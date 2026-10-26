/**
 * Bonus (`gm_pickup_update` `004463c0`, `gm_pickup_can_take` `00458f88`, `gm_pickup_apply` `004585c4`), compagnons et bouclier.
 * Un bonus flotte à 23 unités du sol ; à moins de 100 unités du joueur, si le plafond de son stock n'est pas atteint, il est
 * aspiré pendant 130 ticks (joueur en vol) ou 70 (au sol) puis appliqué. Voir `docs/swiv3d/objects.md` §6.10 et `rules.md` §4.
 */
import {
  SND,
  acquireTarget,
  applyAimOption,
  bestAimOption,
  cloneObject,
  explosionBig,
  findNearestPlayer,
  localVelocity,
  sound,
  spawnOnGround,
} from "./combat";
import { normalize256, SIN } from "./fixed";
import { AMMO_CAP, AMMO_PICKUP } from "./game";
import { CLASS, type GameObject } from "./objects";
import { unregisterObjective } from "./objectives";
import { PLAYER_PROJECTILE_CLASS, isWeaponAllowed } from "./player-weapons";
import { hoverFollow } from "./special-weapons";
import { MESSAGE_TINT } from "./status";
import type { World } from "./world";

/** Premiers codes de bonus autres que les armes : 100 à 102 vie, 105-106-108 compagnons, 107 bouclier, 109 rien, 110-113 puissance. */
export const PICKUP_HEALTH_10 = 100;
export const PICKUP_HEALTH_25 = 101;
export const PICKUP_HEALTH_MEGA = 102;
export const PICKUP_BUDDY_LOCK = 105;
export const PICKUP_BUDDY_AUTO = 106;
export const PICKUP_SHIELD = 107;
export const PICKUP_BUDDY_SUPER = 108;

/** Classe des compagnons et du bouclier (`MOV EAX,0x14` de `004585c4`) : en vol et cible des ennemis, ni solide ni fantôme. */
const BUDDY_CLASS = 0x14;

const MAX_ENERGY = 496;
const MAX_MEGA_ENERGY = 992;

/** Ordre de remplissage des 6 emplacements de compagnons (`0048459c`). */
const BUDDY_ORDER = [1, 0, 2, 3, 4, 5] as const;

/** Niveau de puissance maximal avant qu'un bonus 110-113 soit refusé : 4, 9, 14, 19 (`< 0x13` pour 111-113 dans le code). */
function powerCap(n: number): number {
  return n === 110 ? 4 : n === 111 ? 9 : n === 112 ? 14 : 19;
}

function freeBuddySlot(world: World): number {
  const b = world.game.buddies;
  let slot = 1;
  let i = 0;
  while (i < 6 && b[slot]) {
    slot = BUDDY_ORDER[i]!;
    i++;
  }
  return b[slot] ? -1 : slot;
}

/**
 * `gm_pickup_can_take` : le joueur peut-il prendre le bonus `n` (stock sous son plafond, énergie sous 496 / 992, emplacement de
 * compagnon libre, niveau de canon < 19) ? Si oui, le message de nom est affiché (table 100, id `n`).
 */
export function canTake(world: World, n: number): boolean {
  const g = world.game;
  const p = world.player.obj;
  if (p.classe & CLASS.GHOST) return true;
  let ok: boolean;
  if (n >= 0 && n < 20) ok = g.ammo[n]! < AMMO_CAP[n]!;
  else if (n === PICKUP_HEALTH_10 || n === PICKUP_HEALTH_25) ok = p.hp < MAX_ENERGY;
  else if (n === PICKUP_HEALTH_MEGA) ok = p.hp < MAX_MEGA_ENERGY;
  else if (n === PICKUP_BUDDY_LOCK || n === PICKUP_BUDDY_AUTO || n === PICKUP_BUDDY_SUPER)
    ok = g.buddies.some((b) => !b);
  else if (n >= 110 && n <= 113) ok = g.power < 19;
  else ok = true;
  if (ok) {
    g.message(100, n, pickupTint(n));
    world.emit({ kind: "message", textTable: 100, textId: n });
  }
  return ok;
}

/** Teinte du texte d'un ramassage (`00458f88`) : armes 0 à 19 rouge, bonus 100 à 108 `0x400`, 110 à 113 `0x100`. */
function pickupTint(n: number): number {
  if (n >= 110) return MESSAGE_TINT.bonus;
  if (n >= 100) return MESSAGE_TINT.powerUp;
  return MESSAGE_TINT.weapon;
}

