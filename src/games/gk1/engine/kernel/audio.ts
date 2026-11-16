/**
 * Noyau, groupe « audio numérique » : `DoAudio` et `DoSync` (`docs/gk1/engine.md` § 5 et § 6.1). Le travail est fait par
 * `audio/digital.ts` (canaux, durées, position) et `audio/sync.ts` (repères des lèvres).
 *
 * Référence : `engines/sci/engine/ksound.cpp` (`kDoAudioPlay`, `kDoAudioStop`, `kDoAudioPosition`, `kDoSync`),
 * `engines/sci/engine/kernel_tables.h` (`kDoAudio_subops`), `engines/sci/sound/audio32.cpp` (`Audio32::kernelPlay`,
 * `findChannelByArgs`) et `engines/sci/sound/sync.cpp` de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * `DoAudio(sous-fonction, …)`. Une ressource est une clé de voix `module, noun, verb, cond, seq` (cinq arguments ou plus) ou
 * un numéro de son (moins de cinq) :
 * - 2 `Play(ressource[, boucle[, volume]])` : lance le son et rend sa durée en ticks, 0 si la ressource n'existe pas ; sans
 *   argument, le nombre de canaux en cours. Boucle : 0 et 1 = une fois. Volume absent ou hors de 0 à 127 : 127 ;
 * - 3 `Stop([ressource])` : arrête ce canal, ou tous ; rend le nombre de canaux d'avant, 0 si le canal n'existe pas ;
 * - 4 `Pause`, 5 `Resume([ressource])` (jamais appelées) ;
 * - 6 `Position([ressource])` : ticks écoulés, −1 si le canal n'existe plus ; sans argument, position commune ;
 * - 0 `Init` rend 0, 9 `GetCapability` rend 1, 13 `SetBufferSize` est sans effet ;
 * - 1 : **n'existe pas dans l'interpréteur SCI2** (lu : la table de ScummVM ne la donne qu'à partir de SCI2.1) ; son seul
 *   appel, `ScriptSync::init` du script 64929, est du code que rien n'instancie. Ici : la durée, sans rien jouer.
 *
 * `DoSync` : 0 `Start(objet, module, noun, verb, cond, seq)` écrit `syncCue` (0, ou −1 sans synchronisation) ; 1
 * `Next(objet)` écrit `syncTime` et `syncCue` ; 2 `Stop`. Toutes laissent l'accumulateur tel quel.
 *
 * Écarts volontaires :
 * - **message sans clip** : `Play` d'une voix absente rend 0 dans l'original et dans ScummVM ; en « texte et voix », le
 *   texte d'une telle réplique se ferme alors à l'image suivante (`Narrator::doit`). Ici `Play` rend le temps de lecture que
 *   `Narrator::startText` calcule en « texte seul » : `max(120, 24 × longueur / 10 × vitesse)` ticks, vitesse = variable
 *   globale 94. Concerne 38 répliques du CD français (1 089 messages n'ont ni clip ni renvoi vers un message doublé, dont
 *   669 des talkers 64 et 97, toujours en texte seul, 349 « !!! » et 33 libellés du talker 98). Il en va de même quand les
 *   fichiers audio manquent : le jeu se replie sur le texte ;
 * - **attente des fichiers** : tant que l'index du module (`index.json`, `sync.json`) est en route, `Play` et `Start`
 *   rendent la main image après image (motif `SUSPEND_DIGITAL`), au plus `LOAD_TIMEOUT_TICKS` ; passé ce délai le clip est
 *   tenu pour absent ;
 * - une sous-fonction inconnue est signalée par un avertissement (ScummVM s'arrête).
 */
import { DIGITAL_LOADING, type DigitalId, digitalAudioOf, LOAD_TIMEOUT_TICKS } from "../../audio/digital";
import { LipSync, SYNC_END } from "../../audio/sync";
import type { VoiceKey } from "../../data/audio-index";
import { GAME_SCRIPT } from "../ids";
import { fromInt, type Reg, toSint16 } from "../memory";
import { messagesOf } from "../message";
import { writeSelector } from "../object";
import { remapKey } from "../patches";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

