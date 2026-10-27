/**
 * Son `\0SND` Mohawk de type `WAVE` : `MHWK`, taille u32, `WAVE`, puis des blocs `tag[4]` + taille u32 (big-endian),
 * complétés à une longueur paire. Blocs vus : `Cue#` (points de repère, optionnel) et `Data`.
 *
 * Bloc `Data` (la taille inclut les 20 octets d'entête) : fréquence u16, nombre d'échantillons u32,
 * bits u8, canaux u8, codage u16 (0 = PCM brut non signé), nombre de boucles u16 (0xFFFF = boucle),
 * début de boucle u32, fin de boucle u32, puis les échantillons.
 */
import { u8ToFloat32 } from "../../audio/pcm";
import { BinaryReader } from "../reader";

export interface CuePoint {
  /** Position en échantillons. */
  sampleFrame: number;
  name: string;
}

export interface Wave {
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  /** 0 = PCM brut (seul codage rencontré dans le jeu). */
  encoding: number;
  loopCount: number;
  loopStart: number;
  loopEnd: number;
  cues: CuePoint[];
  /** PCM 8 bits non signé, `sampleCount` octets. */
  samples: Uint8Array;
}

/** `true` si la ressource `\0SND` contient un son (et non un MIDI). */
export function isWave(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "MHWK" && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE";
}

export function parseWave(bytes: Uint8Array): Wave {
  const r = new BinaryReader(bytes);
  if (r.tag() !== "MHWK") throw new Error("WAVE : signature MHWK absente");
  r.u32be();
  if (r.tag() !== "WAVE") throw new Error("WAVE : signature WAVE absente");

  let wave: Wave | undefined;
  const cues: CuePoint[] = [];
  while (r.offset + 8 <= r.length) {
    const tag = r.tag();
    const size = r.u32be();
    const start = r.offset;
    const end = start + size;
    if (tag === "Data") {
      const sampleRate = r.u16be();
      const sampleCount = r.u32be();
      const bitsPerSample = r.u8();
      const channels = r.u8();
      const encoding = r.u16be();
      const loopCount = r.u16be();
      const loopStart = r.u32be();
      const loopEnd = r.u32be();
      if (encoding !== 0 || bitsPerSample !== 8 || channels !== 1) {
        throw new Error(`WAVE : ${bitsPerSample} bits, ${channels} canal(aux), codage ${encoding} non pris en charge`);
      }
      // La taille du bloc dépasse parfois de 1 octet le nombre d'échantillons déclaré : seul ce dernier compte.
      if (sampleCount > size - 20) throw new Error("WAVE : bloc Data tronqué");
      wave = { sampleRate, bitsPerSample, channels, encoding, loopCount, loopStart, loopEnd, cues, samples: r.bytesView(sampleCount) };
    } else if (tag === "Cue#") {
      const count = r.u16be();
      for (let i = 0; i < count; i++) {
        const sampleFrame = r.u32be();
        const nameLength = r.u8();
        const name = r.string(nameLength);
        if (nameLength % 2 === 0) r.u8();
        cues.push({ sampleFrame, name });
      }
    }
    r.offset = end + (size & 1);
  }
  if (!wave) throw new Error("WAVE : bloc Data absent");
  return wave;
}

/** PCM 8 bits non signé → flottants dans [-1, 1[ pour Web Audio (0x80 = 0). */
export function waveToFloat32(wave: Wave): Float32Array {
  return u8ToFloat32(wave.samples);
}

/** Durée en secondes. */
export function waveDuration(wave: Wave): number {
  return wave.samples.length / wave.sampleRate;
}
