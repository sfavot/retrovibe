/**
 * Solution du groupe 1 (jungle et Amazones), jouée à la souris par le joueur scripté : `docs/fotaq/specials.md` § 7, passages 1a à 1c
 * (`group1Solution`, de l'écran du crash à la cachette des Amazones) et 1d (`returnToAmazons`, à jouer après le groupe 2), corrigés par
 * `docs/fotaq/specials-group-1.md` (ce qui diffère de la solution du § 7 y est noté).
 */

import type { GroupSolution } from "../../solutions";
import type { Start, Walkthrough } from "../../walkthrough";

/** Objets d'inventaire (`Item`, annexe du § 7). */
export const Item = {
  Clothes: 58,
  Knife: 3,
  Lighter: 40,
  ComicCoupon: 98,
  Sausages: 5,
  Propeller: 6,
  Banana: 7,
  Vine: 8,
  SlothHair: 9,
  Comic: 10,
  Flower: 11,
  Beetle: 12,
  Orchid: 13,
  Dictionary: 14,
  Perfume: 16,
  Horn: 17,
  Lotion: 18,
  Record: 19,
  Vacuum: 20,
  Net: 21,
  Money: 24,
  Scissors: 76,
  Coconut: 80,
  File: 93,
  Plans: 94,
  Doll: 95,
  TornPage: 99,
} as const;

/** Départ : le site du crash, Joe sort de l'avion par la porte de la pièce 1, la tenue normale (`C75B`, groupe 5). */
export const startGroup1: Start = { entryObject: 6, items: [Item.Clothes] };

/** Passage 1a : le site du crash (pièces 1 à 6), jusqu'au piton. */
function crashSite(w: Walkthrough): void {
  w.settle();
  w.act("Open", 1);
  w.act("Look", 1);
  w.act("Look", 5);
  w.act("Talk", 2);
  w.waitForChoices();
  w.chooseText("stock de vivres");
  w.chooseText("saucisses");
  w.chooseText("sous-produits");
  w.chooseText("ne bouge pas");
  w.settle();
  w.act("Open", 6);
  w.goTo(6);
  w.waitForRoom(2);
  w.useItem(Item.Sausages, 10, "Give");
  w.act("PickUp", 12);
  w.useItem(Item.Knife, 7);
  w.useItem(Item.Propeller, 9);
  w.waitForRoom(3);
  // La liane de la pièce 5 sert de corde au pont de la pièce 4 (sans elle, Joe s'arrête devant le pont : zone éteinte), puis la banane.
  w.goTo(21);
  w.waitForRoom(4);
  w.goTo(27);
  w.waitForRoom(3);
  w.goTo(22);
  w.waitForRoom(5);
  w.useItem(Item.Knife, 35);
  w.goTo(34);
  w.waitForRoom(3);
  w.goTo(21);
  w.waitForRoom(4);
  w.useItem(Item.Vine, 28);
  w.act("PickUp", 26);
  w.goTo(27);
  w.waitForRoom(3);
  w.goTo(22);
  w.waitForRoom(5);
  w.goTo(36);
  w.waitForRoom(6);
  w.act("Talk", 37);
  w.waitForChoices();
  w.chooseText("ne parle pas le SINGE");
  w.chooseText("bien un gorille");
  w.chooseText("venaient d'Afrique");
  w.chooseText("très loin de l'Afrique");
  w.settle();
  w.toPinnacle(39);
}

/** Passage 1b : la fleur, Bob le Marchand (pièces 20 et 21) et la jungle jusqu'à Bud et Skip (pièce 9). */
function jungleStart(w: Walkthrough): void {
  w.fromPinnacle(41, 22);
  w.act("PickUp", 168);
  w.toPinnacle(165);
  w.fromPinnacle(47, 20);
  w.goTo(147);
  w.waitForChoices();
  // bob5.DOG : Bob demande de l'aide ; trois choix suffisent pour finir le dialogue.
  w.chooseText("Pourquoi avez-vous besoin");
  w.chooseText("D'accord, je vous aiderai");
  w.chooseText("pensez-vous");
  w.chooseText("Bon, maintenant que je connais");
  w.settle();
  // Bob : les saucisses contre de l'argent, puis l'aspirateur contre cet argent.
  w.useItem(Item.Sausages, 161, "Give");
  w.act("PickUp", 148);
  w.goTo(149);
  w.waitForRoom(20);
  w.toPinnacle(135);
  // La jungle : la pièce 10, la 8 et la 9 (Bud et Skip).
  w.fromPinnacle(43, 10);
  w.goTo(62);
  w.waitForRoom(8);
  w.goTo(55);
  w.waitForRoom(9);
}

