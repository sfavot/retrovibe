/**
 * Effets sonores de TIM3 (`docs/tim3/formats.md` § 9) : 121 `SX_3xxx.WAV` dans `RESOURCE.002`, RIFF WAVE PCM (120 en 8 bits mono
 * 11 025 Hz, `SX_3400` en 16 bits 22 050 Hz). Le décodage est celui de `src/data/riff-wave.ts` ; ce module ajoute le contrôle
 * « lu jusqu'au dernier octet » : taille RIFF = fichier − 8, blocs `fmt ` puis `data`, aucun octet restant.
 */
import { parseRiffWave, riffWaveToChannels, type RiffWave } from "../../../data/riff-wave";

export interface SoundEffect {
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly duration: number;
  /** Octets situés après la fin du RIFF (470 octets étrangers dans `SX_3400.WAV`, vides ailleurs) : conservés, non interprétés. */
  readonly trailer: Uint8Array;
  /** Un `Float32Array` par canal, dans [-1, 1[. */
  readonly channels: Float32Array[];
}

/** Lit un WAV et vérifie qu'il est exactement constitué de `fmt ` (16 octets) et `data`. */
export function readSoundEffect(bytes: Uint8Array): SoundEffect {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wave: RiffWave = parseRiffWave(bytes);
  const dataSize = bytes.length >= 44 ? view.getUint32(40, true) : -1;
  const extent = 8 + view.getUint32(4, true);
  const exact =
    view.getUint32(16, true) === 16 &&
    dataSize === wave.data.length &&
    // La taille RIFF ne compte pas d'octet de bourrage : les fichiers à nombre d'octets impair n'en ont pas.
    extent === 44 + dataSize &&
    extent <= bytes.length;
  if (!exact) throw new Error("TIM3 : WAV d'effet de structure inattendue");
  const channels = riffWaveToChannels(wave);
  return {
    sampleRate: wave.sampleRate,
    bitsPerSample: wave.bitsPerSample,
    duration: channels[0].length / wave.sampleRate,
    trailer: bytes.subarray(extent),
    channels,
  };
}
