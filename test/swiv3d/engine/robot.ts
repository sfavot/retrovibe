/**
 * Pilote automatique de test : lit l'état du monde à chaque tick et rend les entrées d'un joueur qui va détruire les groupes
 * d'objectifs dans l'ordre (9 -> 0) avec ses armes réelles. Aucune triche : pas de téléportation, pas de modification de l'état.
 *
 * Direction : le cap `yaw` (512 pas par tour) pointe vers `(sin yaw, cos yaw)` en (x, z) ; tourner à droite augmente le cap.
 *
 * Priorités : véhicule au sol, objectif que son trajet atteint sans mur, puis Super Ressort à ramasser, puis plate-forme ; bonus
 * d'énergie quand l'énergie baisse ; ennemi qui vise le joueur et tire ; objectif du groupe de tête. Esquive (hélicoptère) : au combat,
 * consigne de vitesse qui tourne autour de la cible (les tirs ennemis visent la position du moment, sans anticipation), et écart
 * latéral devant tout projectile ennemi qui passerait près. Le véhicule au sol qui cale sur une pente saute au Super Ressort.
 */
import type { PlayerInput } from "../../../src/games/swiv3d/engine/input";
import { emptyInput } from "../../../src/games/swiv3d/engine/input";
import { torusDelta } from "../../../src/games/swiv3d/engine/fixed";
import type { GameObject } from "../../../src/games/swiv3d/engine/objects";
import type { World } from "../../../src/games/swiv3d/engine/world";
import { GroundField } from "./ground-planner";

/** Distance (unités) à laquelle le pilote cesse d'avancer et se contente de tirer. */
const STANDOFF = 400;
/** Portée de tir : une balle vole 28 à 30 ticks à 31 unités par tick. */
const FIRE_RANGE = 640;
/** Véhicule au sol : il tire depuis le bord (sous la portée de 640) au lieu de descendre dans une cuvette dont il ne sortirait plus. */
const GROUND_STANDOFF = 480;
/** Écart minimal (ticks) entre deux tirs spéciaux. */
const SPECIAL_GAP = 40;
/** Fenêtre de contrôle de blocage (ticks) et déplacement minimal attendu (unités). */
const STUCK_WINDOW = 120;
const STUCK_MIN_MOVE = 40;
/** Durée (ticks) d'une manœuvre de dégagement. */
const UNSTUCK_TICKS = 70;

/** Véhicule au sol : sous cette distance (unités) à la cible, tout droit ; au-delà, on suit le trajet (`GroundField`). */
const DIRECT_RANGE = 560;
/** Rayon (cases) d'arrivée autour d'une plate-forme de transformation. */
const PAD_SEED = 1;
/** Cases (64 unités) devant le véhicule visées sur le trajet. */
const PATH_LOOKAHEAD = 5;

export interface StuckEvent {
  tick: number;
  x: number;
  z: number;
  y: number;
  targetType: number;
  targetGroup: number;
  targetX: number;
  targetZ: number;
  distance: number;
}

export interface TargetInfo {
  obj: GameObject;
  group: number;
  /** Écart (unités) du joueur à la cible, sur le plan. */
  dx: number;
  dz: number;
  distance: number;
  /** Bonus d'énergie que le pilote va chercher (pas une cible d'objectif). */
  pickup: boolean;
}

/** Portée (unités) à laquelle un ennemi qui vise le joueur devient la cible ; au-delà de THREAT_GIVE_UP ticks sans l'abattre, il est
 * ignoré pendant THREAT_IGNORE ticks (un char d'une fabrique en remplace un autre sans fin). */
const THREAT_RANGE = 700;
const THREAT_GIVE_UP = 400;
const THREAT_IGNORE = 1500;
/** Tireur : un programme d'arme (100 à 999), ou l'hélicoptère kamikaze `4001` qui percute. */
const isShooter = (o: GameObject): boolean => o.type === 4001 || (o.subtype >= 100 && o.subtype < 1000);

