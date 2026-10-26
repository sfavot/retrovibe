/**
 * Lanceurs d'armes spéciales du joueur : les missiles et nacelles accrochés au véhicule pendant l'armement, leur tir et leur
 * retrait, portés des quatre fonctions `gm_special_weapon_ship*` de l'exe (`00459f30` hélicoptère, `0045e128` formes 1 et 2,
 * `004629e4` formes 4 et 5, identique à la précédente, `004672a0` forme 3). Voir `docs/swiv3d/rules.md` §3.2 et §3.3.
 *
 * Chaque arme crée au moins un objet « lanceur » (classe `0x40`, comportement `gm_upd_missile_attached`) à l'état 0 ; pendant l'état 2
 * un compteur `k` (`+0x17c`) monte jusqu'à `steps` et l'objet est posé à `grow(k)` (décalage latéral, vertical, avant dans le repère du
 * véhicule : `gm_attach_offset` `004580f0`) ; à l'état 10 il reste à `hold` ; le tir (état 0x0b) lui donne son comportement de vol ; le
 * retrait (0x14 → 0x16) rejoue l'armement à l'envers. Les hélicoptères portent les missiles sous le fuselage (décalage vertical
 * négatif), les véhicules au-dessus (positif) : deux tables, `HELI` (formes 0 et 3) et `GROUND` (formes 1, 2, 4, 5).
 *
 * Écarts : la forme 3 a ses propres constantes dans l'exe (non reportées : elle reprend celles de l'hélicoptère, aucune des missions
 * livrées ne la donne) ; le signe latéral des armes à nacelle unique (5 à 8, 15 à 18) est celui de l'ordre des blocs de l'exe (nova +,
 * mortier −, bombe +, napalm −, nucléateur +, super mortier −, méga-bombe −, super napalm +), non vérifié bloc par bloc.
 */
import { attachTo } from "./attach";
import { SND, cloneObject, localVelocity, smokeTrail, sound } from "./combat";
import { ANGLE_MASK, COS, SIN, normalize256 } from "./fixed";
import { CLASS, FLAG, GRID_SIZE, type GameObject } from "./objects";
import { PLAYER_PROJECTILE_CLASS } from "./special-weapons";
import type { World } from "./world";

/** Décalage (latéral, vertical, avant), 1/256 d'unité, dans le repère du véhicule. */
type Offset = readonly [number, number, number];

/** Un lanceur : modèle et pv du clone, position pendant l'armement `lat = latB + latK·k`, `vert = vertK·k`, `fwd = fwdB + fwdK·k`. */
interface Pod {
  model: number;
  hp: number;
  latK: number;
  latB: number;
  vertK: number;
  fwdK: number;
  fwdB: number;
  hold: Offset;
}

interface Launcher {
  pods: readonly Pod[];
  /** Valeur du compteur à la fin de l'armement. */
  steps: number;
}

/** Emplacements d'objets : `+0x19c`, `+0x1a0`, `+0x1a4` et `+0x1cc`, `+0x1d0`, `+0x1d4`, `+0x1d8`. */
const S19C = 0;
const S1A0 = 1;
const S1A4 = 2;
const S1CC = 3;
const S1D0 = 4;
const S1D4 = 5;
const S1D8 = 6;

interface Slots {
  objs: (GameObject | null)[];
}

const slotsOf = new WeakMap<World, Slots>();

function slots(world: World): Slots {
  let s = slotsOf.get(world);
  if (!s) {
    s = { objs: new Array<GameObject | null>(7).fill(null) };
    slotsOf.set(world, s);
  }
  return s;
}

function pod(
  model: number,
  hp: number,
  hold: Offset,
  o: Partial<Pick<Pod, "latK" | "latB" | "vertK" | "fwdK" | "fwdB">> = {},
): Pod {
  return { model, hp, hold, latK: 0, latB: 0, vertK: 0, fwdK: 0, fwdB: 0, ...o };
}

type Group = "heli" | "ground";

/** Armes à une nacelle de `10`, `75`, `100` par tick (5 à 8 et 15 à 18) : modèle, pv, signe latéral. */
const SINGLES: readonly (readonly [number, number, number, number])[] = [
  [5, 855, 80, +1],
  [6, 811, 30, -1],
  [7, 812, 80, +1],
  [8, 858, 80, -1],
  [15, 855, 80, +1],
  [16, 811, 30, -1],
  [17, 812, 80, -1],
  [18, 858, 80, +1],
];

