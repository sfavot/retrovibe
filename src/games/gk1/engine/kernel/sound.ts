/**
 * Noyau, groupe « son » : `DoSound` et ses sous-fonctions (`docs/gk1/engine.md` § 5), entre les objets `Sound` des scripts
 * et le gestionnaire de sons (`audio/sound-manager.ts`).
 *
 * Référence : `engines/sci/sound/soundcmd.cpp` de ScummVM (`SoundCommandParser` : `processInitSound`, `processPlaySound`,
 * `processStopSound`, `processDisposeSound`, `processUpdateCues`, `kDoSoundPause`, `kDoSoundFade`, `kDoSoundSetHold`,
 * `kDoSoundSetVolume`, `kDoSoundSetPriority`, `kDoSoundSetLoop`, `kDoSoundSendMidi`, `kDoSoundMasterVolume`), GPL v3 ou
 * ultérieure, lu puis réécrit.
 *
 * Sous-fonctions de SCI2 (le premier argument) et propriétés de l'objet touchées :
 * - 0 `MasterVolume([v])` : rend le volume maître (0 à 15) d'avant, le fixe si `v` est donné ;
 * - 1 `Mute([on])` : rend l'état « son ouvert » d'avant, le fixe si `on` est donné (jamais appelée par le jeu) ;
 * - 2 `Restore`, 5 `Suspend`, 13, 19 `GlobalReverb`, 20 `Update` : sans effet ;
 * - 3 `GetPolyphony` : voix du pilote (32) ; 4 `GetAudioCapability` : 1 (il y a une sortie numérique) ;
 * - 6 `Init(obj)` : crée l'emplacement d'après `number`, `loop`, `priority`, `vol` ; écrit `nodePtr` = l'objet si le son a
 *   de quoi jouer ;
 * - 7 `Dispose(obj)` : arrête, libère ; `handle` = 0, `nodePtr` = 0 ;
 * - 8 `Play(obj, fond)` : `handle` = `nodePtr` = l'objet, `min` = `sec` = `frame` = `signal` = 0 ; relit `loop`, `vol`, et
 *   `priority` si le son n'a pas la sienne ;
 * - 9 `Stop(obj)` : `handle` = 0, `signal` = −1 ;
 * - 10 `Pause(obj ou 0, oui)` : un son, ou tous ; 11 `Fade(obj, volume, ticks, pas, arrêt)` ; 12 `SetHold(obj, valeur)` ;
 * - 14 `SetVolume(obj, v)` : écrit `vol` ; 15 `SetPriority(obj, p)` : −1 rend la priorité au son ; bit 2 de `flags` ;
 * - 16 `SetLoop(obj, n)` : `loop` = −1 si `n` vaut −1, sinon 1 ;
 * - 17 `UpdateCues(obj)` : recopie l'état du son dans l'objet. S'il y a un signal, `signal` le reçoit (et le son s'arrête
 *   si c'est la fin) ; sinon, si `dataInc` a changé, `dataInc` est écrit et `signal` = `dataInc` + 127. Un son sans rien à
 *   jouer s'arrête aussitôt (`signal` = −1) : **les scripts n'attendent jamais un son muet**. Un fondu fini donne
 *   `signal` = 0xFE, puis l'arrêt s'il était demandé. Enfin `min`, `sec`, `frame` (1/30 s) et `vol` ;
 * - 18 `SendMidi(obj, canal, [commande,] contrôleur, valeur)` : canal de 1 à 16 ; avec quatre arguments, contrôleur 0xFF =
 *   molette (valeur signée autour du centre).
 *
 * Le gestionnaire appartient à la machine virtuelle (`soundManagerOf`) : créé au premier besoin avec le pilote General MIDI
 * et le patch 4, sans synthétiseur ni horloge audio (l'interface branche les siens : `soundDriverOf(vm).attach(…)`, `soundManagerOf(vm).clock`). Les objets qui
 * ont un emplacement sont des racines du ramasse-miettes. Chaque appel de `DoSound` avance d'abord le gestionnaire jusqu'à
 * `vm.ticks`.
 *
 * Écarts volontaires : une propriété absente de l'objet est ignorée avec un avertissement (ScummVM s'arrête) ; les sons
 * numérisés lancés par `DoSound` (ceux qui ont un `audio/<n>.mp3`) passent par `audio/digital.ts`, un canal par objet.
 */