/** Combat de l'hélicoptère : distance (unités) sous laquelle il suit la consigne de vitesse, vitesse d'approche maximale et vitesse
 * latérale de l'orbite (unités/tick), période (ticks) du changement de sens, tolérance (unités/tick) du suivi en tout ou rien. */
const COMBAT_RANGE = 1200;
const APPROACH = 8;
const ORBIT = 7;
const ORBIT_FLIP = 400;
const DEADBAND = 1.5;
/** Esquive : distance de passage (unités) d'un projectile ennemi qui déclenche l'écart, horizon de prévision (ticks). */
const DODGE = 60;
const DODGE_HORIZON = 25;

/** Véhicule au sol : coût de trajet (`GroundField`) sous lequel il attaque l'objectif au lieu de rejoindre une plate-forme (un mur
 * ou une traversée d'eau coûtent bien plus). */
const REACHABLE = 600;
/** Véhicule au sol : fenêtre (ticks) sans baisse du coût restant du trajet, et baisse minimale qui compte comme un progrès. */
const PROGRESS_WINDOW = 250;
const PROGRESS_MIN = 5;
/** Super Ressort (arme spéciale 9, bonus 1009) : durée maximale de la manœuvre (ticks), cases du trajet visées par le saut. */
const JUMP_SLOT = 9;
const JUMP_TICKS = 200;
const JUMP_LOOKAHEAD = 30;

/** Sous ce niveau d'énergie, le pilote fait un détour par le bonus d'énergie (codes 100 à 102) le plus proche. */
const LOW_ENERGY = 450;
/** Distance maximale (unités) d'un détour. */
const PICKUP_RANGE = 12000;

export class Robot {
  /** Blocages détectés (position quasi inchangée alors que la cible est loin). */
  readonly stuck: StuckEvent[] = [];
  /** Tick de dernier changement de cible (pour les rapports). */
  private current: GameObject | null = null;
  private chasing: GameObject | null = null;
  /** Tirs d'arme spéciale. */
  specialShots = 0;
  private lastSpecial = -1000;
  /** Bonus d'énergie ramassés (détours terminés). */
  pickups = 0;
  private history: { x: number; z: number }[] = [];
  private unstuckLeft = 0;
  private jumpLeft = 0;
  /** Sauts au Super Ressort. */
  jumps = 0;
  private unstuckDir = 1;
  private tick = 0;
  private field: { goal: GameObject; field: GroundField } | null = null;
  private threatObj: GameObject | null = null;
  /** Objectifs que le véhicule au sol peut rejoindre par son trajet (calculé une fois par cible). */
  private readonly reachable = new Map<GameObject, boolean>();
  /** Meilleur coût restant atteint sur le trajet courant (véhicule au sol), et depuis quand. */
  private progress: { goal: GameObject; best: number; since: number } | null = null;
  private threatSince = 0;
  private readonly ignored = new Map<GameObject, number>();

  constructor(private readonly world: World) {}

  /** La cible courante : la plus proche du groupe de tête (le plus grand numéro restant). */
  target(): TargetInfo | null {
    const objs = this.world.game.objectives;
    if (objs.length === 0) return null;
    const head = objs[0]!.group;
    const p = this.world.player.obj;
    let best: TargetInfo | null = null;
    for (const e of objs) {
      if (e.group !== head) continue;
      const info = this.info(e.obj, e.group, p);
      // on reste sur la cible courante tant qu'elle vit : pas d'hésitation entre deux cibles équidistantes
      if (e.obj === this.current) return info;
      if (!best || info.distance < best.distance) best = info;
    }
    this.current = best?.obj ?? null;
    return best;
  }

  private info(o: GameObject, group: number, p: GameObject): TargetInfo {
    const dx = torusDelta(o.x, p.x) / 256;
    const dz = torusDelta(o.z, p.z) / 256;
    return { obj: o, group, dx, dz, distance: Math.hypot(dx, dz), pickup: false };
  }

