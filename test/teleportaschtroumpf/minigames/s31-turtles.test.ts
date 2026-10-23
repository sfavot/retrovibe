import { describe, expect, it } from "vitest";
import { parseHy8 } from "../../../src/games/teleportaschtroumpf/data/hy8";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { TURTLES_LOSE_CLIP, TurtlesScene, createTurtles, turtlesWinClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s31-turtles";
import {
  FrameCycle,
  GOAL,
  HOP_DX,
  HOP_DY,
  LANDING_TOLERANCE,
  LEVELS,
  SMURF_FALLING,
  SMURF_FRAMES,
  SMURF_HOP_BACK,
  SMURF_HOP_FORWARD,
  SMURF_HOP_IN_PLACE,
  SMURF_IDLE,
  START_MIN_GAP,
  Smurf,
  TURTLE_FRAMES,
  TURTLE_SPECS,
  Turtle,
  placeTurtles,
  type SmurfKeys,
  type TurtlePhase,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s31/turtles";
import { hasOriginalFiles, listData, readData } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

const INGREDIENT = 5;
const NO_KEYS: SmurfKeys = { up: false, down: false, click: false };

describe("S31 : compteur d'images (`12d7:00c1`)", () => {
  it("rend l'image montrée, avance, et revient à 0 quand l'animation vient de finir", () => {
    const cycle = new FrameCycle(3);
    expect([cycle.next(), cycle.counter]).toEqual([0, 1]);
    expect([cycle.next(), cycle.counter]).toEqual([1, 2]);
    expect([cycle.next(), cycle.counter]).toEqual([2, 0]);
    expect(cycle.next()).toBe(0);
  });
});

describe("S31 : une tortue (pur, `2f87:0950`)", () => {
  /** Phases visitées par une tortue lente, avec la durée de chacune en itérations. */
  function cycle(turtle: Turtle, steps: number): [TurtlePhase, number][] {
    const out: [TurtlePhase, number][] = [];
    for (let i = 0; i < steps; i++) {
      const phase = turtle.phase;
      turtle.step();
      if (out.at(-1)?.[0] === phase) out.at(-1)![1]++;
      else out.push([phase, 1]);
    }
    return out;
  }

  it("cycle complet : plongée à droite (6), départ (7), nage à gauche (43), plongée à gauche (6), départ (7), nage à droite (43)", () => {
    const turtle = new Turtle(TURTLE_SPECS[2], 0, 0, false);
    const phases = cycle(turtle, 150);
    expect(phases.slice(0, 7)).toEqual([
      ["glideRight", 1],
      ["diveRight", 6],
      ["leaveRight", 7],
      ["glideLeft", 43],
      ["diveLeft", 6],
      ["leaveLeft", 7],
      ["glideRight", 43],
    ]);
    // Le cycle recommence : plongée à droite de nouveau, de la même durée.
    expect(phases[7]).toEqual(["diveRight", 6]);
  });

  it("les extrémités sont atteintes exactement : la tortue est calée sur la rive ou sur le bout gauche", () => {
    const turtle = new Turtle(TURTLE_SPECS[4], 0, 1, false);
    for (let i = 0; i < 400; i++) {
      turtle.step();
      if (turtle.phase === "diveLeft") expect([turtle.x, turtle.y]).toEqual([...TURTLE_SPECS[4].left]);
      if (turtle.phase === "diveRight") expect([turtle.x, turtle.y]).toEqual([...TURTLE_SPECS[4].home]);
    }
  });

  it("la rapide va deux fois plus vite (6, 2) et suit la même pente de 3 pour 1", () => {
    const slow = new Turtle(TURTLE_SPECS[0], 10, 0, true);
    const fast = new Turtle(TURTLE_SPECS[0], 10, 1, true);
    slow.step();
    fast.step();
    expect([slow.x - (0xbc - 30), slow.y - (0x9f - 10)]).toEqual([-3, -1]);
    expect([fast.x - (0xbc - 30), fast.y - (0x9f - 10)]).toEqual([-6, -2]);
    for (const spec of TURTLE_SPECS) expect((spec.home[0] - spec.left[0]) / (spec.home[1] - spec.left[1])).toBe(3);
  });

  it("sous l'eau : pendant les images 4 et 5 de la plongée (compteur > 3), à droite comme à gauche", () => {
    for (const [dive, leftFirst] of [
      ["diveRight", false],
      ["diveLeft", true],
    ] as const) {
      const turtle = new Turtle(TURTLE_SPECS[1], 0, 0, leftFirst);
      while (turtle.phase !== dive) turtle.step();
      const samples: boolean[] = [];
      while (turtle.phase === dive) {
        turtle.step();
        if (turtle.phase === dive) samples.push(turtle.submerged);
      }
      expect(samples).toEqual([false, false, false, true, true]);
    }
  });

  it("jamais sous l'eau hors des plongées", () => {
    const turtle = new Turtle(TURTLE_SPECS[3], 5, 0, false);
    for (let i = 0; i < 300; i++) {
      turtle.step();
      if (turtle.phase !== "diveLeft" && turtle.phase !== "diveRight") expect(turtle.submerged).toBe(false);
    }
  });
});

describe("S31 : placement des tortues (pur, `2f87:0008`)", () => {
  it("décalage 0..29, à 15 au moins du précédent (la première contre 0), vitesse et sens tirés ensuite", () => {
    for (const seed of [1, 2, 3, 4, 5, 77]) {
      const turtles = placeTurtles(new BorlandRandom(seed), false);
      expect(turtles).toHaveLength(5);
      let previous = 0;
      turtles.forEach((t, i) => {
        const offset = (TURTLE_SPECS[i].home[0] - t.x) / 3;
        expect(Number.isInteger(offset)).toBe(true);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(30);
        expect(Math.abs(offset - previous)).toBeGreaterThanOrEqual(START_MIN_GAP);
        expect(TURTLE_SPECS[i].home[1] - t.y).toBe(offset);
        expect(["glideLeft", "glideRight"]).toContain(t.phase);
        previous = offset;
      });
    }
  });

  it("avec l'indice de l'oiseau : toutes lentes, mais le même nombre de tirages", () => {
    const fastSeen = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const a = new BorlandRandom(seed);
      const b = new BorlandRandom(seed);
      const normal = placeTurtles(a, false);
      const slow = placeTurtles(b, true);
      expect(slow.every((t) => t.speed === 0)).toBe(true);
      for (const t of normal) fastSeen.add(t.speed);
      expect(a.next()).toBe(b.next());
      // Hors vitesse, le placement est identique.
      expect(slow.map((t) => [t.x, t.y, t.phase])).toEqual(normal.map((t) => [t.x, t.y, t.phase]));
    }
    expect([...fastSeen].sort()).toEqual([0, 1]);
  });
});

describe("S31 : le Schtroumpf (pur, `2f87:0656`)", () => {
  const level = LEVELS[0];

  /** Cinq tortues posées pour que le Schtroumpf puisse sauter dessus : la tortue visée est sous le point d'atterrissage. */
  function river(): Turtle[] {
    return TURTLE_SPECS.map((spec) => new Turtle(spec, 5, 0, true));
  }

  /** Joue des itérations (les tortues avancent aussi) jusqu'à ce que `until` soit vrai. */
  function run(smurf: Smurf, turtles: Turtle[], keys: SmurfKeys, until: () => boolean, limit = 200) {
    let last = smurf.step(keys, turtles);
    for (let i = 0; i < limit && !until(); i++) {
      for (const t of turtles) t.step();
      last = smurf.step(NO_KEYS, turtles);
    }
    return last;
  }

  it("départ : au repos sur la case de départ, aux positions des trois niveaux", () => {
    expect(LEVELS.map((l) => [l.start, l.x, l.y])).toEqual([
      [1, 0x84, 0x70],
      [0, 0x68, 0x88],
      [-1, 0x4c, 0xa0],
    ]);
    const smurf = new Smurf(LEVELS[2]);
    expect(smurf.current).toBe(-1);
    expect(smurf.state).toBe(SMURF_IDLE);
    const result = smurf.step(NO_KEYS, river());
    expect(result).toMatchObject({ won: false, lost: false, sound: undefined });
    expect(result.draw).toMatchObject({ animation: 0, x: 0x4c, y: 0xa0 });
  });

  it("saut en avant : 6 images, puis la case suivante et un décalage de (+31, −27) ; le bruit de saut est demandé", () => {
    const turtles = river();
    const smurf = new Smurf(level);
    // La tortue 2 est mise sous le point d'atterrissage.
    turtles[2].x = level.x + HOP_DX;
    turtles[2].y = level.y - HOP_DY;
    const first = smurf.step({ ...NO_KEYS, up: true }, turtles);
    expect(first.sound).toBe("jump");
    expect(smurf.state).toBe(SMURF_HOP_FORWARD);
    expect(first.draw.animation).toBe(1);
    let frames = 1;
    while (smurf.state === SMURF_HOP_FORWARD) {
      smurf.step(NO_KEYS, turtles);
      frames++;
    }
    expect(frames).toBe(SMURF_FRAMES[1]);
    expect(smurf.current).toBe(2);
    expect([smurf.x, smurf.y]).toEqual([level.x + HOP_DX, level.y - HOP_DY]);
    // Posé sur la tortue : il la suit.
    turtles[2].x -= 3;
    smurf.step(NO_KEYS, turtles);
    expect(smurf.x).toBe(turtles[2].x);
    expect(smurf.y).toBe(turtles[2].y);
    expect(smurf.state).toBe(SMURF_IDLE);
  });

  it("saut en arrière : seulement hors de la case de départ ; saut sur place : ne change rien", () => {
    const turtles = river();
    const smurf = new Smurf(level);
    expect(smurf.step({ ...NO_KEYS, down: true }, turtles).sound).toBeUndefined();
    expect(smurf.state).toBe(SMURF_IDLE);
    expect(smurf.step({ ...NO_KEYS, click: true }, turtles).sound).toBe("jump");
    expect(smurf.state).toBe(SMURF_HOP_IN_PLACE);
    run(smurf, turtles, NO_KEYS, () => smurf.state === SMURF_IDLE);
    expect(smurf.current).toBe(level.start);
    expect([smurf.x, smurf.y]).toEqual([level.x, level.y]);
    // Avance sur la tortue 2 puis revient.
    turtles[2].x = level.x + HOP_DX;
    run(smurf, turtles, { ...NO_KEYS, up: true }, () => smurf.current === 2 && smurf.state === SMURF_IDLE);
    expect(smurf.current).toBe(2);
    expect(smurf.step({ ...NO_KEYS, down: true }, turtles).sound).toBe("jump");
    expect(smurf.state).toBe(SMURF_HOP_BACK);
    run(smurf, turtles, NO_KEYS, () => smurf.state === SMURF_IDLE);
    expect(smurf.current).toBe(level.start);
  });

  it("atterrir à plus de 20 pixels de la tortue : chute de 16 images, puis perdu ; le bruit de plouf est demandé", () => {
    const turtles = river();
    const smurf = new Smurf(level);
    turtles[2].x = level.x + HOP_DX + LANDING_TOLERANCE + 1;
    run(smurf, turtles, { ...NO_KEYS, up: true }, () => smurf.current === 2);
    // Pas de déplacement de la tortue pendant ce test : on la remet.
    turtles[2].x = level.x + HOP_DX + LANDING_TOLERANCE + 1;
    const fall = smurf.step(NO_KEYS, turtles);
    expect(fall.sound).toBe("splash");
    expect(smurf.state).toBe(SMURF_FALLING);
    let frames = 1;
    let result = fall;
    while (!result.lost && frames < 40) {
      result = smurf.step(NO_KEYS, turtles);
      frames++;
    }
    expect(frames).toBe(SMURF_FRAMES[4]);
    expect(result.lost).toBe(true);
  });

  it("exactement à 20 pixels : sauf ; à 21 : à l'eau", () => {
    for (const [gap, falls] of [
      [LANDING_TOLERANCE, false],
      [-LANDING_TOLERANCE, false],
      [LANDING_TOLERANCE + 1, true],
      [-(LANDING_TOLERANCE + 1), true],
    ] as const) {
      const turtles = river();
      const smurf = new Smurf(level);
      smurf.current = 2;
      smurf.x = 100;
      smurf.y = 80;
      turtles[2].x = 100 + gap;
      smurf.step(NO_KEYS, turtles);
      expect(smurf.state === SMURF_FALLING).toBe(falls);
    }
  });

  it("sur une tortue qui plonge : à l'eau ; la case de départ et l'arrivée sont sûres", () => {
    const turtles = river();
    const smurf = new Smurf(level);
    smurf.current = 3;
    const turtle = turtles[3];
    turtle.phase = "glideLeft";
    // On avance la tortue jusqu'à son bout gauche et sa plongée.
    smurf.x = turtle.x;
    let fell = false;
    for (let i = 0; i < 200 && !fell; i++) {
      turtle.step();
      smurf.step(NO_KEYS, turtles);
      smurf.x = turtle.x;
      if (smurf.state === SMURF_FALLING) fell = true;
      else expect(turtle.submerged).toBe(false);
    }
    expect(fell).toBe(true);
    expect(turtle.phase).toBe("diveLeft");
    expect(turtle.submerged).toBe(true);
    const safe = new Smurf(level);
    safe.step(NO_KEYS, turtles);
    expect(safe.state).toBe(SMURF_IDLE);
  });

  it("l'autre rive : gagné dès que le Schtroumpf y est au repos ; plus de saut en avant", () => {
    const turtles = river();
    const smurf = new Smurf(level);
    smurf.current = GOAL;
    const result = smurf.step({ ...NO_KEYS, up: true }, turtles);
    expect(result.won).toBe(true);
    expect(result.sound).toBeUndefined();
    expect(smurf.state).toBe(SMURF_IDLE);
  });

  it("une touche haut au repos fait sauter, bas puis haut le même tour : c'est le bas qui gagne ; la chute l'emporte sur tout", () => {
    const turtles = river();
    const smurf = new Smurf(level);
    smurf.current = 3;
    smurf.x = turtles[3].x;
    smurf.step({ up: true, down: true, click: true }, turtles);
    expect(smurf.state).toBe(SMURF_HOP_BACK);
    const falling = new Smurf(level);
    falling.current = 3;
    falling.x = turtles[3].x + 99;
    falling.step({ up: true, down: false, click: false }, turtles);
    expect(falling.state).toBe(SMURF_FALLING);
  });
});

describe("S31 : vidéos de fin", () => {
  const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));

  it("réussite : s31c2 si l'ingrédient 5 est dans l'objectif (`1e52:0008(5)` non nul), s31c1 sinon ; échec : s31b", () => {
    game.state.goal.ingredients |= 1 << INGREDIENT;
    expect(turtlesWinClip(game)).toBe("s31c2.mux");
    game.state.goal.ingredients &= ~(1 << INGREDIENT);
    expect(turtlesWinClip(game)).toBe("s31c1.mux");
    expect(TURTLES_LOSE_CLIP).toBe("s31b.mux");
  });

  it("la requête est exigée : sans Game.openMinigame(31) la scène ne se construit pas", () => {
    expect(() => createTurtles(game, () => undefined)).toThrow(/openMinigame\(31\)/);
    game.openMinigame(22);
    expect(() => createTurtles(game, () => undefined)).toThrow(/openMinigame\(31\)/);
  });
});

