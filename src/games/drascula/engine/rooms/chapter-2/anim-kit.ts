import type { Plane } from "../../../render/plane";
import type { DrasculaRenderer, Scene } from "../../../render/renderer";
import { LIGHT_END, LIGHT_FIRST } from "../../../render/palette";
import type { DrasculaEngine } from "../../loop";
import { type Sequence, wait } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { Flag } from "./ids";

/**
 * Aides propres au chapitre 2 pour les cinématiques de pièce : l'écran « matériel » de ScummVM (`screenSurface` sur lequel
 * `updateAnim`, `copyBackground` et `updateScreen` dessinent sans passer par la pièce) est ici l'image libre `gfx.canvas`
 * (`docs/drascula/graphics.md` § 11). Une cinématique y fige l'image de la pièce (`freezeRoom`, `room-kit.ts`), puis y recopie des rectangles de
 * feuilles (`updateAnim`) ; `g.updateRoom()` rend la main à la pièce (ScummVM : `updateRoom(); updateScreen();`).
 *
 * Écart : ScummVM n'envoie à l'écran que le rectangle d'une image (`updateScreen(x, y, x, y, w, h)`) ; le reste de l'écran garde
 * ce qu'il montrait. Le canvas fige de la même manière ce que la pièce montrait au moment du `freezeRoom`.
 */

/** Une image d'écran sans `pause` (boucles de `animation_14_2`, `animation_25_2` : `updateScreen()` seul) : 2 ticks, ~ 50 images par seconde. */
export const SCREEN_STEP_TICKS = 2;

/** Feuilles du héros : de face, de côté, de dos (`frontSurface`, `extraSurface`, `backSurface`). */
export type HeroSheet = "front" | "extra" | "back";

/**
 * Remet les feuilles du héros de la pièce (`loadPic(964, frontSurface)`, `loadPic(974, extraSurface)`, `loadPic(994, backSurface)` :
 * celles de la fiche au chapitre 2, `96`, `97` et `99` par défaut) après qu'une cinématique les a prises pour ses images. Sans
 * argument, les trois ; sinon seulement celles nommées (ce que l'original recharge, cinématique par cinématique).
 */
export function restoreHeroSheets(g: DrasculaEngine, ...which: HeroSheet[]): void {
  const { gfx } = g;
  const wanted = which.length > 0 ? which : (["front", "extra", "back"] as const);
  const hero = g.room.hero;
  const names: Record<HeroSheet, string | number> = hero
    ? { front: hero.surfaces[0], extra: hero.surfaces[1], back: hero.surfaces[3] }
    : { front: 96, extra: 97, back: 99 };
  for (const sheet of wanted) gfx.loadPic(names[sheet], gfx[sheet]);
}

/** `updateRoom(); updateScreen();` : la pièce reprend la main sur l'image et l'état se montre un tick. */
export function* refresh(g: DrasculaEngine): Sequence {
  g.updateRoom();
  yield* wait(1);
}

/** `copyBackground(); updateScreen();` : le décor nu, sans personnage ni mise à jour de la pièce. */
export function showBackground(g: DrasculaEngine): void {
  const { gfx } = g;
  gfx.canvas.copyBackground(gfx.bg, 0, 0, 0, 0, 320, 200);
  gfx.owner = "canvas";
}

/** Dessine dans l'écran « matériel » en passant par le plan `screen` du rendu, seul où `Scene` sait dessiner. */
export function drawOnCanvas(g: DrasculaEngine, draw: (screen: Plane, scene: Scene) => void): void {
  const { gfx } = g;
  gfx.screen.load(gfx.canvas.pixels);
  draw(gfx.screen, gfx.scene(g.state));
  gfx.canvas.load(gfx.screen.pixels);
  gfx.owner = "canvas";
}

/**
 * Dessine dans l'écran « matériel » mais ne garde que le rectangle (x, y, width, height) : `updateScreen(x, y, x, y, w, h)` n'envoie
 * qu'une partie de `screenSurface`, le reste de ce que `draw` a écrit (la mise à jour de la pièce, `updateRefresh`) n'atteint pas l'écran.
 */
export function drawRect(g: DrasculaEngine, x: number, y: number, width: number, height: number, draw: (screen: Plane, scene: Scene) => void): void {
  const { gfx } = g;
  gfx.screen.load(gfx.canvas.pixels);
  draw(gfx.screen, gfx.scene(g.state));
  gfx.canvas.copyBackground(gfx.screen, x, y, x, y, width, height);
  gfx.owner = "canvas";
}

/**
 * `updateAnim(y, destX, destY, width, height, count, src, delayVal, copyRectangle)` : `count` images de `src` posées l'une après
 * l'autre dans le rectangle (destX, destY, width, height) du canvas, une par `pause(delayVal)`. Les images sont dans la rangée `y`,
 * séparées d'un pixel (`x = 1, 1 + width + 1…`). `copyRectangle` : le décor est d'abord remis sous l'image (qui est alors transparente).
 */
export function* updateAnim(
  g: DrasculaEngine,
  src: Plane,
  y: number,
  destX: number,
  destY: number,
  width: number,
  height: number,
  count: number,
  delayVal = 3,
  copyRectangle = false,
): Sequence {
  const { gfx } = g;
  gfx.owner = "canvas";
  let x = 0;
  for (let n = 0; n < count; n++) {
    x++;
    if (copyRectangle) {
      gfx.canvas.copyBackground(gfx.bg, destX, destY, destX, destY, width, height);
      gfx.canvas.copyRect(src, x, y, destX, destY, width, height);
    } else {
      gfx.canvas.copyBackground(src, x, y, destX, destY, width, height);
    }
    x += width;
    yield* pause(delayVal);
  }
}

/**
 * `hipo_sin_nadie(counter)` : le hoquet sur le décor nu (personne n'est dessiné). Écart : ScummVM ne fait aucune pause entre les
 * sursauts (ils ne durent que le temps d'afficher l'écran) ; ici `pause(3)` comme `hiccup` (`room-kit.ts`), pour qu'on le voie.
 */
export function* bareHiccup(g: DrasculaEngine, counter: number): Sequence {
  const { gfx } = g;
  showBackground(g);
  let y = 0;
  let down = false;
  try {
    do {
      counter--;
      gfx.shake = { y, fromRow: 1, rows: 198 };
      y += down ? -1 : 1;
      if (y === 2) down = true;
      if (y === 0) down = false;
      yield* pause(3);
    } while (counter > 0);
  } finally {
    gfx.shake = null;
  }
  showBackground(g);
}

/** Les cinq ingrédients sont réunis : `flags[38] = 1` (test répété après chaque ramassage dans `room_4`, `room_7`, `room_8`, `room_15`, `animation_7_2`). */
export function checkIngredients(g: DrasculaEngine): void {
  const f = g.flags;
  if (f[Flag.TissuesTaken] === 1 && f[Flag.CigarettesTaken] === 1 && f[Flag.GumTaken] === 1 && f[Flag.CandleTaken] === 1 && f[Flag.LeavesTaken] === 1) {
    f[Flag.AllIngredients] = 1;
  }
}

/** `setDefaultPalette(brightPalette)` ou `(darkPalette)` : la lumière de la pièce selon la position du héros ; sans effet si elle est déjà celle-là. */
export function setLight(r: DrasculaRenderer, light: "bright" | "dark"): void {
  const target = r.palette[light];
  const game = r.palette.game;
  for (let i = LIGHT_FIRST * 3; i < LIGHT_END * 3; i++) {
    if (game[i] !== target[i]) {
      r.palette.useLight(target);
      return;
    }
  }
}
