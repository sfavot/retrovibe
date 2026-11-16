import { describe, expect, it } from "vitest";
import { decodeCp850 } from "../../../src/data/cp850";
import { digitalAudioOf, LOAD_TIMEOUT_TICKS } from "../../../src/games/gk1/audio/digital";
import { AUDIO_INDEX_PATH, parseDurationJson, parseSyncJson, samplesToTicks } from "../../../src/games/gk1/data/audio-index";
import { eventsOf, MouseButton, SciKey } from "../../../src/games/gk1/engine/events";
import { MessageMode } from "../../../src/games/gk1/engine/ids";
import { DoAudioOp, DoSyncOp, lipSyncOf, SUSPEND_DIGITAL } from "../../../src/games/gk1/engine/kernel/audio";
import { DoSoundOp, soundManagerOf } from "../../../src/games/gk1/engine/kernel/sound";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { fromInt, NULL_REG, type Reg, toSint16 } from "../../../src/games/gk1/engine/memory";
import { messageModeOf, messagesOf, setMessageMode } from "../../../src/games/gk1/engine/message";
import { lookupSelector, newLookup, readSelector, SelectorKind, writeSelector } from "../../../src/games/gk1/engine/object";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { mainIndex, original } from "../data/real";
import { diskFiles, fakeFiles } from "./digital-files";

const TITLE_ROOM = 375;
const DREAM_ROOM = 370;
const BOOKSHOP = 210;
/** Clip avec synchronisation des lèvres : 59 094 échantillons, 161 ticks. */
const CLIP = [50, 6, 0, 20, 1] as const;
const CLIP_TICKS = 161;
/** Réplique du prêcheur à la télévision : un message parlé sans clip sur le CD français. */
const UNVOICED = [220, 23, 0, 58, 1] as const;
/** Variable globale de la vitesse du texte. */
const GLOBAL_TEXT_SPEED = 94;

const text = (name: string): string => new TextDecoder().decode(original.read(name));

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

/** Machine virtuelle sur les scripts réels, sans lancer le jeu, avec les fichiers audio du disque. */
function world(files = diskFiles()) {
  const vm = new Vm(mainIndex());
  vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
  digitalAudioOf(vm).files = files;
  const call = (name: string, ...args: Reg[]): Reg => vm.kernel.call(vm, vm.kernel.indexOf(name), Uint32Array.from(args));
  return {
    vm,
    digital: digitalAudioOf(vm),
    doAudio: (...args: number[]): number => toSint16(call("DoAudio", ...args)),
    doSync: (...args: Reg[]): Reg => call("DoSync", ...args),
    doSound: (...args: Reg[]): Reg => call("DoSound", ...args),
    get: (object: Reg, name: string): number => toSint16(readSelector(vm.memory, object, vm.selectors.id(name))),
    set: (object: Reg, name: string, value: Reg): void => writeSelector(vm.memory, object, vm.selectors.id(name), value),
  };
}

