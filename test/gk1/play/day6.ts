/**
 * Jour 6 de Gabriel Knight, du matin dans la librairie au réveil du jour 7 dans le studio.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés. Le jour 6 ne finit pas par `IconMap::endDay` : c'est le
 * rituel du bayou (`roomScript`, script 480) qui passe au jour 7. Pour y arriver :
 * - le bayou n'est sur la carte qu'une fois le message des tambours traduit (drapeau **268**, `PhraseDisplay::checkPhrases`,
 *   script 815) : le livre des tambours sur le joueur de tambour du coin nord-est de la place (`tom::doVerb`, script 410),
 *   puis les trois phrases 6, 10 et 26 du livre (« réunir assemblée secrète », « ce soir », « marécage ») ;
 * - le traqueur ne répond au bayou (`trackerOn`, script 490) que si l'émetteur est dans le petit cercueil du musée
 *   (drapeau **114**, `putSignalDevInCoffin`, script 260) et si le cercueil est emporté au rituel : le message de Gabriel
 *   sur la tombe de Marie Laveau (drapeau **246**, `rm302::dispose` : le texte « DJ APPORTE SEKE MADOULE ») ;
 * - traqueur et émetteurs sont dans le tiroir du bureau de Mosely (`drawer::doVerb`, script 240 : « ouvrir » puis
 *   « prendre »). Mosely parti, sa clé arrive par la poste (`getTheEnvelope`, script 210 ; l'enveloppe s'ouvre dans
 *   l'inventaire). Le sergent ne quitte son comptoir que pour les beignets (`daySixBeignet`, script 230) : le vendeur du
 *   coin sud-ouest de la place retourne « à Royal et Conti » si on le lui conseille (`manTeller`, script 440) ;
 * - écrire sur la tombe (`laveauTomb::doVerb`, script 300, verbe 66 : la brique) demande le gardien parti (minuterie de 25
 *   à 40 secondes), les deux messages copiés (`VoodooCode1`, `sVoodooCode`) et comparés dans l'inventaire (drapeau **249**) ;
 * - entrer dans le cercle demande le masque de crocodile, puis les deux réponses au docteur John (`questions`, script 480) ;
 *   une mauvaise réponse tue Gabriel. Le tatouage peint par Grace (`doTheTattoo`, script 213) rapporte trois points.
 */
import { Room } from "./day1";
import { Room3, answer, through } from "./day3";
import { Room5 } from "./day5";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room6 = {
  LaveauEditor: 302,
  BayouRitual: 480,
  BayouMaze: 490,
} as const;

/** Drapeaux du jeu que le jour 6 pose (voir l'en-tête). */
export const Flag6 = {
  SignalInCoffin: 114,
  MessageOnTomb: 246,
  ComparedMessages: 249,
  DrawerOpen: 252,
  BayouOnMap: 268,
} as const;

/** Script du bayou : ses variables locales 5 (distance au rituel) et 8 (direction du point du traqueur, 0 au nord, 2 à l'est). */
const BAYOU_SCRIPT = 490;
const BAYOU_DISTANCE = 5;
const BAYOU_DIRECTION = 8;

/** Les deux messages de la tombe, tels que l'éditeur les montre (`rm302::init`, textes français), sept signes par ligne. */
const TOMB_MESSAGES = ["DJOBSERVEGKMAISEVITEVIOLENCE", "DJREUNIONSECRETECESOIRAPPORTEFWETKASH"] as const;
/** Le message que Gabriel doit écrire (`rm302::init`, comparé dans `rm302::dispose`). */
const GABRIEL_MESSAGE = "DJAPPORTESEKEMADOULE";
/** Grille de l'éditeur (`messageView::doVerb`, script 302, valeurs françaises) : origine, pas, colonnes ; l'écran commence 10 lignes au-dessus de la pièce. */
const EDITOR_GRID = { left: 3, top: 32, width: 17, height: 20, columns: 7 } as const;

/** Éléments d'écran d'un nom donné, toutes fenêtres confondues. */
export function screenItems(play: Play, name: string) {
  return play.frameout.planes.filter((plane) => plane.priority >= 0).flatMap((plane) => plane.items.filter((item) => item.object !== 0 && play.vm.nameOf(item.object) === name));
}

/** Script de la pièce (0 s'il n'y en a pas). */
const roomScript = (play: Play) => play.prop(play.globalReg(2), "script");

