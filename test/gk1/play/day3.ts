/**
 * Jour 3 de Gabriel Knight, du matin dans la librairie au matin du jour 4.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés. Ce que les scripts exigent pour finir la journée
 * (`IconMap::endDay`, script 20, vérifié à l'ouverture d'une carte ; la boutique ferme à l'entrée suivante) :
 * - l'objet 8, `wolfPhone` : le numéro de Wolfgang Ritter, que Grace donne après son deuxième message du matin ;
 * - l'objet 38, `reconVeve` : le motif reconstitué par l'artiste du square (`sGetReconVeve`, script 410) ;
 * - le drapeau **21** : l'interrogatoire télévisé que Gabriel interrompt chez Mosely (`crashInterview`, script 240) ;
 * - le drapeau **265** : la rencontre de Malia au cimetière (`sCartoon`, script 320, en venant de la pièce 310). Le
 *   cimetière n'arrive sur la carte qu'avec le drapeau 77, posé par le docteur John (`drJohn::cue`, script 1053, sujet 89 :
 *   « Marie Laveau » plusieurs fois, sujet ouvert par « L'histoire du Vaudouisme » cinq fois) ;
 * - le drapeau **256** : le moule du bracelet montré à Sam au bar Napoléon (`showMold`, script 460). Trois chaînes :
 *   - le moule se prend à l'argile sur le bracelet de Madame Cazaunoux (`useTheClay`, script 280), qui n'ouvre qu'à un
 *     prêtre (`putTheDisguiseOn`, script 270 : chemise et col de la sacristie, script 457, gel de la salle de bains,
 *     script 220). Sa maison n'arrive sur la carte qu'avec le drapeau 266, que pose la clinique vétérinaire au téléphone
 *     (`vetTeller::cue`, script 221) quand Gabriel connaît le nom du chien (drapeau 316, `callCaz`). Elle ne montre le
 *     bracelet qu'après le sujet « Lieu de culte Vaudou » (`cazaunoux::cue`, script 1055 : drapeau 67), qui suit « Les
 *     véritables Reines Vaudous », « Sacrifice humain » et la bonne réponse à sa question sur « Cabrit Sans Cor' ». Cette
 *     réponse n'est proposée qu'à qui tient le sens du mot de Hartridge (`hartridge::cue`, sujet 6), sujet commun visible
 *     avec le drapeau 42, posé quand Willy voit la photo du meurtre (`willy::doVerb`, script 250) ;
 *   - Sam n'accepte le moule qu'après avoir gagné aux échecs (`sam::doVerb` : drapeau 255, `useTheOil`), grâce à l'huile
 *     que Willy offre avec le masque de crocodile (`willyGetYourMask`, script 250 : cent dollars). Sam n'écoute le
 *     boniment (`pitchTheOil`) que si le barman a parlé de lui (`bartender::cue`, script 1052 : sujets 111 et 113, « Le
 *     Vaudouisme » une fois, « Des barmans » deux fois) ;
 *   - les cent dollars viennent du tableau du père de Gabriel, que Bruno vient acheter à la librairie (`enterFlorist`,
 *     script 211, quinze secondes après l'entrée) dès que Willy a donné son prix (drapeau 35, sujet « Willy Jr. » deux
 *     fois). Ce sujet suit « Des Masques d'animaux », sujet commun visible avec le drapeau 45, posé par la conférence de
 *     Hartridge à Tulane (`attendLecture`, script 330 ; Tulane est sur la carte depuis le journal du matin, drapeau 14).
 *
 * Les verbes des portes sont ceux des scripts : la porte du musée, celle du bureau de Hartridge et la sortie du salon de
 * Madame Cazaunoux ne répondent qu'au curseur « marcher » (13) ; Gabriel assis chez Hartridge se lève au premier clic et
 * sort au second (`officeDoor::doVerb`, script 340).
 */
