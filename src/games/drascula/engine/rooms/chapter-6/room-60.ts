import { animate } from "../../../cinematics/player";
import { placeDrascula } from "../../../render/actors";
import type { RoomPainter } from "../../../render/renderer";
import { FRAME_TICKS } from "../../cadence";
import type { DrasculaEngine } from "../../loop";
import { type Sequence } from "../../sequence";
import { Verb } from "../../state";
import { Flag, Item, Tavern } from "./ids";

/**
 * Pièce 60, la taverne : le match à la télévision, le barman, Drascula au comptoir. Réécriture de `room_60`, `update_60_pre`,
 * `update_60` (engines/drascula/rooms.cpp, ScummVM), de la partie de `updateVisible` qui place Drascula (objects.cpp) et de la partie
 * de `checkAction` qui donne la main à `room_60` avant les réponses par défaut (rooms.cpp). Les regards et les paroles qui n'ont qu'une
 * réponse (piano, tête de mort, affiche, ventilateurs) sont dans `roomActions` de `drascula.dat`.
 *
 * Écarts à ScummVM :
 * - **l'avance des animations** (`update_60_pre` les avance en les dessinant) est séparée du dessin (`rooms.md` § 4) : `tickTavern`
 *   (accroche `tick`) avance les bougies, toutes les 70 ms (`getTime() - savedTime > 6`), et fait scintiller la télévision ; le painter ne
 *   fait que dessiner. ScummVM tire le scintillement (`getRandomNumber(7) == 5` fait basculer l'écran) à chaque redessin de la pièce :
 *   ici une fois par image de la boucle principale (`FRAME_TICKS`), à comparer au jeu d'origine ;
 * - pousser le piano (`Move 112`) montre une seule image fixe (`copyBackground` + `updateScreen`), pendant le son 14 : c'est le painter
 *   (`anim.pianoShot`), le héros caché le temps du son comme dans l'original qui n'appelle pas `moveCharacters` ;
 * - l'animation de fin (`animation_9_6`) est dans `cinematics/sequences.ts` ; `room60` y enchaîne la fin du chapitre (et du jeu).
 */

/** Ticks d'écart entre deux images des bougies (`difference > 6`). */
const FRAME_DELAY = 6;

/** Images courantes dans `GameState.anim`. */
const Anim = { Candles: "candles", Television: "television", TelevisionTick: "televisionTick", PianoShot: "pianoShot" } as const;

/** `room_60`. */
export function* room60(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Move && objectId === Tavern.Piano) {
    yield* pianoMoved(g);
  } else if (picked === Verb.Talk && objectId === Tavern.Barman) {
    yield* g.talk(266);
    yield* g.talkers.bartender(1, 1);
    yield* g.dialogs.converse(12);
    g.selectVerb(Verb.None);
    g.state.pickedObject = 0;
  } else if (picked === Item.Drink && objectId === Tavern.Drascula) {
    flags[Flag.DrasculaDrank] = 1;
    g.selectVerb(Verb.None);
    g.removeObject(Item.Drink);
    yield* animate(g, "beb.bin", 10);
    g.updateRoom();
  } else if (picked === Item.Stake && objectId === Tavern.Drascula && flags[Flag.DrasculaDrank] === 1) {
    // `animation_9_6` puis la fin du jeu : le chapitre 6 est le dernier, `endChapter` rend la main à l'hôte.
    yield* g.animation("9_6");
    g.endChapter();
  } else if (picked === Item.Stake && objectId === Tavern.Drascula) {
    yield* animate(g, "cnf.bin", 14);
    g.updateRoom();
    yield* g.talk(455);
  } else {
    return false;
  }
  return true;
}

/** `Move 112` : le son 14, une image du comptoir, le barman crie (réplique 23), puis le piano est « poussé » (drapeau 7). */
function* pianoMoved(g: DrasculaEngine): Sequence {
  const s = g.state;
  const hero = s.hero;
  const visible = hero.visible;
  g.playEffect(14);
  s.anim[Anim.PianoShot] = 1;
  hero.visible = false;
  try {
    g.updateRoom();
    yield* g.finishSound();
  } finally {
    s.anim[Anim.PianoShot] = 0;
    hero.visible = visible;
  }
  yield* g.talkers.bartender(23, 1);
  s.flags[Flag.PianoMoved] = 1;
}

/** `updateVisible` pour la pièce 60 : Drascula est au comptoir, tourné vers la gauche, à (155, 69). */
export function placeDrasculaAtBar(g: DrasculaEngine): void {
  Object.assign(g.state.drascula, { track: 0, x: 155, y: 69 });
}

/** Partie « avance » de `update_60_pre` : les bougies passent à l'image suivante toutes les 70 ms, la télévision scintille. */
export function tickTavern(g: DrasculaEngine): void {
  const s = g.state;
  const { anim } = s;
  if (g.ticks - (anim[Anim.TelevisionTick] ?? 0) >= FRAME_TICKS) {
    anim[Anim.TelevisionTick] = g.ticks;
    if (g.rng.inclusive(7) === 5) anim[Anim.Television] = (anim[Anim.Television] ?? 0) === 0 ? 1 : 0;
  }
  if (g.ticks - s.savedTime > FRAME_DELAY) {
    anim[Anim.Candles] = ((anim[Anim.Candles] ?? 0) + 1) % 3;
    s.savedTime = g.ticks;
  }
}

/** `update_60_pre` (avant le héros : Drascula, bougies, télévision, le comptoir du piano) et `update_60` (Drascula devant le héros). */
export const tavernPainter: RoomPainter = {
  pre(r, s) {
    const { screen, draw3, dat } = r;
    const { anim, flags } = s;
    if (flags[Flag.DrasculaGone] === 0) placeDrascula(r, s);
    screen.copyBackground(draw3, 123, dat.candles[anim[Anim.Candles] ?? 0].y, 142, 14, 39, 13);
    if ((anim[Anim.Television] ?? 0) === 1) screen.copyBackground(draw3, 114, 158, 8, 30, 8, 23);
    if ((anim[Anim.PianoShot] ?? 0) === 1) screen.copyBackground(draw3, 164, 85, 155, 48, 113, 114);
  },
  post(r, s) {
    // Drascula passe devant le héros quand celui-ci est assez haut dans la pièce.
    if (s.hero.y - 10 < s.drascula.y && s.flags[Flag.DrasculaGone] === 0) placeDrascula(r, s);
  },
};