function build(group: Group): readonly (Launcher | null)[] {
  const heli = group === "heli";
  const v = (a: number, b: number): number => (heli ? a : b);
  const L: (Launcher | null)[] = new Array<Launcher | null>(20).fill(null);
  // 0 : missile unique
  L[0] = { steps: 0x14, pods: [pod(800, 80, [0, v(-3000, 4000), 0], { vertK: v(-150, 200) })] };
  // 1, 3, 13 et 2, 12 : deux lanceurs à droite et à gauche
  const pair = (
    model: number,
    hp: number,
    steps: number,
    lat: number,
    vert: number,
    holdLat: number,
    holdVert: number,
    fwd = 0,
  ): Launcher => ({
    steps,
    pods: [
      pod(model, hp, [holdLat, holdVert, fwd], { latK: lat, vertK: vert, fwdB: fwd }),
      pod(model, hp, [-holdLat, holdVert, fwd], { latK: -lat, vertK: vert, fwdB: fwd }),
    ],
  });
  L[1] = pair(801, 100, 0x28, v(100, 125), v(-17, 50), v(4000, 5000), v(-700, 2000));
  L[2] = pair(850, 100, 0x3c, v(100, 103), v(-23, 35), v(6000, 6200), v(-1400, 2300), -1500);
  L[3] = pair(856, 100, 0x28, v(200, 225), v(-17, 50), v(8000, 9000), v(-700, 2000));
  L[12] = pair(850, 100, 0x3c, v(100, 103), v(-23, 65), v(6000, 6200), v(-1400, 2300), -1500);
  L[13] = pair(856, 100, 0x28, v(200, 225), v(-17, 50), v(8000, 9000), v(-700, 2000));
  // 4 et 14 : nacelle centrale qui descend (roquettes en couronne)
  L[4] = { steps: 0x28, pods: [pod(854, 80, [0, v(-3500, 4000), 0], { vertK: v(-87, 100) })] };
  L[14] = { steps: 0x28, pods: [pod(854, 80, [0, v(-3500, 4000), 0], { vertK: v(-87, 100) })] };
  // 5 à 8 et 15 à 18 : une nacelle sur le côté et en avant
  for (const [n, model, hp, sign] of SINGLES)
    L[n] = {
      steps: 0x28,
      pods: [pod(model, hp, [3000 * sign, v(400, 2400), 4000], { latK: 75 * sign, vertK: v(10, 60), fwdK: 100 })],
    };
  // 9 et 19 (véhicules roulants) : nacelle au-dessus et derrière
  if (!heli) {
    L[9] = { steps: 0x14, pods: [pod(981, 80, [0, 4000, -4000], { vertK: 200, fwdK: -200 })] };
    L[19] = { steps: 0x14, pods: [pod(813, 80, [0, 4000, -4000], { vertK: 200, fwdK: -200 })] };
  }
  // 10 : deux lanceurs latéraux et un sous (au-dessus) le fuselage
  L[10] = {
    steps: 0x28,
    pods: [
      pod(800, 70, [4000, v(-700, 700), 0], { latK: 100, vertK: v(-17, 17) }),
      pod(800, 70, [-4000, v(-700, 700), 0], { latK: -100, vertK: v(-17, 17) }),
      pod(800, 70, [0, v(-4000, 4000), 0], { vertK: v(-100, 100) }),
    ],
  };
  // 11 : quatre lanceurs
  const hl = v(100, 125);
  const hv = v(-17, 50);
  const hvHold = v(-700, 2000);
  const hlHold = hl * 0x28;
  L[11] = {
    steps: 0x28,
    pods: [
      pod(801, 100, [hlHold + 3000, hvHold, 0], { latK: hl, latB: 3000, vertK: hv }),
      pod(801, 100, [-hlHold - 3000, hvHold, 0], { latK: -hl, latB: -3000, vertK: hv }),
      pod(801, 100, [hlHold, hvHold, 0], { latK: hl, vertK: hv }),
      pod(801, 100, [-hlHold, hvHold, 0], { latK: -hl, vertK: hv }),
    ],
  };
  return L;
}

