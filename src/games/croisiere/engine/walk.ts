/**
 * Zones de marche (CT) et recherche de chemin.
 *
 * Références (ScummVM `engines/cruise/`, GPL v3+, release 2026.4.0, lu puis réécrit) :
 * - `ctp.cpp` : `initCt`, `computeAllDistance`, `getWalkBoxCenter`, `renderCTPWalkBox`, `makeCtStruct`, `getNode`, `setNodeColor`,
 *   `setNodeState`, `computeDistance` ;
 * - `actor.cpp` : `getPixel`, `polydroite`, `poly2`, `point_proche`, `explore`, `chemin0`, `valide_noeud`, `computePathfinding` ;
 * - `perso.cpp` : `freePerso`, `freeCTP` ; `vars.cpp` (tailles des tableaux).
 *
 * Les variables globales de ScummVM vivent dans `WalkState` (`e.walk`) et gardent leur valeur d'un appel à l'autre, comme dans le
 * moteur : `initCt` ne remet à zéro ni les routes, ni les distances, ni les zones au-delà de celles du fichier.
 *
 * Particularités reproduites :
 * - les deux listes de zones rastérisées (`_polyStructNorm`, `_polyStructExp`) ne sont vidées que par `freeCTP` : deux `LoadCt` de
 *   suite les mettent bout à bout, et `getPixel` s'arrête à la première zone qui contient le point ;
 * - `getPixel` laisse `numPoly` sur la dernière zone parcourue quand aucune ne contient le point ;
 * - `distanceTable[20][10]` est indexé par des numéros de nœud jusqu'à 14 : `distanceTable[i][p]` déborde sur la ligne suivante
 *   (tableau à plat, mêmes recouvrements que dans ScummVM) ;
 * - `setNodeColor` (bogue de ScummVM, plan.md D8) : ne change la couleur que si la nouvelle vaut −1 (et rend alors −1) ; sinon ne
 *   change rien et rend l'ancienne couleur. `setNodeColor` / `setNodeState` bornent l'indice par le nombre de **nœuds**, pas de zones ;
 * - `persoStruct` : tableau d'int16 à plat, avec la disposition de la structure (voir `PERSO_*`), pour que les lectures hors des
 *   coordonnées tombent sur les mêmes champs que dans ScummVM.
 *
 * Écarts volontaires (sans effet sur les données du jeu : 33 `.CTP`, au plus 15 nœuds, 11 zones, aucune route pleine) : tout accès
 * hors des tableaux de ScummVM lève une erreur au lieu de lire la mémoire voisine ; `getPixel` sans zone de marche jamais chargée
 * (pointeur nul dans ScummVM) lève aussi une erreur ; le rastériseur des zones est propre à `WalkState` (dans ScummVM il partage ses
 * tampons avec le dessin des polygones, ce qui ne change pas les tranches lues ici, voir `render/poly.ts`).
 */
import { parseCtp } from "../data/ctp";
import { PolyRasterizer } from "../render/poly";
import { int16 } from "./memory";
import type { EngineState } from "./state";

export const NUM_NODES = 20;
export const NUM_PERSONS = 10;
const MAX_WALKBOXES = 15;

/** Disposition de `persoStruct` (int16) : `inc_droite`, `inc_droite0`, `inc_chemin`, `coordinates[400]`, `solution[23][2]`, ... */
export const PERSO_INC_DROITE = 0;
export const PERSO_INC_DROITE0 = 1;
export const PERSO_INC_CHEMIN = 2;
export const PERSO_COORDS = 3;
export const PERSO_SOLUTION = PERSO_COORDS + 400 * 2;
export const PERSO_INC_JO1 = PERSO_SOLUTION + (NUM_NODES + 3) * 2;
export const PERSO_INC_JO2 = PERSO_INC_JO1 + 1;
export const PERSO_DIR = PERSO_INC_JO1 + 2;
export const PERSO_INC_JO0 = PERSO_INC_JO1 + 3;
const PERSO_SIZE = PERSO_INC_JO1 + 4;

/** `MovementEntry`. */
export interface MovementEntry {
  x: number;
  y: number;
  direction: number;
  zoom: number;
  poly: number;
}

