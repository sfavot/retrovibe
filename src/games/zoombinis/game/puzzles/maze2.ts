import type { MsvcRandom } from "../../../../engine/mohawk/rng";
import type { Attrs } from "../state";

/**
 * Règles du gouffre des véhibules (`MAZE2.MHK`, écran 18 ; `docs/zoombinis/puzzles/maze2.md`) : fonctions pures sur le groupe et un `MsvcRandom`,
 * sans rendu ni texte. Adresses : `1118:xxxx` = module de l'épreuve, `1100:xxxx` = module d'aide (cases, collisions) ; `DS` = segment `1530`,
 * `S14` = segment `1450` (tampons de l'épreuve). Dans les appels `04e8(max, min)` de l'original, le tirage est `min + rand(max - min)` (`MsvcRandom.range`).
 *
 * Contenu :
 * 1. tables du code (rampes, falaises, sorties, traits) ;
 * 2. cartes `REGS 16600 + i` (`readMaze2Maps`) et choix de la carte par niveau et par visite (`chooseMaze2Map`) ;
 * 3. tirage des traits des panneaux d'après l'équipe, bit à bit (`generateTraits` : `67d3`, `6b4d`, `6f02`, `7532`, `7acf` et leurs outils) ;
 * 4. mise en place (`setupMaze2`, ordre des tirages de `1118:4ad2` puis `1118:4cf0`) ;
 * 5. simulation d'un lancer (`launchMaze2`, `advanceMaze2`, `settleMaze2`) : pas, panneaux, aiguillages, boutons, cases d'attente, tourbillons, collisions, arrivée ;
 * 6. fin (`maze2Outcome`) et robot (`planMaze2`).
 *
 * Temps : un « instant » est une image d'animation (le jeu en affiche une toutes les quelques ticks, valeur non extraite ; seul l'ordre compte).
 * Durées lues dans les scripts : un pas de case = 6 images (`SCRS 15015`…, 7 images, la dernière lance le pas suivant), réservation de la case
 * d'arrivée à la 4e (`+0xc8 = 3`), tourbillon `SCRS 14006` (26 images), rejet de collision `SCRS 14004` (6 images) après 6 images de gerbe
 * (`SCRB 10012` : événement `0x3e` à l'image 6), atterrissage `SCRB 10040` + `SCRS 14007` (7 images avant de quitter la liste en vol), premier pas à l'image 30
 * du script de rampe, rampe libérée à l'image 34 ou 35.
 */

// ---------------------------------------------------------------------------------------------------------------------
// 1. Tables du code
// ---------------------------------------------------------------------------------------------------------------------

/** Côté de la grille de cases (`13 × 13`, `S14:0d18` / `S14:0bc6` : 13 mots par ligne). */
export const MAZE2_SIZE = 13;
/** `REGS` des positions écran des 169 cases (paires `(x, y)`, indice `2 × (13 × ligne + colonne)`) ; `(0, 0)` hors du losange. */
export const MAZE2_CELL_POSITIONS_ID = 16000;
/** `REGS 16600 + i` : cartes de niveau, `i` de 0 à 9. */
export const MAZE2_MAP_BASE = 16600;
export const MAZE2_MAP_COUNT = 10;
/** Un Zoombini est dessiné à la position de sa case plus ce décalage (`1100:0b69`). */
export const MAZE2_SPRITE_OFFSET = { x: 4, y: -38 } as const;
/** Zoombinis dans la liste en vol au plus (`1118:2285` : refus si `[890e] ≥ 10`) ; un atterrissage ou un rejet les en retire (`1118:3263`, `1118:3784`). */
export const MAZE2_MAX_FLIGHTS = 10;

/** Types de case (`kind`, mot `+0x6c`). Les sorties valent `0x14` à `0x17`. */
export const Maze2Kind = { floor: 0, whirl: 1, panel: 2, arrow: 3, switch: 4, wait: 5, button: 6, exit: 0x14 } as const;

/** Directions : `0` colonne − 1, `1` ligne + 1, `2` colonne + 1, `3` ligne − 1 (`1100:0b69`). `[Δligne, Δcolonne]`. */
export const MAZE2_DIR_STEP: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Cases des sorties 0 à 3 (`S14:0344`, valeurs `S14:0320`) : `[ligne, colonne]`. La sortie 3 est la falaise à atteindre. */
export const MAZE2_EXITS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 10], [1, 10], [2, 10], [2, 11], [2, 12]],
  [[0, 2], [1, 2], [1, 1], [1, 0]],
  [[10, 12], [10, 11], [11, 11], [12, 10]],
  [[10, 0], [10, 1], [10, 2], [11, 2], [12, 3]],
];
export const MAZE2_GOAL_CLIFF = 3;

/** Rectangles de dépôt des falaises 0 à 3 (`S14:13d8`) : `[gauche, haut, droite, bas]`. */
export const MAZE2_CLIFF_RECTS: readonly (readonly [number, number, number, number])[] = [
  [0, 250, 300, 479],
  [0, 0, 200, 175],
  [450, 230, 639, 400],
  [400, 0, 639, 200],
];

export interface Maze2Ramp {
  /** Numéro 1 à 14 (celui des en-têtes de carte). */
  number: number;
  /** Point de dépôt (`S14:0038`). */
  drop: { x: number; y: number };
  /** Case de départ (`S14:02e8`). */
  start: { row: number; col: number };
  /** Direction du premier mouvement (`S14:00fe`). */
  dir: number;
  /** Classe de pose du Zoombini (`S14:011a`) ; miroir (`S14:00aa`) ; paramètre `+0xf1` (`S14:00e2`). */
  poseClass: number;
  mirror: number;
  param: number;
  /** `SCRB` de la rampe (`S14:028e`) et position de sa plaque (`S14:02b0`). */
  script: number;
  plaque: { x: number; y: number };
  /** Falaise dont le rectangle contient le point de dépôt (la glisser-déposer est limité au rectangle de la falaise du Zoombini). */
  cliff: number;
  /** Images écoulées avant que la rampe soit de nouveau libre (événement `0x42` / `0x56`). */
  freeAfter: number;
}

function ramp(
  number: number, dropX: number, dropY: number, row: number, col: number, dir: number, poseClass: number, mirror: number, param: number,
  script: number, plaqueX: number, plaqueY: number, cliff: number,
): Maze2Ramp {
  return {
    number, drop: { x: dropX, y: dropY }, start: { row, col }, dir, poseClass, mirror, param, script, plaque: { x: plaqueX, y: plaqueY }, cliff,
    freeAfter: script === 9000 ? 34 : 35,
  };
}

/** Les 14 rampes (tables `S14`, vérifiées sur l'exécutable). Aucune n'est sur la falaise 3. */
export const MAZE2_RAMPS: readonly Maze2Ramp[] = [
  ramp(1, 101, 283, 0, 9, 0, 0, 0, 0, 9000, 91, 295, 0),
  ramp(2, 148, 282, 1, 9, 0, 0, 0, 0, 9000, 138, 294, 0),
  ramp(3, 188, 280, 2, 9, 0, 0, 0, 0, 9000, 178, 292, 0),
  ramp(4, 195, 275, 4, 10, 1, 1, 0, 2, 9001, 185, 287, 0),
  ramp(5, 203, 297, 4, 11, 1, 1, 0, 2, 9001, 193, 309, 0),
  ramp(6, 210, 316, 4, 12, 1, 1, 0, 2, 9001, 201, 328, 0),
  ramp(7, 95, 65, 3, 0, 1, 1, 0, 2, 9001, 85, 77, 1),
  ramp(8, 100, 81, 3, 1, 1, 1, 0, 2, 9001, 90, 93, 1),
  ramp(9, 104, 96, 3, 2, 1, 1, 0, 2, 9001, 94, 108, 1),
  ramp(10, 622, 271, 12, 10, 0, 0, 0, 0, 9000, 612, 283, 2),
  ramp(11, 576, 288, 11, 10, 0, 0, 0, 0, 9000, 576, 300, 2),
  ramp(12, 545, 287, 10, 10, 0, 0, 0, 0, 9000, 535, 299, 2),
  ramp(13, 543, 286, 8, 11, 3, 2, 1, 2, 9003, 533, 298, 2),
  ramp(14, 554, 308, 8, 12, 3, 2, 1, 2, 9003, 544, 320, 2),
];

/** `DS:18f0` : décalage de l'indice de trait par attribut. Un trait `k` (1 à 20) est le couple (attribut `⌊(k−1)/5⌋`, valeur `(k−1) mod 5 + 1`). */
const ATTR_OFFSET = [0, 5, 10, 15] as const;
/** `S14:13f8` : attribut (1 à 4) du trait `k`, 0 pour `k = 0` (la case 20 est lue au-delà de la table de `65b9`, valeur 4 dans le fichier). */
const TRAIT_GROUP = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4] as const;
/** `DS:18f8` : ⌈r / 2⌉. */
const HALF_UP = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8] as const;
/** `DS:193c` : taille de groupe visée pour `r` membres restants (`7acf`). */
const GROUP_SIZE = [1, 1, 1, 1, 4, 4, 4, 7, 7, 7, 10, 10, 10, 13, 13, 13, 16] as const;