const HELI = build("heli");
const GROUND = build("ground");

/** Table du lanceur de l'arme `n` pour la forme du joueur, `null` si l'arme n'a pas de lanceur pour cette forme. */
export function launcherOf(form: number, n: number): Launcher | null {
  if (n < 0) return null;
  const ground = form === 1 || form === 2 || form === 4 || form === 5;
  return (ground ? GROUND : HELI)[n] ?? null;
}

/** `gm_attach_offset` (`004580f0`) : pose `o` à `(lat, vert, fwd)` dans le repère (cap, tangage, roulis) du joueur, étage par étage. */
export function attachOffset(world: World, o: GameObject, lat: number, vert: number, fwd: number): void {
  attachTo(world.player.obj, o, lat, vert, fwd);
}

// ---------------------------------------------------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------------------------------------------------

/** Emplacements utilisés selon le nombre de lanceurs : 1 ou 2 (`+0x19c`, `+0x1a0`), 3 ou 4 (`+0x1cc` à `+0x1d8`). */
function slotIndices(_n: number, count: number): readonly number[] {
  if (count === 1) return [S19C];
  if (count === 2) return [S19C, S1A0];
  return count === 3 ? [S1CC, S1D0, S1D4] : [S1CC, S1D0, S1D4, S1D8];
}

function setupPods(world: World, L: Launcher, n: number, sounded: boolean): void {
  const g = world.game;
  const s = slots(world);
  const idx = slotIndices(n, L.pods.length);
  L.pods.forEach((p, i) => {
    const o = cloneObject(world, world.player.obj, { classe: 0x40, hp: p.hp, model: p.model, update: "missile_attached" });
    s.objs[idx[i]!] = o;
  });
  g.weaponCounter = 0;
  g.weaponState = 2;
  if (sounded) sound(world, SND.armed, world.player.obj);
}

function offsetAt(p: Pod, k: number): Offset {
  return [p.latB + p.latK * k, p.vertK * k, p.fwdB + p.fwdK * k];
}

function placePods(world: World, L: Launcher, n: number, at: "grow" | "hold"): void {
  const s = slots(world);
  const idx = slotIndices(n, L.pods.length);
  const k = world.game.weaponCounter;
  L.pods.forEach((p, i) => {
    const o = s.objs[idx[i]!];
    if (!o) return;
    const [lat, vert, fwd] = at === "hold" ? p.hold : offsetAt(p, k);
    attachOffset(world, o, lat, vert, fwd);
  });
}

/** Tous les lanceurs de l'arme `n` existent-ils (clones réussis) ? */
function podsReady(world: World, L: Launcher, n: number): boolean {
  const s = slots(world);
  return slotIndices(n, L.pods.length).every((i) => s.objs[i] != null && s.objs[i]!.classe !== 0);
}

function podAt(world: World, slot: number): GameObject {
  return slots(world).objs[slot]!;
}

/** Donne au lanceur son comportement de vol : `classe = 0x100003f` (classe `0x3f`, drapeau `0x100`), cible du joueur. */
function release(world: World, o: GameObject, update: string): void {
  o.update = update;
  o.classe = PLAYER_PROJECTILE_CLASS;
  o.flags = FLAG.HIT;
  o.target = world.player.obj.target;
}

function dropPod(world: World, o: GameObject, fwd: number, lat: number, vert: number, rotate: 0 | 1): void {
  o.update = "pod_dropped";
  localVelocity(o, lat, vert, fwd);
  o.state = rotate;
  sound(world, SND.podDrop, o);
}

function killPods(world: World, ...which: number[]): void {
  const s = slots(world);
  for (const i of which) {
    const o = s.objs[i];
    if (o) o.classe = 0;
    s.objs[i] = null;
  }
}

/**
 * `FUN_0043848c` et `gm_player_pick_target` (`00438198`, au calcul de la période près) : cible la mieux placée devant le cap de `m`
 * parmi les objets des 7 × 7 cellules (`gm_grid_query_cells(3, 0x40044)` : ni fantôme, ni cible `0x04`, ni invulnérable ; produit
 * scalaire du cap avec la direction de l'objet normalisée à 256, plus le biais +4 000 objectif, −6 000 dangereux, −4 000 peu
 * prioritaire ; seuil 50 000) ; sans résultat la cible est `m` lui-même. Remet l'âge à 0.
 */
