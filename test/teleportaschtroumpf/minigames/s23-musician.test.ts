import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  GAME_LIMIT_SECONDS,
  INSTRUMENT_KEYS,
  INSTRUMENT_POSITIONS,
  LISTEN_LIMIT_SECONDS,
  MusicianScene,
  RIGHT_SOUNDS,
  WRONG_SOUNDS,
  createMusician,
  goalLength,
  instrumentAt,
  pointsFor,
  rollNote,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s23-musician";
import type { TestHost } from "../engine-test-host";
import { hasOriginalFiles } from "../helpers";
import { longPress, swipe, tap } from "../touch";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S23 : règles du musicien (pur, `24d0:000c`)", () => {
  it("longueur à reproduire : 5, 6, 7 selon le niveau, 4 avec l'indice de l'oiseau (niveau 0)", () => {
    expect([0, 1, 2].map((level) => goalLength(level, false))).toEqual([5, 6, 7]);
    expect(goalLength(0, true)).toBe(4);
  });

  it("gouttes de rosée : goal − 2 notes → 1, goal − 1 → 2, goal → 3 ; moins, ou une erreur → 0", () => {
    expect([2, 3, 4, 5].map((score) => pointsFor(score, 5, false))).toEqual([0, 1, 2, 3]);
    expect([0, 1].map((score) => pointsFor(score, 5, false))).toEqual([0, 0]);
    expect(pointsFor(5, 5, true)).toBe(0);
    expect([4, 5, 6, 7].map((score) => pointsFor(score, 7, false))).toEqual([0, 1, 2, 3]);
  });

  it("niveau 0 : notes libres ; niveau 1 : jamais trois fois la même de suite ; niveau 2 : jamais deux fois la même de suite", () => {
    const build = (level: number, seed: number) => {
      const rng = new BorlandRandom(seed);
      const melody: number[] = [];
      for (let i = 0; i < 400; i++) melody.push(rollNote(rng, level, melody));
      return melody;
    };
    const repeats = (melody: number[], run: number) => melody.some((_, i) => i >= run - 1 && melody.slice(i - run + 1, i + 1).every((n) => n === melody[i]));
    for (const seed of [1, 2, 3]) {
      const free = build(0, seed);
      expect(free.every((n) => n >= 0 && n < 4)).toBe(true);
      expect(repeats(free, 2)).toBe(true);
      expect(repeats(free, 3)).toBe(true);
      const l1 = build(1, seed);
      expect(repeats(l1, 3)).toBe(false);
      expect(repeats(l1, 2)).toBe(true);
      expect(repeats(build(2, seed), 2)).toBe(false);
    }
  });

  it("le tirage consomme un nombre par note aux niveaux 0, et pour les premières notes du niveau 1 (graine fixe)", () => {
    const a = new BorlandRandom(5);
    const b = new BorlandRandom(5);
    const melody: number[] = [];
    for (let i = 0; i < 2; i++) melody.push(rollNote(a, 1, melody));
    expect(melody).toEqual([b.below(4), b.below(4)]);
  });

  it("quatre instruments, une touche et deux sons chacun", () => {
    expect(INSTRUMENT_POSITIONS).toHaveLength(4);
    expect(INSTRUMENT_KEYS).toEqual(["left", "up", "right", "down"]);
    expect(new Set([...RIGHT_SOUNDS, ...WRONG_SOUNDS]).size).toBe(8);
  });

  it("doigt : le musicien touché est celui dont la zone contient le point ; dans un chevauchement, le centre le plus proche l'emporte", () => {
    const areas = [
      { x0: 0, y0: 0, x1: 100, y1: 100 },
      { x0: 90, y0: 0, x1: 200, y1: 100 },
    ];
    expect(instrumentAt(areas, 10, 50)).toBe(0);
    expect(instrumentAt(areas, 150, 50)).toBe(1);
    expect(instrumentAt(areas, 92, 50)).toBe(0);
    expect(instrumentAt(areas, 99, 50)).toBe(1);
    expect(instrumentAt(areas, 250, 50)).toBeNull();
    expect(instrumentAt(areas, 50, 150)).toBeNull();
  });

  it("la requête est exigée : sans Game.openMinigame(23) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createMusician(game, () => undefined)).toThrow(/openMinigame\(23\)/);
    game.openMinigame(22);
    expect(() => createMusician(game, () => undefined)).toThrow(/openMinigame\(23\)/);
  });
});

const CODES = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];

