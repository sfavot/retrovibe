/**
 * Armes du joueur : canon (`gm_fire_primary` `0046b6fc`, `gm_primary_bullet_spawn` `0046b4b4`), sélection (`gm_weapon_select`
 * `004582dc`), machine d'état de l'arme spéciale (`gm_player_weapon_update` `00459c80`), visée verticale
 * (`gm_player_aim_update` `004599b8`), choix de la cible (`gm_player_pick_target` `00438198`) et les 20 armes spéciales.
 * Voir `docs/swiv3d/rules.md` §3.
 *
 * Écarts assumés : le canon est porté pour les niveaux de puissance 0 à 6 (les seuls atteignables avec les 4 niveaux livrés, plus
 * haut le motif 6 est répété) ; les armes spéciales gardent leurs munitions, modèles, énergies, plafonds et temps d'armement
 * d'origine mais leurs comportements de vol sont approchés (missiles à tête chercheuse exacts, bombe, nova, mortier, napalm et
 * croisière reconstitués d'après `rules.md`, pas d'après le détail des étiquettes `LAB_xxxxxxxx`) ; pas de missile « accroché » au
 * véhicule pendant l'armement.
 */
import {
  PROJECTILE_CLASS,
  SND,
  burst,
  cloneObject,
  explosionBig,
  localVelocity,
  nextRandom,
  smokeTrail,
  sound,
} from "./combat";
import { ANGLE_MASK, COS, SIN } from "./fixed";
import { CLASS, type GameObject } from "./objects";
import { missileSteer } from "./projectiles";
import type { World } from "./world";
import type { PlayerInput } from "./input";

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

/** `gm_primary_bullet_spawn` : balle du canon de type `type`, à la position du joueur, cap et tangage de visée + écarts. */
function primaryBullet(world: World, shot: Shot): void {
  const p = world.player.obj;
  const [type, lat, vert, dYaw, dPitch, energy] = shot;
  const def = BULLET_TYPES[type]!;
  const b = cloneObject(world, p, {
    classe: PROJECTILE_CLASS,
    hp: energy,
    model: def.model,
    update: def.update,
  });
  if (!b) return;
  b.timer = def.life;
  b.pitch = world.game.aimPitch + dPitch;
  b.yaw = p.yaw + dYaw;
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

/** `gm_player_pick_target` : cible du joueur parmi les objets des 7 × 7 cellules devant lui (produit scalaire + biais). */
export function pickPlayerTarget(world: World): void {
  const p = world.player.obj;
  const vx = p.vx >> 8;
  const vz = p.vz >> 8;
  const v2 = vx * vx + vz * vz;
  const period = v2 < 0x1e ? 0x3c : v2 < 0x8c ? 0x23 : 7;
  if (period >= p.age) return;
  const fx = SIN[p.yaw & ANGLE_MASK]!;
  const fz = COS[p.yaw & ANGLE_MASK]!;
  p.target = p;
  let best = 50000;
  const cx = p.x >> 17;
  const cz = p.z >> 17;
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const list = world.grid.cells[((cz + dz) & 63) * 64 + ((cx + dx) & 63)]!;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]!;
        if (c === p || c.owner === p || c.classe & CLASS.GHOST) continue;
        const ax = (c.x - p.x) >> 8;
        const az = (c.z - p.z) >> 8;
        const len = Math.hypot(ax, az) || 1;
        const nx = Math.trunc((ax * 256) / len);
        const nz = Math.trunc((az * 256) / len);
        const bias =
          c.classe & 0x1000 ? 4000 : c.classe & 8 ? -6000 : c.classe & 0x4000 ? -4000 : 0;
        const score = fx * nx + fz * nz + bias;
        if (score > best) {
          best = score;
          p.target = c;
        }
      }
    }
  }
  p.age = 0;
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
// Armes spéciales
// ---------------------------------------------------------------------------------------------------------------------

