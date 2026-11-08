/**
 * Écran de *Flight of the Amazon Queen* : décor de 640 pixels qui défile, panneau, mode plein écran ou panneau, liste de textes par
 * ligne, textes au-dessus des personnages, palettes. Réécriture de `Display` (engines/queen/display.cpp, display.h) et de
 * `Graphics::setBobText` (graphics.cpp, ScummVM, GPL v3 ou ultérieure).
 *
 * Fonctionnement (lu) : `setupNewRoom` décode le décor dans un tampon de 640 x 200 (`_backdropBuf`) et en garde la palette ;
 * `setupPanel` décode `PANEL.PCX` (320 x 40) dans les 40 dernières lignes d'un tampon de 320 x 50 (les 10 premières, noires,
 * portent la ligne de commande). À chaque image, `prepareUpdate` copie 150 lignes du décor (200 en plein écran) à partir du
 * défilement, plus le panneau en panneau ; les bobs sont dessinés ensuite (`renderer.ts`), puis `drawTexts` écrit la liste de textes
 * (une entrée par ordonnée, de bas en haut). Les images collées (`drawBobPasteDown`) sont écrites dans le décor.
 *
 * Écarts :
 * - ScummVM ne vide pas le tampon du décor à un changement de pièce (restes de l'ancien décor sous un décor de 150 lignes ou de
 *   320 pixels en plein écran) ; ici il est vidé (noir) ;
 * - pas de blocs sales (`setDirtyBlock`, `_fullRefresh`) : l'image est entièrement recomposée ;
 * - l'économiseur d'écran (`blankScreen`), `shake` (porté : `shakeY`, appliqué par le rendu) et les polices non
 *   françaises ne sont pas portés ; `drawBox` (zones, débogage) n'est pas porté.
 */

import type { RoomLight } from "../data/dynalum";
import type { PcxImage } from "../data/pcx";
import { drawText as drawGlyphText, textWidth } from "./font";
import { Palette } from "./palette";
import type { Surface } from "./sprites";

export const SCREEN_W = 320;
export const SCREEN_H = 200;
export const PANEL_W = 320;
export const PANEL_H = 50;
export const BACKDROP_W = 640;
export const BACKDROP_H = 200;
/** Hauteur de l'écran de jeu (`ROOM_ZONE_HEIGHT`) ; en plein écran le décor en prend 200 (`GAME_SCREEN_HEIGHT`). */
export const ROOM_ZONE_HEIGHT = 150;
/** Ordonnée de la ligne de commande (`CmdText::COMMAND_Y_POS`). */
export const COMMAND_Y_POS = 151;
/** Hauteur des 10 premières lignes du panneau, occupées par la ligne de commande (`setupPanel` : l'image est décalée de 10 lignes). */
const PANEL_TOP = 10;
/** Pas entre deux lignes d'un texte au-dessus d'un personnage, et nombre de caractères avant le saut de ligne (`setBobText`). */
const BOB_TEXT_LINE_HEIGHT = 9;
const BOB_TEXT_LINE_LENGTH = 20;

/** Couleurs d'encre (`InkColor`, `setupInkColors`, version DOS) : indices de la palette du panneau (224 à 255) ou du décor. */
export const Ink = {
  /** Fond des cases de l'inventaire vides. */
  BgPanel: 226,
  Journal: 248,
  PinnacleRoom: 243,
  /** Ligne de commande sous le curseur (`INK_CMD_SELECT`) et normale. */
  CmdSelect: 255,
  CmdNormal: 225,
  /** Réplique de Joe dans les choix de dialogue (`INK_JOE`) et texte normal (`INK_TALK_NORMAL`). */
  Joe: 14,
  TalkNormal: 7,
  /** Contour des textes (`INK_OUTLINED_TEXT`). */
  OutlinedText: 16,
} as const;

/** Entrée de la liste de textes (`TextSlot`). */
export interface TextSlot {
  x: number;
  color: number;
  text: string;
  outlined: boolean;
}

/** Le bob dont on dit le texte : sa position, son échelle et la taille de son image (`setBobText`). */
export interface TextAnchor {
  x: number;
  y: number;
  scale: number;
  frameWidth: number;
  frameHeight: number;
}

/** Abscisse d'un texte centré ; un texte plus large que l'écran perd son premier et son dernier caractère jusqu'à tenir (`setTextCentered`). */
export function centerText(text: string): { x: number; text: string } {
  let x = Math.trunc((SCREEN_W - textWidth(text)) / 2);
  while (x <= 0 && text.length > 2) {
    text = text.slice(1, -1);
    x = Math.trunc((SCREEN_W - textWidth(text)) / 2);
  }
  return { x, text };
}

