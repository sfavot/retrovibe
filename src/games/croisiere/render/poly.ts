/**
 * Rastériseur des modèles polygonaux (« sprites » vectoriels) de Croisière pour un cadavre, au bit près (docs/croisiere/engine.md § 3
 * « Polygones » et § 10, formats.md § 3.3).
 *
 * Référence : ScummVM (GPL v3+), relu puis réécrit :
 * - `engines/cruise/mainDraw.cpp` : `flipPoly`, `upscaleValue`, `getPolySize`, `blitPolyMode1`, `blitPolyMode2`, `buildSegment`,
 *   `drawPolyMode1`, `drawPolyMode2`, `buildPolyModel`, `findPoly`, le cadrage de `mainDrawPolygons`, et l'état global `bigPolyBuf`
 *   (`DIST_3D`, `polyBuffer2`, `XMIN_XMAX`, `polyBuffer4`), `nbseg`, `nbligne`, `A2ptr`, `polyXMin/Max`, `polyYMin/Max`, `m_*` ;
 * - `engines/cruise/ctp.cpp` : `renderCTPWalkBox` et la lecture de `XMIN_XMAX` par `makeCtStruct` ;
 * - `engines/cruise/cruise_main.cpp` : `testMask`, et la redirection miroir recopiée dans `findObject`.
 * `polys.cpp` (`fillpoly`, `line`) ne sert qu'au tracé de débogage des zones (`drawCtp`, commenté) : il n'est pas porté.
 *
 * L'état partagé de ScummVM (tampons et compteurs globaux, réutilisés d'un appel à l'autre par le dessin, le hit-test et la
 * rastérisation des zones de marche) vit dans une instance de `PolyRasterizer`, à créer une seule fois et à partager entre ces trois
 * usages, dans le même ordre d'appel que le moteur.
 *
 * Particularités reproduites (vérifiées au bit près contre le code de ScummVM compilé, voir test/croisiere/render/poly.test.ts) :
 * 1. Les quatre tampons int16 sont contigus dans un seul `Int16Array` (`bigPolyBuf`, 1 940 mots) adressé par indices : les débordements
 *    d'un tampon sur son voisin (FIXME de ScummVM) donnent le même résultat. En miroir, `drawPolyMode1` écrit l'anneau des sommets
 *    *sous* `polyBuffer4 + 2 × nbseg`, où `nbseg` est le nombre de sommets du polygone *précédent* (dessin, hit-test ou zone de marche) :
 *    si le polygone courant en a davantage, l'anneau descend dans `XMIN_XMAX`, que `buildSegment` réinitialise ensuite pendant qu'il le
 *    relit (le contour lu peut alors être altéré, comme dans le jeu).
 * 2. Toutes les cases des tampons sont des int16 (troncature au stockage) ; les calculs intermédiaires sont des int 32 bits (`| 0`).
 * 3. Divisions et décalages comme en C : `>>` arithmétique sur les négatifs (demi-échelle, arrondi `(v + 0x8000) >> 16`), division
 *    tronquée vers zéro.
 * 4. Demi-résolution sous l'échelle `0x180` (coordonnées `>> 1`, échelle doublée) ; LOD par polygone (`minScale <= |échelle|`, sur
 *    l'échelle non doublée) ; miroir par échelle négative ; renvoi miroir (`flipPoly`) qui inverse l'échelle et décale la position.
 * 5. `buildSegment` : polygone entièrement hors écran → `XMIN_XMAX[0] = -1`, `nbligne = -1`, le reste du tableau garde l'état
 *    précédent ; polygone d'une seule ligne → un seul intervalle, sans relire l'écrêtage vertical ; lignes jamais touchées laissées à
 *    `[5000, -5000]` (vides) ; une arête horizontale propose son x droit comme minimum et son x gauche comme maximum ; une arête en
 *    pente faible prend déjà l'abscisse suivante quand elle change de ligne (un pixel de plus à droite), et son dernier pixel n'est
 *    ajouté que si l'erreur est négative au dernier pas.
 * 6. Le hit-test (`findPoly`) s'arrête au premier polygone touché : l'état reste celui de ce polygone.
 * 7. Le cadrage de `mainDrawPolygons` (boîte de `getPolySize` élargie de 2 à gauche, en haut et en bas, de 18 à droite) peut renoncer
 *    au dessin, auquel cas l'état n'est pas modifié.
 *
 * Écarts volontaires (aucun ne se produit sur les données du jeu : les 17 renvois visent des modèles, test/croisiere/data/sets.test.ts ;
 * au plus 55 sommets par polygone et 12 par zone de marche) :
 * - un renvoi miroir dont la cible n'est pas un modèle (absente, d'un autre type, ou elle-même un renvoi) n'est ni dessiné ni touché ;
 *   ScummVM lirait alors les octets qui suivent le renvoi comme un modèle ;
 * - un polygone ou une zone de moins de 2 sommets, un modèle de moins de 2 points (ScummVM bouclerait sur un compteur négatif) et tout
 *   accès hors de `bigPolyBuf` (au-delà de 128 sommets) lèvent une `RangeError` (ScummVM écrirait dans la mémoire voisine) ;
 * - la table d'indices `walkboxTable` de `ctp.cpp` (18 octets pour 19 points possibles) n'existe pas : les indices `0..n-1` sont
 *   générés, ce que donne aussi le débordement dans ScummVM.
 */
