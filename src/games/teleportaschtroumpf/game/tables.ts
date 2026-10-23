/**
 * Tables de règles du Téléportaschtroumpf, extraites de `SMURF.EXE` (voir `docs/teleportaschtroumpf/rules.md`).
 * Chaque table donne l'adresse d'origine (`segment:offset` de code, `DS:xxxx` de données) ; les valeurs
 * lisibles dans l'exécutable sont revérifiées par `test/teleportaschtroumpf/rules.test.ts`.
 * Aucune dépendance au rendu, au DOM ni au moteur.
 */

/** Rangée du plateau : `y = 0x38` (haute) ou `y = 0x84` (basse). */
export type Row = "top" | "bottom";

/** Ordonnée d'origine de chaque rangée (`DS:7ABB` = `iRam3de4b`). */
export const ROW_Y: Record<Row, number> = { top: 0x38, bottom: 0x84 };

// --- Plateau ---------------------------------------------------------------------------------

/** Nombre d'écrans du plateau (fonds `s01a001d..s01a009d.mcg`). */
export const SCREEN_COUNT = 9;
/** Abscisse de départ de tous les joueurs (`28a3:00ad`) : écran 1, rangée haute, tournés vers la droite. */
export const START_X = 0x0b;
/** Largeur utile : le pion est sur le bord droit au-delà de `0x13E`, sur le bord gauche en dessous de 1 (`291e:13f2`). */
export const EDGE_RIGHT = 0x13e;
/** Abscisse d'arrivée quand on revient de l'écran suivant par la gauche (`291e:13f2`). */
export const ARRIVE_FROM_RIGHT_X = 0x134;
/** Pas de marche et de course en pixels par image (`2bd4:0093`, poses 2/3 et 6/7). */
export const WALK_STEP = 4;
export const RUN_STEP = 8;
/** Saut latéral (`2bd4:02bd` : poses 4/5, `x ± 0x44`). */
export const JUMP_STEP = 0x44;
/** Images logiques par seconde sur le plateau (`1f33:0348(4)` : 4 ticks de 60 Hz). */
export const BOARD_FPS = 15;

/** Zones de `x` d'une rangée : gauche 7..0x6A, centre 0x6C..0xD3, droite 0xD5..0x13A (`2813:010b..06b4`). */
export const DOOR_ZONES = [
  { min: 0x07, max: 0x6a },
  { min: 0x6c, max: 0xd3 },
  { min: 0xd5, max: 0x13a },
] as const;

/** Code « pas de porte » de l'exécutable (`0xFFFF`). */
export const NO_DOOR = 0xffff;

/**
 * Table des portes (`2813:010b..06b4`, lue par `2813:000d`) : `DOORS[écran − 1][rangée] = [gauche, centre, droite]`,
 * `null` = pas de porte dans la zone. Les codes 14 à 21 sont des événements du plateau (puits, pièges, pont,
 * fusée, lac, prison, turlusiphon) ; 22 à 41 et 51 sont des mini-jeux (voir `MINIGAMES`).
 * Écran 1 haut : aucune porte ; écran 1 bas : zones gauche et centre = 23 ; écran 9 : deux zones seulement
 * (écran 9 haut : G = 14, C et D = 39 ; écran 9 bas : G = 20, C et D = 36).
 */
export const DOORS: readonly Record<Row, readonly (number | null)[]>[] = [
  { top: [null, null, null], bottom: [23, 23, 29] },
  { top: [35, 38, 14], bottom: [40, 33, 25] },
  { top: [26, 28, 24], bottom: [39, 20, 21] },
  { top: [38, 51, 14], bottom: [34, 15, 18] },
  { top: [27, 21, 38], bottom: [15, 15, 20] },
  { top: [14, 15, 30], bottom: [39, 17, 21] },
  { top: [22, 20, 38], bottom: [32, 16, 31] },
  { top: [15, 15, 15], bottom: [20, 41, 38] },
  { top: [14, 39, 39], bottom: [20, 36, 36] },
];

