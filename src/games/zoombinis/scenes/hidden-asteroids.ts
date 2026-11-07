/**
 * Écran caché 20 : les astéroïdes (`PICKER.MHK`, `1110:2f46` Enter, `1110:311e` Exit, `1110:317c` Tick, `1110:33f0` clic, `1110:35ae` touches, `1110:341e` vaisseau,
 * `1110:34a3` tir, `1110:3778` / `1110:3936` / `1110:3de7` rappels d'image du vaisseau, des tirs et des rochers, `1110:3b5a` rocher, `1110:3e95` score, `1110:3f99` fin
 * d'explosion ; `docs/zoombinis/screens.md` §1.7). On y arrive par le lieu 8 de la carte, en entraînement, juste après avoir tapé le code secret de l'écran.
 *
 * Ce que fait l'original (sûr, désassemblage) :
 * - décor : fond `tBMP` / `SHPL` 2000, planche 1000 avec ses `REGS` (`SCRB` 1000 à 1030), sons 3000 (rocher touché), 3001 (vaisseau détruit), 3002 (tir), musique 30035 ;
 *   `SCRB` 1012 décor, 1014 tableau (`1110:3e95` : meilleur score `S+0x24` et score sur trois chiffres, vies sur un), 1013 fin de partie ;
 * - le vaisseau (`SCRB` 1010, image 17 + direction) part du centre (320, 240), direction 0 (haut) ; huit directions dans le sens des aiguilles d'une montre ;
 *   touches `4` / `6` : tourner, `8` : pousser (± 4 sur chaque axe dans la direction, vitesse bornée à ± 12), `5` : tirer (trois tirs au plus, son 3002) ; l'écran
 *   « boucle » de −10 à 650 et de −10 à 490 ;
 * - un tir (`SCRB` 1011, image 25) part à 14 points devant le vaisseau à 14 points par pas ; il vit 12 pas, s'éteint en deux images (25, 27) puis disparaît ;
 * - rochers (six places) : une vague de 1 ou 2 gros rochers (`SCRB` 1016 à 1020, +1 point) quand il n'y en a plus ; un gros touché donne deux moyens (`SCRB` 1000 à
 *   1004, +5), un moyen deux petits (`SCRB` 1005 à 1009, +10 ; un troisième une fois sur trois), un petit rien ; les morceaux partent du rocher, de part et d'autre de
 *   sa direction ; vitesse 8, 12 ou 16 ; après chaque vague détruite, une fois sur deux, un rocher spécial (`SCRB` 1021 à 1025 vers la gauche ou 1026 à 1030 vers la
 *   droite, vitesse 20, +15) traverse l'écran ; un rocher touché joue l'explosion `SCRB` 1015 en continuant sa course, puis disparaît ;
 * - vaisseau touché par un rocher : explosion (images 11 à 14) en dérivant, son 3001, une vie de moins (3 au départ, une de plus tous les 100 points, 9 au plus) ;
 *   `Espace` fait repartir un vaisseau ; sans vie, `SCRB` 1013 s'affiche et `Espace` relance une partie ;
 * - un clic gauche n'importe où ramène à la carte (région plein écran `DS:16fc`, `1110:33f0`).
 *
 * Portage : les objets mus par leur rappel (vaisseau, tirs, rochers) sont lus par `11a0:1013` dans l'original, qui relit l'image 0 de leur script toutes les `délai`
 * ticks sans avancer, puis appelle le rappel : ici la scène tient leur échéance et pose elle-même la partie (position moins l'ancre `REGS`, rectangle de la forme).
 *
 * Écarts : l'Enter remplit l'écran de l'indice 0x2c puis recopie le fond (`11e8:3034`, `1058:0a66`) : sans effet visible ici (le fond est recopié en entier, **probable**) ;
 * `DS:235c` (attente des Zoombinis), mis à 0 par l'Enter et rendu par l'Exit, est sans objet (aucun Zoombini) ; la logique s'arrête pendant qu'une boîte de dialogue est
 * ouverte (comme `11a0:1013`, `DS:a2da`).
 */
