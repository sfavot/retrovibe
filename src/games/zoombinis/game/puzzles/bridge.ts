import type { MsvcRandom } from "../../../../engine/mohawk/rng";
import type { Attrs } from "../state";

/**
 * Règles des gorges allergiques (`BRIDGE.MHK`, écran 7 ; `docs/zoombinis/puzzles/bridge.md`) : la règle cachée tirée à l'entrée, l'acceptation
 * d'un Zoombini par un pont, les six refus qui ferment les ponts, les sauvés et les perdus, le robot. Fonctions pures sur `BridgeState` : aucun
 * rendu, aucun service, aucun texte. Le hasard vient d'un `MsvcRandom` injecté, tiré **dans l'ordre de l'original** (`10c0:131a`, voir
 * `drawRule`).
 *
 * Adresses : `10c0:*` est le segment de code de l'écran, `DS:` le segment de données du jeu (`1530`). Ghidra inverse l'ordre des arguments pascal
 * (`docs/zoombinis/engine.md` §0) : `10a8:04e8(max, min)` en signature Ghidra = `rng.range(min, max)`.
 *
 * Conventions :
 *  - niveau 0 à 3 (comme `currentLevel` de `route.ts`) = `DS:7060` ;
 *  - pont 1 = haut (`SCRB` 1300), pont 2 = bas (`SCRB` 1301) : le numéro de zone de dépôt de `10c0:2059` ;
 *  - attribut 1 à 4 = octet 0 à 3 de la fiche (cheveux, yeux, nez, pieds) ; la candidate de `131a` est un dword dont l'octet de poids fort porte
 *    l'attribut 1 et l'octet de poids faible l'attribut 4 (la fiche est relue octet par octet puis recomposée en gros-boutiste).
 *
 * Écarts avec l'original (sans effet sur les règles) :
 *  - le temps (45 ticks entre deux départs, période d'animation d'attente) et la mise en scène sont laissés à la scène ; le module n'exporte
 *    que les constantes et les conditions de départ (`canStartDecision`) ;
 *  - la boucle infinie de `131a` quand aucune candidate n'a l'effectif cherché (impossible avec des fiches de valeurs 1 à 5 et au moins une) est
 *    remplacée par une erreur ;
 *  - `DS:96ec` / `96f0` (mémoire du niveau 0 relue par `1190:2748`, grottes) sont rendus par `drawRule` (`previous`) et non écrits dans un tampon global.
 */

// --- Constantes de l'original ---

