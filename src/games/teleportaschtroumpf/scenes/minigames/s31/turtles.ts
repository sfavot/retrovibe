import type { BorlandRandom } from "../../../engine/rng";

/**
 * Logique pure de S31 « Les Tortues » (`2f87:0008`, `2f87:0656`, `2f87:0950` ; RE : `docs/teleportaschtroumpf/minigames/s31.md`),
 * sans écran ni son : les tortues et le Schtroumpf avancent d'**une itération** à la fois (toutes les 5 ticks) et disent quelle image dessiner.
 */

/** Nombre d'images des animations de `s31a001s.hy8` (tortues), dans l'ordre des animations 0 à 5. */
export const TURTLE_FRAMES = [6, 6, 11, 11, 7, 7] as const;
/** Nombre d'images des animations de `s31a000s.hy8` (Schtroumpf) : repos, saut en avant, saut en arrière, saut sur place, chute. */
export const SMURF_FRAMES = [1, 6, 6, 6, 16] as const;

/** Position d'une tortue : au repos à droite (`home`), le haut-gauche du trajet (`left`). La pente est de 3 pour 1 (`150 × 50`). */
export interface TurtleSpec {
  home: readonly [x: number, y: number];
  left: readonly [x: number, y: number];
}

/** Les cinq tortues, de la plus proche à la plus éloignée (enregistrements de `0xEE` octets à `DS:7E32`, remplis par `2f87:0008`). */
export const TURTLE_SPECS: readonly TurtleSpec[] = [
  { home: [0xbc, 0x9f], left: [0x26, 0x6d] },
  { home: [0xcb, 0x84], left: [0x35, 0x52] },
  { home: [0xdf, 0x69], left: [0x49, 0x37] },
  { home: [0x116, 0x58], left: [0x80, 0x26] },
  { home: [0x118, 0x39], left: [0x82, 0x07] },
];

/** Décalage initial sur le trajet : `k` pas de (−3, −1), `k` tiré dans 0..29 en gardant 15 d'écart avec la tortue précédente. */
export const START_SPREAD = 30;
export const START_MIN_GAP = 15;

/** Vitesses de nage (pixels par itération) : lente (3, 1) ou rapide (6, 2). */
export const SPEEDS = [
  [3, 1],
  [6, 2],
] as const;

/**
 * Compteur d'images d'une animation (`12d7:00c1`) : `next()` rend l'image montrée et avance ; `counter` est l'image suivante, 0 quand
 * l'animation vient de finir (le jeu teste ce 0 pour détecter la fin).
 */
export class FrameCycle {
  counter = 0;

  constructor(readonly length: number) {}

  next(): number {
    const shown = this.counter;
    this.counter++;
    if (this.counter >= this.length) this.counter = 0;
    return shown;
  }
}

/**
 * Phase d'une tortue (les six drapeaux `DS:7E42..7E47` de l'enregistrement, un seul à la fois). Le cycle :
 * `glideRight` (nage vers la rive droite) → `diveRight` (plonge à la rive droite) → `leaveRight` (repart vers la gauche) → `glideLeft`
 * (nage vers la gauche) → `diveLeft` (plonge au bout gauche) → `leaveLeft` (repart vers la droite) → `glideRight`.
 */
export type TurtlePhase = "glideRight" | "diveRight" | "leaveRight" | "glideLeft" | "diveLeft" | "leaveLeft";

/** Animation jouée dans chaque phase et sens du déplacement (+1 vers la droite et le bas, −1 vers la gauche et le haut, 0 à l'arrêt). */
const PHASES: Readonly<Record<TurtlePhase, { animation: number; direction: -1 | 0 | 1 }>> = {
  glideRight: { animation: 3, direction: 1 },
  diveRight: { animation: 1, direction: 0 },
  leaveRight: { animation: 4, direction: -1 },
  glideLeft: { animation: 2, direction: -1 },
  diveLeft: { animation: 0, direction: 0 },
  leaveLeft: { animation: 5, direction: 1 },
};

export interface TurtleDraw {
  animation: number;
  frame: number;
  x: number;
  y: number;
}

export class Turtle {
  x: number;
  y: number;
  phase: TurtlePhase;
  private readonly cycles = TURTLE_FRAMES.map((n) => new FrameCycle(n));

  /**
   * @param offset  décalage `k` sur le trajet (0..29)
   * @param speed   vitesse (`SPEEDS[speed]`)
   * @param leftFirst  vrai : part vers la gauche (`DS:7E42`), faux : vers la droite (`DS:7E43`)
   */
  constructor(
    readonly spec: TurtleSpec,
    offset: number,
    public speed: 0 | 1,
    leftFirst: boolean,
  ) {
    this.x = spec.home[0] - 3 * offset;
    this.y = spec.home[1] - offset;
    this.phase = leftFirst ? "glideLeft" : "glideRight";
  }

