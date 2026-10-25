import { GRID_COLUMNS, GRID_ROWS, SPAN_EMPTY, cellIndex, lowAt, spanAt, typeAt, type Terrain } from "./ground";
import type { MoverBody } from "./mover";
import { PLACE_OK, PLACE_TYPE_CHANGED, SEARCH_CLICK, searchPosition, type PlaceBody, type PlaceEnv } from "./placement";

/**
 * Trajets : graphe de navigation `305e:0002`, calcul `gm_compute_path` `3187:0000`, suivi `30d9:0006` / `30d9:0184` et
 * destination d'un clic `1504:0002` (`docs/armaeth/movement.md` § 6 et § 4.6). Module pur.
 *
 * Le graphe est reconstruit à chaque calcul de trajet, comme dans l'original. Le suivi (`followPath`) porte `30d9:0006` et
 * `30d9:0184` d'après le décompilat : les cibles mobiles (gérées par `npc-kit.ts`), la lumière trop faible et le déplacement
 * direct hors salle ne sont pas portés.
 */

/** Plafond du nombre de nœuds (`ng <= 250`, enregistrements de 16 octets). */
export const MAX_NODES = 250;
/** Plafond de voisins par nœud. */
export const MAX_NEIGHBORS = 8;
/** Coût initial des nœuds (`0x7d00`). */
export const UNREACHED = 32000;

/** Nœud : segment praticable maximal `[c0, c1]` d'une rangée d'un plan. */
export interface PathNode {
  row: number;
  plane: number;
  c0: number;
  c1: number;
  /** Indices des nœuds voisins (8 au plus, dans les rangées `row - 1 .. row + 1`). */
  neighbors: number[];
}

/** Ce que le graphe et le trajet lisent de l'objet. */
export interface PathBody {
  x: number;
  y: number;
  p: number;
  plane: number;
  /** `Dep` : 0 = marcheur, autre = volant. */
  dep: number;
  height: number;
  width: number;
  /** `dpX`, `dpY`, `dpP` : un pas nul interdit tout trajet. */
  stepX: number;
  stepY: number;
  stepP: number;
}

export interface GraphOptions {
  /** `13a8:000a(type, 0, o) == 0`. Défaut : tout type >= 2. */
  acceptsGround?: (type: number) => boolean;
}

const isWalkableType = (type: number): boolean => type > 1 && type !== 0xff;

/** Vide sous le plafond d'un plan supérieur pour un volant (`305e:06fc`). Hypothèse (movement.md § 6.1) : lue dans le décompilat seul. */
function flyerClearance(terrain: Terrain, plane: number, row: number, col: number, needed: number): boolean {
  const floor = lowAt(terrain.grid, cellIndex(plane, row, col));
  let ceiling = 0;
  for (let upper = plane + 1; upper < terrain.planes; upper++) {
    const span = spanAt(terrain.grid, cellIndex(upper, row, col));
    if (span === SPAN_EMPTY) continue;
    ceiling = span >> 8;
    break;
  }
  return floor - ceiling >= needed;
}

/**
 * Graphe de navigation (`305e:0002`, **validé** par les tailles : 0 à 64 nœuds pour le héros, jamais 8 voisins). `null` si la
 * salle est trop grande (plus de 20 rangées ou 80 colonnes) ou dépasse `MAX_NODES` nœuds.
 */
