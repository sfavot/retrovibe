/**
 * Plates-formes de transformation 7010 / 7011 (`gm_upd_transform_pad` `004482dc`, `gm_upd_pad_helper` `0044822c`,
 * `gm_upd_dock_flying` `00446efc`, `gm_upd_dock_ground` `00447080`). Le joueur en vol qui passe à moins de 122 unités est amarré,
 * déposé sur la plate-forme et change de forme (hélicoptère → véhicule) ; revenu au sol sur la plate-forme, il est replacé sur
 * l'hélicoptère posé de 7011 (objet auxiliaire) et redevient hélicoptère. Voir `docs/swiv3d/objects.md` §6.11.
 *
 * Les deux mouvements d'amarrage sont portés de l'exe :
 *  - en vol (`00446efc`) : cap tourné vers la plate-forme (pas de 4), puis 35 ticks de glissement vers un point à 32 unités de la
 *    plate-forme (`cap + 0x140`, 1/16 de l'écart par tick, vol stationnaire à 130 unités du relief), puis descente de 550/256 unité par
 *    tick jusqu'à 37 unités au-dessus de la plate-forme ;
 *  - au sol (`00447080`) : suspension des 4 roues, frottement 14/16 et gravité de 150 comme la forme 1, puis trajet programmé
 *    (le véhicule va au point à 256 unités devant ou derrière la plate-forme selon le plus proche, s'aligne, avance de 4 unités par
 *    tick, s'aligne sur la plate-forme et y entre à moins de 70 unités).
 *
 * Écarts : la suspension d'amarrage au sol utilise la hauteur du relief sans les vagues d'eau (`00425c94` hors missions à eau :
 * identique) ; les roues du véhicule (objets 980) ne sont pas animées pendant l'amarrage ; les variantes 7012 / 7013 et suivantes
 * (`004477b0`, `00447afc`, `0044878c`, `004490cc`, `004493e8`, `004495f8`) ne sont pas portées (absentes des niveaux livrés).
 */
import { findNearestPlayer } from "./combat";
import { ANGLE_MASK, COS, SIN } from "./fixed";
import type { GameObject } from "./objects";
import { heliPhysics } from "./player";
import { steerToPoint } from "./projectiles";
import type { World } from "./world";

/** États du joueur pendant l'amarrage (`+0x50`) : 2 = arrivé en vol, 0x20 = arrivé au sol. */
const DOCK_FLYING_DONE = 2;
const DOCK_GROUND_DONE = 0x20;
const DOCK_TICKS = 0x46;

/** Hauteur de vol stationnaire pendant l'approche (`gm_heli_physics(…, 0x82)`) et palier d'arrivée au-dessus de la plate-forme. */
const HOVER_HEIGHT = 0x82;
const DESCENT_SPEED = 0x226;
const DESCENT_STOP = 0x251c;

/** Mondes dont le joueur est amarré avant son changement de forme (`+0x180 == 1`) : les armes se rétractent et ne tirent plus. */
const docked = new WeakSet<World>();

/** `+0x180 == 1` : le joueur est capté par une plate-forme et n'a pas encore changé de forme. */
export function isDockLocked(world: World): boolean {
  return docked.has(world);
}

/** `gm_upd_dock_flying` : joueur en vol attiré vers la plate-forme (`p.owner`). */
export function dockFlying(world: World, p: GameObject): void {
  const pad = p.owner;
  if (p.timer > 0) p.timer--;
  steerToPoint(p, 4, pad.x, pad.z);
  const a = (pad.yaw + 0x140) & ANGLE_MASK;
  const tx = pad.x + SIN[a]! * 0x20;
  const tz = pad.z + COS[a]! * 0x20;
  if (p.state === 0) {
    heliPhysics(p, world.terrain, HOVER_HEIGHT, (e) => world.emit(e));
    p.pitch = 0;
    p.roll = 0;
    p.x += (tx - p.x) >> 4;
    p.z += (tz - p.z) >> 4;
    if (p.timer === 0) {
      p.state = 1;
      p.vx = p.vy = p.vz = 0;
    }
  } else if (p.state === 1) {
    p.y -= DESCENT_SPEED;
    if (p.y < pad.y + DESCENT_STOP) p.state = DOCK_FLYING_DONE;
  }
}

