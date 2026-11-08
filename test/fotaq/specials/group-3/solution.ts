/**
 * Solution du groupe 3 (temple et labyrinthe, pièces 43 à 63 et 97 à 102) : de l'embarcadère de la pièce 42 à la porte de l'oracle
 * (pièce 63, le gardien). Numéros : `On` objet du jeu (`QUEEN.JAS`), `In` objet d'inventaire (`Item`), `gsN` état du jeu
 * (`docs/fotaq/specials-group-3.md`, § 2, pour le déroulé et les corrections de `specials.md` § 7).
 */

import type { GroupSolution } from "../../solutions";
import type { Start, Walkthrough } from "../../walkthrough";

/**
 * I12 scarabée (appât), I25 croquettes au fromage, I24 argent, I20 aspirateur, I3 couteau, I40 briquet, I95 poupée, I17 corne. Le
 * passeur (306), son bateau (307) et le panneau (308 copie 309) sont ceux que montre `C18B` (la reine des Amazones, groupe 1).
 */
export const GROUP_3_START: Start = {
  entryObject: 304,
  items: [12, 25, 24, 20, 3, 40, 95, 17],
  states: { 102: 1, 103: 1 },
  shown: [306, 307],
  copies: [[309, 308]],
};

/** Utilise l'objet `first` de la pièce avec l'objet `second` de la pièce (verbe, premier clic, second clic). */
export function useObjects(w: Walkthrough, first: number, second: number): void {
  w.reach(first);
  w.verb("Use");
  const a = w.pointOf(first);
  w.click(a.x, a.y);
  w.reach(second);
  const b = w.pointOf(second);
  w.click(b.x, b.y);
}

/** Marche vers l'objet `door` de la pièce courante et attend d'être dans la pièce `room`. */
export function through(w: Walkthrough, door: number, room: number): void {
  w.goTo(door);
  w.waitForRoom(room);
}

/** Étapes 2 à 4 : le passeur (appât, traversée) -> pièce 43. */
function ferry(w: Walkthrough): void {
  w.act("Talk", 306);
  w.waitForChoices();
  for (const text of [
    "c'est quoi votre nom",
    "Vous avez l'air très pâle",
    "Pourquoi portez-vous cette cape",
    "Génial!",
    "Je préférais le premier lapin",
    "Je m'appelle Joe King",
    "Je n'ai pas dit que je faisais du jogging",
    "Vous avez l'air fâché",
    "Vous pêchez?",
    "Vous utilisez quoi",
  ]) {
    w.chooseText(text);
  }
  w.useItem(12, 306, "Give");
  w.act("Talk", 306);
  w.waitForChoices();
  w.chooseText("Vous pouvez m'emmener");
  w.waitForRoom(43);
}

/** Étapes 5 à 16 : les rats, les os, les trous de la pièce 44, le passage secret -> pièce 47 et l'oracle. */
function bones(w: Walkthrough): void {
  through(w, 312, 44);
  through(w, 321, 45);
  w.useItem(25, 337, "Give");
  w.act("Move", 336);
  w.act("PickUp", 333);
  w.act("Move", 338);
  w.act("PickUp", 332);
  through(w, 331, 46);
  w.act("Move", 343);
  w.act("PickUp", 340);
  w.act("Move", 345);
  w.act("PickUp", 341);
  through(w, 342, 44);
  w.useItem(35, 317);
  w.useItem(36, 320);
  w.useItem(37, 319);
  w.useItem(24, 316);
  w.useItem(96, 327);
  w.act("Use", 327);
  w.goTo(329);
  w.waitForChoices();
}

/** Étape 17 : l'énigme de l'oracle (`oracle1.DOG`). */
function riddle(w: Walkthrough): void {
  w.chooseText("Une vache à deux jambes");
  w.chooseText("Je sais!");
  w.chooseText("Merci pour l'énigme");
  w.settle();
}

/** Étape 20 : 47 -> 99 -> 97 -> 50 (depuis `c47a`, la main de pierre n'est plus un passage ; les zombies s'atteignent par la 97). */
function toZombies(w: Walkthrough): void {
  through(w, 353, 99);
  through(w, 655, 97);
  through(w, 642, 50);
}

/**
 * Étapes 21 à 27 : Joe marche vers le sarcophage, ce qui traverse la zone éteinte 6 (`handleSpecialArea`, pièce 50) : `C50D` puis le
 * dialogue `zombie1.DOG`. Les bandelettes, la couronne, la liane, le sarcophage poussé -> pièce 51.
 */
function zombies(w: Walkthrough): void {
  w.goTo(377);
  w.waitForChoices();
  for (const text of [
    "Depuis combien de temps",
    "Comment pouvez-vous être vivantes",
    "vous êtes fait avoir",
    "Je ne vois aucun Prince",
    "Comment pouvez-vous être sûre",
    "Prouvez-moi",
    "Vous avez peur",
  ]) {
    w.chooseText(text);
  }
  w.settle();
  w.act("PickUp", 371);
  w.act("Talk", 367);
  w.waitForChoices();
  w.chooseText("encore ouvrir");
  w.chooseText("J'ai récupéré un tas");
  w.settle();
  w.act("Open", 377);
  w.useItem(3, 377);
  w.act("Close", 377);
  w.act("Move", 377);
  w.goTo(377);
  w.waitForRoom(51);
}

