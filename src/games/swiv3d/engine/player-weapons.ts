/**
 * Armes du joueur : canon (`gm_fire_primary` `0046b6fc`, `gm_primary_bullet_spawn` `0046b4b4`), sélection (`gm_weapon_select`
 * `004582dc`), machine d'état de l'arme spéciale (`gm_player_weapon_update` `00459c80`), visée verticale
 * (`gm_player_aim_update` `004599b8`), choix de la cible (`gm_player_pick_target` `00438198`). Les lanceurs accrochés au véhicule et le
 * tir des 20 armes spéciales sont dans `launchers.ts`, leur vol dans `special-weapons.ts` et `projectiles.ts`.
 * Voir `docs/swiv3d/rules.md` §3.
 *
 * Écarts assumés : le canon est porté pour les niveaux de puissance 0 à 6 (les seuls atteignables avec les 4 niveaux livrés, plus
 * haut le motif 6 est répété).
 */
import { cloneObject, localVelocity } from "./combat";
import { ANGLE_MASK, COS, SIN } from "./fixed";
import type { PlayerInput } from "./input";
import { launcherStep, scanTarget } from "./launchers";

import { DEPOP_MARK } from "./objects";
import { isDockLocked } from "./pads";
import { missileB, missileClass10, missileStraight } from "./projectiles";
import * as sw from "./special-weapons";
import { PLAYER_PROJECTILE_CLASS } from "./special-weapons";
import type { Behavior, World } from "./world";

export { PLAYER_PROJECTILE_CLASS };

/** Masques de véhicules autorisés par arme (`004843dc`) : bit = forme (0 hélico, 1 buggy, …). */
const WEAPON_MASKS: readonly number[] = [
  0x83f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x32, 0x3f, 0x83f, 0x3f, 0x3f, 0x3f, 0x3f,
  0x3f, 0x3f, 0x3f, 0x36,
];

