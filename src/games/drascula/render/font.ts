import { encodeCp850 } from "../../../data/cp850";
import type { DatCharEntry, DrasculaDat } from "../data/dat";
import type { Plane } from "./plane";

/**
 * Police et texte de *Drascula* : `print_abc`, `print_abc_opc`, `centerText` et `textFitsCentered` (engines/drascula/graphics.cpp,
 * ScummVM), réécrits. Les glyphes sont des rectangles de feuilles d'images (`95.ALG` pour le texte du jeu, `CAR.ALG` pour les
 * choix de dialogue), recopiés avec `copyRect` : l'indice 255 est transparent et les pixels du glyphe sont en 254, la couleur du
 * texte (`palette.ts`, `setTextColor`).
 *
 * La table des caractères vient de `drascula.dat` (`charMaps`) : l'octet CP850 du texte est mis en majuscule (`toupper`, `a`-`z`
 * seulement), puis cherché dans les lettres, les signes, les accentués ; la première entrée gagne. La police n'a que des
 * capitales : les minuscules accentuées de CP850 (`è`, `ç`) ont le même glyphe que leur majuscule.
 *
 * Écarts : le texte est une chaîne JavaScript (un caractère par octet CP850, ce que `decodeCp850` produit), encodée en CP850 pour
 * la recherche ; l'espagnol (rangées 149 / 160) et le russe ne sont pas gérés. Un octet sans entrée recopie le glyphe précédent
 * (les variables de ScummVM ne sont pas remises à zéro), le premier recopiant le coin haut gauche de la feuille : reproduit.
 */

/** Feuille des glyphes du texte du jeu (menus, titres, sous-titres) : `95.ALG`, chargée dans `tableSurface`. */
export const FONT_SHEET = "95.ALG";
/** Feuille des glyphes des choix de dialogue : `car.alg`, chargée dans `backSurface` par `converse` (`converse.cpp`). */
export const DIALOG_FONT_SHEET = "CAR.ALG";
/** Un glyphe de la police du jeu fait 8 x 6 pixels ; un pas de 9 pixels sépare les glyphes d'une rangée. */
export const GLYPH = { width: 8, height: 6, pitch: 9 } as const;
/** Ordonnée de la rangée de glyphes selon le type de la table de caractères : 0 lettres, 1 signes, 2 accentués (hors espagnol). */
export const GLYPH_ROW_Y: readonly number[] = [158, 169, 180];
/** État d'un choix de dialogue (`kDialogOptionUnselected` 1, `kDialogOptionSelected` 2, `kDialogOptionClicked` 3) : une paire de rangées par état. */
export type DialogState = "unselected" | "selected" | "clicked";
export const DIALOG_STATES: readonly DialogState[] = ["unselected", "selected", "clicked"];
/** Glyphes des choix de dialogue : 6 x 5 pixels. */
export const DIALOG_GLYPH = { width: 6, height: 5, letterX0: 10, pitch: 7 } as const;
export const DIALOG_ROWS_Y: Readonly<Record<DialogState, readonly [letters: number, signs: number]>> = {
  unselected: [6, 15],
  selected: [31, 40],
  clicked: [56, 65],
};
/** Dernière colonne où un caractère peut commencer avant le retour à la ligne de `print_abc` (`screenX > 317`). */
const WRAP_X = 317;
/** Interligne : hauteur du glyphe + 2. */
const LINE_HEIGHT = GLYPH.height + 2;
/** Ordonnée de la rangée de glyphes de l'apostrophe : remplacée par l'octet 164 dans les choix (sauf en espagnol). */
const DIALOG_APOSTROPHE = 164;

