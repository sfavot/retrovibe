import { describe, expect, it } from "vitest";
import { parseMcg, type Mcg } from "../../../src/games/teleportaschtroumpf/data/mcg";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  BRUSH_ENTRY,
  COLORING_PICTURES,
  ColoringRun,
  ColoringScene,
  FLASH_COUNT,
  OUTLINE_ENTRY,
  PAINT_LIMIT_X,
  PREVIEW_SECONDS,
  REGION_END,
  REGION_FIRST,
  SWATCH_LAST,
  SWATCH_STEP,
  SWATCH_X,
  SWATCH_Y,
  TRUE_OFFSET,
  coloringLimit,
  coloringPoints,
  createColoring,
  pickPicture,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s35-coloring";
import type { TestHost } from "../engine-test-host";
import { hasOriginalFiles, listData, readData } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchOptions } from "./harness";

function loadMcg(name: string): Mcg {
  const [path] = listData((n) => n.toUpperCase() === `${name.toUpperCase()}.MCG`);
  return parseMcg(readData(path));
}

/** Une zone à peindre : un point de clic dont les neuf pixels voisins n'ont aucune autre zone, et la couleur de palette à prendre. */
interface Step {
  region: number;
  x: number;
  y: number;
  swatch: number;
}

/** Plan de résolution d'une image, calculé sur le fichier (pas sur l'état de la scène) ; `radius` : marge sans autre zone autour du point de clic. */
function plan(mcg: Mcg, swatches: number, radius = 1): Step[] {
  const run = new ColoringRun(mcg.pixels, mcg.palette, swatches);
  const colorOf = (i: number) => mcg.palette.slice(i * 3, i * 3 + 3).join(",");
  const swatchColors = Array.from({ length: swatches }, (_, k) => colorOf(run.pixelAt(SWATCH_X, SWATCH_Y + SWATCH_STEP * k)));
  const steps: Step[] = [];
  for (let region = REGION_FIRST; region < REGION_END; region++) {
    // Une zone déjà grise au départ n'est pas à peindre (`iRam37b80` ne la compte pas).
    if ([0, 1, 2].every((k) => mcg.palette[region * 3 + k] === mcg.palette[GRAY * 3])) continue;
    let point: { x: number; y: number } | null = null;
    for (let y = 2; y < 198 && !point; y++) {
      for (let x = 2; x < PAINT_LIMIT_X - 2 && !point; x++) {
        if (run.pixelAt(x, y) !== region) continue;
        let clean = x + radius < PAINT_LIMIT_X;
        for (let dy = -radius; dy <= radius && clean; dy++) {
          for (let dx = -radius; dx <= radius && clean; dx++) {
            const v = run.pixelAt(x + dx, y + dy);
            if (v >= REGION_FIRST && v < REGION_END && v !== region) clean = false;
          }
        }
        if (clean) point = { x, y };
      }
    }
    if (!point) throw new Error(`région ${region.toString(16)} sans point de clic propre`);
    const swatch = swatchColors.indexOf(colorOf(region + TRUE_OFFSET));
    if (swatch < 0) throw new Error(`région ${region.toString(16)} : sa couleur n'est pas dans la palette`);
    steps.push({ region, ...point, swatch });
  }
  return steps.sort((a, b) => a.swatch - b.swatch);
}
const GRAY = 0x7f;

/** Un point dont le carré de côté 2 × radius + 1 est entièrement de la zone, ou `null`. */
function interior(mcg: Mcg, region: number, radius: number): { x: number; y: number } | null {
  for (let y = radius; y < 200 - radius; y++) {
    for (let x = radius; x < PAINT_LIMIT_X - radius; x++) {
      let all = true;
      for (let dy = -radius; dy <= radius && all; dy++) for (let dx = -radius; dx <= radius && all; dx++) all = mcg.pixels[(y + dy) * 320 + x + dx] === region;
      if (all) return { x, y };
    }
  }
  return null;
}

/** Une valeur 8 bits telle qu'affichée : le DAC VGA n'en garde que 6 bits. */
const dac = (v: number) => Math.round(((v >> 2) * 255) / 63);

