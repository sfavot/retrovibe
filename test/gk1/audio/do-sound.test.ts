import { describe, expect, it } from "vitest";
import type { MidiSink } from "../../../src/audio/midi-sink";
import { parseSong } from "../../../src/games/gk1/audio/sci-song";
import { SoundStatus } from "../../../src/games/gk1/audio/sound-manager";
import { ResourceType, SoundDevice } from "../../../src/games/gk1/data/ids";
import { readSound } from "../../../src/games/gk1/data/sound";
import { collectGarbage } from "../../../src/games/gk1/engine/gc";
import { DoSoundOp, setSampleOutput, soundDriverOf, soundManagerOf } from "../../../src/games/gk1/engine/kernel/sound";
import { fromInt, NULL_REG, type Reg } from "../../../src/games/gk1/engine/memory";
import { readSelector, writeSelector } from "../../../src/games/gk1/engine/object";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { mainIndex, original } from "../data/real";

class CountingSink implements MidiSink {
  noteOns = 0;
  messages = 0;
  send(message: Uint8Array): void {
    this.messages++;
    if ((message[0] & 0xf0) === 0x90) this.noteOns++;
  }
  reset(): void {}
}

function send(vm: Vm, object: Reg, selector: string, ...args: Reg[]): Reg {
  vm.start(object, vm.selectors.id(selector), args);
  expect(vm.run().status).toBe(RunStatus.Finished);
  return vm.acc;
}

function classNamed(vm: Vm, name: string): Reg {
  for (let species = 0; species < vm.scripts.classCount; species++) {
    const address = vm.scripts.classAddress(species, 0);
    if (vm.nameOf(address) === name) return address;
  }
  throw new Error(name);
}