interface BotOptions {
  /** Ticks d'attente avant chaque touche (le joueur réfléchit). */
  delay?: number;
  /** Instrument réellement joué quand `expected` est attendu. */
  pick?(expected: number, scene: MusicianScene): number;
  /** Touche utilisée pour un instrument (défaut : les flèches). */
  codes?: readonly string[];
  /** Joue au doigt : touche le centre du musicien au lieu d'appuyer sur sa flèche. */
  touch?: boolean;
}

/** Centre de la zone touchable d'un musicien. */
function center(scene: MusicianScene, instrument: number): [number, number] {
  const a = scene.touchAreas[instrument];
  return [Math.round((a.x0 + a.x1) / 2), Math.round((a.y0 + a.y1) / 2)];
}

/** Pilote : une touche (tenue 3 ticks) par note attendue, après `delay` ticks d'écoute. Appelé une fois par image (≈ 1 tick). */
function bot(scene: MusicianScene, host: TestHost, options: BotOptions = {}) {
  const codes = options.codes ?? CODES;
  let down: string | null = null;
  let downFrames = 0;
  let waited = -1;
  return () => {
    if (down && ++downFrames >= 3) {
      host.input.keyUp(down);
      down = null;
    }
    if (scene.stage !== "listen") {
      waited = -1;
      return;
    }
    if (down) return;
    waited++;
    if (waited < (options.delay ?? 0)) return;
    const expected = scene.sequence[scene.progress];
    const instrument = options.pick ? options.pick(expected, scene) : expected;
    waited = -1;
    if (options.touch) {
      tap(host.input, ...center(scene, instrument));
      return;
    }
    down = codes[instrument];
    downFrames = 0;
    host.input.keyDown(down);
  };
}

const finished = (scene: MusicianScene) => scene.stage === "fadeOut" || scene.stage === "result" || scene.stage === "done";

/** Joue le pilote jusqu'à la fin de la partie (avant la vidéo de fin). */
async function play(run: LaunchedMinigame, options: BotOptions = {}): Promise<void> {
  const scene = run.scene as MusicianScene;
  const act = bot(scene, run.host, options);
  await run.until(() => {
    act();
    return finished(scene);
  }, 300_000);
}