export function buildGraph(terrain: Terrain, body: PathBody, options: GraphOptions = {}): PathNode[] | null {
  const { grid, limits } = terrain;
  const accepts = options.acceptsGround ?? (() => true);
  const columns = (limits.xMax >> 2) + 1;
  const lastRow = (limits.pMax >> 3) + 1;
  if (lastRow > GRID_ROWS - 1 || columns > GRID_COLUMNS - 1) return null;
  const { stepX, stepY, stepP } = body;
  const flyer = body.dep !== 0;
  const nodes: PathNode[] = [];
  const rowStart: number[] = [];
  for (let row = 0; row <= lastRow; row++) {
    rowStart[row] = nodes.length;
    for (let plane = 0; plane < terrain.planes; plane++) {
      const typeOf = (col: number) => typeAt(grid, cellIndex(plane, row, col));
      const loOf = (col: number) => lowAt(grid, cellIndex(plane, row, col));
      const typeUsable = (type: number) => isWalkableType(type) && accepts(type);
      const cellUsable = (type: number, col: number) =>
        typeUsable(type) && (!flyer || flyerClearance(terrain, plane, row, col, body.height + 6));
      let refused = -1; // type refusé mémorisé pour ne pas être retesté
      let col = 0;
      while (col < columns) {
        const type = typeOf(col);
        if (type !== refused) {
          if (cellUsable(type, col)) {
            const start = col;
            let current = type;
            let previous = loOf(col);
            let end = col + 1;
            for (; end < columns; end++) {
              const next = typeOf(end);
              if (next !== current) {
                if (cellUsable(next, end)) current = next;
                else {
                  if (!typeUsable(next)) refused = next;
                  break;
                }
              } else if (flyer && !cellUsable(next, end)) break;
              if (Math.abs(previous - loOf(end)) * stepX > stepY * 4) break;
              previous = loOf(end);
            }
            nodes.push({ row, plane, c0: start, c1: end - 1, neighbors: [] });
            if (nodes.length > MAX_NODES) return null;
            col = end;
            continue;
          }
          if (!typeUsable(type)) refused = type;
        }
        col++;
      }
    }
  }
  rowStart[lastRow + 1] = nodes.length;
  const heightAt = (plane: number, row: number, col: number) => lowAt(grid, cellIndex(plane, row, col));
  nodes.forEach((node, index) => {
    const from = node.row > 0 ? rowStart[node.row - 1]! : rowStart[0]!;
    const to = rowStart[node.row + 2] ?? nodes.length;
    for (let other = from; other < to && node.neighbors.length < MAX_NEIGHBORS; other++) {
      if (other === index) continue;
      const b = nodes[other]!;
      if (b.row === node.row) {
        // même rangée : segments qui se touchent, écart de hauteur franchissable en un pas de 4 px
        let colA: number;
        let colB: number;
        if (b.c0 - node.c1 === 1) {
          colA = node.c1;
          colB = b.c0;
        } else if (node.c0 - b.c1 === 1) {
          colA = node.c0;
          colB = b.c1;
        } else continue;
        const gap = Math.abs(heightAt(node.plane, node.row, colA) - heightAt(b.plane, b.row, colB));
        if (gap * stepX <= stepY * 4) node.neighbors.push(other);
      } else if (node.c0 <= b.c1 && b.c0 <= node.c1) {
        // rangées voisines : colonnes communes, écart minimal de hauteur ; entre deux plans, une colonne ne compte pas si une case
        // des plans au-dessus du nœud le plus bas (jusqu'au plan du nœud le plus haut compris, à la rangée du nœud le plus bas)
        // est occupée (`305e:0572..05c4`)
        let gap = 1000;
        for (let c = Math.max(node.c0, b.c0); c <= Math.min(node.c1, b.c1); c++) {
          if (node.plane !== b.plane) {
            const lower = node.plane < b.plane ? node : b;
            const upper = lower === node ? b : node;
            let covered = false;
            for (let plane = lower.plane + 1; plane <= upper.plane && !covered; plane++) {
              const type = typeAt(grid, cellIndex(plane, lower.row, c));
              covered = type !== 0 && type !== 0xff;
            }
            if (covered) continue;
          }
          gap = Math.min(gap, Math.abs(heightAt(node.plane, node.row, c) - heightAt(b.plane, b.row, c)));
        }
        if (gap * stepP <= stepY * 8) node.neighbors.push(other);
      }
    }
  });
  return nodes;
}

/** Entrée de `Chm` : `{rangée, plan, c0, c1}`. */
export interface PathStep {
  row: number;
  plane: number;
  c0: number;
  c1: number;
}

/** Destination d'un trajet (`Xc, Yc, Pc, Nc`). */
export interface PathTarget {
  x: number;
  y: number;
  p: number;
  plane: number;
}

/**
 * Trajet d'un objet (champs +0x63..+0x78 : `Def`, `Mod`, `Dir`, `Nbc`, `Chm`, `X1`, `X2`).
 * `nodes` va de l'arrivée (indice 0) au premier saut (indice `remaining - 1`).
 */
