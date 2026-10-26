/**
 * Briques communes des comportements : création d'objets (`gm_object_clone` `004261a0`, `gm_object_spawn` mode 2), effets
 * (explosions, fumées, éclats), vitesse locale (`gm_set_local_velocity` `00456814`), ciblage (`gm_acquire_target` `00443938`),
 * visée parmi 5 options (`0044167c`) et score (`gm_score_add` `0042ebc4`). Voir `docs/swiv3d/objects.md` §4, §8, §10.
 */
import { CLASS, FLAG, DEPOP_MARK, GRID_SIZE, groundY, type GameObject } from "./objects";
import { COS, SIN, ANGLE_MASK, normalize256, wrapQ8 } from "./fixed";
import { RANDOM_COUNT, RANDOM_TABLE } from "./random-table";
import type { World } from "./world";

/** Classe des décalques, fumées et explosions (`0xe1` : vivant, dépeuplable, sans collision, « neuf »). */
export const FX_CLASS = 0xe1;
/** Classe des projectiles (`0x3b` : vivant, solide, dangereux, en vol, dépeuplable). */
export const PROJECTILE_CLASS = 0x3b;
/** Classe de masque 0x44 = 4 : les joueurs (bit 0x04 posé, bit 0x40 absent). */
export const TARGET_MASK = 4;

/** Sons de `SOUNDS.BD` (`audio/catalog.ts`). */
export const SND = {
  bigExplosion: 1000,
  smallExplosion: 1001,
  fall: 1003,
  missile: 2000,
  enemyShot: 2001,
  enemyBullets: 2002,
  enemyShell: 2003,
  beam700: 2004,
  beam701: 2005,
  gauge: 4001,
  armed: 3000,
  retract: 3001,
  podDrop: 3002,
  pickupAir: 4000,
  pickupGround: 4002,
} as const;

export function sound(world: World, id: number, o: GameObject): void {
  world.emit({ kind: "sound", id, x: o.x, y: o.y, z: o.z });
}

/**
 * `gm_set_local_velocity` (`00456814`) : vitesse de `o` à partir de (latéral, vertical, avant) dans le repère de son cap et de son
 * tangage ; les composantes sont en 1/256 d'unité par tick. Avant = `(sin cap, ·, cos cap)`, latéral positif = à droite.
 */
export function localVelocity(
  o: GameObject,
  lat: number,
  vert: number,
  fwd: number,
): void {
  const np = -o.pitch & ANGLE_MASK;
  const ny = -o.yaw & ANGLE_MASK;
  const sp = SIN[np]!;
  const cp = COS[np]!;
  const sy = SIN[ny]!;
  const cy = COS[ny]!;
  const vy = (vert * cp - fwd * sp) >> 8;
  const h = (vert * sp + fwd * cp) >> 8;
  o.vx = (lat * cy - h * sy) >> 8;
  o.vy = vy;
  o.vz = (lat * sy + h * cy) >> 8;
}

/** Vecteur « avant » de longueur `speed` Q8 pour le cap et le tangage de `o` (vitesse des missiles, `00454ce0`). */
export function forwardVelocity(o: GameObject, speed: number): void {
  localVelocity(o, 0, 0, speed);
}

/**
 * `gm_object_clone` (`004261a0`) : nouvel objet à la position, à la vitesse, au cap, à la cible et au minuteur de `parent` ;
 * état, sous-type et âge à 0, propriétaire = `parent`. Le type du bloc 105 n'est pas copié (`rec` = null).
 */
export function cloneObject(
  world: World,
  parent: GameObject,
  init: { classe: number; hp: number; model: number; update: string },
): GameObject | null {
  const o = world.pool.alloc();
  if (!o) return null;
  o.x = parent.x;
  o.y = parent.y;
  o.z = parent.z;
  o.vx = parent.vx;
  o.vy = parent.vy;
  o.vz = parent.vz;
  o.yaw = parent.yaw;
  o.pitch = parent.pitch;
  o.roll = parent.roll;
  o.param = parent.param;
  o.timer = parent.timer;
  o.target = parent.target;
  o.flags = FLAG.NEW;
  o.age = 0;
  o.node = -1;
  o.state = 0;
  o.subtype = 0;
  o.owner = parent;
  o.rec = null;
  o.classe = init.classe;
  o.hp = init.hp;
  o.model = init.model;
  o.update = init.update;
  world.grid.insert(o);
  return o;
}