describe.skipIf(!hasOriginalFiles)("S31 Les Tortues : fichiers", () => {
  it("les nombres d'images des animations sont ceux des HY8", () => {
    const frames = (name: string) => parseHy8(readData(listData((f) => f.toUpperCase() === name)[0])).animations.map((a) => a.frames.length);
    expect(frames("S31A001S.HY8")).toEqual([...TURTLE_FRAMES]);
    expect(frames("S31A000S.HY8")).toEqual([...SMURF_FRAMES]);
  });
});

// --- Pilote : on place les tortues sous le Schtroumpf (le test ne dépend pas du hasard des tortues) -----------

function turtlesScene(run: LaunchedMinigame): TurtlesScene {
  return run.scene as TurtlesScene;
}

/** Pose la prochaine tortue sous le point d'atterrissage du prochain saut. */
function readyNextTurtle(scene: TurtlesScene): void {
  const next = scene.allTurtles[scene.position + 1];
  if (!next) return;
  const { x, y } = scene.coordinates;
  next.x = x + HOP_DX + 10;
  next.y = y - HOP_DY;
  next.phase = "glideLeft";
  next.speed = 0;
}

/** Un saut en avant réussi : la tortue visée est posée, haut est tapé, on attend l'atterrissage. */
async function hopForward(run: LaunchedMinigame): Promise<void> {
  const scene = turtlesScene(run);
  const from = scene.position;
  readyNextTurtle(scene);
  run.host.input.keyDown("ArrowUp");
  await run.run(100);
  run.host.input.keyUp("ArrowUp");
  await run.until(() => scene.position === from + 1 && scene.smurfState === SMURF_IDLE, 5000);
}