import { digitalAudioOf } from "../../audio/digital";
import { GmDriver } from "../../audio/gm-driver";
import { parseSong } from "../../audio/sci-song";
import { SIGNAL_END, type SampleOutput, SoundManager, type SoundSlot, SoundStatus } from "../../audio/sound-manager";
import { readGmPatch } from "../../data/gm-patch";
import { ResourceType } from "../../data/ids";
import { readSound } from "../../data/sound";
import { TICKS_PER_SECOND } from "../ids";
import { NULL_REG, type Reg, toSint16 } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

export const DoSoundOp = {
  MasterVolume: 0,
  Mute: 1,
  Restore: 2,
  GetPolyphony: 3,
  GetAudioCapability: 4,
  Suspend: 5,
  Init: 6,
  Dispose: 7,
  Play: 8,
  Stop: 9,
  Pause: 10,
  Fade: 11,
  SetHold: 12,
  SetVolume: 14,
  SetPriority: 15,
  SetLoop: 16,
  UpdateCues: 17,
  SendMidi: 18,
  GlobalReverb: 19,
  Update: 20,
} as const;

/** Numéro de la ressource patch qui porte la table General MIDI. */
const GM_PATCH_NUMBER = 4;
/** `signal` écrit quand un fondu se termine. */
const SIGNAL_FADE_DONE = 0xfe;
/** `signal` d'un repère cumulatif : `dataInc` + 127. */
const SIGNAL_CUE_BASE = 127;
/** Bit de `flags` : priorité fixée par le script. */
const FLAG_FIXED_PRIORITY = 2;
const WORD_MASK = 0xffff;
const PITCH_CENTER = 0x2000;
const PITCH_MAX = 0x3fff;
/** Contrôleur qui, dans `SendMidi` à quatre arguments, désigne la molette. */
const SEND_MIDI_PITCH = 0xff;
/** `frame` compte en trentièmes de seconde. */
const TICKS_PER_FRAME = 2;

interface SoundContext {
  readonly driver: GmDriver;
  readonly manager: SoundManager;
  samples: SampleOutput | undefined;
}

const contexts = new WeakMap<Vm, SoundContext>();

function contextOf(vm: Vm): SoundContext {
  let context = contexts.get(vm);
  if (context) return context;
  const patch = vm.resources.find(ResourceType.Patch, GM_PATCH_NUMBER);
  const driver = new GmDriver(patch ? readGmPatch(patch) : undefined);
  const created: SoundContext = {
    driver,
    samples: digitalAudioOf(vm).soundOutput,
    manager: new SoundManager({
      driver,
      loadSong: (resourceId) => {
        const data = vm.resources.find(ResourceType.Sound, resourceId);
        return data ? parseSong(readSound(data), driver.device) : undefined;
      },
      samples: {
        has: (resourceId) => created.samples?.has(resourceId) ?? false,
        play: (key, resourceId, loop, volume) => created.samples?.play(key, resourceId, loop, volume),
        stop: (key) => created.samples?.stop(key),
        pause: (key, paused) => created.samples?.pause(key, paused),
        setVolume: (key, volume) => created.samples?.setVolume(key, volume),
        finished: (key) => created.samples?.finished(key) ?? true,
      },
    }),
  };
  context = created;
  contexts.set(vm, context);
  vm.gcRoots.push(() => created.manager.keys());
  return context;
}

/** Gestionnaire de sons de cette machine virtuelle (créé au premier appel). */
export function soundManagerOf(vm: Vm): SoundManager {
  return contextOf(vm).manager;
}

/** Pilote General MIDI de cette machine virtuelle : l'interface y branche son synthétiseur (`attach`). */
export function soundDriverOf(vm: Vm): GmDriver {
  return contextOf(vm).driver;
}

/** Remplace la sortie des sons numérisés lancés par `DoSound` (par défaut : `digitalAudioOf(vm).soundOutput`). */
export function setSampleOutput(vm: Vm, samples: SampleOutput | undefined): void {
  contextOf(vm).samples = samples;
}

function read(vm: Vm, object: Reg, name: string): number {
  const target = vm.memory.getObject(object);
  const index = target ? target.propertyIndex(vm.selectors.find(name)) : -1;
  return index < 0 ? 0 : target!.vars[index];
}

