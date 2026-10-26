/**
 * Véhicules au sol du joueur (formes 1, 2, 4 et 5, objet de type 991 ou 980) : pilotes `0043a174`, `0043a760`, `0043ac64`,
 * `0043b0ac`, suspension `00443510` et physiques `00445228`, `00445670`, `00445a84`, `00445f44`, portés ligne à ligne depuis
 * `archives/swiv3d/re/decomp` (docs/swiv3d/player.md §3.5 et §3.6). Tout est en entiers : mêmes décalages, mêmes arrondis
 * (les `>>` d'un entier négatif arrondissent vers le bas, comme dans l'exe).
 *
 * Forme 1 : buggy (4 roues). Forme 2 : motoneige (2 roues arrière, un ski : l'arrière est enfoncé de 2 000 dans l'eau). Forme 4 :
 * véhicule plus nerveux (poussée 210, pas de roues). Forme 5 : aéroglisseur (modèle 980, 982 dans l'eau, pas de roues).
 *
 * Les objets enfants « roues » des formes 1 et 2 (`0x3d4`/`0x3d7`, `gm_wheel_update` `004446a0`) sont dans `wheels.ts` : décor sans
 * effet sur la physique, mis à jour après le pilote avec le braquage `steer` ; le pilote du buggy fait tourner les roues arrière à
 * chaque pas de poussée (`kickRearWheels`).
 */
import type { PlayerInput } from "./input";
import { COS, SIN } from "./fixed";
import type { Player, PlayerContext } from "./player";
import type { WorldEvent } from "./events";

export const FORM_BUGGY = 1;
export const FORM_SNOWMOBILE = 2;
export const FORM_FAST = 4;
export const FORM_HOVER = 5;

/** Ce qui change d'une forme à l'autre dans les pilotes et les physiques (le reste du code est commun aux quatre). */
interface VehicleForm {
  /** Pilote : pas de poussée par tick et par touche avancer/reculer (`0x82`, `0xd2` pour la forme 4). */
  thrustStep: number;
  /** Pilote, clavier : la touche « latéral gauche » (`+0xc8`) freine aussi (formes 1, 4, 5). */
  brakeOnStrafeLeft: boolean;
  /** Pilote, axe analogique : le frein se pose même si un frein est déjà en cours (forme 2) ; sinon seulement si `état == 0`. */
  analogBrakeAlways: boolean;
  /** Pilote : retournement du braquage en marche arrière et braquage visuel des roues (formes 1 et 2 seulement, elles ont des roues). */
  wheels: boolean;
  /** Physique : gravité Q8 par tick en l'air. */
  gravity: number;
}

export const VEHICLE_FORMS: Record<number, VehicleForm> = {
  [FORM_BUGGY]: { thrustStep: 0x82, brakeOnStrafeLeft: true, analogBrakeAlways: false, wheels: true, gravity: 150 },
  [FORM_SNOWMOBILE]: { thrustStep: 0x82, brakeOnStrafeLeft: false, analogBrakeAlways: true, wheels: true, gravity: 150 },
  [FORM_FAST]: { thrustStep: 0xd2, brakeOnStrafeLeft: true, analogBrakeAlways: false, wheels: false, gravity: 120 },
  [FORM_HOVER]: { thrustStep: 0x82, brakeOnStrafeLeft: true, analogBrakeAlways: false, wheels: false, gravity: 120 },
};

/** Types de sol sous les roues : en dessous, c'est de l'eau (`00577664 < 4`, carte 102). */
const WATER_GROUND = 4;
/** Sol normal quand la carte 102 n'est pas utilisée (`00577664 = 0xff`). */
export const NORMAL_GROUND = 0xff;

/** Vague : `round(16·sin(π·i/32))`, 32 entrées (`00481050`). Même table que `render/tables.ts`. */
const WAVE = Int8Array.from({ length: 32 }, (_, i) => Math.round(16 * Math.sin((Math.PI * i) / 32)));

// ---------------------------------------------------------------------------------------------------------------------
// Pilote
// ---------------------------------------------------------------------------------------------------------------------