/** `CtStruct` : une zone rastérisée, une tranche `[minX, maxX]` par ligne à partir de `top`. */
export interface CtStruct {
  readonly num: number;
  readonly color: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly slices: ReadonlyArray<readonly [number, number]>;
}

/** Lecture bornée d'un tableau de ScummVM. */
function rd(arr: Int16Array | Int8Array | Int32Array, i: number, what: string): number {
  if (i < 0 || i >= arr.length) throw new RangeError(`${what}[${i}] hors du tableau`);
  return arr[i]!;
}

function wr(arr: Int16Array | Int8Array | Int32Array, i: number, v: number, what: string): void {
  if (i < 0 || i >= arr.length) throw new RangeError(`${what}[${i}] hors du tableau`);
  arr[i] = v;
}

export class WalkState {
  /** `ctp_routeCoordCount`. */
  routeCoordCount = 0;
  readonly routeCoords = new Int16Array(NUM_NODES * 2);
  readonly routes = new Int16Array(NUM_NODES * 10);
  readonly walkboxTable = new Int16Array(MAX_WALKBOXES * 40);
  readonly walkboxColor = new Int16Array(MAX_WALKBOXES);
  readonly walkboxState = new Int16Array(MAX_WALKBOXES);
  readonly walkboxColorIndex = new Int16Array(16);
  readonly walkboxZoom = new Int16Array(MAX_WALKBOXES);
  readonly distanceTable = new Int16Array(NUM_NODES * 10);
  numberOfWalkboxes = 0;
  readonly polyStructNorm: CtStruct[] = [];
  readonly polyStructExp: CtStruct[] = [];
  /** `_polyStruct != nullptr` : une zone de marche est chargée. */
  loaded = false;
  /** `_polyStructs` : liste utilisée par `getPixel` (`null` tant qu'aucun `LoadCt` n'a eu lieu). */
  polyStructs: CtStruct[] | null = null;
  numPoly = 0;
  readonly persoTable: (Int16Array | null)[] = new Array<Int16Array | null>(NUM_PERSONS).fill(null);
  /**
   * Rastériseur des zones (`renderCTPWalkBox` → `drawPolyMode2`, lu par `makeCtStruct`) : l'instance du dessin et du hit-test
   * (`display.poly`), car ScummVM partage cet état global entre les trois usages.
   */
  constructor(readonly raster: PolyRasterizer = new PolyRasterizer()) {}
  /** `inc_jo` (perso.cpp). */
  incJo = 0;

  // Recherche de chemin (actor.cpp)
  nclickNoeud = 0;
  flagAffChemin = 0;
  xMouse = 0;
  yMouse = 0;
  pointSelect = 0;
  /** `table_ptselect[2][2]`. */
  readonly tablePtselect = new Int32Array(4);
  X = 0;
  Y = 0;
  readonly selectNoeud = new Int16Array(3);
  readonly solution = new Int8Array(NUM_NODES + 1);
  prem = 0;
  prem2 = 0;
  distChemin = 0;
  idsol = 0;
  solmax = 0;
  readonly fl = new Int8Array(NUM_NODES + 1);
  readonly sol = new Int8Array(NUM_NODES + 1);
  D = 0;
}

/** `computeDistance` : distance de Tchebychev. */
export function computeDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

/** `MemAlloc(sizeof(persoStruct))` : mémoire non initialisée dans ScummVM, mise à zéro ici (aucun champ n'est lu avant écriture). */
function allocPerso(): Int16Array {
  return new Int16Array(PERSO_SIZE);
}

/** `freePerso`. */
export function freePerso(e: EngineState, idx: number): void {
  if (e.walk.persoTable[idx]) e.walk.persoTable[idx] = null;
}

/** `freeCTP` : trajets, listes de zones et nom du CTP. */
export function freeCtp(e: EngineState): void {
  const w = e.walk;
  for (let i = 0; i < NUM_PERSONS; i++) freePerso(e, i);
  if (w.loaded) {
    w.polyStructNorm.length = 0;
    w.polyStructExp.length = 0;
  }
  w.loaded = false;
  e.currentCtpName = "";
}

