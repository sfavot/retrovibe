/**
 * Jour 4 de Gabriel Knight, du matin dans la librairie au matin du jour 5.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés. Ce que les scripts exigent pour finir la journée
 * (`IconMap::endDay`, script 20, vérifié à l'ouverture d'une carte ; la boutique ferme à l'entrée suivante) :
 * - le drapeau **227** : le motif montré à Hartridge (`showTheVeve`, script 340), acquis au jour 3 ;
 * - le drapeau **447** : l'appel à Wolfgang Ritter (`callWolfGang`, script 221, numéro 49-09324-3333 lu dans
 *   `dialThePhone::init`). Gabriel refuse d'appeler un inconnu (`earlyCall`) tant que sa grand-mère n'a pas parlé de Heinz
 *   Ritter (`granny::cue`, script 1051 : drapeau 282), sujet visible avec le drapeau 69, posé en lisant (verbe 58) la
 *   lettre du tiroir secret de l'horloge du grenier (`ritLetter::doVerb`, script 15). Le tiroir s'ouvre (`theKey::doVerb`,
 *   script 391) quand le cadran extérieur montre le dragon en haut (`theDial`, cel 2), la grande aiguille midi (`bigHand`,
 *   cel 0) et la petite trois heures (`littleHand`, cel 3) ;
 * - l'objet 41, `braceRep` : la copie du bracelet, que Sam remet à l'entrée du bar Napoléon (`getBracelet`, script 460) ;
 * - l'objet 26, `tatooTrace` : le tatouage de Crash décalqué au carnet (`sTraceTattoo`, script 450). Crash n'est dans la
 *   cathédrale qu'après avoir été vu aux jumelles du belvédère (`sCrashTalkToDrummer`, script 410, joué seulement en
 *   venant de la pièce 400 : drapeau 314) ; il ne parle qu'à qui montre le bracelet (`crash::doVerb` : drapeau 308) et
 *   meurt au sujet « Le lieu de culte Vaudou. » abordé après « Joueur de tambour » (`crash::cue`, script 1056 : drapeau 74) ;
 * - le drapeau **248** : Magentia Moonbeam traduit les signes de la tombe (`sFullShow`, script 290, objet `VoodooCode1`) ;
 * - le drapeau **36** : la recherche demandée à Grace sur le motif (`grace::cue`, script 1050, sujet 50).
 */
import { NOTHING_ELSE, Room, endInterrogation, interrogate } from "./day1";
import { Room3, dial, through } from "./day3";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room4 = {
  GrandmaHouse: 380,
  Attic: 390,
  Clock: 391,
  Moonbeam: 290,
  Overlook: 400,
} as const;

/** Drapeaux du jeu que le jour 4 pose (voir l'en-tête). */
export const Flag4 = {
  AskedResearchOnVeve: 36,
  ReadRitterLetter: 69,
  RadaDrumsResearch: 73,
  CrashDead: 74,
  CodeTranslated: 248,
  KnowsHeinzRitter: 282,
  TattooTraced: 307,
  CrashTrustsGabriel: 308,
  SawCrashWithDrummer: 314,
  CalledWolfgang: 447,
} as const;

/** Numéro de Schloss Ritter (`dialThePhone::init`, script 221, dernier tableau). */
const WOLFGANG_NUMBER = "49093243333";

/** Centre du cadran de l'horloge (`GetAngle` de `moveTheDial::doit` et `moveTheBigHand::doit`, script 391), à l'écran. */
const CLOCK_CENTER = { x: 172, y: 72 };
const CLOCK_RADIUS = 20;

/** Point du cadran à `angle` degrés (0 en haut, sens des aiguilles). */
function onClock(angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return { x: Math.round(CLOCK_CENTER.x + CLOCK_RADIUS * Math.sin(radians)), y: Math.round(CLOCK_CENTER.y - CLOCK_RADIUS * Math.cos(radians)) };
}

/**
 * Saisit une pièce de l'horloge (curseur « déplacer ») et fait tourner le pointeur autour du cadran, par pas de trente
 * degrés, jusqu'à ce que `done` soit vrai ; un clic sur place la lâche. Le cadran extérieur avance d'un cran par pas ; la
 * grande aiguille suit l'angle du pointeur, et la petite avance d'une heure à chaque passage par midi.
 */
function turnClock(play: Play, part: string, done: () => boolean, what: string): void {
  play.use(Verb.Move, part, { settle: false });
  play.step(30);
  let at = onClock(0);
  for (let angle = 0, steps = 0; !done(); angle = (angle + 30) % 360, steps++) {
    if (steps > 80) play.fail(`${what} : l'horloge ne s'y met pas`);
    at = onClock(angle);
    play.point(at.x, at.y, 6);
  }
  play.click(at.x, at.y);
  play.step(30);
  if (!done() || !play.inControl()) play.fail(`${what} : la pièce n'est pas lâchée en place`);
}

