import type { SceneryLoadArgs, VmContext } from "../host";
import { BACK_SURFACE, s16 } from "../graphics/core";
import type { DrawImpl } from "../graphics/draw";

const SCENERY_COUNT = 10;
const SPRITE_SLOTS = 20;
/** Entrée « pas de rectangle » de toRedrawLeft. */
export const NO_REDRAW = -12345;

const s8 = (v: number): number => (v << 24) >> 24;

interface Piece {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface StaticPlane {
  pictIndex: number;
  pieceIndex: number;
  drawOrder: number;
  destX: number;
  destY: number;
  transp: number;
}

interface StaticLayer {
  backResId: number;
  planes: StaticPlane[];
}

interface Static {
  layers: StaticLayer[];
  pieces: Piece[][];
}

interface AnimFramePiece {
  pictIndex: number;
  pieceIndex: number;
  destX: number;
  destY: number;
  notFinal: number;
}

export interface AnimLayer {
  unknown0: number;
  posX: number;
  posY: number;
  animDeltaX: number;
  animDeltaY: number;
  transp: number;
  framesCount: number;
  frames: AnimFramePiece[];
}

interface Animation {
  layers: AnimLayer[];
  pieces: Piece[][];
}

/** Zone d'animation courante de Mult (_animLeft…), lue par updateAnim. */
export interface AnimBounds {
  readonly animLeft: number;
  readonly animTop: number;
  readonly animWidth: number;
  readonly animHeight: number;
}

/** Scenery_v2 : décors statiques (fond + plans) et animations (couches d'images), dessinés sur le fond. */
export class Scenery {
  curStatic = 0;
  curStaticLayer = 0;
  /** Ordre de dessin maximal (40 dans Gobliins 2/3, 100 ailleurs ; Lost in Time suit la valeur par défaut). */
  readonly maxDrawOrder = 100;

  toRedrawLeft = 0;
  toRedrawRight = 0;
  toRedrawTop = 0;
  toRedrawBottom = 0;

  animTop = 0;
  animLeft = 0;
  animBottom = 0;
  animRight = 0;

  private readonly spriteRefs = new Array<number>(SPRITE_SLOTS).fill(0);
  private readonly spriteResId = new Array<number>(SPRITE_SLOTS).fill(0);
  private readonly staticPictCount = new Array<number>(SCENERY_COUNT).fill(0);
  private readonly staticResId = new Array<number>(SCENERY_COUNT).fill(0);
  private readonly animPictCount = new Array<number>(SCENERY_COUNT).fill(0);
  private readonly animResId = new Array<number>(SCENERY_COUNT).fill(0);
  private readonly staticPictToSprite = new Array<number>(SCENERY_COUNT * 7).fill(0);
  private readonly animPictToSprite = new Array<number>(SCENERY_COUNT * 7).fill(0);
  private readonly statics: (Static | null)[] = new Array(SCENERY_COUNT).fill(null);
  private readonly animations: (Animation | null)[] = new Array(SCENERY_COUNT).fill(null);

  constructor(
    private readonly draw: DrawImpl,
    private readonly bounds: AnimBounds,
    private readonly getVm: () => VmContext,
  ) {}

  /** Scenery::init (début de chaque TOT) : oublie les décors sans libérer leurs sprites, comme l'original. */
  init(): void {
    for (let i = 0; i < SCENERY_COUNT; i++) {
      this.animPictCount[i] = 0;
      this.staticPictCount[i] = -1;
    }
    this.spriteRefs.fill(0);
    this.spriteResId.fill(-1);
    this.curStaticLayer = -1;
    this.curStatic = -1;
  }

  // --- chargement ---

  /** Libère un emplacement de sprite et le désigne comme vide. */
  private releaseSprite(spr: number): void {
    this.spriteRefs[spr]--;
    if (this.spriteRefs[spr] === 0) {
      this.draw.freeSprite(spr);
      this.spriteResId[spr] = -1;
    }
  }