/** `gm_pickup_apply` : effet du bonus `n`. */
export function applyPickup(world: World, n: number): void {
  const g = world.game;
  const p = world.player.obj;
  if (n >= 0 && n < 20) {
    g.ammo[n] = Math.min(AMMO_CAP[n]!, g.ammo[n]! + AMMO_PICKUP[n]!);
  } else if (n === PICKUP_HEALTH_10) p.hp = Math.min(MAX_ENERGY, p.hp + 0x31);
  else if (n === PICKUP_HEALTH_25) p.hp = Math.min(MAX_ENERGY, p.hp + 0x7c);
  else if (n === PICKUP_HEALTH_MEGA) p.hp = Math.min(MAX_MEGA_ENERGY, p.hp + 0x1f0);
  else if (n === PICKUP_BUDDY_LOCK || n === PICKUP_BUDDY_AUTO || n === PICKUP_BUDDY_SUPER) {
    const slot = freeBuddySlot(world);
    if (slot >= 0) {
      const [model, hp, update] =
        n === PICKUP_BUDDY_LOCK
          ? ([851, 250, "buddy_lock"] as const)
          : n === PICKUP_BUDDY_AUTO
            ? ([852, 70, "buddy_auto"] as const)
            : ([810, 70, "buddy_super"] as const);
      const b = cloneObject(world, p, { classe: BUDDY_CLASS, hp, model, update });
      if (b) {
        b.y += 80000;
        b.vx = b.vy = b.vz = 0;
        g.buddies[slot] = b;
      }
    }
  } else if (n === PICKUP_SHIELD) {
    if (!g.shield) {
      const s = cloneObject(world, p, { classe: BUDDY_CLASS, hp: 200, model: 853, update: "shield" });
      if (s) {
        g.shield = s;
        if (p.hp < 200) p.hp = 200;
        s.state = p.hp;
        s.vx = s.vy = s.vz = 0;
      }
    } else {
      g.shield.hp = 300;
      p.hp = Math.min(MAX_MEGA_ENERGY, p.hp + 0x1f0);
    }
  } else if (n >= 110 && n <= 113) {
    if (g.power < powerCap(n)) g.power++;
  }
  // arme sélectionnée automatiquement si aucune ne l'est
  if (n < 21 && g.loaded === -1 && n < 20 && isWeaponAllowed(world.player.form, n)) {
    g.selected = n;
    g.weaponState = 0;
  }
  world.emit({ kind: "pickup", n });
}

// ---------------------------------------------------------------------------------------------------------------------
// Comportement d'un bonus
// ---------------------------------------------------------------------------------------------------------------------

const v = { x: 0, y: 0, z: 0 };

/** Position d'un bonus attiré : `joueur - n × timer` (n normalisé à 256, soit une approche linéaire de `timer` unités). */
function pullPosition(o: GameObject): { x: number; y: number; z: number; nx: number; ny: number; nz: number } {
  const p = o.owner;
  normalize256((p.x - o.x) >> 6, (p.y - o.y) >> 6, (p.z - o.z) >> 6, v);
  return {
    x: p.x - v.x * o.timer,
    y: p.y - v.y * o.timer,
    z: p.z - v.z * o.timer,
    nx: v.x,
    ny: v.y,
    nz: v.z,
  };
}