type SpecialKind =
  | "missiles"
  | "nova"
  | "mortar"
  | "bomb"
  | "napalm"
  | "jump"
  | "thruster";

interface SpecialDef {
  kind: SpecialKind;
  /** Modèle 3D (ou sprite) du projectile et énergie (dégâts). */
  model: number;
  energy: number;
  /** Ticks d'armement. */
  arming: number;
  /** Missiles : `[délai, côté (-1 gauche, 0 centre, 1 droite), écart de cap, écart de tangage]`. */
  shots?: readonly (readonly [number, number, number, number])[];
  /** Virage du missile (pas de 1/512 par tick) et durée de vie (ticks) ; 0 = défaut. */
  turn?: number;
  life?: number;
  /** Bombe : durée de l'onde de choc. */
  wave?: number;
}

const crown = (n: number): readonly (readonly [number, number, number, number])[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [i, 0, Math.round(Math.sin(a) * 14), Math.round(Math.cos(a) * 14)] as const;
  });

const seq = (
  n: number,
  every: number,
): readonly (readonly [number, number, number, number])[] =>
  Array.from({ length: n }, (_, i) => [i * every, i & 1 ? 1 : -1, 0, 0] as const);

/** Les 20 emplacements (`rules.md` §3.2) : munitions et plafonds sont dans `game.ts`. */
export const SPECIALS: readonly SpecialDef[] = [
  { kind: "missiles", model: 800, energy: 80, arming: 20, turn: 2, shots: [[0, 0, 0, 0]] },
  { kind: "missiles", model: 801, energy: 100, arming: 40, turn: 4, shots: [[0, -1, 0, 0], [7, 1, 0, 0]] },
  { kind: "missiles", model: 800, energy: 60, arming: 60, turn: 4, shots: seq(8, 8) },
  { kind: "missiles", model: 856, energy: 100, arming: 40, turn: 2, life: 300, shots: [[0, -1, 0, 0], [0, 1, 0, 0]] },
  { kind: "missiles", model: 800, energy: 60, arming: 40, turn: 3, shots: crown(5) },
  { kind: "nova", model: 855, energy: 80, arming: 40 },
  { kind: "mortar", model: 811, energy: 30, arming: 40 },
  { kind: "bomb", model: 812, energy: 80, arming: 40, wave: 40 },
  { kind: "napalm", model: 858, energy: 80, arming: 40 },
  { kind: "jump", model: 981, energy: 80, arming: 20 },
  { kind: "missiles", model: 800, energy: 70, arming: 20, turn: 2, shots: [[0, -1, 0, 0], [0, 0, 0, 0], [0, 1, 0, 0]] },
  { kind: "missiles", model: 801, energy: 100, arming: 40, turn: 4, shots: [[8, -1, 0, 0], [16, 1, 0, 0], [24, -1, 0, 0], [25, 1, 0, 0]] },
  { kind: "missiles", model: 800, energy: 80, arming: 60, turn: 4, shots: seq(16, 4) },
  { kind: "missiles", model: 856, energy: 100, arming: 40, turn: 2, life: 300, shots: [[0, -1, 0, 0], [4, 1, 0, 0], [8, -1, 0, 0], [12, 1, 0, 0]] },
  { kind: "missiles", model: 801, energy: 80, arming: 40, turn: 4, shots: crown(10) },
  { kind: "nova", model: 855, energy: 80, arming: 40, life: 3 },
  { kind: "mortar", model: 811, energy: 30, arming: 40, life: 3 },
  { kind: "bomb", model: 812, energy: 80, arming: 40, wave: 60 },
  { kind: "napalm", model: 858, energy: 80, arming: 40, life: 2 },
  { kind: "thruster", model: 813, energy: 80, arming: 20 },
];

/** Tirs différés d'une salve (`délai`, arme, indice du tir dans l'arme). */
interface PendingShot {
  at: number;
  weapon: number;
  index: number;
}

const pending: WeakMap<World, PendingShot[]> = new WeakMap();

