import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../src/engine/infogrames/rng";
import { parseExeTables, type ExeTables } from "../../src/games/asterix/data/exe";
import {
  MINIGAMES,
  addSesterces,
  announceVariant,
  announceVoice,
  detritusDraw,
  detritusPath,
  initGame,
  marbleRemark,
  minigameAt,
  pathToPrison,
  proposedObjects,
  quizNumber,
  quizOrder,
  quizWelcomeVoice,
  removeCurrentPlayer,
  restDraw,
  saveSetup,
  scoreComment,
  screenRank,
  spyForbidden,
  spyMove,
  squareVisible,
  surpriseDraw,
  testVictory,
  trapDestination,
  type Rnd,
} from "../../src/games/asterix/game/rules";
import { SQUARE, createPlayer, createSession, type GameState, type Session } from "../../src/games/asterix/game/state";
import { layoutQuestion } from "../../src/games/asterix/scenes/quiz";
import { hasOriginalFiles, readOriginal } from "./helpers";

/** Générateur à graine : mêmes lois que le jeu (`rnd() % n`, `rnd() & masque`) sur des tirages de 15 bits. */
function seeded(seed: number): Rnd {
  const rng = new BorlandRandom(seed);
  return () => rng.next();
}

/** Tirages imposés, puis des zéros. */
function scripted(...values: number[]): Rnd {
  let i = 0;
  return () => values[i++] ?? 0;
}

function newSession(): Session {
  return createSession({ duration: 7200, objectsRequired: 9 });
}

/** Partie de `count` joueurs (personnages 0, 1, 2…), 60 minutes, 5 objets. */
function newGame(count: number, session = newSession()): GameState {
  session.noGameYet = false;
  const game = initGame(session, scripted(0), false);
  game.players = Array.from({ length: count }, (_, j) => createPlayer(j));
  game.duration = 3600;
  game.objectsRequired = 5;
  return game;
}

