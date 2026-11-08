/**
 * Solution du groupe 2 (Floda, pièces 22 à 42 et 103), `docs/fotaq/specials.md` § 7 « Groupe 2 », corrigée et complétée par
 * `docs/fotaq/specials-group-2.md`. `solveGroup2` joue le passage 2a (infiltration, sauvetage d'Azura, fuite) ; `solveGroup2b` joue
 * le passage 2b (évasion de la prison, fusée dorsale pleine), qui vient après le temple (groupe 3) dans l'ordre de jeu.
 */

import { Walkthrough, type Start } from "../../walkthrough";
import type { GroupSolution } from "../../solutions";

/** Objets d'inventaire (`Item`) : numéro de `items.txt`. */
const I = {
  Knife: 3,
  Banana: 7,
  Disc: 19,
  Vacuum: 20,
  Alcohol: 22,
  Rocket: 23,
  Money: 24,
  CheeseCroquettes: 25,
  DogFood: 26,
  CanOpener: 27,
  Letter: 28,
  SqueakToy: 29,
  Key: 30,
  Book: 31,
  Paper: 32,
  Padlock: 34,
  Pencil: 77,
  Serum: 78,
  Cup: 92,
} as const;

/** Départ de 2a : fin de la jungle et du village (aspirateur et disque achetés chez Bob, banane de la pièce 4), au sommet du piton. */
export const startGroup2: Start = {
  room: 7,
  items: [58, I.Banana, I.Knife, 40, I.Vacuum, I.Disc, I.Money, 10, 14, 12, 21, 95],
  states: { 30: 1, 51: 1, 103: 1 },
};

/** Vérifie une étape : le joueur scripté ne modifie rien, mais une action sans effet doit se voir tout de suite. */
function must(w: Walkthrough, what: string, ok: boolean): void {
  if (!ok) throw new Error(`étape non réalisée : ${what} (pièce ${w.room}, cinématiques : ${[...new Set(w.cutaways.played)].join(" ")})`);
}
const gs = (w: Walkthrough, n: number): number => w.engine.gameState(n);
const has = (w: Walkthrough, item: number): boolean => w.engine.inventory.has(item);

/** Marche jusqu'à l'objet `object` et attend la pièce `room`. */
function enter(w: Walkthrough, object: number, room: number): void {
  w.goTo(object);
  w.waitForRoom(room);
}

/**
 * 2a, étape 1 : la banane repousse après chaque don (`OBJ O26 src=32`) ; le piton mène au site du crash (pièce 6), puis 5, 3 et le
 * pont de la pièce 4 (la liane posée en 1a) ; retour au piton par le même chemin.
 */
function fetchBanana(w: Walkthrough): void {
  w.fromPinnacle(42, 6);
  enter(w, 38, 5);
  enter(w, 34, 3);
  enter(w, 21, 4);
  w.act("PickUp", 26);
  must(w, "banane", has(w, I.Banana));
  enter(w, 27, 3);
  enter(w, 22, 5);
  enter(w, 36, 6);
  w.toPinnacle(39);
}

/** 2a, étapes 1 à 14 : banane, entrée de Floda, aspirateur à la secrétaire, cuisine (croquettes, nourriture, chef), garde-manger. */
function reachKitchenAndStore(w: Walkthrough): void {
  // 1. La banane (pièce 4) pour le chef : déjà dans l'inventaire du départ isolé, sinon on retourne la cueillir.
  if (!has(w, I.Banana)) fetchBanana(w);
  // 2-3. Le camp de la Floda (la porte O167 est derrière le chien : elle s'ouvre à l'étape 42), puis la réception.
  w.fromPinnacle(41, 22);
  enter(w, 169, 103);
  // 4. L'aspirateur à la secrétaire (c103l).
  w.useItem(I.Vacuum, 717, "Give");
  w.waitForCutaway();
  must(w, "aspirateur donné (état 28)", gs(w, 28) === 1);
  // 5. La cuisine : le comptoir (zone 2) est éteint tant que le chef est là, Joe ne peut pas aller aux croquettes ni à la nourriture.
  enter(w, 716, 26);
  // 8. Le chef : « Qu'est-ce que vous préparez? » pose l'état 55.
  w.act("Talk", 196);
  w.waitForChoices();
  w.chooseText("Qu'est-ce que vous préparez");
  w.chooseText("steack-frites");
  w.chooseText("simple verre d'eau");
  w.settle();
  // 9. La banane au chef : il s'en va, le comptoir s'allume.
  w.useItem(I.Banana, 196, "Give");
  w.waitForCutaway();
  must(w, "chef parti (banane donnée)", !has(w, I.Banana) && gs(w, 55) === 1);
  // 6-7. Croquettes et nourriture pour chiens.
  w.act("PickUp", 197);
  w.act("PickUp", 198);
  must(w, "croquettes et nourriture", has(w, I.CheeseCroquettes) && has(w, I.DogFood));
  // 10-13. Le garde-manger : jouet couinant, lettre.
  enter(w, 201, 27);
  w.act("Open", 207);
  w.act("PickUp", 207);
  w.act("Open", 216);
  w.act("Look", 216);
  w.verbOnItem("Look", I.Letter);
  w.settle();
  must(w, "jouet couinant et lettre", has(w, I.SqueakToy) && has(w, I.Letter) && gs(w, 144) === 1);
  // 14. Retour devant le camp.
  enter(w, 217, 26);
  enter(w, 206, 103);
  enter(w, 724, 22);
}