import type { PolyModel, PolyRecord } from "../data/poly-model";

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
/** Octets par ligne d'un masque d'occultation plein écran (`polygonMask`, 1 bit par pixel, bit fort à gauche). */
export const POLY_MASK_STRIDE = SCREEN_WIDTH / 8;
/** Taille d'un masque plein écran (`(320 * 200) / 8`). */
export const POLY_MASK_SIZE = POLY_MASK_STRIDE * SCREEN_HEIGHT;

/** Disposition de `bigPolyBuf` (en mots int16). */
const DIST_3D = 0; // deltas des points du modèle
const POLY_POINTS = 512; // `polyBuffer2` : points transformés (x, y)
const SPANS = 1024; // `XMIN_XMAX` : [ligne de départ, (xmin, xmax) par ligne..., -1]
const EDGES = 1428; // `polyBuffer4` : anneau des sommets du polygone courant (deux copies consécutives)
const BUFFER_WORDS = 1940;

const HALF_RES_SCALE = 0x180;
const ROUND_HALF = 0x8000;
const EMPTY_MIN = 5000;
const EMPTY_MAX = -5000;
const LAST_X = SCREEN_WIDTH - 1;
const LAST_Y = SCREEN_HEIGHT - 1;

/** `upscaleValue` : `((value * scale) << 8) / 2`, en int 32 bits. Le résultat est pair, la division est exacte. */
function upscale(value: number, scale: number): number {
  return (Math.imul(value, scale) << 8) / 2;
}

/** `(v + 0x8000) >> 16` en int 32 bits : arrondi d'une valeur 16.16. */
function round16(value: number): number {
  return ((value + ROUND_HALF) | 0) >> 16;
}