/** Classe d'une zone vis-à-vis du bouton (table de sauts `291e:11f4`, 52 mots ; zones 53 et 54 absentes = porte). */
export type DoorClass =
  /** `D` : le bouton entre dans la porte (fin du tour). */
  | "door"
  /** `N` : pas une porte (le piège se déclenche par la marche) ; le bouton ne fait rien. */
  | "none"
  /** `W` : porte du puits, active seulement si le puits est ouvert ce tour (`DS:79D0`). */
  | "well"
  /** `S` : active seulement si le pion est dans un état ≠ 0 (prisonnier/pris au siphon) ; sinon le piège gère le bouton. */
  | "state"
  /** `F` : le magicien refuse un joueur qui a déjà les 8 ingrédients (`0xFF`). */
  | "notFull";

const CLASS_BY_LETTER: Record<string, DoorClass> = { D: "door", N: "none", W: "well", S: "state", F: "notFull" };

/**
 * `DOOR_CLASSES[(écran − 1) × 6 + (rangée basse ? 3 : 0) + zone]` pour `zone` 0 à 2 (`291e:1536` donne l'indice 1..54).
 * Les 52 premières classes viennent des 52 mots de `CS:291e:11f4` ; les zones 53 et 54 (écran 9 bas, centre et droite)
 * sont hors table : porte ordinaire.
 */
export const DOOR_CLASSES: readonly DoorClass[] = [..."NNNDDDDDDDDDDDDDSSDDWDNNDSDNNSWNDDNSDSDDNDNNNSFDWDDS", "D", "D"].map((c) => CLASS_BY_LETTER[c]);

// --- Mini-jeux et événements -------------------------------------------------------------------

/** Nature du gain d'un mini-jeu (`1e52:0053` = ingrédient, `1e52:00ad` = points, voir rules.md §Gains). */
export type MinigameKind = "ingredient" | "points" | "trade" | "steal" | "bird" | "well";

export interface MinigameInfo {
  /** Numéro de scène (`DATA/DESCRIPT.ION`). */
  scene: number;
  /** Fonction d'entrée (`segment:offset`). */
  entry: string;
  kind: MinigameKind;
  /** Pour `ingredient` : ingrédient 0..7 obtenu en cas de réussite. */
  ingredient?: number;
  /** Valeur de `DS:6F37` (`iRam3d397`) qui déclenche le bonus de l'oiseau dans cette scène (voir S39). */
  bonusTag?: number;
}

/**
 * Les 21 codes que `28a3:00ad` sait lancer (`28a3:0474` / `28a3:04a8`) en dehors des codes 100, 101 et 200..203 (voir
 * `SCENE_CODES`). Ingrédients : lus dans les appels `1e52:0053(joueur, n)` de chaque scène.
 */
export const MINIGAMES: readonly MinigameInfo[] = [
  { scene: 14, entry: "2daf:0006", kind: "well" },
  { scene: 22, entry: "1c78:0005", kind: "ingredient", ingredient: 3, bonusTag: 0x16 },
  { scene: 23, entry: "24d0:000c", kind: "points", bonusTag: 0x17 },
  { scene: 24, entry: "2e6a:0001", kind: "points", bonusTag: 0x18 },
  { scene: 25, entry: "260f:000e", kind: "points", bonusTag: 0x19 },
  { scene: 26, entry: "1ed0:000b", kind: "points", bonusTag: 0x1a },
  { scene: 27, entry: "1f84:000e", kind: "ingredient", ingredient: 2, bonusTag: 0x1b },
  { scene: 28, entry: "2573:000f", kind: "ingredient", ingredient: 6, bonusTag: 0x1c },
  { scene: 29, entry: "1da0:0009", kind: "points", bonusTag: 0x1d },
  { scene: 30, entry: "2d6b:0008", kind: "points", bonusTag: 0x1e },
  { scene: 31, entry: "2f87:0008", kind: "ingredient", ingredient: 5, bonusTag: 0x1f },
  { scene: 32, entry: "199e:000a", kind: "ingredient", ingredient: 4, bonusTag: 0x20 },
  { scene: 33, entry: "1ceb:000c", kind: "ingredient", ingredient: 7, bonusTag: 0x21 },
  { scene: 34, entry: "1b05:000b", kind: "ingredient", ingredient: 0, bonusTag: 0x22 },
  { scene: 35, entry: "1bda:0021", kind: "points", bonusTag: 0x23 },
  // Défaut de l'original corrigé (2026-10-23) : S36 testait la valeur de S27 (0x1B) ; elle lit maintenant la sienne (0x24, scène 36).
  { scene: 36, entry: "23c9:0004", kind: "ingredient", ingredient: 1, bonusTag: 0x24 },
  { scene: 38, entry: "1fc6:0008", kind: "steal" },
  { scene: 39, entry: "265b:000d", kind: "bird" },
  { scene: 40, entry: "2ee8:000d", kind: "points", bonusTag: 0x28 },
  { scene: 41, entry: "2143:0009", kind: "trade" },
  { scene: 51, entry: "19a8:0006", kind: "points", bonusTag: 0x33 },
];