import type { Archive } from "../../../engine/mohawk/resources";
import type { Fade } from "../../../engine/mohawk/graphics/palette";
import type { KeyEvent } from "../../../engine/mohawk/input";
import { DIALOG } from "../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeaturePart, type FeatureRect, type Features } from "../engine/features";
import { ZOOMBINIS_GAME, type ZoombinisGame } from "../engine/game";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenId } from "../engine/scene";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { closeScreen, fadeInScreen, fadeOutScreen, openScreen } from "./screen-kit";

const ARCHIVE = "PICKER.MHK";
/** Fond et palette (`11a8:1475(2000)`) ; planche 1000 avec `REGS` (`11a0:0000(0, 1, 1000)`) et ses 31 scripts (`11a8:14ab(31, 1000)`). */
const BACKGROUND = 2000;
const SHEET = 1000;
const SCRIPTS = 31;
const SHIP = 1010;
const BULLET = 1011;
const PANEL = 1012;
const GAME_OVER = 1013;
const SCOREBOARD = 1014;
const EXPLOSION = 1015;
/** Délais des objets (`11a8:0ad6`) : vaisseau 4, tir 3, rocher 5, décor et tableau 6. */
const SHIP_DELAY = 4;
const BULLET_DELAY = 3;
const ROCK_DELAY = 5;
const DECOR_DELAY = 6;
const SOUND_ROCK_HIT = 3000;
const SOUND_SHIP_HIT = 3001;
const SOUND_FIRE = 3002;
const MUSIC = 30035;

/** Bords du monde (`1110:37bd` et suivants) : au-delà de 650 (490) on revient à −10, en deçà de −10 on passe à 650 (490). */
const WRAP_X = 0x28a;
const WRAP_Y = 0x1ea;
const WRAP_MIN = -10;
/** Pas d'un tir et décalage de son départ (`1110:34a3`), poussée et vitesse maximale du vaisseau (`1110:36ad`). */
const BULLET_STEP = 14;
const THRUST = 4;
const MAX_SPEED = 12;
const MAX_BULLETS = 3;
const ROCK_SLOTS = 6;
/** Vies et palier de vie supplémentaire (`1110:2f46`, `1110:3936`). */
const START_LIVES = 3;
const MAX_LIVES = 9;
const BONUS_STEP = 100;

/** Vecteur unitaire de chaque direction (0 = haut, puis dans le sens des aiguilles d'une montre), en `(dx, dy)`. */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Taille d'un rocher (`1110:3b5a`, paramètre 2) : premier script de la taille. */
export const ROCK_KINDS = {
  small: 0x3ed,
  medium: 1000,
  large: 0x3f8,
  leftRunner: 0x3fd,
  rightRunner: 0x402,
} as const;
export type RockKind = keyof typeof ROCK_KINDS;

/** Points d'un rocher touché selon son script (`1110:3936`). */
export function rockPoints(script: number): number {
  if (script >= 0x3fd) return 15;
  if (script >= 0x3f8) return 1;
  if (script >= 0x3ed) return 10;
  return 5;
}

/** Taille des morceaux d'un rocher qui éclate (`1110:31f3`) : gros → moyens, moyen → petits, sinon rien. */
export function splitKind(script: number): RockKind | null {
  if (script > 0x3f7 && script < 0x3fd) return "medium";
  if (script < 0x3ed) return "small";
  return null;
}

/** Repli d'une coordonnée dans le monde (`1110:37bd`). */
export function wrap(value: number, max: number): number {
  if (value > max) return -10;
  if (value < WRAP_MIN) return max;
  return value;
}

/** `1110:3e95` : chiffres du tableau (meilleur score sur trois chiffres, score sur trois, vies). */
export function scoreboardDigits(best: number, score: number, lives: number): number[] {
  const digits = (n: number): number[] => [Math.trunc(n / 100), Math.trunc((n % 100) / 10), n % 10];
  return [...digits(best), ...digits(score), lives];
}

