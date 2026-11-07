import type { MsvcRandom } from "../../../../engine/mohawk/rng";

/**
 * Règles de l'hôtel du temps-compté (`HOTEL.MHK`, écran 14 ; `docs/zoombinis/puzzles/hotel.md`). Fonctions pures, sans rendu ni texte :
 * choix des attributs et mise en place (`10e8:1896`), validité d'une pose (`10e8:1cea`, `2511`, `2e30`, `320f`), première pose gratuite,
 * erreurs tolérées (`12 − F`), succès, perdus, obscurcissement (`10e8:2698`), choix des scénettes (`10e8:0000`, `07ca`), robot.
 *
 * Adresses : `10e8:*` est le segment de code de l'écran, `DS:` le segment de données (`1530`), `1428:*` les tableaux de travail du module.
 * Ghidra inverse l'ordre des arguments pascal (`docs/zoombinis/engine.md` §0) : `1080:0028(n)` est `rng.range(0, n)`.
 *
 * Conventions :
 *  - niveau 0 à 3 (`currentLevel`) ; attribut 0 à 3 = octet 0 à 3 de la fiche (cheveux, yeux, nez, pieds), valeur 1 à 5 ;
 *  - **chambre** = indice de dépôt 0-based : niveau 0 : 5 chambres (`0x1428:[2·(5·i + 4)]` : l'original ne s'en sert que de ces cinq-là), niveaux 1 et 2 :
 *    25 chambres, niveau 3 : 125 ; `tablePoint` donne l'indice de la table des coordonnées (`1428:0388` / `03f0`) ;
 *  - **axes** : chaque attribut choisi est une rangée d'étiquettes de 5 cases, que les chambres se partagent (`1428:0316` = attribut `A`, `0348` = `B`,
 *    `037A` = `C`) : niveau 0 un axe (la chambre), niveaux 1 et 2 deux axes (colonne `r mod 5` = `A`, bloc `⌊r / 5⌋` = `B`), niveau 3 trois (`A` : `⌊(r mod 25) / 5⌋`,
 *    `B` : `⌊r / 25⌋`, `C` : `r mod 5`) ;
 *  - une étiquette vaut 0 (vierge) ou la valeur apprise : la première pose qui l'atteint la définit (**apprises à la volée**).
 */

// --- Constantes ---

export type Level = 0 | 1 | 2 | 3;

/** Chambres par niveau (`DS:74de` : 25 par défaut, 125 au niveau 3 ; le niveau 0 n'en utilise que 5). */
export const ROOM_COUNTS: readonly number[] = [5, 25, 25, 125];
/** Nombre d'axes (attributs choisis) par niveau. */
export const AXIS_COUNTS: readonly number[] = [1, 2, 2, 3];
/** `F` = `DS:74f0` : crans de l'horloge déjà tombés à la première pose (`10e8:0000`). */
export const FREE_STEPS: readonly number[] = [5, 2, 4, 2];
/** `DS:74ee` à partir duquel l'épreuve est perdue (`10e8:116b` : `≥ 0xc`). */
export const DEFEAT_STEP = 12;
/** Erreurs tolérées avant la défaite (`12 − F`) : l'épreuve est perdue au refus suivant ce nombre. 7, 10, 8, 10. */
export const MAX_ERRORS: readonly number[] = FREE_STEPS.map((f) => DEFEAT_STEP - f);
/** Pourcentage de lumière conservée par erreur (`10e8:2698`) : 88 (niveau 0), 92, 90 (niveau 2), 92 (niveau 3). */
export const DIM_PERCENT: readonly number[] = [0x58, 0x5c, 0x5a, 0x5c];
/** Première et dernière entrée de la palette obscurcie (`1058:03b5(0xec, 10)` : 236 entrées de 10 à 245). */
export const DIM_FIRST = 10;
export const DIM_COUNT = 0xec;
/** Hauteur de la pile d'une chambre (`1428:[2·r]`) : au plus 6 (`10e8:0f9f`). */
export const PILE_MAX = 6;
/** Étiquette d'une chambre bloquée (niveau 2 : `1428:[2·r] = −1`). */
export const BLOCKED = -1;
/** Voix de félicitation quand tout le groupe est rangé : `0xAF + rand(0..23)` (`10e8:1cea`). */
export const COMPLETION_VOICES = { first: 0xaf, last: 0xaf + 23 } as const;
/** Réplique supplémentaire (clin d'œil) à `DS:74ee == 9` : `SCRB 7007 + rand(0..2)` (`10e8:1106`). */
export const WARNING_STEP = 9;
export const WARNING_SCRIPT = 7007;
/** Scénette de fin : victoire `SCRB 7507 + rand(0..2)` (`10e8:0894`…), défaite `SCRB 7503 + rand(0..3)` (`10e8:125b`). */
export const VICTORY_SCRIPT = 7507;
export const DEFEAT_SCRIPT = 7503;
/** Voix de défaite : 6006 (`10e8:1176`) ; au niveau 3 ensuite le son 7500 (`10e8:11a9`, après un tirage inutile `rand(0..3)`). */
export const DEFEAT_VOICE = 6006;
export const DEFEAT_VOICE_L3 = 7500;
/** Voix d'introduction rejouée par F1 (`DS:a2c4 = 0x4e71`, `10e8:0415`). */
export const HELP_VOICE = 0x4e71;
/** Scénette d'avant la relance : `SCRB 7000 + variante` ; scénette d'explication après la relance : `SCRB 7500 + niveau`. */
export const INTRO_SCRIPT = 7000;
export const EXPLAIN_SCRIPT = 7500;
/** Attente de défaite avant la voix (`1090:00c1(1, 0, 60, 0)` : 60 ticks, 120 en « moins d'action » **probable**, `DS:908a`). */
export const DEFEAT_WAIT_TICKS = 60;

