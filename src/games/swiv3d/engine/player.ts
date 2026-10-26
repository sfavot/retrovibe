/**
 * Joueur : fonction pilote (entrées → intentions → angles) et physique par forme (docs/swiv3d/player.md §3).
 *
 * Le joueur est un `GameObject` du pool (les 0x70 octets communs) plus l'état propre à la structure de 0x228 octets de l'exe.
 * Par tick : la boucle d'objets fait `pos += vel` puis appelle la **physique** (`+0x68`), ensuite `pilot()` lit les entrées
 * (`+0xa8`) ; la physique du tick N+1 voit donc les angles écrits par le pilote du tick N.
 *
 * Formes portées : 0 et 3 (hélicoptère, `00439088` + `gm_heli_physics`), 1 (véhicule, `0043a174` + `00445228`), 2, 4, 5 (variantes
 * de la forme 1, **approximées** : seuls la poussée, la gravité et un frottement latéral changent, voir `VEHICLE_FORMS`), 0x2a
 * (démo) et 0x2b (mort) : inertes, la séquence de mort relève de H1/R3.
 */
import type { PlayerInput } from "./input";
import { clamp, COS, friction16, SIN, sin, cos } from "./fixed";
import type { WorldEvent } from "./events";
import type { GameObject, ModelTable } from "./objects";
import type { Terrain } from "./terrain";

/** Plafond de vol par défaut (`005b03cc`) : aucun. */
export const NO_CEILING = 0x7ffffff8;

/** Altitude de consigne de l'hélicoptère au-dessus du relief, en unités (`hauteur = 0x50`). */
export const HELI_ALTITUDE = 0x50;

export const FORM_HELI = 0;
export const FORM_BUGGY = 1;
export const FORM_HELI_3 = 3;
export const FORM_DEMO = 0x2a;
export const FORM_DYING = 0x2b;

/** Paramètres des variantes de véhicule. `lateral` : frottement latéral supplémentaire `v·k >> 6` (0 = aucun) ; `front` : relevé des 2 roues avant. */
interface VehicleForm {
  thrustStep: number;
  gravity: number;
  lateral: number;
  front: number;
  /** Frein avec « latéral gauche » (forme 1 seulement). */
  brakeOnStrafeLeft: boolean;
}

/**
 * Formes de véhicule. Forme 1 : confirmée (poussée 130, gravité 150). Forme 2 : `+2 000` sur les deux roues avant [confirmé
 * dans le doc], reste identique à la forme 1 [hypothèse]. Formes 4 (poussée 210, gravité 120, `v·0x3d >> 6`) et 5 (`v·0x3c >> 6`) :
 * valeurs du doc, « à relire dans `00445a84` / `00445f44` » ; la gravité de 5 est reprise de 4 [hypothèse].
 */
export const VEHICLE_FORMS: Record<number, VehicleForm> = {
  1: {
    thrustStep: 0x82,
    gravity: 150,
    lateral: 0,
    front: 0,
    brakeOnStrafeLeft: true,
  },
  2: {
    thrustStep: 0x82,
    gravity: 150,
    lateral: 0,
    front: 2000,
    brakeOnStrafeLeft: false,
  },
  4: {
    thrustStep: 0xd2,
    gravity: 120,
    lateral: 0x3d,
    front: 0,
    brakeOnStrafeLeft: false,
  },
  5: {
    thrustStep: 0x82,
    gravity: 120,
    lateral: 0x3c,
    front: 0,
    brakeOnStrafeLeft: false,
  },
};

/** Ce dont la physique a besoin du monde (évite l'import circulaire de `World`). */
export interface PlayerContext {
  terrain: Terrain;
  models: ModelTable;
  /** `true` : la carte 102 donne le type de sol (missions à eau) ; sinon sol normal partout (`00577664 = 0xff`). */
  groundType(x: number, z: number): number;
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
  /** Véhicules : poussée (`+0x74`), vitesse de roue (`+0x78`), braquage courant / cible (`+0xb0` / `+0xb4`). */
  thrust = 0;
  wheelSpeed = 0;
  steer = 0;
  steerTarget = 0;
  /** `+0x120` arme courante (-1 = aucune) : choisie par H1 à partir des événements `weaponSelect`. */
  weapon = -1;
  /** `+0xa0` : tir principal maintenu. */
  firePrimaryHeld = false;
  /** Plafond de vol Q8 (`005b03cc`). */
  ceiling = NO_CEILING;
  /** pv ≤ 0 : le pilote ne lit plus les entrées. */
  dead = false;
  /** Type de sol sous le véhicule (`00577664`), dernier calculé. */
  groundTypeUnder = 0xff;