/** Niveaux (0 à 3). */
export type BridgeLevel = 0 | 1 | 2 | 3;
/** Pont : 1 = haut, 2 = bas (zones de dépôt `SCRB` 1300 et 1301). */
export type Bridge = 1 | 2;
/** Erreurs qui ferment les ponts (`DS:7068` plafonné à 6, `10c0:1255`). */
export const MAX_ERRORS = 6;
/** Délai minimal entre deux départs de décision, en ticks (`10c0:0014 < 0x2d`). */
export const START_GAP_TICKS = 45;
/** Refus simultanés au plus (`DS:707c > 4` bloque un refus). */
export const MAX_PENDING_REFUSALS = 5;
/** Période des animations des Zoombinis qui ont traversé : 60 ticks, 120 avec « moins d'action » (`10c0:002b`, `DS:908a`). */
export const CELEBRATION_PERIOD = 60;
export const CELEBRATION_PERIOD_LESS_ACTION = 120;
/** Demi-côté de la zone de prise des ponts (`DS:9706 = 0x37`, `10c0:002b`). */
export const GRAB_RADIUS = 55;
/** Zone de transport d'un Zoombini (`DS:0ac0`) : la moitié gauche de l'écran. */
export const CARRY_BOUNDS = { left: 0, top: 0, right: 280, bottom: 480 } as const;
/** Points d'accroche des ponts (`DS:0b08`) : là où commence le script de traversée (haut, bas). */
export const BRIDGE_ANCHORS: Readonly<Record<Bridge, { x: number; y: number }>> = {
  1: { x: 116, y: 104 },
  2: { x: 128, y: 203 },
};
/** Falaise de gauche où un Zoombini refusé revient (`DS:0ab0` haut, `DS:0ab8` bas) : (gauche, haut, droite, bas). */
export const RETURN_RECTS: Readonly<Record<Bridge, Rect>> = {
  1: { left: 10, top: 50, right: 57, bottom: 105 },
  2: { left: 10, top: 165, right: 65, bottom: 212 },
};
/** Les seize places d'attente (`DS:0ac8`), dans l'ordre : le membre `i` du groupe se tient sur la place `i`. */
export const WAITING_PLACES: readonly Point[] = [
  { x: 176, y: 304 },
  { x: 169, y: 327 },
  { x: 144, y: 283 },
  { x: 147, y: 355 },
  { x: 124, y: 318 },
  { x: 119, y: 379 },
  { x: 108, y: 284 },
  { x: 99, y: 345 },
  { x: 88, y: 414 },
  { x: 69, y: 262 },
  { x: 79, y: 303 },
  { x: 78, y: 370 },
  { x: 61, y: 346 },
  { x: 45, y: 301 },
  { x: 36, y: 359 },
  { x: 30, y: 404 },
];
/** Places d'arrivée sur la falaise de droite (`seg130:0x20 + 4k` pour le pont du haut, `0x80 + 4k` pour le bas), dans l'ordre d'arrivée. */
export const ARRIVAL_PLACES: Readonly<Record<Bridge, readonly Point[]>> = {
  1: [
    { x: 618, y: 45 },
    { x: 582, y: 49 },
    { x: 552, y: 36 },
    { x: 524, y: 32 },
    { x: 493, y: 25 },
    { x: 464, y: 27 },
    { x: 422, y: 36 },
    { x: 618, y: 86 },
    { x: 588, y: 81 },
    { x: 556, y: 76 },
    { x: 615, y: 129 },
    { x: 580, y: 122 },
    { x: 550, y: 116 },
    { x: 522, y: 112 },
    { x: 493, y: 106 },
    { x: 530, y: 69 },
  ],
  2: [
    { x: 610, y: 369 },
    { x: 593, y: 340 },
    { x: 579, y: 303 },
    { x: 549, y: 290 },
    { x: 522, y: 281 },
    { x: 492, y: 271 },
    { x: 621, y: 319 },
    { x: 602, y: 283 },
    { x: 573, y: 267 },
    { x: 533, y: 248 },
    { x: 622, y: 257 },
    { x: 596, y: 242 },
    { x: 561, y: 235 },
    { x: 621, y: 197 },
    { x: 594, y: 187 },
    { x: 566, y: 178 },
  ],
};

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// --- Règle ---

/** Une condition de la règle : le Zoombini porte la valeur `value` (1 à 5) de l'attribut `attr` (1 à 4). */
export interface Condition {
  attr: 1 | 2 | 3 | 4;
  value: number;
}

/** La règle cachée (`DS:7092…`) : l'ensemble des conditions (OU) et le pont qui accepte les Zoombinis qui en vérifient une. */
export interface BridgeRule {
  conditions: Condition[];
  /** `DS:7094` : vrai = le pont du haut accepte ceux qui vérifient la règle (et le pont du bas tous les autres) ; faux = l'inverse. */
  upperAccepts: boolean;
}

/** Valeurs des paires du niveau 1 (`DS:0b1e`) : nibble haut = première valeur, nibble bas = seconde. */
const PAIRS = [0x12, 0x13, 0x14, 0x15, 0x23, 0x24, 0x25, 0x34, 0x35, 0x45] as const;
/** Niveau 2 : unité de l'attribut « base » (`DS:0b46`) et de l'attribut « pas » (`DS:0b5e`) de chacune des six paires d'octets. */
const PAIR_BASES = [1, 1, 1, 0x100, 0x100, 0x10000] as const;
const PAIR_STEPS = [0x100, 0x10000, 0x1000000, 0x10000, 0x1000000, 0x1000000] as const;
/** Niveau 3 : octets de chacun des quatre triplets (le plus petit varie le plus vite), `local_20` = 0 à 3 de `131a`. */
const TRIPLES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 1, 3],
  [0, 2, 3],
  [1, 2, 3],
];

