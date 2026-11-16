/**
 * Compositeur graphique SCI2 : la liste des plans et de leurs éléments d'écran, tenue par les fonctions du noyau
 * (`engine/kernel/planes.ts`, `cels.ts`, `palette.ts`), et la composition de l'image à chaque `FrameOut` dans un tampon
 * indexé de 320×200 (`docs/gk1/plan.md`, vague G1).
 *
 * Référence : `engines/sci/graphics/frameout.cpp` de ScummVM (`GfxFrameout::kernelAddPlane`, `kernelUpdatePlane`,
 * `kernelDeletePlane`, `kernelAddScreenItem`, `kernelUpdateScreenItem`, `kernelDeleteScreenItem`, `kernelSetNowSeen`,
 * `kernelIsOnMe`, `isOnMe`, `frameOut`, `calcLists`, `drawEraseList`, `drawScreenItemList`) et `plane32.cpp`
 * (`PlaneList::getTopSciPlanePriority`), GPL v3 ou ultérieure, lus puis réécrits.
 *
 * **Image** : un plan de fond de l'interpréteur couvre l'écran en noir à la priorité 0 ; les plans des scripts se dessinent
 * par priorité croissante. Un plan non transparent efface d'abord son rectangle avec sa couleur `back`, puis ses éléments
 * se dessinent dans l'ordre de `compareScreenItems`, bornés au plan. Un plan de priorité négative, ou entièrement recouvert
 * par un plan non transparent placé au-dessus, n'est pas dessiné et ses palettes ne sont pas fusionnées.
 *
 * Écarts volontaires :
 * - **l'image est entièrement recomposée à chaque `FrameOut`** (`plan.md`, « Architecture ») : ni rectangles sales, ni liste
 *   des plans « visibles » gardée d'une image à l'autre. `OnMe` et `SetNowSeen` lisent donc l'état courant des éléments et
 *   non celui de la dernière image ;
 * - un plan à pic efface lui aussi son rectangle avec `back` (dans l'original, ce que le pic ne couvre pas garde les pixels
 *   de l'image précédente) ;
 * - un plan supprimé disparaît tout de suite avec ses éléments (l'original attend le `FrameOut` suivant) ;
 * - `UpdateScreenItem` sur un objet sans élément d'écran lève une erreur, comme ScummVM, mais un plan introuvable n'est
 *   qu'un avertissement pour les trois fonctions d'éléments ;
 * - la palette et les couleurs de remplacement sont mises à jour **avant** le dessin, comme dans l'original : les palettes
 *   des cels visibles sont fusionnées d'abord, puis les éléments sont dessinés ;
 * - la secousse (`ShakeScreen`) et le curseur ne touchent pas à `screen` : `present` les applique sur une copie, celle que
 *   la page montre ;
 * - pas de loupe (`AddMagnify` : code mort des scripts, que ScummVM ne porte pas non plus ; `engine/kernel/effects.ts`) ;
 * - pas de plan retourné : `mirrored` n'est écrit que par `Plane::drawPic`, à partir du bit 1024 du style, qu'aucun style
 *   du jeu ne porte (`transitions.ts`). Un plan retourné, impossible avec ces scripts, donne un avertissement.
 */
import { OBJECT_PROPERTY } from "../data/script";
import { ResourceType } from "../data/ids";
import { readPalette } from "../data/palette";
import { INFO_VIEW_INSERTED } from "../engine/ids";
import { formatReg, NULL_REG, type Reg, SciError } from "../engine/memory";
import type { SciObject } from "../engine/object";
import type { Vm } from "../engine/vm";
import { type Cel, CelStore, drawCel, readCelPixel } from "./cel";
import { Cursor } from "./cursor";
import { DEFAULT_PALETTE, DEFAULT_PLANE_COLOR, DEFAULT_PLANE_PRIORITY, DISSOLVE_SKIP_COLOR, PLANE_PRIORITY_SYSTEM, PlaneType, SCALE_ONE, SCREEN_HEIGHT, SCREEN_WIDTH } from "./ids";
import { GamePalette } from "./palette";
import { addPicture, comparePlanes, Plane, removePicture, setPlaneFromObject } from "./plane";
import { isEmptyRect, type Rect, rectContains, rectContainsPoint } from "./rect";
import { Remap } from "./remap";
import { calcRects, CelKind, compareScreenItems, itemCel, itemMirrored, nowSeenRect, ScreenItem, setFromObject } from "./screen-item";
import { type GraphicsSelectors, graphicsSelectors, readProperty, writeProperty } from "./selectors";
import { FontStore, TextRenderer } from "./text";
import { type TransitionHost, Transitions } from "./transitions";
import { declareState } from "../engine/save-codec";