describe.skipIf(!original.has)("DoAudio et DoSync sur les scripts réels", () => {
  it("Play rend la durée du clip, Position avance avec l'horloge du jeu et rend −1 à la fin, Stop compte les canaux", () => {
    const { vm, doAudio } = world();
    vm.acc = 0x1234;
    expect(doAudio(DoAudioOp.Play)).toBe(0);
    expect(doAudio(DoAudioOp.Position)).toBe(-1);
    expect(doAudio(DoAudioOp.Position, ...CLIP)).toBe(-1);
    expect(doAudio(DoAudioOp.Play, ...CLIP)).toBe(CLIP_TICKS);
    expect([doAudio(DoAudioOp.Play), doAudio(DoAudioOp.Position, ...CLIP), doAudio(DoAudioOp.Position)]).toEqual([1, 0, 0]);
    vm.ticks += 100;
    expect([doAudio(DoAudioOp.Position, ...CLIP), doAudio(DoAudioOp.Position)]).toEqual([100, 100]);
    // Un son numéroté en plus (le 12, 20 352 échantillons : 56 ticks), en boucle : seule la valeur 1 ne boucle pas.
    const sounds = parseDurationJson(text(AUDIO_INDEX_PATH));
    expect(doAudio(DoAudioOp.Play, 12, 2, 80)).toBe(samplesToTicks(sounds.get("12")!));
    expect(doAudio(DoAudioOp.Play)).toBe(2);
    vm.ticks += 60;
    expect([doAudio(DoAudioOp.Position, ...CLIP), doAudio(DoAudioOp.Position, 12)]).toEqual([160, 60]);
    vm.ticks += 1;
    expect([doAudio(DoAudioOp.Position, ...CLIP), doAudio(DoAudioOp.Position, 12), doAudio(DoAudioOp.Play)]).toEqual([-1, 61, 1]);
    expect(doAudio(DoAudioOp.Stop, ...CLIP)).toBe(0);
    expect(doAudio(DoAudioOp.Stop, 12)).toBe(1);
    doAudio(DoAudioOp.Play, ...CLIP);
    doAudio(DoAudioOp.Play, 12, 1);
    expect(doAudio(DoAudioOp.Stop)).toBe(2);
    expect([doAudio(DoAudioOp.Stop), doAudio(DoAudioOp.Play)]).toEqual([0, 0]);

    expect([doAudio(DoAudioOp.Init), doAudio(DoAudioOp.GetCapability), doAudio(DoAudioOp.SetBufferSize, 63)]).toEqual([0, 1, 0x1234]);
    // La sous-fonction 1 (absente de SCI2) rend la durée sans rien jouer.
    expect([doAudio(DoAudioOp.WaitPlay, ...CLIP), doAudio(DoAudioOp.Play)]).toEqual([CLIP_TICKS, 0]);
    expect([...vm.warnings.keys()]).toEqual([]);
    expect(doAudio(12)).toBe(0x1234);
    expect([...vm.warnings.keys()]).toEqual(["DoAudio : sous-fonction 12 non portée"]);
    expect(vm.kernel.journal.stubs.size).toBe(0);
  });

  it("message sans clip : Play rend le temps de lecture du texte, sans canal ; clé sans message ni clip : 0", () => {
    const { vm, doAudio } = world();
    const [module, noun, verb, cond, seq] = UNVOICED;
    const length = messagesOf(vm).size(module, { noun, verb, cond, seq }) - 1;
    expect(length).toBeGreaterThan(60);
    const globals = vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values;
    globals[GLOBAL_TEXT_SPEED] = 2;
    expect(doAudio(DoAudioOp.Play, ...UNVOICED)).toBe(Math.trunc((24 * length) / 10) * 2);
    // Un texte court ne descend pas sous 120 ticks : « "Oh, merci." » (210 2-0-81-1).
    expect(doAudio(DoAudioOp.Play, 210, 2, 0, 81, 1)).toBe(120);
    expect([doAudio(DoAudioOp.Play), doAudio(DoAudioOp.Position, ...UNVOICED)]).toEqual([0, -1]);
    expect(doAudio(DoAudioOp.Play, 210, 250, 0, 0, 1)).toBe(0);
    expect(doAudio(DoAudioOp.Play, 9999)).toBe(0);
    // Sans aucun fichier audio (hôte sans voix), toute réplique se comporte ainsi.
    const silent = world({ has: () => false, text: () => undefined, load: () => Promise.reject(new Error("absent")) });
    expect(silent.doAudio(DoAudioOp.Play, ...CLIP)).toBeGreaterThanOrEqual(120);
    expect(silent.doAudio(DoAudioOp.Play)).toBe(0);
  });

  it("index du module en route : Play rend la main image après image, puis rend la durée ; perdu, le clip est absent", () => {
    const files = fakeFiles({ "voices/50/index.json": '{"6-0-20-1":44100}' }, ["voices/50/6-0-20-1.mp3"], 4);
    const { vm, doAudio, digital } = world(files);
    doAudio(DoAudioOp.Play, ...CLIP);
    let frames = 0;
    for (;;) {
      vm.ticks++;
      const result = vm.run();
      if (result.status === RunStatus.Finished) break;
      expect(result).toEqual({ status: RunStatus.Suspended, reason: SUSPEND_DIGITAL });
      frames++;
    }
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(5);
    expect([toSint16(vm.acc), digital.activeCount]).toEqual([121, 1]);

    // Un index qui n'arrive jamais : au bout du délai, la réplique reçoit son temps de lecture (ici 0 : pas de message).
    const lost = world(fakeFiles({ "voices/9/index.json": "{}" }, ["voices/9/1-0-0-1.mp3"], Infinity));
    lost.doAudio(DoAudioOp.Play, 9, 1, 0, 0, 1);
    let waited = 0;
    for (; lost.vm.run().status !== RunStatus.Finished; waited++) lost.vm.ticks++;
    expect(waited).toBe(LOAD_TIMEOUT_TICKS);
    expect([toSint16(lost.vm.acc), lost.digital.activeCount]).toEqual([0, 0]);
  });

  it("DoSync : Start écrit syncCue, Next sert les repères du clip puis −1", () => {
    const { vm, doSync, get } = world();
    const object = send(vm, classNamed(vm, "Sync"), "new");
    const cues = parseSyncJson(text("voices/50/sync.json")).get("6-0-20-1")!;
    vm.acc = 0x4321;
    expect(doSync(DoSyncOp.Start, object, ...CLIP)).toBe(0x4321);
    expect(get(object, "syncCue")).toBe(0);
    const seen: number[][] = [];
    for (let i = 0; i < cues.length + 2; i++) {
      doSync(DoSyncOp.Next, object);
      seen.push([get(object, "syncTime"), get(object, "syncCue")]);
    }
    expect(seen).toEqual([...cues.map((cue) => [cue.tick, cue.cue]), [-1, -1], [-1, -1]]);
    doSync(DoSyncOp.Stop);
    expect(lipSyncOf(vm).active).toBe(false);
    // Clip sans synchronisation (module 210) : −1, le script n'anime pas la bouche.
    doSync(DoSyncOp.Start, object, 210, 11, 0, 34, 1);
    expect(get(object, "syncCue")).toBe(-1);
    doSync(DoSyncOp.Start, object, 5);
    expect(get(object, "syncCue")).toBe(-1);
    expect([...vm.warnings.keys()]).toEqual([]);
  });

  it("MouthSync du jeu : le cel de la bouche suit les repères du clip à la position de l'audio", () => {
    const { vm, doAudio, get } = world();
    const cues = parseSyncJson(text("voices/50/sync.json")).get("6-0-20-1")!;
    const mouth = send(vm, classNamed(vm, "Prop"), "new");
    const cycler = send(vm, classNamed(vm, "MouthSync"), "new");
    // Comme `Talker::startAudio` : la bouche reçoit son `MouthSync`, puis la voix part.
    send(vm, cycler, "init", mouth, ...CLIP);
    expect(doAudio(DoAudioOp.Play, ...CLIP)).toBe(CLIP_TICKS);
    const cels: number[] = [];
    let changes = 0;
    for (let tick = 0; tick < CLIP_TICKS; tick++) {
      send(vm, cycler, "doit");
      // Repère en vigueur à cette position : le dernier dont le temps est atteint ; ses 4 bits bas sont le cel.
      // Au tick 0 le script n'a encore rien écrit : il lit le premier repère, daté de 0, sans voir le temps changer.
      const current = cues.filter((cue) => cue.tick <= tick).at(-1)!;
      expect([tick, get(mouth, "cel")]).toEqual([tick, tick === 0 ? 0 : current.cue & 15]);
      if (cels.at(-1) !== get(mouth, "cel")) changes++;
      cels.push(get(mouth, "cel"));
      vm.ticks++;
    }
    expect(cels.slice(0, 8)).toEqual([0, 5, 5, 4, 10, 10, 5, 4]);
    expect(changes).toBeGreaterThan(20);
    // Le clip est fini : la position commune vaut −1, la bouche garde son dernier cel.
    send(vm, cycler, "doit");
    expect([doAudio(DoAudioOp.Position), get(mouth, "cel")]).toEqual([-1, cels.at(-1)]);
    expect([...vm.warnings.keys()]).toEqual([]);
  });

  it("DoSound : un son qui a un fichier audio passe par un canal numérique, finit seul, et son fondu l'arrête", () => {
    const { vm, doSound, digital, get, set } = world();
    const duration = samplesToTicks(parseDurationJson(text(AUDIO_INDEX_PATH)).get("12")!);
    const sound = (loop: number): Reg => {
      const object = send(vm, classNamed(vm, "Sound"), "new");
      set(object, "number", 12);
      set(object, "loop", fromInt(loop));
      set(object, "vol", 127);
      return object;
    };
    const run = (object: Reg, count: number): void => {
      for (let i = 0; i < count; i++) {
        vm.ticks++;
        doSound(DoSoundOp.UpdateCues, object);
      }
    };
    const once = sound(1);
    doSound(DoSoundOp.Play, once, 0);
    expect([soundManagerOf(vm).slot(once)!.isSample, digital.activeCount, digital.position({ sound: 12 }, once)]).toEqual([true, 1, 0]);
    run(once, duration - 1);
    expect([readSelector(vm.memory, once, vm.selectors.id("handle")), get(once, "signal")]).toEqual([once, 0]);
    run(once, 1);
    expect([readSelector(vm.memory, once, vm.selectors.id("handle")), get(once, "signal"), digital.activeCount]).toEqual([NULL_REG, -1, 0]);

    // En boucle, puis fondu vers 0 en 10 × 5 ticks avec arrêt : le volume descend en ligne droite, puis le son s'arrête.
    const looped = sound(-1);
    doSound(DoSoundOp.Play, looped, 0);
    run(looped, 3 * duration);
    expect(digital.position({ sound: 12 }, looped)).toBe(3 * duration);
    doSound(DoSoundOp.Fade, looped, 0, 10, 5, 1);
    run(looped, 25);
    expect(digital.volume({ sound: 12 }, looped)).toBe(127 - Math.trunc((127 * 25) / 50));
    run(looped, 25);
    expect(digital.activeCount).toBe(1);
    run(looped, 2);
    expect([readSelector(vm.memory, looped, vm.selectors.id("handle")), get(looped, "signal"), digital.activeCount]).toEqual([NULL_REG, -1, 0]);
    expect([...vm.warnings.keys()]).toEqual([]);
  });
});

