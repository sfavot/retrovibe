/**
 * Pilote automatique de test : lit l'état du monde à chaque tick et rend les entrées d'un joueur qui va détruire les groupes
 * d'objectifs dans l'ordre (9 -> 0) avec ses armes réelles. Aucune triche : pas de téléportation, pas de modification de l'état.
 *
 * Direction : le cap `yaw` (512 pas par tour) pointe vers `(sin yaw, cos yaw)` en (x, z) ; tourner à droite augmente le cap.
 */
import type { PlayerInput } from "../../../src/games/swiv3d/engine/input";
import { emptyInput } from "../../../src/games/swiv3d/engine/input";
import { torusDelta } from "../../../src/games/swiv3d/engine/fixed";
import type { GameObject } from "../../../src/games/swiv3d/engine/objects";
import type { World } from "../../../src/games/swiv3d/engine/world";

/** Distance (unités) à laquelle le pilote cesse d'avancer et se contente de tirer. */
const STANDOFF = 260;
/** Portée de tir : une balle vole 28 à 30 ticks à 31 unités par tick. */
const FIRE_RANGE = 640;
/** Fenêtre de contrôle de blocage (ticks) et déplacement minimal attendu (unités). */
/** Écart minimal (ticks) entre deux tirs spéciaux. */
const SPECIAL_GAP = 40;
const STUCK_WINDOW = 120;
const STUCK_MIN_MOVE = 40;
/** Durée (ticks) d'une manœuvre de dégagement. */
const UNSTUCK_TICKS = 70;

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

/** Sous ce niveau d'énergie, le pilote fait un détour par le bonus d'énergie (codes 100 à 102) le plus proche. */
const LOW_ENERGY = 400;
/** Distance maximale (unités) d'un détour. */
const PICKUP_RANGE = 5000;

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
  private unstuckDir = 1;
  private tick = 0;

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

  /** Entrées du prochain tick. */
  decide(): PlayerInput {
    const inp = emptyInput();
    const w = this.world;
    const p = w.player.obj;
    this.tick++;
    const t = this.pickupGoal() ?? this.target();
    if (!t || w.game.endCounter >= 0) return inp;

    const heli = w.player.form === 0 || w.player.form === 3;
    const desired = Math.round((Math.atan2(t.dx, t.dz) * 512) / (2 * Math.PI));
    const err = (((desired - p.yaw + 256) % 512) + 512) % 512 - 256;
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
    if (this.unstuckLeft > 0) {
      // dégagement : reculer en tournant, puis repartir
      this.unstuckLeft--;
      inp.back = this.unstuckLeft > UNSTUCK_TICKS / 2;
      inp.forward = !inp.back;
      if (this.unstuckDir > 0) inp.turnRight = true;
      else inp.turnLeft = true;
      return inp;
    }

    if (err > 2) inp.turnRight = true;
    else if (err < -2) inp.turnLeft = true;

    if (Math.abs(err) < 60) {
      // freinage : la distance de glissade vaut environ 16 ticks de vitesse (frottement 1/16)
      const slide = speed * 16;
      const standoff = t.pickup ? 30 : STANDOFF;
      if (t.distance > standoff && t.distance > slide * 0.8 + standoff * 0.5) inp.forward = true;
      else if (heli && speed > 3 && t.distance < slide + 80 && !t.pickup) inp.back = true;
    }

    // tir : cible dans la portée et dans le cône (une cible de 30 unités de rayon)
    const tol = Math.max(3, Math.round((Math.atan2(40, Math.max(t.distance, 1)) * 512) / (2 * Math.PI)));
    if (!t.pickup && t.distance < FIRE_RANGE && Math.abs(err) <= tol) inp.firePrimary = true;
    if (!t.pickup) this.special(inp, t, err);
    return inp;
  }

  /** Arme spéciale : sélectionne la première arme de 1 à 10 qui a des munitions, tire (appui bref) armée, alignée et à portée. */
  private special(inp: PlayerInput, t: TargetInfo, err: number): void {
    const st = this.world.status;
    const ammo = st.specialAmmo;
    if (st.special < 0 || st.special > 9 || (ammo[st.special] ?? 0) <= 0) {
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
