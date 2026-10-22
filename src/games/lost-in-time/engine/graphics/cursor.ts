import { decodeSprite } from "../../data/sprite";
import type { CursorSystem, InitCursorArgs } from "../host";
import { CURSOR_SURFACE, type GraphicsCore } from "./core";
import type { DrawImpl } from "./draw";
import { Surface } from "./surface";

const ANIM_COUNT = 40;
const i16 = (v: number): number => (v << 16) >> 16;

/**
 * Curseur de souris (Draw_v2::animateCursor / blitCursor, o1_initCursor, o1_loadCursor…).
 * Les images des curseurs sont rangées côte à côte dans la surface n°23 ; l'image courante est copiée
 * dans `core.cursorImage`, que le rendu dessine à la position de la souris.
 */
export class CursorImpl implements CursorSystem {
  cursorIndex = 0;
  cursorWidth = 16;
  cursorHeight = 16;
  transparentCursor = true;
  private cursorTimeKey = 0;
  private cursorX = 0;
  private cursorY = 0;
  private cursorAnim = 0;
  private readonly animLow = new Int8Array(ANIM_COUNT).fill(-1);
  private readonly animHigh = new Int8Array(ANIM_COUNT);
  private readonly animDelays = new Int8Array(ANIM_COUNT);

  /** Curseur à utiliser sous la souris (Hotspots::findCursor) ; renseigné par le sous-système des zones. */
  findCursor: ((x: number, y: number) => number) | null = null;

  draw!: DrawImpl;

  constructor(private readonly core: GraphicsCore) {}

  get sprites(): Surface | null {
    return this.draw.sprites[CURSOR_SURFACE] ?? null;
  }

  initCursor({ width, height, count }: InitCursorArgs): void {
    const sprites = this.sprites;
    if (width === this.cursorWidth && height === this.cursorHeight && sprites && sprites.width === width * count) return;

    this.draw.freeSprite(CURSOR_SURFACE);
    this.cursorWidth = width;
    this.cursorHeight = height;
    this.transparentCursor = count < 0x80;
    if (count > 0x80) count -= 0x80;
    this.draw.initSpriteSurf(CURSOR_SURFACE, width * count, height);

    this.animLow.fill(-1);
    this.animDelays.fill(0);
    this.animHigh.fill(0);
    this.animLow[1] = 0;
  }

  initAnim(index: number, low: number, high: number, delay: number): void {
    this.core.showCursor = 3;
    this.animLow[index] = low;
    this.animHigh[index] = high;
    this.animDelays[index] = delay;
  }

  clearAnim(index: number): void {
    this.core.showCursor = 0;
    this.animLow[index] = -1;
    this.animHigh[index] = 0;
    this.animDelays[index] = 0;
  }

  /** o1_loadCursor : décode la ressource dans la case `index` de la planche de curseurs. */
  load(resId: number, index: number): void {
    const sprites = this.sprites;
    const vm = this.core.vm;
    if (!sprites || !vm) return;
    index = (index << 24) >> 24;
    if (index < 0 || index * this.cursorWidth >= sprites.width) return;
    const res = vm.resources?.getResource(resId & 0xffff);
    if (!res) return;

    const x = index * this.cursorWidth;
    sprites.fillRect(x, 0, x + this.cursorWidth - 1, this.cursorHeight - 1, 0);
    if (res.height > sprites.height) return;
    const sprite = this.decode(res.data, res.width, res.height);
    sprites.blit(sprite, 0, 0, res.width - 1, res.height - 1, x, 0);
    this.animLow[index] = 0;
  }

  private decode(data: Uint8Array, width: number, height: number): Surface {
    return new Surface(width, height, decodeSprite(data, width, height).pixels);
  }

  hideAnim(): void {
    this.core.showCursor &= ~2;
  }

  /** Draw_v2::blitCursor. */
  blit(): void {
    if (!this.sprites || this.cursorIndex === -1) return;
    const core = this.core;
    core.showCursor = (core.showCursor & ~2) | ((core.showCursor & 1) << 1);
  }

  /** Draw_v2::animateCursor : choisit l'image du curseur (animée ou non) et la rend visible. */
  animate(mode: number): void {
    const sprites = this.sprites;
    const core = this.core;
    const vm = core.vm;
    if (!sprites || !vm) return;
    const input = vm.host.input;
    const now = vm.host.now();

    let cursorIndex = mode;
    core.showCursor |= 1;

    if (cursorIndex === -1) {
      cursorIndex = this.findCursor ? this.findCursor(input.mouseX, input.mouseY) : 0;
      if (this.animLow[cursorIndex] === -1) cursorIndex = 1;
    }

    if (this.animLow[cursorIndex] !== -1) {
      if (cursorIndex === this.cursorIndex) {
        const delay = this.animDelays[this.cursorIndex];
        if (delay !== 0 && this.cursorTimeKey + delay * 10 <= now) {
          this.cursorAnim++;
          if (this.animHigh[this.cursorIndex] < this.cursorAnim || this.animLow[this.cursorIndex] > this.cursorAnim) {
            this.cursorAnim = this.animLow[this.cursorIndex];
          }
          this.cursorTimeKey = now;
        } else if (this.draw.noInvalidated && input.mouseX === this.cursorX && input.mouseY === this.cursorY) {
          return;
        }
      } else {
        this.cursorIndex = cursorIndex;
        if (this.animDelays[cursorIndex] !== 0) {
          this.cursorAnim = this.animLow[cursorIndex];
          this.cursorTimeKey = now;
        }
      }

      if (this.animDelays[this.cursorIndex] !== 0) {
        if (this.animHigh[this.cursorIndex] < this.cursorAnim || this.animLow[this.cursorIndex] > this.cursorAnim) {
          this.cursorAnim = this.animLow[this.cursorIndex];
        }
        cursorIndex = this.cursorAnim;
      }

      let hotX = 0;
      let hotY = 0;
      if (vm.cursorHotspotXVar !== -1) {
        try {
          hotX = vm.vars.readVar32(this.cursorIndex + vm.cursorHotspotXVar) & 0xffff;
          hotY = vm.vars.readVar32(this.cursorIndex + vm.cursorHotspotYVar) & 0xffff;
        } catch {
          // variables absentes : point chaud en haut à gauche
        }
      }

      const image = new Surface(this.cursorWidth, this.cursorHeight);
      image.blit(
        sprites,
        cursorIndex * this.cursorWidth,
        0,
        (cursorIndex + 1) * this.cursorWidth - 1,
        this.cursorHeight - 1,
        0,
        0,
      );
      core.cursorImage = { width: image.width, height: image.height, hotX, hotY, pixels: image.pixels };

      if (this.draw.front !== this.draw.back) {
        if (!this.draw.noInvalidated) {
          const saved = this.cursorIndex;
          this.cursorIndex = -1;
          this.draw.blitInvalidated();
          this.cursorIndex = saved;
        } else {
          core.showCursor = 3;
        }
      }
    } else {
      this.blit();
      this.cursorX = i16(0);
      this.cursorY = i16(0);
    }

    core.showCursor &= ~1;
    core.touch();
  }
}