export class Display {
  readonly palette = new Palette();
  /** Plan du décor : 640 x 200, les images collées y sont écrites. */
  readonly backdrop: Surface = { pixels: new Uint8Array(BACKDROP_W * BACKDROP_H), width: BACKDROP_W, height: BACKDROP_H };
  /** Plan du panneau : 320 x 50. */
  readonly panel: Surface = { pixels: new Uint8Array(PANEL_W * PANEL_H), width: PANEL_W, height: PANEL_H };
  /** Image composée, sans curseur : 320 x 200. */
  readonly screen: Surface = { pixels: new Uint8Array(SCREEN_W * SCREEN_H), width: SCREEN_W, height: SCREEN_H };
  /** Largeur et hauteur du décor chargé (`_bdWidth`, `_bdHeight`). */
  bdWidth = 0;
  bdHeight = 0;
  /** Plein écran (`_fullscreen`) : le décor prend 200 lignes, sans panneau ; faux : 150 lignes et le panneau. */
  fullscreen = true;
  /** Le curseur de la souris est montré (`showMouseCursor`). */
  cursorVisible = true;
  /** Incrémenté à chaque décor chargé : les images collées déjà écrites sont à refaire. */
  backdropVersion = 0;
  /** Secousse de l'écran (`Display::shake`, `OSystem::setShakePos`) : l'image est remontée de ce nombre de lignes, le bas devient noir. */
  shakeY = 0;
  /** L'image est figée (de `eraseRoom` à la pièce suivante, pendant le fondu de sortie). */
  frozen = false;

  private readonly texts: TextSlot[] = Array.from({ length: SCREEN_H }, () => ({ x: 0, color: 0, text: "", outlined: false }));
  private curTextColor = 0;

  // --- Panneau, pièce, mode d'écran ----------------------------------------------------------------------------------------

  /** `setupPanel` : `PANEL.PCX` dans les 40 dernières lignes du panneau, ses couleurs 144 à 255 dans la palette du panneau. */
  setupPanel(pcx: PcxImage): void {
    this.panel.pixels.fill(0);
    const rows = Math.min(pcx.height, PANEL_H - PANEL_TOP);
    for (let y = 0; y < rows; y++) {
      this.panel.pixels.set(pcx.pixels.subarray(y * pcx.width, y * pcx.width + Math.min(pcx.width, PANEL_W)), (PANEL_TOP + y) * PANEL_W);
    }
    this.palette.setPanelColors(pcx.palette);
  }

  /** `setupNewRoom` : décor, palette de la pièce, lumière dynamique (`null` : aucune). */
  setupRoom(pcx: PcxImage, room: number, light: RoomLight | null): void {
    this.backdrop.pixels.fill(0);
    this.bdWidth = pcx.width;
    this.bdHeight = pcx.height;
    const width = Math.min(pcx.width, BACKDROP_W);
    for (let y = 0; y < Math.min(pcx.height, BACKDROP_H); y++) {
      this.backdrop.pixels.set(pcx.pixels.subarray(y * pcx.width, y * pcx.width + width), y * BACKDROP_W);
    }
    this.palette.setupRoom(pcx.palette, room, light, pcx.width);
    this.backdropVersion++;
    this.frozen = false;
  }

  /**
   * `screenMode(comPanel, inCutaway)` : panneau de commande 1 = panneau ; 2 dans une cinématique = plein écran si le décor fait 200
   * lignes (`fullscreen(_bdHeight == GAME_SCREEN_HEIGHT)`), panneau sinon ; 0 ne change rien.
   */
  screenMode(comPanel: number, inCutaway: boolean): void {
    if (comPanel === 2 && inCutaway) this.fullscreen = this.bdHeight === SCREEN_H;
    else if (comPanel === 1) this.fullscreen = false;
  }

  /** Hauteur de l'écran de jeu dans le mode actuel (la boîte des bobs). */
  get gameHeight(): number {
    return this.fullscreen ? SCREEN_H : ROOM_ZONE_HEIGHT;
  }

  // --- Composition ---------------------------------------------------------------------------------------------------------

  /** `prepareUpdate` : le décor à partir du défilement (200 lignes en plein écran, 150 et le panneau sinon). */
  prepareScreen(scroll: number): void {
    const rows = this.gameHeight;
    const out = this.screen.pixels;
    for (let y = 0; y < rows; y++) {
      const from = y * BACKDROP_W + scroll;
      out.set(this.backdrop.pixels.subarray(from, from + SCREEN_W), y * SCREEN_W);
    }
    if (!this.fullscreen) out.set(this.panel.pixels, ROOM_ZONE_HEIGHT * SCREEN_W);
  }

