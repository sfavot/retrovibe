import { drawVonBraun } from "../../../render/actors";
import type { RoomPainter } from "../../../render/renderer";
import { freezeRoom, hiccup, pose, setVisible } from "../../room-kit";
import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause, wait } from "../../sequence";
import { Track, Verb } from "../../state";
import { SCREEN_STEP_TICKS, drawRect, restoreHeroSheets, updateAnim } from "./anim-kit";
import { Anim, Flag, HERO, INGREDIENT_ITEMS, Item, Lab } from "./ids";

/**
 * Pièce 18, le laboratoire de Von Braun. Réécriture de `room_18`, `update_18_pre` et des cinématiques `animation_24_2` (lui parler),
 * `animation_23_2` (la première visite, l'épreuve des bruits, et sa suite avec les bouchons d'oreilles), `animation_14_2` et
 * `animation_25_2` (la machine qui descend du plafond et remonte), `animation_27_2` (les bouchons d'oreilles marchent : il rend
 * l'argent), `animation_29_2` (réponse du menu `OP_5`) et `animation_31_2` (la potion) (engines/drascula/rooms.cpp, animation.cpp,
 * ScummVM). La machine posée (`roomUpdates`, drapeau 24) et le premier plan sont dans `drascula.dat`.
 *
 * Écarts :
 * - l'avance du ronflement (`difference > 9`, une image de 16) est séparée du dessin : `tickLab` l'avance, `labPainter` dessine ;
 * - les boucles `animation_14_2` et `animation_25_2` n'ont aucune pause dans ScummVM (seule la vitesse d'affichage les limite) : une
 *   image toutes les 2 ticks (`SCREEN_STEP_TICKS`), à comparer au jeu d'origine ;
 * - `animation_14_2` recopie l'écran dans le décor (`memcpy(bgSurface, screenSurface)`) avant le hoquet ; `animation_23_2` s'en sert
 *   pour remettre des rectangles : `gfx.bg` est écrasé de la même manière, et rechargé (`loadPic(18, bgSurface)`) par `animation_25_2`.
 */

/** Ticks entre deux images du ronflement (`difference > 9`). */
const SNORE_TICKS = 9;
const SNORE_X = [95, 136, 95, 136, 95, 95, 95, 95, 136, 95, 95, 95, 95, 95, 95, 95];
const SNORE_Y = [18, 18, 56, 56, 94, 94, 94, 94, 94, 18, 18, 18, 18, 18, 18, 18];

/** `room_18`. */
export function* room18(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const verb = g.picked;
  const flags = g.flags;
  const hero = g.state.hero;
  const gives = INGREDIENT_ITEMS.includes(verb);
  if (verb === Verb.Talk && objectId === Lab.VonBraun && flags[Flag.WellOpen] === 0) {
    yield* wakeVonBraun(g);
  } else if (verb === Verb.Talk && objectId === Lab.VonBraun && flags[Flag.WellOpen] === 1) {
    yield* g.talk(109);
  } else if (verb === Verb.Pick && objectId === Lab.Book) {
    freezeRoom(g, { hero: pose(g, g.gfx.draw2, 44, 1, 0, 0, 41, 70) });
    yield* pause(4);
    g.pickObject(Item.Book);
    setVisible(g, Lab.Book, false);
    flags[Flag.BookTaken] = 1;
    g.updateRoom();
  } else if (objectId === Lab.VonBraun && flags[Flag.AllIngredients] === 0 && flags[Flag.BlindSpokeTwice] === 0) {
    // Les ingrédients lui sont montrés trop tôt ; tout autre verbe : rien (la pièce a répondu sans mot, `hasAnswer = 1`).
    if (gives) yield* g.talk(349);
  } else if (objectId === Lab.VonBraun && flags[Flag.AllIngredients] === 1 && flags[Flag.BlindSpokeTwice] === 1) {
    if (gives) yield* wakeVonBraun(g);
  } else if (verb === Item.Earplugs && objectId === HERO && flags[Flag.EarplugsScene] === 0) {
    hero.track = Track.Down;
    g.updateRoom();
    freezeRoom(g, { hero: pose(g, g.gfx.draw2, 1, 1, -1, 3, 42, 67) });
    yield* pause(6);
    yield* g.talk(347);
    flags[Flag.WearingEarplugs] = 1;
    g.pickObject(Item.EarWithEarplug);
    g.removeObject(Item.Earplugs);
    g.updateRoom();
  } else {
    return false;
  }
  return true;
}