function launchMissile(world: World, weapon: number, index: number): void {
  const def = SPECIALS[weapon]!;
  const shot = def.shots![index]!;
  const p = world.player.obj;
  const m = cloneObject(world, p, {
    classe: PROJECTILE_CLASS,
    hp: def.energy,
    model: def.model,
    update: "special_missile",
  });
  if (!m) return;
  const [, side, dYaw, dPitch] = shot;
  m.yaw = p.yaw + dYaw;
  m.pitch = world.game.aimPitch + dPitch;
  m.param = def.turn ?? 2;
  m.subtype = def.life ?? 100;
  m.timer = 0;
  m.state = 0;
  m.x += SIN[(p.yaw + 0x80) & ANGLE_MASK]! * 24 * side;
  m.z += COS[(p.yaw + 0x80) & ANGLE_MASK]! * 24 * side;
  m.y -= 6 * 256;
  m.target = p.target;
  localVelocity(m, 0, 0, 5000);
  sound(world, SND.missile, p);
}

/** Lance l'arme `n` (état 0x0b) : missiles différés, ou projectile unique. */
function launch(world: World, n: number): void {
  const def = SPECIALS[n]!;
  const g = world.game;
  const p = world.player.obj;
  g.ammo[n]!--;
  if (def.kind === "missiles") {
    const list = pending.get(world) ?? [];
    pending.set(world, list);
    def.shots!.forEach((s, i) => {
      if (s[0] === 0) launchMissile(world, n, i);
      else list.push({ at: world.tickCount + s[0], weapon: n, index: i });
    });
    return;
  }
  const o = cloneObject(world, p, {
    classe: PROJECTILE_CLASS,
    hp: def.energy,
    model: def.model,
    update: `special_${def.kind}`,
  });
  switch (def.kind) {
    case "nova":
    case "napalm":
      if (o) {
        o.pitch = g.aimPitch;
        o.subtype = def.life ?? 1;
        localVelocity(o, 0, 0, 4500);
      }
      sound(world, SND.missile, p);
      break;
    case "mortar":
      if (o) {
        o.pitch = g.aimPitch + 20;
        o.subtype = def.life ?? 1;
        localVelocity(o, 0, 0, 3000);
        o.vy += 2000;
      }
      sound(world, SND.missile, p);
      break;
    case "bomb":
      if (o) {
        o.pitch = g.aimPitch;
        o.subtype = def.wave ?? 40;
        localVelocity(o, 0, 0, 3500);
      }
      sound(world, SND.missile, p);
      break;
    case "jump":
      // Super ressort : impulsion verticale du véhicule roulant (effet exact non décodé)
      p.vy += 3500;
      sound(world, SND.missile, p);
      if (o) o.classe = 0;
      break;
    case "thruster":
      // Accélérateur : poussée avant forte pendant quelques ticks (effet exact non décodé)
      world.player.thrust += 4000;
      sound(world, SND.missile, p);
      if (o) o.classe = 0;
      break;
  }
}

/** Salves différées : lance les missiles dont le délai est écoulé. */
function flushPending(world: World): void {
  const list = pending.get(world);
  if (!list || list.length === 0) return;
  const rest: PendingShot[] = [];
  for (const s of list) {
    if (s.at <= world.tickCount) launchMissile(world, s.weapon, s.index);
    else rest.push(s);
  }
  pending.set(world, rest);
}

