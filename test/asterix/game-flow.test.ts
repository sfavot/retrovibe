import { describe, expect, it } from "vitest";
import { SQUARE } from "../../src/games/asterix/game/state";
import { MINIGAMES } from "../../src/games/asterix/game/rules";
import { PLACEHOLDER_GAIN, isPorted } from "../../src/games/asterix/scenes/minigame";
import { SAVE_KEY, parseSave, readSave } from "../../src/games/asterix/scenes/save";
import { launch, type LaunchOptions, type Launched } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";

/**
 * Le jeu entier sur le moteur de test, piloté au clavier et à la souris : réglages, tour, délais, cases, sauvegarde.
 * Pour amener un joueur sur une case d'un type donné quel que soit le dé, les tests réécrivent la table du plateau lue
 * dans l'exécutable (`rt.tables.board`), jamais l'état du jeu en cours de script.
 */

/** Du menu principal au premier menu du tour, avec les personnages donnés (clic direct sur chacun). */
async function toFirstTurn(characters: number[], options: LaunchOptions = {}): Promise<Launched> {
  const run = await launch(options);
  await run.untilScreen("menu");
  await run.tap("Space");
  for (const character of characters) {
    await run.untilScreen("players");
    const slot = run.rt.tables.characterSlots.find((s) => s.character === character)!;
    await run.click(slot.x - 16, slot.y - 20);
    await run.untilScreen("levels");
    await run.tap("Space");
  }
  await run.untilScreen("players");
  if (characters.length < 4) await run.tap("ArrowDown");
  await run.run(500);
  await run.tap("Space");
  await run.untilScreen("settings");
  await run.tap("Space");
  await run.untilScreen("score");
  await run.tap("Space");
  await run.untilScreen("turn");
  return run;
}

/** Lance le dé et l'arrête aussitôt ; attend la fin du déplacement (l'écran suivant, ou le tour suivant). */
async function roll(run: Launched): Promise<void> {
  await run.tap("Space");
  await run.untilScreen("die");
  await run.tap("Space");
  await run.until(() => run.screen !== "die");
}

/** Répond OUI à la question oui/non : après les 20 cs où l'écran ne lit pas encore les directions, droite puis valider. */
async function answerYes(run: Launched): Promise<void> {
  await run.untilScreen("confirm");
  await run.run(400);
  await run.tap("ArrowRight");
  await run.run(400);
  await run.tap("Space");
}

/** Toute la table du plateau devient des cases du type donné. */
function allSquares(run: Launched, type: number): void {
  run.rt.tables.board.fill(type);
}

/** Premier mini-jeu pas encore porté (indice dans la table), −1 quand ils le sont tous : le test de l'écran provisoire part alors avec lui. */
const UNPORTED = MINIGAMES.findIndex((entry) => !isPorted(entry.module));