/** `makeCtStruct` : rastérise la zone `num` à l'échelle `z + 0x200` autour de son centre et ajoute ses tranches à `list`. */
function makeCtStruct(w: WalkState, list: CtStruct[], num: number, z: number): void {
  const row = w.walkboxTable.subarray(num * 40, num * 40 + 40);
  if (row[0]! < 1) return;
  // getWalkBoxCenter
  let minX = 1000;
  let minY = 1000;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < row[0]!; i++) {
    const x = row[i * 2 + 1]!;
    const y = row[i * 2 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = Math.trunc((maxX - minX) / 2) + minX;
  const cy = Math.trunc((maxY - minY) / 2) + minY;
  w.raster.rasterizeWalkbox(row, cx, cy, cx, cy, z + 0x200);

  const table = w.raster.spanTable();
  let left = 1000;
  let right = -1;
  for (const [x1, x2] of table.spans) {
    if (x1 < left) left = x1;
    if (x2 > right) right = x2;
  }
  list.push({
    num,
    color: w.walkboxColor[num]!,
    left,
    right,
    top: table.top,
    bottom: table.top + table.spans.length,
    slices: table.spans,
  });
}

/**
 * `initCt` (`Op_LoadCt`) : 1 si chargé, 0 si ce n'est pas un CTP, −18 si le fichier manque. `fromSave` (`loadCtFromSave`, rechargement
 * d'une sauvegarde) garde les trajets et les couleurs et états des zones déjà restitués.
 */
export function loadCt(e: EngineState, name: string, fromSave = false): number {
  const w = e.walk;
  if (!fromSave) w.persoTable.fill(null);
  if (!e.files.has(name)) return -18;
  const bytes = e.files.readFile(name);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "CTP ") return 0;
  const ctp = parseCtp(bytes);
  if (ctp.nodes.length > NUM_NODES || ctp.routeRows.length > NUM_NODES || ctp.walkboxRows.length > MAX_WALKBOXES) {
    throw new RangeError(`${name} : tables plus grandes que celles de ScummVM`);
  }
  if (ctp.walkboxes.length > MAX_WALKBOXES) throw new RangeError(`${name} : ${ctp.walkboxes.length} zones`);
  w.routeCoordCount = ctp.numNodes;
  ctp.nodes.forEach((n, i) => {
    w.routeCoords[i * 2] = n.x;
    w.routeCoords[i * 2 + 1] = n.y;
  });
  ctp.routeRows.forEach((row, i) => w.routes.set(row, i * 10));
  ctp.walkboxRows.forEach((row, i) => w.walkboxTable.set(row, i * 40));
  // Les segments 3 à 6 peuvent avoir des longueurs différentes : chacun est copié selon sa propre taille.
  const raw = (seg: number): number[] => {
    let pos = 20;
    for (let s = 0; s < seg; s++) pos += ctp.segmentSizes[s]!;
    const out: number[] = [];
    for (let i = 0; i < ctp.segmentSizes[seg]! / 2; i++) out.push(int16((bytes[pos + 2 * i]! << 8) | bytes[pos + 2 * i + 1]!));
    return out;
  };
  if (!fromSave) {
    raw(3).forEach((v, i) => wr(w.walkboxColor, i, v, "walkboxColor"));
    raw(4).forEach((v, i) => wr(w.walkboxState, i, v, "walkboxState"));
  }
  raw(5).forEach((v, i) => wr(w.walkboxColorIndex, i, v, "walkboxColorIndex"));
  raw(6).forEach((v, i) => wr(w.walkboxZoom, i, v, "walkboxZoom"));
  e.currentCtpName = name.slice(0, 39);
  w.numberOfWalkboxes = ctp.segmentSizes[6]! / 2;

  // computeAllDistance
  for (let i = 0; i < w.routeCoordCount; i++) {
    const x1 = rd(w.routeCoords, i * 2, "ctp_routeCoords");
    const y1 = rd(w.routeCoords, i * 2 + 1, "ctp_routeCoords");
    for (let j = 0; j < rd(w.routes, i * 10, "ctp_routes"); j++) {
      const p = rd(w.routes, i * 10 + j + 1, "ctp_routes");
      const x2 = rd(w.routeCoords, p * 2, "ctp_routeCoords");
      const y2 = rd(w.routeCoords, p * 2 + 1, "ctp_routeCoords");
      wr(w.distanceTable, i * 10 + p, computeDistance(x1, y1, x2, y2), "distanceTable");
    }
  }

  for (let i = w.numberOfWalkboxes - 1; i >= 0; i--) makeCtStruct(w, w.polyStructNorm, i, 0);
  for (let i = w.numberOfWalkboxes - 1; i >= 0; i--) makeCtStruct(w, w.polyStructExp, i, w.walkboxZoom[i]! * 20);
  w.loaded = true;
  w.polyStructs = w.polyStructNorm;
  return 1;
}