/** Positions des 4 roues (`gm_vehicle_suspension` `00443510`) : x, z du coin en Q8 (avant gauche, avant droit, arrière gauche, arrière droit). */
const CORNERS: readonly (readonly [number, number])[] = [
  [-5120, 7680],
  [5120, 7680],
  [-5120, -7680],
  [5120, -7680],
];

/** Hauteurs Q8 des 4 roues au-dessus du relief (`0048420c`, `00484218`, `00484224`, `00484230`). */
function wheelHeights(world: World, o: GameObject, out: number[]): void {
  const sp = SIN[-o.pitch & ANGLE_MASK]!;
  const cp = COS[-o.pitch & ANGLE_MASK]!;
  const sy = SIN[-o.yaw & ANGLE_MASK]!;
  const cy = COS[-o.yaw & ANGLE_MASK]!;
  const sr = SIN[-o.roll & ANGLE_MASK]!;
  const cr = COS[-o.roll & ANGLE_MASK]!;
  const foot = world.models.get(o.model)?.groundOffset ?? 0;
  for (let i = 0; i < 4; i++) {
    const [lx, lz] = CORNERS[i]!;
    const a = (foot * 0x100 * cp - lz * sp) >> 8;
    const b = (foot * 0x100 * sp + lz * cp) >> 8;
    const yRaw = lx * sr + a * cr;
    const a2 = (lx * cr - a * sr) >> 8;
    const xRaw = a2 * cy - b * sy;
    const zRaw = a2 * sy + b * cy;
    const px = (xRaw >> 8) + o.x;
    const pz = (zRaw >> 8) + o.z;
    out[i] = (yRaw >> 8) + o.y - world.terrain.height(px, pz);
  }
}

const wheels = [0, 0, 0, 0];

/** Avance de 4 unités dans la direction du cap (`+0x1c += (sin >> 16) · 4`). */
function drive(o: GameObject): void {
  o.x += SIN[o.yaw & ANGLE_MASK]! * 4;
  o.z += COS[o.yaw & ANGLE_MASK]! * 4;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = (ax - bx) >> 8;
  const dz = (az - bz) >> 8;
  return dx * dx + dz * dz;
}

/** `gm_upd_dock_ground` : véhicule au sol conduit jusqu'à la plate-forme (`p.owner`). */
export function dockGround(world: World, p: GameObject): void {
  const pad = p.owner;
  wheelHeights(world, p, wheels);
  const [w0, w1, w2, w3] = wheels as [number, number, number, number];
  const m = Math.min(1000, w0, w1, w2, w3);
  p.vx = (p.vx * 14) >> 4;
  p.vy = (p.vy * 14) >> 4;
  p.vz = (p.vz * 14) >> 4;
  if (m < 1000) {
    p.pitch += (w2 + w3 - (w0 + w1)) >> 9;
    p.roll += (w3 + w1 - (w2 + w0)) >> 9;
  } else p.pitch -= 2;
  if (m > 0) p.vy -= 150;
  if (m < 0) {
    if (p.vy < 0) p.vy = 0;
    p.y -= m;
  }
  const padSin = SIN[pad.yaw & ANGLE_MASK]! * 0x100;
  const padCos = COS[pad.yaw & ANGLE_MASK]! * 0x100;
  switch (p.state) {
    case 0: {
      // point à 32 unités devant le véhicule, distance aux points à ±256 unités de la plate-forme
      const ax = (p.x >> 8) + (SIN[p.yaw & ANGLE_MASK]! >> 3);
      const az = (p.z >> 8) + (COS[p.yaw & ANGLE_MASK]! >> 3);
      const px = pad.x >> 8;
      const pz = pad.z >> 8;
      const front = (ax - (px + SIN[pad.yaw & ANGLE_MASK]!)) ** 2 + (az - (pz + COS[pad.yaw & ANGLE_MASK]!)) ** 2;
      const back = (ax - (px - SIN[pad.yaw & ANGLE_MASK]!)) ** 2 + (az - (pz - COS[pad.yaw & ANGLE_MASK]!)) ** 2;
      p.state = front < back ? 10 : 0x14;
      break;
    }
    case 10:
      if (steerToPoint(p, 2, pad.x + padSin, pad.z + padCos)) p.state = 0xb;
      break;
    case 0xb:
      drive(p);
      if (dist2(pad.x + padSin, pad.z + padCos, p.x, p.z) < 10000) p.state = 0x1e;
      break;
    case 0x14:
      if (steerToPoint(p, 2, pad.x - padSin, pad.z - padCos)) p.state = 0x15;
      break;
    case 0x15:
      drive(p);
      if (dist2(pad.x - padSin, pad.z - padCos, p.x, p.z) < 10000) p.state = 0x1e;
      break;
    case 0x1e:
      if (steerToPoint(p, 3, pad.x, pad.z)) p.state = 0x1f;
      break;
    case 0x1f:
      steerToPoint(p, 2, pad.x, pad.z);
      drive(p);
      if (dist2(pad.x, pad.z, p.x, p.z) < 5000) p.state = DOCK_GROUND_DONE;
      break;
  }
}

