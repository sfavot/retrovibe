/**
 * Inventaire des timbres utilisés par des morceaux MIDI : pour réduire la soundfont (`scripts/mathemagique/soundfont.mts`)
 * et pour contrôler ce que le jeu demande vraiment au synthétiseur. Pur.
 *
 * Un canal commence au programme 0 (banque 0) ; la banque vient des contrôleurs 0 (MSB) et 32 (LSB), le programme du dernier
 * `Cn`. Le canal 10 (indice 9) est la batterie : le « programme » y désigne le kit, les touches jouées sont les instruments.
 */
import { type Song, isNoteOn } from "./smf";

export interface UsedPreset {
  /** Batterie (canal 10) ou timbre mélodique. */
  drum: boolean;
  bank: number;
  program: number;
  /** Touches jouées avec ce timbre. */
  keys: Set<number>;
}

export interface ProgramUsage {
  /** Clé `d:banque:programme` (batterie) ou `m:banque:programme`. */
  presets: Map<string, UsedPreset>;
  noteOns: number;
  pitchBends: number;
}

const DRUM_CHANNEL = 9;

export function presetKey(drum: boolean, bank: number, program: number): string {
  return `${drum ? "d" : "m"}:${bank}:${program}`;
}

/** Timbres réellement joués (au moins un Note On) par l'ensemble des morceaux. */
export function collectPrograms(songs: Iterable<Song>): ProgramUsage {
  const usage: ProgramUsage = { presets: new Map(), noteOns: 0, pitchBends: 0 };
  for (const song of songs) {
    const program = new Array<number>(16).fill(0);
    const bankMsb = new Array<number>(16).fill(0);
    const bankLsb = new Array<number>(16).fill(0);
    for (const event of song.events) {
      if (event.kind !== "midi") continue;
      const [status, d1, d2] = event.bytes;
      const channel = status & 0x0f;
      switch (status & 0xf0) {
        case 0xc0:
          program[channel] = d1;
          break;
        case 0xb0:
          if (d1 === 0) bankMsb[channel] = d2;
          else if (d1 === 32) bankLsb[channel] = d2;
          break;
        case 0xe0:
          usage.pitchBends++;
          break;
        case 0x90: {
          if (!isNoteOn(event.bytes)) break;
          usage.noteOns++;
          const drum = channel === DRUM_CHANNEL;
          const bank = drum ? 128 : (bankMsb[channel] << 7) | bankLsb[channel];
          const key = presetKey(drum, bank, program[channel]);
          let preset = usage.presets.get(key);
          if (!preset) {
            preset = { drum, bank, program: program[channel], keys: new Set() };
            usage.presets.set(key, preset);
          }
          preset.keys.add(d1);
          break;
        }
      }
    }
  }
  return usage;
}