async function launch(options: LaunchOptions = {}): Promise<LaunchedMinigame> {
  const run = await launchMinigame(31, { seed: 5, ...options });
  await run.until(() => turtlesScene(run).iterations > 0);
  return run;
}

describe.skipIf(!hasOriginalFiles)("S31 Les Tortues : mise en place", () => {
  it("le niveau du joueur donne le fond, le départ et le nombre de tortues en jeu (3, 4, 5)", async () => {
    for (const level of [0, 1, 2]) {
      const run = await launch({ level });
      const scene = turtlesScene(run);
      expect(scene.internalLevel).toBe(level);
      expect(scene.position).toBe(LEVELS[level].start);
      expect(scene.coordinates).toEqual({ x: LEVELS[level].x, y: LEVELS[level].y });
      expect(scene.allTurtles).toHaveLength(5);
      run.shot(`s31-niveau-${level}`);
    }
  }, 60_000);

  it("l'indice de l'oiseau : niveau 0 quel que soit le joueur, tortues lentes seulement", async () => {
    for (const level of [0, 1, 2]) {
      const run = await launch({ level, bonus: true });
      const scene = turtlesScene(run);
      expect(scene.internalLevel).toBe(0);
      expect(scene.hasSlowTurtlesOnly).toBe(true);
      expect(scene.allTurtles.every((t) => t.speed === 0)).toBe(true);
    }
    const normal = turtlesScene(await launch({ level: 2 }));
    expect(normal.hasSlowTurtlesOnly).toBe(false);
  }, 60_000);

  it("graine fixe : mêmes tortues au départ ; les tortues avancent toutes les 5 ticks", async () => {
    const a = turtlesScene(await launch({ seed: 9 }));
    const b = turtlesScene(await launch({ seed: 9 }));
    expect(a.allTurtles.map((t) => [t.x, t.y, t.phase, t.speed])).toEqual(b.allTurtles.map((t) => [t.x, t.y, t.phase, t.speed]));
    const other = turtlesScene(await launch({ seed: 10 }));
    expect(other.allTurtles.map((t) => [t.x, t.y])).not.toEqual(a.allTurtles.map((t) => [t.x, t.y]));
  }, 60_000);

  it("la boucle tourne à 12 itérations par seconde", async () => {
    const run = await launch();
    const scene = turtlesScene(run);
    const before = scene.iterations;
    await run.run(2000);
    expect(scene.iterations - before).toBeGreaterThanOrEqual(23);
    expect(scene.iterations - before).toBeLessThanOrEqual(25);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S31 Les Tortues : commandes", () => {
  it("haut : saut en avant d'une case avec le bruit de saut ; bas : retour ; Espace : saut sur place", async () => {
    const run = await launch({ audio: true });
    const scene = turtlesScene(run);
    const jump = await run.ctx.resources.voc("s31a002b.voc");
    await hopForward(run);
    expect(scene.position).toBe(LEVELS[0].start + 1);
    run.shot("s31-sur-tortue");
    expect(run.host.audio.effects.some((p) => p.sound.samples === jump.samples)).toBe(true);
    run.host.input.keyDown("ArrowDown");
    await run.run(100);
    run.host.input.keyUp("ArrowDown");
    await run.until(() => scene.position === LEVELS[0].start && scene.smurfState === SMURF_IDLE, 5000);
    await run.tap("Space", 100);
    expect(scene.smurfState === SMURF_HOP_IN_PLACE || scene.smurfState === SMURF_IDLE).toBe(true);
    await run.until(() => scene.smurfState === SMURF_IDLE, 3000);
    expect(scene.position).toBe(LEVELS[0].start);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S31 Les Tortues : issue", () => {
  it("réussite : l'autre rive est atteinte → vidéo s31c1 (ingrédient hors objectif), ingrédient 5 donné, pas de limite de temps", async () => {
    const run = await launch({ setup: (g) => (g.state.goal.ingredients &= ~(1 << INGREDIENT)) });
    const scene = turtlesScene(run);
    await run.run(60_000);
    expect(scene.stage).toBe("play");
    for (let i = 0; i < 4; i++) await hopForward(run);
    expect(scene.position).toBe(GOAL);
    run.shot("s31-arrivee");
    await run.until(() => scene.hasWon);
    expect(run.outcome).toBeUndefined();
    await run.until(() => scene.stage === "video", 60_000);
    expect(scene.clipFile).toBe("s31c1.mux");
    await run.run(1500);
    run.shot("s31-video-reussite");
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "ingredient", success: true });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients & (1 << INGREDIENT)).not.toBe(0);
    expect(run.game.player.ingredientCount).toBe(1);
  }, 120_000);

  it("réussite avec l'ingrédient 5 dans l'objectif : vidéo s31c2", async () => {
    const run = await launch({ setup: (g) => (g.state.goal.ingredients |= 1 << INGREDIENT) });
    const scene = turtlesScene(run);
    for (let i = 0; i < 4; i++) await hopForward(run);
    await run.until(() => scene.stage === "video", 60_000);
    expect(scene.clipFile).toBe("s31c2.mux");
    expect(await run.finish()).toEqual({ kind: "ingredient", success: true });
  }, 120_000);

  it("niveau 2 : cinq tortues à passer, six sauts depuis la rive", async () => {
    const run = await launch({ level: 2 });
    const scene = turtlesScene(run);
    expect(scene.position).toBe(-1);
    for (let i = 0; i < 6; i++) await hopForward(run);
    expect(scene.position).toBe(GOAL);
    await run.until(() => scene.hasWon);
    expect(await run.finish()).toEqual({ kind: "ingredient", success: true });
  }, 120_000);

  it("échec : le saut atterrit loin des tortues → chute, vidéo s31b, aucun ingrédient", async () => {
    const run = await launch({ audio: true });
    const scene = turtlesScene(run);
    const splash = await run.ctx.resources.voc("s31a003b.voc");
    const next = scene.allTurtles[scene.position + 1];
    next.x = scene.coordinates.x + HOP_DX + 60;
    next.phase = "glideRight";
    next.speed = 0;
    run.host.input.keyDown("ArrowUp");
    await run.run(100);
    run.host.input.keyUp("ArrowUp");
    await run.until(() => scene.smurfState === SMURF_FALLING, 5000);
    expect(run.host.audio.effects.some((p) => p.sound.samples === splash.samples)).toBe(true);
    run.shot("s31-chute-0");
    await run.run(600);
    run.shot("s31-chute-1");
    await run.until(() => scene.hasLost, 5000);
    expect(scene.hasWon).toBe(false);
    await run.until(() => scene.stage === "video", 60_000);
    expect(scene.clipFile).toBe("s31b.mux");
    await run.run(1500);
    run.shot("s31-video-echec");
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "ingredient", success: false });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients).toBe(0);
  }, 120_000);

  it("échec : la tortue plonge sous le Schtroumpf", async () => {
    const run = await launch();
    const scene = turtlesScene(run);
    await hopForward(run);
    const turtle = scene.allTurtles[scene.position];
    // Elle nage vers son bout gauche, où elle plonge : le Schtroumpf qui la suit se noie.
    turtle.phase = "glideLeft";
    await run.until(() => scene.smurfState === SMURF_FALLING, 20_000);
    expect(turtle.phase).toBe("diveLeft");
    await run.until(() => scene.hasLost, 10_000);
    expect(await run.finish()).toEqual({ kind: "ingredient", success: false });
  }, 120_000);

  it("la vidéo de fin se passe (Échap)", async () => {
    const run = await launch();
    const scene = turtlesScene(run);
    for (let i = 0; i < 4; i++) await hopForward(run);
    await run.until(() => scene.stage === "video", 60_000);
    await run.run(500);
    await run.tap("Escape", 120);
    expect(await run.finish(20_000)).toEqual({ kind: "ingredient", success: true });
  }, 120_000);

  it("le fondu sonore de fin baisse le volume puis le rend", async () => {
    const run = await launch({ audio: true });
    const scene = turtlesScene(run);
    const volume = run.ctx.voice.volume;
    for (let i = 0; i < 4; i++) await hopForward(run);
    await run.until(() => scene.stage === "hush", 10_000);
    await run.run(400);
    expect(run.ctx.voice.volume).toBeLessThan(volume);
    await run.until(() => scene.stage === "video", 60_000);
    expect(run.ctx.voice.volume).toBe(volume);
    await run.finish();
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S31 Les Tortues : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de la scène 31 : réussite → l'ingrédient 5 est ajouté, le tour est fini", async () => {
    const s = await enterFromBoard(31, "TurtlesScene", { seed: 11 });
    const scene = s.ctx.scenes.top as TurtlesScene;
    expect(scene).toBeInstanceOf(TurtlesScene);
    expect(s.game.state.pending).toMatchObject({ scene: 31, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    // Le niveau du joueur donne le nombre de sauts (départ −1, 0 ou 1) : on saute jusqu'à l'arrivée.
    while (scene.position < GOAL) {
      const from = scene.position;
      readyNextTurtle(scene);
      s.host.input.keyDown("ArrowUp");
      await s.run(100);
      s.host.input.keyUp("ArrowUp");
      await s.until(() => scene.position === from + 1 && scene.smurfState === SMURF_IDLE, 10_000);
    }
    await s.until(() => scene.stage === "video", 60_000);
    expect(scene.hasWon).toBe(true);
    await s.run(500);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.ingredients & (1 << INGREDIENT)).not.toBe(0);
    expect(s.history).toContain("TurtlesScene");
  }, 180_000);

  it("plateau : chute → rien n'est donné", async () => {
    const s = await enterFromBoard(31, "TurtlesScene", { seed: 11 });
    const scene = s.ctx.scenes.top as TurtlesScene;
    const next = scene.allTurtles[scene.position + 1];
    next.x = scene.coordinates.x + HOP_DX + 80;
    next.phase = "glideRight";
    next.speed = 0;
    s.host.input.keyDown("ArrowUp");
    await s.run(100);
    s.host.input.keyUp("ArrowUp");
    await s.until(() => scene.stage === "video", 60_000);
    await s.run(500);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.ingredients).toBe(0);
  }, 180_000);

  it("mode libre : la partie se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(31, { seed: 5 });
    const scene = turtlesScene(run);
    expect(scene).toBeInstanceOf(TurtlesScene);
    expect(run.game.state.pending).toMatchObject({ scene: 31 });
    await run.until(() => scene.iterations > 0);
    while (scene.position < GOAL) await hopForward(run);
    await run.until(() => scene.stage === "video", 60_000);
    await run.run(500);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);
});