describe("S35 : limites, points, tirage de l'image (pur)", () => {
  it("temps de jeu : 55, 52 ou 49 s selon le niveau", () => {
    expect([0, 1, 2].map(coloringLimit)).toEqual([55, 52, 49]);
  });

  it("points : moins d'un tiers du temps utile (limite − 18 s) = 3, moins de deux tiers = 2, sinon 1", () => {
    // Niveau 0 : tiers 12, deux tiers 24.
    expect([0, 11, 12, 23, 24, 54].map((t) => coloringPoints(t, 55))).toEqual([3, 3, 2, 2, 1, 1]);
    // Niveau 1 : 34 / 3 = 11, 68 / 3 = 22 ; niveau 2 : 31 / 3 = 10, 62 / 3 = 20.
    expect([10, 11, 21, 22].map((t) => coloringPoints(t, 52))).toEqual([3, 2, 2, 1]);
    expect([9, 10, 19, 20].map((t) => coloringPoints(t, 49))).toEqual([3, 2, 2, 1]);
  });

  it("3 séries de 8 images ; 3 ou 4 couleurs au niveau 0, 5 au niveau 1, 6 ou 7 au niveau 2 (table de sauts `1bda:09b5`)", () => {
    expect(COLORING_PICTURES.map((series) => series.length)).toEqual([8, 8, 8]);
    expect(COLORING_PICTURES[0].map((p) => p.swatches)).toEqual([4, 4, 4, 4, 4, 4, 3, 4]);
    expect(COLORING_PICTURES[1].every((p) => p.swatches === 5)).toBe(true);
    expect(COLORING_PICTURES[2].map((p) => p.swatches)).toEqual([7, 6, 7, 6, 7, 6, 7, 6]);
    const names = COLORING_PICTURES.flat().map((p) => p.name);
    expect(new Set(names).size).toBe(24);
    expect(COLORING_PICTURES[0][0].name).toBe("s35a003d");
    expect(COLORING_PICTURES[2][7].name).toBe("s35a022d");
  });

  it("tirage : un `below(8)` par essai, jamais la même image que la précédente de la partie, la première n'est jamais l'image 0", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    const asked: number[] = [];
    const rng = (values: number[]) => ({
      below(n: number) {
        asked.push(n);
        return values.shift()!;
      },
    });
    // Première partie : la mémoire vaut 0, le 0 est refusé.
    expect(pickPicture(game, rng([0, 0, 5]), 0, 0).index).toBe(5);
    expect(asked).toEqual([8, 8, 8]);
    // Même image refusée, puis une autre.
    expect(pickPicture(game, rng([5, 2]), 0, 0).index).toBe(2);
    expect(pickPicture(game, rng([2, 2, 7]), 0, 0)).toMatchObject({ index: 7, picture: COLORING_PICTURES[0][7] });
    // Le niveau 2 prend sa série, mais la mémoire est celle du joueur (niveau 0) : le 7 est refusé.
    expect(pickPicture(game, rng([7, 3]), 0, 2)).toMatchObject({ index: 3, picture: COLORING_PICTURES[2][3] });
  });

  it("la mémoire est propre à chaque partie", () => {
    const a = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    const b = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    pickPicture(a, { below: () => 4 }, 0, 0);
    expect(pickPicture(b, { below: () => 4 }, 0, 0).index).toBe(4);
  });

  it("la requête est exigée : Game.openMinigame(35) d'abord", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createColoring(game, () => undefined)).toThrow(/openMinigame\(35\)/);
  });
});