/** Partie « avance » de `update_18_pre`. */
export function tickLab(g: DrasculaEngine): void {
  const s = g.state;
  if (s.room?.number !== 18 || !g.gfx.roomSprites || g.gfx.owner !== "room") return;
  if (g.ticks - s.savedTime <= SNORE_TICKS) return;
  s.anim[Anim.Snore] = ((s.anim[Anim.Snore] ?? 0) + 1) % SNORE_X.length;
  s.savedTime = g.ticks;
}

/** `update_18_pre` (avant le héros) : Von Braun endormi qui ronfle, ou debout (drapeau 21). */
export const labPainter: RoomPainter = {
  pre(r, s) {
    if (s.flags[Flag.VonBraunAwake] === 0) {
      const frame = s.anim[Anim.Snore] ?? 0;
      r.screen.copyBackground(r.draw3, 1, 69, 120, 58, 56, 61);
      r.screen.copyBackground(r.draw3, SNORE_X[frame], SNORE_Y[frame], 124, 59, 40, 37);
    } else {
      drawVonBraun(r, s);
    }
  },
};

/** Remet Von Braun endormi à sa place (fin de `animation_24_2` et d'`animation_20_2` : drapeaux 21 et 24 bas, tourné à droite, x = 120). */
export function resetVonBraun(g: DrasculaEngine): void {
  g.flags[Flag.VonBraunAwake] = 0;
  g.flags[Flag.Machine] = 0;
  g.state.vonBraun.track = 1;
  g.state.vonBraun.x = 120;
}

/**
 * `animation_24_2` : le héros réveille Von Braun (`an32_1.alg`, `an32_2.alg`, 65 x 81 en (113, 53)) et lui parle : le menu `OP_4`
 * tant que les bouchons d'oreilles n'ont pas servi, `OP_5` ensuite. Le héros ressort par la porte.
 */
export function* wakeVonBraun(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  const hero = g.state.hero;
  if (hero.x < 178) yield* g.walkToPoint(208, 136);
  hero.track = Track.Down;
  g.updateRoom();
  yield* pause(3);
  hero.track = Track.Left;
  yield* g.talk(356);

  freezeRoom(g);
  gfx.loadPic("an24.alg", gfx.front);
  gfx.loadPic("an32_1.alg", gfx.draw3);
  gfx.loadPic("an32_2.alg", gfx.back);
  yield* updateAnim(g, gfx.draw3, 1, 113, 53, 65, 81, 4, 4);
  yield* updateAnim(g, gfx.draw3, 83, 113, 53, 65, 81, 4, 4);
  yield* updateAnim(g, gfx.back, 1, 113, 53, 65, 81, 4, 4);
  let x = 0;
  for (let n = 0; n < 3; n++) {
    x++;
    gfx.canvas.copyBackground(gfx.back, x, 83, 113, 53, 65, 81);
    x += 65;
    if (n < 2) yield* pause(4);
  }
  gfx.loadPic("aux18.alg", gfx.draw3);

  g.flags[Flag.VonBraunAwake] = 1;
  yield* g.talkers.vonBraun(22, false);
  if (g.flags[Flag.EarplugsScene] === 0) yield* g.dialogs.converse(4);
  else yield* g.dialogs.converse(5);

  yield* g.exitRoom(0);
  resetVonBraun(g);
}

/** Les cadres de la machine qui descend (`animation_14_2`) ou remonte (`animation_25_2`) : le décor, la pièce, Von Braun, puis la machine à l'ordonnée `y`. */
function machineFrame(g: DrasculaEngine, y: number): void {
  const { gfx } = g;
  freezeRoom(g, {
    between: (screen) => {
      drawVonBraun(gfx, g.state, screen);
      screen.copyRect(gfx.back, 150, 6, 69, y, 158, 161);
    },
  });
}

