import { measureText, type PfnFont } from "../../data/font";
import type { SceneContext } from "../../engine/scene";

/** Police par défaut du jeu (`305a:0071`, `S52D001F.PFN`, 16 px) et sa couleur de texte (`32f4:0123(…, 0x7e)`). */
export const DEFAULT_FONT = "s52d001f.pfn";
export const TEXT_COLOR = 0x7e;

export function loadDefaultFont(ctx: SceneContext): Promise<PfnFont> {
  return ctx.resources.pfn(DEFAULT_FONT);
}

const SPACE = 0x20;

/**
 * Coupe un texte en lignes de `maxWidth` pixels au plus (`1823:000c`, limite `0xBE` = 190 px). Comme l'original, la ligne
 * grandit caractère par caractère ; dès qu'elle dépasse, elle est coupée à la dernière espace (l'espace est supprimée).
 * Un mot plus large que la limite est coupé net (l'original boucle dans ce cas).
 */
export function wrapText(font: PfnFont, text: Uint8Array, maxWidth: number): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  let i = start;
  while (i < text.length) {
    if (measureText(font, text.subarray(start, i + 1)) > maxWidth) {
      let cut = i;
      while (cut > start && text[cut] !== SPACE) cut--;
      if (cut === start) {
        // Aucune espace : coupe au caractère avant celui qui déborde.
        lines.push(text.subarray(start, Math.max(i, start + 1)));
        start = Math.max(i, start + 1);
      } else {
        lines.push(text.subarray(start, cut));
        start = cut + 1;
      }
      i = start;
      continue;
    }
    i++;
  }
  lines.push(text.subarray(start));
  return lines;
}
