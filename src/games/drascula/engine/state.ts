import type { AldDoor, AldHero, AldPoint, AldRect } from "../data/ald";

/**
 * État du monde de *Drascula* : chapitre, drapeaux, inventaire, pièce chargée, héros, curseur. Variables de `DrasculaEngine`
 * (engines/drascula/drascula.h, ScummVM), regroupées et renommées ; données simples (sérialisables en JSON pour la vague S).
 * Igor, Drascula et Von Braun (`igorX`, `trackDrascula`, `vonBraunX`…) sont là parce que leurs répliques et les cinématiques les
 * dessinent (vagues T et C) ; B.J. et les autres personnages des pièces viendront avec les pièces (vague P).
 */

/** Dernier chapitre du jeu. */
export const LAST_CHAPTER = 6;
/** Drapeaux du jeu (`NUM_FLAGS`). */
export const NUM_FLAGS = 50;
/** Cases de l'inventaire (`inventoryObjects[43]`) : la case 0 n'est pas utilisée, les cases 1 à 6 portent les verbes. */
export const INVENTORY_SIZE = 43;

/** Taille du héros par défaut et pas de marche (`CHARACTER_WIDTH`, `CHARACTER_HEIGHT`, `FEET_HEIGHT`, `STEP_X`, `STEP_Y`). */
export const CHARACTER_WIDTH = 43;
export const CHARACTER_HEIGHT = 70;
export const FEET_HEIGHT = 12;
export const STEP_X = 8;
export const STEP_Y = 3;
/** Taille d'une case d'objet de l'inventaire et d'un curseur d'objet (`OBJWIDTH`, `OBJHEIGHT`). */
export const OBJ_WIDTH = 40;
export const OBJ_HEIGHT = 25;

/**
 * Verbes (`Verbs` de ScummVM). Ce sont aussi les « objets » 1 à 6 du curseur et de l'inventaire : `pickedObject` vaut un
 * verbe (1 à 6) ou un objet de l'inventaire (7 et plus).
 */
export const Verb = {
  /** `kVerbDefault` : ligne de `roomActions` valable pour tous les verbes. */
  Default: -1,
  None: 0,
  Look: 1,
  Pick: 2,
  Open: 3,
  Close: 4,
  Talk: 5,
  Move: 6,
} as const;

/** Numéro d'objet du héros lui-même (`checkAction(50)` quand on clique sur lui avec un verbe). */
export const HERO_OBJECT = 50;

/**
 * Orientation du héros (`trackProtagonist`) : choisit l'image. 0 gauche et 1 droite (images de profil, `extraSurface`),
 * 2 de dos (en montant, `backSurface`), 3 de face (en descendant, `frontSurface`). Lu dans `quadrant_*` et `moveCharacters`.
 */
export const Track = { Left: 0, Right: 1, Up: 2, Down: 3 } as const;

/**
 * Sens du pas (`curDirection`, `CharacterDirections` de ScummVM) : malgré leurs noms d'origine, ce sont des diagonales
 * (`increaseFrameNum`). `kDirectionUp` = haut-gauche, `kDirectionDown` = bas-droite, `kDirectionLeft` = bas-gauche,
 * `kDirectionRight` = haut-droite.
 */
export const Step = { UpLeft: 0, DownRight: 1, DownLeft: 2, UpRight: 3 } as const;

export interface Hero {
  /** Coin haut gauche (`curX`, `curY`) ; `x = -1` : à placer au point d'arrivée de la prochaine pièce. */
  x: number;
  y: number;
  /** Taille courante (`curWidth`, `curHeight`) : fixe au chapitre 2, réduite par la perspective ailleurs. */
  width: number;
  height: number;
  feetHeight: number;
  /** Pas de marche (`stepX`, `stepY`) : 8 et 3, sauf la composante calculée par `quadrant_*`. */
  stepX: number;
  stepY: number;
  /** `trackProtagonist`, voir `Track`. */
  track: number;
  /** `curDirection`, voir `Step`. */
  direction: number;
  /** Image de marche, 0 à 5 (`_characterFrame`). */
  frame: number;
  /** En marche (`_characterMoved`). */
  moving: boolean;
  /** Affiché (`_characterVisible`). */
  visible: boolean;
  /** Point visé, au niveau des pieds (`roomX`, `roomY`). */
  targetX: number;
  targetY: number;
  /** Tick du dernier pas (`_startTime`). */
  startTime: number;
  /** En route vers un objet : à l'arrivée, prendre l'orientation `trackFinal` (`_walkToObject`). */
  walkToObject: boolean;
  trackFinal: number;
  /** Taille réduite calculée au dernier dessin (`newWidth`, `newHeight`), appliquée au pas suivant. */
  scaledWidth: number;
  scaledHeight: number;
}

/** Personnage secondaire placé par le jeu : coin haut gauche et orientation (`igorX`, `igorY`, `trackIgor`…). */
export interface Actor {
  x: number;
  y: number;
  /** 0 gauche, 1 droite, 3 de face (`placeIgor`, `placeDrascula`). */
  track: number;
}