/** Sort d'une pièce par le bas de l'écran et attend la carte du Quartier Français. */
function downToCityMap(play: Play): void {
  play.selectVerb(Verb.Walk);
  play.click(160, 190);
  play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
}

export const DAY4: readonly Stage[] = [
  {
    name: "j4-matin",
    title: "le journal ; le grenier de la grand-mère : l'horloge, le tiroir secret, la lettre ; Heinz Ritter",
    score: 118,
    run(play) {
      if (play.day() !== 4 || play.room() !== Room.Bookshop) play.fail("l'étape part de la librairie, le matin du jour 4");
      // Le journal du 21 juin (1 point) : la police classe l'affaire.
      const paper = play.use(Verb.Pickup, "newsPaper");
      if (!paper[0]?.startsWith("Le Times du 21 Juin 1993")) play.fail("ce n'est pas le journal du jour 4");
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      play.travel("greatNO1");
      play.travel("grandma");
      play.skipText();
      through(play, Verb.Walk, "stairs", Room4.Attic);
      // L'horloge en gros plan : le dragon en haut, trois heures, puis la clé (5 points) : le tiroir secret s'ouvre.
      through(play, Verb.Operate, "clock", Room4.Clock);
      const cel = (part: string): number => play.num(play.object(part).reg, "cel");
      turnClock(play, "theDial", () => cel("theDial") === 2, "le dragon en haut du cadran");
      turnClock(play, "bigHand", () => cel("bigHand") === 0 && cel("littleHand") === 3, "trois heures");
      const opened = play.use(Verb.Operate, "theKey");
      if (!play.present("getTheItem") || !opened.some((text) => text.includes("Grand-Papa"))) play.fail("le tiroir de l'horloge ne s'est pas ouvert");
      // Dans le tiroir : une photo (1 point), une lettre (1 point). La lettre, lue (1 point), nomme Heinz Ritter.
      play.use(Verb.Pickup, "getTheItem");
      play.use(Verb.Pickup, "getTheItem");
      for (const item of ["ritPhoto ", "ritLetter"]) if (!play.carried().includes(item)) play.fail(`le tiroir n'a pas donné « ${item} »`);
      play.inventory("ritLetter", "read");
      if (!play.flag(Flag4.ReadRitterLetter)) play.fail("la lettre n'est pas lue");
      through(play, Verb.Walk, "leftExit", Room4.Attic);
      through(play, Verb.Walk, "stairs", Room4.GrandmaHouse);
      // La grand-mère : le grand-père s'appelait Heinz Ritter avant l'Amérique (2 points).
      interrogate(play, "granny");
      for (let i = 0; i < 6 && !play.flag(Flag4.KnowsHeinzRitter); i++) play.talkTopic("Heinz Ritter");
      if (!play.flag(Flag4.KnowsHeinzRitter)) play.fail("la grand-mère n'a pas parlé de Heinz Ritter");
      endInterrogation(play, Room4.GrandmaHouse);
      through(play, Verb.Operate, "frontDoor", Room.GreaterMap);
      play.travel("frenchQ");
    },
  },
  {
    name: "j4-ritter",
    title: "le studio : l'appel à Wolfgang Ritter, à Schloss Ritter",
    score: 120,
    run(play) {
      play.travel("bookStore");
      play.skipText();
      through(play, Verb.Operate, "xcurtainDoor", Room3.Studio);
      // Wolfgang demande à Gabriel de lire le journal de Gunter Ritter, qu'il envoie (2 points).
      const call = dial(play, WOLFGANG_NUMBER);
      if (!play.flag(Flag4.CalledWolfgang) || !call.some((text) => text.includes("Schloß Ritter"))) play.fail("Wolfgang Ritter n'a pas répondu");
      play.skipText();
      through(play, Verb.Operate, "curtainDoor", Room.Bookshop);
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
    },
  },
  {
    name: "j4-crash",
    title: "belvédère : Crash et le joueur de tambour aux jumelles ; la copie du bracelet ; cathédrale : Crash parle, meurt, son tatouage",
    score: 130,
    run(play) {
      // Des jumelles du belvédère, Gabriel voit Crash parler au joueur de tambour (3 points).
      play.travel("jackOver");
      play.skipText();
      play.use(Verb.Operate, "binoc1", { settle: false });
      play.playUntil(() => play.room() === Room3.JacksonNorthEast, 3000, "la vue des jumelles");
      const seen = play.playUntil(() => play.room() === Room4.Overlook && play.inControl() && play.texts().length === 0, 20_000, "le retour des jumelles");
      if (!play.flag(Flag4.SawCrashWithDrummer) || !seen.some((text) => text.includes("C'est Crash"))) play.fail("Gabriel n'a pas vu Crash");
      play.skipText();
      downToCityMap(play);
      // Sam remet la copie du bracelet dès l'entrée (1 point).
      play.travel("napHouse");
      play.skipText();
      if (!play.carried().includes("braceRep ")) play.fail("Sam n'a pas remis la copie du bracelet");
      through(play, Verb.Operate, "wayOut", Room.CityMap);
      // Crash se cache dans la cathédrale. Le bracelet le décide (1 point) : il montre son tatouage.
      play.travel("louisCath");
      play.skipText();
      play.useItem("braceRep ", "crash");
      if (!play.flag(Flag4.CrashTrustsGabriel)) play.fail("Crash n'a pas reconnu le bracelet");
      // Les joueurs de tambour (2 points), puis le lieu de culte : Crash meurt en le disant (1 point).
      interrogate(play, "crash");
      play.talkTopic("Joueur de tambour");
      const last = play.talkTopic("Le lieu de culte Vaudou.", () => play.room() === Room3.Cathedral && play.inControl(), 40_000);
      play.skipText();
      if (!play.flag(Flag4.CrashDead) || !last.some((text) => text.includes("Damballah"))) play.fail("Crash n'a pas dit ses derniers mots");
      // Le corps en gros plan : la chemise ouverte, le carnet décalque le tatouage (2 points).
      play.use(Verb.Look, "crash");
      play.use(Verb.Open, "myShirt");
      play.useItem("sketchBook", "chest");
      if (play.insetOpen()) play.closeInset();
      play.skipText();
      if (!play.carried().includes("tatooTrace") || !play.flag(Flag4.TattooTraced)) play.fail("le tatouage n'est pas décalqué");
      // Par le parvis et le square, retour à la carte.
      play.leave("southExit");
      play.skipText();
      play.leave("southExit");
      play.leave("southExit");
      if (play.room() !== Room.CityMap) play.fail("le square ne ramène pas à la carte");
    },
  },
  {
    name: "j4-moonbeam",
    title: "Magentia Moonbeam traduit les signes de la tombe ; Grace : deux recherches ; la nuit",
    score: 140,
    run(play) {
      // Première visite : elle attendait l'envoyé du docteur John. Les signes copiés au cimetière (3 points).
      play.travel("moonBeam");
      play.skipText(40_000);
      const reading = play.useItem("VoodooCode1", "magentia");
      if (!play.flag(Flag4.CodeTranslated) || !reading.some((text) => text.includes("K-A-S-H"))) play.fail("Magentia Moonbeam n'a pas traduit les signes");
      // La sortie sur la rue n'est pas un objet de la pièce : une zone (233, 37)-(282, 109) suivie par `streetExit::doit`.
      play.selectVerb(Verb.Walk);
      play.click(257, 83);
      play.playUntil(() => play.room() === Room.CityMap, 6000, "la carte du Quartier Français");
      // Grace : une recherche sur le motif (2 points, exigée), une autre sur les tambours Rada (2 points).
      play.travel("bookStore");
      play.skipText();
      interrogate(play, "graceProp");
      play.talkTopic("Demande de recherche");
      play.talkTopic("Je dois faire des recherches sur le modèle que je détiens.");
      play.talkTopic("Regardez ce que vous pouvez trouver sur les tambours Rada.");
      play.talkTopic(NOTHING_ELSE);
      if (!play.flag(Flag4.AskedResearchOnVeve) || !play.flag(Flag4.RadaDrumsResearch)) play.fail("Grace n'a pas noté les deux recherches");
      // En sortant de l'interrogatoire, le colis de Wolfgang et le livre des tambours arrivent (3 points).
      endInterrogation(play, Room.Bookshop);
      for (const item of ["guntJournal", "wolfLetter", "drumBook"]) if (!play.carried().includes(item)) play.fail(`« ${item} » n'est pas arrivé`);
      // Les conditions sont réunies : la carte marque la fin de la journée, la librairie ferme à l'entrée suivante.
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      play.travel("bookStore");
      play.playUntil(() => play.day() === 5 && play.room() === Room.Bookshop && play.inControl() && play.texts().length === 0, 120_000, "le matin du jour 5");
      play.skipText();
    },
  },
];
