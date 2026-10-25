import type { Scene } from "../data/scene";
import { SPRITE_TRANSPARENT, type SpriteFrame } from "../data/sprite";
import {
  DirtyRects,
  Surface,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type Rect,
} from "./surface";

/** Valeur de priorité à partir de laquelle une scène n'écrase plus rien : le cadre vaut 200 ou 216 (`screens.md` E7). */
export const FRAME_PRIORITY_MIN = 200;
/** Couleur et priorité du fond de la fenêtre de jeu hors de l'image de la salle (`gm_decode_scene_image`). */
export const OUTSIDE_COLOR = 221;
export const OUTSIDE_PRIORITY = 199;

/** Retours de `blitSprite` (`vga_draw_sprite`). */
export const BLIT_OK = 0;
/** Sprite entièrement hors de la fenêtre : rien n'est dessiné. */
export const BLIT_OUTSIDE = 3;

/** Retour de `spriteHit` (`vga_sprite_hit`). */
export const HIT_NONE = 0;
export const HIT = 7;
export const HIT_OUTSIDE = 0xffff;

export interface Point {
  x: number;
  y: number;
}

export interface BlitOptions {
  /** Miroir horizontal (octet `+0x44` de l'objet > 0). Il n'y a pas de miroir vertical. */
  flip?: boolean;
  /**
   * Octet `+0x2F` (`Inv`) : objet caché / invisible quand il est non nul (`docs/armaeth/objects.md` § 12 : les gestionnaires
   * et `219b:0000` le testent comme « caché », par exemple le héros invisible après l'élixir). Le pilote (`VGA.EXE 1000:0722`,
   * `docs/armaeth/re-index.md` « Pilote vidéo VGA.EXE ») ne dessine alors pas le sprite : chaque pixel opaque écrit
   * `couleur du fond + valeur` (modulo 256), soit une transparence par décalage d'index de palette (« fantôme »). Les tests
   * de priorité sont inchangés. 0 ou absent : rendu normal.
   */
  ghost?: number;
  /** Objet mobile (octet `+6` non nul) : annulé à chaque image par `restoreDynamic`. Sinon il reste dans la liste fixe. Vrai par défaut. */
  dynamic?: boolean;
  /**
   * Décalage ajouté à `x` et `y` quand `flags & 7` est non nul (`CS:048C/048E`) : les objets des listes de salle sont
   * dessinés relativement à la fenêtre de la salle (`x`, `y` de l'en-tête de sa scène). Hypothèse : c'est ce décalage.
   */
  origin?: Point;
}

/** Sauvegarde d'un fond avant un blit (`vga_save_rect`) : le rectangle exact touché, pixels et priorités. */
interface UndoRecord {
  rect: Rect;
  pixels: Uint8Array;
  priority: Uint8Array;
  dynamic: boolean;
}

/**
 * Ce que le moteur obtient du pilote `VGA.EXE` en matière d'image : une page d'arrière-plan (`page`, avec son plan de
 * priorité) où tout se compose, et l'écran `A000` (`screen`). Les sprites vont dans la page, sont sauvegardés sur
 * deux piles d'annulation puis recopiés à l'écran par `present` ; le texte et les cadres (`drawFrameRect`, `text.ts`)
 * s'écrivent directement dans l'écran et s'effacent en recopiant la page (`restoreScreen`).
 *
 * Non reproduits : les codes de retour 1 et 2 (pile ou zone de sauvegarde pleine, tailles fournies par le moteur) ;
 * l'alignement des rectangles sauvegardés sur des mots (sans effet sur le résultat).
 */
export class Compositor {
  readonly page = new Surface();
  readonly screen = new Surface();
  private readonly undo: UndoRecord[] = [];
  private readonly dirty = new DirtyRects();

  /** Rectangles qui seront recopiés par le prochain `present`. */
  get dirtyRects(): DirtyRects {
    return this.dirty;
  }

  /** Nombre de sprites sauvegardés (fixes puis dynamiques). */
  get undoDepth(): number {
    return this.undo.length;
  }

  /**
   * Cadre d'interface = scène 0 : page et priorités remises à zéro, puis la scène est posée. Sa couche B donne 200 ou 216
   * sur le cadre (intouchable ensuite) et 0 dans la fenêtre de jeu.
   */
  setFrame(frame: Scene): void {
    this.page.clear();
    this.drawScene(frame);
  }