describe.skipIf(!hasOriginalFiles)("déroulé d'une partie d'Astérix", () => {
  it("réglages : gourdes selon le niveau Réflexion, 90 minutes et objets de la table, ordre d'inscription", async () => {
    const run = await launch({ seed: 2 });
    await run.untilScreen("menu");
    await run.tap("Space");
    await run.untilScreen("players");
    // Le curseur part d'Astérix (emplacement libre le plus à droite) ; bas une fois sur la bulle Réflexion : difficile.
    await run.tap("Space");
    await run.untilScreen("levels");
    await run.tap("ArrowDown");
    await run.run(600);
    await run.tap("Space");
    await run.untilScreen("players");
    expect(run.rt.game.players).toMatchObject([{ character: 0, reflexion: 2, action: 1, gourds: 1 }]);
    // Un personnage déjà pris ne peut pas être repris : le clic est ignoré.
    const asterix = run.rt.tables.characterSlots.find((s) => s.character === 0)!;
    await run.click(asterix.x - 16, asterix.y - 20);
    await run.run(500);
    expect(run.screen).toBe("players");
    // Obélix, niveau Action facile (bulle de droite, haut).
    const obelix = run.rt.tables.characterSlots.find((s) => s.character === 1)!;
    await run.click(obelix.x - 16, obelix.y - 20);
    await run.untilScreen("levels");
    await run.tap("ArrowRight");
    await run.run(600);
    await run.tap("ArrowUp");
    await run.run(600);
    await run.tap("Space");
    await run.untilScreen("players");
    expect(run.rt.game.players[1]).toMatchObject({ character: 1, reflexion: 1, action: 0, gourds: 2 });
    await run.tap("ArrowDown");
    await run.run(500);
    await run.tap("Space");
    await run.untilScreen("settings");
    // 60 minutes : le nombre d'objets suit la table (5 à deux joueurs) ; un choix manuel des objets tient ensuite.
    await run.tap("ArrowLeft");
    await run.run(400);
    await run.tap("ArrowDown");
    await run.run(400);
    await run.tap("ArrowRight");
    await run.run(400);
    await run.tap("Space");
    await run.untilScreen("score");
    expect([run.rt.game.duration, run.rt.game.objectsRequired]).toEqual([3600, 7]);
    expect(run.rt.session.saved).toMatchObject({ duration: 3600, objectsRequired: 7, players: [{ character: 0 }, { character: 1 }] });
    expect(run.rt.missing).toEqual([]);
  });

  it("à quatre joueurs le curseur est forcé sur JOUER, et JOUER sans joueur est refusé", async () => {
    const run = await launch({ seed: 2 });
    await run.untilScreen("menu");
    await run.tap("Space");
    await run.untilScreen("players");
    await run.tap("ArrowDown");
    await run.run(500);
    await run.tap("Space");
    await run.run(1000);
    expect(run.screen).toBe("players");
    for (let i = 0; i < 4; i++) {
      await run.untilScreen("players");
      await run.tap("Space");
      await run.untilScreen("levels");
      await run.tap("Space");
    }
    await run.untilScreen("players");
    // Ordre d'inscription : toujours l'emplacement libre le plus à droite (Astérix, Agecanonix, Falbala, Bonemine).
    expect(run.rt.game.players.map((p) => p.character)).toEqual([0, 3, 4, 2]);
    await run.tap("Space");
    await run.untilScreen("settings");
    await run.tap("Space");
    await run.untilScreen("score");
    expect([run.rt.game.duration, run.rt.game.objectsRequired]).toEqual([5400, 5]);
  });

  it("menu du tour au clic : carte, marbre de route, dé (décision D11)", async () => {
    const run = await toFirstTurn([0, 1]);
    await run.click(285, 175);
    await run.untilScreen("map");
    await run.click(100, 100);
    await run.untilScreen("turn");
    await run.click(285, 137);
    await run.untilScreen("marble");
    // RETOUR.
    await run.click(250, 47);
    await run.untilScreen("turn");
    // SCORE depuis le marbre.
    await run.click(285, 137);
    await run.untilScreen("marble");
    await run.click(250, 107);
    await run.untilScreen("score");
    await run.click(10, 10);
    await run.untilScreen("turn");
    await run.click(288, 100);
    await run.untilScreen("die");
    expect(run.rt.missing).toEqual([]);
  });

  it("délai du tour : rappel puis tour perdu à plusieurs ; en solo le dé part tout seul", async () => {
    const many = await toFirstTurn([0, 1]);
    const start = many.rt.game.players[0].pos;
    await many.until(() => many.rt.game.current === 1, 40_000);
    expect(many.rt.game.players[0].pos).toBe(start);
    expect(many.host.time).toBeGreaterThan(30_000);

    const solo = await toFirstTurn([4]);
    allSquares(solo, SQUARE.potion);
    await solo.until(() => solo.rt.game.round === 2, 80_000);
    expect(solo.rt.game.players[0].pos).toBeGreaterThan(0);
    expect(solo.rt.game.players[0].gourds).toBe(3);
  });

  it("sauvegarde au début de chaque tour, reprise au même point, effacement en fin de partie (décision D6)", async () => {
    const run = await toFirstTurn([2], { seed: 8 });
    allSquares(run, SQUARE.potion);
    const first = readSave(run.host.storage)!;
    expect(first).toMatchObject({ version: 1, state: { current: 0, round: 1, players: [{ character: 2, pos: 0 }] } });
    expect(parseSave(JSON.parse(JSON.stringify(first)))).not.toBeNull();
    await roll(run);
    await run.untilScreen("turn");
    const saved = readSave(run.host.storage)!;
    expect(saved.state.round).toBe(2);
    expect(saved.state.players[0].pos).toBe(run.rt.game.players[0].pos);
    expect(saved.state.players[0].gourds).toBe(3);
    expect(saved.elapsed).toBeGreaterThan(0);

    // Deux reprises de la même sauvegarde, jouées de la même façon, donnent le même tour.
    const positions: number[] = [];
    for (let i = 0; i < 2; i++) {
      const resumed = await launch({ resume: structuredClone(saved), seed: 99 + i });
      await resumed.untilScreen("turn");
      allSquares(resumed, SQUARE.potion);
      expect(resumed.rt.game.round).toBe(2);
      // Le temps de partie reprend où il en était (plus le fondu d'entrée du plateau).
      expect(resumed.rt.elapsedCentiseconds(1) - saved.elapsed).toBeLessThan(300);
      expect(resumed.rt.elapsedCentiseconds(1)).toBeGreaterThanOrEqual(saved.elapsed);
      await roll(resumed);
      await resumed.untilScreen("turn");
      positions.push(resumed.rt.game.players[0].pos);
    }
    expect(positions[0]).toBe(positions[1]);
    expect(positions[0]).not.toBe(saved.state.players[0].pos);

    // Une sauvegarde abîmée est ignorée et effacée.
    run.host.storage.set(SAVE_KEY, JSON.stringify({ ...saved, version: 2 }));
    expect(readSave(run.host.storage)).toBeNull();
    expect(run.host.storage.get(SAVE_KEY)).toBeNull();
  });

  it("abandon : le joueur est retiré, le dernier choisit de continuer seul ; FIN arrête la partie", async () => {
    const run = await toFirstTurn([0, 1]);
    await run.click(285, 137);
    await run.untilScreen("marble");
    // ABANDON, puis OUI.
    await run.click(250, 137);
    await answerYes(run);
    // Question au dernier joueur : continuer seul ?
    await run.until(() => run.rt.game.players.length === 1);
    expect(run.rt.game.players.map((p) => p.character)).toEqual([1]);
    await answerYes(run);
    await run.untilScreen("turn");
    expect([run.rt.game.quit, run.rt.game.players.length, run.rt.game.current]).toEqual([false, 1, 0]);
    // FIN en solo : la question de l'abandon ; oui, retour au menu principal et sauvegarde effacée.
    await run.click(285, 137);
    await run.untilScreen("marble");
    await run.click(250, 167);
    await answerYes(run);
    await run.untilScreen("menu");
    expect(run.rt.game.quit).toBe(true);
    expect(run.host.storage.get(SAVE_KEY)).toBeNull();
    expect(run.rt.missing).toEqual([]);
  });

  it("quiz : bonne réponse au clic, l'objet du pays est gagné ; mauvaise réponse, rattrapage contre une gourde", async () => {
    const run = await toFirstTurn([0], { seed: 4 });
    allSquares(run, SQUARE.country);
    const player = run.rt.game.players[0];
    await roll(run);
    await run.untilScreen("quiz");
    const country = Math.floor(player.pos / 6);
    expect(run.rt.hint.country).toBe(country);
    // Clic direct sur la bonne réponse (lignes en (20, 118 + 18i)).
    await run.click(60, 118 + 18 * (run.rt.hint.correct as number) + 5);
    await run.untilScreen("turn");
    expect(player.objects[country]).toBe(true);
    expect([player.objectCount, player.sesterces, player.gourds]).toEqual([1, 0, 2]);

    // Mauvaise réponse : question oui/non, puis une seconde question (différente) et une gourde en moins.
    await roll(run);
    await run.untilScreen("quiz");
    const firstNumber = run.rt.hint.number;
    const wrong = ((run.rt.hint.correct as number) + 1) % 3;
    await run.click(60, 118 + 18 * wrong + 5);
    await answerYes(run);
    await run.untilScreen("quiz");
    expect(player.gourds).toBe(1);
    expect(run.rt.hint.number).not.toBe(firstNumber);
    // Second échec : plus de rattrapage.
    await run.click(60, 118 + 18 * (((run.rt.hint.correct as number) + 1) % 3) + 5);
    await run.untilScreen("turn");
    expect(player.gourds).toBe(1);

    // Temps écoulé (15 s) : pas de rattrapage proposé.
    await roll(run);
    await run.untilScreen("quiz");
    const before = run.host.time;
    await run.until(() => run.screen !== "quiz", 20_000);
    expect(run.host.time - before).toBeGreaterThan(14_000);
    await run.untilScreen("turn");
    expect(player.gourds).toBe(1);
    expect(run.rt.missing).toEqual([]);
  });

  it.skipIf(UNPORTED < 0)("mini-jeu provisoire : gagné donne des sesterces, perdu rien ; le point d'entrée est celui de la table", async () => {
    const run = await toFirstTurn([5], { seed: 6 });
    allSquares(run, SQUARE.game);
    const player = run.rt.game.players[0];
    // Le dé arrêté, la case d'arrivée est connue : la table y place un mini-jeu pas encore porté.
    const rollToUnported = async (): Promise<void> => {
      const from = player.pos;
      await roll(run);
      run.rt.tables.minigamePositions.fill(-1);
      run.rt.tables.minigamePositions[UNPORTED] = from + run.rt.game.die;
      await run.untilScreen("minigame");
      expect(player.pos).toBe(from + run.rt.game.die);
      expect(run.rt.hint.module).toBe(MINIGAMES[UNPORTED].module);
    };
    await rollToUnported();
    await run.tap("Space");
    await run.untilScreen("turn");
    expect(player.sesterces).toBe(PLACEHOLDER_GAIN);
    await rollToUnported();
    // « Perdu », au clic.
    await run.click(220, 135);
    await run.untilScreen("turn");
    expect(player.sesterces).toBe(PLACEHOLDER_GAIN);
  });

  it("une position absente de la table des mini-jeux lance celui d'Idéfix", async () => {
    const run = await toFirstTurn([5], { seed: 6 });
    allSquares(run, SQUARE.game);
    run.rt.tables.minigamePositions.fill(-1);
    await roll(run);
    await run.untilScreen("minigame");
    expect(run.rt.hint.module).toBe(34);
  });

  it("prison : en solo jamais de tour perdu ; à plusieurs un tour au plus, ou une gourde pour sortir", async () => {
    const run = await toFirstTurn([0, 1], { seed: 3 });
    allSquares(run, SQUARE.prison);
    const [first, second] = run.rt.game.players;
    await roll(run);
    await run.until(() => run.rt.game.current === 1 && run.screen === "turn");
    expect(first.inPrison).toBe(true);
    await roll(run);
    // Retour au joueur 0 : question (il a des gourdes) ; non, le tour est perdu et il est libéré.
    await run.untilScreen("confirm");
    expect(run.rt.game.current).toBe(0);
    await run.tap("Space");
    await run.until(() => run.rt.game.current === 1 && run.screen !== "confirm");
    expect([first.inPrison, first.gourds]).toEqual([false, 2]);
    // Joueur 1 : oui, la gourde est dépensée et le tour continue (menu du tour du même joueur).
    await answerYes(run);
    await run.untilScreen("turn");
    expect(run.rt.game.current).toBe(1);
    expect([second.inPrison, second.gourds]).toEqual([false, 1]);
    expect(run.rt.missing).toEqual([]);
  });

  it("Epidemaïs : un achat à 3 sesterces par passage, au clic sur l'objet ; rien sans sesterces", async () => {
    const run = await toFirstTurn([0], { seed: 7 });
    allSquares(run, SQUARE.merchant);
    const player = run.rt.game.players[0];
    await roll(run);
    await run.untilScreen("turn");
    expect(player.objectCount).toBe(0);
    player.sesterces = 5;
    await roll(run);
    await run.untilScreen("merchant");
    const item = run.rt.tables.stall[4];
    await run.click(item.x - 16, item.y - 20);
    await run.untilScreen("turn");
    expect(player.objects[item.object]).toBe(true);
    expect([player.objectCount, player.sesterces]).toEqual([1, 2]);
  });

  it("devin : le pari porte sur les gourdes du prochain visiteur, 3 sesterces au parieur", async () => {
    const run = await toFirstTurn([0, 1], { seed: 9 });
    allSquares(run, SQUARE.soothsayer);
    const [first, second] = run.rt.game.players;
    await roll(run);
    await run.untilScreen("soothsayer");
    // Pari sur 2 gourdes (deux fois à droite), le compte du joueur suivant.
    await run.tap("ArrowRight");
    await run.run(300);
    await run.tap("ArrowRight");
    await run.run(300);
    await run.tap("Space");
    await run.until(() => run.rt.game.current === 1 && run.screen === "turn");
    expect([run.rt.game.bettor, run.rt.game.bet]).toEqual([0, 2]);
    await roll(run);
    // Le visiteur a 2 gourdes : pari juste, +3 sesterces au parieur, puis le visiteur parie à son tour.
    await run.untilScreen("soothsayer");
    expect(first.sesterces).toBe(3);
    expect(run.rt.game.bettor).toBe(1);
    await run.tap("Space");
    await run.until(() => run.rt.game.current === 0 && run.screen === "turn");
    expect([run.rt.game.bet, second.sesterces]).toEqual([0, 0]);
    expect(run.rt.missing).toEqual([]);
  });

  it("pause : elle n'use pas le temps de partie ; le clic droit (aide muette) ne joue rien", async () => {
    const run = await toFirstTurn([3], { audio: true });
    const plays = run.host.audio.plays.length;
    run.host.input.mouseDown(2);
    await run.frame();
    run.host.input.mouseUp(2);
    await run.run(500);
    expect(run.host.audio.plays.length).toBe(plays);
    const before = run.rt.elapsedCentiseconds(1);
    await run.tap("KeyP");
    await run.untilScreen("pause");
    await run.run(20_000);
    await run.tap("Space");
    await run.untilScreen("turn");
    expect(run.rt.elapsedCentiseconds(1) - before).toBeLessThan(600);
    expect(run.rt.missing).toEqual([]);
  });

  it("REJOUER reprend la configuration de la partie précédente, et les mémoires de séance sont gardées (D13)", async () => {
    const run = await toFirstTurn([4, 2]);
    await run.click(285, 137);
    await run.untilScreen("marble");
    await run.click(250, 167);
    await answerYes(run);
    await run.untilScreen("menu");
    expect(run.rt.session.noGameYet).toBe(false);
    await run.tap("ArrowDown");
    await run.run(500);
    await run.tap("Space");
    // Pas d'écran des joueurs ni des réglages : directement le tableau de score, puis le tour.
    await run.until(() => run.screen === "score" || run.screen === "turn");
    expect(run.rt.game.replay).toBe(true);
    expect(run.rt.game.players.map((p) => p.character)).toEqual([4, 2]);
    expect([run.rt.game.duration, run.rt.game.objectsRequired]).toEqual([5400, 7]);
  });

  it("reprise au milieu d'un tour de table, FIN, puis REJOUER : la configuration de la partie reprise (D6)", async () => {
    const run = await toFirstTurn([4, 2]);
    allSquares(run, SQUARE.potion);
    await roll(run);
    await run.until(() => run.rt.game.current === 1 && run.screen === "turn");
    const saved = readSave(run.host.storage)!;
    expect(saved.state.current).toBe(1);

    // Rechargement de la page : mémoires de séance neuves (`DS:1a02` à 1), la partie reprise est pourtant une vraie partie.
    const resumed = await launch({ resume: structuredClone(saved) });
    await resumed.untilScreen("turn");
    expect(resumed.rt.game.current).toBe(1);
    expect(resumed.rt.session.noGameYet).toBe(false);
    await resumed.click(285, 137);
    await resumed.untilScreen("marble");
    await resumed.click(250, 167);
    await answerYes(resumed);
    await resumed.untilScreen("menu");
    await resumed.tap("ArrowDown");
    await resumed.run(500);
    await resumed.tap("Space");
    await resumed.until(() => resumed.screen === "score" || resumed.screen === "turn");
    expect(resumed.rt.game.replay).toBe(true);
    expect(resumed.rt.game.players.map((p) => p.character)).toEqual([4, 2]);
    expect([resumed.rt.game.duration, resumed.rt.game.objectsRequired]).toEqual([5400, 7]);
  });

  it("JOUER puis ANNULER à l'écran des joueurs : la partie sauvegardée reste reprenable (D6)", async () => {
    const run = await toFirstTurn([3]);
    const saved = readSave(run.host.storage)!;
    // La page est rouverte par « Jouer » (pas « Continuer ») : même stockage.
    const again = await launch({ host: run.host });
    await again.untilScreen("menu");
    await again.tap("Space");
    await again.untilScreen("players");
    // Bas (JOUER), gauche (ANNULER), valider.
    await again.tap("ArrowDown");
    await again.run(500);
    await again.tap("ArrowLeft");
    await again.run(500);
    await again.tap("Space");
    await again.untilScreen("menu");
    expect(readSave(again.host.storage)).toEqual(saved);
    // Une nouvelle partie réellement lancée la remplace, à son premier tour.
    await again.tap("ArrowDown");
    await again.run(500);
    await again.tap("Space");
    await again.until(() => again.screen === "score" || again.screen === "turn");
    expect(readSave(again.host.storage)!.state.players.map((p) => p.character)).toEqual([0]);
  });

  it("abandon du premier de trois joueurs : le suivant joue, le tour de table est compté (1d24:0be9)", async () => {
    const run = await toFirstTurn([0, 1, 2]);
    allSquares(run, SQUARE.potion);
    await run.click(285, 137);
    await run.untilScreen("marble");
    await run.click(250, 137);
    await answerYes(run);
    await run.until(() => run.rt.game.players.length === 2 && run.screen === "turn");
    expect(run.rt.game.players.map((p) => p.character)).toEqual([1, 2]);
    // Fidèle à l'original : le joueur courant devient `nb − 2`, le dernier indice, donc la fin de tour compte un tour de table.
    expect([run.rt.game.current, run.rt.game.round]).toEqual([0, 2]);
    expect(readSave(run.host.storage)!.state.players.length).toBe(2);
    await roll(run);
    await run.until(() => run.rt.game.current === 1 && run.screen === "turn");
    await roll(run);
    await run.until(() => run.rt.game.current === 0 && run.screen === "turn");
    expect(run.rt.game.players.map((p) => p.gourds)).toEqual([3, 3]);
    expect(run.rt.game.round).toBe(3);
    expect(run.rt.missing).toEqual([]);
  });
});
