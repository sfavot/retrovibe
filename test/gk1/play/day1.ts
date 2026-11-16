/**
 * Jour 1 de Gabriel Knight, du bouton JOUER au carton « Jour 2 » : la suite d'actions du parcours sans tête.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés (`engine/disasm.ts`) et les messages du CD français, pas
 * seulement avec la solution connue. Ce que les scripts exigent pour finir la journée :
 * - le drapeau 15 fait fermer la boutique à la prochaine entrée (`bookstore::init`, script 210, puis `timeToGoHome`) ;
 * - seul le sujet « Enquêtez sur Malia Gedde. » de Grace le pose le jour 1 (`grace::cue`, script 1050, sujet 49) ;
 * - ce sujet n'existe qu'avec le drapeau 65, posé par la scène du lac (scripts 470 et 472) ;
 * - le lac n'est sur la carte qu'avec le drapeau 64, posé par la radio de la moto de police (`sOperateRadio`, script 430) ;
 * - le motard n'est au square qu'avec le drapeau 66, posé par le sujet « Détective Mosely » du sergent (`sarge::cue`) ;
 * - le commissariat n'est sur la carte qu'avec le drapeau 63, posé par le troisième « Autres messages » de Grace ;
 * - le motard ne lâche sa radio que si le mime, qui suit Gabriel (drapeau 102), entre dans sa zone (`specialMimeCode`).
 *
 * Le reste (journal, loupe, pince, enveloppe, écaille, argile) n'est pas exigé le jour 1 : ce sont des points et des
 * objets dont les jours suivants ont besoin.
 */
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room = {
  Interrogation: 50,
  CityMap: 200,
  GreaterMap: 205,
  Bookshop: 210,
  PoliceLobby: 230,
  DayCard: 370,
  JacksonNorthWest: 420,
  JacksonSouthEast: 430,
  JacksonSouthWest: 440,
  Lake: 470,
  LakeCloseUp: 471,
} as const;

/** Drapeaux du jeu que le jour 1 pose (script 13 ; voir l'en-tête). */
export const Flag = {
  EndOfDay: 15,
  PoliceOnMap: 63,
  LakeOnMap: 64,
  SawCrimeScene: 65,
  CopAtSquare: 66,
  GrandmaOnMap: 101,
  MimeFollows: 102,
} as const;

/** Dernier choix d'un sous-menu de Grace : revient aux sujets principaux. */
export const NOTHING_ELSE = "Je n'arrive pas à penser à quoi que ce soit.";
/** Où est le mime au square nord-ouest : Gabriel doit entrer dans le rectangle (229, 50)-(270, 65) pour qu'il le suive. */
const MIME_SPOT = { x: 250, y: 62 };
/** Le mime agace d'abord les passants, et le jeu retire alors la main : plusieurs essais peuvent être nécessaires. */
const MIME_TRIES = 8;

/** Ouvre l'interrogatoire d'un personnage (curseur « interroger ») et attend son menu. */
export function interrogate(play: Play, who: string): void {
  play.use(Verb.Ask, who, { settle: false });
  play.playUntil(() => play.room() === Room.Interrogation && play.menu().length > 0, 3000, `l'interrogatoire de ${who}`);
}

/** Referme l'interrogatoire et attend le retour dans la pièce. */
export function endInterrogation(play: Play, backTo: number): string[] {
  const read = play.talkTopic("Sortie", () => play.room() === backTo);
  return [...read, ...play.skipText()];
}

/** Sort de la librairie par la porte et attend la carte du Quartier Français. */
function toCityMap(play: Play, door: string): void {
  play.use(Verb.Operate, door, { settle: false });
  play.playUntil(() => play.room() === Room.CityMap, 3000, "la carte du Quartier Français");
}

