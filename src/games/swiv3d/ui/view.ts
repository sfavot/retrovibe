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
import type { Effect } from "../engine/effects";
import { WORLD_SIZE, type RenderCamera, type RenderObject, type RenderSprite, type RenderView } from "../render/view";

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

/** Un objet du monde est-il un modèle 3D à dessiner ? Emplacement 1..9999 : 0 = rien, 10000 à 10999 = balle (sprite 505), 11000 et plus = effet (sprite 504). */
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

/** Premier et dernier modèle des balles : sprites 21×35 de `GLOBAL 505`, série `modèle - 10000` (6 séries). */
export const BULLET_MODEL_FIRST = 10000;
export const BULLET_MODEL_LAST = 10005;

/** Demi-tailles monde des sprites 504 par `modèle - 11000` (table `0x481014` : `W[slot - 11000]`, `render.md` §9). */
export const EFFECT_HALF_SIZES: readonly number[] = [15, 10, 35, 40, 23];

/** Un objet du pool est-il une balle (sprite 505) ? Les explosions (modèle ≥ 11000) passent par `world.effects()`, jamais par ici. */
export function isBullet(o: Pick<GameObject, "classe" | "model">): boolean {
  return o.classe !== 0 && o.model >= BULLET_MODEL_FIRST && o.model <= BULLET_MODEL_LAST;
}

/** Sprite 505 d'une balle : la série est `modèle - 10000`. */
export function bulletToSprite(o: GameObject, out: RenderSprite): RenderSprite {
  out.setId = 505;
  out.frame = o.model - BULLET_MODEL_FIRST;
  out.x = o.x * UNIT;
  out.y = o.y * UNIT;
  out.z = o.z * UNIT;
  out.size = undefined;
  return out;
}

/** Sprite 504 d'une explosion, d'un éclat ou d'une fumée (`Effect` : position Q8, image `+0x50`, série de taille). */
export function effectToSprite(e: Effect, out: RenderSprite): RenderSprite {
  out.setId = e.set;
  out.frame = e.frame;
  out.x = e.x * UNIT;
  out.y = e.y * UNIT;
  out.z = e.z * UNIT;
  out.size = EFFECT_HALF_SIZES[e.size] ?? EFFECT_HALF_SIZES[4];
  return out;
}

const blankSprite = (): RenderSprite => ({ setId: 505, frame: 0, x: 0, y: 0, z: 0 });
const blankObject = (): RenderObject => ({ modelId: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });

/**
 * Construit la vue de chaque image sans allouer : les `RenderObject` et le tableau sont réutilisés d'une image à l'autre (la vue
 * renvoyée n'est valable que jusqu'à l'appel suivant).
 */
export class ViewBuilder {
  private readonly pool: RenderObject[] = [];
  private readonly objects: RenderObject[] = [];
  private readonly spritePool: RenderSprite[] = [];
  private readonly sprites: RenderSprite[] = [];
  private readonly view: RenderView = { camera: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, objects: this.objects, sprites: this.sprites, time: 0 };

  build(world: World): RenderView {
    const objects = this.objects;
    objects.length = 0;
    const sprites = this.sprites;
    sprites.length = 0;
    for (const o of world.liveObjects()) {
      if (isDrawable(o)) {
        const slot = (this.pool[objects.length] ??= blankObject());
        objects.push(objectToRender(o, slot));
      } else if (isBullet(o)) {
        const slot = (this.spritePool[sprites.length] ??= blankSprite());
        sprites.push(bulletToSprite(o, slot));
      }
    }
    // Explosions, impacts, fumées : objets du pool de modèle ≥ 11000, exposés une seule fois par `effects()`.
    for (const e of world.effects()) {
      const slot = (this.spritePool[sprites.length] ??= blankSprite());
      sprites.push(effectToSprite(e, slot));
    }
    this.view.camera = cameraToRender(world.camera);
    this.view.time = world.tickCount;
    return this.view;
  }
}
