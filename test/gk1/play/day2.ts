/**
 * Jour 2 de Gabriel Knight, du matin dans la librairie au carton « Jour 3 ».
 *
 * Chaque étape a été recoupée avec les scripts désassemblés. Ce que les scripts exigent pour finir la journée
 * (`IconMap::endDay`, script 20 : quatre drapeaux vérifiés à l'ouverture d'une carte, qui posent le drapeau 15 ; la
 * boutique ferme à l'entrée suivante) :
 * - **107**, la conversation avec Malia Gedde (`maliaKnowsTruth`, script 360) : le majordome ne laisse entrer qu'un
 *   policier, il faut l'insigne de Mosely (`showTheBadge`, script 350) ;
 * - l'insigne est dans le manteau de Mosely (`moselyCoat::doVerb`, script 240), qu'il ne quitte que s'il fait chaud
 *   (drapeau 99, `geezItsHot`, script 241, joué à l'entrée dans le bureau quand la variable globale 179 dépasse 74) ; le
 *   thermostat du hall ne se règle que de l'intérieur du guichet (`thermo::doVerb`, `local6` du script 230), où Gabriel
 *   ne se trouve seul que s'il sort « vérifier sa coiffure » pendant la séance de photo ; Mosely ne s'éloigne que pour
 *   aller chercher du café (`getSomeCoffee`) ;
 * - **231 et 232**, l'artiste du square (`artist::doVerb`, script 410) : lui rendre son dessin envolé, puis lui confier
 *   le croquis du lac et le motif du dossier de police (l'original ou sa photocopie) ;
 * - la photocopie (`goToCopier`, script 230) ne se fait que sans l'officier Franks (`local0`) : pendant la même séance
 *   de photo, où elle est dans le bureau. Le dossier, qu'elle donne sur ordre de Mosely (sujet « Six autres modèles »)
 *   et qui ne sort ni du guichet ni vers le bureau, attend dans sa corbeille (`inBox::doVerb`, drapeau 13) ;
 * - **72**, le sujet de Grace sur Madame Cazaunoux (`grace::cue`, script 1050, sujet 47), visible avec le drapeau 60,
 *   posé par la scène de la pharmacie (`egoAndCazaunox`, script 250).
 */
import { NOTHING_ELSE, Room, endInterrogation, interrogate } from "./day1";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room2 = {
  MoselyOffice: 240,
  DrugStore: 250,
  GeddeGate: 350,
  GeddeParlor: 360,
  JacksonNorthEast: 410,
  GrandmaHouse: 380,
  Attic: 390,
} as const;

/** Drapeaux du jeu que le jour 2 pose (voir l'en-tête). */
export const Flag2 = {
  Photocopied: 2,
  SawCazaunoux: 60,
  AskedAboutCazaunoux: 72,
  ItIsHot: 99,
  MetMalia: 107,
  ArtistHasDrawing: 230,
  ArtistHasLakeSketch: 231,
  ArtistHasPoliceVeve: 232,
  DrawingBlown: 236,
} as const;

/** Le dossier de police : le nom de l'objet porte une espace finale dans les scripts. */
const POLICE_FILE = "policeVeve ";
/** Variable globale 179 : la température du commissariat, 70 au départ ; Mosely tombe la veste au-dessus de 74. */
const TEMPERATURE = 179;
/** Dans le gros plan du thermostat, un point à droite de l'axe de l'aiguille (174, 110) : 26° environ, soit 90 degrés. */
const THERMOSTAT_HOT = { x: 203, y: 50 };

/** Pousse une porte et attend la pièce voisine. */
function through(play: Play, door: string, to: number): string[] {
  play.use(Verb.Operate, door, { settle: false });
  const read = play.playUntil(() => play.room() === to, 3000, `la pièce ${to}`);
  return [...read, ...play.skipText()];
}

