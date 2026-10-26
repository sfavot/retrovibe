/**
 * Caméra de poursuite (`gm_render_view`, `0042b31c` ; docs/swiv3d/player.md §4). Le calcul de la cible et de l'œil est entier
 * comme dans l'exe ; le lissage est en flottants (l'exe lisse `V[6..13]` en flottants) et se fait une fois par **image**
 * avec `k = max(1, fps / 4)` : `smooth(fps)` est donc appelé par le moteur de rendu, ou par `World.tick` avec une cadence
 * fixe (`WorldOptions.cameraFps`). Toutes les coordonnées sont en unités de monde (Q8 >> 8).
 */
import { clamp, COS, SIN, torusDelta, TORUS_Q8 } from "./fixed";
import type { Terrain } from "./terrain";

/** Côté du monde en unités. */
const WORLD_UNITS = TORUS_Q8 >> 8;

export interface CameraTarget {
  /** Position Q8 du joueur suivi. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
}

export class Camera {
  /** `V[2]` : caméra figée (mort, F4). */
  frozen = false;
  /** `V[3]` : décalage de cap (F5/F6), pas d'angle. */
  yawOffset = 0;
  /** `V[4]` : angle de site, borné 15..100, défaut 30. */
  pitch = 30;
  /** `V[5]` : distance, bornée 200..800, défaut 550 (0x226). */
  distance = 550;
  /** `V[6..8]` : point visé lissé. */
  aimX = 0;
  aimY = 0;
  aimZ = 0;
  /** `V[10..12]` : position de l'œil lissée. */
  eyeX = 0;
  eyeY = 0;
  eyeZ = 0;
  /** `V[13]` : roulis lissé (flottant, borné ±0,5). */
  roll = 0;
  /** Cibles instantanées du dernier `setGoal`. */
  goalAimX = 0;
  goalAimY = 0;
  goalAimZ = 0;
  goalEyeX = 0;
  goalEyeY = 0;
  goalEyeZ = 0;
  goalRoll = 0;
  /** Option : « plan large » des événements (liste `00587704` non vide) : œil +900 et reculé une 2ᵉ fois. */
  wideShot = false;
  private initialised = false;
  private px = 0;
  private py = 0;
  private pz = 0;

  /** Calcule les cibles instantanées d'après le joueur. Premier appel : le lissage démarre sur la cible. */
  setGoal(p: CameraTarget, terrain: Terrain): void {
    const aimX = (p.x >> 8) + (SIN[p.yaw & 0x1ff]! >> 1);
    const aimY = p.y >> 8;
    const aimZ = (p.z >> 8) + (COS[p.yaw & 0x1ff]! >> 1);
    const v4 = clamp(this.pitch, 15, 100);
    const v5 = clamp(this.distance, 200, 800);
    let radius = (COS[v4]! * v5) >> 8;
    const a = (p.yaw + this.yawOffset) & 0x1ff;
    let eyeX = aimX - ((SIN[a]! * radius) >> 8);
    let eyeY = aimY + ((SIN[v4]! * v5) >> 8);
    let eyeZ = aimZ - ((COS[a]! * radius) >> 8);
    if (this.wideShot) {
      eyeY += 900;
      radius = (COS[v4]! * v5) >> 8;
      eyeX -= (SIN[a]! * radius) >> 8;
      eyeZ -= (COS[a]! * radius) >> 8;
    }
    // Garde-sol : œil au moins 120 unités au-dessus du plus haut des 5 points (œil, œil ± 30 000 Q8 en x et en z).
    const ex = eyeX * 256;
    const ez = eyeZ * 256;
    const h = Math.max(
      terrain.height(ex, ez),
      terrain.height(ex + 30000, ez),
      terrain.height(ex - 30000, ez),
      terrain.height(ex, ez + 30000),
      terrain.height(ex, ez - 30000),
    );
    eyeY = Math.max(eyeY, (h >> 8) + 120);

    this.goalAimX = aimX;
    this.goalAimY = aimY;
    this.goalAimZ = aimZ;
    this.goalEyeX = eyeX;
    this.goalEyeY = eyeY;
    this.goalEyeZ = eyeZ;
    this.goalRoll = clamp(-p.roll * 0.013333, -0.5, 0.5);
    this.px = p.x >> 8;
    this.py = p.y >> 8;
    this.pz = p.z >> 8;
    if (!this.initialised) this.snap();
  }

  /** Copie les cibles sans lissage (changement de joueur suivi, apparition). */
  snap(): void {
    this.aimX = this.goalAimX;
    this.aimY = this.goalAimY;
    this.aimZ = this.goalAimZ;
    this.eyeX = this.goalEyeX;
    this.eyeY = this.goalEyeY;
    this.eyeZ = this.goalEyeZ;
    this.roll = this.goalRoll;
    this.initialised = true;
  }

  /** Lissage exponentiel d'une image : `V += (cible - V) / k`, `k = max(1, fps >> 2)` ; roulis `/ fps`. L'écart suit le tore. */
  smooth(fps: number): void {
    const k = Math.max(1, Math.floor(fps) >> 2);
    const step = (cur: number, goal: number, div: number): number => {
      let d = goal - cur;
      d -= Math.round(d / WORLD_UNITS) * WORLD_UNITS;
      return cur + d / div;
    };
    this.aimX = step(this.aimX, this.goalAimX, k);
    this.aimY = step(this.aimY, this.goalAimY, k);
    this.aimZ = step(this.aimZ, this.goalAimZ, k);
    if (!this.frozen) {
      this.eyeX = step(this.eyeX, this.goalEyeX, k);
      this.eyeY = step(this.eyeY, this.goalEyeY, k);
      this.eyeZ = step(this.eyeZ, this.goalEyeZ, k);
    } else {
      const dx = torusDelta(this.eyeX * 256, this.px * 256) / 256;
      const dz = torusDelta(this.eyeZ * 256, this.pz * 256) / 256;
      const dy = this.eyeY - this.py;
      if (dx * dx + dy * dy + dz * dz > 3_500_000) this.frozen = false;
    }
    this.roll = clamp(
      this.roll + (this.goalRoll - this.roll) / Math.max(1, fps),
      -0.5,
      0.5,
    );
  }
}