export function scanTarget(world: World, m: GameObject): void {
  const fx = SIN[m.yaw & ANGLE_MASK]!;
  const fz = COS[m.yaw & ANGLE_MASK]!;
  m.target = m;
  let best = 50000;
  const cx = m.x >> 17;
  const cz = m.z >> 17;
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const list = world.grid.cells[((cz + dz) & (GRID_SIZE - 1)) * GRID_SIZE + ((cx + dx) & (GRID_SIZE - 1))]!;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]!;
        if ((c.classe & 0x44) !== 0 || c.flags & FLAG.INVULNERABLE) continue;
        const o = { x: 0, y: 0, z: 0 };
        normalize256((c.x - m.x) >> 8, 0, (c.z - m.z) >> 8, o);
        const bias = c.classe & 0x1000 ? 4000 : c.classe & 8 ? -6000 : c.classe & 0x4000 ? -4000 : 0;
        const score = fx * o.x + fz * o.z + bias;
        if (score > best) {
          best = score;
          m.target = c;
        }
      }
    }
  }
  m.age = 0;
}

/**
 * `gm_child_copy_tilt` (`00441d40`) : tangage et roulis de `child` = ceux de `parent` tournés de l'écart de cap entre eux.
 */
function copyTilt(child: GameObject, parent: GameObject): void {
  const d = (child.yaw - parent.yaw) & ANGLE_MASK;
  const s = SIN[d]!;
  const c = COS[d]!;
  const pitch = parent.pitch;
  const roll = parent.roll;
  child.pitch = (pitch * c - roll * s) >> 8;
  child.roll = (pitch * s + roll * c) >> 8;
}

/** Table `00484468` : 9 positions (latéral, vertical, avant) des missiles de la salve des armes 2 et 12. */
const SALVO_POSITIONS: readonly Offset[] = [
  [500, -500, 0],
  [500, -500, 0],
  [-500, -500, 0],
  [500, 500, 0],
  [-500, 500, 0],
  [500, -500, 0],
  [-500, -500, 0],
  [500, 500, 0],
  [-500, 500, 0],
];
/** Table `004844d4` : écarts de cap de la salve de l'arme 12. */
const SALVO_YAW = [0, -10, 10, -25, 25, -40, 40, -55, 55] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Machine à états d'une arme : un tick du bloc de l'arme chargée (`g.loaded`)
// ---------------------------------------------------------------------------------------------------------------------

/** Armes dont le tir donne seulement son vol à la nacelle unique : comportement, tangage au tir (`+0x38`) et réglages propres. */
interface SingleFire {
  update: string;
  pitch?: number;
  /** Le mortier garde la classe `0x40` de la nacelle (le tir ne la change pas : `+4` n'est pas écrit). */
  ghost?: boolean;
  init?(o: GameObject): void;
}

const SINGLE_FIRE: Record<number, SingleFire> = {
  0: { update: "missile_straight" },
  5: { update: "special_nova", pitch: 0x46 },
  6: {
    update: "special_mortar",
    ghost: true,
    init: (o) => {
      localVelocity(o, 0, 1500, 0x514);
      o.state = 0;
      o.pitch = 0;
      o.roll = 0;
      o.timer = 0;
    },
  },
  7: { update: "special_bomb", pitch: 0x46 },
  8: { update: "special_napalm", pitch: 0x3c },
  15: { update: "special_nucleator", pitch: 0x46 },
  16: {
    update: "special_mortar",
    ghost: true,
    init: (o) => {
      localVelocity(o, 0, 1500, 0x514);
      o.state = 1;
      o.pitch = 0;
      o.roll = 0;
      o.timer = 2;
    },
  },
  17: { update: "special_megabomb", pitch: 0x46 },
  18: { update: "special_superNapalm", pitch: 0x3c },
};