export function isWeaponAllowed(form: number, n: number): boolean {
  return (WEAPON_MASKS[n]! & (1 << (form & 31))) !== 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Canon
// ---------------------------------------------------------------------------------------------------------------------

/** Types de projectile du canon (`0046b4b4`) : modèle, durée de vie (ticks) et comportement. */
const BULLET_TYPES = [
  { model: 10002, life: 28, update: "bullet_right" },
  { model: 10000, life: 30, update: "bullet_right" },
  { model: 10001, life: 40, update: "bullet_heavy" },
  { model: 10003, life: 60, update: "bullet_homing" },
  { model: 800, life: 60, update: "bullet_homing" },
] as const;

/** Une balle : `[type, latéral, vertical, écart de cap, écart de tangage, énergie]` à la vitesse avant 8 000. */
type Shot = readonly [number, number, number, number, number, number];

/** Motifs du canon par niveau de puissance 0 à 6 et par phase (`compteur & 0xf`) : doc rules.md §3.1. */
const PRIMARY: readonly { phase: number; shots: readonly Shot[] }[][] = [
  [
    { phase: 0, shots: [[0, 0, 0, 0, 0, 10], [0, 0, 0, 0, 0, 10]] },
    { phase: 3, shots: [[0, 0, 0, 0, 0, 10], [0, 0, 0, 0, 0, 10]] },
  ],
  [
    { phase: 0, shots: [[0, 200, 0, 0, 0, 10], [0, -200, 0, 0, 0, 10]] },
    { phase: 3, shots: [[0, 0, 0, 0, 0, 10]] },
  ],
  [
    { phase: 0, shots: [[0, 200, 0, 0, 0, 10], [0, -200, 0, 0, 0, 10]] },
    { phase: 3, shots: [[0, 200, 0, 0, 0, 10], [0, -200, 0, 0, 0, 10]] },
  ],
  [
    { phase: 0, shots: [[0, 350, 0, 0, 0, 10], [0, 0, 0, 0, 0, 10], [0, -350, 0, 0, 0, 10]] },
    { phase: 8, shots: [[0, 200, 0, 0, 0, 10], [0, -200, 0, 0, 0, 10]] },
  ],
  [
    {
      phase: 0,
      shots: [
        [0, 0, 0, 10, 0, 10],
        [0, 0, 0, 5, 0, 12],
        [1, 0, 0, 0, 0, 10],
        [0, 0, 0, -5, 0, 10],
        [0, 0, 0, -10, 0, 10],
      ],
    },
  ],
  [
    { phase: 0, shots: [[0, 300, 0, 0, 0, 10], [0, 0, 0, 0, 0, 12], [0, -300, 0, 0, 0, 10]] },
    { phase: 8, shots: [[0, 0, 300, 0, 0, 10], [0, 0, 0, 0, 0, 12], [0, 0, -300, 0, 0, 10]] },
  ],
  [
    { phase: 0, shots: [[0, 400, 0, 0, 0, 10], [1, 0, 0, 0, 0, 12], [0, -400, 0, 0, 0, 10]] },
    { phase: 8, shots: [[0, 0, 400, 0, 0, 10], [1, 0, 0, 0, 0, 12], [0, 0, -400, 0, 0, 10]] },
  ],
];

/** `gm_primary_bullet_spawn` : balle du canon de type `type`, à la position du joueur, cap de tir (`+0x94`) et tangage de visée + écarts. */
function primaryBullet(world: World, shot: Shot): void {
  const p = world.player.obj;
  const [type, lat, vert, dYaw, dPitch, energy] = shot;
  const def = BULLET_TYPES[type]!;
  const b = cloneObject(world, p, {
    classe: PLAYER_PROJECTILE_CLASS,
    hp: energy,
    model: def.model,
    update: def.update,
  });
  if (!b) return;
  b.timer = def.life;
  b.pitch = world.game.aimPitch + dPitch;
  b.yaw = world.player.fireYaw + dYaw;
  localVelocity(b, lat, vert, 8000);
}

/** `gm_fire_primary` : salves du canon selon `power` quand `compteur & 0xf` vaut la phase du motif. */
export function firePrimary(world: World): void {
  const g = world.game;
  const pattern = PRIMARY[Math.min(g.power, PRIMARY.length - 1)]!;
  for (const step of pattern) {
    if ((g.fireCounter & 0xf) === step.phase) {
      for (const s of step.shots) primaryBullet(world, s);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Visée et ciblage du joueur
// ---------------------------------------------------------------------------------------------------------------------

const AIM_STEPS = [-15, -8, -3, -1, 0, 1, 3, 8, 15] as const;

/** `gm_player_aim_update` : tangage de visée `+0x90`, auto-aim vertical vers la cible du joueur (bornes ±60 → ±25). */
export function updateAim(world: World): void {
  const g = world.game;
  const p = world.player.obj;
  if (p.target === p) {
    if (g.aimPitch > 0) g.aimPitch -= 3;
    if (g.aimPitch < 0) g.aimPitch += 3;
  } else {
    const t = p.target;
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const dz = t.z - p.z;
    const sy = SIN[-p.yaw & ANGLE_MASK]!;
    const cy = COS[-p.yaw & ANGLE_MASK]!;
    let best = -999999999;
    let step = 0;
    for (let k = 0; k < 9; k++) {
      const a = -(g.aimPitch + AIM_STEPS[k]!) & ANGLE_MASK;
      const y = (SIN[a]! * -100) >> 8;
      const h = (COS[a]! * 100) >> 8;
      const x = (-(h * sy)) >> 8;
      const z = (h * cy) >> 8;
      const s = y * dy + x * dx + z * dz;
      if (s > best) {
        best = s;
        step = AIM_STEPS[k]!;
      }
    }
    g.aimPitch += step;
  }
  if (g.aimPitch > 0x3c) g.aimPitch = 0x19;
  if (g.aimPitch < -0x3c) g.aimPitch = -0x19;
}

/**
 * `gm_player_pick_target` (`00438198`) : cible du joueur parmi les objets des 7 × 7 cellules autour de lui (`gm_grid_query_cells(3,
 * 0x40044)` : ni fantôme `0x40`, ni cible `0x04`, ni invulnérable) ; score = produit scalaire entre le cap et la direction de l'objet
 * (normalisée à 256) + biais (+4 000 objectif, −6 000 dangereux, −4 000 peu prioritaire), seuil 50 000 ; recalculée quand le compteur
 * d'âge dépasse 60 (vitesse² < 30), 35 (< 140) ou 7 ticks, puis remis à 0.
 */
export function pickPlayerTarget(world: World): void {
  const p = world.player.obj;
  const vx = p.vx >> 8;
  const vz = p.vz >> 8;
  const v2 = vx * vx + vz * vz;
  const period = v2 < 0x1e ? 0x3c : v2 < 0x8c ? 0x23 : 7;
  if (period >= p.age) return;
  scanTarget(world, p);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sélection d'arme
// ---------------------------------------------------------------------------------------------------------------------

/** `gm_weapon_select` : -1 arme suivante, -2 précédente, 0..9 sélection directe (second appui : arme n + 10). */
export function selectWeapon(world: World, command: number): void {
  const g = world.game;
  const form = world.player.form;
  const ok = (n: number): boolean => isWeaponAllowed(form, n) && g.ammo[n]! > 0;
  if (command < 0) {
    if (g.selected === -1) return;
    let n = g.selected;
    let tries = 0;
    do {
      n += command === -1 ? 1 : -1;
      tries++;
      if (n > 19) n = 0;
      if (n < 0) n = 19;
    } while (tries < 21 && !ok(n));
    g.selected = tries === 21 ? -1 : n;
    return;
  }
  let base = g.selected < 0 ? -1 : g.selected % 10;
  let bank = 0;
  if (command === base) bank = (Math.trunc(g.selected / 10) + 1) & 1;
  else base = command;
  if (ok(bank * 10 + base)) {
    g.selected = bank * 10 + base;
    return;
  }
  if (ok(base + 10)) g.selected = base + 10;
  if (ok(base)) g.selected = base;
}

// ---------------------------------------------------------------------------------------------------------------------
// Armes spéciales : machine à états (`gm_player_weapon_update`)
// ---------------------------------------------------------------------------------------------------------------------

/** Comportements de vol des armes spéciales ; `registerGameplay` les enregistre à la création du monde (ils remplacent ceux de `projectiles`). */
export function registerWeaponBehaviors(world: World): void {
  const fx = (key: string, fn: Behavior): void => world.registerBehavior(key, skipDepop(fn));
  fx("missile_attached", sw.missileAttached);
  fx("pod_dropped", sw.podDropped);
  fx("cruise_missile", sw.cruiseMissile);
  fx("special_bomb", sw.bombFly);
  fx("special_megabomb", sw.bombShockwave);
  fx("special_mortar", sw.mortar);
  fx("special_nova", sw.superNova);
  fx("special_nucleator", sw.nucleator);
  fx("bomblet", sw.bomblet);
  fx("special_napalm", sw.napalm);
  fx("special_superNapalm", sw.superNapalm);
  fx("napalm_drop", sw.napalmDrop);
  fx("missile_class10", missileClass10);
  fx("missile_straight", missileStraight);
  fx("missile_b", missileB);
}

/** Les projectiles n'ont rien à faire pendant leur dépeuplement : ils sont simplement supprimés. */
function skipDepop(fn: Behavior): Behavior {
  return (w, o) => {
    if (o.classe !== DEPOP_MARK) fn(w, o);
  };
}

function ammoOf(world: World, n: number): number {
  return n < 0 ? 0 : world.game.ammo[n]!;
}

/**
 * `gm_player_weapon_update` (`00459c80`), après le pilote : visée, consommation de la munition au tir (état 0x0b), retraits forcés
 * (arme changée, amarrage), bloc de l'arme chargée (`launcherStep`), puis resélection quand le retrait est fini (état 0x1e : l'arme
 * sélectionnée si elle a des munitions, sinon la première possédée).
 */
function weaponUpdate(world: World): void {
  const g = world.game;
  const form = world.player.form;
  updateAim(world);
  if (g.weaponState === 0x0b && g.loaded >= 0) g.ammo[g.loaded]!--;
  if ((g.weaponState === 0 || g.weaponState === 1) && ammoOf(world, g.loaded) === 0) g.weaponState = 0x1e;
  if (g.loaded !== g.selected && g.weaponState === 10) g.weaponState = 0x14;
  if (isDockLocked(world) && g.weaponState === 10) g.weaponState = 0x14;
  launcherStep(world);
  if (!isDockLocked(world) && g.weaponState === 0x1e) {
    if (ammoOf(world, g.selected) === 0) {
      let k = 0;
      while (k < 20 && (g.ammo[k]! === 0 || !isWeaponAllowed(form, k))) k++;
      g.selected = k === 20 ? -1 : k;
    }
    g.loaded = g.selected;
    g.weaponState = 0;
  }
}

/**
 * Entrées d'armes et tir du canon pour un tick (à appeler après le pilote). Pendant l'amarrage ou l'envol du Super Ressort le pilote
 * est coupé : ni sélection ni tir (le canon et `gm_fire_special` sont appelés par les pilotes).
 */
export function playerWeaponsTick(world: World, input: PlayerInput): void {
  const g = world.game;
  const p = world.player;
  if (!g.alive || p.dead) return;
  if (!p.autopilot) {
    if (input.weaponDirect !== null && input.weaponDirect >= 1 && input.weaponDirect <= 10)
      selectWeapon(world, input.weaponDirect - 1);
    if (input.weaponNext) selectWeapon(world, -1);
    if (input.weaponPrev) selectWeapon(world, -2);
    if (input.firePrimary) firePrimary(world);
    if (input.fireSpecial && g.weaponState === 10) g.weaponState = 0x0b;
  }
  g.fireCounter++;
  weaponUpdate(world);
}

/** Noms conservés pour le registre de `gameplay.ts` (les comportements eux-mêmes sont dans `special-weapons.ts`). */
export const specialMissile: Behavior = missileStraight;
export const specialNova: Behavior = sw.superNova;
export const specialMortar: Behavior = sw.mortar;
export const specialNapalm: Behavior = sw.napalm;
export const specialBomb: Behavior = sw.bombFly;
export const napalmDrop: Behavior = sw.napalmDrop;