/** `gm_object_spawn` mode 2 : objet posé sur le terrain en (x, z) Q8 (le pied du modèle touche le sol). */
export function spawnOnGround(
  world: World,
  init: {
    x: number;
    z: number;
    yaw?: number;
    classe: number;
    hp: number;
    model: number;
    update: string;
  },
): GameObject | null {
  const o = world.pool.alloc();
  if (!o) return null;
  o.x = wrapQ8(init.x);
  o.z = wrapQ8(init.z);
  o.y = groundY(world.terrain, world.models, init.model, o.x, o.z);
  o.yaw = init.yaw ?? 0;
  o.timer = 10;
  o.flags = FLAG.NEW;
  o.classe = init.classe;
  o.hp = init.hp;
  o.model = init.model;
  o.update = init.update;
  world.grid.insert(o);
  return o;
}

// ---------------------------------------------------------------------------------------------------------------------
// Effets : explosions, fumées (objets de modèle 11000-11004, `+0x50` = image du sprite)
// ---------------------------------------------------------------------------------------------------------------------

function fx(
  world: World,
  parent: GameObject,
  model: number,
  frame: number,
  update: string,
): GameObject | null {
  const e = cloneObject(world, parent, {
    classe: FX_CLASS,
    hp: 100,
    model,
    update,
  });
  if (!e) return null;
  e.vx = e.vy = e.vz = 0;
  e.state = frame;
  return e;
}

/** `00443d3c` : grande explosion (11003, images 27 à 39) et son 1001. */
export function explosionBig(world: World, parent: GameObject): void {
  fx(world, parent, 11003, 27, "fx_explosion");
  sound(world, SND.smallExplosion, parent);
}

/** `00443e00` : petite explosion (11002, images 13 à 27) et son 1003. */
export function explosionSmall(world: World, parent: GameObject): void {
  fx(world, parent, 11002, 13, "fx_explosion_small");
  sound(world, SND.fall, parent);
}

/** `00443c88` : éclat d'impact d'un projectile (11000, images 39 à 46). */
export function burst(world: World, parent: GameObject): void {
  fx(world, parent, 11000, 39, "fx_burst");
}

/** `00443fe4` : panache de fumée suivant `parent` pendant 50 ticks (11004, image 55). */
export function smokePlume(world: World, parent: GameObject): void {
  fx(world, parent, 11004, 55, "fx_smoke_follow");
}

/** `00444084` : traînée de fumée de missile (11001) quand l'âge dépasse `threshold`. */
export function smokeTrail(
  world: World,
  o: GameObject,
  threshold: number,
): void {
  if (o.age > threshold) {
    fx(world, o, 11001, 13, "fx_smoke_trail");
    o.age = 0;
  }
}

/** Tirage dans la table pseudo-aléatoire de l'exe : triplet `(x, y, z)` à l'index courant ; l'index avance de 1. */
export function nextRandom(
  world: World,
  out: { x: number; y: number; z: number },
): void {
  const i = world.game.randomIndex * 3;
  out.x = RANDOM_TABLE[i]!;
  out.y = RANDOM_TABLE[i + 1]!;
  out.z = RANDOM_TABLE[i + 2]!;
  world.game.randomIndex = (world.game.randomIndex + 1) & (RANDOM_COUNT - 1);
}

const rnd = { x: 0, y: 0, z: 0 };

/** `00443ed0` : bouffée de fumée montante (11004, images 46 à 56). */
export function smokeRise(world: World, parent: GameObject): void {
  const e = fx(world, parent, 11004, 46, "fx_smoke_rise");
  if (!e) return;
  nextRandom(world, rnd);
  e.vx = rnd.x >> 4;
  e.vz = rnd.z >> 4;
  e.vy = rnd.y + 500;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ciblage
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `gm_acquire_target` (`00443938`) : tous les `period` ticks (×4 si une cible est déjà tenue), cherche dans les `(2r + 1)²` cellules
 * autour de `o` l'objet dont `classe & (mask | 0x40) == value` le plus proche (distance 3D / 4 au carré < 400 000, soit 2 530
 * unités) ; la cible est le propriétaire racine de l'objet trouvé. Sans résultat `o.target = o`.
 */