/**
 * Les candidates de `131a` dans l'ordre d'énumération (celui du tirage uniforme parmi les égalités) :
 *  - niveau 0 (20) : octet 0 à 3, valeur 1 à 5 ;
 *  - niveau 1 (40) : octet 0 à 3, paire de `PAIRS` ;
 *  - niveau 2 (150) : paire d'octets, valeur du « pas » (1 à 5), valeur de la « base » (1 à 5) ;
 *  - niveau 3 (500) : triplet d'octets, puis 5 × 5 × 5 (compteur à trois chiffres, le plus petit octet varie le plus vite).
 */
export function candidates(level: BridgeLevel): number[] {
  const out: number[] = [];
  switch (level) {
    case 0:
      for (let byte = 0; byte < 4; byte++) for (let v = 1; v <= 5; v++) out.push((v << (8 * byte)) >>> 0);
      break;
    case 1:
      for (let byte = 0; byte < 4; byte++) for (const pair of PAIRS) out.push((pair << (8 * byte)) >>> 0);
      break;
    case 2:
      for (let k = 0; k < 6; k++) {
        const base = PAIR_BASES[k]!;
        const step = PAIR_STEPS[k]!;
        for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) out.push((step * i + base * j) >>> 0);
      }
      break;
    case 3:
      for (const [low, mid, high] of TRIPLES) {
        for (let c = 1; c <= 5; c++) {
          for (let b = 1; b <= 5; b++) {
            for (let a = 1; a <= 5; a++) out.push(((a << (8 * low)) | (b << (8 * mid)) | (c << (8 * high))) >>> 0);
          }
        }
      }
      break;
  }
  return out;
}

/** La fiche (attributs 1 à 4) vue comme `131a` : l'attribut 1 dans l'octet de poids fort, l'attribut 4 dans l'octet de poids faible. */
export function packAttrs(attrs: Attrs): number {
  return (((attrs[0] << 24) | (attrs[1] << 16) | (attrs[2] << 8) | attrs[3]) >>> 0);
}

/**
 * La candidate est-elle vraie pour la fiche (au moins une condition vraie, `131a`) ? Aux niveaux 0, 2 et 3 un octet compare son nibble bas ; au
 * niveau 1 chaque octet compare aussi son nibble haut (la seconde valeur de la paire). Un octet de candidate nul ne correspond jamais.
 */
export function satisfies(candidate: number, level: BridgeLevel, attrs: Attrs): boolean {
  for (let byte = 0; byte < 4; byte++) {
    const value = attrs[3 - byte]!;
    const cell = (candidate >>> (8 * byte)) & 0xff;
    if ((cell & 0xf) === value) return true;
    if (level === 1 && cell >>> 4 === value) return true;
  }
  return false;
}

/** Conditions d'une candidate, dans l'ordre de `131a` (octet 0 d'abord, c'est-à-dire attribut 4, 3, 2, 1 : sans effet, c'est un OU). */
export function conditionsOf(candidate: number, level: BridgeLevel): Condition[] {
  const out: Condition[] = [];
  for (let byte = 0; byte < 4; byte++) {
    const cell = (candidate >>> (8 * byte)) & 0xff;
    if (cell === 0) continue;
    const attr = (4 - byte) as Condition["attr"];
    out.push({ attr, value: cell & 0xf });
    if (level === 1) out.push({ attr, value: cell >>> 4 });
  }
  return out;
}

/** Ce que `drawRule` rend : la règle et ce que `131a` laisse en `DS:96ec` / `96f0` pour les grottes. */
export interface RuleDraw {
  rule: BridgeRule;
  /** Candidate retenue et effectif cible `c` (nombre de Zoombinis qui la vérifient). */
  candidate: number;
  count: number;
  /** Nombre de candidates à égalité d'effectif (le tirage uniforme se fait parmi elles). */
  ties: number;
  /** Niveau 0 et une seule candidate d'effectif `count` : `{ candidate, count }` (`DS:96ec` / `96f0`), sinon `null` (remis à 0). */
  previous: { candidate: number; count: number } | null;
}