/** Ligne d'un texte centré : texte, abscisse et ordonnée du coin haut gauche du premier glyphe. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
}

export class GameFont {
  private readonly entries = new Map<number, DatCharEntry>();

  constructor(maps: Pick<DrasculaDat["charMaps"], "letters" | "signs" | "accented">) {
    for (const entry of [...maps.letters, ...maps.signs, ...maps.accented]) if (!this.entries.has(entry.inChar)) this.entries.set(entry.inChar, entry);
  }

  /** Entrée de la table pour l'octet `code` (passé en majuscule comme `toupper`), la première qui correspond. */
  find(code: number): DatCharEntry | undefined {
    return this.entries.get(code >= 0x61 && code <= 0x7a ? code - 32 : code);
  }

  /** Origine (colonne, rangée) du glyphe de l'octet CP850 `code` dans `FONT_SHEET`, ou `null` s'il n'a pas de glyphe. */
  glyphOrigin(code: number): { x: number; y: number } | null {
    const entry = this.find(code);
    return entry ? { x: entry.mappedChar, y: GLYPH_ROW_Y[entry.charType] ?? GLYPH_ROW_Y[0] } : null;
  }

  /**
   * `print_abc` : écrit `said` à `(x, y)` en recopiant les glyphes de `sheet` (`95.ALG`) dans `dest`. Le texte avance de 8
   * pixels par caractère et passe à la ligne (x = 0, 8 pixels plus bas) quand x dépasse 317.
   */
  print(dest: Plane, sheet: Plane, said: string, x: number, y: number): void {
    let letterX = 0;
    let letterY = 0;
    for (const code of encodeCp850(said)) {
      const origin = this.glyphOrigin(code);
      if (origin) {
        letterX = origin.x;
        letterY = origin.y;
      }
      dest.copyRect(sheet, letterX, letterY, x, y, GLYPH.width, GLYPH.height);
      x += GLYPH.width;
      if (x > WRAP_X) {
        x = 0;
        y += LINE_HEIGHT;
      }
    }
  }

  /** Origine du glyphe de dialogue qui correspond à une entrée de la table (`print_abc_opc` : `(mappedChar - 6) / 9 * 7 + 10`). */
  dialogGlyphOrigin(entry: DatCharEntry, state: DialogState): { x: number; y: number } {
    const [letters, signs] = DIALOG_ROWS_Y[state];
    return {
      x: Math.trunc((entry.mappedChar - 6) / GLYPH.pitch) * DIALOG_GLYPH.pitch + DIALOG_GLYPH.letterX0,
      y: entry.charType > 0 ? signs : letters,
    };
  }

  /**
   * Mise en page d'un choix de dialogue (`print_abc_opc`) : abscisse et décalage vertical de chaque octet, et nombre de lignes.
   * Le texte commence à x = 1 ; un mot qui ne tient pas avant x = 317 passe à la ligne suivante (x = 0, 8 pixels plus bas).
   */
  private layoutChoice(codes: Uint8Array): { xs: number[]; dys: number[]; lines: number } {
    const xs: number[] = [];
    const dys: number[] = [];
    let x = 1;
    let dy = 0;
    let lines = 1;
    for (let h = 0; h < codes.length; h++) {
      // Longueur du mot qui commence à l'octet courant (jusqu'à l'espace suivant) : ScummVM la recompte à chaque octet.
      let wordLength = 0;
      for (let pos = h; pos < codes.length && codes[pos] !== 0x20; pos++) wordLength++;
      if (x + wordLength * DIALOG_GLYPH.width > WRAP_X) {
        x = 0;
        dy += LINE_HEIGHT;
        lines++;
      }
      xs.push(x);
      dys.push(dy);
      x += DIALOG_GLYPH.width;
    }
    return { xs, dys, lines };
  }

  /** Nombre de lignes qu'occupe un choix de dialogue (`print_abc_opc` rend ce nombre) : de quoi placer les choix sans les dessiner. */
  measureChoice(said: string): number {
    return this.layoutChoice(encodeCp850(said)).lines;
  }

  /**
   * `print_abc_opc` : un choix de dialogue en glyphes de 6 x 5 (feuille `CAR.ALG`), à partir de x = 1 ; un mot qui ne tient pas
   * avant x = 317 passe à la ligne suivante (x = 0). Rend le nombre de lignes. Sans entrée, le glyphe est celui de la rangée
   * des lettres, à la colonne du caractère précédent.
   */
  printChoice(dest: Plane, sheet: Plane, said: string, y: number, state: DialogState): number {
    const codes = encodeCp850(said);
    const { xs, dys, lines } = this.layoutChoice(codes);
    let letterX = 0;
    let letterY = 0;
    for (let h = 0; h < codes.length; h++) {
      letterY = DIALOG_ROWS_Y[state][0];
      let code = codes[h];
      if (code === 0x27) code = DIALOG_APOSTROPHE;
      const entry = this.find(code);
      if (entry) {
        const origin = this.dialogGlyphOrigin(entry, state);
        letterX = origin.x;
        letterY = origin.y;
      }
      dest.copyRect(sheet, letterX, letterY, xs[h], y + dys[h], DIALOG_GLYPH.width, DIALOG_GLYPH.height);
    }
    return lines;
  }
}

