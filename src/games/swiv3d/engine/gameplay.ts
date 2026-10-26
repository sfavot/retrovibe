/**
 * Câblage du gameplay : table des comportements (`registerBehavior`), mise en place du niveau (objectifs, compteurs de bonus) et
 * logique de jeu par tick (`gm_game_tick` `0043c234` : mort, fin de niveau, score affiché, compagnons, bouclier, jauge d'énergie).
 */
import { objectiveGroup } from "../data/level";
import { SND, explosionBig, smokePlume, sound } from "./combat";
import { spawnDebris } from "./debris";
import * as enemies from "./enemies";
import type { PlayerInput } from "./input";
import { launcherObjects } from "./launchers";
import { ANGLE_MASK, COS, SIN } from "./fixed";
import { CLASS, DEPOP_MARK, UPDATE_STATIC, type GameObject } from "./objects";
import { registerObjective } from "./objectives";
import * as pads from "./pads";
import * as pickups from "./pickups";
import * as pw from "./player-weapons";
import { UPDATE_PLAYER_DEAD } from "./player";
import * as proj from "./projectiles";
import { MESSAGE_TINT } from "./status";
import { flingAttached, flingPlayerWheels } from "./wheels";
import type { Behavior, World } from "./world";

/** Les effets et projectiles n'ont rien à faire pendant leur dépeuplement : ils sont simplement supprimés. */
function skipDepop(fn: Behavior): Behavior {
  return (w, o) => {
    if (o.classe !== DEPOP_MARK) fn(w, o);
  };
}

/** Enregistre tous les comportements du gameplay dans `world`. */
export function registerGameplay(world: World): void {
  const r = (key: string, fn: Behavior): void => world.registerBehavior(key, fn);
  const fx = (key: string, fn: Behavior): void => r(key, skipDepop(fn));

  // Effets
  fx("fx_burst", proj.fxBurst);
  fx("fx_explosion", proj.fxExplosion);
  fx("fx_explosion_small", proj.fxExplosionSmall);
  fx("fx_smoke_trail", proj.fxSmokeTrail);
  fx("fx_smoke_follow", proj.fxSmokeFollow);
  fx("fx_smoke_rise", proj.fxSmokeRise);
  fx("fx_decal", proj.fxDecal);
  r("fx_wreck", proj.fxWreck);
  fx("fx_debris", proj.fxDebris);
  fx("fx_debris_small", proj.fxDebrisSmall);
  // Projectiles
  fx("bullet", proj.bullet);
  fx("bullet_tracking", proj.bulletTracking);
  fx("bullet_right", proj.bulletRight);
  fx("bullet_heavy", proj.bulletHeavy);
  fx("bullet_homing", proj.bulletHoming);
  fx("missile_a", proj.missileA);
  fx("missile_b", proj.missileB);
  fx("missile_straight", proj.missileStraight);
  fx("missile_coast", proj.missileCoast);
  fx("rocket", proj.rocket);
  fx("special_missile", pw.specialMissile);
  fx("special_nova", pw.specialNova);
  fx("special_mortar", pw.specialMortar);
  fx("special_napalm", pw.specialNapalm);
  fx("special_bomb", pw.specialBomb);
  fx("napalm_drop", pw.napalmDrop);
  // Objets du niveau
  r(UPDATE_STATIC, enemies.destructible);
  r("upd_0044ac88", enemies.turret);
  r("upd_0044b848", enemies.beamGun);
  r("upd_0044bca8", enemies.groundVehicle);
  r("upd_0044cf1c", enemies.boat);
  fx("upd_0044d470", enemies.vehicleTurret);
  r("upd_004450c4", enemies.wheel);
  r("upd_0044d804", enemies.vehicleFactory);
  r("upd_0044df98", enemies.airstrip);
  r("upd_0044e0f8", enemies.airstripSquadron);
  r("upd_0044e2d8", enemies.airstripPasses);
  fx("attack_plane", enemies.attackPlane);
  fx("attack_plane2", enemies.attackPlane2);
  r("upd_0044de9c", enemies.antenna);
  r("upd_0044e438", enemies.kamikazeHeli);
  r("upd_0044e758", enemies.nodePlane);
  r("upd_0045199c", enemies.fighterSpawner);
  fx("fighter", enemies.fighter);
  fx("upd_00449c10", proj.fallingWreck);
  // Bonus, compagnons, bouclier, plates-formes
  r("upd_004469fc", pickups.pickupPlaced);
  r("upd_00446a3c", pickups.pickupDropped);
  r("upd_00446964", pickups.pickupAfterGroup9);
  r("upd_004468cc", pickups.pickupAfterAll);
  r("shield", pickups.shield);
  r("buddy_auto", pickups.buddyAuto);
  r("buddy_lock", pickups.buddyLock);
  r("buddy_super", pickups.buddySuper);
  r("upd_004482dc", pads.transformPad);
  r("upd_0044822c", pads.padHelper);
  r("dock_flying", (w, o) => pads.dockFlying(w, o));
  r("dock_ground", (w, o) => pads.dockGround(w, o));
  // Armes spéciales : leurs comportements de vol remplacent les versions génériques de `projectiles` enregistrées plus haut.
  pw.registerWeaponBehaviors(world);
}