/** Quatre-vingts octets de `1438:000a` : seize places d'attente du hall (pieds), la première étant la plus à droite (`10e8:0ad5`). */
export const HALL_PLACES: readonly { x: number; y: number }[] = [
  { x: 504, y: 458 },
  { x: 467, y: 453 },
  { x: 428, y: 453 },
  { x: 384, y: 454 },
  { x: 344, y: 451 },
  { x: 297, y: 454 },
  { x: 270, y: 441 },
  { x: 244, y: 453 },
  { x: 217, y: 448 },
  { x: 188, y: 453 },
  { x: 160, y: 449 },
  { x: 130, y: 455 },
  { x: 103, y: 446 },
  { x: 74, y: 454 },
  { x: 50, y: 445 },
  { x: 17, y: 453 },
];

/** `1428:0388` : points des 25 chambres des niveaux 0 à 2 (x, y en pieds), colonne par colonne (`r` de 0 à 24). */
export const ROOM_POINTS_25: readonly { x: number; y: number }[] = [
  [135, 78], [138, 142], [142, 204], [146, 263], [149, 324],
  [223, 84], [222, 147], [227, 210], [228, 267], [234, 328],
  [315, 88], [311, 152], [313, 213], [314, 272], [314, 333],
  [402, 94], [398, 157], [399, 220], [397, 277], [396, 338],
  [491, 100], [489, 164], [489, 226], [488, 284], [485, 346],
].map(([x, y]) => ({ x: x!, y: y! }));

