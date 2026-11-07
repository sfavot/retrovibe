import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause } from "../../sequence";
import { Track, Verb } from "../../state";
import { startWalking } from "../../walk";
import { Crypt, Flag, Item } from "./ids";
import { updateVisible } from "./screen";

/**
 * Pièce 54, la crypte du squelette et de la cellule de B.J. Réécriture de `room_54` et `animation_1_5` (engines/drascula/rooms.cpp et
 * animation.cpp, ScummVM). Pas de `update_54` : le squelette qui parle (drapeau 12) et la clé dans sa main (drapeau 5) sont dans
 * `roomPreUpdates` de `drascula.dat`. B.J. n'est pas dessinée : sa voix et son visage viennent de `talkers.bj` (chapitre 5).
 *
 * Écart : dans `animation_1_5` le héros reprend sa marche pendant que B.J. parle (`startWalking` puis `talk_bj`), puis la boucle
 * `while (_characterMoved)` redessine la pièce jusqu'à son arrivée ; la même boucle est écrite ici en séquence (`pause(3)`, comme `walkToPoint`).
 */

/** `room_54` : B.J. (porte 118, menu 8), le squelette (menu 10), l'os, l'épingle sur le cadenas. */
export function* room54(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if ((picked === Verb.Talk && objectId === Crypt.Cell) || (picked === Verb.Look && objectId === Crypt.Cell && flags[Flag.BjMet] === 0)) {
    yield* meetBj(g);
  } else if (picked === Verb.Look && objectId === Crypt.Cell && flags[Flag.BjMet] === 1) {
    yield* g.talk(124);
  } else if (picked === Verb.Talk && objectId === Crypt.Skeleton && flags[Flag.SkeletonSpoke] === 0) {
    yield* g.talk(288);
    flags[Flag.SkeletonTalking] = 1;
    yield* pause(10);
    yield* g.talkers.musician(1);
    yield* g.talk(289);
    yield* g.talkers.musician(2);
    yield* g.talkers.musician(3);
    yield* g.dialogs.converse(10);
    flags[Flag.SkeletonTalking] = 0;
    flags[Flag.SkeletonSpoke] = 1;
  } else if (picked === Verb.Talk && objectId === Crypt.Skeleton) {
    yield* g.talk(109);
  } else if (picked === Verb.Pick && objectId === Crypt.Bone && flags[Flag.BoneTaken] === 0) {
    g.pickObject(Item.Bone);
    flags[Flag.BoneTaken] = 1;
    yield* g.talkers.musician(10);
    updateVisible(g);
  } else if (picked === Item.Pin && objectId === Crypt.Padlock) {
    yield* pause(4);
    yield* g.talk(436);
    g.selectVerb(Verb.None);
    g.removeObject(Item.Pin);
  } else {
    return false;
  }
  return true;
}

/**
 * `animation_1_5` : la première fois (drapeau 0 bas), le héros découvre B.J. derrière la porte (ses répliques alternent avec les siennes ;
 * il s'écarte puis revient vers la porte en l'écoutant), puis, à chaque fois, le menu 8 (clé, outil, épingle ; le scénario 3 donne l'épingle).
 */
export function* meetBj(g: DrasculaEngine): Sequence {
  const hero = g.state.hero;
  if (g.flags[Flag.BjMet] === 0) {
    yield* g.talk(430);
    yield* g.talkers.bj(16);
    yield* g.talkers.bj(17);
    yield* g.talkers.bj(18);
    yield* g.talk(217);
    yield* g.talkers.bj(19);
    yield* g.talk(229);
    yield* pause(5);
    yield* g.walkToPoint(114, 170);
    hero.track = Track.Down;
    yield* g.talk(431);
    yield* g.talkers.bj(20);
    hero.track = Track.Up;
    yield* pause(4);
    yield* g.talk(438);
    // Le héros retourne à la porte en écoutant B.J. : `_walkToObject`, `trackFinal` à droite, puis on attend son arrivée.
    hero.targetX = 120;
    hero.targetY = 157;
    hero.walkToObject = true;
    hero.trackFinal = Track.Right;
    startWalking(hero, g.chapter, g.ticks);
    yield* g.talkers.bj(21);
    for (;;) {
      g.updateRoom();
      if (!hero.moving) break;
      yield* pause(3);
    }
    hero.walkToObject = false;
    hero.track = Track.Right;
    yield* g.talk(229);
    g.flags[Flag.BjMet] = 1;
  }
  hero.track = Track.Right;
  yield* g.dialogs.converse(8);
}
