/**
 * Fenêtres `.ITF` dessinées comme dans TIMWIN.EXE (`docs/tim3/graphics.md` § Fenêtres) : cadres découpés dans `CORNERS.BMP`,
 * libellés et boutons à texte en `SYS12.PFT`, boutons à image de l'ANM de la fenêtre, zones de texte.
 *
 * - **Décor** (genre 0, `image = 0`, valeur < 20) : la valeur est un style de cadre, `FRAME_STYLES` (421d43) donne la première des
 *   8 pièces de `CORNERS.BMP` et la couleur logique du fond ; 44e8e0 remplit l'intérieur puis pose les bords en mosaïque et les coins.
 * - **Libellé** (genre 0, valeur ≥ 1000) et **bouton à texte** (genres 1, 2, 3, 5 sans image) : texte `INTRFACE.RES` (`2000 + valeur %
 *   1000`), police `(valeur / 1000) % 10` (1 = `SYS12.PFT`), style de lettre `valeur / 10000` (2 : relief 6 / 15, 3 : relief 14 / 15),
 *   couleur 5 (421d1b ; le 15 de 421f22 est le fond du cadre). Les boutons ont un cadre (pièces 16, enfoncé 24, fond 15) et leur
 *   texte descend de 3 pixels quand ils sont enfoncés.
 * - **Texte** : codes en tête de chaîne (4217d7) `~C<n>` couleur, `~S<n>` style, `~F<n>` police, `~JC` / `~JL` / `~JR` / `~JX`
 *   alignement ; mise en page 45301c (mots, `\n`, lignes entières seulement, défilement = lignes sautées) et dessin 452ed0.
 * - **Image** (`image = 1`) : image de l'état `valeur` de l'ANM, origine décalée de (`unknown12`, `unknown14`) (410dcb).
 *
 * Coordonnées : celles de l'ITF (espace 640×400), plus le décalage `state.dx`, `state.dy` (`itfOrigin` centre la fenêtre sur
 * l'écran 640×480 du port : le jeu ouvre chaque `.ITF` dans une fenêtre Windows centrée).
 */
import type { Itf, ItfControl } from "../data/itf";
import { interfaceText, parseLines } from "../data/text";
import type { Font } from "../data/font";
import { drawAnmImage, imageCount, stateStart } from "./anm-draw";
import type { RenderAssets } from "./assets";
import type { Rect } from "./editor-overlay";
import { mapColor } from "./palette";
import type { IndexedImage, Surface } from "./surface";
import { drawText, measureText, wrapText } from "./text";

export const CORNERS_BMP = "CORNERS.BMP";

/** Polices indexées par le chiffre des milliers d'un identifiant de texte (0x472a24 ; l'entrée 0 est `CORNERS.BMP`). */
export const ITF_FONTS: Readonly<Record<number, string>> = { 1: "SYS12.PFT", 2: "10X10NOP.PFT" };
export const ITF_DEFAULT_FONT = "SYS12.PFT";

/** Styles de décor (valeur d'un contrôle de genre 0 sans image) : première pièce de `CORNERS.BMP`, couleur logique du fond (421d43). */
export const FRAME_STYLES: Readonly<Record<number, { first: number; fill: number }>> = {
  0: { first: 0x00, fill: 15 },
  1: { first: 0x20, fill: 5 },
  2: { first: 0x28, fill: 5 },
  3: { first: 0x30, fill: 15 },
  4: { first: 0x08, fill: 15 },
  6: { first: 0x38, fill: 7 },
  7: { first: 0x40, fill: 5 },
  8: { first: 0x48, fill: 5 },
  9: { first: 0x50, fill: 15 },
  10: { first: 0x58, fill: 15 },
  11: { first: 0x10, fill: 15 },
  12: { first: 0x60, fill: 11 },
  13: { first: 0x68, fill: 15 },
  14: { first: 0x70, fill: 11 },
  15: { first: 0x78, fill: 9 },
  16: { first: 0x80, fill: 2 },
  19: { first: 0x88, fill: 9 },
};

/** Cadre des boutons à texte (421f11) : pièces 16 (relâché) ou 24 (enfoncé), fond 15 ; texte 1 ou 4 pixels plus bas. */
export const BUTTON_FRAME = { normal: 0x10, pressed: 0x18, fill: 15, textDy: 1, pressedTextDy: 4 } as const;