/** `gm_player_weapon_update` : machine à états de l'arme spéciale (`+0x178`). */
function weaponStateMachine(world: World, fireSpecial: boolean): void {
  const g = world.game;
  const form = world.player.form;
  if (g.weaponState === 0x0b) {
    // le tir : consommation de la munition et lancement, puis réarmement de l'arme suivante
    launch(world, g.loaded);
    g.weaponState = 1;
    g.weaponCounter = 0;
  }
  if (g.weaponState === 0 || g.weaponState === 1) {
    if (g.loaded !== g.selected) g.loaded = g.selected;
    if (g.loaded >= 0) {
      if (g.ammo[g.loaded]! === 0) g.weaponState = 0x1e;
      else {
        g.weaponState = 2;
        g.weaponCounter = 0;
      }
    }
  } else if (g.weaponState === 2) {
    g.weaponCounter++;
    if (g.weaponCounter >= SPECIALS[g.loaded]!.arming) g.weaponState = 10;
  } else if (g.weaponState === 10) {
    if (g.loaded !== g.selected) {
      g.weaponState = 0x14;
      g.weaponCounter = 0;
      sound(world, SND.retract, world.player.obj);
    } else if (fireSpecial) g.weaponState = 0x0b;
  } else if (g.weaponState === 0x14) {
    g.weaponCounter++;
    if (g.weaponCounter >= 6) g.weaponState = 0x1e;
  }
  if (g.weaponState === 0x1e) {
    if (g.selected >= 0 && g.ammo[g.selected]! === 0) {
      let k = 0;
      while (k < 20 && (g.ammo[k]! === 0 || !isWeaponAllowed(form, k))) k++;
      g.selected = k === 20 ? -1 : k;
    }
    g.loaded = g.selected;
    g.weaponState = 0;
  }
}

/** Entrées d'armes et tir du canon pour un tick (à appeler après le pilote). */
export function playerWeaponsTick(world: World, input: PlayerInput): void {
  const g = world.game;
  const p = world.player;
  if (!g.alive || p.dead) return;
  if (input.weaponDirect !== null && input.weaponDirect >= 1 && input.weaponDirect <= 10)
    selectWeapon(world, input.weaponDirect - 1);
  if (input.weaponNext) selectWeapon(world, -1);
  if (input.weaponPrev) selectWeapon(world, -2);
  if (input.firePrimary) firePrimary(world);
  g.fireCounter++;
  updateAim(world);
  weaponStateMachine(world, input.fireSpecial);
  flushPending(world);
}

// ---------------------------------------------------------------------------------------------------------------------
// Comportements de vol des armes spéciales
// ---------------------------------------------------------------------------------------------------------------------

const rnd = { x: 0, y: 0, z: 0 };

function groundOrDead(world: World, o: GameObject): boolean {
  if (world.terrain.height(o.x, o.z) >= o.y || o.hp < 1) {
    o.classe = 0;
    burst(world, o);
    return true;
  }
  return false;
}

/** Missile des armes 0 à 4 et 10 à 14 : tête chercheuse (virage `param`), vol libre au-delà de `subtype` ticks. */
export function specialMissile(world: World, o: GameObject): void {
  groundOrDead(world, o);
  if (o.timer < o.subtype) missileSteer(o, o.param);
  else localVelocity(o, 0, 0, 5000);
  smokeTrail(world, o, 4);
  o.timer++;
}

/** Lâche des éclats autour de `o` : `n` balles de modèle `model` (énergie `hp`) dans des directions pseudo-aléatoires. */
function scatter(world: World, o: GameObject, n: number, model: number, hp: number, speed: number): void {
  for (let i = 0; i < n; i++) {
    const b = cloneObject(world, o, { classe: PROJECTILE_CLASS, hp, model, update: "bullet" });
    if (!b) return;
    nextRandom(world, rnd);
    b.vx = rnd.x * speed;
    b.vy = Math.abs(rnd.y) * speed;
    b.vz = rnd.z * speed;
  }
}

/** Super Nova (`0045754c`) et Nucléator (`00457abc`) : vitesse 4 500, se désintègre en bombelettes après 35 ticks. */
export function specialNova(world: World, o: GameObject): void {
  if (groundOrDead(world, o)) return;
  smokeTrail(world, o, 3);
  o.timer++;
  if (o.timer >= 35) {
    o.classe = 0;
    explosionBig(world, o);
    const mult = o.subtype;
    scatter(world, o, 6 * mult, 10001, 25, 12);
    scatter(world, o, 6 * mult, 10005, 15, 14);
  }
}