/** `getPixel` : zone marchable sous `(x, y)` → `flag_obstacle` (couleur de la zone, 0 sinon) et `numPoly`. */
export function getPixel(e: EngineState, x: number, y: number): void {
  const w = e.walk;
  const list = w.polyStructs;
  if (!list) throw new Error("getPixel : aucune zone de marche chargée");
  for (const ct of list) {
    w.numPoly = ct.num;
    if (w.walkboxState[ct.num] === 0 && x >= ct.left && x < ct.right && y >= ct.top && y < ct.bottom) {
      const [minX, maxX] = ct.slices[y - ct.top]!;
      if (x >= minX && x <= maxX) {
        e.flagObstacle = w.walkboxColor[ct.num]!;
        return;
      }
    }
  }
  e.flagObstacle = 0;
}

/** `getNode` : coordonnées du nœud, `null` (−1) hors bornes. */
export function getNode(e: EngineState, node: number): [number, number] | null {
  const w = e.walk;
  if (node < 0 || node >= w.routeCoordCount) return null;
  return [rd(w.routeCoords, node * 2, "ctp_routeCoords"), rd(w.routeCoords, node * 2 + 1, "ctp_routeCoords")];
}

/** `setNodeColor`, bogue compris (voir l'en-tête). */
export function setNodeColor(e: EngineState, node: number, color: number): number {
  const w = e.walk;
  if (node < 0 || node >= w.routeCoordCount) return -1;
  const old = rd(w.walkboxColor, node, "walkboxColor");
  if (color === -1) {
    w.walkboxColor[node] = color;
    return color;
  }
  return old;
}

/** `setNodeState`. */
export function setNodeState(e: EngineState, node: number, state: number): number {
  const w = e.walk;
  if (node < 0 || node >= w.routeCoordCount) return -1;
  const old = rd(w.walkboxState, node, "walkboxState");
  if (state === -1) return old;
  w.walkboxState[node] = state;
  return old;
}

/**
 * Parcours de Bresenham commun à `polydroite` et `poly2` : `stopOn(flag)` dit si le pixel courant arrête le tracé. Pose `X`, `Y` sur le
 * dernier pixel testé et `flag_obstacle` à 1 en cas d'arrêt (ou de droite de longueur nulle), 0 sinon.
 */
function walkLine(e: EngineState, x1: number, y1: number, x2: number, y2: number, stopOn: (flag: number) => boolean): void {
  const w = e.walk;
  let dx = x2 - x1;
  let dy = y2 - y1;
  let mD0 = 1;
  let mD1 = 1;
  if (dx < 0) {
    dx = -dx;
    mD0 = -1;
  }
  if (dy < 0) {
    dy = -dy;
    mD1 = -1;
  }
  let mA0: number;
  let mA1: number;
  let bp: number;
  let cx: number;
  if (dx < dy) {
    mA0 = 0;
    bp = dx;
    cx = dy;
    mA1 = mD1;
  } else {
    mA1 = 0;
    bp = dy;
    cx = dx;
    mA0 = mD0;
  }
  bp *= 2;
  let d = bp - cx;
  const si = d - cx;
  let ax = x1;
  let bx = y1;
  getPixel(e, x1, y1);
  w.X = x1;
  w.Y = y1;
  if (stopOn(e.flagObstacle) || cx === 0) {
    e.flagObstacle = 1;
    return;
  }
  while (--cx >= 0) {
    if (d > 0) {
      ax += mD0;
      bx += mD1;
      d += si;
    } else {
      ax += mA0;
      bx += mA1;
      d += bp;
    }
    getPixel(e, ax, bx);
    w.X = ax;
    w.Y = bx;
    if (stopOn(e.flagObstacle)) {
      e.flagObstacle = 1;
      return;
    }
  }
  e.flagObstacle = 0;
}

