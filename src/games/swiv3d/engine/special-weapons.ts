/**
 * Comportements de vol des armes spéciales du joueur, portés de l'exe : missile accroché (`gm_upd_missile_attached` `00455124`),
 * nacelle larguée (`gm_upd_pod_dropped` `00458064`), missile de croisière (`gm_upd_cruise_missile` `00455a98`), bombe et méga-bombe
 * (`gm_upd_bomb_fly` `00455370`, `gm_upd_bomb_shockwave` `004556dc`), mortier (`gm_upd_mortar` `00457074`), super nova
 * (`gm_upd_super_nova` `0045754c`), nucléateur (`gm_upd_nucleator` `00457abc` et ses sous-munitions `0045789c`), napalm et super napalm
 * (`gm_upd_napalm` `00457784`, `gm_upd_super_napalm` `00457bcc`) et goutte de napalm (`00457000`). Les missiles à tête chercheuse
 * (`gm_upd_missile_*`) sont dans `projectiles.ts`. Voir `docs/swiv3d/rules.md` §3.
 *
 * Écarts assumés : l'exe ne laisse exploser le mortier et ne déclenche l'onde de la bombe que si la réserve de déformations du
 * terrain n'est pas vide (liste libre `00587714` des 5 nœuds de `gm_deformers_apply`, `render.md` §10, rendus au bout de leur
 * durée par `gm_game_tick`) ; le moteur n'a pas ces déformations, la réserve est donc considérée comme toujours disponible.
 */
import {
  PROJECTILE_CLASS,
  burst,
  cloneObject,
  explosionSmall,
  localVelocity,
  nextRandom,
  smokeTrail,
} from "./combat";
import { explodeHeavy } from "./enemies";
import { ANGLE_MASK, COS, SIN, normalize256 } from "./fixed";
import { CLASS, FLAG, type GameObject } from "./objects";
import type { World } from "./world";

/** Classe des projectiles du joueur : `0x3f` = `0x3b` + bit 0x04 (`MOV EAX,0x3f` des clones du joueur et des compagnons). */
export const PLAYER_PROJECTILE_CLASS = 0x3f;

const rnd = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

/** Le projectile touche le sol ou n'a plus de pv : disparition dans un éclat. */
function groundOrDead(world: World, o: GameObject): boolean {
  if (world.terrain.height(o.x, o.z) >= o.y || o.hp < 1) {
    o.classe = 0;
    burst(world, o);
    return true;
  }
  return false;
}

/**
 * Asservissement vertical des projectiles « rasants » : relief le plus haut entre la position et celle 32 ticks plus loin, consigne
 * `hover` unités au-dessus, accélération `d · up` (`d > 0`) ou `d · down` (`d < 0`), frottement 29/32.
 */
export function hoverFollow(world: World, o: GameObject, hover: number, up: number, down: number): void {
  const here = world.terrain.height(o.x, o.z);
  const ahead = world.terrain.height(o.x + (o.vx << 5), o.z + (o.vz << 5));
  const d = (Math.max(here, ahead) >> 8) + hover - (o.y >> 8);
  if (d > 0) o.vy += d * up;
  if (d < 0) o.vy += d * down;
  o.vy = (o.vy * 29) >> 5;
}

// ---------------------------------------------------------------------------------------------------------------------
// Accrochage
// ---------------------------------------------------------------------------------------------------------------------

/** `gm_upd_missile_attached` (`00455124`) : prend les angles du propriétaire et ne bouge plus (la position est posée par le tir). */
export function missileAttached(_world: World, o: GameObject): void {
  const p = o.owner;
  o.yaw = p.yaw;
  o.pitch = p.pitch;
  o.roll = p.roll;
  o.vx = o.vy = o.vz = 0;
}