export function minigameInfo(scene: number): MinigameInfo | undefined {
  return MINIGAMES.find((m) => m.scene === scene);
}

/** Codes retournés par le plateau et traités par `28a3:00ad` (`CS:28a3:0474`, 26 mots). */
export const SCENE_CODES: readonly number[] = [14, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 51, 100, 101, 201, 202, 203];

/** Sortie du plateau par la gauche (`100`, vidéo `s01b.mux`) ou par la droite (`101`, `s01c.mux`) : `291e:13f2`. */
export const EXIT_LEFT_CODE = 100;
export const EXIT_RIGHT_CODE = 101;

/** Ingrédient `i` (0..7) est donné par la scène `INGREDIENT_SCENES[i]` (appels `1e52:0053`). */
export const INGREDIENT_COUNT = 8;
export const INGREDIENT_SCENES: readonly number[] = [34, 36, 27, 22, 32, 31, 28, 33];
/** Masque de tous les ingrédients (`0xFF` : `291e:0401`, `2daf:0006`, `2143:0009`). */
export const ALL_INGREDIENTS = 0xff;

/** Plafond des points (« gouttes de rosée »), `1e52:00ad` : 60 (`0x3C`). */
export const MAX_POINTS = 60;
/** Prix d'un ingrédient chez le magicien, en points (`2143:0009`, `S49_12`). */
export const MAGICIAN_PRICE = 3;
/** Choix 8 du magicien (zone « chapeau ») : paie sans ingrédient. */
export const MAGICIAN_HAT_CHOICE = 8;

/** Table des scènes d'indice de l'oiseau (`DS:25F5`, 17 octets, tirée par `rand() × 17`) : les 17 lieux de la carte. */
export const BIRD_HINT_SCENES: readonly number[] = [22, 30, 31, 32, 36, 24, 26, 51, 28, 34, 27, 23, 25, 29, 33, 35, 40];

// --- Objectif (téléporteur) ---------------------------------------------------------------------

export interface Goal {
  /** Nombre d'ingrédients requis, tirés au hasard parmi les 8 (`1e52:0271`). */
  ingredients: number;
  /** Points (gouttes de rosée) à avoir (`DS:19B9`). */
  points: number;
}

/**
 * Table `DS:19E0` (64 octets) : `GOAL_TABLE[indice de durée][nombre de joueurs − 1]`, entrées de 4 octets
 * (`u16 ingrédients`, `u8 points`, `u8 0`), lues par `1e52:0271` à `16 × (durée/1800 − 1) + 4 × (joueurs − 1)`.
 */
export const GOAL_TABLE: readonly (readonly Goal[])[] = [
  [
    { ingredients: 6, points: 20 },
    { ingredients: 4, points: 10 },
    { ingredients: 3, points: 10 },
    { ingredients: 2, points: 10 },
  ],
  [
    { ingredients: 7, points: 30 },
    { ingredients: 6, points: 20 },
    { ingredients: 5, points: 10 },
    { ingredients: 4, points: 10 },
  ],
  [
    { ingredients: 7, points: 40 },
    { ingredients: 6, points: 20 },
    { ingredients: 6, points: 20 },
    { ingredients: 5, points: 10 },
  ],
  [
    { ingredients: 7, points: 50 },
    { ingredients: 7, points: 30 },
    { ingredients: 6, points: 20 },
    { ingredients: 6, points: 20 },
  ],
];

