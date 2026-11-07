import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause } from "../../sequence";
import { Track, Verb } from "../../state";
import { checkIngredients, restoreHeroSheets, updateAnim } from "./anim-kit";
import { freezeRoom, pose } from "../../room-kit";
import { Flag, Hallway, Item } from "./ids";

/**
 * Pièce 15, le couloir des chambres. Réécriture de `room_15` et `animation_34_2` (le coup de pied dans le distributeur)
 * (engines/drascula/rooms.cpp, animation.cpp, ScummVM). Le rideau et les papiers sont dans `roomActions` ; le rectangle du premier
 * plan (`roomUpdates`) est dans `drascula.dat`.
 *
 * Le distributeur de cigarettes : deux pièces (objet 18) dedans ne donnent rien mais rendent une pièce (objet 19) et baissent le
 * drapeau 27 ; une poussée (verbe Pousser) donne alors les cigarettes (un des cinq ingrédients). Le drapeau 27 est levé au début du
 * chapitre.
 */

/** `room_15`. */
export function* room15(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (objectId !== Hallway.Machine) return false;
  const verb = g.picked;
  const flags = g.flags;
  const hero = g.state.hero;
  if (verb === Item.OneCoin && flags[Flag.MachineReady] === 0) {
    yield* g.talk(335);
  } else if (verb === Item.OneCoin && flags[Flag.MachineReady] === 1) {
    yield* g.talk(336);
    hero.track = Track.Down;
    yield* g.talk(337);
    yield* g.talkers.heroSync(g.data.text("text", 46), "46.als", "4442444244244");
    hero.track = Track.Right;
  } else if (verb === Item.TwoCoins && flags[Flag.CigarettesTaken] === 0) {
    // Le héros met les pièces : le décor et sa pose seuls, le temps du son.
    freezeRoom(g, { pre: false, hero: pose(g, g.gfx.draw3, 133, 135, 6, 0, 39, 63), post: false });
    g.playEffect(8);
    yield* g.finishSound();
    yield* g.talk(338);
    flags[Flag.MachineReady] = 0;
    g.pickObject(Item.OneCoin);
    g.removeObject(Item.TwoCoins);
    g.updateRoom();
  } else if (verb === Verb.Move && flags[Flag.MachineReady] === 0) {
    yield* kickMachine(g);
    yield* g.talk(339);
    g.pickObject(Item.Cigarettes);
    flags[Flag.CigarettesTaken] = 1;
    flags[Flag.MachineReady] = 1;
    checkIngredients(g);
  } else {
    return false;
  }
  return true;
}

/** `animation_34_2` : le héros donne un coup de pied dans le distributeur (`an34_1.alg`, `an34_2.alg`, 83 x 75 en (218, 79)). */
export function* kickMachine(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  g.state.hero.track = Track.Right;
  g.updateRoom();
  freezeRoom(g);
  gfx.loadPic("an34_1.alg", gfx.back);
  gfx.loadPic("an34_2.alg", gfx.extra);
  const frames = (sheet: typeof gfx.back, y: number) => updateAnim(g, sheet, y, 218, 79, 83, 75, 3);
  yield* frames(gfx.back, 1);
  yield* frames(gfx.back, 77);
  g.playEffect(8);
  yield* frames(gfx.extra, 1);
  yield* g.finishSound();
  yield* pause(30);
  gfx.canvas.copyBackground(gfx.extra, 1, 77, 218, 79, 83, 75);
  yield* pause(3);
  restoreHeroSheets(g, "back", "extra");
  g.updateRoom();
}
