/**
 * RIFF WAVE : `RIFF`, taille u32, `WAVE`, puis des blocs `tag[4]` + taille u32 (little-endian) complétés à une
 * longueur paire. Blocs lus : `fmt ` (format, canaux, fréquence, bits) et `data` ; les autres sont ignorés.
 * Pris en charge : PCM (format 1) 8 bits non signé et 16 bits signé, mono ou stéréo.
 */
import { s16leToFloat32, u8ToFloat32 } from "../audio/pcm";
import { BinaryReader } from "./reader";

export interface RiffWave {
  /** Code de format (1 = PCM). */
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Échantillons bruts, entrelacés (vue sur le tampon source). */
  data: Uint8Array;
}

const WAVE_FORMAT_PCM = 1;

/** `true` si les octets commencent par un en-tête `RIFF` … `WAVE`. */
export function isRiffWave(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0) === "RIFF" && ascii(bytes, 8) === "WAVE";
}

function ascii(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export function parseRiffWave(bytes: Uint8Array): RiffWave {
  const r = new BinaryReader(bytes);
  if (bytes.length < 12 || r.tag() !== "RIFF") throw new Error("RIFF WAVE : signature RIFF absente");
  const riffSize = r.u32();
  if (r.tag() !== "WAVE") throw new Error("RIFF WAVE : signature WAVE absente");
  // Une taille RIFF incohérente avec les données disponibles est bornée à la fin du tampon.
  const end = Math.min(bytes.length, 8 + riffSize);

  let fmt: Pick<RiffWave, "format" | "channels" | "sampleRate" | "bitsPerSample"> | undefined;
  let data: Uint8Array | undefined;
  while (r.offset + 8 <= end) {
    const tag = r.tag();
    const size = r.u32();
    const start = r.offset;
    if (tag === "fmt ") {
      if (size < 16 || start + 16 > bytes.length) throw new Error("RIFF WAVE : bloc fmt tronqué");
      const format = r.u16();
      const channels = r.u16();
      const sampleRate = r.u32();
      r.u32(); // débit moyen en octets/s
      r.u16(); // alignement d'un bloc
      const bitsPerSample = r.u16();
      fmt = { format, channels, sampleRate, bitsPerSample };
    } else if (tag === "data") {
      // Un bloc final tronqué est lu jusqu'à la fin des données disponibles.
      data = bytes.subarray(start, Math.min(start + size, bytes.length));
    }
    r.offset = start + size + (size & 1);
  }
  if (!fmt) throw new Error("RIFF WAVE : bloc fmt absent");
  if (!data) throw new Error("RIFF WAVE : bloc data absent");
  return { ...fmt, data };
}

/** Un `Float32Array` par canal, dans [-1, 1[. */
export function riffWaveToChannels(wave: RiffWave): Float32Array[] {
  if (wave.format !== WAVE_FORMAT_PCM || (wave.bitsPerSample !== 8 && wave.bitsPerSample !== 16) || wave.channels < 1) {
    throw new Error(`RIFF WAVE : format ${wave.format}, ${wave.bitsPerSample} bits, ${wave.channels} canal(aux) non pris en charge`);
  }
  const out: Float32Array[] = [];
  for (let c = 0; c < wave.channels; c++) {
    if (wave.bitsPerSample === 16) {
      out.push(s16leToFloat32(wave.data, wave.channels, c));
    } else {
      const frames = Math.floor(wave.data.length / wave.channels);
      const channel = new Uint8Array(frames);
      for (let i = 0; i < frames; i++) channel[i] = wave.data[i * wave.channels + c];
      out.push(u8ToFloat32(channel));
    }
  }
  return out;
}