/** Passage 1b, Bud et Skip (pièce 9) : la B.D, la page déchirée et les plans de la fusée. */
function budAndSkip(w: Walkthrough): void {
  w.act("Talk", 57);
  w.waitForChoices();
  w.chooseText("Vous lisez quelle");
  w.chooseText("adore les B.D");
  w.chooseText("Qu'est-ce que vous avez découvert");
  w.chooseText("tous les numéros");
  w.chooseText("pègre de Chicago");
  w.chooseText("short est vraiment");
  w.settle();
  w.act("Talk", 56);
  w.waitForChoices();
  w.chooseText("il fait vraiment chaud");
  w.settle();
  // La B.D livre la page déchirée, qui complète le coupon : les plans de la fusée.
  w.verbOnItem("Look", Item.Comic);
  w.settle();
  w.combine(Item.ComicCoupon, Item.TornPage);
  w.verbOnItem("Look", Item.Plans);
  w.settle();
}

/** Passage 1b, le second gorille (pièce 14) et la mission (pièce 13). */
function secondGorilla(w: Walkthrough): void {
  w.goTo(59);
  w.waitForRoom(11);
  w.goTo(69);
  w.waitForRoom(14);
  w.act("Talk", 86);
  w.waitForChoices();
  w.chooseText("déguisement");
  w.chooseText("qui parle");
  w.chooseText("Je sais qui vous êtes");
  w.chooseText("Vous êtes un singe");
  w.settle();
  w.act("Talk", 86);
  w.waitForChoices();
  w.chooseText("Comment avez-vous fait pour disparaître");
  w.chooseText("Si je vous dis encore");
  w.chooseText("vous n'existez pas!");
  w.settle();
}

/** Passage 1b, la mission (pièce 13) : Mary-Lou, le singe et la noix de coco, puis l'orchidée aux guêpes (pièce 12). */
function mission(w: Walkthrough): void {
  w.goTo(88);
  w.waitForRoom(13);
  w.act("Talk", 82);
  w.waitForChoices();
  w.chooseText("Pourquoi avez-vous installé une mission");
  w.chooseText("Pourquoi sont-ils partis");
  w.chooseText("Je serais resté pour le rappel");
  w.chooseText("Comment faisiez-vous pour parler");
  w.chooseText("Puis-je voir ce dictionnaire");
  w.chooseText("Merci pour ces renseignements");
  w.settle();
  w.useItem(Item.Banana, 80, "Give");
  w.combine(Item.Knife, Item.Coconut);
  w.goTo(77);
  w.waitForRoom(14);
  w.goTo(90);
  w.waitForRoom(15);
  w.goTo(96);
  w.waitForRoom(12);
  w.useItem(Item.Vacuum, 72);
  w.act("PickUp", 72);
}

/** Passage 1b, le retour chez Bob (pièce 21) : l'orchidée contre l'épuisette. */
function backToBob(w: Walkthrough): void {
  w.goTo(76);
  w.waitForRoom(15);
  w.goTo(95);
  w.waitForRoom(14);
  w.goTo(87);
  w.waitForRoom(11);
  w.goTo(66);
  w.waitForRoom(10);
  w.toPinnacle(60);
  w.fromPinnacle(47, 20);
  w.goTo(147);
  w.waitForRoom(21);
  w.useItem(Item.Orchid, 161, "Give");
  w.act("PickUp", 163);
}

/** Passage 1b, le scarabée (pièce 11) et le crash (pièce 3) : l'épuisette prend le scarabée puis le parfum ; la B.D contre la lime. */
function beetleAndPerfume(w: Walkthrough): void {
  w.goTo(149);
  w.waitForRoom(20);
  w.toPinnacle(135);
  w.fromPinnacle(43, 10);
  w.goTo(63);
  w.waitForRoom(11);
  w.useItem(Item.Net, 65);
  w.goTo(66);
  w.waitForRoom(10);
  w.toPinnacle(60);
  w.fromPinnacle(42, 6);
  w.goTo(38);
  w.waitForRoom(5);
  w.goTo(34);
  w.waitForRoom(3);
  w.useItem(Item.Net, 18);
  w.useItem(Item.Comic, 23, "Give");
}

/** Passage 1b, Naomi (pièce 21) : le parfum contre les ciseaux. */
function naomi(w: Walkthrough): void {
  w.goTo(22);
  w.waitForRoom(5);
  w.goTo(36);
  w.waitForRoom(6);
  w.toPinnacle(39);
  w.fromPinnacle(47, 20);
  w.goTo(147);
  w.waitForRoom(21);
  w.act("Talk", 162);
  w.waitForChoices();
  w.chooseText("A quoi sert le fauteuil");
  w.chooseText("Vous pourriez me couper");
  w.chooseText("Pourquoi êtes-vous anxieuse");
  w.chooseText("Je vais jeter un coup");
  w.settle();
  w.useItem(Item.Perfume, 162, "Give");
}

