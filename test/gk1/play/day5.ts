/**
 * Jour 5 de Gabriel Knight, du matin dans la librairie au matin du jour 6.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés. Ce que les scripts exigent pour finir la journée
 * (`IconMap::endDay`, script 20) : deux drapeaux.
 * - le drapeau **73** : la recherche de Grace sur les tambours Rada, acquise au jour 4 ;
 * - le drapeau **16** : Mosely rouvre l'enquête (`walkToTheDoor`, script 240). Il ne le fait qu'une fois trois preuves
 *   reçues (`showMoselyPaper` et `showMoselyOther`, script 240 : drapeaux 33, 241 et 26), et ne les regarde qu'après le
 *   sujet « Réouvre le cas » de son interrogatoire (`mosely::cue`, script 1051, sujet 43 : drapeau 331) :
 *   - **33**, « ils sont une menace » : la coupure de presse de 1810 (`news1810`), reçue de Grace ;
 *   - **241**, le lien avec le musée : les deux écailles réunies (`twoScales`). Celle du musée vient de l'attaque du
 *     python (`snakeAttack`, script 260, jouée à l'entrée du musée au jour 5) : Gabriel étranglé a la main, et seul le
 *     ventilateur le sauve (`fanSwitch::doVerb`, verbe « actionner » quand le script a passé l'état 9 ; sinon la pièce 770,
 *     la mort). De retour à la librairie, Grace trouve l'écaille (`graceGetsScale`, script 212, drapeau 96) et la pose dans
 *     le cendrier ; la pince la prend (`ashTray::doVerb`, `getScale`). La loupe sur chaque écaille dans l'inventaire
 *     (`lakeScale::doVerb` et `musScale::doVerb`, script 15 : drapeaux 319 et 320) les réunit ;
 *   - **26**, « un culte existe » : le motif reconstitué (`reconVeve`), que Mosely n'accepte qu'appuyé par les notes de
 *     Hartridge (`hartNotes`, drapeau 27). Hartridge est mort à son bureau (`hartIsDead`, script 340, au jour 5) ; ses
 *     notes sont sur le bureau (`notes::doVerb`, `takeHartNotes`).
 */
import { Room, endInterrogation, interrogate } from "./day1";
import { Room3, through } from "./day3";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room5 = {
  /** Film de la moto, joué une fois en quittant la carte (pièce 372, drapeau 449). */
  Motorcycle: 372,
  Death: 770,
  Title: 375,
} as const;

/** Drapeaux du jeu que le jour 5 pose (voir l'en-tête). */
export const Flag5 = {
  MoselyReopensCase: 16,
  ProvedCultExists: 26,
  MoselySawNotes: 27,
  ProvedCultIsThreat: 33,
  SnakeAttacked: 96,
  HartridgeFoundDead: 224,
  ProvedMuseumLink: 241,
  ScaleInAshtray: 321,
  AskedToReopenCase: 331,
  TookHartridgeNotes: 422,
} as const;

/** État de `snakeAttack` (script 260) où le python serre et où le joueur reprend la main. */
const SNAKE_CHOKING = 10;

/** Bouton « Recommencer » de l'écran de la mort (`deathScript`, script 770 : troisième bouton, valeur 111). */
const RESTART_BUTTON = { x: 242, y: 161 };

/** Nom et état du script de la pièce. */
function roomScript(play: Play): { name: string; state: number } | undefined {
  const script = play.prop(play.globalReg(2), "script");
  return script === 0 ? undefined : { name: play.vm.nameOf(script), state: play.num(script, "state") };
}

/** De la carte au musée du vaudou, jusqu'à ce que le python serre Gabriel : le joueur a la main, le temps compte. */
export function intoSnakeAttack(play: Play): string[] {
  play.travel("voodooMus");
  play.waitUntil(() => play.room() === Room3.VoodooMuseum, 3000, "le musée du vaudou");
  return play.playUntil(
    () => {
      const script = roomScript(play);
      return script?.name === "snakeAttack" && script.state >= SNAKE_CHOKING && play.inControl() && play.texts().length === 0;
    },
    3000,
    "l'étreinte du python",
  );
}

