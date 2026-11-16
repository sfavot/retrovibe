/**
 * Parcours complet de Gabriel Knight, sans tête : du bouton JOUER au générique de fin, puis les variantes.
 *
 * Seulement avec `PLAY=1`. Les dix jours se suivent dans un seul fichier, donc dans un seul processus de test : chaque jour
 * est joué une fois, à la suite de la partie laissée par le précédent, et les variantes repartent d'images gardées en
 * mémoire pendant le parcours (`stageImages`).
 *
 * - `PLAY_CHECKPOINTS=<dossier>` : écrit le point de reprise de chaque étape ;
 * - `PLAY_FROM=<étape>` (avec ce dossier) : les jours d'avant celui de l'étape ne sont pas joués, leurs variantes non
 *   plus ; le jour de l'étape repart de son point de reprise, et les variantes lisent leurs images dans le dossier.
 */
import { describe, expect, it } from "vitest";
import { GK1_FIXES } from "../../../src/games/gk1/game/fixes";
import { original } from "../data/real";
import { DAY1, Flag, NOTHING_ELSE, Room, endInterrogation, interrogate } from "./day1";
import { DAY2 } from "./day2";
import { DAY3, Room3, through } from "./day3";
import { DAY4 } from "./day4";
import { DAY5, Room5, dieAndRestart, intoSnakeAttack, nightIntoDay5 } from "./day5";
import { DAY6, Room6, followTracker, joinRitual, wrongAnswer } from "./day6";
import { DAY7, Room7 } from "./day7";
import { DAY8, Room8 } from "./day8";
import { DAY9, caughtByMummies, wakeMummies } from "./day9";
import { DAY10, Flag10, Room10, creditsToEnd, finalScoreShown, killedByDrJohn, letMaliaFall } from "./day10";
import { Play, PlayError, Verb } from "./harness";
import { runStages, stageImages, type Stage } from "./walkthrough";

/** Étapes dont le parcours garde l'image d'entrée : le départ des variantes. */
const images = stageImages(["j2-lac", "j2-commissariat", "j3-cimetiere", "j5-matin", "j6-matin", "j6-bayou", "j9-momies", "j10-hounfour", "j10-fin"]);

/** Nombre de répliques qui contiennent `part`. */
const count = (texts: readonly string[], part: string): number => texts.filter((text) => text.includes(part)).length;

interface Day {
  readonly stages: readonly Stage[];
  readonly title: string;
  /** Ce qui doit être vrai à la fin du jour, outre les scores de ses étapes. */
  check(play: Play): void;
}

