import { parseBd } from "../../../src/games/swiv3d/data/bd";
import { parseGlobal, type GlobalData } from "../../../src/games/swiv3d/data/global";
import { TextRenderer } from "../../../src/games/swiv3d/ui-draw/text";
import { readOriginal } from "../helpers";

let cached: GlobalData | undefined;

/** `GLOBAL.BD` du jeu, décodé une fois pour tous les tests d'écrans. */
export function loadGlobal(): GlobalData {
  cached ??= parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  return cached;
}

/** Rendu de texte réduit à ce que les menus appellent, pour les tests qui n'ont pas besoin de la vraie police (largeur 8 px par caractère). */
export function stubText(): TextRenderer {
  return {
    width: (text: string) => text.length * 8,
    fill: () => {},
    draw: () => {},
    truncate: (text: string) => text,
    blend: new Uint8Array(0),
  } as unknown as TextRenderer;
}