export interface PathState {
  /** `Def` : un trajet est en cours. */
  defined: boolean;
  nodes: PathStep[];
  /** `Nbc` : nœuds restants sans celui où se trouve l'objet ; -1 = pas de trajet, 0 = déjà au bon nœud. */
  remaining: number;
  /** `Mod` : 0 alignement, 1 changement de rangée, 2 contournement. */
  mode: number;
  /** +0x64 : sens du contournement (+1 au départ). */
  lateral: number;
  /** +0x65 : sens de la rangée visée, mémorisé à l'entrée en `Mod 2`. */
  memo: number;
  /** `X1`, `X2` : colonnes du nœud d'arrivée. */
  x1: number;
  x2: number;
  /** Nœud où se trouve l'objet (départ, puis chaque nœud atteint). */
  here: PathStep | null;
  target: PathTarget | null;
}

export function createPathState(): PathState {
  return { defined: false, nodes: [], remaining: -1, mode: 0, lateral: 0, memo: 0, x1: 0, x2: 0, here: null, target: null };
}

/** Métrique du repli : 0 = 3D, 1 = X seul, 2 = P seul (`DX` de `gm_compute_path`, 1 et 2 seulement pour `228e:0266`). */
export type PathMetric = 0 | 1 | 2;

export interface ComputeOptions extends GraphOptions {
  metric?: PathMetric;
  /**
   * `AX = 7` : conserve la destination du trajet en cours et coupe le lien entre le départ et le premier saut courant, pour
   * forcer un autre itinéraire (recalcul après un blocage).
   */
  resume?: boolean;
  /** Cible sans nœud accessible (`Cib == 0`, errance) : n'importe quel plan convient pour l'arrivée. */
  anyPlane?: boolean;
}

const contains = (node: { c0: number; c1: number }, col: number): boolean => node.c0 <= col && col <= node.c1;

/** Nœud de la rangée `row` qui couvre la colonne `col` ; `plane` null = n'importe quel plan ; volant : sol sous `y`. */
function nodeAt(terrain: Terrain, nodes: PathNode[], row: number, col: number, plane: number | null, flyerY: number | null): number {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.row !== row || !contains(node, col)) continue;
    if (plane !== null && node.plane !== plane) continue;
    if (flyerY !== null && !(flyerY < lowAt(terrain.grid, cellIndex(node.plane, row, col)))) continue;
    return i;
  }
  return -1;
}

/**
 * `gm_compute_path` (`3187:0000`, **probable**) : met `state` à jour et rend vrai si un trajet existe (`Nbc >= 0`).
 * Coût d'un lien = 1 si la rangée change, 0 sinon (le coût compte les changements de profondeur, pas la distance) ; le trajet
 * retenu parmi les plus courts minimise la marche horizontale cumulée (hypothèse sur l'ordre des voisins, § 8 question 10).
 */
