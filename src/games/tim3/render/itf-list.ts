/**
 * Liste à défilement de `DOSBOX.ITF` (contrôle `DR_LIST`), dessinée par le jeu lui-même (41bf29) et non par le moteur des `.ITF` :
 *
 * - hauteur d'une rangée : hauteur du texte « » de la police de la fenêtre (`SYS12.PFT`, [0x47f620]) + 2 ; rangées visibles :
 *   (hauteur − 16) / rangée ; le reste est partagé au-dessus et au-dessous, après une marge de 8 pixels en haut ;
 * - texte de la rangée (« %2d. » puis le titre du LEV, 41bb9d) à x + 48, jusqu'à 8 pixels du bord droit, plat, couleur logique
 *   14 pour la rangée choisie, 15 sinon ;
 * - devant, l'image de l'état 36 (puzzle résolu : la rangée commence par « * », 41bb87) ou 35 (non résolu) de `BUTTONS.ANM`,
 *   posée en (x − 570, y − 18) : ses images sont placées en (590, 17) dans l'animation, soit une case de 24 × 15 en x + 20.
 *
 * `ScrollList` garde l'état d'une liste (rangées, rangée choisie, première rangée visible) ; la fenêtre (`ui/itf-window.ts`, option
 * `list`) la dessine sur son contrôle, la touche au pointeur et l'expose en `role="listbox"`.
 *
 * La liste « Avancé » (fichiers et lecteurs, `[0x47e5a0]`) et le bac Maison (catégorie 6) ne sont pas portés.
 */
import type { Anm } from "../data/anm";
import type { Font } from "../data/font";
import { drawAnmImage, imageCount, stateStart } from "./anm-draw";
import type { RenderAssets } from "./assets";
import type { Rect } from "./editor-overlay";
import { mapColor } from "./palette";
import type { Surface } from "./surface";
import { drawText } from "./text";

/** États de `BUTTONS.ANM` devant une rangée (41c287 : 0x24 si la rangée est marquée « * », sinon 0x23). */
export const LIST_ICON = { solved: 36, unsolved: 35 } as const;
const ICON_DX = -570;
const ICON_DY = -18;
const TEXT_DX = 48;
const RIGHT_MARGIN = 8;
const TOP_MARGIN = 8;
const BOTTOM_MARGIN = 16;
const SELECTED_COLOR = 14;
const ROW_COLOR = 15;

export interface ListRow {
  /** Texte de la rangée, sans la marque de tête (« 12. Titre »). */
  text: string;
  solved: boolean;
}

export interface ListGeometry {
  /** Haut de la première rangée visible. */
  y: number;
  rowHeight: number;
  /** Nombre de rangées visibles. */
  visible: number;
  textX: number;
  textWidth: number;
}

/** 41bf29 : rangées de la liste posée dans `rect`. */
export function listGeometry(font: Font, rect: Rect): ListGeometry {
  const rowHeight = font.height + 2;
  const avail = rect.height - BOTTOM_MARGIN;
  const visible = Math.max(0, Math.floor(avail / rowHeight));
  const spare = Math.trunc((avail - visible * rowHeight) / 2);
  const textX = rect.x + TEXT_DX;
  return { y: rect.y + TOP_MARGIN + spare, rowHeight, visible, textX, textWidth: rect.x + rect.width - textX - RIGHT_MARGIN };
}

/** Première rangée visible qui garde la rangée `selected` au milieu (41b169), ramenée dans la liste. */
export function centeredTop(selected: number, count: number, visible: number): number {
  let top = selected - Math.trunc(visible / 2);
  if (count - visible < top) top = count - visible;
  return Math.max(0, top);
}

/** Rangée sous le point, `null` hors des rangées visibles (41bdb6). */
export function listRowAt(geometry: ListGeometry, rect: Rect, top: number, count: number, x: number, y: number): number | null {
  if (x < rect.x || x >= rect.x + rect.width || y < geometry.y) return null;
  const i = Math.floor((y - geometry.y) / geometry.rowHeight);
  if (i >= geometry.visible) return null;
  return top + i < count ? top + i : null;
}

