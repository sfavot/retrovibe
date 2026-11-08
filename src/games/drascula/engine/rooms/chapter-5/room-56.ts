import type { DrasculaEngine } from "../../loop";
import { type Sequence } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { Track, Verb } from "../../state";
import { CoffinRoom, Flag } from "./ids";

/**
 * Pièce 56, la chambre du cercueil : on n'y arrive que par la porte du couloir 57 (`animation_12_5` y envoie le héros). Réécriture de
 * `room_56` et `animation_14_5` (engines/drascula/rooms.cpp et animation.cpp, ScummVM). Pas de `update_56` : le cercueil ouvert
 * (drapeau 11) et la porte de l'horloge (drapeau 10) sont dans `roomPreUpdates` de `drascula.dat`.
 *
 * `room_56` rend vrai quand il a lancé la cinématique, ce qui finit le chapitre dans ScummVM (`checkAction` rend vrai jusqu'à
 * `runCurrentChapter`) : `g.endChapter()`. Écart : ScummVM appelle `room(56, …)` avant la table de la pièce et, si rien ne répond,
 * la rappelle ; une ligne de `roomActions` de la pièce (regarder le cercueil, 450) y serait donc dite deux fois. Ici une fois (sûrement un oubli
 * de l'original, à confirmer sous ScummVM).
 */

/** `room_56` : ouvrir le cercueil. */
export function* room56(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked !== Verb.Open || objectId !== CoffinRoom.Coffin) return false;
  yield* coffinOpened(g);
  return true;
}

/**
 * `animation_14_5` : le cercueil s'ouvre (son 3), il est vide, le héros va à l'horloge dont la porte s'ouvre (son 7), et la voix de
 * Drascula lui annonce le pendule (`textd[18]`, `d18.als`) ; fondu au noir, le chapitre 6 commence.
 */
export function* coffinOpened(g: DrasculaEngine): Sequence {
  const s = g.state;
  const hero = s.hero;
  s.flags[Flag.CoffinOpen] = 1;
  g.playEffect(3);
  g.updateRoom();
  yield* g.finishSound();
  yield* pause(17);
  hero.track = Track.Down;
  yield* g.talk(246);
  yield* g.walkToPoint(89, 160);
  s.flags[Flag.ClockOpen] = 1;
  g.playEffect(7);
  g.updateRoom();
  yield* g.finishSound();
  yield* pause(14);
  hero.track = Track.Down;
  g.updateRoom();
  yield* g.talkers.solo(g.data.text("textd", 18), "d18.als");
  yield* g.fadeToBlack(1);
  g.endChapter();
}