import { Room, endInterrogation, interrogate } from "./day1";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room3 = {
  Studio: 220,
  MoselyOffice: 240,
  DrugStore: 250,
  VoodooMuseum: 260,
  CazaunouxDoor: 270,
  CazaunouxParlor: 280,
  CemeteryLaveau: 300,
  CemeteryMiddle: 310,
  CemeteryGedde: 320,
  LectureHall: 330,
  HartridgeOffice: 340,
  JacksonNorthEast: 410,
  Cathedral: 450,
  Sacristy: 457,
  NapoleonHouse: 460,
} as const;

/** Drapeaux du jeu que le jour 3 pose (voir l'en-tête). */
export const Flag3 = {
  TulaneOnMap: 14,
  CrashedInterview: 21,
  WillyNamedHisPrice: 35,
  WillySawPhoto: 42,
  HeardLecture: 45,
  SawBracelet: 67,
  CemeteryOnMap: 77,
  SamWonAtChess: 255,
  ShowedMold: 256,
  MetMaliaAtCemetery: 265,
  CazaunouxOnMap: 266,
  PaintingSold: 289,
  KnowsDogName: 316,
} as const;

/** Numéros de la page d'annuaire (`dialThePhone::init`, script 221) : Madame Cazaunoux, puis la clinique vétérinaire. */
const CAZAUNOUX_NUMBER = "5551280";
const VET_NUMBER = "5556170";

/** Touches du téléphone de Gabriel dans son gros plan (pièce 220) : MARCHE, puis les chiffres en trois colonnes. */
const PHONE_KEYS: Readonly<Record<string, { x: number; y: number }>> = {
  on: { x: 72, y: 47 },
  "1": { x: 72, y: 68 },
  "2": { x: 99, y: 68 },
  "3": { x: 127, y: 68 },
  "4": { x: 72, y: 87 },
  "5": { x: 99, y: 87 },
  "6": { x: 127, y: 87 },
  "7": { x: 72, y: 106 },
  "8": { x: 99, y: 106 },
  "9": { x: 127, y: 106 },
  "0": { x: 99, y: 126 },
};

/** Décroche le téléphone, compose un numéro et rend ce qui se dit jusqu'à un menu ou la fin de l'appel. */
export function dial(play: Play, number: string): string[] {
  play.use(Verb.Operate, "phone");
  if (!play.insetOpen()) play.fail("le clavier du téléphone n'est pas à l'écran");
  for (const key of ["on", ...number]) {
    play.click(PHONE_KEYS[key].x, PHONE_KEYS[key].y);
    play.step(25);
  }
  return play.playUntil(() => play.menu().length > 0 || (play.inControl() && play.texts().length === 0 && !play.insetOpen()), 9000, `l'appel au ${number}`);
}

/** Agit sur une porte et attend la pièce suivante (une carte ne rend pas la main : on n'attend que la pièce). */
export function through(play: Play, verb: number, door: string, to: number): void {
  play.use(verb, door, { settle: false });
  play.playUntil(() => play.room() === to, 3000, `la pièce ${to}`);
  if (to !== Room.CityMap && to !== Room.GreaterMap) play.skipText();
}

/** Choisit un bouton d'une fenêtre de répliques (pas un interrogatoire) et attend le bouton suivant ou la fin de la scène. */
export function answer(play: Play, text: string, maxFrames = 20_000): string[] {
  return play.talkTopic(text, () => play.menu().length > 0 || play.inControl(), maxFrames);
}