/** Drapeaux de mise en page d'un texte (champ +0x18 de 45301c / 452ed0). */
export const TEXT_WRAP = 0x2;
export const TEXT_CENTER_BLOCK = 0x100;
export const TEXT_MIDDLE = 0x200;
export const TEXT_RIGHT = 0x800;
export const TEXT_CENTER_LINES = 0x1000;
/** Base des libellés (42205f : 0x302, combinée par ou exclusif avec l'alignement, 0x1000 par défaut). */
const LABEL_BASE_FLAGS = 0x302;
const DEFAULT_ALIGN = 0x1000;

export interface TextStyle {
  /** 0 : plat ; 2 : relief 6 en haut à gauche, 15 en bas à droite (4136e7) ; 3 : relief 14 / 15 (41375a). */
  mode: number;
  /** Couleur logique (`mapColor`). */
  color: number;
  flags: number;
  /** Police (nom de ressource). */
  font: string;
}

/** Codes en tête d'un texte (4217d7) ; renvoie le texte sans eux et le style mis à jour. */
export function parseTextCodes(raw: string, style: TextStyle, align = DEFAULT_ALIGN): { text: string; style: TextStyle } {
  const out = { ...style };
  let a = align;
  let i = 0;
  const number = (): number => {
    const m = /^\d*/.exec(raw.slice(i))![0];
    i += m.length;
    return Number(m || "0");
  };
  while (raw[i] === "~") {
    const code = raw[i + 1]?.toUpperCase();
    if (code === "C") {
      i += 2;
      out.color = number();
    } else if (code === "S") {
      i += 2;
      out.mode = number();
    } else if (code === "F") {
      i += 2;
      const f = number();
      out.font = ITF_FONTS[f] ?? out.font;
    } else if (code === "J") {
      const j = raw[i + 2]?.toUpperCase();
      if (j === "C") a = 0x1000;
      else if (j === "L") a = 0x500;
      else if (j === "R") a = 0x800;
      else if (j === "X") a &= ~0x100;
      i += 3;
    } else i += 1;
  }
  if (style.flags === LABEL_BASE_FLAGS || align !== DEFAULT_ALIGN || a !== DEFAULT_ALIGN) out.flags = style.flags ^ a;
  return { text: raw.slice(i), style: out };
}

export interface TextLayout {
  lines: { text: string; width: number }[];
  /** Largeur de la plus longue ligne. */
  width: number;
  height: number;
  /** Nombre total de lignes (défilement compris), pour savoir s'il y a une suite. */
  total: number;
}

/** 45301c : lignes d'un texte dans `width × height` (mots entiers, `\n`), après `scroll` lignes sautées ; lignes entières seulement. */
export function layoutText(font: Font, text: string, width: number, height: number, flags: number, scroll = 0): TextLayout {
  const all = flags & TEXT_WRAP ? wrapText(font, text, width) : text.split(/\r?\n/);
  const step = font.height;
  const lines: TextLayout["lines"] = [];
  for (const line of all.slice(scroll)) {
    if ((lines.length + 1) * step > height) break;
    lines.push({ text: line, width: measureText(font, line) });
  }
  return { lines, width: Math.max(0, ...lines.map((l) => l.width)), height: lines.length * step, total: all.length };
}

/** 452ed0 : texte aligné dans le rectangle, avec le relief du style ; renvoie la mise en page. */
export function drawTextBox(surface: Surface, font: Font, text: string, rect: Rect, style: TextStyle, scroll = 0): TextLayout {
  const layout = layoutText(font, text, rect.width, rect.height, style.flags, scroll);
  const f = style.flags;
  let x = rect.x;
  let y = rect.y;
  if (f & (TEXT_CENTER_BLOCK | TEXT_CENTER_LINES)) x += Math.trunc((rect.width - layout.width) / 2);
  if (f & TEXT_MIDDLE) y += Math.trunc((rect.height - layout.height) / 2);
  for (const line of layout.lines) {
    let dx = 0;
    if (f & (TEXT_RIGHT | TEXT_CENTER_LINES)) {
      dx = layout.width - line.width;
      if (f & TEXT_CENTER_LINES) dx = Math.trunc(dx / 2);
      else if (!(f & TEXT_CENTER_BLOCK)) dx += rect.width - layout.width;
    }
    const lx = x + dx;
    const relief = style.mode === 2 ? [6, 15] : style.mode === 3 ? [14, 15] : null;
    if (relief) {
      drawText(surface, font, line.text, lx - 1, y - 1, mapColor(relief[0]!));
      drawText(surface, font, line.text, lx + 1, y + 1, mapColor(relief[1]!));
    }
    drawText(surface, font, line.text, lx, y, mapColor(style.color));
    y += font.height;
  }
  return layout;
}