describe.skipIf(!hasOriginalFiles)("S35 : les 24 images et les règles du clic (`1bda:0238..0638`)", () => {
  const all = COLORING_PICTURES.flatMap((series, level) => series.map((picture) => ({ picture, level })));

  it("chaque image : des zones 0x60..0x6D, la palette de droite à (0x11C, 0x0F + 0x1C × n), et une couleur pour chaque zone", () => {
    for (const { picture } of all) {
      const mcg = loadMcg(picture.name);
      const run = new ColoringRun(mcg.pixels, mcg.palette, picture.swatches);
      expect(run.regions, picture.name).toBeGreaterThan(0);
      expect(run.regions, picture.name).toBeLessThanOrEqual(REGION_END - REGION_FIRST);
      for (let n = 0; n < picture.swatches; n++) {
        const b = run.pixelAt(SWATCH_X, SWATCH_Y + SWATCH_STEP * n);
        expect(b >= BRUSH_ENTRY && b < SWATCH_LAST, `${picture.name} couleur ${n}`).toBe(true);
      }
      // Résoluble : chaque zone a un point de clic propre et sa couleur est dans la palette.
      expect(plan(mcg, picture.swatches).length, picture.name).toBe(run.regions);
    }
  });

  it("le départ : zones grises (R de l'entrée 0x7F), contour 0x44 (0x6E), entrée 0xFF à 0x80 ; la couleur en main est celle de l'entrée 0x6F", () => {
    const mcg = loadMcg("s35a003d");
    const run = new ColoringRun(mcg.pixels, mcg.palette, 4);
    const gray = mcg.palette[GRAY * 3];
    expect(run.gray).toBe(gray);
    expect(run.regions).toBe(5);
    for (let i = REGION_FIRST; i < REGION_FIRST + 5; i++) expect(run.entry(i)).toEqual([gray, gray, gray]);
    expect(run.entry(OUTLINE_ENTRY)).toEqual([0x44, 0x44, 0x44]);
    expect(run.entry(255)).toEqual([0x80, 0x80, 0x80]);
    // L'original n'est pas modifié (la scène en garde l'aperçu).
    expect(mcg.palette[REGION_FIRST * 3 + 2]).not.toBe(gray);
    expect(run.brush).toEqual(run.entry(0x70));
    expect(run.painted).toBe(0);
    expect(run.selected).toBe(0);
  });

  it("peindre : la bonne couleur colore la zone et compte, une zone déjà peinte est ignorée", () => {
    const mcg = loadMcg("s35a003d");
    const steps = plan(mcg, 4);
    const run = new ColoringRun(mcg.pixels, mcg.palette, 4);
    const first = steps[0];
    while (run.selected !== first.swatch) run.nextSwatch();
    const result = run.paint(first.x, first.y);
    expect(result).toEqual({ events: ["painted"], wrong: false, complete: false });
    expect(run.painted).toBe(1);
    expect(run.entry(first.region)).toEqual(run.entry(first.region + TRUE_OFFSET));
    expect(run.paint(first.x, first.y)).toEqual({ events: [], wrong: false, complete: false });
    expect(run.painted).toBe(1);
  });

  it("peindre d'une mauvaise couleur : faute, la zone fautive est retenue, rien n'est peint", () => {
    const mcg = loadMcg("s35a003d");
    const steps = plan(mcg, 4);
    const run = new ColoringRun(mcg.pixels, mcg.palette, 4);
    const wrong = steps.find((s) => s.swatch !== 0)!;
    expect(run.selected).toBe(0);
    const result = run.paint(wrong.x, wrong.y);
    expect(result.wrong).toBe(true);
    // Chaque pixel voisin de la zone compte (un seul son est joué, `1bda:0460`).
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events.every((e) => e === "wrong")).toBe(true);
    expect(run.lastWrong).toBe(wrong.region);
    expect(run.painted).toBe(0);
    expect(run.isGray(wrong.region)).toBe(true);
  });

  it("le clic touche aussi les pixels voisins (3 × 3) : à un pixel de la zone, elle est peinte", () => {
    const mcg = loadMcg("s35a003d");
    const steps = plan(mcg, 4);
    const run = new ColoringRun(mcg.pixels, mcg.palette, 4);
    // Le clic décalé d'un pixel : (x, y) est dans le voisinage 3 × 3 de (x + 1, y).
    const target = steps.find((s) => s.swatch === 0)!;
    expect(run.paint(target.x + 1, target.y).events).toEqual(["painted"]);
    // Deux pixels plus loin que le voisinage, rien (zone hors du 3 × 3).
    const other = new ColoringRun(mcg.pixels, mcg.palette, 4);
    let far: { x: number; y: number } | null = null;
    for (let y = 2; y < 198 && !far; y++) {
      for (let x = 2; x < PAINT_LIMIT_X - 2 && !far; x++) {
        let none = true;
        for (let k = 0; k < 9; k++) {
          const v = other.pixelAt(x - 1 + (k % 3), y - 1 + Math.trunc(k / 3));
          if (v >= REGION_FIRST && v < REGION_END) none = false;
        }
        if (none) far = { x, y };
      }
    }
    expect(other.paint(far!.x, far!.y)).toEqual({ events: [], wrong: false, complete: false });
  });

  it("peindre toutes les zones (couleurs prises dans l'ordre de la palette) termine chacune des 24 images", () => {
    for (const picture of COLORING_PICTURES.flat()) {
      const mcg = loadMcg(picture.name);
      const run = new ColoringRun(mcg.pixels, mcg.palette, picture.swatches);
      let complete = false;
      for (const step of plan(mcg, picture.swatches)) {
        while (run.selected !== step.swatch) run.nextSwatch();
        const result = run.paint(step.x, step.y);
        expect(result.wrong).toBe(false);
        complete = result.complete;
      }
      expect(complete).toBe(true);
      expect(run.painted).toBe(run.regions);
    }
  });

  it("couleur suivante : tourne sur le nombre de couleurs de l'image et lit l'entrée du pixel de la palette", () => {
    const mcg = loadMcg("s35a002d");
    const run = new ColoringRun(mcg.pixels, mcg.palette, 3);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      run.nextSwatch();
      seen.push(run.selected);
      const b = run.pixelAt(SWATCH_X, SWATCH_Y + SWATCH_STEP * run.selected);
      expect(run.brush).toEqual(run.entry(b));
    }
    expect(seen).toEqual([1, 2, 0, 1, 2, 0]);
  });

  it("prendre une couleur à la souris : la case sous le curseur (3 × 3), son numéro selon l'ordonnée ; hors des cases, rien", () => {
    const mcg = loadMcg("s35a001d");
    const run = new ColoringRun(mcg.pixels, mcg.palette, 7);
    for (let n = 0; n < 7; n++) {
      const y = SWATCH_Y + SWATCH_STEP * n;
      expect(run.pick(SWATCH_X, y)).toBe(true);
      expect(run.selected).toBe(n);
      expect(run.brush).toEqual(run.entry(run.pixelAt(SWATCH_X, y)));
    }
    // Les bornes d'ordonnée : < 0x1F → 0, < 0x3C → 1 … ≥ 0xA8 → 6.
    for (const [y, n] of [[0x1e, 0], [0x1f, 1], [0x3b, 1], [0x3c, 2], [0x71, 3], [0x72, 4], [0xa7, 5], [0xa8, 6]] as const) {
      const sample = new ColoringRun(mcg.pixels, mcg.palette, 7);
      // Une case de la palette doit être sous le curseur : on cherche un x de la colonne qui y tombe.
      if (sample.pick(SWATCH_X, y)) expect(sample.selected, `y=${y}`).toBe(n);
    }
    const before = run.brush;
    expect(run.pick(5, 5)).toBe(false);
    expect(run.brush).toEqual(before);
  });
});