/** Étapes 28 à 32 : la racine collante (sur la batte, sur la fontaine), la gemme bleue -> pièce 100 (`c100a` puis `ian1.DOG`). */
function tree(w: Walkthrough): void {
  w.useItem(3, 386);
  w.act("PickUp", 386);
  w.combine(46, 1);
  w.act("PickUp", 386);
  w.useItem(46, 383);
  w.act("PickUp", 382);
  w.goTo(378);
  w.waitForChoices();
}

/** Étapes 33 et 37 à 40 : Ian derrière les barreaux (`ian1.DOG`), puis la salle des rayons (101) : le disque de pierre. */
function disk(w: Walkthrough): void {
  w.chooseText("Bon, je dois y aller");
  through(w, 672, 101);
  w.act("PickUp", 687);
  w.useItem(95, 687);
}

/** Retour par la pièce 100 et la 51 ; le levier de la 51 envoie Joe en pièce 47 (`c51a`). */
function leaveByLever(w: Walkthrough): void {
  through(w, 684, 100);
  through(w, 673, 51);
  w.act("Use", 379);
  w.waitForRoom(47);
}

/** Étapes de la poulie (pièce 99, `docs/fotaq/specials-group-3.md`) : l'axe, les lianes, la batte -> la porte vers le coin du piolet (100). */
function pulley(w: Walkthrough): void {
  through(w, 348, 99);
  w.useItem(67, 660);
  w.useItem(68, 660);
  // La poulie est en bas : on y descend par la pièce 47 (la passerelle de l'axe n'est pas reliée au sol).
  through(w, 652, 47);
  through(w, 353, 99);
  useObjects(w, 666, 657);
  w.useItem(1, 657);
}

/** Étape 34 : par la porte de la poulie, le coin du piolet (pièce 100), puis la pièce 48 (stalactite, silex, briquet, torche). */
function flint(w: Walkthrough): void {
  through(w, 659, 100);
  w.act("PickUp", 674);
  through(w, 669, 99);
  // Le bloc redescend (et rouvre le sol de la pièce 100 jusqu'au levier et à la cage).
  w.useItem(1, 657);
  through(w, 654, 47);
  through(w, 348, 99);
  through(w, 653, 48);
  w.useItem(42, 355);
  w.act("PickUp", 356);
  w.combine(69, 40);
  w.combine(96, 79);
  w.combine(40, 39);
}

/** Étapes 47 et 48 : le trou de la pièce 48 donne la 49 (sans issue de ce côté) ; la torche allumée brûle le serpent de la 53. */
function snake(w: Walkthrough): void {
  w.useItem(42, 357);
  through(w, 354, 99);
  through(w, 652, 47);
  through(w, 347, 52);
  through(w, 389, 53);
  w.useItem(39, 400);
}

/** Le serpent parti : 53 -> 98 -> 52 (côté du corps) : la carte d'identité et le morceau de pierre. -> 54 -> 55 -> 97 -> 56 : le grand bâton. */
function body52AndStaff(w: Walkthrough): void {
  through(w, 396, 98);
  through(w, 649, 52);
  w.act("Look", 388);
  through(w, 390, 54);
  through(w, 402, 55);
  through(w, 416, 97);
  through(w, 643, 56);
  w.act("PickUp", 418);
}

/** 56 -> 97 -> 55 -> 100 (le sol) : le levier sans effet (`c100c`), Ian (`ian2.DOG`), le levier (`c100d`). */
function cage(w: Walkthrough): void {
  through(w, 430, 97);
  through(w, 644, 55);
  through(w, 415, 100);
  w.act("Move", 676);
  w.act("Talk", 675);
  w.waitForChoices();
  w.chooseText("J'ai une idée");
  w.chooseText("couper la corde");
  w.act("Move", 676);
}

/**
 * Retour dans la poche (51, 100, 101) par le sarcophage : 100 -> 98 -> 53 -> 52 -> 47 -> 99 -> 97 -> 50 -> 51 -> 100 (le haut) -> 101 (`c101e`).
 * Le corps de Ian, la racine collante sur les deux morceaux de pierre : la clef de pierre.
 */
function pocketAgain(w: Walkthrough): void {
  through(w, 670, 98);
  through(w, 647, 53);
  through(w, 395, 52);
  through(w, 394, 47);
  through(w, 353, 99);
  through(w, 655, 97);
  through(w, 642, 50);
  w.goTo(377);
  w.waitForRoom(51);
  w.act("PickUp", 386);
  through(w, 378, 100);
  through(w, 672, 101);
  w.act("Look", 685);
  // La clef de pierre : la racine colle un morceau à l'autre.
  w.combine(46, 82);
  w.combine(82, 83);
  // Retour : le levier de la pièce 51 renvoie Joe en 47.
  through(w, 684, 100);
  through(w, 673, 51);
  w.act("Use", 379);
  w.waitForRoom(47);
}