/** Un objet mû par son rappel (`11a0:1013`) : échéance et délai. */
interface Mover {
  feature: Feature;
  delay: number;
  next: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Rock extends Mover {
  script: number;
  dir: number;
  /** L'explosion joue (`SCRB` 1015 par l'interpréteur normal) : la scène ne la mène plus. */
  exploding: boolean;
}

interface Bullet extends Mover {
  /** `+0x58` : pas déjà faits. */
  life: number;
}

export function createHiddenAsteroidsScene(): Scene {
  let archive: Archive;
  let features: Features;
  let zoombinis: ZoombinisGame;
  let ship: Mover | null = null;
  /** `DS:8830` : 0 vaisseau en vie, sinon image d'explosion en cours (1 à 4, puis caché). `DS:882e` direction. */
  let shipDead = 0;
  let shipDir = 0;
  const bullets: Bullet[] = [];
  /** `DS:8842` / `DS:885a` : les six places de rochers (les seuls qui heurtent). */
  const rocks: (Rock | null)[] = [];
  /** Tous les rochers dont la feature vit encore, y compris ceux qu'une relance a retirés de leur place (ils continuent leur course sans rien heurter). */
  const flying: Rock[] = [];
  /** `DS:883e` : place (1 à 6) du rocher touché en attente ; `DS:8840` : rocher qui explose (en cours), null sinon. */
  let rockHit = 0;
  let exploding: Rock | null = null;
  let explosionDone = false;
  /** `DS:8868` rochers en jeu, `DS:886a` alternance du rocher spécial, `DS:886c` rocher spécial en jeu. */
  let rockCount = 0;
  let runnerTurn = false;
  let runner: Rock | null = null;
  /** `DS:8822` score, `DS:8824` prochain palier de vie, `DS:8826` vies, `DS:882a` fin de partie affichée. */
  let score = 0;
  let nextBonus = BONUS_STEP;
  let lives = START_LIVES;
  let gameOver: Feature | null = null;
  let scoreboard: Feature;
  let fadeIn: Fade | null = null;
  let fadeOut: Fade | null = null;
  let left = false;

  function shapeOf(w: number): { width: number; height: number } | undefined {
    return features.group(0)?.images[w - 1];
  }

  /** Pose la partie unique d'un objet (`11a0:1013` après son rappel) : position moins l'ancre `REGS`, rectangle de la forme ; `w` 0 = rien. */
  function place(feature: Feature, w: number, x: number, y: number): void {
    if (w === 0) {
      feature.parts = [];
    } else {
      const anchors = features.group(0)?.anchors;
      const px = x - (anchors?.x[w] ?? 0);
      const py = y - (anchors?.y[w] ?? 0);
      feature.parts = [{ w, x: px, y: py }];
      const shape = shapeOf(w);
      if (shape) feature.rect = { left: px, top: py, right: px + shape.width, bottom: py + shape.height };
    }
    features.invalidate();
  }

  /** Crée un objet mû par son rappel : la feature lit son image 0 une fois, la scène fait le reste. */
  function createMover(script: number, delay: number): Feature {
    return features.create({ script, delay, flags: FeatureFlag.firstImage | FeatureFlag.stopEachImage });
  }

  function intersects(a: FeatureRect | null, b: FeatureRect | null): boolean {
    return !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  /** `11a8:1b89(0, 0, 0, tableau)` : le tableau relit son image. */
  function refreshScore(): void {
    features.setScript(scoreboard);
  }

  /** `1110:3e95` : rappel d'image du tableau. */
  function scoreImage(_feature: Feature, parts: FeaturePart[]): FeaturePart[] {
    const game = zoombinis.game;
    if (score > 999) score = 0;
    if (game.asteroidsHighScore < score) game.asteroidsHighScore = score;
    const base = parts[0]?.w ?? 0;
    const digits = scoreboardDigits(game.asteroidsHighScore, score, lives);
    return parts.map((part, i) => ({ ...part, w: base + (digits[i] ?? 0) }));
  }

  /** `1110:341e` : nouveau vaisseau au centre, immobile, tourné vers le haut. */
  function spawnShip(ctx: SceneContext): void {
    shipDead = 0;
    shipDir = 0;
    if (ship) features.destroy(ship.feature);
    const now = ctx.clock.ticks;
    ship = { feature: createMover(SHIP, SHIP_DELAY), delay: SHIP_DELAY, next: now, x: 0x140, y: 0xf0, vx: 0, vy: 0 };
  }

  /** `1110:3b5a(split, kind)` : un rocher dans la première place libre ; `from` : rocher qui éclate (position et direction données). */
  function spawnRock(ctx: SceneContext, kind: RockKind, from?: { x: number; y: number; dir: number }): Rock | null {
    const slot = rocks.findIndex((rock) => rock === null);
    if (slot < 0) return null;
    const rng = ctx.rng;
    const roll = rng.range(1, 10);
    let speed = roll <= 2 ? 8 : roll >= 9 ? 16 : 12;
    let dir = rng.range(0, 7);
    const script = ROCK_KINDS[kind] + rng.range(0, 4);
    if (kind === "leftRunner") [dir, speed] = [6, 20];
    if (kind === "rightRunner") [dir, speed] = [2, 20];
    let x: number;
    let y: number;
    if (!from) {
      if (dir === 0 || dir === 4) {
        x = rng.range(0x14, 0x26c);
        y = -10;
      } else {
        x = -10;
        y = rng.range(0x14, 0x1cc);
      }
    } else {
      ({ x, y, dir } = from);
    }
    const [dx, dy] = DIRECTIONS[dir]!;
    const now = ctx.clock.ticks;
    const rock: Rock = { feature: createMover(script, ROCK_DELAY), delay: ROCK_DELAY, next: now, x, y, vx: dx * speed, vy: dy * speed, script, dir, exploding: false };
    rocks[slot] = rock;
    flying.push(rock);
    rockCount += 1;
    return rock;
  }

  /** `1110:34a3` : un tir, à 14 points devant le vaisseau. */
  function fire(ctx: SceneContext): void {
    if (!ship) return;
    const [dx, dy] = DIRECTIONS[shipDir]!;
    const now = ctx.clock.ticks;
    bullets.push({
      feature: createMover(BULLET, BULLET_DELAY),
      delay: BULLET_DELAY,
      next: now,
      x: ship.x + dx * BULLET_STEP,
      y: ship.y + dy * BULLET_STEP,
      vx: dx * BULLET_STEP,
      vy: dy * BULLET_STEP,
      life: 0,
    });
  }

  /** `1110:3778` : un pas du vaisseau. */
  function stepShip(ctx: SceneContext, s: Mover): void {
    if (shipDead !== 0) {
      if (shipDead > 4) {
        place(s.feature, 0, s.x, s.y);
        return;
      }
      s.x = wrap(s.x + s.vx, WRAP_X);
      s.y = wrap(s.y + s.vy, WRAP_Y);
      place(s.feature, shipDead + 10, s.x, s.y);
      shipDead += 1;
      return;
    }
    for (let i = 0; shipDead === 0 && i < ROCK_SLOTS; i++) {
      const rock = rocks[i];
      if (!rock || !intersects(s.feature.rect, rock.feature.rect)) continue;
      shipDead = 1;
      ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND_SHIP_HIT);
      lives -= 1;
      if (lives === 0) gameOver = features.create({ script: GAME_OVER, delay: DECOR_DELAY });
      refreshScore();
    }
    s.x = wrap(s.x + s.vx, WRAP_X);
    s.y = wrap(s.y + s.vy, WRAP_Y);
    place(s.feature, shipDir + 0x11, s.x, s.y);
  }

  /** `1110:3936` : un pas d'un tir ; vrai s'il doit être retiré. */
  function stepBullet(ctx: SceneContext, b: Bullet): boolean {
    b.life += 1;
    if (b.life >= 0x10) {
      place(b.feature, 0, b.x, b.y);
      return true;
    }
    b.x = wrap(b.x + b.vx, WRAP_X);
    b.y = wrap(b.y + b.vy, WRAP_Y);
    let w = BULLET_IMAGE;
    if (b.life > 12) {
      w = b.life + 12;
      b.life += 1;
    }
    let spent = b.life > 12;
    for (let i = 0; !spent && rockHit === 0 && i < ROCK_SLOTS; i++) {
      const rock = rocks[i];
      if (!rock || !intersects(rock.feature.rect, b.feature.rect)) continue;
      b.life = 12;
      rockHit = i + 1;
      spent = true;
      ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND_ROCK_HIT);
      score += rockPoints(rock.script);
      if (nextBonus <= score) {
        nextBonus += BONUS_STEP;
        if (lives < MAX_LIVES) lives += 1;
      }
      refreshScore();
    }
    place(b.feature, w, b.x, b.y);
    return false;
  }