/** 2a, étapes 15 à 19 : le chien, le grammophone, le canapé, l'ascenseur. */
function reachLift(w: Walkthrough): void {
  // 15. Le jouet au chien de garde.
  w.useItem(I.SqueakToy, 166, "Give");
  w.waitForCutaway();
  must(w, "chien calmé (état 69)", gs(w, 69) === 1);
  // 16. Le salon.
  enter(w, 169, 103);
  enter(w, 718, 25);
  // 17. Le disque sur le grammophone : « Un ascenseur secret! ».
  w.useItem(I.Disc, 184);
  w.waitForCutaway();
  must(w, "ascenseur secret (état 84)", gs(w, 84) === 1);
  // 18. Le canapé : un peu plus d'argent.
  w.act("Look", 186);
  w.waitForCutaway();
  must(w, "argent du canapé (état 30 à 2)", gs(w, 30) === 2);
  // 19. L'ascenseur : pièce 28.
  w.goTo(184);
  w.waitForRoom(28);
  must(w, "ascenseur pris (état 197)", gs(w, 197) === 1);
}

/** 2a, étapes 20 à 28 : l'ouvre-boîtes, le sérum, Azura (c41f), le crayon, la lettre à John, le planning, le meuble du bureau. */
function reachOffice(w: Walkthrough): void {
  // 20. La caisse de la pièce 34 : l'ouvre-boîtes.
  w.act("Open", 221);
  enter(w, 221, 34);
  w.act("Look", 245);
  must(w, "ouvre-boîtes", has(w, I.CanOpener));
  // 21-22. La sortie de secours, le sérum.
  enter(w, 246, 28);
  enter(w, 218, 29);
  enter(w, 224, 40);
  w.act("PickUp", 291);
  must(w, "sérum", has(w, I.Serum));
  // 23. L'escalier : Azura (prin1.DOG), puis c41f ; Joe finit dans la prison.
  w.goTo(284);
  w.waitForChoices();
  w.chooseText("Comment avez-vous transmis");
  w.chooseText("Je reviendrai bientôt");
  w.waitForRoom(41);
  must(w, "Azura vue (état 39)", gs(w, 39) === 1);
  // 24-25. Retour à la réception : le crayon.
  enter(w, 303, 40);
  enter(w, 285, 29);
  enter(w, 223, 28);
  enter(w, 220, 25);
  enter(w, 195, 103);
  w.act("PickUp", 725);
  must(w, "crayon", has(w, I.Pencil));
  // 26. La lettre à John (pièce 31).
  enter(w, 718, 25);
  enter(w, 184, 28);
  enter(w, 219, 31);
  w.useItem(I.Letter, 232, "Give");
  w.waitForCutaway();
  must(w, "John parti (état 128)", gs(w, 128) === 1);
  // 27. Le planning (pièce 38).
  w.act("Open", 236);
  enter(w, 236, 38);
  w.act("Look", 267);
  w.waitForCutaway();
  must(w, "planning lu (état 34)", gs(w, 34) === 1);
  enter(w, 268, 31);
  // 28. Le meuble du bureau (pièce 24) : le coffre-fort.
  w.act("Open", 235);
  enter(w, 235, 24);
  w.act("Move", 175);
  w.waitForCutaway();
}