describe.skipIf(!hasOriginalFiles)("règles d'Astérix (tables de l'exécutable)", () => {
  const tables: ExeTables = hasOriginalFiles ? parseExeTables(readOriginal("ASTERIX.EXE")) : (undefined as never);

  it("lit le plateau de 54 cases et ses comptes (DS:1d81)", () => {
    const count = (type: number): number => tables.board.filter((t) => t === type).length;
    expect(tables.board).toHaveLength(54);
    expect([7, 6, 1, 5, 3, 0, 2, 4, 8, 9, 10].map(count)).toEqual([9, 15, 4, 4, 6, 4, 4, 3, 2, 1, 2]);
    expect(tables.board.slice(0, 9)).toEqual([7, 6, 6, 6, 1, 3, 7, 6, 5]);
    // Un pays toutes les 6 cases.
    expect([0, 6, 12, 18, 24, 30, 36, 42, 48].every((pos) => tables.board[pos] === SQUARE.country)).toBe(true);
  });

  it("lit les tables de géométrie et de réglages", () => {
    expect(tables.pawnCenters[0]).toEqual({ x: 54, y: 91 });
    expect(tables.pawnCenters[53]).toEqual({ x: 264, y: 84 });
    expect(tables.mapCells[0]).toEqual({ x: 4, y: 4 });
    expect(tables.mapCells[53]).toEqual({ x: 4, y: 3 });
    expect(tables.scoreRows).toEqual([[140], [124, 162], [116, 143, 170], [106, 131, 156, 181]]);
    expect(tables.characterSlots.map((s) => s.character)).toEqual([5, 1, 2, 4, 3, 0]);
    expect(tables.stall.map((s) => s.object)).toEqual([0, 4, 5, 2, 8, 7, 6, 3, 1]);
    expect(tables.soothsayer).toHaveLength(6);
    expect(tables.marbleObjects[0]).toEqual({ x: 61, y: 136 });
    expect([...tables.pawnColors[0]]).toEqual([235, 235, 235, 235, 181, 16, 235, 214, 33]);
    expect(tables.quizFiles).toEqual([
      "M40GAULE.TXT",
      "M40GBRET.TXT",
      "M40NORMD.TXT",
      "M40GERMA.TXT",
      "M40ROMAN.TXT",
      "M40GRECE.TXT",
      "M40MEPAL.TXT",
      "M40EGYPT.TXT",
      "M40IBERE.TXT",
    ]);
    expect(tables.characterNames).toEqual(["asterix", "obelix", "bonemine", "agecanonix", "falbala", "goudurix"]);
    expect(tables.soothsayerTexts).toEqual(["tu avais parié: %d", "%s a parié: %d", "réponse exacte !", "faux ! c'était: %d"]);
    expect([tables.defaultDuration, tables.defaultObjects]).toEqual([7200, 9]);
    expect(tables.trapPositions).toEqual([5, 14, 23, 27, 37, 50]);
  });

  it("propose le nombre d'objets de la table DS:201a", () => {
    const objects = (players: number): number[] => [0, 1, 2, 3].map((d) => 3 + 2 * proposedObjects(tables, players, d));
    expect(objects(1)).toEqual([5, 7, 9, 9]);
    expect(objects(2)).toEqual([3, 5, 7, 9]);
    expect(objects(3)).toEqual([3, 5, 7, 9]);
    expect(objects(4)).toEqual([3, 3, 5, 7]);
  });

  it("aiguille les quinze mini-jeux par position (20fa:146d)", () => {
    expect(tables.minigamePositions).toEqual([1, 2, 3, 7, 10, 19, 22, 26, 32, 35, 39, 41, 43, 46, 51]);
    expect(tables.minigamePositions.every((pos) => tables.board[pos] === SQUARE.game)).toBe(true);
    expect(minigameAt(tables, 1)).toMatchObject({ module: 22, announce: 0 });
    expect(minigameAt(tables, 22)).toMatchObject({ module: 36, announce: 14 });
    expect(minigameAt(tables, 46)).toMatchObject({ module: 34, argument: 1 });
    expect(minigameAt(tables, 51)).toMatchObject({ module: 29, argument: 1 });
    expect(minigameAt(tables, 0)).toBeNull();
    expect(MINIGAMES.map((m) => m.module).sort((a, b) => a - b)).toEqual([22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
  });

  it("piège : destination fixe pour la forêt, tirage de 9 cases sans piège pour les autres (20fa:0f38)", () => {
    expect(trapDestination(tables, 5, seeded(1))).toEqual({ module: 15, destination: 33 });
    const ranges: Record<number, [number, number, number]> = { 14: [17, 21, 29], 23: [18, 6, 14], 27: [19, 12, 20], 37: [14, 45, 53], 50: [16, 33, 41] };
    const rnd = seeded(7);
    for (const [pos, [module, first, last]] of Object.entries(ranges)) {
      const seen = new Set<number>();
      for (let i = 0; i < 400; i++) {
        const trap = trapDestination(tables, Number(pos), rnd)!;
        expect(trap.module).toBe(module);
        expect(tables.board[trap.destination]).not.toBe(SQUARE.trap);
        seen.add(trap.destination);
      }
      const expected = [];
      for (let p = first; p <= last; p++) if (tables.board[p] !== SQUARE.trap) expected.push(p);
      expect([...seen].sort((a, b) => a - b)).toEqual(expected);
    }
    expect(trapDestination(tables, 0, seeded(1))).toBeNull();
  });

  it("recule jusqu'à la première prison, et de 6 cases en prolongeant sur un piège", () => {
    expect(pathToPrison(tables, 6)).toEqual([5, 4]);
    // Depuis une prison : au moins un pas, jusqu'à la prison précédente (case 48, en bouclant).
    expect(pathToPrison(tables, 4).at(-1)).toBe(47);
    expect(detritusPath(tables, 0, 1)).toEqual([1, 2, 3, 4, 5, 6]);
    // 6 cases après la position 8 : la 14, un piège ; on continue jusqu'à la 15.
    expect(detritusPath(tables, 8, 1).at(-1)).toBe(15);
    expect(detritusPath(tables, 11, -1).at(-1)).toBe(4);
    // La sixième case (position 50) est un piège : on recule d'une de plus.
    expect(detritusPath(tables, 2, -1)).toEqual([1, 0, 53, 52, 51, 50, 49]);
  });

  it("espion : saute les cases espion, et les cases 2 et 3 quand le joueur a tous ses objets (20fa:09c7)", () => {
    const game = newGame(1);
    const player = game.players[0];
    expect([13, 28, 40, 52].every((pos) => spyForbidden(tables, game, pos))).toBe(true);
    expect(spyForbidden(tables, game, 1)).toBe(false);
    // Position 12 : la direction « bas » (bit 2) avance ; la case 14 (position 13) est un espion, on arrive en 14.
    player.pos = 12;
    expect(spyMove(tables, game, tables.spyDirections[12] & 0xf)).toBe(true);
    expect(player.pos).toBe(14);
    expect(spyMove(tables, game, (tables.spyDirections[14] & 0xf0) >> 4)).toBe(true);
    expect(player.pos).toBe(12);
    expect(spyMove(tables, game, 0)).toBe(false);
    // Avec tous ses objets : de la position 0 on saute les positions 1 et 2.
    player.objectCount = game.objectsRequired;
    player.pos = 0;
    spyMove(tables, game, tables.spyDirections[0] & 0xf);
    expect(player.pos).toBe(3);
  });
});

describe("règles d'Astérix (sans fichiers)", () => {
  it("REJOUER sans partie préalable : Astérix seul, niveaux moyens, 120 minutes et 9 objets (1abf:13e5)", () => {
    const session = newSession();
    const game = initGame(session, scripted(4), true);
    expect(game.players).toHaveLength(1);
    expect(game.players[0]).toMatchObject({ character: 0, reflexion: 1, action: 1, gourds: 2, pos: 0, sesterces: 0, objectCount: 0 });
    expect([game.duration, game.objectsRequired, game.die, game.round, game.bettor]).toEqual([7200, 9, 5, 1, -1]);
  });

  it("REJOUER après une vraie partie reprend joueurs, niveaux, durée et objets ; JOUER repart sans joueur", () => {
    const session = newSession();
    session.noGameYet = false;
    const first = initGame(session, scripted(0), false);
    expect(first.players).toEqual([]);
    first.players = [createPlayer(4, 0, 2), createPlayer(1, 2, 1)];
    first.duration = session.duration = 1800;
    first.objectsRequired = session.objectsRequired = 3;
    saveSetup(session, first);
    first.players[0].sesterces = 12;
    const again = initGame(session, scripted(2), true);
    expect(again.players.map((p) => [p.character, p.reflexion, p.action, p.gourds, p.sesterces])).toEqual([
      [4, 0, 2, 3, 0],
      [1, 2, 1, 1, 0],
    ]);
    expect([again.duration, again.objectsRequired, again.replay, again.die]).toEqual([1800, 3, true, 3]);
  });

  it("victoire : tous ses objets et arrêt sur les cases 1 à 3, premier joueur dans l'ordre des indices (1abf:0cde)", () => {
    const game = newGame(3);
    game.players[1].objectCount = 5;
    game.players[1].pos = 3;
    expect(testVictory(game)).toBe(false);
    game.players[1].pos = 2;
    game.players[2].objectCount = 6;
    game.players[2].pos = 0;
    expect(testVictory(game)).toBe(true);
    expect([game.winner, game.victory, game.over]).toEqual([1, true, true]);
    // Sans tous ses objets, le village ne suffit pas.
    const other = newGame(1);
    other.players[0].objectCount = 4;
    expect(testVictory(other)).toBe(false);
  });

  it("sesterces bornés à 0..99 (1d24:0912)", () => {
    const player = createPlayer(0);
    expect(addSesterces(player, -2)).toBe(0);
    expect(addSesterces(player, 3)).toBe(3);
    expect(addSesterces(player, -5)).toBe(-3);
    player.sesterces = 98;
    expect(addSesterces(player, 3)).toBe(1);
    expect(player.sesterces).toBe(99);
  });

  it("annonce du tour : aucune voix en solo ni pour un prisonnier avec une gourde ; jamais à moins de 6 de la précédente", () => {
    const session = newSession();
    expect(announceVoice(newGame(1), session, seeded(1))).toBe(-1);
    const game = newGame(3);
    game.current = 2;
    game.players[2].inPrison = true;
    expect(announceVoice(game, session, seeded(1))).toBe(-1);
    game.players[2].gourds = 0;
    const rnd = seeded(3);
    let previous = session.lastAnnounce;
    for (let i = 0; i < 300; i++) {
      game.round = 1 + (i % 6);
      const voice = announceVoice(game, session, rnd);
      expect(Math.abs(voice - previous)).toBeGreaterThanOrEqual(6);
      if (game.round < 3) expect([7, 13, 19, 25, 31, 37]).toContain(voice);
      else expect(voice < 5 || (voice - 7) % 6 === 0).toBe(true);
      expect(voice).toBeLessThanOrEqual(5 + 2 + 15 * 6);
      previous = voice;
    }
  });

  it("repos : halte et brigands en solo, jeux d'ambiance à plusieurs, « gagnant » si quelqu'un est en prison (20fa:05e9)", () => {
    const solo = newGame(1);
    expect([0, 1, 2, 3, 4].map((t) => restDraw(solo, scripted(t)))).toEqual(["halt", "halt", "halt", "halt", "brigands"]);
    const many = newGame(3);
    expect([0, 1, 2, 3, 4].map((t) => restDraw(many, scripted(t)))).toEqual(["halt", "halt", "brigands", "loserGame", "winnerGame"]);
    many.players[1].inPrison = true;
    expect(restDraw(many, scripted(3))).toBe("winnerGame");
  });

  it("Détritus : jamais deux fois le même tour de suite, substitutions selon le mode (288f:000f)", () => {
    const session = newSession();
    const two = newGame(2);
    const rnd = seeded(5);
    let previous = session.lastDetritus;
    for (let i = 0; i < 200; i++) {
      const before = session.lastDetritus;
      const draw = detritusDraw(two, session, rnd, false);
      expect(draw.chooseVictim).toBe(false);
      expect(session.lastDetritus).not.toBe(before);
      previous = session.lastDetritus;
    }
    expect(previous).toBeLessThan(4);
    // Mode « sur soi » : sans gourde, la potion devient la prison ; en prison, la prison devient 2 ou 3.
    two.players[0].gourds = 0;
    session.lastDetritus = 1;
    expect(detritusDraw(two, session, scripted(0), false).trick).toBe(1);
    two.players[0].inPrison = true;
    session.lastDetritus = 0;
    expect(detritusDraw(two, session, scripted(1, 1), false).trick).toBe(3);
    // À 3 joueurs : victime désignée, sauf sur la case surprise.
    const three = newGame(3);
    session.lastDetritus = 3;
    expect(detritusDraw(three, session, scripted(2), false)).toEqual({ chooseVictim: true, trick: 2 });
    session.lastDetritus = 3;
    expect(detritusDraw(three, session, scripted(2), true).chooseVictim).toBe(false);
    // Vol de potion écarté si un autre joueur n'a aucune gourde, ou si le voleur est Obélix ou a 5 gourdes.
    three.players[2].gourds = 0;
    session.lastDetritus = 3;
    expect(detritusDraw(three, session, scripted(0), false).trick).toBe(1);
    three.players[2].gourds = 2;
    three.players[0].gourds = 5;
    session.lastDetritus = 3;
    expect(detritusDraw(three, session, scripted(0), false).trick).toBe(1);
  });

  it("surprise : Détritus une fois sur deux, sinon gourde, sesterces ou espion (20fa:231b)", () => {
    const player = createPlayer(0);
    expect(surpriseDraw(player, scripted(0))).toBe("detritus");
    expect(surpriseDraw(player, scripted(1, 0))).toBe("gourd");
    expect(surpriseDraw(player, scripted(1, 1))).toBe("sesterces");
    expect(surpriseDraw(player, scripted(1, 2))).toBe("spy");
    // Obélix ou 5 gourdes : la gourde devient des sesterces ; 97 sesterces ou plus : l'espion.
    expect(surpriseDraw(createPlayer(1), scripted(1, 0))).toBe("sesterces");
    player.gourds = 5;
    expect(surpriseDraw(player, scripted(1, 0))).toBe("sesterces");
    player.sesterces = 97;
    expect(surpriseDraw(player, scripted(1, 1))).toBe("spy");
  });

  it("quiz : numéros par niveau, dernière question exclue, ordre des réponses (25f1:0046)", () => {
    const session = newSession();
    const rnd = seeded(9);
    const ranges = [
      [1, 30],
      [31, 70],
      [71, 99],
    ];
    for (let level = 0; level < 3; level++) {
      let previous = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 2000; i++) {
        const n = quizNumber(session, level, 4, rnd);
        expect(n).toBeGreaterThanOrEqual(ranges[level][0]);
        expect(n).toBeLessThanOrEqual(ranges[level][1]);
        expect(n).not.toBe(previous);
        previous = n;
        seen.add(n);
      }
      expect(seen.size).toBe(ranges[level][1] - ranges[level][0] + 1);
      expect(session.lastQuestion[4 * 3 + level]).toBe(previous);
    }
    for (let i = 0; i < 50; i++) expect([...quizOrder(rnd)].sort()).toEqual([0, 1, 2]);
  });

  it("quiz : voix d'accueil (25f1:042d)", () => {
    const game = newGame(1);
    game.players[0].objectCount = 4;
    expect(quizWelcomeVoice(game, 3, scripted())).toBe(0x33);
    // Dernier tour de table : la phrase « il ne te manque qu'un objet » n'est dite qu'en Gaule.
    game.lastRound = true;
    expect(quizWelcomeVoice(game, 0, scripted())).toBe(0x33);
    expect(quizWelcomeVoice(game, 3, scripted(0, 0, 1))).toBe(0x34 + 6 + 1);
    game.lastRound = false;
    game.players[0].objectCount = 1;
    expect(quizWelcomeVoice(game, 3, scripted(0, 1))).toBe(0x32);
    expect(quizWelcomeVoice(game, 3, scripted(1, 1, 3))).toBe(0x30);
    game.players[0].objects[3] = true;
    expect(quizWelcomeVoice(game, 3, scripted(1, 1))).toBe(0x2f);
  });

  it("quiz : mise en page de la question en lignes de 29 caractères (25f1:0046)", () => {
    expect(layoutQuestion("Qui est le chef du village ?")).toEqual(["Qui est le chef du village ?", "", "", "", ""]);
    const lines = layoutQuestion("Comment s'appelle le barde du village des irréductibles Gaulois ?");
    expect(lines.every((line) => line.length <= 29)).toBe(true);
    expect(lines.join(" ").replace(/ +/g, " ").trim()).toBe("Comment s'appelle le barde du village des irréductibles Gaulois ?");
    // Un « ? » qui tomberait seul en début de ligne emmène le dernier mot de la ligne précédente.
    const alone = layoutQuestion("Quel est le nom de ce chien ?".padStart(31, "x").replace(/^x+/, "Dis-moi : "));
    expect(alone.some((line) => line.trim() === "?")).toBe(false);
  });

  it("commentaire de score : présentation par durée, voix de REJOUER, dernier tour, demi-heure (1d24:112b)", () => {
    const session = newSession();
    const game = newGame(2, session);
    expect(scoreComment(game, session, scripted(), 0)).toEqual({ voice: -1, video: 2 });
    expect(game.intro).toBe(false);
    const solo = newGame(1, session);
    solo.duration = 7200;
    expect(scoreComment(solo, session, scripted(), 0).video).toBe(10);
    const four = newGame(4, session);
    four.duration = 7200;
    expect(scoreComment(four, session, scripted(), 0).video).toBe(4);
    const replayed = newGame(3, session);
    replayed.replay = true;
    expect(scoreComment(replayed, session, scripted(2), 0)).toEqual({ voice: 0xf, video: -1 });
    // Dernier tour de table.
    game.lastRound = true;
    game.round = 5;
    expect(scoreComment(game, session, scripted(1), 3550).video).toBe(8);
    // Pas de commentaire à moins de 360 s du précédent.
    game.lastRound = false;
    session.lastComment = 1000;
    expect(scoreComment(game, session, scripted(), 1300)).toEqual({ voice: -1, video: -1 });
    // « Il reste une demi-heure » puis « un quart d'heure ».
    session.lastComment = 0;
    expect(scoreComment(game, session, scripted(), 3600 - 1800).video).toBe(5);
    expect(scoreComment(game, session, scripted(), 3600 - 900).video).toBe(6);
    // Remarque sur le classement : le dernier est seul, puis le meneur est seul.
    game.players[0].objectCount = 2;
    game.players[1].objectCount = 1;
    expect(scoreComment(game, session, scripted(0, 0), 500).voice).toBe(game.players[1].character + 0x19);
    expect(scoreComment(game, session, scripted(0, 1), 500).voice).toBe(game.players[0].character + 0x10);
    // Tous à égalité.
    game.players[1].objectCount = 2;
    expect(scoreComment(game, session, scripted(0, 1), 500).voice).toBe(0x17);
    // Remarque générale, écartée après 600 s pour deux d'entre elles.
    expect(scoreComment(game, session, scripted(1, 1), 500).voice).toBe(0x20);
    expect(scoreComment(game, session, scripted(1, 0), 700).voice).toBe(-1);
  });

  it("marbre de route : la dernière remarque vraie l'emporte (1d24:161b)", () => {
    const game = newGame(1);
    const player = game.players[0];
    expect(marbleRemark(game)).toBe(-1);
    game.elapsedRead = 601;
    expect(marbleRemark(game)).toBe(1);
    player.objectCount = 1;
    expect(marbleRemark(game)).toBe(2);
    player.objectCount = 4;
    expect(marbleRemark(game)).toBe(0);
    player.gourds = 0;
    expect(marbleRemark(game)).toBe(3);
    player.character = 1;
    expect(marbleRemark(game)).toBe(0);
    player.sesterces = 3;
    expect(marbleRemark(game)).toBe(4);
    player.objectCount = 5;
    expect(marbleRemark(game)).toBe(5);
    player.objectCount = 6;
    expect(marbleRemark(game)).toBe(6);
  });

  it("abandon : le joueur est retiré, le pari du devin suit, le suivant jouera (1d24:0be9)", () => {
    const game = newGame(4);
    game.current = 1;
    game.bettor = 3;
    removeCurrentPlayer(game);
    expect(game.players.map((p) => p.character)).toEqual([0, 2, 3]);
    expect([game.current, game.bettor, game.abandoned]).toEqual([0, 2, true]);
    game.current = 2;
    removeCurrentPlayer(game);
    expect([game.current, game.bettor]).toEqual([1, -1]);
    // Le joueur 0 abandonne : l'indice repart du dernier, l'incrément de fin de tour reviendra au nouveau joueur 0.
    const other = newGame(3);
    removeCurrentPlayer(other);
    expect(other.current).toBe(1);
    expect(other.players).toHaveLength(2);
  });

  it("écran de jeu : cases visibles et rang à l'écran, avec bouclage (1d24:09b9, 1d24:0a02)", () => {
    expect([0, 8, 9].map((pos) => squareVisible(0, pos))).toEqual([true, true, false]);
    expect([51, 53, 0, 2, 3, 50].map((pos) => squareVisible(17, pos))).toEqual([true, true, true, true, true, false]);
    expect([51, 0, 5].map((pos) => screenRank(17, pos))).toEqual([0, 1, 2]);
    expect(screenRank(16, 1)).toBe(2);
    expect(screenRank(3, 0)).toBe(-1);
  });

  it("annonce d'un mini-jeu : la première variante une seule fois, puis 1 et 2 en alternance (20fa:130f)", () => {
    const session = newSession();
    const variants = [announceVariant(session, 4, scripted(1)), announceVariant(session, 4, scripted()), announceVariant(session, 4, scripted())];
    expect(variants).toEqual([0, 2, 1]);
    expect(announceVariant(session, 4, scripted())).toBe(2);
    expect(announceVariant(session, 5, scripted(0))).toBe(0);
    expect(session.announceVariant[5]).toBe(1);
  });
});
