import { expect } from "vitest";
import * as C1 from "../../src/games/drascula/engine/rooms/chapter-1/ids";
import * as C2 from "../../src/games/drascula/engine/rooms/chapter-2/ids";
import * as C3 from "../../src/games/drascula/engine/rooms/chapter-3/ids";
import * as C4 from "../../src/games/drascula/engine/rooms/chapter-4/ids";
import * as C5 from "../../src/games/drascula/engine/rooms/chapter-5/ids";
import * as C6 from "../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../src/games/drascula/engine/state";
import { useOnHero } from "./rooms/chapter-4/support";
import {
  bookToPianist,
  chapelToHut,
  drunkTellsAboutVonBraun,
  earplugsOnHero,
  go,
  handbagAndCigarettes,
  innToLab,
  restOfIngredients,
  talkToVonBraun,
  tissuesAndSickle,
  vonBraunLetsUsIn,
  wellFromChapel,
} from "./rooms/chapter-2/route";
import type { Walkthrough } from "./walkthrough";

/**
 * Les solutions des six chapitres, chacune jouée à la souris et au clavier par un `Walkthrough` (jamais par l'état du moteur) : de
 * l'écran du début du chapitre à celui du début du suivant (la fin du jeu pour le chapitre 6). Les tests de passage de chaque chapitre
 * (`rooms/chapter-N/walkthrough.test.ts`) les rejouent seules ; `full-game.test.ts` les enchaîne dans une même partie. Un `Walkthrough`
 * démarre au chapitre 1 ou au chapitre voulu sans l'introduction du jeu (`1_1`).
 */

/** Chapitre 1 : le barman, puis la porte du fond ; la cinématique de B.J. finit le chapitre. Le `Walkthrough` est au début du chapitre 1. */
export function solveChapter1(w: Walkthrough): void {
  expect(w.state.chapter).toBe(1);
  // La porte du fond est fermée tant que le barman n'a pas parlé.
  w.goTo(C1.Inn.Back);
  expect(w.room).toBe(62);
  w.act(Verb.Talk, C1.Inn.Barman);
  expect(w.flags[C1.Flag.BarmanSpoke]).toBe(1);
  w.selectVerb(Verb.None);
  const mark = w.mark();
  w.goTo(C1.Inn.Back, 60_000);
  // La cinématique joue (hoquet, B.J., enlèvement), puis le chapitre 2 commence dans la pièce 14.
  expect(w.state.chapter).toBe(2);
  expect(w.room).toBe(14);
  expect(w.host.exits).toBe(0);
  const voices = w.voices(mark);
  for (const voice of ["bj1.als", "214.als", "bj2.als", "223.als", "bj11.als", "224.als", "bj12.als", "225.als", "226.als", "227.als"]) {
    expect(voices, voice).toContain(voice);
  }
  expect(voices.findIndex((v) => v === "225.als")).toBeLessThan(voices.findIndex((v) => v === "226.als"));
  expect(voices.at(-1)).toBe("227.als");
}

