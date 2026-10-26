/**
 * Comportements des objets du niveau : cibles destructibles, tourelles, canons, chars, navires, fabriques, pistes d'avions,
 * hélicoptères, avions, chasseurs. Chaque fonction porte une fonction `+0x68` de l'exe (adresse en tête), voir
 * `docs/swiv3d/objects.md` §6. `o` est l'objet, `world.player.obj` le joueur ; les distances de ciblage sont en unités d'objet.
 */
import {
  FX_CLASS,
  SND,
  acquireTarget,
  aircraftTurn,
  aircraftTurnToTarget,
  applyAimOption,
  bestAimOption,
  cloneObject,
  explosionBig,
  explosionSmall,
  findNearestPlayer,
  scoreAdd,
  smokePlume,
  sound,
  spawnOnGround,
} from "./combat";
import { spawnDebris } from "./debris";
import { enemyFire } from "./enemy-fire";
import { ANGLE_MASK, COS, SIN } from "./fixed";
import { CLASS, DEPOP_MARK, FLAG, radius2, type GameObject } from "./objects";
import { unregisterObjective } from "./objectives";
import { heliPhysics } from "./player";
import type { World } from "./world";

/** `gm_object_explode` (`00443ac0`) : décalque d'explosion de taille 900/901/902 selon le rayon², cratère (événement), son 1000. */
export function explodeHeavy(world: World, o: GameObject): void {
  const r2 = radius2(world.models, o.model);
  const size: 0 | 1 | 2 = r2 < 1000 ? 0 : r2 < 5000 ? 1 : 2;
  // Le cratère est creusé avant la pose du décalque, qui se pose donc sur le fond.
  world.crater(o.x, o.z, size);
  world.emit({ kind: "crater", x: o.x, z: o.z, size });
  spawnOnGround(world, {
    x: o.x,
    z: o.z,
    classe: FX_CLASS,
    hp: 3000,
    model: 900 + size,
    update: "fx_decal",
  });
  sound(world, SND.bigExplosion, o);
}

/** Mort d'un corps lourd : classe 0, explosion, épave et éclats, score, désinscription de l'objectif. */
function heavyDeath(world: World, o: GameObject, points: number): void {
  o.classe = 0;
  explodeHeavy(world, o);
  spawnDebris(world, o);
  scoreAdd(world, o, points);
  unregisterObjective(world, o);
}

// ---------------------------------------------------------------------------------------------------------------------
// Cibles statiques
// ---------------------------------------------------------------------------------------------------------------------

/** Points d'une cible statique détruite (`0042ebc4`, objects.md §10.3). */
export const STATIC_SCORE = 73;

/**
 * `gm_upd_destructible` (`00446d24`) : cible statique (2000, 2002, 2003, base de 3000, décor de 7000). Gelée tant qu'intacte ;
 * fumée à la première blessure ; à pv ≤ 0 explosion, épave, éclats, 73 points, et largage du bonus `subtype` (1000-1999).
 */
