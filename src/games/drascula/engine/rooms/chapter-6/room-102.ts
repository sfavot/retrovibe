import { animate, clearScreen } from "../../../cinematics/player";
import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import type { Sequence } from "../../sequence";
import { Track, Verb } from "../../state";
import { Corridor, Dungeon, Flag, Item } from "./ids";

/**
 * Pièce 102, le cachot où le héros est ligoté sous le pendule (`activatePendulum`, `cinematics/sequences.ts`, arme la pièce). Réécriture
 * de `room_102`, `update_102` et `animation_6_6` (engines/drascula/rooms.cpp, animation.cpp, ScummVM). Regarder le pendule (452) et
 * l'objet 101 (123) est dans `roomActions` de `drascula.dat` ; regarder le héros (308, 310) est dans le `checkAction` du chapitre
 * (`index.ts`).
 *
 * Écarts à ScummVM :
 * - **l'avance du pendule** (`update_102` l'avance en le dessinant, toutes les `getTime() - savedTime > 8`) est séparée du dessin
 *   (`rooms.md` § 4) : `tickPendulum` (accroche `tick`) change d'image toutes les 90 ms, `pendulumPainter` ne fait que dessiner ;
 * - `animation_6_6` : chaque vidéo se saute seule avec Échap (`animate`), la suite de la cinématique est toujours jouée (la pièce 58 est
 *   rechargée, les drapeaux sont posés) ;
 * - `animation_6_6` recharge la feuille du héros de face (`front`) avec `97.ALG`, la feuille de profil, après `96.ALG` : lu tel quel dans
 *   ScummVM (deux `loadPic` consécutifs dans la même surface), à confirmer sur le jeu d'origine.
 */

/** Ticks d'écart entre deux images du pendule (`difference > 8`). */
const FRAME_DELAY = 8;
/** Les 17 images du pendule : colonne dans la feuille. Les 5 premières sont dans `draw3` (`AN_P1.ALG`), les 7 suivantes dans `extra` (`AN_P2.ALG`), les autres dans `front` (`AN_P3.ALG`). */
const PENDULUM_X = [40, 96, 152, 208, 264, 40, 96, 152, 208, 208, 152, 264, 40, 96, 152, 208, 264];
const PENDULUM_FRAMES = PENDULUM_X.length;
const PENDULUM_IN_DRAW3 = 4;
const PENDULUM_IN_EXTRA = 11;

/** Image courante du pendule dans `GameState.anim`. */
const Anim = { Pendulum: "pendulum" } as const;

/**
 * `room_102` : prendre l'objet 101 met l'objet 20 en main ; l'objet 20 sur le pendule (100) coupe les liens (`animation_6_6`) ; prendre
 * ou ouvrir autre chose : les mains sont menottées (453).
 */
export function* room102(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const picked = g.picked;
  if (picked === Verb.Pick && objectId === Dungeon.Reach) {
    g.pickObject(Item.Blade);
  } else if (picked === Item.Blade && objectId === Dungeon.Pendulum) {
    yield* g.animation("6_6");
  } else if (picked === Verb.Pick || picked === Verb.Open) {
    yield* g.talk(453);
  } else {
    return false;
  }
  return true;
}

/**
 * `animation_6_6` : la lame coupe les liens (`RCT.BIN`), le héros tombe dans le couloir (pièce 58, par la porte dérobée) et se relève
 * (`HBP.BIN`). Igor et Drascula ont disparu du couloir (drapeau 2), le héros est libre (drapeau 0) et le pendule ne le menace plus
 * (drapeau 1).
 */
export function* freeFromPendulum(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const hero = s.hero;
  yield* animate(g, "rct.bin", 11);
  clearScreen(g);
  g.selectVerb(Verb.None);
  g.removeObject(Item.Blade);
  gfx.loadPic(96, gfx.front);
  gfx.loadPic(97, gfx.front);
  gfx.loadPic(97, gfx.extra);
  gfx.loadPic(99, gfx.back);
  g.doBreak = true;
  s.objExit = Corridor.SecretDoor;
  hero.x = -1;
  g.selectVerb(Verb.None);
  yield* g.enterRoom(58);
  hero.visible = true;
  hero.track = Track.Right;
  yield* animate(g, "hbp.bin", 14);
  hero.track = Track.Down;
  s.flags[Flag.Free] = 1;
  s.flags[Flag.Pendulum] = 0;
  s.flags[Flag.CorridorEmpty] = 1;
  g.updateRoom();
}

/** Partie « avance » de `update_102` : le pendule passe à l'image suivante toutes les 90 ms (17 images, puis retour à la première). */
export function tickPendulum(g: DrasculaEngine): void {
  const s = g.state;
  if (g.ticks - s.savedTime <= FRAME_DELAY) return;
  s.anim[Anim.Pendulum] = ((s.anim[Anim.Pendulum] ?? 0) + 1) % PENDULUM_FRAMES;
  s.savedTime = g.ticks;
}

/**
 * `update_102` : le pendule (55 x 125 en haut de l'écran), puis le héros ligoté en bas : le drapeau 1 à 2 (pas encore parlé) ou à 0
 * (après sa première réplique, tête reposée) ; pendant une réplique (drapeau 1 à 1) c'est la tête qui parle (`talk_pen`) qui est dessinée.
 */
export const pendulumPainter: RoomPainter = {
  post(r, s) {
    const { screen, draw3, extra, front } = r;
    const frame = s.anim[Anim.Pendulum] ?? 0;
    const sheet = frame <= PENDULUM_IN_DRAW3 ? draw3 : frame <= PENDULUM_IN_EXTRA ? extra : front;
    screen.copyBackground(sheet, PENDULUM_X[frame], 19, 152, 0, 55, 125);
    if (s.flags[Flag.Pendulum] === 2) screen.copyRect(draw3, 18, 145, 145, 105, 25, 29);
    if (s.flags[Flag.Pendulum] === 0) screen.copyRect(draw3, 44, 145, 145, 105, 25, 29);
  },
};