/** Chapitre 2 : de l'auberge au puits du cimetière (étapes de `rooms/chapter-2/route.ts`). Le `Walkthrough` est au début du chapitre 2. */
export function solveChapter2(w: Walkthrough): void {
  expect(w.state.chapter).toBe(2);
  expect(w.room).toBe(14);
  expect(w.state.inventory).toContain(C2.Item.Phone);

  // L'ivrogne, le sac de B.J., le distributeur.
  drunkTellsAboutVonBraun(w);
  expect(w.flags[C2.Flag.HutKnown]).toBe(1);
  handbagAndCigarettes(w);
  expect(w.flags[C2.Flag.HandbagOpened]).toBe(1);
  expect(w.flags[C2.Flag.CigarettesTaken]).toBe(1);
  expect(w.state.inventory).toEqual(expect.arrayContaining([C2.Item.Money, C2.Item.Cigarettes]));

  // Les mouchoirs, la faucille de l'aveugle, le reste des ingrédients.
  tissuesAndSickle(w);
  expect(w.flags[C2.Flag.TissuesTaken]).toBe(1);
  expect(w.flags[C2.Flag.BlindSpokeTwice]).toBe(1);
  expect(w.state.inventory).toContain(C2.Item.Sickle);
  expect(w.state.inventory).not.toContain(C2.Item.Money);
  restOfIngredients(w);
  expect(w.room).toBe(7);
  expect(w.flags[C2.Flag.AllIngredients]).toBe(1);
  expect(w.state.inventory).toEqual(expect.arrayContaining([C2.Item.Leaves, C2.Item.BubbleGum, C2.Item.Tissues, C2.Item.Cigarettes, C2.Item.Candle, C2.Item.Cross]));

  // La cabane : on sonne, Von Braun nous met à l'épreuve.
  chapelToHut(w);
  expect(w.room).toBe(17);
  vonBraunLetsUsIn(w);
  expect(w.room).toBe(17);
  expect(w.flags[C2.Flag.MetVonBraun]).toBe(1);
  expect(w.flags[C2.Flag.HutDoorOpen]).toBe(1);

  // Le livre du laboratoire, le pianiste, les bouchons d'oreilles.
  go(w, 177, 18);
  w.act(Verb.Pick, 182);
  expect(w.flags[C2.Flag.BookTaken]).toBe(1);
  w.selectVerb(Verb.None);
  bookToPianist(w);
  expect(w.room).toBe(14);
  expect(w.flags[C2.Flag.BookGiven]).toBe(1);
  expect(w.state.inventory).toContain(C2.Item.Earplugs);
  expect(w.state.inventory).not.toContain(C2.Item.Book);

  // Retour au laboratoire : les bouchons d'oreilles, l'épreuve qui marche (menu OP_4), la potion (menu OP_5).
  innToLab(w);
  expect(w.flags[C2.Flag.PianistGone]).toBe(1);
  earplugsOnHero(w);
  expect(w.flags[C2.Flag.WearingEarplugs]).toBe(1);
  w.selectVerb(Verb.None);
  talkToVonBraun(w, 2);
  expect(w.flags[C2.Flag.EarplugsScene]).toBe(1);
  expect(w.room).toBe(17);
  go(w, 177, 18);
  const mark = w.mark();
  talkToVonBraun(w, 2);
  expect(w.voices(mark)).toContain("405.als");
  expect(w.voices(mark).at(-1)).toBe("vb56.als");
  expect(w.flags[C2.Flag.WellOpen]).toBe(1);
  expect(w.flags[C2.Flag.AllIngredients]).toBe(0);
  expect(w.state.inventory).toContain(C2.Item.Reefer);
  for (const gone of [C2.Item.Leaves, C2.Item.BubbleGum, C2.Item.Tissues, C2.Item.Cigarettes, C2.Item.Candle]) expect(w.state.inventory).not.toContain(gone);

  // Du laboratoire au puits (la conversation ramène le héros devant la cabane) : la chapelle, puis le puits qui finit le chapitre.
  expect(w.room).toBe(17);
  w.selectVerb(Verb.None);
  go(w, 176, 2);
  go(w, 127, 3);
  go(w, 134, 5);
  go(w, 136, 6);
  go(w, 138, 7);
  expect(w.flags[C2.Flag.WearingEarplugs]).toBe(0);
  const end = w.mark();
  wellFromChapel(w);
  expect(w.state.chapter).toBe(3);
  expect(w.room).toBe(20);
  expect(w.voices(end)).toContain("s1.als");
  expect(w.host.exits).toBe(0);
}

/** Chapitre 3 : la porte de la pièce 20, puis la croix sur le vampire. Le `Walkthrough` est au début du chapitre 3. */
export function solveChapter3(w: Walkthrough): void {
  expect(w.state.chapter).toBe(3);
  expect(w.room).toBe(20);
  w.goTo(C3.Start.Door);
  expect(w.room).toBe(13);
  w.useItem(C3.Item.Cross, C3.Gate.Vampire, 60_000);
  // La croix tue le vampire, le héros sort de l'écran : le chapitre 4 commence par le château, puis la pièce 21.
  expect(w.state.chapter).toBe(4);
  expect(w.room).toBe(21);
  expect(w.host.exits).toBe(0);
}

