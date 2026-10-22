import type { Host, VmContext } from "../host";
import { Surface } from "./surface";

/** Indices des surfaces dans le tableau de sprites (Draw::k…Surface). */
export const FRONT_SURFACE = 20;
export const BACK_SURFACE = 21;
export const ANIM_SURFACE = 22;
export const CURSOR_SURFACE = 23;
export const CAPTURE_SURFACE = 30;
export const SPRITE_COUNT = 100;
export const FONT_COUNT = 16;

// Opérations de spriteOperation (DRAW_*).
export const DRAW_BLITSURF = 0;
export const DRAW_PUTPIXEL = 1;
export const DRAW_FILLRECT = 2;
export const DRAW_DRAWLINE = 3;
export const DRAW_INVALIDATE = 4;
export const DRAW_LOADSPRITE = 5;
export const DRAW_PRINTTEXT = 6;
export const DRAW_DRAWBAR = 7;
export const DRAW_CLEARRECT = 8;
export const DRAW_FILLRECTABS = 9;
export const DRAW_DRAWLETTER = 10;

// Drapeaux de rendu (RENDERFLAG_*).
export const RENDERFLAG_NOINVALIDATE = 0x0001;
export const RENDERFLAG_CAPTUREPUSH = 0x0002;
export const RENDERFLAG_COLLISIONS = 0x0004;
export const RENDERFLAG_USEDELTAS = 0x0010;
export const RENDERFLAG_NOBLITINVALIDATED = 0x0200;
export const RENDERFLAG_FROMSPLIT = 0x0800;
export const RENDERFLAG_DOUBLECOORDS = 0x1000;

export const s16 = (v: number): number => (v << 16) >> 16;

/** Image du curseur courant (copie des indices de palette, 0 = transparent). */
export interface CursorImage {
  width: number;
  height: number;
  hotX: number;
  hotY: number;
  pixels: Uint8Array;
}

/**
 * État partagé par les trois sous-systèmes graphiques : écran (Video), palette, et ce qu'il faut
 * pour présenter l'image. Tout ce qui change l'affichage incrémente `version`.
 */
export class GraphicsCore {
  vm: VmContext | null = null;

  // Écran : taille affichée (_vm->_width/_height) et taille des surfaces (_surfWidth/_surfHeight).
  screenWidth = 320;
  screenHeight = 200;
  surfWidth = 320;
  surfHeight = 200;
  /** Mode vidéo courant (_global->_videoMode). */
  videoMode = 0x13;
  /** Nombre de couleurs de la palette utilisée (16 pour l'écran-titre en 640x400, sinon 256). */
  colorCount = 256;
  /** Décalage d'affichage courant (Video::_scrollOffset). */
  scrollX = 0;
  scrollY = 0;
  splitHeight2 = 0;
  splitStart = 0;

  /** Surface affichée (la « primaire ») : même taille que les surfaces de travail. */
  front = new Surface(320, 200);

  // Palette : `wanted` = _vgaPalette (voulue par le jeu), `shown` = palette matérielle (RGB 6 bits).
  readonly wanted = new Uint8Array(768);
  readonly shown = new Uint8Array(768);
  /** Palette à appliquer au prochain blitInvalidated (_applyPal). */
  applyPal = false;
  paletteCleared = false;

  // Curseur : visible si (showCursor & 6) != 0.
  showCursor = 0;
  cursorImage: CursorImage | null = null;

  private _version = 1;

  get host(): Host {
    return this.vm!.host;
  }

  get version(): number {
    return this._version;
  }

  /** Signale que l'image affichée a changé (dirtyRectsAdd / dirtyRectsAll). */
  touch(): void {
    this._version++;
  }

  /** Affiche la palette voulue (Video::setFullPalette). */
  setFullPalette(): void {
    this.shown.set(this.wanted);
    this.touch();
  }

  /** Noircit la palette affichée (Util::clearPalette). */
  clearPalette(): void {
    this.shown.fill(0);
    this.touch();
  }
}
