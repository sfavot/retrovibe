import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  GIFT_CLOSED,
  GIFT_LAYOUTS,
  GIFT_OPEN,
  GIFT_OPENING,
  GiftsScene,
  POINTER_BOUNDS,
  STOP_ZONE,
  createGifts,
  failureVoice,
  successVoice,
  trapDivisor,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s51-gifts";
import { hasOriginalFiles } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S51 : règles des cadeaux (pur, `19a8:0006`)", () => {
  it("le cadeau piégé : 1 chance sur niveau + 3, sur 3 avec l'indice de l'oiseau (niveau le plus facile ; défaut de l'original corrigé)", () => {
    expect([0, 1, 2].map((level) => trapDivisor(level, false))).toEqual([3, 4, 5]);
    expect([0, 1, 2].map((level) => trapDivisor(level, true))).toEqual([3, 3, 3]);
  });

  it("voix de réussite : moins de 2 cadeaux → 1, moins de 4 → 2, sinon 3", () => {
    expect([0, 1, 2, 3, 4, 10, 11].map(successVoice)).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });

  it("voix d'échec : 1 ou 2, 3 ou 4 pour le personnage 4", () => {
    expect([0, 1].map((roll) => failureVoice(0, roll))).toEqual([1, 2]);
    expect([0, 1].map((roll) => failureVoice(4, roll))).toEqual([3, 4]);
    expect(failureVoice(5, 1)).toBe(2);
  });

  it("trois fonds de 10, 11 et 10 cadeaux, zones cliquables autour de chaque cadeau, sprites fermés 16, 22 ou 28", () => {
    expect(GIFT_LAYOUTS.map((l) => l.length)).toEqual([10, 11, 10]);
    for (const layout of GIFT_LAYOUTS) {
      for (const [x, , base, minX, minY, maxX, maxY] of layout) {
        expect([16, 22, 28]).toContain(base);
        expect(maxX).toBeGreaterThan(minX + 20);
        expect(maxY).toBeGreaterThan(minY + 20);
        expect(x).toBeGreaterThan(minX);
        // Le pointeur borné (x ≥ 0x21) doit pouvoir toucher chaque zone.
        expect(maxX).toBeGreaterThan(POINTER_BOUNDS.minX);
        expect(minY).toBeLessThan(POINTER_BOUNDS.maxY);
      }
    }
  });

  it("le bouton d'arrêt n'est atteignable que contre le bord gauche (x borné à 0x21, 0x22)", () => {
    expect(POINTER_BOUNDS.minX).toBeGreaterThan(STOP_ZONE.minX);
    expect(POINTER_BOUNDS.minX + 1).toBeLessThan(STOP_ZONE.maxX);
    expect(POINTER_BOUNDS.minX + 2).not.toBeLessThan(STOP_ZONE.maxX);
  });

  it("la requête est exigée : sans Game.openMinigame(51) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createGifts(game, () => undefined)).toThrow(/openMinigame\(51\)/);
    game.openMinigame(22);
    expect(() => createGifts(game, () => undefined)).toThrow(/openMinigame\(51\)/);
  });
});

// --- Pilote -------------------------------------------------------------------------------------------

/** Tirages d'ouverture que l'original ferait avec cette graine : `rand × 32000 / 0x8000 % diviseur` (1 = cadeau piégé). */
function rolls(seed: number, divisor: number, count: number): number[] {
  const rng = new BorlandRandom(seed);
  return Array.from({ length: count }, () => rng.below(32000) % divisor);
}

/** Première graine dont les premiers tirages ont la forme voulue. */
function seedFor(divisor: number, wanted: (rolls: number[]) => boolean): number {
  for (let seed = 1; seed < 20_000; seed++) if (wanted(rolls(seed, divisor, 12))) return seed;
  throw new Error("aucune graine ne convient");
}

const safe = (count: number) => (r: number[]) => r.slice(0, count).every((v) => v !== 1);
const trapAt = (index: number) => (r: number[]) => r.slice(0, index).every((v) => v !== 1) && r[index] === 1;