describe.skipIf(!hasOriginalFiles)("S23 Le Schtroumpf Musicien : manches, notes, délais", () => {
  /** Lance la scène, saute la vidéo d'introduction et attend la première manche. */
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(23, options);
    await run.until(() => !run.ctx.fade.active);
    await run.tap("Escape");
    return run;
  };

  it("départ : vidéo d'introduction s23d (passable), puis décor, fondu, 2 s, une première note", async () => {
    const run = await launchMinigame(23, { seed: 3 });
    const scene = run.scene as MusicianScene;
    expect(scene.stage).toBe("intro");
    expect(run.host.loaded.some((f) => /S23D\.MUX/i.test(f))).toBe(true);
    await run.until(() => !run.ctx.fade.active);
    await run.run(600);
    expect(scene.stage).toBe("intro");
    await run.tap("Escape");
    expect(scene.stage).toBe("settle");
    expect(scene.sequence).toEqual([]);
    expect(scene.internalLevel).toBe(0);
    expect(scene.goalNotes).toBe(5);
    run.shot("s23-decor");
    await run.run(1000);
    expect(scene.sequence).toEqual([]);
    await run.until(() => scene.stage === "demo", 5000);
    expect(scene.sequence).toHaveLength(1);
    expect(scene.gameSeconds).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("graine fixe : même mélodie ; des graines différentes la font varier", async () => {
    const first = async (seed: number) => {
      const run = await launch({ seed });
      const scene = run.scene as MusicianScene;
      const act = bot(scene, run.host);
      await run.until(() => {
        act();
        return scene.sequence.length >= 3;
      }, 120_000);
      return [...scene.sequence];
    };
    const a = await first(21);
    expect(await first(21)).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) seen.add((await first(seed)).join(""));
    expect(seen.size).toBeGreaterThan(1);
  }, 120_000);

  it("la mélodie s'allonge d'une note par manche, rejouée depuis le début, avec l'animation de chaque instrument", async () => {
    const run = await launch({ seed: 4, audio: true });
    const scene = run.scene as MusicianScene;
    const act = bot(scene, run.host);
    const rightSounds = await Promise.all(RIGHT_SOUNDS.map((name) => run.ctx.resources.voc(name)));
    const lengths: number[] = [];
    const animated = new Set<number>();
    await run.until(() => {
      act();
      if (scene.animated !== null) animated.add(scene.animated);
      if (lengths.at(-1) !== scene.sequence.length) lengths.push(scene.sequence.length);
      return scene.sequence.length >= 4 && scene.stage === "listen";
    }, 120_000);
    expect(lengths).toEqual([0, 1, 2, 3, 4]);
    // La démonstration de la manche 4 a joué ses quatre notes dans l'ordre, au-dessus des sons des manches précédentes.
    const demo = run.host.audio.plays.map((p) => rightSounds.findIndex((s) => s.samples === p.sound.samples));
    const lastRound = demo.slice(-4);
    expect(lastRound).toEqual([...scene.sequence]);
    expect(animated.size).toBeGreaterThan(0);
    run.shot("s23-ecoute");
  }, 120_000);

  it("l'animation d'une note dure 7 images de 5 ticks, puis on attend la fin du son", async () => {
    const run = await launch({ seed: 4, audio: true });
    const scene = run.scene as MusicianScene;
    await run.until(() => scene.stage === "demo", 10_000);
    const start = run.ctx.clock.ticks;
    const frames = new Set<string>();
    let shot = false;
    await run.until(() => {
      const index = Math.floor((run.ctx.clock.ticks - start) / 5);
      frames.add(`${scene.animated}@${index}`);
      if (!shot && index === 3) {
        run.shot("s23-demo-note");
        shot = true;
      }
      return scene.stage === "gap" || scene.stage === "listen";
    }, 10_000);
    const instrument = scene.sequence[0];
    expect(frames.has(`${instrument}@0`)).toBe(true);
    expect(frames.has(`${instrument}@6`)).toBe(true);
    run.shot("s23-demo");
  }, 60_000);

  it("une mélodie reproduite en entier ajoute une note ; cinq notes reproduites : 3 gouttes, vidéo s23c, l'issue est appliquée", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    await play(run);
    expect(scene.hasFailed).toBe(false);
    expect(scene.score).toBe(5);
    expect(scene.sequence).toHaveLength(5);
    run.shot("s23-fin-reussite");
    const outcome = await run.finish(120_000);
    expect(outcome).toEqual({ kind: "points", points: 3 });
    expect(run.host.loaded.some((f) => /S23C\.MUX/i.test(f))).toBe(true);
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(3);
  }, 180_000);

  it.each([
    [0, 5],
    [1, 6],
    [2, 7],
  ])("niveau %i : %i notes à reproduire, 3 gouttes pour une partie parfaite", async (level, goal) => {
    const run = await launch({ seed: 9, level });
    const scene = run.scene as MusicianScene;
    expect(scene.internalLevel).toBe(level);
    expect(scene.goalNotes).toBe(goal);
    await play(run);
    expect(scene.score).toBe(goal);
    expect(await run.finish(120_000)).toEqual({ kind: "points", points: 3 });
  }, 240_000);

  it("une note fausse : son d'erreur de l'instrument pressé, 0 goutte, vidéo s23b, même après plusieurs manches réussies", async () => {
    const run = await launch({ seed: 7, audio: true });
    const scene = run.scene as MusicianScene;
    const wrongSounds = await Promise.all(WRONG_SOUNDS.map((name) => run.ctx.resources.voc(name)));
    // Parfait jusqu'à la manche 4, puis une erreur à la deuxième note.
    await play(run, { pick: (expected, s) => (s.sequence.length === 4 && s.progress === 1 ? (expected + 1) % 4 : expected) });
    expect(scene.hasFailed).toBe(true);
    expect(scene.score).toBe(3);
    const played = run.host.audio.plays.at(-1)!;
    expect(wrongSounds.some((s) => s.samples === played.sound.samples)).toBe(true);
    run.shot("s23-erreur");
    const outcome = await run.finish(120_000);
    expect(outcome).toEqual({ kind: "points", points: 0 });
    expect(run.host.loaded.some((f) => /S23B\.MUX/i.test(f))).toBe(true);
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(0);
  }, 240_000);

  it("le son d'erreur est celui de l'instrument pressé, pas de l'attendu", async () => {
    for (const shift of [1, 2, 3]) {
      const run = await launch({ seed: 7 + shift, audio: true });
      const scene = run.scene as MusicianScene;
      const wrongSounds = await Promise.all(WRONG_SOUNDS.map((name) => run.ctx.resources.voc(name)));
      let pressed = -1;
      await play(run, { pick: (expected) => (pressed = (expected + shift) % 4) });
      expect(scene.hasFailed).toBe(true);
      expect(scene.lastNote).toBe("wrong");
      expect(run.host.audio.plays.at(-1)!.sound.samples).toEqual(wrongSounds[pressed].samples);
    }
  }, 240_000);

  it("10 s sans reproduire la mélodie : échec (0 goutte), la partie s'arrête", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    await run.until(() => scene.stage === "listen", 20_000);
    const start = scene.listenSeconds;
    expect(start).toBe(0);
    await run.until(() => scene.stage === "fadeOut", 20_000);
    expect(scene.listenSeconds).toBe(LISTEN_LIMIT_SECONDS);
    expect(scene.hasFailed).toBe(true);
    expect(await run.finish(120_000)).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("le délai de 10 s court pour toute la mélodie, pas pour chaque note", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    // Quatre secondes d'hésitation par note : la manche 3 (trois notes) dépasse 10 s, les manches 1 et 2 passent.
    await play(run, { delay: 240 });
    expect(scene.hasFailed).toBe(true);
    expect(scene.score).toBe(2);
    expect(await run.finish(120_000)).toEqual({ kind: "points", points: 0 });
  }, 240_000);

  it("45 s pour toute la partie : à la fin de la manche en cours, sans erreur, le score acquis compte (niveau 2, joueur lent)", async () => {
    const run = await launch({ seed: 9, level: 2 });
    const scene = run.scene as MusicianScene;
    await play(run, { delay: 55 });
    expect(scene.hasFailed).toBe(false);
    expect(scene.gameSeconds).toBeGreaterThanOrEqual(GAME_LIMIT_SECONDS);
    expect(scene.score).toBeGreaterThanOrEqual(5);
    expect(scene.score).toBeLessThan(7);
    const outcome = await run.finish(120_000);
    expect(outcome).toEqual({ kind: "points", points: pointsFor(scene.score, 7, false) });
    expect((outcome as { points: number }).points).toBeGreaterThan(0);
    expect(run.host.loaded.some((f) => /S23C\.MUX/i.test(f))).toBe(true);
  }, 300_000);

  it("temps écoulé avec une mélodie trop courte : échec, vidéo s23b", async () => {
    const run = await launch({ seed: 9, level: 2 });
    const scene = run.scene as MusicianScene;
    await play(run, { delay: 120 });
    expect(scene.score).toBeLessThan(5);
    const outcome = await run.finish(120_000);
    expect(outcome).toEqual({ kind: "points", points: 0 });
    expect(run.host.loaded.some((f) => /S23B\.MUX/i.test(f))).toBe(true);
  }, 300_000);

  it("indice de l'oiseau : niveau 0 et 4 notes (3 gouttes dès la 4e), l'indice est consommé", async () => {
    const run = await launch({ seed: 9, level: 2, bonus: true });
    const scene = run.scene as MusicianScene;
    expect(run.game.state.pending).toMatchObject({ scene: 23, level: 2, bonus: true });
    expect(run.game.state.bonusTag).toBe(0);
    expect(scene.internalLevel).toBe(0);
    expect(scene.goalNotes).toBe(4);
    await play(run);
    expect(scene.score).toBe(4);
    expect(await run.finish(120_000)).toEqual({ kind: "points", points: 3 });
  }, 240_000);

  it("deux directions à la fois ne désignent aucun instrument ; les touches Z, Q, X, A valent gauche, haut, droite, bas", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    await run.until(() => scene.stage === "listen", 20_000);
    const expected = scene.sequence[0];
    run.host.input.keyDown("ArrowLeft");
    run.host.input.keyDown("ArrowDown");
    await run.run(200);
    run.host.input.keyUp("ArrowLeft");
    run.host.input.keyUp("ArrowDown");
    expect(scene.stage).toBe("listen");
    expect(scene.progress).toBe(0);
    await play(run, { codes: ["KeyZ", "KeyQ", "KeyX", "KeyA"] });
    expect(scene.hasFailed).toBe(false);
    expect(expected).toBeGreaterThanOrEqual(0);
    expect(scene.score).toBe(5);
  }, 240_000);

  it("une flèche tenue ne rejoue pas la note suivante (attente du relâchement, 5 s au plus)", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    await run.until(() => scene.stage === "listen", 20_000);
    run.host.input.keyDown(CODES[scene.sequence[0]]);
    await run.run(3000);
    expect(scene.stage).toBe("release");
    run.host.input.keyUp(CODES[scene.sequence[0]]);
    await run.run(300);
    expect(scene.stage).not.toBe("release");
  }, 60_000);

  it("la vidéo de fin se passe avec Échap", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    await play(run);
    await run.until(() => scene.stage === "result", 30_000);
    await run.run(800);
    expect(run.outcome).toBeUndefined();
    await run.tap("Escape");
    expect(await run.finish(5000)).toMatchObject({ kind: "points" });
  }, 240_000);
});

