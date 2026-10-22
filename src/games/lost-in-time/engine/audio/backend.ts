/**
 * Frontières entre la logique audio (pure, testable sous node) et le navigateur.
 * Les implémentations Web Audio / HTMLAudioElement sont dans web-audio.ts et html-cd.ts.
 */

/** Sortie des effets sonores : un canal « Sound Blaster » et une file pour le son des vidéos IMD. */
export interface SoundBackend {
  /**
   * Joue un échantillon 8 bits signé à `rate` Hz, en remplaçant le précédent.
   * `passes` : nombre de lectures complètes, Infinity pour une boucle.
   */
  playSample(pcm: Int8Array, rate: number, passes: number): void;
  /** Arrête le canal ; avec `fadeSeconds` > 0, le volume décroît jusqu'à zéro avant l'arrêt. */
  stopSample(fadeSeconds: number): void;
  /** Met en file d'attente un morceau de PCM 8 bits signé, joué à la suite des précédents. */
  queuePcm(pcm: Int8Array, rate: number): void;
  /** Vide la file du son vidéo et coupe ce qui joue. */
  clearQueue(): void;
}

/** Lecture en flux de la piste audio du CD. Les temps sont en secondes depuis le début du fichier. */
export interface CdBackend {
  /** Lit de `startSec` à `endSec` (arrêt automatique en fin de plage), en remplaçant la lecture en cours. */
  play(startSec: number, endSec: number): void;
  stop(): void;
  /** Vrai tant que le son sort réellement (faux si en pause, terminé ou bloqué par le navigateur). */
  readonly playing: boolean;
  /** Position de lecture courante, en secondes depuis le début du fichier. */
  readonly currentTime: number;
}

/** Ce que le son lit dans les données du jeu. */
export interface SoundSource {
  /** Fichier des archives ouvertes (insensible à la casse). */
  getFile(name: string): Uint8Array | undefined;
  /** Ressource du TOT courant (ou de son EXT) par numéro. */
  getResource(id: number): Uint8Array | null;
}
