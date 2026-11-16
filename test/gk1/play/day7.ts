/**
 * Jour 7 de Gabriel Knight, du réveil dans le studio au réveil du jour 8 à Schloss Ritter.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés. Le jour 7 ne finit pas par `IconMap::endDay` : c'est la
 * cérémonie d'initiation de la chapelle (`doTheRitual`, script 540) qui mène au carton du château (`endTheDay`,
 * script 500), au rêve du dragon (script 550, qui passe au jour 8) et au réveil dans la chambre (`wakeUp`, script 530).
 * - L'aéroport n'est sur la carte qu'une fois le billet réservé (drapeau **269**, `travelAgentTeller::cue`, script 221) :
 *   l'agence de voyage répond au 585-1130 (quatrième numéro du téléphone, `dialThePhone::init`), et la réplique « Je règle
 *   par carte de crédit. » demande la carte de Mosely (`master card`, dans son portefeuille).
 * - Le portefeuille est dans le tombeau des Gedde (script 325) : la plaque près de la porte (`flap::doVerb`, script 320)
 *   ne se soulève qu'au jour 7 et si Wolfgang a parlé du pays natal de Tetelo (drapeau **176**, posé par les points de
 *   `wolfgang::cue`, script 1056 : « Tetelo », « Talisman » deux fois, « La dépouille de Tetelo », « Le pays natal en
 *   Afrique »). Dans le noir, la lampe de poche du studio (`lit flash`) sert de curseur : un clic déplace son faisceau, les
 *   verbes s'appliquent à ce qu'il éclaire. Le casier au vévé contient Mosely ; Gabriel est assommé, le corps disparaît, le
 *   portefeuille reste.
 * - Au château, la cérémonie demande que Gerde ait dit ce que montrent les panneaux de la chapelle (drapeau **261**,
 *   `gerde::cue`, script 1057 : regarder un panneau pose le drapeau 304 et ouvre le sujet « Les Panneaux de la Chapelle »,
 *   qui ouvre « Cérémonie d'initiation »). Puis, panneau par panneau : les mains lavées dans la neige de la fenêtre, les
 *   cheveux coupés, le pot de chambre sur l'autel et le sel dedans, le bras entaillé à la dague, Gabriel à genoux, le
 *   manuscrit lu.
 */
import { Room, endInterrogation, interrogate } from "./day1";
import { Room3, answer, dial, through } from "./day3";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room7 = {
  GeddeTomb: 325,
  CastleCard: 500,
  GreatHall: 510,
  Library: 520,
  Bedroom: 530,
  Chapel: 540,
  Dream: 550,
  Flight: 750,
} as const;

/** Drapeaux du jeu que le jour 7 pose (voir l'en-tête). */
export const Flag7 = {
  TeteloHomeland: 176,
  KnowsCeremony: 261,
  TicketBooked: 269,
  SawPanels: 304,
  FlashlightLit: 416,
} as const;

/** L'agence de voyage (`dialThePhone::init`, script 221). */
const TRAVEL_AGENCY = "5851130";
/** Schloss Ritter, déjà appelé au jour 4. */
const SCHLOSS_RITTER = "49093243333";
/** Le casier au vévé du tombeau des Gedde, là où le faisceau de la lampe se pose quand on l'allume. */
const VEVE_DRAWER = { x: 160, y: 95 };

/** Les six panneaux de la chapelle, dans l'ordre de la cérémonie. */
const PANELS = ["washHandsPanel", "cutHairPanel", "getPotPanel", "bloodPanel", "kneelPanel", "scrollPanel"] as const;

/** Applique un verbe à ce que le faisceau de la lampe éclaire (le tombeau n'a pas d'objets nommés dans le noir). */
function onBeam(play: Play, verb: number): string[] {
  play.selectVerb(verb);
  play.click(VEVE_DRAWER.x, VEVE_DRAWER.y);
  return play.skipText();
}

