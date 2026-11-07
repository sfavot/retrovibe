import { WALK_STEP_TICKS } from "./cadence";
import { factorAt, scaledSize } from "./perspective";
import { type Hero, STEP_X, STEP_Y, Step, Track } from "./state";

/**
 * Déplacement du héros, d'après `startWalking`, `quadrant_1..4`, `walkUp`, `walkDown`, `moveCharacters` et `increaseFrameNum`
 * (engines/drascula/actors.cpp, ScummVM), sans le dessin (vague R).
 *
 * Le héros ne suit pas de chemin : il va **en ligne droite** vers le point visé (`targetX`, `targetY` : les pieds), avec un pas
 * de 8 pixels sur l'axe dominant et la composante proportionnelle sur l'autre, et s'arrête quand il passe sur la coordonnée
 * visée de l'axe dominant. Le pas n'avance que lorsque le héros est redessiné (`updateRoom`), et au plus tous les 6 ticks.
 * Hors chapitre 2, le point de référence horizontal est le milieu du héros et sa taille suit la perspective : la taille réduite
 * calculée au dessin est appliquée au pas suivant, en gardant le coin bas droit en place (`curX += curWidth - newWidth`).
 * Au chapitre 2, la référence est le bord gauche (en allant à gauche) ou droit (à droite) et la taille est fixe.
 *
 * Fidélité : distances et pas en `float` 32 bits tronqués, comme ScummVM. Aucun garde-fou contre un point jamais atteint
 * (le héros continuerait tout droit, comme dans l'original) ; `test/drascula/engine/walk.test.ts` vérifie les trajets du jeu.
 */

export interface WalkContext {
  chapter: number;
  room: number;
  /** Facteurs de perspective de la pièce (`null` au chapitre 2). */
  factors: readonly number[] | null;
  /** Tick courant (`getTime()`). */
  now: number;
}

const f32 = Math.fround;

/** `curX + curWidth / 2` (division entière du C). */
function centerX(hero: Hero): number {
  return hero.x + Math.trunc(hero.width / 2);
}

/** Choisit le sens et l'orientation vers `targetX`, `targetY` et met le héros en marche (`startWalking`). */
export function startWalking(hero: Hero, chapter: number, now: number): void {
  hero.moving = true;
  hero.stepX = STEP_X;
  hero.stepY = STEP_Y;
  const feet = hero.y + hero.height;
  const { targetX: tx, targetY: ty } = hero;
  if (chapter === 2) {
    if (tx < hero.x && ty <= feet) quadrant(hero, chapter, "up", "left");
    else if (tx < hero.x && ty > feet) quadrant(hero, chapter, "down", "left");
    else if (tx > hero.x + hero.width && ty <= feet) quadrant(hero, chapter, "up", "right");
    else if (tx > hero.x + hero.width && ty > feet) quadrant(hero, chapter, "down", "right");
    else if (ty < feet) walkStraight(hero, Step.UpLeft, Track.Up);
    else if (ty > feet) walkStraight(hero, Step.DownRight, Track.Down);
    else hero.moving = false;
  } else {
    const center = centerX(hero);
    if (tx < center && ty <= feet) quadrant(hero, chapter, "up", "left");
    else if (tx < center && ty > feet) quadrant(hero, chapter, "down", "left");
    else if (tx > center && ty <= feet) quadrant(hero, chapter, "up", "right");
    else if (tx > center && ty > feet) quadrant(hero, chapter, "down", "right");
    else hero.moving = false;
  }
  hero.startTime = now;
}

/** `walkUp` / `walkDown` (chapitre 2) : déplacement vertical pur. */
function walkStraight(hero: Hero, direction: number, track: number): void {
  hero.direction = direction;
  hero.track = track;
  hero.stepX = 0;
}

/** `quadrant_1` (haut-gauche), `quadrant_2` (haut-droite), `quadrant_3` (bas-gauche), `quadrant_4` (bas-droite). */
function quadrant(hero: Hero, chapter: number, vertical: "up" | "down", horizontal: "left" | "right"): void {
  const feet = hero.y + hero.height;
  let dx: number;
  if (horizontal === "left") dx = chapter === 2 ? hero.x - hero.targetX : centerX(hero) - hero.targetX;
  else dx = Math.abs(chapter === 2 ? hero.x + hero.width - hero.targetX : centerX(hero) - hero.targetX);
  const dy = vertical === "up" ? feet - hero.targetY : hero.targetY - feet;
  hero.direction =
    vertical === "up" ? (horizontal === "left" ? Step.UpLeft : Step.UpRight) : horizontal === "left" ? Step.DownLeft : Step.DownRight;
  if (dx < dy) {
    hero.track = vertical === "up" ? Track.Up : Track.Down;
    hero.stepX = Math.trunc(f32(dx / f32(dy / STEP_Y)));
  } else {
    hero.track = horizontal === "left" ? Track.Left : Track.Right;
    hero.stepY = Math.trunc(f32(dy / f32(dx / STEP_X)));
  }
}