  constructor(obj: GameObject) {
    this.obj = obj;
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
export const UPDATE_PLAYER_INERT = "player_inert";

/**
 * `gm_player_set_form` (`0043de0c`) : type/classe/physique selon la forme, accumulateurs d'angle recalés sur les angles
 * (`+0x214 = cap << 8`, `+0x218 = tangage << 8`, `+0x21c = roulis << 7`).
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
      : UPDATE_PLAYER_INERT;
  p.accYaw = o.yaw << 8;
  p.accPitch = o.pitch << 8;
  p.accRoll = o.roll << 7;
  p.thrust = 0;
  p.wheelSpeed = 0;
  o.state = 0;
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

/** Pilote des véhicules (`0043a174` et variantes) : cap direct (pas d'inertie angulaire), poussée, frein, braquage visuel. */
function vehiclePilot(p: Player, inp: PlayerInput): void {
  const o = p.obj;
  const f = VEHICLE_FORMS[p.form] ?? VEHICLE_FORMS[1]!;
  const ax = inp.axes;
  if (o.state === 1) {
    o.state = 0;
    p.steerTarget = 0;
  }
  if (ax?.turn) {
    o.yaw += (ax.turn * 10) >> 8;
    p.steerTarget += (ax.turn * 100) >> 8;
  } else {
    if (inp.turnLeft) {
      o.yaw -= 4;
      p.steerTarget = -40;
    }
    if (inp.turnRight) {
      o.yaw += 4;
      p.steerTarget = 40;
    }
    if (!inp.turnLeft && !inp.turnRight) p.steerTarget = 0;
  }
  if (ax?.forward) p.thrust += (ax.forward * 0x104) >> 8;
  else {
    if (inp.forward) p.thrust += f.thrustStep;
    if (inp.back) p.thrust -= f.thrustStep;
  }
  if (
    inp.brake ||
    (inp.forward && inp.back) ||
    (f.brakeOnStrafeLeft && inp.strafeLeft)
  )
    o.state = 1;
  // braquage visuel : +0xb0 → +0xb4 par pas de 4
  if (p.steer < p.steerTarget) p.steer = Math.min(p.steer + 4, p.steerTarget);
  else if (p.steer > p.steerTarget)
    p.steer = Math.max(p.steer - 4, p.steerTarget);
}

/** Fonction pilote du joueur (`+0xa8`), une fois par tick après la mise à jour des objets. */
export function pilot(
  p: Player,
  inp: PlayerInput,
  emit: (e: WorldEvent) => void,
): void {
  if (p.dead || p.form === FORM_DEMO || p.form === FORM_DYING) return;
  if (p.form === 0 || p.form === 3) heliPilot(p, inp);
  else vehiclePilot(p, inp);
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

/**
 * `gm_vehicle_contact` (`00443510`) : hauteur Q8 au-dessus du sol de 4 points de contact (0 avant gauche, 1 avant droit,
 * 2 arrière gauche, 3 arrière droit ; coins ±5 120 en x, ±7 680 en z, à la hauteur de pied du modèle), orientés par
 * cap, tangage et roulis. **Approximation** : le calcul de l'exe n'a pas été relu, ici `y = base + lz·sin(tangage) − lx·sin(roulis)`
 * (petits angles, tangage positif = nez levé, roulis positif = côté droit bas).
 */
function contactHeights(
  p: Player,
  ctx: PlayerContext,
  front: number,
  out: number[],
): void {
  const o = p.obj;
  const foot = (ctx.models.get(o.model)?.groundOffset ?? 0) * 256;
  const sp = sin(o.pitch);
  const sr = sin(o.roll);
  const sy = sin(o.yaw);
  const cy = cos(o.yaw);
  for (let i = 0; i < 4; i++) {
    const lx = i & 1 ? 5120 : -5120;
    const lz = i < 2 ? 7680 : -7680;
    const wx = o.x + ((lx * cy + lz * sy) >> 8);
    const wz = o.z + ((-lx * sy + lz * cy) >> 8);
    const wy =
      o.y + foot + ((lz * sp) >> 8) - ((lx * sr) >> 8) + (i < 2 ? front : 0);
    out[i] = wy - ctx.terrain.height(wx, wz);
  }
}

const contact = [0, 0, 0, 0];
/** Inclinaison maximale d'un véhicule, en pas d'angle (garde-fou, voir `playerVehicleUpdate`). */
const MAX_TILT = 128;

/** Comportement `player_vehicle` : physique des formes 1, 2, 4, 5 (`00445228` et variantes ; docs/swiv3d/player.md §3.6). */
export function playerVehicleUpdate(p: Player, ctx: PlayerContext): void {
  const o = p.obj;
  const f = VEHICLE_FORMS[p.form] ?? VEHICLE_FORMS[1]!;
  contactHeights(p, ctx, f.front, contact);
  const [w0, w1, w2, w3] = contact as [number, number, number, number];
  // vecteur « avant corps » T = 1000 · (sin cap · cos tangage, sin tangage, cos cap · cos tangage)
  const cp = cos(o.pitch);
  const tx = (1000 * sin(o.yaw) * cp) >> 16;
  const ty = (1000 * sin(o.pitch)) >> 8;
  const tz = (1000 * cos(o.yaw) * cp) >> 16;
  // poussée de pente : -gradient du relief (approximation, valeur de `005b04c8/cc` non relue)
  const d = 4096;
  const sx = -(
    ((ctx.terrain.height(o.x + d, o.z) - ctx.terrain.height(o.x - d, o.z)) *
      1000) /
    (2 * d)
  );
  const sz = -(
    ((ctx.terrain.height(o.x, o.z + d) - ctx.terrain.height(o.x, o.z - d)) *
      1000) /
    (2 * d)
  );
  const slopeX = Math.trunc(sx);
  const slopeZ = Math.trunc(sz);

  const push = clamp(p.thrust, -500, 500);
  p.wheelSpeed = (p.wheelSpeed * 13) >> 4;
  p.thrust = (p.thrust * 15) >> 4;
  p.wheelSpeed = (p.wheelSpeed * 13) >> 4;

  p.groundTypeUnder = ctx.groundType(o.x, o.z);
  const h = Math.min(1000, w0, w1, w2, w3);
  const braking = o.state === 1;
  if (h < 1000) {
    if (braking) {
      o.vx = (o.vx * 14) >> 4;
      o.vz = (o.vz * 14) >> 4;
      p.thrust = 0;
    } else {
      o.vx = (o.vx * 15) >> 4;
      o.vz = (o.vz * 15) >> 4;
    }
    if (f.lateral) {
      // frottement latéral supplémentaire des formes 4 et 5 (hypothèse sur l'application : composante latérale seulement)
      const lat = (o.vx * cos(o.yaw) - o.vz * sin(o.yaw)) >> 8;
      const k = lat - ((lat * f.lateral) >> 6);
      o.vx -= (k * cos(o.yaw)) >> 8;
      o.vz += (k * sin(o.yaw)) >> 8;
    }
    o.roll += (w3 + w1 - (w2 + w0)) >> 9;
    if (o.state === 3) o.state = 0;
    if (o.state !== 2) o.pitch += (w2 + w3 - (w0 + w1)) >> 9;
    if (p.groundTypeUnder >= 4) {
      if (!braking) {
        o.vx += slopeX >> 8;
        o.vz += slopeZ >> 8;
      }
      o.vx += (push * tx) >> 11;
      o.vy += (push * ty) >> 11;
      o.vz += (push * tz) >> 11;
    } else {
      // eau / boue (hypothèse sur la nature de ces cases) : tout est amorti et le véhicule s'abîme
      o.vx += slopeX >> 10;
      o.vz += slopeZ >> 10;
      o.vx += (push * tx) >> 13;
      o.vy += (push * ty) >> 13;
      o.vz += (push * tz) >> 13;
      if (o.hp > 0) {
        o.hp--;
        ctx.emit({ kind: "playerDamaged", amount: 1, source: "mud" });
      }
    }
  } else if (o.state === 3) {
    if (o.pitch > -50) o.pitch -= 4;
  } else if (o.pitch < 90) o.pitch += 2;
  // Garde-fou non documenté : l'exe ne borne pas ces angles dans ce qui a été lu, mais ma version approximée des contacts peut
  // diverger sur les falaises ; un quart de tour (128 pas) reste physiquement plausible.
  o.pitch = clamp(o.pitch, -MAX_TILT, MAX_TILT);
  o.roll = clamp(o.roll, -MAX_TILT, MAX_TILT);
  o.vy = (o.vy * 15) >> 4;
  if (h > 0) o.vy -= f.gravity;
  if (h < 0) {
    if (o.vy < -1900)
      ctx.emit({ kind: "sound", id: 0xfab, x: o.x, y: o.y, z: o.z });
    else if (o.vy < -1100)
      ctx.emit({ kind: "sound", id: 0xfaa, x: o.x, y: o.y, z: o.z });
    o.vy = Math.max(o.vy, 0);
    o.y -= h;
  }
}