/** Bombe mortier (`00457074`) : lancée en cloche, explose au contact ou après 40 ticks en éclats. */
export function specialMortar(world: World, o: GameObject): void {
  o.vy -= 130;
  o.timer++;
  if (world.terrain.height(o.x, o.z) >= o.y || o.hp < 1 || o.timer >= 40) {
    o.classe = 0;
    explosionBig(world, o);
    const mult = o.subtype;
    scatter(world, o, 6 * mult, 10005, 15, 10);
    scatter(world, o, 4 * mult, 10001, 20, 10);
  }
}

/** Napalm (`00457784`) : vitesse 4 500, sème des gouttes enflammées (10005, 50 pv) pendant 120 ticks. */
export function specialNapalm(world: World, o: GameObject): void {
  o.timer++;
  if (o.timer > 120) {
    o.classe = 0;
    burst(world, o);
    return;
  }
  if (world.terrain.height(o.x, o.z) + 2000 >= o.y) o.vy = Math.max(o.vy, 600);
  if (o.timer % 4 === 0) {
    for (let i = 0; i < o.subtype; i++) {
      const d = cloneObject(world, o, { classe: PROJECTILE_CLASS, hp: 50, model: 10005, update: "napalm_drop" });
      if (!d) break;
      nextRandom(world, rnd);
      d.vx = rnd.x << 1;
      d.vz = rnd.z << 1;
      d.vy = 0;
      d.owner = world.player.obj;
    }
  }
}

/** Goutte de napalm : tombe (gravité 60) et s'éteint au sol ou à 0 pv. */
export function napalmDrop(world: World, o: GameObject): void {
  o.vy -= 60;
  groundOrDead(world, o);
}

/**
 * Bombe (`00455370`, `004556dc`) : avance 40 ticks en ralentissant, puis onde de choc de `subtype` ticks : un tick sur deux,
 * chaque objet non invulnérable à moins de 2 048 unités subit `sin((d² >> 9) + (t - 20) × 64) × t / 64` pv (jusqu'à 160).
 */
export function specialBomb(world: World, o: GameObject): void {
  o.timer++;
  if (o.timer <= 40) {
    o.vx = (o.vx * 15) >> 4;
    o.vy = (o.vy * 15) >> 4;
    o.vz = (o.vz * 15) >> 4;
    if (world.terrain.height(o.x, o.z) >= o.y) o.vy = Math.max(o.vy, 0);
    return;
  }
  o.vx = o.vy = o.vz = 0;
  o.hp = 1000;
  o.flags |= 0x04;
  const t = o.subtype - (o.timer - 40);
  if (t <= 0) {
    o.classe = 0;
    return;
  }
  if ((o.timer & 7) === 0) explosionBig(world, o);
  if ((o.timer & 1) === 0) shockwave(world, o, t);
}

function shockwave(world: World, o: GameObject, t: number): void {
  const player = world.player.obj;
  const cx = o.x >> 17;
  const cz = o.z >> 17;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const c of world.grid.cells[((cz + dz) & 63) * 64 + ((cx + dx) & 63)]!) {
        if (c === o || c === player || c.owner === player || c.flags & 0x04 || c.classe & CLASS.GHOST) continue;
        const ax = (c.x - o.x) >> 8;
        const ay = (c.y - o.y) >> 8;
        const az = (c.z - o.z) >> 8;
        const d2 = ax * ax + ay * ay + az * az;
        if (d2 > 2048 * 2048) continue;
        const dmg = Math.trunc((SIN[((d2 >> 9) + (t - 20) * 64) & ANGLE_MASK]! * t) / 64);
        if (dmg > 0) {
          c.hp -= dmg;
          c.flags = (c.flags | 0x102) & ~0x20;
          c.target = player;
        }
      }
    }
  }
}