  /**
   * Véhicule au sol : la plate-forme `7011` qui attend un véhicule (état 5) le transforme en hélicoptère ; le robot y va d'abord
   * (par le trajet le moins pentu), puis joue en vol. `null` en vol, sans plate-forme prête, ou pendant l'amarrage.
   */
  private padGoal(): TargetInfo | null {
    const w = this.world;
    if (w.player.form === 0 || w.player.form === 3 || w.player.autopilot) return null;
    const p = w.player.obj;
    let best: TargetInfo | null = null;
    for (const o of w.liveObjects()) {
      if (o.update !== "upd_004482dc" || o.state !== 5) continue;
      const info = this.info(o, -2, p);
      if (!best || info.distance < best.distance) best = info;
    }
    if (best) best.pickup = true;
    return best;
  }

  /** Bonus d'énergie à ramasser : actif seulement quand l'énergie est basse (avec hystérésis jusqu'à la disparition du bonus). */
  private pickupGoal(): TargetInfo | null {
    const w = this.world;
    const p = w.player.obj;
    if (this.chasing && this.chasing.classe === 0) {
      this.chasing = null;
      this.pickups++;
    }
    if (!this.chasing) {
      if (p.hp >= LOW_ENERGY) return null;
      let best: TargetInfo | null = null;
      for (const o of w.liveObjects()) {
        if (o.subtype < 1100 || o.subtype > 1102 || o.update === "static" || o.state !== 0) continue;
        const info = this.info(o, -1, p);
        if (info.distance < PICKUP_RANGE && (!best || info.distance < best.distance)) best = info;
      }
      if (!best) return null;
      this.chasing = best.obj;
    }
    const info = this.info(this.chasing, -1, p);
    info.pickup = true;
    // un bonus qu'on n'atteint pas (hors de portée, ou déjà aspiré) est abandonné
    if (info.distance > PICKUP_RANGE * 1.5) {
      this.chasing = null;
      return null;
    }
    return info;
  }

  /** Véhicule au sol sans Super Ressort : le bonus 1009 le plus proche (révélé par le groupe 9, `7002`), pour sauter un mur. */
  private jumpGoal(): TargetInfo | null {
    const w = this.world;
    if (w.player.form === 0 || w.player.form === 3 || (w.game.ammo[JUMP_SLOT] ?? 0) > 0) return null;
    const p = w.player.obj;
    let best: TargetInfo | null = null;
    for (const o of w.liveObjects()) {
      if (o.subtype !== 1000 + JUMP_SLOT || o.update === "static" || o.state !== 0 || o.type !== 0) continue;
      const info = this.info(o, -1, p);
      info.pickup = true;
      if (!best || info.distance < best.distance) best = info;
    }
    return best;
  }

  /**
   * Menace : l'ennemi vivant le plus proche qui vise le joueur (`+0x58`) et tire, à portée. Le robot l'abat avant de reprendre les
   * objectifs (les tourelles et les avions `4002` tirent en continu sur leur cible) ; projectiles, éclats et objets dépeuplables
   * (`classe & 0x68`, dont les chars des fabriques) exclus.
   */
  private threat(): TargetInfo | null {
    const w = this.world;
    const p = w.player.obj;
    if (this.threatObj && (this.threatObj.classe === 0 || this.threatObj.target !== p)) this.threatObj = null;
    if (this.threatObj && this.tick - this.threatSince > THREAT_GIVE_UP) {
      this.ignored.set(this.threatObj, this.tick + THREAT_IGNORE);
      this.threatObj = null;
    }
    let best: TargetInfo | null = null;
    for (const o of w.liveObjects()) {
      if (o.target !== p || o === p || o.hp <= 0 || o.classe & 0x68 || !(o.classe & 0x1000)) continue;
      if (!isShooter(o)) continue;
      if ((this.ignored.get(o) ?? 0) > this.tick) continue;
      const info = this.info(o, -3, p);
      if (o === this.threatObj && info.distance < THREAT_RANGE * 1.3) return info;
      if (info.distance < THREAT_RANGE && (!best || info.distance < best.distance)) best = info;
    }
    if (best && best.obj !== this.threatObj) {
      this.threatObj = best.obj;
      this.threatSince = this.tick;
    }
    return best;
  }