/** Retrait des armes (état 0x14 → 0x16) : son 3001, puis compteur à rebours qui rejoue l'armement à l'envers. */
function retractStep(world: World, L: Launcher, n: number): void {
  const g = world.game;
  if (g.weaponState === 0x14) {
    sound(world, SND.retract, world.player.obj);
    g.weaponState = 0x16;
    if (n === 2 || n === 12) g.weaponCounter = 0x3c;
    return;
  }
  g.weaponCounter--;
  placePods(world, L, n, "grow");
  if (n === 4 || n === 14) podAt(world, S19C).timer--;
  if (g.weaponCounter === 0) {
    killPods(world, ...slotIndices(n, L.pods.length));
    g.weaponState = 0x1e;
  }
}

/**
 * Un tick du bloc de l'arme chargée (`+0x11c`) : états 0 et 1 (création des lanceurs), 2 (armement), 10 (armée), 0x0b à 0x0d (tir
 * et salves), 0x14 et 0x16 (retrait). Une arme sans lanceur pour la forme (arme 9 ou 19 de l'hélicoptère) passe à l'état 0x1e.
 */
export function launcherStep(world: World): void {
  const g = world.game;
  const n = g.loaded;
  if (n < 0) return;
  const L = launcherOf(world.player.form, n);
  if (!L) {
    if (n === 9 || n === 19) g.weaponState = 0x1e;
    return;
  }
  const st = g.weaponState;
  if ((st === 2 || st === 10 || st === 0x14 || st === 0x16) && !podsReady(world, L, n)) {
    // un lanceur n'a pas pu être créé (pool plein) : on repart de la création
    g.weaponState = 0;
    return;
  }
  if (st === 0 || st === 1) {
    // les armes à salve longue (2 et 12) n'ont pas de bloc pour l'état 1 : elles rechargent par l'état 0
    if (st === 1 && (n === 2 || n === 12)) return;
    setupPods(world, L, n, st === 0);
  } else if (st === 2) {
    g.weaponCounter++;
    placePods(world, L, n, "grow");
    if (n === 4 || n === 14) podAt(world, S19C).timer++;
    if (g.weaponCounter === L.steps) g.weaponState = 10;
  } else if (st === 10) placePods(world, L, n, "hold");
  else if (st === 0x14 || st === 0x16) retractStep(world, L, n);
  else if (st >= 0x0b && st <= 0x0d) fire(world, L, n, st);
}

