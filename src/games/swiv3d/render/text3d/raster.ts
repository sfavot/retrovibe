/**
 * Triangle de couleur unie du texte 3D (`gm_draw_flat_tri`, `004359c8`) : tracé colonne par colonne dans l'image 320 × 400, en entiers,
 * sans découpe de terrain. Même mise en place d'arête que les triangles de modèles (`render.md` § 8.1), sans texture ni lumière : la
 * couleur est celle de la face (octet `table[teinte + lumière]` de la table du bloc 11003, déjà résolue par l'appelant).
 */
import { idiv } from "../tables";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../view";

/** Dernière colonne tracée (`0x13f`). */
const LAST_COLUMN = 0x13f;
const LAST_ROW = SCREEN_HEIGHT - 1;
/** Garde contre des coordonnées absurdes : au-delà, la boucle sur les colonnes n'a plus de sens. */
const MAX_SPAN = 1 << 20;

/** Remplit le triangle `(x[0], y[0])`, `(x[1], y[1])`, `(x[2], y[2])` de `colour` dans `fb` (`320 × 400` indices). */
export function fillFlatTriangle(fb: Uint8Array, x: ArrayLike<number>, y: ArrayLike<number>, colour: number): void {
  // Sommet de départ : x minimal, l'indice le plus grand à égalité.
  let v0 = 0;
  let xMin = x[0]!;
  if (x[1]! <= xMin) {
    xMin = x[1]!;
    v0 = 1;
  }
  if (x[2]! <= xMin) {
    xMin = x[2]!;
    v0 = 2;
  }
  let xMax = Math.max(x[0]!, x[1]!, x[2]!);
  if (xMax > LAST_COLUMN) xMax = LAST_COLUMN;
  if (xMax < 0 || xMax - xMin > MAX_SPAN) return;

  let fc = (v0 + 1) % 3;
  let f8 = (v0 + 2) % 3;
  let dxA = Math.abs(x[fc]! - x[v0]!) + 1;
  let dxB = Math.abs(x[v0]! - x[f8]!) + 1;
  let slopeDown = idiv((y[fc]! - y[v0]!) * 256, dxA);
  let slopeUp = idiv((y[v0]! - y[f8]!) * 256, dxB);
  if (-slopeDown !== slopeUp && slopeDown <= -slopeUp) {
    // Les deux arêtes sortent du même côté : on échange la montante et la descendante.
    f8 = (v0 + 1) % 3;
    fc = (v0 + 2) % 3;
    dxA = Math.abs(x[fc]! - x[v0]!) + 1;
    dxB = Math.abs(x[v0]! - x[f8]!) + 1;
    slopeDown = idiv((y[fc]! - y[v0]!) * 256, dxA);
    slopeUp = idiv((y[v0]! - y[f8]!) * 256, dxB);
  }
  const dxC = Math.abs(x[f8]! - x[fc]!) + 1;
  const slopeClosing = idiv((y[f8]! - y[fc]!) * 256, dxC);

  let top = y[v0]! << 8;
  let bottom = y[v0]! << 8;
  let stepTop = slopeUp;
  let stepBottom = slopeDown;
  for (let cx = xMin; cx <= xMax; cx++) {
    top -= stepTop;
    bottom += stepBottom;
    if (cx === x[fc]) stepBottom = slopeClosing;
    if (cx === x[f8]) stepTop = slopeClosing;
    if (cx < 0) continue;
    let y0 = top >> 8;
    const y1 = bottom >> 8;
    if ((y0 >= 0 || y1 >= 0) && (y0 < SCREEN_HEIGHT || y1 < LAST_ROW) && y0 < y1) {
      let count = y1 - y0 + 1;
      if (y0 < 0) {
        count += y0;
        y0 = 0;
      }
      if (y1 > LAST_ROW) count -= y1 - LAST_ROW;
      if (y0 + count > SCREEN_HEIGHT) count = SCREEN_HEIGHT - y0;
      for (let at = y0 * SCREEN_WIDTH + cx, n = count; n > 0; n--, at += SCREEN_WIDTH) fb[at] = colour;
    }
  }
}