  /** Compteur d'images de l'animation `animation` (`+0x16` de l'objet), pour les tests. */
  counter(animation: number): number {
    return this.cycles[animation].counter;
  }

  /**
   * La tortue est sous l'eau : le Schtroumpf qui la monte se noie. À l'arrêt d'une rive, une fois les trois premières images de la
   * plongée montrées (compteur > 3, `2f87:073c` et `2f87:075a`).
   */
  get submerged(): boolean {
    if (this.phase === "diveLeft") return this.cycles[0].counter > 3;
    if (this.phase === "diveRight") return this.cycles[1].counter > 3;
    return false;
  }

  /** Une itération (`2f87:0950`) : déplacement, image suivante de l'animation de la phase, changement de phase en fin de trajet ou d'animation. */
  step(): TurtleDraw {
    const { animation, direction } = PHASES[this.phase];
    const [vx, vy] = SPEEDS[this.speed];
    this.x += direction * vx;
    this.y += direction * vy;
    const cycle = this.cycles[animation];
    const frame = cycle.next();
    const draw = { animation, frame, x: this.x, y: this.y };
    switch (this.phase) {
      case "glideRight":
        if (this.x >= this.spec.home[0]) {
          [this.x, this.y] = this.spec.home;
          this.phase = "diveRight";
        }
        break;
      case "diveRight":
        if (cycle.counter === 0) this.phase = "leaveRight";
        break;
      case "leaveRight":
        if (cycle.counter === 0) this.phase = "glideLeft";
        break;
      case "glideLeft":
        if (this.x <= this.spec.left[0]) {
          [this.x, this.y] = this.spec.left;
          this.phase = "diveLeft";
        }
        break;
      case "diveLeft":
        if (cycle.counter === 0) this.phase = "leaveLeft";
        break;
      case "leaveLeft":
        if (cycle.counter === 0) this.phase = "glideRight";
        break;
    }
    return draw;
  }
}

/**
 * Place les cinq tortues dans l'ordre des tirages de l'original : pour chacune, le décalage (retiré tant qu'il est à moins de 15 de celui
 * de la précédente ; la première se compare à 0), la vitesse (`rand × diviseur`, le diviseur valant 1 avec l'indice de l'oiseau : toujours
 * lente, mais le tirage a lieu), puis le sens de départ (`rand × 2`).
 */
export function placeTurtles(rng: BorlandRandom, slowOnly: boolean): Turtle[] {
  const turtles: Turtle[] = [];
  let previous = 0;
  for (const spec of TURTLE_SPECS) {
    let offset: number;
    do {
      offset = rng.below(START_SPREAD);
    } while (Math.abs(offset - previous) < START_MIN_GAP);
    const speed = rng.below(slowOnly ? 1 : SPEEDS.length) as 0 | 1;
    const leftFirst = rng.below(2) === 0;
    turtles.push(new Turtle(spec, offset, speed, leftFirst));
    previous = offset;
  }
  return turtles;
}

// --- Le Schtroumpf --------------------------------------------------------------------------------------------

/** Les niveaux (teinte du joueur) : fond, case de départ (l'index d'une tortue, ou −1 / 0 pour une rive), position de départ. */
export interface LevelSpec {
  background: string;
  /** Index de la case de départ ; les tortues d'index supérieur sont en jeu (`DS:E0F0`, `DS:E0F4`). */
  start: number;
  x: number;
  y: number;
}

export const LEVELS: readonly LevelSpec[] = [
  { background: "s31a003d.mcg", start: 1, x: 0x84, y: 0x70 },
  { background: "s31a002d.mcg", start: 0, x: 0x68, y: 0x88 },
  { background: "s31a001d.mcg", start: -1, x: 0x4c, y: 0xa0 },
];

/** Case d'arrivée : l'autre rive, après la tortue 4 (`DS:E0F2`). */
export const GOAL = 5;

/** Un saut déplace le Schtroumpf de 31 pixels vers la droite et 27 vers le haut (`2f87:0894`, `2f87:08d0`). */
export const HOP_DX = 0x1f;
export const HOP_DY = 0x1b;
/** Écart horizontal toléré entre le Schtroumpf et sa tortue (`2f87:0716`, `2f87:072b`) : au-delà, il tombe à l'eau. */
export const LANDING_TOLERANCE = 0x14;

