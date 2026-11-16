/**
 * Rectangles du compositeur : bords gauche et haut compris, droit et bas exclus (`Common::Rect` de ScummVM).
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function makeRect(left = 0, top = 0, right = 0, bottom = 0): Rect {
  return { left, top, right, bottom };
}

export function isEmptyRect(rect: Rect): boolean {
  return rect.right <= rect.left || rect.bottom <= rect.top;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Vrai si `inner` est tout entier dans `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

export function rectContainsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

/** Partie de `rect` située dans `bounds` ; rectangle vide (0, 0, 0, 0) s'ils ne se touchent pas. */
export function clipRect(rect: Rect, bounds: Rect): Rect {
  if (isEmptyRect(rect) || !rectsIntersect(rect, bounds)) return makeRect();
  return makeRect(Math.max(rect.left, bounds.left), Math.max(rect.top, bounds.top), Math.min(rect.right, bounds.right), Math.min(rect.bottom, bounds.bottom));
}

export function translateRect(rect: Rect, dx: number, dy: number): void {
  rect.left += dx;
  rect.right += dx;
  rect.top += dy;
  rect.bottom += dy;
}
