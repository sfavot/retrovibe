/**
 * Jour 10 de Gabriel Knight, de la carte de La Nouvelle-Orléans au générique de fin.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés.
 * - Librairie (script 210) : la note de Malia sur le bureau (`readMaliasNote`, 1 point) fait entrer Mosely ; la scène finit
 *   dans le studio (220). Son interrogatoire (`mosely::cue`, script 1051) : « Fais un plan » pose le drapeau **326** ; au
 *   retour, `moselyLeaves` lui remet le traqueur (2 points). Sans ce drapeau, le confessionnal de droite reste fermé au
 *   jour 10 (`sGoToConfession`, script 450).
 * - Confessionnal (455) : la tige en forme de serpent dans le creux du panneau (`sGabeUsesKey`, 3 points, drapeau **272** :
 *   l'ascenseur est en bas) ; l'émetteur puis la tige sous le coussin de prière, pour Mosely (`sStowStuff`, 1 point chacun,
 *   drapeaux **281** et **280**). Un clic hors de la cabine fait sortir (`rm455::doVerb`, `sExitElevator`) ; les deux
 *   objets laissés posent le drapeau **351** : Mosely suivra.
 * - Hounfour (script 800) : un couloir rond de douze tronçons, `curLoc` 0 à 11 ; la porte du tronçon k ouvre la salle
 *   801 + k, et son enseigne porte k + 1 serpents. On change de tronçon en marchant dans un des deux rectangles de
 *   `sMainHallways::doit` : (0, 140)-(235, 148) vers k − 1, (180, 100)-(221, 118) vers k + 1. Le clic de marche vise dix
 *   lignes au-dessus du pointeur. Le boîtier de la porte (`keypad`, verbe « actionner ») fait entrer et sortir ; les salles
 *   801, 808 et 811 demandent la carte-clé (`sUnlockDoor`, 1 point chacune). Un tronçon pair a une voûte (`hall`) vers un
 *   rayon (`curLoc` 12 à 17), qui mène à la salle du rituel (script 900, `curLoc` 900, sorties `e1` à `e6`).
 * - Salle 804 : l'annuaire noir (`sGetBook`, 2 points), qui ajoute le second livre à l'écran des tambours (script 815).
 *   Salle 807 : deux masques et deux robes (1 point par déguisement complet). Salle 803 : Malia et Tetelo (drapeau **350**).
 * - Salle du rituel : les tambours (`sPlayDrums`), second livre, « LE FRERE AIGLE » (`checkPhrases` : drapeau **346**,
 *   5 points) : le docteur John sort de la salle 802 (`sDrJohnWalk` : 5 secondes au tronçon 1, puis 16 secondes par pas,
 *   tronçon 2, rayon 13, salle du rituel et retour). Il tue Gabriel s'il le croise ; on sort par `e1` (rayon 12, tronçon 0)
 *   et on entre dans sa chambre par le tronçon 1 pendant qu'il est au-delà : la carte-clé (`sGetKeys`, 2 points).
 * - Salle 808 : Grace, puis Mosely (drapeau 351). `djTimer` laisse 40 puis 20 secondes par geste : le talisman sur Grace
 *   (drapeau **370**, 2 points), le sanglier à Mosely (**365**, 1 point), le loup sur Gabriel (**366**, 1 point) ; le
 *   docteur John emmène tout le monde au rituel (pièce 899).
 * - Rituel (899, messages du module 900), quatre moments où le joueur a la main, 10 secondes chacun, 15 pour le dernier :
 *   le talisman sur Malia (3 points ; avec Mosely, la bande dessinée 891), le talisman à Mosely (3 points), l'idole prise
 *   (5 points ; bande dessinée 892), enfin la main tendue à Malia (`sFinale`, 10 points, bande dessinée 893 : Gabriel vit)
 *   ou rien (`sPart4`, bande dessinée 894, drapeau **407** : Gabriel meurt). Les deux fins passent par l'épilogue (670 :
 *   `sayAlive` ou `sayDead`, puis le score en trois chiffres) et le générique (680), après quoi le jeu s'arrête.
 */
