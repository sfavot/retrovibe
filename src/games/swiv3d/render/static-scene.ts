/**
 * Pose statique des objets d'un niveau à leur position d'enregistrement (bloc 105), pour les outils de contrôle visuel du rendu :
 * ce n'est pas la simulation (pas de comportement, d'enfant animé ni d'apparition). Modèles : `docs/swiv3d/objects.md` §4.3-4.4
 * (`REC[4]` corps, `REC[5]` enfant ou bonus ; le joueur est le modèle 990 posé 80 unités au-dessus du sol).
 */
import { HEIGHT_UNITS, type Level } from "../data/level";
import type { Model } from "../data/model";
import type { RenderObject } from "./view";

const PLAYER_MODEL = 990;
/** Hauteur de départ du joueur au-dessus du sol (`gm_level_spawn_objects`). */
const PLAYER_HEIGHT = 80;
/** Types dont `REC[5]` est un enfant visible posé sur le corps (tourelles, antennes) ou un bonus posé (7000). */
const CHILD_TYPES: ReadonlySet<number> = new Set([3000, 5000, 5002, 5500, 6100, 6101, 6110, 7000]);
/** Plate-forme avec hélicoptère posé : cap + 64, 10000/256 au-dessus du sol. */
const PAD_WITH_HELICOPTER = 7011;
/** Générateur de chasseurs : invisible. */
const INVISIBLE = 6300;

/** Hauteur du sol en unités monde sous `(x, z)` (bilinéaire sur la carte 100, sans vagues). */
export function terrainHeight(level: Pick<Level, "heightmap">, x: number, z: number): number {
  const cell = (cx: number, cz: number): number => level.heightmap[((cz & 511) << 9) + (cx & 511)]! * HEIGHT_UNITS;
  const cx = Math.floor(x / 64);
  const cz = Math.floor(z / 64);
  const fx = x - cx * 64;
  const fz = z - cz * 64;
  const a = cell(cx, cz) + ((cell(cx + 1, cz) - cell(cx, cz)) * fx) / 64;
  const b = cell(cx, cz + 1) + ((cell(cx + 1, cz + 1) - cell(cx, cz + 1)) * fx) / 64;
  return Math.floor(a + ((b - a) * fz) / 64);
}

export interface StaticScene {
  objects: RenderObject[];
  /** Position et cap du départ du joueur (type 1000 ou 1001), `null` s'il n'y en a pas. */
  player: { x: number; y: number; z: number; yaw: number } | null;
}

export function placeLevelObjects(level: Level, models: readonly Model[]): StaticScene {
  const bySlot = new Map(models.map((m) => [m.slot, m]));
  const objects: RenderObject[] = [];
  let player: StaticScene["player"] = null;
  const put = (slot: number, x: number, z: number, yaw: number, lift = 0): void => {
    const model = bySlot.get(slot);
    if (!model) return;
    objects.push({ modelId: slot, x, y: terrainHeight(level, x, z) - model.groundOffset + lift, z, yaw, pitch: 0, roll: 0 });
  };

  for (const o of level.objects) {
    if (o.type === 1000 || o.type === 1001) {
      const y = terrainHeight(level, o.x, o.z) + PLAYER_HEIGHT;
      player = { x: o.x, y, z: o.z, yaw: o.angle };
      objects.push({ modelId: PLAYER_MODEL, x: o.x, y, z: o.z, yaw: o.angle, pitch: 0, roll: 0 });
      continue;
    }
    if (o.type === INVISIBLE) continue;
    put(o.model, o.x, o.z, o.angle);
    if (CHILD_TYPES.has(o.type)) put(o.childModel, o.x, o.z, o.angle);
    if (o.type === PAD_WITH_HELICOPTER) put(PLAYER_MODEL, o.x, o.z, o.angle + 64, 10000 / 256);
  }
  return { objects, player };
}