const DAYS: readonly Day[] = [
  {
    stages: DAY1,
    title: "du bouton JOUER au matin du jour 2, score 25",
    check(play) {
      expect(DAY1.map((stage) => stage.score)).toEqual([0, 7, 10, 10, 17, 22, 25]);
      expect([play.day(), play.room(), play.inControl()]).toEqual([2, Room.Bookshop, true]);
      expect(play.flag(Flag.EndOfDay)).toBe(false);
      expect(play.carried().sort()).toEqual(["clay", "gradPhoto", "lakeScale", "magGlass", "murderPhoto", "tweezers"]);
    },
  },
  {
    stages: DAY2,
    title: "du matin dans la librairie au matin du jour 3, score 61",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([3, Room.Bookshop, 61]);
      // L'insigne de Mosely reste à rendre ; le croquis et la photocopie sont chez l'artiste ; Grace a laissé une adresse.
      expect(play.carried()).toEqual(expect.arrayContaining(["badge", "sketchBook", "phonePage", "lakeScale", "clay"]));
      expect(play.carried()).not.toEqual(expect.arrayContaining(["sLakePatter"]));
    },
  },
  {
    stages: DAY3,
    title: "du matin dans la librairie au matin du jour 4, score 107",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([4, Room.Bookshop, 107]);
      // Le masque de crocodile et les signes de la tombe restent ; l'insigne est rendu, le moule est chez Sam, l'huile a servi.
      expect(play.carried()).toEqual(expect.arrayContaining(["wolfPhone", "reconVeve ", "crocMask", "VoodooCode1", "sketchBook"]));
      for (const gone of ["badge", "braceMold ", "oil", "hundred", "clay"]) expect(play.carried()).not.toContain(gone);
    },
  },
  {
    stages: DAY4,
    title: "du matin dans la librairie au matin du jour 5, score 140",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([5, Room.Bookshop, 140]);
      // Les deux objets exigés le soir, le colis de Wolfgang et le livre des tambours.
      expect(play.carried()).toEqual(expect.arrayContaining(["tatooTrace", "braceRep ", "guntJournal", "wolfLetter", "news1810", "drumBook", "ritLetter"]));
    },
  },
  {
    stages: DAY5,
    title: "du matin dans la librairie au matin du jour 6, score 158",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([6, Room.Bookshop, 158]);
      expect(play.carried()).toEqual(expect.arrayContaining(["twoScales", "hartNotes", "news1810", "reconVeve ", "drumBook"]));
    },
  },
  {
    stages: DAY6,
    title: "du matin dans la librairie au réveil du jour 7 dans le studio, score 195",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([7, Room3.Studio, 195]);
      expect(play.carried()).toEqual(expect.arrayContaining(["tracker", "signalDev2 ", "mosKey", "mosLetter", "sVoodooCode"]));
      // La brique est jetée, l'émetteur est dans le cercueil, le masque est resté au bayou, le décalque chez Grace.
      for (const gone of ["brick", "signalDev ", "crocMask", "tatooTrace"]) expect(play.carried()).not.toContain(gone);
    },
  },
  {
    stages: DAY7,
    title: "du réveil dans le studio au réveil du jour 8 à Schloss Ritter, score 226",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([8, Room7.Bedroom, 226]);
      expect(play.carried()).toEqual(expect.arrayContaining(["master card", "wallet", "lit flash", "knife"]));
      // Le pot de chambre et le sel sont restés sur l'autel ; Gerde a rangé les ciseaux et le manuscrit.
      for (const gone of ["chamPot", "salt", "scissors", "scroll"]) expect(play.carried()).not.toContain(gone);
      // La clé du rêve est sur la table au pied du lit.
      expect(play.present("theKey")).toBe(true);
    },
  },
  {
    stages: DAY8,
    title: "de la chambre de Wolfgang au mont serpenté du Bénin, score 237",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([9, Room8.SnakeMound, 237]);
      expect(play.carried()).toEqual(expect.arrayContaining(["bookSnkMnd", "wolfKey", "knife", "master card", "lit flash"]));
    },
  },
  {
    stages: DAY9,
    title: "du mont serpenté à la carte de La Nouvelle-Orléans au jour 10, score 263",
    check(play) {
      expect([play.day(), play.room(), play.score()]).toEqual([10, Room.GreaterMap, 263]);
    },
  },
  {
    stages: DAY10,
    title: "de la librairie vide au rituel ; Gabriel sauve Malia, épilogue, score final 311, générique",
    check(play) {
      // Fin où Gabriel vit : l'épilogue affiche le score en trois chiffres, 311 sur 342.
      expect([play.day(), play.room(), play.score(), play.flag(Flag10.GabrielDied)]).toEqual([10, Room10.Epilogue, 311, false]);
      expect(finalScoreShown(play)).toBe(311);
      // La fenêtre fermée, le générique défile (pièce 680), puis le jeu s'arrête de lui-même : la page revient à son écran titre.
      const credits = creditsToEnd(play);
      expect(credits).toBeGreaterThan(5000);
      expect(play.room()).toBe(Room10.Credits);
    },
  },
];

const from = process.env.PLAY_FROM;
/** Premier jour à jouer : celui de l'étape `PLAY_FROM`, sinon le jour 1. */
const firstDay = from === undefined ? 0 : DAYS.findIndex((day) => day.stages.some((stage) => stage.name === from));

