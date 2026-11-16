/**
 * Élément d'écran : une image posée dans un plan (une vue animée par un objet des scripts, ou un cel de pic), avec sa
 * position, sa priorité et son échelle ; calcul de son rectangle à l'écran et de son rectangle « vu » (`SetNowSeen`).
 *
 * Référence : `engines/sci/graphics/screen_item32.cpp` et `screen_item32.h` de ScummVM (`ScreenItem::setFromObject`,
 * `calcRects`, `getNowSeenRect`, `operator<`), GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - **Lecture de l'objet** (`AddScreenItem`, `UpdateScreenItem`) : position, échelle, vue / boucle / cel (ramenés dans la
 *   vue **et réécrits dans l'objet**), priorité fixe ou tirée de `y` (alors réécrite dans `priority`), `z` (retiré de `y`),
 *   rectangle intérieur. La lecture **baisse le bit « à redessiner »** de `-info-` (`INFO_VIEW_VISIBLE`) : les scripts ne
 *   rappellent `UpdateScreenItem` que pour un objet dont une propriété graphique (indices 26 à 44) a changé depuis.
 * - **Rectangle à l'écran** : le cel se pose à `position − ancrage × échelle`, décalé du coin du plan, puis est borné au plan.
 *   L'ancrage x d'un cel retourné est `largeur − ancrage x − 1`.
 * - **Ordre de dessin** : priorité croissante, puis `y` croissant, puis les cels de pics après les objets des scripts, puis
 *   ordre de création.
 *
 * - **Bitmap** : un objet dont la propriété `bitmap` n'est pas nulle montre ce bitmap (un texte) au lieu de sa vue ; à une
 *   mise à jour, une propriété `bitmap` nulle laisse l'élément tel quel.
 *
 * Écarts volontaires : pas d'aplats de couleur (aucun script n'en crée) ; un objet dont la vue manque donne un élément sans image, avec un avertissement (ScummVM s'arrête) ; un seul repère
 * 320×200 (pas de conversion entre résolutions) ; un plan retourné (`mirrored`) n'est pas géré : `frameout.ts` le signale par un
 * avertissement.
 */
import { OBJECT_PROPERTY } from "../data/script";
import { INFO_VIEW_VISIBLE } from "../engine/ids";
import { isNumber, type Reg } from "../engine/memory";
import type { SciObject } from "../engine/object";
import type { Cel, CelStore } from "./cel";
import { SCALE_ONE, SCALE_SIGNAL_MASK, ScaleSignal, SCREEN_WIDTH } from "./ids";
import type { Plane } from "./plane";
import { clipRect, makeRect, type Rect, rectsIntersect, translateRect } from "./rect";
import { type GraphicsSelectors, readProperty, readSigned, readUnsigned, writeProperty } from "./selectors";
import { declareState } from "../engine/save-codec";

export const CelKind = { View: 0, Pic: 1, Bitmap: 2 } as const;
export type CelKind = (typeof CelKind)[keyof typeof CelKind];

export class ScreenItem {
  kind: CelKind = CelKind.View;
  /** Vue, boucle et cel (`View`), ou pic et numéro de cel dans `cel` (`Pic`). */
  view = 0;
  loop = 0;
  cel = 0;
  picture = 0;
  /** Bitmap montré (`Bitmap`). */
  bitmap: Reg = 0;
  /** Position dans le plan (`y` diminué de `z`). */
  x = 0;
  y = 0;
  z = 0;
  priority = 0;
  fixedPriority = false;
  scaleX = SCALE_ONE;
  scaleY = SCALE_ONE;
  maxScale = SCALE_ONE;
  scaleSignal: number = ScaleSignal.None;
  useInsetRect = false;
  inset: Rect = makeRect();
  /** Retournement demandé par l'élément (en plus de celui de la boucle). */
  mirrorX = false;

  /** Résultats de `calcRects` : coin du cel à l'écran, rectangle visible (borné au plan), échelle appliquée. */
  drawX = 0;
  drawY = 0;
  screenRect: Rect = makeRect();
  drawScaleX = SCALE_ONE;
  drawScaleY = SCALE_ONE;

