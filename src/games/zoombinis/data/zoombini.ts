/**
 * Un Zoombini (« snoid ») à l'écran : composition de ses parties à partir d'une image de `SCRS`, et pas de marche sur `NODE` / `PATH`
 * (`docs/zoombinis/engine.md` §3.6 et §4.2). Module pur, sans DOM : il ne lit pas d'archive, on lui donne les `SCRS` décodés
 * (`script.ts`) et les ancres `REGS` (`regs.ts`).
 *
 * ## Composition (`1168:4741`, tables de `1168:4dc9`)
 *
 * Un Zoombini a 4 attributs de valeur 1 à 5 : cheveux, yeux, nez, pieds (octets 0 à 3 de la fiche, `+0xbc` à `+0xbf` du snoid).
 * Une image de `SCRS` liste des parties `(w, x, y)` **par emplacement** (le rang de la case dans l'image, cases vides comprises) :
 * `w` n'est pas un indice de planche mais un numéro de variante **relatif à la famille** de l'emplacement. Le moteur y ajoute une
 * base propre à la famille (corps 0, cheveux, yeux, nez, pieds : tables `DS:0306…` de la planche), puis prend l'image
 * `2 × variante − 1` de la planche (Zoombini tourné vers la droite) ou `2 × variante` (tourné vers la gauche, drapeau `+0xf2`).
 * Le mot de pose du `SCRS` ne fait que choisir **quelle famille occupe quel emplacement** (ordre de superposition).
 *
 * Trois planches `tBMP` de `ZOOMBINI.MHK` : 3000 (grande, `REGS` 100 / 101) pour les scripts communs 100 à 150 et les scripts « normaux »
 * des épreuves, 3100 (`REGS` 102 / 103) pour les scripts « de rejet » (états 9), 3200 (petite, `REGS` 3200 / 3201) qui remplace 3000
 * dans les écrans HOTEL, TOWN et XFER (`1168:5a13`).
 */
import type { NodePoint } from "./node-path";
import type { Anchors } from "./regs";
import { snoidVoiceCode, type ScriptCell, type ScriptImage } from "./script";

// ---------------------------------------------------------------------------------------------------------------------------
// Attributs

/** Nombre de valeurs de chaque attribut (1 à 5) et de Zoombinis différents (5⁴). */
export const ZOOMBINI_VALUES = 5;
export const ZOOMBINI_COUNT = 625;

/** Un Zoombini : les 4 attributs (1 à 5) et les 10 octets d'état de la fiche (octets 9 à 18). */
export interface ZoombiniTraits {
  /** Octet 0 (`+0xbc`) : cheveux. Désigne aussi le type de voix (1 à 5). */
  hair: number;
  /** Octet 1 (`+0xbd`) : yeux. */
  eyes: number;
  /** Octet 2 (`+0xbe`) : nez. Désigne aussi la variante de voix dans le type (1 à 5). */
  nose: number;
  /** Octet 3 (`+0xbf`) : pieds. Choisit le script de marche (§3.6). */
  feet: number;
  /** Octets 9 à 18 de la fiche, recopiés tels quels en `+0xf9…+0x102` ; aucun code lu ne les emploie (réservés). */
  state: readonly number[];
}

/** Taille de la fiche d'un Zoombini du groupe courant (`S+0xA92E`, `screens.md` §6.3). */
export const ZOOMBINI_RECORD_SIZE = 19;

/** Décode une fiche de 19 octets (ou ses 4 premiers octets seuls) : 0 à 3 = attributs, 9 à 18 = état. */
export function traitsFromRecord(record: Uint8Array): ZoombiniTraits {
  if (record.length < 4) throw new Error("fiche de Zoombini trop courte");
  return {
    hair: record[0]!,
    eyes: record[1]!,
    nose: record[2]!,
    feet: record[3]!,
    state: record.length >= ZOOMBINI_RECORD_SIZE ? [...record.subarray(9, 19)] : new Array<number>(10).fill(0),
  };
}