/** `gm_pickup_update` (`004463c0`) : états 0 (flotte), 1 (aspiré par un véhicule aérien), 2 (par un véhicule au sol). */
export function pickupUpdate(world: World, o: GameObject): void {
  const n = o.subtype - 1000;
  if (o.state === 0) {
    o.timer++;
    o.y = world.terrain.height(o.x, o.z) + 6000 + SIN[(o.timer & 0x7f) * 4]! * 8;
    if ((o.age & 0x1f) === 0) findNearestPlayer(world, o, 6000000);
    o.yaw += SIN[(o.timer & 0x7f) * 4]! >> 4;
    if (o.target !== o) {
      const t = o.target;
      const dx = (o.x - t.x) >> 8;
      const dz = (o.z - t.z) >> 8;
      if (dx * dx + dz * dz < 10000 && canTake(world, n)) {
        o.yaw &= 0x1ff;
        o.owner = t;
        if (!(t.classe & CLASS.FLYING)) {
          o.state = 2;
          o.timer = 0x46;
          o.flags |= 1;
          sound(world, SND.pickupGround, o);
        } else {
          o.state = 1;
          o.classe |= 0x400;
          o.timer = 0x82;
          sound(world, SND.pickupAir, o);
        }
      }
    }
  } else if (o.state === 1) {
    if (o.timer > 0) o.timer--;
    const p = o.owner;
    const pos = pullPosition(o);
    if (!(p.classe & CLASS.GHOST)) {
      p.vx -= pos.nx >> 2;
      p.vy -= pos.ny >> 2;
      p.vz -= pos.nz >> 2;
      o.vy -= 100;
    } else o.timer = 0;
    o.x = pos.x;
    o.y = pos.y;
    o.z = pos.z;
    if (o.y - 0x3c - world.terrain.height(o.x, o.z) < 0) o.timer -= 3;
    applyAimOption(o, bestAimOption(o, o.target), 5, 5);
    if (o.timer < 11) {
      o.classe = 0;
      applyPickup(world, n);
      unregisterObjective(world, o);
    }
  } else if (o.state === 2) {
    if (o.timer > 0) o.timer--;
    const p = o.owner;
    const pos = pullPosition(o);
    p.vx -= pos.nx >> 2;
    p.vy -= pos.ny >> 2;
    p.vz -= pos.nz >> 2;
    o.vy += 0xaa;
    o.vx += (pos.x - o.x) >> 3;
    o.vy += (pos.y - o.y) >> 3;
    o.vz += (pos.z - o.z) >> 3;
    o.x = pos.x;
    o.y = pos.y;
    o.z = pos.z;
    if (o.timer < 11) {
      o.classe = 0;
      applyPickup(world, n);
      unregisterObjective(world, o);
    }
  }
}

/** `gm_upd_pickup_placed` (`004469fc`) : bonus posé par le niveau ; compte les bonus ramassés (`+0x198`). */
export function pickupPlaced(world: World, o: GameObject): void {
  pickupUpdate(world, o);
  if (o.classe === 0) world.game.pickedPlaced++;
}

/** `gm_upd_pickup_dropped` (`00446a3c`) : bonus largué par une cible ; compte les « secrets » trouvés (`+0x194`). */
export function pickupDropped(world: World, o: GameObject): void {
  pickupUpdate(world, o);
  if (o.classe === 0) world.game.pickedDropped++;
}

/** Crée le bonus caché d'un 7001 / 7002 : même position que l'enregistrement, modèle `REC[5]`, code `REC[7]`. */
function revealHidden(world: World, o: GameObject): void {
  const rec = o.rec;
  if (!rec) return;
  const b = spawnOnGround(world, {
    x: rec.x * 256,
    z: rec.z * 256,
    yaw: rec.angle,
    classe: 0x41,
    hp: 1000,
    model: rec.childModel,
    update: "upd_004469fc",
  });
  if (b) b.subtype = rec.subtype;
  o.state = 1;
}

/** `gm_upd_pickup_after_group9` (`00446964`, 7002) : le bonus n'apparaît qu'une fois le groupe 9 détruit. */
export function pickupAfterGroup9(world: World, o: GameObject): void {
  if (o.state === 0 && world.game.group9Done) revealHidden(world, o);
}

/** `gm_upd_pickup_after_all` (`004468cc`, 7001) : quand il ne reste que le groupe final. */
export function pickupAfterAll(world: World, o: GameObject): void {
  if (o.state === 0 && world.game.finalGroupOnly) revealHidden(world, o);
}

// ---------------------------------------------------------------------------------------------------------------------
// Compagnons et bouclier
// ---------------------------------------------------------------------------------------------------------------------

/** `gm_upd_shield` (`00456038`) : le bouclier absorbe la perte d'énergie du joueur depuis le tick précédent. */
export function shield(world: World, o: GameObject): void {
  const p = o.owner;
  if (p.hp < o.state) {
    o.hp -= o.state - p.hp;
    p.hp = o.state;
  }
  o.state = p.hp;
  if (o.hp < 1 || p.hp === 0) {
    o.classe = 0;
    explosionBig(world, o);
    if (world.game.shield === o) world.game.shield = null;
  }
  o.yaw += 3;
  o.pitch += o.hp >> 6;
  o.roll += o.hp >> 5;
}

/** Suit le joueur : cap et vitesse horizontale du joueur, ressort vertical à 90 unités du relief (raideur 4 en montée, 2 en descente). */
function buddyFollow(world: World, o: GameObject): GameObject {
  const owner = o.owner;
  o.timer++;
  o.roll = 0;
  o.vx = owner.vx;
  o.vz = owner.vz;
  hoverFollow(world, o, 0x5a, 4, 2);
  return owner;
}

