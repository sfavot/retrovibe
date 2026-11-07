import type { BaseHost } from "../../../engine/host";

/**
 * Frontière entre le moteur de *Drascula* et son environnement (navigateur ou test) : seul point d'entrée des fichiers, des
 * entrées, du son et de la musique. Le moteur n'attend jamais : `tick()` consomme ce que l'hôte a accumulé depuis le tick
 * précédent, et l'hôte fait avancer le temps (`FixedStepClock`, `TICK_MS`).
 *
 * L'image est présentée par `present` (vague R) ; la sortie du jeu est `exit()` de `BaseHost`.
 */

/**
 * Entrée de l'utilisateur. La souris est un **état** (position écran 320 x 200, masque de boutons : 1 gauche, 2 droit), relu
 * comme les événements de ScummVM (`updateEvents`) ; une touche est un événement, nommée comme `KeyboardEvent.key`
 * (`"F1"`, `"Escape"`, `" "`, `"a"`).
 */
export type DrasculaInput = { type: "pointer"; x: number; y: number; buttons: number } | { type: "key"; key: string };

export interface DrasculaHost extends BaseHost {
  /**
   * Octets d'un fichier du jeu (`62.ald`, `drascula.dat`, `96.alg`), nom en casse arbitraire : l'hôte le résout dans
   * `original/drascula/` (`GameFiles.resolve`). Synchrone : l'hôte du navigateur précharge les fichiers lus ainsi (fiches,
   * images, `drascula.dat`) ; les sons passent par `playSound`. Lève si le fichier manque.
   */
  readFile(name: string): Uint8Array;
  /** Événements d'entrée reçus depuis l'appel précédent (la file est vidée). */
  pollInput(): readonly DrasculaInput[];
  /**
   * Joue un son `.ALS` (voix ou effet, `214.als`, `s3.als`) sur la voie unique de ScummVM (`_soundHandle`), en remplaçant le
   * son en cours. Rend faux si le fichier n'existe pas. Le chargement peut être asynchrone : le son est « en cours » dès cet
   * appel. Son coupé (préférence « Son ») : le son reste « en cours » pendant sa durée, pour ne pas décaler le temps du jeu.
   */
  playSound(name: string): boolean;
  /** Arrête le son en cours (`stopSound`). */
  stopSound(): void;
  /** Un son est en cours (`soundIsActive`). */
  soundActive(): boolean;
  /**
   * Présente l'image du moteur : 320 x 200 indices de palette (64 000 octets) et la palette affichée (768 octets, RVB 8 bits).
   * Appelée par `DrasculaEngine.render()`, que l'hôte appelle une fois par image d'écran après avoir fait avancer les ticks ; l'hôte peint tout de suite (`IndexedPresenter`). Les
   * deux tableaux appartiennent au moteur et ne sont valables que pendant l'appel : l'hôte les copie ou les peint tout de suite.
   */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Joue la piste `track<n>` en entier, une fois (`playMusic(p)`). */
  playMusic(track: number): void;
  /** Arrête la musique (`stopMusic`). */
  stopMusic(): void;
  /** Une piste est en cours (`musicStatus`). */
  musicPlaying(): boolean;
  /**
   * Volume de la musique, de 0 à 1 : le moteur le baisse pas à pas pour le fondu de fin de chapitre et des cinématiques
   * (`MusicFadeout`), puis le remet à 1. Facultatif : sans lui, la musique s'arrête sans fondu.
   */
  setMusicVolume?(level: number): void;
}
