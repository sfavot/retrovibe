/**
 * Métafichiers Windows (WMF) : analyse et rendu Canvas 2D du sous-ensemble utilisé par `BKG.WMF` et `RIB1–4.WMF` / `RIBB.WMF`
 * (`docs/mathemagique/certificate.md`).
 *
 * Les six fichiers sont des WMF « placeables » (clé `0x9AC6CDD7`, 22 octets) puis un en-tête standard de 18 octets, sans texte ni bitmap :
 * un fond de page (544 crayons, 571 polygones, 309 polylignes) et cinq rubans de 18 polygones chacun. Records pris en charge :
 *
 * | Record | Code | Effet |
 * |---|---|---|
 * | `SETWINDOWORG` / `SETWINDOWEXT` | `0x020B` / `0x020C` | fenêtre logique (Y puis X dans les paramètres) |
 * | `INTERSECTCLIPRECT` | `0x0416` | rectangle de découpe logique |
 * | `SETPOLYFILLMODE` | `0x0106` | 1 = alterné (`evenodd`), 2 = enroulement (`nonzero`) |
 * | `CREATEPENINDIRECT` / `CREATEBRUSHINDIRECT` | `0x02FA` / `0x02FC` | objets crayon et pinceau (table à premier emplacement libre) |
 * | `SELECTOBJECT` / `DELETEOBJECT` | `0x012D` / `0x01F0` | sélection et libération |
 * | `SAVEDC` / `RESTOREDC` | `0x001E` / `0x0127` | pile de contextes |
 * | `POLYGON` / `POLYLINE` | `0x0324` / `0x0325` | remplissage + contour / contour seul |
 * | `SETBKMODE`, `SETBKCOLOR`, `SETMAPMODE`, `SETSTRETCHBLTMODE`, `SETROP2`, `SETTEXTCOLOR` | … | lus, sans effet sur ce rendu (pas de texte ni de motif) |
 *
 * Tout autre record est ignoré et compté (`DrawStats.skipped`). Le rendu ne dépend pas du DOM : `WmfContext` est le sous-ensemble de
 * `CanvasRenderingContext2D` utilisé (un faux contexte enregistreur suffit aux tests).
 */

const PLACEABLE_KEY = 0x9ac6cdd7;

export const WMF = {
  eof: 0x0000,
  saveDc: 0x001e,
  setBkMode: 0x0102,
  setMapMode: 0x0103,
  setRop2: 0x0104,
  setPolyFillMode: 0x0106,
  setStretchBltMode: 0x0107,
  restoreDc: 0x0127,
  selectObject: 0x012d,
  deleteObject: 0x01f0,
  setBkColor: 0x0201,
  setTextColor: 0x0209,
  setWindowOrg: 0x020b,
  setWindowExt: 0x020c,
  createPenIndirect: 0x02fa,
  createBrushIndirect: 0x02fc,
  polygon: 0x0324,
  polyline: 0x0325,
  intersectClipRect: 0x0416,
} as const;

const IGNORED: ReadonlySet<number> = new Set([WMF.setBkMode, WMF.setMapMode, WMF.setRop2, WMF.setStretchBltMode, WMF.setBkColor, WMF.setTextColor]);

export interface WmfPlaceable {
  left: number;
  top: number;
  right: number;
  bottom: number;
  unitsPerInch: number;
}

export interface WmfHeader {
  /** 1 = en mémoire, 2 = sur disque. */
  type: number;
  headerWords: number;
  version: number;
  /** Taille du fichier en mots de 16 bits (en-tête standard compris, sans l'en-tête placeable). */
  sizeWords: number;
  objectCount: number;
  maxRecordWords: number;
}

export interface WmfRecord {
  /** Fonction (`META_*`). */
  fn: number;
  /** Paramètres (mots signés de 16 bits). Un `COLORREF` se lit en deux mots non signés (`param & 0xffff`). */
  params: Int16Array;
}

export interface Wmf {
  placeable: WmfPlaceable | null;
  header: WmfHeader;
  /** Tous les records, `META_EOF` compris. */
  records: WmfRecord[];
  /** Nombre de records par fonction. */
  counts: ReadonlyMap<number, number>;
}

export class WmfError extends Error {
  constructor(message: string) {
    super(`WMF : ${message}`);
    this.name = "WmfError";
  }
}