/** Ouvre la barre d'icônes d'une scène (pointeur en haut de l'écran), clique une icône et ramène le pointeur dans la pièce. */
export function barIcon(play: Play, icon: string): void {
  play.point(160, 3);
  play.waitUntil(() => play.item(icon) !== undefined, 300, `l'icône ${icon}`);
  play.step(10);
  play.clickItem(icon);
  play.step(10);
  play.point(200, 120);
}

/** Clique la phrase `label` de la page ouverte du livre des tambours (`BookButton`, script 815). */
export function pickPhrase(play: Play, label: string): void {
  const button = screenItems(play, "BookButton").find((item) => play.vm.memory.getString(play.prop(item.object, "text")).startsWith(`${label}:`));
  if (!button) play.fail(`le livre des tambours n'a pas la phrase « ${label} » sur cette page`);
  play.click(button.screenRect.left + 20, (button.screenRect.top + button.screenRect.bottom) >> 1);
  play.step(30);
}

/** Tourne la page du livre des tambours vers la droite (`turnRight`, une zone au bord de la page). */
function turnPage(play: Play): void {
  const corner = play.object("turnRight").reg;
  play.click((play.num(corner, "nsLeft") + play.num(corner, "nsRight")) >> 1, (play.num(corner, "nsTop") + play.num(corner, "nsBottom")) >> 1);
  play.step(40);
}

/**
 * Écrit `GABRIEL_MESSAGE` dans l'éditeur de la tombe : chaque lettre est le signe qui la porte dans l'un des deux messages
 * copiés ; « Message suivant » (`codeIcon1`) passe de l'un à l'autre, « Sortie » (`codeIcon2`) valide.
 */
function writeOnTomb(play: Play): void {
  let page = 0;
  for (const letter of GABRIEL_MESSAGE) {
    if (!TOMB_MESSAGES[page].includes(letter)) {
      barIcon(play, "codeIcon1");
      play.waitUntil(() => roomScript(play) === 0, 600, "le message suivant");
      play.step(20);
      page = 1 - page;
    }
    const cell = TOMB_MESSAGES[page].indexOf(letter);
    play.click(EDITOR_GRID.left + (cell % EDITOR_GRID.columns) * EDITOR_GRID.width + 8, EDITOR_GRID.top + Math.floor(cell / EDITOR_GRID.columns) * EDITOR_GRID.height + 10);
    play.waitUntil(() => roomScript(play) === 0, 600, `le signe « ${letter} »`);
    play.step(10);
  }
  if (screenItems(play, "charView").length !== GABRIEL_MESSAGE.length) play.fail(`le mur ne porte pas ${GABRIEL_MESSAGE.length} signes`);
  barIcon(play, "codeIcon2");
}

interface Passage {
  dir: number;
  ritual: boolean;
  at: { x: number; y: number };
}

/** Passages de l'écran du bayou (`passageExit`, script 490) : direction, et le point où cliquer pour y marcher. */
function passages(play: Play): Passage[] {
  return play
    .objects()
    .filter((object) => object.name === "passageExit")
    .map(({ reg }) => ({
      dir: play.num(reg, "dir"),
      ritual: play.num(reg, "isRitual") !== 0,
      // Les rectangles sont en coordonnées de la pièce, dix lignes sous le haut de l'écran.
      at: { x: Math.max(1, Math.min(318, (play.num(reg, "nsLeft") + play.num(reg, "nsRight")) >> 1)), y: ((play.num(reg, "nsTop") + play.num(reg, "nsBottom")) >> 1) + 10 },
    }));
}

/**
 * Traqueur allumé, suit le point d'écran en écran jusqu'à celui d'où l'on voit le rituel (deux passages `isRitual`).
 * Rend ce que Gabriel a pensé en route.
 */
export function followTracker(play: Play): string[] {
  const read: string[] = [];
  const turn = (a: number, b: number): number => Math.min((a - b + 8) % 8, (b - a + 8) % 8);
  for (let screens = 0; ; screens++) {
    if (screens > 40) play.fail("le traqueur ne mène pas au rituel");
    read.push(...play.playUntil(() => play.inControl() && play.texts().length === 0 && passages(play).length > 0, 3000, "un écran du bayou"));
    const open = passages(play);
    if (open.some((passage) => passage.ritual)) return read;
    const wanted = play.local(BAYOU_SCRIPT, BAYOU_DIRECTION);
    const next = open.reduce((best, passage) => (turn(passage.dir, wanted) < turn(best.dir, wanted) ? passage : best));
    play.note(`bayou : distance ${play.local(BAYOU_SCRIPT, BAYOU_DISTANCE)}, le point est en ${wanted}, passage ${next.dir}`);
    play.selectVerb(Verb.Walk);
    play.click(next.at.x, next.at.y);
    play.waitUntil(() => passages(play).length === 0 || !play.inControl(), 3000, "la sortie de l'écran");
  }
}

