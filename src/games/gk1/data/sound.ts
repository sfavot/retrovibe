/**
 * Ressources sound SCI (`docs/gk1/formats.md` § 10) : pistes par périphérique et canaux MIDI. Structure seulement, aucune lecture.
 *
 * Référence : `engines/sci/resource/resource_audio.cpp` de ScummVM (`SoundResource::SoundResource`), GPL v3 ou ultérieure,
 * lu puis réécrit.
 *
 * ```
 * { u8 type de piste ; { u16 ? ; u16 offset ; u16 taille } … 0xFF } … 0xFF
 * Canal : u8 numéro (quartet bas ; 15 = contrôle) et drapeaux (quartet haut) | u8 voix (quartet bas) et priorité (quartet haut) | flux MIDI
 * ```
 * Le type de piste est l'identifiant du périphérique (0 AdLib, 7 General MIDI, 12 MT-32, 18 haut-parleur, 19 Tandy), ou
 * **0xF0 : piste d'en-tête**, dont l'unique entrée de 6 octets commence par la priorité du son. Les « 8 octets d'en-tête
 * facultatif » des sons sont cette piste ; le son 742 n'en a simplement pas. Les canaux sont partagés entre pistes (mêmes offsets).
 *
 * Écarts volontaires : pas de canal d'échantillon numérique (0xFE), absent de ce CD : il lève une erreur ; un canal qui
 * déborde de la ressource lève une erreur (ScummVM le tronque avec un avertissement).
 */
import { BinaryReader } from "../../../data/reader";
import { SOUND_DIGITAL_CHANNEL, SOUND_END, SOUND_TRACK_HEADER } from "./ids";

const CHANNEL_ENTRY_SIZE = 6;
const CHANNEL_HEADER_SIZE = 2;

/** Drapeaux d'un canal (quartet haut du premier octet), d'après ScummVM. */
export const CHANNEL_FLAG_UNMAPPED = 1;
export const CHANNEL_FLAG_NO_REMAP = 2;
export const CHANNEL_FLAG_MUTED = 4;

export interface SoundChannel {
  /** Offset et taille dans la ressource, en-tête de 2 octets compris. */
  readonly offset: number;
  readonly size: number;
  /** Canal MIDI, 0 à 15. */
  readonly number: number;
  readonly flags: number;
  /** Nombre de voix demandées et priorité du canal. */
  readonly voices: number;
  readonly priority: number;
  /** Flux MIDI (après l'en-tête du canal). */
  readonly data: Uint8Array;
}

export interface SoundTrack {
  /** Identifiant du périphérique (`SoundDevice`). */
  readonly device: number;
  readonly channels: readonly SoundChannel[];
}

export interface Sound {
  /** Priorité du son (piste 0xF0), ou `undefined` s'il n'en a pas. */
  readonly priority: number | undefined;
  readonly tracks: readonly SoundTrack[];
  /** Taille de la table des pistes, en tête de la ressource (contrôle des restes). */
  readonly tableSize: number;
}

export function readSound(data: Uint8Array): Sound {
  const r = new BinaryReader(data);
  const tracks: SoundTrack[] = [];
  let priority: number | undefined;
  const next = (): number => {
    if (r.isAtEnd) throw new Error("GK1 : table des pistes de son tronquée");
    return r.u8();
  };
  for (;;) {
    const device = next();
    if (device === SOUND_END) break;
    const channels: SoundChannel[] = [];
    for (;;) {
      if (r.isAtEnd) throw new Error("GK1 : table des pistes de son tronquée");
      if (data[r.offset] === SOUND_END) {
        r.offset++;
        break;
      }
      if (r.offset + CHANNEL_ENTRY_SIZE > data.length) throw new Error("GK1 : entrée de canal de son tronquée");
      if (device === SOUND_TRACK_HEADER) {
        priority = data[r.offset];
        r.offset += CHANNEL_ENTRY_SIZE;
        continue;
      }
      r.u16();
      const offset = r.u16();
      const size = r.u16();
      if (size < CHANNEL_HEADER_SIZE || offset + size > data.length) throw new Error("GK1 : canal de son hors de la ressource");
      const first = data[offset];
      if (first === SOUND_DIGITAL_CHANNEL) throw new Error("GK1 : canal d'échantillon numérique non géré");
      channels.push({
        offset,
        size,
        number: first & 0x0f,
        flags: first >> 4,
        voices: data[offset + 1] & 0x0f,
        priority: data[offset + 1] >> 4,
        data: data.subarray(offset + CHANNEL_HEADER_SIZE, offset + size),
      });
    }
    if (device !== SOUND_TRACK_HEADER) tracks.push({ device, channels });
  }
  return { priority, tracks, tableSize: r.offset };
}

/** Piste d'un périphérique, ou `undefined`. */
export function trackFor(sound: Sound, device: number): SoundTrack | undefined {
  return sound.tracks.find((t) => t.device === device);
}