import { Room, endInterrogation, interrogate } from "./day1";
import { Room3, through } from "./day3";
import { Room5 } from "./day5";
import { barIcon, pickPhrase, screenItems } from "./day6";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room10 = {
  Confessional: 455,
  Hounfour: 800,
  Ceremony: 899,
  Epilogue: 670,
  Credits: 680,
} as const;

/** Drapeaux du jeu que le jour 10 pose (voir l'en-tête). */
export const Flag10 = {
  MadePlan: 326,
  ElevatorDown: 272,
  RodStowed: 280,
  SignalStowed: 281,
  MoselyFollows: 351,
  SawMaliaAndTetelo: 350,
  CalledDrJohn: 346,
  GraceAwake: 370,
  MoselyDisguised: 365,
  GabrielDisguised: 366,
  GabrielDied: 407,
} as const;

/** `curLoc` de la salle du rituel ; les rayons vont de 12 à 17. */
const RITUAL_ROOM = 900;
const FIRST_SPOKE = 12;
/** Clics de marche qui mènent dans les rectangles de changement de tronçon (le jeu vise dix lignes plus haut). */
const RING_DOWN = { x: 150, y: 157 };
const RING_UP = { x: 200, y: 124 };
/** Dans un rayon : le bord gauche ramène au couloir rond, le bord droit entre dans la salle du rituel. */
const SPOKE_TO_RING = { x: 44, y: 140 };
const SPOKE_TO_RITUAL = { x: 275, y: 140 };

/** Où est Gabriel dans le hounfour (`Hounfour.curLoc`). */
export const hounfourLoc = (play: Play): number => play.num(play.globalReg(2), "curLoc");

const settled = (play: Play): boolean => play.inControl() && play.texts().length === 0;

/** Script en cours de Gabriel et son état (« sPart2@16 ») : les moments du rituel où le joueur a la main. */
const egoScript = (play: Play): string => {
  const script = play.prop(play.ego, "script");
  return script ? `${play.vm.nameOf(script)}@${play.num(script, "state")}` : "";
};

/** Suit le couloir rond jusqu'au tronçon `target`, par le plus court. */
export function ringTo(play: Play, target: number): void {
  for (let steps = 0; hounfourLoc(play) !== target; steps++) {
    const from = hounfourLoc(play);
    if (steps > 12 || from > 11) play.fail(`Gabriel ne trouve pas le tronçon ${target} du couloir rond`);
    const down = (from - target + 12) % 12 <= 6;
    play.selectVerb(Verb.Walk);
    play.click(down ? RING_DOWN.x : RING_UP.x, down ? RING_DOWN.y : RING_UP.y);
    play.waitUntil(() => hounfourLoc(play) !== from, 3000, `la sortie du tronçon ${from}`);
    play.playUntil(() => settled(play) && !play.walking(), 3000, "l'arrivée dans le tronçon suivant");
  }
}

/** Actionne le boîtier d'une porte (ou y passe la carte-clé) : entre dans la salle du tronçon, ou en sort. */
export function throughDoor(play: Play, key?: string): string[] {
  const from = hounfourLoc(play);
  const said = key ? play.useItem(key, "keypad", { settle: false }) : play.use(Verb.Operate, "keypad", { settle: false });
  return [...said, ...play.playUntil(() => hounfourLoc(play) !== from && settled(play), 6000, `la porte (départ ${from})`)];
}

/** D'un tronçon pair, passe la voûte et traverse le rayon jusqu'à la salle du rituel. */
function toRitualRoom(play: Play): void {
  play.use(Verb.Walk, "hall", { settle: false });
  play.playUntil(() => hounfourLoc(play) >= FIRST_SPOKE && settled(play), 6000, "le rayon");
  play.selectVerb(Verb.Walk);
  play.click(SPOKE_TO_RITUAL.x, SPOKE_TO_RITUAL.y);
  play.playUntil(() => hounfourLoc(play) === RITUAL_ROOM && settled(play), 6000, "la salle du rituel");
}