/** Chapitre 5 : l'os, la vis, le cerveau, la fiche, l'interrupteur, le cercueil. Rend la main dès que le chapitre 6 est en place (pièce 58, son introduction attend des clics). Le `Walkthrough` est au début du chapitre 5. */
export function solveChapter5(w: Walkthrough): void {
  expect(w.room).toBe(C5.Room.Towers);
  // L'os dans la crypte (tour 2).
  w.goTo(C5.Towers.Tower2);
  expect(w.room).toBe(C5.Room.Tower2);
  w.goTo(113);
  expect(w.room).toBe(C5.Room.Crypt);
  w.act(Verb.Pick, C5.Crypt.Bone);
  expect(w.state.pickedObject).toBe(C5.Item.Bone);
  // Le loup-garou (tour 3).
  w.goTo(C5.Crypt.Door);
  w.goTo(108);
  expect(w.room).toBe(C5.Room.Towers);
  w.goTo(C5.Towers.Tower3);
  expect(w.room).toBe(C5.Room.Office);
  expect(w.flags[C5.Flag.WerewolfMet]).toBe(1);
  w.useItem(C5.Item.Bone, C5.Office.Werewolf, 60_000);
  expect(w.flags[C5.Flag.WerewolfGone]).toBe(1);
  // La vis dans l'atelier (tour 4, ouverte).
  w.goTo(C5.Office.DoorLeft);
  expect(w.room).toBe(C5.Room.Towers);
  w.goTo(C5.Towers.Tower4);
  expect(w.room).toBe(C5.Room.Tower3);
  w.goTo(114);
  expect(w.room).toBe(C5.Room.Workshop);
  w.act(Verb.Pick, C5.Workshop.Screw);
  expect(w.state.pickedObject).toBe(C5.Item.Screw);
  // Le laboratoire (tour 1).
  w.goTo(C5.Workshop.Door);
  w.goTo(111);
  w.goTo(C5.Towers.Tower1);
  expect(w.room).toBe(C5.Room.Tower1);
  w.goTo(112);
  expect(w.room).toBe(C5.Room.Laboratory);
  w.useItem(C5.Item.Screw, C5.Laboratory.Frankenstein);
  w.useItem(C5.Item.Brain, C5.Laboratory.Frankenstein);
  w.act(Verb.Pick, C5.Laboratory.FloorPlug);
  expect(w.state.pickedObject).toBe(C5.Item.Plug);
  const socket = w.pointOf(C5.Laboratory.Socket);
  w.clickAt(socket.x, socket.y);
  expect(w.flags[C5.Flag.PlugConnected]).toBe(1);
  w.act(Verb.Move, C5.Laboratory.Switch, 60_000);
  // Frankenstein est réveillé et sort : le héros est dans le couloir.
  expect(w.room).toBe(C5.Room.Corridor);
  expect(w.flags[C5.Flag.FrankensteinAwake]).toBe(1);
  w.goTo(104);
  expect(w.room).toBe(C5.Room.Coffin);
  const mark = w.mark();
  w.selectVerb(Verb.Open);
  const coffin = w.pointOf(C5.CoffinRoom.Coffin);
  w.player.click(coffin.x, coffin.y);
  // Le chapitre 6 commence par une cinématique qui attend les choix du joueur : on ne la laisse pas se finir.
  w.until(() => w.state.chapter === 6 && w.room === 58, 60_000);
  // « C'est vide ! », puis la voix de Drascula (d18) avant le fondu ; le chapitre 6 s'ouvre sur d19.
  const voices = w.voices(mark);
  expect(voices.indexOf("246.als")).toBeGreaterThanOrEqual(0);
  expect(voices.indexOf("d18.als")).toBeGreaterThan(voices.indexOf("246.als"));
  expect(voices.indexOf("d19.als")).toBeGreaterThan(voices.indexOf("d18.als"));
}

/** Chapitre 4, fin de la partie : le grappin sur le mur, depuis le pied du château. */
export function climb(w: Walkthrough): void {
  w.useItem(C4.Item.Grapnel, C4.Outside.Wall, 60_000);
  expect(w.state.chapter).toBe(5);
  expect(w.room).toBe(45);
  expect(w.host.exits).toBe(0);
}

/** La corde, la clé de l'arbre et la porte du château, jusqu'au hall. */
export function intoTheCastle(w: Walkthrough): void {
  w.act(Verb.Pick, C4.Outside.Rope);
  expect(w.state.pickedObject).toBe(C4.Item.Rope);
  w.selectVerb(Verb.None);
  w.goTo(C4.Outside.Tree);
  expect(w.room).toBe(22);
  w.useItem(C4.Item.Coin, C4.Tree.Magpie, 60_000);
  expect(w.flags[C4.Flag.MagpieDown]).toBe(1);
  w.act(Verb.Pick, C4.Tree.Key);
  expect(w.state.pickedObject).toBe(C4.Item.Key);
  w.selectVerb(Verb.None);
  w.goTo(C4.Tree.Exit);
  expect(w.room).toBe(21);
  w.goTo(C4.Outside.Door);
  expect(w.room).toBe(21); // fermée à clé
  w.useItem(C4.Item.Key, C4.Outside.Door);
  w.goTo(C4.Outside.Door);
  expect(w.room).toBe(23);
}

