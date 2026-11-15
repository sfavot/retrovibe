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
 * - **Image** (`image = 1`) : image de l'état `valeur` de l'ANM, origine décalée de (`unknown12`, `unknown14`) (410dcb), plus le
 *   décalage d'image courant (`ItfState.frames`, +0x4c).
 * - **Décors 5, 17, 18** : 5 = texte du but ; 17 = zone vide que remplit un rappel de dessin (`ItfState.draw`) ; 18 = visite guidée
 *   (42b072, non portée : rien n'est dessiné).
 * - **Valeurs dynamiques** (98 à 120, 154, 161, 162, 193 ; 4213b9) : textes de l'appelant, styles du jeu (`rawText`, `valueStyle`).
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

/**
 * Cadre d'une zone de texte (genre 4, 4218d4) selon `valeur % 100` (table 0x421908 puis sauts 0x421918) : première pièce de
 * `CORNERS.BMP` et couleur du fond ; −1 : rectangle plein du contrôle ; 0 : pas de cadre, seule la zone du texte est remplie
 * (421b03 : x − 2, y − 1, l + 3, h + 2). Valeurs hors table : pièces 0x20, fond 5.
 */
const TEXT_BOX_TABLE = [0, 0, 6, 5, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1];
const TEXT_BOX_TARGETS = [{ first: 0x20, fill: 5 }, { first: 0x78, fill: 9 }, { first: 0x70, fill: 11 }, { first: -1, fill: 15 }, { first: 0x78, fill: 9 }, { first: 0, fill: 15 }, { first: 0x78, fill: 9 }];

/** Cadre d'une zone de texte (genre 4) pour sa valeur. */
export function textBoxFrame(value: number): { first: number; fill: number } {
  const v = value % 100;
  return v <= 15 ? TEXT_BOX_TARGETS[TEXT_BOX_TABLE[v]!]! : TEXT_BOX_TARGETS[0]!;
}

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

/**
 * 45301c : lignes d'un texte dans `width × height` (mots entiers, `\n`), après `scroll` lignes sautées ; lignes entières seulement,
 * sauf la première, toujours posée (un titre d'une ligne dans un cadre moins haut que la police, IN_TITLE de INFO.ITF : supposé).
 */
export function layoutText(font: Font, text: string, width: number, height: number, flags: number, scroll = 0): TextLayout {
  const all = flags & TEXT_WRAP ? wrapText(font, text, width) : text.split(/\r?\n/);
  const step = font.height;
  const lines: TextLayout["lines"] = [];
  for (const line of all.slice(scroll)) {
    if (lines.length > 0 && (lines.length + 1) * step > height) break;
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
  /** Textes donnés par l'appelant à la place de celui de la valeur (message de GENERIC, libellés de ses boutons, valeurs dynamiques). */
  texts?: Readonly<Record<number, string>>;
  /** Arguments des valeurs dynamiques à format (116, 117, 120, 193 : `%s` / `%d` du texte de la valeur, 4213b9). */
  args?: Readonly<Record<number, string | number>>;
  /** Contrôles déplacés ou redimensionnés (identifiant → nouveau rectangle dans l'espace de l'ITF), comme le bouton seul de GENERIC (42253a). */
  moved?: Readonly<Record<number, { x?: number; y?: number; width?: number; height?: number }>>;
  /** Lignes sautées d'un texte (défilement, 421c91 : contrôle `[0x47f634]`, `[0x47f638]` lignes). */
  scroll?: Readonly<Record<number, number>>;
  /**
   * Image courante d'un contrôle image, en décalage dans son état (+0x4c, 410dcb) : flèche qui s'anime, interrupteur (0 = marche,
   * dernière image = arrêt, 423dca), volume. Sans valeur : enfoncé = image suivante (supposé), sinon la première.
   */
  frames?: Readonly<Record<number, number>>;
  /** Dessin propre d'un contrôle (rappel +0x5c, posé par 44f070), appelé après son dessin ordinaire : zones animées (style 17), aperçus. */
  draw?: Readonly<Record<number, (surface: Surface, rect: Rect) => void>>;
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
  /** Textes : il reste des lignes plus bas. */
  more?: boolean;
  /** Textes : lignes affichées et lignes en tout (`[0x47f63c]`, `[0x47f640]`), pour le défilement. */
  lines?: { visible: number; total: number };
  /** Contrôles image : nombre d'images de leur état (+0x48). */
  frameCount?: number;
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

/**
 * Valeurs dynamiques de 4213b9 (`valeur % 1000`) : le texte vient du jeu en cours et non de `INTRFACE.RES`. Le port reçoit ces
 * textes de l'appelant (`ItfState.texts`) ; ce tableau garde ce que 4213b9 change au style.
 * - 98, 99 : noms des deux joueurs (`%s` de 0x472a70 / 0x472a73 sur 0x4815e0 / 0x4815eb), couleur 7 ou 15 selon le joueur dont c'est
 *   le tour (`[0x4815d4]`), style 1 ; 102 : couleur 14 ou 15 (421fbf) ; 100, 101 : textes 2103 et 2104 ; 116, 117, 120 : format du texte
 *   de la valeur appliqué au nom du joueur courant ; 193 : format appliqué à 41c861 (deux joueurs, non portés : textes de l'appelant).
 * - 154 : tampon 0x47e6f8 ; 162 : nom de la pièce (tampon 0x47f5dc, INFO.ITF).
 * - 161 : description de la pièce (`INFO.RES` 7001 + type, après la deuxième tabulation, 4215b1), couleur 15, alignement 0x400, plus 0x200
 *   tant que le texte n'a pas défilé.
 */
const FIXED_TEXT: Readonly<Record<number, number>> = { 100: 2103, 101: 2104 };
const FORMATTED = new Set([116, 117, 120, 193]);
const BUFFERS = new Set([98, 99, 102, 154, 161, 162]);

/** `sprintf` réduit aux `%s` et `%d` des textes du jeu. */
export function formatText(format: string, arg: string | number | undefined): string {
  return format.replace(/%[sd]/, arg === undefined ? "" : String(arg));
}

/** Texte d'un contrôle : celui de l'appelant, ou celui de sa valeur (identifiant ≥ 1000, valeurs dynamiques de 4213b9). */
function rawText(assets: RenderAssets, c: ItfControl, state: ItfState): string {
  const given = state.texts?.[c.id];
  if (given !== undefined) return given;
  if (c.image || c.value < 1000) return "";
  const v = c.value % 1000;
  if (BUFFERS.has(v)) return "";
  if (FIXED_TEXT[v] !== undefined) return interfaceText(interfaceLines(assets), FIXED_TEXT[v]);
  const text = interfaceText(interfaceLines(assets), c.value);
  return FORMATTED.has(v) ? formatText(text, state.args?.[c.id]) : text;
}

/** 4213b9 : style de lettre et police tirés de la valeur (> 10000 : style ; > 1000 : police), et ce que changent les valeurs dynamiques. */
function valueStyle(c: ItfControl, base: TextStyle, scrolled: boolean): { style: TextStyle; align: number } {
  const s = { ...base };
  let align = DEFAULT_ALIGN;
  if (c.value > 10000) s.mode = Math.floor(c.value / 10000);
  if (c.value > 1000) s.font = ITF_FONTS[Math.floor(c.value / 1000) % 10] ?? ITF_DEFAULT_FONT;
  const v = c.value % 1000;
  if (c.value >= 1000 && v === 161) {
    s.color = 15;
    align = scrolled ? 0x400 | 0x200 : 0x400;
  }
  return { style: s, align };
}

/** Position du contrôle sur la surface. */
function placed(c: ItfControl, state: ItfState): Rect {
  const m = state.moved?.[c.id];
  return { x: (m?.x ?? c.x) + (state.dx ?? 0), y: (m?.y ?? c.y) + (state.dy ?? 0), width: m?.width ?? c.width, height: m?.height ?? c.height };
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
  const dx = state.dx ?? 0;
  const dy = state.dy ?? 0;
  // Les contrôles sont rangés de l'avant vers le fond : le décor de la fenêtre est le dernier.
  for (const c of [...itf.controls].reverse()) {
    if (hidden.has(c.id)) continue;
    const r = placed(c, state);
    const clickable = CLICKABLE.has(c.kind);
    const pressed = clickable && state.pressed === c.id;
    const item: ItfItem = { id: c.id, kind: c.kind, ...r, clickable, enabled: clickable && !disabled.has(c.id), text: "" };
    if (c.name !== undefined) item.name = c.name;

    if (c.image) {
      const first = anm ? imageOfState(anm, c.value) : -1;
      if (anm && first >= 0) {
        const count = stateLength(anm, first);
        item.frameCount = count;
        const wanted = state.frames?.[c.id];
        const offset = wanted !== undefined ? Math.max(0, Math.min(count - 1, wanted)) : pressed && count > 1 ? 1 : 0;
        if (surface) drawAnmImage(surface, assets, anm, first + offset, r.x + c.unknown12, r.y + c.unknown14);
      }
    } else if (c.kind === 4 && c.text) {
      const t = c.text;
      const m = state.moved?.[c.id];
      const box = { x: t.x + (m?.x !== undefined ? m.x - c.x : 0) + dx, y: t.y + (m?.y !== undefined ? m.y - c.y : 0) + dy, width: t.width, height: t.height };
      const boxFrame = textBoxFrame(c.value);
      if (surface && boxFrame.first > 0) drawFrame(surface, corners, boxFrame.first, r, boxFrame.fill);
      else if (surface && boxFrame.first === -1) surface.fillRect(r.x, r.y, r.width, r.height, mapColor(boxFrame.fill));
      else if (surface) surface.fillRect(box.x - 2, box.y - 1, box.width + 3, box.height + 2, mapColor(boxFrame.fill));
      const { text, style } = parseTextCodes(rawText(assets, c, state), { mode: 0, color: t.color, flags: t.flags, font: ITF_DEFAULT_FONT });
      item.text = text;
      textLines(surface, assets, item, text, box, style, state.scroll?.[c.id] ?? 0);
    } else {
      const decor = c.kind === 0 && c.value < 20 ? FRAME_STYLES[c.value] : undefined;
      if (surface && decor) drawFrame(surface, corners, decor.first, r, decor.fill);
      if (surface && clickable) drawFrame(surface, corners, pressed ? BUTTON_FRAME.pressed : BUTTON_FRAME.normal, r, BUTTON_FRAME.fill);
      if (c.kind === 0 && c.value === GOAL_TEXT_STYLE) {
        // Style 5 (421ec1) : texte du but (0x4811e8) dans la police de la barre, alignement 0x400, lettres plates, couleur 5.
        const { text, style } = parseTextCodes(rawText(assets, c, state), { mode: 0, color: 5, flags: LABEL_BASE_FLAGS, font: ITF_DEFAULT_FONT }, 0x400);
        item.text = text;
        textLines(surface, assets, item, text, r, style, state.scroll?.[c.id] ?? 0);
      } else if (c.kind !== 0 || c.value >= 1000) {
        const scroll = state.scroll?.[c.id] ?? 0;
        const base = valueStyle(c, { mode: 2, color: 5, flags: LABEL_BASE_FLAGS, font: ITF_DEFAULT_FONT }, scroll !== 0);
        const { text, style } = parseTextCodes(rawText(assets, c, state), base.style, base.align);
        item.text = text;
        const textDy = clickable ? (pressed ? BUTTON_FRAME.pressedTextDy : BUTTON_FRAME.textDy) : 0;
        if (text) textLines(surface, assets, item, text, { x: r.x, y: r.y + textDy + 1, width: r.width, height: r.height }, style, scroll);
      }
    }
    if (surface && clickable && !item.enabled) grey(surface, r, mapColor(windowFill));
    const custom = state.draw?.[c.id];
    if (surface && custom) custom(surface, r);
    items.push(item);
  }
  return { items, frame };
}

/** Style de décor 5 : texte du but (barre du but, 421ec1). (Le style 17 est une zone sans dessin, remplie par le rappel du contrôle.) */
export const GOAL_TEXT_STYLE = 5;

/** Dessine (ou mesure) un texte dans `box` et note ses lignes dans l'élément (défilement). */
function textLines(surface: Surface | null, assets: RenderAssets, item: ItfItem, text: string, box: Rect, style: TextStyle, scroll: number): void {
  const font = assets.font(style.font);
  if (!font) return;
  const layout = surface ? drawTextBox(surface, font, text, box, style, scroll) : layoutText(font, text, box.width, box.height, style.flags, scroll);
  item.more = scroll + layout.lines.length < layout.total;
  item.lines = { visible: visibleLines(font, box.height), total: layout.total };
}

/** Lignes entières qui tiennent dans une hauteur (45301c). */
function visibleLines(font: Font, height: number): number {
  return Math.max(0, Math.floor(height / font.height));
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

/** Première image de l'état `state` d'un ANM (−1 s'il n'existe pas). */
export function imageOfState(anm: import("../data/anm").Anm, state: number): number {
  for (let i = 0; i < imageCount(anm); i++) if (stateStart(anm, i) === state) return i;
  return -1;
}

/** Nombre d'images de l'état qui commence à `first` (4107fb). */
export function stateLength(anm: import("../data/anm").Anm, first: number): number {
  let n = 1;
  while (first + n < imageCount(anm) && stateStart(anm, first + n) === 0) n++;
  return n;
}