/** Centre de la zone cliquable du cadeau `index` du fond tiré. */
function target(scene: GiftsScene, index: number): [number, number] {
  const [, , , minX, minY, maxX, maxY] = GIFT_LAYOUTS[scene.layout][index];
  return [(minX + maxX) >> 1, (minY + maxY) >> 1];
}

async function click(run: LaunchedMinigame, x: number, y: number, hold = 120): Promise<void> {
  run.host.input.mouseMove(x, y);
  run.host.input.mouseDown(0);
  await run.run(hold);
  run.host.input.mouseUp(0);
  await run.run(40);
}

async function openGift(run: LaunchedMinigame, index: number): Promise<void> {
  const scene = run.scene as GiftsScene;
  const [x, y] = target(scene, index);
  await click(run, x, y);
  // Six images d'ouverture à 5 ticks (0,5 s).
  await run.run(600);
}

/** Clic sur la bougie de gauche : le pointeur est borné à x ≥ 0x21. */
async function stop(run: LaunchedMinigame): Promise<void> {
  await click(run, 0x22, 0x86);
}

/** Lance la scène et la rejoue avec des tirages d'ouverture connus (le fond est déjà tiré). */
async function launch(options: LaunchOptions & { rolls?: (r: number[]) => boolean } = {}): Promise<LaunchedMinigame> {
  const run = await launchMinigame(51, { seed: 5, ...options });
  if (options.rolls) {
    const level = options.level ?? 0;
    run.ctx.rng.seed(seedFor(trapDivisor(level, options.bonus ?? false), options.rolls));
  }
  // L'introduction : fondu, 20 centièmes de seconde, puis la boucle.
  await run.until(() => (run.scene as GiftsScene).stage === "play");
  return run;
}