export const DAY7: readonly Stage[] = [
  {
    name: "j7-matin",
    title: "la lampe de poche ; Wolfgang au téléphone : le talisman et le pays natal de Tetelo ; le journal",
    score: 200,
    run(play) {
      if (play.day() !== 7 || play.room() !== Room3.Studio) play.fail("l'étape part du studio, au réveil du jour 7");
      // La lampe de poche, sur l'étagère près du lit (1 point).
      play.use(Verb.Pickup, "theFlashLight");
      if (!play.carried().includes("lit flash")) play.fail("Gabriel n'a pas la lampe de poche");
      // Wolfgang : l'appel ouvre un interrogatoire ; le sujet de Tetelo mène, de réponse en réponse, à l'Afrique (3 points).
      const call = dial(play, SCHLOSS_RITTER);
      if (play.room() !== Room.Interrogation || !call.some((text) => text.includes("C'est encore pire"))) play.fail("Wolfgang ne répond pas");
      play.talkTopic("Tetelo");
      play.talkTopic("Talisman");
      play.talkTopic("Talisman");
      play.talkTopic("La dépouille de Tetelo");
      // La dernière réponse clôt l'appel : Wolfgang part pour l'Afrique.
      const bye = play.talkTopic("Le pays natal en Afrique", () => play.room() === Room3.Studio && play.inControl(), 40_000);
      if (!play.flag(Flag7.TeteloHomeland) || !bye.some((text) => text.includes("Au revoir, Oncle Wolfgang"))) play.fail("Wolfgang n'a pas parlé du pays natal de Tetelo");
      play.skipText();
      through(play, Verb.Operate, "curtainDoor", Room.Bookshop);
      // Le journal du 24 juin : l'horoscope de Gabriel (1 point).
      const paper = play.use(Verb.Pickup, "newsPaper");
      if (!paper.some((text) => text.includes("horoscope de Gabriel"))) play.fail("ce n'est pas le journal du jour 7");
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
    },
  },
  {
    name: "j7-tombe",
    title: "le tombeau des Gedde à la lampe de poche : Mosely dans le casier au vévé, Gabriel assommé, le portefeuille",
    score: 208,
    run(play) {
      play.travel("cemetery");
      play.skipText();
      play.leave("eastExit");
      play.skipText();
      play.leave("eastExit");
      play.skipText();
      if (play.room() !== Room3.CemeteryGedde) play.fail("Gabriel n'est pas devant le tombeau des Gedde");
      // La plaque de marbre est soulevée : dessous, une manette (2 points) ; un bruit de verre, et Gabriel est dans le tombeau.
      const flap = play.use(Verb.Look, "flap");
      if (!flap.some((text) => text.includes("manette"))) play.fail("la plaque du tombeau n'est pas soulevée");
      play.use(Verb.Operate, "flap", { settle: false });
      play.playUntil(() => play.room() === Room7.GeddeTomb && play.inControl(), 3000, "le tombeau des Gedde");
      play.skipText();
      // La lampe de poche (1 point) : son faisceau se pose sur le casier au vévé.
      play.useItem("lit flash", "le tombeau", { at: { x: 160, y: 100 } });
      if (!play.flag(Flag7.FlashlightLit) || !play.present("torch")) play.fail("la lampe de poche n'éclaire pas le tombeau");
      const drawer = onBeam(play, Verb.Look);
      if (!drawer.some((text) => text.includes("vévé"))) play.fail("le faisceau n'est pas sur le casier au vévé");
      // Le casier ouvert : Mosely, « mort » ; la lampe tombe, Gabriel est assommé (2 points).
      const found = onBeam(play, Verb.Open);
      if (!found.includes('"Mosely!"') || !found.some((text) => text.includes("Ma tête"))) play.fail("Gabriel n'a pas trouvé Mosely");
      // Rouvert : le corps a disparu, le portefeuille est resté (2 points) ; dedans, la carte de crédit (1 point).
      onBeam(play, Verb.Open);
      play.use(Verb.Pickup, "walletView");
      if (play.insetOpen()) play.closeInset();
      play.skipText();
      const wallet = play.inventory("wallet", "open");
      if (!play.carried().includes("master card") || !wallet.some((text) => text.includes("carte de crédit"))) play.fail("le portefeuille n'a pas donné la carte de Mosely");
      // Le bouton près de la porte rouvre le tombeau.
      play.use(Verb.Operate, "exitButton", { settle: false });
      play.playUntil(() => play.room() === Room3.CemeteryGedde && play.inControl(), 3000, "la sortie du tombeau");
      play.skipText();
      for (let i = 0; i < 3; i++) {
        play.leave("westExit");
        if (play.room() !== Room.CityMap) play.skipText();
      }
      if (play.room() !== Room.CityMap) play.fail("le cimetière ne ramène pas à la carte");
    },
  },
  {
    name: "j7-billet",
    title: "le billet pour Munich payé avec la carte de Mosely ; l'aéroport, l'arrivée à Schloss Ritter",
    score: 213,
    run(play) {
      // Grace s'inquiète : Wolfgang a rappelé, Gabriel doit quitter La Nouvelle-Orléans.
      play.travel("bookStore");
      const grace = play.skipText();
      if (!grace.some((text) => text.includes("tu DOIS quitter la Nouvelle Orléans"))) play.fail("Grace n'a pas accueilli Gabriel");
      through(play, Verb.Operate, "xcurtainDoor", Room3.Studio);
      // L'agence de voyage : 1400 dollars pour Munich, réglés avec la carte de Mosely (5 points).
      const agency = dial(play, TRAVEL_AGENCY);
      if (!agency.some((text) => text.includes("World Travel Agency"))) play.fail("l'agence de voyage ne répond pas");
      answer(play, `"Combien pour aller à Rittersberg, Allemagne?"`, 40_000);
      const paid = answer(play, `"Je règle par carte de crédit."`, 40_000);
      play.skipText();
      if (!play.flag(Flag7.TicketBooked) || !paid.some((text) => text.includes("le numéro de la carte de Mosely"))) play.fail("le billet n'est pas réservé");
      through(play, Verb.Operate, "curtainDoor", Room.Bookshop);
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      // L'aéroport est sur la carte du grand La Nouvelle-Orléans : le vol (pièce 750), le carton du château, Gerde à la porte.
      play.travel("greatNO1");
      play.travel("airport");
      const arrival = play.playUntil(() => play.room() === Room7.GreatHall && play.inControl() && play.texts().length === 0, 20_000, "l'arrivée à Schloss Ritter");
      if (!arrival.some((text) => text.includes("m'appeler Gerde"))) play.fail("Gerde n'a pas accueilli Gabriel");
    },
  },
  {
    name: "j7-chateau",
    title: "Schloss Ritter : les panneaux de la chapelle, Gerde, la dague et le sel, la chambre, la cérémonie d'initiation ; le rêve, réveil du jour 8",
    score: 226,
    run(play) {
      // La chapelle : un premier regard sur un panneau, que Gabriel ne comprend pas.
      through(play, Verb.Walk, "arch", Room7.Chapel);
      play.use(Verb.Look, PANELS[0]);
      if (!play.flag(Flag7.SawPanels)) play.fail("Gabriel n'a pas vu les panneaux");
      play.selectVerb(Verb.Walk);
      play.click(159, 160);
      play.playUntil(() => play.room() === Room7.GreatHall && play.inControl(), 3000, "le retour dans la grande salle");
      play.skipText();
      // Gerde : les panneaux décrivent la cérémonie d'initiation du Schattenjäger (1 point).
      interrogate(play, "gerde");
      play.talkTopic("Les Panneaux de la Chapelle");
      play.talkTopic("Cérémonie d'initiation");
      endInterrogation(play, Room7.GreatHall);
      if (!play.flag(Flag7.KnowsCeremony)) play.fail("Gerde n'a pas parlé de la cérémonie");
      // La dague des Schattenjäger au mur (1 point), la salière de Gerde (1 point).
      play.use(Verb.Pickup, "knife");
      play.use(Verb.Pickup, "theSalt");
      // La chambre de Wolfgang : ciseaux, pot de chambre, manuscrit (1 point chacun).
      play.use(Verb.Walk, "stairs", { settle: false });
      play.playUntil(() => play.room() === Room7.Bedroom, 3000, "la chambre de Wolfgang");
      play.skipText();
      play.use(Verb.Pickup, "theScissors");
      play.use(Verb.Pickup, "theChamberPot");
      play.use(Verb.Open, "displayCase");
      for (const item of ["knife", "salt", "scissors", "chamPot", "scroll"]) if (!play.carried().includes(item)) play.fail(`Gabriel n'a pas « ${item} »`);
      // Premier panneau : la fenêtre ouverte, les mains lavées dans la neige (1 point). Deuxième : les cheveux coupés (1 point).
      play.use(Verb.Open, "theWindow");
      const washed = play.use(Verb.Operate, "theWindow");
      if (!washed.some((text) => text.includes("se lave les mains dans la neige"))) play.fail("Gabriel ne s'est pas lavé les mains");
      const cut = play.useItem("scissors", "GKEgo");
      if (!cut.some((text) => text.includes("se coupe les cheveux"))) play.fail("Gabriel ne s'est pas coupé les cheveux");
      through(play, Verb.Operate, "hallDoor", Room7.GreatHall);
      through(play, Verb.Walk, "arch", Room7.Chapel);
      // Les six panneaux, que Gabriel sait lire maintenant.
      const panels = PANELS.flatMap((panel) => play.use(Verb.Look, panel));
      if (!panels.some((text) => text.includes("Le sixième panneau montre un manuscrit"))) play.fail("les panneaux ne sont pas décrits");
      // Troisième panneau : le pot de chambre sur l'autel, le sel dedans. Quatrième : la dague. Cinquième : à genoux.
      play.useItem("chamPot", "altar");
      play.useItem("salt", "pot");
      const blood = play.useItem("knife", "GKEgo");
      if (!blood.some((text) => text.includes("l'entaille avec la dague"))) play.fail("Gabriel ne s'est pas entaillé le bras");
      const knelt = play.use(Verb.Operate, "altar");
      if (!knelt.some((text) => text.includes("s'agenouille"))) play.fail("Gabriel ne s'est pas agenouillé");
      // Sixième panneau : le manuscrit lu (5 points). Gerde l'envoie se coucher ; le rêve du dragon, puis le jour 8.
      play.useItem("scroll", "GKEgo", { settle: false });
      const night = play.playUntil(() => play.day() === 8 && play.room() === Room7.Bedroom && play.inControl() && play.texts().length === 0, 80_000, "le réveil du jour 8");
      for (const line of ["Ca a marché!", "Cette nuit-là, Gabriel rêve", "abandonner la plus grand", "J'ai mal partout"]) {
        if (!night.some((text) => text.includes(line))) play.fail(`la nuit du jour 7 n'a pas dit « ${line} »`);
      }
    },
  },
];
