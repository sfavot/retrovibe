import { HALF_PAL } from "../../../render/palette";
import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { type Sequence, wait } from "../../../../../engine/sequence";
import { delay, pause } from "../../cadence";
import { Verb } from "../../state";
import { restoreHeroSheets, showBackground } from "./anim-kit";
import { Anim, BlindAlley, Flag, Item } from "./ids";

/**
 * Pièce 9, l'impasse de l'aveugle. Réécriture de `room_9`, `update_9_pre`, `animation_4_2` (lui parler) et `animation_6_2` (lui donner
 * l'argent : il donne sa faucille) (engines/drascula/rooms.cpp, animation.cpp, ScummVM).
 *
 * Écarts :
 * - l'avance de l'aveugle (une image toutes les 11 ticks, `difference >= 11`) est séparée du dessin : `tickBlindAlley` (accroche
 *   `tick`) l'avance, `blindAlleyPainter` ne fait que dessiner depuis `anim.blind` ;
 * - les deux cinématiques jouent dans un décor `CIEGO1.ALG` qui remplace la pièce (`clearRoom`, cinq feuilles `ciego1` à `ciego5`) :
 *   c'est l'image libre qui tient la place du décor, les répliques de l'aveugle (`talkers.blind`) lisant `bg` et les feuilles ;
 * - `_system->delayMillis(1000)` (une seconde réelle, sans le doublement de `delay`) : 100 ticks.
 */

/** Ticks entre deux images de l'aveugle (`difference >= 11`). */
const BLIND_TICKS = 11;
const BLIND_X = [26, 68, 110, 152, 194, 236, 278, 26, 68];
const BLIND_Y = [51, 51, 51, 51, 51, 51, 51, 127, 127];
/** Image où il se tient debout, immobile, pendant qu'il parle. */
const BLIND_STANDING = 3;
/** Une seconde réelle (`_system->delayMillis(1000)`). */
const ONE_SECOND_TICKS = 100;

/** `room_9` : lui parler ; lui donner l'argent (objet 7). */
export function* room09(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (objectId !== BlindAlley.Blind) return false;
  if (g.picked === Verb.Talk) {
    yield* talkToBlind(g);
  } else if (g.picked === Item.Money) {
    yield* giveMoney(g);
    g.removeObject(Item.Money);
    g.pickObject(Item.Sickle);
  } else {
    return false;
  }
  return true;
}

/** Partie « avance » de `update_9_pre`. */
export function tickBlindAlley(g: DrasculaEngine): void {
  const s = g.state;
  if (s.room?.number !== 9 || !g.gfx.roomSprites || g.gfx.owner !== "room") return;
  if (s.flags[Flag.BlindStanding] === 0) {
    if (g.ticks - s.savedTime >= BLIND_TICKS) {
      s.anim[Anim.Blind] = (s.anim[Anim.Blind] ?? 0) + 1;
      s.savedTime = g.ticks;
    }
    if (s.anim[Anim.Blind] === BLIND_X.length) s.anim[Anim.Blind] = 0;
  } else {
    s.anim[Anim.Blind] = BLIND_STANDING;
  }
}

/** `update_9_pre` (avant le héros) : l'aveugle (41 x 72 dans `AUX9.ALG`). */
export const blindAlleyPainter: RoomPainter = {
  pre(r, s) {
    const frame = s.anim[Anim.Blind] ?? 0;
    r.screen.copyRect(r.draw3, BLIND_X[frame], BLIND_Y[frame], 122, 57, 41, 72);
  },
};

/** Le décor et les cinq feuilles de la cinématique de l'aveugle (`ciego1` à `ciego5`), l'écran vidé : `clearRoom()`. */
function enterBlindScene(g: DrasculaEngine): void {
  const { gfx } = g;
  gfx.clearRoom();
  gfx.loadPic("ciego1.alg", gfx.bg, HALF_PAL);
  gfx.loadPic("ciego2.alg", gfx.draw3);
  gfx.loadPic("ciego3.alg", gfx.extra);
  gfx.loadPic("ciego4.alg", gfx.back);
  gfx.loadPic("ciego5.alg", gfx.front);
  showBackground(g);
}

/** Retour dans la pièce : musique, décor et feuilles remis, `selectVerb(kVerbNone)`. */
function leaveBlindScene(g: DrasculaEngine): void {
  const { gfx } = g;
  gfx.clearRoom();
  g.host.playMusic(g.state.roomMusic);
  gfx.loadPic(9, gfx.bg, HALF_PAL);
  gfx.loadPic(g.room.disk, gfx.draw3);
  restoreHeroSheets(g);
  g.selectVerb(Verb.None);
}

/**
 * `animation_4_2` : parler à l'aveugle. La musique s'arrête, il se tient debout (drapeau 9) ; le héros dit « C'est un aveugle… »,
 * puis la scène s'ouvre sur le décor de `CIEGO1.ALG`. Première fois : neuf répliques qui lèvent le drapeau 4 ; ensuite : une seule
 * qui lève le drapeau 33 (la recette est connue, `animation_29_2`).
 */
export function* talkToBlind(g: DrasculaEngine): Sequence {
  const flags = g.flags;
  g.host.stopMusic();
  flags[Flag.BlindStanding] = 1;
  yield* pause(12);
  yield* g.talk(60);
  yield* pause(8);

  enterBlindScene(g);
  yield* pause(10);
  yield* g.talkers.blind(1);
  yield* pause(5);
  yield* g.talkers.hacker(57);
  yield* pause(6);

  if (flags[Flag.BlindSpoke] === 0) {
    yield* g.talkers.blind(2);
    yield* pause(4);
    yield* g.talkers.hacker(58);
    yield* g.talkers.blind(3);
    yield* delay(14);
    yield* g.talkers.hacker(59);
    yield* g.talkers.blind(4);
    yield* g.talkers.hacker(60);
    yield* g.talkers.blind(5);
    yield* g.talkers.hacker(61);
    yield* g.talkers.blind(6);
    yield* g.talkers.hacker(62);
    yield* g.talkers.blind(7);
    yield* g.talkers.hacker(63);
    yield* g.talkers.blind(8);
    showBackground(g);
    yield* wait(ONE_SECOND_TICKS);
    yield* g.talkers.hacker(64);
    yield* g.talkers.blind(9);
    flags[Flag.BlindSpoke] = 1;
  } else {
    yield* wait(ONE_SECOND_TICKS);
    yield* g.talkers.blind(10);
    yield* g.talkers.hacker(65);
    flags[Flag.BlindSpokeTwice] = 1;
  }

  flags[Flag.BlindStanding] = 0;
  showBackground(g);
  yield* pause(14);
  leaveBlindScene(g);
  g.updateRoom();
}

/** `animation_6_2` : l'argent donné à l'aveugle ; il rend la faucille (l'appelant reprend l'argent et met la faucille en main). */
export function* giveMoney(g: DrasculaEngine): Sequence {
  const flags = g.flags;
  g.host.stopMusic();
  flags[Flag.BlindStanding] = 1;
  enterBlindScene(g);
  yield* pause(1);
  if (flags[Flag.BlindSpoke] === 1) yield* g.talkers.hacker(66);
  yield* pause(6);
  yield* g.talkers.blind(11);
  yield* pause(4);
  yield* g.talkers.hacker(67);
  showBackground(g);
  yield* pause(10);
  leaveBlindScene(g);
  flags[Flag.BlindStanding] = 0;
  g.updateRoom();
}
