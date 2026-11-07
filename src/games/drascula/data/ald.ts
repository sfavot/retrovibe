import { TextResource } from "./text-resource";

/**
 * Fiches de pièces `.ALD` (`<n>.ALD`) : image annexe, musique, objets cliquables, portes, zone de marche.
 *
 * Disposition tirée de `enterRoom` (engines/drascula/rooms.cpp, ScummVM), à l'exception du chargement des
 * images, laissé au moteur. La disposition dépend du **chapitre** :
 * - chapitre 2 : l'en-tête compte une largeur de héros ; si elle est nulle rien d'autre, sinon la taille du
 *   héros pour la pièce et quatre noms d'images ; pas de limites de perspective en fin de fiche ;
 * - autres chapitres : deux limites de perspective (haute et basse) en fin de fiche.
 * Écarts volontaires : erreur au lieu d'une valeur par défaut sur une ligne illisible (voir `TextResource`) ;
 * les lignes que ScummVM ne lit pas sont rendues dans `unread` plutôt que perdues.
 */

export interface AldRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AldPoint {
  x: number;
  y: number;
}

export interface AldDoor {
  /** Pièce de destination. */
  room: number;
  /**
   * Point où le héros apparaît dans **cette** pièce quand il y arrive par la sortie dont l'identifiant est
   * celui de cet objet (`enterRoom` cherche l'objet de numéro `objExit` et prend son point). La porte
   * qu'on franchit n'en donne donc pas l'arrivée : c'est l'objet de même numéro que `exit` dans la
   * pièce de destination qui la donne.
   */
  x: number;
  y: number;
  /** Orientation du héros à l'arrivée dans la pièce de destination (`trackCharacter_alkeva`). */
  direction: number;
  /** Identifiant de l'objet de la pièce de destination où le héros apparaît (`objExit`). */
  exit: number;
}

export interface AldObject {
  id: number;
  /** Nom affiché (premier mot de la ligne, comme ScummVM). */
  name: string;
  rect: AldRect;
  /** Point où le héros va se placer pour agir sur l'objet. */
  approach: AldPoint;
  /** Orientation du héros en agissant (`trackObj`). */
  track: number;
  visible: boolean;
  /** Présent si l'objet est une porte. */
  door: AldDoor | null;
}

/** Taille du héros dans une pièce du chapitre 2 qui ne prend pas les valeurs par défaut. */
export interface AldHero {
  width: number;
  height: number;
  feetHeight: number;
  stepX: number;
  stepY: number;
  /** Images de la pièce, dans l'ordre : avant, annexe, inutilisée, arrière. */
  surfaces: [front: string, extra: string, unused: string, back: string];
}

export interface AldRoom {
  number: number;
  /** Numéro de la piste de musique (0 : aucune) ; la piste est `track<n>`. */
  music: number;
  /** Image annexe de la pièce (`AUX14.ALG`) : feuille de sprites. */
  disk: string;
  /** Niveau de palette (éclaircit ou assombrit la palette de base). */
  paletteLevel: number;
  /** Chapitre 2 seulement : `null` pour les valeurs par défaut du jeu (largeur nulle). */
  hero: AldHero | null;
  objects: AldObject[];
  /** Zone de marche. */
  walk: AldRect;
  /** Limites de perspective (facteur de réduction du héros en haut et en bas de la zone), hors chapitre 2. */
  limits: { upper: number; lower: number } | null;
  /** Lignes que ScummVM ne lit pas, après la dernière valeur lue. */
  unread: string[];
}

/** Lit un `.ALD` ; `chapter` est le chapitre en cours, qui fixe la disposition de la fiche. */
export function parseAld(bytes: Uint8Array, chapter: number): AldRoom {
  const text = new TextResource(bytes, "ALD invalide");
  const number = text.int();
  const music = text.int();
  const disk = text.word();
  const paletteLevel = text.int();

  let hero: AldHero | null = null;
  if (chapter === 2) {
    const width = text.int();
    if (width !== 0) {
      hero = {
        width,
        height: text.int(),
        feetHeight: text.int(),
        stepX: text.int(),
        stepY: text.int(),
        surfaces: [text.word(), text.word(), text.word(), text.word()],
      };
    }
  }

  const count = text.int();
  const objects: AldObject[] = [];
  for (let i = 0; i < count; i++) {
    const id = text.int();
    const name = text.word();
    const rect = { x1: text.int(), y1: text.int(), x2: text.int(), y2: text.int() };
    const approach = { x: text.int(), y: text.int() };
    const track = text.int();
    const visible = text.int() !== 0;
    const door =
      text.int() !== 0
        ? { room: text.int(), x: text.int(), y: text.int(), direction: text.int(), exit: text.int() }
        : null;
    objects.push({ id, name, rect, approach, track, visible, door });
  }

  const walk = { x1: text.int(), y1: text.int(), x2: text.int(), y2: text.int() };
  const limits = chapter === 2 ? null : { upper: text.int(), lower: text.int() };
  return { number, music, disk, paletteLevel, hero, objects, walk, limits, unread: text.unread() };
}