/** Laisse le python étouffer Gabriel, puis choisit « Recommencer » : le jeu revient à l'écran-titre. */
export function dieAndRestart(play: Play): string[] {
  const last = play.playUntil(() => play.room() === Room5.Death && play.menu().length === 3, 6000, "l'écran de la mort");
  play.click(RESTART_BUTTON.x, RESTART_BUTTON.y);
  play.waitUntil(() => play.room() === Room5.Title && play.present("playButt"), 3000, "l'écran-titre");
  return last;
}

/**
 * Variante du matin du jour 5 pour le correctif « dialogue du livre des tambours » (script 212, `getTheVeve`) : la
 * recherche sur le motif a été demandée au jour 3 (la coupure de 1810 arrive au matin du jour 4), celle sur les tambours
 * au jour 4. Part de la carte du Quartier Français au jour 4, toutes les autres conditions du soir réunies ; rend les
 * répliques de la nuit et du matin.
 */
export function nightIntoDay5(play: Play): string[] {
  play.travel("bookStore");
  const read = play.playUntil(() => play.day() === 5 && play.room() === Room.Bookshop && play.inControl() && play.texts().length === 0, 120_000, "le matin du jour 5");
  play.skipText();
  return read;
}

export const DAY5: readonly Stage[] = [
  {
    name: "j5-matin",
    title: "le journal du 22 juin ; le musée du vaudou : le python, le ventilateur",
    score: 146,
    run(play) {
      if (play.day() !== 5 || play.room() !== Room.Bookshop) play.fail("l'étape part de la librairie, le matin du jour 5");
      // Le journal du 22 juin (1 point).
      const paper = play.use(Verb.Pickup, "newsPaper");
      if (!paper[0]?.startsWith("Le Times du 22 Juin 1993")) play.fail("ce n'est pas le journal du jour 5");
      // La première sortie du jour passe par le film de la moto (pièce 372), puis le musée : il est fermé et sombre.
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
      const attack = intoSnakeAttack(play);
      if (!attack.some((text) => text.includes("Pourquoi fait-il si noir"))) play.fail("le musée n'est pas plongé dans le noir");
      // Le python tombe sur Gabriel. Le ventilateur, à côté de la porte, le fait lâcher (5 points) ; le docteur John arrive.
      play.use(Verb.Operate, "fanSwitch", { settle: false });
      const saved = play.playUntil(() => play.room() === Room.CityMap, 6000, "la sortie du musée");
      if (!play.flag(Flag5.SnakeAttacked) || !saved.some((text) => text.includes("essayé de me TUER"))) play.fail("le python n'a pas lâché Gabriel");
    },
  },
  {
    name: "j5-ecailles",
    title: "la librairie : l'écaille du python dans le cendrier, la loupe, les deux écailles réunies",
    score: 150,
    run(play) {
      // Grace trouve une écaille sur le visage de Gabriel et la pose dans le cendrier.
      play.travel("bookStore");
      const grace = play.skipText();
      if (!play.flag(Flag5.ScaleInAshtray) || !grace.some((text) => text.includes("un truc brillant"))) play.fail("Grace n'a pas trouvé l'écaille");
      // La pince la prend (1 point).
      play.useItem("tweezers", "ashTray");
      if (!play.carried().includes("musScale")) play.fail("l'écaille du musée n'est pas dans l'inventaire");
      // La loupe sur l'écaille du lac puis sur celle du musée : les mêmes teintes, Gabriel les réunit (3 points).
      play.combine("magGlass", "lakeScale");
      if (play.insetOpen()) play.closeInset();
      const match = play.combine("magGlass", "musScale");
      if (play.insetOpen()) play.closeInset();
      if (!play.carried().includes("twoScales") || !match.some((text) => text.includes("les deux écailles ensemble"))) play.fail("les deux écailles ne sont pas réunies");
      through(play, Verb.Operate, "shopDoor", Room.CityMap);
    },
  },
  {
    name: "j5-hartridge",
    title: "Tulane : Hartridge mort à son bureau, ses notes",
    score: 152,
    run(play) {
      play.travel("greatNO1");
      play.travel("tulane");
      play.skipText(40_000);
      // Gabriel trouve le corps : la scène se joue à l'entrée.
      play.use(Verb.Operate, "smallDoor", { settle: false });
      play.waitUntil(() => play.room() === Room3.HartridgeOffice, 3000, "le bureau de Hartridge");
      const found = play.skipText(40_000);
      if (!play.flag(Flag5.HartridgeFoundDead) || !found.some((text) => text.includes("Hartridge?"))) play.fail("Gabriel n'a pas trouvé Hartridge mort");
      // Les notes sur le bureau (2 points).
      play.use(Verb.Pickup, "notes");
      if (!play.carried().includes("hartNotes") || !play.flag(Flag5.TookHartridgeNotes)) play.fail("les notes de Hartridge ne sont pas prises");
      through(play, Verb.Walk, "officeDoor", Room3.LectureHall);
      through(play, Verb.Operate, "doors", Room.GreaterMap);
      play.travel("frenchQ");
    },
  },
  {
    name: "j5-mosely",
    title: "le commissariat : Mosely rouvre l'enquête sur trois preuves ; la nuit",
    score: 158,
    run(play) {
      play.travel("policeLobby");
      play.skipText();
      interrogate(play, "deskSarg");
      play.talkTopic("Détective Mosely");
      endInterrogation(play, Room.PoliceLobby);
      play.use(Verb.Operate, "mosDoor", { settle: false });
      play.playUntil(() => play.room() === Room3.MoselyOffice, 3000, "le bureau de Mosely");
      const closed = play.skipText(40_000);
      if (!closed.some((text) => text.includes("Sale traître"))) play.fail("Mosely n'a pas annoncé que l'affaire était classée");
      // Tant que Gabriel n'a pas demandé comment le convaincre, Mosely refuse tout : « L'affaire est classée ».
      interrogate(play, "mosely");
      const terms = play.talkTopic("Réouvre le cas");
      if (!play.flag(Flag5.AskedToReopenCase) || !terms.some((text) => text.includes("prouver qu'ils sont une menace"))) play.fail("Mosely n'a pas dit ce qu'il lui faut");
      endInterrogation(play, Room3.MoselyOffice);
      // La coupure de 1810 : ils ont tué, ils tuent (2 points).
      play.useItem("news1810", "mosely");
      if (!play.flag(Flag5.ProvedCultIsThreat)) play.fail("la coupure de presse n'a pas convaincu Mosely");
      // Les notes de Hartridge : intéressant, si c'est vérifié.
      play.useItem("hartNotes", "mosely");
      if (!play.flag(Flag5.MoselySawNotes)) play.fail("Mosely n'a pas lu les notes de Hartridge");
      // Les deux écailles : le python du musée était au lac (2 points).
      play.useItem("twoScales", "mosely");
      if (!play.flag(Flag5.ProvedMuseumLink)) play.fail("les écailles n'ont pas convaincu Mosely");
      // Le motif reconstitué, que les notes appuient (2 points) : Mosely rouvre l'enquête et raccompagne Gabriel.
      play.useItem("reconVeve ", "mosely", { settle: false });
      const reopened = play.playUntil(() => play.room() === Room.PoliceLobby && play.inControl() && play.texts().length === 0, 40_000, "le retour dans le hall");
      if (!play.flag(Flag5.ProvedCultExists) || !play.flag(Flag5.MoselyReopensCase) || !reopened.some((text) => text.includes("J'ouvre à nouveau le dossier"))) play.fail("Mosely n'a pas rouvert l'enquête");
      play.skipText();
      // Les conditions sont réunies : la carte marque la fin de la journée, la librairie ferme à l'entrée suivante.
      through(play, Verb.Operate, "extDoor", Room.CityMap);
      play.travel("bookStore");
      const night = play.playUntil(() => play.day() === 6 && play.room() === Room.Bookshop && play.inControl() && play.texts().length === 0, 120_000, "le matin du jour 6");
      if (!night.some((text) => text.includes("ce truc est encore vivant"))) play.fail("le matin du jour 6 ne s'ouvre pas sur la scène de la librairie");
      play.skipText();
    },
  },
];