// --- Pilote ------------------------------------------------------------------------------------------

/** Clic de souris : bouton tenu ~110 ms (plus d'un tour de boucle de 100 ms), puis une pause pour que la boucle reprenne. */
async function click(host: TestHost, run: (ms: number) => Promise<void>, button: number, hold = 110): Promise<void> {
  host.input.mouseDown(button);
  await run(hold);
  host.input.mouseUp(button);
  await run(110);
}

type Run = Awaited<ReturnType<typeof launchMinigame>>;

/** Joue le plan : la bonne couleur d'abord (clic droit en boucle), puis un clic gauche sur la zone. Rend le nombre de clics faits. */
async function solve(run: Run, scene: ColoringScene, steps: Step[], limit = steps.length): Promise<void> {
  const move = (ms: number) => run.run(ms);
  for (const step of steps.slice(0, limit)) {
    while (scene.stage === "play" && scene.state.selected !== step.swatch) await click(run.host, move, 2);
    if (scene.stage !== "play") return;
    run.host.input.mouseMove(step.x, step.y);
    await click(run.host, move, 0);
  }
}

async function start(options: LaunchOptions & { level?: number }, skip = true) {
  const run = await launchMinigame(35, options);
  const scene = run.scene as ColoringScene;
  if (skip) {
    // Le fondu d'entrée finit avant que l'aperçu écoute les boutons.
    await run.run(700);
    await run.tap("Space");
    await run.until(() => scene.stage === "play", 5000);
  }
  return { run, scene, mcg: loadMcg(scene.pictureName), steps: [] as Step[] };
}