/**
 * `10c0:131a` : tire la règle. Étapes et ordre des tirages (deux seulement) :
 *  1. effectif de chaque candidate (`candidates(niveau)`) ;
 *  2. effectif cible `c` : on teste `⌊n/2⌋`, puis le pas alterne `+1` / `−2` (`pas ← −(pas+1)`), soit `n/2, n/2+1, n/2−1, n/2, n/2−2, n/2−1, n/2−3…`,
 *     en ignorant `c = 0` et `c ≥ 16`, jusqu'à ce qu'**au moins une** candidate ait exactement `c` Zoombinis. Défaut de l'original reproduit :
 *     on ne teste jamais `n/2 + 2` ou plus (pour 16 : 8, 9, 7, 6, 5…) ;
 *  3. `rng.range(1, k)` (`10a8:04e8(k, 1)`, `k` = nombre de candidates d'effectif `c`) : la `k`-ième dans l'ordre d'énumération ;
 *  4. `rng.range(0, 1)` (`10a8:04e8(1, 0)`) : `DS:7094`, 1 = le pont du haut accepte la règle.
 */
export function drawRule(rng: MsvcRandom, level: BridgeLevel, members: readonly { attrs: Attrs }[]): RuleDraw {
  const list = candidates(level);
  const counts = list.map((candidate) => members.reduce((n, member) => n + (satisfies(candidate, level, member.attrs) ? 1 : 0), 0));
  let ties = 0;
  let target = 0;
  let c = Math.trunc(members.length / 2);
  let step = 1;
  // L'original ne se termine pas sans candidate ; au-delà de ±64 la suite n'a plus de valeur utile.
  for (let guard = 0; ties === 0; guard++) {
    if (guard > 128) throw new RangeError("drawRule : aucune candidate d'effectif utilisable");
    if (c > 0 && c < 16) {
      for (const count of counts) if (count === c) ties++;
      target = c;
    }
    c += step;
    step = -(step + 1);
  }
  let k = rng.range(1, ties);
  let picked = list[0]!;
  for (let i = 0; i < list.length; i++) {
    if (counts[i] === target && --k === 0) {
      picked = list[i]!;
      break;
    }
  }
  const upperAccepts = rng.range(0, 1) === 1;
  return {
    rule: { conditions: conditionsOf(picked, level), upperAccepts },
    candidate: picked,
    count: target,
    ties,
    previous: level === 0 && ties === 1 ? { candidate: picked, count: target } : null,
  };
}

/** Le Zoombini vérifie-t-il une condition de la règle ? */
export function matches(rule: BridgeRule, attrs: Attrs): boolean {
  return rule.conditions.some((condition) => attrs[condition.attr - 1] === condition.value);
}

/** Pont qui accepte ce Zoombini (`10c0:2059` : chacun est accepté par exactement un pont). */
export function acceptingBridge(rule: BridgeRule, attrs: Attrs): Bridge {
  const upper = matches(rule, attrs) ? rule.upperAccepts : !rule.upperAccepts;
  return upper ? 1 : 2;
}

/** `10c0:2059` : le pont `bridge` refuse-t-il ce Zoombini ? (Un numéro hors de 1 à 2 vaut 1.) */
export function isRefused(rule: BridgeRule, attrs: Attrs, bridge: number): boolean {
  return acceptingBridge(rule, attrs) !== (bridge === 2 ? 2 : 1);
}

// --- Partie ---

export interface BridgeState {
  level: BridgeLevel;
  rule: BridgeRule;
  /** Fiches du groupe, dans l'ordre des places d'attente. */
  attrs: Attrs[];
  /** `DS:7068` : refus comptés, 0 à 6. */
  errors: number;
  /** Membres qui ont traversé (ou traversent : `+0x127 ≠ 0`). */
  crossed: boolean[];
  /** Mémoire du niveau 0 laissée par le tirage pour les grottes (`DS:96ec` / `96f0`). */
  previous: RuleDraw["previous"];
}

export function createBridge(rng: MsvcRandom, level: BridgeLevel, members: readonly { attrs: Attrs }[]): BridgeState {
  const draw = drawRule(rng, level, members);
  return {
    level,
    rule: draw.rule,
    attrs: members.map((member) => member.attrs),
    errors: 0,
    crossed: members.map(() => false),
    previous: draw.previous,
  };
}

