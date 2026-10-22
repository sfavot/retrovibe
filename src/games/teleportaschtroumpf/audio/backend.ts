/** Échantillon prêt à jouer : PCM 8 bits non signé (silence = 0x80), comme `Voc` de `data/voc.ts`. */
export interface PcmSound {
  samples: Uint8Array;
  sampleRate: number;
}

/**
 * Frontière entre la voie son du jeu (pure, testable sous node) et le navigateur.
 * Une seule voie : `play` remplace ce qui jouait (comme `15f9:089f`).
 */
export interface AudioBackend {
  /** Autorise la sortie (politique d'autoplay) : à appeler depuis un geste de l'utilisateur. */
  unlock(): void;
  /** Joue `sound` en remplaçant le son courant ; `loop` : en boucle. Sans effet tant que la sortie est verrouillée. */
  play(sound: PcmSound, loop: boolean): void;
  stop(): void;
  /** Vrai tant qu'un son sort réellement (faux s'il est fini, arrêté, ou si la sortie est verrouillée). */
  readonly playing: boolean;
  /** Position de lecture dans le son courant, en secondes depuis son début (revient à 0 à chaque tour d'une boucle). */
  readonly position: number;
  /** Gain de 0 à 1. */
  setGain(gain: number): void;
}