/** 2a, étapes 29 à 41 : Henri, la clef, Klunk, le papier, le coffre-fort. */
function reachSafe(w: Walkthrough): void {
  // 29. Henri (henry.DOG) : on le demande à la cuisine.
  enter(w, 181, 31);
  enter(w, 233, 28);
  enter(w, 218, 29);
  w.act("Open", 225);
  w.goTo(225);
  w.waitForChoices();
  w.chooseText("corvées de cuisine");
  w.chooseText("colonel Jackson");
  w.waitForCutaway();
  must(w, "Henri parti (état 134)", gs(w, 134) === 1);
  // 30. La porte d'Henri : Ironstein et Anderson (c40a), Joe en pièce 33.
  w.act("Open", 241);
  w.goTo(241);
  w.waitForRoom(33);
  must(w, "c40a vue (état 24)", gs(w, 24) === 1);
  // 31. Le livre, la clef.
  w.act("PickUp", 242);
  must(w, "livre", has(w, I.Book));
  w.combine(I.Knife, I.Book);
  must(w, "clef", has(w, I.Key));
  // 32. Chez Klunk (pièce 30).
  enter(w, 244, 32);
  enter(w, 237, 29);
  enter(w, 222, 30);
  // 33-34. La nourriture pour chiens : ouvre-boîtes puis sérum.
  w.combine(I.CanOpener, I.DogFood);
  w.combine(I.Serum, I.DogFood);
  must(w, "surprise du chef (état 43)", gs(w, 43) === 1);
  // 35. Klunk mange la surprise.
  w.useItem(I.DogFood, 226, "Give");
  w.waitForCutaway();
  must(w, "Klunk drogué (état 52)", gs(w, 52) === 1);
  // 36. Klunk (klunk2.DOG) : on le met au défi, il tombe K.O.
  w.act("Talk", 226);
  w.waitForChoices();
  w.chooseText("vraiment pour un dur");
  w.chooseText("vrai dur");
  w.waitForCutaway();
  must(w, "Klunk K.O. (état 126)", gs(w, 126) === 1);
  // 37-38. Le bureau de Frank : le bloc-notes au crayon.
  w.act("Open", 231);
  enter(w, 231, 35);
  w.useItem(I.Pencil, 250);
  w.waitForCutaway();
  must(w, "morceau de papier", has(w, I.Paper));
  // 39. Le bureau de la pièce 24.
  enter(w, 253, 30);
  enter(w, 227, 31);
  enter(w, 235, 24);
  // 40-41. Le papier sur le coffre-fort, le coffre : cadenas et plan de fusée.
  w.useItem(I.Paper, 176);
  must(w, "code du coffre (état 73)", gs(w, 73) === 1);
  w.act("Open", 176);
  w.act("PickUp", 176);
  w.waitForCutaway();
  must(w, "cadenas et plan de fusée", has(w, I.Padlock) && has(w, 33) && gs(w, 74) === 1);
}

/** 2a, étapes 42 à 49 : la fusée dorsale, la libération d'Azura, le mannequin, le panneau mural. */
function rescueAzura(w: Walkthrough): void {
  // 42. Retour devant le camp, la porte O167 (le chien est calmé) : la caisse de la pièce 23.
  enter(w, 181, 31);
  enter(w, 233, 28);
  enter(w, 220, 25);
  enter(w, 195, 103);
  enter(w, 724, 22);
  w.act("Open", 167);
  enter(w, 167, 23);
  w.useItem(I.Padlock, 171);
  must(w, "cadenas posé (état 27)", gs(w, 27) === 1 && !has(w, I.Padlock));
  // 43. La caisse : la fusée dorsale.
  w.act("Open", 170);
  w.act("Look", 170);
  must(w, "fusée dorsale (état 9)", has(w, I.Rocket) && gs(w, 9) === 1);
  // 44. La prison (pièce 41) par la sortie de secours.
  enter(w, 174, 22);
  enter(w, 169, 103);
  enter(w, 718, 25);
  enter(w, 184, 28);
  enter(w, 218, 29);
  enter(w, 224, 40);
  enter(w, 284, 41);
  // 45. La clef sur la porte de la prison : Azura libre, Joe et elle à la réception.
  w.useItem(I.Key, 296);
  w.waitForRoom(103);
  must(w, "Azura libérée (états 40 et 191)", gs(w, 40) === 1 && gs(w, 191) === 1);
  // 46-47. Les mannequins (c103f), l'interrupteur (c103j).
  w.act("Use", 719);
  w.waitForCutaway();
  must(w, "mannequins (état 193)", gs(w, 193) === 1);
  w.act("Use", 720);
  w.waitForCutaway();
  // 48. Azura (prin2.DOG) : elle a vu le code de la porte.
  w.act("Talk", 721);
  w.waitForChoices();
  w.chooseText("Vous avez vu le garde"); // la suite (« Vous avez une mémoire impressionnante! ») est dite sans menu
  w.waitForCutaway();
  must(w, "code de la porte (état 192)", gs(w, 192) === 1);
  // 49. Le panneau mural : Azura s'enfuit, Joe est rendu devant le camp.
  w.act("Use", 728);
  w.waitForRoom(22);
  must(w, "Azura enfuie (état 191 à 0)", gs(w, 191) === 0);
}

