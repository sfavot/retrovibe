import { encodeCp437 } from "../../../data/cp437";
import type { GphFont } from "../data/font";
import { messageLines } from "../data/text";
import type { Compositor } from "../render/compositor";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Rect } from "../render/surface";
import { drawText } from "../render/text";
import type { TextColors, TextRect } from "./tokens";

/**
 * Fenêtres de message (`gm_draw_text` `327a:0044`, `docs/armaeth/parser.md` § 13.2 et `screens.md` E9) : mise en page par mots,
 * pagination, cadre à cinq anneaux et texte à ombre, écrits **directement dans l'écran** du compositeur et effacés en y
 * recopiant la page d'arrière-plan. Une seule fenêtre est ouverte à la fois ; l'attente (clic, Entrée, délai) appartient
 * à l'appelant.
 */

/** Largeur de la cellule du glyphe (`4dde`) : marge de la fenêtre. */
const CELL_WIDTH = 5;
/** Interlettre des messages (`327a:0004`, `AX = 1`). */
const SPACING = 1;
/** Fenêtre par défaut (`327a:0004`) : largeur 320, hauteur 0xA0, ordonnée 21. */
const DEFAULT_WINDOW = { x: 0, y: 21, width: SCREEN_WIDTH, height: 0xa0 };
/** Couleurs du pilote (`DGROUP:5818`) : fond 236, texte et anneaux A 237, ombre et anneaux B 234. */
export const DEFAULT_TEXT_COLORS: TextColors = [236, 237, 234];

export interface WindowRequest {
  /** Texte du message (`■` = saut de ligne, `·` = espace). */
  text: string;
  /** Fenêtre de `ttl` ; `null` = fenêtre par défaut. */
  window: TextRect | null;
  /** Rétrécie au texte et centrée sur l'écran. */
  centered: boolean;
  /** Couleurs de `ecr` ; `null` = couleurs du pilote. */
  colors: TextColors | null;
}

/** Mise en page d'une fenêtre : lignes de chaque page et rectangle de chaque page. */
export interface WindowLayout {
  pages: { lines: string[]; rect: Rect }[];
}

/**
 * Césure (`327a:0044`, § 13.2) : un mot qui tient s'ajoute à la ligne, sinon il passe à la suivante ; un mot plus large que
 * la ligne est coupé caractère par caractère ; `■` termine la ligne (ligne vide si deux se suivent).
 */
