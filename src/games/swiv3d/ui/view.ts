/**
 * Passage du monde (unités Q8 de l'exe, angles de 512 pas) à la vue du rendu (`RenderView`, unités monde en flottants).
 *
 * Conventions : le cap 0 regarde vers +z et 128 vers +x, dans le monde comme dans le rendu. L'élévation du rendu (`pitch`) est
 * **positive vers le bas** (`view[4]` du jeu) : la caméra du monde ne donne pas d'angles mais un œil et un point visé lissés, d'où
 * `cameraToRender`, qui en déduit cap et élévation comme `gm_render_view` (`f = normalize(visé - œil)`).
 */
import type { Camera } from "../engine/camera";
import type { GameObject } from "../engine/objects";
import type { World } from "../engine/world";
import { WORLD_SIZE, type RenderCamera, type RenderObject, type RenderView } from "../render/view";

export const ANGLE_STEPS = 512;
const RAD_TO_STEP = ANGLE_STEPS / (2 * Math.PI);
/** Q8 -> unités monde. */
const UNIT = 1 / 256;

/** Ce que la conversion lit de la caméra du monde (`Camera` en est un sur-ensemble). */
export type CameraState = Pick<Camera, "eyeX" | "eyeY" | "eyeZ" | "aimX" | "aimY" | "aimZ" | "roll">;

/** Écart signé le plus court entre deux coordonnées du tore, en unités monde (flottants, contrairement à `wrapDelta`). */
export function torusDelta(d: number): number {
  return d - Math.round(d / WORLD_SIZE) * WORLD_SIZE;
}

/** Replie une coordonnée dans `[0, WORLD_SIZE[`. */
export function wrapCoordinate(v: number): number {
  return ((v % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
}

/** Cap (pas de 1/512 de tour, dans `[0, 512[`) et élévation (positive vers le bas) du vecteur `(dx, dy, dz)`. */
export function lookAngles(dx: number, dy: number, dz: number): { yaw: number; pitch: number } {
  const horizontal = Math.hypot(dx, dz);
  const yaw = horizontal === 0 ? 0 : Math.atan2(dx, dz) * RAD_TO_STEP;
  const pitch = Math.atan2(-dy, horizontal) * RAD_TO_STEP;
  return { yaw: ((yaw % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS, pitch };
}

/** Caméra de poursuite du monde (œil et point visé lissés) -> caméra du rendu. L'œil est replié dans le tore, le cap suit la couture. */
export function cameraToRender(camera: CameraState): RenderCamera {
  const { yaw, pitch } = lookAngles(
    torusDelta(camera.aimX - camera.eyeX),
    camera.aimY - camera.eyeY,
    torusDelta(camera.aimZ - camera.eyeZ),
  );
  return {
    x: wrapCoordinate(camera.eyeX),
    y: camera.eyeY,
    z: wrapCoordinate(camera.eyeZ),
    yaw,
    pitch,
    roll: camera.roll,
  };
}

/** Un objet du monde est-il à dessiner ? Seuls les modèles 3D (emplacement 1..9999) : 0 = rien, 10000 et plus = sprite (viendra avec H1). */
export function isDrawable(o: Pick<GameObject, "classe" | "model">): boolean {
  return o.classe !== 0 && o.model > 0 && o.model < 10000;
}

/** Remplit `out` avec la pose de rendu d'un objet (positions Q8 -> unités monde ; angles inchangés, le rendu les replie). */
export function objectToRender(o: GameObject, out: RenderObject): RenderObject {
  out.modelId = o.model;
  out.x = o.x * UNIT;
  out.y = o.y * UNIT;
  out.z = o.z * UNIT;
  out.yaw = o.yaw;
  out.pitch = o.pitch;
  out.roll = o.roll;
  return out;
}

const blankObject = (): RenderObject => ({ modelId: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });

/**
 * Construit la vue de chaque image sans allouer : les `RenderObject` et le tableau sont réutilisés d'une image à l'autre (la vue
 * renvoyée n'est valable que jusqu'à l'appel suivant).
 */
export class ViewBuilder {
  private readonly pool: RenderObject[] = [];
  private readonly objects: RenderObject[] = [];
  private readonly view: RenderView = { camera: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, objects: this.objects, sprites: [], time: 0 };

  build(world: World): RenderView {
    const objects = this.objects;
    objects.length = 0;
    for (const o of world.liveObjects()) {
      if (!isDrawable(o)) continue;
      const slot = (this.pool[objects.length] ??= blankObject());
      objects.push(objectToRender(o, slot));
    }
    this.view.camera = cameraToRender(world.camera);
    this.view.time = world.tickCount;
    return this.view;
  }
}