/** Du hall aux trois objets du déguisement ; Igor s'en va avec le dernier. */
export function gatherTheDisguise(w: Walkthrough): void {
  // Les frites sont derrière la porte du château : on la ferme derrière soi.
  w.act(Verb.Close, C4.Hall.DoorToOutside);
  w.act(Verb.Pick, C4.Hall.Fries);
  expect(w.state.pickedObject).toBe(C4.Item.Fries);
  w.selectVerb(Verb.None);
  w.act(Verb.Open, C4.Hall.DoorToLanding);
  w.goTo(C4.Hall.DoorToLanding);
  expect(w.room).toBe(24);
  w.act(Verb.Open, C4.Landing.DoorToBedroom);
  w.goTo(C4.Landing.Stairs);
  expect(w.room).toBe(27);
  // Le bureau, puis son armoire : le pieu, la cape, le cerveau, le déodorant.
  w.goTo(C4.Corridor.DoorToStudy);
  expect(w.room).toBe(34);
  w.act(Verb.Open, C4.Study.Wardrobe);
  expect(w.state.pickedObject).toBe(C4.Item.Stake);
  w.selectVerb(Verb.None);
  w.goTo(C4.Study.Wardrobe);
  expect(w.room).toBe(35);
  w.act(Verb.Pick, C4.Cupboard.Cape);
  w.selectVerb(Verb.None);
  w.act(Verb.Pick, C4.Cupboard.Brain);
  w.selectVerb(Verb.None);
  w.act(Verb.Pick, C4.Cupboard.Deodorant);
  expect(w.state.pickedObject).toBe(C4.Item.Deodorant);
  w.selectVerb(Verb.None);
  w.goTo(C4.Cupboard.Exit);
  w.goTo(C4.Study.DoorToCorridor);
  expect(w.room).toBe(27);
  // La cuisine, le garde-manger, l'armoire dégrippée : la farine, et Igor s'en va.
  w.goTo(C4.Corridor.DoorToKitchen);
  expect(w.room).toBe(29);
  w.act(Verb.Open, C4.Kitchen.DoorToPantry);
  w.goTo(C4.Kitchen.DoorToPantry);
  expect(w.room).toBe(30);
  w.act(Verb.Open, C4.Pantry.Wardrobe);
  expect(w.flags[C4.Flag.FlourTaken]).toBe(0); // les gonds sont rouillés
  w.useItem(C4.Item.Deodorant, C4.Pantry.Wardrobe);
  w.act(Verb.Open, C4.Pantry.Wardrobe, 60_000);
  expect(w.flags[C4.Flag.FlourTaken]).toBe(1);
  expect(w.flags[C4.Flag.Ready]).toBe(1);
  w.selectVerb(Verb.None);
}

/** Du garde-manger à la chambre d'Igor, la perruque, le déguisement, puis le palier avec la clé du salon. */
export function disguise(w: Walkthrough): void {
  w.goTo(C4.Pantry.DoorToKitchen);
  w.goTo(C4.Kitchen.DoorToCorridor);
  w.goTo(C4.Corridor.Stairs);
  expect(w.room).toBe(24);
  w.goTo(C4.Landing.DoorToBedroom);
  expect(w.room).toBe(26);
  w.act(Verb.Pick, C4.Bedroom.Wig);
  expect(w.state.inventory).toContain(C4.Item.Wig);
  w.goTo(C4.Bedroom.Door);
  expect(w.room).toBe(26); // Igor a fermé la porte à clé
  useOnHero(w, C4.Item.Wig);
  expect(w.room).toBe(24);
  expect(w.state.inventory).toContain(C4.Item.LivingRoomKey);
}

/** Du palier à la hache, puis à la branche et au grappin, jusqu'au pied du château. */
export function getTheGrapnel(w: Walkthrough): void {
  w.goTo(C4.Landing.Stairs);
  expect(w.room).toBe(27);
  w.useItem(C4.Item.LivingRoomKey, C4.Corridor.DoorToLivingRoom);
  w.goTo(C4.Corridor.DoorToLivingRoom);
  expect(w.room).toBe(31);
  w.act(Verb.Pick, C4.LivingRoom.Axe);
  expect(w.state.pickedObject).toBe(C4.Item.Axe);
  w.selectVerb(Verb.None);
  w.goTo(C4.LivingRoom.DoorToCorridor);
  w.goTo(C4.Corridor.Stairs);
  w.goTo(C4.Landing.DoorToHall);
  expect(w.room).toBe(23);
  w.act(Verb.Open, C4.Hall.DoorToOutside);
  w.goTo(C4.Hall.DoorToOutside);
  expect(w.room).toBe(21);
  w.goTo(C4.Outside.Tree);
  expect(w.room).toBe(22);
  w.useItem(C4.Item.Axe, C4.Tree.Branch);
  expect(w.state.pickedObject).toBe(C4.Item.Branch);
  w.selectVerb(Verb.None);
  w.goTo(C4.Tree.Exit);
  expect(w.room).toBe(21);
  w.combine(C4.Item.Branch, C4.Item.Rope);
  expect(w.state.pickedObject).toBe(C4.Item.Grapnel);
}