describe.skipIf(!hasOriginalFiles)("S23 Le Schtroumpf Musicien : au doigt (ajout du port)", () => {
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(23, options);
    await run.until(() => !run.ctx.fade.active);
    await run.tap("Escape");
    return run;
  };

  it("les quatre zones entourent les musiciens au repos (cymbales, guitare, tambour, trompette)", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    const areas = scene.touchAreas;
    expect(areas).toHaveLength(4);
    // Chaque centre désigne son musicien ; le guitariste est en haut, le trompettiste en bas, les cymbales à gauche, le tambour à droite.
    for (let i = 0; i < 4; i++) expect(instrumentAt(areas, ...center(scene, i))).toBe(i);
    const [left, up, right, down] = [0, 1, 2, 3].map((i) => center(scene, i));
    expect(left[0]).toBeLessThan(right[0]);
    expect(up[1]).toBeLessThan(down[1]);
  }, 60_000);

  it("toucher le Schtroumpf qui doit jouer reproduit la mélodie : cinq notes, 3 gouttes", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    await play(run, { touch: true });
    expect(scene.hasFailed).toBe(false);
    expect(scene.score).toBe(5);
    expect(await run.finish(120_000)).toEqual({ kind: "points", points: 3 });
  }, 180_000);

  it("toucher un autre musicien : son d'erreur de celui qui est touché, comme sa flèche", async () => {
    const run = await launch({ seed: 8, audio: true });
    const scene = run.scene as MusicianScene;
    const wrongSounds = await Promise.all(WRONG_SOUNDS.map((name) => run.ctx.resources.voc(name)));
    let touched = -1;
    await play(run, { touch: true, pick: (expected) => (touched = (expected + 1) % 4) });
    expect(scene.hasFailed).toBe(true);
    expect(scene.lastNote).toBe("wrong");
    expect(run.host.audio.plays.at(-1)!.sound.samples).toEqual(wrongSounds[touched].samples);
  }, 120_000);

  it("toucher hors des musiciens, un appui long ou un glissement sur un musicien ne jouent rien", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as MusicianScene;
    await run.until(() => scene.stage === "listen", 20_000);
    const [x, y] = center(scene, scene.sequence[0]);
    for (const act of [
      () => tap(run.host.input, 4, 4),
      () => tap(run.host.input, 300, 190),
      () => longPress(run.host.input, x, y),
      () => swipe(run.host.input, x, y, 30, 0),
    ]) {
      act();
      await run.run(100);
      expect(scene.stage).toBe("listen");
      expect(scene.progress).toBe(0);
      expect(scene.hasFailed).toBe(false);
    }
    tap(run.host.input, x, y);
    await run.run(50);
    expect(scene.lastNote).toBe("right");
    expect(scene.progress).toBe(1);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S23 Le Schtroumpf Musicien : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de la scène 23 : partie réussie → les gouttes sont ajoutées, le tour est fini", async () => {
    const s = await enterFromBoard(23, "MusicianScene", { seed: 11 });
    const scene = s.ctx.scenes.top as MusicianScene;
    expect(scene).toBeInstanceOf(MusicianScene);
    expect(s.game.state.pending).toMatchObject({ scene: 23, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    const before = s.game.player.points;
    await s.tap("Escape");
    const act = bot(scene, s.host);
    while (!finished(scene)) {
      act();
      await s.run(16);
    }
    expect(scene.hasFailed).toBe(false);
    await s.until(() => scene.stage === "result", 30_000);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.points).toBe(before + 3);
    expect(s.history).toContain("MusicianScene");
  }, 240_000);

  it("plateau : erreur → rien n'est gagné", async () => {
    const s = await enterFromBoard(23, "MusicianScene", { seed: 11 });
    const scene = s.ctx.scenes.top as MusicianScene;
    const before = s.game.player.points;
    await s.tap("Escape");
    const act = bot(scene, s.host, { pick: (expected) => (expected + 1) % 4 });
    while (!finished(scene)) {
      act();
      await s.run(16);
    }
    expect(scene.hasFailed).toBe(true);
    await s.until(() => scene.stage === "result", 30_000);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.points).toBe(before);
  }, 240_000);

  it("mode libre : la partie se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(23, { seed: 5 });
    const scene = run.scene as MusicianScene;
    expect(scene).toBeInstanceOf(MusicianScene);
    expect(run.game.state.pending).toMatchObject({ scene: 23 });
    await run.tap("Escape");
    const act = bot(scene, run.host);
    while (!finished(scene)) {
      act();
      await run.run(16);
    }
    await run.until(() => scene.stage === "result", 30_000);
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.currentGame).toBeNull();
  }, 240_000);
});