/** `1428:03f0` : points des 125 chambres du niveau 3 (5 blocs de 25 : bloc `⌊r / 25⌋`, rangée `⌊(r mod 25) / 5⌋`, `r mod 5` dans la rangée). */
export const ROOM_POINTS_125: readonly { x: number; y: number }[] = [
  [16, 40], [39, 50], [60, 54], [86, 58], [111, 60],
  [19, 115], [42, 125], [63, 129], [89, 133], [114, 135],
  [21, 188], [44, 198], [65, 202], [91, 206], [116, 208],
  [24, 261], [47, 271], [68, 275], [94, 279], [119, 281],
  [28, 333], [51, 343], [73, 347], [99, 351], [124, 353],
  [142, 54], [165, 60], [186, 64], [212, 68], [237, 70],
  [145, 129], [168, 139], [189, 143], [215, 147], [240, 149],
  [147, 202], [170, 212], [191, 216], [217, 220], [242, 222],
  [150, 275], [173, 285], [194, 289], [220, 293], [245, 295],
  [154, 347], [177, 357], [198, 361], [224, 365], [249, 367],
  [268, 59], [291, 69], [312, 73], [338, 77], [363, 79],
  [271, 134], [294, 144], [315, 148], [341, 152], [366, 154],
  [273, 207], [296, 217], [316, 221], [342, 225], [367, 227],
  [276, 280], [299, 290], [320, 294], [346, 298], [371, 300],
  [280, 355], [303, 365], [324, 369], [350, 373], [375, 375],
  [392, 63], [415, 73], [437, 77], [463, 81], [488, 83],
  [395, 138], [418, 148], [439, 152], [465, 156], [490, 158],
  [397, 211], [420, 221], [441, 225], [467, 229], [492, 231],
  [400, 284], [423, 294], [444, 298], [470, 302], [495, 304],
  [404, 356], [427, 366], [448, 370], [474, 374], [499, 376],
  [516, 72], [539, 82], [560, 86], [586, 90], [611, 92],
  [519, 147], [542, 157], [563, 161], [589, 165], [614, 167],
  [521, 220], [544, 230], [567, 234], [593, 238], [618, 240],
  [524, 293], [547, 303], [568, 307], [594, 311], [619, 313],
  [528, 365], [551, 375], [572, 379], [598, 383], [623, 385],
].map(([x, y]) => ({ x: x!, y: y! }));

/** Indice de la table des coordonnées d'une chambre (niveau 0 : `5·i + 4`, les cinq chambres de la rangée du bas). */
export function tablePoint(level: number, room: number): number {
  return level === 0 ? room * 5 + 4 : room;
}

/** Indices (un par axe) de la chambre : colonne / bloc / rangée selon le niveau (voir l'en-tête). */
export function axisIndices(level: number, room: number): number[] {
  if (level === 0) return [room];
  if (level < 3) return [room % 5, Math.floor(room / 5)];
  return [Math.floor((room % 25) / 5), Math.floor(room / 25), room % 5];
}

/** Chambre dont les indices d'axes sont `indices` (réciproque de `axisIndices`). */
export function roomOfAxes(level: number, indices: readonly number[]): number {
  if (level === 0) return indices[0]!;
  if (level < 3) return indices[1]! * 5 + indices[0]!;
  return indices[1]! * 25 + indices[0]! * 5 + indices[2]!;
}

// --- Obscurcissement ---

/** Composante assombrie : `⌊v × pourcentage / 100⌋` (`10e8:2698`). */
export function dimmed(value: number, percent: number): number {
  return Math.floor((value * percent) / 100);
}

/** Assombrit les 236 entrées de 10 à 245 d'une palette de 256 × RVB (`10e8:2698`) : cumulatif, chaque erreur multiplie de nouveau. */
export function dimPalette(colors: Uint8Array, percent: number): void {
  for (let index = DIM_FIRST; index < DIM_FIRST + DIM_COUNT; index++) {
    for (let c = 0; c < 3; c++) colors[index * 3 + c] = dimmed(colors[index * 3 + c]!, percent);
  }
}

// --- État ---

/** Tableau d'attributs d'un Zoombini (octets 0 à 3 de la fiche), valeurs de 1 à 5. */
export type Traits = readonly number[];

export interface HotelState {
  readonly level: Level;
  /** Attributs de chaque membre du groupe (copie). */
  readonly group: readonly (readonly number[])[];
  /** `A`, `B`, `C` : indices d'attribut tirés (`DS:74ce`, `74d0`, `74d2`) ; seuls les `axes` premiers servent. */
  readonly chosen: readonly [number, number, number];
  readonly axes: number;
  readonly rooms: number;
  /** Étiquettes apprises : un tableau de 5 cases par axe (0 = vierge). */
  readonly labels: number[][];
  /** Pile de chaque chambre (`1428:[2·r]`) : 0 vide, 1 à 6 hauteur, `BLOCKED` bloquée. */
  readonly piles: number[];
  /** Niveau 2 : dessin de barrière (0 à 3) de chaque chambre bloquée, dans l'ordre des chambres (`1428:02EE`, voir `blockedArt`). */
  arts: number[];
  /** Niveau 2 : disposition cachée tirée à la mise en place (colonnes `a[i]`, blocs `b[i]` ; les étiquettes qu'elle posait sont effacées en fin de `1896`). */
  hidden: { a: number[]; b: number[] } | null;
  /** `DS:74ee` : cran de l'horloge ; `F` = `DS:74f0`. */
  step: number;
  readonly base: number;
  /** `DS:74ca` : la prochaine pose est gratuite. */
  firstPose: boolean;
  /** `DS:74d4` : poses acceptées. */
  accepted: number;
  /** `DS:74d6` : épreuve perdue. */
  lost: boolean;
  /** `DS:74a8` : mode de test (touche `R`), accepte toute pose aux niveaux 1 à 3 (le niveau 0 ne lit pas ce mot, `10e8:1cea`). */
  acceptAll: boolean;
  /** Chambre de chaque membre accepté, ou `null`. */
  readonly placed: (number | null)[];
}