/** 44e8e0 : cadre en 9 morceaux (8 pièces à partir de `first` : coins et bords, bords en mosaïque) et fond `fill` (−1 : aucun). */
export function drawFrame(surface: Surface, pieces: readonly IndexedImage[], first: number, r: Rect, fill: number): void {
  const p = Array.from({ length: 8 }, (_, i) => pieces[first + i]);
  if (p.some((x) => !x)) return;
  const [tl, top, tr, left, right, bl, bottom, br] = p as IndexedImage[];
  const { x, y, width: w, height: h } = r;
  if (fill !== -1 && tl.width + br.width < w && tl.height + br.height < h) {
    surface.fillRect(x + tl.width, y + tl.height, w - tl.width - br.width, h - tl.height - br.height, mapColor(fill));
  }
  const tile = (img: IndexedImage, x0: number, y0: number, x1: number, y1: number, horizontal: boolean): void => {
    // Bord coupé avant le coin suivant, dans le découpage en cours.
    const clip = surface.setClip(x0, y0, x1 - x0, y1 - y0);
    surface.clip.x0 = Math.max(surface.clip.x0, clip.x0);
    surface.clip.y0 = Math.max(surface.clip.y0, clip.y0);
    surface.clip.x1 = Math.min(surface.clip.x1, clip.x1);
    surface.clip.y1 = Math.min(surface.clip.y1, clip.y1);
    if (horizontal) for (let xx = x0; xx < x1; xx += img.width) surface.blit(img, xx, y0);
    else for (let yy = y0; yy < y1; yy += img.height) surface.blit(img, x0, yy);
    surface.restoreClip(clip);
  };
  tile(top, x + tl.width, y, x + w - tr.width, y + top.height, true);
  tile(bottom, x + bl.width, y + h - bottom.height, x + w - br.width, y + h, true);
  tile(left, x, y + tl.height, x + left.width, y + h - bl.height, false);
  tile(right, x + w - right.width, y + tr.height, x + w, y + h - br.height, false);
  surface.blit(tl, x, y);
  surface.blit(tr, x + w - tr.width, y);
  surface.blit(bl, x, y + h - bl.height);
  surface.blit(br, x + w - br.width, y + h - br.height);
}

/** Genres de contrôle sur lesquels on clique. */
const CLICKABLE = new Set([1, 2, 3, 5]);

export interface ItfState {
  /** Décalage des coordonnées de l'ITF vers la surface (`itfOrigin`). */
  dx?: number;
  dy?: number;
  /** Contrôle enfoncé (identifiant). */
  pressed?: number | null;
  /** Contrôles grisés (dessinés, mais ni cliquables ni activables). */
  disabled?: readonly number[];
  /** Contrôles cachés (45064c, drapeau 8). */
  hidden?: readonly number[];
  /** Textes donnés par l'appelant à la place de celui de la valeur (message de GENERIC, libellés de ses boutons). */
  texts?: Readonly<Record<number, string>>;
  /** Contrôles déplacés (identifiant → nouvelle position dans l'espace de l'ITF), comme le bouton seul de GENERIC (42253a). */
  moved?: Readonly<Record<number, { x?: number; y?: number }>>;
  /** Lignes sautées d'une zone de texte (défilement). */
  scroll?: Readonly<Record<number, number>>;
}

/** Un contrôle tel qu'il est posé sur la surface. */
export interface ItfItem extends Rect {
  id: number;
  name?: string;
  kind: number;
  /** Bouton qu'on peut cliquer (visible, cliquable, non grisé). */
  enabled: boolean;
  clickable: boolean;
  /** Texte affiché (sans les codes `~`), vide s'il n'y en a pas. */
  text: string;
  /** Zones de texte : il reste des lignes plus bas. */
  more?: boolean;
}

