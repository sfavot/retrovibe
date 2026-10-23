/** Échantillon prêt à jouer : PCM 8 bits non signé (silence = 0x80), comme `Voc` de `data/voc.ts`. */
export interface PcmSound {
  samples: Uint8Array;
  sampleRate: number;
}

/**
 * Frontière entre la voie son du jeu (pure, testable sous node) et le navigateur.
 * Deux canaux :
 * - la **voie** (voix, musique, vidéo) : `play` remplace ce qui jouait (comme `15f9:089f`) ;
 * - le **bruitage** mélangé (`348d:0b42`, engine.md §5.2 bis) : un seul emplacement, `playEffect` remplace le
 *   bruitage précédent, et l'on entend le bruitage **par-dessus** la voie sans la couper. Les deux canaux passent
 *   par le même volume.
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
  /**
   * Joue `sound` comme bruitage mélangé, une fois : remplace le bruitage précédent, ne touche pas à la voie.
   * Sans effet tant que la sortie est verrouillée.
   */
  playEffect(sound: PcmSound): void;
  /** Coupe le bruitage ; la voie n'est pas touchée. */
  stopEffect(): void;
  /** Vrai tant qu'un bruitage sort (équivalent de `348d:0b42(1, 0) != 0`) ; faux dès qu'il est fini. */
  readonly effectPlaying: boolean;
  /** Gain de 0 à 1, commun à la voie et au bruitage. */
  setGain(gain: number): void;
}