  // --- Textes --------------------------------------------------------------------------------------------------------------

  /** `textCurrentColor`. */
  textCurrentColor(color: number): void {
    this.curTextColor = color;
  }

  /** `setText` : texte en `(x, y)` (une entrée par ordonnée ; hors de l'écran de 200 lignes, ignoré). */
  setText(x: number, y: number, text: string, outlined = true): void {
    if (y < 0 || y >= SCREEN_H) return;
    if (x === 0) x = 1;
    if (y === 0) y = 1;
    this.texts[y] = { x, color: this.curTextColor, text, outlined };
  }

  /** `setTextCentered` : texte centré à l'ordonnée `y`. */
  setTextCentered(y: number, text: string, outlined = true): void {
    if (y < 0 || y >= SCREEN_H) return;
    const centered = centerText(text);
    this.texts[y] = { x: centered.x, color: this.curTextColor, text: centered.text, outlined };
  }

  /** `clearTexts(y1, y2)`, bornes comprises. */
  clearTexts(y1: number, y2: number): void {
    for (let y = Math.max(0, y1); y <= Math.min(SCREEN_H - 1, y2); y++) this.texts[y].text = "";
  }

  /** `textColor(y, color)` : couleur de l'entrée de l'ordonnée `y`. */
  textColor(y: number, color: number): void {
    if (y >= 0 && y < SCREEN_H) this.texts[y].color = color;
  }

  /** Entrée de l'ordonnée `y` (tests, outils). */
  textAt(y: number): Readonly<TextSlot> {
    return this.texts[y];
  }

  /** `drawTexts` : les entrées, de la ligne 199 à la ligne 1, dans l'image composée. */
  drawTexts(skip?: number): void {
    for (let y = SCREEN_H - 1; y > 0; y--) {
      const slot = this.texts[y];
      if (slot.text && y !== skip) drawGlyphText(this.screen.pixels, slot.x, y, slot.color, slot.text, slot.outlined, Ink.OutlinedText);
    }
  }

  /**
   * `Graphics::setBobText` : texte dit par un personnage. Coupé en lignes de plus de 20 caractères à la première espace suivante ;
   * un point final est ajouté si le texte finit par un caractère ASCII >= 'A'. `flags` : 0 au-dessus du bob (centré sur lui, 16
   * pixels au-dessus de sa tête) ; 1 en `(textX, textY)` ; 2 centré horizontalement de l'écran à `textY`. `scroll` : défilement du
   * décor, qui est retiré de l'abscisse. Rien n'est écrit pour un texte vide.
   */
  setBobText(anchor: TextAnchor | null, scroll: number, text: string, textX: number, textY: number, color: number, flags: number): void {
    if (!text) return;
    // `char` est signé en C++ : un texte qui finit par une lettre accentuée (octet >= 0x80, donc négatif) n'a pas de point.
    const last = text.charCodeAt(text.length - 1);
    const copy = last >= 0x41 && last < 0x80 ? `${text}.` : text;

    const lines: string[] = [];
    let lineLength = 0;
    for (let i = 0; i < copy.length; i++) {
      lineLength++;
      if ((lineLength > BOB_TEXT_LINE_LENGTH && copy[i] === " ") || i === copy.length - 1) {
        lines.push(copy.slice(i + 1 - lineLength, i + 1));
        lineLength = 0;
      }
    }
    const maxLineWidth = Math.max(...lines.map(textWidth));

    let x: number;
    let y: number;
    let width = 0;
    if (flags) {
      x = flags === 2 ? 160 - Math.trunc(maxLineWidth / 2) : textX;
      y = textY;
    } else {
      if (!anchor) return;
      x = anchor.x;
      width = Math.trunc((anchor.frameWidth * anchor.scale) / 100);
      const height = Math.trunc((anchor.frameHeight * anchor.scale) / 100);
      y = anchor.y - height - 16 - lines.length * BOB_TEXT_LINE_HEIGHT;
    }
    x -= scroll;
    if (y < 0) {
      y = 0;
      if (x < 160) x += Math.trunc(width / 2);
      else x -= Math.trunc(width / 2) + maxLineWidth;
    } else if (!flags) {
      x -= Math.trunc(maxLineWidth / 2);
    }
    if (x < 0) x = 4;
    else if (x + maxLineWidth > 320) x = 320 - maxLineWidth - 4;

    this.textCurrentColor(color);
    lines.forEach((line, i) => this.setText(x + Math.trunc((maxLineWidth - textWidth(line)) / 2), y + BOB_TEXT_LINE_HEIGHT * i, line));
  }
}