export function computePath(terrain: Terrain, body: PathBody, target: PathTarget, state: PathState, options: ComputeOptions = {}): boolean {
  const previous = options.resume && state.defined ? { target: state.target, first: state.nodes[state.remaining - 1] } : null;
  const destination = previous?.target ?? target;
  state.defined = false;
  state.nodes = [];
  state.remaining = -1;
  state.mode = 0;
  state.lateral = 0;
  state.memo = 0;
  state.target = destination;
  state.here = null;
  if (body.stepX === 0 || body.stepY === 0 || body.stepP === 0) return false;
  const graph = buildGraph(terrain, body, options);
  if (!graph) return false;
  const flyer = body.dep !== 0;
  const startCol = body.x >> 2;
  const start = nodeAt(terrain, graph, body.p >> 3, startCol, flyer ? null : body.plane, flyer ? body.y : null);
  if (start < 0) return false;
  let goal = nodeAt(
    terrain,
    graph,
    destination.p >> 3,
    destination.x >> 2,
    options.anyPlane ? null : destination.plane,
    flyer ? destination.y : null,
  );

  // adjacence modifiable : la vague coupe les liens qui n'améliorent rien
  const links = graph.map((node) => [...node.neighbors]);
  if (previous?.first) {
    const first = graph.findIndex((n) => n.row === previous.first!.row && n.plane === previous.first!.plane && n.c0 === previous.first!.c0 && n.c1 === previous.first!.c1);
    if (first >= 0) links[start] = links[start]!.filter((m) => m !== first);
  }
  const cost = new Array<number>(graph.length).fill(UNREACHED);
  const weight = (a: number, b: number) => (graph[a]!.row !== graph[b]!.row ? 1 : 0);
  cost[start] = 0;
  let frontier = [start];
  // phase 1 : tout le graphe ; dès que l'arrivée est améliorée, la frontière en cours est rejouée en phase 2 où seule l'arrivée
  // peut encore s'améliorer (les autres liens, égaux ou meilleurs, sont coupés), puis la vague s'éteint (`3187:048f..0622`)
  let phaseTwo = false;
  while (frontier.length) {
    const next: number[] = [];
    let restart = false;
    scan: for (const n of frontier) {
      const list = links[n]!;
      const kept: number[] = [];
      for (let k = 0; k < list.length; k++) {
        const m = list[k]!;
        const c = cost[n]! + weight(n, m);
        if (c > cost[m]!) continue; // le lien dégrade le voisin : coupé
        if (c === cost[m]!) {
          if (phaseTwo && m !== goal) continue;
          kept.push(m); // hypothèse (§ 6.2) : un lien à coût égal est gardé
          continue;
        }
        if (phaseTwo && m !== goal) continue;
        cost[m] = c;
        kept.push(m);
        if (m === goal && !phaseTwo) {
          phaseTwo = true;
          restart = true;
          links[n] = [...kept, ...list.slice(k + 1)];
          break scan;
        }
        if (!next.includes(m)) next.push(m);
      }
      links[n] = kept;
    }
    if (restart) {
      // la frontière est rejouée une fois en phase 2 (seuls les liens vers l'arrivée survivent), puis la vague s'éteint
      for (const n of frontier) {
        links[n] = links[n]!.filter((m) => m === goal && cost[n]! + weight(n, m) <= cost[m]!);
        if (links[n]!.length && cost[n]! + weight(n, goal) < cost[goal]!) cost[goal] = cost[n]! + weight(n, goal);
      }
      break;
    }
    frontier = next;
  }

  let targetCol = destination.x >> 2;
  if (goal < 0 || cost[goal]! >= UNREACHED) {
    // repli : le nœud atteint le plus proche de la destination selon la métrique
    const metric = options.metric ?? 0;
    const targetRow = destination.p >> 3;
    let bestNode = -1;
    let bestDist = Infinity;
    graph.forEach((node, i) => {
      if (cost[i]! >= UNREACHED) return;
      const clamped = Math.min(Math.max(targetCol, node.c0), node.c1);
      const colGap = Math.abs(clamped - targetCol);
      const rowGap = Math.abs(node.row - targetRow);
      const yGap = destination.y - lowAt(terrain.grid, cellIndex(node.plane, node.row, clamped));
      const d2 = (metric !== 2 ? (4 * colGap) ** 2 : 0) + (metric !== 1 ? (8 * rowGap) ** 2 : 0) + (metric === 0 ? yGap * yGap : 0);
      if (d2 < bestDist || (d2 === bestDist && cost[i]! < cost[bestNode]!)) {
        bestDist = d2;
        bestNode = i;
      }
    });
    if (bestNode < 0) return false;
    goal = bestNode;
    const node = graph[goal]!;
    if (targetCol < node.c0) targetCol = node.c0 - 1;
    else if (targetCol > node.c1) targetCol = node.c1 + 1;
  }

  // élagage par niveaux de coût, de l'arrivée vers le départ
  const kept = new Set<number>([goal]);
  const queue = [goal];
  const reverse: number[][] = graph.map(() => []);
  links.forEach((list, n) => list.forEach((m) => reverse[m]!.push(n)));
  while (queue.length) {
    const m = queue.pop()!;
    for (const n of reverse[m]!) {
      if (kept.has(n) || cost[m]! !== cost[n]! + weight(n, m)) continue;
      kept.add(n);
      queue.push(n);
    }
  }
  if (!kept.has(start)) return false;

  // recherche en profondeur avec borne : marche horizontale cumulée minimale
  let bestWalk = Infinity;
  let bestRoute: number[] = [];
  const route: number[] = [start];
  const visit = (n: number, col: number, walk: number): void => {
    if (walk >= bestWalk) return;
    if (n === goal) {
      const total = walk + Math.abs(col - targetCol);
      if (total < bestWalk) {
        bestWalk = total;
        bestRoute = [...route];
      }
      return;
    }
    for (const m of links[n]!) {
      if (!kept.has(m) || cost[m]! !== cost[n]! + weight(n, m) || route.includes(m)) continue;
      const node = graph[m]!;
      const entered = Math.min(Math.max(col, node.c0), node.c1);
      route.push(m);
      visit(m, entered, walk + Math.abs(entered - col));
      route.pop();
    }
  };
  visit(start, startCol, 0);
  if (!bestRoute.length) return false;

  const toStep = (i: number): PathStep => ({ row: graph[i]!.row, plane: graph[i]!.plane, c0: graph[i]!.c0, c1: graph[i]!.c1 });
  state.nodes = bestRoute.slice(1).reverse().map(toStep);
  state.remaining = state.nodes.length;
  state.x1 = graph[goal]!.c0;
  state.x2 = graph[goal]!.c1;
  state.here = toStep(start);
  state.defined = true;
  return true;
}

