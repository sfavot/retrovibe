/**
 * Polygones des pièces : recherche de chemin autour des obstacles (`AvoidPath`), point dans un polygone (`InPolygon`) et
 * fusion de polygones (`MergePoly`). Calculs purs ; `kernel/polygons.ts` lit les objets `Polygon` des scripts.
 *
 * Référence : `engines/sci/engine/kpathing.cpp` de ScummVM (`contained`, `fix_vertex_order`, `fixup_start_point`,
 * `fixup_end_point`, `findNearPoint`, `find_free_point`, `nearest_intersection`, `merge_point`, `visible_vertices`, `AStar`,
 * `output_path`, `kAvoidPath`, `kMergePoly`, `mergeSinglePolygon`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * **Genres de polygones** : accès total (0 : il s'efface si le départ ou l'arrivée est dedans, sinon il se contourne), accès au plus près (1 : obstacle ;
 * viser dedans mène au bord le plus proche, puis au point visé), accès barré (2 : obstacle ; viser dedans mène au bord le
 * plus proche), accès contenu (3 : l'acteur doit rester **dedans**).
 *
 * **Recherche de chemin** :
 * 1. chaque polygon est orienté (un sens pour les obstacles, l'autre pour l'accès contenu), ce qui dit de quel côté d'une
 *    arête se trouve l'intérieur interdit ;
 * 2. le départ et l'arrivée sont sortis des obstacles : ramenés au point libre le plus proche de leur contour ; le point
 *    d'origine est gardé en tête du chemin (départ) ou en queue (arrivée dans un polygon « au plus près ») ;
 * 3. départ et arrivée deviennent des sommets, greffés sur une arête s'ils y tombent ;
 * 4. A* sur le graphe de visibilité : deux sommets se voient si le segment qui les joint n'entre dans aucun polygon ; le
 *    coût est la distance, tronquée à l'entier, plus 10 000 pour un sommet posé sur le bord de l'écran (l'acteur ne longe
 *    pas le cadre) ;
 * 5. le chemin est la suite des sommets ; si l'arrivée est inatteignable, il s'arrête au départ.
 *
 * L'ordre des sommets et celui des listes suivent l'original, car ils départagent les chemins de même coût.
 *
 * **Fusion** (`mergePolygons`) : le polygon de travail absorbe ceux qu'il chevauche ; chaque chevauchement est une
 * « pièce » (là où le contour de travail entre dans l'autre polygon, puis en ressort) remplacée par le contour de l'autre.
 *
 * Écarts volontaires : listes circulaires remplacées par des tableaux (même ordre de parcours) ; pas des contournements de
 * ScummVM propres à d'autres jeux (Laura Bow 2, Larry 5, Quest for Glory) ; un échec (point libre introuvable) rend
 * `undefined` au lieu d'un code, l'appelant trace alors la ligne droite comme l'original.
 */

export interface Point {
  x: number;
  y: number;
}

export const PolygonType = { TotalAccess: 0, NearestAccess: 1, BarredAccess: 2, ContainedAccess: 3 } as const;
/** Bit ajouté au `type` d'un polygon absorbé par `MergePoly`. */
export const POLYGON_MERGED = 0x10;
/** Coordonnée qui termine une liste de points. */
export const PATH_END = 0x7777;

/** Polygon tel que les scripts le décrivent : son genre et ses points dans l'ordre de la ressource. */
export interface PolygonInput {
  type: number;
  points: readonly Point[];
}

const Containment = { Outside: 0, OnEdge: 1, Inside: 2 } as const;
type Containment = (typeof Containment)[keyof typeof Containment];

const HUGE_DISTANCE = 0xffffffff;
/** Surcoût d'un sommet posé sur le bord de l'écran. */
const SCREEN_EDGE_PENALTY = 10000;
/** Pièces qu'une fusion peut garder. */
const MAX_PATCHES = 8;
/** Carré de la distance sous laquelle une extrémité d'arête « touche » une autre arête, pour la fusion. */
const TOUCH_DISTANCE_SQUARED = 2;

interface Vertex extends Point {
  polygon: Polygon;
  costG: number;
  costF: number;
  previous: Vertex | undefined;
}

