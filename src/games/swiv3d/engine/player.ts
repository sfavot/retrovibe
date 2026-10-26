/**
 * Joueur : fonction pilote (entrées → intentions → angles) et physique par forme (docs/swiv3d/player.md §3).
 *
 * Le joueur est un `GameObject` du pool (les 0x70 octets communs) plus l'état propre à la structure de 0x228 octets de l'exe.
 * Par tick : la boucle d'objets fait `pos += vel` puis appelle la **physique** (`+0x68`), ensuite `pilot()` lit les entrées
 * (`+0xa8`) ; la physique du tick N+1 voit donc les angles écrits par le pilote du tick N.
 *
 * Formes portées : 0 et 3 (hélicoptère, `00439088` + `gm_heli_physics`), 1, 2, 4 et 5 (véhicules au sol, `vehicle.ts`), 0x2a (pilote
 * de démonstration, `demo-pilot.ts`). La forme 0x2b (mort) est inerte, la séquence de mort relève de H1/R3.
 */
import type { PlayerInput } from "./input";
import { COS, friction16, SIN, sin, cos } from "./fixed";
import type { WorldEvent } from "./events";
import type { GameObject, ModelTable } from "./objects";
import type { NodeNet } from "./nodes";
import type { Terrain } from "./terrain";
import { VEHICLE_FORMS, vehiclePilot } from "./vehicle";

/** Plafond de vol par défaut (`005b03cc`) : aucun. */
export const NO_CEILING = 0x7ffffff8;

/** Altitude de consigne de l'hélicoptère au-dessus du relief, en unités (`hauteur = 0x50`). */
export const HELI_ALTITUDE = 0x50;

export const FORM_HELI = 0;
export { FORM_BUGGY } from "./vehicle";
export const FORM_HELI_3 = 3;
export const FORM_DEMO = 0x2a;
export const FORM_DYING = 0x2b;

/** Ce dont la physique a besoin du monde (évite l'import circulaire de `World`). */
export interface PlayerContext {
  terrain: Terrain;
  models: ModelTable;
  /** Carte 102 (type de sol, vagues) quand la mission est « à eau » (`00577670 & 2`) ; `null` : sol normal partout (`00577664 = 0xff`). */
  groundMap: Uint8Array | null;
  /** Compteur d'animation des vagues (`00481154`), incrémenté à chaque tick. */
  time(): number;
  /** Réseau de chemins (pilote de démonstration). */
  nodes: NodeNet;
  emit(e: WorldEvent): void;
}

export class Player {
  readonly obj: GameObject;
  /** Forme courante (`+0xa4`). */
  form = FORM_HELI;
  /** Accumulateurs d'angle du pilote hélicoptère (`+0x214` cap Q8, `+0x218` tangage Q8, `+0x21c` roulis Q7). */
  accYaw = 0;
  accPitch = 0;
  accRoll = 0;
  /** Véhicules : poussée (`+0x74`), vitesse de roue (`+0x78`), rotation cumulée des roues (`+0x70`), braquage courant / cible (`+0xb0` / `+0xb4`). */
  thrust = 0;
  wheelSpeed = 0;
  wheelSpin = 0;
  steer = 0;
  steerTarget = 0;
  /** Roues enfants (`+0x1a8`, `+0x1ac`, `+0x1b0`, `+0x1b4`) : 4 pour la forme 1, 3 pour la forme 2, aucune sinon (`wheels.ts`). */
  wheels: GameObject[] = [];
  /** `+0x190` : valeur qui suit la vitesse (hauteur du son moteur, hypothèse). */
  soundPitch = 0;
  /** `+0x94` : cap de tir du canon (`gm_primary_bullet_spawn`, `0046b4b4`) : celui du tick, figé tant que « latéral droit » est tenu pour les véhicules. */
  fireYaw = 0;
  /** `+0x120` arme courante (-1 = aucune) : choisie par H1 à partir des événements `weaponSelect`. */
  weapon = -1;
  /** `+0xa0` : tir principal maintenu. */
  firePrimaryHeld = false;
  /** Plafond de vol Q8 (`005b03cc`). */
  ceiling = NO_CEILING;
  /** pv ≤ 0 : le pilote ne lit plus les entrées. */
  dead = false;
  /** Amarrage sur une plate-forme (`gm_pilot_none`) : le pilote ne lit plus les entrées. */
  autopilot = false;
  /** Type de sol sous le véhicule (`00577664`), dernier calculé. */
  groundTypeUnder = 0xff;

  constructor(obj: GameObject) {
    this.obj = obj;
    // `0043e958` : le cap de tir part du cap de l'objet.
    this.fireYaw = obj.yaw;
  }