/** Von Braun (`vonBraunX`, `trackVonBraun`, `vonBraunHasMoved`, `actorFrames[kFrameVonBraun]`) : toujours à l'ordonnée 66. */
export interface VonBraun {
  x: number;
  /** 0 gauche, 1 droite. */
  track: number;
  /** En marche (`vonBraunHasMoved`) : image de marche au lieu de l'image fixe. */
  moving: boolean;
  /** Colonne de l'image de marche (1, 30, 59… : `actorFrames[kFrameVonBraun]`). */
  frame: number;
}

export interface RoomObject {
  id: number;
  name: string;
  /** Zone cliquable : `Common::Rect(x1, y1, x2, y2)`, bords droit et bas exclus. */
  rect: AldRect;
  /** Point où le héros va pour agir sur l'objet. */
  approach: AldPoint;
  /** Orientation du héros une fois arrivé (`trackObj`). */
  track: number;
  visible: boolean;
  /** Porte franchissable (`isDoor`) : modifiable par le jeu (`updateDoor`, `updateVisible`) ; sans `door` elle ne mène nulle part. */
  isDoor: boolean;
  door: AldDoor | null;
}

export interface RoomState {
  number: number;
  /** Piste de musique de la fiche (0 : aucune). */
  music: number;
  /** Image annexe (feuille de sprites). */
  disk: string;
  paletteLevel: number;
  objects: RoomObject[];
  walk: AldRect;
  /** Chapitre 2 : taille du héros propre à la pièce (`null` : valeurs par défaut). */
  hero: AldHero | null;
  /** Facteur de réduction du héros (pourcentage) selon l'ordonnée des pieds, 0 à 201 (`factor_red`) ; `null` au chapitre 2. */
  factors: number[] | null;
}

export interface GameState {
  chapter: number;
  flags: number[];
  /** `inventoryObjects` : numéro d'objet par case (0 : vide). */
  inventory: number[];
  room: RoomState | null;
  hero: Hero;
  igor: Actor;
  drascula: Actor;
  vonBraun: VonBraun;
  /** Tick de la dernière image d'animation de la pièce (`savedTime` : pendule du chapitre 6, bougies de l'auberge, etc.). */
  savedTime: number;
  /**
   * Images courantes des animations des pièces (`actorFrames[kFrame*]`, `blinking`…), par nom : chaque chapitre emploie ses
   * propres clés (`candles`, `pianist`, `drunk`…), absentes = 0. Sérialisable ; lues par les accroches de dessin (`painters`),
   * avancées par l'accroche `tick` du chapitre.
   */
  anim: Record<string, number>;
  /** Couleur des répliques de `talk_solo` au chapitre 1 (`color_solo`, `TextColor`). */
  colorSolo: number;
  /** Un verbe ou un objet est sur le curseur (`takeObject`). */
  takeObject: boolean;
  /** Verbe (1 à 6) ou objet (7 et plus) du curseur (`pickedObject`). */
  pickedObject: number;
  /** Écran d'inventaire ouvert (`_menuScreen`). */
  menuScreen: boolean;
  /** Souris sur la barre des verbes (`_menuBar`). */
  menuBar: boolean;
  /** Nom affiché sous le curseur (`_hasName`, `textName`). */
  hasName: boolean;
  textName: string;
  /** Objet de la pièce suivante où le héros apparaît (`objExit`). */
  objExit: number;
  roomMusic: number;
  previousMusic: number;
  musicStopped: boolean;
  /** Excuses suivantes de `room_0` (`curExcuseLook`, `curExcuseAction`). */
  excuseLook: number;
  excuseAction: number;
}

export function createHero(): Hero {
  return {
    x: -1,
    y: 0,
    width: CHARACTER_WIDTH,
    height: CHARACTER_HEIGHT,
    feetHeight: FEET_HEIGHT,
    stepX: STEP_X,
    stepY: STEP_Y,
    track: Track.Down,
    direction: Step.UpLeft,
    frame: 0,
    moving: false,
    visible: true,
    targetX: 0,
    targetY: 0,
    startTime: 0,
    walkToObject: false,
    trackFinal: 0,
    scaledWidth: 0,
    scaledHeight: 0,
  };
}

/** État au début d'un chapitre, avant `runCurrentChapter` (début de la boucle de `run()`). */
export function createGameState(chapter: number): GameState {
  return {
    chapter,
    flags: new Array<number>(NUM_FLAGS).fill(0),
    inventory: new Array<number>(INVENTORY_SIZE).fill(0),
    room: null,
    hero: createHero(),
    // `run()` : Igor et Drascula sont placés d'avance au chapitre 6 seulement ; ailleurs les pièces ou les cinématiques les placent.
    igor: chapter === 6 ? { x: 105, y: 85, track: 1 } : { x: 0, y: 0, track: 0 },
    drascula: chapter === 6 ? { x: 62, y: 99, track: 1 } : { x: 0, y: 0, track: 0 },
    vonBraun: { x: 120, track: 1, moving: false, frame: 1 },
    savedTime: 0,
    anim: {},
    colorSolo: 0,
    takeObject: false,
    pickedObject: 0,
    menuScreen: false,
    menuBar: false,
    hasName: false,
    textName: "",
    objExit: 0,
    roomMusic: 0,
    previousMusic: -1,
    musicStopped: false,
    excuseLook: 0,
    excuseAction: 0,
  };
}