// --- Texte centré -------------------------------------------------------------------------------------------------------

const clip = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * `textFitsCentered` : le texte centré en `x` tient dans l'écran. Au-delà de 160, ScummVM prend le complément à 315 (le jeu
 * d'origine ne teste que le bord gauche) ; en deçà, il teste aussi le bord droit, avec le caractère en trop d'un texte impair.
 */
export function textFitsCentered(text: string, x: number): boolean {
  const length = text.length;
  const half = Math.trunc(length / 2) * GLYPH.width;
  if (x > 160) return 315 - x - half >= 0;
  return x - half >= 0 && x + half + (length % 2) * GLYPH.width <= 320;
}

/**
 * `centerText` : met en page `message` centré sur `textX`, `textY` (le point est le haut de la tête du personnage ou le curseur : le
 * texte se place au-dessus). Rend les lignes à écrire avec `GameFont.print`. Centre ramené à 60..255 ; un texte qui tient
 * est sur une ligne, à 4 lignes de glyphe au-dessus du point ; un mot seul qui ne tient pas glisse sur le côté ; sinon le
 * texte est coupé aux espaces. Fidèle à ScummVM, y compris le défaut d'origine : quand le texte est coupé, la dernière
 * ligne reçoit un espace final (qui décale d'un demi-glyphe) et, s'il ne tient plus, une ligne d'un espace s'ajoute.
 */
export function layoutCenteredText(message: string, textX: number, textY: number): TextLine[] {
  const x0 = clip(textX, 60, 255);
  if (textFitsCentered(message, x0)) {
    const y = clip(textY - 4 * GLYPH.height, 0, 200 - GLYPH.height);
    return [{ text: message, x: x0 - Math.trunc(message.length / 2) * GLYPH.width - 1, y }];
  }

  // Un mot seul (sans espace) : on le fait glisser sur le côté.
  if (!message.includes(" ")) {
    const x = clip(x0 - Math.trunc(message.length / 2) * GLYPH.width - 1, 0, 319 - message.length * GLYPH.width);
    const y = clip(textY - 4 * GLYPH.height, 0, 200 - GLYPH.height);
    return [{ text: message, x, y }];
  }

  // Coupe aux espaces (`strtok` ignore les espaces répétés).
  const words = message.split(" ").filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";
  let candidate = "";
  words.forEach((word, index) => {
    candidate = candidate !== "" ? `${candidate} ${word}` : word;
    if (textFitsCentered(candidate, x0)) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      candidate = word;
    }
    if (index === words.length - 1) {
      current += " ";
      if (!textFitsCentered(current, x0)) {
        lines.push(current.slice(0, -1), " ");
      } else {
        lines.push(current);
      }
    }
  });
  const y0 = clip(textY - (lines.length + 2) * GLYPH.height, 0, 200 - lines.length * LINE_HEIGHT + 2);
  return lines.map((text, line) => ({ text, x: x0 - Math.trunc(text.length / 2) * GLYPH.width - 1, y: y0 + line * LINE_HEIGHT }));
}

/** `centerText` : met en page puis écrit les lignes. */
export function centerText(font: GameFont, dest: Plane, sheet: Plane, message: string, textX: number, textY: number): void {
  for (const line of layoutCenteredText(message, textX, textY)) font.print(dest, sheet, line.text, line.x, line.y);
}

