/**
 * Audio numérique de Gabriel Knight : correspondance clé → fichier de `original/gk1/` (`docs/gk1/files.md`, `plan.md` D3).
 *
 * Le moteur ne lit ni `RESOURCE.AUD` ni `RESOURCE.SFX` : l'extraction les a convertis en
 * `voices/<module>/<noun>-<verb>-<cond>-<seq>.mp3`, `voices/<module>/sync.json` et `audio/<numéro>.mp3`, avec les durées
 * exactes dans `voices/<module>/index.json` et `audio/index.json`. Ce module ne décode aucun son : il nomme les fichiers, lit
 * `sync.json` et `index.json` et, pour les recoupements, les maps d'origine (ressources 0x90).
 *
 * Référence pour les maps : `engines/sci/resource/resource_audio.cpp` de ScummVM (`ResourceManager::readAudioMapSCI11`),
 * GPL v3 ou ultérieure, lu puis réécrit ; pour la synchro : `engines/sci/sound/sync.cpp`.
 *
 * - Map audio36 (numéro = module) : `u32 offset de base`, puis `noun | verb | cond | seq | u24 delta` ; si `seq & 0x80`, un
 *   `u16 taille du bloc de synchro` suit ; fin : une entrée de 11 octets `0xFF` (la plus longue possible).
 * - Map 65535 (bruitages) : `u16 numéro | u24 delta`, fin : une entrée de 5 octets `0xFF`.
 * - `sync.json` : `{ "<noun>-<verb>-<cond>-<seq>": [tick, repère, tick, repère, …] }`, ticks de 1/60 s.
 * - `index.json` : `{ "<noun>-<verb>-<cond>-<seq>": échantillons }` par module (voix), `{ "<numéro>": échantillons }` pour
 *   `audio/` ; nombre d'échantillons du PCM source, mono 22 050 Hz, mesuré avant l'encodage MP3. La durée en ticks suit
 *   l'arrondi de `Audio32::play` de ScummVM (`engines/sci/sound/audio32.cpp`), valeur rendue à `DoAudio`.
 *
 * Écart volontaire (D3) : les offsets des maps ne servent à rien ici ; seules les clés sont gardées.
 */
import { BinaryReader } from "../../../data/reader";
import type { MessageTuple } from "./message";

const SEQ_HAS_SYNC = 0x80;
const SEQ_HAS_RAVE = 0x40;
const SEQ_MASK = 0x3f;
const AUDIO36_END = 0xff;
const SFX_END = 0xffff;
/** Entrée terminale : noun, verb, cond, seq, u24, u16 de synchro, u16 de RAVE, tous à 0xFF. */
const AUDIO36_TERMINATOR_SIZE = 11;
const SFX_ENTRY_SIZE = 5;

export const TICKS_PER_SECOND = 60;
/** Fréquence de tout l'audio numérique du CD (voix et bruitages), en échantillons par seconde. */
export const SAMPLE_RATE = 22050;
/** Durées des ressources de `audio/`, relatif à `original/gk1/`. */
export const AUDIO_INDEX_PATH = "audio/index.json";

const VOICE_PATH = /^voices\/(\d+)\/(\d+-\d+-\d+-\d+)\.mp3$/;
const AUDIO_PATH = /^audio\/(\d+)\.mp3$/;
const SYNC_PATH = /^voices\/(\d+)\/sync\.json$/;

export interface VoiceKey extends MessageTuple {
  /** Numéro de la ressource message. */
  readonly module: number;
}

/** Nom d'un clip dans son module, aussi clé de `sync.json` : `noun-verb-cond-seq`, en décimal. */
export function voiceClipName(key: MessageTuple): string {
  return `${key.noun}-${key.verb}-${key.cond}-${key.seq}`;
}

/** Chemin d'un clip de voix, relatif à `original/gk1/`. */
export function voicePath(key: VoiceKey): string {
  return `voices/${key.module}/${voiceClipName(key)}.mp3`;
}

/** Chemin de la synchronisation des lèvres d'un module. */
export function syncPath(module: number): string {
  return `voices/${module}/sync.json`;
}

/** Chemin des durées des clips de voix d'un module. */
export function voiceIndexPath(module: number): string {
  return `voices/${module}/index.json`;
}

/** Chemin d'une ressource audio désignée par son numéro (bruitages, musiques numérisées). */
export function audioPath(number: number): string {
  return `audio/${number}.mp3`;
}

/** Repère de synchronisation : à `tick` (1/60 s depuis le début du clip), la propriété `syncCue` prend la valeur `cue`. */
export interface SyncCue {
  readonly tick: number;
  readonly cue: number;
}

/** Lit un `sync.json` : nom de clip → repères, dans l'ordre du temps. */
export function parseSyncJson(text: string): Map<string, SyncCue[]> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("GK1 : sync.json mal formé");
  const out = new Map<string, SyncCue[]>();
  for (const [name, values] of Object.entries(parsed)) {
    if (!Array.isArray(values) || values.length % 2 !== 0 || values.some((v) => !Number.isInteger(v) || v < 0 || v > 0xffff)) {
      throw new Error(`GK1 : sync.json : repères invalides pour ${name}`);
    }
    const cues: SyncCue[] = [];
    for (let i = 0; i < values.length; i += 2) cues.push({ tick: values[i], cue: values[i + 1] });
    out.set(name, cues);
  }
  return out;
}