/** Nombre de valeurs distinctes de chaque attribut présent dans le groupe (`10e8:2784`, `DS:74f6`). */
export function distinctValues(group: readonly Traits[]): number[] {
  return [0, 1, 2, 3].map((attr) => new Set(group.map((traits) => traits[attr]!)).size);
}

/**
 * Tire `A`, `B`, `C` jusqu'à ce que la condition du niveau soit vraie (`10e8:1896`, première boucle). Trois tirages `rand(0..3)` par essai, dans l'ordre
 * `A`, `B`, `C`, quel que soit le niveau (au niveau 0 seul `A` sert, `B` entre dans la condition).
 */
export function chooseAttributes(rng: MsvcRandom, level: Level, group: readonly Traits[]): [number, number, number] {
  const c = distinctValues(group);
  for (;;) {
    const a = rng.range(0, 3);
    const b = rng.range(0, 3);
    const k = rng.range(0, 3);
    if (level < 2) {
      if (c[a] === 5 && c[b] === 5 && a !== b) return [a, b, k];
      if (c.filter((n) => n < 5).length < 3) {
        if (a !== b && c[a]! > 3 && c[b]! > 3) return [a, b, k];
      } else if (a !== b) return [a, b, k];
    } else if (level === 2) {
      if (c.filter((n) => n < 4).length < 3) {
        if (a !== b && c[a]! > 3 && c[b]! > 3) return [a, b, k];
      } else if (a !== b) return [a, b, k];
    } else if (a !== b && b !== k && a !== k) {
      return [a, b, k];
    }
  }
}

/**
 * Mise en place (`10e8:1896`). Ordre des tirages : `A`, `B`, `C` (répétés jusqu'à acceptation), puis au niveau 2 : deux permutations de 1 à 5 tirées sans remise
 * (`rand(0..4)`, rejeté tant que la case est prise, colonne puis ligne à chaque tour), le nombre de chambres à bloquer (`rand(0..candidates − 1)`), le choix de chaque chambre
 * bloquée (`rand(0..candidates − 1)`, rejeté si déjà bloquée) suivi de son dessin (`rand(0..3)`).
 *
 * **Point ouvert 1, tranché** : les étiquettes que la disposition cachée pose au niveau 2 (`2496(6·i, …)`) sont **effacées à la fin de `1896`** (`11c8:6a5c` sur
 * `1428:0316` et `0348`, `10e8:1cc4`) : elles ne servent qu'à choisir les chambres bloquées (celles où aucun Zoombini du groupe n'irait dans cette disposition). Le joueur
 * apprend donc les étiquettes à la volée comme au niveau 1 ; la première pose gratuite n'écrase rien.
 */