export const DoAudioOp = { Init: 0, WaitPlay: 1, Play: 2, Stop: 3, Pause: 4, Resume: 5, Position: 6, GetCapability: 9, SetBufferSize: 13 } as const;
export const DoSyncOp = { Start: 0, Next: 1, Stop: 2 } as const;

/** Motif de suspension pendant l'attente d'un index audio (`RunResult.reason`). */
export const SUSPEND_DIGITAL = "DoAudio";

const DO_AUDIO = "DoAudio";
const DO_SYNC = "DoSync";
const BYTE_MASK = 0xff;
const WORD_MASK = 0xffff;
/** Nombre d'arguments d'une clé de voix. */
const TUPLE_SIZE = 5;
/** `DoSync Start` avec une clé de voix : sous-fonction, objet, clé. */
const ARGC_SYNC_START = 2 + TUPLE_SIZE;
/** Boucle : seules les valeurs autres que 0 et 1 font boucler. */
const LOOP_ONCE = 1;
/** Variable globale de la vitesse du texte (`textSpeed` de la bibliothèque de Sierra), lue par `Narrator::startText`. */
const GLOBAL_TEXT_SPEED = 94;
/** Temps de lecture d'un texte, comme `Narrator::startText` : au moins 120 ticks, 24 ticks par 10 caractères et par cran de vitesse. */
const READING_MIN_TICKS = 120;
const READING_TICKS = 24;
const READING_CHARS = 10;
const SINT16_MAX = 0x7fff;

const lipSyncs = new WeakMap<Vm, LipSync>();

/** Synchronisation des lèvres de cette machine virtuelle. */
export function lipSyncOf(vm: Vm): LipSync {
  let sync = lipSyncs.get(vm);
  if (!sync) {
    const digital = digitalAudioOf(vm);
    sync = new LipSync(
      () => digital.files,
      (message) => vm.warn(message),
    );
    lipSyncs.set(vm, sync);
  }
  return sync;
}

function voiceKeyOf(args: Uint32Array): VoiceKey {
  return { module: args[0] & WORD_MASK, noun: args[1] & BYTE_MASK, verb: args[2] & BYTE_MASK, cond: args[3] & BYTE_MASK, seq: args[4] & BYTE_MASK };
}

/**
 * Ressource désignée par ces arguments, ou `undefined` sans argument (tous les canaux). Une voix que le jeu range sous une
 * autre clé que son texte est prise sous cette clé (`fixes.voiceRemaps`, `remapAudio36ResourceId` de ScummVM).
 */
function resourceOf(vm: Vm, args: Uint32Array): DigitalId | undefined {
  if (args.length === 0) return undefined;
  if (args.length < TUPLE_SIZE) return { sound: args[0] & WORD_MASK };
  const asked = voiceKeyOf(args);
  const { module, tuple } = remapKey(vm.fixes.voiceRemaps, asked.module, asked);
  return { voice: { module, noun: tuple.noun, verb: tuple.verb, cond: tuple.cond, seq: tuple.seq } };
}

/** Temps de lecture du texte d'un message, en ticks ; 0 si le message n'existe pas. */
function readingTicks(vm: Vm, key: VoiceKey): number {
  const size = messagesOf(vm).size(key.module, key);
  if (size === 0) return 0;
  const script = vm.scripts.loaded(GAME_SCRIPT);
  const globals = script && vm.memory.localsSegment(script.localsSegment);
  const speed = globals ? toSint16(globals.values[GLOBAL_TEXT_SPEED]) : 1;
  return Math.min(SINT16_MAX, Math.max(READING_MIN_TICKS, Math.trunc((READING_TICKS * (size - 1)) / READING_CHARS) * speed));
}

function play(vm: Vm, args: Uint32Array, start: boolean): Reg {
  const digital = digitalAudioOf(vm);
  const id = resourceOf(vm, args);
  if (!id) return digital.activeCount;
  const extra = args.subarray("voice" in id ? TUPLE_SIZE : 1);
  let duration: number | typeof DIGITAL_LOADING;
  if (start) {
    duration = digital.play(id, {
      loop: extra.length > 0 && extra[0] !== 0 && extra[0] !== LOOP_ONCE,
      volume: extra.length > 1 ? toSint16(extra[1]) : undefined,
    });
  } else duration = digital.duration(id);
  if (duration === DIGITAL_LOADING) duration = 0;
  if (duration === 0 && "voice" in id) duration = readingTicks(vm, id.voice);
  return fromInt(duration);
}

