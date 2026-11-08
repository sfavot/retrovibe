import type { BaseHost } from "../../../engine/host";

/**
 * Frontière entre le moteur de *Flight of the Amazon Queen* et son environnement (navigateur ou test) : seul point d'entrée des
 * fichiers, des entrées et du son (`docs/fotaq/engine.md`, § 1). Le moteur n'attend jamais : `tick()` consomme ce que l'hôte a
 * accumulé depuis le tick précédent, et l'hôte fait avancer le temps (`FixedStepClock`, `TICK_MS`).
 *
 * Vague G1 : fichiers, entrées, morceaux (`playSong`) et journal. Vague R : l'image (`present`, `fileExists`). Les vagues suivantes
 * y ajoutent les voix et les effets (A, T) ; la sortie du jeu est `exit()` de `BaseHost`.
 */

/** Boutons de la souris (`Input::MOUSE_LBUTTON`, `MOUSE_RBUTTON`). */
export const MouseButton = { Left: 1, Right: 2 } as const;

/**
 * Actions du clavier, nommées comme la carte de touches de ScummVM (`kAction*` d'engines/queen/metaengine.cpp) : l'hôte traduit
 * les touches (vague J), le moteur ne connaît que les actions. Les huit verbes, les cases 1 à 4 et les flèches de l'inventaire,
 * le passage d'une réplique (`skipText`), d'une cinématique ou d'un dialogue (`skipCutaway`, Échap) et le journal.
 */
export type FotaqAction =
  | "open"
  | "close"
  | "move"
  | "give"
  | "look"
  | "pickUp"
  | "talk"
  | "use"
  | "inventory1"
  | "inventory2"
  | "inventory3"
  | "inventory4"
  | "scrollUp"
  | "scrollDown"
  | "skipText"
  | "skipCutaway"
  | "journal";

/**
 * Entrée de l'utilisateur. La souris est un **état** (position écran 320 x 200, masque de boutons `MouseButton`) dont le moteur
 * retient les appuis comme `Input::delay` de ScummVM (`EVENT_LBUTTONDOWN`, `EVENT_RBUTTONDOWN`) ; une action est un événement.
 */
export type FotaqInput = { type: "pointer"; x: number; y: number; buttons: number } | { type: "action"; action: FotaqAction };

export interface FotaqHost extends BaseHost {
  /**
   * Octets d'un fichier du jeu (`QUEEN.JAS`, `C1.PCX`, `CHIEF1.DOG`), nom en casse arbitraire : l'hôte le résout dans
   * `original/fotaq/`. Synchrone : l'hôte du navigateur précharge les fichiers lus ainsi. Lève si le fichier manque.
   */
  readFile(name: string): Uint8Array;
  /** Le fichier existe (`Resource::fileExists` : la lumière dynamique d'une pièce n'a de `.MSK` et de `.LUM` que si elle en a une). */
  fileExists(name: string): boolean;
  /**
   * Les fichiers d'un décor (`B1.PCX`, et `B1.MSK` / `B1.LUM` si la pièce en a) sont-ils lisibles ? Interrogé par `displayRoom` avant de
   * toucher à l'écran : tant que l'hôte répond non (il charge alors ce qui manque), le jeu attend, un tick à la fois, la pièce
   * précédente restant affichée. Facultatif : sans lui, les fichiers sont toujours lisibles (tests, outils).
   */
  roomFilesReady?(files: readonly string[]): boolean;
  /** Événements d'entrée reçus depuis l'appel précédent (la file est vidée). */
  pollInput(): readonly FotaqInput[];
  /**
   * Présente l'image du moteur : 320 x 200 indices de palette (64 000 octets, curseur compris sauf option `cursor: false` du rendu) et
   * la palette affichée (768 octets, RVB 8 bits). Appelée par `FotaqEngine.render()`, que l'hôte appelle une fois par image d'écran
   * après avoir fait avancer les ticks ; l'hôte peint tout de suite (`IndexedPresenter`). Les deux tableaux appartiennent au moteur
   * et ne sont valables que pendant l'appel.
   */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /**
   * `Sound::playSong(n)` : numéro de « morceau » des listes de commandes et des cinématiques. La table de ScummVM (`_song` de
   * `musicdata.cpp`) en fait une musique ou un effet (porte qui s'ouvre) : c'est la vague A qui la porte ; d'ici là l'hôte peut
   * l'ignorer.
   */
  playSong(song: number): void;
  /**
   * `Sound::playSfx(currentRoomSfx)` : une animation de la pièce (image > 500) joue l'effet de la pièce (numéro de `_sfxName`).
   * Facultatif : un hôte sans son l'ignore. Le son du navigateur est `FotaqAudio` (`audio/audio.ts`).
   */
  playSfx?(sfx: number): void;
  /**
   * `Sound::playSpeech` : lance la voix `name` (nom calculé par le moteur, en majuscules, espaces remplacés par `0` : `020001P2`).
   * Rend vrai si les voix sont actives et si le fichier existe (`speechOn() && speechSfxExists()`) : la réplique dure alors autant que
   * la voix (`speechActive`) ; sinon elle dure le temps d'un texte sans voix (`textFrames`). Facultatif : sans lui, jamais de voix.
   */
  playSpeech?(name: string): boolean;
  /** `Sound::stopSpeech`. */
  stopSpeech?(): void;
  /** `Sound::isSpeechActive` : la voix lancée par `playSpeech` n'est pas finie. */
  speechActive?(): boolean;
  /** `Sound::stopSfx` (une cinématique sautée coupe aussi l'effet en cours). */
  stopSfx?(): void;
  /**
   * Précharge des voix (noms de fichiers, comme `playSpeech`) : le moteur donne les voix de la scène à chaque changement de pièce
   * (`FotaqAudio.preload`). Facultatif ; sans attente, l'hôte charge en tâche de fond.
   */
  preloadSpeech?(names: readonly string[]): void;
  /** `Sound::lastOverride` : dernier morceau de musique retenu, repris à la fin d'une cinématique (0 : aucun). Facultatif. */
  lastSong?(): number;
  /**
   * Le journal est demandé (verbe du journal, `specialSection` 1 d'une liste de commandes) : `Logic::useJournal`. L'écran journal
   * de ScummVM n'est pas porté (D7) : l'hôte ouvre ses propres fenêtres (sauvegarde, chargement, options). Facultatif.
   */
  openJournal?(): void;
}
