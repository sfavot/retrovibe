import type { SoundEntry, SoundSection } from "../../../src/games/lure/data/sound";

export interface TestEvent {
  /** Ticks depuis l'événement précédent. */
  delta: number;
  /** Octets de l'événement (statut compris). */
  bytes: number[];
}

const vlq = (value: number): number[] => {
  const out = [value & 0x7f];
  while ((value >>= 7) > 0) out.unshift((value & 0x7f) | 0x80);
  return out;
};

/** Événements raccourcis. */
export const noteOn = (delta: number, note: number, velocity = 100, channel = 0): TestEvent => ({ delta, bytes: [0x90 | channel, note, velocity] });
export const noteOff = (delta: number, note: number, channel = 0): TestEvent => ({ delta, bytes: [0x80 | channel, note, 0] });
export const tempo = (delta: number, microsPerQuarter: number): TestEvent => ({ delta, bytes: [0xff, 0x51, 3, microsPerQuarter >> 16, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff] });
/** `FF 7F` d'instrument (type 1) : signature, type, canal, 28 octets BNK. */
export const instrument = (delta: number, channel: number, bnk: readonly number[]): TestEvent => ({ delta, bytes: [0xff, 0x7f, 0x22, 0x00, 0x00, 0x3f, 0x00, 0x01, channel, ...bnk] });
/** Sensibilité de l'inflexion de hauteur (type 3). */
export const bendSensitivity = (delta: number, semitones: number): TestEvent => ({ delta, bytes: [0xff, 0x7f, 0x06, 0x00, 0x00, 0x3f, 0x00, 0x03, semitones] });
/** Mode rythme (type 2), toujours désactivé dans les données. */
export const rhythmOff = (delta: number): TestEvent => ({ delta, bytes: [0xff, 0x7f, 0x06, 0x00, 0x00, 0x3f, 0x00, 0x02, 0] });

/** Fichier MIDI de format 0 : une piste dont la fin (`FF 2F`) tombe `endDelta` ticks après le dernier événement. */
export function buildSmf(events: readonly TestEvent[], options: { division?: number; endDelta?: number } = {}): Uint8Array {
  const track: number[] = [];
  for (const e of events) track.push(...vlq(e.delta), ...e.bytes);
  track.push(...vlq(options.endDelta ?? 0), 0xff, 0x2f, 0x00);
  const division = options.division ?? 96;
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, division >> 8, division & 0xff, 0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track]);
}

/** Section de sons de test : un son par fichier MIDI. */
export function buildSection(files: readonly Uint8Array[]): SoundSection {
  const sounds: SoundEntry[] = files.map((smf, index) => ({ index, offset: 0, stored: smf, compression: "none", smf, trailing: 0 }));
  return { sounds, headerSize: 0 };
}