export function wrapText(font: GphFont, text: string, maxWidth: number): string[] {
  const width = (s: string) => font.measure(encodeCp437(s), SPACING);
  const lines: string[] = [];
  const paragraphs = messageLines(text.replaceAll("·", " "));
  if (paragraphs.length > 1 && paragraphs[paragraphs.length - 1] === "") paragraphs.pop();
  for (const paragraph of paragraphs) {
    let line = "";
    const push = (word: string) => {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (width(candidate) <= maxWidth) {
        line = candidate;
        return;
      }
      if (line !== "") {
        lines.push(line);
        line = "";
      }
      if (width(word) <= maxWidth) {
        line = word;
        return;
      }
      for (const char of word) {
        if (line !== "" && width(line + char) > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    };
    for (const word of paragraph.split(" ")) if (word !== "") push(word);
    lines.push(line);
  }
  return lines;
}

export function layoutWindow(font: GphFont, request: Pick<WindowRequest, "text" | "window" | "centered">): WindowLayout {
  const w = request.window;
  let { x, y, width, height } = w ? { ...w } : { ...DEFAULT_WINDOW };
  if (w) {
    // Bornes de `327a:0044` : largeur hors de 3 cellules..320 -> 320, hauteur idem puis arrondie à une ligne.
    if (width < 3 * CELL_WIDTH || width > SCREEN_WIDTH) width = SCREEN_WIDTH;
    if (height < 3 * CELL_WIDTH || height > SCREEN_HEIGHT) height = SCREEN_HEIGHT;
  }
  const lineHeight = font.cellHeight;
  height = Math.floor((height - 16) / lineHeight) * lineHeight + 16;
  const maxWidth = width - 2 * CELL_WIDTH - SPACING;
  const maxLines = Math.max(1, Math.floor((height - 2 * lineHeight) / lineHeight));
  const lines = wrapText(font, request.text, maxWidth);
  if (lines.length === 0) lines.push("");
  const pages: WindowLayout["pages"] = [];
  for (let at = 0; at < lines.length; at += maxLines) {
    const pageLines = lines.slice(at, at + maxLines);
    let pageWidth = width;
    let left = x;
    if (request.centered) {
      const widest = Math.max(...pageLines.map((l) => font.measure(encodeCp437(l), SPACING)));
      // une ligne pleine (309 px) donne 321 px : le cadre est rogné à l'écran (`327a:0044` n'a pas de garde, hypothèse)
      pageWidth = Math.min(SCREEN_WIDTH, 2 * (CELL_WIDTH + SPACING) + widest);
      left = (SCREEN_WIDTH - pageWidth) >> 1;
    }
    const pageHeight = lineHeight * (pageLines.length + 2);
    pages.push({ lines: pageLines, rect: { x: left, y: y + pageHeight > SCREEN_HEIGHT ? 0 : y, width: pageWidth, height: pageHeight } });
  }
  return { pages };
}

/** Fenêtre de texte modale : une page à la fois (`advance` efface la page et dessine la suivante). */
export class TextWindows {
  private layout: WindowLayout | null = null;
  private page = 0;
  private source = "";
  private colors: TextColors = DEFAULT_TEXT_COLORS;

  constructor(
    private readonly compositor: Compositor,
    private readonly font: GphFont,
    /** Couleurs du pilote (`peo`). */
    public defaultColors: TextColors = DEFAULT_TEXT_COLORS,
  ) {}

  get active(): boolean {
    return this.layout !== null;
  }

  /** Texte de la fenêtre ouverte, ou `null`. */
  get text(): string | null {
    return this.layout ? this.source : null;
  }

  /** Rectangle de la page affichée. */
  get rect(): Rect | null {
    return this.layout ? this.layout.pages[this.page].rect : null;
  }

  /** Ouvre la fenêtre et dessine la première page ; une fenêtre déjà ouverte est effacée. */
  open(request: WindowRequest): void {
    this.close();
    this.colors = request.colors ?? this.defaultColors;
    this.source = request.text;
    this.layout = layoutWindow(this.font, request);
    this.page = 0;
    this.draw();
  }

  /** Page suivante après une confirmation : faux (et fenêtre fermée) si le texte est épuisé. */
  advance(): boolean {
    if (!this.layout) return false;
    this.erase();
    if (this.page + 1 >= this.layout.pages.length) {
      this.layout = null;
      return false;
    }
    this.page += 1;
    this.draw();
    return true;
  }

  close(): void {
    if (!this.layout) return;
    this.erase();
    this.layout = null;
  }

  private erase(): void {
    const rect = this.rect;
    if (rect) this.compositor.restoreScreen(rect);
  }

  private draw(): void {
    const { lines, rect } = this.layout!.pages[this.page];
    const [background, text, shadow] = this.colors;
    const c = this.compositor;
    // Cinq anneaux d'un pixel (`32e1:0008`) : le deuxième est sauté ; fond uniquement dans le premier.
    const ring = (i: number, color: number, fill: number | null) =>
      c.drawFrameRect({ x: rect.x + i, y: rect.y + i, width: rect.width - 2 * i, height: rect.height - 2 * i }, color, fill);
    ring(0, text, background);
    ring(1, shadow, null);
    ring(3, text, null);
    ring(4, shadow, null);
    lines.forEach((line, i) => {
      drawText(c.screen, this.font, rect.x + CELL_WIDTH + SPACING, rect.y + this.font.cellHeight * (i + 1), encodeCp437(line), {
        spacing: SPACING,
        color: text,
        shadow,
      });
    });
  }
}