/** Numéro de 0 à 624 d'un Zoombini : `a0 × 125 + a1 × 25 + a2 × 5 + a3` avec `ai = valeur − 1` (`1128:13a4`, tableau `S+0xAB94`). */
export function traitsIndex(traits: Pick<ZoombiniTraits, "hair" | "eyes" | "nose" | "feet">): number {
  return (traits.hair - 1) * 125 + (traits.eyes - 1) * 25 + (traits.nose - 1) * 5 + (traits.feet - 1);
}

/** Réciproque de `traitsIndex`. */
export function traitsFromIndex(index: number): ZoombiniTraits {
  if (!Number.isInteger(index) || index < 0 || index >= ZOOMBINI_COUNT) throw new RangeError(`numéro de Zoombini hors 0..624 : ${index}`);
  return {
    hair: Math.floor(index / 125) + 1,
    eyes: (Math.floor(index / 25) % 5) + 1,
    nose: (Math.floor(index / 5) % 5) + 1,
    feet: (index % 5) + 1,
    state: new Array<number>(10).fill(0),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Planches, bases et poses

export type SnoidSheet = 3000 | 3100 | 3200;

/**
 * Famille de scripts, d'après l'état `+0xf4` du snoid :
 * - `base` : états 0 à 7 et 10, scripts communs 100 à 150 (`DS:9754`) ; planche 3000 (ou 3200) ;
 * - `normal` : état 8, scripts `NORMAL` d'un écran (`1168:04d0`, deuxième plage) ; planche 3000 (ou 3200) ;
 * - `reject` : état 9, scripts `REJECT` d'un écran (`1168:03ef`, première plage) ; planche 3100, jusqu'à 16 parties.
 */
export type SnoidKind = "base" | "normal" | "reject";

/** Bases de variantes par famille et par valeur d'attribut (index 0 inutilisé, valeurs 1 à 5) : `DS:0306…035a` du segment `14c0`. */
interface BaseTables {
  feet: readonly number[];
  nose: readonly number[];
  eyes: readonly number[];
  hair: readonly number[];
}

/** Planche 3000 (`14c0:0306`, `0312`, `031e`, `032a`). Corps = variantes 1 à 11 (base 0). */
export const TABLES_LARGE: BaseTables = {
  feet: [0, 191, 246, 335, 360, 411],
  nose: [0, 171, 175, 179, 183, 187],
  eyes: [0, 91, 107, 123, 139, 155],
  hair: [0, 11, 27, 43, 59, 75],
};

/** Planche 3200 (`14e0:0082`, `008e`, `009a`, `00a6`) : copiées sur les tables précédentes par `1168:5a13(0)`. */
export const TABLES_SMALL: BaseTables = {
  feet: [0, 131, 174, 227, 235, 278],
  nose: [0, 111, 115, 119, 123, 127],
  eyes: [0, 91, 95, 99, 103, 107],
  hair: [0, 11, 27, 43, 59, 75],
};

/** Planche 3100, scripts de rejet (`14c0:0336`, `0342`, `034e`, `035a`) : 18 variantes par valeur, corps = variantes 1 à 18. */
export const TABLES_REJECT: BaseTables = {
  feet: [0, 288, 306, 324, 342, 360],
  nose: [0, 198, 216, 234, 252, 270],
  eyes: [0, 108, 126, 144, 162, 180],
  hair: [0, 18, 72, 36, 54, 90],
};

/** Nombre d'emplacements du tableau de bases `+0xc2…+0xe0` (`1168:09f7` les met à 0). */
const BASE_SLOTS = 16;

/** Planche utilisée : 3100 pour `reject`, sinon 3000 ou, dans le mode petit des écrans HOTEL / TOWN / XFER, 3200. */
export function snoidSheet(kind: SnoidKind, small = false): SnoidSheet {
  return kind === "reject" ? 3100 : small ? 3200 : 3000;
}

function tablesFor(kind: SnoidKind, small: boolean): BaseTables {
  return kind === "reject" ? TABLES_REJECT : small ? TABLES_SMALL : TABLES_LARGE;
}

/**
 * Tableau des bases de variantes d'un Zoombini pour une pose (`1168:4dc9`) : `bases[0]` est `+0xc2` (jamais écrit : 0),
 * `bases[1]` est `+0xc4`, … `bases[5]` est `+0xcc`, le reste vaut 0 (indice de planche absolu).
 *
 * | Pose | Emplacements 1 à 5 (de l'arrière vers l'avant) |
 * |---|---|
 * | 0 | pieds, corps, nez, yeux, cheveux |
 * | 1 | pieds, nez, corps, yeux, cheveux (le nez est caché par le corps : Zoombini vu de dos) |
 * | 2 | corps, yeux, nez, pieds, cheveux |
 *
 * Pour les autres poses (3 et `0xffff` : Fleens des scripts d'épreuve), le moteur ne touche pas aux bases : **hypothèse**, elles
 * restent à 0 (indices de planche bruts).
 */
export function snoidBases(traits: Pick<ZoombiniTraits, "hair" | "eyes" | "nose" | "feet">, pose: number | undefined, kind: SnoidKind = "base", small = false): number[] {
  const t = tablesFor(kind, small);
  const feet = t.feet[traits.feet] ?? 0;
  const nose = t.nose[traits.nose] ?? 0;
  const eyes = t.eyes[traits.eyes] ?? 0;
  const hair = t.hair[traits.hair] ?? 0;
  const bases = new Array<number>(BASE_SLOTS).fill(0);
  if (pose === 0) bases.splice(1, 5, feet, 0, nose, eyes, hair);
  else if (pose === 1) bases.splice(1, 5, feet, nose, 0, eyes, hair);
  else if (pose === 2) bases.splice(1, 5, 0, eyes, nose, feet, hair);
  return bases;
}

/** Image de la planche pour une variante : `2 × variante − 1` (droite, `+0xf2 = 0`) ou `2 × variante` (gauche, `+0xf2 = 1`). */
export function snoidImageIndex(variant: number, facing: 0 | 1 = 0): number {
  return 2 * variant - 1 + facing;
}

/** Une partie à dessiner : image 1-based de la planche, position écran (ancres `REGS` déjà retranchées). */
export interface SnoidPart {
  sheet: SnoidSheet;
  index: number;
  x: number;
  y: number;
}

/** Ancres `REGS` des planches : 3000 = REGS 100 / 101, 3100 = REGS 102 / 103, 3200 = REGS 3200 / 3201. */
export interface SnoidAnchors {
  3000: Anchors;
  3100: Anchors;
  3200?: Anchors;
}

/** `REGS` de chaque planche des Zoombinis dans `ZOOMBINI.MHK` : couple (X, Y). */
export const SNOID_REGS_IDS: Readonly<Record<SnoidSheet, readonly [number, number]>> = {
  3000: [100, 101],
  3100: [102, 103],
  3200: [3200, 3201],
};

export interface ComposeOptions {
  /** Famille du script (défaut `base`). */
  kind?: SnoidKind;
  /** Mot de pose du `SCRS` (`Script.pose`). */
  pose: number | undefined;
  /** 0 = tourné vers la droite (image impaire), 1 = vers la gauche (image paire), `+0xf2`. Défaut 0. */
  facing?: 0 | 1;
  /** Mode petit (planche 3200) pour les familles `base` et `normal`. Défaut faux. */
  small?: boolean;
  /** Décalage ajouté aux positions du script : position du Zoombini (`+0xa6`, `+0xa8`) pour `base`, `scriptAnchorOffset` pour `normal` / `reject`. Défaut (0, 0). */
  origin?: { x: number; y: number };
  /** Ancres `REGS`. Sans elles les positions restent celles du script (plus l'origine). */
  anchors?: SnoidAnchors;
}

/** Rang de l'emplacement 0 dans le tableau de bases : décalé quand la famille `reject` commence par une partie de numéro ≥ 0x13 (`1168:4741`). */
function baseShift(kind: SnoidKind, cells: readonly ScriptCell[]): number {
  return kind === "reject" && (cells[0]?.w ?? 0) >= 0x13 ? 0 : 1;
}

/**
 * Parties à dessiner d'une image de `SCRS` pour un Zoombini (`1168:4741`).
 *
 * `cells` doit être **toute** l'image (`ScriptImage.cells`, cases vides comprises) et non `visibleCells` : l'emplacement d'une partie
 * est le rang de sa case. Les cases vides (`w == 0`) ne produisent rien. Position écran de chaque partie :
 * `origin + (x, y) − ancre REGS[image]`. L'ordre de sortie est l'ordre de dessin (de l'arrière vers l'avant).
 *
 * La famille `base` lit au plus 5 parties et `normal` 5, `reject` 16 : au-delà les cases sont ignorées (comme la boucle du moteur,
 * qui s'arrête avant de lire un terminateur manquant).
 */
export function composeSnoidCells(traits: ZoombiniTraits, cells: readonly ScriptCell[], options: ComposeOptions): SnoidPart[] {
  const kind = options.kind ?? "base";
  const small = options.small ?? false;
  const facing = options.facing ?? 0;
  const sheet = snoidSheet(kind, small);
  const anchors = options.anchors?.[sheet];
  const bases = snoidBases(traits, options.pose, kind, small);
  const shift = baseShift(kind, cells);
  const slots = kind === "reject" ? 16 : 6;
  const ox = options.origin?.x ?? 0;
  const oy = options.origin?.y ?? 0;
  const parts: SnoidPart[] = [];
  for (let slot = 0; slot < cells.length && slot < slots; slot++) {
    const cell = cells[slot]!;
    if (cell.w <= 0) continue;
    const index = snoidImageIndex((bases[slot + shift] ?? 0) + cell.w, facing);
    parts.push({ sheet, index, x: ox + cell.x - (anchors?.x[index] ?? 0), y: oy + cell.y - (anchors?.y[index] ?? 0) });
  }
  return parts;
}

/** `composeSnoidCells` sur une image décodée. */
export function composeSnoidImage(traits: ZoombiniTraits, image: ScriptImage, options: ComposeOptions): SnoidPart[] {
  return composeSnoidCells(traits, image.cells, options);
}

/**
 * Décalage des scripts `normal` et `reject` (`1168:3f76`) : le script est posé de façon que la première partie de l'image de
 * référence tombe sur `anchor`. Sans point d'arrivée (`anchor` absent), la référence est l'image 0 et `anchor` la position
 * courante du Zoombini : il démarre là. Avec un point d'arrivée, la référence est la **dernière** image dont la première case
 * est une partie : le script finit sur ce point. Renvoie `anchor − première partie` (= `−(+0xaa, +0xac)`), à passer en `origin`.
 */
export function scriptAnchorOffset(images: readonly ScriptImage[], anchor: { x: number; y: number }, fromEnd: boolean): { x: number; y: number } {
  const candidates = fromEnd ? [...images].reverse() : images;
  const reference = candidates.find((image) => (image.cells[0]?.w ?? 0) > 0) ?? images[0];
  const first = reference?.cells[0];
  if (!first || first.w <= 0) return { x: 0, y: 0 };
  return { x: anchor.x - first.x, y: anchor.y - first.y };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Scripts communs

/** Premier id des 51 `SCRS` communs de `ZOOMBINI.MHK` (`1168:0376`). */
export const SNOID_SCRIPT_FIRST = 100;
export const SNOID_SCRIPT_COUNT = 51;

/** Script de marche : `100 + 5 × pieds + secteur` (`1168:2b30`, `1168:4231` état 7), pieds 1 à 5, secteur 0 à 4 : ids 105 à 129. */
export function snoidWalkScriptId(feet: number, sector: number): number {
  return SNOID_SCRIPT_FIRST + 5 * feet + sector;
}

/** Script d'animation propre aux pieds (état 5 de `1168:4231`) : `145 + pieds`, ids 146 à 150. */
export function snoidFeetScriptId(feet: number): number {
  return SNOID_SCRIPT_FIRST + 45 + feet;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Voix

/** Id de départ de chaque code de voix 0 à 15 (`1168:575b`). Le code 16 tire au hasard dans 1800…1814, le code 17 vaut 99 sans décalage. */
export const SNOID_VOICE_BASES = [100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 475, 450, 425] as const;
/** Décalage selon le type de voix (valeur des cheveux 1 à 5). */
export const SNOID_VOICE_TYPE_OFFSETS = [0, 0, 5, 20, 15, 10] as const;

/** Id du son `\0SND` d'un code de voix pour ce Zoombini : `base + décalage(cheveux) + nez − 1`. `random(min, max)` : entier inclus (`10a8:04e8`). */
export function snoidVoiceId(code: number, traits: Pick<ZoombiniTraits, "hair" | "nose">, random: (min: number, max: number) => number): number {
  if (code === 16) return random(1800, 1814);
  if (code === 17) return 99;
  const base = SNOID_VOICE_BASES[code];
  if (base === undefined) return 0;
  return base + (SNOID_VOICE_TYPE_OFFSETS[traits.hair] ?? 0) + traits.nose - 1;
}

/** Id de son d'un numéro d'évènement de terminateur de `SCRS` (octet bas `0xc9`…`0xda`, 18 codes dont le dernier vaut 17) ; `undefined` si ce n'est pas une voix. */
export function snoidVoiceIdForEvent(event: number, traits: Pick<ZoombiniTraits, "hair" | "nose">, random: (min: number, max: number) => number): number | undefined {
  const code = event === 0xda ? 17 : snoidVoiceCode(event);
  return code === undefined ? undefined : snoidVoiceId(code, traits, random);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Marche (1168:2b30, 1168:2f9f, 1168:0ba8 état 0x70)

export interface Point {
  x: number;
  y: number;
}

/** Entier 16 bits signé (les mots du moteur). */
function int16(value: number): number {
  return (value << 16) >> 16;
}

/** Les 5 secteurs de pente : (`pas x`, `pas y`) = `local_1a`, `local_1c` de `1168:2b30`. */
export const WALK_SECTOR_STEPS: readonly (readonly [number, number])[] = [
  [5, -15],
  [13, -10],
  [16, 8],
  [13, 10],
  [5, 15],
];

/**
 * Secteur de direction d'un trajet (`1168:2b30`). `dx = cible.x − x`, `dyUp = y − cible.y` (positif vers le haut de l'écran).
 * La pente `1024 × dyUp / |dx|` (tronquée à 16 bits comme le moteur) est classée : `< −1408` → 0 (descend à pic), `< −331` → 1
 * (descend en diagonale), `< 332` → 2 (presque à plat), `< 1409` → 3 (monte en diagonale), sinon 4 (monte à pic).
 * Les seuils valent 1024 × tan 18° et 1024 × tan 54°. `dx` nul : secteur 0 ou 4 selon `dyUp`.
 */
export function walkSector(dx: number, dyUp: number): 0 | 1 | 2 | 3 | 4 {
  const slope = dx === 0 ? (dyUp < 0 ? -0x582 : 0x582) : int16(Math.trunc((dyUp * 1024) / Math.abs(dx)));
  if (slope < -0x580) return 0;
  if (slope < -0x14b) return 1;
  if (slope < 0x14c) return 2;
  if (slope < 0x581) return 3;
  return 4;
}

/** Pas d'un trajet rectiligne : `stepX` (`+0xec`) et `stepY` (`+0xee`, positif vers le haut), seules leurs valeurs absolues servent. */
export interface WalkLeg {
  sector: 0 | 1 | 2 | 3 | 4;
  stepX: number;
  stepY: number;
}

/**
 * Pas de marche d'un trajet de `from` à `to` (`1168:2b30`, seconde moitié). `undefined` si les points sont confondus (le moteur
 * ne change rien). L'axe le plus long garde le pas du secteur (|x| ≥ |y| : `stepX` fixe), l'autre est divisé pour arriver
 * en même temps, avec au moins 1 pixel quand il reste de la distance.
 */
export function walkLeg(from: Point, to: Point): WalkLeg | undefined {
  const dx = to.x - from.x;
  const dyUp = from.y - to.y;
  if (dx === 0 && dyUp === 0) return undefined;
  const sector = walkSector(dx, dyUp);
  const [a, c] = WALK_SECTOR_STEPS[sector]!;
  const sign = (n: number) => (n < 0 ? -1 : 1);
  let stepX: number;
  let stepY: number;
  if (Math.abs(a) < Math.abs(c)) {
    stepY = c;
    const n = Math.trunc(Math.abs(dyUp) / Math.abs(c));
    stepX = n === 0 ? dx : Math.trunc(dx / n);
    if (stepX === 0 && dx !== 0) stepX = sign(dx);
  } else {
    stepX = a;
    const n = Math.trunc(Math.abs(dx) / Math.abs(a));
    stepY = n === 0 ? dyUp : Math.trunc(dyUp / n);
    if (stepY === 0 && dyUp !== 0) stepY = sign(dyUp);
  }
  return { sector, stepX, stepY };
}

/**
 * Un tick de marche vers `target` (`1168:0ba8`, état `0x70`) : avance de `min(|dx|, |stepX|)` en x et `min(|dy|, |stepY|)` en y.
 * `facing` : 1 si le Zoombini va vers la gauche, 0 vers la droite, `undefined` (inchangé) si `dx` est nul.
 */
export function walkStep(position: Point, target: Point, leg: Pick<WalkLeg, "stepX" | "stepY">): { x: number; y: number; facing: 0 | 1 | undefined } {
  const dx = target.x - position.x;
  const dyUp = position.y - target.y;
  let x = position.x;
  let y = position.y;
  let facing: 0 | 1 | undefined;
  if (dx !== 0) {
    const move = Math.min(Math.abs(dx), Math.abs(leg.stepX));
    x += dx < 0 ? -move : move;
    facing = dx < 0 ? 1 : 0;
  }
  if (dyUp !== 0) {
    const move = Math.min(Math.abs(dyUp), Math.abs(leg.stepY));
    y += dyUp < 0 ? move : -move;
  }
  return { x, y, facing };
}

/** Intervalle entre deux pas : le délai de la feature, 6 ticks de 17 ms (`1168:09f7`, `1168:0ba8`). */
export const WALK_TICKS_PER_STEP = 6;

/** Chemins d'un écran : `parseNode` et `parsePath`. Vides : pas de `NODE` / `PATH` (ligne droite vers la destination). */
export interface WalkMap {
  nodes: readonly NodePoint[];
  paths: readonly (readonly number[])[];
}

/** Position dans un chemin : numéro de chemin (`+0xeb`), rang (`+0xea`, entier 8 bits signé) et sens (`+0xf0`, 1 ou −1). */
export interface PathCursor {
  path: number;
  rank: number;
  step: number;
}

const PATH_BLOCK = 24;
const FAR = 0xf423f;

function pathByte(map: WalkMap, path: number, rank: number): number {
  return map.paths[path]?.[rank] ?? 0;
}

function squaredDistance(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Choix du chemin quand une marche commence (`1168:2f9f`) : le nœud le plus proche de la destination (ex æquo : le dernier)
 * puis, parmi les chemins qui le contiennent, le nœud du chemin le plus proche de `position`. Le rang de départ est celui
 * de ce nœud plus un ; le sens est −1 si le nœud de la destination est avant lui (et non en tête de chemin), sinon +1.
 * `undefined` : aucun chemin ne convient (le curseur précédent est alors conservé), ou la carte est vide.
 */
export function planPath(map: WalkMap, position: Point, destination: Point): PathCursor | undefined {
  if (map.nodes.length === 0 || map.paths.length === 0) return undefined;
  let nearest = 0;
  let best = FAR;
  map.nodes.forEach((node, i) => {
    const d = squaredDistance(node, destination);
    if (d <= best) {
      best = d;
      nearest = i + 1;
    }
  });
  let cursor: PathCursor | undefined;
  best = FAR;
  for (let c = 0; c < map.paths.length; c++) {
    for (let s = 0; s < PATH_BLOCK; s++) {
      if (pathByte(map, c, s) !== nearest) continue;
      for (let k = 0; k < PATH_BLOCK; k++) {
        const index = pathByte(map, c, k);
        const node = map.nodes[index - 1];
        if (index === 0 || !node) continue;
        const d = squaredDistance(node, position);
        if (d <= best) {
          best = d;
          cursor = { path: c, rank: k + 1, step: s !== 0 && s <= k ? -1 : 1 };
        }
      }
      break;
    }
  }
  return cursor;
}

/**
 * Prochain point de passage (`1168:2b30`, première moitié) : lit le nœud au rang courant puis fait avancer le rang du sens.
 * Rang négatif, fin de chemin (0) ou nœud inconnu : la destination. Sinon le nœud, sauf si la destination est plus proche
 * de `position` que lui. Renvoie la cible et le curseur mis à jour.
 */
export function nextWaypoint(map: WalkMap, cursor: PathCursor | undefined, position: Point, destination: Point): { target: Point; cursor: PathCursor | undefined } {
  if (!cursor || cursor.rank < 0) return { target: destination, cursor };
  const index = pathByte(map, cursor.path, cursor.rank);
  const next: PathCursor = { ...cursor, rank: ((cursor.rank + cursor.step) << 24) >> 24 };
  const node = map.nodes[index - 1];
  if (index === 0 || !node) return { target: destination, cursor: next };
  return { target: squaredDistance(position, destination) <= squaredDistance(position, node) ? destination : node, cursor: next };
}

/** État d'une marche (champs du snoid). */
export interface WalkState {
  /** Position courante (`+0xa6`, `+0xa8`). */
  position: Point;
  /** Destination finale (`+0xe6`, `+0xe8`). */
  destination: Point;
  /** Cible du trajet rectiligne en cours (`+0xaa`, `+0xac`). */
  target: Point;
  cursor: PathCursor | undefined;
  /** Pas du trajet en cours (`+0xec`, `+0xee`). */
  leg: Pick<WalkLeg, "stepX" | "stepY">;
  /** Secteur du trajet (`+0xf5`) ; `snoidWalkScriptId(pieds, sector)` donne le script à jouer. */
  sector: 0 | 1 | 2 | 3 | 4;
  /** Tourné vers la gauche (`+0xf2`). */
  facing: 0 | 1;
  /** Vrai quand il n'y a plus rien à parcourir. */
  arrived: boolean;
  /** Vrai à l'instant où le secteur change (le moteur recharge alors le script de marche). */
  scriptChanged: boolean;
}

function retarget(map: WalkMap, state: WalkState): WalkState {
  const { target, cursor } = nextWaypoint(map, state.cursor, state.position, state.destination);
  const leg = walkLeg(state.position, target);
  if (!leg) return { ...state, target, cursor, scriptChanged: false };
  return { ...state, target, cursor, leg, sector: leg.sector, scriptChanged: leg.sector !== state.sector };
}

/**
 * Début d'une marche (état 7 de `1168:0ba8` : `1168:2f9f` puis `1168:2b30`). Le secteur de départ est 0 (`1168:4231` charge le
 * script `100 + 5 × pieds`). Le premier pas a lieu dans le même tick : appeler `tickWalk` juste après.
 */
export function startWalk(map: WalkMap, position: Point, destination: Point, facing: 0 | 1 = 0): WalkState {
  const cursor = planPath(map, position, destination);
  const initial: WalkState = {
    position,
    destination,
    target: position,
    cursor,
    leg: { stepX: 0, stepY: 0 },
    sector: 0,
    facing,
    arrived: false,
    scriptChanged: false,
  };
  return retarget(map, initial);
}

/**
 * Un tick de marche (état `0x70`, toutes les `WALK_TICKS_PER_STEP` ticks du moteur). Sur la cible : demande le point de
 * passage suivant (sans avancer dans ce tick) ou, s'il n'y en a plus, marque l'arrivée. Sinon avance d'un pas.
 */
export function tickWalk(map: WalkMap, state: WalkState): WalkState {
  if (state.arrived) return state;
  if (state.position.x === state.target.x && state.position.y === state.target.y) {
    const next = retarget(map, state);
    if (next.position.x === next.target.x && next.position.y === next.target.y) return { ...next, arrived: true, scriptChanged: false };
    return next;
  }
  const moved = walkStep(state.position, state.target, state.leg);
  return { ...state, position: { x: moved.x, y: moved.y }, facing: moved.facing ?? state.facing, scriptChanged: false };
}