  function removeRock(rock: Rock): void {
    features.destroy(rock.feature);
    const index = flying.indexOf(rock);
    if (index >= 0) flying.splice(index, 1);
  }

  /** `1110:3de7` : un pas d'un rocher (aussi pendant son explosion, par le rappel d'image). */
  function moveRock(rock: Rock): void {
    rock.x = wrap(rock.x + rock.vx, WRAP_X);
    rock.y = wrap(rock.y + rock.vy, WRAP_Y);
  }

  /** `1110:317c` (deuxième partie) : un rocher touché éclate et explose ; l'explosion finie, il est retiré. */
  function breakRock(ctx: SceneContext): void {
    if (rockHit === 0) return;
    if (!exploding) {
      const slot = rockHit - 1;
      const rock = rocks[slot];
      if (rock) {
        const split = splitKind(rock.script);
        if (split) {
          const rng = ctx.rng;
          const [near, far] = rng.range(1, 100) < 0x22 ? [2, 6] : [1, 7];
          spawnRock(ctx, split, { x: rock.x, y: rock.y, dir: (rock.dir + near) & 7 });
          spawnRock(ctx, split, { x: rock.x, y: rock.y, dir: (rock.dir + far) & 7 });
          if (split === "small" && rng.range(1, 100) < 0x22) spawnRock(ctx, "small", { x: rock.x, y: rock.y, dir: (rock.dir + 4) & 7 });
        }
        // Explosion : script 1015 lu par l'interpréteur normal, le rappel d'image `1110:3de7` reste (le rocher continue sa course).
        rock.exploding = true;
        exploding = rock;
        explosionDone = false;
        rock.feature.flags = FeatureFlag.stopAtEnd;
        rock.feature.onImage = (_feature, parts) => {
          moveRock(rock);
          return parts.map((part, i) => (i === 0 ? { ...part, x: rock.x, y: rock.y } : part));
        };
        rock.feature.onEvent = (_image, n) => {
          // `1110:3f99` : fin de l'explosion.
          if (n === FEATURE_END) explosionDone = true;
        };
        rock.feature.notifyEnd = true;
        features.setScript(rock.feature, EXPLOSION);
      } else {
        rockHit = 0;
      }
      rocks[slot] = null;
      rockCount -= 1;
      if (rockCount < 1) {
        rockCount = 0;
        runnerTurn = !runnerTurn;
        if (runnerTurn) runner = spawnRock(ctx, ctx.rng.range(1, 10) < 6 ? "leftRunner" : "rightRunner");
      }
    } else if (explosionDone) {
      if (exploding === runner) {
        runnerTurn = false;
        runner = null;
      }
      removeRock(exploding);
      exploding = null;
      rockHit = 0;
    }
  }

