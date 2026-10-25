/** Conversion PCM → flottants et création d'`AudioBuffer`, partagées par les jeux. */

/** `AudioContext.createBuffer` exige au moins 3000 Hz. */
export const MIN_BUFFER_RATE = 3000;

/** PCM 8 bits non signé (0x80 = silence) → flottants dans [-1, 1[. */
export function u8ToFloat32(samples: Uint8Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < out.length; i++) out[i] = (samples[i] - 128) / 128;
  return out;
}

/** PCM 8 bits signé → flottants dans [-1, 1[. */
export function s8ToFloat32(samples: Int8Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < out.length; i++) out[i] = samples[i] / 128;
  return out;
}

/**
 * PCM 16 bits signé little-endian, entrelacé sur `channels` canaux → flottants dans [-1, 1[ pour le canal `channel`.
 * Un éventuel échantillon incomplet en fin de données est ignoré.
 */
export function s16leToFloat32(bytes: Uint8Array, channels: number, channel: number): Float32Array {
  const frames = Math.floor(bytes.length / (2 * channels));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = view.getInt16((i * channels + channel) * 2, true) / 32768;
  return out;
}

/** Crée un `AudioBuffer` mono ; la fréquence est relevée au minimum accepté par Web Audio. */
export function createMonoBuffer(ctx: BaseAudioContext, samples: Float32Array, sampleRate: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, Math.max(MIN_BUFFER_RATE, sampleRate));
  buffer.getChannelData(0).set(samples);
  return buffer;
}