/** Chapitre 4 : de la corde au grappin sur le mur ; le chapitre 5 commence. Le `Walkthrough` est au début du chapitre 4. */
export function solveChapter4(w: Walkthrough): void {
  intoTheCastle(w);
  gatherTheDisguise(w);
  disguise(w);
  getTheGrapnel(w);
  w.selectVerb(Verb.None);
  climb(w);
}

/**
 * Le dialogue 11 de Drascula qui ouvre le chapitre 6 (`animation_1_6`) : les choix `choices` dans l'ordre (tous, par défaut), puis
 * le héros est ligoté sous le pendule (pièce 102).
 */
export function playChapter6Intro(w: Walkthrough, choices: readonly number[] = [0, 1, 2, 3]): void {
  w.waitForChoices();
  for (const n of choices) if (!w.choose(n)) break;
  w.settle(60_000);
}

/** Chapitre 6 : la lame, la torche, le piano, le barman, le verre à Drascula, le pieu : la fin du jeu. Le `Walkthrough` a fini l'introduction du chapitre 6 (`playChapter6Intro`, pièce 102). */
export function solveChapter6(w: Walkthrough): void {
  expect(w.state.chapter).toBe(6);
  expect(w.room).toBe(102);
  expect(w.flags[C6.Flag.Free]).toBe(0);

  // Le cachot : la lame, puis les liens coupés sur le pendule.
  w.act(Verb.Pick, C6.Dungeon.Reach);
  expect(w.state.pickedObject).toBe(C6.Item.Blade);
  w.useItem(C6.Item.Blade, C6.Dungeon.Pendulum, 60_000);
  expect(w.room).toBe(58);
  expect(w.flags[C6.Flag.Free]).toBe(1);
  expect(w.state.inventory).not.toContain(C6.Item.Blade);

  // Le couloir : la porte dérobée est fermée jusqu'à ce que la torche soit poussée.
  w.goTo(C6.Corridor.SecretDoor);
  expect(w.room).toBe(58);
  w.act(Verb.Move, C6.Corridor.Torch);
  expect(w.flags[C6.Flag.TorchMoved]).toBe(1);
  w.selectVerb(Verb.None);
  w.goTo(C6.Corridor.SecretDoor);
  expect(w.room).toBe(59);

  // La chambre de B.J. (le téléphone est facultatif), puis la taverne.
  w.goTo(C6.Bedroom.Door);
  expect(w.room).toBe(60);

  // La taverne : le piano, puis le barman jusqu'à ce qu'il donne l'objet 21.
  w.act(Verb.Move, C6.Tavern.Piano);
  expect(w.flags[C6.Flag.PianoMoved]).toBe(1);
  w.selectVerb(Verb.Talk);
  const barman = w.pointOf(C6.Tavern.Barman);
  w.player.click(barman.x, barman.y);
  w.waitForChoices();
  expect(w.engine.choices?.phrases[2]).toBe(w.engine.data.text("text", 273));
  expect(w.choose(2)).toBe(false); // la réponse 14 donne l'objet et ferme le dialogue (`breakOut`)
  w.settle();
  expect(w.state.inventory).toContain(C6.Item.Drink);
  expect(w.flags[C6.Flag.DrinkGiven]).toBe(1);

  // Drascula boit, puis l'objet 9 : la fin du jeu.
  w.useItem(C6.Item.Drink, C6.Tavern.Drascula, 60_000);
  expect(w.flags[C6.Flag.DrasculaDrank]).toBe(1);
  expect(w.host.exits).toBe(0);
  const mark = w.mark();
  w.useItem(C6.Item.Stake, C6.Tavern.Drascula, 100_000);
  expect(w.host.exits).toBe(1);
  expect(w.engine.ended).toBe(true);
  const voices = w.voices(mark);
  for (const voice of ["bj24.als", "bj28.als", "296.als", "301.als"]) expect(voices, voice).toContain(voice);
  expect(w.state.chapter).toBe(6);
}

/** Les solutions dans l'ordre du jeu, chacune au début de son chapitre. */
export const SOLUTIONS = [solveChapter1, solveChapter2, solveChapter3, solveChapter4, solveChapter5] as const;
