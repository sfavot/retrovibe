import { Verb } from "../../../../src/games/drascula/engine/state";
import { playChapter6Intro } from "../../solutions";
import { Walkthrough } from "../../walkthrough";

/**
 * Démarre le chapitre 6 avec son introduction (`animation_1_6`) et la joue comme une personne : le dialogue 11 de Drascula attend des
 * clics, d'où `settle: false` (le constructeur n'attend pas que le jeu soit au repos). Rend le `Walkthrough`, le héros ligoté sous
 * le pendule (pièce 102).
 */
export function startChapter6(choices: readonly number[] = [0, 1, 2, 3]): Walkthrough {
  const w = new Walkthrough({ chapter: 6, skip: ["1_1"], settle: false });
  playChapter6Intro(w, choices);
  return w;
}

/** Démarre le chapitre 6 sans son introduction (`animation_1_6`) : le héros est libre dans le couloir (pièce 58), tout est intact. */
export function startInCorridor(): Walkthrough {
  const w = new Walkthrough({ chapter: 6, skip: ["1_1", "1_6"] });
  w.state.flags[0] = 1;
  return w;
}

/** Va jusqu'à la taverne (pièce 60) depuis le couloir : la torche, la porte dérobée, la chambre, sa porte. */
export function startInTavern(): Walkthrough {
  const w = startInCorridor();
  w.act(Verb.Move, 103);
  w.selectVerb(Verb.None);
  w.goTo(104);
  w.goTo(108);
  if (w.room !== 60) throw new Error(`pièce ${w.room} au lieu de 60`);
  return w;
}