// --- Personnages ----------------------------------------------------------------------------------

/** Nombre de personnages (S08 : 6 icônes, chacune choisie au plus une fois). */
export const CHARACTER_COUNT = 6;
/** Niveaux de difficulté 0 (le plus facile) à 2 (`DS:6EB6`, flèches haut/bas de S08, défaut 1). */
export const LEVEL_COUNT = 3;
export const DEFAULT_LEVEL = 1;
/** Icône S08 (sprites 4..9 de `s08a000s.hy8`) → personnage (`21ee:0435`, table `CS:21ee:0c05`). */
export const CHARACTER_BY_ICON: readonly number[] = [4, 0, 5, 2, 1, 3];
/** Personnage → numéro `S49_NN` du nom (`DS:1058`, 6 mots lus par `1823:0415`), noms de `S49A.DAT`. */
export const CHARACTER_TEXT_INDEX: readonly number[] = [0, 4, 5, 1, 2, 3];
export const CHARACTER_NAMES: readonly string[] = ["Costaud", "Poète", "Grognon", "Gourmand", "Farceur", "Bricoleur"];

// --- Temps ------------------------------------------------------------------------------------------

/** Au-delà de cette durée de tour, une action automatique est déclenchée en multijoueur (`slot 1 ≥ 0x24`). */
export const TURN_AUTO_SECONDS = 36;
/** Un piège « d'attente » se déclenche quand le tour dure depuis 16 s (`slot 1 ≥ 0x10`). */
export const DWELL_SECONDS = 16;
/** Indices vocaux d'inactivité (fenêtres du chrono du tour, `291e:0401`). */
export const HINT_WINDOWS: readonly [number, number][] = [
  [12, 22],
  [24, 34],
];
/** Avertissements du Grand Schtroumpf : à moins de 600 s (`s42a031..033`) puis de 300 s (`s42a034..035`) de la fin. */
export const WARNING_10_MIN_SECONDS = 0x259;
export const WARNING_5_MIN_SECONDS = 0x12d;

// --- Événements du plateau ----------------------------------------------------------------------

export type HazardKind = "trap" | "jail" | "turlusiphon" | "ice" | "bridge" | "rocket" | "wellDoor" | "wellFall";

export interface Position {
  screen: number;
  row: Row;
  x: number;
}

export type HazardEffect =
  /** Téléporte à un point fixe (pièges de Gargamel, S15) ; le tour continue. */
  | { kind: "teleport"; to: Position }
  /** Téléporte sur un écran tiré dans `screens` (puits S14, fusée S17, lac S18, pont S16) ; le tour continue. */
  | { kind: "randomTeleport"; screens: readonly number[]; counter?: "ice" | "bridge" }
  /** Prisonnier de Gargamel (S20) : le pion va en `x`, état 2, le tour se termine. */
  | { kind: "jail"; x: number }
  /** Pris au Turlusiphon (S21) : le pion va en `x`, état 4, le tour se termine. */
  | { kind: "turlusiphon"; x: number }
  /** Animation S13 devant le puits : le pion va en `x`, puis le tour se termine par le code 14. */
  | { kind: "well"; x: number };

/** Déclencheur d'un événement du plateau (voir rules.md §Événements du plateau). */
export interface Hazard {
  /** Scène d'animation jouée (S13..S21). */
  scene: number;
  kind: HazardKind;
  screen: number;
  row: Row;
  /** Se déclenche quand le pion marche dans cette plage de `x` (bornes incluses). */
  walk?: readonly [number, number];
  /** Se déclenche sur un appui du bouton (ou l'action automatique) dans cette plage. */
  press?: readonly [number, number];
  /** Se déclenche sur appui, ou quand le tour dure depuis `DWELL_SECONDS`, pion dans cette plage. */
  dwell?: readonly [number, number];
  /** Compté à chaque entrée dans cette plage ; se déclenche à la 5ᵉ (`counter > 4`). */
  counted?: readonly [number, number];
  /** Seulement si le puits est ouvert ce tour. */
  needsWell?: boolean;
  /** Seulement si le pion est libre (état 0). */
  needsFree?: boolean;
  effect: HazardEffect;
}