function capture(world: World, pad: GameObject, p: GameObject, update: string): void {
  p.owner = pad;
  pad.owner = p;
  world.player.autopilot = true;
  p.classe = 0x40;
  p.vx = p.vy = p.vz = 0;
  p.update = update;
  p.state = 0;
  p.timer = DOCK_TICKS;
  docked.add(world);
}

/** Change de forme : le pilote de la nouvelle forme est réinstallé et le verrou des armes levé (`gm_player_set_form`, `+0x180 = 0`). */
function changeForm(world: World, form: number): void {
  world.setPlayerForm(form);
  world.player.autopilot = false;
  world.player.obj.owner = world.player.obj;
  docked.delete(world);
}

/** `gm_upd_transform_pad` : plate-forme indestructible (pv 1 000 réécrits à chaque tick) et machine à 10 états. */
export function transformPad(world: World, o: GameObject): void {
  if (o.timer > 0) o.timer--;
  o.hp = 1000;
  const player = world.player.obj;
  switch (o.state) {
    case 0:
    case 5: {
      if ((o.age & 0x1f) === 0) findNearestPlayer(world, o, 6000000);
      if (o.target === o) break;
      const t = o.target;
      const dx = (o.x - t.x) >> 8;
      const dz = (o.z - t.z) >> 8;
      const wantFlying = o.state === 0;
      if (dx * dx + dz * dz < 15000 && (t.classe & 0x21c) === (wantFlying ? 0x214 : 0x204)) {
        capture(world, o, t, wantFlying ? "dock_flying" : "dock_ground");
        o.state = wantFlying ? 1 : 6;
      }
      break;
    }
    case 1:
      if (player.state === DOCK_FLYING_DONE) o.state = 2;
      break;
    case 2:
      player.x = o.x;
      player.y = o.y;
      player.z = o.z;
      o.state = 3;
      o.timer = 0x28;
      player.state = 0;
      changeForm(world, 1);
      break;
    case 3:
      player.vx = SIN[o.yaw & ANGLE_MASK]! << 2;
      player.vz = COS[o.yaw & ANGLE_MASK]! << 2;
      player.yaw = o.yaw;
      if (o.timer === 0) {
        o.target = o;
        o.owner = o;
        o.state = 4;
        o.timer = 200;
      }
      break;
    case 4:
      if (o.timer === 0) o.state = 5;
      break;
    case 6:
      if (player.state === DOCK_GROUND_DONE) o.state = 7;
      break;
    case 8:
      changeForm(world, 0);
      o.timer = 200;
      o.state = 9;
      break;
    case 9:
      if (o.timer === 0) o.state = 0;
      break;
  }
}

/**
 * `gm_upd_pad_helper` : hélicoptère posé de 7011 ; à l'état 7 de sa plate-forme, replace le joueur à sa position et disparaît.
 * À sa création l'exe le décale (cap + 64, 39 unités plus haut, 32 unités en arrière du nouveau cap) : appliqué ici au premier tick.
 */
export function padHelper(_world: World, o: GameObject): void {
  if (o.age === 0) {
    o.yaw += 0x40;
    o.y += 10000;
    o.x -= SIN[o.yaw & ANGLE_MASK]! * 0x20;
    o.z -= COS[o.yaw & ANGLE_MASK]! * 0x20;
  }
  const pad = o.owner;
  if (pad === o || pad.classe === 0 || pad.state !== 7) return;
  const p = pad.owner;
  p.x = o.x;
  p.y = o.y;
  p.z = o.z;
  p.pitch = o.pitch;
  p.roll = o.roll;
  p.yaw = o.yaw;
  pad.state = 8;
  o.classe = 0;
}