/** État du Schtroumpf (`DS:7C96`) : au repos, saut en avant, saut en arrière, saut sur place, chute. */
export const SMURF_IDLE = 0;
export const SMURF_HOP_FORWARD = 1;
export const SMURF_HOP_BACK = 2;
export const SMURF_HOP_IN_PLACE = 3;
export const SMURF_FALLING = 4;
export type SmurfState = 0 | 1 | 2 | 3 | 4;

export interface SmurfKeys {
  /** Haut (`DS:4BBB & 1`) : saute vers l'avant. */
  up: boolean;
  /** Bas (`DS:4BBB & 2`) : saute vers l'arrière. */
  down: boolean;
  /** Bouton gauche (`DS:4BBD == 1`) : saute sur place. */
  click: boolean;
}

export interface SmurfDraw {
  animation: number;
  frame: number;
  x: number;
  y: number;
}

/** Ce que le Schtroumpf demande à la scène pendant une itération. */
export interface SmurfStep {
  draw: SmurfDraw;
  /** Bruit de saut (haut, bas, clic) ou de chute, joué si rien ne sonne. */
  sound?: "jump" | "splash";
  won: boolean;
  lost: boolean;
}

export class Smurf {
  x: number;
  y: number;
  /** Case occupée : −1 / 0 / 1 pour la rive de départ, 0 à 4 pour une tortue, 5 pour l'arrivée (`DS:E0FC`). */
  current: number;
  state: SmurfState = SMURF_IDLE;
  private readonly cycles = SMURF_FRAMES.map((n) => new FrameCycle(n));

  constructor(readonly level: LevelSpec) {
    this.x = level.x;
    this.y = level.y;
    this.current = level.start;
  }

  /** Compteur d'images de l'animation `animation`, pour les tests. */
  counter(animation: number): number {
    return this.cycles[animation].counter;
  }

  /** Les tortues sont-elles à l'origine de la chute ? Vrai si la case est une tortue qui s'est éloignée ou qui plonge (`2f87:06fb..0770`). */
  private fallsOnto(turtles: readonly Turtle[]): boolean {
    const turtle = turtles[this.current];
    const onTurtle = this.current !== this.level.start && this.current !== GOAL;
    if (onTurtle && turtle && (turtle.x + LANDING_TOLERANCE < this.x || turtle.x - LANDING_TOLERANCE > this.x)) return true;
    // Sur la rive de départ, la case est sûre : les tortues d'index ≤ départ ne plongent jamais (leurs drapeaux restent à 0).
    return turtle?.submerged === true;
  }

  /** Une itération (`2f87:0656`) : lit les touches au repos, décide d'une chute, puis joue l'état courant. */
  step(keys: SmurfKeys, turtles: readonly Turtle[]): SmurfStep {
    let sound: SmurfStep["sound"];
    if (this.state === SMURF_IDLE) {
      if (keys.click) {
        sound = "jump";
        this.state = SMURF_HOP_IN_PLACE;
      }
      if (keys.up && this.current !== GOAL) {
        sound = "jump";
        this.state = SMURF_HOP_FORWARD;
      }
      if (keys.down && this.current !== this.level.start) {
        sound = "jump";
        this.state = SMURF_HOP_BACK;
      }
      if (this.fallsOnto(turtles)) {
        sound = "splash";
        this.state = SMURF_FALLING;
      }
    }
    let won = false;
    let lost = false;
    const draw = (animation: number): SmurfDraw => ({ animation, frame: this.cycles[animation].next(), x: this.x, y: this.y });
    let shown: SmurfDraw;
    switch (this.state) {
      case SMURF_IDLE:
        if (this.current !== this.level.start && this.current !== GOAL) {
          // Sur une tortue, il la suit : la position est celle de la tortue.
          this.x = turtles[this.current].x;
          this.y = turtles[this.current].y;
        }
        shown = draw(0);
        won = this.current === GOAL;
        break;
      case SMURF_HOP_FORWARD:
        shown = draw(1);
        if (this.cycles[1].counter === 0) {
          this.x += HOP_DX;
          this.y -= HOP_DY;
          this.current++;
          this.state = SMURF_IDLE;
        }
        break;
      case SMURF_HOP_BACK:
        shown = draw(2);
        if (this.cycles[2].counter === 0) {
          this.x -= HOP_DX;
          this.y += HOP_DY;
          this.current--;
          this.state = SMURF_IDLE;
        }
        break;
      case SMURF_HOP_IN_PLACE:
        shown = draw(3);
        if (this.cycles[3].counter === 0) this.state = SMURF_IDLE;
        break;
      default:
        shown = draw(4);
        if (this.cycles[4].counter === 0) lost = true;
    }
    return { draw: shown, sound, won, lost };
  }
}