/** Destination d'un clic gauche : point praticable le plus proche en (X, P) à ±4 en X et ±1 en hauteur (`1504:0002`). */
export interface ClickDestination extends PathTarget {
  ground: number;
}

/**
 * Clic dans la fenêtre de la scène (`movement.md` § 4.6) : le héros est posé provisoirement en `(clickX, clickY, P actuel)` puis
 * `rech(6, 0, tolérance X 4, 0, P libre, 0, tolérance Y 1, 0)` est lancé. Comme la hauteur du sol dépend de P, la hauteur
 * cliquée sélectionne la profondeur. `null` : clic hors de la scène, sur un mur ou hors sol (le héros s'arrête sans message).
 */
export function clickDestination(hero: PlaceBody, clickX: number, clickY: number, env: PlaceEnv): ClickDestination | null {
  const { limits } = env.terrain;
  if (clickX < limits.xMin || clickX > limits.xMax || clickY < limits.yMin || clickY > limits.yMax) return null;
  const probe: PlaceBody = { ...hero, x: clickX, y: clickY };
  const result = searchPosition(probe, env, SEARCH_CLICK);
  if (result !== PLACE_OK && result !== PLACE_TYPE_CHANGED) return null;
  return { x: probe.x, y: probe.y, p: probe.p, plane: probe.plane, ground: probe.ground };
}

/** Clic gauche complet : destination puis trajet (`Cib = 7`, `gm_compute_path`). Vrai si le héros doit marcher. */
export function planClick(
  hero: PathBody & PlaceBody,
  clickX: number,
  clickY: number,
  env: PlaceEnv,
  state: PathState,
  options: ComputeOptions = {},
): boolean {
  const destination = clickDestination(hero, clickX, clickY, env);
  if (!destination) return false;
  return computePath(env.terrain, hero, destination, state, options);
}

/** Objet qui suit un trajet. */
export interface FollowBody extends PathBody, Pick<MoverBody, "speedX" | "speedY" | "speedP" | "err" | "txt"> {}

export interface FollowContext {
  /**
   * `gm_compute_path(o, AX)` : `resume` vrai = `AX = 7` (recalcul après un blocage, destination conservée), faux = `AX = 0`
   * (trajet perdu, `Nbc < 0`). Faux rendu = aucun chemin.
   */
  recompute?: (state: PathState, resume: boolean) => boolean;
}

/**
 * Retours de `30d9:0006` : 0 en marche ; 1 arrivé (`Cib == 0`) ; 2 arrivé à la destination (`Cib != 0`) ; 3 cible mobile absente
 * (rendu par l'appelant) ; 4 pas de chemin ; 5 bloqué (même décision qu'au tic précédent malgré une erreur, ou plus rien à faire
 * sans destination) ; 6 aucun trajet.
 */
export const FOLLOW_WALKING = 0;
export const FOLLOW_ARRIVED_FREE = 1;
export const FOLLOW_ARRIVED = 2;
export const FOLLOW_TARGET_LOST = 3;
export const FOLLOW_RECOMPUTE_FAILED = 4;
export const FOLLOW_BLOCKED = 5;
export const FOLLOW_NO_PATH = 6;

const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
/** Colonne `v >> 2` et rangée `v >> 3` de la routine (valeur absolue décalée puis signe rétabli : troncature vers zéro). */
const colOf = (v: number): number => Math.trunc(v / 4);
const rowOf = (v: number): number => Math.trunc(v / 8);

/** `Err` qui bloque le pas suivant : tout sauf 0, 9, 0x0A et 0x11 (succès). */
const isBlocking = (err: number): boolean => !(err === 0 || err === 0x11 || err === 9 || err === 0x0a);

/** Garde contre une boucle de recalculs qui ne progresserait jamais (l'original boucle sans borne). */
const MAX_PASSES = 32;