/** Tourne le compagnon vers sa cible (un des 5 pas de `AIM_OPTIONS`) ; retourne l'option choisie (0 : cap bon). */
function buddyAim(o: GameObject, owner: GameObject, wrap: boolean): number {
  if (o.target === owner || o.target === o) {
    o.yaw += (owner.yaw - o.yaw) >> 1;
    o.pitch >>= 1;
    return -1;
  }
  const k = bestAimOption(o, o.target);
  if (wrap) {
    if (k === 1) o.yaw = (o.yaw - 3) & 0x1ff;
    if (k === 2) o.yaw = (o.yaw + 3) & 0x1ff;
    if (k === 3) o.pitch = (o.pitch + 3) & 0x1ff;
    if (k === 4) o.pitch = (o.pitch - 3) & 0x1ff;
  } else {
    if (k === 1) o.yaw -= 3;
    if (k === 2) o.yaw += 3;
    if (k === 3) o.pitch += 3;
    if (k === 4) o.pitch -= 3;
  }
  return k;
}

function buddyDie(world: World, o: GameObject): void {
  if (o.hp >= 1) return;
  o.classe = 0;
  explosionBig(world, o);
  const b = world.game.buddies;
  const i = b.indexOf(o);
  if (i >= 0) b[i] = null;
}

/** Balle de compagnon (`10002` ou `10000`, classe `0x3f`, `+0x14` = 30) tirée à 9 000 dans le cap du compagnon, propriétaire : le joueur. */
function buddyBullet(world: World, o: GameObject, model: number, hp: number, lat: number, vert = 0): void {
  const b = cloneObject(world, o, { classe: PLAYER_PROJECTILE_CLASS, hp, model, update: "bullet_right" });
  if (!b) return;
  b.owner = o.owner;
  b.timer = 0x1e;
  localVelocity(b, lat, vert, 9000);
}

/**
 * `gm_upd_buddy_autofire` (`00456abc`) : module de tir auto. Cherche une cible tous les 10 ticks (rayon 1, classe `0x45 == 1`),
 * se tourne vers elle (3 pas par tick) et, cap bon, tire une balle `10000` (14 pv) aux ticks `& 0xf` = 0 et 3 (2,5 coups par seconde
 * en rafale de deux), sans appui sur le tir du joueur.
 */
export function buddyAuto(world: World, o: GameObject): void {
  if (o.target.classe === 0) o.age = 9999;
  acquireTarget(world, o, 10, 0x45, 1, 1);
  const owner = buddyFollow(world, o);
  const k = buddyAim(o, owner, true);
  if (k === 0 && ((o.timer & 0xf) === 0 || (o.timer & 0xf) === 3)) buddyBullet(world, o, 10000, 14, 0);
  buddyDie(world, o);
}

/**
 * `gm_upd_buddy_lock` (`004560e4`) : module de verrouillage. Prend la cible du joueur et s'oriente vers elle ; tant que le joueur
 * tient le tir principal : 4 balles `10002` (8 pv) en croix, à 9 000 dans le cap du compagnon : deux écartées de ±150 sur le côté
 * au tick `& 0x1f` = 7, deux de ±150 en hauteur au tick 0.
 */
export function buddyLock(world: World, o: GameObject): void {
  const owner = o.owner;
  o.target = owner.target;
  const player = buddyFollow(world, o);
  buddyAim(o, player, false);
  if (world.player.firePrimaryHeld) {
    if ((o.timer & 0x1f) === 7) {
      buddyBullet(world, o, 10002, 8, -150);
      buddyBullet(world, o, 10002, 8, 150);
    }
    if ((o.timer & 0x1f) === 0) {
      buddyBullet(world, o, 10002, 8, 0, -150);
      buddyBullet(world, o, 10002, 8, 0, 150);
    }
  }
  buddyDie(world, o);
}

/**
 * `gm_upd_buddy_super` (`00456658`) : super module, cap et cible du joueur ; tant que le tir principal est tenu, un missile
 * (`10001`, 20 pv, classe 10 : 7 000, virage 2) tous les 32 ticks.
 */
export function buddySuper(world: World, o: GameObject): void {
  const owner = o.owner;
  o.target = owner.target;
  buddyFollow(world, o);
  o.yaw = owner.yaw;
  o.pitch = 0;
  o.target = owner.target;
  if (world.player.firePrimaryHeld && (o.timer & 0x1f) === 0) {
    const m = cloneObject(world, o, { classe: PLAYER_PROJECTILE_CLASS, hp: 0x14, model: 10001, update: "missile_class10" });
    if (m) {
      m.owner = owner;
      m.timer = 0x14;
    }
  }
  buddyDie(world, o);
}