export class Frameout implements TransitionHost {
  /** Image composée par le dernier `FrameOut` : 320×200 indices de couleur. */
  readonly screen = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  readonly palette: GamePalette;
  readonly remap: Remap;
  readonly cels: CelStore;
  readonly text: TextRenderer;
  readonly cursor: Cursor;
  readonly transitions: Transitions;
  /** Décalage de l'image à la présentation (`ShakeScreen`), en pixels. */
  shakeX = 0;
  shakeY = 0;
  private readonly presented = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  /** Plans des scripts, du dessous au dessus. */
  readonly planes: Plane[] = [];
  /** Nombre d'images composées. */
  frameCount = 0;
  readonly selectors: GraphicsSelectors;
  private nextCreationId = 1;

  constructor(private readonly vm: Vm) {
    this.palette = new GamePalette(() => vm.ticks);
    this.palette.onWarning = (message) => vm.warn(message);
    this.remap = new Remap(this.palette, (message) => vm.warn(message));
    this.cels = new CelStore(vm.resources, vm.memory.bitmaps);
    this.text = new TextRenderer(new FontStore(vm.resources));
    this.cursor = new Cursor(this.cels);
    this.transitions = new Transitions(this);
    this.selectors = graphicsSelectors(vm.selectors);
    const initial = vm.resources.find(ResourceType.Palette, DEFAULT_PALETTE);
    if (initial) this.palette.submit(readPalette(initial));
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------------------------------------------------------------

  findPlane(object: Reg): Plane | undefined {
    return this.planes.find((plane) => plane.object === object);
  }

  /** `AddPlane` : crée le plan de cet objet, ou le relit s'il existe déjà. */
  addPlane(object: Reg): void {
    let plane = this.findPlane(object);
    if (!plane) this.planes.push((plane = new Plane(object, this.nextCreationId++)));
    this.readPlane(plane);
  }

  /** `UpdatePlane` : relit position, priorité, fond et pic du plan. */
  updatePlane(object: Reg): void {
    const plane = this.findPlane(object);
    if (!plane) throw new SciError(`UpdatePlane : ${this.vm.nameOf(object)} n'est pas un plan connu`);
    this.readPlane(plane);
  }

  /** `DeletePlane` : retire le plan et tous ses éléments. */
  deletePlane(object: Reg): void {
    const index = this.planes.findIndex((plane) => plane.object === object);
    if (index < 0) throw new SciError(`DeletePlane : ${this.vm.nameOf(object)} n'est pas un plan connu`);
    for (const item of this.planes[index].items) this.setInserted(item.object, false);
    this.planes.splice(index, 1);
  }

  /** `GetHighPlanePri` : priorité du plan le plus haut, plans de l'interpréteur exclus. */
  topPlanePriority(): number {
    let priority = DEFAULT_PLANE_PRIORITY;
    for (const plane of this.planes) if (plane.priority < PLANE_PRIORITY_SYSTEM) priority = Math.max(priority, plane.priority);
    return priority;
  }

  private readPlane(plane: Plane): void {
    const created = setPlaneFromObject(plane, this.requireObject(plane.object), this.selectors, this.cels, this.nextCreationId);
    if (created < 0) this.vm.warn(`pic ${plane.pictureId} absent (plan ${this.vm.nameOf(plane.object)})`);
    else this.nextCreationId += created;
    if (plane.mirrored) this.vm.warn("plan retourné (mirrored) non géré");
    this.planes.sort(comparePlanes);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Éléments d'écran
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `AddScreenItem` : crée l'élément d'écran de cet objet dans son plan, ou le relit s'il existe déjà. */
  addScreenItem(object: Reg): void {
    const source = this.requireObject(object);
    this.setInserted(object, true);
    const plane = this.planeOf(source, "AddScreenItem", object);
    if (!plane) return;
    let item = plane.findItem(object);
    if (!item) plane.items.push((item = new ScreenItem(object, this.nextCreationId++)));
    this.readItem(item, source, true);
  }

  /** `UpdateScreenItem` : relit les propriétés graphiques de l'objet. */
  updateScreenItem(object: Reg): void {
    const source = this.requireObject(object);
    const plane = this.planeOf(source, "UpdateScreenItem", object);
    if (!plane) return;
    const item = plane.findItem(object);
    if (!item) throw new SciError(`UpdateScreenItem : ${this.vm.nameOf(object)} n'a pas d'élément d'écran`);
    this.readItem(item, source, readProperty(source, this.selectors.bitmap) !== 0);
  }

  /** `DeleteScreenItem` : retire l'élément d'écran de l'objet, s'il en a un. */
  deleteScreenItem(object: Reg): void {
    const source = this.requireObject(object);
    this.setInserted(object, false);
    const plane = this.findPlane(readProperty(source, this.selectors.plane));
    const index = plane ? plane.items.findIndex((item) => item.object === object) : -1;
    if (index >= 0) plane!.items.splice(index, 1);
  }

  /** Élément d'écran d'un objet et son plan, ou `undefined`. */
  locate(object: Reg): { plane: Plane; item: ScreenItem } | undefined {
    const source = this.vm.memory.getObject(object);
    const plane = source && this.findPlane(readProperty(source, this.selectors.plane));
    const item = plane?.findItem(object);
    return plane && item ? { plane, item } : undefined;
  }

  /**
   * `SetNowSeen` : écrit dans `nsLeft` … `nsBottom` le rectangle occupé par l'objet dans son plan (bords compris).
   * Renvoie faux si l'objet n'a pas d'élément d'écran.
   */
  setNowSeen(object: Reg): boolean {
    const found = this.locate(object);
    if (!found) return false;
    const rect = nowSeenRect(found.item, found.plane, itemCel(found.item, this.cels));
    const target = this.requireObject(object);
    writeProperty(target, this.selectors.nsLeft, rect.left);
    writeProperty(target, this.selectors.nsTop, rect.top);
    writeProperty(target, this.selectors.nsRight, rect.right - 1);
    writeProperty(target, this.selectors.nsBottom, rect.bottom - 1);
    return true;
  }

  /**
   * `OnMe` : le point (`x`, `y`) du plan de l'objet tombe-t-il sur son élément d'écran ? Avec `checkPixel`, seulement si le
   * pixel du cel à cet endroit n'est pas transparent.
   */
  isOnMe(object: Reg, x: number, y: number, checkPixel: boolean): boolean {
    const found = this.locate(object);
    if (!found) return false;
    const { plane, item } = found;
    const cel = itemCel(item, this.cels);
    calcRects(item, plane, cel);
    const screenX = x + plane.gameRect.left;
    const screenY = y + plane.gameRect.top;
    if (!cel || !rectContainsPoint(item.screenRect, screenX, screenY)) return false;
    if (!checkPixel) return true;
    let celX = screenX - item.drawX;
    let celY = screenY - item.drawY;
    if (item.drawScaleX !== SCALE_ONE || item.drawScaleY !== SCALE_ONE) {
      celX = Math.trunc((celX * SCALE_ONE) / item.drawScaleX);
      celY = Math.trunc((celY * SCALE_ONE) / item.drawScaleY);
    }
    const pixel = readCelPixel(cel, celX, celY, itemMirrored(item, cel));
    return pixel !== undefined && pixel !== cel.skipColor;
  }

  private readItem(item: ScreenItem, source: SciObject, updateBitmap: boolean): void {
    setFromObject(item, source, this.selectors, this.cels, true, updateBitmap);
    if (!itemCel(item, this.cels)) this.vm.warn(`${item.kind === CelKind.Bitmap ? "bitmap libéré" : `vue ${item.view} absente ou vide`} (objet ${this.vm.nameOf(item.object)})`);
  }

  private planeOf(source: SciObject, caller: string, object: Reg): Plane | undefined {
    const plane = this.findPlane(readProperty(source, this.selectors.plane));
    if (!plane) this.vm.warn(`${caller} : plan de ${this.vm.nameOf(object)} introuvable`);
    return plane;
  }

  private requireObject(object: Reg): SciObject {
    const source = this.vm.memory.getObject(object);
    if (!source) throw new SciError(`${formatReg(object)} n'est pas un objet graphique`);
    return source;
  }

  private setInserted(object: Reg, inserted: boolean): void {
    const source = this.vm.memory.getObject(object);
    if (!source) return;
    if (inserted) source.vars[OBJECT_PROPERTY.Info] |= INFO_VIEW_INSERTED;
    else source.vars[OBJECT_PROPERTY.Info] &= ~INFO_VIEW_INSERTED;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Image
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Plans à dessiner, du dessous au dessus : ni sous le plan de fond, ni vides, ni recouverts en entier. */
  visiblePlanes(): Plane[] {
    return this.planes.filter(
      (plane, index) =>
        plane.priority >= DEFAULT_PLANE_PRIORITY &&
        !isEmptyRect(plane.screenRect) &&
        !this.planes.some((above, aboveIndex) => aboveIndex > index && above.type !== PlaneType.Transparent && rectContains(above.screenRect, plane.screenRect)),
    );
  }

  /**
   * `FrameOut` : compose l'image dans `screen`. D'abord les palettes des cels visibles, la palette de l'écran (variation,
   * cycles, fondu) et les couleurs de remplacement ; puis le dessin.
   */
  frameOut(): void {
    const planes = this.visiblePlanes();
    const drawn = planes.map((plane) => {
      for (const item of plane.items) calcRects(item, plane, itemCel(item, this.cels));
      const items: [ScreenItem, Cel][] = [];
      for (const item of [...plane.items].sort(compareScreenItems)) {
        const cel = itemCel(item, this.cels);
        if (!cel || isEmptyRect(item.screenRect)) continue;
        if (cel.palette) this.palette.submit(cel.palette);
        items.push([item, cel]);
      }
      return items;
    });
    this.remap.update(this.palette.update());

    this.screen.fill(DEFAULT_PLANE_COLOR);
    planes.forEach((plane, index) => {
      if (plane.type !== PlaneType.Transparent) this.fill(plane.screenRect, plane.back);
      for (const [item, cel] of drawn[index]) {
        drawCel(this.screen, SCREEN_WIDTH, cel, item.screenRect, item.drawX, item.drawY, itemMirrored(item, cel), item.drawScaleX, item.drawScaleY, this.remap);
      }
    });
    this.frameCount++;
  }

  /** Image à montrer : `screen` décalée par la secousse en cours, curseur par-dessus. Le tampon rendu est réutilisé. */
  present(): Uint8Array {
    const out = this.presented;
    if (this.shakeX === 0 && this.shakeY === 0) out.set(this.screen);
    else {
      out.fill(DEFAULT_PLANE_COLOR);
      for (let y = Math.max(this.shakeY, 0); y < SCREEN_HEIGHT; y++) {
        const from = (y - this.shakeY) * SCREEN_WIDTH;
        out.set(this.screen.subarray(from, from + SCREEN_WIDTH - Math.max(this.shakeX, 0)), y * SCREEN_WIDTH + Math.max(this.shakeX, 0));
      }
    }
    this.cursor.draw(out);
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Services des transitions (`TransitionHost`)
  // -------------------------------------------------------------------------------------------------------------------------------

  now(): number {
    return this.vm.ticks;
  }

  warn(message: string): void {
    this.vm.warn(message);
  }

  addPicture(plane: Plane, pictureId: number, x: number, y: number): number {
    const created = addPicture(plane, this.cels, pictureId, this.nextCreationId, x, y);
    if (created < 0) this.vm.warn(`pic ${pictureId} absent (défilement du plan ${this.vm.nameOf(plane.object)})`);
    else this.nextCreationId += created;
    return plane.pictureId;
  }

  replacePicture(plane: Plane, oldPictureId: number, newPictureId: number): void {
    removePicture(plane, oldPictureId);
    plane.pictureId = newPictureId;
    plane.type = PlaneType.Picture;
  }

  captureScreen(plane: Plane, priority: number): Reg {
    const { left, top, right, bottom } = plane.gameRect;
    const width = Math.max(right - left, 0);
    const pixels = new Uint8Array(width * Math.max(bottom - top, 0)).fill(DISSOLVE_SKIP_COLOR);
    const visible = plane.screenRect;
    for (let y = visible.top; y < visible.bottom; y++) {
      pixels.set(this.screen.subarray(y * SCREEN_WIDTH + visible.left, y * SCREEN_WIDTH + visible.right), (y - top) * width + visible.left - left);
    }
    const bitmap = this.vm.memory.bitmaps.allocate({ width, height: width > 0 ? pixels.length / width : 0, skipColor: DISSOLVE_SKIP_COLOR, pixels });
    const item = new ScreenItem(NULL_REG, this.nextCreationId++);
    item.kind = CelKind.Bitmap;
    item.bitmap = bitmap;
    item.priority = priority;
    item.fixedPriority = true;
    plane.items.push(item);
    return bitmap;
  }

  capturePixels(bitmap: Reg): Uint8Array | undefined {
    return this.vm.memory.bitmaps.get(bitmap)?.pixels;
  }

  releaseCapture(planeObject: Reg, bitmap: Reg): void {
    const items = this.findPlane(planeObject)?.items;
    const index = items ? items.findIndex((item) => item.object === NULL_REG && item.bitmap === bitmap) : -1;
    if (index >= 0) items!.splice(index, 1);
    this.vm.memory.bitmaps.release(bitmap);
  }

  private fill(rect: Rect, color: number): void {
    for (let y = rect.top; y < rect.bottom; y++) this.screen.fill(color, y * SCREEN_WIDTH + rect.left, y * SCREEN_WIDTH + rect.right);
  }

  /** Objets des scripts que le compositeur référence : racines du ramasse-miettes. */
  *references(): IterableIterator<Reg> {
    for (const plane of this.planes) {
      yield plane.object;
      for (const item of plane.items) {
        if (item.object !== 0) yield item.object;
        if (item.bitmap !== 0) yield item.bitmap;
      }
    }
    yield* this.transitions.references();
  }
}

const instances = new WeakMap<Vm, Frameout>();

/** Compositeur de cette machine virtuelle, créé au premier appel et déclaré au ramasse-miettes. */
export function frameoutOf(vm: Vm): Frameout {
  let frameout = instances.get(vm);
  if (!frameout) {
    instances.set(vm, (frameout = new Frameout(vm)));
    const created = frameout;
    vm.gcRoots.push(() => created.references());
  }
  return frameout;
}

// État sauvegardé (`engine/save.ts`) : plans, éléments, palette, remaps, transitions et curseur. L'image composée n'en fait pas
// partie : le `FrameOut` suivant la refait en entier, et d'ici là l'écran repris est noir.
declareState(Frameout, {
  name: "Frameout",
  skip: ["vm", "cels", "text", "selectors", "screen", "presented"],
  loaded: (frameout) => frameout.screen.fill(DEFAULT_PLANE_COLOR),
});