/** `gm_upd_pod_dropped` (`00458064`) : nacelle vide larguée, chute (`vy -= 20`) en tournant ; `state` 0 / 1 = sens de rotation. */
export function podDropped(world: World, o: GameObject): void {
  o.vy -= 0x14;
  groundOrDead(world, o);
  if (o.state === 0) {
    o.pitch += 3;
    o.yaw += 5;
    o.roll += 6;
  } else {
    o.pitch += 3;
    o.yaw -= 5;
    o.roll -= 6;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Missile de croisière (armes 3 et 13)
// ---------------------------------------------------------------------------------------------------------------------

/** `00484564` : écarts de cap candidats (7 pas) et `00484580` : variations de vitesse correspondantes. */
const CRUISE_TURN = [0, -1, 1, -5, 5, -15, 15] as const;
const CRUISE_SPEED = [20, -3, 3, 0, 0, -20, -20] as const;

/**
 * `gm_upd_cruise_missile` (`00455a98`). `timer` (`+0x14`) est la vitesse (`sin(cap) · timer >> 8`), initialement 300, +10 par tick
 * tant qu'il n'a pas de cible. `state` (`+0x50`) : 10 / 11 (spirale à droite / à gauche pendant 30 ticks, arme 3), 0x14 / 0x15
 * (spirale plus serrée, arme 13) puis 0x16 (ralenti jusqu'à l'appui sur le tir principal) ; 0x1e, 0x28, 0x29 : guidage sur la cible
 * (0x1e : cible figée au tir ; 0x28 : cible du joueur, perdue → 0x29).
 */
export function cruiseMissile(world: World, o: GameObject): void {
  groundOrDead(world, o);
  o.pitch = 0;
  o.roll = 0;
  hoverFollow(world, o, 0x5a, 4, 2);
  o.vx = (SIN[o.yaw & ANGLE_MASK]! * o.timer) >> 8;
  o.vz = (COS[o.yaw & ANGLE_MASK]! * o.timer) >> 8;
  o.pitch = Math.max(-0x46, Math.min(0x46, o.vy >> 5));
  const owner = o.owner;
  const spiral = (right: number, left: number, next: number): void => {
    o.yaw += o.age < 10 ? right : left;
    if (o.age > 0x1e) o.state = next;
  };
  switch (o.state) {
    case 10:
      spiral(6, -3, 0x1e);
      break;
    case 11:
      spiral(-6, 3, 0x1e);
      break;
    case 0x14:
      spiral(8, -4, 0x16);
      break;
    case 0x15:
      spiral(-8, 4, 0x16);
      break;
    case 0x16:
      o.vx = (o.vx * 14) >> 4;
      o.vz = (o.vz * 14) >> 4;
      if (world.player.firePrimaryHeld) {
        o.state = 0x28;
        o.target = owner.target;
      }
      break;
    case 0x1e:
      smokeTrail(world, o, 3);
      break;
    case 0x28:
      smokeTrail(world, o, 3);
      if (o.target === owner) o.state = 0x29;
      break;
    case 0x29:
      if (o.target === owner) o.target = owner.target;
      if (o.target !== owner) o.state = 0x28;
      o.vx = (o.vx * 14) >> 4;
      o.vz = (o.vz * 14) >> 4;
      break;
  }
  if (o.state === 0x1e || o.state === 0x28) {
    if (o.target === owner) {
      o.timer += 10;
      if (o.state === 0x28) o.target = owner.target;
    } else {
      const t = o.target;
      const dx = (t.x - o.x) >> 5;
      const dz = (t.z - o.z) >> 5;
      let best = -99999999;
      let bestK = 0;
      for (let k = 0; k < 7; k++) {
        const a = (o.yaw + CRUISE_TURN[k]!) & ANGLE_MASK;
        const score = SIN[a]! * dx + COS[a]! * dz;
        if (best < score) {
          bestK = k;
          best = score;
        }
      }
      if (dx * dx + dz * dz < 90000) o.vy += (t.y - o.y) >> 6;
      o.yaw += CRUISE_TURN[bestK]!;
      o.timer += CRUISE_SPEED[bestK]!;
      o.roll = CRUISE_TURN[bestK]! << 3;
      if (t.classe === 0) o.target = owner;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Bombe (arme 7) et méga-bombe (arme 17)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Objets de `gm_grid_query(radius, 0)` (`0042ae7c`) : tous les objets (sauf `o`) des `(2·radius + 1)²` cellules de la grille autour de
 * `o`, y compris ceux de la cellule en cours de traitement qui n'ont pas encore été remis dans la grille (l'exe les retrouve en
 * suivant la liste détachée après `o`). Parcourt le pool : la cellule est celle où l'objet a été inséré en dernier.
 */
function allAround(world: World, o: GameObject, radius: number): GameObject[] {
  const out: GameObject[] = [];
  const cx = (o.x >> 17) & 63;
  const cz = (o.z >> 17) & 63;
  for (const c of world.pool.objects) {
    if (c.classe === 0 || c === o || c.cell < 0) continue;
    const dx = ((((c.cell & 63) - cx + 32) & 63) - 32);
    const dz = ((((c.cell >> 6) - cz + 32) & 63) - 32);
    if (dx >= -radius && dx <= radius && dz >= -radius && dz <= radius) out.push(c);
  }
  return out;
}

/** Même requête restreinte à `(classe & mask) === 0` (`gm_grid_query(radius, mask)`). */
function queryFree(world: World, o: GameObject, radius: number, mask: number): GameObject[] {
  return allAround(world, o, radius).filter((c) => (c.classe & mask) === 0);
}

function hit(c: GameObject, damage: number): void {
  c.hp -= damage;
  if (c.hp < 0) c.hp = 0;
  c.flags = (c.flags | FLAG.FLASH) & 0x3df;
}

/**
 * `gm_upd_bomb_fly` (arme 7) et `gm_upd_bomb_shockwave` (arme 17). Phase de vol (`state` 0) : cap + 10 (15), tangage 20 (40),
 * vitesse × 30/32, lancée à 32 unités/tick dans le cap du joueur au premier tick (la bombe devient un fantôme `0x40`), rasante à
 * 40 unités du relief ; après 40 ticks : éclat, le modèle disparaît, `timer` = 40 (60) et phase d'onde (`state` 1). Onde : un tick
 * sur deux, chaque objet des 9 × 9 cellules (le joueur compris) à `d = (dx² + dz²) >> 9 + (timer - 20) · 64` dans ]0, 255[ perd
 * `sin(d) · timer >> 6` pv (bombe) ; méga-bombe : `d = dx/4 + (timer - 30) · 16 + 128`, dans la même plage et à moins de 894 unités,
 * perte de `sin(d) >> 2` pv.
 */
function bomb(world: World, o: GameObject, mega: boolean): void {
  if (o.state === 0) {
    o.pitch = mega ? 0x28 : 0x14;
    o.roll = 0;
    o.yaw += mega ? 0xf : 10;
    o.vx = (o.vx * 30) >> 5;
    o.vz = (o.vz * 30) >> 5;
    if (o.age === 0) {
      o.classe = CLASS.GHOST;
      o.vx = SIN[o.owner.yaw & ANGLE_MASK]! << 5;
      o.vz = COS[o.owner.yaw & ANGLE_MASK]! << 5;
    }
    hoverFollow(world, o, 0x28, 4, 4);
    if (o.age > 0x27) {
      burst(world, o);
      o.model = 0;
      o.timer = mega ? 0x3c : 0x28;
      o.state = 1;
    }
    return;
  }
  o.timer--;
  if (o.timer < 1) o.classe = 0;
  if ((o.timer & 1) !== 0) return;
  const t = o.timer;
  for (const c of allAround(world, o, 4)) {
    if (mega) {
      const ax = ((c.x >> 8) - (o.x >> 8)) >> 2;
      const az = ((c.z >> 8) - (o.z >> 8)) >> 2;
      const d = ax + (t - 0x1e) * 0x10 + 0x80;
      if (d > 0 && d < 0xff && ax * ax + az * az < 50000) hit(c, SIN[d & ANGLE_MASK]! >> 2);
    } else {
      const ax = (c.x >> 8) - (o.x >> 8);
      const az = (c.z >> 8) - (o.z >> 8);
      const d = ((ax * ax + az * az) >> 9) + (t - 0x14) * 0x40;
      if (d > 0 && d < 0xff) hit(c, (SIN[d & ANGLE_MASK]! * t) >> 6);
    }
  }
}

/** `gm_upd_bomb_fly` (`00455370`), arme 7. */
export function bombFly(world: World, o: GameObject): void {
  bomb(world, o, false);
}

/** `gm_upd_bomb_shockwave` (`004556dc`), arme 17. */
export function bombShockwave(world: World, o: GameObject): void {
  bomb(world, o, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Mortier (armes 6 et 16)
// ---------------------------------------------------------------------------------------------------------------------

/** Éclats : `n` clones du modèle `model`, `life` = `i · 2 + 50`, vitesse = triplet de la table pseudo-aléatoire × `scale`. */
function fragments(world: World, o: GameObject, n: number, model: number, hp: number, shift: number): void {
  for (let i = 0; i < n; i++) {
    const b = cloneObject(world, o, { classe: PLAYER_PROJECTILE_CLASS, hp, model, update: "bullet_heavy" });
    if (!b) return;
    b.timer = i * 2 + 0x32;
    nextRandom(world, rnd);
    b.vx = rnd.x << shift;
    b.vy = rnd.y << shift;
    b.vz = rnd.z << shift;
  }
}

/**
 * `gm_upd_mortar` (`00457074`) : rase le relief à 90 unités, vitesse horizontale × 30/32, lancé à 32 unités/tick dans le cap du
 * joueur au premier tick (devient un fantôme `0x40`). Après 40 ticks : éclat, 35 éclats lourds (`10005`, 15 pv, vitesse × 16) et,
 * pour le super mortier (`state` 1), 20 éclats (`10001`, 20 pv, × 8).
 */
export function mortar(world: World, o: GameObject): void {
  o.pitch = 0;
  o.roll = 0;
  o.vx = (o.vx * 30) >> 5;
  o.vz = (o.vz * 30) >> 5;
  if (o.age === 0) {
    o.classe = CLASS.GHOST;
    o.vx = SIN[o.owner.yaw & ANGLE_MASK]! << 5;
    o.vz = COS[o.owner.yaw & ANGLE_MASK]! << 5;
  }
  hoverFollow(world, o, 0x5a, 4, 4);
  if (o.age >= 0x28) {
    burst(world, o);
    o.classe = 0;
    fragments(world, o, 0x23, 10005, 0xf, 4);
    if (o.state === 1) fragments(world, o, 0x14, 10001, 0x14, 3);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Super nova (arme 5) et nucléateur (arme 15)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Explosion de la super nova et des sous-munitions du nucléateur : petite explosion, une balle (`10001`, 25 pv, classe `0x3b`) par
 * objet « ennemi » (`classe & 0x4c == 0`) des 5 × 5 cellules, dirigée sur lui (32 unités/tick) s'il est à moins de 282 unités en
 * plan, puis 10 éclats lourds (`10005`, 15 pv, vitesse × 8).
 */
function novaBurst(world: World, o: GameObject): void {
  o.classe = 0;
  explosionSmall(world, o);
  for (const c of queryFree(world, o, 2, 0x4c)) {
    const b = cloneObject(world, o, { classe: PROJECTILE_CLASS, hp: 0x19, model: 10001, update: "bullet" });
    if (!b) break;
    const dx = (c.x - o.x) >> 8;
    const dz = (c.z - o.z) >> 8;
    if ((dx * dx + dz * dz) >> 2 < 20000) {
      normalize256(dx, (c.y - o.y) >> 8, dz, dir);
      b.vx = dir.x << 5;
      b.vy = dir.y << 5;
      b.vz = dir.z << 5;
    }
  }
  fragments(world, o, 10, 10005, 0xf, 3);
}

/** `gm_upd_super_nova` (`0045754c`) : vol à 4 500 en piquant (tangage - 3 par tick) pendant 35 ticks puis `novaBurst`. */
export function superNova(world: World, o: GameObject): void {
  o.timer++;
  groundOrDead(world, o);
  o.pitch -= 3;
  if (o.timer < 0x23) {
    localVelocity(o, 0, 0, 4500);
    smokeTrail(world, o, 6);
  } else novaBurst(world, o);
}

/**
 * `gm_upd_nucleator` (`00457abc`) : comme la super nova, mais après 35 ticks il se scinde en trois sous-munitions (`10003`, 25 pv,
 * classe `0x3b`, cap + 220 / 390 / 560, durées de vie 30 / 50 / 70) qui partent chacune à 1 700 dans leur cap.
 */
export function nucleator(world: World, o: GameObject): void {
  o.timer++;
  groundOrDead(world, o);
  o.pitch -= 3;
  if (o.timer < 0x23) {
    localVelocity(o, 0, 0, 4500);
    smokeTrail(world, o, 6);
    return;
  }
  o.yaw += 0x32;
  for (let i = 0; i < 3; i++) {
    o.yaw += 0xaa;
    const b = cloneObject(world, o, { classe: PROJECTILE_CLASS, hp: 0x19, model: 10003, update: "bomblet" });
    if (!b) break;
    b.pitch = 0;
    b.timer = i * 0x14 + 0x1e;
  }
  o.classe = 0;
  burst(world, o);
}

/** `0045789c` : sous-munition du nucléateur ; explose comme une super nova quand sa durée de vie est écoulée. */
export function bomblet(world: World, o: GameObject): void {
  o.timer--;
  groundOrDead(world, o);
  if (o.timer > 0) localVelocity(o, 0, 0, 0x6a4);
  else novaBurst(world, o);
}

// ---------------------------------------------------------------------------------------------------------------------
// Napalm (armes 8 et 18)
// ---------------------------------------------------------------------------------------------------------------------

/** Goutte de napalm : clone `10005` (50 pv, classe `0x3f`, vitesse horizontale aléatoire × `shift`, `vy = -600`). */
function napalmDropSpawn(world: World, o: GameObject, shift: number): void {
  const d = cloneObject(world, o, { classe: PLAYER_PROJECTILE_CLASS, hp: 0x32, model: 10005, update: "napalm_drop" });
  if (!d) return;
  nextRandom(world, rnd);
  d.vx = rnd.x << shift;
  d.vz = rnd.z << shift;
  d.vy = -600;
}

/** `gm_upd_napalm` (`00457784`) : vol à 4 500, pique 10 pas par tick du 6ᵉ au 11ᵉ tick, goutte tous les 4 ticks du 18ᵉ au 119ᵉ. */
export function napalm(world: World, o: GameObject): void {
  o.timer++;
  groundOrDead(world, o);
  if (o.timer > 5 && o.timer < 0xc) o.pitch -= 10;
  if (o.timer > 0x11 && o.timer < 0x78 && (o.timer & 3) === 0) napalmDropSpawn(world, o, 0);
  localVelocity(o, 0, 0, 4500);
  smokeTrail(world, o, 6);
}

/**
 * `gm_upd_super_napalm` (`00457bcc`) : 4 500 du 6ᵉ au 11ᵉ tick, 4 500 avec une montée de 1 000 du 18ᵉ au 39ᵉ, puis 150 (+ montée de
 * 200, quasi à l'arrêt) en semant une goutte tous les 4 ticks (vitesse × 4) jusqu'au 149ᵉ tick, puis de nouveau 4 500. Entre les
 * phases la vitesse reste celle du dernier tick.
 */
export function superNapalm(world: World, o: GameObject): void {
  o.timer++;
  groundOrDead(world, o);
  if (o.timer > 5 && o.timer < 0xc) {
    o.pitch -= 10;
    localVelocity(o, 0, 0, 4500);
  }
  if (o.timer > 0x11 && o.timer < 0x28) localVelocity(o, 0, 1000, 4500);
  if (o.timer > 0x27 && o.timer < 0x96 && (o.timer & 3) === 0) {
    napalmDropSpawn(world, o, 2);
    localVelocity(o, 0, 200, 0x96);
  }
  if (o.timer > 0x95) localVelocity(o, 0, 0, 4500);
  smokeTrail(world, o, 6);
}

/**
 * `00457000` : goutte de napalm. Au sol : devient le décalque 901 (taille d'explosion de ce modèle), cratère, explosion ; blessée
 * (pv ≠ 50 après un contact) : éclat. Gravité de 90 par tick.
 */
export function napalmDrop(world: World, o: GameObject): void {
  if (world.terrain.height(o.x, o.z) >= o.y) {
    o.model = 0x385;
    o.classe = 0;
    explodeHeavy(world, o);
  }
  if (o.hp !== 0x32) {
    o.classe = 0;
    burst(world, o);
  }
  o.vy -= 0x5a;
}
