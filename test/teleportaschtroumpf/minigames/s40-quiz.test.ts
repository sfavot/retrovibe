import { describe, expect, it } from "vitest";
import { encodeCp437 } from "../../../src/data/cp437";
import { measureText, parsePfn } from "../../../src/games/teleportaschtroumpf/data/font";
import { parseQuiz } from "../../../src/games/teleportaschtroumpf/data/text";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  ANSWER_ROWS,
  QuizScene,
  TEXT_LEFT,
  TEXT_WIDTH,
  answerRowAt,
  answerVoiceNumber,
  createQuiz,
  drawOrder,
  drawQuestion,
  questionVoiceNumber,
  splitPhrase,
  timeLimit,
  wrongVoiceNumber,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s40-quiz";
import { hasOriginalFiles, readData } from "../helpers";
import { longPress, swipe, tap, touchDown, touchMove, touchUp } from "../touch";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

const below = (seed: number) => {
  const rng = new BorlandRandom(seed);
  return (n: number) => rng.below(n);
};

describe("S40 : règles du quiz (pur, `2ee8:000d`)", () => {
  it("temps imparti : 35 − 7 × niveau secondes", () => {
    expect([0, 1, 2].map(timeLimit)).toEqual([35, 28, 21]);
  });

  it("voix : question puis trois propositions, décalées d'un numéro à partir de la question 13 ; `s40b` saute le fichier 4", () => {
    expect([0, 1, 12, 13, 43].map(questionVoiceNumber)).toEqual([3, 7, 51, 56, 176]);
    expect([0, 1, 2].map((a) => answerVoiceNumber(0, a))).toEqual([4, 5, 6]);
    expect([12, 13].map((q) => answerVoiceNumber(q, 2))).toEqual([54, 59]);
    expect(answerVoiceNumber(43, 2)).toBe(179);
    expect([0, 2, 3, 43].map(wrongVoiceNumber)).toEqual([1, 3, 5, 45]);
  });

  it("ordre des propositions : toujours une permutation de 0, 1, 2, et les six se rencontrent", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const order = drawOrder(below(seed));
      expect([...order].sort()).toEqual([0, 1, 2]);
      seen.add(order.join(""));
    }
    expect(seen.size).toBe(6);
  });

  it("question : jamais l'une des cinq précédentes, et 0 à 4 sont exclues à la première partie", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    const rand = below(3);
    const first = drawQuestion(game, 44, rand);
    expect(first).toBeGreaterThanOrEqual(5);
    const drawn = [first];
    for (let i = 0; i < 60; i++) {
      const next = drawQuestion(game, 44, rand);
      expect(drawn.slice(-5)).not.toContain(next);
      drawn.push(next);
    }
    expect(new Set(drawn).size).toBeGreaterThan(30);
  });

  it("la mémoire des questions est propre à chaque partie", () => {
    const a = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    const b = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(drawQuestion(a, 44, below(9))).toBe(drawQuestion(b, 44, below(9)));
  });

  it("doigt : une bande par proposition, de la largeur du bloc de texte, centrée sur la ligne", () => {
    const h = 10;
    const step = ANSWER_ROWS[1] - ANSWER_ROWS[0];
    for (let row = 0; row < 3; row++) {
      const y = ANSWER_ROWS[row] + h / 2;
      expect(answerRowAt(160, y, h)).toBe(row);
      expect(answerRowAt(160, Math.ceil(y - step / 2), h)).toBe(row);
      expect(answerRowAt(160, Math.ceil(y + step / 2) - 1, h)).toBe(row);
      expect(answerRowAt(TEXT_LEFT, y, h)).toBe(row);
      expect(answerRowAt(TEXT_LEFT + TEXT_WIDTH, y, h)).toBe(row);
      expect(answerRowAt(TEXT_LEFT - 20, y, h)).toBeNull();
      expect(answerRowAt(TEXT_LEFT + TEXT_WIDTH + 20, y, h)).toBeNull();
    }
    expect(answerRowAt(160, 0x1e, h)).toBeNull();
    expect(answerRowAt(160, ANSWER_ROWS[2] + h / 2 + step, h)).toBeNull();
  });

  it("la requête est exigée : sans Game.openMinigame(40) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createQuiz(game, () => undefined)).toThrow(/openMinigame\(40\)/);
  });
});