  constructor(
    /** Objet des scripts, ou 0 pour un cel de pic. */
    readonly object: Reg,
    readonly creationId: number,
  ) {}
}

/**
 * Relit les propriétés graphiques de l'objet ; `updateCel` : aussi la vue, la boucle et le cel ; `updateBitmap` : aussi le
 * bitmap, qui l'emporte sur la vue (`AddScreenItem` toujours, `UpdateScreenItem` seulement si la propriété n'est pas nulle).
 */
export function setFromObject(item: ScreenItem, object: SciObject, selectors: GraphicsSelectors, cels: CelStore, updateCel: boolean, updateBitmap = false): void {
  item.x = readSigned(object, selectors.x);
  item.y = readSigned(object, selectors.y);
  item.scaleX = readSigned(object, selectors.scaleX);
  item.scaleY = readSigned(object, selectors.scaleY);
  item.maxScale = readSigned(object, selectors.maxScale);
  item.scaleSignal = readProperty(object, selectors.scaleSignal) & SCALE_SIGNAL_MASK;

  if (updateCel) {
    if (item.kind !== CelKind.Bitmap) item.kind = CelKind.View;
    item.view = readUnsigned(object, selectors.view);
    item.loop = readUnsigned(object, selectors.loop);
    item.cel = readUnsigned(object, selectors.cel);
    const loop = cels.clampLoop(item.view, item.loop);
    if (loop >= 0 && loop !== item.loop) writeProperty(object, selectors.loop, (item.loop = loop));
    const cel = cels.clampCel(item.view, item.loop, item.cel);
    if (cel >= 0 && cel !== item.cel) writeProperty(object, selectors.cel, (item.cel = cel));
  }

  if (updateBitmap) {
    item.bitmap = readProperty(object, selectors.bitmap);
    item.kind = item.bitmap !== 0 ? CelKind.Bitmap : CelKind.View;
  }

  if (readProperty(object, selectors.fixPriority) !== 0) {
    item.fixedPriority = true;
    item.priority = readSigned(object, selectors.priority);
  } else {
    item.fixedPriority = false;
    writeProperty(object, selectors.priority, item.y);
  }
  item.z = readSigned(object, selectors.z);
  item.y -= item.z;

  item.useInsetRect = readProperty(object, selectors.useInsetRect) !== 0;
  if (item.useInsetRect) {
    item.inset = makeRect(
      readSigned(object, selectors.inLeft),
      readSigned(object, selectors.inTop),
      readSigned(object, selectors.inRight) + 1,
      readSigned(object, selectors.inBottom) + 1,
    );
  }
  object.vars[OBJECT_PROPERTY.Info] &= ~INFO_VIEW_VISIBLE;
}

/** Cel montré par l'élément, ou `undefined` si sa ressource manque. */
export function itemCel(item: ScreenItem, cels: CelStore): Cel | undefined {
  if (item.kind === CelKind.Bitmap) return cels.bitmap(item.bitmap);
  return item.kind === CelKind.Pic ? cels.pic(item.picture)?.[item.cel] : cels.viewCel(item.view, item.loop, item.cel);
}

/** Faut-il dessiner le cel retourné ? Un cel de pic ne se retourne pas par sa boucle. */
export function itemMirrored(item: ScreenItem, cel: Cel): boolean {
  return item.mirrorX !== cel.mirrored;
}

/** Échelles `[x, y]` sur 128 ; l'échelle « selon la profondeur » grandit avec la distance au point de fuite du plan. */
function itemScale(item: ScreenItem, plane: Plane): [number, number] {
  if (item.scaleSignal === ScaleSignal.Manual) return [item.scaleX, item.scaleY];
  if (item.scaleSignal === ScaleSignal.VanishingPoint) {
    // Le dénominateur part bien de la largeur du repère, pas de sa hauteur : c'est le calcul de l'original.
    const scale = Math.trunc((item.maxScale * (item.y - plane.vanishingY)) / (SCREEN_WIDTH - plane.vanishingY));
    return [scale, scale];
  }
  return [SCALE_ONE, SCALE_ONE];
}

