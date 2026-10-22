/** Fichier son Creative Voice (.VOC). */
export interface Voc {
  /** Fréquence d'échantillonnage en Hz. */
  sampleRate: number;
  /** PCM 8 bits non signé (silence = 0x80), tous les blocs de données concaténés. */
  samples: Uint8Array;
}

const SIGNATURE = "Creative Voice File\x1a";

/**
 * Lit un .VOC. Inventaire des 975 fichiers du jeu : un seul bloc de données par fichier,
 * soit type 1 (974 fichiers, PCM 8 bits, time constant → 18 868 Hz pour 959 d'entre eux et
 * 19 231 Hz pour 15), soit type 9 (1 fichier, 11 025 Hz, 8 bits mono PCM) ; aucun silence,
 * marqueur, répétition ni bloc étendu, et jamais deux fréquences dans un même fichier.
 * Le silence (type 3) et la continuation (type 2) sont gérés par précaution ; tout le reste
 * (codec compressé, 16 bits, stéréo, répétitions…) lève une erreur explicite.
 */
export function parseVoc(bytes: Uint8Array): Voc {
  if (bytes.length < 26 || String.fromCharCode(...bytes.subarray(0, SIGNATURE.length)) !== SIGNATURE) {
    throw new Error("VOC : signature « Creative Voice File » absente");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = view.getUint16(20, true);
  let sampleRate = 0;
  const chunks: Uint8Array[] = [];

  const setRate = (rate: number) => {
    if (sampleRate && sampleRate !== rate) throw new Error(`VOC : fréquences différentes dans un même fichier (${sampleRate} et ${rate} Hz)`);
    sampleRate = rate;
  };

  while (pos < bytes.length) {
    const type = bytes[pos];
    if (type === 0) break;
    if (pos + 4 > bytes.length) throw new Error("VOC : en-tête de bloc tronqué");
    const size = bytes[pos + 1] | (bytes[pos + 2] << 8) | (bytes[pos + 3] << 16);
    const start = pos + 4;
    const end = start + size;
    if (end > bytes.length) throw new Error(`VOC : bloc de type ${type} tronqué`);

    switch (type) {
      case 1: {
        const codec = bytes[start + 1];
        if (codec !== 0) throw new Error(`VOC : codec ${codec} non pris en charge (seul le PCM 8 bits l'est)`);
        setRate(Math.round(1_000_000 / (256 - bytes[start])));
        chunks.push(bytes.subarray(start + 2, end));
        break;
      }
      case 2:
        chunks.push(bytes.subarray(start, end));
        break;
      case 3: {
        // Silence : durée u16 (en échantillons, moins un), time constant u8.
        const length = view.getUint16(start, true) + 1;
        setRate(Math.round(1_000_000 / (256 - bytes[start + 2])));
        chunks.push(new Uint8Array(length).fill(0x80));
        break;
      }
      case 9: {
        const bits = bytes[start + 4];
        const channels = bytes[start + 5];
        const codec = view.getUint16(start + 6, true);
        if (bits !== 8 || channels !== 1 || codec !== 0) {
          throw new Error(`VOC : bloc étendu ${bits} bits, ${channels} canal(aux), codec ${codec} non pris en charge`);
        }
        setRate(view.getUint32(start, true));
        chunks.push(bytes.subarray(start + 12, end));
        break;
      }
      default:
        throw new Error(`VOC : bloc de type ${type} non pris en charge`);
    }
    pos = end;
  }

  if (!sampleRate) throw new Error("VOC : aucun bloc de données");
  const samples = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return { sampleRate, samples };
}

/** PCM 8 bits non signé → flottants dans [-1, 1[ pour Web Audio (0x80 = 0). */
export function vocToFloat32(voc: Voc): Float32Array {
  const out = new Float32Array(voc.samples.length);
  for (let i = 0; i < out.length; i++) out[i] = (voc.samples[i] - 128) / 128;
  return out;
}