export interface ItfLayout {
  /** Contrôles visibles, du fond vers l'avant (ordre de dessin). */
  items: ItfItem[];
  /** Rectangle du décor de fond (le dernier contrôle de l'ITF). */
  frame: Rect;
}

/** Décalage qui centre le décor de fond (dernier contrôle) sur une surface `width × height`. */
export function itfOrigin(itf: Itf, width = 640, height = 480): { dx: number; dy: number } {
  const bg = itf.controls[itf.controls.length - 1];
  if (!bg) return { dx: 0, dy: 0 };
  return { dx: Math.trunc((width - bg.width) / 2) - bg.x, dy: Math.trunc((height - bg.height) / 2) - bg.y };
}

const linesCache = new WeakMap<RenderAssets, string[]>();

function interfaceLines(assets: RenderAssets): string[] {
  let lines = linesCache.get(assets);
  if (!lines) {
    lines = assets.index && assets.index.has("INTRFACE.RES") ? parseLines(assets.index.get("INTRFACE.RES")) : [];
    linesCache.set(assets, lines);
  }
  return lines;
}

/** Texte de `INTRFACE.RES` par identifiant, lu dans les ressources (`""` s'il manque). */
export function itfText(assets: RenderAssets, id: number): string {
  return interfaceText(interfaceLines(assets), id);
}

/** Texte d'un contrôle : celui de l'appelant, ou celui de sa valeur (identifiant ≥ 1000). */
function rawText(assets: RenderAssets, c: ItfControl, state: ItfState): string {
  const given = state.texts?.[c.id];
  if (given !== undefined) return given;
  if (c.image || c.value < 1000) return "";
  return interfaceText(interfaceLines(assets), c.value);
}

/** 4213b9 : style de lettre et police tirés de la valeur (> 10000 : style ; > 1000 : police). */
function valueStyle(c: ItfControl, base: TextStyle): TextStyle {
  const s = { ...base };
  if (c.value > 10000) s.mode = Math.floor(c.value / 10000);
  if (c.value > 1000) s.font = ITF_FONTS[Math.floor(c.value / 1000) % 10] ?? ITF_DEFAULT_FONT;
  return s;
}

/** Position du contrôle sur la surface. */
function placed(c: ItfControl, state: ItfState): Rect {
  const m = state.moved?.[c.id];
  return { x: (m?.x ?? c.x) + (state.dx ?? 0), y: (m?.y ?? c.y) + (state.dy ?? 0), width: c.width, height: c.height };
}

/** Rectangles et textes des contrôles visibles, sans dessiner (pour le toucher et le calque DOM). */
export function layoutItf(assets: RenderAssets, itf: Itf, state: ItfState = {}): ItfLayout {
  return run(null, assets, itf, state);
}

/** Dessine la fenêtre ; renvoie ses contrôles. */
export function drawItf(surface: Surface, assets: RenderAssets, itf: Itf, state: ItfState = {}): ItfLayout {
  return run(surface, assets, itf, state);
}