function scaled(value: number, scale: number): number {
  return Math.trunc((value * scale) / SCALE_ONE);
}

/** Met un rectangle à l'échelle en gardant ses bords droit et bas compris dans l'image réduite. */
function scaleRect(rect: Rect, scaleX: number, scaleY: number): void {
  rect.left = scaled(rect.left, scaleX);
  rect.top = scaled(rect.top, scaleY);
  rect.right = scaled(rect.right - 1, scaleX) + 1;
  rect.bottom = scaled(rect.bottom - 1, scaleY) + 1;
}

/** Rectangle du cel montré (tout le cel, ou son rectangle intérieur), dans le repère du cel. */
function celRect(item: ScreenItem, cel: Cel): Rect {
  const whole = makeRect(0, 0, cel.width, cel.height);
  return item.useInsetRect ? clipRect(item.inset, whole) : whole;
}

function mirroredOriginX(item: ScreenItem, cel: Cel): number {
  return itemMirrored(item, cel) && item.kind !== CelKind.Pic ? cel.width - cel.originX - 1 : cel.originX;
}

/**
 * Rectangle de l'élément dans le plan, à l'échelle, et échelles appliquées ; `undefined` si l'échelle est nulle.
 * Commun à `calcRects` et à `nowSeenRect`.
 */
function placedRect(item: ScreenItem, cel: Cel, plane: Plane): { rect: Rect; x: number; y: number; scaleX: number; scaleY: number } | undefined {
  const [scaleX, scaleY] = itemScale(item, plane);
  if (scaleX === 0 || scaleY === 0) return undefined;
  const rect = celRect(item, cel);
  if (scaleX !== SCALE_ONE || scaleY !== SCALE_ONE) scaleRect(rect, scaleX, scaleY);
  const x = item.x - scaled(mirroredOriginX(item, cel), scaleX);
  const y = item.y - scaled(cel.originY, scaleY);
  translateRect(rect, x, y);
  return { rect, x, y, scaleX, scaleY };
}

/** Calcule où et comment l'élément se dessine dans son plan ; fixe sa priorité si elle suit `y`. */
export function calcRects(item: ScreenItem, plane: Plane, cel: Cel | undefined): void {
  if (!item.fixedPriority) item.priority = item.z + item.y;
  item.screenRect = makeRect();
  const placed = cel && placedRect(item, cel, plane);
  if (!placed) return;
  translateRect(placed.rect, plane.gameRect.left, plane.gameRect.top);
  item.drawX = placed.x + plane.gameRect.left;
  item.drawY = placed.y + plane.gameRect.top;
  item.drawScaleX = placed.scaleX;
  item.drawScaleY = placed.scaleY;
  if (rectsIntersect(placed.rect, plane.screenRect)) item.screenRect = clipRect(placed.rect, plane.screenRect);
}

/** Rectangle occupé par l'élément dans le repère de son plan (non borné) : ce que `SetNowSeen` écrit dans l'objet. */
export function nowSeenRect(item: ScreenItem, plane: Plane, cel: Cel | undefined): Rect {
  return (cel && placedRect(item, cel, plane)?.rect) || makeRect();
}

/** Ordre de dessin : négatif si `a` se dessine avant `b` (donc dessous). */
export function compareScreenItems(a: ScreenItem, b: ScreenItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const depth = a.y + a.z - (b.y + b.z);
  if (depth !== 0) return depth;
  // À égalité, un cel de pic (sans objet) passe après un objet des scripts.
  if (isNumber(a.object) !== isNumber(b.object)) return isNumber(b.object) ? -1 : 1;
  return a.creationId - b.creationId;
}

// État sauvegardé (`engine/save.ts`).
declareState(ScreenItem, { name: "ScreenItem", create: (fields) => new ScreenItem(fields.object as Reg, fields.creationId as number) });