export function acquireTarget(
  world: World,
  o: GameObject,
  period: number,
  mask: number,
  value: number,
  radius: number,
): void {
  const p = o.target !== o ? period << 2 : period;
  if (p >= o.age) return;
  o.target = o;
  o.age = 0;
  let best = 400000;
  const cx = o.x >> 17;
  const cz = o.z >> 17;
  const m = mask | CLASS.GHOST;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const list =
        world.grid.cells[
          ((cz + dz) & (GRID_SIZE - 1)) * GRID_SIZE +
            ((cx + dx) & (GRID_SIZE - 1))
        ]!;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]!;
        if (c === o || (c.classe & m) !== value) continue;
        const a = (c.x - o.x) >> 10;
        const b = (c.y - o.y) >> 10;
        const d = (c.z - o.z) >> 10;
        const d2 = a * a + b * b + d * d;
        if (d2 < best) {
          best = d2;
          o.target = c.owner;
        }
      }
    }
  }
}

/**
 * `gm_find_nearest_player` (`0043c164`) : le joueur s'il est vivant (pas de bit 0x40) et à moins de `maxD2` (distance 2D en
 * unités au carré), sinon `o` lui-même ; écrit `o.target`.
 */
export function findNearestPlayer(
  world: World,
  o: GameObject,
  maxD2: number,
): void {
  const p = world.player.obj;
  o.target = o;
  const dx = (o.x - p.x) >> 8;
  const dz = (o.z - p.z) >> 8;
  if (!(p.classe & CLASS.GHOST) && dx * dx + dz * dz < maxD2) o.target = p;
}

// ---------------------------------------------------------------------------------------------------------------------
// Visée
// ---------------------------------------------------------------------------------------------------------------------

/** Table `00484238` : 5 directions candidates (latéral, vertical, avant) : droit devant, gauche, droite, haut, bas. */
export const AIM_OPTIONS: readonly (readonly [number, number, number])[] = [
  [0, 0, 1000],
  [-44, 0, 999],
  [44, 0, 999],
  [0, 44, 999],
  [0, -44, 999],
];

/**
 * Meilleure des 5 options de `AIM_OPTIONS` (produit scalaire de la direction candidate, dans le repère du cap et du tangage de
 * `o`, avec le vecteur vers `target`) : 0 tout droit, 1 gauche, 2 droite, 3 haut, 4 bas (`0044167c`, `0044ac88`).
 */
export function bestAimOption(o: GameObject, target: GameObject): number {
  const dx = target.x - o.x;
  const dy = target.y - o.y;
  const dz = target.z - o.z;
  const np = -o.pitch & ANGLE_MASK;
  const ny = -o.yaw & ANGLE_MASK;
  const sp = SIN[np]!;
  const cp = COS[np]!;
  const sy = SIN[ny]!;
  const cy = COS[ny]!;
  let best = -999999999;
  let bestK = 8;
  for (let k = 0; k < 5; k++) {
    const [lat, vert, fwd] = AIM_OPTIONS[k]!;
    const y = (vert * cp - fwd * sp) >> 8;
    const h = (vert * sp + fwd * cp) >> 8;
    const x = (lat * cy - h * sy) >> 8;
    const z = (lat * sy + h * cy) >> 8;
    const score = y * dy + x * dx + z * dz;
    if (score > best) {
      best = score;
      bestK = k;
    }
  }
  return bestK;
}

/** Applique l'option de visée : 1 cap − `yawStep`, 2 cap + `yawStep`, 3 tangage + `pitchStep`, 4 tangage − `pitchStep`. */
export function applyAimOption(
  o: GameObject,
  option: number,
  yawStep: number,
  pitchStep: number,
): void {
  if (option === 1) o.yaw -= yawStep;
  else if (option === 2) o.yaw += yawStep;
  else if (option === 3) o.pitch += pitchStep;
  else if (option === 4) o.pitch -= pitchStep;
}

/** `gm_turn_toward_target` (`00441af4`) : cap ± `step` vers la cible (en x, z), le meilleur des trois. */
export function turnToward(o: GameObject, target: GameObject, step: number): void {
  const dx = (target.x >> 8) - (o.x >> 8);
  const dz = (target.z >> 8) - (o.z >> 8);
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
}

/**
 * Secteur (0 à 7, pas de 45°) du point (tx, tz) en unités par rapport au cap de `o` (`00442398` : parmi 8 caps à pas de 64, celui
 * qui regarde le mieux le point). 0 = devant, 2 = à droite, 4 = derrière, 6 = à gauche.
 */
