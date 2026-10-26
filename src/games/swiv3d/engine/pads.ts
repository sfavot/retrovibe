/**
 * Plates-formes de transformation 7010 / 7011 (`gm_upd_transform_pad` `004482dc`, `gm_upd_pad_helper` `0044822c`,
 * `gm_upd_dock_flying` `00446efc`, `gm_upd_dock_ground` `00447080`). Le joueur en vol qui passe à moins de 122 unités est amarré,
 * déposé sur la plate-forme et change de forme (hélicoptère → véhicule) ; revenu au sol sur la plate-forme, il est replacé sur
 * l'hélicoptère posé de 7011 (objet auxiliaire) et redevient hélicoptère. Voir `docs/swiv3d/objects.md` §6.11.
 *
 * Écart : les mouvements d'amarrage (`00446efc`, `00447080`, non relus) sont remplacés par une approche linéaire sur 70 ticks.
 */
import { findNearestPlayer } from "./combat";
import { ANGLE_MASK, COS, SIN } from "./fixed";
import { type GameObject } from "./objects";
import type { World } from "./world";

/** États du joueur pendant l'amarrage (`+0x50`) : 2 = arrivé en vol, 0x20 = arrivé au sol. */
const DOCK_FLYING_DONE = 2;
const DOCK_GROUND_DONE = 0x20;
const DOCK_TICKS = 0x46;

function pull(world: World, pad: GameObject, p: GameObject, done: number): void {
  // l'amarrage garde le temps dans le minuteur du joueur, l'état de fin dans `state`
  if (p.timer > 0) p.timer--;
  const t = p.timer;
  p.x += (pad.x - p.x) / Math.max(t, 1) | 0;
  p.y += (pad.y - p.y) / Math.max(t, 1) | 0;
  p.z += (pad.z - p.z) / Math.max(t, 1) | 0;
  if (t <= 1) p.state = done;
  void world;
}

/** `gm_upd_dock_flying` : joueur en vol attiré vers la plate-forme. */
export function dockFlying(world: World, p: GameObject): void {
  pull(world, p.owner, p, DOCK_FLYING_DONE);
}

/** `gm_upd_dock_ground` : joueur au sol attiré vers la plate-forme. */
export function dockGround(world: World, p: GameObject): void {
  pull(world, p.owner, p, DOCK_GROUND_DONE);
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
      world.setPlayerForm(1);
      world.player.autopilot = true;
      break;
    case 3:
      player.vx = SIN[o.yaw & ANGLE_MASK]! << 2;
      player.vz = COS[o.yaw & ANGLE_MASK]! << 2;
      player.yaw = o.yaw;
      if (o.timer === 0) {
        world.player.autopilot = false;
        player.owner = player;
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
      world.setPlayerForm(0);
      world.player.autopilot = false;
      player.owner = player;
      o.target = o;
      o.owner = o;
      o.timer = 200;
      o.state = 9;
      break;
    case 9:
      if (o.timer === 0) o.state = 0;
      break;
  }
}

/** `gm_upd_pad_helper` : hélicoptère posé de 7011 ; à l'état 7 de sa plate-forme, replace le joueur à sa position et disparaît. */
export function padHelper(_world: World, o: GameObject): void {
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