/** Tir (état 0x0b) puis salves en cours (0x0c, 0x0d) de l'arme `n`. */
function fire(world: World, L: Launcher, n: number, st: number): void {
  const g = world.game;
  const player = world.player.obj;
  const single = SINGLE_FIRE[n];
  if (single) {
    if (st !== 0x0b) return;
    const o = podAt(world, S19C);
    release(world, o, single.update);
    if (single.ghost) {
      o.classe = 0x40;
      o.flags = 0;
    }
    if (single.pitch !== undefined) {
      o.roll = 0;
      o.pitch = single.pitch;
      o.timer = 0;
    }
    single.init?.(o);
    g.weaponState = 1;
    o.age = 0;
    sound(world, SND.missile, o);
    return;
  }
  switch (n) {
    case 1:
    case 3:
    case 13: {
      // deux missiles : le second part 7 ticks après le premier
      const launch = (o: GameObject, first: boolean): void => {
        if (n === 1) release(world, o, "missile_b");
        else {
          release(world, o, "cruise_missile");
          o.age = 0;
          o.timer = 300;
          o.state = n === 3 ? (first ? 10 : 11) : first ? 0x14 : 0x15;
        }
        sound(world, SND.missile, o);
      };
      if (st === 0x0b) {
        launch(podAt(world, S19C), true);
        g.weaponCounter = 7;
        g.weaponState = 0x0c;
      } else if (st === 0x0c) {
        g.weaponCounter--;
        if (g.weaponCounter === 0) g.weaponState = 0x0d;
        attachOffset(world, podAt(world, S1A0), ...L.pods[1]!.hold);
      } else {
        launch(podAt(world, S1A0), false);
        g.weaponState = 1;
        g.weaponCounter = 0x28;
      }
      return;
    }
    case 2:
    case 12:
      salvo(world, L, n, st);
      return;
    case 4:
    case 14: {
      // roquettes en couronne : la nacelle tourne sur elle-même, chaque missile cherche sa cible dans son cap
      if (st !== 0x0b) return;
      const pd = podAt(world, S19C);
      sound(world, SND.missile, pd);
      const crown = n === 4;
      for (let i = 0; i < (crown ? 5 : 8); i++) {
        pd.yaw += crown ? 0x66 : 0x40;
        copyTilt(pd, player);
        const m = cloneObject(world, pd, {
          classe: PLAYER_PROJECTILE_CLASS,
          hp: crown ? 0x3c : 0x50,
          model: crown ? 800 : 801,
          update: "missile_b",
        });
        if (!m) continue;
        scanTarget(world, m);
        if (m.target === m) m.target = player.target;
      }
      dropPod(world, pd, -400, 200, world.player.form === 0 || world.player.form === 3 ? 0 : 1000, 0);
      g.weaponState = 1;
      return;
    }
    case 10: {
      // le lanceur du dessous part le premier, les deux latéraux 10 ticks plus tard
      if (st === 0x0b) {
        release(world, podAt(world, S1D4), "missile_b");
        g.weaponCounter = 10;
        g.weaponState = 0x0c;
        sound(world, SND.missile, podAt(world, S1D4));
      } else if (st === 0x0c) {
        g.weaponCounter--;
        if (g.weaponCounter === 0) g.weaponState = 0x0d;
        attachOffset(world, podAt(world, S1CC), ...L.pods[0]!.hold);
        attachOffset(world, podAt(world, S1D0), ...L.pods[1]!.hold);
      } else {
        release(world, podAt(world, S1CC), "missile_straight");
        release(world, podAt(world, S1D0), "missile_straight");
        g.weaponState = 1;
        g.weaponCounter = 0x28;
        sound(world, SND.missile, podAt(world, S1CC));
      }
      return;
    }
    case 11: {
      // quatre missiles : le premier tout de suite, les autres aux ticks 8, 16 et 24 de la salve
      const quad = [S1CC, S1D0, S1D4, S1D8] as const;
      if (st === 0x0b) {
        release(world, podAt(world, quad[0]), "missile_b");
        g.weaponCounter = 0;
        g.weaponState = 0x0c;
        sound(world, SND.missile, podAt(world, quad[0]));
      } else if (st === 0x0c) {
        g.weaponCounter++;
        const k = g.weaponCounter;
        const limits = [8, 0x10, 0x18] as const;
        for (let i = 0; i < 3; i++) {
          if (k < limits[i]!) attachOffset(world, podAt(world, quad[i + 1]!), ...L.pods[i + 1]!.hold);
          if (k === limits[i]) {
            release(world, podAt(world, quad[i + 1]!), "missile_b");
            sound(world, SND.missile, podAt(world, quad[i + 1]!));
          }
        }
        if (k === 0x19) g.weaponState = 1;
      }
      return;
    }
    case 9:
      jumpBoost(world, L, st);
      return;
    case 19:
      thruster(world, L, st);
      return;
  }
}

/**
 * Salve des armes 2 (Multi-tir) et 12 (Mégacanon) : après l'armement, 8 missiles (un tous les 8 ticks à partir du 8ᵉ, en 4 coins autour
 * du véhicule ; le Mégacanon les oriente dans un éventail de 8 caps pour choisir leurs cibles), puis les deux nacelles sont larguées
 * aux ticks 70 et 85 ; à 90 la balance repart de l'état 0.
 */