export function parseWmf(bytes: Uint8Array): Wmf {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let placeable: WmfPlaceable | null = null;
  if (bytes.length >= 22 && view.getUint32(0, true) === PLACEABLE_KEY) {
    placeable = {
      left: view.getInt16(6, true),
      top: view.getInt16(8, true),
      right: view.getInt16(10, true),
      bottom: view.getInt16(12, true),
      unitsPerInch: view.getUint16(14, true),
    };
    at = 22;
  }
  if (bytes.length < at + 18) throw new WmfError("en-tête tronqué");
  const header: WmfHeader = {
    type: view.getUint16(at, true),
    headerWords: view.getUint16(at + 2, true),
    version: view.getUint16(at + 4, true),
    sizeWords: view.getUint32(at + 6, true),
    objectCount: view.getUint16(at + 10, true),
    maxRecordWords: view.getUint32(at + 12, true),
  };
  if ((header.type !== 1 && header.type !== 2) || header.headerWords !== 9) throw new WmfError("en-tête standard invalide");
  at += header.headerWords * 2;

  const records: WmfRecord[] = [];
  const counts = new Map<number, number>();
  for (;;) {
    if (at + 6 > bytes.length) throw new WmfError("fin de fichier sans META_EOF");
    const words = view.getUint32(at, true);
    const fn = view.getUint16(at + 4, true);
    if (words < 3 || at + words * 2 > bytes.length) throw new WmfError(`record ${records.length} (0x${fn.toString(16)}) de taille invalide`);
    const count = words - 3;
    const params = new Int16Array(count);
    for (let i = 0; i < count; i++) params[i] = view.getInt16(at + 6 + i * 2, true);
    records.push({ fn, params });
    counts.set(fn, (counts.get(fn) ?? 0) + 1);
    at += words * 2;
    if (fn === WMF.eof) break;
  }
  return { placeable, header, records, counts };
}

/** Points d'un `POLYGON` / `POLYLINE` : `[nombre, x0, y0, x1, y1, …]`. */
export function polyPoints(record: WmfRecord): { x: number; y: number }[] {
  const n = record.params[0] ?? 0;
  if (n < 0 || record.params.length < 1 + 2 * n) throw new WmfError(`polyligne de ${n} points tronquée`);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) points.push({ x: record.params[1 + 2 * i]!, y: record.params[2 + 2 * i]! });
  return points;
}

/** `COLORREF` (deux mots : `0x00BBGGRR`) en `rgb(r, g, b)`. */
export function colorRef(low: number, high: number): string {
  const lo = low & 0xffff;
  return `rgb(${lo & 0xff}, ${lo >> 8}, ${high & 0xff})`;
}

// --- Rendu ---

/** Sous-ensemble de `CanvasRenderingContext2D` utilisé par le rendu. */
export interface WmfContext {
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
}

export interface WmfTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rectangle (px) occupé par le métafichier sur une sortie de `pxPerInch` px par pouce, comme `1088:03ed` : taille de la boîte placeable
 * en unités ÷ `unitsPerInch` (en-tête du fichier) × résolution, coin haut-gauche en `(x, y)`. Les rubans (1 636 unités par pouce) sortent
 * ainsi 1 % plus petits que le fond (1 620). Sans boîte placeable : 1 unité = 1 px.
 */
export function wmfPhysicalTarget(wmf: Wmf, pxPerInch: number, x = 0, y = 0): WmfTarget {
  const p = wmf.placeable;
  if (!p) return { x, y, w: pxPerInch, h: pxPerInch };
  const scale = pxPerInch / (p.unitsPerInch || 1);
  return { x, y, w: (p.right - p.left) * scale, h: (p.bottom - p.top) * scale };
}

export interface DrawStats {
  polygons: number;
  polylines: number;
  /** Fonctions ignorées (hors `IGNORED`), avec leur nombre. */
  skipped: Map<number, number>;
}

interface Pen {
  /** Style `PS_*` : 5 = `PS_NULL`. */
  style: number;
  width: number;
  color: string;
}

interface Brush {
  /** Style `BS_*` : 1 = `BS_HOLLOW` ; tout autre style est rempli en uni (aucun motif dans les fichiers du jeu). */
  style: number;
  color: string;
}

type GdiObject = { kind: "pen"; pen: Pen } | { kind: "brush"; brush: Brush };

interface DcState {
  pen: Pen | null;
  brush: Brush | null;
  fillRule: CanvasFillRule;
  orgX: number;
  orgY: number;
  extX: number;
  extY: number;
}

const PS_NULL = 5;
const BS_HOLLOW = 1;

/**
 * Joue le métafichier dans `target` (px du canevas) : la fenêtre logique du fichier (`SETWINDOWORG` / `SETWINDOWEXT`, à défaut la boîte
 * placeable) est étirée sur le rectangle (`GM_ANISOTROPIC`, comme `1088:03ed`). Contexte de départ de GDI : crayon noir de 1 unité,
 * pinceau blanc. Le contexte du canevas est sauvegardé puis restauré (état et découpe).
 */
