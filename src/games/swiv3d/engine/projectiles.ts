/**
 * Comportements des projectiles et des effets : balles (`0044a2d0`, `0044a1a0`, `0044a374`, `0044a430`, `0044a4f8`), missiles
 * (`00456f78`, `00455278`, `004551f0`, `00455190`, `00454ce0`), fusée à phases (`00457d4c`) et sprites d'effet
 * (`00443a70`, `00443c40`, `00443cf4`, `00443db8`, `00443e7c`, `00443f78`, `00444050`, `00444108`, `0044412c`, `0044420c`).
 * Voir `docs/swiv3d/objects.md` §8.3, §10.4.
 */
import {
  AIM_OPTIONS,
  applyAimOption,
  bestAimOption,
  burst,
  directionTo,
  explosionBig,
  forwardVelocity,
  smokeRise,
  smokeTrail,
} from "./combat";
import { ANGLE_MASK, COS, SIN } from "./fixed";
import type { GameObject } from "./objects";
import type { World } from "./world";

const dir = { x: 0, y: 0, z: 0 };

/** Le projectile touche le sol ou n'a plus de pv : il disparaît dans un éclat. Retourne `true` s'il est détruit. */
function groundOrDead(world: World, o: GameObject): boolean {
  if (world.terrain.height(o.x, o.z) >= o.y || o.hp < 1) {
    o.classe = 0;
    burst(world, o);
    return true;
  }
  return false;
}

/** `gm_upd_bullet` (`0044a2d0`) : balle droite, sans durée de vie. */
export function bullet(world: World, o: GameObject): void {
  groundOrDead(world, o);
}

/** `gm_upd_bullet_tracking` (`0044a1a0`) : suiveur, recale sa vitesse vers la cible (norme 8 192) à chaque tick. */
export function bulletTracking(world: World, o: GameObject): void {
  directionTo(o, o.target, dir);
  o.vx = dir.x << 5;
  o.vy = dir.y << 5;
  o.vz = dir.z << 5;
  if (world.terrain.height(o.x, o.z) >= o.y || o.hp < 1) {
    o.classe = 0;
    explosionBig(world, o);
  }
}

/** Fin de vie commune des balles du joueur : sol, pv épuisés ou durée écoulée. */
function playerBullet(world: World, o: GameObject): void {
  o.timer--;
  groundOrDead(world, o);
  if (o.timer === 0) o.classe = 0;
}

/** `gm_upd_bullet_right` (`0044a374`) : balle droite du canon, durée de vie dans `timer`. */
export function bulletRight(world: World, o: GameObject): void {
  playerBullet(world, o);
}

/** `gm_upd_bullet_heavy` (`0044a430`) : balle lourde en cloche (`vy -= 210`). */
export function bulletHeavy(world: World, o: GameObject): void {
  playerBullet(world, o);
  o.vy -= 210;
}

/** `gm_upd_bullet_homing` (`0044a4f8`) : balle à tête chercheuse (5 directions testées, ±2 pas), vitesse avant 4 000. */
export function bulletHoming(world: World, o: GameObject): void {
  playerBullet(world, o);
  if (o.target !== o && o.target.classe !== 0) {
    applyAimOption(o, bestAimOption(o, o.target), 2, 2);
  }
  forwardVelocity(o, 4000);
}

// ---------------------------------------------------------------------------------------------------------------------
// Missiles
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `gm_missile_steer` (`00454ce0`) : vitesse = `speed` selon la classe (0 : 5 000, 2 : 900, 10 : 7 000) dans la direction du cap et
 * du tangage, puis, si la cible n'est ni le tireur ni le missile et que l'âge est < 6, virage de `turn` pas vers la meilleure des
 * 5 directions (classe 1 : vers le haut).
 */