  /** Emplacement du sprite portant la ressource `sprResId` ; le charge dans un emplacement libre sinon. */
  private acquireSprite(sprResId: number, width: number, height: number): number {
    let spr = this.spriteResId.indexOf(sprResId);
    if (spr >= 0) {
      this.spriteRefs[spr]++;
      return spr;
    }
    for (spr = SPRITE_SLOTS - 1; spr > 0 && this.draw.sprites[spr]; spr--);
    this.spriteRefs[spr] = 1;
    this.spriteResId[spr] = sprResId;
    this.draw.initSpriteSurf(spr, width, height);
    this.draw.loadSprite(sprResId, spr, 0, 0, 0);
    return spr;
  }

  private loadPieces(pictDescId: number): Piece[] {
    const res = this.getVm().resources?.getResource(pictDescId & 0xffff);
    if (!res) return [];
    const view = new DataView(res.data.buffer, res.data.byteOffset, res.data.byteLength);
    const count = Math.trunc(res.data.length / 8);
    const pieces: Piece[] = [];
    for (let i = 0; i < count; i++) {
      pieces.push({
        left: view.getInt16(i * 8, true),
        right: view.getInt16(i * 8 + 2, true),
        top: view.getInt16(i * 8 + 4, true),
        bottom: view.getInt16(i * 8 + 6, true),
      });
    }
    return pieces;
  }

  /** Scenery::loadStatic. Retourne l'emplacement + 100 (chargé ici), l'emplacement seul (déjà chargé) ou 0 (échec). */
  loadStatic(args: SceneryLoadArgs): number {
    let index = args.index;
    if (args.search) {
      for (let i = 0; i < SCENERY_COUNT; i++) {
        if (this.staticPictCount[i] !== -1 && this.staticResId[i] === args.resId) return i;
        if (this.staticPictCount[i] === -1 && i < index) index = i;
      }
    }
    if (index < 0 || index >= SCENERY_COUNT) return 0;

    const res = this.getVm().resources?.getResource(args.resId & 0xffff);
    if (!res) return 0;
    this.staticPictCount[index] = args.picsCount;
    this.staticResId[index] = args.resId;

    const data = res.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const layersCount = view.getInt16(0, true);
    const layers: StaticLayer[] = [];
    for (let i = 0; i < layersCount; i++) {
      let p = view.getUint16(2 + i * 2, true);
      p += 2; // backResId de la ressource, remplacé par celui du script
      const planeCount = view.getInt16(p, true);
      p += 2;
      const planes: StaticPlane[] = [];
      for (let j = 0; j < planeCount; j++, p += 8) {
        planes.push({
          pictIndex: data[p],
          pieceIndex: data[p + 1],
          drawOrder: data[p + 2],
          destX: view.getInt16(p + 3, true),
          destY: view.getInt16(p + 5, true),
          transp: s8(data[p + 7]),
        });
      }
      layers.push({ backResId: args.backs[i] ?? -1, planes });
    }

    const pieces: Piece[][] = [];
    for (let i = 0; i < args.picsCount; i++) {
      const pic = args.pics[i];
      pieces.push(this.loadPieces(pic.pictDescId));
      this.staticPictToSprite[7 * index + i] = this.acquireSprite(pic.sprResId, pic.width, pic.height);
    }
    this.statics[index] = { layers, pieces };
    return index + 100;
  }

