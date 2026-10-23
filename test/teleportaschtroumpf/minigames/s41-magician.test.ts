import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { type Game, newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  CHOICE_TIME_UP,
  CHOICE_VOICE_TABLE,
  MagicianScene,
  ZONES,
  ZONE_COUNT,
  choiceVoice,
  createMagician,
  zoneAt,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s41-magician";
import { Session } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { doorPosition, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S41 : règles du magicien (pur, `2143:0009`)", () => {
  it("neuf zones : huit ingrédients et le chapeau (8), le centre de chacune la désigne", () => {
    expect(ZONE_COUNT).toBe(9);
    expect(ZONES.map((z) => z.choice).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const z of ZONES) expect(zoneAt((z.x1 + z.x2) >> 1, (z.y1 + z.y2) >> 1)).toBe(z.choice);
  });

  it("les bornes de chaque zone sont exclues ; hors de toute zone : -1 ; sinon la dernière zone testée qui contient le point", () => {
    const hat = ZONES.find((z) => z.choice === 8)!;
    expect(zoneAt(hat.x1, hat.y1)).toBe(-1);
    expect(zoneAt(0, 0)).toBe(-1);
    for (let x = 0; x < 320; x++) {
      for (let y = 0; y < 200; y++) {
        const hits = ZONES.filter((z) => z.x1 < x && x < z.x2 && z.y1 < y && y < z.y2);
        expect(zoneAt(x, y)).toBe(hits.length ? hits[hits.length - 1].choice : -1);
      }
    }
  });

  it("voix du choix : `s41v` 1 + T[choix], T = 1 6 3 5 2 7 8 0 4 ; rien quand le temps est écoulé", () => {
    expect(CHOICE_VOICE_TABLE).toEqual([1, 6, 3, 5, 2, 7, 8, 0, 4]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(choiceVoice)).toEqual([2, 7, 4, 6, 3, 8, 9, 1, 5]);
    expect(choiceVoice(CHOICE_TIME_UP)).toBeNull();
  });

  it("la requête est exigée : sans Game.openMinigame(41) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createMagician(game, () => undefined)).toThrow(/openMinigame\(41\)/);
  });
});

// --- Pilote -------------------------------------------------------------------------------------------

interface Holdings {
  points?: number;
  /** Masque des ingrédients possédés. */
  mask?: number;
}

function setupPlayer({ points = 6, mask = 0b0000_0110 }: Holdings = {}): (game: Game) => void {
  return (game) => {
    const p = game.state.players[0];
    p.points = points;
    p.ingredients = mask;
    p.ingredientCount = [...Array(8).keys()].filter((i) => (mask >> i) & 1).length;
  };
}

async function launch(holdings: Holdings = {}, options: LaunchOptions = {}): Promise<LaunchedMinigame> {
  return launchMinigame(41, { seed: 5, setup: setupPlayer(holdings), ...options });
}

type Driver = Pick<LaunchedMinigame, "run" | "tap" | "host" | "ctx">;

/** Joue jusqu'à `done()` en passant les vidéos (Échap) ; échoue au bout de `limit` pas. */
async function playUntil(run: Driver, scene: MagicianScene, done: () => boolean, limit = 4000): Promise<void> {
  for (let i = 0; !done(); i++) {
    if (i > limit) throw new Error(`condition non atteinte (phase ${scene.stage}, écran ${scene.screen})`);
    if (scene.stage === "video") await run.tap("Escape", 60);
    else await run.run(100);
  }
}

async function answerQuestion(run: Driver, scene: MagicianScene, yes: boolean): Promise<void> {
  await playUntil(run, scene, () => scene.stage === "question");
  if (!yes) await run.tap("ArrowRight", 80);
  await run.tap("Space", 80);
}

async function reachChoice(run: Driver, scene: MagicianScene): Promise<void> {
  await answerQuestion(run, scene, true);
  await playUntil(run, scene, () => scene.stage === "choice");
}

function center(choice: number): [number, number] {
  const z = ZONES.find((zone) => zone.choice === choice)!;
  return [(z.x1 + z.x2) >> 1, (z.y1 + z.y2) >> 1];
}

async function clickZone(run: Driver, choice: number, hold = 100): Promise<void> {
  const [x, y] = center(choice);
  run.host.input.mouseMove(x, y);
  await run.run(60);
  run.host.input.mouseDown(0);
  await run.run(hold);
  run.host.input.mouseUp(0);
  await run.run(60);
}