export function drawWmf(ctx: WmfContext, wmf: Wmf, target: WmfTarget): DrawStats {
  const stats: DrawStats = { polygons: 0, polylines: 0, skipped: new Map() };
  const p = wmf.placeable;
  const dc: DcState = {
    pen: { style: 0, width: 1, color: "rgb(0, 0, 0)" },
    brush: { style: 0, color: "rgb(255, 255, 255)" },
    fillRule: "evenodd",
    orgX: p?.left ?? 0,
    orgY: p?.top ?? 0,
    extX: p ? p.right - p.left : target.w,
    extY: p ? p.bottom - p.top : target.h,
  };
  const saved: DcState[] = [];
  const objects: (GdiObject | null)[] = [];

  const applyTransform = (): void => {
    const sx = target.w / dc.extX;
    const sy = target.h / dc.extY;
    ctx.setTransform(sx, 0, 0, sy, target.x - dc.orgX * sx, target.y - dc.orgY * sy);
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  applyTransform();
  let depth = 0;

  for (const record of wmf.records) {
    const w = record.params;
    switch (record.fn) {
      case WMF.eof:
        break;
      case WMF.setWindowOrg:
        dc.orgY = w[0]!;
        dc.orgX = w[1]!;
        applyTransform();
        break;
      case WMF.setWindowExt:
        if (w[0] !== 0 && w[1] !== 0) {
          dc.extY = w[0]!;
          dc.extX = w[1]!;
          applyTransform();
        }
        break;
      case WMF.intersectClipRect: {
        const [bottom, right, top, left] = [w[0]!, w[1]!, w[2]!, w[3]!];
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();
        break;
      }
      case WMF.setPolyFillMode:
        dc.fillRule = w[0] === 2 ? "nonzero" : "evenodd";
        break;
      case WMF.saveDc:
        saved.push({ ...dc });
        ctx.save();
        depth++;
        break;
      case WMF.restoreDc: {
        // Paramètre : numéro absolu (> 0) ou relatif (< 0, -1 = le dernier) ; `ctx.restore()` rend aussi la découpe.
        const back = Math.max(1, Math.min(saved.length, (w[0] ?? -1) < 0 ? -(w[0] ?? -1) : saved.length - (w[0] ?? 0) + 1));
        for (let i = 0; i < back && saved.length > 0; i++) {
          Object.assign(dc, saved.pop()!);
          ctx.restore();
          depth--;
        }
        applyTransform();
        break;
      }
      case WMF.createPenIndirect: {
        const pen: Pen = { style: w[0]! & 0xffff, width: w[1]!, color: colorRef(w[3]!, w[4]!) };
        addObject(objects, { kind: "pen", pen });
        break;
      }
      case WMF.createBrushIndirect: {
        const brush: Brush = { style: w[0]! & 0xffff, color: colorRef(w[1]!, w[2]!) };
        addObject(objects, { kind: "brush", brush });
        break;
      }
      case WMF.selectObject: {
        const object = objects[w[0]! & 0xffff];
        if (object?.kind === "pen") dc.pen = object.pen;
        else if (object?.kind === "brush") dc.brush = object.brush;
        break;
      }
      case WMF.deleteObject:
        // Les objets sélectionnés restent utilisables (GDI les garde vivants) : seul l'emplacement est libéré.
        if ((w[0]! & 0xffff) < objects.length) objects[w[0]! & 0xffff] = null;
        break;
      case WMF.polygon: {
        const points = polyPoints(record);
        stats.polygons++;
        if (points.length < 2) break;
        tracePath(ctx, points, true);
        if (dc.brush && dc.brush.style !== BS_HOLLOW) {
          ctx.fillStyle = dc.brush.color;
          ctx.fill(dc.fillRule);
        }
        strokeWith(ctx, dc.pen);
        break;
      }
      case WMF.polyline: {
        const points = polyPoints(record);
        stats.polylines++;
        if (points.length < 2) break;
        tracePath(ctx, points, false);
        strokeWith(ctx, dc.pen);
        break;
      }
      default:
        if (!IGNORED.has(record.fn)) stats.skipped.set(record.fn, (stats.skipped.get(record.fn) ?? 0) + 1);
    }
  }
  while (depth-- > 0) ctx.restore();
  ctx.restore();
  return stats;
}

/** GDI range un nouvel objet dans le premier emplacement libre de la table. */
function addObject(objects: (GdiObject | null)[], object: GdiObject): void {
  const free = objects.indexOf(null);
  if (free >= 0) objects[free] = object;
  else objects.push(object);
}

function tracePath(ctx: WmfContext, points: readonly { x: number; y: number }[], close: boolean): void {
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
  if (close) ctx.closePath();
}

function strokeWith(ctx: WmfContext, pen: Pen | null): void {
  if (!pen || pen.style === PS_NULL) return;
  ctx.strokeStyle = pen.color;
  // Un crayon de largeur 0 est « cosmétique » (1 pixel) : ici une unité logique, déjà de l'ordre du pixel à l'échelle d'une page.
  ctx.lineWidth = Math.max(1, pen.width);
  ctx.stroke();
}