  /** `1110:317c` : un tour. */
  function update(ctx: SceneContext): void {
    const now = ctx.clock.ticks;
    if (ship && now >= ship.next) {
      ship.next = now + ship.delay;
      stepShip(ctx, ship);
    }
    for (let i = 0; i < bullets.length; ) {
      const b = bullets[i]!;
      if (now >= b.next) {
        b.next = now + b.delay;
        if (stepBullet(ctx, b)) {
          // `DS:883a` : retiré au tour suivant par `1110:317c` (le nombre de tirs baisse alors).
          features.destroy(b.feature);
          bullets.splice(i, 1);
          continue;
        }
      }
      i += 1;
    }
    for (const rock of flying) {
      if (!rock.exploding && now >= rock.next) {
        rock.next = now + rock.delay;
        moveRock(rock);
        place(rock.feature, rock.feature.parts[0]?.w ?? 0, rock.x, rock.y);
      }
    }
    if (rockCount === 0) {
      spawnRock(ctx, "large");
      if (ctx.rng.range(1, 10) < 5) spawnRock(ctx, "large");
    }
    breakRock(ctx);
  }

  /** `1110:35ae` : touches `4`, `5`, `6`, `8` et `Espace` (jamais consommées). */
  function key(ctx: SceneContext, event: KeyEvent): void {
    if (event.ctrl && !event.alt) return;
    switch (event.key) {
      case " ":
        if (gameOver) {
          // `1110:35dc` : partie neuve. Seulement si un rocher spécial est en jeu : il est retiré et toutes les places sont vidées (les autres rochers
          // continuent leur course sans plus rien heurter, et une nouvelle vague part).
          if (runner) {
            removeRock(runner);
            rockCount = 0;
            runner = null;
            for (let i = 0; i < ROCK_SLOTS; i++) rocks[i] = null;
          }
          features.destroy(gameOver);
          gameOver = null;
          score = 0;
          lives = START_LIVES;
          nextBonus = BONUS_STEP;
          runnerTurn = false;
          refreshScore();
          spawnShip(ctx);
        } else if (shipDead !== 0) {
          spawnShip(ctx);
        }
        break;
      case "4":
        if (shipDead === 0) shipDir = (shipDir - 1) & 7;
        break;
      case "6":
        if (shipDead === 0) shipDir = (shipDir + 1) & 7;
        break;
      case "5":
        if (bullets.length < MAX_BULLETS && shipDead === 0) {
          fire(ctx);
          ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND_FIRE);
        }
        break;
      case "8":
        if (shipDead === 0 && ship) {
          const [dx, dy] = DIRECTIONS[shipDir]!;
          ship.vx = Math.min(Math.max(ship.vx + dx * THRUST, -MAX_SPEED), MAX_SPEED);
          ship.vy = Math.min(Math.max(ship.vy + dy * THRUST, -MAX_SPEED), MAX_SPEED);
        }
        break;
    }
  }

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(ARCHIVE);
    },
    enter(ctx: SceneContext) {
      zoombinis = ctx.services.get(ZOOMBINIS_GAME);
      features = ctx.services.get(FEATURES);
      zoombinis.session.screen = ScreenId.hiddenAsteroids;
      ship = null;
      shipDead = 0;
      bullets.length = 0;
      rocks.length = 0;
      for (let i = 0; i < ROCK_SLOTS; i++) rocks.push(null);
      flying.length = 0;
      rockHit = 0;
      exploding = null;
      rockCount = 0;
      runnerTurn = false;
      runner = null;
      score = 0;
      nextBonus = BONUS_STEP;
      lives = START_LIVES;
      gameOver = null;
      fadeOut = null;
      left = false;
      openScreen(ctx, archive, { background: BACKGROUND });
      features.defineGroup(0, SHEET, true);
      features.setScripts(SHEET, SCRIPTS);
      spawnShip(ctx);
      features.create({ script: PANEL, delay: DECOR_DELAY });
      scoreboard = features.create({ script: SCOREBOARD, delay: DECOR_DELAY, flags: FeatureFlag.stopAtEnd, onImage: scoreImage });
      fadeIn = fadeInScreen(ctx);
      ctx.services.get(ZOOMBINIS_SOUND).queue(MUSIC);
    },
    leave(ctx: SceneContext) {
      closeScreen(ctx);
    },
    tick(ctx: SceneContext) {
      if (fadeOut) {
        // `1110:311e` (fondu de sortie, bloquant) puis la carte.
        if (fadeOut.done && !left) {
          left = true;
          zoombinis.goTo(ctx, ScreenId.map);
        }
        return;
      }
      if (fadeIn && !fadeIn.done) return;
      fadeIn = null;
      if (ctx.services.get(DIALOG).isOpen) return;
      update(ctx);
      for (const event of ctx.input.buttonEvents) {
        // `1110:33f0` : un clic gauche n'importe où ramène à la carte.
        if (event.down && event.button === "left") {
          fadeOut = fadeOutScreen(ctx);
          return;
        }
      }
    },
    key(event, ctx: SceneContext) {
      if (fadeOut || (fadeIn && !fadeIn.done) || ctx.services.get(DIALOG).isOpen) return false;
      key(ctx, event);
      return false;
    },
  };
}

/** Image d'un tir en vol (`SCRB` 1011). */
const BULLET_IMAGE = 25;
