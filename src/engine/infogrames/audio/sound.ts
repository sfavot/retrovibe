/**
 * Son prêt à jouer : ses données, et la longueur du PCM d'origine.
 *
 * Deux formes :
 * - `pcm-u8` : PCM 8 bits non signé mono (silence = 0x80), un octet par échantillon (piste son d'une vidéo MUX) ;
 * - `mp3` : fichier MP3 (les VOC des jeux, versionnés en `<nom d'origine>.mp3`), décodé par la sortie du navigateur.
 *   Sa longueur vient de l'index `audio.json` (`data/audio-index.ts`), pas du MP3.
 *
 * Tout ce qui dépend d'une durée (attente de la fin d'un son, calage d'une vidéo, boucle de la musique) passe par
 * `sampleCount / sampleRate` : c'est la durée du son d'origine, à l'échantillon près, quelle que soit la forme.
 */
export interface Sound {
  format: "pcm-u8" | "mp3";
  data: Uint8Array;
  /** Nombre d'échantillons du PCM d'origine. */
  sampleCount: number;
  /** Fréquence du PCM d'origine, en Hz. */
  sampleRate: number;
}

/** Son à partir de PCM 8 bits non signé mono. */
export function pcmSound(samples: Uint8Array, sampleRate: number): Sound {
  return { format: "pcm-u8", data: samples, sampleCount: samples.length, sampleRate };
}

/** Durée exacte du son d'origine, en secondes. */
export function soundDuration(sound: Sound): number {
  return sound.sampleCount / sound.sampleRate;
}