function run(surface: Surface | null, assets: RenderAssets, itf: Itf, state: ItfState): ItfLayout {
  const items: ItfItem[] = [];
  const hidden = new Set(state.hidden ?? []);
  const disabled = new Set(state.disabled ?? []);
  const anm = itf.anm ? assets.anm(itf.anm) : null;
  const corners = assets.bitmap(CORNERS_BMP)?.frames ?? [];
  const bg = itf.controls[itf.controls.length - 1];
  const frame = bg ? placed(bg, state) : { x: 0, y: 0, width: 0, height: 0 };
  const windowFill = bg && !bg.image ? (FRAME_STYLES[bg.value]?.fill ?? 15) : 15;
  // Les contrôles sont rangés de l'avant vers le fond : le décor de la fenêtre est le dernier.
  for (const c of [...itf.controls].reverse()) {
    if (hidden.has(c.id)) continue;
    const r = placed(c, state);
    const clickable = CLICKABLE.has(c.kind);
    const pressed = clickable && state.pressed === c.id;
    const item: ItfItem = { id: c.id, kind: c.kind, ...r, clickable, enabled: clickable && !disabled.has(c.id), text: "" };
    if (c.name !== undefined) item.name = c.name;

    if (c.image) {
      if (surface && anm) {
        const first = imageOfState(anm, c.value);
        if (first >= 0) {
          const count = stateLength(anm, first);
          const image = first + (pressed && count > 1 ? 1 : 0);
          drawAnmImage(surface, assets, anm, image, r.x + c.unknown12, r.y + c.unknown14);
        }
      }
    } else if (c.kind === 4 && c.text) {
      const t = c.text;
      const box = { x: t.x + (state.dx ?? 0), y: t.y + (state.dy ?? 0), width: t.width, height: t.height };
      const { text, style } = parseTextCodes(rawText(assets, c, state), { mode: 0, color: t.color, flags: t.flags, font: ITF_DEFAULT_FONT });
      item.text = text;
      const font = assets.font(style.font);
      if (font) {
        const scroll = state.scroll?.[c.id] ?? 0;
        const layout = surface ? drawTextBox(surface, font, text, box, style, scroll) : layoutText(font, text, box.width, box.height, style.flags, scroll);
        item.more = scroll + layout.lines.length < layout.total;
      }
    } else {
      const decor = c.kind === 0 && c.value < 20 ? FRAME_STYLES[c.value] : undefined;
      if (surface && decor) drawFrame(surface, corners, decor.first, r, decor.fill);
      if (surface && clickable) drawFrame(surface, corners, pressed ? BUTTON_FRAME.pressed : BUTTON_FRAME.normal, r, BUTTON_FRAME.fill);
      if (c.kind !== 0 || c.value >= 1000) {
        const base: TextStyle = { mode: 2, color: 5, flags: LABEL_BASE_FLAGS, font: ITF_DEFAULT_FONT };
        const { text, style } = parseTextCodes(rawText(assets, c, state), valueStyle(c, base));
        item.text = text;
        const font = assets.font(style.font);
        const dy = clickable ? (pressed ? BUTTON_FRAME.pressedTextDy : BUTTON_FRAME.textDy) : 0;
        if (surface && font && text) drawTextBox(surface, font, text, { x: r.x, y: r.y + dy + 1, width: r.width, height: r.height }, style);
      }
    }
    if (surface && clickable && !item.enabled) grey(surface, r, mapColor(windowFill));
    items.push(item);
  }
  return { items, frame };
}

/**
 * Bouton grisé : une trame d'un pixel sur deux à la couleur du fond de la fenêtre. Choix du port (supposé) : le jeu cache les
 * boutons qu'il n'offre pas (45064c, drapeau 8) et aucun dessin « grisé » n'a été trouvé dans 421c91 ni 410dcb.
 */
function grey(surface: Surface, r: Rect, color: number): void {
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x + ((y + r.x) & 1); x < r.x + r.width; x += 2) surface.plot(x, y, color);
}

/** Premier contrôle cliquable sous le point (coordonnées de la surface), du premier plan vers le fond ; grisés compris. */
export function itfHitAt(layout: ItfLayout, x: number, y: number): ItfItem | null {
  for (let i = layout.items.length - 1; i >= 0; i--) {
    const it = layout.items[i]!;
    if (it.clickable && x >= it.x && x < it.x + it.width && y >= it.y && y < it.y + it.height) return it;
  }
  return null;
}

/** Libellé d'un bouton à image : le texte posé juste dessous qui le chevauche le plus en largeur (PUZZSOLV : « Même Puzzle »…). */
export function itfButtonLabel(layout: ItfLayout, item: ItfItem): string {
  if (item.text) return item.text;
  let best: ItfItem | null = null;
  let bestOverlap = 0;
  for (const it of layout.items) {
    if (it.clickable || !it.text || it.y < item.y + item.height / 2) continue;
    const overlap = Math.min(it.x + it.width, item.x + item.width) - Math.max(it.x, item.x);
    if (overlap > bestOverlap) {
      best = it;
      bestOverlap = overlap;
    }
  }
  return best?.text ?? "";
}

function imageOfState(anm: import("../data/anm").Anm, state: number): number {
  for (let i = 0; i < imageCount(anm); i++) if (stateStart(anm, i) === state) return i;
  return -1;
}

/** Nombre d'images de l'état qui commence à `first` (4107fb). */
function stateLength(anm: import("../data/anm").Anm, first: number): number {
  let n = 1;
  while (first + n < imageCount(anm) && stateStart(anm, first + n) === 0) n++;
  return n;
}
