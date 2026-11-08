import type { DrasculaEngine } from "../../loop";
import type { RoomPainter } from "../../../render/renderer";
import { toggleDoor } from "../../room-kit";
import { type Sequence } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { Track, Verb } from "../../state";
import { Anim, DoorIndex, Flag, Item, Study } from "./ids";

/** Réplique du héros qui trouve un pieu dans l'armoire (`talk(425)`). */
const STAKE_SPEECH = 425;
/** Colonne et rangée de chaque image de l'étagère qui pivote dans `an_8.alg` (`bookcaseX`, `bookcaseY`). */
const BOOKCASE_X = [1, 75, 149, 223, 1, 75, 149, 223, 149, 223, 149, 223, 149, 223];
const BOOKCASE_Y = [1, 1, 1, 1, 74, 74, 74, 74, 74, 74, 74, 74, 74, 74];

/**
 * Pièce 34, le bureau. Réécriture de `room_34` et `animation_8_4` (engines/drascula/rooms.cpp, animation.cpp, ScummVM).
 *
 * - pousser la torche (146) : l'étagère pivote (`animation_8_4`, quatorze images de `an_8.alg`) et s'ouvre sur le labyrinthe de
 *   couloirs (pièce 36), drapeau 7 ;
 * - l'armoire (120, drapeau 8) s'ouvre et se ferme ; ouverte pour la première fois elle donne un pieu (14, drapeau 25).
 *
 * Écarts :
 * - `animation_8_4` charge `an_8.alg` dans la feuille « de face » (`frontSurface`) et n'en copie que des zones sur l'écran ; le héros
 *   étant dessiné à chaque image depuis cette feuille, ici `an_8.alg` est chargée dans la feuille du chapitre (`draw2`, libre au
 *   chapitre 4) et l'image de l'étagère est dessinée par `bookcasePainter` (`anim.bookcase`) ;
 * - `room_34` passe l'index 2 à `toggleDoor` pour l'armoire (index 1), coquille de ScummVM reprise (`ids.ts`).
 */
export function* room34(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Move && objectId === Study.Torch) {
    yield* bookcaseTurns(g);
  } else if (picked === Verb.Open && objectId === Study.Wardrobe && flags[Flag.StakeTaken] === 1) {
    yield* toggleDoor(g, Flag.StudyWardrobe, DoorIndex.StudyWardrobe, "open");
  } else if (picked === Verb.Open && objectId === Study.Wardrobe) {
    yield* toggleDoor(g, Flag.StudyWardrobe, DoorIndex.StudyWardrobe, "open");
    g.state.hero.track = Track.Down;
    yield* g.talk(STAKE_SPEECH);
    g.pickObject(Item.Stake);
    flags[Flag.StakeTaken] = 1;
  } else if (picked === Verb.Close && objectId === Study.Wardrobe) {
    yield* toggleDoor(g, Flag.StudyWardrobe, DoorIndex.StudyWardrobe, "close");
  } else {
    return false;
  }
  return true;
}

/** `animation_8_4` : quatorze images de l'étagère (deux pauses chacune), puis elle reste ouverte (drapeau 7). */
export function* bookcaseTurns(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const anim = g.state.anim;
  gfx.loadPic("an_8.alg", gfx.draw2);
  try {
    for (let frame = 1; frame <= BOOKCASE_X.length; frame++) {
      yield* pause(2);
      anim[Anim.Bookcase] = frame;
    }
  } finally {
    anim[Anim.Bookcase] = 0;
  }
  yield* toggleDoor(g, Flag.Bookcase, DoorIndex.StudyBookcase, "open");
}

/** `animation_8_4`, l'image courante de l'étagère, par-dessus la pièce et le héros (comme la copie directe sur l'écran). */
export const studyPainter: RoomPainter = {
  post(r, s) {
    const frame = s.anim[Anim.Bookcase] ?? 0;
    if (frame > 0) r.screen.copyBackground(r.draw2, BOOKCASE_X[frame - 1], BOOKCASE_Y[frame - 1], 77, 45, 73, 72);
  },
};