/** Les ponts sont fermés : six refus comptés (le clic n'est plus pris, `DS:7068 < 6` échoue). */
export function isClosed(state: BridgeState): boolean {
  return state.errors >= MAX_ERRORS;
}

export function savedCount(state: BridgeState): number {
  return state.crossed.filter(Boolean).length;
}

/** Zoombinis qui n'ont pas traversé : perdus à la sortie (`1168:36e1`). */
export function lostCount(state: BridgeState): number {
  return state.crossed.length - savedCount(state);
}

/**
 * Conditions de `10c0:05e4` pour démarrer la décision de tête : ponts ouverts (`7068 < 6`), pas de refus si déjà 5 sont en cours
 * (`707c > 4`), et au moins 45 ticks depuis le dernier départ (`elapsed`).
 */
export function canStartDecision(state: BridgeState, refused: boolean, pending: number, elapsed: number): boolean {
  if (isClosed(state)) return false;
  if (refused && pending >= MAX_PENDING_REFUSALS) return false;
  return elapsed >= START_GAP_TICKS;
}

/** Fin d'un refus (événement 20 de `0f68`) : une erreur de plus, plafonnée à 6. */
export function recordRefusal(state: BridgeState): void {
  if (state.errors < MAX_ERRORS) state.errors += 1;
}

/** Départ d'une traversée acceptée (`+0x127 = 1`). */
export function recordCrossing(state: BridgeState, member: number): void {
  state.crossed[member] = true;
}

export interface Attempt {
  member: number;
  bridge: Bridge;
  refused: boolean;
  /** Erreurs après cette décision, et ponts fermés par elle. */
  errors: number;
  closed: boolean;
}

/**
 * Pose le membre `member` sur le pont `bridge` et applique tout de suite la décision (sans le temps de la scène) : accepté, il a traversé ;
 * refusé, une erreur de plus. Rend `null` si les ponts sont fermés ou si le membre a déjà traversé.
 */
export function attempt(state: BridgeState, member: number, bridge: Bridge): Attempt | null {
  if (isClosed(state) || state.crossed[member]) return null;
  const refused = isRefused(state.rule, state.attrs[member]!, bridge);
  if (refused) recordRefusal(state);
  else recordCrossing(state, member);
  return { member, bridge, refused, errors: state.errors, closed: isClosed(state) };
}

// --- Robot ---

export interface Placement {
  member: number;
  bridge: Bridge;
}

/** Robot de partie : pose chaque membre qui n'a pas traversé sur le pont qui l'accepte (aucune erreur). */
export function solve(state: BridgeState): Placement[] {
  const moves: Placement[] = [];
  state.attrs.forEach((attrs, member) => {
    if (!state.crossed[member]) moves.push({ member, bridge: acceptingBridge(state.rule, attrs) });
  });
  return moves;
}

/** Applique `solve` à la partie en cours ; rend les poses faites. */
export function robot(state: BridgeState): Placement[] {
  const moves = solve(state);
  for (const move of moves) attempt(state, move.member, move.bridge);
  return moves;
}

// --- Animations d'attente des Zoombinis qui ont traversé (`10c0:05e4`, `10c0:0f68`) ---

/** Période entre deux animations : 60 ticks, 120 avec « moins d'action » (`DS:908a`). */
export function celebrationPeriod(lessAction: boolean): number {
  return lessAction ? CELEBRATION_PERIOD_LESS_ACTION : CELEBRATION_PERIOD;
}

/**
 * Quota d'animations (`DS:70b8`) gagné quand le `count`-ième Zoombini a traversé : +1 au 10e et au 12e, +2 au 14e, +2 au dernier
 * (`count` = taille du groupe).
 */
export function celebrationQuotaGain(count: number, size: number): number {
  let gain = 0;
  if (count === 10 || count === 12) gain += 1;
  else if (count === 14) gain += 2;
  if (count === size) gain += 2;
  return gain;
}

// --- Retour d'un Zoombini refusé (`1168:5482`) ---