describe.skipIf(!hasOriginalFiles)("S40 : mise en page avec la police S52D001F", () => {
  const font = () => parsePfn(readData("S52/S52D/S52D001F.PFN"));
  const quiz = () => parseQuiz(readData("S40/S40A/S40A.DAT"));

  it("44 questions ; toutes leurs lettres (accents compris) ont un glyphe, et aucune ligne ne déborde du bloc", () => {
    const f = font();
    const { questions } = quiz();
    expect(questions).toHaveLength(44);
    for (const q of questions) {
      for (const text of [q.text, q.correct, ...q.wrong]) {
        for (const code of encodeCp437(text)) {
          if (code === 0x20) continue;
          expect(f.glyphs.get(code)?.width ?? 0, `« ${text} » : code ${code.toString(16)}`).toBeGreaterThan(0);
        }
        // Les propositions tiennent dans le bloc de 185 px.
        if (text !== q.text) expect(measureText(f, encodeCp437(text))).toBeLessThanOrEqual(TEXT_WIDTH);
      }
      const lines = splitPhrase(f, encodeCp437(q.text));
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(3);
      // Comme l'original, un point qui déborde reste sur la ligne : au plus un glyphe (≤ 16 px) de trop.
      for (const line of lines.slice(0, 2)) expect(measureText(f, line)).toBeLessThanOrEqual(TEXT_WIDTH + 16);
    }
  });

  it("les accents du français sont dans la zone dessinée de la police (< 0xB0)", () => {
    const codes = new Set(quiz().questions.flatMap((q) => [...encodeCp437([q.text, q.correct, ...q.wrong].join(" "))]));
    expect(Math.max(...codes)).toBeLessThan(0xb0);
  });

  it("coupe comme l'original : à l'espace (supprimée) ou après un point, jamais un mot perdu", () => {
    const f = font();
    for (const q of quiz().questions) {
      const lines = splitPhrase(f, encodeCp437(q.text));
      const rejoined = lines.map((l) => String.fromCharCode(...l)).join(" ");
      expect(rejoined.replace(/\s+/g, "")).toBe(String.fromCharCode(...encodeCp437(q.text)).replace(/\s+/g, ""));
    }
    // Une phrase courte reste sur une ligne.
    expect(splitPhrase(f, encodeCp437("Perdre la schtroumpf."))).toHaveLength(1);
    // Une longue se coupe à l'espace précédant le débordement.
    const long = encodeCp437("Il y a un schtroumpf sous roche et ce n'est pas du schtroumpf de bonne qualité dit-on.");
    const lines = splitPhrase(f, long);
    expect(lines.length).toBeGreaterThan(1);
    expect(String.fromCharCode(...lines[0]).endsWith(" ")).toBe(false);
  });
});

/**
 * Attend la fin du bruit de sélection puis laisse passer quelques ticks : l'original ne relâche le verrou de ↑ / ↓ qu'à la prochaine
 * itération sans touche, un appui lancé à la seconde où la boucle reprend serait ignoré.
 */
async function settle(run: LaunchedMinigame): Promise<void> {
  await run.until(() => (run.scene as QuizScene).stage === "choose");
  await run.run(80);
}

/** Joue : ↑ / ↓ jusqu'à la ligne voulue, puis Espace. */
async function moveTo(run: LaunchedMinigame, row: number): Promise<void> {
  const scene = run.scene as QuizScene;
  for (let guard = 0; scene.selection !== row && guard < 8; guard++) {
    await run.tap(scene.selection < row ? "ArrowDown" : "ArrowUp", 60);
    await settle(run);
  }
  expect(scene.selection).toBe(row);
}

async function chooseAnswer(run: LaunchedMinigame, answer: number): Promise<void> {
  const scene = run.scene as QuizScene;
  await run.until(() => scene.stage === "choose");
  await moveTo(run, scene.rowAnswers.indexOf(answer));
  await run.tap("Space", 60);
}