function sectorToward(o: GameObject, tx: number, tz: number): number {
  const dx = tx - (o.x >> 8);
  const dz = tz - (o.z >> 8);
  let best = -999999999;
  let sector = 0;
  for (let k = 0; k < 8; k++) {
    const y = o.yaw + 0x40 * k;
    const s = dx * SIN[y & ANGLE_MASK]! + COS[y & ANGLE_MASK]! * dz;
    if (s > best) {
      best = s;
      sector = k;
    }
  }
  return sector;
}

/** Tangage et roulis des virages d'avion selon le secteur ; retourne la variation de cap de `004420a4` (variante 1). */
function bankFor(o: GameObject, sector: number, limit: number): number {
  switch (sector) {
    case 0:
      if (-limit < o.pitch) o.pitch -= 4;
      return 0;
    case 1:
      if (-limit < o.pitch) o.pitch -= 3;
      if (o.roll < limit) o.roll += 5;
      return 3;
    case 2:
      if (o.roll < limit) o.roll += 6;
      return 4;
    case 3:
      if (o.pitch < limit) o.pitch += 3;
      if (o.roll < limit) o.roll += 5;
      return 4;
    case 4:
      if (o.pitch < limit) o.pitch += 4;
      return 4;
    case 5:
      if (o.pitch < limit) o.pitch += 3;
      if (-limit < o.roll) o.roll -= 5;
      return -4;
    case 6:
      if (-limit < o.roll) o.roll -= 6;
      return -4;
    default:
      if (-limit < o.pitch) o.pitch -= 3;
      if (-limit < o.roll) o.roll -= 5;
      return -3;
  }
}

/**
 * `gm_aircraft_turn_to_point` (`004420a4`) : virage vers (tx, tz) en unités : cap + 3 à 4 pas selon le secteur, tangage et roulis
 * bornés à `limit` ; secteur 0 : réglage fin du cap (±2).
 */
export function aircraftTurn(o: GameObject, tx: number, tz: number, limit: number): void {
  const sector = sectorToward(o, tx, tz);
  o.yaw &= ANGLE_MASK;
  const d = bankFor(o, sector, limit);
  if (sector !== 0) {
    o.yaw += d;
    return;
  }
  const dx = tx - (o.x >> 8);
  const dz = tz - (o.z >> 8);
  let best = -999999999;
  let bestYaw = o.yaw;
  for (let k = -1; k <= 1; k++) {
    const y = o.yaw + k * 2;
    const s = dx * SIN[y & ANGLE_MASK]! + COS[y & ANGLE_MASK]! * dz;
    if (s > best) {
      best = s;
      bestYaw = y;
    }
  }
  o.yaw = bestYaw;
}

/**
 * `gm_aircraft_turn_to_point2` (`00442398`) : même tangage et roulis, mais le cap est réglé par `turnToward` vers la cible de
 * l'objet (`+0x58`, soi-même s'il n'en a pas : l'avion tourne alors de 8 pas par tick).
 */
export function aircraftTurnToTarget(o: GameObject, tx: number, tz: number, limit: number): void {
  const sector = sectorToward(o, tx, tz);
  o.yaw &= ANGLE_MASK;
  bankFor(o, sector, limit);
  turnToward(o, o.target, 8);
}

// ---------------------------------------------------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `gm_score_add` (`0042ebc4`) : crédite `points` au joueur propriétaire du dernier agresseur de `victim` (`target` → racine) ;
 * rien si cette racine n'est pas un joueur (`classe & 0x20c == 0x204`).
 */
export function scoreAdd(world: World, victim: GameObject, points: number): void {
  const root = victim.target.owner.owner;
  if ((root.classe & 0x20c) !== 0x204) return;
  world.game.addScore(points);
  world.emit({ kind: "scoreChanged", score: world.game.score, delta: points });
}

/** Vecteur de longueur 256 vers `to` depuis `from` (écarts décalés de 6, `gm_vec_normalize256`). */
export function directionTo(
  from: GameObject,
  to: GameObject,
  out: { x: number; y: number; z: number },
): void {
  normalize256(
    (to.x - from.x) >> 6,
    (to.y - from.y) >> 6,
    (to.z - from.z) >> 6,
    out,
  );
}

/** Marque d'un objet en cours de dépeuplement (classe -1 pendant l'appel du comportement). */
export function isDepopulating(o: GameObject): boolean {
  return o.classe === DEPOP_MARK;
}