/** Met le masque à l'écran du rituel : Gabriel entre dans le cercle, le docteur John pose sa première question. */
export function joinRitual(play: Play): string[] {
  play.useItem("crocMask", "GKEgo", { settle: false });
  return play.playUntil(() => play.room() === Room6.BayouRitual && play.menu().length > 0, 20_000, "la question du docteur John");
}

export const DAY6: readonly Stage[] = [
  {
    name: "j6-matin",
    title: "le journal ; l'enveloppe de Mosely, sa clé et sa note ; Grace peint le tatouage",
    score: 165,
    run(play) {
      if (play.day() !== 6 || play.room() !== Room.Bookshop) play.fail("l'étape part de la librairie, le matin du jour 6");
      // Le journal du 23 juin, veille de la Saint-Jean (1 point).
      const paper = play.use(Verb.Pickup, "newsPaper");
      if (!paper[0]?.startsWith("Le Times du 23 Juin 1993")) play.fail("ce n'est pas le journal du jour 6");
      // L'enveloppe tombe par la fente de la porte au bout d'une minuterie (`bookstore::cue`, à correctif de script).
      play.playUntil(() => play.present("envelope") && play.inControl() && play.texts().length === 0, 20_000, "l'enveloppe sous la porte");
      // Ramassée : un point (`getPoints` sans son nombre de points : `missingParams` de `game/fixes.ts`).
      play.use(Verb.Pickup, "envelope");
      if (!play.carried().includes("keyEnvelope")) play.fail("l'enveloppe n'est pas ramassée");
      // Ouverte dans l'inventaire (1 point) : la clé du bureau de Mosely et sa note, lue (1 point).
      play.inventory("keyEnvelope", "open");
      for (const item of ["mosKey", "mosLetter"]) if (!play.carried().includes(item)) play.fail(`l'enveloppe n'a pas donné « ${item} »`);
      const note = play.inventory("mosLetter", "read");
      if (play.insetOpen()) play.closeInset();
      if (!note.some((text) => text.includes("la clé de mon bureau"))) play.fail("la note de Mosely n'est pas lue");
      // Le décalque du tatouage à Grace : une soirée chic, puis sa jalousie ; elle peint le serpent au studio (3 points).
      play.useItem("tatooTrace", "graceProp", { settle: false });
      play.playUntil(() => play.menu().length > 0, 20_000, "la réponse à Grace");
      answer(play, `"Je vais à une soirée aujourd'hui. Une soirée chic, tu sais."`);
      const painted = answer(play, `"Eh bien, si tu es jaloux des sentiments que j'éprouves pour elle...."`, 40_000);
      play.skipText();
      if (play.room() !== Room3.Studio || play.carried().includes("tatooTrace") || !painted.some((text) => text.includes("Je suis vraiment la meilleure"))) play.fail("Grace n'a pas peint le tatouage");
      through(play, Verb.Operate, "curtainDoor", Room.Bookshop);
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
    },
  },
  {
    name: "j6-beignets",
    title: "le vendeur de beignets renvoyé à Royal et Conti ; le commissariat déserté : le traqueur du tiroir de Mosely",
    score: 170,
    run(play) {
      // Coin sud-ouest de la place : le vendeur de beignets a pris la place du vendeur de hot-dogs.
      play.travel("jackSquare");
      play.skipText();
      play.leave("westExit");
      play.skipText();
      const advice = ["Dites-moi, ne vous ai-je pas déjà vu quelque part?", "Vous dites qu'avant vous travailliez à Royal et Conti?", "Pourquoi avez-vous quitté Royal et Conti?", "Pourquoi n'y retournez-vous pas?", "Je crois sincérement que vous devriez retourner à Royal et Conti."];
      let last: string[] = [];
      for (const line of advice) {
        // Chaque réponse referme la fenêtre : on reparle au vendeur pour la suivante.
        play.skipText();
        play.use(Verb.Talk, "beignetMan", { settle: false });
        play.playUntil(() => play.menu().length > 0, 6000, "les répliques au vendeur");
        last = answer(play, line, 40_000);
      }
      play.skipText();
      // Il y retourne « dès aujourd'hui » (2 points).
      if (!last.some((text) => text.includes("Je vais y retourner"))) play.fail("le vendeur de beignets ne repart pas");
      play.leave("southExit");
      if (play.room() !== Room.CityMap) play.fail("la place ne ramène pas à la carte");
      // Au commissariat, le vendeur est devant la porte : Franks et le sergent sortent (`daySixBeignet`, 22 secondes).
      play.travel("policeLobby");
      const break_ = play.skipText();
      if (!break_.some((text) => text.includes("le vendeur de beignet"))) play.fail("le sergent n'est pas sorti pour les beignets");
      // Le portillon, puis la clé de Mosely sur sa porte (2 points).
      play.use(Verb.Operate, "gate");
      play.useItem("mosKey", "mosDoor", { settle: false });
      play.playUntil(() => play.room() === Room3.MoselyOffice, 3000, "le bureau de Mosely");
      play.skipText();
      // Le tiroir du bas : ouvert, puis vidé (1 point) : le traqueur et deux émetteurs.
      play.use(Verb.Open, "drawer");
      if (!play.flag(Flag6.DrawerOpen)) play.fail("le tiroir de Mosely ne s'ouvre pas");
      play.use(Verb.Pickup, "drawer");
      for (const item of ["tracker", "signalDev ", "signalDev2 "]) if (!play.carried().includes(item)) play.fail(`le tiroir n'a pas donné « ${item} »`);
      // Le sergent, revenu, chasse Gabriel de derrière le portillon.
      play.use(Verb.Operate, "officeDoor", { settle: false });
      const caught = play.playUntil(() => play.room() === Room.PoliceLobby && play.inControl() && play.texts().length === 0, 6000, "le retour dans le hall");
      if (!caught.some((text) => text.includes("Dégagez de là"))) play.fail("le sergent n'a pas renvoyé Gabriel");
      through(play, Verb.Operate, "extDoor", Room.CityMap);
    },
  },
  {
    name: "j6-tambours",
    title: "le livre des tambours sur le joueur de tambour : le bayou ; l'émetteur dans le petit cercueil du musée",
    score: 178,
    run(play) {
      // Coin nord-est de la place : le livre sur le joueur de tambour ouvre la traduction (script 815).
      play.travel("jackSquare");
      play.skipText();
      play.leave("northExit");
      play.skipText();
      play.useItem("drumBook", "tom", { settle: false });
      play.waitUntil(() => play.present("turnRight") && screenItems(play, "BookButton").length > 0, 3000, "le livre des tambours");
      play.step(60);
      // Une phrase par page : réunir l'assemblée secrète, ce soir, au marécage. La troisième déclenche la traduction (5 points).
      pickPhrase(play, "REUNIR ASSEMBLEE SECRETE");
      turnPage(play);
      pickPhrase(play, "CE SOIR");
      turnPage(play);
      pickPhrase(play, "MARECAGE");
      // Les lettres des tambours et les phrases choisies restent à l'écran : on ne guette que la phrase du narrateur.
      const bayou = (): boolean => play.texts().some((text) => text.includes("Ca doit être le Bayou"));
      play.playUntil(bayou, 3000, "la traduction");
      play.playUntil(() => !bayou(), 3000, "la fin de la traduction");
      if (!play.flag(Flag6.BayouOnMap)) play.fail("le message des tambours n'est pas traduit");
      barIcon(play, "exitIcon");
      play.waitUntil(() => !play.present("turnRight"), 600, "la fermeture du livre");
      play.skipText();
      play.leave("southExit");
      play.skipText();
      play.leave("southExit");
      if (play.room() !== Room.CityMap) play.fail("la place ne ramène pas à la carte");
      // Le musée : le docteur John nie connaître le « seke madoulé » ; l'émetteur y va quand même (3 points).
      play.travel("voodooMus");
      play.skipText();
      play.use(Verb.Open, "coffin");
      const hidden = play.useItem("signalDev ", "coffin");
      if (!play.flag(Flag6.SignalInCoffin) || !hidden.some((text) => text.includes("glisse le signal émetteur"))) play.fail("l'émetteur n'est pas dans le cercueil");
      through(play, Verb.Walk, "doorWay", Room.CityMap);
    },
  },
  {
    name: "j6-tombe",
    title: "cimetière : le second message copié et comparé, la brique, le message de Gabriel sur la tombe de Marie Laveau",
    score: 188,
    run(play) {
      play.travel("cemetery");
      play.skipText();
      // Le second message, copié au carnet (2 points) ; la brique au pied de la tombe (1 point).
      play.use(Verb.Look, "message2");
      play.useItem("sketchBook", "theInView");
      if (play.insetOpen()) play.closeInset();
      play.skipText();
      play.use(Verb.Pickup, "myBrick");
      for (const item of ["sVoodooCode", "brick"]) if (!play.carried().includes(item)) play.fail(`Gabriel n'a pas « ${item} »`);
      // Les deux copies comparées dans l'inventaire : presque tous les signes sont traduits (2 points).
      const compared = play.combine("sVoodooCode", "VoodooCode1");
      if (!play.flag(Flag6.ComparedMessages) || !compared.some((text) => text.includes("sauf trois"))) play.fail("les deux messages ne sont pas comparés");
      // Tant que le gardien est là, Gabriel n'écrit pas : il s'en va au bout de sa minuterie.
      const keeper = play.object("xKeeper").reg;
      play.playUntil(() => play.prop(keeper, "script") === 0 && play.num(keeper, "x") > 319 && play.inControl() && play.texts().length === 0, 8000, "le départ du gardien");
      // La brique sur la tombe ouvre l'éditeur de signes ; le bon message rapporte 5 points.
      play.useItem("brick", "laveauTomb", { settle: false });
      play.waitUntil(() => play.room() === Room6.LaveauEditor && play.inControl(), 3000, "l'éditeur de signes");
      play.step(80);
      writeOnTomb(play);
      const written = play.playUntil(() => play.room() === Room3.CemeteryLaveau && play.inControl() && play.texts().length === 0 && roomScript(play) === 0, 6000, "le retour devant la tombe");
      if (!play.flag(Flag6.MessageOnTomb) || !written.some((text) => text.includes("Satisfait de son message"))) play.fail("le message de Gabriel n'est pas le bon");
      play.leave("westExit");
      if (play.room() !== Room.CityMap) play.fail("le cimetière ne ramène pas à la carte");
    },
  },
  {
    name: "j6-bayou",
    title: "le bayou au traqueur, le masque de crocodile, les deux questions du docteur John, le rituel ; réveil du jour 7",
    score: 195,
    run(play) {
      play.travel("greatNO1");
      play.travel("bayou");
      play.playUntil(() => play.room() === Room6.BayouMaze && play.inControl() && play.texts().length === 0, 3000, "le bayou");
      // Le traqueur sur Gabriel : l'émetteur répond, le point donne la direction d'écran en écran.
      const signal = play.useItem("tracker", "GKEgo");
      if (!signal.some((text) => text.includes("Ca marche"))) play.fail("le traqueur ne capte pas l'émetteur");
      // L'écran d'où l'on voit les feux (3 points) ; le masque fait entrer Gabriel dans le cercle (2 points).
      followTracker(play);
      joinRitual(play);
      // « Le grand serpent » : Damballah. « Le destructeur des hommes » : Ogoun Badagris. Puis le rituel (2 points).
      play.talkTopic("Damballah.", () => play.menu().length > 0, 20_000);
      const ritual = play.talkTopic("Ogoun Badagris.", () => play.day() === 7, 80_000);
      if (!ritual.some((text) => text.includes("TETELO"))) play.fail("le rituel n'a pas appelé Tetelo");
      const waking = play.playUntil(() => play.room() === Room3.Studio && play.inControl() && play.texts().length === 0, 80_000, "le réveil du jour 7");
      if (!waking.some((text) => text.includes("Appelle Wolfgang"))) play.fail("Grace n'a pas réveillé Gabriel");
      play.skipText();
    },
  },
];

/** À la première question du docteur John, une mauvaise réponse : Gabriel est démasqué et tué (pièce 770). */
export function wrongAnswer(play: Play): string[] {
  return play.talkTopic("Papa Gede?", () => play.room() === Room5.Death && play.menu().length === 3, 20_000);
}