/** `animation_14_2` : la machine (`an14_2.alg`) descend du plafond, le décor la garde (drapeau 24), le hoquet. */
export function* machineDown(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  gfx.loadPic("an14_2.alg", gfx.back);
  let l = 0;
  for (let n = -160; n <= 0; n += 5 + l) {
    machineFrame(g, n);
    yield* wait(SCREEN_STEP_TICKS);
    l++;
  }
  g.flags[Flag.Machine] = 1;
  // `memcpy(bgSurface, screenSurface, 64000)` : la dernière image devient le décor.
  gfx.bg.load(gfx.canvas.pixels);
  g.playEffect(7);
  yield* hiccup(g, 15);
  yield* g.finishSound();
  restoreHeroSheets(g, "back");
}

/** `animation_25_2` : la machine remonte ; le décor est rechargé (`18.alg`) et le drapeau 24 baisse. */
export function* machineUp(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  gfx.loadPic("an14_2.alg", gfx.back);
  gfx.loadPic(18, gfx.bg);
  g.flags[Flag.Machine] = 0;
  g.playEffect(6);
  for (let n = 0; n >= -160; n -= 8) {
    machineFrame(g, n);
    yield* wait(SCREEN_STEP_TICKS);
  }
  yield* g.finishSound();
  restoreHeroSheets(g, "back");
  g.updateRoom();
}

/** Images du héros qui subit l'épreuve sans bouchons d'oreilles (`an23.alg`, 36 x 74) : colonne et rangée de chacune. */
const JOHN_X = [1, 38, 75, 112, 75, 112, 75, 112, 149, 112, 149, 112, 149, 186, 223, 260, 1, 38, 75, 112, 149, 112, 149, 112, 149, 112, 149, 186, 223, 260, 260, 260, 260, 223];
const JOHN_Y = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 1, 1, 1, 1];
/** Avec les bouchons d'oreilles (`an23_2.alg`, 33 x 71). */
const JOHN_EARPLUGS_X = [1, 35, 69, 103, 137, 171, 205, 239, 273, 1, 35, 69, 103, 137];
const JOHN_EARPLUGS_Y = [1, 1, 1, 1, 1, 1, 1, 1, 1, 73, 73, 73, 73, 73];

/**
 * `animation_23_2` : Von Braun fait subir au héros l'épreuve des bruits (la machine descend, le héros se tord) ; la première fois
 * il prend l'argent (drapeaux 30 à 32), sinon, avec les bouchons d'oreilles, il l'a perdu et rend tout (`animation_27_2`).
 */