/** Coup de rotation des roues arrière du buggy (`0043a174`, `+0x1b0`/`+0x1b4`) ; `both` faux : la roue arrière gauche seule. */
function kickRearWheels(p: Player, d: number, both = true): void {
  if (p.form !== FORM_BUGGY) return;
  const rl = p.wheels[2];
  const rr = p.wheels[3];
  if (rl) rl.pitch += d;
  if (both && rr) rr.pitch += d;
}

/** Touches avancer / reculer : un pas de poussée chacune, et le coup de rotation des roues arrière (−13 / +13). */
function thrustKeys(p: Player, inp: PlayerInput, step: number): void {
  if (inp.forward) {
    p.thrust += step;
    kickRearWheels(p, -0xd);
  }
  if (inp.back) {
    p.thrust -= step;
    kickRearWheels(p, 0xd);
  }
}

/**
 * Pilote des véhicules (`+0xa8`) : le cap bouge directement (4 pas par tick au clavier, pas d'inertie angulaire), la touche
 * avancer/reculer ajoute à la poussée `+0x74`, le frein est l'état `+0x50 = 1` qui ne dure qu'un tick. Les sélections d'armes
 * et les tirs sont dans `commonButtons` (player.ts). `fireYaw` (`+0x94`) se recopie après le tir (`latchVehicleFireYaw`, player.ts).
 */
export function vehiclePilot(p: Player, inp: PlayerInput): void {
  const o = p.obj;
  const f = VEHICLE_FORMS[p.form]!;
  const ax = inp.axes;
  if (o.state === 1) o.state = 0;
  p.steerTarget = 0;
  // virage : axe analogique, sinon touches (les deux touches ensemble : le cap ne bouge pas, braquage à droite)
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
  }
  // poussée et frein (buggy : chaque pas fait aussi tourner les roues arrière, de 13 par touche, de 30/256 de l'axe pour la gauche)
  if (ax?.forward) {
    p.thrust += (ax.forward * 0x104) >> 8;
    kickRearWheels(p, -((ax.forward * 0x1e) >> 8), false);
    if (inp.brake && (f.analogBrakeAlways || o.state === 0)) o.state = 1;
  } else {
    thrustKeys(p, inp, f.thrustStep);
    if ((inp.forward && inp.back) || inp.brake || (f.brakeOnStrafeLeft && inp.strafeLeft)) o.state = 1;
  }
  // seconde application des touches (après les armes dans l'exe) : sans frein, la touche vaut donc deux pas par tick
  if (o.state !== 1) thrustKeys(p, inp, f.thrustStep);
  if (f.wheels) {
    // marche arrière (vitesse vers l'avant < -7000) : le braquage visuel s'inverse ; puis les roues suivent la cible de 4 en 4
    const yaw = o.yaw & 0x1ff;
    if (o.vx * SIN[yaw]! + COS[yaw]! * o.vz < -7000) p.steerTarget = -p.steerTarget;
    if (p.steer < p.steerTarget) p.steer += 4;
    if (p.steerTarget < p.steer) p.steer -= 4;
  }
}

/**
 * Pilotes de fin de niveau des formes 1 (`00438ec8`) et 2 (`00438fb8`), installés au tick 25 de la victoire : frein relâché
 * (`+0x50` 1 → 0), cap −4 et poussée `+0x82` à chaque tick (le véhicule tourne en rond à gauche), coup de −13 sur `+0x1b0` (et `+0x1b4`
 * pour le buggy : ses deux roues arrière ; pour la motoneige `+0x1b0` est le ski, dont le tangage est ensuite recopié du corps). Ni
 * entrée ni tir ; le braquage `+0xb0` va vers la dernière cible `+0xb4` par pas de 8 (`playerWheelsTick`).
 */