/**
 * `30d9:0184` (**port ligne à ligne du décompilat**, sauf la cible mobile : voir `npc-kit.ts`) : règle `Hor`, `Prf`, `Ver` à partir du
 * nœud courant `Chm[Nbc - 1]` et de l'`Err` du dernier pas. Rend un code `FOLLOW_*`.
 *
 * Sous-état `Mod` : 0 alignement dans la fenêtre de colonnes du nœud (rétrécie de `Lar / 4 + 1` si l'objet n'est pas encore sur sa
 * rangée), 1 changement de rangée, 2 contournement latéral (un pas de côté, un essai en avant, sens inversé une fois au bord du nœud).
 * Quand `Nbc` tombe à 0, la destination elle-même est un dernier nœud d'une seule colonne tant qu'elle est à 4 en X ou 8 en P ou
 * plus : l'arrivée se juge à la **case** (colonne et rangée), pas au pixel.
 */
function followNodes(state: PathState, body: FollowBody, context: FollowContext): number {
  const savedErr = body.err === 0x11 ? 0 : body.err;
  const savedHor = body.speedX;
  const savedPrf = body.speedP;
  const savedVer = body.speedY;
  const flyer = body.dep !== 0;
  let err = body.err; // `Err` tel que le lit 30d9:0184 (remis à 0 par endroits)

  const arrival = (): number => (state.target ? FOLLOW_ARRIVED : FOLLOW_ARRIVED_FREE);

  /** Vitesse verticale d'un volant vers la hauteur de la destination (`30d9:02de..0361`). */
  const verticalSpeed = (): number => {
    if (!flyer) return 0;
    const t = state.target ?? { x: body.x, y: body.y, p: body.p, plane: 0 };
    const dx = body.stepX === 0 ? 0 : Math.trunc(Math.abs(t.x - body.x) / body.stepX);
    const dp = Math.abs(t.p - body.p);
    const dy = t.y - body.y;
    const vertical = body.stepY === 0 ? 0 : Math.trunc(Math.abs(dy) / body.stepY);
    if (vertical < dx + dp) return body.y > 30 ? -1 : 0;
    return dy < 0 ? -1 : dy !== 0 ? 1 : 0;
  };

  let result = FOLLOW_BLOCKED; // garde contre une boucle de recalculs sans fin : vaut le blocage si les passes sont épuisées
  passes: for (let pass = 0; pass < MAX_PASSES; pass++) {
    let blocked = isBlocking(err);
    let ver = verticalSpeed();

    // nœud à rejoindre : le prochain de `Chm`, puis la destination comme nœud d'une colonne
    let node: { row: number; c0: number; c1: number } | null = null;
    if (state.remaining > 0) {
      const step = state.nodes[state.remaining - 1];
      if (!step) throw new RangeError(`Nœud ${state.remaining - 1} du trajet absent`);
      node = step;
    } else if (state.remaining === 0 && state.target) {
      const t = state.target;
      if (colOf(Math.abs(t.x - body.x)) !== 0 || rowOf(Math.abs(t.p - body.p)) !== 0) node = { row: rowOf(t.p), c0: colOf(t.x), c1: colOf(t.x) };
    }
    if (!node) {
      result = arrival();
      break;
    }

    /** Vitesses décidées : `04fb` (au moins une non nulle) ou bloqué (`0827`). */
    const commit = (hor: number, prf: number): boolean => {
      if (hor === 0 && prf === 0 && ver === 0) return false;
      body.speedX = hor;
      body.speedP = prf;
      body.speedY = ver;
      return true;
    };
    /** `0827` : plus rien à faire ; sans destination c'est la fin (5), sinon recalcul `AX = 7`, sauf pour un volant. */
    const stuck = (): "retry" | number => {
      if (!state.target) return FOLLOW_BLOCKED;
      if (flyer || !context.recompute?.(state, true)) return FOLLOW_RECOMPUTE_FAILED;
      err = 0;
      body.err = 0;
      state.lateral = 0;
      state.memo = 0;
      state.mode = 0;
      return "retry";
    };
    /** `074e` : pas latéral, borné par les colonnes du nœud (sprite compris) ; hors bornes : inversion du sens (`0732`) ou blocage. */
    const sidestep = (hor: number): "ok" | "stuck" => {
      for (;;) {
        if (flyer) ver = body.height < body.y ? -1 : 0;
        if (hor === 0) return commit(0, 0) ? "ok" : "stuck";
        const x = body.stepX * hor + body.x;
        const half = body.width >> 1;
        if ((hor >= 0 || colOf(x - half) >= node!.c0) && (hor <= 0 || colOf(x + half) <= node!.c1)) return commit(hor, 0) ? "ok" : "stuck";
        if (state.lateral < 0) return "stuck";
        state.lateral = -1;
        hor = -1;
      }
    };

    for (;;) {
      const col = colOf(body.x);
      const row = rowOf(body.p);
      let low = node.c0;
      let high = node.c1;
      if (row !== node.row) {
        const margin = (body.width >> 2) + 1;
        low = node.c0 + margin;
        high = node.c1 - margin;
        if (high < low) low = high = Math.trunc((node.c0 + node.c1) / 2);
      }
      let reached = false;
      let outcome: "ok" | "stuck" | "next" = "next";
      if (state.mode === 0) {
        const hor = col < low ? 1 : col > high ? -1 : 0;
        if (hor === 0) {
          if (node.row === row) reached = true;
          else state.mode = 1;
        } else if (!blocked) outcome = commit(hor, 0) ? "ok" : "stuck";
        else if (col < node.c0 || node.c1 < col) {
          ver = flyer ? -1 : 0;
          if (err !== 4 && (err !== 8 || (body.p & 7) === 7)) outcome = "stuck";
          else {
            body.p += 1; // esquive d'un cran de profondeur
            outcome = commit(hor, 0) ? "ok" : "stuck";
          }
        } else {
          state.mode = 1;
          blocked = false;
          err = 0;
          body.err = 0;
        }
      } else if (state.mode === 1) {
        const prf = sgn(node.row - row);
        if (!blocked) {
          if (prf !== 0) outcome = commit(0, prf) ? "ok" : "stuck";
          else reached = true;
        } else {
          state.memo = prf;
          state.lateral = 1;
          ver = flyer ? -1 : 0;
          state.mode = 2;
        }
      } else if (state.mode === 2) {
        if (isBlocking(err)) {
          if (body.speedP === 0) {
            // le pas de côté est bloqué : un seul changement de sens (`0732`)
            if (state.lateral < 0) outcome = "stuck";
            else {
              state.lateral = -1;
              outcome = sidestep(-1);
            }
          } else outcome = sidestep(state.lateral);
        } else if (body.speedP === 0) {
          // le pas de côté a réussi : nouvel essai vers la rangée
          if (flyer) ver = body.height < body.y ? -1 : 0;
          outcome = commit(0, state.memo) ? "ok" : "stuck";
        } else {
          state.mode = 1;
          blocked = false;
          err = 0;
          body.err = 0;
        }
      } else throw new RangeError(`Sous-état de trajet invalide : ${state.mode}`);

      if (reached) {
        state.mode = 0;
        state.remaining -= 1;
        continue passes;
      }
      if (outcome === "ok") {
        result = FOLLOW_WALKING;
        break passes;
      }
      if (outcome === "stuck") {
        const next = stuck();
        if (next === "retry") continue passes;
        result = next;
        break passes;
      }
    }
  }
  if (result === FOLLOW_WALKING && savedErr !== 0 && body.speedX === savedHor && body.speedP === savedPrf && body.speedY === savedVer && isBlocking(savedErr)) {
    result = FOLLOW_BLOCKED;
  }
  return result;
}

/**
 * Suivi d'un trajet, `30d9:0006` : trajet perdu (`Nbc < 0`) recalculé, `30d9:0184`, puis `Err = 0` ; un résultat non nul arrête l'objet
 * (`2273:0190`), un résultat nul sans aucune vitesse devient 5. Non porté : cibles mobiles, objet hors de la salle chargée.
 */
export function followPath(state: PathState, body: FollowBody, context: FollowContext = {}): number {
  if (!state.defined) return FOLLOW_NO_PATH;
  let result: number;
  if (state.remaining < 0 && !context.recompute?.(state, false)) result = FOLLOW_NO_PATH;
  else result = followNodes(state, body, context);
  body.err = 0;
  if (result === FOLLOW_WALKING) {
    if (body.speedX === 0 && body.speedP === 0 && body.speedY === 0) result = FOLLOW_BLOCKED;
  } else {
    body.speedX = 0;
    body.speedP = 0;
    body.speedY = 0;
  }
  return result;
}
