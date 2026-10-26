/**
 * Programmes d'armes des ennemis (`gm_enemy_fire`, `0046d1f8`) : un `switch` sur le code d'arme de l'objet (`+0x54`). La fonction
 * est appelée à chaque tick dès qu'il y a une cible ; le minuteur `+0x14` (décrémenté par le comportement) déclenche les tirs et
 * est rechargé par l'arme. Les projectiles sont des clones de classe `0x3b` dont les pv sont les dégâts.
 * Voir `docs/swiv3d/objects.md` §8.2.
 */
import {
  PROJECTILE_CLASS,
  SND,
  cloneObject,
  directionTo,
  localVelocity,
  sound,
} from "./combat";
import { COS, SIN } from "./fixed";
import type { GameObject } from "./objects";
import type { World } from "./world";

/** Modèles de sprite des balles (`0x2710`…) : 10000 à 10005 (planche GLOBAL 505). */
export const SPRITE_BULLET_A = 10000;
export const SPRITE_BULLET_B = 10001;
export const SPRITE_BULLET_C = 10005;
/** Modèles 3D de missile (`0x320`, `0x321`). */
export const MODEL_MISSILE_A = 800;
export const MODEL_MISSILE_B = 801;

const dir = { x: 0, y: 0, z: 0 };

/** Balle simple : clone de classe 0x3b, vitesse locale (latéral, vertical, avant). */
function bullet(
  world: World,
  o: GameObject,
  model: number,
  hp: number,
  lat: number,
  vert: number,
  fwd: number,
  update = "bullet",
): GameObject | null {
  const b = cloneObject(world, o, {
    classe: PROJECTILE_CLASS,
    hp,
    model,
    update,
  });
  if (b) localVelocity(b, lat, vert, fwd);
  return b;
}

/** Balle visée : direction vers la cible × 32 (norme 8 192), sans prédiction. */
function aimed(
  world: World,
  o: GameObject,
  model: number,
  hp: number,
  update = "bullet",
): GameObject | null {
  const b = cloneObject(world, o, {
    classe: PROJECTILE_CLASS,
    hp,
    model,
    update,
  });
  if (!b) return null;
  directionTo(o, o.target, dir);
  b.vx = dir.x << 5;
  b.vy = dir.y << 5;
  b.vz = dir.z << 5;
  return b;
}

/** Décale `b` de ±8 unités sur le côté du tireur (cap + 128). */
function sideOffset(b: GameObject, o: GameObject, sign: number): void {
  b.x += SIN[(o.yaw + 0x80) & 0x1ff]! * 8 * sign;
  b.z += COS[(o.yaw + 0x80) & 0x1ff]! * 8 * sign;
}

function missile(
  world: World,
  o: GameObject,
  model: number,
  update: string,
  sign: number,
): void {
  const m = cloneObject(world, o, {
    classe: PROJECTILE_CLASS,
    hp: 55,
    model,
    update,
  });
  if (m && sign !== 0) sideOffset(m, o, sign);
  sound(world, SND.missile, o);
}

/**
 * Programme d'arme de `o` (`o.subtype`, `o.target`, `o.timer`). Les codes absents des niveaux livrés (109, 120, 500, 510…) sont
 * portés d'après la décompilation ; `501` est un doublon de `500` en balles 10001 (la décompilation ne donne pas de cas propre).
 */