async function confirm(run: Driver, scene: MagicianScene, yes: boolean): Promise<void> {
  await playUntil(run, scene, () => scene.stage === "confirm");
  if (!yes) await run.tap("ArrowDown", 80);
  await run.tap("Space", 80);
}

describe.skipIf(!hasOriginalFiles)("S41 Le Magicien : branches de l'entrée", () => {
  it("tous les ingrédients possédés : rien n'est montré, aucun échange", async () => {
    const run = await launch({ points: 9, mask: 0xff });
    const scene = run.scene as MagicianScene;
    expect(scene.branch).toBe("closed");
    expect(run.game.canTrade(0)).toBe(false);
    expect(await run.finish()).toEqual({ kind: "magician", choice: null });
    expect(scene.screen).toBe("none");
  }, 60_000);

  it("moins de 3 gouttes : le magicien refuse (s41a1 puis s41c), aucun échange", async () => {
    const run = await launch({ points: 2 });
    const scene = run.scene as MagicianScene;
    expect(scene.branch).toBe("refusal");
    expect(run.game.canTrade(0)).toBe(false);
    expect(scene.clipFile).toBe("s41a1.mux");
    const seen: string[] = [];
    await playUntil(run, scene, () => {
      if (scene.clipFile && seen.at(-1) !== scene.clipFile) seen.push(scene.clipFile);
      return scene.stage === "done";
    });
    expect(seen).toEqual(["s41a1.mux", "s41c.mux"]);
    expect(await run.finish()).toEqual({ kind: "magician", choice: null });
  }, 120_000);

  it("3 gouttes suffisent : la question est posée (s41a1, s41d, puis l'image de la question)", async () => {
    const run = await launch({ points: 3 });
    const scene = run.scene as MagicianScene;
    expect(scene.branch).toBe("trade");
    expect(run.game.canTrade(0)).toBe(true);
    const seen: string[] = [];
    await playUntil(run, scene, () => {
      if (scene.clipFile && seen.at(-1) !== scene.clipFile) seen.push(scene.clipFile);
      return scene.stage === "question";
    });
    expect(seen).toEqual(["s41a1.mux", "s41d.mux"]);
    expect(scene.screen).toBe("question");
    expect(scene.selected).toBe(0);
    run.shot("s41-question");
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S41 Le Magicien : question", () => {
  it("Non : vidéo s41e puis fin sans échange ; les flèches changent la sélection sans déborder", async () => {
    const run = await launch();
    const scene = run.scene as MagicianScene;
    await playUntil(run, scene, () => scene.stage === "question");
    await run.tap("ArrowLeft", 80);
    expect(scene.selected).toBe(0);
    await run.tap("ArrowRight", 80);
    expect(scene.selected).toBe(1);
    await run.tap("ArrowRight", 80);
    expect(scene.selected).toBe(1);
    run.shot("s41-question-non");
    await run.tap("Space", 80);
    expect(scene.answer).toBe(false);
    const seen: string[] = [];
    await playUntil(run, scene, () => {
      if (scene.clipFile && seen.at(-1) !== scene.clipFile) seen.push(scene.clipFile);
      return scene.stage === "done";
    });
    expect(seen.at(-1)).toBe("s41e.mux");
    expect(await run.finish()).toEqual({ kind: "magician", choice: null });
  }, 120_000);

  it("Oui : vidéos s41f et s41a2, puis l'écran de choix", async () => {
    const run = await launch();
    const scene = run.scene as MagicianScene;
    const seen: string[] = [];
    await playUntil(run, scene, () => {
      if (scene.clipFile && seen.at(-1) !== scene.clipFile) seen.push(scene.clipFile);
      return scene.stage === "question";
    });
    await run.tap("Space", 80);
    expect(scene.answer).toBe(true);
    await playUntil(run, scene, () => {
      if (scene.clipFile && seen.at(-1) !== scene.clipFile) seen.push(scene.clipFile);
      return scene.stage === "choice";
    });
    expect(seen).toEqual(["s41a1.mux", "s41d.mux", "s41f.mux", "s41a2.mux"]);
    expect(scene.screen).toBe("choice");
  }, 120_000);

  it("le bip de changement ne sonne au premier tour que si le dernier état connu n'est pas Oui (mémoire par partie)", async () => {
    const run = await launch({}, { audio: true });
    const scene = run.scene as MagicianScene;
    const beep = await run.ctx.resources.voc("s07a001b.voc");
    await playUntil(run, scene, () => scene.stage === "question");
    expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(beep.samples);
  }, 180_000);
});

describe.skipIf(!hasOriginalFiles)("S41 Le Magicien : choix et confirmation", () => {
  it("chaque zone est désignée par le curseur (cadres de survol) ; l'écran se rend avec la palette s41a.pal", async () => {
    const run = await launch({ mask: 0 });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    await run.run(200);
    run.shot("s41-choix");
    for (const z of ZONES) {
      const [x, y] = center(z.choice);
      run.host.input.mouseMove(x, y);
      await run.run(100);
      expect(scene.hoveredZone).toBe(z.choice);
    }
    run.host.input.mouseMove(10, 10);
    await run.run(100);
    expect(scene.hoveredZone).toBe(-1);
    run.host.input.mouseMove(...center(8));
    await run.run(100);
    run.shot("s41-choix-chapeau");
    run.host.input.mouseMove(...center(0));
    await run.run(100);
    run.shot("s41-choix-survol");
  }, 180_000);

  it("les flèches déplacent le curseur de 2 px par tick et Espace clique", async () => {
    const run = await launch({ mask: 0 });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    const [x, y] = center(4);
    run.host.input.mouseMove(x - 20, y);
    run.host.input.keyDown("ArrowRight");
    await run.until(() => run.ctx.input.mouseX >= x, 3000);
    run.host.input.keyUp("ArrowRight");
    await run.run(100);
    expect(scene.hoveredZone).toBe(4);
    await run.tap("Space", 80);
    expect(scene.chosen).toBe(4);
  }, 180_000);

  it("un ingrédient déjà possédé est refusé de vive voix et on reste sur l'écran ; la voix change à la 2e fois", async () => {
    const run = await launch({ mask: 0b0000_0110 });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    await clickZone(run, 1);
    expect(scene.chosen).toBeNull();
    expect(scene.ownedReplies[1]).toBe(1);
    expect(scene.stage).toBe("choice");
    await clickZone(run, 1);
    expect(scene.ownedReplies[1]).toBe(2);
    await clickZone(run, 2);
    expect(scene.ownedReplies[2]).toBe(1);
    expect(scene.stage).toBe("choice");
    // Le chapeau n'est jamais refusé, même au « mauvais » moment.
    await clickZone(run, 8);
    expect(scene.chosen).toBe(8);
  }, 180_000);

  it("un clic dans le vide ne fait rien", async () => {
    const run = await launch();
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    run.host.input.mouseMove(10, 10);
    await run.run(60);
    run.host.input.mouseDown(0);
    await run.run(100);
    run.host.input.mouseUp(0);
    await run.run(100);
    expect(scene.chosen).toBeNull();
    expect(scene.stage).toBe("choice");
  }, 180_000);

  it("un ingrédient manquant : deux voix, vidéo s41b, confirmation ; Oui rend l'ingrédient", async () => {
    const run = await launch({ mask: 0b0000_0110 });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    await clickZone(run, 3);
    expect(scene.chosen).toBe(3);
    const seen: string[] = [];
    await playUntil(run, scene, () => {
      if (scene.clipFile && seen.at(-1) !== scene.clipFile) seen.push(scene.clipFile);
      return scene.stage === "confirm";
    });
    expect(seen.at(-1)).toBe("s41b.mux");
    expect(scene.screen).toBe("confirm");
    expect(scene.selected).toBe(0);
    await run.run(200);
    run.shot("s41-confirmation");
    await run.tap("ArrowDown", 80);
    expect(scene.selected).toBe(1);
    await run.tap("ArrowUp", 80);
    expect(scene.selected).toBe(0);
    await run.tap("Space", 80);
    expect(scene.confirmation).toBe(true);
    expect(await run.finish()).toEqual({ kind: "magician", choice: 3 });
  }, 180_000);

  it("le chapeau (choix 8) : même confirmation, issue 8", async () => {
    const run = await launch({ mask: 0b0000_0110 });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    await clickZone(run, 8);
    await confirm(run, scene, true);
    expect(await run.finish()).toEqual({ kind: "magician", choice: 8 });
  }, 180_000);

  it("Non à la confirmation : retour à l'écran de choix (compteurs remis à 0), puis un autre choix", async () => {
    const run = await launch({ mask: 0b0000_0110 });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    await clickZone(run, 1);
    expect(scene.ownedReplies[1]).toBe(1);
    await clickZone(run, 5);
    await confirm(run, scene, false);
    expect(scene.confirmation).toBe(false);
    await playUntil(run, scene, () => scene.stage === "choice" && scene.chosen === null);
    expect(scene.screen).toBe("choice");
    expect(scene.ownedReplies.every((n) => n === 0)).toBe(true);
    expect(run.ctx.input.mouseX).toBe(0xa0);
    await clickZone(run, 7);
    await confirm(run, scene, true);
    expect(await run.finish()).toEqual({ kind: "magician", choice: 7 });
  }, 240_000);

  it("temps de partie écoulé pendant le choix : fin sans échange, sans voix ni confirmation", async () => {
    const run = await launch({}, { setup: (game) => {
      setupPlayer()(game);
      // Le chrono de partie compte aussi les vidéos : il reste de quoi atteindre l'écran de choix, pas de quoi y rester.
      game.state.elapsed = game.state.durationSeconds - 30;
    } });
    const scene = run.scene as MagicianScene;
    await reachChoice(run, scene);
    expect(scene.stage).not.toBe("done");
    await run.until(() => scene.chosen === CHOICE_TIME_UP, 60_000);
    expect(await run.finish()).toEqual({ kind: "magician", choice: null });
  }, 180_000);

  it("graine fixe : mêmes voix tirées, même issue", async () => {
    const play = async () => {
      const run = await launch({ mask: 0 }, { seed: 33 });
      const scene = run.scene as MagicianScene;
      await reachChoice(run, scene);
      await clickZone(run, 0);
      await confirm(run, scene, true);
      return { outcome: await run.finish(), rng: run.ctx.rng.next() };
    };
    const a = await play();
    expect(await play()).toEqual(a);
  }, 240_000);
});

describe.skipIf(!hasOriginalFiles)("S41 Le Magicien : parcours depuis le plateau", () => {
  /** Une partie réelle, le joueur doté, le pion devant la porte du magicien (S41 ne se joue que depuis le plateau). */
  async function enter(points: number, mask: number): Promise<{ s: Session; scene: MagicianScene }> {
    const s = await Session.start({ seed: 11 });
    await s.ready();
    const p = s.game.player;
    p.points = points;
    p.ingredients = mask;
    p.ingredientCount = [...Array(8).keys()].filter((i) => (mask >> i) & 1).length;
    s.place(doorPosition(41));
    await s.tap("Space");
    await s.settle("MagicianScene");
    return { s, scene: s.ctx.scenes.top as MagicianScene };
  }

  it("échange : 3 gouttes contre l'ingrédient demandé, le tour est fini", async () => {
    const { s, scene } = await enter(7, 0b0000_0110);
    expect(scene).toBeInstanceOf(MagicianScene);
    expect(s.game.state.pending).toMatchObject({ scene: 41, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    await reachChoice(s, scene);
    await clickZone(s, 4);
    await confirm(s, scene, true);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.points).toBe(4);
    expect((s.game.player.ingredients >> 4) & 1).toBe(1);
    expect(s.game.player.ingredientCount).toBe(3);
    expect(s.history).toContain("MagicianScene");
  }, 300_000);

  it("chapeau : 3 gouttes sans ingrédient (la règle du code, `iRam38204 == 8`)", async () => {
    const { s, scene } = await enter(5, 0b0000_0110);
    await reachChoice(s, scene);
    await clickZone(s, 8);
    await confirm(s, scene, true);
    await s.ready();
    expect(s.game.player.points).toBe(2);
    expect(s.game.player.ingredients).toBe(0b0000_0110);
  }, 300_000);

  it("Non à la question : rien n'est échangé", async () => {
    const { s, scene } = await enter(5, 0b0000_0110);
    await answerQuestion(s, scene, false);
    await s.ready();
    expect(s.game.player.points).toBe(5);
    expect(s.game.player.ingredients).toBe(0b0000_0110);
    expect(s.game.state.phase).toBe("turn");
  }, 300_000);

  it("moins de 3 gouttes : refus, rien n'est échangé", async () => {
    const { s, scene } = await enter(2, 0b0000_0110);
    expect(scene.branch).toBe("refusal");
    await playUntil(s, scene, () => scene.stage === "done");
    await s.ready();
    expect(s.game.player.points).toBe(2);
    expect(s.game.state.phase).toBe("turn");
  }, 300_000);
});