export const DAY3_START: readonly Stage[] = [
  {
    name: "j3-matin",
    title: "le journal, le numéro de Ritter, puis le téléphone : Madame Cazaunoux, la clinique vétérinaire",
    score: 67,
    run(play) {
      if (play.day() !== 3 || play.room() !== Room.Bookshop) play.fail("l'étape part de la librairie, le matin du jour 3");
      const paper = play.use(Verb.Pickup, "newsPaper");
      if (!paper[0]?.startsWith("Le Times du 20 Juin 1993")) play.fail("ce n'est pas le journal du jour 3");
      // Grace : Mosely interroge un suspect ce matin ; Wolfgang Ritter a rappelé, elle a son numéro (remis en sortant).
      interrogate(play, "graceProp");
      play.talkTopic("Messages");
      play.talkTopic("Autres messages");
      play.talkTopic("Numéro de téléphone de Ritter");
      endInterrogation(play, Room.Bookshop);
      if (!play.carried().includes("wolfPhone")) play.fail("Grace n'a pas donné le numéro de Ritter");
      // Le studio de Gabriel, derrière le rideau : le gel de la salle de bains, et le téléphone.
      play.use(Verb.Operate, "xcurtainDoor", { settle: false });
      play.playUntil(() => play.room() === Room3.Studio, 3000, "le studio");
      play.skipText();
      play.use(Verb.Pickup, "theHairGel");
      if (!play.carried().includes("hair gel")) play.fail("le gel n'est pas pris");
      // Madame Cazaunoux raccroche vite, mais elle a nommé son chien : Castro.
      const caz = dial(play, CAZAUNOUX_NUMBER);
      if (!caz.some((text) => text.includes("Castro")) || !play.flag(Flag3.KnowsDogName)) play.fail("Madame Cazaunoux n'a pas nommé son chien");
      play.skipText();
      // La clinique ne donne l'adresse qu'à qui s'inquiète de Castro : la maison arrive sur la carte.
      dial(play, VET_NUMBER);
      play.talkTopic("Avez-vous une cliente au nom de Madame Cazaunoux?");
      play.talkTopic("\"Je suis inquiet au sujet de Castro. Il a raté trois leçons de danse.\"", () => play.inControl());
      play.skipText();
      if (!play.flag(Flag3.CazaunouxOnMap)) play.fail("la clinique n'a pas donné l'adresse de Madame Cazaunoux");
      play.use(Verb.Operate, "curtainDoor", { settle: false });
      play.playUntil(() => play.room() === Room.Bookshop, 3000, "la librairie");
      play.skipText();
      play.use(Verb.Operate, "shopDoor", { settle: false });
      play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
    },
  },
  {
    name: "j3-cathedrale",
    title: "cathédrale Saint-Louis : la chemise noire et le col de prêtre ; square : le motif reconstitué par l'artiste",
    score: 70,
    run(play) {
      play.travel("louisCath");
      play.skipText();
      play.use(Verb.Operate, "priestDoor", { settle: false });
      play.playUntil(() => play.room() === Room3.Sacristy, 3000, "la sacristie");
      play.skipText();
      // La chemise noire (1 point), puis un col dans la boîte (1 point) : les deux font le déguisement de prêtre.
      play.use(Verb.Pickup, "shirt");
      play.use(Verb.Pickup, "box");
      if (!play.carried().includes("disguise")) play.fail("le déguisement de prêtre n'est pas fait");
      play.leave({ x: 160, y: 150 });
      if (play.room() !== Room3.Cathedral) play.fail("la sacristie ne ramène pas dans la nef");
      // Le parvis donne sur le coin nord-ouest du square, où Lorelei danse aujourd'hui.
      play.leave("southExit");
      play.skipText();
      if (play.room() !== Room.JacksonNorthWest) play.fail("la cathédrale ne donne pas sur le square");
      // L'artiste a fini : le motif reconstitué (objet exigé pour finir la journée).
      play.leave("eastExit");
      play.skipText();
      play.use(Verb.Talk, "artist");
      if (!play.carried().includes("reconVeve ")) play.fail(`l'artiste n'a pas remis le motif (Gabriel porte : ${play.carried().join(", ")})`);
      play.leave("southExit");
      play.leave("southExit");
      if (play.room() !== Room.CityMap) play.fail("la sortie sud du square ne mène pas à la carte");
    },
  },
];