/** Passage 1b, du village à la mission (pièce 13) : la lime contre le dictionnaire. */
function dictionary(w: Walkthrough): void {
  w.goTo(149);
  w.waitForRoom(20);
  w.toPinnacle(135);
  w.fromPinnacle(43, 10);
  w.goTo(63);
  w.waitForRoom(11);
  w.goTo(69);
  w.waitForRoom(14);
  w.goTo(88);
  w.waitForRoom(13);
  w.useItem(Item.File, 82, "Give");
}

/** Passage 1b, le paresseux (pièce 8) : la fleur l'attire, les ciseaux lui coupent des poils. */
function sloth(w: Walkthrough): void {
  w.goTo(77);
  w.waitForRoom(14);
  w.goTo(87);
  w.waitForRoom(11);
  w.goTo(66);
  w.waitForRoom(10);
  w.goTo(62);
  w.waitForRoom(8);
  w.useItem(Item.Flower, 53, "Give");
  w.useItem(Item.Scissors, 51);
}

/** Passage 1b, la sorcière du village (pièce 20) : trois ingrédients contre la lotion. */
function witch(w: Walkthrough): void {
  w.goTo(52);
  w.waitForRoom(10);
  w.toPinnacle(60);
  w.fromPinnacle(47, 20);
  w.act("Talk", 142);
  w.waitForChoices();
  w.chooseText("Qu'est-ce que vous êtes en train");
  w.chooseText("Pourriez-vous me fabriquer");
  w.chooseText("Merci pour ces informations");
  w.chooseText("C'était un plaisir");
  w.settle();
  w.useItem(Item.SlothHair, 142, "Give");
  w.useItem(Item.Coconut, 142, "Give");
  w.useItem(Item.Vacuum, 142, "Give");
}

/** Passage 1b, Bud (pièce 9) : la lotion contre de l'argent, puis le disque de Bob (pièce 21). */
function lotionAndRecord(w: Walkthrough): void {
  w.toPinnacle(135);
  w.fromPinnacle(43, 10);
  w.goTo(62);
  w.waitForRoom(8);
  w.goTo(55);
  w.waitForRoom(9);
  w.useItem(Item.Lotion, 56, "Give");
  w.goTo(58);
  w.waitForRoom(8);
  w.goTo(52);
  w.waitForRoom(10);
  w.toPinnacle(60);
  w.fromPinnacle(47, 20);
  w.goTo(147);
  w.waitForRoom(21);
  w.act("PickUp", 152);
}

/** Passage 1c : la forteresse des Amazones (pièces 16 à 19). */
function amazons(w: Walkthrough): void {
  w.goTo(149);
  w.waitForRoom(20);
  w.toPinnacle(135);
  w.fromPinnacle(43, 10);
  w.goTo(63);
  w.waitForRoom(11);
  w.goTo(69);
  w.waitForRoom(14);
  w.goTo(90);
  w.waitForRoom(15);
  w.goTo(96);
  w.waitForRoom(12);
  w.goTo(70);
  w.waitForRoom(16);
  // Le premier essai s'arrête devant la zone éteinte (C16A : deux Amazones passent) ; le second déclenche le piège (C16B, pièce 19).
  w.act("Use", 97);
  w.act("Use", 97);
  w.waitForRoom(19);
  // Le prisonnier (man1.DOG) et Faye (faye4.DOG, enchaîné) : la poupée.
  w.act("Talk", 129);
  w.waitForChoices();
  w.chooseText("très jolies poupées");
  w.chooseText("j'aime bien celle");
  w.chooseText("Je suis vraiment content de vous voir");
  w.chooseText("Mais où suis-je donc");
  w.chooseText("Alors, vous allez me faire sortir");
  w.chooseText("Des ennuis?");
  w.chooseText("aucun ennui");
  w.chooseText("C'est du chantage");
  w.chooseText("vraiment, vraiment désolé");
  w.settle();
  w.goTo(134);
  w.waitForRoom(17);
}

/**
 * Passage 1d (après le groupe 2 : Azura est libre, `gs40 = 1`) : l'entrée de la cachette des Amazones (pièce 17) fait offrir la corne de
 * tyranno par Azura. Joe est déjà dans la pièce 17 ; le chemin depuis le piton (O48, pièce 16, O101) n'est pas rejoué.
 */
export function returnToAmazons(w: Walkthrough): void {
  w.goTo(117);
  w.settle();
}

export const solveGroup1 = (w: Walkthrough): void => {
  crashSite(w);
  jungleStart(w);
  budAndSkip(w);
  secondGorilla(w);
  mission(w);
  backToBob(w);
  beetleAndPerfume(w);
  naomi(w);
  dictionary(w);
  sloth(w);
  witch(w);
  lotionAndRecord(w);
  amazons(w);
};

export const group1Solution: GroupSolution = {
  start: startGroup1,
  solve: solveGroup1,
};

export default group1Solution;