describe.skipIf(!original.has || process.env.PLAY !== "1")("Gabriel Knight, parcours sans tête complet", () => {
  /** La partie en cours, passée d'un jour au suivant ; absente tant qu'aucun jour n'est fini, ou après un échec. */
  let game: Play | undefined;

  it("PLAY_FROM nomme une étape du parcours", () => {
    expect(firstDay, `étape inconnue : ${from}`).toBeGreaterThanOrEqual(0);
  });

  DAYS.forEach((day, index) => {
    it.skipIf(index < firstDay)(`jour ${index + 1} : ${day.title}`, { timeout: 900_000 }, () => {
      const before = game;
      game = undefined;
      if (index > firstDay && !before) throw new PlayError(`le jour ${index} n'a pas abouti : le jour ${index + 1} n'a pas de partie à continuer`);
      const { play, scores } = runStages(day.stages, { play: before, onStage: images.onStage });
      expect(scores).toEqual(day.stages.slice(-scores.length).map((stage) => ({ name: stage.name, score: stage.score })));
      day.check(play);
      expect(play.vm.kernel.journal.stubs.size).toBe(0);
      expect([...play.vm.warnings.keys()]).toEqual([]);
      // Le dernier jour finit le jeu : plus rien à sauver ni à continuer.
      if (index < DAYS.length - 1) {
        expect(play.canCheckpoint()).toBe(true);
        game = play;
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------
  // Variantes : chacune repart de l'image d'une étape du parcours
  // ---------------------------------------------------------------------------------------------------------------------------

  it.skipIf(firstDay > 1)("jour 2, sauvegarde au milieu du jour : la partie reprise finit l'étape du lac dans le même état que la partie continuée", { timeout: 300_000 }, () => {
    const resumed = Play.resume(images.of("j2-lac"));
    DAY2.find((stage) => stage.name === "j2-lac")!.run(resumed);
    expect(resumed.score()).toBe(29);
    expect(JSON.stringify(resumed.checkpoint("j2-commissariat"))).toBe(JSON.stringify(images.of("j2-commissariat")));
  });

  it.skipIf(firstDay > 4)("jour 5, le python tue Gabriel qui n'actionne pas le ventilateur ; « Recommencer » rend une partie neuve", { timeout: 300_000 }, () => {
    const play = Play.resume(images.of("j5-matin"));
    through(play, Verb.Operate, "shopDoor", Room.CityMap);
    intoSnakeAttack(play);
    dieAndRestart(play);
    // Le redémarrage (`doTheRestart`, script 93, à correctif de script) : jour 1, score nul, plus rien en poche.
    expect([play.room(), play.day(), play.score()]).toEqual([Room5.Title, 1, 0]);
    expect(play.carried()).toEqual([]);
    // La partie neuve se joue comme une partie lancée à froid.
    const fresh = Play.boot();
    fresh.startGame();
    play.startGame();
    expect([play.room(), play.day(), play.score(), play.inControl()]).toEqual([fresh.room(), fresh.day(), fresh.score(), true]);
    expect(play.carried()).toEqual(fresh.carried());
    expect(play.objects().map((object) => object.name).sort()).toEqual(fresh.objects().map((object) => object.name).sort());
    const paper = play.use(Verb.Pickup, "newsPaper");
    expect(paper[0]).toMatch(/^Le Times, du 18 Juin 1993/);
    expect([...play.vm.warnings.keys()]).toEqual([]);
  });

  it.skipIf(firstDay > 2)("jours 3 à 5, correctif « dialogue du livre des tambours » : motif demandé au jour 3, tambours au jour 4, chaque dialogue une fois", { timeout: 600_000 }, () => {
    const play = Play.resume(images.of("j3-cimetiere"));
    // Au jour 3, la recherche sur le motif : la coupure de 1810 arrive au matin du jour 4.
    play.travel("bookStore");
    play.skipText();
    interrogate(play, "graceProp");
    play.talkTopic("Demande de recherche");
    play.talkTopic("Je dois faire des recherches sur le modèle que je détiens.");
    play.talkTopic(NOTHING_ELSE);
    endInterrogation(play, Room.Bookshop);
    through(play, Verb.Operate, "shopDoor", Room.CityMap);
    DAY3.find((stage) => stage.name === "j3-cimetiere")!.run(play);
    expect(play.day()).toBe(4);
    expect(play.carried()).toContain("news1810");
    for (const stage of DAY4.slice(0, 3)) stage.run(play);
    // Au jour 4, la recherche sur les tambours, puis la dernière condition du soir : Magentia Moonbeam.
    play.travel("bookStore");
    play.skipText();
    interrogate(play, "graceProp");
    play.talkTopic("Demande de recherche");
    play.talkTopic("Regardez ce que vous pouvez trouver sur les tambours Rada.");
    play.talkTopic(NOTHING_ELSE);
    endInterrogation(play, Room.Bookshop);
    through(play, Verb.Operate, "shopDoor", Room.CityMap);
    play.travel("moonBeam");
    play.skipText(40_000);
    play.useItem("VoodooCode1", "magentia");
    play.selectVerb(Verb.Walk);
    play.click(257, 83);
    play.playUntil(() => play.room() === Room.CityMap, 6000, "la carte du Quartier Français");
    const evening = play.checkpoint("soir du jour 4");
    // Avec le correctif : Grace remet le livre des tambours, une fois, et ne reparle pas du motif.
    const morning = nightIntoDay5(play);
    expect(count(morning, "Nous avons reçu ce matin le livre")).toBe(1);
    expect(count(morning, "J'ai consulté la micro-fiche")).toBe(0);
    expect(play.carried()).toEqual(expect.arrayContaining(["news1810", "drumBook", "guntJournal", "wolfLetter"]));
    expect(play.score()).toBe(140);
    // Sans lui (les scripts d'origine) : le dialogue du motif repasse, puis celui du livre une seconde fois.
    const unpatched = Play.resume(structuredClone(evening), {
      fixes: { ...GK1_FIXES, scriptPatches: GK1_FIXES.scriptPatches.filter((patch) => patch.name !== "dialogue du livre des tambours") },
    });
    const repeated = nightIntoDay5(unpatched);
    expect(count(repeated, "Nous avons reçu ce matin le livre")).toBe(2);
    expect(count(repeated, "J'ai consulté la micro-fiche")).toBe(1);
  });

  it.skipIf(firstDay > 5)("jour 6, l'enveloppe de Mosely rapporte un point ; sans le correctif du paramètre manquant, elle double le score", { timeout: 300_000 }, () => {
    const pickUp = (play: Play): number[] => {
      play.playUntil(() => play.present("envelope") && play.inControl() && play.texts().length === 0, 20_000, "l'enveloppe sous la porte");
      const before = play.score();
      play.use(Verb.Pickup, "envelope");
      expect(play.carried()).toContain("keyEnvelope");
      return [before, play.score()];
    };
    expect(pickUp(Play.resume(images.of("j6-matin")))).toEqual([158, 159]);
    // Les scripts d'origine envoient `getPoints(-999)` sans nombre de points : la méthode lit la case où elle vient d'empiler le score.
    expect(pickUp(Play.resume(images.of("j6-matin"), { fixes: { ...GK1_FIXES, missingParams: [] } }))).toEqual([158, 316]);
  });

  it.skipIf(firstDay > 5)("jour 6, une mauvaise réponse au docteur John : Gabriel est tué, l'écran de la mort offre ses trois boutons", { timeout: 300_000 }, () => {
    const play = Play.resume(images.of("j6-bayou"));
    play.travel("greatNO1");
    play.travel("bayou");
    play.playUntil(() => play.room() === Room6.BayouMaze && play.inControl() && play.texts().length === 0, 3000, "le bayou");
    play.useItem("tracker", "GKEgo");
    followTracker(play);
    joinRitual(play);
    const end = wrongAnswer(play);
    expect(end.some((text) => text.includes("Vous n'êtes pas croyant"))).toBe(true);
    expect([play.room(), play.day(), play.score()]).toEqual([Room5.Death, 6, 193]);
    expect(play.menu()).toHaveLength(3);
    expect([...play.vm.warnings.keys()]).toEqual([]);
  });

  it.skipIf(firstDay > 8)("jour 9, les momies réveillées, Gabriel reste sur place : il est rattrapé, l'écran de la mort offre ses trois boutons", { timeout: 300_000 }, () => {
    const play = Play.resume(images.of("j9-momies"));
    wakeMummies(play);
    caughtByMummies(play);
    expect([play.room(), play.day(), play.score()]).toEqual([Room5.Death, 9, 246]);
    expect(play.menu()).toHaveLength(3);
    expect([...play.vm.warnings.keys()]).toEqual([]);
  });

  it("jour 10, Gabriel entre chez le docteur John sans l'avoir éloigné : il est tué, l'écran de la mort offre ses trois boutons", { timeout: 300_000 }, () => {
    const play = Play.resume(images.of("j10-hounfour"));
    const end = killedByDrJohn(play);
    expect(end.some((text) => text.includes("Comment osez-vous profaner ce sanctuaire!"))).toBe(true);
    expect([play.room(), play.day(), play.score()]).toEqual([Room5.Death, 10, 271]);
    expect(play.menu()).toHaveLength(3);
    expect([...play.vm.warnings.keys()]).toEqual([]);
  });

  it("jour 10, seconde fin : Gabriel ne tend pas la main, Malia l'entraîne ; épilogue de Grace et Mosely, score 301, générique", { timeout: 300_000 }, () => {
    const play = Play.resume(images.of("j10-fin"));
    const end = letMaliaFall(play);
    for (const line of ["Tu me trahis!", "toi aussi tu mourras.", "Au revoir, Gabriel Knight."]) expect(count(end, line)).toBe(1);
    expect([play.room(), play.score(), play.flag(Flag10.GabrielDied)]).toEqual([Room10.Epilogue, 301, true]);
    expect(finalScoreShown(play)).toBe(301);
    expect(creditsToEnd(play)).toBeGreaterThan(5000);
    expect(play.vm.kernel.journal.stubs.size).toBe(0);
    expect([...play.vm.warnings.keys()]).toEqual([]);
  });
});