  get x(): number {
    return this.obj.x;
  }
  get y(): number {
    return this.obj.y;
  }
  get z(): number {
    return this.obj.z;
  }
  get vx(): number {
    return this.obj.vx;
  }
  get vy(): number {
    return this.obj.vy;
  }
  get vz(): number {
    return this.obj.vz;
  }
  get yaw(): number {
    return this.obj.yaw & 0x1ff;
  }
  get pitch(): number {
    return this.obj.pitch;
  }
  get roll(): number {
    return this.obj.roll;
  }
  get hp(): number {
    return this.obj.hp;
  }
  /** Vitesse horizontale Q8 par tick. */
  get speed(): number {
    return Math.hypot(this.obj.vx, this.obj.vz);
  }
}

/** Clés de comportement du joueur (`+0x68`). */
export const UPDATE_PLAYER_HELI = "player_heli";
export const UPDATE_PLAYER_VEHICLE = "player_vehicle";
export const UPDATE_PLAYER_DEMO = "player_demo";
export const UPDATE_PLAYER_INERT = "player_inert";

/**
 * `gm_player_set_form` (`0043de0c`) : type/classe/physique/pilote selon la forme ; hélicoptères : accumulateurs d'angle recalés sur
 * les angles (`+0x214 = cap << 8`, `+0x218 = tangage << 8`, `+0x21c = roulis << 7`) ; formes 1 et 2 : `+0x190 = 11000`, roues droites.
 * Comme dans l'exe, la poussée, la vitesse de roue et l'état `+0x50` ne sont pas remis à zéro (les plates-formes posent l'état
 * elles-mêmes). Les roues enfants des formes 1 et 2 sont créées par `World` (`setPlayerWheels`, `wheels.ts`).
 */
export function setForm(
  p: Player,
  form: number,
  emit?: (e: WorldEvent) => void,
): void {
  const o = p.obj;
  p.form = form;
  const heli = form === 0 || form === 3;
  const vehicle = form in VEHICLE_FORMS;
  o.classe = heli ? 0x217 : vehicle ? 0x207 : form === FORM_DEMO ? 0x40 : 0x217;
  o.model = form === 5 ? 980 : vehicle ? 991 : 990;
  o.update = heli
    ? UPDATE_PLAYER_HELI
    : vehicle
      ? UPDATE_PLAYER_VEHICLE
      : form === FORM_DEMO
        ? UPDATE_PLAYER_DEMO
        : UPDATE_PLAYER_INERT;
  if (form === 1 || form === 2) {
    p.soundPitch = 11000;
    p.steer = 0;
    p.steerTarget = 0;
  }
  p.accYaw = o.yaw << 8;
  p.accPitch = o.pitch << 8;
  p.accRoll = o.roll << 7;
  emit?.({ kind: "formChanged", form });
}

// ---------------------------------------------------------------------------------------------------------------------
// Pilote (entrées → intentions → angles)
// ---------------------------------------------------------------------------------------------------------------------

/** Sélection d'arme, tirs : identiques pour toutes les formes (touches `2..11`, `+0xd8/+0xdc`, `+0xd4`, `+0xd0`). */
function commonButtons(
  p: Player,
  inp: PlayerInput,
  emit: (e: WorldEvent) => void,
): void {
  if (
    inp.weaponDirect !== null &&
    inp.weaponDirect >= 1 &&
    inp.weaponDirect <= 10
  )
    emit({ kind: "weaponSelect", command: inp.weaponDirect - 1 });
  if (inp.weaponNext) emit({ kind: "weaponSelect", command: -1 });
  if (inp.weaponPrev) emit({ kind: "weaponSelect", command: -2 });
  if (inp.fireSpecial) emit({ kind: "fire", special: true });
  if (inp.firePrimary) emit({ kind: "fire", special: false });
  p.firePrimaryHeld = inp.firePrimary;
}

/** Pilote de l'hélicoptère (formes 0 et 3, `00439088`) : intentions de cap/tangage/roulis puis intégration. */
function heliPilot(p: Player, inp: PlayerInput): void {
  let dYaw = 0;
  let dPitch = 0;
  let dRoll = 0;
  const ax = inp.axes;
  // avancer / reculer
  if (ax?.forward) dPitch += ax.forward * 10;
  else {
    if (inp.forward) dPitch += 0x4b0;
    if (inp.back) dPitch -= 0x4b0;
  }
  if (inp.brake) {
    // « Strafe On » : tourner devient déplacement latéral
    if (ax?.turn) dRoll += ax.turn * 7;
    else {
      if (inp.turnLeft) dRoll -= 0x320;
      if (inp.turnRight) dRoll += 0x320;
    }
  } else {
    if (ax?.strafe) dRoll += ax.strafe * 7;
    else {
      if (inp.strafeLeft) dRoll -= 0x320;
      if (inp.strafeRight) dRoll += 0x320;
    }
    if (ax?.turn) {
      dYaw += ax.turn << 3;
      dRoll += (ax.turn * 0x320) >> 8;
    } else {
      if (inp.turnLeft) {
        dYaw -= 0x258;
        dRoll -= 0xc8;
      }
      if (inp.turnRight) {
        dYaw += 0x258;
        dRoll += 0xc8;
      }
    }
  }
  integrateHeliAngles(p, dYaw, dPitch, dRoll);
  p.fireYaw = p.obj.yaw;
}