export const DAY2_START: readonly Stage[] = [
  {
    name: "j2-matin",
    title: "le journal du jour, puis le grenier de la grand-mère : le carnet de croquis",
    score: 27,
    run(play) {
      if (play.day() !== 2 || play.room() !== Room.Bookshop) play.fail("l'étape part de la librairie, le matin du jour 2");
      // Le journal du 19 juin (1 point).
      const paper = play.use(Verb.Pickup, "newsPaper");
      if (!paper[0]?.startsWith("Le Times du 19 Juin 1993")) play.fail("ce n'est pas le journal du jour 2");
      play.use(Verb.Operate, "shopDoor", { settle: false });
      play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
      // La maison de la grand-mère est sur la grande carte depuis le message de Grace (jour 1).
      play.travel("greatNO1");
      play.travel("grandma");
      const welcome = play.skipText();
      if (play.room() !== Room2.GrandmaHouse || !welcome.some((text) => text.includes("Grand-Maman"))) play.fail("la grand-mère n'a pas accueilli Gabriel");
      // L'escalier mène au grenier, où sont les affaires du père de Gabriel.
      play.use(Verb.Walk, "stairs", { settle: false });
      play.playUntil(() => play.room() === Room2.Attic, 3000, "le grenier");
      play.skipText();
      // Le carnet de croquis (1 point) : de quoi copier le motif du lac.
      play.use(Verb.Pickup, "sketchBook");
      if (!play.carried().includes("sketchBook")) play.fail("le carnet de croquis n'est pas pris");
      play.use(Verb.Walk, "stairs", { settle: false });
      play.playUntil(() => play.room() === Room2.GrandmaHouse, 3000, "le salon");
      play.skipText();
      play.use(Verb.Operate, "frontDoor", { settle: false });
      play.playUntil(() => play.room() === Room.GreaterMap, 3000, "la carte de la Nouvelle-Orléans");
    },
  },
  {
    name: "j2-lac",
    title: "copier le motif du lac dans le carnet",
    score: 29,
    run(play) {
      play.travel("lake");
      play.skipText();
      // Le carnet sur le motif tracé dans le sable (2 points) : un croquis du motif du lac.
      play.useItem("sketchBook", "patternOnGround");
      if (!play.carried().includes("sLakePatter")) play.fail("le croquis du motif n'est pas dans l'inventaire");
      play.use(Verb.Walk, "myExitFeature", { settle: false });
      play.playUntil(() => play.room() === Room.GreaterMap, 3000, "la carte de la Nouvelle-Orléans");
    },
  },
];

export const DAY2_POLICE: readonly Stage[] = [
  {
    name: "j2-commissariat",
    title: "commissariat : le dossier des meurtres, la photo, le thermostat, la photocopie, l'insigne de Mosely",
    score: 45,
    run(play) {
      play.travel("frenchQ");
      play.travel("policeLobby");
      play.skipText();
      // Le sergent laisse passer qui vient voir Mosely.
      interrogate(play, "deskSarg");
      play.talkTopic("Détective Mosely");
      endInterrogation(play, Room.PoliceLobby);
      through(play, "mosDoor", Room2.MoselyOffice);
      // Mosely autorise à voir les six autres motifs (1 point) : « Allez voir l'officier Franks. »
      interrogate(play, "mosely");
      play.talkTopic("Schémas autour de corps");
      play.talkTopic("Six autres modèles");
      endInterrogation(play, Room2.MoselyOffice);
      through(play, "officeDoor", Room.PoliceLobby);
      // L'officier Franks donne le dossier (2 points), à consulter sur place et sans photocopie.
      play.use(Verb.Talk, "franky", { settle: false });
      play.playUntil(() => play.menu().length > 0, 3000, "les questions à l'officier Franks");
      play.talkTopic("Pouvez-vous me fournir un fichier?", () => play.inControl());
      play.skipText();
      if (!play.carried().includes(POLICE_FILE)) play.fail("l'officier Franks n'a pas donné le dossier");
      // Le dossier ne passe ni la porte de Mosely ni le portillon : il attend dans la corbeille de Franks.
      const refusal = play.use(Verb.Operate, "gate");
      if (!refusal.some((text) => text.includes("Ne sortez pas de là avec le dossier"))) play.fail("Franks laisse sortir le dossier");
      play.useItem(POLICE_FILE, "inBox");
      through(play, "mosDoor", Room2.MoselyOffice);
      // Une photo avec Mosely pour le livre (2 points) : Franks vient la prendre, et quitte donc son bureau.
      interrogate(play, "mosely");
      play.talkTopic("Photographies");
      play.talkTopic("Un policier à la fois photographe ce pourrait être pas mal.", () => play.menu().length > 0 && play.room() === Room2.MoselyOffice);
      // « Vérifier ma coiffure » : Gabriel sort seul dans le hall, derrière le guichet, devant le miroir.
      play.talkTopic("Attendez un instant, je veux vérifier ma coiffure.", () => play.room() === Room.PoliceLobby && play.inControl());
      // Le thermostat (1 point) : son gros plan suit le pointeur, un clic lâche l'aiguille, un autre à côté le referme.
      play.use(Verb.Operate, "thermo");
      if (!play.insetOpen()) play.fail("le gros plan du thermostat n'est pas ouvert");
      play.point(THERMOSTAT_HOT.x, THERMOSTAT_HOT.y);
      play.click(THERMOSTAT_HOT.x, THERMOSTAT_HOT.y);
      play.step(20);
      play.closeInset();
      if (play.global(TEMPERATURE) <= 74) play.fail(`le thermostat est resté à ${play.global(TEMPERATURE)} degrés`);
      // Franks absente : reprendre le dossier dans sa corbeille, le photocopier (5 points), le remettre (1 point).
      play.use(Verb.Pickup, "inBox");
      play.useItem(POLICE_FILE, "copier");
      if (!play.flag(Flag2.Photocopied) || !play.carried().includes("veveCopy")) play.fail("la photocopie n'est pas faite");
      play.useItem(POLICE_FILE, "inBox");
      // Retour dans le bureau : la photo est prise.
      const photo = through(play, "mosDoor", Room2.MoselyOffice);
      if (!photo.some((text) => text.includes("quand les photos seront développées"))) play.fail("la photo n'a pas été prise");
      // La chaleur n'est remarquée qu'à l'entrée dans le bureau : sortir, rentrer, et Mosely pose son manteau.
      through(play, "officeDoor", Room.PoliceLobby);
      const heat = through(play, "mosDoor", Room2.MoselyOffice);
      if (!play.flag(Flag2.ItIsHot) || !heat.some((text) => text.includes("Il fait chaud ici"))) play.fail("Mosely n'a pas remarqué la chaleur");
      // L'envoyer chercher du café (1 point), et prendre l'insigne dans le manteau (3 points) avant son retour.
      interrogate(play, "mosely");
      play.talkTopic("Café", () => play.room() === Room2.MoselyOffice && play.inControl());
      const caught = play.use(Verb.Pickup, "moselyCoat");
      if (!play.carried().includes("badge")) play.fail("l'insigne n'est pas pris");
      if (!caught.some((text) => text.includes("une araignée"))) play.fail("Mosely n'est pas revenu avec le café");
      through(play, "officeDoor", Room.PoliceLobby);
      play.use(Verb.Operate, "extDoor", { settle: false });
      play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
    },
  },
];

