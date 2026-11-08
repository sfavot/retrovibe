/**
 * Joe, le héros (`docs/fotaq/engine.md`, § 11) : banques de ses tenues, bob 0, orientation et geste de saisie. Réécriture de
 * `Logic::loadJoeBanks`, `setupJoe`, de la fin de `setupJoeInRoom`, de `joeFace` et `joeGrab` (engines/queen/logic.cpp, ScummVM).
 *
 * Images de Joe dans la table : 11 à 30 les marches (gauche / droite 11 à 18, de face 19 à 24, de dos 25 à 30), 31 l'image affichée
 * debout ou en train de saisir, 35 à 37 les poses debout de profil, de face et de dos. L'état de Joe (`g.state.joe` : position
 * des pieds, orientations, échelle) est la source des autres modules ; le bob 0 le reflète (`Stage.frame` recopie la position du
 * bob).
 *
 * Écart : ScummVM règle l'échelle de Joe (`joeScale`) au fil de la marche ; ici `g.state.joe.scale` est recopiée du bob à chaque
 * image (voir `walk.ts`).
 */

import type { Sequence } from "../../../engine/sequence";
import type { Bobs } from "./bobs";
import type { FotaqEngine } from "./loop";
import { Direction, Grab, Room } from "./state";
import { Outfit } from "./services";

/** Emplacements de banques de Joe : marches (déchargée aussitôt), poses debout. */
const ANIM_SLOT = 13;
const STAND_SLOT = 7;
/** Image de Joe affichée dans la table, et poses debout (profil, face, dos). */
export const JOE_FRAME = 31;
const STAND_FRAMES = [35, 36, 37];
/** Pièce où Joe est vu de dos en grand : banque `JOE_E.ACT`. */
const ROOM_108_BANK = "JOE_E.ACT";

/** Banques d'une tenue : marches et poses debout (`joeUseClothes`, `joeUseDress`, `joeUseUnderwear`). */
const OUTFIT_BANKS: Record<Outfit, [string, string]> = {
  [Outfit.Normal]: ["JOE_A.BBK", "JOE_B.BBK"],
  [Outfit.Underwear]: ["JOEU_A.BBK", "JOEU_B.BBK"],
  [Outfit.Dress]: ["JOED_A.BBK", "JOED_B.BBK"],
};

export class Joe {
  constructor(private readonly bobs: Bobs) {
    this.loadBanks(Outfit.Normal);
  }

  /** Bob de Joe. */
  get bob() {
    return this.bobs.bob(0);
  }

  /** Images de marche (11 à 30) et poses debout (35 à 37) de la tenue (`Logic::loadJoeBanks`). */
  loadBanks(outfit: Outfit): void {
    const [anim, stand] = OUTFIT_BANKS[outfit];
    const frames = this.bobs.frames;
    frames.load(anim, ANIM_SLOT);
    for (let i = 11; i < 31; i++) frames.unpack(i - 10, i, ANIM_SLOT);
    frames.close(ANIM_SLOT);
    frames.load(stand, STAND_SLOT);
    frames.unpack(1, 35, STAND_SLOT);
    frames.unpack(3, 36, STAND_SLOT);
    frames.unpack(5, 37, STAND_SLOT);
    // L'image de Joe (`JOE_FRAME`) est posée une fois pour toutes (entrée dans la pièce, `face`, `grab`) : sans ce renvoi vers la
    // banque de la nouvelle tenue, Joe garderait l'ancienne jusqu'à sa prochaine pose.
    const current = frames.frame(JOE_FRAME);
    if (current && Object.values(OUTFIT_BANKS).some(([, bank]) => bank === current.bank)) this.pose(current.image);
  }

  /**
   * Fin de `setupJoeInRoom` : le bob de Joe est posé à `g.state.joe` (position, échelle). Pièce 108 : banque `JOE_E.ACT`, caméra
   * libre et défilement de 320.
   */
  place(g: FotaqEngine): void {
    const joe = g.state.joe;
    const bob = this.bob;
    bob.scale = joe.scale;
    if (g.state.room === Room.Room108) {
      this.bobs.cameraBob = -1;
      this.bobs.frames.load(ROOM_108_BANK, STAND_SLOT);
      g.horizontalScroll = 320;
    }
    if (g.state.room === Room.Room108) this.pose(1);
    bob.curPos(joe.x, joe.y);
    bob.frameNum = JOE_FRAME;
  }

  /** Met l'image `image` de la banque debout dans l'image de Joe. */
  private pose(image: number): void {
    this.bobs.frames.unpack(image, JOE_FRAME, STAND_SLOT);
  }

  /**
   * Joe se tourne vers `joe.facing` (`Logic::joeFace`) : en passant par la pose de profil quand il se retourne (de face à dos, de
   * gauche à droite), une image par pose. `prevFacing` suit. Pièce 108 : image fixe.
   */
  *face(g: FotaqEngine): Sequence {
    const joe = g.state.joe;
    const bob = this.bob;
    if (g.state.room === Room.Room108) {
      bob.frameNum = JOE_FRAME;
      this.pose(1);
      return;
    }
    let frame = STAND_FRAMES[0];
    if (joe.facing === Direction.Front) {
      if (joe.prevFacing === Direction.Back) {
        bob.frameNum = STAND_FRAMES[0];
        yield* g.update();
      }
      frame = STAND_FRAMES[1];
    } else if (joe.facing === Direction.Back) {
      if (joe.prevFacing === Direction.Front) {
        bob.frameNum = STAND_FRAMES[0];
        yield* g.update();
      }
      frame = STAND_FRAMES[2];
    } else if (
      (joe.facing === Direction.Left && joe.prevFacing === Direction.Right) ||
      (joe.facing === Direction.Right && joe.prevFacing === Direction.Left)
    ) {
      bob.frameNum = STAND_FRAMES[1];
      yield* g.update();
    }
    bob.frameNum = frame;
    bob.scale = joe.scale;
    bob.xflip = joe.facing === Direction.Left;
    yield* g.update();
    joe.prevFacing = joe.facing;
    this.pose(STAND_FRAMES.indexOf(frame) * 2 + 1);
    bob.frameNum = JOE_FRAME;
  }

  /** Geste de saisie (`Logic::joeGrab`) : une image par pose, la saisie vers le bas dure trois images. */
  *grab(g: FotaqEngine, grab: Grab): Sequence {
    const joe = g.state.joe;
    const facing = joe.facing;
    const show = (image: number) => {
      this.pose(image);
      this.bob.xflip = facing === Direction.Left;
      this.bob.scale = joe.scale;
    };
    let frame = 0;
    switch (grab) {
      case Grab.Mid:
        frame = facing === Direction.Back ? 6 : facing === Direction.Front ? 4 : 2;
        break;
      case Grab.Down:
        frame = facing === Direction.Back ? 9 : 8;
        break;
      case Grab.Up:
        // Il se tourne, lève le bras, puis revient.
        show(5);
        yield* g.update();
        show(7);
        yield* g.update();
        frame = 7;
        break;
      default:
        break;
    }
    if (frame === 0) return;
    show(frame);
    yield* g.update();
    if (grab === Grab.Down) {
      yield* g.update();
      yield* g.update();
    }
  }
}