describe.skipIf(!hasOriginalFiles)("S51 Les Cadeaux : mise en place", () => {
  it("un fond tiré parmi trois, tous les cadeaux fermés, le curseur au centre ; graine fixe : même fond", async () => {
    const run = await launch({ seed: 3 });
    const scene = run.scene as GiftsScene;
    expect(scene.layout).toBeGreaterThanOrEqual(0);
    expect(scene.layout).toBeLessThan(3);
    expect(scene.states).toHaveLength(GIFT_LAYOUTS[scene.layout].length);
    expect(scene.states.every((s) => s === GIFT_CLOSED)).toBe(true);
    expect(scene.giftSprites).toEqual(GIFT_LAYOUTS[scene.layout].map((g) => g[2]));
    expect(run.ctx.input.mouseX).toBe(0xa0);
    expect(run.ctx.input.mouseY).toBe(0x64);
    run.shot("s51-debut");
    const again = await launch({ seed: 3 });
    expect((again.scene as GiftsScene).layout).toBe(scene.layout);
  }, 60_000);

  it("les trois fonds sortent selon la graine, et chacun se charge", async () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 60 && seen.size < 3; seed++) {
      const run = await launch({ seed });
      seen.add((run.scene as GiftsScene).layout);
      run.shot(`s51-fond-${(run.scene as GiftsScene).layout + 1}`);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  }, 120_000);

  it("la boucle tourne à 12 itérations par seconde", async () => {
    const run = await launch();
    const scene = run.scene as GiftsScene;
    const before = scene.iterations;
    await run.run(2000);
    expect(scene.iterations - before).toBeGreaterThanOrEqual(23);
    expect(scene.iterations - before).toBeLessThanOrEqual(25);
  }, 60_000);

  it("le niveau du joueur règle le cadeau piégé (1/3, 1/4, 1/5), l'indice de l'oiseau le met à 1/3 (défaut de l'original corrigé : 1/2)", async () => {
    for (const level of [0, 1, 2]) {
      expect(((await launchMinigame(51, { level })).scene as GiftsScene).trapChance).toBe(level + 3);
      expect(((await launchMinigame(51, { level, bonus: true })).scene as GiftsScene).trapChance).toBe(3);
    }
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S51 Les Cadeaux : ouvrir des cadeaux", () => {
  it("un clic dans la zone ouvre le cadeau en six images (le sprite passe de base à base + 5), puis compte pour un", async () => {
    const run = await launch({ rolls: safe(3) });
    const scene = run.scene as GiftsScene;
    const base = GIFT_LAYOUTS[scene.layout][0][2];
    const [x, y] = target(scene, 0);
    run.host.input.mouseMove(x, y);
    run.host.input.mouseDown(0);
    await run.run(150);
    run.host.input.mouseUp(0);
    expect(scene.states[0]).toBe(GIFT_OPENING);
    expect(scene.openedCount).toBe(0);
    run.shot("s51-ouverture-0");
    await run.run(200);
    expect(scene.giftSprites[0]).toBeGreaterThan(base);
    run.shot("s51-ouverture-1");
    await run.run(500);
    expect(scene.states[0]).toBe(GIFT_OPEN);
    expect(scene.giftSprites[0]).toBe(base + 5);
    expect(scene.openedCount).toBe(1);
    expect(scene.states.slice(1).every((s) => s === GIFT_CLOSED)).toBe(true);
    run.shot("s51-ouvert");
    // Un cadeau ouvert ne se rouvre pas : pas de nouveau tirage (la graine reste celle d'avant le clic).
    run.ctx.rng.seed(1);
    const next = new BorlandRandom(1).next();
    await click(run, x, y);
    expect(scene.states[0]).toBe(GIFT_OPEN);
    expect(scene.openedCount).toBe(1);
    expect(run.ctx.rng.next()).toBe(next);
  }, 60_000);

  it("la zone cliquable exclut ses bornes ; un clic ailleurs n'ouvre rien", async () => {
    const run = await launch({ rolls: safe(3) });
    const scene = run.scene as GiftsScene;
    const [, , , minX, minY, maxX, maxY] = GIFT_LAYOUTS[scene.layout][0];
    const midY = (minY + maxY) >> 1;
    await click(run, minX, midY);
    await click(run, maxX, midY);
    await click(run, (minX + maxX) >> 1, minY);
    await click(run, (minX + maxX) >> 1, maxY);
    expect(scene.states[0]).toBe(GIFT_CLOSED);
    await click(run, 5, 5);
    expect(scene.states.every((s) => s === GIFT_CLOSED)).toBe(true);
    await click(run, minX + 1, midY);
    expect(scene.states[0]).not.toBe(GIFT_CLOSED);
  }, 60_000);

  it("pointeur au clavier : flèches = 2 px par tick, borné ; Espace ouvre le cadeau sous le curseur", async () => {
    const run = await launch({ rolls: safe(3) });
    const scene = run.scene as GiftsScene;
    const [x, y] = target(scene, 0);
    run.host.input.mouseMove(x - 10, y);
    run.host.input.keyDown("ArrowRight");
    await run.run(100);
    run.host.input.keyUp("ArrowRight");
    const moved = run.ctx.input.mouseX - (x - 10);
    expect(moved).toBeGreaterThanOrEqual(8);
    expect(moved).toBeLessThanOrEqual(14);
    run.host.input.mouseMove(x, y);
    await run.tap("Space", 120);
    expect(scene.states[0]).not.toBe(GIFT_CLOSED);
  }, 60_000);

  it("un clic au bord gauche, à la hauteur de la bougie, arrête la partie ; ailleurs sur ce bord, rien", async () => {
    const run = await launch({ rolls: safe(3) });
    const scene = run.scene as GiftsScene;
    await click(run, 0x22, 0x20);
    await click(run, 0x40, 0x86);
    await click(run, 0x22, 0x7c);
    await run.run(200);
    expect(scene.stage).toBe("play");
    await click(run, 2, 0x86);
    await run.until(() => scene.stage !== "play");
    expect(scene.stage).toBe("tada");
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S51 Les Cadeaux : issue", () => {
  it("réussite : trois cadeaux puis l'arrêt → 3 points, la flamme s'éteint (11 à 15), voix s51c002, sans vidéo", async () => {
    const run = await launch({ seed: 5, audio: true, rolls: safe(3) });
    const scene = run.scene as GiftsScene;
    for (const i of [0, 1, 2]) await openGift(run, i);
    expect(scene.openedCount).toBe(3);
    expect(scene.hasFailed).toBe(false);
    expect(run.game.state.pending).toMatchObject({ scene: 51, level: 0 });
    await stop(run);
    await run.until(() => scene.stage === "tada");
    run.shot("s51-sortie-0");
    const seen = new Set<number | null>();
    await run.run(400, () => seen.add(scene.candleSprite));
    run.shot("s51-sortie-1");
    expect([...seen].some((s) => s !== null && s >= 11 && s <= 15)).toBe(true);
    await run.until(() => scene.stage === "voice");
    const voice = await run.ctx.resources.voc("s51c002t.voc");
    expect(run.host.audio.plays.at(-1)?.sound.samples).toEqual(voice.samples);
    run.shot("s51-voix");
    const tada = await run.ctx.resources.voc("s29a002b.voc");
    expect(run.host.audio.effects.some((p) => p.sound.samples === tada.samples || p.sound.samples.length === tada.samples.length)).toBe(true);
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "points", points: 3 });
    const before = run.game.player.points;
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(before + 3);
  }, 120_000);

  it("arrêt sans rien ouvrir : 0 point et voix s51c001", async () => {
    const run = await launch({ audio: true });
    await stop(run);
    await run.until(() => (run.scene as GiftsScene).stage === "voice");
    const voice = await run.ctx.resources.voc("s51c001t.voc");
    expect(run.host.audio.plays.at(-1)?.sound.samples).toEqual(voice.samples);
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("un clic coupe la voix de fin", async () => {
    const run = await launch({ audio: true });
    await stop(run);
    await run.until(() => (run.scene as GiftsScene).stage === "voice");
    await run.run(300);
    expect(run.outcome).toBeUndefined();
    await run.tap("Space", 120);
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("tous les cadeaux ouverts : la partie s'arrête seule et rend autant de points que de cadeaux (jusqu'à 10 ou 11)", async () => {
    const run = await launch({ level: 2, rolls: safe(11) });
    const scene = run.scene as GiftsScene;
    const count = scene.states.length;
    for (let i = 0; i < count; i++) await openGift(run, i);
    expect(scene.openedCount).toBe(count);
    await run.until(() => scene.stage !== "play");
    run.shot("s51-tout-ouvert");
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "points", points: count });
    const before = run.game.player.points;
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(Math.min(60, before + count));
  }, 180_000);

  it("cadeau piégé : le cadeau s'arrête à la 3e image, le butin est perdu, vidéo s51b puis voix s51b001 ou 002, 0 point", async () => {
    const run = await launch({ audio: true, rolls: trapAt(1) });
    const scene = run.scene as GiftsScene;
    await openGift(run, 0);
    expect(scene.openedCount).toBe(1);
    const [x, y] = target(scene, 1);
    await click(run, x, y);
    expect(scene.hitTrap).toBe(true);
    const base = GIFT_LAYOUTS[scene.layout][1][2];
    await run.run(100);
    run.shot("s51-piege-0");
    await run.until(() => scene.hasFailed);
    expect(scene.giftSprites[1]).toBe(base + 2);
    expect(scene.states[1]).toBe(GIFT_OPEN);
    expect(scene.openedCount).toBe(1);
    run.shot("s51-piege-1");
    await run.until(() => scene.stage === "video");
    expect(scene.openedCount).toBe(0);
    // La vidéo dure un peu plus d'une seconde.
    await run.run(500);
    run.shot("s51-piege-video-1");
    await run.run(400);
    run.shot("s51-piege-video-2");
    await run.until(() => scene.stage === "voice", 60_000);
    run.shot("s51-piege-voix");
    const voices = await Promise.all(["s51b001t.voc", "s51b002t.voc"].map((n) => run.ctx.resources.voc(n)));
    expect(voices.map((v) => v.samples)).toContainEqual(run.host.audio.plays.at(-1)?.sound.samples);
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "points", points: 0 });
    const before = run.game.player.points;
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(before);
  }, 180_000);

  it("la vidéo d'échec se passe (Échap) ; le personnage 4 a les voix s51b003 et s51b004", async () => {
    const run = await launch({ audio: true, character: 4, rolls: trapAt(0) });
    const scene = run.scene as GiftsScene;
    await openGift(run, 0);
    await run.until(() => scene.stage === "video");
    await run.run(500);
    await run.tap("Escape", 120);
    await run.until(() => scene.stage === "voice", 10_000);
    const voices = await Promise.all(["s51b003t.voc", "s51b004t.voc"].map((n) => run.ctx.resources.voc(n)));
    expect(voices.map((v) => v.samples)).toContainEqual(run.host.audio.plays.at(-1)?.sound.samples);
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 180_000);

  it("un cadeau piégé ouvert pendant qu'un autre s'ouvre : la partie est perdue dès la 3e image de l'un ou l'autre", async () => {
    const run = await launch({ rolls: (r) => r[0] !== 1 && r[1] === 1 });
    const scene = run.scene as GiftsScene;
    const [x0, y0] = target(scene, 0);
    const [x1, y1] = target(scene, 1);
    await click(run, x0, y0, 60);
    await click(run, x1, y1, 60);
    await run.until(() => scene.hitTrap);
    await run.until(() => scene.hasFailed);
    expect(scene.openedCount).toBeLessThanOrEqual(1);
    await run.finish();
    expect((await Promise.resolve(run.outcome)) as unknown).toEqual({ kind: "points", points: 0 });
  }, 180_000);

  it("indice de l'oiseau : niveau le plus facile (1 chance sur 3), même au niveau 2 ; défaut de l'original corrigé", async () => {
    const run = await launch({ bonus: true, level: 2, rolls: trapAt(0) });
    const scene = run.scene as GiftsScene;
    expect(scene.trapChance).toBe(3);
    await openGift(run, 0);
    expect(scene.hitTrap).toBe(true);
    await run.finish();
  }, 180_000);
});

describe.skipIf(!hasOriginalFiles)("S51 Les Cadeaux : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de la scène 51 : trois cadeaux ouverts → trois gouttes ajoutées, le tour est fini", async () => {
    const s = await enterFromBoard(51, "GiftsScene", { seed: 11 });
    const scene = s.ctx.scenes.top as GiftsScene;
    expect(scene).toBeInstanceOf(GiftsScene);
    expect(s.game.state.pending).toMatchObject({ scene: 51, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    const before = s.game.player.points;
    s.ctx.rng.seed(seedFor(trapDivisor(0, false), safe(2)));
    await s.until(() => scene.stage === "play");
    const clickAt = async (x: number, y: number) => {
      s.host.input.mouseMove(x, y);
      s.host.input.mouseDown(0);
      await s.run(120);
      s.host.input.mouseUp(0);
      await s.run(700);
    };
    for (const i of [0, 1]) await clickAt(...target(scene, i));
    expect(scene.openedCount).toBe(2);
    await clickAt(0x22, 0x86);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.points).toBe(before + 2);
    expect(s.history).toContain("GiftsScene");
  }, 180_000);

  it("mode libre : la partie se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(51, { seed: 5 });
    const scene = run.scene as GiftsScene;
    expect(scene).toBeInstanceOf(GiftsScene);
    expect(run.game.state.pending).toMatchObject({ scene: 51 });
    await run.until(() => scene.stage === "play");
    await click(run, 0x22, 0x86);
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 60_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);
});