export function enemyFire(world: World, o: GameObject): void {
  const t = o.timer;
  switch (o.subtype) {
    case 100:
      if (t === 0) {
        bullet(world, o, SPRITE_BULLET_C, 35, 0, 0, 9000);
        sound(world, SND.enemyShot, o);
        o.timer = 50;
      }
      break;
    case 101:
      if (t === 1 || t === 5 || t === 10) {
        bullet(world, o, SPRITE_BULLET_C, 35, 200, 0, 9300);
        bullet(world, o, SPRITE_BULLET_C, 35, -200, 0, 9300);
        sound(world, SND.enemyShot, o);
      }
      if (t === 0) o.timer = 120;
      break;
    case 109:
      if (t === 0 || t === 3) {
        bullet(world, o, SPRITE_BULLET_A, 45, 0, 0, 9000);
        sound(world, SND.enemyBullets, o);
      }
      if (t === 0) o.timer = 15;
      break;
    case 110:
      if (t === 1 || t === 5) {
        bullet(world, o, SPRITE_BULLET_A, 45, 0, 0, 9000);
        sound(world, SND.enemyBullets, o);
      }
      if (t === 0) o.timer = 35;
      break;
    case 111:
      if (t === 7) {
        bullet(world, o, SPRITE_BULLET_A, 45, 0, 150, 9500);
        sound(world, SND.enemyBullets, o);
      }
      if (t === 4) {
        bullet(world, o, SPRITE_BULLET_A, 45, -100, 0, 9500);
        sound(world, SND.enemyBullets, o);
      }
      if (t === 1) {
        bullet(world, o, SPRITE_BULLET_A, 45, 100, 0, 9500);
        sound(world, SND.enemyBullets, o);
      }
      if (t === 0) o.timer = 33;
      break;
    case 112:
      if (t === 1 || t === 3 || t === 5 || t === 7) {
        const m = (12 - t) * 64;
        bullet(world, o, SPRITE_BULLET_A, 35, m, 0, 9300);
        bullet(world, o, SPRITE_BULLET_A, 35, -m, 0, 9300);
        bullet(world, o, SPRITE_BULLET_A, 35, 0, m, 9300);
        bullet(world, o, SPRITE_BULLET_A, 35, 0, -m, 9300);
        sound(world, SND.enemyBullets, o);
      }
      if (t === 0) o.timer = 120;
      break;
    case 120:
      if (t < 20 && (t & 1) === 0) {
        const m = (t & 0xf) << 5;
        bullet(world, o, SPRITE_BULLET_B, 60, SIN[m]! * 2, 0, 7000);
        if ((t & 3) === 0) sound(world, SND.enemyBullets, o);
        if (t === 0) o.timer = 150;
      }
      break;
    case 121:
      if (t < 35 && (t & 1) === 0) {
        const m = (t & 0xf) << 5;
        bullet(world, o, SPRITE_BULLET_B, 60, SIN[m]!, COS[m]!, 7000);
        if ((t & 3) === 0) sound(world, SND.enemyBullets, o);
        if (t === 0) o.timer = 150;
      }
      break;
    case 400:
      if (t === 0) {
        bullet(world, o, MODEL_MISSILE_A, 55, 0, 0, 5000);
        sound(world, SND.enemyShell, o);
        o.timer = 37;
      }
      break;
    case 405:
      if (t === 0) {
        missile(world, o, MODEL_MISSILE_A, "missile_a", 0);
        o.timer = 39;
      }
      break;
    case 408:
      if (t === 0) {
        missile(world, o, MODEL_MISSILE_B, "missile_b", 0);
        o.timer = 41;
      }
      break;
    case 500:
    case 501: {
      if (t === 0) {
        const model = o.subtype === 500 ? SPRITE_BULLET_C : SPRITE_BULLET_B;
        const hp = o.subtype === 500 ? 35 : 45;
        for (const sign of [1, -1]) {
          const b = bullet(world, o, model, hp, 0, 0, 9000);
          if (b) sideOffset(b, o, sign);
        }
        sound(world, o.subtype === 500 ? SND.enemyShot : SND.enemyBullets, o);
        o.timer = o.subtype === 500 ? 50 : 47;
      }
      break;
    }
    case 510:
      if (t === 0) {
        missile(world, o, MODEL_MISSILE_A, "missile_a", 1);
        o.timer = 39;
      }
      if (t === 1) missile(world, o, MODEL_MISSILE_A, "missile_a", -1);
      break;
    case 511:
      if (t === 0) {
        missile(world, o, MODEL_MISSILE_B, "missile_b", 1);
        o.timer = 41;
      }
      if (t === 1) missile(world, o, MODEL_MISSILE_B, "missile_b", -1);
      break;
    case 600:
      if (t === 0) {
        aimed(world, o, SPRITE_BULLET_B, 50);
        o.timer = 60;
        sound(world, SND.enemyBullets, o);
      }
      break;
    case 601:
      if (t === 0 || t === 5) {
        aimed(world, o, SPRITE_BULLET_B, 50);
        if (t === 0) {
          o.timer = 45;
          sound(world, SND.enemyBullets, o);
        }
      }
      break;
    case 602:
      if (t === 0) {
        aimed(world, o, SPRITE_BULLET_C, 25);
        o.timer = 55;
        sound(world, SND.enemyBullets, o);
      }
      break;
    case 603:
      if (t === 0 || t === 5) {
        aimed(world, o, SPRITE_BULLET_C, 35);
        if (t === 0) {
          o.timer = 40;
          sound(world, SND.enemyBullets, o);
        }
      }
      break;
    case 610:
    case 611:
    case 612:
      if (t === 0) {
        const r = cloneObject(world, o, {
          classe: PROJECTILE_CLASS,
          hp: 50,
          model: MODEL_MISSILE_B,
          update: "rocket",
        });
        if (r) {
          r.state = (o.subtype - 610) * 10;
          r.vx = 0;
          r.vy = 600;
          r.vz = 0;
          r.timer = 40;
          r.pitch = 128;
        }
        o.timer = 60;
        sound(world, SND.missile, o);
      }
      break;
    case 666:
      if (t === 0 || t === 5) {
        aimed(world, o, SPRITE_BULLET_C, 1, "bullet_tracking");
        if (t === 0) {
          o.timer = 40;
          sound(world, SND.enemyBullets, o);
        }
      }
      break;
    case 700:
    case 701:
      beam(world, o, o.subtype === 700);
      break;
    default:
      break;
  }
}

/**
 * Faisceaux 700 (cycle de 100 ticks, 11 pv toutes les 8 ticks sous 30) et 701 (cycle de 110, 19 pv sous 40) : aucun projectile,
 * la cible perd des pv directement, est repoussée et clignote (`flags |= 2`).
 */
function beam(world: World, o: GameObject, small: boolean): void {
  const cycle = small ? 100 : 110;
  const soundAt = small ? 30 : 40;
  const damage = small ? 11 : 19;
  if (o.timer === 0) o.timer = cycle;
  if (o.timer === soundAt) sound(world, small ? SND.beam700 : SND.beam701, o);
  if (o.timer < soundAt && (o.timer & 7) === 0) {
    const t = o.target;
    t.hp -= damage;
    t.flags |= 0x02;
    directionTo(o, t, dir);
    t.vx += dir.x * 8;
    t.vy += dir.y * 8;
    t.vz += dir.z * 8;
    if (t === world.player.obj)
      world.emit({ kind: "playerDamaged", amount: damage, source: "contact" });
  }
}
