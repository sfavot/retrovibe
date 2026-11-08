/**
 * Solution du groupe 4 (`docs/fotaq/specials.md` § 7, corrigée dans `docs/fotaq/specials-group-4.md`) : `GROUP_SOLUTIONS[4]` pour le
 * coordinateur. `solve` joue le passage 4a, de la chambre d'hôtel (pièce 70) jusqu'au dialogue d'Anderson dans l'avion (pièce 75,
 * groupe 5). Le passage 4c (lancement et vallée, pièces 76 et 64 à 68) a son propre départ et sa propre solution
 * (`startGroup4c`, `solveGroup4c`) : il dépend des groupes 1 à 3 (fusée, crâne). Le passage 4b (oracle, pièces 62 et 63) est du
 * groupe 3 (`ownership.ts`).
 */

import type { GroupSolution } from "../../solutions";
import type { Start, Walkthrough } from "../../walkthrough";

/** Départ : la sortie de l'introduction, la chambre d'hôtel. */
export const startGroup4: Start = { room: 70, states: { 117: 1, 158: 1 } };

/** Passage 4a : de la chambre à l'avion (étapes 1 à 32). */
export function solveGroup4(w: Walkthrough): void {
  w.settle();
  // Chambre (70) : le cordon fait apparaître la perruque, le miroir et les affiches ; la perruque, puis les deux draps.
  w.act("Use", 531);
  w.act("PickUp", 528);
  w.act("PickUp", 535);
  w.act("PickUp", 535);
  // Les draps noués, attachés au radiateur ; descente par la fenêtre dans le couloir (71).
  w.combine(51, 52);
  w.useItem(53, 541);
  w.act("Use", 541);
  w.waitForRoom(71);

  // Couloir (71) : les faux seins et la barre à mine ; le portier dans le hall (73) pour la clef.
  w.act("Move", 550);
  w.act("PickUp", 556);
  w.act("PickUp", 557);
  w.goTo(559);
  w.waitForRoom(73);
  w.act("Talk", 585);
  w.waitForChoices();
  w.chooseText("au sujet de cette clef");
  w.chooseText("emprunter");
  w.chooseText("encore au sujet");
  w.chooseText("ami de Lola");
  w.settle();
  w.act("PickUp", 581);
  w.goTo(582);
  w.waitForRoom(71);

  // La clef ouvre la porte de Lola (72) ; Lola, puis les draps attachés ramènent Joe dans la chambre (70).
  w.useItem(57, 551);
  w.goTo(551);
  w.waitForChoices();
  w.chooseText("j'ai besoin de ton aide");
  w.chooseText("Tu peux m'aider");
  w.chooseText("sortir d'ici");
  w.settle();
  w.goTo(566);
  w.waitForRoom(71);
  w.act("Use", 561);
  w.waitForRoom(70);

  // Le coffre ouvert à la barre à mine donne la serviette ; retour au couloir puis chez Lola, qui donne la robe.
  w.useItem(54, 529);
  w.act("Look", 529);
  w.act("Use", 541);
  w.waitForRoom(71);
  w.goTo(551);
  w.waitForRoom(72);
  w.act("Talk", 571);
  w.waitForRoom(71);

  // La robe (mouvement spécial 2), le hall (interlude du laboratoire, c39a) et le camion de la course (73 -> 74).
  w.verbOnItem("Use", 56);
  w.settle();
  w.goTo(559);
  w.waitForRoom(73);
  w.act("Use", 584);
  w.waitForRoom(74);

  // Course (74) : la paille devient de l'huile, le poulet ; l'huile sur Rico finit la course (C74A, 75).
  w.act("PickUp", 591);
  w.act("PickUp", 591);
  w.act("PickUp", 592);
  w.useItem(60, 588);
  // C74A finit dans l'avion (75) : le dialogue `and1.DOG` du groupe 5 attend alors un choix.
  w.until(() => w.room === 75 && w.awaitingChoice, 12_000, "le dialogue d'Anderson dans l'avion");
}

/**
 * Départ du passage 4c : la fusée pleine (gs9 = 2), le crâne pris (gs45 = 2), `c76a` jouée (gs138 = 1) ; Joe est en pièce 76 avec la
 * fusée dorsale (I23), la corne de tyranno (I17), le couteau (I3) et le masque propre (I15), des groupes 1 à 3.
 */
export const startGroup4c: Start = { room: 76, items: [23, 17, 3, 15], states: { 9: 2, 45: 2, 138: 1 } };

/** Passage 4c : le lancement (76) et la vallée (64 à 68), jusqu'à l'entrée de la pièce 69 (étapes 70 à 77). */
export function solveGroup4c(w: Walkthrough): void {
  w.settle();
  // Lancement : la fusée dorsale mène à la vallée (64).
  w.verbOnItem("Use", 23);
  w.waitForRoom(64);
  // Le passage (Faye, le gros dinosaure), la clairière, la clairière : la pièce 68 et ses branches (couteau).
  w.goTo(487);
  w.waitForRoom(65);
  w.goTo(490);
  w.waitForRoom(66);
  w.goTo(494);
  w.waitForRoom(68);
  w.useItem(3, 508);
  // Les branches au gros dinosaure (66), qui s'écarte ; le second (65) s'enfuit.
  w.goTo(509);
  w.waitForRoom(66);
  w.useItem(48, 496, "Give");
  // `c66a` rend Joe à la pièce 68 : on repasse par la 66 pour rejoindre la 65.
  w.waitForRoom(68);
  w.goTo(509);
  w.waitForRoom(66);
  w.goTo(495);
  w.waitForRoom(65);
  w.goTo(491);
  w.waitForRoom(67);
  // La corne de tyranno fait fuir le dernier dinosaure ; le passage mène à la pièce 69 (`c69z`).
  w.verbOnItem("Use", 17);
  w.settle();
  // Le passage est à l'autre bout du décor : marcher vers la droite le fait défiler.
  for (let tries = 0; tries < 4 && w.engine.horizontalScroll < 240; tries++) w.click(315, 125);
  w.goTo(502);
  w.waitForRoom(69);
}

export const group4Solution: GroupSolution = { start: startGroup4, solve: solveGroup4 };