export function missileSteer(
  o: GameObject,
  turn: number,
  cls = 0,
  maxAge = 6,
): void {
  const speed = cls === 2 ? 900 : cls === 10 ? 7000 : 5000;
  forwardVelocity(o, speed);
  if (o.target.classe === 0) o.target = o.owner;
  if (o.target !== o.owner && o.target !== o && o.age < maxAge) {
    const t = o.target;
    let option: number;
    if (cls === 1) {
      // cible fictive à la verticale : même calcul que bestAimOption avec le vecteur (0, 1000, 0)
      option = bestAimOptionVec(o, 0, 1000, 0);
    } else option = bestAimOption(o, t);
    applyAimOption(o, option, turn, turn);
    o.roll = 0;
  }
}

function bestAimOptionVec(o: GameObject, dx: number, dy: number, dz: number): number {
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
    const s = y * dy + x * dx + z * dz;
    if (s > best) {
      best = s;
      bestK = k;
    }
  }
  return bestK;
}

function guidedMissile(
  world: World,
  o: GameObject,
  turn: number,
  trail: number,
): void {
  groundOrDead(world, o);
  missileSteer(o, turn);
  smokeTrail(world, o, trail);
  const old = o.timer;
  o.timer++;
  if (old > 100) o.update = "missile_coast";
}

/** `gm_upd_missile_a` (`00456f78`) : missile faible (virage 1, fumée tous les 6 ticks). */
export function missileA(world: World, o: GameObject): void {
  guidedMissile(world, o, 1, 6);
}

/** `gm_upd_missile_b` (`00455278`) : missile Faucon (virage 4, fumée tous les 3 ticks). */
export function missileB(world: World, o: GameObject): void {
  guidedMissile(world, o, 4, 3);
}

/** `gm_upd_missile_straight` (`004551f0`) : missile du joueur, arme 0 (virage 2, fumée quand l'âge dépasse 4). */
export function missileStraight(world: World, o: GameObject): void {
  guidedMissile(world, o, 2, 4);
}

/** `gm_upd_missile_class10` (`00455300`) : missile du super module (classe 10 : vitesse 7 000, virage 2, fumée tous les 3 ticks), sans durée de vol. */
export function missileClass10(world: World, o: GameObject): void {
  groundOrDead(world, o);
  missileSteer(o, 2, 10);
  smokeTrail(world, o, 3);
}

/** `gm_upd_missile_coast` (`00455190`) : vol libre après 100 ticks, fumée tous les 7 ticks. */
export function missileCoast(world: World, o: GameObject): void {
  groundOrDead(world, o);
  smokeTrail(world, o, 7);
}

/**
 * `gm_steer_to_point` (`00443114`) : cap + {-2, -1, 0, 1, 2} × `rate`, le meilleur vers (tx, tz) Q8. Retourne `true` quand le cap
 * actuel est déjà le meilleur (l'objet est aligné sur le point). Écart : l'exe réécrit sa table de pas à chaque appel (les cases
 * ±2 et +1 gardent la valeur de l'appel précédent pendant l'appel courant) ; ici la table est celle de l'appel courant.
 */
export function steerToPoint(o: GameObject, rate: number, tx: number, tz: number): boolean {
  const dx = (tx - o.x) >> 8;
  const dz = (tz - o.z) >> 8;
  let best = -999999999;
  let bestInc = 0;
  for (let k = -2; k <= 2; k++) {
    const inc = k * rate;
    const y = (o.yaw + inc) & ANGLE_MASK;
    const s = dx * SIN[y]! + COS[y]! * dz;
    if (s > best) {
      best = s;
      bestInc = inc;
    }
  }
  o.yaw += bestInc;
  return bestInc === 0;
}