/** De l'ascenseur (salle 806), sort dans le couloir rond. */
function leaveElevatorRoom(play: Play): void {
  play.use(Verb.Operate, "keyPad2", { settle: false });
  play.playUntil(() => hounfourLoc(play) === 5 && settled(play), 6000, "le couloir rond");
}

/** Au dernier moment du rituel, ne rien faire : Malia entraîne Gabriel (fin où il meurt). Rend les répliques jusqu'au score. */
export function letMaliaFall(play: Play): string[] {
  return play.playUntil(() => play.room() === Room10.Epilogue && play.present("finalInset"), 60_000, "l'épilogue sans Gabriel");
}

/** Ferme la fenêtre du score (un clic à côté), suit le générique jusqu'à l'arrêt du jeu ; rend le nombre d'images du générique. */
export function creditsToEnd(play: Play): number {
  play.click(20, 150);
  play.waitUntil(() => play.room() === Room10.Credits, 3000, "le générique");
  return play.playToEnd(20_000);
}

/** Variante : entrer chez le docteur John tant qu'il est chez lui et toucher à sa carte-clé (`sDJKillGabe`, script 802). */
export function killedByDrJohn(play: Play): string[] {
  leaveElevatorRoom(play);
  ringTo(play, 1);
  throughDoor(play);
  if (!play.present("xDJ")) play.fail("le docteur John n'est pas dans sa chambre");
  play.use(Verb.Pickup, "hounfourKey", { settle: false });
  return play.playUntil(() => play.room() === Room5.Death && play.menu().length === 3, 6000, "la mort chez le docteur John");
}