/** Plage d'appui du puits sur les écrans 4, 6 et 9, 2 (`2bd4:084c/0af9/0e9c/149c`). */
export const HAZARDS: readonly Hazard[] = [
  // Écran 2 (2bd4:084c) : le puits S14 envoie sur un autre écran.
  { scene: 14, kind: "wellFall", screen: 2, row: "top", press: [0xd5, 0x13a], effect: { kind: "randomTeleport", screens: [1, 3, 4, 5, 6, 7, 8, 9] } },
  // Écran 3 (2bd4:08e8) : prison, Turlusiphon.
  { scene: 20, kind: "jail", screen: 3, row: "bottom", dwell: [0x94, 0xc4], effect: { kind: "jail", x: 0xac } },
  { scene: 21, kind: "turlusiphon", screen: 3, row: "bottom", walk: [0x100, 0x112], press: [0xd5, 0x13a], needsFree: true, effect: { kind: "turlusiphon", x: 0x109 } },
  // Écran 4 (2bd4:0af9) : puits S13, piège, lac glacé.
  { scene: 13, kind: "wellDoor", screen: 4, row: "top", press: [0xd5, 0x13a], needsWell: true, effect: { kind: "well", x: 0x116 } },
  { scene: 15, kind: "trap", screen: 4, row: "bottom", walk: [0x95, 0xc5], effect: { kind: "teleport", to: { screen: 9, row: "top", x: 0x10 } } },
  { scene: 18, kind: "ice", screen: 4, row: "bottom", counted: [0xf0, 0x120], effect: { kind: "randomTeleport", screens: [5, 6, 7, 8, 9], counter: "ice" } },
  // Écran 5 (2bd4:0cbc) : Turlusiphon, deux pièges, prison.
  { scene: 21, kind: "turlusiphon", screen: 5, row: "top", walk: [0x9a, 0xac], press: [0x6c, 0xd3], needsFree: true, effect: { kind: "turlusiphon", x: 0xa3 } },
  { scene: 15, kind: "trap", screen: 5, row: "bottom", walk: [0x1e, 0x4e], effect: { kind: "teleport", to: { screen: 9, row: "bottom", x: 0xd4 } } },
  { scene: 15, kind: "trap", screen: 5, row: "bottom", walk: [0x7b, 0xab], effect: { kind: "teleport", to: { screen: 8, row: "bottom", x: 0xde } } },
  { scene: 20, kind: "jail", screen: 5, row: "bottom", dwell: [0xee, 0x11e], effect: { kind: "jail", x: 0x106 } },
  // Écran 6 (2bd4:0e9c) : puits S13, piège, fusée S17, Turlusiphon.
  { scene: 13, kind: "wellDoor", screen: 6, row: "top", press: [0x07, 0x6a], needsWell: true, effect: { kind: "well", x: 0x41 } },
  { scene: 15, kind: "trap", screen: 6, row: "top", walk: [0x91, 0xc1], effect: { kind: "teleport", to: { screen: 7, row: "bottom", x: 0x10 } } },
  { scene: 17, kind: "rocket", screen: 6, row: "bottom", press: [0x97, 0xc7], effect: { kind: "randomTeleport", screens: [1, 2, 3, 4, 5] } },
  { scene: 21, kind: "turlusiphon", screen: 6, row: "bottom", walk: [0x100, 0x112], press: [0xd5, 0x13a], needsFree: true, effect: { kind: "turlusiphon", x: 0x109 } },
  // Écran 7 (2bd4:10da) : prison, pont branlant S16.
  { scene: 20, kind: "jail", screen: 7, row: "top", dwell: [0x98, 0xc8], effect: { kind: "jail", x: 0xb0 } },
  { scene: 16, kind: "bridge", screen: 7, row: "bottom", counted: [0x76, 0xa5], effect: { kind: "randomTeleport", screens: [8, 9], counter: "bridge" } },
  // Écran 8 (2bd4:12e9) : trois pièges, prison.
  { scene: 15, kind: "trap", screen: 8, row: "top", walk: [0x3a, 0x6a], effect: { kind: "teleport", to: { screen: 7, row: "top", x: 0x10 } } },
  { scene: 15, kind: "trap", screen: 8, row: "top", walk: [0x85, 0xb5], effect: { kind: "teleport", to: { screen: 5, row: "top", x: 0x10 } } },
  { scene: 15, kind: "trap", screen: 8, row: "top", walk: [0xff, 0x12f], effect: { kind: "teleport", to: { screen: 3, row: "bottom", x: 0x75 } } },
  { scene: 20, kind: "jail", screen: 8, row: "bottom", dwell: [0x1c, 0x4c], effect: { kind: "jail", x: 0x34 } },
  // Écran 9 (2bd4:149c) : puits S13, prison.
  { scene: 13, kind: "wellDoor", screen: 9, row: "top", press: [0x07, 0x6a], needsWell: true, effect: { kind: "well", x: 0x36 } },
  { scene: 20, kind: "jail", screen: 9, row: "bottom", dwell: [0x22, 0x52], effect: { kind: "jail", x: 0x3a } },
];