/** `polydroite` : `flag_obstacle` à 0 si toute la droite est marchable, 1 sinon (`X`, `Y` : premier pixel bloquant). */
function polydroite(e: EngineState, x1: number, y1: number, x2: number, y2: number): void {
  walkLine(e, x1, y1, x2, y2, (flag) => flag === 0);
}

/** `poly2` : avance de `(x1, y1)` vers `(x2, y2)` jusqu'au premier pixel marchable (`X`, `Y`). */
function poly2(e: EngineState, x1: number, y1: number, x2: number, y2: number): void {
  walkLine(e, x1, y1, x2, y2, (flag) => flag !== 0);
}

/** `point_proche` : nœud le plus proche de `(x_mouse, y_mouse)` qu'on peut joindre en ligne droite, −1 sinon. */
function pointProche(e: EngineState): number {
  const w = e.walk;
  let d1 = 1000;
  w.polyStructs = w.polyStructNorm;
  if (w.nclickNoeud === 1) {
    const x = w.xMouse;
    const y = w.yMouse;
    let x1 = w.tablePtselect[0]!;
    let y1 = w.tablePtselect[1]!;
    w.polyStructs = w.polyStructExp;
    getPixel(e, x, y);
    if (!e.flagObstacle) {
      w.polyStructs = w.polyStructNorm;
      getPixel(e, x, y);
      if (e.flagObstacle) polydroite(e, x1, y1, x, y);
      w.polyStructs = w.polyStructExp;
    }
    if (!e.flagObstacle) {
      x1 = w.tablePtselect[0]!;
      y1 = w.tablePtselect[1]!;
      poly2(e, x, y, x1, y1);
      w.xMouse = w.X;
      w.yMouse = w.Y;
    }
  }
  w.polyStructs = w.polyStructNorm;
  let p = -1;
  for (let i = 0; i < w.routeCoordCount; i++) {
    const x = rd(w.routeCoords, i * 2, "ctp_routeCoords");
    const y = rd(w.routeCoords, i * 2 + 1, "ctp_routeCoords");
    const dist = computeDistance(w.xMouse, w.yMouse, x, y);
    if (dist < d1) {
      polydroite(e, w.xMouse, w.yMouse, x, y);
      if (!e.flagObstacle && w.routes[i * 10]! > 0) {
        d1 = dist;
        p = i;
      }
    }
  }
  return p;
}

/** `explore` : parcours en profondeur exhaustif du graphe, garde le chemin le plus court (`solution`). */
function explore(w: WalkState, depart: number, arrivee: number): void {
  const id1 = depart;
  wr(w.fl, id1, rd(w.fl, id1, "fl") + 1, "fl");
  wr(w.sol, w.idsol++, id1, "sol");
  if (w.idsol > w.solmax) {
    w.fl[id1] = -1;
    w.idsol--;
    return;
  }
  let i: number;
  while ((i = w.fl[id1]!) < 20) {
    const id2 = rd(w.routes, id1 * 10 + i + 1, "ctp_routes");
    if (id2 === arrivee) {
      if (w.idsol < w.solmax) {
        wr(w.sol, w.idsol, arrivee, "sol");
        let D = 0;
        for (i = 0; i < w.idsol; i++) D += rd(w.distanceTable, w.sol[i]! * 10 + w.sol[i + 1]!, "distanceTable");
        w.D = D;
        w.prem2 = 0;
        if (!w.prem || D < w.distChemin) {
          w.distChemin = D;
          w.prem = 1;
          for (i = 0; i <= w.idsol; i++) wr(w.solution, i, w.sol[i]!, "solution");
          wr(w.solution, i++, -1, "solution");
          wr(w.solution, i, -1, "solution");
        }
      }
      w.fl[id1] = -1;
      w.idsol--;
      return;
    } else if (id2 !== -1 && rd(w.fl, id2, "fl") === -1) {
      explore(w, id2, arrivee);
    } else if (id2 === -1) {
      w.fl[id1] = -1;
      w.idsol--;
      return;
    }
    w.fl[id1] = w.fl[id1]! + 1;
  }
  w.fl[id1] = -1;
  w.idsol--;
}

