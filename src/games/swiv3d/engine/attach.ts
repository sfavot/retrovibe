/**
 * `gm_attach_offset` (`004580f0`) et sa copie inlinée dans `FUN_004418b0` : pose un objet enfant à un décalage `(latéral, vertical,
 * avant)` (Q8) exprimé dans le repère de son parent, étage par étage : tangage, puis roulis, puis cap, chaque fois avec le sinus et le
 * cosinus de l'angle **opposé** (comme `gm_vehicle_suspension`). Sert aux lanceurs d'armes (`launchers.ts`), aux roues du joueur
 * (`wheels.ts`) et aux roues de l'ennemi 5002 (`enemies.ts`).
 */
import { ANGLE_MASK, COS, SIN } from "./fixed";
import type { GameObject } from "./objects";

export function attachTo(parent: GameObject, o: GameObject, lat: number, vert: number, fwd: number): void {
  const sp = SIN[-parent.pitch & ANGLE_MASK]!;
  const cp = COS[-parent.pitch & ANGLE_MASK]!;
  const sr = SIN[-parent.roll & ANGLE_MASK]!;
  const cr = COS[-parent.roll & ANGLE_MASK]!;
  const sy = SIN[-parent.yaw & ANGLE_MASK]!;
  const cy = COS[-parent.yaw & ANGLE_MASK]!;
  const t1 = (vert * cp - fwd * sp) >> 8;
  const t2 = (vert * sp + fwd * cp) >> 8;
  const lat2 = (lat * cr - t1 * sr) >> 8;
  const vert2 = (lat * sr + t1 * cr) >> 8;
  const x = (lat2 * cy - t2 * sy) >> 8;
  const z = (lat2 * sy + t2 * cy) >> 8;
  o.x = parent.x + x;
  o.y = parent.y + vert2;
  o.z = parent.z + z;
}