  /**
   * Esquive de l'hélicoptère : parmi les projectiles ennemis (classe `0x3b`), celui qui passera le plus tôt à moins de DODGE unités
   * du joueur (trajectoires rectilignes relatives) ; le robot glisse alors du côté opposé à sa ligne de vol, en remplaçant la consigne
   * latérale.
   */
  private dodge(inp: PlayerInput): void {
    const w = this.world;
    const p = w.player.obj;
    let soonest = Infinity;
    let side = 0;
    for (const o of w.liveObjects()) {
      if (o.classe !== 0x3b) continue;
      const rx = torusDelta(o.x, p.x) / 256;
      const ry = (o.y - p.y) / 256;
      const rz = torusDelta(o.z, p.z) / 256;
      if (Math.abs(rx) > 900 || Math.abs(rz) > 900) continue;
      const vx = (o.vx - p.vx) / 256;
      const vy = (o.vy - p.vy) / 256;
      const vz = (o.vz - p.vz) / 256;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 < 1) continue;
      const tc = -(rx * vx + ry * vy + rz * vz) / v2;
      if (tc < 0 || tc > DODGE_HORIZON || tc >= soonest) continue;
      const mx = rx + vx * tc;
      const my = ry + vy * tc;
      const mz = rz + vz * tc;
      if (mx * mx + my * my + mz * mz > DODGE * DODGE) continue;
      soonest = tc;
      // côté du joueur par rapport à la ligne du projectile, dans le plan : signe de (v × r) en y ; aller de ce côté
      const cross = vx * -rz - vz * -rx;
      // droite de l'appareil : (cos cap, -sin cap) ; la direction d'écart est la perpendiculaire à v du côté du joueur
      const a = (p.yaw * 2 * Math.PI) / 512;
      const ex = cross > 0 ? -vz : vz;
      const ez = cross > 0 ? vx : -vx;
      side = ex * Math.cos(a) - ez * Math.sin(a) > 0 ? 1 : -1;
    }
    if (side === 0) return;
    inp.strafeRight = side > 0;
    inp.strafeLeft = side < 0;
  }

  /**
   * Véhicule au sol : la cible d'objectif si le trajet du véhicule y mène sans franchir de mur (coût du champ sous REACHABLE) ;
   * sinon `null` et le robot rejoint une plate-forme pour passer en hélicoptère.
   */
  private groundObjective(): TargetInfo | null {
    const form = this.world.player.form;
    if (form === 0 || form === 3) return null;
    const t = this.target();
    if (!t) return null;
    let reach = this.reachable.get(t.obj);
    if (reach === undefined) {
      const p = this.world.player.obj;
      const field = new GroundField(this.world.level, t.obj.x >> 8, t.obj.z >> 8);
      reach = field.costAt(p.x / 256, p.z / 256) < REACHABLE;
      this.reachable.set(t.obj, reach);
    }
    return reach ? t : null;
  }

  /** Entrées du prochain tick. */
  decide(): PlayerInput {
    const inp = emptyInput();
    const w = this.world;
    const p = w.player.obj;
    this.tick++;
    const t = this.groundObjective() ?? this.jumpGoal() ?? this.padGoal() ?? this.pickupGoal() ?? this.threat() ?? this.target();
    if (!t || w.game.endCounter >= 0) return inp;

    const heli = w.player.form === 0 || w.player.form === 3;
    const desired = Math.round((Math.atan2(t.dx, t.dz) * 512) / (2 * Math.PI));
    const err = (((desired - p.yaw + 256) % 512) + 512) % 512 - 256;
    // véhicule au sol : le cap de conduite contourne les pentes que le véhicule ne grimpe pas (le tir reste réglé sur `err`)
    const drive = heli ? err : this.driveError(desired, t);
    const speed = Math.hypot(p.vx, p.vz) / 256;

    // détection de blocage
    if (this.tick % 10 === 0) {
      this.history.push({ x: p.x / 256, z: p.z / 256 });
      if (this.history.length > STUCK_WINDOW / 10) {
        const old = this.history.shift()!;
        const moved = Math.hypot(torusDelta(p.x, old.x * 256) / 256, torusDelta(p.z, old.z * 256) / 256);
        if (moved < STUCK_MIN_MOVE && t.distance > STANDOFF + 150 && this.unstuckLeft === 0) {
          this.stuck.push({
            tick: w.tickCount,
            x: Math.round(p.x / 256),
            z: Math.round(p.z / 256),
            y: Math.round(p.y / 256),
            targetType: t.obj.type,
            targetGroup: t.group,
            targetX: Math.round(t.obj.x / 256),
            targetZ: Math.round(t.obj.z / 256),
            distance: Math.round(t.distance),
          });
          this.unstuckLeft = UNSTUCK_TICKS;
          this.unstuckDir = -this.unstuckDir;
          this.history = [];
        }
      }
    }
    // véhicule au sol sur un trajet : si le coût restant n'a pas baissé depuis PROGRESS_WINDOW ticks (il monte et redescend la même
    // pente) et qu'il a un Super Ressort, il saute vers le trajet
    if (!heli && this.field && this.field.goal === t.obj && this.unstuckLeft === 0 && this.jumpLeft === 0) {
      const cost = this.field.field.costAt(p.x / 256, p.z / 256);
      if (this.progress?.goal !== t.obj || cost < this.progress.best - PROGRESS_MIN) {
        this.progress = { goal: t.obj, best: cost, since: this.tick };
      } else if (this.tick - this.progress.since > PROGRESS_WINDOW && (w.game.ammo[JUMP_SLOT] ?? 0) > 0) {
        this.jumpLeft = JUMP_TICKS;
        this.progress.since = this.tick + JUMP_TICKS;
      }
    }
    if (this.jumpLeft > 0) {
      // sélection du Super Ressort, alignement sur le trajet plus loin (le saut porte à plus de 1 000 unités), puis tir de l'arme
      this.jumpLeft--;
      const st = w.status;
      const jumpErr = this.jumpError();
      if (st.special !== JUMP_SLOT) {
        if (this.tick % 5 === 0) inp.weaponDirect = JUMP_SLOT + 1;
      } else if (Math.abs(jumpErr) > 4) {
        if (jumpErr > 0) inp.turnRight = true;
        else inp.turnLeft = true;
        if (speed < 2) inp.forward = true;
      } else if (st.specialArmed) {
        inp.fireSpecial = true;
        this.jumps++;
        this.jumpLeft = 0;
      } else inp.forward = speed < 2;
      return inp;
    }
    if (this.unstuckLeft > 0) {
      // dégagement : reculer en tournant, puis repartir
      this.unstuckLeft--;
      inp.back = this.unstuckLeft > UNSTUCK_TICKS / 2;
      inp.forward = !inp.back;
      if (this.unstuckDir > 0) inp.turnRight = true;
      else inp.turnLeft = true;
      return inp;
    }

    if (drive > 2) inp.turnRight = true;
    else if (drive < -2) inp.turnLeft = true;

    if (Math.abs(drive) < 60) {
      // freinage : la distance de glissade vaut environ 16 ticks de vitesse (frottement 1/16)
      const slide = speed * 16;
      const standoff = t.pickup ? 30 : heli ? STANDOFF : GROUND_STANDOFF;
      if (t.distance > standoff && t.distance > slide * 0.8 + standoff * 0.5) inp.forward = true;
      else if (heli && speed > 3 && t.distance < slide + 80 && !t.pickup) inp.back = true;
    }

    // tir : cible dans la portée et dans le cône (une cible de 30 unités de rayon)
    const tol = Math.max(3, Math.round((Math.atan2(40, Math.max(t.distance, 1)) * 512) / (2 * Math.PI)));
    if (!t.pickup && t.distance < FIRE_RANGE && Math.abs(err) <= tol) inp.firePrimary = true;
    // combat de l'hélicoptère : consigne de vitesse (rapprochement vers la distance de tir + orbite latérale), suivie en tout ou
    // rien dans le repère de l'appareil ; les tirs ennemis partent vers sa position du moment, sans anticipation
    if (heli && !t.pickup && t.distance < COMBAT_RANGE) {
      const dir = Math.floor(this.tick / ORBIT_FLIP) % 2 === 0 ? 1 : -1;
      const ux = t.dx / Math.max(1, t.distance);
      const uz = t.dz / Math.max(1, t.distance);
      const radial = Math.max(-6, Math.min(APPROACH, (t.distance - STANDOFF) / 20));
      // tangente (à droite de la direction de la cible) : (uz, -ux)
      const wantX = ux * radial + uz * ORBIT * dir;
      const wantZ = uz * radial - ux * ORBIT * dir;
      const ex = wantX - p.vx / 256;
      const ez = wantZ - p.vz / 256;
      const a = (p.yaw * 2 * Math.PI) / 512;
      const fwd = ex * Math.sin(a) + ez * Math.cos(a);
      const right = ex * Math.cos(a) - ez * Math.sin(a);
      inp.forward = fwd > DEADBAND;
      inp.back = fwd < -DEADBAND;
      inp.strafeRight = right > DEADBAND;
      inp.strafeLeft = right < -DEADBAND;
    }
    if (heli) this.dodge(inp);
    if (!t.pickup) this.special(inp, t, err);
    return inp;
  }

  /**
   * Écart de cap (pas) à suivre pour un véhicule au sol : le cap vers un point quelques cases plus loin sur le trajet le moins
   * pentu et le plus sec jusqu'à la cible (`GroundField`) ; tout droit quand la cible est proche ou le champ n'y mène pas.
   */
  private driveError(desired: number, t: TargetInfo): number {
    const p = this.world.player.obj;
    let yaw = desired;
    // une plate-forme se rejoint par le trajet jusqu'à 100 unités (elle capte à 122), une cible se vise depuis DIRECT_RANGE
    const seed = t.group === -2 ? PAD_SEED : undefined;
    if (t.distance > (seed ? PAD_SEED * 64 + 36 : DIRECT_RANGE)) {
      if (this.field?.goal !== t.obj) {
        this.field = { goal: t.obj, field: new GroundField(this.world.level, t.obj.x >> 8, t.obj.z >> 8, seed) };
      }
      const wp = this.field.field.waypoint(p.x / 256, p.z / 256, PATH_LOOKAHEAD);
      yaw = Math.round((Math.atan2(torusDelta(wp.x * 256, p.x) / 256, torusDelta(wp.z * 256, p.z) / 256) * 512) / (2 * Math.PI));
    }
    return (((yaw - p.yaw + 256) % 512) + 512) % 512 - 256;
  }

  /** Écart de cap (pas) vers le point du trajet situé JUMP_LOOKAHEAD cases plus loin : la direction du saut. */
  private jumpError(): number {
    const p = this.world.player.obj;
    if (!this.field) return 0;
    const wp = this.field.field.waypoint(p.x / 256, p.z / 256, JUMP_LOOKAHEAD);
    const yaw = Math.round((Math.atan2(torusDelta(wp.x * 256, p.x) / 256, torusDelta(wp.z * 256, p.z) / 256) * 512) / (2 * Math.PI));
    return (((yaw - p.yaw + 256) % 512) + 512) % 512 - 256;
  }

  /** Arme spéciale : sélectionne la première arme de 1 à 10 qui a des munitions, tire (appui bref) armée, alignée et à portée. */
  private special(inp: PlayerInput, t: TargetInfo, err: number): void {
    const st = this.world.status;
    const ammo = st.specialAmmo;
    if (st.special < 0 || st.special > 9 || st.special === JUMP_SLOT || (ammo[st.special] ?? 0) <= 0) {
      const k = [0, 1, 4, 2, 3, 5, 6, 8, 10].find((i) => i <= 9 && (ammo[i] ?? 0) > 0);
      if (k !== undefined && this.tick % 20 === 0) inp.weaponDirect = k + 1;
      return;
    }
    if (st.specialArmed && this.tick - this.lastSpecial >= SPECIAL_GAP && t.distance > 200 && t.distance < 900 && Math.abs(err) < 24) {
      inp.fireSpecial = true;
      this.lastSpecial = this.tick;
      this.specialShots++;
    }
  }
}