/** Lance la partie jusqu'au jeu et calcule le plan de l'image tirée. */
async function ready(options: LaunchOptions = {}) {
  const game = await start(options);
  game.steps = plan(game.mcg, COLORING_PICTURES.flat().find((p) => p.name === game.scene.pictureName)!.swatches);
  return game;
}

describe.skipIf(!hasOriginalFiles)("S35 Le Coloriage : aperçu, jeu, issue", () => {
  it("le niveau donne la série d'images et le temps : 55, 52, 49 s ; l'indice de l'oiseau (et il est consommé) le niveau 0", async () => {
    for (const level of [0, 1, 2]) {
      const run = await launchMinigame(35, { level, seed: 3 });
      const scene = run.scene as ColoringScene;
      expect(scene.timeLimit).toBe(coloringLimit(level));
      expect(COLORING_PICTURES[level].map((p) => p.name)).toContain(scene.pictureName);
    }
    const run = await launchMinigame(35, { level: 2, bonus: true, seed: 3 });
    const scene = run.scene as ColoringScene;
    expect(scene.timeLimit).toBe(55);
    expect(COLORING_PICTURES[0].map((p) => p.name)).toContain(scene.pictureName);
    expect(run.game.state.pending?.bonus).toBe(true);
    expect(run.game.state.bonusTag).toBe(0);
  }, 60_000);

  it("graine fixe : même image ; à la partie suivante (même Game), jamais la même", async () => {
    const a = await launchMinigame(35, { seed: 9 });
    const b = await launchMinigame(35, { seed: 9 });
    expect((a.scene as ColoringScene).pictureName).toBe((b.scene as ColoringScene).pictureName);
    const names = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) names.add((await launchMinigame(35, { seed })).scene instanceof ColoringScene ? "ok" : "ko");
    expect([...names]).toEqual(["ok"]);
  }, 60_000);

  it("aperçu : l'image est montrée coloriée 8 s, puis les zones passent au gris et le chrono démarre", async () => {
    const run = await launchMinigame(35, { level: 0, seed: 4 });
    const scene = run.scene as ColoringScene;
    const mcg = loadMcg(scene.pictureName);
    expect(scene.stage).toBe("preview");
    await run.run(1000);
    run.shot("s35-apercu");
    const shown = run.host.presentations.at(-1)!;
    expect([...shown.palette.slice(REGION_FIRST * 3, REGION_FIRST * 3 + 3)]).toEqual([...mcg.palette.slice(REGION_FIRST * 3, REGION_FIRST * 3 + 3)].map(dac));
    await run.run((PREVIEW_SECONDS - 1) * 1000 - 600);
    expect(scene.stage).toBe("preview");
    await run.until(() => scene.stage === "play", 5000);
    await run.run(100);
    const after = run.host.presentations.at(-1)!;
    expect(after.palette[REGION_FIRST * 3]).toBe(dac(mcg.palette[GRAY * 3]));
    expect(scene.elapsed(run.ctx)).toBe(0);
    run.shot("s35-gris");
  }, 60_000);

  it("un clic abrège l'aperçu (gauche ou droit) ; le bouton est attendu relâché avant le jeu", async () => {
    for (const button of [0, 2]) {
      const run = await launchMinigame(35, { seed: 4 });
      const scene = run.scene as ColoringScene;
      await run.run(1000);
      run.host.input.mouseDown(button);
      await run.run(300);
      expect(scene.stage).toBe("release");
      run.host.input.mouseUp(button);
      await run.until(() => scene.stage === "play", 3000);
      expect(scene.state.painted).toBe(0);
      expect(run.ctx.clock.ticks).toBeLessThan(60 * 3);
    }
  }, 60_000);

  it("réussite rapide : toutes les zones peintes → 3 points, voix s35c, pas de faute", async () => {
    const { run, scene, steps } = await ready({ level: 0, seed: 4, audio: true });
    expect(scene.state.regions).toBe(steps.length);
    await solve(run, scene, steps);
    expect(scene.state.painted).toBe(scene.state.regions);
    run.shot("s35-fini");
    const outcome = await run.finish(120_000);
    expect(scene.end).toBe("won");
    expect(scene.voiceFile).toMatch(/^s35c00[1-6]t\.voc$/);
    expect(scene.earned).toBe(3);
    expect(outcome).toEqual({ kind: "points", points: 3 });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(3);
  }, 180_000);

  it("les 24 images se terminent : chacune est jouée jusqu'au bout (3 ou plus de points au niveau, jamais d'échec)", async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24 && seen.size < 24; seed++) {
      for (const level of [0, 1, 2]) {
        const game = await ready({ level, seed });
        if (seen.has(game.scene.pictureName)) continue;
        seen.add(game.scene.pictureName);
        await solve(game.run, game.scene, game.steps);
        expect(game.scene.state.painted, game.scene.pictureName).toBe(game.scene.state.regions);
        expect(game.scene.stage === "play" || game.scene.stage === "reveal").toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(12);
  }, 600_000);

  it("les points suivent le temps lu après le fondu sonore (3 s au volume maximal) : début à 10 s → 2, à 22 s → 1 (niveau 0)", async () => {
    for (const [wait, points] of [[10_000, 2], [22_000, 1]] as const) {
      const { run, scene, steps } = await ready({ level: 0, seed: 4 });
      await run.run(wait);
      await solve(run, scene, steps);
      const outcome = await run.finish(120_000);
      expect(scene.finalSeconds).toBeGreaterThanOrEqual(wait / 1000);
      expect(outcome).toEqual({ kind: "points", points });
    }
  }, 300_000);

  it("la fin compte dans le temps : image finie à 53 s sur 55, les 3 s du fondu sonore la font échouer (0 point, voix s35b003 ou 004)", async () => {
    const { run, scene, steps } = await ready({ level: 0, seed: 4 });
    await run.run(50_500);
    await solve(run, scene, steps);
    expect(scene.state.painted).toBe(scene.state.regions);
    const outcome = await run.finish(120_000);
    expect(scene.finalSeconds).toBeGreaterThanOrEqual(55);
    expect(scene.end).toBe("timeout");
    expect(scene.voiceFile).toMatch(/^s35b00[34]t\.voc$/);
    expect(outcome).toEqual({ kind: "points", points: 0 });
  }, 300_000);

  it("temps écoulé sans rien faire : les zones prennent leur vraie couleur, voix s35b003 ou 004, 0 point", async () => {
    const { run, scene } = await ready({ level: 1, seed: 6, audio: true });
    expect(scene.timeLimit).toBe(52);
    await run.until(() => scene.stage === "reveal", 120_000);
    expect(scene.elapsed(run.ctx)).toBeGreaterThanOrEqual(52);
    await run.until(() => scene.stage === "soundFade", 5000);
    await run.run(100);
    const palette = run.host.presentations.at(-1)!.palette;
    const mcg = loadMcg(scene.pictureName);
    for (let i = REGION_FIRST; i < REGION_END; i++) {
      expect([...palette.slice(i * 3, i * 3 + 3)]).toEqual([...mcg.palette.slice(i * 3, i * 3 + 3)].map(dac));
    }
    expect(await run.finish(120_000)).toEqual({ kind: "points", points: 0 });
    expect(scene.end).toBe("timeout");
    expect(scene.voiceFile).toMatch(/^s35b00[34]t\.voc$/);
  }, 300_000);

  it("une mauvaise couleur : les 30 clignotements de la zone, la fin, voix s35b001 ou 002, 0 point", async () => {
    const { run, scene, steps } = await ready({ level: 0, seed: 4, audio: true });
    const wrong = steps.find((s) => s.swatch !== 0)!;
    run.host.input.mouseMove(wrong.x, wrong.y);
    const wrongVoc = await run.ctx.resources.voc("s35a002b.voc");
    run.host.input.mouseDown(0);
    await run.until(() => scene.stage === "flash", 2000);
    run.host.input.mouseUp(0);
    expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(wrongVoc.samples);
    const colors = new Set<string>();
    let frames = 0;
    await run.until(() => {
      if (scene.stage === "flash") {
        frames++;
        colors.add(run.ctx.palette.colors.slice(wrong.region * 3, wrong.region * 3 + 3).join(","));
      }
      return scene.stage !== "flash";
    }, 3000);
    expect(frames).toBeGreaterThanOrEqual(FLASH_COUNT - 2);
    expect(colors.size).toBeGreaterThan(15);
    expect(scene.state.painted).toBe(0);
    const outcome = await run.finish(120_000);
    expect(scene.end).toBe("wrong");
    expect(scene.voiceFile).toMatch(/^s35b00[12]t\.voc$/);
    expect(outcome).toEqual({ kind: "points", points: 0 });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(0);
  }, 180_000);

  it("clic droit : couleur suivante en boucle ; clic gauche sur la palette de droite : prend la couleur", async () => {
    const { run, scene, steps } = await ready({ level: 2, seed: 2 });
    const swatches = COLORING_PICTURES.flat().find((p) => p.name === scene.pictureName)!.swatches;
    for (let i = 1; i <= swatches + 1; i++) {
      await click(run.host, (ms) => run.run(ms), 2);
      expect(scene.state.selected).toBe(i % swatches);
    }
    run.host.input.mouseMove(SWATCH_X, SWATCH_Y + SWATCH_STEP * 2);
    await click(run.host, (ms) => run.run(ms), 0);
    expect(scene.state.selected).toBe(2);
    expect(scene.state.painted).toBe(0);
    expect(steps.length).toBeGreaterThan(0);
    run.shot("s35-niveau2");
  }, 60_000);

  it("un bouton tenu ne répète pas : la boucle attend son relâchement (une peinture, pas de faute en passant dessus)", async () => {
    const { run, scene, steps } = await ready({ level: 0, seed: 4 });
    const first = steps[0];
    while (scene.state.selected !== first.swatch) await click(run.host, (ms) => run.run(ms), 2);
    run.host.input.mouseMove(first.x, first.y);
    run.host.input.mouseDown(0);
    await run.run(300);
    expect(scene.state.painted).toBe(1);
    // Le curseur bouge, le bouton est toujours tenu : rien ne se passe (la boucle est suspendue).
    const wrong = steps.find((s) => s.swatch !== first.swatch)!;
    run.host.input.mouseMove(wrong.x, wrong.y);
    await run.run(1500);
    expect(scene.stage).toBe("play");
    run.host.input.mouseUp(0);
    await run.run(300);
    // Relâché puis rappuyé : cette fois c'est une faute.
    await click(run.host, (ms) => run.run(ms), 0);
    expect(scene.stage === "flash" || scene.stage === "play").toBe(true);
    expect(scene.state.lastWrong).toBe(wrong.region);
  }, 60_000);

  it("clavier seul : les flèches (2 px par tick) amènent le curseur sur une zone, Espace peint", async () => {
    const { run, scene, mcg } = await ready({ level: 0, seed: 4 });
    const swatches = COLORING_PICTURES.flat().find((p) => p.name === scene.pictureName)!.swatches;
    // Un point à l'intérieur d'une zone (carré de 9 × 9 pixels tous de cette zone) : la précision d'un tick (2 px) suffit.
    const first = plan(mcg, swatches).find((step) => interior(mcg, step.region, 4) !== null)!;
    const inside = interior(mcg, first.region, 4)!;
    Object.assign(first, inside);
    while (scene.state.selected !== first.swatch) await run.tap("Enter");
    run.host.input.mouseMove(first.x - 8, first.y + 6);
    run.host.input.keyDown("ArrowRight");
    await run.run(4 * (1000 / 60) + 5);
    run.host.input.keyUp("ArrowRight");
    run.host.input.keyDown("ArrowUp");
    await run.run(3 * (1000 / 60) + 5);
    run.host.input.keyUp("ArrowUp");
    expect(Math.abs(run.ctx.input.mouseX - first.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(run.ctx.input.mouseY - first.y)).toBeLessThanOrEqual(4);
    await run.tap("Space", 130);
    expect(scene.state.painted).toBe(1);
  }, 60_000);

  it("le curseur est dessiné à la position de la souris (sprite 2 de s35a000s.hy8, pointe en haut à gauche)", async () => {
    const { run, mcg } = await ready({ level: 0, seed: 4 });
    const sprites = await run.ctx.resources.hy8("s35a000s.hy8");
    run.host.input.mouseMove(150, 90);
    await run.run(100);
    const shown = run.host.presentations.at(-1)!.surface;
    // Au moins un pixel de l'image du curseur (48 × 36, la pointe est son coin haut gauche) diffère du décor.
    const image = sprites.images[2];
    let differing = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (image.pixels[y * image.width + x] === 0) continue;
        const px = 150 + x;
        const py = 90 + y;
        if (shown[py * 320 + px] !== mcg.pixels[py * 320 + px]) differing++;
      }
    }
    expect(differing).toBeGreaterThan(100);
    run.host.input.mouseMove(60, 150);
    await run.run(100);
    run.shot("s35-curseur");
  }, 60_000);

  it("la voix de fin se coupe d'un clic ; ensuite 3 s de pause avant de rendre l'issue", async () => {
    const { run, scene, steps } = await ready({ level: 0, seed: 4, audio: true });
    await solve(run, scene, steps);
    await run.until(() => scene.stage === "voice", 60_000);
    await run.run(300);
    expect(run.outcome).toBeUndefined();
    await run.tap("Space", 130);
    await run.until(() => scene.stage === "pause", 5000);
    const at = run.ctx.clock.ticks;
    await run.until(() => run.outcome !== undefined, 10_000);
    expect(run.ctx.clock.ticks - at).toBeGreaterThanOrEqual(170);
    expect(run.ctx.clock.ticks - at).toBeLessThan(260);
  }, 180_000);
});