/**
 * Place où un Zoombini refusé retourne dans la falaise de gauche (`1168:5482(0x24, 1, rect, objet)`, `DS:2396 = 0`) : grille de 5 colonnes × 4 rangées
 * parcourue colonne par colonne (`DI` 1 à 5, puis `SI` 1 à 4), avec une secousse horizontale de 0 à 5 pixels (`rng.range(0, 5)`, un tirage par
 * case essayée) ; la première case à plus de 6 pixels de tous les `others` est prise. Si toutes sont prises, la dernière case essayée (**probable** :
 * l'original garde alors l'ancienne destination).
 */
export function returnSpot(rng: MsvcRandom, rect: Rect, others: readonly Point[]): Point {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const half = Math.trunc(width / 10);
  let spot: Point = { x: rect.left, y: rect.top };
  for (let row = 1; row <= 4; row++) {
    for (let column = 1; column <= 5; column++) {
      let x = rng.range(0, 5) + Math.trunc((width * column) / 5) + rect.left;
      if ((row & 1) === 0) x += half;
      const y = rect.top + Math.trunc((height * row) / 4);
      spot = { x: Math.max(0, Math.min(640, x)), y: Math.max(0, Math.min(480, y)) };
      if (!others.some((other) => (spot.x - other.x) ** 2 + (spot.y - other.y) ** 2 < 36)) return spot;
    }
  }
  return spot;
}

/** Fiche d'un script de traversée : base des `SCRS` (`10c0:05e4`), +1 pour le pied (1 à 5) moins 1. */
export const CROSSING_SCRIPTS = {
  /** Refus au pont du bas / du haut, accepté au bas / au haut. */
  refusedLower: 2000,
  acceptedLower: 2005,
  refusedUpper: 2010,
  acceptedUpper: 2015,
} as const;

/** `SCRS` de la traversée d'un Zoombini de pied `feet` (1 à 5) sur le pont `bridge`. */
export function crossingScript(bridge: Bridge, refused: boolean, feet: number): number {
  const base =
    bridge === 1
      ? refused
        ? CROSSING_SCRIPTS.refusedUpper
        : CROSSING_SCRIPTS.acceptedUpper
      : refused
        ? CROSSING_SCRIPTS.refusedLower
        : CROSSING_SCRIPTS.acceptedLower;
  return base + feet - 1;
}

/** Premier `SCRS` d'éternuement par type (1 à 5) pour le pont du bas (`10c0:0f89` : 1016, 1012, 1008, 1000, 1004 ; +2 au pont du haut ; +0 ou 1 au hasard). */
const SNEEZE_BASES: Readonly<Record<number, number>> = { 1: 1016, 2: 1012, 3: 1008, 4: 1000, 5: 1004, 6: 1016 };

/** `SCRS` de réaction (1000 à 1019) pour le type d'éternuement posé par le visage ; `variant` = tirage de 0 à 1. */
export function sneezeScript(type: number, bridge: Bridge, variant: number): number {
  return (SNEEZE_BASES[type] ?? SNEEZE_BASES[1]!) + (bridge === 1 ? 2 : 0) + variant;
}

/** Point où l'éternuement envoie le Zoombini (haut, bas) : fin du script de réaction (`10c0:0f89`). */
export const SNEEZE_POINTS: Readonly<Record<Bridge, Point>> = {
  1: { x: 38, y: 106 },
  2: { x: 56, y: 205 },
};

/**
 * Type d'éternuement (1 à 5) que le visage de la falaise annonce au n-ième refus (`SCRB` 1208 à 1213 en bas, 1223 à 1228 en haut ; terminateurs 1 à 5
 * de leur troisième image, lus par `10c0:0e5a` dans `DS:7090`). Le type est donc **déterministe** par numéro d'erreur ; la scène le lit des `SCRB`
 * eux-mêmes, cette table sert de repli (et de contrôle dans les tests).
 */
export const FACE_SNEEZE_TYPES: Readonly<Record<Bridge, readonly number[]>> = {
  1: [2, 5, 1, 4, 3, 2],
  2: [1, 2, 3, 4, 5, 1],
};

export function faceSneezeType(bridge: Bridge, errors: number): number {
  return FACE_SNEEZE_TYPES[bridge][Math.max(0, Math.min(errors, MAX_ERRORS - 1))]!;
}