/** Entrée de `flipPoly` : modèle à dessiner et position / échelle corrigées. */
export interface ResolvedPoly {
  readonly model: PolyModel;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** Boîte de `getPolySize` (bornes incluses, coordonnées écran). */
export interface PolyBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Rectangle modifié par `drawCell` (`addDirtyRect` : `right` et `bottom` exclus). */
export interface DirtyRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Lecture de `XMIN_XMAX` faite par `makeCtStruct` : ligne de départ, puis un intervalle `[x1, x2]` par ligne. */
export interface SpanTable {
  readonly top: number;
  readonly spans: ReadonlyArray<readonly [x1: number, x2: number]>;
}

/** Enregistrement de l'entrée `fileIndex` (pour la cible d'un renvoi miroir), `null` si elle n'est pas un enregistrement vectoriel chargé. */
export type PolyResolver = (fileIndex: number) => PolyRecord | null;

/**
 * `flipPoly` (et sa copie dans `findObject`) : un renvoi miroir désigne l'entrée `fileIndex + offset` (int16), dessinée avec l'échelle
 * opposée en `(x - newX, y - newY)`. Rend `null` si la cible n'est pas un modèle (écart volontaire, voir l'en-tête).
 */
export function resolvePoly(fileIndex: number, record: PolyRecord, x: number, y: number, scale: number, resolve: PolyResolver): ResolvedPoly | null {
  if (record.kind === "model") return { model: record, x, y, scale };
  const target = ((record.offset + fileIndex) << 16) >> 16;
  const model = target >= 0 ? resolve(target) : null;
  if (!model || model.kind !== "model") return null;
  return { model, x: x - record.newX, y: y - record.newY, scale: -scale | 0 };
}

/** `getPolySize` : boîte englobante annoncée par l'en-tête du modèle (`upperX/Y`, `lowerX/Y`), sans demi-résolution. */
export function polyBounds(model: PolyModel, x: number, y: number, scale: number): PolyBounds {
  const flip = scale < 0;
  const absScale = flip ? -scale : scale;
  const edge = (value: number) => round16(upscale(value, absScale));

  let lower = -edge(flip ? -model.lowerX : model.lowerX);
  let upper = edge(flip ? -(model.upperX - model.lowerX) : model.upperX - model.lowerX);
  if (upper < lower) [lower, upper] = [upper, lower];
  const left = lower + x;
  const right = upper + x;

  lower = -edge(model.lowerY);
  upper = edge(model.upperY - model.lowerY);
  if (upper < lower) [lower, upper] = [upper, lower];
  return { left, right, top: lower + y, bottom: upper + y };
}

/** Bit `(x, y)` d'un masque (`testMask`) : vrai si le pixel peut être dessiné. */
function testMask(mask: Uint8Array, x: number, y: number, stride: number): boolean {
  return (mask[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
}

export class PolyRasterizer {
  /** `bigPolyBuf` : les quatre tampons int16 contigus. */
  private readonly buf = new Int16Array(BUFFER_WORDS);
  /** `nbseg` : nombre de sommets du dernier polygone tracé (0 au démarrage, comme la variable globale). */
  private segments = 0;
  /** `nbligne` (int16) : lignes de `XMIN_XMAX` valides, -1 si le dernier polygone était hors écran. */
  private lines = 0;

  /** Nombre de sommets du dernier polygone (`nbseg`). */
  get segmentCount(): number {
    return this.segments;
  }

  /** Nombre de lignes du dernier tracé (`nbligne`), -1 s'il était hors écran. */
  get lineCount(): number {
    return this.lines;
  }

  /** Copie de `bigPolyBuf` (diagnostic et tests). */
  snapshot(): Int16Array {
    return this.buf.slice();
  }

  /**
   * `mainDrawPolygons` sans la construction du masque (vague R2) : renvoi miroir, cadrage par `getPolySize`, puis `buildPolyModel`.
   * `mask` : masque plein écran (`POLY_MASK_SIZE` octets, tout à 0xFF s'il n'y a pas d'occultation) ; `null` dessine sans masque.
   * Rend le rectangle modifié, ou `null` si rien n'a été tenté (hors écran, ou renvoi miroir invalide).
   */
  drawCell(
    fileIndex: number,
    record: PolyRecord,
    x: number,
    y: number,
    scale: number,
    dest: Uint8Array,
    mask: Uint8Array | null,
    resolve: PolyResolver,
  ): DirtyRect | null {
    const poly = resolvePoly(fileIndex, record, x, y, scale, resolve);
    if (!poly) return null;
    const box = polyBounds(poly.model, poly.x, poly.y, poly.scale);
    let left = box.left - 2;
    let right = box.right + 18;
    let top = box.top - 2;
    let bottom = box.bottom + 2;
    if (left >= SCREEN_WIDTH || right < 0 || top >= SCREEN_HEIGHT || bottom < 0) return null;
    left = Math.max(left, 0);
    right = Math.min(right, SCREEN_WIDTH);
    top = Math.max(top, 0);
    bottom = Math.min(bottom, SCREEN_HEIGHT);
    if (right === left || bottom === top) return null;
    this.drawModel(poly.model, poly.x, poly.y, poly.scale, dest, mask);
    return { left, top, right, bottom };
  }

  /**
   * `buildPolyModel` : transforme les points puis remplit chaque polygone visible à cette échelle avec sa couleur (index de palette,
   * sans conversion), à travers `mask` (`blitPolyMode1`) ou sans masque (`blitPolyMode2`, incrustations de fond). `dest` : 320 × 200.
   */
  drawModel(model: PolyModel, x: number, y: number, scale: number, dest: Uint8Array | null, mask: Uint8Array | null = null): void {
    const { absScale, flip } = this.transformPoints(model, x, y, scale);
    for (const polygon of model.polygons) {
      if (polygon.minScale > absScale) continue;
      this.traceRing(polygon.indices, polygon.indices.length, flip);
      if (dest) this.blit(dest, mask, polygon.color & 0xff);
    }
  }

  /** `findPoly` : vrai si `(mouseX, mouseY)` tombe dans un polygone visible du modèle ; s'arrête au premier trouvé. */
  hitTest(model: PolyModel, x: number, y: number, scale: number, mouseX: number, mouseY: number): boolean {
    const { absScale, flip } = this.transformPoints(model, x, y, scale);
    for (const polygon of model.polygons) {
      if (polygon.minScale > absScale) continue;
      this.traceRing(polygon.indices, polygon.indices.length, flip);
      const top = this.buf[SPANS]!;
      if (mouseY >= top && mouseY < top + this.lines) {
        const at = SPANS + 1 + (mouseY - top) * 2;
        if (mouseX >= this.buf[at]! && mouseX <= this.buf[at + 1]!) return true;
      }
    }
    return false;
  }

  /** Hit-test de `findObject` : renvoi miroir résolu sur place, puis `findPoly`. */
  hitTestRecord(
    fileIndex: number,
    record: PolyRecord,
    x: number,
    y: number,
    scale: number,
    mouseX: number,
    mouseY: number,
    resolve: PolyResolver,
  ): boolean {
    const poly = resolvePoly(fileIndex, record, x, y, scale, resolve);
    return poly !== null && this.hitTest(poly.model, poly.x, poly.y, poly.scale, mouseX, mouseY);
  }

  /**
   * `renderCTPWalkBox` : `row` est une ligne de zone de marche (`[n, x0, y0, x1, y1, ...]`) ; les points sont mis à l'échelle autour de
   * `(hotX, hotY)` puis placés en `(x, y)`, et le polygone est rastérisé dans `XMIN_XMAX` (lu ensuite par `spanTable`).
   */
  rasterizeWalkbox(row: ArrayLike<number>, hotX: number, hotY: number, x: number, y: number, scale: number): void {
    const count = row[0]!;
    if (count < 2) throw new RangeError(`Zone de marche de ${count} sommet(s)`);
    const startX = x - round16(upscale(hotX, scale));
    const startY = y - round16(upscale(hotY, scale));
    for (let i = 0; i < count; i++) {
      this.write(POLY_POINTS + i * 2, round16(upscale(row[1 + i * 2]!, scale)) + startX);
      this.write(POLY_POINTS + i * 2 + 1, round16(upscale(row[2 + i * 2]!, scale)) + startY);
    }
    this.traceRing(null, count, false);
  }

  /** Lecture de `XMIN_XMAX` par `makeCtStruct` : ligne de départ, puis des paires jusqu'à un `x1` négatif (y compris l'état laissé). */
  spanTable(): SpanTable {
    const top = this.buf[SPANS]!;
    const spans: (readonly [number, number])[] = [];
    let at = SPANS + 1;
    while (this.read(at) >= 0) {
      spans.push([this.read(at), this.read(at + 1)]);
      at += 2;
    }
    return { top, spans };
  }

  // -------------------------------------------------------------------------------------------------------------------------------

  private read(index: number): number {
    if (index < 0 || index >= BUFFER_WORDS) throw new RangeError(`Rastériseur : lecture hors de bigPolyBuf (${index})`);
    return this.buf[index]!;
  }

  private write(index: number, value: number): void {
    if (index < 0 || index >= BUFFER_WORDS) throw new RangeError(`Rastériseur : écriture hors de bigPolyBuf (${index})`);
    this.buf[index] = value;
  }

  /** Début commun de `buildPolyModel` et `findPoly` : deltas dans `DIST_3D`, puis points écran dans `polyBuffer2`. */
  private transformPoints(model: PolyModel, x: number, y: number, scale: number): { absScale: number; flip: boolean } {
    const points = model.points;
    const count = points.length >> 1;
    if (count < 2) throw new RangeError(`Modèle de ${count} point(s)`);
    const flip = scale < 0;
    const absScale = flip ? -scale : scale;
    const half = absScale < HALF_RES_SCALE;
    const scaleValue = half ? absScale << 1 : absScale;
    const firstX = points[0]!;
    const firstY = points[1]!;

    let startX = model.lowerX - firstX;
    let startY = model.lowerY - firstY;
    if (half) {
      startX >>= 1;
      startY >>= 1;
    }
    if (flip) startX = -startX;
    startX = x - round16(upscale(startX, scaleValue));
    startY = y - round16(upscale(startY, scaleValue));

    // Deltas successifs, X opposé (le premier point vaut 0, 0).
    const buf = this.buf;
    buf[DIST_3D] = 0;
    buf[DIST_3D + 1] = 0;
    let previousX = 0;
    let previousY = 0;
    for (let i = 1; i < count; i++) {
      let px = points[i * 2]! - firstX;
      if (half) px >>= 1;
      buf[DIST_3D + i * 2] = previousX - px;
      previousX = px;
      let py = points[i * 2 + 1]! - firstY;
      if (half) py >>= 1;
      buf[DIST_3D + i * 2 + 1] = -(previousY - py);
      previousY = py;
    }

    // Cumul en 16.16, arrondi à chaque point.
    let currentX = 0;
    let currentY = 0;
    for (let i = 0; i < count; i++) {
      let dx = buf[DIST_3D + i * 2]!;
      if (!flip) dx = -dx;
      currentX = (currentX + upscale(dx, scaleValue)) | 0;
      buf[POLY_POINTS + i * 2] = round16(currentX) + startX;
      currentY = (currentY + upscale(buf[DIST_3D + i * 2 + 1]!, scaleValue)) | 0;
      buf[POLY_POINTS + i * 2 + 1] = round16(currentY) + startY;
    }
    return { absScale, flip };
  }

  /**
   * `drawPolyMode1` (miroir) ou `drawPolyMode2` : recopie les sommets (indices dans `polyBuffer2`, ou `0..count-1` si `indices` est
   * nul) en anneau doublé dans `polyBuffer4`, puis `buildSegment`.
   */
  private traceRing(indices: Uint8Array | null, count: number, mirrored: boolean): void {
    if (count < 2) throw new RangeError(`Polygone de ${count} sommet(s)`);
    const buf = this.buf;
    const vertex = (k: number) => POLY_POINTS + (indices ? indices[k]! : k) * 2;
    // Mode 1 : l'anneau descend depuis `polyBuffer4 + 2 × nbseg` (nbseg du polygone précédent).
    let dest = mirrored ? EDGES + this.segments * 2 - 2 : EDGES;
    const step = mirrored ? -2 : 2;
    this.segments = count;
    const copy = count * 2;

    let source = vertex(0);
    let value = buf[source]!;
    this.write(dest + copy, value);
    this.write(dest, value);
    let xMin = buf[dest]!;
    let xMax = xMin;
    value = buf[source + 1]!;
    this.write(dest + 1 + copy, value);
    this.write(dest + 1, value);
    let yMin = buf[dest + 1]!;
    let yMax = yMin;
    // `A2ptr` : en mode 2, l'emplacement du sommet le plus bas ; en mode 1, celui du sommet *précédent* (pointeur pas encore décrémenté).
    let start = dest;

    for (let k = 1; k < count; k++) {
      const previous = dest;
      dest += step;
      source = vertex(k);
      value = buf[source]!;
      this.write(dest + copy, value);
      this.write(dest, value);
      value = buf[dest]!;
      if (value < xMin) xMin = value;
      if (value > xMax) xMax = value;
      value = buf[source + 1]!;
      this.write(dest + 1 + copy, value);
      this.write(dest + 1, value);
      value = buf[dest + 1]!;
      if (value < yMin) yMin = value;
      if (value > yMax) {
        yMax = value;
        start = mirrored ? previous : dest;
      }
    }
    this.buildSegment(start, xMin, xMax, yMin, yMax);
  }

  /** `buildSegment` : remplit `XMIN_XMAX` à partir des `nbseg` arêtes lues depuis `start` dans l'anneau. */
  private buildSegment(start: number, xMin: number, xMax: number, yMin: number, yMax: number): void {
    const buf = this.buf;
    if (xMin >= SCREEN_WIDTH || xMax < 0 || yMax < 0 || yMin >= SCREEN_HEIGHT) {
      buf[SPANS] = -1;
      this.lines = -1;
      return;
    }

    if (yMin === yMax) {
      // Une seule ligne : de l'abscisse minimale à la maximale, écrêtées.
      buf[SPANS] = yMin;
      let left = this.read(start);
      let right = left;
      for (let k = 1; k < this.segments; k++) {
        const value = this.read(start + k * 2);
        if (left > value) left = value;
        if (right < value) right = value;
      }
      buf[SPANS + 1] = left < 0 ? 0 : left;
      buf[SPANS + 2] = right >= SCREEN_WIDTH ? LAST_X : right;
      buf[SPANS + 3] = -1;
      this.lines = 1;
      return;
    }

    const first = yMin < 0 ? 0 : yMin;
    const last = yMax > LAST_Y ? LAST_Y : yMax;
    this.lines = last - first + 1;
    const rowMin = SPANS + 1;
    buf[SPANS] = first;
    const rowMax = SPANS + (last - first) * 2 + 1;
    buf[rowMax + 2] = -1;
    for (let at = rowMin; at <= rowMax; at += 2) {
      buf[at] = EMPTY_MIN;
      buf[at + 1] = EMPTY_MAX;
    }
    const row = (lineY: number) => SPANS + (lineY - first) * 2 + 1;
    const widen = (at: number, from: number, to: number) => {
      if (at <= rowMax && at >= rowMin) {
        if (from < buf[at]!) buf[at] = from;
        if (to > buf[at + 1]!) buf[at + 1] = to;
      }
    };

    let edge = start;
    for (let s = 0; s < this.segments; s++, edge += 2) {
      let x2 = this.read(edge + 2);
      let x1 = this.read(edge);
      let y2 = this.read(edge + 3);
      let y1 = this.read(edge + 1);
      if ((y1 > y2 ? y2 : y1) > LAST_Y || (y1 > y2 ? y1 : y2) < 0) continue;

      let dx = x2 - x1;
      if (dx === 0) {
        // Arête verticale : toutes ses lignes, de la plus haute à la plus basse.
        const from = x2 < 0 ? 0 : x2;
        const to = x2 > LAST_X ? LAST_X : x2;
        let at = row(y2);
        let end = row(y1);
        if (y2 >= y1) [at, end] = [end, at];
        do {
          widen(at, from, to);
          at += 2;
        } while (at <= end);
        continue;
      }

      // Bresenham depuis l'extrémité gauche (les deux échanges de ScummVM laissent la gauche dans (x2, y1)).
      if (dx < 0) {
        dx = -dx;
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
      }
      [x1, x2] = [x2, x1];
      let dy = y2 - y1;
      if (dy === 0) {
        widen(row(y1), x1 < 0 ? 0 : x1, x2 > LAST_X ? LAST_X : x2); // x1 = droite, x2 = gauche : bornes croisées, comme ScummVM
        continue;
      }

      let lineStep = 2;
      if (dy < 0) {
        dy = -dy;
        lineStep = -2;
      }
      const steep = dy > dx;
      if (steep) [dy, dx] = [dx, dy];
      const incStraight = 2 * dy;
      let error = 2 * dy - dx;
      const incDiagonal = 2 * (dy - dx);
      let remaining = dx + 1;
      let at = row(y1);
      let bp = x2;
      let from = bp < 0 ? 0 : bp;
      let to = bp > LAST_X ? LAST_X : bp;

      if (!steep) {
        do {
          widen(at, from, to);
          bp++;
          from = bp < 0 ? 0 : bp;
          to = bp > LAST_X ? LAST_X : bp;
          if (error < 0) {
            error += incStraight;
            if (remaining === 1) widen(at, from, to); // dernier pixel, seulement sans changement de ligne
          } else {
            error += incDiagonal;
            at += lineStep;
          }
        } while (--remaining);
      } else {
        do {
          widen(at, from, to);
          at += lineStep;
          if (error < 0) {
            error += incStraight;
          } else {
            error += incDiagonal;
            bp++;
            from = bp < 0 ? 0 : bp;
            to = bp > LAST_X ? LAST_X : bp;
          }
        } while (--remaining);
      }
    }
  }

  /** `blitPolyMode1` (avec masque, pas de 40 octets) ou `blitPolyMode2` : remplit les lignes de `XMIN_XMAX`. */
  private blit(dest: Uint8Array, mask: Uint8Array | null, color: number): void {
    const buf = this.buf;
    const top = buf[SPANS]!;
    for (let i = 0; i < this.lines; i++) {
      const lineY = top + i;
      const from = buf[SPANS + 1 + i * 2]!;
      const to = buf[SPANS + 2 + i * 2]!;
      if (from > to) continue;
      // Invariant de `buildSegment` (bornes écrêtées) : garde contre tout accès hors écran.
      if (lineY < 0 || lineY > LAST_Y || from < 0 || to > LAST_X) throw new RangeError(`Rastériseur : ligne ${lineY} [${from}, ${to}] hors écran`);
      const rowStart = lineY * SCREEN_WIDTH;
      for (let px = from; px <= to; px++) {
        if (!mask || testMask(mask, px, lineY, POLY_MASK_STRIDE)) dest[rowStart + px] = color;
      }
    }
  }
}