export const DAY2_ERRANDS: readonly Stage[] = [
  {
    name: "j2-pharmacie",
    title: "pharmacie Dixieland : Madame Cazaunoux ; librairie : le bon de la caisse, la recherche de Grace",
    score: 48,
    run(play) {
      // À la première entrée du jour 2, Madame Cazaunoux et son chien passent commande à Willy Walker.
      play.travel("voodooShop");
      const scene = play.skipText(30_000);
      if (play.room() !== Room2.DrugStore || !play.flag(Flag2.SawCazaunoux)) play.fail("la scène de Madame Cazaunoux n'a pas eu lieu");
      if (!scene.some((text) => text.includes("Madame Cazaunoux"))) play.fail("Willy Walker n'a pas nommé Madame Cazaunoux");
      play.use(Verb.Operate, "shopDoor", { settle: false });
      play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
      play.travel("bookStore");
      play.skipText();
      // La caisse ne s'ouvre qu'avec le curseur « ouvrir » : dans son tiroir, un bon pour un hot-dog.
      play.use(Verb.Open, "xcashRegister");
      if (!play.insetOpen()) play.fail("le tiroir de la caisse n'est pas ouvert");
      play.use(Verb.Pickup, "giftCertificate");
      if (play.insetOpen()) play.closeInset();
      if (!play.carried().includes("giftCert")) play.fail("le bon n'est pas pris");
      // Grace peut maintenant chercher Madame Cazaunoux (drapeau 72, exigé pour finir la journée).
      interrogate(play, "graceProp");
      play.talkTopic("Demande de recherche");
      play.talkTopic("Enquétez sur Madame Cazaunoux.");
      if (!play.flag(Flag2.AskedAboutCazaunoux)) play.fail("la recherche sur Madame Cazaunoux n'est pas demandée");
      play.talkTopic(NOTHING_ELSE);
      endInterrogation(play, Room.Bookshop);
      play.use(Verb.Operate, "shopDoor", { settle: false });
      play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
    },
  },
  {
    name: "j2-square",
    title: "square Jackson : le hot-dog, le petit danseur de claquettes, le dessin envolé, l'artiste",
    score: 55,
    run(play) {
      play.travel("jackSquare");
      play.skipText();
      // Coin sud-ouest : le bon de la librairie contre un hot-dog (1 point), le hot-dog au petit danseur (1 point).
      play.leave("westExit");
      play.useItem("giftCert", "luckyDogVendor");
      const thanks = play.useItem("luckyDog ", "tapper");
      if (!thanks.some((text) => text.includes("vous pouvez m'demander"))) play.fail("le petit danseur n'a pas promis un service");
      // Coin nord-est, par le nord-ouest : l'artiste est à son chevalet. Le vent n'emporte son dessin qu'à la visite
      // suivante (`neJackson::init` : drapeau 237 posé à la première entrée du jour 2, joué à la deuxième).
      play.leave("northExit");
      play.leave("eastExit");
      if (play.room() !== Room2.JacksonNorthEast || !play.present("artist")) play.fail("l'artiste n'est pas au coin nord-est");
      play.leave("westExit");
      play.leave("eastExit");
      play.skipText();
      if (!play.flag(Flag2.DrawingBlown)) play.fail("le dessin de l'artiste ne s'est pas envolé");
      // Le dessin est tombé derrière la grille de la statue, au coin nord-ouest : hors de portée.
      play.leave("westExit");
      const outOfReach = play.use(Verb.Pickup, "drawing");
      if (!outOfReach.some((text) => text.includes("ne peut atteindre le dessin"))) play.fail("Gabriel a pu prendre le dessin lui-même");
      // Le petit danseur passe entre les barreaux (1 point) : il suit Gabriel au coin nord-ouest et rapporte le dessin.
      play.leave("southExit");
      play.use(Verb.Talk, "tapper", { settle: false });
      play.playUntil(() => play.menu().length > 0, 3000, "le service à demander au petit danseur");
      play.talkTopic("Peux-tu passer entre les barres qui entourent la statue?", () => play.room() === Room.JacksonNorthWest && play.inControl());
      play.skipText();
      if (!play.carried().includes("lostDrawing")) play.fail("le petit danseur n'a pas rapporté le dessin");
      // Rendre son dessin à l'artiste, puis lui confier le croquis du lac et la photocopie du dossier : il
      // reconstituera le motif entier pour le lendemain (drapeaux 231 et 232, exigés pour finir la journée).
      play.leave("eastExit");
      play.useItem("lostDrawing", "artist");
      if (!play.flag(Flag2.ArtistHasDrawing)) play.fail("l'artiste n'a pas repris son dessin");
      play.useItem("sLakePatter", "artist");
      play.useItem("veveCopy", "artist");
      if (!play.flag(Flag2.ArtistHasLakeSketch) || !play.flag(Flag2.ArtistHasPoliceVeve)) play.fail("l'artiste n'a pas les deux motifs");
      // Retour à la carte par le coin sud-est.
      play.leave("southExit");
      play.leave("southExit");
      if (play.room() !== Room.CityMap) play.fail("la sortie sud du square ne mène pas à la carte");
    },
  },
  {
    name: "j2-gedde",
    title: "manoir Gedde : l'insigne de Mosely montré au majordome, Malia Gedde",
    score: 60,
    run(play) {
      play.travel("greatNO1");
      play.travel("gedde");
      play.skipText();
      // Le heurtoir : le majordome n'annonce que les rendez-vous et les affaires officielles.
      play.use(Verb.Operate, "knocker", { settle: false });
      play.playUntil(() => play.menu().length > 0, 6000, "les réponses au majordome");
      play.talkTopic("J'aimerais voir Malia Gedde, s'il vous plaît.");
      play.talkTopic("Je suis VRAIMENT en service commandé.", () => play.inControl());
      // L'insigne de Mosely (3 points) : « Je suis le détective Mosely. » Le majordome fait entrer.
      play.inventory("badge");
      const butler = play.pointOn("butler");
      play.click(butler.x, butler.y);
      const welcome = play.skipText(30_000, () => play.room() === Room2.GeddeParlor);
      if (!welcome.some((text) => text.includes("Que puis-je faire pour vous, Détective?"))) play.fail("Malia Gedde n'a pas reçu Gabriel");
      // Malia démasque le faux policier quand le vaudou et le lac ont été abordés (`malia::cue`, script 1053 : sujets
      // 1 et 37, drapeau 264 posé par le sujet suivant) : 2 points, et le majordome raccompagne Gabriel.
      interrogate(play, "malia");
      play.talkTopic("Vaudouisme");
      play.talkTopic("Le Lac Pontchartrain");
      const unmasked = play.talkTopic("Flirter avec elle", () => play.room() === Room2.GeddeGate && play.inControl(), 30_000);
      if (!unmasked.some((text) => text.includes("Vous n'êtes pas vraiment Détective"))) play.fail("Malia n'a pas démasqué Gabriel");
      if (!play.flag(Flag2.MetMalia)) play.fail("la rencontre avec Malia n'est pas notée");
    },
  },
  {
    name: "j2-soir",
    title: "quitter le manoir : la journée finit, la nuit, le carton « Jour 3 », le matin dans la librairie",
    score: 61,
    run(play) {
      // Les quatre conditions sont réunies : la carte, en s'ouvrant, marque la fin de la journée (`IconMap::endDay`) et
      // passe d'elle-même à la nuit, sans retour par la librairie. Au matin, le café de Grace (1 point).
      play.leave({ x: 157, y: 150 }, 60_000);
      if (play.day() !== 3 || play.room() !== Room.Bookshop) play.fail("le matin du jour 3 n'est pas arrivé");
      play.skipText();
    },
  },
];

/** Le jour 2 entier, du matin dans la librairie au matin du jour 3. */
export const DAY2: readonly Stage[] = [...DAY2_START, ...DAY2_POLICE, ...DAY2_ERRANDS];