export function createHotel(rng: MsvcRandom, level: Level, group: readonly Traits[]): HotelState {
  const chosen = chooseAttributes(rng, level, group);
  const axes = AXIS_COUNTS[level]!;
  const rooms = ROOM_COUNTS[level]!;
  const state: HotelState = {
    level,
    group: group.map((traits) => [...traits]),
    chosen,
    axes,
    rooms,
    labels: Array.from({ length: axes }, () => [0, 0, 0, 0, 0]),
    piles: new Array<number>(rooms).fill(0),
    arts: [],
    hidden: null,
    step: FREE_STEPS[level]!,
    base: FREE_STEPS[level]!,
    firstPose: true,
    accepted: 0,
    lost: false,
    acceptAll: false,
    placed: group.map(() => null),
  };
  if (level === 2) {
    const a: number[] = [];
    const b: number[] = [];
    const takenA = new Array<boolean>(5).fill(false);
    const takenB = new Array<boolean>(5).fill(false);
    for (let i = 0; i < 5; i++) {
      let x: number;
      do x = rng.range(0, 4);
      while (takenA[x]);
      takenA[x] = true;
      let y: number;
      do y = rng.range(0, 4);
      while (takenB[y]);
      takenB[y] = true;
      a.push(x + 1);
      b.push(y + 1);
    }
    state.hidden = { a, b };
    // Chambres que la disposition cachée ne remplit pas : colonne `r mod 5` ↔ `A = a[r mod 5]`, bloc `⌊r / 5⌋` ↔ `B = b[⌊r / 5⌋]`.
    const used = new Array<boolean>(25).fill(false);
    for (const traits of group) {
      const va = traits[chosen[0]]!;
      const vb = traits[chosen[1]]!;
      for (let r = 0; r < 25; r++) if (a[r % 5] === va && b[Math.floor(r / 5)] === vb) used[r] = true;
    }
    const candidates = used.flatMap((u, r) => (u ? [] : [r]));
    if (candidates.length > 0) {
      const count = Math.min(8, rng.range(0, candidates.length - 1) + 1, candidates.length);
      const blocked: number[] = [];
      for (let j = 0; j < count; j++) {
        let r: number;
        do r = candidates[rng.range(0, candidates.length - 1)]!;
        while (state.piles[r]! < 0);
        state.piles[r] = BLOCKED;
        blocked.push(r);
        state.arts.push(rng.range(0, 3));
      }
    }
  }
  return state;
}

/** Dessin de barrière de la chambre bloquée `room` (`10e8:12f6` : le j-ième dessin tiré va à la j-ième chambre bloquée **dans l'ordre des chambres**), ou `null`. */
export function blockedArt(state: HotelState, room: number): number | null {
  if (state.piles[room] !== BLOCKED) return null;
  let rank = 0;
  for (let r = 0; r < room; r++) if (state.piles[r] === BLOCKED) rank++;
  return state.arts[rank] ?? null;
}

/** Les chambres bloquées, dans l'ordre. */
export function blockedRooms(state: HotelState): number[] {
  return state.piles.flatMap((p, r) => (p === BLOCKED ? [r] : []));
}

/** Valeurs (une par axe) que le membre `member` présente. */
export function memberValues(state: HotelState, member: number): number[] {
  return state.chosen.slice(0, state.axes).map((attr) => state.group[member]![attr]!);
}

/**
 * Validité d'une pose, sans effet (`10e8:1cea` niveau 0, `2511` niveaux 1 et 2, `2e30` niveau 3, qui se réduisent à la même règle) : pour chaque axe, une étiquette
 * vierge n'accepte que si la valeur n'est portée par aucune autre case de l'axe, une étiquette posée n'accepte que sa valeur. Hors mode de test (`DS:74a8`).
 */
export function isValid(state: HotelState, member: number, room: number): boolean {
  const values = memberValues(state, member);
  const indices = axisIndices(state.level, room);
  for (let axis = 0; axis < state.axes; axis++) {
    const label = state.labels[axis]![indices[axis]!]!;
    const value = values[axis]!;
    if (label === 0) {
      if (state.labels[axis]!.includes(value)) return false;
    } else if (label !== value) {
      return false;
    }
  }
  return true;
}

export type PlaceResult =
  | { kind: "ignored" }
  | { kind: "blocked" }
  | {
      kind: "accepted";
      /** Pile utilisée pour placer le Zoombini (`1428:[2·r]` au moment de `10e8:3620` : 0 pour le premier de la chambre, 2 à 6 ensuite). */
      pile: number;
      /** Premier Zoombini de la chambre : la porte s'ouvre (`SCRB 6013 + r`, `9002 + r mod 5`). */
      opensDoor: boolean;
      /** C'était la pose gratuite. */
      free: boolean;
      /** Tout le groupe est rangé. */
      completed: boolean;
    }
  | {
      kind: "refused";
      /** `DS:74ee` après le refus : le cran de l'horloge à jouer (`SCRB 6000 + step`). */
      step: number;
      /** Dernier refus : l'épreuve est perdue (`74ee ≥ 12`). */
      lost: boolean;
    };