  /** Scenery::loadAnim (Scenery_v2 : sans attente du CD). */
  loadAnim(args: SceneryLoadArgs): number {
    let index = args.index;
    if (args.search) {
      index = SCENERY_COUNT;
      for (let i = 0; i < SCENERY_COUNT; i++) {
        if (this.animPictCount[i] !== 0 && this.animResId[i] === args.resId) return i;
        if (this.animPictCount[i] === 0 && i < index) index = i;
      }
    }
    if (index < 0 || index >= SCENERY_COUNT) return 0;

    const res = this.getVm().resources?.getResource(args.resId & 0xffff);
    if (!res) return 0;
    this.animPictCount[index] = args.picsCount;
    this.animResId[index] = args.resId;

    const data = res.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const layersCount = view.getInt16(0, true);
    const layers: AnimLayer[] = [];
    for (let i = 0; i < layersCount; i++) {
      let p = view.getUint16(2 + i * 2, true);
      const layer: AnimLayer = {
        unknown0: view.getInt16(p, true),
        posX: view.getInt16(p + 2, true),
        posY: view.getInt16(p + 4, true),
        animDeltaX: view.getInt16(p + 6, true),
        animDeltaY: view.getInt16(p + 8, true),
        transp: s8(data[p + 10]),
        framesCount: view.getInt16(p + 11, true),
        frames: [],
      };
      p += 13;
      // Chaque image est une suite de morceaux de 5 octets, le dernier ayant notFinal != 1.
      let pieceCount = 0;
      let q = p;
      for (let j = 0; j < layer.framesCount; j++) {
        q += 4;
        while (q < data.length && data[q] === 1) {
          pieceCount++;
          q += 5;
        }
        q++;
        pieceCount++;
      }
      for (let j = 0; j < pieceCount && p + 5 <= data.length; j++, p += 5) {
        layer.frames.push({
          pictIndex: data[p],
          pieceIndex: data[p + 1],
          destX: s8(data[p + 2]),
          destY: s8(data[p + 3]),
          notFinal: s8(data[p + 4]),
        });
      }
      layers.push(layer);
    }

    const pieces: Piece[][] = [];
    for (let i = 0; i < args.picsCount; i++) {
      const pic = args.pics[i];
      pieces.push(this.loadPieces(pic.pictDescId));
      this.animPictToSprite[7 * index + i] = this.acquireSprite(pic.sprResId, pic.width, pic.height);
    }
    this.animations[index] = { layers, pieces };
    return index + 100;
  }

  freeStatic(index: number): void {
    if (index < 0 || index >= SCENERY_COUNT || this.staticPictCount[index] === -1) return;
    for (let i = 0; i < this.staticPictCount[index]; i++) this.releaseSprite(this.staticPictToSprite[index * 7 + i]);
    this.statics[index] = null;
    this.staticPictCount[index] = -1;
  }

  freeAnim(index: number): void {
    if (index < 0 || index >= SCENERY_COUNT || this.animPictCount[index] === 0) return;
    for (let i = 0; i < this.animPictCount[index]; i++) this.releaseSprite(this.animPictToSprite[index * 7 + i]);
    this.animations[index] = null;
    this.animPictCount[index] = 0;
  }

  // --- accès ---

  getStaticLayersCount(index: number): number {
    return this.statics[index]?.layers.length ?? 0;
  }

  getAnimLayersCount(index: number): number {
    return this.animations[index]?.layers.length ?? 0;
  }

  getAnimLayer(index: number, layer: number): AnimLayer | null {
    return this.animations[index]?.layers[layer] ?? null;
  }

  // --- dessin des décors ---

  /** Scenery::renderStatic : fond de la couche, puis ses plans par ordre de dessin. */
  renderStatic(scenery: number, layer: number): void {
    const stat = this.statics[scenery];
    if (!stat || layer >= stat.layers.length || layer < 0) return;
    const layerPtr = stat.layers[layer];
    const draw = this.draw;

    if (layerPtr.backResId !== -1) draw.loadSprite(layerPtr.backResId, BACK_SURFACE, 0, 0, 0);

    for (let order = 0; order < this.maxDrawOrder; order++) {
      for (const plane of layerPtr.planes) {
        if (plane.drawOrder !== order) continue;
        const pictIndex = (plane.pictIndex - 1) & 0xffff;
        if (pictIndex >= this.staticPictCount[scenery]) continue;
        const piece = stat.pieces[pictIndex]?.[plane.pieceIndex];
        if (!piece) continue;
        draw.copySprite(
          this.staticPictToSprite[scenery * 7 + pictIndex],
          BACK_SURFACE,
          piece.left,
          piece.top,
          piece.right - piece.left + 1,
          piece.bottom - piece.top + 1,
          plane.destX,
          plane.destY,
          plane.transp ? 3 : 0,
        );
      }
    }
  }

