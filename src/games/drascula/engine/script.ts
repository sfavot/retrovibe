import type { DrasculaEngine } from "./loop";
import type { RoomPainter } from "../render/renderer";
import type { Sequence } from "../../../engine/sequence";

/**
 * Points d'extension du moteur pour la logique propre au jeu (vague P : pièces, cinématiques, dialogues). Chaque point correspond
 * à un endroit nommé du moteur de ScummVM (engines/drascula) où le code générique appelle du code propre à une pièce ou à un
 * chapitre ; le moteur fait le reste. Tous sont facultatifs : sans eux, les verbes répondent par `roomActions` et les excuses.
 *
 * Convention : un gestionnaire qui parle, marche ou attend est une séquence (`Sequence`). Pour finir un chapitre (ScummVM :
 * un gestionnaire qui « rend vrai » jusqu'à `runCurrentChapter`), il appelle `g.endChapter()` : la séquence est abandonnée à
 * son prochain `yield` et le chapitre suivant commence.
 */

/** Gestionnaire de verbe d'une pièce (`room_N`) : rend vrai s'il a répondu (`hasAnswer`), faux pour laisser la main. */
export type RoomParser = (g: DrasculaEngine, objectId: number) => Sequence<boolean>;

export interface GameScript {
  /** `room_N` : gestionnaires des pièces, appelés après `roomActions` de la pièce (`room(rN, fl)`). */
  rooms?: Partial<Record<number, RoomParser>>;
  /**
   * Partie propre au chapitre de `checkAction`, entre `roomActions` des pseudo-pièces 200 / 201 et la pièce : objets de
   * l'inventaire combinés, pièces qui répondent avant leur table (13, 21, 56, 60, 102). Rend vrai s'il a répondu.
   */
  checkAction?: (g: DrasculaEngine, objectId: number) => Sequence<boolean>;
  /** Cinématiques appelées par le moteur lui-même, nommées comme `animation_*` de ScummVM : `1_1`, `castle`, `1_6`. */
  animations?: Partial<Record<string, (g: DrasculaEngine) => Sequence>>;
  /** `updateDoor` : état de porte des objets selon les drapeaux (chapitres 2 et 4) ; `index` : index de l'objet dans la pièce. */
  updateDoor?: (g: DrasculaEngine, index: number) => void;
  /** Fin de la partie « données » d'`enterRoom` : `updateVisible`, musiques de remplacement du chapitre 2, minuteries. */
  roomLoaded?: (g: DrasculaEngine) => void;
  /** Fin d'`enterRoom` : séquences jouées à l'entrée (`animation_7_4`, `playTalkSequence(4)`, `animation_19_6`…). */
  roomEntered?: (g: DrasculaEngine) => Sequence;
  /**
   * Début d'`exitRoom`, avant tout : rend faux pour refuser la sortie (porte 104 de l'auberge au chapitre 1, réplique 442 de la
   * porte 105). `index` : index de la porte dans la pièce.
   */
  canExit?: (g: DrasculaEngine, index: number) => Sequence<boolean>;
  /**
   * `exitRoom`, le héros arrivé à la porte, avant de charger la pièce suivante : actions propres aux portes. Rend faux quand une
   * cinématique a pris le relais (la pièce suivante n'est pas chargée).
   */
  leaving?: (g: DrasculaEngine, index: number) => Sequence<boolean>;
  /**
   * Après le rechargement d'une partie (`DrasculaEngine.loadGame`), la pièce chargée et ses séquences d'entrée jouées : refait ce qu'une
   * séquence avait mis en place hors de l'état sauvegardé (chapitre 6 : `activatePendulum` dans la pièce 102, comme `loadGame` de ScummVM).
   */
  restored?: (g: DrasculaEngine) => void;
  /** Début de chaque image de la boucle principale (corrections de position des pièces 3 et 14 du chapitre 2). */
  frame?: (g: DrasculaEngine) => Sequence | null;
  /**
   * `update_N_pre` (avant le héros) et `update_N` (après) : dessin propre à une pièce, par chapitre puis par numéro de pièce (une
   * même pièce peut être dessinée différemment d'un chapitre à l'autre : la 16 de ScummVM ; accroches de
   * `DrasculaRenderer.painters`, `graphics.md` § 11). Un painter **ne fait que dessiner** depuis l'état (`GameState.anim`, drapeaux,
   * héros) : il est rappelé à chaque `render()`, à une cadence qui n'est pas celle du moteur, et ne doit ni tirer au hasard ni
   * avancer une animation (c'est le rôle de `tick`).
   */
  painters?: Partial<Record<number, Partial<Record<number, RoomPainter>>>>;
  /**
   * Appelée à chaque tick du moteur (10 ms) : fait avancer les animations des pièces dont le dessin est dans `painters`
   * (partie « avance » de `update_N_pre` : `getTime() - savedTime > n`, tirages au hasard). Le moteur ne l'appelle pas après la
   * fin du jeu ; elle doit se limiter à sa pièce (`g.state.room?.number`) et ne pas lancer de séquence.
   */
  tick?: (g: DrasculaEngine) => void;
}

/**
 * Logique d'un chapitre : un `GameScript` partiel dont tous les points ne servent que dans ce chapitre. `rooms/index.ts` assemble les
 * six chapitres en un seul `GameScript` (`rooms/assemble.ts`) : les points globaux (`checkAction`, `canExit`, `leaving`,
 * `roomLoaded`, `roomEntered`, `updateDoor`, `frame`, `tick`) ne sont appelés que pour le chapitre en cours ; les tables par
 * pièce ou par nom (`rooms`, `painters`, `animations`) sont fusionnées, une même clé dans deux chapitres est une erreur.
 */
export type ChapterScript = Omit<GameScript, "painters"> & {
  /** Painters du chapitre, par numéro de pièce : `assemble.ts` les range sous le numéro du chapitre. */
  painters?: Partial<Record<number, RoomPainter>>;
};
