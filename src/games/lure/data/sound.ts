/**
 * Sections de sons : `0x0D` (AdLib, jeu), `0x31` (AdLib, introduction), `0xFF11` (AdLib, fin) ; chaque son est un fichier MIDI standard (SMF),
 * parfois compressé, dont les instruments AdLib sont dans des méta-événements `FF 7F`. Aucun échantillon dans le jeu.
 *
 * Source : `SoundManager::loadSection`, `SoundManager::musicInterface_Play` (engines/lure/sound.cpp, ScummVM, GPL v3+), `MidiMusic::MidiMusic`
 * (décompression) et `MidiDriver_ADLIB_Lure::metaEvent` (format des `FF 7F`) ; `SoundDescResource` (`res_struct.h`).
 * Ce module ne fait que lire les données : le pilote AdLib et la lecture sont dans `audio/` (vague A).
 *
 * Disposition d'une section (octets petit-boutistes) : `u8` nombre de sons, `u8` à 0, puis `nombre` positions `u32` (depuis le début de la
 * section), puis la marque de fin d'en-tête `80 00` (les sections Roland y ajoutent l'adresse des timbres MT-32, absente ici). Le son `i`
 * occupe de sa position à celle du suivant, le dernier jusqu'à la fin de la section.
 *
 * Compression : un son qui commence par `'C'` ou `'c'` porte un dictionnaire de 256 mots de 16 bits (512 octets) puis une suite d'indices d'un octet ;
 * chaque indice donne deux octets du SMF. Avec `'c'`, le premier octet décompressé est un remplissage (ScummVM démarre un octet plus loin).
 *
 * Écarts volontaires :
 * - ScummVM confie à l'analyseur MIDI toute la mémoire décompressée (un octet de trop avec `'c'`) et son analyseur tolère la longueur de piste
 *   qui omet l'événement de fin ; ici le SMF est coupé à la fin de piste, cet événement compris, et la longueur de piste est corrigée (`normalizeMidiFile`) ;
 * - les `FF 7F` sont décodés et contrôlés d'avance (type, longueur, canal) au lieu d'être interprétés à la lecture (un type inconnu y est un avertissement).
 */
import { parseSong, type Song } from "../../../audio/smf";
import { type Coverage } from "./cursor";
import { DiskResId } from "./ids";
import type { SoundDesc } from "./lure-dat";
import type { LureResources } from "./container";

const COUNT_BYTES = 2;
const OFFSET_SIZE = 4;
/** Marque qui ferme l'en-tête d'une section (`80 00`). */
export const SECTION_HEADER_MARK = 0x0080;
const DICTIONARY_SIZE = 0x200;
const MIDI_HEADER_SIZE = 14;
const MIDI_TRACK_HEADER_SIZE = 8;

/** Compression d'un son : `'C'` ou `'c'` (premier octet décompressé à ignorer), `none` sinon. */
export type SoundCompression = "none" | "C" | "c";

export interface SoundEntry {
  /** Rang dans la section (`soundNum` de `musicInterface_Play`). */
  readonly index: number;
  /** Position dans la section. */
  readonly offset: number;
  /** Octets stockés (compressés s'il y a lieu). */
  readonly stored: Uint8Array;
  readonly compression: SoundCompression;
  /** Fichier MIDI standard (format 0), longueur de piste corrigée pour inclure la fin de piste. */
  readonly smf: Uint8Array;
  /** Octets décompressés après la fin de piste (remplissage ; 0 ou 1). */
  readonly trailing: number;
}

export interface SoundSection {
  readonly sounds: readonly SoundEntry[];
  /** Taille de l'en-tête (position du premier son). */
  readonly headerSize: number;
}

/** Décompression d'un son `'C'` / `'c'` (`MidiMusic::MidiMusic`) : octets décompressés, premier octet de remplissage de `'c'` retiré. */
export function decompressSound(stored: Uint8Array): { data: Uint8Array; compression: SoundCompression } {
  const marker = stored[0];
  if (marker !== 0x43 && marker !== 0x63) return { data: stored, compression: "none" };
  if (stored.length < 1 + DICTIONARY_SIZE) throw new Error("son compressé : dictionnaire tronqué");
  const packed = stored.length - 1 - DICTIONARY_SIZE;
  const out = new Uint8Array(packed * 2);
  for (let i = 0; i < packed; i++) {
    const word = 1 + stored[1 + DICTIONARY_SIZE + i]! * 2;
    out[i * 2] = stored[word]!;
    out[i * 2 + 1] = stored[word + 1]!;
  }
  return marker === 0x63 ? { data: out.subarray(1), compression: "c" } : { data: out, compression: "C" };
}

const END_OF_TRACK = [0x00, 0xff, 0x2f, 0x00] as const;

/**
 * Fichier MIDI d'un son décompressé : les sons du jeu sont des fichiers de format 0 dont la longueur de piste **omet** l'événement de fin
 * (`00 FF 2F 00`, 4 octets) qui suit ; ils sont suivis d'un octet de remplissage avec `'c'` quand la longueur décompressée est impaire.
 * Retourne le fichier complet (longueur de piste corrigée, fin de piste incluse) et le nombre d'octets restants, ou `undefined` si ce n'est pas un SMF de ce type.
 */