function salvo(world: World, L: Launcher, n: number, st: number): void {
  const g = world.game;
  const mega = n === 12;
  const ground = world.player.form !== 0 && world.player.form !== 3;
  if (st === 0x0b) {
    g.weaponCounter = 0;
    g.weaponState = 0x0c;
    return;
  }
  if (st !== 0x0c) return;
  g.weaponCounter++;
  const k = g.weaponCounter;
  const idx = k >> 3;
  if (k % 8 === 0 && idx < 9) {
    const m = cloneObject(world, world.player.obj, {
      classe: PLAYER_PROJECTILE_CLASS,
      hp: mega ? 0x50 : 0x3c,
      model: mega ? 857 : 800,
      update: "missile_b",
    });
    if (m) {
      slots(world).objs[S1A4] = m;
      if (mega) {
        m.yaw += SALVO_YAW[idx]!;
        scanTarget(world, m);
        m.yaw -= SALVO_YAW[idx]!;
      }
      attachOffset(world, m, ...SALVO_POSITIONS[idx]!);
    }
    sound(world, SND.missile, world.player.obj);
  }
  const a = podAt(world, S19C);
  const b = podAt(world, S1A0);
  if (k < 0x4b) attachOffset(world, a, ...L.pods[0]!.hold);
  if (k < 0x50) attachOffset(world, b, ...L.pods[1]!.hold);
  // vitesses de largage (avant, latéral, vertical) : hélicoptère -400 / ±200 / 0, véhicules -300 / ±400 / +900, Mégacanon 4000 / ±200 / 0
  const fwd = mega ? 4000 : ground ? -300 : -400;
  const lat = mega ? 200 : ground ? 400 : 200;
  const vert = ground && !mega ? 900 : 0;
  if (k === 0x46) {
    a.update = "pod_dropped";
    localVelocity(a, lat, vert, fwd);
    a.state = 0;
    sound(world, SND.podDrop, a);
  }
  if (k === 0x55) {
    b.update = "pod_dropped";
    localVelocity(b, -lat, vert, fwd);
    // défaut de l'exe (arme 2 des véhicules) : le sens de rotation est écrit sur la première nacelle, pas sur la seconde
    if (ground && !mega) a.state = 1;
    else b.state = 1;
    sound(world, SND.podDrop, b);
  }
  if (k === 0x5a) g.weaponState = 0;
}

/**
 * Arme 9, Super Ressort (véhicules 1, 2, 4, 5) : le pilote est coupé et le véhicule n'est plus une cible (`classe & ~4`) ; 30 ticks de
 * cabrage (tangage + 4 jusqu'à 90, vitesse horizontale nulle, état 2 de la physique), puis poussée à 9 000 dans l'axe du véhicule
 * jusqu'au tick 80 (état 3, que la physique remet à 0 au contact du sol) ; l'envol finit à l'atterrissage, nacelle larguée.
 */
function jumpBoost(world: World, L: Launcher, st: number): void {
  const g = world.game;
  const p = world.player.obj;
  const o = podAt(world, S19C);
  if (st === 0x0b) {
    g.weaponCounter = 0;
    g.weaponState = 0x0c;
    world.player.autopilot = true;
    p.classe &= ~CLASS.TARGET;
    return;
  }
  if (st !== 0x0c) return;
  g.weaponCounter++;
  const k = g.weaponCounter;
  if (k < 0x1e) {
    if (p.pitch < 0x5a) p.pitch += 4;
    p.vx = 0;
    p.vz = 0;
    p.state = 2;
    if (k === 0x1a) sound(world, 0xfb4, p);
  } else if (k < 0x50) {
    p.state = 3;
    localVelocity(p, 0, 0, 9000);
    smokeTrail(world, p, 0);
  }
  if (k < 0x49) attachOffset(world, o, ...L.pods[0]!.hold);
  if (k === 0x49) dropPod(world, o, 600, -100, 900, 1);
  if (p.state === 0) {
    if (k < 0x56) {
      p.vx >>= 1;
      p.vz >>= 1;
      dropPod(world, o, 600, -100, 900, 1);
    }
    g.weaponState = 0;
    world.player.autopilot = false;
    p.classe |= CLASS.TARGET;
  }
}

/**
 * Arme 19, Accélérateur (véhicules 1, 2, 4, 5) : chaque tick où le tir spécial est tenu (état 0x0b) consomme 1 munition et pousse de
 * 2 · (sin cap, cos cap) (vitesse horizontale × 14/16 après ajout, soit une limite de 14 unités/tick) en plaquant le véhicule
 * (`vy -= 60`) ; plus de munition : retrait.
 */
function thruster(world: World, L: Launcher, st: number): void {
  if (st !== 0x0b) return;
  const g = world.game;
  const p = world.player.obj;
  attachOffset(world, podAt(world, S19C), ...L.pods[0]!.hold);
  p.vy -= 0x3c;
  p.vx = ((SIN[p.yaw & ANGLE_MASK]! * 2 + p.vx) * 14) >> 4;
  p.vz = ((COS[p.yaw & ANGLE_MASK]! * 2 + p.vz) * 14) >> 4;
  smokeTrail(world, p, 0);
  g.weaponState = g.ammo[g.loaded]! < 1 ? 0x14 : 10;
}