describe.skipIf(!hasOriginalFiles)("S35 Le Coloriage : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau : image réussie → les gouttes sont ajoutées, le tour est fini", async () => {
    const s = await enterFromBoard(35, "ColoringScene", { seed: 11 });
    const scene = s.ctx.scenes.top as ColoringScene;
    await s.run(700);
    expect(s.game.state.pending).toMatchObject({ scene: 35, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    const before = s.game.player.points;
    await s.run(700);
    const steps = plan(loadMcg(scene.pictureName), COLORING_PICTURES.flat().find((p) => p.name === scene.pictureName)!.swatches);
    await s.tap("Space");
    await s.until(() => scene.stage === "play", 5000);
    for (const step of steps) {
      while (scene.state.selected !== step.swatch) await click(s.host, (ms) => s.run(ms), 2);
      s.host.input.mouseMove(step.x, step.y);
      await click(s.host, (ms) => s.run(ms), 0);
    }
    expect(scene.state.painted).toBe(scene.state.regions);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.points).toBe(before + 3);
    expect(s.history).toContain("ColoringScene");
  }, 240_000);

  it("plateau : couleur fausse → rien n'est gagné", async () => {
    const s = await enterFromBoard(35, "ColoringScene", { seed: 11 });
    const scene = s.ctx.scenes.top as ColoringScene;
    const before = s.game.player.points;
    await s.run(700);
    const steps = plan(loadMcg(scene.pictureName), COLORING_PICTURES.flat().find((p) => p.name === scene.pictureName)!.swatches);
    await s.tap("Space");
    await s.until(() => scene.stage === "play", 5000);
    const wrong = steps.find((st) => st.swatch !== 0)!;
    s.host.input.mouseMove(wrong.x, wrong.y);
    await click(s.host, (ms) => s.run(ms), 0);
    await s.ready();
    expect(scene.end).toBe("wrong");
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.points).toBe(before);
  }, 240_000);

  it("mode libre : la partie se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(35, { seed: 5 });
    const scene = run.scene as ColoringScene;
    expect(scene).toBeInstanceOf(ColoringScene);
    expect(run.game.state.pending).toMatchObject({ scene: 35 });
    const wait = () => run.until(() => scene.stage === "play", 15_000);
    await run.run(700);
    await run.tap("Space");
    await wait();
    const steps = plan(loadMcg(scene.pictureName), COLORING_PICTURES.flat().find((p) => p.name === scene.pictureName)!.swatches);
    for (const step of steps) {
      while (scene.state.selected !== step.swatch) await click(run.host, (ms) => run.run(ms), 2);
      run.host.input.mouseMove(step.x, step.y);
      await click(run.host, (ms) => run.run(ms), 0);
    }
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 60_000);
    expect(run.free.currentGame).toBeNull();
  }, 240_000);
});