/**
 * Mise en place après la création des objets : inscription des cibles d'objectif (types 2000-2004 dont `REC[7]` vaut
 * 5000-5009) et compteurs de bonus (`005b03f4` porteurs, `005b03d8` posés).
 */
export function setupLevel(world: World): void {
  const g = world.game;
  for (const o of world.levelObjects) {
    const t = o.type;
    if (t >= 2000 && t <= 2004 && objectiveGroup({ subtype: o.subtype }) !== null)
      registerObjective(world, o);
    if ((t === 2000 || t === 2004) && o.subtype >= 1000 && o.subtype < 2000) g.bonusDropped++;
    if (t === 7000 || t === 7001 || t === 7002) g.bonusPlaced++;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Mort du joueur
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `gm_player_die` (`0043b4f4`) : pilote coupé (`gm_pilot_none`), classe `0x40` (mot entier : drapeaux effacés), explosion, éclats
 * du modèle, fumée, âge 0, modèle 0 (invisible), tangage et roulis à 0 ; roues des formes 1 et 2 puis lanceurs d'armes spéciales
 * (`+0x19c…`, `+0x1cc…`) lancés en gros éclats ; `+0x184 = 0`, vitesse nulle et physique `0043863c` (vitesse remise à 0 à chaque
 * tick) ; les 6 emplacements de compagnons (`+0x1f8…+0x20c`) sont vidés mais les compagnons vivent (ils restent sur place et tirent
 * encore) ; le bouclier (`+0x210`, non vidé) suit le joueur et disparaît de lui-même si l'énergie vaut exactement 0 (`gm_upd_shield`).
 * Message « Game over ! », état 2, compteur de fin à 0 : `gm_game_tick` passe au game over 35 ticks plus tard.
 */
function playerDie(world: World): void {
  const g = world.game;
  const p = world.player.obj;
  p.classe = CLASS.GHOST;
  p.flags = 0;
  explosionBig(world, p);
  spawnDebris(world, p);
  smokePlume(world, p);
  p.age = 0;
  p.model = 0;
  p.pitch = 0;
  p.roll = 0;
  flingPlayerWheels(world, world.player);
  g.alive = false;
  p.vx = p.vy = p.vz = 0;
  p.update = UPDATE_PLAYER_DEAD;
  g.buddies.fill(null);
  for (const o of launcherObjects(world)) if (o.classe !== 0) flingAttached(world, o);
  world.player.dead = true;
  g.message(20, 10, MESSAGE_TINT.gameOver, 10);
  world.emit({ kind: "message", textTable: 20, textId: 10 });
  g.endState = "dead";
  g.endCounter = 0;
  world.emit({ kind: "playerDied" });
}

/**
 * `gm_player_victory_mode` (`0043c07c`), au tick 25 de la victoire : les formes 0 à 3 reçoivent leur pilote de fin de niveau
 * (`00438d08`, `00438ec8`, `00438fb8`, `00438de8`), un âge nul et la classe `0x40` (fantôme : plus de collision ni de bonus,
 * toujours dessiné) ; les formes 4 et 5 gardent leur pilote (et les commandes). Toutes : `+0x184 = 0` (plus de mort possible).
 */
function victoryMode(world: World): void {
  const p = world.player;
  if (p.form >= 0 && p.form <= 3) {
    p.victory = true;
    p.autopilot = false; // `+0xa8` remplacé : le pilote d'amarrage éventuel aussi
    p.obj.age = 0;
    p.obj.classe = CLASS.GHOST;
    p.obj.flags = 0;
  }
  world.game.alive = false;
}

/** Décalages (en 1/256 d'unité × facteur) des 6 emplacements de compagnons : `[facteur, décalage d'angle]`. */
const BUDDY_OFFSETS: readonly (readonly [number, number])[] = [
  [-0x40, 0],
  [0x40, 0],
  [-0x78, 0],
  [0x8c, 0],
  [-0xbe, 0xf],
  [0xbe, -0xf],
];

/** Jauge d'énergie (`+0x118`) : avance d'un pas tous les 2 ticks vers `hp >> 5` (+12 au-dessus de 15), son 4001 aux franchissements. */
function updateGauge(world: World): void {
  const g = world.game;
  if ((world.tickCount & 1) !== 0) return;
  let target = world.player.obj.hp >> 5;
  if (target < 0) target = 0;
  if (target > 0x1f) target = 0x1f;
  if (target > 0xf) target += 0xc;
  if (g.gauge < target) {
    g.gauge++;
    if (g.gauge === 0x10) sound(world, SND.gauge, world.player.obj);
  }
  if (target < g.gauge) {
    g.gauge--;
    if (g.gauge === 0x1a) sound(world, SND.gauge, world.player.obj);
  }
}

/**
 * Fin du tick pour le joueur (après le pilote) : armes, fin de niveau, cible, score affiché, compagnons, bouclier, mort, jauge.
 * `input` : entrées du tick.
 */
export function playerTick(world: World, input: PlayerInput): void {
  const g = world.game;
  const p = world.player.obj;
  if (g.endState !== "dead") pw.playerWeaponsTick(world, input);
  if (g.endState === "victory" && g.endCounter === 0x19) victoryMode(world);
  if (g.endState === "victory" && g.endCounter === 0x37 && !g.levelComplete) {
    g.levelComplete = true;
    world.emit({ kind: "levelComplete" });
  }
  if (g.endState === "dead" && g.endCounter === 0x23 && !g.gameOver) {
    g.gameOver = true;
    world.emit({ kind: "gameOver" });
  }
  pw.pickPlayerTarget(world);
  // score affiché : rattrape le score réel de 3 par tick (1 pour un écart de 1 ou 2)
  let diff = g.score - g.scoreShown;
  if (diff < 3) {
    if (diff > 0) diff = 1;
  } else diff = 3;
  g.scoreShown += diff;
  if (g.shield) {
    if (g.shield.classe === 0) g.shield = null;
    else {
      g.shield.x = p.x;
      g.shield.y = p.y;
      g.shield.z = p.z;
    }
  }
  g.buddies.forEach((b, i) => {
    if (!b) return;
    if (b.classe === 0) {
      g.buddies[i] = null;
      return;
    }
    const [k, da] = BUDDY_OFFSETS[i]!;
    const a = (p.yaw + 0x80 + da) & ANGLE_MASK;
    b.x = p.x + SIN[a]! * k;
    b.z = p.z + COS[a]! * k;
  });
  if (p.hp < 1 && g.alive && g.endCounter === -1) playerDie(world);
  updateGauge(world);
}

/** Avance les compteurs de fin de niveau (après la mise à jour des objets, avant le joueur). */
export function advanceEndCounter(world: World): void {
  const g = world.game;
  if (g.endCounter > -1) g.endCounter++;
}

export type { GameObject };