export const DAY1: readonly Stage[] = [
  {
    name: "j1-titre",
    title: "du titre à la librairie",
    score: 0,
    run(play) {
      // JOUER, le carton « Jour 1 », le rêve, puis le dialogue d'ouverture avec Grace : Entrée ferme chaque réplique.
      const read = play.startGame();
      if (play.room() !== Room.Bookshop || play.day() !== 1) play.fail("la partie ne commence pas dans la librairie, le jour 1");
      if (!read.some((text) => text.includes("Musée Historique du Vaudou"))) play.fail("le dialogue d'ouverture n'a pas été lu en entier");
    },
  },
  {
    name: "j1-librairie",
    title: "journal, loupe, pince, messages de Grace",
    score: 7,
    run(play) {
      // Lire le journal du jour (1 point) : les Meurtres Vaudou font la une.
      play.use(Verb.Pickup, "newsPaper");
      // Emprunter la loupe et la pince à épiler du bureau (1 point chacune) : elles servent au lac.
      play.use(Verb.Pickup, "magnifyingGlass");
      play.use(Verb.Pickup, "tweezers");
      // Interroger Grace sur ses messages : Dana et Susie, la grand-mère (2 points, sa maison sur la carte), Wolfgang
      // Ritter, enfin Mosely (2 points) : ses photos attendent au commissariat, qui arrive sur la carte.
      interrogate(play, "graceProp");
      play.talkTopic("Messages");
      for (let asked = 0; !play.flag(Flag.PoliceOnMap); asked++) {
        if (asked > 5) play.fail("Grace ne donne pas le message de Mosely");
        play.talkTopic("Autres messages");
      }
      if (!play.flag(Flag.GrandmaOnMap)) play.fail("le message de la grand-mère n'a pas été donné");
      endInterrogation(play, Room.Bookshop);
      toCityMap(play, "shopDoor");
    },
  },
  {
    name: "j1-commissariat",
    title: "le sergent Frick : Mosely est sur les lieux du crime, l'enveloppe de photos",
    score: 10,
    run(play) {
      play.travel("policeLobby");
      play.skipText();
      interrogate(play, "deskSarg");
      // « Détective Mosely » (2 points) : il est sur les lieux du crime ; un motard de la police apparaît au square.
      play.talkTopic("Détective Mosely");
      play.talkTopic("Photographies");
      // Le sergent ne dit pas où : c'est la radio du motard qui le dira.
      play.talkTopic("Lieu du crime");
      // En partant, Frick remet l'enveloppe laissée par Mosely (1 point).
      endInterrogation(play, Room.PoliceLobby);
      if (!play.carried().includes("phoEnvelope")) play.fail("le sergent n'a pas remis l'enveloppe");
      if (!play.flag(Flag.CopAtSquare)) play.fail("le motard n'est pas attendu au square");
      toCityMap(play, "extDoor");
    },
  },
  {
    name: "j1-square",
    title: "square Jackson : chercher le mime au coin nord-ouest",
    score: 10,
    run(play) {
      // La carte dépose Gabriel au coin sud-est, où le motard garde sa moto et sa radio.
      play.travel("jackSquare");
      play.skipText();
      if (play.room() !== Room.JacksonSouthEast || !play.present("cop")) play.fail("le motard n'est pas au coin sud-est");
      // Par l'ouest puis le nord jusqu'au coin nord-ouest, où le mime fait son numéro.
      play.leave("westExit");
      play.leave("northExit");
      if (play.room() !== Room.JacksonNorthWest || !play.present("xMime")) play.fail("le mime n'est pas au coin nord-ouest");
      // S'approcher du mime : il se met à suivre Gabriel.
      for (let tries = 0; !play.flag(Flag.MimeFollows); tries++) {
        if (tries >= MIME_TRIES) play.fail("le mime ne suit pas Gabriel");
        play.walkTo(MIME_SPOT.x, MIME_SPOT.y);
      }
    },
  },
  {
    name: "j1-radio",
    title: "ramener le mime au motard, écouter la radio",
    score: 17,
    run(play) {
      // Retour par le sud puis l'est, loin des musiciens : le mime qui entre dans leur zone reste les agacer
      // (`specialMimeCode` : (83, 76)-(170, 114) au nord-ouest, (85, 64)-(163, 84) au sud-ouest).
      play.leave({ x: 225, y: 145 });
      if (play.room() !== Room.JacksonSouthWest) play.fail("la sortie sud du coin nord-ouest ne mène pas au coin sud-ouest");
      play.leave({ x: 319, y: 120 });
      if (play.room() !== Room.JacksonSouthEast || !play.flag(Flag.MimeFollows)) play.fail("le mime n'a pas suivi jusqu'au coin sud-est");
      // Passer devant la moto : le mime singe le motard, qui finit par le poursuivre (5 points).
      play.walkTo(110, 120);
      play.skipText(20_000, () => !play.flag(Flag.MimeFollows));
      // Écouter la radio de la moto (2 points) : le crime a eu lieu au bord du lac Pontchartrain.
      const heard = play.use(Verb.Operate, "radio");
      if (!heard.some((text) => text.includes("Lakeside Drive"))) play.fail("la radio n'a pas donné le lieu du crime");
      if (!play.flag(Flag.LakeOnMap)) play.fail("le lac n'est pas ajouté à la carte");
      play.leave("southExit");
    },
  },
  {
    name: "j1-lac",
    title: "lac Pontchartrain : Mosely, Malia Gedde, l'écaille et l'argile",
    score: 22,
    run(play) {
      play.travel("greatNO1");
      play.travel("lake");
      // Mosely laisse voir les lieux ; la limousine de Malia Gedde s'arrête ; la police remballe.
      // La scène passe par le gros plan de Malia dans la limousine (pièce 471, fondu de type 12), puis revient au lac.
      const closeUp = play.playUntil(() => play.room() === Room.LakeCloseUp, 20_000, "le gros plan de Malia");
      const scene = [...closeUp, ...play.skipText(60_000, () => play.room() === Room.Lake)];
      if (!scene.some((text) => text.includes("Malia Gedde"))) play.fail("la scène du lac n'a pas eu lieu");
      if (!play.flag(Flag.SawCrimeScene)) play.fail("la scène du lac n'est pas notée");
      // Ouvrir l'enveloppe de Mosely dans l'inventaire (1 point) : deux photographies.
      play.inventory("phoEnvelope", "open");
      // La loupe sur l'herbe couchée, près du ruban de droite (1 point) : les marques d'une cage, en gros plan.
      play.useItem("magGlass", "cageGrass");
      // Dans le gros plan, la pince sur l'écaille (2 points).
      play.useItem("tweezers", "lakeScale");
      if (play.insetOpen()) play.closeInset();
      // Un peu d'argile de la rive (1 point).
      play.use(Verb.Pickup, "clayBank");
      for (const item of ["murderPhoto", "gradPhoto", "lakeScale", "clay"]) if (!play.carried().includes(item)) play.fail(`il manque « ${item} »`);
      // Le motif tracé au sol reste à copier : il faut le carnet de croquis du grenier de la grand-mère (jour 2).
      play.use(Verb.Walk, "myExitFeature", { settle: false });
      play.playUntil(() => play.room() === Room.GreaterMap, 3000, "la carte de la Nouvelle-Orléans");
    },
  },
  {
    name: "j1-soir",
    title: "demander à Grace d'enquêter sur Malia Gedde : la boutique ferme, jour 2",
    score: 25,
    run(play) {
      play.travel("frenchQ");
      play.travel("bookStore");
      play.skipText();
      interrogate(play, "graceProp");
      play.talkTopic("Demande de recherche");
      // 2 points, et le drapeau de fin de journée.
      play.talkTopic("Enquêtez sur Malia Gedde.");
      if (!play.flag(Flag.EndOfDay)) play.fail("la journée n'est pas marquée comme finie");
      play.talkTopic(NOTHING_ELSE);
      play.talkTopic("Sortie", () => play.room() !== Room.Interrogation);
      // Grace ferme la boutique, la nuit et son rêve passent, le carton « Jour 2 », puis le café du matin (1 point).
      const rooms: number[] = [];
      const night = play.playUntil(
        () => {
          if (rooms[rooms.length - 1] !== play.room()) rooms.push(play.room());
          return play.day() === 2 && play.room() === Room.Bookshop && play.inControl();
        },
        60_000,
        "le matin du jour 2",
      );
      if (!rooms.includes(Room.DayCard)) play.fail("le carton du jour n'a pas été montré");
      if (!night.some((text) => text.includes("il est temps de fermer"))) play.fail("Grace n'a pas fermé la boutique");
      const morning = play.skipText();
      if (![...night, ...morning].some((text) => text.includes("557 W. Ingram"))) play.fail("Grace n'a pas donné l'adresse des Gedde");
    },
  },
];
