/**
 * Plan : une fenêtre de l'écran, avec son fond (pic, couleur unie ou transparent), sa priorité et ses éléments d'écran.
 *
 * Référence : `engines/sci/graphics/plane32.cpp` et `plane32.h` de ScummVM (`Plane::Plane`, `setType`, `update`,
 * `changePic`, `addPicInternal`, `operator<`), GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - **Rectangle** : `inLeft`, `inTop`, `inRight`, `inBottom` de l'objet, bords droit et bas compris ; les éléments du plan
 *   sont placés par rapport à son coin haut gauche et ne débordent pas.
 * - **Fond** selon `picture` : un numéro de pic (jusqu'à 65 531) ; −1 : couleur unie `back` ; −2 : transparent (les plans
 *   de dessous restent visibles) ; −3 : opaque.
 * - **Pic** : chacun de ses cels devient un élément d'écran sans objet, à sa position dans le pic et à sa priorité fixe
 *   (−1000 pour le fond, les avant-plans masquent les acteurs de priorité plus petite).
 * - **Ordre** : priorité croissante, puis ordre de création. Un plan de priorité négative est sous le plan de fond de
 *   l'interpréteur, donc invisible (`frameout.ts`).
 *
 * Écarts volontaires : le pic d'un plan est remplacé dès `UpdatePlane` (ScummVM attend le `FrameOut` suivant : même image,
 * rien ne lit les cels du pic entre-temps) ; un pic absent laisse le plan vide, avec un avertissement.
 */
import { type Reg, NULL_REG } from "../engine/memory";
import type { SciObject } from "../engine/object";
import type { CelStore } from "./cel";
import { PLANE_PIC_COLORED, PLANE_PIC_MAX, PLANE_PIC_OPAQUE, PLANE_PIC_TRANSPARENT, PlaneType, SCREEN_HEIGHT, SCREEN_WIDTH } from "./ids";
import { clipRect, makeRect, type Rect } from "./rect";
import { CelKind, ScreenItem } from "./screen-item";
import { type GraphicsSelectors, readProperty, readSigned, readUnsigned } from "./selectors";
import { declareState } from "../engine/save-codec";

const SCREEN_RECT: Readonly<Rect> = makeRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

export class Plane {
  priority = 0;
  /** Rectangle du plan dans le repère des scripts, et sa partie à l'écran. */
  gameRect: Rect = makeRect();
  screenRect: Rect = makeRect();
  back = 0;
  pictureId: number = PLANE_PIC_COLORED;
  type: PlaneType = PlaneType.Colored;
  vanishingX = 0;
  vanishingY = 0;
  mirrored = false;
  /** Éléments d'écran, dans l'ordre de leur ajout (triés au dessin). */
  readonly items: ScreenItem[] = [];

  constructor(
    readonly object: Reg,
    readonly creationId: number,
  ) {}

  findItem(object: Reg): ScreenItem | undefined {
    return this.items.find((item) => item.object === object);
  }
}

function planeType(pictureId: number): PlaneType {
  if (pictureId === PLANE_PIC_COLORED) return PlaneType.Colored;
  if (pictureId === PLANE_PIC_TRANSPARENT) return PlaneType.Transparent;
  if (pictureId === PLANE_PIC_OPAQUE) return PlaneType.Opaque;
  return PlaneType.Picture;
}

/**
 * Relit les propriétés du plan ; `nextCreationId` numérote les éléments créés pour un nouveau pic. Renvoie le nombre
 * d'éléments créés, ou −1 si le pic demandé manque.
 */
export function setPlaneFromObject(plane: Plane, object: SciObject, selectors: GraphicsSelectors, cels: CelStore, nextCreationId: number): number {
  plane.vanishingX = readSigned(object, selectors.vanishingX);
  plane.vanishingY = readSigned(object, selectors.vanishingY);
  plane.gameRect = makeRect(
    readSigned(object, selectors.inLeft),
    readSigned(object, selectors.inTop),
    readSigned(object, selectors.inRight) + 1,
    readSigned(object, selectors.inBottom) + 1,
  );
  plane.screenRect = clipRect(plane.gameRect, SCREEN_RECT);
  plane.priority = readSigned(object, selectors.priority);
  plane.back = readProperty(object, selectors.back) & 0xff;
  plane.mirrored = readProperty(object, selectors.mirrored) !== 0;
  const pictureId = readUnsigned(object, selectors.picture);
  const changed = pictureId !== plane.pictureId || plane.type !== planeType(pictureId);
  plane.pictureId = pictureId;
  plane.type = planeType(pictureId);
  return changed ? changePicture(plane, cels, nextCreationId) : 0;
}

/** Remplace les éléments du pic précédent par ceux du pic courant. */
function changePicture(plane: Plane, cels: CelStore, nextCreationId: number): number {
  for (let i = plane.items.length - 1; i >= 0; i--) if (plane.items[i].kind === CelKind.Pic) plane.items.splice(i, 1);
  if (plane.type !== PlaneType.Picture || plane.pictureId > PLANE_PIC_MAX) return 0;
  return addPicture(plane, cels, plane.pictureId, nextCreationId);
}

/**
 * Ajoute au plan les cels du pic `pictureId`, décalés de (`x`, `y`) (défilement), après avoir retiré ceux qu'il en avait
 * déjà. Renvoie le nombre d'éléments créés, ou −1 si le pic manque. Le pic du plan (`pictureId`) ne change pas.
 */
export function addPicture(plane: Plane, cels: CelStore, pictureId: number, nextCreationId: number, x = 0, y = 0): number {
  removePicture(plane, pictureId);
  const picture = cels.pic(pictureId);
  if (!picture) return -1;
  picture.forEach((cel, index) => {
    const item = new ScreenItem(NULL_REG, nextCreationId + index);
    item.kind = CelKind.Pic;
    item.picture = pictureId;
    item.cel = index;
    item.x = cel.x + x;
    item.y = cel.y + y;
    item.priority = cel.priority;
    item.fixedPriority = true;
    plane.items.push(item);
  });
  return picture.length;
}

/** Retire du plan les cels du pic `pictureId`. */
export function removePicture(plane: Plane, pictureId: number): void {
  for (let i = plane.items.length - 1; i >= 0; i--) if (plane.items[i].kind === CelKind.Pic && plane.items[i].picture === pictureId) plane.items.splice(i, 1);
}

/** Ordre des plans : négatif si `a` est sous `b`. */
export function comparePlanes(a: Plane, b: Plane): number {
  return a.priority !== b.priority ? a.priority - b.priority : a.creationId - b.creationId;
}

// État sauvegardé (`engine/save.ts`).
declareState(Plane, { name: "Plane", create: (fields) => new Plane(fields.object as Reg, fields.creationId as number) });