export function destructible(world: World, o: GameObject): void {
  if (o.age === 0) o.state = o.hp;
  if (o.hp !== o.state && o.hp > 0) {
    o.state = o.hp;
    smokePlume(world, o);
    world.emit({ kind: "smoke", x: o.x, y: o.y, z: o.z });
  }
  if (o.hp <= 0) {
    heavyDeath(world, o, STATIC_SCORE);
    world.emit({
      kind: "objectDestroyed",
      type: o.type,
      model: o.model,
      childModel: o.rec?.childModel ?? 0,
      subtype: o.subtype,
      x: o.x,
      y: o.y,
      z: o.z,
      yaw: o.yaw,
      score: STATIC_SCORE,
    });
    if (o.subtype >= 1000 && o.subtype < 2000 && o.rec && o.type !== 7000) {
      const b = spawnOnGround(world, {
        x: o.rec.x * 256,
        z: o.rec.z * 256,
        yaw: o.rec.angle,
        classe: 0x41,
        hp: 1000,
        model: o.rec.childModel,
        update: "upd_00446a3c",
      });
      if (b) b.subtype = o.subtype;
    }
  } else {
    o.flags |= FLAG.FROZEN;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Tourelles
// ---------------------------------------------------------------------------------------------------------------------

/** Éjection d'une tourelle dont le corps est détruit : saute (vy 0x4b0), propriétaire = soi. */
function ejectTurret(o: GameObject): void {
  o.vy = 0x4b0;
  o.owner = o;
  o.classe |= 0x4012;
}

/** Tourelle éjectée qui retombe : gravité 30, rotation 25 par tick. Retourne `true` au contact du sol. */
function fallTurret(world: World, o: GameObject): boolean {
  o.vy -= 30;
  o.yaw += 25;
  return world.terrain.height(o.x, o.z) >= o.y;
}

/**
 * `gm_upd_turret` (`0044ac88`) : tourelle de 3000. Cherche un joueur (3 × 3 cellules), vise parmi 5 options (cap ∓3, tangage ±2,
 * borné à [-15, 55]) et appelle `enemyFire` sans test d'alignement ; sans cible rejoint tangage 55 et le cap de sa base.
 * Éjectée à la mort de la base (111 points) ; elle lance alors une dernière fusée à l'impact.
 */
export function turret(world: World, o: GameObject): void {
  if (o.timer > 0) o.timer--;
  acquireTarget(world, o, 40, 4, 4, 1);
  const base = o.owner;
  if (o.target === o) {
    if (o.pitch < 55) o.pitch++;
    if (base.yaw < o.yaw) o.yaw--;
    if (o.yaw < base.yaw) o.yaw++;
  } else {
    applyAimOption(o, bestAimOption(o, o.target), 3, 2);
    if (o.pitch > 55) o.pitch = 55;
    if (o.pitch < -15) o.pitch = -15;
    enemyFire(world, o);
  }
  if (o.hp < 1) {
    o.classe = 0;
    explosionBig(world, o);
  }
  if (o.owner === o) {
    if (fallTurret(world, o)) {
      const m = cloneObject(world, o, {
        classe: 0x3b,
        hp: 20,
        model: 800,
        update: "missile_a",
      });
      if (m) {
        m.pitch = 128;
        m.y += 1500;
        m.vy = 800;
      }
      o.classe = 0;
      explosionBig(world, o);
    }
  } else if (base.hp < 1) {
    ejectTurret(o);
    scoreAdd(world, o, 111);
  }
}

/** `gm_upd_beam_gun` (`0044b848`) : canon à faisceau fixe (3001), portée 640 unités, pas de score. */
export function beamGun(world: World, o: GameObject): void {
  if (o.timer > 0) o.timer--;
  acquireTarget(world, o, 40, 4, 4, 1);
  o.flags |= 0x11;
  if (o.target === o) o.timer = 41;
  else {
    const dx = (o.target.x - o.x) >> 8;
    const dz = (o.target.z - o.z) >> 8;
    if ((dx * dx + dz * dz) >> 8 < 0x640) enemyFire(world, o);
    else o.timer = 41;
  }
  if (o.hp < 1) {
    o.classe = 0;
    explosionBig(world, o);
  }
}

/** `gm_child_limit_angles` (`00441c00`) : tangage et roulis d'un enfant bornés à ± `limit` autour de ceux du parent. */
function limitAngles(o: GameObject, limit: number): void {
  const p = o.owner;
  const d = (o.yaw - p.yaw) & ANGLE_MASK;
  const s = SIN[d]!;
  const c = COS[d]!;
  const a = (p.pitch * c - p.roll * s) >> 8;
  const b = (p.roll * c + p.pitch * s) >> 8;
  if (a + limit < o.pitch) o.pitch = a + limit;
  if (o.pitch < a - limit) o.pitch = a - limit;
  if (b + limit < o.roll) o.roll = b + limit;
  if (o.roll < b - limit) o.roll = b - limit;
}

/**
 * `gm_upd_vehicle_turret` (`0044d470`) : tourelle d'un char ou navire, collée à son corps, cible = celle du corps ; tire seulement
 * quand l'option « tout droit » est la meilleure ; éjectée à la mort du corps (sans score).
 */
export function vehicleTurret(world: World, o: GameObject): void {
  const body = o.owner;
  if (body !== o && body.classe !== 0) {
    o.x = body.x;
    o.y = body.y;
    o.z = body.z;
  }
  if (o.timer > 0) o.timer--;
  o.target = body.target;
  if (o.target === body) {
    if (body.yaw < o.yaw) o.yaw--;
    if (o.yaw < body.yaw) o.yaw++;
  } else {
    const option = bestAimOption(o, o.target);
    if (option === 0) enemyFire(world, o);
    else applyAimOption(o, option, 3, 2);
  }
  if (o.hp < 1) o.classe = 0;
  if (o.owner === o) {
    o.vy -= 30;
    o.yaw += 25;
    if (world.terrain.height(o.x, o.z) >= o.y) o.classe = 0;
  } else if (o.owner.hp < 1) ejectTurret(o);
  if (o.owner !== o) limitAngles(o, 10);
}

/** `gm_upd_antenna` (`0044de9c`) : antenne ou radar décoratif collé au hangar ; meurt avec lui. */
export function antenna(_world: World, o: GameObject): void {
  const h = o.owner;
  if (h.classe !== 0) {
    o.x = h.x;
    o.y = h.y;
    o.z = h.z;
  }
  switch (o.state) {
    case 1:
      o.yaw = h.yaw + (SIN[(o.age & 0x3f) * 4]! >> 2);
      break;
    case 2:
      o.yaw = h.yaw + SIN[(o.age & 0x7f) * 4]!;
      break;
    case 3:
      o.yaw += 5;
      break;
  }
  if (o.hp < 1 || h.classe === 0) {
    o.classe = 0;
    if (h.classe !== 0) h.hp = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Véhicules terrestres et navires
// ---------------------------------------------------------------------------------------------------------------------

/** Hauteurs au-dessus du sol des 4 coins du véhicule (`00443510`) et poussée avant, en Q8. */
const contact = {
  c: [0, 0, 0, 0],
  thrustX: 0,
  thrustY: 0,
  thrustZ: 0,
};

/**
 * `gm_vehicle_suspension` (`00443510`) : hauteur de chaque coin `(±5 120, ±7 680)` (0 avant gauche, 1 avant droit, 2 arrière
 * gauche, 3 arrière droit) au-dessus du terrain, orientés par cap, tangage et roulis ; vecteur de poussée `thrust` le long de l'axe
 * du véhicule (tangage compris).
 */
export function vehicleContact(world: World, o: GameObject, thrust: number): typeof contact {
  const foot = (world.models.get(o.model)?.groundOffset ?? 0) * 256;
  const np = -o.pitch & ANGLE_MASK;
  const nr = -o.roll & ANGLE_MASK;
  const ny = -o.yaw & ANGLE_MASK;
  const sp = SIN[np]!;
  const cp = COS[np]!;
  const sr = SIN[nr]!;
  const cr = COS[nr]!;
  const sy = SIN[ny]!;
  const cy = COS[ny]!;
  for (let k = 0; k < 4; k++) {
    const lx = k & 1 ? 5120 : -5120;
    const lz = k < 2 ? 7680 : -7680;
    const y1 = (foot * cp - lz * sp) >> 8;
    const z1 = (foot * sp + lz * cp) >> 8;
    const yy = lx * sr + y1 * cr;
    const x2 = (lx * cr - y1 * sr) >> 8;
    const wx = ((x2 * cy - z1 * sy) >> 8) + o.x;
    const wy = (yy >> 8) + o.y;
    const wz = ((x2 * sy + z1 * cy) >> 8) + o.z;
    contact.c[k] = wy - world.terrain.height(wx, wz);
  }
  const t = (thrust * cp) >> 8;
  contact.thrustX = (-t * sy) >> 8;
  contact.thrustY = (-thrust * sp) >> 8;
  contact.thrustZ = (t * cy) >> 8;
  return contact;
}

/** `gm_steer_to_node` (`00443284`) : cap vers le nœud courant (−step, 0 ou +step) ; retourne D² (unités) jusqu'à lui. */
function steerToNode(world: World, o: GameObject, step: number): number {
  const n = world.nodes;
  if (o.node < 0) return 0;
  const dx = n.x[o.node]! - (o.x >> 8);
  const dz = n.z[o.node]! - (o.z >> 8);
  let best = -999999999;
  let bestYaw = o.yaw;
  for (let k = -1; k <= 1; k++) {
    const y = o.yaw + k * step;
    const s = dx * SIN[y & ANGLE_MASK]! + COS[y & ANGLE_MASK]! * dz;
    if (s > best) {
      best = s;
      bestYaw = y;
    }
  }
  o.yaw = bestYaw;
  return dx * dx + dz * dz;
}

/**
 * Corps d'un char ou d'un navire (`0044bca8`, `0044cf1c`) : suspension à 4 coins, gravité 150, poussée `3 × param` vers le nœud
 * courant, nouveau nœud à l'arrivée (D² < 1 000 : à tour de rôle sans cible, vers le joueur avec une cible).
 */
function vehicleBody(world: World, o: GameObject, boat: boolean): void {
  const kind = boat ? "ship" : "ground";
  const nodes = world.nodes;
  if (o.node === -1) nodes.claim(kind, o);
  if (o.classe === DEPOP_MARK) {
    nodes.release(kind, o);
    return;
  }
  const c = vehicleContact(world, o, 3 * o.param);
  const [c0, c1, c2, c3] = c.c as [number, number, number, number];
  const tx = c.thrustX;
  const ty = c.thrustY;
  const tz = c.thrustZ;
  if (!boat) acquireTarget(world, o, 40, 4, 4, 1);
  const m = Math.min(1000, c0, c1, c2, c3);
  o.vx = (o.vx * 14) >> 4;
  o.vy = (o.vy * 14) >> 4;
  o.vz = (o.vz * 14) >> 4;
  if (m < 1000) {
    o.pitch += (c2 + c3 - (c0 + c1)) >> 9;
    o.roll += (c3 + c1 - (c2 + c0)) >> 9;
  } else o.pitch -= 2;
  if (m > 0) o.vy -= 150;
  if (m < 0) {
    if (o.vy < 0) o.vy = 0;
    o.y -= m;
  }
  const d2 = steerToNode(world, o, 10);
  if (boat) acquireTarget(world, o, 40, 4, 4, 2);
  if (o.target === o) {
    if (d2 < 1000) nodes.patrol(kind, o);
  } else if (d2 < 1000) nodes.chase(kind, o, o.target);
  if (m < 1000 && d2 > 1000) {
    o.vx += tx;
    o.vy += ty;
    o.vz += tz;
  }
  if (o.hp < 1) {
    nodes.release(kind, o);
    o.classe = 0;
    scoreAdd(world, o, 59);
    if (!boat) {
      unregisterObjective(world, o);
      spawnDebris(world, o);
    }
    explosionBig(world, o);
  }
}

/** `gm_upd_ground_vehicle` (`0044bca8`) : char (5000) et véhicule à roues (5002). */
export function groundVehicle(world: World, o: GameObject): void {
  vehicleBody(world, o, false);
}

/** `gm_upd_boat` (`0044cf1c`) : navire (5500), nœuds d'eau, ciblage sur 5 × 5 cellules. */
export function boat(world: World, o: GameObject): void {
  vehicleBody(world, o, true);
}

/** `gm_upd_wheel` (`004450c4`) : roue décorative de 5002, placée sur le corps ; meurt avec lui. */
export function wheel(_world: World, o: GameObject): void {
  const b = o.owner;
  if (b.classe === 0) {
    o.classe = 0;
    return;
  }
  o.vx = b.vx;
  o.vy = b.vy;
  o.vz = b.vz;
  const s = SIN[o.yaw & ANGLE_MASK]!;
  const c = COS[o.yaw & ANGLE_MASK]!;
  o.pitch -= (c * b.vz + b.vx * s) >> 13;
  // position `gm_attach_offset` : (±6000, -4000, +8000 / -4000) dans le repère du corps
  const lx = o.state & 1 ? 6000 : -6000;
  const lz = o.state < 2 ? 8000 : -4000;
  const sy = SIN[b.yaw & ANGLE_MASK]!;
  const cy = COS[b.yaw & ANGLE_MASK]!;
  o.x = b.x + ((lx * cy + lz * sy) >> 8);
  o.y = b.y - 4000;
  o.z = b.z + ((-lx * sy + lz * cy) >> 8);
  o.yaw = b.yaw;
}

/**
 * `gm_upd_vehicle_factory` (`0044d804`) : fabrique de chars (6000) : toutes les 141 ticks, si le nœud le plus proche est libre,
 * un char (modèle `REC[11]`, pv `REC[13]`, vitesse `REC[15]`) et sa tourelle (modèle `REC[12]`, arme `REC[14]`).
 */
export function vehicleFactory(world: World, o: GameObject): void {
  const nodes = world.nodes;
  if (o.node === -1) {
    nodes.claim("ground", o);
    nodes.release("ground", o); // le nœud reste mémorisé, sa capacité est rendue aussitôt
  }
  const rec = o.rec;
  if (rec && o.age > 140 && o.node >= 0 && nodes.capacity("ground", o.node) > 0) {
    const p = rec.params;
    const body = cloneObject(world, o, {
      classe: 0x1023,
      hp: p[9]!,
      model: p[7]!,
      update: "upd_0044bca8",
    });
    if (body) {
      body.param = p[11]!;
      body.target = body;
      const tur = cloneObject(world, body, {
        classe: 0x1023,
        hp: p[9]!,
        model: p[8]!,
        update: "upd_0044d470",
      });
      if (tur) tur.subtype = p[10]!;
    }
    o.age = 0;
  }
  if (o.hp < 1) heavyDeath(world, o, 500);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pistes d'avions et avions d'attaque
// ---------------------------------------------------------------------------------------------------------------------

/** Hauteur d'un avion d'attaque au-dessus du relief : 190 (`0xbe`). */
const ATTACK_ALTITUDE = 190;

/** Maintien d'altitude des avions d'attaque (relief anticipé à 32 ticks, ressort 2 / ½, frottement vertical 1/16). */
function attackAltitude(world: World, o: GameObject): void {
  const ground = world.terrain.height(o.x, o.z);
  const ahead = world.terrain.height(o.x + o.vx * 32, o.z + o.vz * 32);
  const e = (Math.max(ground, ahead) >> 8) + ATTACK_ALTITUDE - (o.y >> 8);
  if (e > 0) o.vy += e * 2;
  if (e < 0) o.vy += e >> 1;
  const d = o.vy >> 4;
  o.vy -= d === 0 ? o.vy : d;
}

function attackPlaneCommon(o: GameObject): void {
  o.vx = (SIN[o.yaw & ANGLE_MASK]! * o.param) >> 2;
  o.vz = (COS[o.yaw & ANGLE_MASK]! * o.param) >> 2;
}

function attackPlaneEnd(world: World, o: GameObject): void {
  attackAltitude(world, o);
  if (o.hp < 1) {
    o.classe = 0;
    explosionBig(world, o);
    scoreAdd(world, o, 50);
  }
  o.pitch = o.vy >> 5;
}

/** `gm_upd_attack_plane` (`0044d938`) : avion d'une piste (6100, 6101) : vole droit, tire en continu, 50 points. */
export function attackPlane(world: World, o: GameObject): void {
  if (o.timer > 0) o.timer--;
  attackPlaneCommon(o);
  enemyFire(world, o);
  attackPlaneEnd(world, o);
}

/** `gm_upd_attack_plane2` (`0044db38`) : avion de 6110 : vire vers le joueur en tirant, puis passe (état 1) et s'éloigne (état 2). */
export function attackPlane2(world: World, o: GameObject): void {
  if (o.timer > 0) o.timer--;
  attackPlaneCommon(o);
  const t = o.target;
  const dx = (t.x >> 8) - (o.x >> 8);
  const dz = (t.z >> 8) - (o.z >> 8);
  if (o.state === 0) {
    let best = -999999999;
    let bestYaw = o.yaw;
    o.yaw -= 1;
    for (let k = 0; k < 3; k++) {
      const s = dx * SIN[o.yaw & ANGLE_MASK]! + COS[o.yaw & ANGLE_MASK]! * dz;
      if (s > best) {
        best = s;
        bestYaw = o.yaw;
      }
      o.yaw++;
    }
    o.yaw = bestYaw;
  }
  if (dx * dx + dz * dz < 2000) o.state = 1;
  else if (o.state === 1) o.state = 2;
  if (o.state === 0) enemyFire(world, o);
  attackPlaneEnd(world, o);
}

/** Crée un avion de piste : position derrière le joueur (recul `back` unités), altitude du hangar + 390, cible = joueur. */
function spawnStripPlane(
  world: World,
  o: GameObject,
  update: string,
  back: number,
  extraYaw = 0,
): GameObject | null {
  const rec = o.rec;
  const t = o.target;
  if (!rec) return null;
  const p = rec.params;
  const plane = cloneObject(world, o, {
    classe: 0x1033,
    hp: p[9]!,
    model: p[7]!,
    update,
  });
  if (!plane) return null;
  plane.yaw += extraYaw;
  const sy = SIN[o.yaw & ANGLE_MASK]!;
  const cy = COS[o.yaw & ANGLE_MASK]!;
  plane.x = t.x + sy * -back;
  plane.z = t.z + cy * -back;
  plane.y += 99999;
  plane.param = p[11]!;
  plane.target = t;
  plane.subtype = p[10]!;
  plane.owner = o;
  return plane;
}

/** Fin commune des pistes : 500 points, explosion, épave et éclats, objectif. */
function airstripDeath(world: World, o: GameObject): void {
  if (o.hp < 1) heavyDeath(world, o, 500);
}

/** `gm_upd_airstrip_0044df98` (6100) : un avion toutes les 91 ticks quand un joueur est repéré. */
export function airstrip(world: World, o: GameObject): void {
  acquireTarget(world, o, 30, 4, 4, 1);
  if (o.target !== o && o.age > 90) {
    spawnStripPlane(world, o, "attack_plane", 0x5dc);
    o.age = 0;
  }
  airstripDeath(world, o);
}

/** `gm_upd_airstrip_0044e0f8` (6101) : escadrille de 6 avions (minuteur 160, un avion tous les 8 ticks sous 48). */
export function airstripSquadron(world: World, o: GameObject): void {
  acquireTarget(world, o, 30, 4, 4, 1);
  if (o.timer > 0) o.timer--;
  if (o.target !== o && o.timer < 0x30 && (o.timer & 7) === 0) {
    const plane = spawnStripPlane(world, o, "attack_plane", 0x708, o.timer * 2 - 0x32);
    if (plane) {
      plane.x += SIN[plane.yaw & ANGLE_MASK]! * 0x100;
      plane.z += COS[plane.yaw & ANGLE_MASK]! * 0x100;
    }
  }
  if (o.timer === 0) o.timer = 0xa0;
  airstripDeath(world, o);
}

/** `gm_upd_airstrip_0044e2d8` (6110) : un avion « passe de tir » toutes les 101 ticks. */
export function airstripPasses(world: World, o: GameObject): void {
  acquireTarget(world, o, 30, 4, 4, 1);
  if (o.target !== o && o.age > 100) {
    spawnStripPlane(world, o, "attack_plane2", 0x5dc);
    o.age = 0;
  }
  airstripDeath(world, o);
}

// ---------------------------------------------------------------------------------------------------------------------
// Hélicoptère kamikaze, avion de nœuds, chasseurs
// ---------------------------------------------------------------------------------------------------------------------

/** Mort d'un appareil : épave qui tombe, fumée, 210 points, petite explosion. */
function aircraftDeath(world: World, o: GameObject): void {
  o.update = "upd_00449c10";
  smokePlume(world, o);
  o.age = 0;
  o.classe |= 0x4020;
  scoreAdd(world, o, 210);
  explosionSmall(world, o);
}

/**
 * `gm_upd_kamikaze_heli` (`0044e438`) : hélicoptère 4001, posé jusqu'à ce qu'un joueur soit repéré, monte 80 ticks puis fonce sur
 * lui (contact seulement, aucun tir) en descendant à sa hauteur.
 */
export function kamikazeHeli(world: World, o: GameObject): void {
  if (!(o.classe & CLASS.FLYING)) {
    acquireTarget(world, o, 70, 4, 4, 1);
    if (o.target !== o) {
      o.age = 0;
      o.classe |= 0x12;
    }
  } else if (o.target === o) {
    heliPhysics(o, world.terrain, 0x50, (e) => world.emit(e));
    acquireTarget(world, o, 20, 4, 4, 1);
  } else {
    const t = o.target;
    if (!(t.classe & CLASS.TARGET)) acquireTarget(world, o, 10, 4, 4, 1);
    if (o.age < 0x50) {
      o.vy += o.age * 2;
      o.yaw += 2;
      o.vx = (o.vx * 14) >> 4;
      o.vy = (o.vy * 14) >> 4;
      o.vz = (o.vz * 14) >> 4;
    } else {
      const dx = (o.x - t.x) >> 12;
      const dz = (o.z - t.z) >> 12;
      const d = dx * dx + dz * dz;
      let h = 0x96;
      if (d < 5000) h = !(t.classe & CLASS.FLYING) ? ((d * 7) >> 8) + 10 : ((d * 4) >> 8) + 0x46;
      heliPhysics(o, world.terrain, h, (e) => world.emit(e));
      aircraftTurn(o, t.x >> 8, t.z >> 8, 0x19);
    }
  }
  if (o.hp < 1) aircraftDeath(world, o);
}

/** `gm_hover_follow_terrain` (`00444ef4`) : `vy` pour suivre le relief à `height` unités (frottement 14/16, descente ¼). */
function hoverFollow(world: World, o: GameObject, height: number): void {
  const ground = world.terrain.height(o.x, o.z);
  const ahead = world.terrain.height(o.x + o.vx * 32, o.z + o.vz * 32);
  const e = (Math.max(ground, ahead) >> 8) + height - (o.y >> 8);
  o.vy = (o.vy * 14) >> 4;
  if (e > 0) o.vy += e * 2;
  if (e < 0) o.vy += e >> 2;
}

/**
 * `gm_upd_node_plane` (`0044e758`) : avion 4002 sur les nœuds aériens. Sans cible patrouille à hauteur 40 ; avec une cible, hauteur
 * 70, tir continu, et à l'arrivée choisit le voisin libre le plus proche du joueur.
 */
export function nodePlane(world: World, o: GameObject): void {
  const nodes = world.nodes;
  if (o.node === -1) nodes.claim("air", o);
  if (o.classe === DEPOP_MARK) {
    nodes.release("air", o);
    return;
  }
  if (o.timer > 0) o.timer--;
  acquireTarget(world, o, 40, 4, 4, 2);
  heliPhysics(o, world.terrain, 0x50, (e) => world.emit(e));
  if (o.node >= 0) {
    const nx = nodes.x[o.node]!;
    const nz = nodes.z[o.node]!;
    const dx = nx - (o.x >> 8);
    const dz = nz - (o.z >> 8);
    const d2 = dx * dx + dz * dz;
    if (o.target === o) {
      hoverFollow(world, o, 0x28);
      aircraftTurn(o, nx, nz, 0x19);
      if (d2 < 2000) nodes.patrol("air", o);
    } else {
      hoverFollow(world, o, 0x46);
      aircraftTurnToTarget(o, nx, nz, 0x19);
      enemyFire(world, o);
      if (d2 < 2000) nodes.chase("air", o, o.target);
    }
  }
  if (o.hp < 1) {
    nodes.release("air", o);
    aircraftDeath(world, o);
  }
}

/**
 * `gm_upd_fighter` (`004516f4`) : chasseur de 6300 : cible du générateur (le joueur), vole à hauteur 70, vise un point à ±700 unités
 * du joueur selon son numéro d'orbite (`state`), tire en continu.
 */
export function fighter(world: World, o: GameObject): void {
  if (o.timer > 0) o.timer--;
  o.target = o.owner.target;
  heliPhysics(o, world.terrain, 0x50, (e) => world.emit(e));
  let tx = 0;
  let tz = 0;
  const t = o.target;
  if (t !== o) {
    enemyFire(world, o);
    tx = t.x >> 8;
    tz = t.z >> 8;
    switch (o.state) {
      case 0:
        tx += 700;
        break;
      case 1:
        tz += 700;
        break;
      case 2:
        tx -= 700;
        break;
      case 3:
        tz -= 700;
        break;
    }
    if (t.hp < 1) o.target = o;
  }
  hoverFollow(world, o, 0x46);
  aircraftTurnToTarget(o, tx, tz, 0x19);
  if (o.hp < 1 || o.classe === 0) {
    aircraftDeath(world, o);
    // l'exe libère l'emplacement `+0x5c + 0x1bc + 4n` (le générateur, pas le joueur) : l'emplacement du joueur reste plein
  }
}

/** `gm_upd_fighter_spawner` (`0045199c`) : générateur 6300, au plus 4 chasseurs par joueur sur toute la partie. */
export function fighterSpawner(world: World, o: GameObject): void {
  findNearestPlayer(world, o, 6000000);
  const p = o.target;
  if (p !== o && o.age > 30) {
    const slots = world.game.fighters;
    let n = 0;
    while (n < 4 && slots[n] !== null) n++;
    const rec = o.rec;
    if (n !== 4 && rec) {
      const f = cloneObject(world, o, {
        classe: 0x1033,
        hp: rec.hitPoints,
        model: rec.model,
        update: "fighter",
      });
      if (f) {
        f.x = p.x + SIN[o.yaw & ANGLE_MASK]! * -0x5dc;
        f.z = p.z + COS[o.yaw & ANGLE_MASK]! * -0x5dc;
        f.y += 99999;
        f.param = rec.thrust;
        f.subtype = rec.subtype;
        f.state = n;
        f.target = p;
        f.owner = o;
        slots[n] = f;
      }
    }
    o.age = 0;
  }
}