/** `gm_upd_rocket` (`00457d4c`) : fusée à phases (montée, virages de plus en plus serrés, vol libre). */
export function rocket(world: World, o: GameObject): void {
  o.timer--;
  groundOrDead(world, o);
  smokeTrail(world, o, 3);
  const t = o.target;
  const phase = (n: number): void => {
    o.state++;
    o.timer = n;
  };
  switch (o.state) {
    case 0:
    case 10:
    case 20:
      steerToPoint(o, 5, t.x, t.z);
      if (o.timer < 1) phase(13);
      break;
    case 1:
    case 11:
    case 21:
      missileSteer(o, 14);
      if (o.timer < 1) phase(13);
      break;
    case 2:
      missileSteer(o, 2);
      if (o.timer < 1) {
        o.state++;
        missileSteer(o, 1);
      }
      break;
    case 12:
    case 22:
      missileSteer(o, 2);
      if (o.timer < 1) phase(150);
      break;
    case 13:
      missileSteer(o, 1);
      if (o.timer < 1) o.state++;
      break;
    case 23:
      missileSteer(o, 4);
      if (o.timer < 1) o.state++;
      break;
    default:
      forwardVelocity(o, 5000);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Sprites d'effet
// ---------------------------------------------------------------------------------------------------------------------

/** Avance l'image tous les 3 ticks puis tous les 2 (`age > 1`), disparaît à l'image `end`. */
function animate(o: GameObject, end: number): void {
  if (o.age > 1) {
    o.state++;
    o.age = 0;
  }
  if (o.state === end) o.classe = 0;
}

export function fxBurst(_w: World, o: GameObject): void {
  animate(o, 46);
}
export function fxExplosion(_w: World, o: GameObject): void {
  animate(o, 39);
}
export function fxExplosionSmall(_w: World, o: GameObject): void {
  animate(o, 27);
}
/** `00444050` : traînée de fumée, une image par tick jusqu'à 27. */
export function fxSmokeTrail(_w: World, o: GameObject): void {
  o.state++;
  if (o.state === 27) o.classe = 0;
}
/** `00443f78` : panache suivant son propriétaire, une bouffée montante tous les 16 ticks, 50 ticks. */
export function fxSmokeFollow(world: World, o: GameObject): void {
  const p = o.owner;
  if (p !== o && p.classe !== 0) {
    o.x = p.x;
    o.y = p.y;
    o.z = p.z;
  }
  if ((o.age & 0xf) === 0) smokeRise(world, o);
  if (o.age > 50) o.classe = 0;
}
/** `00443e7c` : bouffée montante (image toutes les 7 ticks, jusqu'à 56). */
export function fxSmokeRise(_w: World, o: GameObject): void {
  if (o.age > 6) {
    o.state++;
    o.age = 0;
  }
  if (o.state === 56) o.classe = 0;
  o.vy -= 15;
  o.vx += 5;
}
/** `00443a70` : décalque d'explosion au sol, 12 images (une tous les 2 ticks). */
export function fxDecal(_w: World, o: GameObject): void {
  if (o.age === 0) o.state = 1;
  if ((o.age & 1) === 0) o.state++;
  if (o.state === 13) o.classe = 0;
}
/** `00444108` : épave, gelée dès le premier tick. */
export function fxWreck(_w: World, o: GameObject): void {
  o.flags |= 0x20;
}

function debrisFall(
  world: World,
  o: GameObject,
  dPitch: number,
  dRoll: number,
  dYaw: number,
  hp: number,
): void {
  o.vy -= 40;
  if (world.terrain.height(o.x, o.z) >= o.y) {
    o.classe = 0;
    burst(world, o);
  }
  o.pitch += dPitch;
  o.roll += dRoll;
  o.yaw += dYaw;
  o.hp = hp;
  o.vx = (o.vx * 31) >> 5;
  o.vz = (o.vz * 31) >> 5;
}
/** `0044412c` : gros éclat (gravité 40, rotation, pv remis à 15 : les éclats blessent). */
export function fxDebris(world: World, o: GameObject): void {
  debrisFall(world, o, 7, 3, 1, 15);
}
/** `0044420c` : petit éclat (pv remis à 10). */
export function fxDebrisSmall(world: World, o: GameObject): void {
  debrisFall(world, o, 11, 6, 2, 10);
}

/** `00449c10` : épave d'avion qui tombe (rotation, gravité 50, pv remis à 100) et explose au sol. */
export function fallingWreck(world: World, o: GameObject): void {
  o.yaw += o.age >> 2;
  o.hp = 100;
  o.vx = (o.vx * 31) >> 5;
  o.vz = (o.vz * 31) >> 5;
  o.vy -= 50;
  if (world.terrain.height(o.x, o.z) >= o.y) {
    o.classe = 0;
    explosionBig(world, o);
  }
}