  /**
   * Image d'une salle (`gm_decode_scene_image`, `graphics.md`) : la couche d'image (type 1 ou 2) n'écrit un pixel que
   * si la priorité déjà présente est < 200, et la couche de profondeur (type 0) remplace alors la priorité ; tout autre
   * pixel de l'écran de priorité < 200 hors du rectangle de la scène devient 221 avec la priorité 199. Les sprites
   * sauvegardés sont abandonnés (la salle change : `lir` fait `vga_undo_all`) et la page entière sera recopiée.
   */
  drawScene(scene: Scene): void {
    const { x, y, width, height } = scene.header;
    const image = scene.layers.find((l) => l.type !== 0);
    const depth = scene.layers.find((l) => l.type === 0);
    const { pixels, priority } = this.page;
    for (let py = 0; py < SCREEN_HEIGHT; py++) {
      for (let px = 0; px < SCREEN_WIDTH; px++) {
        const at = py * SCREEN_WIDTH + px;
        if (priority[at] >= FRAME_PRIORITY_MIN) continue;
        const lx = px - x;
        const ly = py - y;
        if (lx < 0 || ly < 0 || lx >= width || ly >= height) {
          pixels[at] = OUTSIDE_COLOR;
          priority[at] = OUTSIDE_PRIORITY;
          continue;
        }
        const from = ly * width + lx;
        if (image) pixels[at] = image.pixels[from];
        // Hypothèse : une couche de profondeur absente laisse un plan à 0 (aucune scène n'en est dépourvue).
        priority[at] = depth ? depth.pixels[from] : 0;
      }
    }
    this.undo.length = 0;
    this.dirty.clear();
    this.dirty.markAll();
  }

  /**
   * Blit de sprite (`vga_draw_sprite`, `+0x36`). `x` = centre du sprite (`x - largeur / 2`, division entière), `y` = bas
   * (le haut est `y - hauteur + 1`). `0xFF` n'est jamais écrit ; le sprite est rogné à 320 x 200 ; un pixel opaque n'est
   * écrit que si la priorité mémorisée est inférieure ou égale à `priority` (octet bas), et la met alors à jour. Le fond est sauvegardé
   * avant dessin. Rend `BLIT_OUTSIDE` (3) sans rien dessiner si le sprite est entièrement hors de la fenêtre.
   */
  blitSprite(
    frame: SpriteFrame,
    x: number,
    y: number,
    priority: number,
    options: BlitOptions = {},
  ): number {
    const { width: w, height: h } = frame;
    const left = x + (options.origin?.x ?? 0) - (w >> 1);
    const bottom = y + (options.origin?.y ?? 0);
    const clip = spriteClip(left, bottom, w, h);
    if (!clip) return BLIT_OUTSIDE;

    const rect: Rect = {
      x: clip.x,
      y: clip.y,
      width: clip.columns,
      height: clip.rows,
    };
    const { pixels, priority: plane } = this.page;
    this.undo.push({
      rect,
      pixels: this.page.readRect(rect),
      priority: readPlane(plane, rect),
      dynamic: options.dynamic ?? true,
    });
    this.dirty.add(rect);

    const level = priority & 0xff;
    const ghost = (options.ghost ?? 0) & 0xff;
    for (let c = 0; c < clip.columns; c++) {
      const sx = options.flip ? w - 1 - clip.skipLeft - c : clip.skipLeft + c;
      for (let r = 0; r < clip.rows; r++) {
        const value = frame.pixels[(clip.skipTop + r) * w + sx];
        if (value === SPRITE_TRANSPARENT) continue;
        const at = (clip.y + r) * SCREEN_WIDTH + clip.x + c;
        if (plane[at] > level) continue;
        plane[at] = level;
        pixels[at] = ghost ? (pixels[at] + ghost) & 0xff : value;
      }
    }
    return BLIT_OK;
  }

  /**
   * Test de recouvrement (`vga_sprite_hit`, `+0x2e`) : `HIT` (7) si un pixel opaque du sprite, rogné comme pour le
   * blit, tombe sur une valeur du plan de priorité égale à `priority` ; `HIT_NONE` sinon ; `HIT_OUTSIDE` si le
   * sprite est entièrement hors de la fenêtre. Ne modifie rien. Hypothèse : le pilote lit le sens du miroir dans un
   * autre octet de l'objet (`+0x60`), ici la même option `flip` que pour le blit.
   */
  spriteHit(
    frame: SpriteFrame,
    x: number,
    y: number,
    priority: number,
    options: Pick<BlitOptions, "flip" | "origin"> = {},
  ): number {
    const { width: w, height: h } = frame;
    const clip = spriteClip(
      x + (options.origin?.x ?? 0) - (w >> 1),
      y + (options.origin?.y ?? 0),
      w,
      h,
    );
    if (!clip) return HIT_OUTSIDE;
    const level = priority & 0xff;
    for (let c = 0; c < clip.columns; c++) {
      const sx = options.flip ? w - 1 - clip.skipLeft - c : clip.skipLeft + c;
      for (let r = 0; r < clip.rows; r++) {
        if (frame.pixels[(clip.skipTop + r) * w + sx] === SPRITE_TRANSPARENT)
          continue;
        if (
          this.page.priority[(clip.y + r) * SCREEN_WIDTH + clip.x + c] === level
        )
          return HIT;
      }
    }
    return HIT_NONE;
  }

