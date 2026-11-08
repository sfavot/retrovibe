import type { BankSong, SongBank } from "../../../src/games/fotaq/data/music";

/** Durée variable MIDI. */
export function vlq(value: number): number[] {
  const out = [value & 0x7f];
  for (let v = value >> 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
}

export interface TrackEvent {
  /** Ticks depuis l'événement précédent. */
  delta: number;
  bytes: number[];
}

/** Fichier MIDI standard de format 0, 420 ticks par noire (comme `AQBANK.MUS`), tempo de 120 bpm sauf `tempo`. */
export function smf(events: TrackEvent[], options: { tempo?: number; division?: number; end?: boolean } = {}): Uint8Array {
  const body: number[] = [];
  if (options.tempo) body.push(0, 0xff, 0x51, 3, (options.tempo >> 16) & 255, (options.tempo >> 8) & 255, options.tempo & 255);
  for (const event of events) body.push(...vlq(event.delta), ...event.bytes);
  if (options.end !== false) body.push(0, 0xff, 0x2f, 0);
  const division = options.division ?? 420;
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, division >> 8, division & 255];
  const size = body.length;
  return Uint8Array.from([...head, 0x4d, 0x54, 0x72, 0x6b, size >>> 24, (size >> 16) & 255, (size >> 8) & 255, size & 255, ...body]);
}

/** Méta `FF 7F` d'instrument de Queen (type 1) pour un canal MIDI : 13 octets de modulateur, 13 de porteuse, deux formes d'onde. */
export function instrument(channel: number, modulator: number[], carrier: number[], waves: [number, number] = [0, 0]): TrackEvent {
  const data = [0, 0, 0x3f, 0, 1, channel, ...modulator, ...carrier, ...waves];
  return { delta: 0, bytes: [0xff, 0x7f, data.length, ...data] };
}

/** `FF 7F` de type 2 (mode rythme) ou 3 (multiplicateur de pitch bend). */
export function sequencerValue(type: 2 | 3, value: number): TrackEvent {
  return { delta: 0, bytes: [0xff, 0x7f, 6, 0, 0, 0x3f, 0, type, value] };
}

export const noteOn = (delta: number, channel: number, note: number, velocity = 100): TrackEvent => ({ delta, bytes: [0x90 | channel, note, velocity] });
export const noteOff = (delta: number, channel: number, note: number): TrackEvent => ({ delta, bytes: [0x80 | channel, note, 0] });

/** Table de morceaux de test (seuls `index` et `smf` servent). */
export function bankOf(...files: Uint8Array[]): SongBank {
  const songs = files.map((file, index) => ({ index, smf: file }) as unknown as BankSong);
  return { songs, info: new Uint8Array(2) };
}

export interface Write {
  tick: number;
  reg: number;
  value: number;
}

/** `OplSink` qui garde les écritures avec leur tick. */
export class Recorder {
  readonly writes: Write[] = [];
  tick = 0;
  beginTick(tick: number): void {
    this.tick = tick;
  }
  write(reg: number, value: number): void {
    this.writes.push({ tick: this.tick, reg, value });
  }
  /** Écritures d'un registre, dans l'ordre. */
  of(reg: number): Write[] {
    return this.writes.filter((w) => w.reg === reg);
  }
  clear(): void {
    this.writes.length = 0;
  }
}

/** Instrument neutre de 13 octets : modulateur ou porteuse. */
export const FLAT = [0, 1, 0, 15, 5, 0, 1, 3, 20, 0, 0, 0, 1];
