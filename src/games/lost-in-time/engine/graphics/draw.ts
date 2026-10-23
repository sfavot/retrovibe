import { parseFont, type Font } from "../../data/font";
import { decodeSprite } from "../../data/sprite";
import type { AddHotspotArgs, DrawSystem, HotspotSystem, PrintTextArgs } from "../host";
import {
  BACK_SURFACE,
  CAPTURE_SURFACE,
  CURSOR_SURFACE,
  DRAW_BLITSURF,
  DRAW_CLEARRECT,
  DRAW_DRAWBAR,
  DRAW_DRAWLETTER,
  DRAW_DRAWLINE,
  DRAW_FILLRECT,
  DRAW_FILLRECTABS,
  DRAW_INVALIDATE,
  DRAW_LOADSPRITE,
  DRAW_PRINTTEXT,
  DRAW_PUTPIXEL,
  FONT_COUNT,
  FRONT_SURFACE,
  RENDERFLAG_NOBLITINVALIDATED,
  RENDERFLAG_NOINVALIDATE,
  RENDERFLAG_USEDELTAS,
  SPRITE_COUNT,
  s16,
  type GraphicsCore,
} from "./core";
import type { CursorImpl } from "./cursor";
import type { PaletteImpl } from "./palette";
import { Surface } from "./surface";
import { printTotText } from "./text";

interface FontToSprite {
  sprite: number;
  base: number;
  width: number;
  height: number;
}

interface CaptureRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Media {
  sprites: (Surface | null)[];
  fonts: (Font | null)[];
}

/** Table de l'effet « wobble » (Draw::_wobbleTable) : sinus sur 360 degrés, amplitude 0x4000. */
const WOBBLE_TABLE: number[] = Array.from({ length: 360 }, (_, i) => Math.trunc(Math.sin((i * Math.PI) / 180) * 0x4000));

/**
 * Draw_v2 : tableau de sprites, rectangles invalidés, opérations de dessin et de texte.
 * Les champs portent les noms de ceux de ScummVM : spriteOperation lit les mêmes registres que l'original.
 */
export class DrawImpl implements DrawSystem {
  renderFlags = 0;
  fontIndex = 0;
  spriteLeft = 0;
  spriteTop = 0;
  spriteRight = 0;
  spriteBottom = 0;
  destSpriteX = 0;
  destSpriteY = 0;
  backColor = 0;
  frontColor = 0;
  transparency = 0;
  sourceSurface = 0;
  destSurface = 0;
  textToPrint = "";
  backDeltaX = 0;
  backDeltaY = 0;
  subtitleFont = 0;
  subtitleColor = 0;
  /** Affiche les textes marqués « sous-titre » (désactivé par défaut, comme ScummVM pour ce jeu). */
  doSubtitles = false;
  hotspotText = "";

  readonly fontToSprite: FontToSprite[] = Array.from({ length: 4 }, () => ({ sprite: -1, base: -1, width: -1, height: -1 }));
  readonly fonts: (Font | null)[] = new Array(FONT_COUNT).fill(null);
  readonly sprites: (Surface | null)[] = new Array(SPRITE_COUNT).fill(null);
  back: Surface;

  // Rectangles invalidés de la surface de travail (au plus 30, triés par ordonnée).
  private invalidated: { left: number; top: number; right: number; bottom: number }[] = [];
  noInvalidated = true;

  scrollX = 0;
  scrollY = 0;
  preventScroll = false;

  private readonly captures: CaptureRect[] = [];
  private readonly media = new Map<number, Media>();

  // Liens vers les autres sous-systèmes, renseignés par GraphicsSystems.
  cursor!: CursorImpl;
  palette!: PaletteImpl;
  getHotspots: () => HotspotSystem | undefined = () => undefined;

  constructor(readonly core: GraphicsCore) {
    this.back = Surface.sprite(core.surfWidth, core.surfHeight);
    this.initScreenSurfaces();
  }

  get front(): Surface {
    return this.core.front;
  }

  // --- coordonnées ---

  /** Lost in Time n'utilise pas la mise à l'échelle des coordonnées (_needAdjust == 2). */
  adjustCoords(_kind: 0 | 1 | 2, a: number, b: number): [number, number] {
    return [a, b];
  }

  fontMetrics(index: number): Font | null {
    return this.fonts[index] ?? null;
  }