/** `chemin0`. */
function chemin0(w: WalkState, depart: number, arrivee: number): void {
  w.prem = 0;
  w.prem2 = 0;
  w.distChemin = 0;
  w.idsol = 0;
  w.solmax = 999;
  w.fl.fill(-1);
  w.X = 0;
  w.Y = 30;
  explore(w, depart, arrivee);
}

/** `valide_noeud` : premier puis second point du trajet ; au second, calcule le trajet dans `solution0` (perso). */
function valideNoeud(e: EngineState, p: number, perso: Int16Array | null): void {
  const w = e.walk;
  const n = w.nclickNoeud;
  wr(w.selectNoeud, n, p, "select_noeud");
  wr(w.selectNoeud, n + 1, -1, "select_noeud");
  w.tablePtselect[n * 2] = w.xMouse;
  w.tablePtselect[n * 2 + 1] = w.yMouse;
  w.nclickNoeud++;
  w.polyStructs = w.polyStructNorm;
  if (w.nclickNoeud !== 2) return;
  if (!perso) throw new Error("valide_noeud : second point sans trajet");

  const S = PERSO_SOLUTION;
  const setSol = (i: number, k: 0 | 1, v: number) => wr(perso, S + i * 2 + k, v, "solution0");
  const getSol = (i: number, k: 0 | 1) => rd(perso, S + i * 2 + k, "solution0");
  // `solution0` ne déborde pas de ses 23 lignes : erreur sinon.
  const checkRow = (i: number) => {
    if (i >= NUM_NODES + 3) throw new RangeError(`solution0[${i}] hors du tableau`);
  };

  let x1 = w.tablePtselect[0]!;
  let y1 = w.tablePtselect[1]!;
  let x2 = w.tablePtselect[2]!;
  let y2 = w.tablePtselect[3]!;
  if (x1 === x2 && y1 === y2) return;
  w.flagAffChemin = 1;
  w.polyStructs = w.polyStructExp;
  polydroite(e, x1, y1, x2, y2);
  const node1 = w.selectNoeud[1]!;

  if (!e.flagObstacle) {
    setSol(0, 0, x1);
    setSol(0, 1, y1);
    w.polyStructs = w.polyStructExp;
    poly2(e, x2, y2, rd(w.routeCoords, node1 * 2, "ctp_routeCoords"), rd(w.routeCoords, node1 * 2 + 1, "ctp_routeCoords"));
    setSol(1, 0, (w.tablePtselect[2] = w.X));
    setSol(1, 1, (w.tablePtselect[3] = w.Y));
    setSol(2, 0, -1);
    if (x1 === w.X && y1 === w.Y) w.flagAffChemin = 0;
    return;
  }

  w.solution[0] = -1;
  if (w.routes[w.selectNoeud[0]! * 10]! > 0) chemin0(w, w.selectNoeud[0]!, w.selectNoeud[1]!);

  if (w.solution[0] === -1) {
    x1 = w.tablePtselect[0]!;
    y1 = w.tablePtselect[1]!;
    polydroite(e, x1, y1, w.xMouse, w.yMouse);
    setSol(0, 0, x1);
    setSol(0, 1, y1);
    setSol(1, 0, w.X);
    setSol(1, 1, w.Y);
    setSol(2, 0, -1);
    if (x1 === w.X && y1 === w.Y) w.flagAffChemin = 0;
    return;
  }

  setSol(0, 0, x1);
  setSol(0, 1, y1);
  let i = 0;
  while (rd(w.solution, i, "solution") !== -1) {
    const p1 = w.solution[i]!;
    checkRow(i + 1);
    setSol(i + 1, 0, rd(w.routeCoords, p1 * 2, "ctp_routeCoords"));
    setSol(++i, 1, rd(w.routeCoords, p1 * 2 + 1, "ctp_routeCoords"));
  }
  w.polyStructs = w.polyStructExp;
  poly2(e, x2, y2, rd(w.routeCoords, node1 * 2, "ctp_routeCoords"), rd(w.routeCoords, node1 * 2 + 1, "ctp_routeCoords"));
  checkRow(i + 2);
  setSol(i + 1, 0, (w.tablePtselect[2] = w.X));
  setSol(i + 1, 1, (w.tablePtselect[3] = w.Y));
  setSol(i + 2, 0, -1);
  if (x1 === w.X && y1 === w.Y) {
    w.flagAffChemin = 0;
    return;
  }

  // Élagage des points intermédiaires inutiles.
  i++;
  let d = 0;
  const a = i;
  e.flagObstacle = 1;
  while (d !== a) {
    x1 = getSol(d, 0);
    y1 = getSol(d, 1);
    while (e.flagObstacle && i !== d) {
      x2 = getSol(i, 0);
      y2 = getSol(i, 1);
      w.polyStructs = w.polyStructExp;
      polydroite(e, x1, y1, x2, y2);
      i--;
    }
    e.flagObstacle = 1;
    if (d !== i) {
      i++;
      for (let b = d + 1; b < i; b++) setSol(b, 0, -2);
    } else {
      i++;
    }
    d = i;
    i = a;
  }
  e.flagObstacle = 0;
}

