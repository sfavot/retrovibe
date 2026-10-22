import type { Hy8 } from "../../data/hy8";
import type { BorlandRandom } from "../../engine/rng";
import type { Surface } from "../../engine/surface";

/**
 * Décor animé des écrans du plateau (routines de dessin `2bd4:07e2..149c`, une par écran, appelées à chaque image par
 * `2bd4:0771`). Les animations sont celles de `s01a000s.hy8` ; la position est celle du dernier argument de
 * `31fe:0481` (x = bord gauche, y = ligne du bas). Trois comportements :
 *
 * - **continu** : une frame par image (écran 1, écran 7) ;
 * - **minuté** : attend un délai en secondes, joue l'animation une fois, tire un nouveau délai (`rand × 10 / 0x8000`) ;
 * - **volant** (`2bd4:1634` / `2bd4:174a`) : après 5 à 14 s, un oiseau traverse l'écran de bord à bord, avec un léger
 *   mouvement vertical ; une fois par visite de l'écran.
 *
 * Le puits ouvert (animation 24 aux écrans 4, 6 et 9) est dessiné tant que le puits est ouvert ce tour.
 */

/** Animation de s01a000s.hy8 du puits ouvert (`0x18`) et sa position par écran (`2bd4:0af9`, `0e9c`, `149c`). */
const WELL_ANIMATION = 0x18;
const WELL_POSITIONS: Readonly<Record<number, readonly [number, number]>> = { 4: [0x101, 0x36], 6: [0x2e, 0x36], 9: [0x27, 0x36] };

interface Looped {
  kind: "continuous";
  animation: number;
  x: number;
  y: number;
}

interface Timed {
  kind: "timed";
  animation: number;
  /** Abscisse fixe, ou tirage à chaque passage. */
  x: number | (() => number);
  y: number;
  /** Délai initial puis délai entre deux passages, en secondes. */
  first: (rng: BorlandRandom) => number;
  next: (rng: BorlandRandom) => number;
}

type Fixed = Looped | Timed;

/** Décors fixes par écran (numéro 1..9). */
const FIXED: Readonly<Record<number, readonly Fixed[]>> = {
  1: [
    { kind: "continuous", animation: 0x13, x: 0x7b, y: 0x12 },
    { kind: "continuous", animation: 0x14, x: 0xff, y: 0x5c },
    { kind: "continuous", animation: 0x15, x: 0xda, y: 0x55 },
  ],
  3: [{ kind: "timed", animation: 0x16, x: 0xb4, y: 0x32, first: (r) => r.below(7), next: (r) => r.below(10) }],
  4: [{ kind: "timed", animation: 0x17, x: 0x33, y: 0x49, first: (r) => r.below(7), next: (r) => r.below(10) }],
  7: [
    { kind: "timed", animation: 0x11, x: 0xe6, y: 0x78, first: (r) => r.below(7), next: (r) => 5 + r.below(10) },
    { kind: "timed", animation: 0x12, x: 0x49, y: 0x25, first: (r) => r.below(7), next: (r) => r.below(10) },
    { kind: "continuous", animation: 0x10, x: 0x24, y: 0x53 },
  ],
};

/** Oiseaux : haut (objet `78c7`, y 25..43) aux écrans 2, 4, 6, 8, 9 ; bas (objet `7896`, y 100..117) aux écrans 3, 5, 6, 8, 9. */
const HIGH_FLIER_SCREENS = new Set([2, 4, 6, 8, 9]);
const LOW_FLIER_SCREENS = new Set([3, 5, 6, 8, 9]);
/** Animations d'oiseau : trois vers la gauche (départ à droite), trois vers la droite (`2bd4:1634`). */
const FLY_LEFT_ANIMATIONS = [0x1a, 0x1b, 0x1c];
const FLY_RIGHT_ANIMATIONS = [0x1d, 0x1e, 0x1f];
const FLY_BAND = { high: { min: 0x19, max: 0x2b, start: 0x19 }, low: { min: 100, max: 0x75, start: 100 } } as const;

/** Sprite à poser pour l'image courante. */
interface Drawn {
  sprite: number;
  x: number;
  y: number;
}

class Anim {
  private index = 0;
  constructor(
    readonly hy8: Hy8,
    readonly animation: number,
  ) {}

  /** Sprite de la frame courante, puis avance ; `wrapped` est vrai quand l'animation vient de boucler. */
  next(): { sprite: number; wrapped: boolean } | null {
    const frames = this.hy8.animations[this.animation]?.frames;
    if (!frames || frames.length === 0) return null;
    const frame = frames[this.index];
    this.index = (this.index + 1) % frames.length;
    return { sprite: frame.sprite | (frame.flags & 0x8000), wrapped: this.index === 0 };
  }
}

class TimedActor {
  private readonly anim: Anim;
  private wait: number;
  private waited = 0;
  private x: number;