function stop(hero: Hero): void {
  hero.moving = false;
  hero.stepX = STEP_X;
  hero.stepY = STEP_Y;
}

/**
 * Le héros redessiné (`moveCharacters`) : arrivée sur l'axe dominant, taille réduite du dessin, puis pas suivant
 * (`increaseFrameNum`) s'il marche. Au chapitre 3, ScummVM ne l'appelle pas quand le drapeau 0 est levé (`updateRoom`).
 */
export function moveCharacters(hero: Hero, ctx: WalkContext): void {
  const { chapter } = ctx;
  if (hero.moving && hero.stepX === STEP_X) {
    for (let r = 0; r < hero.stepX; r++) {
      if (chapter !== 2) {
        if (hero.track === Track.Left && hero.targetX - r === centerX(hero)) stop(hero);
        if (hero.track === Track.Right && hero.targetX + r === centerX(hero)) {
          stop(hero);
          hero.x = hero.targetX - Math.trunc(hero.width / 2);
          hero.y = hero.targetY - hero.height;
        }
      } else {
        if (hero.track === Track.Left && hero.targetX - r === hero.x) stop(hero);
        if (hero.track === Track.Right && hero.targetX + r === hero.x + hero.width) {
          stop(hero);
          hero.x = hero.targetX - hero.width + 4;
          hero.y = hero.targetY - hero.height;
        }
      }
    }
  }
  if (hero.moving && hero.stepY === STEP_Y) {
    for (let r = 0; r < hero.stepY; r++) {
      const feet = hero.y + hero.height;
      if (hero.track === Track.Up && hero.targetY - r === feet) stop(hero);
      if (hero.track === Track.Down && hero.targetY + r === feet) stop(hero);
    }
  }

  if (chapter !== 2 && chapter !== 3 && !hero.visible) {
    increaseFrameNum(hero, ctx);
    return;
  }
  // Le dessin réduit (`reduce_hare_chico`) calcule la taille appliquée au pas suivant.
  if (chapter !== 2 && ctx.factors) {
    const size = scaledSize(factorAt(ctx.factors, hero.y + hero.height));
    hero.scaledWidth = size.width;
    hero.scaledHeight = size.height;
  }
  if (hero.moving) increaseFrameNum(hero, ctx);
}

/** Image et pas suivants si 6 ticks sont passés, puis taille réduite (`increaseFrameNum`). */
function increaseFrameNum(hero: Hero, ctx: WalkContext): void {
  if (ctx.now - hero.startTime >= WALK_STEP_TICKS) {
    hero.startTime = ctx.now;
    hero.frame = (hero.frame + 1) % 6;
    switch (hero.direction) {
      case Step.UpLeft:
        hero.x -= hero.stepX;
        hero.y -= hero.stepY;
        break;
      case Step.UpRight:
        hero.x += hero.stepX;
        hero.y -= hero.stepY;
        break;
      case Step.DownRight:
        hero.x += hero.stepX;
        hero.y += hero.stepY;
        break;
      case Step.DownLeft:
        hero.x -= hero.stepX;
        hero.y += hero.stepY;
        break;
    }
  }
  if (ctx.chapter !== 2) {
    hero.y += hero.height - hero.scaledHeight;
    hero.x += hero.width - hero.scaledWidth;
    hero.height = hero.scaledHeight;
    hero.width = hero.scaledWidth;
  }
  // Chapitre 5, pièce 45 (tours du château) : ScummVM ramène le héros invisible à (0, 0) (correctif du bogue n° 5903). Sa marche ne
  // peut plus atteindre son but (la taille est nulle) et ScummVM la laisse en cours jusqu'à la sortie ; rien ne la voit (héros
  // invisible, `walkToPoint` ne l'attend pas), on l'arrête donc ici pour que `hero.moving` ne reste pas vrai pour rien.
  if (ctx.chapter === 5 && ctx.room === 45) {
    hero.x = 0;
    hero.y = 0;
    hero.width = 0;
    hero.height = 0;
    stop(hero);
  }
}