export const DAY10: readonly Stage[] = [
  {
    name: "j10-matin",
    title: "librairie vide : la note de Malia, Mosely revenu d'entre les morts, le plan, le traqueur",
    score: 266,
    run(play) {
      if (play.day() !== 10 || play.room() !== Room.GreaterMap) play.fail("l'étape part de la carte, au jour 10");
      // La carte ne rend pas la main, mais ses icônes répondent.
      play.travel("frenchQ");
      play.travel("bookStore");
      const empty = play.playUntil(() => settled(play), 20_000, "la librairie vide");
      if (!empty.some((text) => text.includes("Grace!")) || play.present("graceProp")) play.fail("Grace est encore à la librairie");
      // La note de Malia (1 point) : Mosely entre, on passe dans le studio pour parler.
      play.use(Verb.Pickup, "maliasNote", { settle: false });
      const note = play.playUntil(() => play.room() === Room3.Studio && settled(play) && play.present("mosely"), 20_000, "Mosely dans le studio");
      for (const line of ["Elle a pris Grace.", "C'était toi à la tombe?"]) if (!note.some((text) => text.includes(line))) play.fail(`la scène de la note n'a pas dit « ${line} »`);
      // Son portefeuille et sa carte de crédit lui reviennent (aucun point).
      play.useItem("wallet", "mosely");
      play.useItem("master card", "mosely");
      if (play.carried().includes("wallet") || play.carried().includes("master card")) play.fail("Mosely n'a pas repris son portefeuille et sa carte");
      // « Fais un plan » : Gabriel cherchera l'entrée, Mosely suivra au traqueur.
      interrogate(play, "mosely");
      const plan = play.talkTopic("Fais un plan");
      if (!play.flag(Flag10.MadePlan) || !plan.some((text) => text.includes("tu laisses un émetteur à l'entrée"))) play.fail("le plan n'est pas fait");
      // Au retour, Mosely prend le traqueur (2 points) et s'en va.
      const leaves = [...endInterrogation(play, Room3.Studio), ...play.playUntil(() => settled(play) && !play.present("mosely"), 20_000, "le départ de Mosely")];
      if (!leaves.some((text) => text.includes("Voici le traqueur.")) || play.carried().includes("tracker")) play.fail("Mosely n'a pas pris le traqueur");
    },
  },
  {
    name: "j10-cathedrale",
    title: "cathédrale : le confessionnal de droite, la tige dans le creux, l'ascenseur ; l'émetteur et la tige laissés à Mosely",
    score: 271,
    run(play) {
      through(play, Verb.Operate, "curtainDoor", Room.Bookshop);
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      play.travel("louisCath");
      play.skipText();
      play.use(Verb.Operate, "confess3", { settle: false });
      play.playUntil(() => play.room() === Room10.Confessional && settled(play), 3000, "le confessionnal");
      // La tige en forme de serpent dans le creux du panneau (3 points) : la cabine descend.
      play.useItem("rod", "knothole", { settle: false });
      const ride = play.playUntil(() => settled(play) && play.flag(Flag10.ElevatorDown), 6000, "la descente");
      if (!ride.some((text) => text.includes("Ca bouge!"))) play.fail("l'ascenseur n'a pas bougé");
      // L'émetteur et la tige sous le coussin de prière (1 point chacun) : Mosely pourra suivre.
      const signal = play.useItem("signalDev2 ", "bench1");
      play.useItem("rod", "bench1");
      if (!signal.some((text) => text.includes("c'est ton signal")) || !play.flag(Flag10.SignalStowed) || !play.flag(Flag10.RodStowed)) play.fail("l'émetteur et la tige ne sont pas sous le coussin");
      // Un clic hors de la cabine : Gabriel sort dans la salle 806, l'ascenseur remonte.
      play.selectVerb(Verb.Walk);
      play.click(20, 150);
      play.waitUntil(() => play.room() === Room10.Hounfour, 6000, "le hounfour");
      const arrival = play.playUntil(() => settled(play) && play.present("keyPad2"), 6000, "la salle de l'ascenseur");
      if (!arrival.some((text) => text.includes("Gabriel est coincé maintenant")) || !play.flag(Flag10.MoselyFollows)) play.fail("l'ascenseur n'est pas remonté pour Mosely");
    },
  },
  {
    name: "j10-hounfour",
    title: "hounfour : l'annuaire noir, Malia et Tetelo, robes et masques, la table du rituel, les tambours appellent le docteur John",
    score: 280,
    run(play) {
      leaveElevatorRoom(play);
      // Tronçon 3, quatre serpents sur l'enseigne : la salle 804, l'annuaire noir (2 points).
      ringTo(play, 3);
      const sign = play.use(Verb.Look, "signFeat");
      if (!sign.some((text) => text.includes("4 serpents"))) play.fail("l'enseigne du tronçon 3 ne compte pas quatre serpents");
      throughDoor(play);
      play.use(Verb.Look, "book");
      const book = play.use(Verb.Pickup, "book");
      if (!book.some((text) => text.includes("Mosely veut donner au FBI"))) play.fail("l'annuaire noir n'est pas pris");
      throughDoor(play);
      // Tronçon 2, la chambre de Malia : elle supplie Tetelo d'épargner Gabriel, qui écoute caché.
      ringTo(play, 2);
      const malia = throughDoor(play);
      if (!play.flag(Flag10.SawMaliaAndTetelo) || !malia.some((text) => text.includes("Gabriel ne me trahirait jamais!"))) play.fail("la scène de Malia et Tetelo n'a pas eu lieu");
      throughDoor(play);
      // Tronçon 6, la réserve : un masque et une robe pour chacun (1 point par déguisement).
      ringTo(play, 6);
      throughDoor(play);
      for (const piece of ["masks", "robes", "masks", "robes"]) play.use(Verb.Pickup, piece);
      for (const guise of ["WolfGuise", "BoarGuise"]) if (!play.carried().includes(guise)) play.fail(`pas de déguisement ${guise}`);
      play.use(Verb.Walk, "door1", { settle: false });
      play.playUntil(() => hounfourLoc(play) === 6 && settled(play), 6000, "le couloir rond");
      // Par la voûte et le rayon, la salle du rituel : l'histoire gravée sur la table.
      toRitualRoom(play);
      const table = play.use(Verb.Look, "table");
      if (!table.some((text) => text.includes("construit sous le Square Jackson"))) play.fail("la table du rituel n'est pas lue");
      // Les tambours : second livre (l'annuaire), « LE FRERE AIGLE », sortie (5 points). Une porte s'ouvre au loin.
      play.use(Verb.Operate, "lDrums", { settle: false });
      play.playUntil(() => screenItems(play, "BookButton").length > 0, 3000, "l'écran des tambours");
      barIcon(play, "nextBookIcon");
      play.step(30);
      pickPhrase(play, "LE FRERE AIGLE");
      barIcon(play, "exitIcon");
      const door = play.playUntil(() => settled(play) && !play.present("drumInset"), 6000, "la fin du message des tambours");
      if (!play.flag(Flag10.CalledDrJohn) || !door.some((text) => text.includes("une porte s'ouvrir au loin"))) play.fail("le docteur John n'a pas entendu les tambours");
    },
  },
  {
    name: "j10-cle",
    title: "le docteur John en route vers la salle du rituel : sa carte-clé, l'argent de la salle 801, la salle 811",
    score: 285,
    run(play) {
      // Il vient par le rayon 13 : sortir par `e1` (rayon 12), rejoindre le tronçon 0, puis le 1 une fois qu'il l'a quitté.
      play.use(Verb.Walk, "e1", { settle: false });
      play.playUntil(() => hounfourLoc(play) === FIRST_SPOKE && play.inControl(), 3000, "le rayon 12");
      play.selectVerb(Verb.Walk);
      play.click(SPOKE_TO_RING.x, SPOKE_TO_RING.y);
      play.playUntil(() => hounfourLoc(play) === 0 && settled(play) && !play.walking(), 3000, "le tronçon 0");
      ringTo(play, 1);
      // Sa chambre est vide : la carte-clé au mur (2 points). Retour au tronçon 0 avant qu'il revienne.
      throughDoor(play);
      if (play.present("xDJ")) play.fail("le docteur John est dans sa chambre");
      play.use(Verb.Pickup, "hounfourKey");
      if (!play.carried().includes("hounfourKey")) play.fail("la carte-clé n'est pas prise");
      throughDoor(play);
      ringTo(play, 0);
      // Salle 801, fermée : la carte-clé (1 point), une liasse de billets (1 point).
      const works = throughDoor(play, "hounfourKey");
      if (!works.some((text) => text.includes("Ca marche!"))) play.fail("la carte-clé n'ouvre pas la salle 801");
      const cash = play.use(Verb.Pickup, "cash1");
      if (!cash.some((text) => text.includes("argent sale"))) play.fail("l'argent n'est pas pris");
      throughDoor(play);
      // Salle 811, fermée elle aussi (1 point) : la morgue. Puis le tronçon 7, devant la cellule de Grace.
      ringTo(play, 10);
      throughDoor(play, "hounfourKey");
      if (!play.present("gurney")) play.fail("Gabriel n'est pas dans la salle 811");
      throughDoor(play);
      ringTo(play, 7);
    },
  },
  {
    name: "j10-grace",
    title: "salle 808 : Grace endormie, Mosely arrive ; le talisman la réveille, le sanglier et le loup ; le docteur John les mène au rituel",
    score: 290,
    run(play) {
      // La carte-clé (1 point) : Grace, puis Mosely qui a suivi l'émetteur.
      const found = throughDoor(play, "hounfourKey");
      for (const line of ["Je l'ai trouvée!", "Mosely! T'as réussi!"]) if (!found.some((text) => text.includes(line))) play.fail(`la salle 808 n'a pas dit « ${line} »`);
      // Le talisman réveille Grace (2 points) ; on fait un plan.
      const woke = play.useItem("talisman", "grace");
      if (!play.flag(Flag10.GraceAwake) || !woke.some((text) => text.includes("Nous allons donc attendre ton signal."))) play.fail("Grace n'est pas réveillée");
      // Le sanglier pour Mosely (1 point), le loup pour Gabriel (1 point) : le docteur John entre aussitôt.
      play.useItem("BoarGuise", "mosely");
      if (!play.flag(Flag10.MoselyDisguised)) play.fail("Mosely n'est pas déguisé");
      play.useItem("WolfGuise", "GKEgo", { settle: false });
      const taken = play.playUntil(() => play.room() === Room10.Ceremony && play.inControl() && egoScript(play) === "sPart1@40", 60_000, "le rituel");
      if (!play.flag(Flag10.GabrielDisguised)) play.fail("Gabriel n'est pas déguisé");
      for (const line of ["Allez vers le cercle!", "accepte ce sacrifice!"]) if (!taken.some((text) => text.includes(line))) play.fail(`le début du rituel n'a pas dit « ${line} »`);
    },
  },
  {
    name: "j10-rituel",
    title: "rituel : le talisman contre Tetelo, puis lancé à Mosely qui sauve Grace ; l'idole renversée",
    score: 301,
    run(play) {
      // Dix secondes : le talisman sur Malia possédée (3 points). Grace vit (bande dessinée 891).
      play.useItem("talisman", "malia", { settle: false });
      const first = play.playUntil(() => play.inControl() && egoScript(play) === "sPart2@16", 60_000, "la menace de Tetelo");
      if (!first.some((text) => text.includes("Je ne te laisserai pas la tuer!"))) play.fail("le talisman n'a pas arrêté Tetelo");
      // Dix secondes : le talisman à Mosely (3 points), qui emporte Grace. Gabriel reste sans défense.
      play.useItem("talisman", "mosely", { settle: false });
      const second = play.playUntil(() => play.inControl() && egoScript(play) === "sPart3@20", 60_000, "Gabriel à genoux");
      if (!second.some((text) => text.includes("Sors Grace de là!")) || play.carried().includes("talisman")) play.fail("Mosely n'a pas reçu le talisman");
      // Dix secondes : l'idole (5 points). Le sol s'ouvre (bande dessinée 892), Malia est suspendue au-dessus du gouffre.
      play.use(Verb.Pickup, "idol", { settle: false });
      const third = play.playUntil(() => play.inControl() && egoScript(play) === "sPart4@28", 60_000, "Malia au bord du gouffre");
      if (!third.some((text) => text.includes("Gabriel...je t'en prie!"))) play.fail("l'idole n'est pas renversée");
    },
  },
  {
    name: "j10-fin",
    title: "la main tendue à Malia : elle lâche prise, Gabriel vit ; épilogue avec Grace, score final",
    score: 311,
    run(play) {
      // Quinze secondes : prendre la main de Malia (10 points, bande dessinée 893).
      play.use(Verb.Pickup, "malia", { settle: false });
      const end = play.playUntil(() => play.room() === Room10.Epilogue && play.present("finalInset"), 60_000, "l'épilogue");
      for (const line of ["Je te tiens, Malia!", "Adieu. Mon amour.", "Tu vas donc le faire? Etre Schattenjäger?"]) {
        if (!end.some((text) => text.includes(line))) play.fail(`la fin n'a pas dit « ${line} »`);
      }
      if (play.flag(Flag10.GabrielDied)) play.fail("la fin jouée est celle où Gabriel meurt");
    },
  },
];

/** Les trois chiffres du score affichés à l'épilogue (`finalInset`, vue 959 : le cel de chaque chiffre est sa valeur). */
export function finalScoreShown(play: Play): number {
  return ["cFour", "cFive", "cSix"].reduce((value, name) => value * 10 + play.num(play.object(name).reg, "cel"), 0);
}