  constructor(
    hy8: Hy8,
    private readonly spec: Timed,
    private readonly rng: BorlandRandom,
  ) {
    this.anim = new Anim(hy8, spec.animation);
    this.wait = spec.first(rng);
    this.x = typeof spec.x === "number" ? spec.x : spec.x();
  }

  /** `seconds` : secondes de jeu écoulées depuis le début de la visite de l'écran (chrono entier). */
  update(seconds: number, out: Drawn[]): void {
    if (seconds - this.waited <= this.wait) return;
    const frame = this.anim.next();
    if (!frame) return;
    out.push({ sprite: frame.sprite, x: this.x, y: this.spec.y });
    if (frame.wrapped) {
      this.wait = this.spec.next(this.rng);
      this.waited = seconds;
      if (typeof this.spec.x !== "number") this.x = this.spec.x();
    }
  }
}

/** Oiseau qui traverse l'écran (`2bd4:174a`). */
class Flier {
  private anim: Anim | null = null;
  private x = 0;
  private y: number;
  private dyDir: number;
  private readonly leftward: boolean;
  private readonly delay: number;
  private readonly band: { min: number; max: number; start: number };

  constructor(
    hy8: Hy8,
    high: boolean,
    private readonly rng: BorlandRandom,
  ) {
    this.band = high ? FLY_BAND.high : FLY_BAND.low;
    this.y = this.band.start;
    this.dyDir = rng.below(2) === 0 ? -1 : 1;
    this.delay = 5 + rng.below(10);
    const pick = rng.below(6);
    this.leftward = pick < 3;
    this.anim = new Anim(hy8, (this.leftward ? FLY_LEFT_ANIMATIONS : FLY_RIGHT_ANIMATIONS)[pick % 3]);
    this.x = this.leftward ? 0x177 : -0x19;
  }

  update(seconds: number, out: Drawn[]): void {
    if (seconds <= this.delay || !this.anim) return;
    const { rng, band } = this;
    this.x += (this.leftward ? -1 : 1) * (7 + rng.below(5));
    this.y += this.dyDir * (3 + rng.below(3));
    if (this.y < band.min) this.dyDir = 1;
    if (this.y >= band.max) this.dyDir = -1;
    const frame = this.anim.next();
    if (frame) out.push({ sprite: frame.sprite, x: this.x, y: this.y });
  }
}

/** Décor d'un écran : créé à l'arrivée sur l'écran, avancé d'une image à chaque image du plateau, puis dessiné. */
export class Ambient {
  private readonly fixed: (TimedActor | Looped)[] = [];
  private readonly continuousAnims = new Map<Looped, Anim>();
  private readonly fliers: Flier[] = [];
  private readonly well: Anim | null;
  private readonly wellAt: readonly [number, number] | null;
  private drawn: Drawn[] = [];

  constructor(
    hy8: Hy8,
    screen: number,
    wellOpen: boolean,
    rng: BorlandRandom,
  ) {
    for (const spec of FIXED[screen] ?? []) {
      if (spec.kind === "timed") {
        // Septième écran : l'oiseau du bas apparaît à une abscisse tirée à chaque passage (`0xE6 + rand × 20`).
        this.fixed.push(new TimedActor(hy8, screen === 7 && spec.animation === 0x11 ? { ...spec, x: () => 0xe6 + rng.below(20) } : spec, rng));
      } else {
        this.fixed.push(spec);
        this.continuousAnims.set(spec, new Anim(hy8, spec.animation));
      }
    }
    if (HIGH_FLIER_SCREENS.has(screen)) this.fliers.push(new Flier(hy8, true, rng));
    if (LOW_FLIER_SCREENS.has(screen)) this.fliers.push(new Flier(hy8, false, rng));
    this.wellAt = wellOpen ? (WELL_POSITIONS[screen] ?? null) : null;
    this.well = this.wellAt ? new Anim(hy8, WELL_ANIMATION) : null;
  }

  /** Une image de décor ; `seconds` = secondes écoulées depuis l'arrivée sur l'écran. */
  update(seconds: number): void {
    const out: Drawn[] = [];
    for (const actor of this.fixed) {
      if (actor instanceof TimedActor) actor.update(seconds, out);
      else {
        const frame = this.continuousAnims.get(actor)?.next();
        if (frame) out.push({ sprite: frame.sprite, x: actor.x, y: actor.y });
      }
    }
    if (this.well && this.wellAt) {
      const frame = this.well.next();
      if (frame) out.push({ sprite: frame.sprite, x: this.wellAt[0], y: this.wellAt[1] });
    }
    for (const flier of this.fliers) flier.update(seconds, out);
    this.drawn = out;
  }

  draw(surface: Surface, hy8: Hy8): void {
    for (const d of this.drawn) surface.drawSprite(hy8, d.sprite, d.x, d.y);
  }
}
