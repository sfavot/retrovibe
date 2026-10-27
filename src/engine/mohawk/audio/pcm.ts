/**
 * Ressources `WAVE` → `PcmSound` (échantillons flottants prêts pour `AudioSink.playWave`).
 * Le résultat est mis en cache par (archive, id) : les écrans rejouent sans cesse les mêmes bruitages et voix.
 */
import { type MohawkArchive, TAG_SND } from "../../../data/mohawk/mohawk";
import { parseWave, waveToFloat32 } from "../../../data/mohawk/wave";
import type { PcmSound } from "./sink";

/** Octets d'une ressource `\0SND` de type `WAVE` → échantillons flottants (8 bits non signé, 0x80 = 0). */
export function pcmFromWave(bytes: Uint8Array): PcmSound {
  const wave = parseWave(bytes);
  return { samples: waveToFloat32(wave), sampleRate: wave.sampleRate };
}

const cache = new WeakMap<MohawkArchive, Map<number, PcmSound>>();

/** Son `\0SND` `id` de l'archive, converti une seule fois. Lève si la ressource est absente ou n'est pas un WAVE. */
export function loadPcm(archive: MohawkArchive, id: number): PcmSound {
  let byId = cache.get(archive);
  if (!byId) {
    byId = new Map();
    cache.set(archive, byId);
  }
  let sound = byId.get(id);
  if (!sound) {
    sound = pcmFromWave(archive.get(TAG_SND, id));
    byId.set(id, sound);
  }
  return sound;
}