export function solveGroup2(w: Walkthrough): void {
  w.wait(30); // le piton ne rend jamais la main : on laisse la pièce s'afficher
  reachKitchenAndStore(w);
  reachLift(w);
  reachOffice(w);
  reachSafe(w);
  rescueAzura(w);
}

/**
 * Départ de 2b : la corniche de la cellule (pièce 41), où `C62C` (fin du groupe 3) laisse Joe en (136,102). La fusée dorsale est vide
 * (état 9 à 1), l'argent à 2 unités (état 30), l'étal de Bob (pièce 21) connu (états 108 et 195, posés dans le temple), le crâne perdu
 * (état 45 à 2). Ce que le jeu enchaîné a fait plus tôt : la tasse montrée par `C352` (groupe 3, `c44b`) et la porte de la prison vue
 * de l'intérieur (`C152`, le crâne pris en pièce 63 : l'objet 296 copie le 302, porte en (220,103) dans la cellule).
 */
export const startGroup2b: Start = {
  room: 41,
  items: [I.Rocket, I.Money, 58, I.Knife, 40],
  states: { 9: 1, 28: 1, 30: 2, 39: 1, 45: 2, 108: 1, 195: 1, 201: 1 },
  shown: [294],
  copies: [[302, 296]],
};

/** Ce que `Start` ne pose pas : Joe sur la corniche (avant le premier tick) et la réception rouverte (zone 3 de la pièce 103, allumée par `C103L` en 2a). */
export function setupGroup2b(w: Walkthrough): void {
  const desk = w.engine.grid.area(103, 3);
  desk.mapNeighbors = Math.abs(desk.mapNeighbors);
  w.engine.state.joe.startX = 136;
  w.engine.state.joe.startY = 102;
}

/** 2b, étapes 50 à 54 : la tasse de la corniche, la porte de la prison, l'alcool de Bob, la fusée pleine. */
export function solveGroup2b(w: Walkthrough): void {
  w.settle();
  // 50. La tasse, sur la corniche où Joe se réveille.
  w.act("PickUp", 294);
  must(w, "tasse", has(w, I.Cup));
  // 51. La tasse sur la porte de la prison : Faye, Sparky et Anderson viennent. `C41B` laisse Joe en pièce 41, devant la cellule ouverte, en (214,123).
  w.useItem(I.Cup, 296);
  w.waitForCutaway();
  must(w, "évasion (porte retirée, zone 3 allumée)", w.engine.state.objects[296].name <= 0 && w.engine.grid.area(41, 3).mapNeighbors > 0);
  // 52. Par la sortie de secours et le salon jusque devant le camp, puis Bob (pièces 20 et 21).
  enter(w, 303, 40);
  enter(w, 285, 29);
  enter(w, 223, 28);
  enter(w, 220, 25);
  enter(w, 195, 103);
  enter(w, 724, 22);
  w.toPinnacle(165);
  w.fromPinnacle(47, 20);
  w.goTo(147);
  // Si le dialogue forcé de Bob (`c21l`, `bob5.DOG`) n'a pas eu lieu en 1b, il part ici : on l'écoute puis on le quitte par « Bon, maintenant… ».
  if (w.awaitingChoice) {
    w.chooseText("Pourquoi avez-vous besoin");
    w.chooseText("D'accord, je vous aiderai");
    w.chooseText("Pourquoi pensez-vous");
    w.chooseText("Bon, maintenant");
  }
  w.waitForRoom(21);
  // 53. L'alcool de l'étal (l'argent est dépensé).
  w.act("PickUp", 158);
  w.waitForCutaway();
  must(w, "alcool (argent à 0)", has(w, I.Alcohol) && gs(w, 30) === 0);
  // 54. L'alcool dans la fusée dorsale : elle est pleine.
  w.combine(I.Alcohol, I.Rocket);
  must(w, "fusée pleine (état 9 à 2)", gs(w, 9) === 2 && !has(w, I.Alcohol));
}

/** Le passage 2a, au format de `test/fotaq/solutions.ts` (2b suit le temple : `solveGroup2b`). */
export const GROUP2_SOLUTION: GroupSolution = { start: startGroup2, solve: solveGroup2 };