/** Textes des fenêtres de texte à l'écran. */
function shownTexts(vm: Vm): string[] {
  const selector = vm.selectors.id("text");
  const out: string[] = [];
  for (const plane of frameoutOf(vm).planes) {
    for (const item of plane.items) {
      const object = item.object !== 0 && item.bitmap !== 0 ? vm.memory.getObject(item.object) : undefined;
      if (!object || lookupSelector(vm.memory, object, selector, newLookup()) !== SelectorKind.Variable) continue;
      const raw = vm.memory.getString(readSelector(vm.memory, item.object, selector));
      out.push(decodeCp850(Uint8Array.from(raw, (char) => char.charCodeAt(0))));
    }
  }
  return out;
}

describe.skipIf(!original.has)("parcours sans tête en « texte et voix » : la réplique dure le temps de son clip", () => {
  const GRACE = '"Mmmmm-hmmm. Je l\'aurais parié. Un instant."';
  const GRACE_CLIP = "11-0-34-1";
  /** Écart admis, en ticks, entre la durée attendue et le temps passé à l'écran. */
  const TOLERANCE = 6;

  /** Du démarrage à la première réplique de Grace dans la librairie ; rend le nombre de ticks qu'elle reste à l'écran. */
  function graceLine(missing: readonly string[]): { vm: Vm; shownFor: number; next: string[] } {
    const vm = new Vm(mainIndex());
    useGameClock(vm);
    digitalAudioOf(vm).files = diskFiles(missing);
    vm.boot();
    const events = eventsOf(vm);
    let frames = 0;
    const step = (count = 1): void => {
      for (let i = 0; i < count; i++) {
        if (++frames > 12000) throw new Error(`parcours trop long (pièce ${currentRoom(vm)})`);
        expect(runFrame(vm)).toEqual({ status: RunStatus.Suspended, reason: "FrameOut" });
      }
    };
    const button = () => frameoutOf(vm).planes.flatMap((plane) => plane.items).find((item) => item.object !== 0 && vm.nameOf(item.object) === "playButt");
    while (!(currentRoom(vm) === TITLE_ROOM && button() !== undefined)) step();
    step(120);
    expect(messageModeOf(vm)).toBe(MessageMode.Both);
    setMessageMode(vm, MessageMode.Both, true);
    const { left, top } = button()!.screenRect;
    events.move(left + 5, top + 3);
    step(3);
    events.down(MouseButton.Left, left + 5, top + 3);
    events.up(MouseButton.Left, left + 5, top + 3);
    while (currentRoom(vm) !== DREAM_ROOM) step();
    // Le poème du rêve (talker 64, toujours en texte seul) attend Entrée ; la scène d'ouverture mène à la librairie.
    while (!(currentRoom(vm) === BOOKSHOP && shownTexts(vm).length > 0)) {
      if (shownTexts(vm).length > 0) {
        events.keyDown(SciKey.Enter);
        events.keyUp(SciKey.Enter);
      }
      step(30);
    }
    // Sans aucune entrée : la réplique se ferme d'elle-même, et la suivante arrive.
    while (!shownTexts(vm).includes(GRACE)) step();
    const from = vm.ticks;
    while (shownTexts(vm).includes(GRACE)) step();
    const shownFor = vm.ticks - from;
    while (shownTexts(vm).length === 0) step();
    return { vm, shownFor, next: shownTexts(vm) };
  }

  it("la réplique de Grace se ferme seule à la fin de son clip, puis la suivante arrive", { timeout: 120_000 }, () => {
    const duration = samplesToTicks(parseDurationJson(text("voices/210/index.json")).get(GRACE_CLIP)!);
    const { vm, shownFor, next } = graceLine([]);
    expect(messagesOf(vm).lastQuery().module).toBe(BOOKSHOP);
    // La fenêtre apparaît quelques ticks après le départ de la voix et se ferme au premier passage du talker après sa fin.
    expect(Math.abs(shownFor - duration)).toBeLessThanOrEqual(TOLERANCE);
    expect(next).toEqual(['"C\'est dur à ce que je vois. Veux-tu parler à \'Lolita\'?"']);
    expect(vm.kernel.journal.stubs.has("DoAudio")).toBe(false);
    expect([...vm.warnings.keys()]).toEqual([]);
  });

  it("sans le fichier du clip, la même réplique reste le temps de lecture de son texte", { timeout: 120_000 }, () => {
    const { vm, shownFor, next } = graceLine([`voices/210/${GRACE_CLIP}.mp3`]);
    // 43 caractères : 24 × 43 / 10 = 103 ticks par cran de vitesse, au moins 120.
    const speed = toSint16(vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values[GLOBAL_TEXT_SPEED]);
    const reading = Math.max(120, Math.trunc((24 * GRACE.length) / 10) * speed);
    expect(Math.abs(shownFor - reading)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(reading - samplesToTicks(parseDurationJson(text("voices/210/index.json")).get(GRACE_CLIP)!))).toBeGreaterThan(2 * TOLERANCE);
    expect(next).toEqual(['"C\'est dur à ce que je vois. Veux-tu parler à \'Lolita\'?"']);
    expect([...vm.warnings.keys()]).toEqual([]);
  });
});