/** Écran dont l'événement S14 exclut le départ (`2a78:015f`) : le puits de l'écran 2. */
export const WELL_S14_SCREEN = 2;

/**
 * Arrivée après une téléportation aléatoire (`2a78:13c1`, table `CS:2a78:15bd`, un cas par écran) : la rangée est
 * tirée au hasard parmi les entrées (basse d'abord : `rand × 2 == 0` donne `y = 0x84`), puis `x` parmi `xs`
 * (`[min, max]` = `0x10 + rand × 21 / 0x8000`, soit 0x10 à 0x24).
 */
export type ArrivalSpec = readonly { row: Row; xs: readonly (number | readonly [number, number])[] }[];
export const ARRIVALS: readonly ArrivalSpec[] = [
  /* 1 */ [{ row: "bottom", xs: [[0x10, 0x24]] }],
  /* 2 */ [{ row: "bottom", xs: [[0x10, 0x24]] }, { row: "top", xs: [0x75, 0x10] }],
  /* 3 */ [{ row: "bottom", xs: [0xde, 0x75] }, { row: "top", xs: [[0x10, 0x24]] }],
  /* 4 */ [{ row: "bottom", xs: [0x10] }, { row: "top", xs: [0x75] }],
  /* 5 */ [{ row: "bottom", xs: [0xde] }, { row: "top", xs: [0x10] }],
  /* 6 */ [{ row: "top", xs: [0x10c] }],
  /* 7 */ [{ row: "bottom", xs: [0xde, 0x10] }, { row: "top", xs: [0x75, 0x10] }],
  /* 8 */ [{ row: "bottom", xs: [0x10] }],
  /* 9 */ [{ row: "bottom", xs: [[0x10, 0x24]] }],
];

// --- Carte S02 et puits aux vœux ----------------------------------------------------------------

export interface MapLocation {
  /** Sélection de la carte (`1a3c:0225`, 2 à 18 ; 1 = retour). */
  k: number;
  scene: number;
  /** Case de la carte (`DS:15BA[k]`). */
  cell: number;
}

/** Les 17 lieux de la carte (`CS:1a3c:0203` et `DS:15BA`). */
export const MAP_LOCATIONS: readonly MapLocation[] = [
  { k: 2, scene: 23, cell: 4 },
  { k: 3, scene: 29, cell: 6 },
  { k: 4, scene: 35, cell: 7 },
  { k: 5, scene: 40, cell: 10 },
  { k: 6, scene: 33, cell: 11 },
  { k: 7, scene: 25, cell: 12 },
  { k: 8, scene: 26, cell: 13 },
  { k: 9, scene: 28, cell: 14 },
  { k: 10, scene: 24, cell: 15 },
  { k: 11, scene: 51, cell: 20 },
  { k: 12, scene: 34, cell: 22 },
  { k: 13, scene: 27, cell: 25 },
  { k: 14, scene: 30, cell: 33 },
  { k: 15, scene: 22, cell: 37 },
  { k: 16, scene: 32, cell: 40 },
  { k: 17, scene: 31, cell: 42 },
  { k: 18, scene: 36, cell: 53 },
];

/**
 * Cases de la carte S02 (`DS:1470`, 54 entrées de 6 octets `x, y, sprite`, cases 0 à 53) : position sur le fond
 * défilant (320 × ~500) et orientation du pion de la carte (3ᵉ colonne : hypothèse).
 */