/**
 * Pose du membre `member` dans la chambre `room` (`10e8:1cea` région 3, puis le Tick `10e8:07ca`). Une chambre bloquée annule le dépôt sans erreur ni acceptation.
 * La **première pose** est acceptée sans condition, définit les étiquettes de sa chambre et remet le cran à `F` (`DS:74ca`, `DS:74ee = DS:74f0`). Une pose refusée
 * avance le cran d'un ; au douzième l'épreuve est perdue (plus aucune pose).
 */
export function place(state: HotelState, member: number, room: number): PlaceResult {
  if (state.lost || state.placed[member] !== null || room < 0 || room >= state.rooms) return { kind: "ignored" };
  if (state.piles[room] === BLOCKED) return { kind: "blocked" };
  const free = state.firstPose;
  // `10e8:2526` / `2e3f` : `DS:74a8 ≠ 0` répond « accepté » avant toute lecture des étiquettes ; l'appelant pose alors celles du Zoombini (`2156`, `2229`).
  const everything = state.acceptAll && state.level > 0;
  if (!free && !everything && !isValid(state, member, room)) {
    state.step += 1;
    if (state.step >= DEFEAT_STEP) state.lost = true;
    return { kind: "refused", step: state.step, lost: state.lost };
  }
  const values = memberValues(state, member);
  const indices = axisIndices(state.level, room);
  for (let axis = 0; axis < state.axes; axis++) state.labels[axis]![indices[axis]!] = values[axis]!;
  if (free) {
    state.firstPose = false;
    state.step = state.base;
  }
  const before = state.piles[room]!;
  state.accepted += 1;
  state.placed[member] = room;
  // `10e8:0f7d` : une pile déjà commencée grandit (6 au plus) avant le placement ; la première reste à 0 puis passe à 1.
  let pile = before;
  if (before > 0) pile = Math.min(before + 1, PILE_MAX);
  state.piles[room] = before === 0 ? 1 : pile;
  return { kind: "accepted", pile, opensDoor: before === 0, free, completed: state.accepted === state.group.length };
}

/** Membres rangés (sauvés) et perdus à la sortie (`1168:36e1` : perdus = jamais acceptés, **point ouvert 5, tranché** : les rangés restent sauvés même en cas d'échec). */
export function savedMembers(state: HotelState): number[] {
  return state.placed.flatMap((room, member) => (room === null ? [] : [member]));
}

export function lostMembers(state: HotelState): number[] {
  return state.placed.flatMap((room, member) => (room === null ? [member] : []));
}

/** Erreurs commises depuis la première pose (`DS:74ee − F`). */
export function errorsMade(state: HotelState): number {
  return state.firstPose ? 0 : Math.max(0, state.step - state.base);
}

// --- Mode de test (touches de `10e8:2289`, `[a43f]`) ---

/** `DS:74ee ← DS:74f2` (touche espace, `10e8:2412`) : le cran de l'horloge revient à sa valeur de l'`Enter` (1) ; `DS:74f0 ← DS:74f4` (`F`) ne change pas. */
export const TEST_RESET_STEP = 1;

/** Touche espace : le compteur d'erreurs repart de 1 (`10e8:2412`). La défaite déjà acquise (`lost`) et la première pose (`firstPose`) ne sont pas touchées. */
export function resetClock(state: HotelState): void {
  state.step = TEST_RESET_STEP;
}

/** Lettres des quatre attributs (`DS:1358`, quatre chaînes d'un caractère) que la touche `A` affiche pour `A`, `B` et `C` (`10e8:2852`). */
export const ATTRIBUTE_LETTERS: readonly string[] = ["H", "E", "N", "F"];

/** Lettres affichées par la touche `A`, une par axe tiré (`DS:74ce`, `74d0`, `74d2`) : les trois, `C` seulement au niveau 3 (`10e8:2980`). */
export function attributeLetters(state: HotelState): string[] {
  const count = state.level === 3 ? 3 : 2;
  return state.chosen.slice(0, count).map((attribute) => ATTRIBUTE_LETTERS[attribute]!);
}