  /** Scenery::updateStatic(orderFrom, index, layer) : redessine les plans d'ordre >= orderFrom dans toRedraw. */
  private updateStaticLayer(orderFrom: number, index: number, layer: number): void {
    index &= 0xff;
    layer &= 0xff;
    const stat = index < SCENERY_COUNT ? this.statics[index] : null;
    if (!stat || layer >= stat.layers.length) return;
    const layerPtr = stat.layers[layer];

    for (let order = orderFrom; order < this.maxDrawOrder; order++) {
      for (const plane of layerPtr.planes) {
        if (plane.drawOrder !== order) continue;
        const pictIndex = (plane.pictIndex - 1) & 0xffff;
        if (pictIndex >= this.staticPictCount[index]) continue;
        const piece = stat.pieces[pictIndex]?.[plane.pieceIndex];
        if (!piece) continue;

        let destX = plane.destX;
        let destY = plane.destY;
        let left = piece.left;
        let top = piece.top;
        if (destX > this.toRedrawRight) continue;
        if (destY > this.toRedrawBottom) continue;
        if (destX < this.toRedrawLeft) {
          left += this.toRedrawLeft - destX;
          destX = this.toRedrawLeft;
        }
        if (destY < this.toRedrawTop) {
          top += this.toRedrawTop - destY;
          destY = this.toRedrawTop;
        }
        let width = piece.right - left + 1;
        let height = piece.bottom - top + 1;
        if (width <= 0 || height <= 0) continue;
        if (destX + width - 1 > this.toRedrawRight) width = this.toRedrawRight - destX + 1;
        if (destY + height - 1 > this.toRedrawBottom) height = this.toRedrawBottom - destY + 1;

        this.draw.copySprite(
          this.staticPictToSprite[index * 7 + pictIndex],
          BACK_SURFACE,
          left,
          top,
          width,
          height,
          destX,
          destY,
          plane.transp ? 3 : 0,
        );
      }
    }
  }

  /** Scenery::updateStatic(orderFrom) : redessine le décor courant (ou les 10000+n premiers). */
  updateStatic(orderFrom: number): void {
    if (this.curStatic === -1) return;
    if (this.curStatic < 10000) {
      this.updateStaticLayer(orderFrom, this.curStatic & 0xff, this.curStaticLayer & 0xff);
      if (this.curStatic & 0xff00) {
        this.updateStaticLayer(orderFrom, ((this.curStatic >> 8) & 0xff) - 1, (this.curStaticLayer >> 8) & 0xff);
      }
    } else {
      for (let i = 0; i < this.curStatic - 10000; i++) this.updateStaticLayer(orderFrom, i, 0);
    }
  }

  // --- animations ---

  /**
   * Scenery::updateAnim : dessine (ou seulement mesure, `doDraw` faux) l'image `frame` de la couche.
   * flags & 1 : capture la zone ; & 2 : limite à la zone d'animation ; & 4 : limite à toRedraw ;
   * sans & 4, calcule le rectangle occupé dans toRedraw / anim.
   * Les animations négatives (vidéos d'objets) n'existent pas dans Lost in Time.
   */
  updateAnim(layer: number, frame: number, animation: number, flags: number, drawDeltaX: number, drawDeltaY: number, doDraw: boolean): void {
    layer = s16(layer);
    frame = s16(frame);
    animation = s16(animation);
    flags = s16(flags);
    drawDeltaX = s16(drawDeltaX);
    drawDeltaY = s16(drawDeltaY);

    if (animation < 0 || animation >= SCENERY_COUNT) return;
    const anim = this.animations[animation];
    if (this.animPictCount[animation] === 0 || !anim || layer < 0) return;
    if (layer >= anim.layers.length) return;
    const layerPtr = anim.layers[layer];
    if (frame >= layerPtr.framesCount) return;

    const vm = this.getVm();
    if (flags & 1) {
      this.updateAnim(layer, frame, animation, 0, drawDeltaX, drawDeltaY, false);
      if (this.toRedrawLeft === NO_REDRAW) return;
      this.draw.capturePush(
        this.toRedrawLeft,
        this.toRedrawTop,
        this.toRedrawRight - this.toRedrawLeft + 1,
        this.toRedrawBottom - this.toRedrawTop + 1,
      );
      vm.captureCounter++;
    }

    // Première pièce de l'image demandée.
    let p = 0;
    const frames = layerPtr.frames;
    for (let i = 0; i < frame; i++, p++) while (frames[p] && frames[p].notFinal === 1) p++;

    const b = this.bounds;
    if (flags & 4) {
      this.toRedrawLeft = Math.max(this.toRedrawLeft, b.animLeft);
      this.toRedrawTop = Math.max(this.toRedrawTop, b.animTop);
      this.toRedrawRight = Math.min(this.toRedrawRight, b.animLeft + b.animWidth - 1);
      this.toRedrawBottom = Math.min(this.toRedrawBottom, b.animTop + b.animHeight - 1);
    } else {
      this.toRedrawLeft = NO_REDRAW;
    }

    const transp = layerPtr.transp ? 3 : 0;
    for (; p < frames.length; p++) {
      const piece = frames[p];
      let destX = piece.destX;
      let destY = piece.destY;
      const highX = (piece.pictIndex & 0xc0) >> 6;
      const highY = (piece.pictIndex & 0x30) >> 4;
      destX += destX >= 0 ? highX << 7 : -(highX << 7);
      destY += destY >= 0 ? highY << 7 : -(highY << 7);
      destX += drawDeltaX === 1000 ? layerPtr.posX : drawDeltaX;
      destY += drawDeltaY === 1000 ? layerPtr.posY : drawDeltaY;

      const pictIndex = ((piece.pictIndex & 15) - 1) & 0xffff;
      if (pictIndex < this.animPictCount[animation]) {
        const desc = anim.pieces[pictIndex]?.[piece.pieceIndex];
        if (desc) this.drawAnimPiece(desc, animation, pictIndex, flags, transp, destX, destY, doDraw);
      }
      if (piece.notFinal !== 1) break;
    }
  }