function write(vm: Vm, object: Reg, name: string, value: Reg): void {
  const target = vm.memory.getObject(object);
  const index = target ? target.propertyIndex(vm.selectors.find(name)) : -1;
  if (index < 0) vm.warn(`DoSound : l'objet n'a pas la propriété ${name}`);
  else target!.setProperty(index, value);
}

function has(vm: Vm, object: Reg, name: string): boolean {
  const target = vm.memory.getObject(object);
  return target !== undefined && target.propertyIndex(vm.selectors.find(name)) >= 0;
}

function initSound(vm: Vm, manager: SoundManager, object: Reg): SoundSlot {
  const slot = manager.init(object, read(vm, object, "number") & WORD_MASK, {
    loop: read(vm, object, "loop"),
    priority: read(vm, object, "priority") & 0xff,
    volume: toSint16(read(vm, object, "vol")),
  });
  if (slot.hasData) write(vm, object, "nodePtr", object);
  return slot;
}

function stopSound(vm: Vm, manager: SoundManager, object: Reg, slot: SoundSlot): void {
  write(vm, object, "handle", NULL_REG);
  write(vm, object, "signal", SIGNAL_END);
  manager.stop(slot);
}

function disposeSound(vm: Vm, manager: SoundManager, object: Reg): void {
  const slot = manager.slot(object);
  if (!slot) return;
  stopSound(vm, manager, object, slot);
  manager.dispose(object);
  write(vm, object, "handle", NULL_REG);
  write(vm, object, "nodePtr", NULL_REG);
}

function playSound(vm: Vm, manager: SoundManager, object: Reg, playBed: boolean): void {
  let slot = manager.slot(object) ?? initSound(vm, manager, object);
  if (slot.resourceId !== (read(vm, object, "number") & WORD_MASK)) {
    disposeSound(vm, manager, object);
    slot = initSound(vm, manager, object);
  }
  write(vm, object, "handle", object);
  write(vm, object, "nodePtr", object);
  for (const name of ["min", "sec", "frame", "signal"]) write(vm, object, name, 0);
  manager.play(slot, {
    loop: read(vm, object, "loop"),
    priority: read(vm, object, "priority") & WORD_MASK,
    volume: toSint16(read(vm, object, "vol")),
    playBed,
  });
}

function updateCues(vm: Vm, manager: SoundManager, object: Reg, slot: SoundSlot): void {
  if (slot.isSample) {
    // Fini de lui-même, ou arrêté au bout de son fondu : le canal n'existe plus.
    slot.fadeCompleted = false;
    if (slot.status !== SoundStatus.Stopped && contextOf(vm).samples?.finished(object) !== false) stopSound(vm, manager, object, slot);
    return;
  }
  if (!slot.song) stopSound(vm, manager, object, slot);
  else if (slot.signal === 0) {
    if (slot.dataInc !== (read(vm, object, "dataInc") & WORD_MASK)) {
      if (has(vm, object, "dataInc")) write(vm, object, "dataInc", slot.dataInc);
      write(vm, object, "signal", (slot.dataInc + SIGNAL_CUE_BASE) & WORD_MASK);
    }
  } else {
    write(vm, object, "signal", slot.signal);
    if (slot.signal === SIGNAL_END) stopSound(vm, manager, object, slot);
  }
  if (slot.fadeCompleted) {
    slot.fadeCompleted = false;
    write(vm, object, "signal", SIGNAL_FADE_DONE);
    if (slot.stopAfterFading) stopSound(vm, manager, object, slot);
  }
  slot.signal = 0;
  write(vm, object, "min", Math.floor(slot.ticker / (60 * TICKS_PER_SECOND)));
  write(vm, object, "sec", Math.floor((slot.ticker % (60 * TICKS_PER_SECOND)) / TICKS_PER_SECOND));
  write(vm, object, "frame", Math.floor((slot.ticker % TICKS_PER_SECOND) / TICKS_PER_FRAME));
  write(vm, object, "vol", slot.volume);
}

