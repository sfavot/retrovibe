import { animate } from "../../../cinematics/player";
import type { DrasculaEngine } from "../../loop";
import { hiccup, setVisible } from "../../room-kit";
import type { Sequence } from "../../sequence";
import { Track, Verb } from "../../state";
import { Flag, Item, Tree } from "./ids";
import { updateVisible } from "./world";

/** Vitesse de `up.bin`, la pie qui fait la morte. */
const MAGPIE_FPS = 14;
/** Sursauts de l'écran quand la pie tombe. */
const MAGPIE_HICCUPS = 14;
/** Effet sonore de la chute de la pie. */
const MAGPIE_SOUND = 1;

/**
 * Pièce 22, l'arbre. Réécriture de `room_22` (engines/drascula/rooms.cpp, ScummVM). La pièce n'a pas de `update_22` : le tronc, la
 * branche coupée et la pie sont des rectangles de `roomPreUpdates` de `drascula.dat` (drapeaux 24, 26, 27).
 *
 * - la pièce de monnaie (22) sur la pie (52) : `up.bin`, la pie tombe, la branche et la clé deviennent accessibles ;
 * - la hache (11) sur la branche (140) : la branche coupée (18) ;
 * - prendre la clé (180) : refusé tant que la pie n'est pas tombée.
 *
 * Écart (hérité de ScummVM) : `updateVisible` rend la branche visible à chaque entrée dans la pièce une fois la pie tombée, même
 * quand elle est déjà coupée ; la hache n'étant jamais retirée, on peut la recouper (le rectangle de la branche coupée reste dessiné).
 */
export function* room22(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Item.Axe && objectId === Tree.Branch) {
    g.pickObject(Item.Branch);
    setVisible(g, Tree.Branch, false);
    flags[Flag.BranchCut] = 1;
  } else if (picked === Item.Coin && objectId === Tree.Magpie) {
    yield* animate(g, "up.bin", MAGPIE_FPS);
    flags[Flag.MagpieDown] = 1;
    g.updateRoom();
    g.playEffect(MAGPIE_SOUND);
    yield* hiccup(g, MAGPIE_HICCUPS);
    yield* g.finishSound();
    g.selectVerb(Verb.None);
    g.removeObject(Item.Coin);
    updateVisible(g);
    g.state.hero.track = Track.Down;
    yield* g.talk(499);
    yield* g.talk(500);
  } else if (picked === Verb.Pick && objectId === Tree.Key && flags[Flag.MagpieDown] === 0) {
    yield* g.talk(420);
  } else if (picked === Verb.Pick && objectId === Tree.Key) {
    g.pickObject(Item.Key);
    setVisible(g, Tree.Key, false);
    flags[Flag.KeyTaken] = 1;
  } else {
    return false;
  }
  return true;
}