interface Polygon {
  type: number;
  /** Sommets dans l'ordre de parcours ; le suivant du dernier est le premier. */
  vertices: Vertex[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------------------------------------------------------------

/** Double de l'aire signée du triangle (a, b, c), dans le repère de l'écran (y vers le bas). */
function area(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (a.y - c.y) - (c.x - a.x) * (a.y - b.y);
}

function left(a: Point, b: Point, c: Point): boolean {
  return area(a, b, c) > 0;
}

function collinear(a: Point, b: Point, c: Point): boolean {
  return area(a, b, c) === 0;
}

/** `c` est-il sur le segment fermé [a, b] ? */
function between(a: Point, b: Point, c: Point): boolean {
  if (!collinear(a, b, c)) return false;
  if (a.x !== b.x) return (a.x <= c.x && c.x <= b.x) || (a.x >= c.x && c.x >= b.x);
  return (a.y <= c.y && c.y <= b.y) || (a.y >= c.y && c.y >= b.y);
}

/** Les segments [a, b] et [c, d] se croisent-ils franchement (ni contact, ni recouvrement) ? */
function intersectProper(a: Point, b: Point, c: Point, d: Point): boolean {
  const ab = (left(a, b, c) && left(b, a, d)) || (left(a, b, d) && left(b, a, c));
  const cd = (left(c, d, a) && left(d, c, b)) || (left(c, d, b) && left(d, c, a));
  return ab && cd;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function squaredDistance(a: Point, b: Point): number {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

/** Distance entière, tronquée, comme le coût d'une arête du graphe. */
function distance(a: Point, b: Point): number {
  return Math.trunc(Math.sqrt(squaredDistance(a, b)));
}

/** Arrondi de l'original pour un point calculé : + 0,5 puis troncature vers zéro. */
function roundCoordinate(value: number): number {
  return Math.trunc(value + 0.5);
}

function next(vertex: Vertex): Vertex {
  const ring = vertex.polygon.vertices;
  return ring[(ring.indexOf(vertex) + 1) % ring.length];
}

function previous(vertex: Vertex): Vertex {
  const ring = vertex.polygon.vertices;
  return ring[(ring.indexOf(vertex) + ring.length - 1) % ring.length];
}

function makeVertex(point: Point, polygon: Polygon): Vertex {
  return { x: point.x, y: point.y, polygon, costG: HUGE_DISTANCE, costF: HUGE_DISTANCE, previous: undefined };
}

/**
 * Sommets d'un polygon dans l'ordre de parcours de l'original : l'ordre de la ressource à l'envers, puis retourné si
 * l'orientation n'est pas celle de son genre (aire positive pour un obstacle, négative pour un accès contenu).
 */
function ringOf(input: PolygonInput): Point[] {
  const ring = [...input.points].reverse();
  let sum = 0;
  for (let i = 1; i + 1 < ring.length; i++) sum += area(ring[0], ring[i], ring[i + 1]);
  const wrong = input.type === PolygonType.ContainedAccess ? sum > 0 : sum < 0;
  return wrong ? [ring[0], ...ring.slice(1).reverse()] : ring;
}

function makePolygon(input: PolygonInput): Polygon {
  const polygon: Polygon = { type: input.type, vertices: [] };
  polygon.vertices = ringOf(input).map((point) => makeVertex(point, polygon));
  return polygon;
}

/**
 * Situation d'un point par rapport à un polygon. Pour un accès contenu, « dedans » et « dehors » sont échangés : « dedans »
 * veut toujours dire « là où l'acteur n'a pas le droit d'être ».
 */
function contained(p: Point, polygon: Polygon): Containment {
  const ring = polygon.vertices;
  let leftCrossings = 0;
  let rightCrossings = 0;
  for (let i = 0; i < ring.length; i++) {
    const v1 = ring[i];
    const v2 = ring[(i + 1) % ring.length];
    if (samePoint(p, v1)) return Containment.OnEdge;
    const straddlesRight = v1.y < p.y !== v2.y < p.y;
    const straddlesLeft = v1.y > p.y !== v2.y > p.y;
    if (!straddlesLeft && !straddlesRight) continue;
    // Abscisse du croisement avec l'horizontale du point, sous forme de fraction x / y.
    let x = v2.x * v1.y - v1.x * v2.y + (v1.x - v2.x) * p.y;
    let y = v1.y - v2.y;
    if (y < 0) {
      x = -x;
      y = -y;
    }
    if (straddlesRight && x > p.x * y) rightCrossings++;
    if (straddlesLeft && x < p.x * y) leftCrossings++;
  }
  if ((leftCrossings + rightCrossings) % 2 === 1) return Containment.OnEdge;
  const inside = rightCrossings % 2 === 1;
  if (polygon.type === PolygonType.ContainedAccess) return inside ? Containment.Outside : Containment.Inside;
  return inside ? Containment.Inside : Containment.Outside;
}

/** Le segment de `p` vers `vertex` entre-t-il dans le polygon de ce sommet ? */
function inside(p: Point, vertex: Vertex): boolean {
  if (vertex.polygon.vertices.length < 2) return false;
  const before = previous(vertex);
  const after = next(vertex);
  if (left(before, vertex, after)) return left(vertex, after, p) && left(before, vertex, p);
  return left(vertex, after, p) || left(before, vertex, p);
}

/** Point d'un polygon : dedans ou sur son bord ? (`InPolygon`, où l'accès contenu n'inverse rien.) */
export function pointInPolygon(p: Point, points: readonly Point[]): boolean {
  if (points.length === 0) return false;
  return contained(p, makePolygon({ type: PolygonType.BarredAccess, points })) !== Containment.Outside;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Recherche de chemin
// ---------------------------------------------------------------------------------------------------------------------------------

class PathState {
  polygons: Polygon[];
  prepend: Point | undefined;
  append: Point | undefined;

  constructor(
    inputs: readonly PolygonInput[],
    readonly width: number,
    readonly height: number,
  ) {
    this.polygons = inputs.filter((input) => input.points.length > 0).map(makePolygon);
  }

  pointOnScreenBorder(p: Point): boolean {
    return p.x === 0 || p.x === this.width - 1 || p.y === 0 || p.y === this.height - 1;
  }

  edgeOnScreenBorder(p: Point, q: Point): boolean {
    return (p.x === 0 && q.x === 0) || (p.y === 0 && q.y === 0) || (p.x === this.width - 1 && q.x === this.width - 1) || (p.y === this.height - 1 && q.y === this.height - 1);
  }

  remove(polygon: Polygon): void {
    this.polygons.splice(this.polygons.indexOf(polygon), 1);
  }
}

/** Point entier libre (pas « dedans ») autour d'un point à coordonnées réelles, ou `undefined`. */
function findFreePoint(f: Point, polygon: Polygon): Point | undefined {
  const rounded = { x: Math.floor(f.x + 0.5), y: Math.floor(f.y + 0.5) };
  if (contained(rounded, polygon) !== Containment.Inside) return rounded;
  const x = Math.floor(f.x);
  const y = Math.floor(f.y);
  for (const candidate of [
    { x, y },
    { x: x + 1, y },
    { x: x + 1, y: y + 1 },
    { x, y: y + 1 },
  ]) {
    if (contained(candidate, polygon) !== Containment.Inside) return candidate;
  }
  return undefined;
}

/** Point libre le plus proche de `p` sur le contour du polygon ; les arêtes posées sur le bord de l'écran ne comptent pas. */
function findNearPoint(state: PathState, p: Point, polygon: Polygon): Point | undefined {
  const ring = polygon.vertices;
  let best = HUGE_DISTANCE;
  let nearest: Point = { x: 0, y: 0 };
  for (let i = 0; i < ring.length; i++) {
    const v1 = ring[i];
    const v2 = ring[(i + 1) % ring.length];
    if (polygon.type !== PolygonType.ContainedAccess && state.edgeOnScreenBorder(v1, v2)) continue;
    const u = Math.min(Math.max(((p.x - v1.x) * (v2.x - v1.x) + (p.y - v1.y) * (v2.y - v1.y)) / squaredDistance(v1, v2), 0), 1);
    const candidate = { x: v1.x + u * (v2.x - v1.x), y: v1.y + u * (v2.y - v1.y) };
    const d = squaredDistance(p, { x: roundCoordinate(candidate.x), y: roundCoordinate(candidate.y) });
    if (d < best) {
      best = d;
      nearest = candidate;
    }
  }
  return findFreePoint(nearest, polygon);
}

/** Un voisin immédiat de `p` est-il hors de l'interdit ? */
function nearPolygon(p: Point, polygon: Polygon): boolean {
  return [
    { x: p.x - 1, y: p.y },
    { x: p.x + 1, y: p.y },
    { x: p.x, y: p.y - 1 },
    { x: p.x, y: p.y + 1 },
  ].some((neighbour) => contained(neighbour, polygon) !== Containment.Inside);
}

/** Sort le départ des obstacles. Renvoie le départ retenu, ou `undefined` si aucun point libre n'existe. */
function fixupStart(state: PathState, start: Point): Point | undefined {
  let result = start;
  for (const polygon of [...state.polygons]) {
    const situation = contained(start, polygon);
    if (polygon.type === PolygonType.TotalAccess) {
      if (situation !== Containment.Outside) state.remove(polygon);
      continue;
    }
    if (polygon.type === PolygonType.ContainedAccess && situation === Containment.Inside && !nearPolygon(start, polygon)) {
      // Le départ est loin hors de la zone permise : ce polygon ne peut pas le concerner.
      state.remove(polygon);
      continue;
    }
    if (polygon.type !== PolygonType.ContainedAccess && polygon.type !== PolygonType.BarredAccess && polygon.type !== PolygonType.NearestAccess) continue;
    if (situation === Containment.Outside || state.prepend) continue;
    const moved = findNearPoint(state, start, polygon);
    if (!moved) return undefined;
    result = moved;
    if (!samePoint(moved, start)) state.prepend = start;
  }
  return result;
}

/** Sort l'arrivée des obstacles. */
function fixupEnd(state: PathState, end: Point): Point | undefined {
  let result = end;
  for (const polygon of [...state.polygons]) {
    const situation = contained(end, polygon);
    if (polygon.type === PolygonType.TotalAccess) {
      if (situation !== Containment.Outside) state.remove(polygon);
      continue;
    }
    if (polygon.type !== PolygonType.ContainedAccess && polygon.type !== PolygonType.BarredAccess && polygon.type !== PolygonType.NearestAccess) continue;
    if (situation === Containment.Outside || state.append) continue;
    const moved = findNearPoint(state, end, polygon);
    if (!moved) return undefined;
    result = moved;
    if (polygon.type === PolygonType.NearestAccess && !samePoint(moved, end)) state.append = end;
  }
  return result;
}

/** Croisement des segments [a, b] et [c, d] : sur [a, b] extrémités comprises, strictement à l'intérieur de [c, d]. */
function intersection(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (denominator === 0) return undefined;
  const s = ((a.y - c.y) * (d.x - c.x) - (a.x - c.x) * (d.y - c.y)) / denominator;
  const t = ((a.y - c.y) * (b.x - a.x) - (a.x - c.x) * (b.y - a.y)) / denominator;
  if (s < 0 || s > 1 || t <= 0 || t >= 1) return undefined;
  return { x: a.x + s * (b.x - a.x), y: a.y + s * (b.y - a.y) };
}

/**
 * Déplacement au clavier (`opt` 0) : premier contour d'obstacle rencontré de `p` vers `q`. Renvoie le point libre à cet
 * endroit, `null` s'il n'y a pas de croisement, `undefined` si aucun point libre n'existe.
 */
function nearestIntersection(state: PathState, p: Point, q: Point): Point | null | undefined {
  let best = HUGE_DISTANCE;
  let found: { point: Point; polygon: Polygon } | undefined;
  for (const polygon of state.polygons) {
    for (const vertex of polygon.vertices) {
      let candidate: Point | undefined;
      if (between(p, q, vertex)) {
        if (!inside(q, vertex)) continue;
        candidate = vertex;
      } else {
        const after = next(vertex);
        if (!left(vertex, after, q)) continue;
        candidate = intersection(p, q, vertex, after);
        if (!candidate) continue;
      }
      const d = squaredDistance(p, { x: Math.trunc(candidate.x), y: Math.trunc(candidate.y) });
      if (d < best) {
        best = d;
        found = { point: { x: candidate.x, y: candidate.y }, polygon };
      }
    }
  }
  if (!found) return null;
  return findFreePoint(found.point, found.polygon);
}

/** Fait de `point` un sommet : celui qui s'y trouve déjà, un nouveau greffé sur l'arête qui le porte, ou un sommet isolé. */
function mergePoint(state: PathState, point: Point): Vertex {
  for (const polygon of state.polygons) {
    const existing = polygon.vertices.find((vertex) => samePoint(vertex, point));
    if (existing) return existing;
  }
  for (const polygon of state.polygons) {
    const ring = polygon.vertices;
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i++) {
      if (!between(ring[i], ring[(i + 1) % ring.length], point)) continue;
      const vertex = makeVertex(point, polygon);
      ring.splice(i + 1, 0, vertex);
      return vertex;
    }
  }
  const single: Polygon = { type: PolygonType.BarredAccess, vertices: [] };
  const vertex = makeVertex(point, single);
  single.vertices.push(vertex);
  state.polygons.unshift(single);
  return vertex;
}

/** Sommets visibles depuis `from`, dans l'ordre où A* les examine (le dernier de la liste des sommets d'abord). */
function visibleVertices(all: readonly Vertex[], from: Vertex): Vertex[] {
  const visible: Vertex[] = [];
  for (const to of all) {
    if (to === from || inside(to, from) || inside(from, to)) continue;
    let blocked = false;
    for (const edge of all) {
      if (edge.polygon.vertices.length < 2) continue;
      if (between(from, to, edge)) {
        // Le segment passe par ce sommet : il ne gêne que si le segment entre dans son polygon.
        if (inside(from, edge) || inside(to, edge)) {
          blocked = true;
          break;
        }
      } else if (intersectProper(from, to, edge, next(edge))) {
        blocked = true;
        break;
      }
    }
    if (!blocked) visible.unshift(to);
  }
  return visible;
}

function search(state: PathState, start: Vertex, end: Vertex): void {
  const all = state.polygons.flatMap((polygon) => polygon.vertices);
  const open: Vertex[] = [start];
  const closed = new Set<Vertex>();
  start.costG = 0;
  start.costF = distance(start, end);
  while (open.length > 0) {
    let current = open[0];
    for (const vertex of open) if (vertex.costF < current.costF) current = vertex;
    if (current === end) return;
    open.splice(open.indexOf(current), 1);
    closed.add(current);
    for (const vertex of visibleVertices(all, current)) {
      if (closed.has(vertex)) continue;
      if (!open.includes(vertex)) open.unshift(vertex);
      let cost = current.costG + distance(current, vertex);
      if (state.pointOnScreenBorder(vertex)) cost += SCREEN_EDGE_PENALTY;
      if (cost < vertex.costG) {
        vertex.costG = cost;
        vertex.costF = cost + distance(vertex, end);
        vertex.previous = current;
      }
    }
  }
}

export interface PathOptions {
  /** Taille de la zone de jeu : ses bords sont ceux que les chemins évitent de longer. */
  width: number;
  height: number;
  /** 0 : déplacement au clavier (on s'arrête au premier obstacle) ; 1 et plus : contournement. */
  opt?: number;
}

/**
 * Chemin de `start` à `end` autour des polygones : la suite des points à rejoindre, départ compris, sans le point final
 * `PATH_END`. Si l'arrivée est inatteignable, le chemin s'arrête au départ.
 */
export function findPath(start: Point, end: Point, polygons: readonly PolygonInput[], options: PathOptions): Point[] {
  const opt = options.opt ?? 1;
  const state = new PathState(polygons, options.width, options.height);
  if (opt === 0) {
    // Au clavier, seuls les obstacles francs arrêtent : les polygones « au plus près » se traversent.
    state.polygons = state.polygons.filter((polygon) => polygon.type !== PolygonType.TotalAccess);
    for (const polygon of state.polygons) if (polygon.type === PolygonType.NearestAccess) polygon.type = PolygonType.TotalAccess;
  }
  let from = fixupStart(state, start);
  const to = from && fixupEnd(state, end);
  if (!from || !to) return [start, end];
  if (opt === 0 && !state.prepend) {
    const hit = nearestIntersection(state, from, to);
    if (hit === undefined) return [start, end];
    if (hit !== null) {
      state.prepend = from;
      from = hit;
    }
  }
  const first = mergePoint(state, from);
  const last = mergePoint(state, to);
  search(state, first, last);

  if (!last.previous) return [state.prepend ?? plain(first), plain(first)];
  const path: Point[] = [];
  for (let vertex: Vertex | undefined = last; vertex; vertex = vertex.previous) path.unshift(plain(vertex));
  if (state.prepend) path.unshift(state.prepend);
  if (state.append) path.push(state.append);
  return path;
}

function plain(point: Point): Point {
  return { x: point.x, y: point.y };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fusion de polygones
// ---------------------------------------------------------------------------------------------------------------------------------

/** Une pièce : le contour de travail entre dans l'autre polygon sur son arête `w1` et en ressort sur son arête `w2`. */
interface Patch {
  w1: number;
  p1: number;
  enter: Point;
  w2: number;
  p2: number;
  exit: Point;
  disabled: boolean;
}

function edgeEnd<T>(ring: readonly T[], index: number): T {
  return ring[(index + 1) % ring.length];
}

/** Direction d'une arête en degrés entiers. */
function edgeDirection(ring: readonly Point[], index: number): number {
  const from = ring[index];
  const to = edgeEnd(ring, index);
  return Math.trunc((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

/** Sens du croisement de deux arêtes : produit vectoriel de leurs directions. */
function crossingDirection(a: Point, b: Point, c: Point, d: Point): number {
  return (b.x - a.x) * (d.y - c.y) - (d.x - c.x) * (b.y - a.y);
}

function pointSegmentDistanceSquared(p: Point, a: Point, b: Point): number {
  const length = squaredDistance(a, b);
  const u = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length;
  if (u < 0 || u > 1) return Math.min(squaredDistance(p, a), squaredDistance(p, b));
  const x = a.x + u * (b.x - a.x);
  const y = a.y + u * (b.y - a.y);
  return (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
}

/**
 * Point de rencontre de l'arête de travail [a, b] et de l'arête [c, d], pour la fusion. `hit` dit si la rencontre compte ;
 * comme l'original, un `d` posé sur [a, b] donne un point sans compter (l'arête suivante le reprendra).
 */
function mergeIntersection(a: Point, b: Point, c: Point, d: Point): { hit: boolean; point?: Point } {
  if (collinear(a, b, c) && collinear(a, b, d)) return { hit: false };
  if (between(a, b, c)) return { hit: true, point: c };
  if (between(a, b, d)) return { hit: false, point: d };
  if (samePoint(c, d)) throw new Error("GK1 : MergePoly, arête de longueur nulle");
  if (pointSegmentDistanceSquared(a, c, d) <= TOUCH_DISTANCE_SQUARED) return { hit: true, point: a };
  if (pointSegmentDistanceSquared(b, c, d) <= TOUCH_DISTANCE_SQUARED) return { hit: true, point: b };
  const crossing = intersection(a, b, c, d);
  if (!crossing) return { hit: false };
  return { hit: true, point: { x: roundCoordinate(crossing.x), y: roundCoordinate(crossing.y) } };
}

/** Positif si `p` est plus loin de `v` que `q`. */
function liesBefore(v: Point, p: Point, q: Point): number {
  return squaredDistance(v, p) - squaredDistance(v, q);
}

/** La pièce `p1` rend-elle `p2` superflue ? */
function patchCovers(work: readonly Point[], p1: Patch, p2: Patch): boolean {
  if (samePoint(p1.enter, p2.enter) && samePoint(p1.exit, p2.exit)) return true;
  const strictlyInside = (outer: Patch, index: number): boolean =>
    outer.w1 < outer.w2 ? outer.w1 < index && index < outer.w2 : outer.w1 > outer.w2 ? index > outer.w1 || index < outer.w2 : false;
  if (strictlyInside(p1, p2.w1) || strictlyInside(p1, p2.w2)) return true;
  if (strictlyInside(p2, p1.w1) || strictlyInside(p2, p1.w2)) return false;
  if (p1.w1 !== p1.w2) {
    if (p1.w1 === p2.w1) return liesBefore(work[p1.w1], p1.enter, p2.enter) < 0;
    if (p1.w2 === p2.w1) return liesBefore(work[p1.w2], p1.exit, p2.enter) > 0;
    return false;
  }
  if (liesBefore(work[p1.w1], p1.enter, p1.exit) > 0) return p2.w1 !== p1.w1;
  if (liesBefore(work[p2.w1], p2.enter, p2.exit) > 0) return false;
  if (liesBefore(work[p1.w1], p2.enter, p1.enter) <= 0) return false;
  if (liesBefore(work[p1.w1], p2.enter, p1.exit) >= 0) return false;
  return true;
}

function patchCoversVertex(work: readonly Point[], patch: Patch, index: number): boolean {
  if (patch.w1 < patch.w2) return patch.w1 < index && index <= patch.w2;
  if (patch.w1 > patch.w2) return index <= patch.w2 || index > patch.w1;
  return liesBefore(work[patch.w1], patch.enter, patch.exit) > 0;
}

/** Fond `other` dans `work`. Renvoie le nouveau contour, ou `undefined` s'ils ne se chevauchent pas. */
function mergeSingle(work: readonly Point[], other: readonly Point[]): Point[] | undefined {
  const patches: Patch[] = [];
  for (let w1 = 0; w1 < work.length; w1++) {
    for (let p1 = 0; p1 < other.length; p1++) {
      const first = mergeIntersection(work[w1], edgeEnd(work, w1), other[p1], edgeEnd(other, p1));
      if (!first.hit) continue;
      if (crossingDirection(work[w1], edgeEnd(work, w1), other[p1], edgeEnd(other, p1)) >= 0) continue;
      // Le contour de travail entre dans l'autre polygon : suivre celui-ci jusqu'à ce que le contour en ressorte.
      let angle = 0;
      let base = edgeDirection(work, w1);
      let found = false;
      let exit: Point | undefined;
      let p2 = p1;
      let w2 = w1;
      for (let k = 0; k < other.length && !found; k++) {
        p2 = (p1 + 1 + k) % other.length;
        const direction = edgeDirection(other, p2);
        let turn = direction - base;
        if (turn > 180) turn -= 360;
        else if (turn < -180) turn += 360;
        angle += turn;
        base = direction;
        for (let j = 0; j < work.length; j++) {
          w2 = (w1 + j) % work.length;
          const second = mergeIntersection(work[w2], edgeEnd(work, w2), other[p2], edgeEnd(other, p2));
          found = second.hit;
          if (second.point) exit = second.point;
          if (found && crossingDirection(work[w2], edgeEnd(work, w2), other[p2], edgeEnd(other, p2)) > 0) break;
        }
      }
      if (!found || !exit || angle < 0) continue;
      if (patches.length >= MAX_PATCHES) throw new Error("GK1 : MergePoly, trop de pièces");
      const patch: Patch = { w1, p1, enter: first.point!, w2, p2, exit, disabled: false };
      if (patches.some((earlier) => patchCovers(work, earlier, patch))) continue;
      for (const earlier of patches) if (patchCovers(work, patch, earlier)) earlier.disabled = true;
      patches.push(patch);
    }
  }
  if (patches.length === 0) return undefined;

  const merged: Point[] = [];
  const active = patches.filter((patch) => !patch.disabled);
  for (let index = 0; index < work.length; index++) {
    if (!active.some((patch) => patchCoversVertex(work, patch, index))) merged.push(plain(work[index]));
    for (const patch of active) {
      if (patch.w1 !== index) continue;
      if (!samePoint(patch.enter, work[index])) merged.push(plain(patch.enter));
      for (let at = patch.p1; at !== patch.p2; ) {
        at = (at + 1) % other.length;
        merged.push(plain(other[at]));
      }
      if (!samePoint(patch.exit, other[patch.p2])) merged.push(plain(patch.exit));
    }
  }
  if (merged.length > 1 && samePoint(merged[0], merged[merged.length - 1])) merged.pop();
  return merged;
}

/**
 * Fond dans le polygon `work` (points dans l'ordre des scripts) chacun des `polygons` qu'il chevauche, l'un après l'autre.
 * `points` est le contour obtenu, sans point répété à la suite ; `merged` dit quels polygones ont été absorbés.
 */
export function mergePolygons(work: readonly Point[], polygons: readonly PolygonInput[]): { points: Point[]; merged: boolean[] } {
  let current: Point[] = work.map(plain);
  const merged = polygons.map((input) => {
    if (input.points.length === 0) return false;
    // L'autre polygon est parcouru dans le sens contraire de celui de la recherche de chemin, depuis son deuxième sommet.
    const ring = ringOf(input);
    const other = [ring[0], ...ring.slice(1).reverse()];
    other.push(other.shift()!);
    const result = mergeSingle(current, other);
    if (result) current = result;
    return result !== undefined;
  });
  const points = current.filter((point, index) => index === 0 || !samePoint(point, current[index - 1]));
  return { points, merged };
}