describe.skipIf(!original.has)("DoSound sur les scripts réels", () => {
  function world() {
    const vm = new Vm(mainIndex());
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    const doSound = (op: number, ...args: Reg[]): Reg => vm.kernel.call(vm, vm.kernel.indexOf("DoSound"), Uint32Array.of(op, ...args));
    /** Instance de la classe `Sound` du jeu, réglée sur le son `number`. */
    const sound = (number: number, loop = 1): Reg => {
      const object = send(vm, classNamed(vm, "Sound"), "new");
      set(object, "number", number);
      set(object, "loop", loop);
      set(object, "vol", 127);
      return object;
    };
    const get = (object: Reg, name: string): Reg => readSelector(vm.memory, object, vm.selectors.id(name));
    const set = (object: Reg, name: string, value: Reg): void => writeSelector(vm.memory, object, vm.selectors.id(name), value);
    const props = (object: Reg, ...names: string[]): Reg[] => names.map((name) => get(object, name));
    /** Avance l'horloge du jeu de `count` ticks, avec un `UpdateCues` par tick comme `Sound::check`. */
    const run = (object: Reg, count: number): void => {
      for (let i = 0; i < count; i++) {
        vm.ticks++;
        doSound(DoSoundOp.UpdateCues, object);
      }
    };
    return { vm, doSound, sound, get, set, props, run, manager: soundManagerOf(vm) };
  }

  it("répond aux questions sur le matériel et règle le volume maître", () => {
    const { vm, doSound } = world();
    vm.acc = 0x1234;
    expect(doSound(DoSoundOp.GetAudioCapability)).toBe(1);
    expect(doSound(DoSoundOp.GetPolyphony)).toBe(32);
    expect(doSound(DoSoundOp.MasterVolume)).toBe(15);
    expect(doSound(DoSoundOp.MasterVolume, 8)).toBe(15);
    expect(doSound(DoSoundOp.MasterVolume, fromInt(-3))).toBe(8);
    expect(doSound(DoSoundOp.MasterVolume, 99)).toBe(0);
    expect(doSound(DoSoundOp.MasterVolume)).toBe(15);
    expect(doSound(DoSoundOp.Mute)).toBe(1);
    expect(doSound(DoSoundOp.Mute, 0)).toBe(1);
    expect(doSound(DoSoundOp.Mute, 1)).toBe(0);
    // Sans effet : l'accumulateur reste.
    expect(doSound(DoSoundOp.Restore)).toBe(0x1234);
    expect(doSound(DoSoundOp.Pause, NULL_REG, 0)).toBe(0x1234);
    expect(vm.kernel.isImplemented("DoSound")).toBe(true);
    expect(vm.kernel.journal.stubs.has("DoSound")).toBe(false);
    expect(vm.warnings.size).toBe(0);
  });

  it("Init, Play, UpdateCues : le son 1 rend ses trois signaux puis sa fin dans les propriétés de l'objet", () => {
    const { vm, doSound, sound, props, run, manager } = world();
    const object = sound(1);
    doSound(DoSoundOp.Init, object);
    expect(props(object, "nodePtr", "handle")).toEqual([object, NULL_REG]);
    const slot = manager.slot(object)!;
    expect([slot.resourceId, slot.status, slot.hasData]).toEqual([1, SoundStatus.Stopped, true]);
    writeSelector(vm.memory, object, vm.selectors.id("signal"), 77);
    doSound(DoSoundOp.Play, object, 0);
    expect(props(object, "handle", "nodePtr", "signal", "min", "sec", "frame")).toEqual([object, object, 0, 0, 0, 0]);
    // Priorité du son (piste 0xF0), pas celle de l'objet.
    expect([slot.status, slot.priority, slot.loop]).toEqual([SoundStatus.Playing, 100, 1]);

    // Les signaux tombent aux ticks 317, 569 et 627 du morceau (joués un tick après leur date).
    const seen: [number, number][] = [];
    for (let tick = 1; tick <= 800 && props(object, "handle")[0] !== NULL_REG; tick++) {
      run(object, 1);
      const signal = props(object, "signal")[0];
      if (signal !== 0) {
        seen.push([tick, signal]);
        writeSelector(vm.memory, object, vm.selectors.id("signal"), 0);
      }
      if (tick === 200) expect(props(object, "min", "sec", "frame", "vol")).toEqual([0, 3, 9, 127]);
    }
    expect(seen).toEqual([
      [318, 10],
      [570, 20],
      [628, 30],
      [779, 0xffff],
    ]);
    // Fin : le noyau a arrêté le son et vidé `handle`.
    expect(props(object, "handle", "nodePtr")).toEqual([NULL_REG, object]);
    expect(slot.status).toBe(SoundStatus.Stopped);
    expect(props(object, "min", "sec", "frame")).toEqual([0, 12, 29]);

    doSound(DoSoundOp.Dispose, object);
    expect(props(object, "handle", "nodePtr")).toEqual([NULL_REG, NULL_REG]);
    expect(manager.slot(object)).toBeUndefined();
    expect(vm.warnings.size).toBe(0);
  });

  it("joue les notes du morceau sur le synthétiseur branché", () => {
    const { vm, doSound, sound, run } = world();
    const sink = new CountingSink();
    soundDriverOf(vm).attach(sink);
    // Initialisation du patch 4 : 65 messages, puis l'état des 16 canaux.
    expect(sink.messages).toBe(65 + 16 * 2);
    const object = sound(1);
    doSound(DoSoundOp.Play, object, 0);
    run(object, 800);
    const song = parseSong(readSound(mainIndex().get(ResourceType.Sound, 1)), SoundDevice.GeneralMidi)!;
    expect(sink.noteOns).toBe(song.events.filter((e) => e.status === 0x90).length);
    expect(sink.noteOns).toBe(122);
  });

  it("Stop, SetLoop, SetVolume, SetPriority, SetHold écrivent les propriétés", () => {
    const { vm, doSound, sound, props, run, manager } = world();
    const object = sound(100, fromInt(-1));
    doSound(DoSoundOp.Play, object, 0);
    const slot = manager.slot(object)!;
    expect(slot.loop).toBe(0xffff);
    run(object, 10);

    doSound(DoSoundOp.SetVolume, object, 90);
    expect([props(object, "vol")[0], slot.volume]).toEqual([90, 90]);
    doSound(DoSoundOp.SetVolume, object, 500);
    expect(props(object, "vol")[0]).toBe(127);

    doSound(DoSoundOp.SetLoop, object, 1);
    expect([props(object, "loop")[0], slot.loop]).toEqual([1, 1]);
    doSound(DoSoundOp.SetLoop, object, fromInt(-1));
    expect([props(object, "loop")[0], slot.loop]).toEqual([0xffff, 0xffff]);

    doSound(DoSoundOp.SetPriority, object, 120);
    expect([slot.priority, slot.overridePriority, props(object, "flags")[0] & 2]).toEqual([120, true, 2]);
    doSound(DoSoundOp.SetPriority, object, fromInt(-1));
    expect([slot.priority, slot.overridePriority, props(object, "flags")[0] & 2]).toEqual([0, false, 0]);

    doSound(DoSoundOp.SetHold, object, 2);
    expect(slot.hold).toBe(2);

    doSound(DoSoundOp.Pause, object, 1);
    expect(slot.status).toBe(SoundStatus.Paused);
    run(object, 5);
    expect(props(object, "frame")[0]).toBe(4);
    doSound(DoSoundOp.Pause, NULL_REG, 0);
    expect(slot.status).toBe(SoundStatus.Playing);

    doSound(DoSoundOp.Stop, object);
    expect(props(object, "handle", "signal")).toEqual([NULL_REG, 0xffff]);
    expect(slot.status).toBe(SoundStatus.Stopped);
    // Sans emplacement : seul SetLoop écrit encore.
    doSound(DoSoundOp.Dispose, object);
    doSound(DoSoundOp.SetLoop, object, 5);
    doSound(DoSoundOp.SetVolume, object, 3);
    doSound(DoSoundOp.UpdateCues, object);
    expect(props(object, "loop", "vol")).toEqual([1, 127]);
    expect(vm.warnings.size).toBe(0);
  });

  it("Fade : le volume descend dans `vol`, puis signal 0xFE, et arrêt s'il est demandé", () => {
    const { doSound, sound, props, set, run, manager } = world();
    const object = sound(100, fromInt(-1));
    doSound(DoSoundOp.Play, object, 0);
    run(object, 5);
    // Comme `Sound::fade` sans argument : vers 0, un pas de 10 toutes les 26 ticks, puis arrêt.
    doSound(DoSoundOp.Fade, object, 0, 25, 10, 1);
    run(object, 1);
    expect(props(object, "vol", "signal")).toEqual([117, 0]);
    run(object, 26 * 11);
    expect(props(object, "vol", "signal", "handle")).toEqual([7, 0, object]);
    run(object, 26);
    expect(props(object, "vol", "signal", "handle")).toEqual([0, 0xffff, NULL_REG]);
    expect(manager.slot(object)!.status).toBe(SoundStatus.Stopped);

    // Sans arrêt : le son continue, le script voit 0xFE.
    const other = sound(100, fromInt(-1));
    doSound(DoSoundOp.Play, other, 0);
    run(other, 5);
    doSound(DoSoundOp.Fade, other, 100, 0, 30, 0);
    run(other, 1);
    expect(props(other, "vol", "signal", "handle")).toEqual([100, 0xfe, other]);
    set(other, "signal", 0);
    run(other, 1);
    expect(props(other, "signal")).toEqual([0]);
    expect(manager.slot(other)!.status).toBe(SoundStatus.Playing);
  });

  it("un son sans piste General MIDI, ou sans ressource, finit aussitôt : les scripts n'attendent pas", () => {
    const { vm, doSound, sound, props, manager } = world();
    for (const number of [215, 264, 9999]) {
      const object = sound(number);
      doSound(DoSoundOp.Init, object);
      expect(props(object, "nodePtr")).toEqual([NULL_REG]);
      doSound(DoSoundOp.Play, object, 0);
      expect(props(object, "handle", "signal")).toEqual([object, 0]);
      vm.ticks++;
      doSound(DoSoundOp.UpdateCues, object);
      expect(props(object, "handle", "signal")).toEqual([NULL_REG, 0xffff]);
      expect(manager.slot(object)!.status).toBe(SoundStatus.Stopped);
    }
    expect(vm.warnings.size).toBe(0);
  });

  it("change de son quand `number` change, et relaie un son numérisé", () => {
    const { doSound, sound, set, props, run, vm, manager } = world();
    const played: number[] = [];
    let finished = false;
    setSampleOutput(vm, { has: (id) => id === 2017, play: (_key, id) => played.push(id), stop: () => {}, pause: () => {}, setVolume: () => {}, finished: () => finished });
    const object = sound(1);
    doSound(DoSoundOp.Play, object, 0);
    expect(manager.slot(object)!.resourceId).toBe(1);
    set(object, "number", 2017);
    doSound(DoSoundOp.Play, object, 0);
    const slot = manager.slot(object)!;
    expect([slot.resourceId, slot.isSample, played]).toEqual([2017, true, [2017]]);
    run(object, 10);
    expect(props(object, "handle")).toEqual([object]);
    finished = true;
    run(object, 1);
    expect(props(object, "handle", "signal")).toEqual([NULL_REG, 0xffff]);
  });

  it("SendMidi : coupe un canal (comme `Sound::mute`), envoie contrôleurs et molette", () => {
    const { doSound, sound, run, manager } = world();
    const object = sound(1);
    doSound(DoSoundOp.Play, object, 0);
    run(object, 2);
    const slot = manager.slot(object)!;
    // Canaux comptés à partir de 1 par les scripts.
    expect(manager.deviceChannel(slot, 1)).toBeGreaterThan(0);
    doSound(DoSoundOp.SendMidi, object, 2, 0xb0, 0x4e, 1);
    expect(manager.deviceChannel(slot, 1)).toBe(-1);
    doSound(DoSoundOp.SendMidi, object, 2, 0xb0, 0x4e, 0);
    expect(manager.deviceChannel(slot, 1)).toBeGreaterThan(0);
    doSound(DoSoundOp.SendMidi, object, 2, 7, 64);
    doSound(DoSoundOp.SendMidi, object, 2, 0xff, fromInt(-0x2000));
    doSound(DoSoundOp.SendMidi, object, 2, 0xff, 0x3000);
  });

  it("les objets qui ont un emplacement survivent au ramasse-miettes", () => {
    const { vm, doSound, sound, manager } = world();
    const kept = sound(1);
    const lost = sound(1);
    doSound(DoSoundOp.Init, kept);
    // L'accumulateur tient encore le dernier objet créé.
    vm.acc = vm.prev = NULL_REG;
    collectGarbage(vm);
    expect(vm.memory.isObject(kept)).toBe(true);
    expect(vm.memory.isObject(lost)).toBe(false);
    doSound(DoSoundOp.Dispose, kept);
    expect([...manager.keys()]).toEqual([]);
    collectGarbage(vm);
    expect(vm.memory.isObject(kept)).toBe(false);
  });
});