  /** Corps de la boucle de updateAnim : découpe d'un morceau, dessin, mise à jour des rectangles. */
  private drawAnimPiece(desc: Piece, animation: number, pictIndex: number, flags: number, transp: number, destX: number, destY: number, doDraw: boolean): void {
    const b = this.bounds;
    let { left, right, top, bottom } = desc;

    if (flags & 2) {
      if (destX < b.animLeft) {
        left += b.animLeft - destX;
        destX = b.animLeft;
      }
      if (left <= right && destX + right - left >= b.animLeft + b.animWidth) {
        right -= destX + right - left - (b.animLeft + b.animWidth) + 1;
      }
      if (destY < b.animTop) {
        top += b.animTop - destY;
        destY = b.animTop;
      }
      if (top <= bottom && destY + bottom - top >= b.animTop + b.animHeight) {
        bottom -= destY + bottom - top - (b.animTop + b.animHeight) + 1;
      }
    } else if (flags & 4) {
      if (destX < this.toRedrawLeft) {
        left += this.toRedrawLeft - destX;
        destX = this.toRedrawLeft;
      }
      if (left <= right && destX + right - left > this.toRedrawRight) right -= destX + right - left - this.toRedrawRight;
      if (destY < this.toRedrawTop) {
        top += this.toRedrawTop - destY;
        destY = this.toRedrawTop;
      }
      if (top <= bottom && destY + bottom - top > this.toRedrawBottom) bottom -= destY + bottom - top - this.toRedrawBottom;
    }

    if (left > right || top > bottom) return;

    if (doDraw) {
      this.draw.copySprite(
        this.animPictToSprite[animation * 7 + pictIndex],
        BACK_SURFACE,
        left,
        top,
        right - left + 1,
        bottom - top + 1,
        destX,
        destY,
        transp,
      );
    }

    if (!(flags & 4)) {
      if (this.toRedrawLeft === NO_REDRAW) {
        this.toRedrawLeft = this.animLeft = destX;
        this.toRedrawTop = this.animTop = destY;
        this.toRedrawRight = this.animRight = destX + right - left;
        this.toRedrawBottom = this.animBottom = destY + bottom - top;
      } else {
        this.toRedrawLeft = Math.min(this.toRedrawLeft, destX);
        this.toRedrawTop = Math.min(this.toRedrawTop, destY);
        this.toRedrawRight = Math.max(this.toRedrawRight, destX + right - left);
        this.toRedrawBottom = Math.max(this.toRedrawBottom, destY + bottom - top);
      }
    }
  }
}