/**
 * Touches `W` et `E` (`10e8:2317`, `2395`) : essai des scénettes de l'écureuil sur l'objet `DS:74aa`. `W` fait défiler `DS:74b4` de 0 à 9 (`SCRB 7000 + …`),
 * `E` fait défiler `DS:74b6` de 10 à 17 (`SCRB 7000 + …`) ; les deux valent 25 à l'`Enter` (donc 0 et 10 au premier appui).
 */
export const TEST_SCENE_START = 0x19;
export function nextTestScene(current: number, first: number, last: number): number {
  const next = current + 1;
  return next > last ? first : next;
}

// --- Hasard des scénettes ---

/** Voix de félicitation (`0xAF + rand(0..23)`). */
export function drawCompletionVoice(rng: MsvcRandom): number {
  return COMPLETION_VOICES.first + rng.range(0, COMPLETION_VOICES.last - COMPLETION_VOICES.first);
}

/**
 * Variante de la scénette d'avant la relance `DS:74ae` (`10e8:0415`) : niveau 0 : 0 à la première visite (`S+0x3A & 0xfff ≤ 1`, le mot de mémoire de dialogue
 * de l'écran, déjà compté par `1168:5c57`), sinon `rand(0..2) + 1` ; niveaux 1 à 3 : 4, 5, 6. **Point ouvert 3, tranché** : `S+0x3A` est ce compteur de visites ; l'état
 * le porte déjà (`dialogMemory`), aucun octet à ajouter.
 */
export function introVariant(rng: MsvcRandom, level: Level, visits: number): number {
  if (level === 0) return visits > 1 ? rng.range(0, 2) + 1 : 0;
  return level + 3;
}

/**
 * Scénette d'explication jouée **après** la relance (`10e8:0b80` à `0c43`) : niveau 0 à la première visite (variante 0), niveaux 1 et 2 toujours (variantes 4 et 5) ;
 * sinon aucune (le cadran de l'horloge démarre tout de suite). **Probable** : l'enchaînement exact dépend de `DS:74b0` et d'un minuteur de 180 ticks.
 */
export function explanationScript(level: Level, variant: number): number | null {
  if (level === 3) return null;
  return variant === 0 || variant === 4 || variant === 5 ? EXPLAIN_SCRIPT + level : null;
}

/** Réplique à `DS:74ee == 9` (`rand(0..2)`). */
export function drawWarningScript(rng: MsvcRandom): number {
  return WARNING_SCRIPT + rng.range(0, 2);
}

export function drawVictoryScript(rng: MsvcRandom): number {
  return VICTORY_SCRIPT + rng.range(0, 2);
}

export function drawDefeatScript(rng: MsvcRandom): number {
  return DEFEAT_SCRIPT + rng.range(0, 3);
}

// --- Robot ---

/**
 * Plan de rangement qui ne se trompe jamais (robot de partie, vague J) : un axe par attribut choisi, chaque valeur du groupe a sa case sur l'axe, dans l'ordre de première
 * apparition ; au niveau 2 la disposition cachée (`hidden`) est utilisée pour ne jamais viser une chambre bloquée. Renvoie la chambre de chaque membre, dans l'ordre du groupe.
 */
export function robotPlan(state: HotelState): number[] {
  const slots: Map<number, number>[] = Array.from({ length: state.axes }, () => new Map<number, number>());
  for (let axis = 0; axis < state.axes; axis++) {
    if (state.hidden) {
      const order = axis === 0 ? state.hidden.a : state.hidden.b;
      order.forEach((value, index) => slots[axis]!.set(value, index));
    }
    for (let member = 0; member < state.group.length; member++) {
      const value = memberValues(state, member)[axis]!;
      if (!slots[axis]!.has(value)) slots[axis]!.set(value, slots[axis]!.size);
    }
  }
  return state.group.map((_traits, member) => {
    const values = memberValues(state, member);
    return roomOfAxes(
      state.level,
      values.map((value, axis) => slots[axis]!.get(value)!),
    );
  });
}

/** Range tout le groupe par `robotPlan` ; renvoie les résultats de chaque pose. */
export function robot(state: HotelState): PlaceResult[] {
  const plan = robotPlan(state);
  return plan.map((room, member) => place(state, member, room));
}