  /** Drapeaux de rendu utiles au placement des zones (RENDERFLAG_CAPTUREPOP = 0x08). */
  renderState(): { capturePop: boolean; backDeltaX: number; backDeltaY: number } {
    return { capturePop: (this.renderFlags & 0x08) !== 0, backDeltaX: this.backDeltaX, backDeltaY: this.backDeltaY };
  }

  setRenderFlags(expr: number): void {
    this.renderFlags = s16(expr);
  }

  setBackDelta(x: number, y: number): void {
    this.backDeltaX = s16(x);
    this.backDeltaY = s16(y);
  }

  setHotspotText(text: string): void {
    this.hotspotText = text;
  }

  // --- écran et surfaces ---

  /** Draw_v2::initScreen : surface de travail neuve, surface des curseurs si besoin. */
  initScreenSurfaces(): void {
    const core = this.core;
    this.scrollX = 0;
    this.scrollY = 0;
    this.preventScroll = false;
    this.back = Surface.sprite(core.surfWidth, core.surfHeight);
    this.sprites[BACK_SURFACE] = this.back;
    if (!this.sprites[CURSOR_SURFACE]) this.sprites[CURSOR_SURFACE] = Surface.sprite(32, 16);
    this.sprites[FRONT_SURFACE] = this.front;
    core.touch();
  }

  /** Inter_v2::o2_initScreen. */
  initScreen(videoMode: number, offY: number, width: number, height: number): void {
    const core = this.core;
    const vm = core.vm!;

    // L'écran-titre passe en 640x400 en 16 couleurs, le reste du jeu est en 320x200.
    if (videoMode === 0x10) {
      width = core.screenWidth = 640;
      height = core.screenHeight = 400;
      core.colorCount = 16;
    } else if (core.videoMode === 0x10) {
      if (width === -1) width = 320;
      if (height === -1) height = 200;
      core.screenWidth = 320;
      core.screenHeight = 200;
      core.colorCount = 256;
    }

    vm.fakeVideoMode = videoMode;
    if (videoMode === 0xd) videoMode = 0x14;
    if (videoMode === core.videoMode && width === -1) return;

    if (width > 0) core.surfWidth = width;
    if (height > 0) core.surfHeight = height;
    core.splitHeight2 = offY;
    core.splitStart = core.surfHeight - offY;

    this.freeSprite(BACK_SURFACE);
    core.clearPalette();
    core.paletteCleared = true;
    core.videoMode = videoMode;
    core.front.resize(core.surfWidth, core.surfHeight);
    try {
      vm.vars.writeVar32(15, vm.fakeVideoMode);
    } catch {
      // variables non allouées : rien à écrire
    }
    this.initScreenSurfaces();
    core.scrollX = this.scrollX;
    core.scrollY = this.scrollY;
  }

  initSpriteSurf(index: number, width: number, height: number): void {
    const surface = Surface.sprite(width, height);
    this.sprites[index] = surface;
    if (index === BACK_SURFACE) this.back = surface;
  }

  createSprite(index: number, width: number, height: number, _flag: number): void {
    if (index < 0 || index >= SPRITE_COUNT || width <= 0 || height <= 0) return;
    this.initSpriteSurf(index, width, height);
  }

  freeSprite(index: number): void {
    if (index < 0 || index >= SPRITE_COUNT) return;
    this.sprites[index] = null;
    if (index === FRONT_SURFACE) this.sprites[index] = this.front;
    if (index === BACK_SURFACE) this.sprites[index] = this.back;
  }

  restoreMainSurfaces(): void {
    this.sprites[FRONT_SURFACE] = this.front;
    this.sprites[BACK_SURFACE] = this.back;
  }

  closeAllWin(): void {}

  /** Le sprite `index` (les surfaces 100 et 101 désignent l'avant et l'arrière-plan). */
  surfaceAt(index: number): Surface | null {
    if (index >= 100) index -= 80;
    return this.sprites[index] ?? null;
  }

  // --- rectangles invalidés ---