/** La crypte de la pièce 49 : le grand bâton l'ouvre (`c49d`), le masque mortuaire (`c49c`), nettoyé avec les bandelettes (`cmask`). */
function mask(w: Walkthrough): void {
  through(w, 348, 99);
  through(w, 653, 48);
  through(w, 357, 49);
  w.useItem(84, 365);
  w.act("Look", 365);
  w.combine(79, 15);
}

/**
 * Le miroir de la pièce 55 (le masque détruit les rayons, `c55a`, zone 8 allumée) ouvre le chemin 55 -> 52 -> 49 (le côté de la gemme
 * verte, `c49b`) ; les deux gemmes dans les yeux de la pièce 56 (`c56a`).
 */
function mirror(w: Walkthrough): void {
  through(w, 361, 48);
  through(w, 354, 99);
  through(w, 652, 47);
  through(w, 347, 52);
  through(w, 389, 53);
  through(w, 396, 98);
  through(w, 648, 100);
  through(w, 671, 55);
  w.useItem(15, 410);
  through(w, 409, 52);
  through(w, 392, 49);
  w.useItem(1, 362);
  w.combine(3, 1);
  through(w, 360, 52);
  through(w, 393, 55);
  through(w, 416, 97);
  through(w, 643, 56);
  w.useItem(41, 421);
  w.useItem(44, 420);
}

/** La statue de la pièce 54 (la clef de pierre, `c54a`) ouvre la sortie vers le labyrinthe : 54 -> 57. */
function statue(w: Walkthrough): void {
  through(w, 422, 54);
  w.useItem(43, 405);
  through(w, 404, 57);
}

/** Le labyrinthe de rats 57 -> 58 -> 59 -> 60 -> 61 -> 62 : un fromage à chaque rat (`c58a` à `c61a`). */
function maze(w: Walkthrough): void {
  through(w, 432, 58);
  w.useItem(25, 434, "Give");
  through(w, 437, 59);
  w.useItem(25, 443, "Give");
  through(w, 448, 60);
  w.useItem(25, 451, "Give");
  through(w, 458, 61);
  w.useItem(25, 460, "Give");
  through(w, 463, 62);
}

/** La pièce 102 : le puzzle des inscriptions (deux déplacements dans l'ordre : `c102e` puis `c102b`) ouvre la porte de l'oracle. */
function inscriptions(w: Walkthrough): void {
  through(w, 471, 102);
  w.useItem(20, 695);
  w.act("Move", 711);
  w.act("Move", 708);
}

/** Passage 4b (pièces 63 et 62) : le gardien de l'oracle, le crâne de cristal, la chaise de Frank -> la cellule (pièce 41, `c62c`). */
function oracle(w: Walkthrough): void {
  w.goTo(693);
  w.chooseText("Je ne suis pas");
  w.useItem(97, 476, "Give");
  w.act("PickUp", 483);
  through(w, 477, 102);
  through(w, 692, 62);
  w.act("Move", 472);
  w.act("Move", 473);
  w.act("Use", 470);
  w.waitForChoices();
  w.chooseText("avez-vous besoin");
  w.chooseText("L'acide");
  w.chooseText("Vous ne mélangez");
  w.waitForRoom(41);
}

/** Passage 3a : de l'embarcadère (42) à la porte de l'oracle ouverte (pièce 102). */
const TEMPLE: [string, (w: Walkthrough) => void][] = [
  ["ferry", ferry],
  ["bones", bones],
  ["riddle", riddle],
  ["toZombies", toZombies],
  ["zombies", zombies],
  ["tree", tree],
  ["disk", disk],
  ["leaveByLever", leaveByLever],
  ["pulley", pulley],
  ["flint", flint],
  ["snake", snake],
  ["body52AndStaff", body52AndStaff],
  ["cage", cage],
  ["pocketAgain", pocketAgain],
  ["mask", mask],
  ["mirror", mirror],
  ["statue", statue],
  ["maze", maze],
  ["inscriptions", inscriptions],
];

/** Passage 4b : le gardien, le crâne de cristal, la chaise (jusqu'à la cellule de Flöda, pièce 41). */
const ORACLE: [string, (w: Walkthrough) => void][] = [["oracle", oracle]];

export const STEPS = [...TEMPLE, ...ORACLE];

/** Joue le passage 3a seul : fin dans la pièce 102, la porte de l'oracle ouverte. */
export function solveTemple(w: Walkthrough): void {
  for (const [, step] of TEMPLE) step(w);
}

/** Joue le groupe : 3a puis 4b (les pièces 62 et 63 sont au groupe 3), jusqu'à la cellule de la pièce 41. */
export function solveGroup3(w: Walkthrough): void {
  for (const [, step] of STEPS) step(w);
}

export const GROUP_3: GroupSolution = { start: GROUP_3_START, solve: solveGroup3 };
