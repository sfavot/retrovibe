import { clearScreen } from "../../../cinematics/player";
import { COMPLETE_PAL, HALF_PAL, TextColor } from "../../../render/palette";
import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { setDoor } from "../../room-kit";
import { type Sequence, delay, pause, wait } from "../../sequence";
import { Track, Verb } from "../../state";
import { Bedroom, Flag } from "./ids";

/**
 * Pièce 59, la chambre de B.J. Réécriture de `room_59`, `update_59_pre` (engines/drascula/rooms.cpp, ScummVM), de `animation_19_6`
 * (animation.cpp) et de la partie de `updateVisible` qui condamne l'armoire (objects.cpp).
 *
 * Écarts à ScummVM :
 * - `animation_19_6` (quelqu'un surgit de l'armoire quand on entre par la porte dérobée) dessine sa silhouette avant les décors de la
 *   pièce ; ici c'est le painter (`anim.wardrobe`), de la même façon ;
 * - la conversation téléphonique : le héros qui décroche est dessiné par le painter (`anim.phone`) le temps d'une image ; ScummVM le
 *   copie dans `bgSurface`, que `loadPic("tlef0.alg")` écrase tout de suite après, et pendant les échanges les décors animés de la
 *   pièce ne sont pas dessinés (`gfx.roomSprites`), comme l'original qui ne redessine que le fond (`talk_htel`, `talk_solo`).
 */

/** Images courantes dans `GameState.anim`. */
const Anim = { Wardrobe: "wardrobe", Phone: "phone" } as const;

/** Les cinq échanges de la conversation téléphonique : réplique du téléphone (`talk_htel`) puis voix de Von Braun (`VBn.als`, `textvb[n]`). */
const PHONE_CALL: readonly (readonly [phoneLine: number, vonBraunLine: number])[] = [
  [240, 58],
  [241, 59],
  [242, 60],
  [196, 61],
  [244, 62],
];

/**
 * `room_59` : parler à B.J. (51) ou la regarder. Elle est attachée au lit ; la première fois, le téléphone sonne : Von Braun explique
 * pourquoi l'alcool annule la potion. Le drapeau 11 retient que la conversation a eu lieu.
 */
export function* room59(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if ((g.picked !== Verb.Talk && g.picked !== Verb.Look) || objectId !== Bedroom.BJ) return false;
  const flags = g.flags;
  flags[Flag.BJTalking] = 1;
  try {
    yield* g.talk(259);
    yield* g.talkers.bjBed(13);
    yield* g.talk(263);
    yield* g.talkers.bjBed(14);
    yield* pause(40);
    yield* g.talk(264);
    yield* g.talkers.bjBed(15);
    yield* g.talk(265);
  } finally {
    flags[Flag.BJTalking] = 0;
  }
  if (flags[Flag.PhoneCalled] === 0) yield* phoneCall(g);
  return true;
}

/** La suite de `room_59` : le téléphone sonne, le héros décroche, la conversation avec Von Braun, puis la chambre revient. */
function* phoneCall(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const hero = s.hero;
  g.playEffect(12);
  yield* delay(40);
  yield* g.finishSound();
  yield* delay(10);
  yield* g.walkToPoint(174, 168);
  hero.track = Track.Up;
  g.updateRoom();
  yield* wait(1);
  yield* pause(40);
  g.playEffect(12);
  yield* pause(19);
  g.stopSound();

  // Le héros a décroché : une image, puis l'écran du téléphone remplace la chambre.
  hero.visible = false;
  s.anim[Anim.Phone] = 1;
  g.updateRoom();
  yield* wait(1);
  s.anim[Anim.Phone] = 0;
  hero.visible = true;
  gfx.roomSprites = false;
  try {
    clearScreen(g);
    gfx.loadPic("tlef0.alg", gfx.bg, COMPLETE_PAL);
    gfx.loadPic("tlef1.alg", gfx.draw3);
    gfx.loadPic("tlef2.alg", gfx.front);
    gfx.loadPic("tlef3.alg", gfx.back);
    for (const [phoneLine, vonBraunLine] of PHONE_CALL) {
      yield* g.talkers.phone(phoneLine);
      gfx.palette.setTextColor(TextColor.Brown);
      yield* g.talkers.solo(g.data.text("textvb", vonBraunLine), `VB${vonBraunLine}.als`);
    }
    clearScreen(g);
  } finally {
    gfx.loadPic("aux59.alg", gfx.draw3);
    gfx.loadPic(96, gfx.front, COMPLETE_PAL);
    gfx.loadPic(99, gfx.back);
    gfx.loadPic(59, gfx.bg, HALF_PAL);
    gfx.roomSprites = true;
  }
  hero.track = Track.Down;
  g.updateRoom();
  yield* g.talk(245);
  g.selectVerb(Verb.None);
  s.flags[Flag.PhoneCalled] = 1;
}

/** `updateVisible` pour la pièce 59 : l'armoire (porte vers le couloir) est condamnée, on ne revient que par la porte dérobée. */
export function updateBedroomDoors(g: DrasculaEngine): void {
  setDoor(g, Bedroom.Wardrobe, false);
}

/**
 * `animation_19_6` : en entrant dans la chambre par la porte dérobée, quelqu'un surgit de l'armoire (une silhouette de `AUX59.ALG`
 * pendant 6 pauses), puis la porte se referme (son 4).
 */
export function* wardrobeSurprise(g: DrasculaEngine): Sequence {
  const anim = g.state.anim;
  anim[Anim.Wardrobe] = 1;
  try {
    g.updateRoom();
    yield* pause(6);
  } finally {
    anim[Anim.Wardrobe] = 0;
  }
  g.updateRoom();
  g.playEffect(4);
  yield* pause(6);
  yield* g.finishSound();
}

/**
 * `update_59_pre` : quand B.J. parle (drapeau 9) sa tête est refaite par-dessus le décor ; `roomPreUpdates` (le lit, tant que le
 * drapeau 4 est bas) est appliqué avant par le rendu. S'y ajoutent la silhouette de `animation_19_6` et le héros au téléphone.
 */
export const bedroomPainter: RoomPainter = {
  pre(r, s) {
    const { screen, bg, draw3 } = r;
    const { anim, flags } = s;
    if ((anim[Anim.Wardrobe] ?? 0) === 1) screen.copyBackground(draw3, 140, 23, 161, 69, 35, 80);
    if (flags[Flag.BJTalking] === 1) {
      screen.copyBackground(bg, 65, 103, 65, 103, 49, 38);
      screen.copyRect(draw3, 1, 105, 65, 103, 49, 38);
    }
  },
  post(r, s) {
    // Le héros qui décroche : le coin de la feuille annexe où il tient le combiné.
    if ((s.anim[Anim.Phone] ?? 0) === 1) r.screen.copyRect(r.draw3, 101, 34, s.hero.x - 4, s.hero.y - 1, 37, 70);
  },
};