describe.skipIf(!hasOriginalFiles)("S40 Le Quizz : au doigt (ajout du port)", () => {
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(40, options);
    await run.until(() => !run.ctx.fade.active);
    await settle(run);
    return run;
  };
  /** Milieu de la ligne `row` à l'écran. */
  const rowPoint = async (run: LaunchedMinigame, row: number): Promise<[number, number]> => {
    const font = await run.ctx.resources.pfn("s52d001f.pfn");
    return [160, Math.round(ANSWER_ROWS[row] + font.height / 2)];
  };

  it("toucher la bonne proposition sur une autre ligne : elle est surlignée avec son clic, puis validée (1 point)", async () => {
    const run = await launch({ seed: 9, audio: true });
    const scene = run.scene as QuizScene;
    const row = scene.rowAnswers.indexOf(0);
    expect(row).not.toBe(0);
    const before = run.host.audio.plays.length;
    tap(run.host.input, ...(await rowPoint(run, row)));
    await run.run(50);
    expect(scene.selection).toBe(row);
    expect(scene.stage).toBe("move");
    expect(run.host.audio.plays.length).toBe(before + 1);
    await run.until(() => scene.stage === "answer");
    expect(await run.finish()).toEqual({ kind: "points", points: 1 });
  }, 60_000);

  it("toucher la ligne déjà surlignée la valide aussitôt ; une mauvaise proposition ne donne rien", async () => {
    const run = await launch({ seed: 9 });
    const scene = run.scene as QuizScene;
    expect(scene.rowAnswers[0]).not.toBe(0);
    tap(run.host.input, ...(await rowPoint(run, 0)));
    await run.run(50);
    expect(scene.stage).not.toBe("choose");
    expect(scene.selection).toBe(0);
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 60_000);

  it("appui long sur une proposition : surlignée puis lue à voix haute, sans valider (le clic droit du doigt)", async () => {
    const run = await launch({ seed: 5, audio: true });
    const scene = run.scene as QuizScene;
    const answerVoice = await run.ctx.resources.voc(`s40a${String(answerVoiceNumber(scene.questionIndex, scene.rowAnswers[2])).padStart(3, "0")}t.voc`);
    longPress(run.host.input, ...(await rowPoint(run, 2)));
    await run.until(() => scene.stage === "read");
    expect(scene.selection).toBe(2);
    expect(run.host.audio.plays.at(-1)!.sound.samples).toEqual(answerVoice.samples);
    await run.until(() => scene.stage === "choose");
    await run.run(300);
    expect(scene.stage).toBe("choose");
    expect(run.outcome).toBeUndefined();
  }, 60_000);

  it("le doigt qui se pose ne valide rien ; toucher hors des propositions ou glisser ne fait rien", async () => {
    const run = await launch({ seed: 5, audio: true });
    const scene = run.scene as QuizScene;
    const [x, y] = await rowPoint(run, 1);
    touchDown(run.host.input, x, y);
    await run.run(200);
    expect(scene.stage).toBe("choose");
    // Le doigt glisse avant de se lever : pas de toucher.
    touchMove(run.host.input, x + 40, y);
    touchUp(run.host.input, x + 40, y);
    await run.run(100);
    swipe(run.host.input, x, y, 0, 30);
    await run.run(100);
    const before = run.host.audio.plays.length;
    for (const [px, py] of [
      [160, 20],
      [10, y],
      [310, y],
    ]) {
      tap(run.host.input, px, py);
      await run.run(100);
    }
    expect(scene.stage).toBe("choose");
    expect(scene.selection).toBe(0);
    expect(run.host.audio.plays.length).toBe(before);
  }, 60_000);

  it("un toucher pendant la voix de la proposition choisie la coupe, comme le clic gauche", async () => {
    const run = await launch({ seed: 9, audio: true });
    const scene = run.scene as QuizScene;
    tap(run.host.input, ...(await rowPoint(run, 0)));
    await run.run(50);
    expect(scene.stage).toBe("answer");
    expect(run.ctx.voice.voicePlaying).toBe(true);
    tap(run.host.input, 10, 10);
    await run.run(50);
    expect(scene.stage).toBe("result");
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S40 Le Quizz : déroulé, réponses, temps", () => {
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(40, options);
    await run.until(() => !run.ctx.fade.active);
    return run;
  };

  it("départ : question tirée, trois propositions, première ligne surlignée, le chrono ne court pas avant la fin de la voix", async () => {
    const run = await launchMinigame(40, { seed: 3 });
    const scene = run.scene as QuizScene;
    expect(run.ctx.fade.active).toBe(true);
    await run.run(100);
    expect(scene.stage).toBe("enter");
    await run.until(() => scene.stage === "choose");
    expect(scene.selection).toBe(0);
    expect([...scene.rowAnswers].sort()).toEqual([0, 1, 2]);
    expect(scene.questionLines.join(" ")).toMatch(/schtroumpf/);
    expect(scene.questionIndex).toBeGreaterThanOrEqual(5);
    run.shot("s40-debut");
  }, 30_000);

  it("la voix de la question est lue avant le choix, puis le chrono démarre (audio actif)", async () => {
    const run = await launch({ seed: 3, audio: true });
    const scene = run.scene as QuizScene;
    await run.until(() => scene.stage === "ask");
    const played = run.host.audio.plays.at(-1)!;
    expect(played.sound.samples.length).toBeGreaterThan(8000);
    await run.run(300);
    expect(scene.stage).toBe("ask");
    expect(scene.seconds).toBe(0);
    await run.until(() => scene.stage === "choose");
    await run.run(2200);
    expect(scene.seconds).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("textes : une question à deux lignes, des accents (à, è, é, â, ê, ô) dans la question et les propositions (captures)", async () => {
    // Question → lignes attendues (les questions 0 à 4 ne sortent pas à la première partie) ; les captures `s40-q<n>` servent à relire les accents à l'œil.
    const wanted = new Map<number, string[]>([
      [14, ["Ne pas voir plus loin que le", "bout de son schtroumpf."]],
      [18, ["Une fièvre de schtroumpf."]],
      [21, ["Une mémoire de schtroumpf."]],
      [24, ["Un vent à décorner un", "schtroumpf."]],
      [33, ["La nuit, tous les chats sont", "schtroumpfs."]],
    ]);
    const found = new Set<number>();
    for (let seed = 1; seed <= 400 && found.size < wanted.size; seed++) {
      const run = await launch({ seed });
      const scene = run.scene as QuizScene;
      const lines = wanted.get(scene.questionIndex);
      if (!lines || found.has(scene.questionIndex)) continue;
      found.add(scene.questionIndex);
      expect(scene.questionLines).toEqual(lines);
      run.shot(`s40-q${scene.questionIndex}`);
    }
    expect(found.size).toBe(wanted.size);
  }, 120_000);

  it("graine fixe : même question et même ordre ; des graines différentes les font varier", async () => {
    const a = (await launch({ seed: 21 })).scene as QuizScene;
    const b = (await launch({ seed: 21 })).scene as QuizScene;
    expect(a.questionIndex).toBe(b.questionIndex);
    expect(a.rowAnswers).toEqual(b.rowAnswers);
    const questions = new Set<number>();
    const orders = new Set<string>();
    for (let seed = 1; seed <= 14; seed++) {
      const scene = (await launch({ seed })).scene as QuizScene;
      questions.add(scene.questionIndex);
      orders.add(scene.rowAnswers.join(""));
    }
    expect(questions.size).toBeGreaterThan(5);
    expect(orders.size).toBeGreaterThan(2);
  }, 120_000);

  it("↓ / ↑ : un pas par appui, borné à 0 et 2, un clic de sélection à chaque changement (audio actif)", async () => {
    const run = await launch({ seed: 5, audio: true });
    const scene = run.scene as QuizScene;
    await settle(run);
    const plays = () => run.host.audio.plays.length;
    const before = plays();
    await run.tap("ArrowUp", 60);
    expect(scene.selection).toBe(0);
    expect(plays()).toBe(before);
    await run.tap("ArrowDown", 60);
    expect(scene.selection).toBe(1);
    await settle(run);
    expect(plays()).toBe(before + 1);
    await run.tap("KeyA", 60);
    await settle(run);
    await run.tap("ArrowDown", 60);
    expect(scene.selection).toBe(2);
    await settle(run);
    await run.tap("KeyQ", 60);
    expect(scene.selection).toBe(1);
  }, 60_000);

  it("une flèche tenue ne fait qu'un pas (verrou jusqu'au relâchement)", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as QuizScene;
    await run.until(() => scene.stage === "choose");
    run.host.input.keyDown("ArrowDown");
    await run.run(1500);
    expect(scene.selection).toBe(1);
    run.host.input.keyUp("ArrowDown");
    await run.run(100);
    await run.tap("ArrowDown", 60);
    expect(scene.selection).toBe(2);
  }, 30_000);

  it("le bord haut / bas de l'écran émule ↑ / ↓ à l'arrivée du pointeur", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as QuizScene;
    await settle(run);
    run.host.input.mouseMove(160, 199);
    await run.run(100);
    expect(scene.selection).toBe(1);
    await settle(run);
    run.host.input.mouseMove(160, 100);
    await run.run(100);
    run.host.input.mouseMove(160, 0);
    await run.run(100);
    expect(scene.selection).toBe(0);
  }, 30_000);

  it("Entrée (clic droit) lit la proposition surlignée sans valider", async () => {
    const run = await launch({ seed: 5, audio: true });
    const scene = run.scene as QuizScene;
    await run.until(() => scene.stage === "choose");
    const before = run.host.audio.plays.length;
    await run.tap("Enter", 60);
    expect(run.host.audio.plays.length).toBe(before + 1);
    await run.until(() => scene.stage === "choose");
    expect(run.outcome).toBeUndefined();
    expect(scene.selection).toBe(0);
  }, 60_000);

  it("réussite : la bonne proposition donne 1 point et la voix de félicitations (`s40c`) est tirée", async () => {
    const run = await launch({ seed: 9 });
    const scene = run.scene as QuizScene;
    await chooseAnswer(run, 0);
    expect(await run.finish()).toEqual({ kind: "points", points: 1 });
    expect(scene.points).toBe(1);
    expect(scene.congratulation).toBeGreaterThanOrEqual(0);
    expect(scene.congratulation).toBeLessThan(6);
    run.shot("s40-reussite");
  }, 60_000);

  it("échec : une mauvaise proposition ne donne rien", async () => {
    for (const wrong of [1, 2]) {
      const run = await launch({ seed: 9 });
      await chooseAnswer(run, wrong);
      expect(await run.finish()).toEqual({ kind: "points", points: 0 });
      expect((run.scene as QuizScene).congratulation).toBe(-1);
    }
  }, 60_000);

  it("temps écoulé : la proposition surlignée est prise telle quelle (juste si c'est la bonne, sinon échec)", async () => {
    const run = await launch({ seed: 9 });
    const scene = run.scene as QuizScene;
    await run.until(() => scene.stage === "choose");
    const top = scene.rowAnswers[0];
    await run.finish();
    expect(scene.seconds).toBeGreaterThanOrEqual(35);
    expect(scene.seconds).toBeLessThanOrEqual(36);
    expect(scene.points).toBe(top === 0 ? 1 : 0);
  }, 120_000);

  it("niveaux : 35, 28 et 21 s ; l'indice de l'oiseau ramène au niveau 0", async () => {
    for (const [level, seconds] of [
      [0, 35],
      [1, 28],
      [2, 21],
    ] as const) {
      const run = await launch({ seed: 4, level });
      const scene = run.scene as QuizScene;
      expect(scene.internalLevel).toBe(level);
      await run.until(() => scene.stage === "choose");
      await run.run(1000 * (seconds - 1) - 500);
      expect(scene.stage).toBe("choose");
      await run.run(2500);
      expect(scene.stage).not.toBe("choose");
    }
    const bird = await launch({ seed: 4, level: 2, bonus: true });
    expect((bird.scene as QuizScene).internalLevel).toBe(0);
    expect(bird.game.state.bonusTag).toBe(0);
  }, 240_000);

  it("plateau : bonne réponse = 1 goutte de rosée, le plateau reprend la main", async () => {
    const s = await enterFromBoard(40, "QuizScene", { seed: 11 });
    const scene = s.ctx.scenes.top as QuizScene;
    expect(scene).toBeInstanceOf(QuizScene);
    expect(s.game.state.pending).toMatchObject({ scene: 40, player: 0 });
    const before = s.game.player.points;
    await s.until(() => scene.stage === "choose");
    const target = scene.rowAnswers.indexOf(0);
    for (let i = 0; i < target; i++) {
      await s.tap("ArrowDown");
      await s.until(() => scene.stage === "choose");
    }
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.points).toBe(before + 1);
    expect(s.history).toContain("QuizScene");
  }, 180_000);

  it("plateau : mauvaise réponse = rien", async () => {
    const s = await enterFromBoard(40, "QuizScene", { seed: 11 });
    const scene = s.ctx.scenes.top as QuizScene;
    const before = s.game.player.points;
    await s.until(() => scene.stage === "choose");
    // La ligne surlignée au départ est la 1re : on prend une ligne qui n'est pas la bonne.
    if (scene.rowAnswers[0] === 0) {
      await s.tap("ArrowDown");
      await s.until(() => scene.stage === "choose");
    }
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.points).toBe(before);
  }, 180_000);

  it("mode libre : la partie se joue, puis la carte revient sans rien appliquer", async () => {
    const run = await enterFromFreeMode(40, { seed: 5 });
    const scene = run.scene as QuizScene;
    expect(scene).toBeInstanceOf(QuizScene);
    expect(run.game.state.pending).toMatchObject({ scene: 40 });
    await run.until(() => scene.stage === "choose");
    await run.tap("Space", 60);
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 60_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);
});