/** Attribut (0 à 3) et valeur (1 à 5) d'un trait `k` ; le trait 0 ne correspond jamais (`DS:189c`, `k = 0` → `(0, 0)`). */
export function traitAttr(k: number): number {
  return k > 0 ? Math.trunc((k - 1) / 5) : 0;
}
export function traitValue(k: number): number {
  return k > 0 ? ((k - 1) % 5) + 1 : 0;
}
export function traitIndex(attr: number, value: number): number {
  return 5 * attr + value;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Cartes
// ---------------------------------------------------------------------------------------------------------------------

/** Un enregistrement de carte (10 mots, `1118:4cf0`). */
export interface Maze2Record {
  kind: number;
  row: number;
  col: number;
  /** 0 pour un tourbillon ; 1 pour panneau / flèche ; 1 à 8 pour aiguillage à bouton, bouton, case d'attente : lien entre eux. */
  type: number;
  /** Directions autorisées `f1..f4` (1 = la direction `d` peut être prise). */
  dirs: readonly number[];
  /** Direction courante `g` (panneau : direction du panneau ; flèche : direction d'envoi). */
  dir: number;
  /** Aiguillage tournant : `g` passe à la direction suivante à chaque passage. */
  rotates: boolean;
}

/** Une carte de niveau (`REGS 16600 + index`) : mot 0 `n`, mots 1 à 9 rampes actives (0 = vide), puis `n` enregistrements de 10 mots. */
export interface Maze2Map {
  index: number;
  /** Numéros (1 à 14) des rampes actives. */
  ramps: number[];
  records: Maze2Record[];
}

export function parseMaze2Map(index: number, words: ArrayLike<number>): Maze2Map {
  const count = words[0] ?? 0;
  if (count < 0 || words.length < 10 + 10 * count) throw new Error(`Maze2 : carte ${index} tronquée (${words.length} mots pour ${count} enregistrements)`);
  const ramps: number[] = [];
  for (let i = 1; i < 10; i++) if (words[i] !== 0) ramps.push(words[i]!);
  const records: Maze2Record[] = [];
  for (let j = 0; j < count; j++) {
    const o = 10 + 10 * j;
    records.push({
      kind: words[o]!,
      row: words[o + 1]!,
      col: words[o + 2]!,
      type: words[o + 3]!,
      dirs: [words[o + 4]!, words[o + 5]!, words[o + 6]!, words[o + 7]!],
      dir: words[o + 8]!,
      rotates: words[o + 9] !== 0,
    });
  }
  return { index, ramps, records };
}

/** Lit les 10 cartes ; `regs(id)` renvoie le `REGS` décodé (`parseRegs`) de `MAZE2.MHK`. */
export function readMaze2Maps(regs: (id: number) => ArrayLike<number>): Maze2Map[] {
  return Array.from({ length: MAZE2_MAP_COUNT }, (_, i) => parseMaze2Map(i, regs(MAZE2_MAP_BASE + i)));
}

/** Position écran de la case `(ligne, colonne)` (`REGS 16000`) ; `(0, 0)` pour une case hors du losange. */
export function maze2CellPosition(positions: ArrayLike<number>, row: number, col: number): { x: number; y: number } {
  const i = 2 * (MAZE2_SIZE * row + col);
  return { x: positions[i] ?? 0, y: positions[i + 1] ?? 0 };
}

/** Position écran d'un Zoombini dans une case. */
export function maze2ZoombiniPosition(positions: ArrayLike<number>, row: number, col: number): { x: number; y: number } {
  const p = maze2CellPosition(positions, row, col);
  return { x: p.x + MAZE2_SPRITE_OFFSET.x, y: p.y + MAZE2_SPRITE_OFFSET.y };
}

export type Maze2Generator = "67d3" | "6b4d" | "6f02" | "7532" | "7acf";

/**
 * Compteurs d'alternance (`DS:177a`, `177c`, `177e`, `1780`) : variables initiales à 0 qui **persistent entre deux visites** de l'épreuve dans la même session
 * (jamais écrites ailleurs que par `1118:4ad2` ; aucune sauvegarde de partie). `level3` vaut 0 ou 2.
 */
export interface Maze2Rotation {
  level0: number;
  level1: number;
  level2: number;
  level3: number;
}

export function newMaze2Rotation(): Maze2Rotation {
  return { level0: 0, level1: 0, level2: 0, level3: 0 };
}

/** Niveau de l'épreuve : le niveau 3 devient 4 pour une équipe de moins de 5 Zoombinis (`1118:05ab`). */
export function maze2Level(level: number, teamSize: number): number {
  return level === 3 && teamSize < 5 ? 4 : level;
}

export interface Maze2MapChoice {
  /** Indice 0 à 9 de la carte (`REGS 16600 + indice`). */
  mapIndex: number;
  generator: Maze2Generator;
  /** Valeur du compteur utilisée (`DS:1778`) : le générateur `6f02` la lit (`= 1` au niveau 1). */
  slot: number;
}

/**
 * `1118:4a3e` + `1118:4ad2` : carte et générateur du niveau (0 à 4), puis avance le compteur (modulo 2 aux niveaux 0 à 2, 0 / 2 au niveau 3 ; le niveau 4
 * ne touche à aucun compteur). Niveau 0 : `16600`, `16601` (`67d3`) ; 1 : `16602` (`6b4d`), `16603` (`6f02`) ; 2 : `16604` (`6f02`), `16605` (`7532`) ;
 * 3 : `16606`, `16608` (`7acf`) ; 4 : `16609` (`7532`).
 */
export function chooseMaze2Map(level: number, rotation: Maze2Rotation): Maze2MapChoice {
  switch (level) {
    case 0: {
      const slot = rotation.level0;
      rotation.level0 = rotation.level0 + 1 > 1 ? 0 : rotation.level0 + 1;
      return { mapIndex: slot, generator: "67d3", slot };
    }
    case 1: {
      const slot = rotation.level1;
      rotation.level1 = rotation.level1 + 1 > 1 ? 0 : rotation.level1 + 1;
      return { mapIndex: 2 + slot, generator: slot === 0 ? "6b4d" : "6f02", slot };
    }
    case 2: {
      const slot = rotation.level2;
      rotation.level2 = rotation.level2 + 1 > 1 ? 0 : rotation.level2 + 1;
      return { mapIndex: 4 + slot, generator: slot === 0 ? "6f02" : "7532", slot };
    }
    case 3: {
      const slot = rotation.level3;
      rotation.level3 = rotation.level3 + 2 > 2 ? 0 : rotation.level3 + 2;
      return { mapIndex: 6 + slot, generator: "7acf", slot };
    }
    case 4:
      return { mapIndex: 9, generator: "7532", slot: 0 };
    default:
      throw new Error(`Maze2 : niveau ${level} inconnu`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Tirage des traits des panneaux (bit à bit)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * État commun des générateurs : copie de travail de l'équipe (`S14:056c`, 4 mots par membre, 0 = retiré), histogramme des traits (`S14:06ac`),
 * traits déjà utilisés par des panneaux (`S14:0e6a`, `S14:0f0a`, compteur `DS:893a`), listes de traits absents (`S14:072a`, `S14:0700`) et résultat (`S14:07a8`).
 * Chaque méthode porte l'adresse de la fonction de l'original ; les boucles en reprennent l'ordre et les bornes.
 */
class TraitState {
  readonly n: number;
  /** `S14:056c`. */
  readonly team: number[][];
  /** `S14:06ac` : `h[k]` = membres restants portant le trait `k` (0 à 20). */
  readonly h = new Array<number>(21).fill(0);
  /** `S14:0e6a` (une valeur par attribut) et `S14:0f0a` (ligne entière) : 20 lignes de 4 mots. */
  readonly usedAttr: number[][] = Array.from({ length: 20 }, () => [0, 0, 0, 0]);
  readonly usedRow: number[][] = Array.from({ length: 20 }, () => [0, 0, 0, 0]);
  /** `DS:893a`. */
  usedCount = 0;
  /** `S14:072a` (traits absents de l'équipe, rang 1 à `absentCount`), `DS:8930`, `DS:8932`. */
  absent = new Array<number>(21).fill(0);
  absentCount = 0;
  absentMin = 0;
  /** `S14:0700` (liste creuse : `k` si `h[k] = 0`), `DS:8934`, `DS:8936`. La liste compacte `S14:0754` n'est jamais relue. */
  sparse = new Array<number>(21).fill(0);
  sparseCount = 0;
  sparseMin = 0;
  /** `S14:07a8` (10 mots) et `DS:8928`. */
  readonly traits = new Array<number>(10).fill(0);
  idx = 0;

  constructor(private readonly rng: MsvcRandom, private readonly members: readonly Attrs[]) {
    this.n = members.length;
    this.team = members.map(() => [0, 0, 0, 0]);
  }

  /** `10a8:04e8(max, min)`. */
  rand(max: number, min: number): number {
    return min + this.rng.rand(max - min);
  }

  /** `1118:5206` : recopie l'équipe entière. */
  resetTeam(): void {
    for (let m = 0; m < this.n; m++) for (let a = 0; a < 4; a++) this.team[m]![a] = this.members[m]![a]!;
  }

  /** `1118:52a6(p)` : ne garde que les membres portant le trait `p`. */
  keepCarriers(p: number): number {
    for (let m = 0; m < this.n; m++) this.team[m]!.fill(0);
    let kept = 0;
    for (let m = 0; m < this.n; m++) {
      let carries = false;
      for (let a = 0; a < 4; a++) if (ATTR_OFFSET[a]! + this.members[m]![a]! === p) carries = true;
      if (carries) {
        for (let a = 0; a < 4; a++) this.team[m]![a] = this.members[m]![a]!;
        kept++;
      }
    }
    return kept;
  }

  /** `1118:5390(p)` : retire les membres portant `p` (si `p ≠ 0`), recompte l'histogramme, renvoie le nombre de membres restants. */
  remove(p: number): number {
    this.h.fill(0);
    let left = 0;
    for (let m = 0; m < this.n; m++) {
      const row = this.team[m]!;
      let keep = true;
      for (let a = 0; a < 4; a++) {
        if (row[a] !== 0 && row[a]! + ATTR_OFFSET[a]! === p && p !== 0) {
          keep = false;
          row.fill(0);
          break;
        }
      }
      if (keep) {
        for (let a = 0; a < 4; a++) {
          if (row[a] === 0) {
            keep = false;
            break;
          }
          this.h[row[a]! + ATTR_OFFSET[a]!] += 1;
        }
      }
      if (keep) left++;
    }
    return left;
  }

  /** `1118:6645` + `1118:6688` : liste des traits que personne ne porte ; renvoie leur nombre. */
  buildAbsent(): number {
    this.absent.fill(0);
    const sparse = new Array<number>(21).fill(0);
    for (let k = 0; k < 21; k++) if (this.h[k] === 0) sparse[k] = k;
    this.absentMin = 0;
    this.absentCount = 0;
    for (let k = 0; k < 21; k++) {
      if (sparse[k] !== 0) {
        this.absentMin = 1;
        this.absentCount++;
        this.absent[this.absentCount] = sparse[k]!;
      }
    }
    return this.absentCount;
  }

  /** `1118:67a7` : liste vide → les 20 traits. */
  fillAbsent(): void {
    for (let k = 0; k < 21; k++) this.absent[k] = k;
    this.absentCount = 20;
    this.absentMin = 1;
  }

  /** `1118:66f6` + `1118:6739` : liste creuse `S14:0700` et ses bornes (la liste compacte `S14:0754` construite par l'original n'est jamais relue). */
  buildSparse(): void {
    this.sparse.fill(0);
    for (let k = 0; k < 21; k++) if (this.h[k] === 0) this.sparse[k] = k;
    this.sparseMin = 0;
    this.sparseCount = 0;
    for (let k = 0; k < 21; k++) {
      if (this.sparse[k] !== 0) {
        this.sparseMin = 1;
        this.sparseCount++;
      }
    }
  }

  /** `S14:072a[rand(8930, 8932)]`. */
  drawAbsent(): number {
    return this.absent[this.rand(this.absentCount, this.absentMin)]!;
  }

  /** `S14:0700[rand(8934, 8936)]` : **défaut de l'original** (relit la liste creuse et non la compacte) ; peut renvoyer 0. */
  drawSparse(): number {
    return this.sparse[this.rand(this.sparseCount, this.sparseMin)]!;
  }

  /** `S14:0700` d'abord, puis `S14:072a` si 0 (repli de `6f02` / `7532`). */
  drawSparseOrAbsent(): number {
    const v = this.drawSparse();
    return v === 0 ? this.drawAbsent() : v;
  }

  /** `1118:658e` : nombre de traits portés par au moins un membre restant. */
  traitCount(): number {
    let c = 0;
    for (let k = 1; k < 21; k++) if (this.h[k] !== 0) c++;
    return c;
  }

  /** `1118:5e24(max, min)` : trait le plus porté (premier en cas d'égalité) parmi ceux dont `h` est dans `[min, max]`, 0 sinon. */
  pickMid(max: number, min: number): number {
    let best = 0;
    let bestH = 0;
    for (let k = 1; k < 21; k++) {
      if (min <= this.h[k]! && this.h[k]! <= max && bestH < this.h[k]!) {
        bestH = this.h[k]!;
        best = k;
      }
    }
    return best;
  }

  /** `1118:559d(ex)` : trait le plus porté hors `ex`. */
  pickMax(ex: number): number {
    let best = 0;
    let bestH = 0;
    for (let k = 1; k < 21; k++) {
      if (bestH < this.h[k]! && ex !== k) {
        bestH = this.h[k]!;
        best = k;
      }
    }
    return best;
  }

  /** `1118:65b9(max, min, ref)` : comme `pickMid` mais limité à l'attribut de `ref`, `k < 20`. */
  pickSameAttr(max: number, min: number, ref: number): number {
    let best = 0;
    let bestH = 0;
    for (let k = 1; k < 20; k++) {
      if (TRAIT_GROUP[k] === TRAIT_GROUP[ref]! && min <= this.h[k]! && this.h[k]! <= max && bestH < this.h[k]!) {
        bestH = this.h[k]!;
        best = k;
      }
    }
    return best;
  }

  private recount(): void {
    this.h.fill(0);
    for (let m = 0; m < this.n; m++) {
      const row = this.team[m]!;
      if (row[0]! > 0) for (let a = 0; a < 4; a++) this.h[row[a]! + ATTR_OFFSET[a]!] += 1;
    }
  }

  /**
   * `1118:5643(mode, ex)` : trait **peu porté** (plus petit `h > 0`, le dernier en cas d'égalité car la comparaison est `≤`) hors `ex` dont un membre n'a
   * aucune de ses 4 valeurs déjà utilisée (tant que `usedCount < 3`) ; retire **ce seul membre**, l'enregistre (mode 0 : seule la valeur de l'attribut du trait
   * dans `0e6a`, ligne entière dans `0f0a` ; sinon ligne entière dans les deux) et recompte.
   */
  pickRare(mode: number, ex: number): number {
    let best = 0;
    let bestAttr = 0;
    let bestMember = -1;
    let bestH = 21;
    for (let k = 1; k < 21; k++) {
      if (!(this.h[k]! > 0 && this.h[k]! <= bestH && ex !== k)) continue;
      for (let m = 0; m < this.n; m++) {
        const row = this.team[m]!;
        let found = false;
        for (let a = 0; a < 4; a++) {
          if (row[a]! > 0 && row[a]! + ATTR_OFFSET[a]! === k) {
            let ok = true;
            for (let w = 0; w < 20 && this.usedCount < 3; w++) {
              for (let b = 0; b < 4; b++) if (this.usedAttr[w]![b]! >= 1 && this.usedAttr[w]![b] === row[b]) ok = false;
            }
            if (ok) {
              best = k;
              bestAttr = a;
              bestH = this.h[k]!;
              bestMember = m;
              found = true;
            }
            break;
          }
        }
        if (found) break;
      }
    }
    if (best !== 0) {
      const row = this.team[bestMember]!;
      if (this.usedCount < 4) {
        if (mode === 0) {
          this.usedAttr[this.usedCount]![bestAttr] = row[bestAttr]!;
          for (let a = 0; a < 4; a++) this.usedRow[this.usedCount]![a] = row[a]!;
        } else {
          for (let a = 0; a < 4; a++) {
            this.usedRow[this.usedCount]![a] = row[a]!;
            this.usedAttr[this.usedCount]![a] = row[a]!;
          }
        }
        this.usedCount++;
      }
      row.fill(0);
      this.recount();
    }
    return best;
  }

  /**
   * `1118:5ad6(ex)` : comme `pickRare` (trait de plus petit `h > 0`, dernier en cas d'égalité) mais l'unique test porte sur la valeur de l'attribut du trait
   * (`usedAttr[w][a]`, tant que `usedCount < 4`) ; enregistre la ligne du membre dans `0e6a` (si `usedCount < 20`), retire **tous** les porteurs, recompte.
   */
  pickUnused(ex: number): number {
    let best = 0;
    let bestMember = -1;
    let bestH = 21;
    for (let k = 1; k < 21; k++) {
      if (!(this.h[k]! > 0 && this.h[k]! <= bestH && ex !== k)) continue;
      for (let m = 0; m < this.n; m++) {
        const row = this.team[m]!;
        let found = false;
        for (let a = 0; a < 4; a++) {
          if (row[a]! > 0 && row[a]! + ATTR_OFFSET[a]! === k) {
            let ok = true;
            for (let w = 0; w < 20 && this.usedCount < 4; w++) if (this.usedAttr[w]![a]! > 0 && this.usedAttr[w]![a] === row[a]) ok = false;
            if (ok) {
              best = k;
              bestH = this.h[k]!;
              bestMember = m;
              found = true;
            }
            break;
          }
        }
        if (found) break;
      }
    }
    if (best !== 0) {
      this.h.fill(0);
      if (this.usedCount < 20) {
        for (let a = 0; a < 4; a++) this.usedAttr[this.usedCount]![a] = this.team[bestMember]![a]!;
        this.usedCount++;
      }
      for (let m = 0; m < this.n; m++) {
        const row = this.team[m]!;
        for (let a = 0; a < 4; a++) {
          if (row[a] !== 0 && row[a]! + ATTR_OFFSET[a]! === best) {
            row.fill(0);
            break;
          }
        }
        if (row[0]! > 0) for (let a = 0; a < 4; a++) this.h[row[a]! + ATTR_OFFSET[a]!] += 1;
      }
    }
    return best;
  }

  /**
   * `1118:5e8f(max, min)` (`rows = false`) et `1118:61fd(max, min)` (`rows = true`) : trait le plus porté (premier) dont `h ∈ [min, max]` et dont un membre
   * passe le test des valeurs déjà utilisées (`5e8f` : valeur de l'attribut du trait dans `0e6a` ; `61fd` : n'importe quelle valeur dans `0f0a`) ; retire
   * **tous** les porteurs en les enregistrant (si `usedCount < 20` ; `5e8f` dans `0f0a` et `0e6a`, `61fd` dans `0f0a` seul) et recompte.
   */
  pickGroup(max: number, min: number, rows: boolean): number {
    let best = 0;
    let bestH = 0;
    for (let k = 1; k < 21; k++) {
      if (!(bestH < this.h[k]! && min <= this.h[k]! && this.h[k]! <= max)) continue;
      for (let m = 0; m < this.n; m++) {
        const row = this.team[m]!;
        let found = false;
        for (let a = 0; a < 4; a++) {
          if (row[a]! > 0 && row[a]! + ATTR_OFFSET[a]! === k) {
            let ok = true;
            for (let w = 0; w < 20; w++) {
              if (rows) {
                for (let b = 0; b < 4; b++) if (this.usedRow[w]![b]! >= 1 && this.usedRow[w]![b] === row[b]) ok = false;
              } else if (this.usedAttr[w]![a]! > 0 && this.usedAttr[w]![a] === row[a]) ok = false;
            }
            if (ok) {
              best = k;
              bestH = this.h[k]!;
              found = true;
            }
            break;
          }
        }
        if (found) break;
      }
    }
    if (best !== 0) {
      this.h.fill(0);
      for (let m = 0; m < this.n; m++) {
        const row = this.team[m]!;
        for (let a = 0; a < 4; a++) {
          if (row[a] !== 0 && row[a]! + ATTR_OFFSET[a]! === best) {
            if (this.usedCount < 20) {
              for (let b = 0; b < 4; b++) {
                this.usedRow[this.usedCount]![b] = row[b]!;
                if (!rows) this.usedAttr[this.usedCount]![b] = row[b]!;
              }
              this.usedCount++;
            }
            row.fill(0);
            break;
          }
        }
        if (row[0]! > 0) for (let a = 0; a < 4; a++) this.h[row[a]! + ATTR_OFFSET[a]!] += 1;
      }
    }
    return best;
  }

  /** Début commun des cinq générateurs : `5206`, `5390(0)`, liste des traits absents (tous les traits si elle est vide). Renvoie le nombre de membres. */
  begin(): number {
    this.idx = 0;
    this.resetTeam();
    const n = this.remove(0);
    if (this.buildAbsent() === 0) this.fillAbsent();
    return n;
  }

  /** Premier trait de `67d3`, `6b4d` et `6f02` (même suite de tentatives), repli sur un trait absent. */
  firstTrait(n: number): number {
    let v: number;
    if (n < 3) v = this.pickMid(2, 1);
    else {
      v = this.pickMid(5, 2);
      if (v === 0) v = this.pickMid(9, 6);
      if (v === 0) v = this.pickMid(16, 10);
      if (v === 0) v = this.pickMid(16, 1);
    }
    return v === 0 ? this.drawAbsent() : v;
  }

  /** `T[idx] ← v ; idx++`. */
  push(v: number): void {
    this.traits[this.idx++] = v;
  }

  /** Échange `T[idx − 1]` et `T[idx]` (le plus rare passe en second). */
  swapLast(): void {
    const t = this.traits[this.idx - 1]!;
    this.traits[this.idx - 1] = this.traits[this.idx]!;
    this.traits[this.idx] = t;
  }

  /**
   * Fin commune de `67d3`, `6b4d`, `6f02` et `7532` : deux derniers panneaux. Avec moins de 5 traits portés, `fewTraits` donne les deux tirages ; sinon un trait
   * assez porté (`5e24(⌈restants/2⌉, 1)`) puis un trait du même attribut (`65b9`), échangés si le second est plus porté que le premier ; `fallback` donne le
   * repli d'un trait nul.
   */
  tail(left: number, fallback: () => number): void {
    const half = HALF_UP[left]!;
    let first = this.pickMid(half, 1);
    let firstH: number;
    if (first === 0) {
      first = fallback();
      firstH = 0;
    } else firstH = this.h[first]!;
    this.traits[this.idx] = first;
    this.remove(first);
    this.idx++;
    let second = this.pickSameAttr(half, 1, this.traits[this.idx - 1]!);
    let secondH: number;
    if (second === 0) {
      second = fallback();
      secondH = 0;
    } else secondH = this.h[second]!;
    this.traits[this.idx] = second;
    if (secondH < firstH) this.swapLast();
  }
}

/**
 * Tire les traits `k` des panneaux (`S14:07a8`, consommés dans l'ordre des enregistrements `kind 2` de la carte). `team` = attributs des membres du groupe
 * dans l'ordre de `1168:365d` (ordre des objets Zoombini) ; `level` = niveau de l'épreuve (0 à 4) ; `slot` = compteur d'alternance utilisé (`DS:1778`).
 * Renvoie autant de traits que d'écritures de l'original : 4 (`67d3`), 5 (`6b4d`), 8 ou 7 (`6f02` aux niveaux 1 et 2), 8 (`7532`), 9 (`7acf`).
 * L'ordre des appels au hasard est celui de l'original.
 */
export function generateTraits(rng: MsvcRandom, team: readonly Attrs[], level: number, generator: Maze2Generator, slot: number): number[] {
  const s = new TraitState(rng, team);
  switch (generator) {
    case "67d3": // niveau 0, 4 panneaux : deux panneaux jumeaux, puis deux traits plus rares
      traits67d3(s);
      break;
    case "6b4d": // niveau 1 (1re carte), 5 panneaux : trois jumeaux, puis deux
      traits6b4d(s);
      break;
    case "6f02":
      traits6f02(s, level, slot);
      break;
    case "7532":
      traits7532(s);
      break;
    case "7acf":
      traits7acf(s);
      break;
  }
  return s.traits.slice(0, s.idx);
}

/** `1118:67d3`. (Le test `DS:1778 = 2` qui duplique un panneau de plus n'est jamais vrai ici : la valeur est 0 ou 1.) */
function traits67d3(s: TraitState): void {
  const n = s.begin();
  const t0 = s.firstTrait(n);
  s.traits[0] = t0;
  s.traits[1] = t0;
  s.idx = 1;
  const left = s.remove(s.traits[s.idx]!);
  s.idx++;
  if (s.traitCount() < 5) {
    s.push(s.drawAbsent());
    s.traits[s.idx] = s.drawAbsent();
  } else s.tail(left, () => s.drawAbsent());
  s.idx++;
}

/** `1118:6b4d`. */
function traits6b4d(s: TraitState): void {
  const n = s.begin();
  const t0 = s.firstTrait(n);
  s.traits[0] = t0;
  s.traits[1] = t0;
  s.traits[2] = t0;
  s.idx = 2;
  const left = s.remove(s.traits[s.idx]!);
  s.idx++;
  if (s.traitCount() < 5) {
    let first = s.pickMax(0);
    let firstH: number;
    if (first === 0) {
      first = s.drawAbsent();
      firstH = 0;
    } else firstH = s.h[first]!;
    s.push(first);
    s.traits[s.idx] = s.drawAbsent();
    if (0 < firstH) s.swapLast();
  } else s.tail(left, () => s.drawAbsent());
  s.idx++;
}

/** `1118:6f02` (niveaux 1 et 2) : un trait de l'équipe entière, puis des traits peu portés parmi ses porteurs. */
function traits6f02(s: TraitState, level: number, slot: number): void {
  const n = s.begin();
  const t0 = s.firstTrait(n);
  s.traits[0] = t0;
  s.traits[1] = t0;
  s.keepCarriers(t0);
  s.idx = 2;
  s.remove(0);
  s.buildSparse();
  const unused = () => {
    const v = s.pickUnused(s.traits[0]!);
    return v === 0 ? s.drawSparseOrAbsent() : v;
  };
  s.push(unused());
  if (level === 1) {
    s.traits[s.idx] = s.traits[s.idx - 1]!;
    s.idx++;
  }
  s.push(unused());
  s.traits[s.idx] = unused();
  s.resetTeam();
  const left = s.remove(s.traits[0]!);
  s.idx++;
  if (s.traitCount() < 5) {
    if (slot === 1) {
      let v = s.pickMax(0);
      if (v === 0) v = s.drawAbsent();
      s.push(v);
      s.traits[s.idx] = s.drawAbsent();
    } else {
      s.push(s.drawAbsent());
      let v = s.pickMax(0);
      if (v === 0) v = s.drawAbsent();
      s.traits[s.idx] = v;
    }
  } else s.tail(left, () => s.drawAbsent());
  s.idx++;
}

/** `1118:7532` (niveau 2 en alternance, niveau 4). */
function traits7532(s: TraitState): void {
  const n = s.begin();
  const first = s.pickUnused(s.traits[0]!);
  let t0: number;
  if (n < 2) t0 = s.pickGroup(1, 1, false);
  else {
    t0 = s.pickGroup(4, 2, false);
    if (t0 === 0) t0 = s.pickGroup(8, 5, false);
    if (t0 === 0) t0 = s.pickGroup(12, 9, false);
    if (t0 === 0) t0 = s.pickGroup(16, 1, false);
  }
  if (t0 === 0) t0 = s.drawAbsent();
  s.traits[0] = t0;
  s.traits[1] = t0;
  s.keepCarriers(t0);
  s.idx = 2;
  s.remove(0);
  s.buildSparse();
  s.push(first);
  s.push(first);
  const unused = () => {
    const v = s.pickUnused(s.traits[0]!);
    return v === 0 ? s.drawSparseOrAbsent() : v;
  };
  s.push(unused());
  s.push(unused());
  s.resetTeam();
  s.remove(s.traits[0]!);
  const left = s.remove(first);
  s.buildSparse();
  if (s.traitCount() < 5) {
    s.push(s.drawSparse());
    let v = s.pickMax(0);
    if (v === 0) v = s.drawSparse();
    s.traits[s.idx] = v;
  } else s.tail(left, () => s.drawSparseOrAbsent());
  s.idx++;
}

/** `1118:7acf` (niveau 3) : trois traits de membres peu communs, un quatrième tenu en réserve, des groupes entiers retirés, puis deux traits de l'équipe restante et deux traits au hasard. */
function traits7acf(s: TraitState): void {
  s.begin();
  const rare = () => {
    const v = s.pickRare(0, 0);
    return v === 0 ? s.drawAbsent() : v;
  };
  s.push(rare());
  s.push(rare());
  s.push(rare());
  const reserve = rare();
  s.remove(s.traits[0]!);
  s.remove(s.traits[1]!);
  const left = s.remove(s.traits[2]!);
  const target = GROUP_SIZE[left]!;
  let counter = 0;
  let remaining = 0;
  while (counter < target) {
    if (counter === 0) {
      let v = s.pickGroup(1, 1, false);
      s.traits[s.idx] = v;
      if (v === 0) {
        v = s.traits[s.rand(2, 0)]!;
        s.traits[s.idx] = v;
      }
      const e = s.h[v]!;
      s.remove(v);
      s.idx++;
      counter = e;
      remaining = target - e;
    } else if (remaining !== 0) {
      let v = s.pickGroup(remaining, 1, false);
      if (v === 0) v = s.drawAbsent();
      const e = s.h[v]!;
      s.remove(v);
      counter += e;
      remaining = target - counter;
    }
    counter++;
  }
  s.push(reserve);
  s.resetTeam();
  s.remove(0);
  const absent = s.buildAbsent();
  if (absent === 0) s.fillAbsent();
  s.remove(reserve);
  for (let i = 0; i < 2; i++) {
    let v = s.pickGroup(3, 1, true);
    if (v === 0) v = absent === 0 ? s.traits[0]! : s.drawAbsent();
    s.traits[s.idx] = v;
    s.remove(v);
    s.idx++;
  }
  s.push(s.rand(20, 1));
  s.push(s.rand(20, 1));
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Mise en place
// ---------------------------------------------------------------------------------------------------------------------

/** Jeux de sprites des cases par type : `[8972..]` (`DS:1886`) ; le type 1 (et le type 0 des tourbillons) prend 31, les types 2 à 8 les bases ci-dessous dans un ordre tiré. */
const SPRITE_BASES = [0, 31, 52, 73, 94, 115, 136, 157, 178, 0, 0] as const;

/**
 * `1118:4ad2` (début) : base d'images de `tBMP 5100` de chaque type de case (indice 1 à 8 ; l'indice 0 n'est pas utilisé). Les types 2 à 8 reçoivent
 * {52, 73, 94, 115, 136, 157, 178} sans remise (`rand(local_a, 2)` avec `local_a` de 8 à 2, 7 tirages).
 */
export function pickSpriteBases(rng: MsvcRandom): number[] {
  const pool: number[] = [...SPRITE_BASES];
  const bases = [0, pool[1]!];
  let top = 8;
  for (let type = 2; type < 9; type++) {
    const pick = 2 + rng.rand(top - 2);
    bases[type] = pool[pick]!;
    for (let k = pick; k < top + 1; k++) pool[k] = pool[k + 1]!;
    top--;
  }
  return bases;
}

/** Un objet de case (`11a8:0ad6` créé par `1118:4cf0`). */
export interface Maze2Cell {
  kind: number;
  row: number;
  col: number;
  type: number;
  /** Directions autorisées. */
  dirs: readonly number[];
  /** Direction courante `g` (tourne pour les aiguillages). */
  dir: number;
  rotates: boolean;
  /** Panneau : attribut (0 à 3) et valeur testés (le Zoombini prend `dir` si `attrs[attr] = value`). */
  panel: { attr: number; value: number } | null;
  /** Base du jeu de sprites (`+0x80`). */
  spriteBase: number;
  /** Délai de l'objet, `rand(25, 20)` (`1118:4cf0`). */
  delay: number;
  /** Zoombini retenu dans une case d'attente (`+0x86`), 0 si aucun. */
  occupant: number;
}

export type Maze2FlightState = "lead" | "step" | "wait" | "reject" | "land";

/** Un Zoombini en vol : case courante `(row, col)` (`+0x6e/+0x70`), case visée `(targetRow, targetCol)` (`+0x72/+0x74`). */
export interface Maze2Flight {
  id: number;
  row: number;
  col: number;
  targetRow: number;
  targetCol: number;
  dir: number;
  state: Maze2FlightState;
  /** Instant de début du segment en cours (attente avant le premier pas : instant du premier pas). */
  start: number;
  /** Premier segment d'une rampe de direction 1 ou 3 : bond de 2 images qui se termine dans la case de départ. */
  hop: boolean;
  /** Rejet ou atterrissage : instants où le Zoombini quitte la liste en vol (événement `0x5b` / `0x5c`) et part vers sa place sur la falaise. */
  removeAt: number;
  backAt: number;
  /** Cases franchies (garde contre les boucles). */
  steps: number;
}

export interface Maze2Member {
  id: number;
  attrs: Attrs;
  /** Falaise 0 à 3 (`+0x76`, 0 au départ : les 16 places d'attente de `DS:8920 = 0x10`). */
  cliff: number;
  /** Arrivé sur la falaise 3 (`+0x127`). */
  saved: boolean;
}

export interface Maze2World {
  level: number;
  mapIndex: number;
  generator: Maze2Generator;
  ramps: number[];
  /** Traits tirés pour les panneaux, dans l'ordre des enregistrements. */
  traits: number[];
  spriteBases: number[];
  /** Cases dans l'ordre des enregistrements, et grille 13 × 13 d'indices dans `cells` (−1 : case sans objet). */
  cells: Maze2Cell[];
  grid: Int16Array;
  /** Type de chaque case de la grille (`S14:0d18`) : 0 sol, 1 à 6 objets, `0x14` à `0x17` sorties. */
  kinds: Int16Array;
  members: Maze2Member[];
  flights: Maze2Flight[];
  /** `[88f8]` : identifiants lancés, ni rejetés ni arrivés depuis plus de 7 images (au plus 10). */
  launched: number[];
  /** Instants où chaque rampe (indice = numéro) est de nouveau libre. */
  rampFreeAt: number[];
  /** Compteur et identifiant de réservation de chaque case (`S14:07d0`, 3 mots par case). */
  claimCount: Int16Array;
  claimId: Int16Array;
  time: number;
  /** Nombre d'arrivées sur la falaise 3 (`DS:8988`) ; le bouton « Go » est actif dès la première (`DS:8916`). */
  goalArrivals: number;
  /** Files d'événements du Tick (`DS:894e`, `8950`, `8948`, `8952`). */
  queues: { release: number[]; back: number[]; steps: number[]; pairs: number[] };
}

/** Construit le monde d'une carte avec des traits et des jeux de sprites donnés (sans hasard : pour les tests et la reprise d'un état). */
export function buildMaze2World(params: {
  map: Maze2Map;
  level: number;
  generator: Maze2Generator;
  traits: readonly number[];
  spriteBases: readonly number[];
  delays?: readonly number[];
  team: readonly Attrs[];
  firstId?: number;
}): Maze2World {
  const { map } = params;
  const kinds = new Int16Array(MAZE2_SIZE * MAZE2_SIZE);
  MAZE2_EXITS.forEach((cells, exit) => {
    for (const [r, c] of cells) kinds[r * MAZE2_SIZE + c] = Maze2Kind.exit + exit;
  });
  const grid = new Int16Array(MAZE2_SIZE * MAZE2_SIZE).fill(-1);
  const cells: Maze2Cell[] = [];
  let panelRank = 0;
  map.records.forEach((rec, j) => {
    const k = rec.kind === Maze2Kind.panel ? (params.traits[panelRank++] ?? 0) : 0;
    const cell: Maze2Cell = {
      kind: rec.kind,
      row: rec.row,
      col: rec.col,
      type: rec.type,
      dirs: rec.dirs,
      dir: rec.dir,
      rotates: rec.rotates,
      panel: rec.kind === Maze2Kind.panel ? { attr: traitAttr(k), value: traitValue(k) } : null,
      spriteBase: params.spriteBases[rec.type >= 1 && rec.type <= 8 ? rec.type : 1] ?? 0,
      delay: params.delays?.[j] ?? 20,
      occupant: 0,
    };
    cells.push(cell);
    // Le dernier enregistrement d'une case l'emporte (comme `S14:0bc6` / `S14:0d18`) ; les coordonnées hors grille sont ignorées par prudence.
    if (rec.row >= 0 && rec.row < MAZE2_SIZE && rec.col >= 0 && rec.col < MAZE2_SIZE) {
      grid[rec.row * MAZE2_SIZE + rec.col] = cells.length - 1;
      kinds[rec.row * MAZE2_SIZE + rec.col] = rec.kind;
    }
  });
  const firstId = params.firstId ?? 1;
  return {
    level: params.level,
    mapIndex: map.index,
    generator: params.generator,
    ramps: [...map.ramps],
    traits: [...params.traits],
    spriteBases: [...params.spriteBases],
    cells,
    grid,
    kinds,
    members: params.team.map((attrs, i) => ({ id: firstId + i, attrs: [...attrs] as Attrs, cliff: 0, saved: false })),
    flights: [],
    launched: [],
    rampFreeAt: new Array<number>(15).fill(0),
    claimCount: new Int16Array(MAZE2_SIZE * MAZE2_SIZE),
    claimId: new Int16Array(MAZE2_SIZE * MAZE2_SIZE),
    time: 0,
    goalArrivals: 0,
    queues: { release: [], back: [], steps: [], pairs: [] },
  };
}

/**
 * Mise en place complète de l'épreuve, dans l'ordre des tirages de l'original : jeux de sprites (`1118:4ad2`, 7 tirages), traits (générateur du niveau),
 * puis un délai `rand(25, 20)` par enregistrement de la carte (`1118:4cf0`). `team` = attributs des Zoombinis du groupe ; `level` = niveau de l'étape
 * (0 à 3, `currentLevel`) : le niveau 4 (moins de 5 Zoombinis) est déduit. Avance `rotation`. L'équipe vide ne génère rien (`1118:0000` n'appelle pas `4ad2`).
 */
export function setupMaze2(
  rng: MsvcRandom, maps: readonly Maze2Map[], team: readonly Attrs[], level: number, rotation: Maze2Rotation,
): Maze2World {
  const resolved = maze2Level(level, team.length);
  const choice = chooseMaze2Map(resolved, rotation);
  const map = maps[choice.mapIndex];
  if (!map) throw new Error(`Maze2 : carte ${choice.mapIndex} absente`);
  const spriteBases = pickSpriteBases(rng);
  const traits = team.length > 0 ? generateTraits(rng, team, resolved, choice.generator, choice.slot) : [];
  const delays = map.records.map(() => rng.range(20, 25));
  return buildMaze2World({ map, level: resolved, generator: choice.generator, traits, spriteBases, delays, team });
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Simulation
// ---------------------------------------------------------------------------------------------------------------------

/** Images d'un pas de case, réservation de la case visée (4e image), bond de lancement, premier pas après la rampe. */
const STEP_IMAGES = 6;
const CLAIM_AT = 3;
const HOP_IMAGES = 1;
const LEAD_IMAGES = 30;
/** Tourbillon (`SCRS 14006`) : 25 images avant le retrait de la liste, 26 avant le retour. Collision : 6 images de gerbe, puis `SCRS 14004` (5 et 6). */
const WHIRL_REMOVE = 25;
const WHIRL_BACK = 26;
const CLASH_REMOVE = 6 + 5;
const CLASH_BACK = 6 + 6;
/** Atterrissage : gerbe `SCRB 10040` (événement `0x79` à l'image 2) puis `SCRS 14007` (6 images, `0x5c` à l'image 5) : le Zoombini quitte la liste en vol au bout de 7 images (`1118:348d`, `1118:3263`). */
const LAND_REMOVE = 2 + 5;
const LAND_BACK = 2 + 6;

function cellIndex(row: number, col: number): number {
  return row * MAZE2_SIZE + col;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > MAZE2_SIZE - 1 ? MAZE2_SIZE - 1 : v;
}

function cellAt(w: Maze2World, row: number, col: number): Maze2Cell | undefined {
  const i = w.grid[cellIndex(row, col)]!;
  return i >= 0 ? w.cells[i] : undefined;
}

function flightOf(w: Maze2World, id: number): Maze2Flight | undefined {
  return w.flights.find((f) => f.id === id);
}

function memberOf(w: Maze2World, id: number): Maze2Member | undefined {
  return w.members.find((m) => m.id === id);
}

export type Maze2LaunchResult = { ok: true } | { ok: false; reason: "unknown" | "airborne" | "limit" | "ramp" | "busy" };

/**
 * Lancement d'un Zoombini sur une rampe (`1118:2285`, région 3). Refus : Zoombini inconnu, déjà dans la liste en vol, 10 Zoombinis lancés non rejetés,
 * rampe inactive ou hors de sa falaise, rampe encore occupée (libre 34 ou 35 images après le dépôt). Le premier pas a lieu 30 images plus tard ;
 * case visée : le départ pour les directions 1 et 3, la case voisine (colonne ∓ 1) pour 0 et 2.
 */
export function launchMaze2(w: Maze2World, id: number, rampNumber: number): Maze2LaunchResult {
  const member = memberOf(w, id);
  if (!member) return { ok: false, reason: "unknown" };
  if (w.launched.length > MAZE2_MAX_FLIGHTS - 1) return { ok: false, reason: "limit" };
  if (w.launched.includes(id)) return { ok: false, reason: "airborne" };
  const ramp = MAZE2_RAMPS[rampNumber - 1];
  if (!ramp || !w.ramps.includes(rampNumber) || ramp.cliff !== member.cliff) return { ok: false, reason: "ramp" };
  if (w.time < w.rampFreeAt[rampNumber]!) return { ok: false, reason: "busy" };
  w.launched.push(id);
  w.rampFreeAt[rampNumber] = w.time + ramp.freeAfter;
  const { row, col } = ramp.start;
  w.flights.push({
    id,
    row,
    col,
    targetRow: row,
    targetCol: ramp.dir === 0 ? col - 1 : ramp.dir === 2 ? col + 1 : col,
    dir: ramp.dir,
    state: "lead",
    start: w.time + LEAD_IMAGES,
    hop: ramp.dir === 1 || ramp.dir === 3,
    removeAt: 0,
    backAt: 0,
    steps: 0,
  });
  return { ok: true };
}

/** `1100:102a` / rotation de `1100:1a9d` : direction autorisée suivante. */
function rotate(cell: Maze2Cell): void {
  if (cell.dirs.every((f) => f === 0)) return;
  cell.dir = (cell.dir + 1) % 4;
  while (cell.dirs[cell.dir] === 0) cell.dir = (cell.dir + 1) % 4;
}

/** Démarre un pas dans `f.dir` depuis la case visée (`1100:0b69` et variantes) : libère l'occupant d'une case d'attente de destination. */
function startStep(w: Maze2World, f: Maze2Flight): void {
  f.row = f.targetRow;
  f.col = f.targetCol;
  const [dr, dc] = MAZE2_DIR_STEP[f.dir]!;
  f.targetRow = clamp(f.row + dr);
  f.targetCol = clamp(f.col + dc);
  const dest = cellAt(w, f.targetRow, f.targetCol);
  if (dest && dest.kind === Maze2Kind.wait && dest.occupant !== 0) {
    w.queues.release.push(dest.occupant);
    const held = flightOf(w, dest.occupant);
    if (held) held.dir = f.dir;
    dest.occupant = 0;
  }
  f.state = "step";
  f.hop = false;
  f.start = w.time;
  f.steps++;
}

function reject(w: Maze2World, f: Maze2Flight, remove: number, back: number): void {
  f.state = "reject";
  f.removeAt = w.time + remove;
  f.backAt = w.time + back;
}

function clearClaim(w: Maze2World, row: number, col: number): void {
  w.claimCount[cellIndex(row, col)] = 0;
  w.claimId[cellIndex(row, col)] = 0;
}

/** Bouton (`1100:102a`) : les aiguillages de même type tournent, les cases d'attente de même type relâchent leur occupant. Le type 1 n'a aucun effet. */
function pressButton(w: Maze2World, button: Maze2Cell): void {
  if (button.type < 2 || button.type > 8) return;
  for (let i = w.cells.length - 1; i >= 0; i--) {
    const cell = w.cells[i]!;
    if (cell.type !== button.type) continue;
    if (cell.kind === Maze2Kind.switch) rotate(cell);
    if (cell.kind === Maze2Kind.wait && cell.occupant !== 0) {
      w.queues.release.push(cell.occupant);
      cell.occupant = 0;
    }
  }
}

/** Fin d'un pas (Tick, file `[8948]`) : libère la réservation, puis effet de la case atteinte (`1118:1503`). */
function finishStep(w: Maze2World, f: Maze2Flight): void {
  const i = cellIndex(f.targetRow, f.targetCol);
  if (w.claimId[i] === f.id) clearClaim(w, f.targetRow, f.targetCol);
  const kind = w.kinds[i]!;
  const cell = cellAt(w, f.targetRow, f.targetCol);
  switch (kind) {
    case Maze2Kind.whirl:
      reject(w, f, WHIRL_REMOVE, WHIRL_BACK);
      return;
    case Maze2Kind.panel: {
      const m = memberOf(w, f.id)!;
      if (cell?.panel && cell.panel.value === m.attrs[cell.panel.attr]) f.dir = cell.dir;
      startStep(w, f);
      return;
    }
    case Maze2Kind.arrow:
    case Maze2Kind.switch:
      f.dir = cell!.dir;
      if (cell!.rotates) rotate(cell!);
      startStep(w, f);
      return;
    case Maze2Kind.wait:
      f.row = f.targetRow;
      f.col = f.targetCol;
      cell!.occupant = f.id;
      f.state = "wait";
      return;
    case Maze2Kind.button:
      pressButton(w, cell!);
      startStep(w, f);
      return;
    default:
      if (kind >= Maze2Kind.exit && kind <= Maze2Kind.exit + 3) {
        land(w, f, kind - Maze2Kind.exit);
        return;
      }
      startStep(w, f);
  }
}

/**
 * `1118:1fb4` : arrivée sur une sortie ; la falaise 3 sauve le Zoombini (`+0x127`) et active « Go » dès la première arrivée. La falaise `+0x76` est celle de la
 * sortie. Le Zoombini reste dans la liste en vol quelques images (gerbe, `SCRS 14007`), puis la quitte (`1118:3263`) et rejoint sa place : il peut alors être
 * relancé s'il y a une rampe active sur cette falaise.
 */
function land(w: Maze2World, f: Maze2Flight, cliff: number): void {
  const member = memberOf(w, f.id)!;
  member.cliff = cliff;
  if (cliff === MAZE2_GOAL_CLIFF) {
    member.saved = true;
    w.goalArrivals++;
  }
  f.state = "land";
  f.removeAt = w.time + LAND_REMOVE;
  f.backAt = w.time + LAND_BACK;
}

/** Événement de la 4e image d'un pas (`1118:3ecd` et variantes) : compteur de la case visée ; deux arrivées → les deux Zoombinis sont rejetés. */
function claim(w: Maze2World, f: Maze2Flight): void {
  const i = cellIndex(f.targetRow, f.targetCol);
  w.claimCount[i] += 1;
  const count = w.claimCount[i]!;
  if (count === 1) w.claimId[i] = f.id;
  else if (count === 2) {
    w.queues.pairs.push(w.claimId[i]!, f.id);
    w.claimId[i] = 0;
  } else {
    w.claimId[i] = 0;
    w.claimCount[i] = 0;
  }
}

/** `1100:02cf` : les deux Zoombinis d'une collision repartent (rejet) ; la réservation de la case du second est remise à zéro. */
function collide(w: Maze2World, a: Maze2Flight | undefined, b: Maze2Flight | undefined): void {
  if (!a || !b) return;
  clearClaim(w, b.targetRow, b.targetCol);
  reject(w, a, CLASH_REMOVE, CLASH_BACK);
  reject(w, b, CLASH_REMOVE, CLASH_BACK);
}

/** Avance d'une image : rappels d'animation dans l'ordre de la liste en vol, puis le Tick vide ses files dans l'ordre de `1118:1503` (piles). */
function tick(w: Maze2World): void {
  const t = w.time;
  for (const f of [...w.flights]) {
    if (f.state === "lead") {
      if (t === f.start) {
        f.state = "step";
        f.start = t;
        f.steps++;
      }
    } else if (f.state === "step") {
      const d = t - f.start;
      if (f.hop) {
        if (d === HOP_IMAGES) w.queues.steps.push(f.id);
      } else if (d === CLAIM_AT) claim(w, f);
      else if (d === STEP_IMAGES) w.queues.steps.push(f.id);
    } else if (f.state === "reject" || f.state === "land") {
      if (t === f.removeAt) {
        const at = w.launched.indexOf(f.id);
        if (at >= 0) w.launched.splice(at, 1);
        const i = cellIndex(f.targetRow, f.targetCol);
        if (w.claimId[i] === f.id) clearClaim(w, f.targetRow, f.targetCol);
      }
      if (t === f.backAt) w.queues.back.push(f.id);
    }
  }
  const q = w.queues;
  while (q.release.length > 0) {
    const f = flightOf(w, q.release.pop()!);
    if (f && f.state === "wait") startStep(w, f);
  }
  while (q.back.length > 0) {
    const f = flightOf(w, q.back.pop()!);
    if (f) w.flights.splice(w.flights.indexOf(f), 1);
  }
  while (q.steps.length > 0) {
    const f = flightOf(w, q.steps.pop()!);
    if (f && f.state === "step") finishStep(w, f);
  }
  while (q.pairs.length > 1) {
    const second = flightOf(w, q.pairs.pop()!);
    const first = flightOf(w, q.pairs.pop()!);
    collide(w, first, second);
  }
  w.time++;
}

/** Avance de `images` images. */
export function advanceMaze2(w: Maze2World, images = 1): void {
  for (let i = 0; i < images; i++) tick(w);
}

/** Vrai si plus rien ne bouge : aucun Zoombini en vol hors cases d'attente, files vides, rampes libres. */
export function maze2Idle(w: Maze2World): boolean {
  const q = w.queues;
  return (
    w.flights.every((f) => f.state === "wait") &&
    q.release.length + q.back.length + q.steps.length + q.pairs.length === 0 &&
    w.rampFreeAt.every((at) => at <= w.time)
  );
}

/** Avance jusqu'à l'immobilité ; renvoie faux si `limit` images ne suffisent pas (boucle sans fin). */
export function settleMaze2(w: Maze2World, limit = 4000): boolean {
  for (let i = 0; i < limit; i++) {
    if (maze2Idle(w)) return true;
    tick(w);
  }
  return maze2Idle(w);
}

export type Maze2MemberState = "cliff" | "flying" | "waiting" | "rejected" | "landing" | "saved" | "relay" | "stranded";

/**
 * État d'un Zoombini : sur la falaise de départ, en vol, retenu dans une case d'attente, en rejet, en train d'atterrir, sauvé (falaise 3), posé sur une autre
 * falaise qui a une rampe active (`relay` : il peut être relancé) ou sans rampe (`stranded` : perdu).
 */
export function maze2MemberState(w: Maze2World, id: number): Maze2MemberState {
  const m = memberOf(w, id)!;
  const f = flightOf(w, id);
  if (f) return f.state === "wait" ? "waiting" : f.state === "reject" ? "rejected" : f.state === "land" ? "landing" : "flying";
  if (m.saved) return "saved";
  if (m.cliff === 0) return "cliff";
  return w.ramps.some((r) => MAZE2_RAMPS[r - 1]!.cliff === m.cliff) ? "relay" : "stranded";
}

export interface Maze2Outcome {
  /** Zoombinis sur la falaise 3 (`+0x127`) ; les autres sont perdus à la sortie de l'écran (`1168:36e1`). */
  saved: number[];
  lost: number[];
  /** « Go » actif : au moins un Zoombini est arrivé sur la falaise 3 (`DS:8916`). */
  goActive: boolean;
  /** Tous sauvés : voix de réussite (`DS:899e`). */
  allSaved: boolean;
}

export function maze2Outcome(w: Maze2World): Maze2Outcome {
  const saved = w.members.filter((m) => m.saved).map((m) => m.id);
  const lost = w.members.filter((m) => !m.saved).map((m) => m.id);
  return { saved, lost, goActive: w.goalArrivals > 0, allSaved: lost.length === 0 && saved.length > 0 };
}

/** Copie profonde de l'état mobile (la disposition des cases est copiée aussi : les aiguillages et occupants changent). */
export function cloneMaze2(w: Maze2World): Maze2World {
  return {
    ...w,
    ramps: [...w.ramps],
    traits: [...w.traits],
    spriteBases: [...w.spriteBases],
    cells: w.cells.map((c) => ({ ...c })),
    grid: w.grid.slice(),
    kinds: w.kinds.slice(),
    members: w.members.map((m) => ({ ...m })),
    flights: w.flights.map((f) => ({ ...f })),
    launched: [...w.launched],
    rampFreeAt: [...w.rampFreeAt],
    claimCount: w.claimCount.slice(),
    claimId: w.claimId.slice(),
    queues: { release: [...w.queues.release], back: [...w.queues.back], steps: [...w.queues.steps], pairs: [...w.queues.pairs] },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Robot
// ---------------------------------------------------------------------------------------------------------------------

export interface Maze2Launch {
  id: number;
  ramp: number;
}

export interface Maze2Plan {
  /** Lancers successifs, chacun après l'immobilité du précédent. */
  launches: Maze2Launch[];
  saved: number;
  /** Tout le groupe est sauvé. */
  complete: boolean;
}

/**
 * Clé de l'état dynamique (aiguillages, occupants des cases d'attente, statut de chaque Zoombini) pour ne pas explorer deux fois la même situation. Les
 * Zoombinis sont désignés par leurs attributs et triés : deux groupes qui ne diffèrent que par l'ordre ou les identifiants donnent la même clé.
 */
function signature(w: Maze2World): string {
  const attrsOf = (id: number) => memberOf(w, id)!.attrs.join("");
  const cells = w.cells.map((c) => (c.kind === Maze2Kind.switch || c.kind === Maze2Kind.arrow ? c.dir : c.occupant ? attrsOf(c.occupant) : 0)).join(",");
  const members = w.members
    .map((m) => `${m.attrs.join("")}${m.cliff}${m.saved ? "s" : ""}${w.launched.includes(m.id) ? "l" : ""}${flightOf(w, m.id)?.state ?? ""}`)
    .sort()
    .join(",");
  return `${cells}|${members}`;
}

/**
 * Robot : cherche la suite de lancers qui amène le groupe à la sortie 3. Recherche du meilleur d'abord sur copies du monde, un lancer à la fois (chacun après
 * l'immobilité du précédent) : à chaque étape on essaie, pour chaque sorte de Zoombini (attributs identiques, même falaise) et chaque rampe active de sa
 * falaise, tous les lancers qui sauvent le Zoombini, le posent sur une falaise munie d'une rampe (relais), le retiennent dans une case d'attente ou le font
 * revenir en changeant l'état des aiguillages ou des cases (tourbillon, collision, falaise de départ). Un lancer qui perd un Zoombini (autre falaise sans
 * rampe) est écarté. Les situations déjà vues sont ignorées ; `budget` borne le nombre de lancers simulés.
 * Renvoie le plan sauvant le plus de Zoombinis (`complete` si tout le groupe est sauvé, ce que certaines compositions ne permettent pas, ou pas dans le budget).
 * Ne modifie pas `world`.
 */
export function planMaze2(world: Maze2World, budget = 300000): Maze2Plan {
  let best: Maze2Plan = { launches: [], saved: world.members.filter((m) => m.saved).length, complete: false };
  const seen = new Set<string>();
  const strandedIn = (w: Maze2World) => w.members.filter((m) => maze2MemberState(w, m.id) === "stranded").length;
  const priority = (w: Maze2World, launches: number) => {
    let p = 0;
    for (const m of w.members) {
      const state = maze2MemberState(w, m.id);
      p += state === "saved" ? 100 : state === "relay" ? 20 : state === "waiting" ? 5 : 0;
    }
    return p - launches;
  };
  type Node = { w: Maze2World; plan: Maze2Launch[]; rank: number };
  const open: Node[] = [{ w: cloneMaze2(world), plan: [], rank: 0 }];
  const push = (node: Node) => {
    let i = open.length;
    open.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (open[parent]!.rank >= node.rank) break;
      open[i] = open[parent]!;
      i = parent;
    }
    open[i] = node;
  };
  const pop = (): Node => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= open.length) break;
        if (child + 1 < open.length && open[child + 1]!.rank > open[child]!.rank) child++;
        if (open[child]!.rank <= last.rank) break;
        open[i] = open[child]!;
        i = child;
      }
      open[i] = last;
    }
    return top;
  };

  let runs = 0;
  // Les cases (aiguillages, occupants) sont l'état qui compte ; un lancer qui sauve un Zoombini sans rien changer d'autre peut toujours être fait tout de suite.
  const config = (w: Maze2World) => w.cells.map((c) => (c.kind === Maze2Kind.switch || c.kind === Maze2Kind.arrow ? c.dir : c.occupant)).join(",");
  const others = (w: Maze2World, id: number) => w.members.filter((m) => m.id !== id).map((m) => `${m.cliff}${m.saved ? "s" : ""}${w.launched.includes(m.id) ? "l" : ""}`).join(",");

  const moves = (w: Maze2World): { id: number; ramp: number; next: Maze2World }[] => {
    const out: { id: number; ramp: number; next: Maze2World }[] = [];
    const baseStranded = strandedIn(w);
    const kinds = new Set<string>();
    for (const m of w.members) {
      const state = maze2MemberState(w, m.id);
      if (state !== "cliff" && state !== "relay") continue;
      const kind = `${m.cliff}:${m.attrs.join("")}`;
      if (kinds.has(kind)) continue;
      kinds.add(kind);
      for (const r of w.ramps) {
        if (MAZE2_RAMPS[r - 1]!.cliff !== m.cliff) continue;
        runs++;
        const next = cloneMaze2(w);
        if (!launchMaze2(next, m.id, r).ok || !settleMaze2(next)) continue;
        if (strandedIn(next) > baseStranded) continue;
        out.push({ id: m.id, ramp: r, next });
      }
    }
    return out;
  };

  const kindOf = (m: Maze2Member) => `${m.cliff}:${m.attrs.join("")}`;
  while (open.length > 0 && runs < budget) {
    let { w, plan } = pop();
    let list = moves(w);
    for (;;) {
      // Sorte de Zoombini → rampe qui la sauve sans rien changer : tous les Zoombinis de cette sorte sont sauvés d'un coup.
      const free = new Map<string, number>();
      for (const mv of list) {
        const m = memberOf(mv.next, mv.id)!;
        if (m.saved && config(mv.next) === config(w) && others(mv.next, mv.id) === others(w, mv.id) && !free.has(kindOf(memberOf(w, mv.id)!))) {
          free.set(kindOf(memberOf(w, mv.id)!), mv.ramp);
        }
      }
      if (free.size === 0 || runs >= budget) break;
      let moved = false;
      for (const m of w.members) {
        const ramp = free.get(kindOf(m));
        const state = maze2MemberState(w, m.id);
        if (ramp === undefined || (state !== "cliff" && state !== "relay")) continue;
        runs++;
        const next = cloneMaze2(w);
        if (!launchMaze2(next, m.id, ramp).ok || !settleMaze2(next)) continue;
        if (!memberOf(next, m.id)!.saved || config(next) !== config(w) || others(next, m.id) !== others(w, m.id)) continue;
        plan = [...plan, { id: m.id, ramp }];
        w = next;
        moved = true;
      }
      if (!moved) break;
      list = moves(w);
    }
    const saved = w.members.filter((m) => m.saved).length;
    if (saved > best.saved) best = { launches: plan, saved, complete: false };
    if (saved === w.members.length) return { launches: plan, saved, complete: true };
    const key = signature(w);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const mv of list) {
      const launches = [...plan, { id: mv.id, ramp: mv.ramp }];
      push({ w: mv.next, plan: launches, rank: priority(mv.next, launches.length) });
    }
  }
  return best;
}

/** Rejoue un plan sur une copie et renvoie le monde final (immobile). */
export function replayMaze2(world: Maze2World, plan: readonly Maze2Launch[]): Maze2World {
  const w = cloneMaze2(world);
  for (const l of plan) {
    if (!launchMaze2(w, l.id, l.ramp).ok) throw new Error(`Maze2 : lancer refusé pour ${l.id} sur la rampe ${l.ramp}`);
    settleMaze2(w);
  }
  return w;
}