function sendMidi(manager: SoundManager, slot: SoundSlot, args: Uint32Array): void {
  // args : objet, canal, [commande,] contrôleur, valeur.
  let command = 0xb0;
  let controller: number;
  let value: number;
  if (args.length >= 5) {
    command = args[2] & 0xf0;
    controller = args[3] & WORD_MASK;
    value = args[4] & WORD_MASK;
  } else {
    controller = args[2] & WORD_MASK;
    value = args[3] & WORD_MASK;
    if (controller === SEND_MIDI_PITCH) {
      const pitch = Math.max(0, Math.min(PITCH_MAX, toSint16(value) + PITCH_CENTER));
      command = 0xe0;
      controller = pitch & 0x7f;
      value = pitch >> 7;
    }
  }
  const channel = args[1] & 0x0f;
  manager.sendMidi(slot, channel > 0 ? channel - 1 : 0, command, controller, value);
}

function doSound(vm: Vm, argv: Uint32Array): Reg {
  const manager = soundManagerOf(vm);
  manager.advanceTo(vm.ticks);
  const op = argv[0];
  const args = argv.subarray(1);
  switch (op) {
    case DoSoundOp.MasterVolume: {
      const previous = manager.masterVolume;
      if (args.length > 0) manager.masterVolume = toSint16(args[0]);
      return previous;
    }
    case DoSoundOp.Mute: {
      const driver = soundDriverOf(vm);
      const previous = driver.soundOn ? 1 : 0;
      if (args.length > 0) driver.soundOn = args[0] !== 0;
      return previous;
    }
    case DoSoundOp.GetPolyphony:
      return manager.driver.polyphony;
    case DoSoundOp.GetAudioCapability:
      return 1;
    case DoSoundOp.Restore:
    case DoSoundOp.Suspend:
    case DoSoundOp.GlobalReverb:
    case DoSoundOp.Update:
      return vm.acc;
    case DoSoundOp.Pause:
      // Sans objet : tous les sons.
      if (args[0] === NULL_REG) manager.pause(undefined, args[1] !== 0);
      else {
        const slot = manager.slot(args[0]);
        if (slot) manager.pause(slot, args[1] !== 0);
      }
      return vm.acc;
    case DoSoundOp.Init:
      initSound(vm, manager, args[0]);
      return vm.acc;
    case DoSoundOp.Play:
      playSound(vm, manager, args[0], args.length > 1 && args[1] !== 0);
      return vm.acc;
    case DoSoundOp.Dispose:
      disposeSound(vm, manager, args[0]);
      return vm.acc;
    case DoSoundOp.SetLoop: {
      // La propriété est écrite même si le son n'a pas d'emplacement.
      const loop = toSint16(args[1]) === -1 ? WORD_MASK : 1;
      write(vm, args[0], "loop", loop);
      const slot = manager.slot(args[0]);
      if (slot) manager.setLoop(slot, loop);
      return vm.acc;
    }
    default:
      break;
  }
  const object = args.length > 0 ? args[0] : NULL_REG;
  const slot = manager.slot(object);
  if (!slot) {
    if (op > DoSoundOp.Update || op === 13) vm.warn(`DoSound : sous-fonction ${op} inconnue`);
    return vm.acc;
  }
  switch (op) {
    case DoSoundOp.Stop:
      stopSound(vm, manager, object, slot);
      break;
    case DoSoundOp.Fade:
      if (args.length >= 4) manager.fade(slot, toSint16(args[1]), args[2] & WORD_MASK, args[3] & WORD_MASK, args.length >= 5 && args[4] !== 0);
      break;
    case DoSoundOp.SetHold:
      manager.setHold(slot, toSint16(args[1]));
      break;
    case DoSoundOp.SetVolume:
      if (manager.setVolume(slot, toSint16(args[1]))) write(vm, object, "vol", slot.volume);
      break;
    case DoSoundOp.SetPriority: {
      const priority = toSint16(args[1]);
      const flags = read(vm, object, "flags");
      if (priority === -1) {
        manager.setPriority(slot, undefined);
        write(vm, object, "flags", flags & ~FLAG_FIXED_PRIORITY & WORD_MASK);
      } else {
        write(vm, object, "flags", flags | FLAG_FIXED_PRIORITY);
        manager.setPriority(slot, priority);
      }
      break;
    }
    case DoSoundOp.UpdateCues:
      updateCues(vm, manager, object, slot);
      break;
    case DoSoundOp.SendMidi:
      sendMidi(manager, slot, args);
      break;
    default:
      vm.warn(`DoSound : sous-fonction ${op} inconnue`);
      break;
  }
  return vm.acc;
}

export function registerSoundKernel(kernel: Kernel): void {
  kernel.register("DoSound", doSound);
}