export const MAP_CELLS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [87, 485, 1], [87, 485, 1], [87, 485, 1], [129, 455, 1], [129, 455, 1],
  [182, 449, 1], [279, 461, 1], [315, 434, 1], [315, 434, 1], [271, 418, 0], [179, 394, 0],
  [73, 372, 0], [104, 350, 1], [196, 330, 1], [247, 330, 0], [242, 308, 1], [242, 308, 1],
  [242, 308, 1], [242, 308, 1], [222, 292, 0], [161, 290, 1], [105, 263, 1], [123, 254, 0],
  [123, 254, 0], [203, 230, 1], [280, 236, 0], [280, 236, 0], [280, 236, 0], [280, 236, 0],
  [280, 236, 0], [280, 236, 0], [280, 236, 0], [317, 200, 1], [207, 190, 1], [207, 190, 1],
  [207, 190, 1], [143, 180, 0], [129, 170, 1], [129, 170, 1], [113, 160, 1], [138, 139, 0],
  [153, 111, 1], [219, 100, 0], [219, 100, 0], [219, 100, 0], [219, 100, 0], [219, 100, 0],
  [219, 100, 0], [219, 100, 0], [219, 100, 0], [219, 100, 0], [219, 100, 0], [273, 85, 1],
];

/**
 * Destinations du puits aux vœux, mode « voyage » (`2daf:0006`, table `CS:2daf:0aa8`) : le lieu `k` de la carte
 * (`k − 2`) téléporte le pion devant la porte de la scène correspondante, tourné vers la droite.
 * La 18ᵉ entrée de la table de l'exécutable (écran 8, magicien) est inaccessible : `k ≤ 18` (`1a3c:0225`).
 */
export const WISH_DESTINATIONS: readonly Position[] = [
  { screen: 1, row: "bottom", x: 0x1f },
  { screen: 1, row: "bottom", x: 0x120 },
  { screen: 2, row: "top", x: 0x1f },
  { screen: 2, row: "bottom", x: 0x1f },
  { screen: 2, row: "bottom", x: 0xa1 },
  { screen: 2, row: "bottom", x: 0x120 },
  { screen: 3, row: "top", x: 0x1f },
  { screen: 3, row: "top", x: 0xa1 },
  { screen: 3, row: "top", x: 0x120 },
  { screen: 4, row: "top", x: 0xa1 },
  { screen: 4, row: "bottom", x: 0x1f },
  { screen: 5, row: "top", x: 0x1f },
  { screen: 6, row: "top", x: 0x120 },
  { screen: 7, row: "top", x: 0x1f },
  { screen: 7, row: "bottom", x: 0x1f },
  { screen: 7, row: "bottom", x: 0x120 },
  { screen: 9, row: "bottom", x: 0xc9 },
];

/**
 * Destinations du Schtroumpf à lunettes (S38, `1fc6:0536..05b2`) : la vidéo `DI` de 9 à 24 (tirée par
 * `9 + rand × 17 / 0x8000`, 25 refusé) renvoie le joueur devant l'un de ces lieux.
 */
export const BESPECTACLED_DESTINATIONS: readonly Position[] = [
  { screen: 7, row: "top", x: 0x1f },
  { screen: 1, row: "bottom", x: 0x1f },
  { screen: 3, row: "top", x: 0x120 },
  { screen: 2, row: "bottom", x: 0x120 },
  { screen: 3, row: "top", x: 0x1f },
  { screen: 4, row: "top", x: 0xa1 },
  { screen: 3, row: "top", x: 0xa1 },
  { screen: 1, row: "bottom", x: 0x120 },
  { screen: 6, row: "top", x: 0x120 },
  { screen: 7, row: "bottom", x: 0x120 },
  { screen: 7, row: "bottom", x: 0x1f },
  { screen: 2, row: "bottom", x: 0xa1 },
  { screen: 4, row: "bottom", x: 0x1f },
  { screen: 2, row: "top", x: 0x1f },
  { screen: 9, row: "bottom", x: 0xc9 },
  { screen: 2, row: "bottom", x: 0x1f },
];
