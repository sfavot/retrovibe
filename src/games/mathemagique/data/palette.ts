/**
 * Palette de 256 couleurs de Math Workshop. Il n'y a pas de palette codée en dur : elle est construite en mémoire par les
 * ressources `SHPL` (voir `shpl.ts`) chargées avec un écran, chacune écrasant une plage d'index (`docs/mathemagique/shap.md`).
 */
import type { ShapeList } from "../../../data/mohawk/shpl";

export const PALETTE_SIZE = 256;

/** Palette RGB (768 octets). */
export type Palette = Uint8Array;

/** Éclaircissement appliqué par le jeu à chaque composante non nulle d'un SHPL (`1098:0857`) : v + 31 - floor(v / 8). */
export function brighten(v: number): number {
  return v === 0 ? 0 : (v + 0x1f - (v >> 3)) & 0xff;
}

/**
 * Palette de départ : noir partout, sauf l'index 255 blanc. Le jeu passe en `SYSPAL_NOSTATIC`, ce qui force l'index 0 au noir
 * et l'index 255 au blanc (hypothèse : comportement documenté de Windows 3.x, `10d8:6c84`).
 */
export function createPalette(): Palette {
  const palette = new Uint8Array(PALETTE_SIZE * 3);
  palette.fill(255, 255 * 3);
  return palette;
}

/**
 * Applique un SHPL sur la palette (écrase les index `paletteFirst` … `paletteFirst + n - 1`), comme `10a8:0640`.
 * `adjust = false` recopie les valeurs brutes (pour un `tPAL`, dont l'éclaircissement n'est pas établi).
 */
export function applyShpl(palette: Palette, shpl: ShapeList, adjust = true): void {
  const count = shpl.rgb.length / 3;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) palette[(shpl.paletteFirst + i) * 3 + c] = adjust ? brighten(shpl.rgb[i * 3 + c]!) : shpl.rgb[i * 3 + c]!;
  }
}