function firstImageOfState(anm: Anm, state: number): number {
  for (let i = 0; i < imageCount(anm); i++) if (stateStart(anm, i) === state) return i;
  return -1;
}

/** Dessine les rangées visibles de la liste. */
export function drawList(
  surface: Surface,
  assets: RenderAssets,
  font: Font,
  icons: Anm | null,
  rect: Rect,
  rows: readonly ListRow[],
  top: number,
  selected: number,
): void {
  const g = listGeometry(font, rect);
  const clip = surface.setClip(rect.x, rect.y, rect.width, rect.height);
  for (let k = 0; k < g.visible && top + k < rows.length; k++) {
    const i = top + k;
    const row = rows[i]!;
    const y = g.y + k * g.rowHeight;
    const textClip = surface.setClip(g.textX, rect.y, g.textWidth, rect.height);
    drawText(surface, font, row.text, g.textX, y, mapColor(i === selected ? SELECTED_COLOR : ROW_COLOR));
    surface.restoreClip(textClip);
    if (icons) {
      const image = firstImageOfState(icons, row.solved ? LIST_ICON.solved : LIST_ICON.unsolved);
      if (image >= 0) drawAnmImage(surface, assets, icons, image, rect.x + ICON_DX, y + ICON_DY);
    }
  }
  surface.restoreClip(clip);
}

/** Liste à défilement : rangées, rangée choisie, première rangée visible, dans le rectangle `rect` (espace de l'ITF). */
export class ScrollList {
  rows: readonly ListRow[] = [];
  selected = 0;
  top = 0;

  constructor(
    readonly font: Font | null,
    /** Rectangle des rangées, dans l'espace de l'ITF. */
    public rect: Rect,
    /** Images devant les rangées (`BUTTONS.ANM`), `null` : sans images. */
    readonly icons: Anm | null = null,
  ) {}

  geometry(): ListGeometry | null {
    return this.font ? listGeometry(this.font, this.rect) : null;
  }

  /** Rangées visibles (toutes sans police). */
  visible(): number {
    return this.geometry()?.visible ?? this.rows.length;
  }

  /** Rangées par page (Page haut / bas). */
  page(): number {
    return Math.max(1, this.visible() - 1);
  }

  /** Nouvelles rangées ; la rangée choisie est mise au milieu (41b169). */
  reset(rows: readonly ListRow[], selected: number): void {
    this.rows = rows;
    this.selected = selected;
    this.top = centeredTop(selected, rows.length, this.visible());
  }

  /** Choisit une rangée et la rend visible ; faux hors de la liste. */
  select(index: number): boolean {
    if (index < 0 || index >= this.rows.length) return false;
    this.selected = index;
    const v = this.visible();
    if (index < this.top) this.top = index;
    else if (index >= this.top + v) this.top = index - v + 1;
    return true;
  }

  /** Défile de `n` rangées, borné (la rangée choisie ne change pas). */
  scrollBy(n: number): void {
    const max = Math.max(0, this.rows.length - this.visible());
    this.top = Math.max(0, Math.min(max, this.top + n));
  }

  /** Rangée sous le point (espace de l'ITF), `null` hors des rangées. */
  rowAt(x: number, y: number): number | null {
    const g = this.geometry();
    return g ? listRowAt(g, this.rect, this.top, this.rows.length, x, y) : null;
  }

  /** Dessine les rangées visibles, décalées de `dx`, `dy` (centrage de la fenêtre). */
  draw(surface: Surface, assets: RenderAssets, dx: number, dy: number): void {
    if (!this.font) return;
    drawList(surface, assets, this.font, this.icons, { ...this.rect, x: this.rect.x + dx, y: this.rect.y + dy }, this.rows, this.top, this.selected);
  }
}