/** Lit un `index.json` : nom de clip (voix) ou numéro en décimal (`audio/`) → nombre d'échantillons à 22 050 Hz. */
export function parseDurationJson(text: string): Map<string, number> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("GK1 : index.json mal formé");
  const out = new Map<string, number>();
  for (const [name, samples] of Object.entries(parsed)) {
    if (!Number.isInteger(samples) || samples <= 0) throw new Error(`GK1 : index.json : durée invalide pour ${name}`);
    out.set(name, samples);
  }
  return out;
}

/**
 * Durée en ticks d'un son de `samples` échantillons, comme `Audio32::play` de ScummVM (`channel.duration`, lu) :
 * millisecondes entières (tronquées, comme la longueur d'un flux SOL), converties en ticks tronqués, plus 1. Un son de
 * 2 000 ms dure donc 121 ticks. Sert à répondre à `DoAudio` même son coupé ou fichier pas encore chargé.
 */
export function samplesToTicks(samples: number): number {
  const ms = Math.floor((samples * 1000) / SAMPLE_RATE);
  return 1 + Math.floor((ms * TICKS_PER_SECOND) / 1000);
}

export interface Audio36MapEntry extends MessageTuple {
  /** Le clip a-t-il un bloc de synchronisation des lèvres dans `RESOURCE.AUD` ? */
  readonly hasSync: boolean;
}

/** Clés d'une map audio36 (ressource 0x90 d'un module), dans l'ordre du fichier. */
export function readAudio36Map(data: Uint8Array): Audio36MapEntry[] {
  const r = new BinaryReader(data);
  r.u32();
  const entries: Audio36MapEntry[] = [];
  for (;;) {
    if (r.isAtEnd) throw new Error("GK1 : map audio36 sans fin");
    const noun = r.u8();
    if (noun === AUDIO36_END) break;
    if (r.offset + 6 > data.length) throw new Error("GK1 : map audio36 tronquée");
    const verb = r.u8();
    const cond = r.u8();
    const seq = r.u8();
    r.offset += 3;
    if (seq & SEQ_HAS_SYNC) r.u16();
    if (seq & SEQ_HAS_RAVE) throw new Error("GK1 : map audio36 avec bloc RAVE, non géré");
    entries.push({ noun, verb, cond, seq: seq & SEQ_MASK, hasSync: (seq & SEQ_HAS_SYNC) !== 0 });
  }
  expectTerminator(data, r.offset - 1, AUDIO36_TERMINATOR_SIZE, "audio36");
  return entries;
}

/** Numéros des ressources audio de la map 65535, dans l'ordre du fichier. */
export function readSfxMap(data: Uint8Array): number[] {
  const r = new BinaryReader(data);
  const numbers: number[] = [];
  for (;;) {
    if (r.offset + 2 > data.length) throw new Error("GK1 : map des bruitages sans fin");
    const number = r.u16();
    if (number === SFX_END) break;
    r.offset += 3;
    numbers.push(number);
  }
  expectTerminator(data, r.offset - 2, SFX_ENTRY_SIZE, "des bruitages");
  return numbers;
}

/** La map doit finir par une entrée entière d'octets 0xFF, sans rien après. */
function expectTerminator(data: Uint8Array, offset: number, size: number, what: string): void {
  if (offset + size !== data.length || data.subarray(offset).some((b) => b !== 0xff)) throw new Error(`GK1 : fin de la map ${what} inattendue`);
}

/**
 * Fichiers audio présents, d'après le manifeste `files.json`. Un clip absent n'est pas une erreur : 3 525 messages n'ont pas
 * de voix, le moteur affiche alors le texte seul.
 */
export class AudioIndex {
  private readonly voices = new Map<string, string>();
  private readonly audio = new Map<number, string>();
  private readonly syncModules = new Set<number>();

  constructor(files: Iterable<{ readonly path: string }>) {
    for (const { path } of files) {
      let match = VOICE_PATH.exec(path);
      if (match) {
        this.voices.set(`${match[1]}/${match[2]}`, path);
        continue;
      }
      match = AUDIO_PATH.exec(path);
      if (match) {
        this.audio.set(Number(match[1]), path);
        continue;
      }
      match = SYNC_PATH.exec(path);
      if (match) this.syncModules.add(Number(match[1]));
    }
  }

  get voiceCount(): number {
    return this.voices.size;
  }

  get audioCount(): number {
    return this.audio.size;
  }

  /** Chemin du clip de voix, ou `undefined` s'il n'existe pas. */
  voice(key: VoiceKey): string | undefined {
    return this.voices.get(`${key.module}/${voiceClipName(key)}`);
  }

  /** Chemin de la ressource audio `number`, ou `undefined`. */
  sound(number: number): string | undefined {
    return this.audio.get(number);
  }

  /** Chemin du `sync.json` du module, ou `undefined` s'il n'a aucune synchronisation. */
  sync(module: number): string | undefined {
    return this.syncModules.has(module) ? syncPath(module) : undefined;
  }
}