/**
 * `computePathfinding` : réserve un trajet (`persoTable`) de `(x, y)` à `(destX, destY)` et rend son numéro, ou −1 (`ANIM_WAIT`) ;
 * `moveInfo` reçoit la destination retenue (−1 si aucune) et la zone de départ.
 */
export function computePathfinding(
  e: EngineState,
  moveInfo: MovementEntry,
  x: number,
  y: number,
  destX: number,
  destY: number,
  stepX: number,
  stepY: number,
  oldPathId: number,
): number {
  const w = e.walk;
  x = int16(x);
  y = int16(y);
  destX = int16(destX);
  destY = int16(destY);
  if (!w.loaded) {
    moveInfo.x = -1;
    moveInfo.y = -1;
    return -1;
  }
  if (oldPathId >= 0 && w.persoTable[oldPathId]) freePerso(e, oldPathId);

  if (!e.flagCt) {
    const i = w.persoTable.indexOf(null);
    if (i < 0) {
      moveInfo.x = -1;
      moveInfo.y = -1;
      return -1;
    }
    const perso = (w.persoTable[i] = allocPerso());
    perso[PERSO_INC_JO1] = stepX;
    perso[PERSO_INC_JO2] = stepY;
    perso.set([x, y, (moveInfo.x = destX), (moveInfo.y = destY), -1], PERSO_SOLUTION);
    moveInfo.poly = w.numPoly;
    perso[PERSO_INC_DROITE] = 0;
    perso[PERSO_INC_CHEMIN] = 0;
    return i;
  }

  w.nclickNoeud = 0;
  w.polyStructs = w.polyStructNorm;
  w.flagAffChemin = 0;
  if (x === destX && y === destY) {
    moveInfo.x = -1;
    moveInfo.y = -1;
    return -1;
  }

  // Premier nœud.
  getPixel(e, x, y);
  moveInfo.poly = w.numPoly;
  w.xMouse = x;
  w.yMouse = y;
  if (!e.flagObstacle || (w.pointSelect = pointProche(e)) === -1) {
    moveInfo.x = -1;
    moveInfo.y = -1;
    return -1;
  }
  valideNoeud(e, w.pointSelect, null);
  w.flagAffChemin = 0;

  // Second nœud.
  const num = w.persoTable.indexOf(null);
  if (num < 0) {
    moveInfo.x = -1;
    moveInfo.y = -1;
    return -1;
  }
  const perso = (w.persoTable[num] = allocPerso());
  perso[PERSO_INC_JO1] = stepX;
  perso[PERSO_INC_JO2] = stepY;
  w.xMouse = destX;
  w.yMouse = destY;
  if ((w.pointSelect = pointProche(e)) !== -1) valideNoeud(e, w.pointSelect, perso);

  const t = w.tablePtselect;
  if (!w.flagAffChemin || (t[0] === t[2] && t[1] === t[3])) {
    moveInfo.x = -1;
    moveInfo.y = -1;
    freePerso(e, num);
    return -1;
  }
  moveInfo.x = int16(t[2]!);
  moveInfo.y = int16(t[3]!);
  moveInfo.poly = w.numPoly;
  perso[PERSO_INC_CHEMIN] = 0;
  perso[PERSO_INC_DROITE] = 0;
  return num;
}