export function* ordeal(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  const s = g.state;
  const hero = s.hero;
  const flags = g.flags;
  const vb = s.vonBraun;
  gfx.loadPic("an24.alg", gfx.front);
  flags[Flag.VonBraunAwake] = 1;
  if (flags[Flag.MetVonBraun] === 0) {
    yield* g.talkers.vonBraun(13, true);
    yield* g.talkers.vonBraun(14, true);
    yield* pause(10);
    yield* g.talk(387);
  }
  yield* g.talkers.vonBraun(15, false);
  yield* g.talkers.placeVonBraun(42);
  vb.track = 1;
  yield* g.talkers.vonBraun(16, false);
  vb.track = 2;
  yield* g.walkToPoint(157, 147);
  yield* g.walkToPoint(131, 149);
  hero.track = Track.Left;
  yield* machineDown(g);
  if (flags[Flag.MetVonBraun] === 0) yield* g.talkers.vonBraun(17, false);
  yield* pause(8);
  vb.track = 1;
  yield* g.talkers.vonBraun(18, false);

  const plugged = flags[Flag.WearingEarplugs] === 1;
  const frame = plugged
    ? { x: hero.x + 4, y: hero.y, count: 14, width: 33, height: 71 }
    : { x: hero.x + 2, y: hero.y - 3, count: 34, width: 36, height: 74 };
  if (plugged) yield* pause(50);
  freezeRoom(g);
  gfx.loadPic(plugged ? "an23_2.alg" : "an23.alg", gfx.back);
  for (let n = 0; n < frame.count; n++) {
    const sx = plugged ? JOHN_EARPLUGS_X[n] : JOHN_X[n];
    const sy = plugged ? JOHN_EARPLUGS_Y[n] : JOHN_Y[n];
    drawRect(g, frame.x, frame.y, frame.width, frame.height, (screen, scene) => {
      screen.copyRect(gfx.bg, frame.x, frame.y, frame.x, frame.y, frame.width, frame.height);
      screen.copyRect(gfx.back, sx, sy, frame.x, frame.y, frame.width, frame.height);
      scene.post();
    });
    yield* pause(5);
  }
  restoreHeroSheets(g, "back");

  vb.track = 2;
  yield* machineUp(g);
  yield* g.talkers.placeVonBraun(99);
  if (!plugged) {
    yield* g.talkers.vonBraun(19, false);
    if (flags[Flag.MetVonBraun] === 0) {
      yield* g.talkers.vonBraun(20, false);
      // Il garde ce qu'il peut prendre : le billet, les deux pièces, la pièce.
      if (g.removeObject(Item.Money)) flags[Flag.MoneyKept] = 1;
      if (g.removeObject(Item.TwoCoins)) flags[Flag.TwoCoinsKept] = 1;
      if (g.removeObject(Item.OneCoin)) flags[Flag.OneCoinKept] = 1;
    }
    yield* g.talkers.vonBraun(21, false);
  } else {
    yield* earplugsWork(g);
  }
  flags[Flag.MetVonBraun] = 1;
  g.dialogs.breakOut = true;
}

/** `animation_27_2` : les bouchons d'oreilles ont marché ; Von Braun admet sa défaite et rend ce qu'il avait pris. */
export function* earplugsWork(g: DrasculaEngine): Sequence {
  const flags = g.flags;
  flags[Flag.EarplugsScene] = 1;
  g.selectVerb(Verb.None);
  g.removeObject(Item.EarWithEarplug);
  g.addObject(Item.Earplugs);
  yield* g.talkers.vonBraun(23, false);
  yield* g.talkers.vonBraun(24, false);
  if (flags[Flag.MoneyKept] === 1) g.addObject(Item.Money);
  if (flags[Flag.TwoCoinsKept] === 1) g.addObject(Item.TwoCoins);
  if (flags[Flag.OneCoinKept] === 1) g.addObject(Item.OneCoin);
  yield* g.talkers.vonBraun(25, false);
  yield* g.talkers.vonBraun(26, false);
}

/**
 * `animation_29_2` : la réponse « Pourquoi Drascula n'a pas pu te tuer ? » : le scénario 29 la première fois (qui lève le drapeau 33),
 * puis un rappel de la recette ; la conversation s'arrête tant qu'il manque des ingrédients.
 */
export function* recipeReminder(g: DrasculaEngine): Sequence {
  if (g.flags[Flag.BlindSpokeTwice] === 0) yield* g.dialogs.play(29);
  else yield* g.talkers.vonBraun(43, false);
  yield* g.talk(402);
  yield* g.talkers.vonBraun(42, false);
  if (g.flags[Flag.AllIngredients] === 0) {
    yield* g.talk(403);
    g.dialogs.breakOut = true;
  } else {
    yield* g.talk(386);
  }
}

/**
 * `animation_31_2` : Von Braun prépare la potion. Les cinq ingrédients sont retirés de l'inventaire et la potion (objet 20) y entre ;
 * le scénario 31 lève le drapeau 36 (le puits s'ouvre) et baisse le drapeau 38.
 */
export function* brewPotion(g: DrasculaEngine): Sequence {
  yield* g.talkers.vonBraun(44, false);
  yield* g.talkers.placeVonBraun(-50);
  yield* pause(15);
  yield* g.walkToPoint(159, 140);
  restoreHeroSheets(g, "back");
  yield* g.dialogs.play(31);
  g.selectVerb(Verb.None);
  for (const item of INGREDIENT_ITEMS) g.removeObject(item);
  g.addObject(Item.Reefer);
}