  /** Draw::invalidateRect : insère le rectangle dans la liste triée, en le fusionnant avec ses voisins. */
  invalidateRect(left: number, top: number, right: number, bottom: number): void {
    const core = this.core;
    if (this.renderFlags & RENDERFLAG_NOINVALIDATE) {
      core.touch();
      return;
    }
    if (left > right) [left, right] = [right, left];
    if (top > bottom) [top, bottom] = [bottom, top];
    const maxX = core.surfWidth - 1;
    const maxY = core.surfHeight - 1;
    if (left > maxX || right < 0 || top > maxY || bottom < 0) return;

    this.noInvalidated = false;
    const list = this.invalidated;
    if (list.length >= 30) {
      list.length = 0;
      list.push({ left: 0, top: 0, right: maxX, bottom: maxY });
      return;
    }
    if (left < 0) left = 0;
    if (right > maxX) right = maxX;
    if (top < 0) top = 0;
    if (bottom > maxY) bottom = maxY;
    left &= 0xfff0;
    right |= 0x000f;

    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.top > top) {
        if (r.top > bottom) {
          list.splice(i, 0, { left, top, right, bottom });
          return;
        }
        if (r.bottom < bottom) r.bottom = bottom;
        if (r.left > left) r.left = left;
        if (r.right < right) r.right = right;
        r.top = top;
        return;
      }
      if (r.bottom < top) continue;
      if (r.bottom < bottom) r.bottom = bottom;
      if (r.left > left) r.left = left;
      if (r.right < right) r.right = right;
      return;
    }
    list.push({ left, top, right, bottom });
  }

  private dirtiedRect(surface: Surface | null, left: number, top: number, right: number, bottom: number): void {
    if (!surface) return;
    if (surface === this.back) this.invalidateRect(left, top, right, bottom);
    else if (surface === this.front) this.core.touch();
  }

  invalidate(surface: number, x: number, y: number, radius: number, color: number): void {
    this.destSurface = surface;
    this.destSpriteX = x;
    this.destSpriteY = y;
    this.spriteRight = radius;
    this.frontColor = color;
    this.spriteOperation(DRAW_INVALIDATE);
  }

  /** Draw::blitInvalidated : recopie les zones modifiées de la surface de travail vers l'écran. */
  blitInvalidated(respectRenderFlags = false): void {
    if (respectRenderFlags && this.renderFlags & RENDERFLAG_NOBLITINVALIDATED) return;
    const core = this.core;

    if (this.cursor.cursorIndex === 4) this.cursor.blit();
    if (core.vm && core.vm.terminate) return;
    if (this.noInvalidated && !core.applyPal) return;

    if (this.noInvalidated) {
      this.setPalette();
      core.applyPal = false;
      return;
    }

    if (this.cursor.sprites) core.showCursor = (core.showCursor & ~2) | ((core.showCursor & 1) << 1);

    if (core.applyPal) {
      this.clearPalette();
      this.forceBlit();
      this.setPalette();
      this.invalidated.length = 0;
      this.noInvalidated = true;
      core.applyPal = false;
      return;
    }

    for (const r of this.invalidated) this.front.blit(this.back, r.left, r.top, r.right, r.bottom, r.left, r.top);
    core.touch();
    this.invalidated.length = 0;
    this.noInvalidated = true;
    core.applyPal = false;
  }

  forceBlit(): void {
    if (this.front === this.back) return;
    this.front.blitAll(this.back);
    this.core.touch();
  }

  private setPalette(): void {
    this.core.setFullPalette();
    this.core.paletteCleared = false;
  }

  private clearPalette(): void {
    if (!this.core.paletteCleared) {
      this.core.clearPalette();
      this.core.paletteCleared = true;
    }
  }

  // --- opérations de dessin demandées par les scripts ---

  loadSprite(resId: number, destSurface: number, transparency: number, x: number, y: number): void {
    this.spriteLeft = resId;
    this.destSurface = destSurface;
    this.transparency = transparency;
    this.destSpriteX = x;
    this.destSpriteY = y;
    this.spriteOperation(DRAW_LOADSPRITE);
  }

  copySprite(
    src: number,
    dest: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    x: number,
    y: number,
    transparency: number,
  ): void {
    this.sourceSurface = src;
    this.destSurface = dest;
    this.spriteLeft = left;
    this.spriteTop = top;
    this.spriteRight = right;
    this.spriteBottom = bottom;
    this.destSpriteX = x;
    this.destSpriteY = y;
    this.transparency = transparency;
    this.spriteOperation(DRAW_BLITSURF);
  }

  /** `deltaVeto` : ignore le décalage de fond (DRAW_FILLRECT | 0x10, comme Hotspots::fillRect). */
  fillRect(surface: number, x: number, y: number, width: number, height: number, color: number, deltaVeto = false): void {
    this.destSurface = surface;
    this.destSpriteX = x;
    this.destSpriteY = y;
    this.spriteRight = width;
    this.spriteBottom = height;
    this.backColor = s16(color);
    if (!this.surfaceAt(surface)) return;
    this.spriteOperation(deltaVeto ? DRAW_FILLRECT | 0x10 : DRAW_FILLRECT);
  }

  drawLine(surface: number, x1: number, y1: number, x2: number, y2: number, color: number): void {
    this.destSurface = surface;
    this.destSpriteX = x1;
    this.destSpriteY = y1;
    this.spriteRight = x2;
    this.spriteBottom = y2;
    this.frontColor = s16(color);
    this.spriteOperation(DRAW_DRAWLINE);
  }

  putPixel(surface: number, x: number, y: number, color: number): void {
    this.destSurface = surface;
    this.destSpriteX = x;
    this.destSpriteY = y;
    this.frontColor = s16(color);
    this.spriteOperation(DRAW_PUTPIXEL);
  }

  /** o1_printText : un morceau de texte sur la surface de travail. */
  printText(args: PrintTextArgs): void {
    this.destSpriteX = args.x;
    this.destSpriteY = args.y;
    this.backColor = args.backColor;
    this.frontColor = args.frontColor;
    this.fontIndex = args.fontIndex & 0xffff;
    this.destSurface = BACK_SURFACE;
    this.textToPrint = args.text;
    this.transparency = args.transparent ? 1 : 0;
    if (this.backColor >= 16) {
      this.backColor = 0;
      this.transparency = 1;
    }
    this.spriteOperation(args.deltaVeto ? DRAW_PRINTTEXT | 0x10 : DRAW_PRINTTEXT);
  }

  printTotText(id: number): Promise<void> {
    return printTotText(this, id);
  }

  // --- polices ---

  loadFont(index: number, name: string): void {
    if (index < 0 || index >= FONT_COUNT) return;
    const data = this.core.vm?.getFile(name);
    let font: Font | null = null;
    if (data) {
      try {
        font = parseFont(data);
      } catch {
        font = null;
      }
    }
    this.fonts[index] = font;
  }

  freeFont(index: number): void {
    if (index >= 0 && index < FONT_COUNT) this.fonts[index] = null;
  }

  loadFontToSprite(index: number, sprite: number, base: number, width: number, height: number): void {
    const f = this.fontToSprite[index];
    if (f) Object.assign(f, { sprite, base, width, height });
  }

  freeFontToSprite(index: number): void {
    const f = this.fontToSprite[index];
    if (f) Object.assign(f, { sprite: -1, base: -1, width: -1, height: -1 });
  }

  resetFontToSprite(count: number): void {
    for (let i = 0; i < count; i++) this.freeFontToSprite(i);
  }

  /** Largeur d'un texte avec la police (Draw::stringLength). */
  stringLength(text: string, fontIndex: number): number {
    const font = this.fonts[fontIndex];
    if (!font) return 0;
    if (font.monospaced) return text.length * font.charWidthDefault;
    let len = 0;
    for (let i = 0; i < text.length; i++) len += font.charWidth(text.charCodeAt(i) & 0xff);
    return len;
  }

  // --- captures (sauvegarde / restauration d'une zone du fond) ---

  capturePush(left: number, top: number, width: number, height: number): void {
    if (this.captures.length >= 20) return;
    const count = this.captures.length;
    this.captures.push({ left, top, right: left + width, bottom: top + height });

    this.spriteTop = top;
    this.spriteBottom = height;
    let right = left + width - 1;
    left = s16(left & 0xfff0);
    right |= 0xf;

    this.initSpriteSurf(CAPTURE_SURFACE + count, right - left + 1, height);
    this.sourceSurface = BACK_SURFACE;
    this.destSurface = CAPTURE_SURFACE + count;
    this.spriteLeft = left;
    this.spriteRight = right - left + 1;
    this.destSpriteX = 0;
    this.destSpriteY = 0;
    this.transparency = 0;
    this.spriteOperation(DRAW_BLITSURF);
  }

  capturePop(doDraw: boolean): void {
    if (this.captures.length === 0) return;
    const rect = this.captures.pop()!;
    const index = CAPTURE_SURFACE + this.captures.length;
    if (doDraw) {
      this.destSpriteX = rect.left;
      this.destSpriteY = rect.top;
      this.spriteRight = rect.right - rect.left;
      this.spriteBottom = rect.bottom - rect.top;
      this.transparency = 0;
      this.sourceSurface = index;
      this.destSurface = BACK_SURFACE;
      this.spriteLeft = this.destSpriteX & 0xf;
      this.spriteTop = 0;
      this.spriteOperation(DRAW_BLITSURF);
    }
    this.freeSprite(index);
  }

  // --- sauvegarde des médias d'un environnement (totSub) ---

  backupMedia(env: number): void {
    const sprites: (Surface | null)[] = [];
    for (let i = 0; i < 10; i++) {
      sprites.push(this.sprites[i]);
      this.sprites[i] = null;
    }
    const fonts = this.fonts.slice();
    this.fonts.fill(null);
    this.media.set(env, { sprites, fonts });
  }

  restoreMedia(env: number): void {
    const saved = this.media.get(env);
    if (!saved) return;
    this.media.delete(env);
    for (let i = 0; i < 10; i++) this.sprites[i] = saved.sprites[i];
    for (let i = 0; i < FONT_COUNT; i++) this.fonts[i] = saved.fonts[i];
  }

  // --- défilement ---

  setScrollOffset(x: number, y: number): void {
    const core = this.core;
    if (x === -1) {
      this.preventScroll = !this.preventScroll;
      try {
        core.vm!.vars.writeVar32(2, this.scrollX);
        core.vm!.vars.writeVar32(3, this.scrollY);
      } catch {
        // variables non allouées
      }
    } else {
      let w = core.surfWidth;
      let h = core.surfHeight;
      if (w > core.screenWidth) w -= core.screenWidth;
      if (h > core.screenHeight) h -= core.screenHeight;
      this.scrollX = clip(s16(x), 0, w);
      this.scrollY = clip(s16(y), 0, h);
      core.touch();
    }
    core.scrollX = this.scrollX;
    core.scrollY = this.scrollY;
    core.touch();
  }

  async scroll(startX: number, startY: number, endX: number, endY: number, stepX: number, stepY: number): Promise<void> {
    const core = this.core;
    const maxX = core.surfWidth - core.screenWidth;
    const maxY = core.surfHeight - core.screenHeight;
    let curX = clip(startX, 0, maxX);
    let curY = clip(startY, 0, maxY);
    endX = clip(endX, 0, maxX);
    endY = clip(endY, 0, maxY);
    while (curX !== endX || curY !== endY) {
      curX = stepX > 0 ? Math.min(curX + stepX, endX) : Math.max(curX + stepX, endX);
      curY = stepY > 0 ? Math.min(curY + stepY, endY) : Math.max(curY + stepY, endY);
      this.scrollX = curX;
      this.scrollY = curY;
      core.scrollX = curX;
      core.scrollY = curY;
      core.touch();
      await core.host.nextFrame();
    }
  }

  // --- effet de vague (o3_wobble) ---

  async wobble(): Promise<void> {
    const core = this.core;
    const height = core.screenHeight;
    let amplitude = 32;
    let curFrame = 0;
    let frameWobble = 0;
    const offsets = new Int8Array(height);

    this.palette.prepareFade(core.wanted, 0);
    while (amplitude > 0) {
      let rowWobble = frameWobble;
      frameWobble = (frameWobble + 20) % 360;
      for (let y = 0; y < height; y++) {
        offsets[y] = amplitude + Math.trunc((WOBBLE_TABLE[rowWobble] * amplitude) / 0x4000);
        rowWobble = (rowWobble + 20) % 360;
      }
      if (curFrame++ & 16) amplitude--;
      for (let y = 0; y < height; y++) this.front.blit(this.back, 0, y, core.screenWidth - 1, y, offsets[y], y);
      this.palette.fadeStep();
      await core.host.nextFrame();
    }
    this.front.blitAll(this.back);
    core.applyPal = false;
    this.invalidated.length = 0;
    this.noInvalidated = true;
    core.touch();
  }

  // --- spriteOperation ---

  /** Draw_v2::spriteOperation : exécute l'opération sur les « registres » du dessin. */
  spriteOperation(operation: number): void {
    const deltaVeto = (operation & 0x10) !== 0;
    operation &= 0x0f;

    if (this.sourceSurface >= 100) this.sourceSurface -= 80;
    if (this.destSurface >= 100) this.destSurface -= 80;

    const deltas = (this.renderFlags & RENDERFLAG_USEDELTAS) !== 0 && !deltaVeto;
    if (deltas) {
      if (this.sourceSurface === BACK_SURFACE && operation !== DRAW_LOADSPRITE) {
        this.spriteLeft += this.backDeltaX;
        this.spriteTop += this.backDeltaY;
      }
      if (this.destSurface === BACK_SURFACE) {
        this.destSpriteX += this.backDeltaX;
        this.destSpriteY += this.backDeltaY;
        if (operation === DRAW_DRAWLINE || (operation >= DRAW_DRAWBAR && operation <= DRAW_FILLRECTABS)) {
          this.spriteRight += this.backDeltaX;
          this.spriteBottom += this.backDeltaY;
        }
      }
    }

    const saved = {
      spriteLeft: this.spriteLeft,
      spriteTop: this.spriteTop,
      spriteRight: this.spriteRight,
      spriteBottom: this.spriteBottom,
      destSpriteX: this.destSpriteX,
      destSpriteY: this.destSpriteY,
      destSurface: this.destSurface,
      sourceSurface: this.sourceSurface,
    };

    const source = this.sprites[this.sourceSurface] ?? null;
    const dest = this.sprites[this.destSurface] ?? null;
    if (dest) this.execute(operation, source, dest);

    this.spriteLeft = saved.spriteLeft;
    this.spriteTop = saved.spriteTop;
    this.spriteRight = saved.spriteRight;
    this.spriteBottom = saved.spriteBottom;
    if (operation !== DRAW_PRINTTEXT) this.destSpriteX = saved.destSpriteX;
    this.destSpriteY = saved.destSpriteY;
    this.destSurface = saved.destSurface;
    this.sourceSurface = saved.sourceSurface;

    if (deltas) {
      if (this.sourceSurface === BACK_SURFACE) {
        this.spriteLeft -= this.backDeltaX;
        this.spriteTop -= this.backDeltaY;
      }
      if (this.destSurface === BACK_SURFACE) {
        this.destSpriteX -= this.backDeltaX;
        this.destSpriteY -= this.backDeltaY;
      }
    }
  }

  private execute(operation: number, source: Surface | null, dest: Surface): void {
    const x = this.destSpriteX;
    const y = this.destSpriteY;

    switch (operation) {
      case DRAW_BLITSURF:
      case DRAW_DRAWLETTER:
        if (!source) break;
        dest.blit(
          source,
          this.spriteLeft,
          this.spriteTop,
          this.spriteLeft + this.spriteRight - 1,
          this.spriteTop + this.spriteBottom - 1,
          x,
          y,
          this.transparency === 0 ? -1 : 0,
          (this.transparency & 0x80) !== 0,
        );
        this.dirtiedRect(dest, x, y, x + this.spriteRight - 1, y + this.spriteBottom - 1);
        break;

      case DRAW_PUTPIXEL:
        dest.putPixel(x, y, this.frontColor & 0xff);
        this.dirtiedRect(dest, x, y, x, y);
        break;

      case DRAW_FILLRECT:
        // En 8 bits, la variante « ombrée » (couleur sur 16 bits) est un simple remplissage.
        dest.fillRect(x, y, x + this.spriteRight - 1, y + this.spriteBottom - 1, this.backColor & 0xff);
        this.dirtiedRect(dest, x, y, x + this.spriteRight - 1, y + this.spriteBottom - 1);
        break;

      case DRAW_DRAWLINE:
        dest.drawLine(x, y, this.spriteRight, this.spriteBottom, this.frontColor & 0xff);
        this.dirtiedRect(dest, x, y, this.spriteRight, this.spriteBottom);
        break;

      case DRAW_INVALIDATE:
        dest.drawCircle(x, y, this.spriteRight, this.frontColor & 0xff);
        this.dirtiedRect(dest, x - this.spriteRight, y - this.spriteBottom, x + this.spriteRight, y + this.spriteBottom);
        break;

      case DRAW_LOADSPRITE: {
        const res = this.core.vm?.resources?.getResource(this.spriteLeft & 0xffff);
        if (!res) break;
        this.spriteRight = res.width;
        this.spriteBottom = res.height;
        if (y + res.height > dest.height) break;
        const sprite = decodeSprite(res.data, res.width, res.height);
        dest.blit(
          new Surface(res.width, res.height, sprite.pixels),
          0,
          0,
          res.width - 1,
          res.height - 1,
          x,
          y,
          this.transparency === 0 ? -1 : 0,
        );
        this.dirtiedRect(dest, x, y, x + res.width - 1, y + res.height - 1);
        break;
      }

      case DRAW_PRINTTEXT:
        this.printTextOperation(dest);
        break;

      case DRAW_DRAWBAR: {
        const color = this.frontColor & 0xff;
        dest.drawLine(x, this.spriteBottom, this.spriteRight, this.spriteBottom, color);
        dest.drawLine(x, y, x, this.spriteBottom, color);
        dest.drawLine(this.spriteRight, y, this.spriteRight, this.spriteBottom, color);
        dest.drawLine(x, y, this.spriteRight, y, color);
        this.dirtiedRect(dest, x, y, this.spriteRight, this.spriteBottom);
        break;
      }

      case DRAW_CLEARRECT:
        if (this.backColor !== 16 && this.backColor !== 144) {
          dest.fillRect(x, y, this.spriteRight, this.spriteBottom, this.backColor & 0xff);
        }
        this.dirtiedRect(dest, x, y, this.spriteRight, this.spriteBottom);
        break;

      case DRAW_FILLRECTABS:
        dest.fillRect(x, y, this.spriteRight, this.spriteBottom, this.backColor & 0xff);
        this.dirtiedRect(dest, x, y, this.spriteRight, this.spriteBottom);
        break;
    }
  }

  /** DRAW_PRINTTEXT : police bitmap, ou police faite d'une planche de sprites. */
  private printTextOperation(dest: Surface): void {
    const text = this.textToPrint;
    const left = this.destSpriteX;
    const fi = this.fontIndex;
    const mapping = fi < 4 ? this.fontToSprite[fi] : null;
    const font = fi < FONT_COUNT ? this.fonts[fi] : null;
    const front = this.frontColor & 0xff;
    const back = this.transparency ? null : this.backColor & 0xff;

    if (!mapping || mapping.sprite === -1) {
      if (!font) return;
      if (font.monospaced) {
        // Chaîne spéciale (premier octet 0xFF) : indices de caractères du fichier de textes, non utilisés ici.
        if ((text.charCodeAt(0) & 0xff) !== 0xff) {
          const height = font.charHeight;
          for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i) & 0xff;
            const w = font.charWidth(c);
            const x = this.destSpriteX;
            const y = this.destSpriteY;
            if (x >= 0 && y >= 0 && x + w <= dest.width && y + height <= dest.height) {
              font.drawChar(dest, c, x, y, front, back);
            }
            this.destSpriteX += w;
          }
        }
      } else {
        for (let i = 0; i < text.length; i++) {
          const c = text.charCodeAt(i) & 0xff;
          font.drawChar(dest, c, this.destSpriteX, this.destSpriteY, front, back);
          this.destSpriteX += font.charWidth(c);
        }
      }
    } else {
      const sheet = this.sprites[mapping.sprite] ?? null;
      if (!sheet) return;
      let ratio = sheet === this.front || sheet === this.back ? 320 : sheet.width;
      ratio = Math.trunc(ratio / mapping.width);
      if (ratio === 0) return;
      for (let i = 0; i < text.length; i++) {
        // Octet non signé : les caractères accentués (CP850, > 0x7f) sont des cases de la planche, après les lettres.
        // (ScummVM lit un `char` signé et les perd, ce qui laisse un trou dans « Prunelière ».)
        const index = (text.charCodeAt(i) & 0xff) - mapping.base;
        const sy = Math.trunc(index / ratio) * mapping.height;
        const sx = (index % ratio) * mapping.width;
        dest.blit(
          sheet,
          sx,
          sy,
          sx + mapping.width - 1,
          sy + mapping.height - 1,
          this.destSpriteX,
          this.destSpriteY,
          this.transparency === 0 ? -1 : 0,
        );
        this.destSpriteX += mapping.width;
      }
    }

    const charHeight = font ? font.charHeight : (mapping?.height ?? 0);
    this.dirtiedRect(dest, left, this.destSpriteY, this.destSpriteX - 1, this.destSpriteY + charHeight - 1);
  }

  // --- aides pour printTotText ---

  addHotspot(args: AddHotspotArgs): void {
    this.getHotspots()?.add(args);
  }

  get hotspots(): HotspotSystem | undefined {
    return this.getHotspots();
  }
}

function clip(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