/** Le reste de la journée, de la carte du Quartier Français au matin du jour 4. */
export const DAY3_ERRANDS: readonly Stage[] = [
  {
    name: "j3-musee",
    title: "musée du vaudou : le docteur John parle de Magentia Moonbeam et de la tombe de Marie Laveau (le cimetière)",
    score: 76,
    run(play) {
      play.travel("voodooMus");
      play.skipText();
      interrogate(play, "drJohn");
      play.talkTopic("Vaudouisme");
      // « Le Vaudouisme actuel » deux fois : il envoie chez Magentia Moonbeam (2 points).
      play.talkTopic("Le Vaudouisme actuel");
      play.talkTopic("Le Vaudouisme actuel");
      // « L'histoire du Vaudouisme » cinq fois : il en vient à Marie Laveau (2 points), qui devient un sujet.
      for (let i = 0; i < 5; i++) play.talkTopic("L'histoire du Vaudouisme");
      // « Marie Laveau », jusqu'à sa tombe au cimetière Saint-Louis, ouvert au public (2 points, drapeau 77).
      for (let i = 0; i < 6 && !play.flag(Flag3.CemeteryOnMap); i++) play.talkTopic("Marie Laveau");
      if (!play.flag(Flag3.CemeteryOnMap)) play.fail("le docteur John n'a pas parlé du cimetière");
      endInterrogation(play, Room3.VoodooMuseum);
      through(play, Verb.Walk, "doorWay", Room.CityMap);
    },
  },
  {
    name: "j3-tulane",
    title: "pharmacie : la photo du meurtre à Willy ; Tulane : la conférence, le motif et « Cabrit Sans Cor' » chez Hartridge",
    score: 83,
    run(play) {
      // Willy pâlit devant la photo (2 points) : « Cabrit Sans Cor' » devient un sujet pour tout le monde.
      play.travel("voodooShop");
      play.skipText();
      play.useItem("murderPhoto", "willy");
      if (!play.flag(Flag3.WillySawPhoto)) play.fail("Willy n'a pas vu la photo du meurtre");
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      // La conférence de Hartridge se joue seule à l'arrivée (2 points) : les masques d'animaux deviennent un sujet.
      play.travel("greatNO1");
      play.travel("tulane");
      const lecture = play.skipText(40_000);
      if (play.room() !== Room3.LectureHall || !play.flag(Flag3.HeardLecture)) play.fail("la conférence n'a pas eu lieu");
      if (!lecture.some((text) => text.includes("la conférence est finie"))) play.fail("Hartridge n'a pas réveillé Gabriel");
      through(play, Verb.Operate, "smallDoor", Room3.HartridgeOffice);
      // Le motif reconstitué (2 points) : Hartridge l'étudiera, Gabriel s'assoit et garde son exemplaire (exigé le soir).
      play.useItem("reconVeve ", "hartrige");
      if (!play.carried().includes("reconVeve ")) play.fail("Gabriel n'a plus le motif reconstitué");
      interrogate(play, "hartrige");
      const meaning = play.talkTopic("Cabrit Sans Cor'");
      if (!meaning.some((text) => text.includes("cela veut dire un humain"))) play.fail("Hartridge n'a pas traduit « cabrit sans cor' »");
      endInterrogation(play, Room3.HartridgeOffice);
      // Assis, Gabriel se lève au premier clic sur la porte et sort au second.
      play.use(Verb.Walk, "officeDoor");
      through(play, Verb.Walk, "officeDoor", Room3.LectureHall);
      through(play, Verb.Operate, "doors", Room.GreaterMap);
      play.travel("frenchQ");
    },
  },
  {
    name: "j3-tableau",
    title: "pharmacie : le prix de Willy Jr. ; librairie : le tableau vendu à Bruno ; pharmacie : le masque et l'huile offerte",
    score: 89,
    run(play) {
      play.travel("voodooShop");
      play.skipText();
      interrogate(play, "willy");
      play.talkTopic("Des Masques d'animaux");
      // Le masque de crocodile : cent dollars (2 points), et pas un de moins à la deuxième demande.
      play.talkTopic("Willy Jr.");
      play.talkTopic("Willy Jr.");
      if (!play.flag(Flag3.WillyNamedHisPrice)) play.fail("Willy n'a pas donné le prix du masque");
      endInterrogation(play, Room3.DrugStore);
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      // Bruno entre de lui-même, un quart de minute après Gabriel, et offre cent dollars du tableau (2 points).
      play.travel("bookStore");
      play.skipText();
      const bruno = play.playUntil(() => play.menu().length > 0, 9000, "l'arrivée de Bruno");
      if (!bruno.some((text) => text.includes("tableau"))) play.fail("Bruno n'a pas parlé du tableau");
      answer(play, "Combien tu me donnerais pour ça?");
      answer(play, "Ne te mêle pas de ça, Grace.");
      answer(play, "D'accord. C'est à toi.");
      play.skipText();
      if (!play.carried().includes("hundred") || !play.flag(Flag3.PaintingSold)) play.fail("le tableau n'est pas vendu");
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      // Willy décroche le masque et offre l'huile « Maître de Jeu » (2 points).
      play.travel("voodooShop");
      play.skipText();
      play.useItem("hundred", "willy");
      play.skipText();
      for (const item of ["crocMask", "oil"]) if (!play.carried().includes(item)) play.fail(`Willy n'a pas donné « ${item} »`);
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
    },
  },
  {
    name: "j3-cazaunoux",
    title: "Madame Cazaunoux : le Père Maclaughlin, le sens de « cabrit sans cor' », le bracelet moulé dans l'argile",
    score: 97,
    run(play) {
      play.travel("cazaunoux");
      play.skipText();
      // La chemise et le col (1 point), le gel (1 point) : elle n'ouvre qu'à un prêtre (1 point).
      play.useItem("disguise", "GKEgo");
      play.useItem("hair gel", "GKEgo");
      play.use(Verb.Operate, "whatKnockers", { settle: false });
      play.playUntil(() => play.menu().length > 0, 6000, "la voix de Madame Cazaunoux");
      play.talkTopic("C'est le Père Maclaughlin qui veut vous voir.", () => play.room() === Room3.CazaunouxParlor && play.inControl(), 30_000);
      play.skipText();
      interrogate(play, "cazaunoux");
      play.talkTopic("Cabrit Sans Cor'");
      // La bonne réponse (2 points) ouvre les sujets suivants, jusqu'au lieu de culte : elle montre son bracelet (1 point).
      play.talkTopic("Ca veut dire \"bouc sans corne.\"");
      play.talkTopic("Sacrifice humain");
      play.talkTopic("Les véritables Reines Vaudous");
      play.talkTopic("Lieu de culte Vaudou", () => play.room() === Room3.CazaunouxParlor && play.insetOpen(), 30_000);
      play.skipText();
      if (!play.insetOpen()) play.fail("le bracelet n'est pas montré en gros plan");
      // L'argile sur le bracelet, sous couvert d'une bénédiction (2 points) : le moule.
      play.useItem("clay", "braceletFeature");
      play.skipText();
      if (!play.carried().includes("braceMold ")) play.fail(`le moule n'est pas pris (Gabriel porte : ${play.carried().join(", ")})`);
      through(play, Verb.Walk, "myExitFeature", Room3.CazaunouxDoor);
      // Le bas de la rue ramène à la carte.
      play.selectVerb(Verb.Walk);
      play.click(160, 185);
      play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
    },
  },
  {
    name: "j3-napoleon",
    title: "bar Napoléon : le barman parle de Sam, l'huile lui fait gagner sa partie d'échecs, il prend le moule du bracelet",
    score: 101,
    run(play) {
      play.travel("napHouse");
      play.skipText();
      interrogate(play, "bartender");
      play.talkTopic("Le Vaudouisme");
      play.talkTopic("Des barmans");
      play.talkTopic("Des barmans");
      endInterrogation(play, Room3.NapoleonHouse);
      // Le boniment (1 point) : vanter l'huile, puis piquer Sam au vif. Il bat Markus (2 points).
      play.useItem("oil", "sam", { settle: false });
      play.playUntil(() => play.menu().length > 0, 6000, "le boniment de l'huile");
      answer(play, "C'est de l'huile vaudou très puissante.");
      const game = answer(play, "Tu ne t'es jamais demandé pourquoi Markus gagnait à chaque fois?", 40_000);
      play.skipText(40_000);
      if (!play.flag(Flag3.SamWonAtChess) || !game.some((text) => text.includes("Jolie partie"))) play.fail("Sam n'a pas gagné sa partie");
      // Sam fera une copie du bracelet pour demain (1 point).
      play.useItem("braceMold ", "sam");
      if (!play.flag(Flag3.ShowedMold)) play.fail("Sam n'a pas pris le moule");
      through(play, Verb.Operate, "wayOut", Room.CityMap);
    },
  },
  {
    name: "j3-commissariat",
    title: "commissariat : Gabriel interrompt l'interrogatoire filmé du suspect ; Mosely reprend son insigne",
    score: 103,
    run(play) {
      play.travel("policeLobby");
      play.skipText();
      interrogate(play, "deskSarg");
      play.talkTopic("Détective Mosely");
      endInterrogation(play, Room.PoliceLobby);
      play.use(Verb.Operate, "mosDoor", { settle: false });
      play.playUntil(() => play.room() === Room3.MoselyOffice, 3000, "le bureau de Mosely");
      const scene = play.skipText(40_000);
      if (!play.flag(Flag3.CrashedInterview) || !scene.some((text) => text.includes("24h"))) play.fail("l'interrogatoire n'a pas été interrompu");
      if (play.carried().includes("badge")) play.fail("Mosely n'a pas repris son insigne");
      through(play, Verb.Operate, "officeDoor", Room.PoliceLobby);
      through(play, Verb.Operate, "extDoor", Room.CityMap);
    },
  },
  {
    name: "j3-cimetiere",
    title: "cimetière Saint-Louis : les signes de la tombe de Marie Laveau copiés, Malia devant le tombeau des Gedde ; la nuit",
    score: 107,
    run(play) {
      play.travel("cemetery");
      play.skipText();
      // Les signes à la craie sur la tombe : en gros plan, le carnet de croquis les copie (2 points).
      play.use(Verb.Look, "message1");
      if (!play.insetOpen()) play.fail("les signes de la tombe ne sont pas en gros plan");
      play.useItem("sketchBook", "theInView");
      if (play.insetOpen()) play.closeInset();
      play.skipText();
      if (!play.carried().includes("VoodooCode1")) play.fail("les signes ne sont pas copiés");
      // Deux allées plus à l'est, Malia se recueille devant le tombeau de sa famille (2 points).
      play.leave("eastExit");
      if (play.room() !== Room3.CemeteryMiddle) play.fail("l'allée de l'est ne mène pas au milieu du cimetière");
      play.leave("eastExit", 40_000);
      if (play.room() !== Room3.CemeteryGedde || !play.flag(Flag3.MetMaliaAtCemetery)) play.fail("Malia n'était pas au tombeau des Gedde");
      play.leave("westExit");
      play.leave("westExit");
      // Les cinq conditions sont réunies : la carte marque la fin de la journée, et la librairie est fermée quand Gabriel
      // y rentre (un client de dernière minute, la nuit, le carton « Jour 4 », le matin).
      play.leave("westExit");
      if (play.room() !== Room.CityMap) play.fail("la sortie du cimetière ne mène pas à la carte");
      play.travel("bookStore");
      play.playUntil(() => play.day() === 4 && play.room() === Room.Bookshop && play.inControl() && play.texts().length === 0, 80_000, "le matin du jour 4");
      play.skipText();
    },
  },
];

/** Le jour 3 entier, du matin dans la librairie au matin du jour 4. */
export const DAY3: readonly Stage[] = [...DAY3_START, ...DAY3_ERRANDS];