/** Intégration commune des angles de l'hélicoptère (aussi appelée sans entrée quand le pilote est inactif). */
function integrateHeliAngles(
  p: Player,
  dYaw: number,
  dPitch: number,
  dRoll: number,
): void {
  const o = p.obj;
  p.accYaw += dYaw;
  p.accPitch -= dPitch;
  p.accRoll += dRoll;
  o.yaw = p.accYaw >> 8;
  o.pitch = p.accPitch >> 8;
  o.roll = p.accRoll >> 7;
  p.accPitch = (p.accPitch * 14) >> 4;
  p.accRoll = (p.accRoll * 14) >> 4;
  // plafond de vol
  if (o.y > p.ceiling) {
    o.y = p.ceiling;
    if (o.vy > 0) o.vy = 0;
  }
  // aide à la montée vers la cible verrouillée (neutre tant que H1 ne pose pas de cible)
  const t = o.target;
  if (t !== o) {
    if (o.y < t.y) o.y += 100;
    if (t.y - o.y > 0x3a98) o.vy = ((o.vy * 14) >> 4) + 40;
  }
}

/** Fonction pilote du joueur (`+0xa8`), une fois par tick après la mise à jour des objets. */
export function pilot(
  p: Player,
  inp: PlayerInput,
  emit: (e: WorldEvent) => void,
): void {
  if (p.dead || p.autopilot || p.form === FORM_DEMO || p.form === FORM_DYING) return;
  if (p.form === 0 || p.form === 3) heliPilot(p, inp);
  else if (p.form in VEHICLE_FORMS) vehiclePilot(p, inp);
  else return;
  commonButtons(p, inp, emit);
}

// ---------------------------------------------------------------------------------------------------------------------
// Physique
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `gm_heli_physics` (`00444af8`, appelée après `pos += vel` et le repli dans le tore) : poussée par tangage/roulis,
 * asservissement d'altitude au relief (consigne `height` unités, relief anticipé à 32 ticks), frottement 1/16, choc au sol.
 * Réutilisable par les avions de H1 (`4001`, `4002`…). Retourne `true` si le choc au sol a eu lieu ce tick.
 */
export function heliPhysics(
  o: GameObject,
  terrain: Terrain,
  height: number,
  emit: (e: WorldEvent) => void,
): boolean {
  if (o.roll < 0) o.roll += 4;
  if (o.roll > 0) o.roll -= 4;
  if (o.timer > 0) o.timer--;
  if (o.pitch < 0) o.pitch += 2;
  if (o.pitch > 0) o.pitch -= 2;
  const yaw = o.yaw;
  if (o.pitch !== 0) {
    o.vx -= (sin(yaw) * o.pitch) >> 5;
    o.vz -= (cos(yaw) * o.pitch) >> 5;
  }
  if (o.roll !== 0) {
    o.vx += (sin(yaw + 0x80) * o.roll) >> 6;
    o.vz += (cos(yaw + 0x80) * o.roll) >> 6;
  }
  const ground = terrain.height(o.x, o.z);
  const ahead = terrain.height(o.x + o.vx * 32, o.z + o.vz * 32);
  const e = (Math.max(ground, ahead) >> 8) + height - (o.y >> 8);
  if (e > 0) o.vy += e * 2;
  if (e < 0) o.vy += e >> 1;
  o.vx = friction16(o.vx);
  o.vy = friction16(o.vy);
  o.vz = friction16(o.vz);
  if (o.y - 2000 <= ground) {
    // choc : on part vers la direction (parmi 16) où le sol est le plus bas
    let best = 99999999;
    let bestK = 0;
    for (let k = 0; k < 16; k++) {
      const h = terrain.height(o.x + SIN[32 * k]!, o.z + COS[32 * k]!);
      if (h < best) {
        best = h;
        bestK = k;
      }
    }
    emit({ kind: "sound", id: 0x3e9, x: o.x, y: o.y, z: o.z });
    o.vx = SIN[32 * bestK]! << 4;
    o.vz = COS[32 * bestK]! << 4;
    o.vy = 1000;
    o.hp = Math.max(0, o.hp - 10);
    return true;
  }
  return false;
}

/** Comportement `player_heli` (`+0x68` des formes 0 et 3). */
export function playerHeliUpdate(p: Player, ctx: PlayerContext): void {
  const hit = heliPhysics(p.obj, ctx.terrain, HELI_ALTITUDE, ctx.emit);
  if (hit) ctx.emit({ kind: "playerDamaged", amount: 10, source: "ground" });
}