export function normalizeMidiFile(bytes: Uint8Array): { smf: Uint8Array; trailing: number } | undefined {
  if (bytes.length < MIDI_HEADER_SIZE + MIDI_TRACK_HEADER_SIZE || String.fromCharCode(...bytes.subarray(0, 4)) !== "MThd") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trackAt = 8 + view.getUint32(4, false);
  if (view.getUint16(10, false) !== 1 || String.fromCharCode(...bytes.subarray(trackAt, trackAt + 4)) !== "MTrk") return undefined;
  const length = view.getUint32(trackAt + 4, false);
  const end = trackAt + MIDI_TRACK_HEADER_SIZE + length;
  if (end + END_OF_TRACK.length > bytes.length || END_OF_TRACK.some((b, i) => bytes[end + i] !== b)) return undefined;
  const smf = bytes.slice(0, end + END_OF_TRACK.length);
  new DataView(smf.buffer).setUint32(trackAt + 4, length + END_OF_TRACK.length, false);
  return { smf, trailing: bytes.length - smf.length };
}

/** Lit une section de sons ; chaque octet de la section est marqué dans `coverage`. */
export function parseSoundSection(bytes: Uint8Array, coverage?: Coverage): SoundSection {
  if (bytes.length < COUNT_BYTES) throw new Error("section de sons : trop courte");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes[0]!;
  const tableEnd = COUNT_BYTES + count * OFFSET_SIZE;
  if (bytes[1] !== 0) throw new Error("section de sons : second octet non nul");
  if (tableEnd + 2 > bytes.length || view.getUint16(tableEnd, true) !== SECTION_HEADER_MARK) throw new Error("section de sons : marque de fin d'en-tête absente");
  const headerSize = tableEnd + 2;
  coverage?.mark(0, headerSize);

  const sounds: SoundEntry[] = [];
  for (let index = 0; index < count; index++) {
    const offset = view.getUint32(COUNT_BYTES + index * OFFSET_SIZE, true);
    const end = index === count - 1 ? bytes.length : view.getUint32(COUNT_BYTES + (index + 1) * OFFSET_SIZE, true);
    if (index === 0 && offset !== headerSize) throw new Error(`son 0 : position inattendue (${offset})`);
    if (end <= offset || end > bytes.length) throw new Error(`son ${index} : taille invalide`);
    const stored = bytes.subarray(offset, end);
    const { data, compression } = decompressSound(stored);
    const midi = normalizeMidiFile(data);
    if (!midi) throw new Error(`son ${index} : fichier MIDI invalide`);
    coverage?.mark(offset, end);
    sounds.push({ index, offset, stored, compression, smf: midi.smf, trailing: midi.trailing });
  }
  return { sounds, headerSize };
}

export const SoundSectionName = { main: "main", intro: "intro", ending: "ending" } as const;
export type SoundSectionName = (typeof SoundSectionName)[keyof typeof SoundSectionName];

/** Identifiant de ressource de chaque section AdLib. */
export const ADLIB_SECTION_IDS: Readonly<Record<SoundSectionName, number>> = {
  main: DiskResId.adlibMainSound,
  intro: DiskResId.adlibIntroSound,
  ending: DiskResId.adlibEndgameSound,
};

/** Les trois sections AdLib (jeu, introduction, fin). */
export function readSoundSections(resources: LureResources): Record<SoundSectionName, SoundSection> {
  return {
    main: parseSoundSection(resources.get(ADLIB_SECTION_IDS.main)),
    intro: parseSoundSection(resources.get(ADLIB_SECTION_IDS.intro)),
    ending: parseSoundSection(resources.get(ADLIB_SECTION_IDS.ending)),
  };
}

/** Numéro du son dans la section (7 bits) et boucle (bit 7) d'après `SoundDescResource.soundNumber`. */
export function soundDescTarget(desc: Pick<SoundDesc, "soundNumber">): { index: number; loop: boolean } {
  return { index: desc.soundNumber & 0x7f, loop: (desc.soundNumber & 0x80) !== 0 };
}

/** Méta-événement `FF 7F` du jeu : `00 00 3F 00`, type, argument(s). */
export type LureSequencerMeta =
  /** Instrument AdLib du canal : 28 octets du format BNK sans ses deux premiers champs. */
  | { readonly kind: "instrument"; readonly channel: number; readonly definition: Uint8Array }
  /** Mode rythme (`0` arrêt) : jamais activé dans les données. */
  | { readonly kind: "rhythm"; readonly on: boolean }
  /** Sensibilité du pitch bend, en demi-tons. */
  | { readonly kind: "pitchBendSensitivity"; readonly semitones: number };

export const INSTRUMENT_META_LENGTH = 0x22;
const META_SIGNATURE = [0x00, 0x00, 0x3f, 0x00] as const;

/** Décode les données d'un `FF 7F` (`MidiDriver_ADLIB_Lure::metaEvent`) ; une forme inconnue est refusée. */
export function parseSequencerMeta(data: Uint8Array): LureSequencerMeta {
  if (data.length < 6 || META_SIGNATURE.some((b, i) => data[i] !== b)) throw new Error("FF 7F : signature inconnue");
  switch (data[4]) {
    case 1:
      if (data.length !== INSTRUMENT_META_LENGTH) throw new Error(`FF 7F : instrument de ${data.length} octets`);
      if (data[5]! >= 16) throw new Error(`FF 7F : canal ${data[5]} hors limites`);
      return { kind: "instrument", channel: data[5]!, definition: data.slice(6) };
    case 2:
      return { kind: "rhythm", on: data[5] !== 0 };
    case 3:
      return { kind: "pitchBendSensitivity", semitones: data[5]! };
    default:
      throw new Error(`FF 7F : type ${data[4]} inconnu`);
  }
}

/** Tous les `FF 7F` d'un morceau, décodés, dans l'ordre du fichier. */
export function songSequencerMetas(song: Song): LureSequencerMeta[] {
  return song.events.flatMap((e) => (e.kind === "sequencerSpecific" ? [parseSequencerMeta(e.data)] : []));
}

/** Lit un son comme morceau (événements, tempos) avec l'analyseur commun. */
export function parseSound(entry: SoundEntry): Song {
  return parseSong(entry.smf);
}