  /** Annule les sprites dynamiques (`vga_restore_dynamic`) : les fonds sauvegardés sont remis, en commençant par le dernier dessiné. */
  restoreDynamic(): void {
    let count = this.undo.filter((r) => r.dynamic).length;
    while (count-- > 0) this.pop();
  }

  /** Annule tous les sprites (`vga_undo_all`, `+0x5a`) et force la recopie complète de la page à la prochaine présentation. */
  undoAll(): void {
    while (this.undo.length > 0) this.pop();
    this.dirty.markAll();
  }

  /** Recopie sur l'écran les rectangles touchés, ou toute la page si besoin (`vga_present`, `+0x2a`). */
  present(): void {
    if (this.dirty.all) {
      this.screen.pixels.set(this.page.pixels);
    } else {
      for (const rect of this.dirty.list) this.screen.copyRect(this.page, rect);
    }
    this.dirty.clear();
  }

  /** `vga_wait_vsync_present` (`+0x3a`) : présente puis annule les sprites dynamiques. */
  presentAndRestore(): void {
    this.present();
    this.restoreDynamic();
  }

  /** Efface une zone de l'écran en y recopiant la page (`vga_copy_rect`, `+0x32`) : sert à fermer les fenêtres de texte. */
  restoreScreen(rect: Rect): void {
    this.screen.copyRect(this.page, rect);
  }

  /**
   * Rectangle direct dans l'écran (`vga_draw_rect`, `+0x6a`) : bordure de 1 pixel de couleur `border`, intérieur de
   * couleur `fill` (ou laissé tel quel si `fill` est `null`, « creux »). Largeur ou hauteur <= 0 : rien. Une largeur de 1
   * ne dessine que le pixel de gauche des lignes intermédiaires.
   */
  drawFrameRect(
    rect: Rect,
    border: number,
    fill: number | null = null,
  ): void {
    const { x, y, width, height } = rect;
    if (width <= 0 || height <= 0) return;
    const screen = this.screen;
    screen.fillRect({ x, y, width, height: 1 }, border);
    if (height === 1) return;
    screen.fillRect({ x, y: y + height - 1, width, height: 1 }, border);
    for (let row = y + 1; row < y + height - 1; row++) {
      screen.setPixel(x, row, border);
      if (width < 2) continue;
      if (fill !== null && width > 2)
        screen.fillRect({ x: x + 1, y: row, width: width - 2, height: 1 }, fill);
      screen.setPixel(x + width - 1, row, border);
    }
  }

  private pop(): void {
    const record = this.undo.pop();
    if (!record) return;
    this.page.writeRect(record.rect, record.pixels, record.priority);
    this.dirty.add(record.rect);
  }
}

function readPlane(plane: Uint8Array, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const from = (rect.y + y) * SCREEN_WIDTH + rect.x;
    out.set(plane.subarray(from, from + rect.width), y * rect.width);
  }
  return out;
}

interface SpriteClip {
  /** Coin haut gauche et taille de la partie visible. */
  x: number;
  y: number;
  columns: number;
  rows: number;
  /** Colonnes et lignes du sprite sautées à gauche (avant miroir) et en haut. */
  skipLeft: number;
  skipTop: number;
}

/** Rognage du pilote (`CS:0556..0560`) à la fenêtre 320 x 200 ; `null` si rien ne reste. */
function spriteClip(
  left: number,
  bottom: number,
  w: number,
  h: number,
): SpriteClip | null {
  const skipLeft = Math.max(-left, 0);
  const skipRight = Math.max(left + w - SCREEN_WIDTH, 0);
  const top = bottom - h + 1;
  const skipTop = Math.max(-top, 0);
  const skipBottom = Math.max(bottom + 1 - SCREEN_HEIGHT, 0);
  const columns = w - skipLeft - skipRight;
  const rows = h - skipTop - skipBottom;
  if (columns <= 0 || rows <= 0) return null;
  return {
    x: left + skipLeft,
    y: top + skipTop,
    columns,
    rows,
    skipLeft,
    skipTop,
  };
}