export function vehicleVictoryPilot(p: Player): void {
  const o = p.obj;
  if (o.state === 1) o.state = 0;
  o.yaw -= 4;
  p.thrust += 0x82;
  const w2 = p.wheels[2];
  if (w2) w2.pitch -= 0xd;
  const w3 = p.form === FORM_BUGGY ? p.wheels[3] : undefined;
  if (w3) w3.pitch -= 0xd;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sol : hauteur avec vagues et type de sol (`gm_terrain_height_water` `00425c94`)
// ---------------------------------------------------------------------------------------------------------------------

/** Dernier type de sol échantillonné (`00577664`) et hauteur Q8 (`00587e54`). */
interface GroundSample {
  height: number;
  type: number;
}

/**
 * `gm_terrain_height_water` : sans carte 102 (`00577670 & 2 == 0`) c'est `gm_terrain_height` et le type de sol vaut `0xff` ; avec,
 * le type est l'octet de la carte 102 de la case de (x, z) et les coins d'eau (octet de la carte 102 `& 0xe0 == 0`) sont relevés de
 * la vague `WAVE[(cz·4 + temps + SIN[(cx & 31)·16]) & 31] · 256`, avant l'interpolation bilinéaire.
 */
export function sampleGround(ctx: PlayerContext, x: number, z: number, out: GroundSample): void {
  const cx = x >> 14;
  const cz = z >> 14;
  const fx = (x >> 6) & 0xff;
  const fz = (z >> 6) & 0xff;
  const map = ctx.groundMap;
  if (!map) {
    out.type = NORMAL_GROUND;
    out.height = ctx.terrain.height(x, z);
    return;
  }
  const time = ctx.time();
  const corner = (ax: number, az: number): number => {
    const i = ((az & 511) << 9) + (ax & 511);
    let h = ctx.terrain.heightmap[i]! * 0x400;
    if ((map[i]! & 0xe0) === 0) h += WAVE[(az * 4 + time + SIN[(ax & 0x1f) * 16]!) & 0x1f]! * 0x100;
    return h;
  };
  out.type = map[((cz & 511) << 9) + (cx & 511)]!;
  const a = corner(cx, cz);
  const b = corner(cx + 1, cz);
  const c = corner(cx, cz + 1);
  const d = corner(cx + 1, cz + 1);
  const top = a + (((b - a) * fx) >> 8);
  const bot = c + (((d - c) * fx) >> 8);
  out.height = top + (((bot - top) * fz) >> 8);
}

// ---------------------------------------------------------------------------------------------------------------------
// Suspension (`gm_vehicle_suspension` `00443510`)
// ---------------------------------------------------------------------------------------------------------------------

/** Coins de contact (`00484208`) : x puis z Q8, dans l'ordre avant gauche, avant droit, arrière gauche, arrière droit. */
const CORNERS: readonly (readonly [number, number])[] = [
  [-5120, 7680],
  [5120, 7680],
  [-5120, -7680],
  [5120, -7680],
];

/** Résultat de la suspension : les noms de l'exe entre parenthèses. */
export interface Suspension {
  /** Hauteur Q8 de chaque contact au-dessus du sol (`0048420c`, `00484218`, `00484224`, `00484230`). */
  w: [number, number, number, number];
  /** Vecteur « avant du corps » (`005b04c4`, `005b04c0`, `005b04b0`), longueur 1000. */
  tx: number;
  ty: number;
  tz: number;
  /** Poussée de pente (`005b04c8`, `005b04cc`) : gravité le long de l'inclinaison du corps. */
  slopeX: number;
  slopeZ: number;
  /** Type de sol du dernier contact (`00577664`). */
  ground: number;
}

const susp: Suspension = { w: [0, 0, 0, 0], tx: 0, ty: 0, tz: 0, slopeX: 0, slopeZ: 0, ground: NORMAL_GROUND };
const sample: GroundSample = { height: 0, type: NORMAL_GROUND };

export function suspension(p: Player, ctx: PlayerContext, form: number): Suspension {
  const o = p.obj;
  // sinus/cosinus des angles opposés (`-angle & 0x1ff`) : tangage, cap, roulis
  const sp = SIN[-o.pitch & 0x1ff]!;
  const cp = COS[-o.pitch & 0x1ff]!;
  const sy = SIN[-o.yaw & 0x1ff]!;
  const cy = COS[-o.yaw & 0x1ff]!;
  const sr = SIN[-o.roll & 0x1ff]!;
  const cr = COS[-o.roll & 0x1ff]!;
  const foot = ctx.models.get(o.model)?.groundOffset ?? 0; // `+0x10` du bloc de modèle
  for (let i = 0; i < 4; i++) {
    const [lx, lz] = CORNERS[i]!;
    const a = (foot * 0x100 * cp - lz * sp) >> 8;
    const b = (foot * 0x100 * sp + lz * cp) >> 8;
    const yRaw = lx * sr + a * cr;
    const a2 = (lx * cr - a * sr) >> 8;
    const xRaw = a2 * cy - b * sy;
    const zRaw = a2 * sy + b * cy;
    sampleGround(ctx, (xRaw >> 8) + o.x, (zRaw >> 8) + o.z, sample);
    let w = (yRaw >> 8) + o.y - sample.height;
    // dans l'eau, les roues sont censées être plus bas : forme 1 aux 4 coins, forme 2 aux deux coins arrière
    if (form === FORM_BUGGY && sample.type < WATER_GROUND) w += 2000;
    if (form === FORM_SNOWMOBILE && sample.type < WATER_GROUND && i > 1) w += 2000;
    susp.w[i] = w;
    susp.ground = sample.type;
  }
  // vecteur avant (poussée) : 1000 · (sin cap · cos tangage, sin tangage, cos cap · cos tangage), `sin(-pitch)` donne le signe
  susp.ty = (-1000 * sp) >> 8;
  const f = (1000 * cp) >> 8;
  susp.tx = (-f * sy) >> 8;
  susp.tz = (f * cy) >> 8;
  // poussée de pente : 0x15e = 350 pondéré par l'inclinaison du corps
  const g = (cp * 0x15e) >> 8;
  const sx = (-(g * sr)) >> 10;
  const sz = (sp * 0x15e) >> 8;
  susp.slopeX = sx * cy - sz * sy;
  susp.slopeZ = sx * sy + sz * cy;
  return susp;
}

// ---------------------------------------------------------------------------------------------------------------------
// Physique (`00445228`, `00445670`, `00445a84`, `00445f44`)
// ---------------------------------------------------------------------------------------------------------------------

/** Modèles de la forme 5 : 980 (`0x3d4`) sur terre, 982 (`0x3d6`) sur l'eau. */
const MODEL_HOVER_LAND = 980;
const MODEL_HOVER_WATER = 982;

function addThrust(p: Player, s: Suspension, shift: number): void {
  const o = p.obj;
  o.vx += (p.thrust * s.tx) >> shift;
  o.vy += (p.thrust * s.ty) >> shift;
  o.vz += (p.thrust * s.tz) >> shift;
}

function addSlope(p: Player, s: Suspension, shift: number): void {
  const o = p.obj;
  if (o.state !== 2 && o.state !== 1) {
    o.vx += s.slopeX >> shift;
    o.vz += s.slopeZ >> shift;
  }
}

/** Dégâts de l'eau (`+8 -= n` si positif). */
function waterDamage(p: Player, amount: number, emit: (e: WorldEvent) => void): void {
  if (p.obj.hp > 0) {
    p.obj.hp -= amount;
    emit({ kind: "playerDamaged", amount, source: "mud" });
  }
}

/** Physique commune des formes 1, 2, 4 et 5 : appelée à chaque tick après `pos += vel` (comportement `+0x68`). */
export function vehiclePhysics(p: Player, ctx: PlayerContext): void {
  const o = p.obj;
  const form = p.form;
  const f = VEHICLE_FORMS[form]!;
  const emit = ctx.emit;
  if (o.timer > 0) o.timer--;
  const s = suspension(p, ctx, form);
  if (p.thrust > 500) p.thrust = 500;
  if (p.thrust < -500) p.thrust = -500;
  const [w0, w1, w2, w3] = s.w;
  const h = Math.min(1000, w0, w1, w2, w3);
  p.wheelSpeed = (p.wheelSpeed * 13) >> 4;
  p.thrust = (p.thrust * 15) >> 4;
  p.wheelSpeed = (p.wheelSpeed * 13) >> 4;
  const fast = form === FORM_FAST || form === FORM_HOVER;
  p.groundTypeUnder = s.ground;

  if (h < 1000) {
    // roues au sol : frein (14/16 ; 15/16 pour 4 et 5), sinon frottement (15/16 ; `0x3d/64` forme 4, `0x3c/64` forme 5)
    if (o.state === 1) {
      const k = fast ? 15 : 14;
      o.vx = (o.vx * k) >> 4;
      o.vz = (o.vz * k) >> 4;
      p.thrust = 0;
    } else if (form === FORM_FAST) {
      o.vx = (o.vx * 0x3d) >> 6;
      o.vz = (o.vz * 0x3d) >> 6;
    } else if (form === FORM_HOVER) {
      o.vx = (o.vx * 0x3c) >> 6;
      o.vz = (o.vz * 0x3c) >> 6;
    } else {
      o.vx = (o.vx * 15) >> 4;
      o.vz = (o.vz * 15) >> 4;
    }
    o.roll += (w3 + w1 - (w2 + w0)) >> 9;
    if (o.state === 3) o.state = 0;
    if (o.state !== 2) o.pitch += (w2 + w3 - (w0 + w1)) >> 9;
    const water = s.ground < WATER_GROUND;
    switch (form) {
      case FORM_BUGGY:
        if (water) {
          addSlope(p, s, 10);
          addThrust(p, s, 13);
          waterDamage(p, 1, emit);
        } else {
          addSlope(p, s, 8);
          addThrust(p, s, 11);
        }
        break;
      case FORM_SNOWMOBILE:
        if (water) {
          addThrust(p, s, 13);
          waterDamage(p, 1, emit);
        } else {
          addSlope(p, s, 8);
          addThrust(p, s, 11);
        }
        break;
      case FORM_FAST:
        if (water) {
          addSlope(p, s, 11);
          waterDamage(p, 2, emit);
          addThrust(p, s, 13);
        } else {
          addSlope(p, s, 9);
          addThrust(p, s, 11);
        }
        break;
      default:
        // forme 5 : le modèle suit le sol, 982 sur l'eau
        o.model = water ? MODEL_HOVER_WATER : MODEL_HOVER_LAND;
        if (water) {
          addSlope(p, s, 11);
          addThrust(p, s, 11);
        } else {
          addSlope(p, s, 9);
          addThrust(p, s, 12);
        }
    }
    // rotation des roues : vitesse de roue × vitesse horizontale (bornée à 10)
    const spin = Math.min(10, (o.vx * o.vx + o.vz * o.vz) >> 18);
    p.wheelSpin += p.wheelSpeed * spin;
  } else if (o.state === 3) {
    if (o.pitch > -50) o.pitch -= 4;
  } else if (!fast) {
    if (o.pitch < 90) o.pitch += 2;
  } else {
    // formes 4 et 5 : en l'air, le corps revient à plat
    if (o.pitch < -10) o.pitch += 2;
    if (o.pitch > 0) o.pitch -= 2;
    if (o.roll < 0) o.roll += 1;
    if (o.roll > 0) o.roll -= 1;
  }
  // forme 4 : poussée supplémentaire à toute altitude
  if (form === FORM_FAST) addThrust(p, s, 16);
  o.vy = (o.vy * 15) >> 4;
  if (h > 0) o.vy -= f.gravity;
  if (h < 0) {
    // posé trop bas : sons d'impact selon la vitesse de chute, vy ramenée à 0 et corps repoussé hors du sol
    if (o.vy < -0x44c) ctx.emit({ kind: "sound", id: o.vy < -0x76c ? 0xfab : 0xfaa, x: o.x, y: o.y, z: o.z });
    if (o.vy < 0) o.vy = 0;
    o.y -= h;
  }
  // `+0x190` : valeur qui suit la vitesse (hauteur du son moteur ; ×2 et autres bornes pour les formes 4 et 5)
  let d = ((o.vz * o.vz + o.vx * o.vx + o.vy * o.vy) >> 10) + 7000 - p.soundPitch;
  if (d >= 0x65) d = 100;
  p.soundPitch += fast ? d * 2 : d;
  if (fast) {
    if (p.soundPitch > 41000) p.soundPitch = 35000;
  } else if (p.soundPitch > 0x5014) p.soundPitch = 15000;
}