function perform(vm: Vm, argv: Uint32Array): Reg {
  const digital = digitalAudioOf(vm);
  const args = argv.subarray(1);
  switch (argv[0]) {
    case DoAudioOp.Init:
      return 0;
    case DoAudioOp.WaitPlay:
      return play(vm, args, false);
    case DoAudioOp.Play:
      return play(vm, args, true);
    case DoAudioOp.Stop:
      return digital.stop(resourceOf(vm, args));
    case DoAudioOp.Pause:
    case DoAudioOp.Resume:
      digital.pause(argv[0] === DoAudioOp.Pause, resourceOf(vm, args));
      return vm.acc;
    case DoAudioOp.Position:
      return fromInt(digital.position(resourceOf(vm, args)));
    case DoAudioOp.GetCapability:
      return 1;
    case DoAudioOp.SetBufferSize:
      return vm.acc;
    default:
      vm.warn(`DoAudio : sous-fonction ${toSint16(argv[0])} non portée`);
      return vm.acc;
  }
}

/** L'appel doit-il attendre un fichier d'index encore en route ? */
function pending(vm: Vm, name: string, argv: Uint32Array): boolean {
  if (name === DO_SYNC) return argv[0] === DoSyncOp.Start && argv.length === ARGC_SYNC_START && lipSyncOf(vm).cuesOf(voiceKeyOf(argv.subarray(2))) === DIGITAL_LOADING;
  if (argv[0] !== DoAudioOp.Play && argv[0] !== DoAudioOp.WaitPlay) return false;
  const id = resourceOf(vm, argv.subarray(1));
  return id !== undefined && digitalAudioOf(vm).duration(id) === DIGITAL_LOADING;
}

/** Appelle `run` tout de suite, ou après l'attente d'un index : l'état de la trame garde le tick de départ et les arguments. */
function whenReady(vm: Vm, name: string, argv: Uint32Array, run: (vm: Vm, argv: Uint32Array) => Reg): Reg {
  return pending(vm, name, argv) ? vm.beginNative(name, [vm.ticks, ...argv]) : run(vm, argv);
}

function waiting(name: string, run: (vm: Vm, argv: Uint32Array) => Reg): (vm: Vm, state: number[]) => boolean {
  return (vm, state) => {
    const argv = Uint32Array.from(state.slice(1));
    if (vm.ticks - state[0] < LOAD_TIMEOUT_TICKS && pending(vm, name, argv)) {
      vm.suspend(SUSPEND_DIGITAL);
      return false;
    }
    vm.acc = run(vm, argv);
    return true;
  };
}

function sync(vm: Vm, argv: Uint32Array): Reg {
  const lipSync = lipSyncOf(vm);
  const write = (name: string, value: number): void => writeSelector(vm.memory, argv[1], vm.selectors.id(name), value);
  switch (argv[0]) {
    case DoSyncOp.Start:
      // Avec un seul numéro (`sync` de SCI1.1, absent de ce CD) : pas de synchronisation.
      if (argv.length === ARGC_SYNC_START) write("syncCue", lipSync.start(voiceKeyOf(argv.subarray(2))));
      else {
        lipSync.stop();
        write("syncCue", SYNC_END);
      }
      break;
    case DoSyncOp.Next: {
      const step = lipSync.next();
      if (step) {
        write("syncTime", step.time);
        write("syncCue", step.cue);
      }
      break;
    }
    case DoSyncOp.Stop:
      lipSync.stop();
      break;
    default:
      vm.warn(`DoSync : sous-fonction ${toSint16(argv[0])} inconnue`);
  }
  return vm.acc;
}

export function registerAudioKernel(kernel: Kernel): void {
  kernel.register(DO_AUDIO, (vm, argv) => whenReady(vm, DO_AUDIO, argv, perform)).continuation(DO_AUDIO, waiting(DO_AUDIO, perform));
  kernel.register(DO_SYNC, (vm, argv) => whenReady(vm, DO_SYNC, argv, sync)).continuation(DO_SYNC, waiting(DO_SYNC, sync));
}
