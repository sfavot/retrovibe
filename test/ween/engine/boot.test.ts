import { describe, expect, it } from "vitest";
import { HeadlessHost } from "../../../src/engine/coktel/host";
import { MemoryStorage } from "../../../src/engine/storage";
import { PROTECTION_CALLS, WeenGame, createWeenSystem } from "../../../src/games/ween/engine/ween";
import { hasOriginalFiles } from "../helpers";
import { firstDivergence, loadReference, readOriginalStk, runBench, type BenchInput } from "./bench";

/**
 * Démarrage de Ween comparé au banc ScummVM (vague C) : TOT chargés (`TT`), protection sautée (`PS`) et hachage des
 * variables (`VH`) à chaque image, identiques au banc sur toute la longueur des traces de référence
 * (`test/ween/fixtures/`, produites par `bench/run-ween.sh` en temps virtuel, graine 1 ; voir `bench.ts`).
 */
describe.skipIf(!hasOriginalFiles)("Ween : démarrage comparé au banc ScummVM", () => {
  it("introduction regardée jusqu'à EMAJ1000 (rustine VAR(59) à l'image 2 550) : 4 000 images identiques au banc", async () => {
    const ref = loadReference("intro");
    expect(ref.vh).toHaveLength(4000);
    const run = await runBench(4000);
    expect(run.tots).toEqual(ref.tots);
    expect(run.skipped).toEqual(ref.skipped);
    expect(run.skipped).toEqual([[2466, "INTRO5.TOT", 1023]]);
    expect(run.vh).toHaveLength(4000);
    expect(firstDivergence(run.vh, ref.vh)).toBe(-1);
    expect(run.tots.at(-1)).toEqual([3549, "EMAJ1000.TOT"]);
    expect(run.game.vars.readVar32(210)).toBe(0); // EMAJ1000 remet 210 à zéro (nouvelle partie)
  });

  it("Échap pendant l'introduction : protection d'intro.tot sautée, MENU puis EMAJ1000 (400 images)", async () => {
    const ref = loadReference("escape");
    const run = await runBench(400, [{ image: 20, key: "ESC" }]);
    expect(run.tots).toEqual(ref.tots);
    expect(run.skipped).toEqual([[26, "INTRO.TOT", 348]]);
    expect(firstDivergence(run.vh, ref.vh)).toBe(-1);
    expect(run.vh).toHaveLength(400);
  });

  it("Quitter par la disquette : gob 3 et 13 sautés, END absent = fin propre, identique au banc", async () => {
    const ref = loadReference("quit");
    const inputs: BenchInput[] = [
      { image: 20, key: "ESC" },
      { image: 300, move: [28, 10] },
      { image: 400, click: [28, 10] },
      { image: 480, move: [58, 37] },
      { image: 500, click: [58, 37] },
      { image: 700, move: [100, 141] },
      { image: 720, click: [100, 141] },
    ];
    const run = await runBench(Infinity, inputs);
    expect(run.tots).toEqual(ref.tots);
    expect(run.tots.at(-1)).toEqual([723, "END.TOT"]);
    expect(run.game.endedOn?.toUpperCase()).toBe("END.TOT");
    expect(run.game.terminate).toBe(2);
    expect(run.vh).toHaveLength(ref.vh.length);
    expect(firstDivergence(run.vh, ref.vh)).toBe(-1);
  });

  it("protection reconnue par TOT et cible de l'appel, réponse juste fixée (210 = 1, 211 = 10)", () => {
    expect(PROTECTION_CALLS).toEqual([
      { tot: "INTRO.TOT", offset: 348 },
      { tot: "INTRO5.TOT", offset: 1023 },
    ]);
  });

  it("le hasard des scripts est tiré pendant l'introduction (scummvmRandom, graine 1 comme --random-seed=1)", async () => {
    let draws = 0;
    const run = await runBench(2100, [], {
      probe: (n, game) => {
        if (n !== 1) return;
        const random = game.random;
        const number = random.number.bind(random);
        random.number = (max) => {
          draws++;
          return number(max);
        };
      },
    });
    expect(run.tots.map(([, t]) => t)).toContain("INTRO5.TOT");
    expect(draws).toBeGreaterThan(0);
  });

  it("attente active d'INTRO5 (VAR(59) jusqu'à 5 000, rustine de ScummVM à 4 000) : 1 000 tours d'une image", async () => {
    // Hôte cadencé par images (navigateur) : chaque keyFunc de la boucle attend une image (handleBusyWait, longDelay(1)).
    const host = new HeadlessHost({ readFile: (n) => (n.toUpperCase() === "INTRO.STK" ? stk() : undefined) });
    const system = createWeenSystem({ host, soundBackend: silentBackend, store: new MemoryStorage() });
    const game = new WeenGame(host, system.sys, { maxSteps: 20_000_000 });
    let turns = 0;
    let firstFrame = -1;
    let lastFrame = -1;
    const stop = new Error("MENU");
    game.hooks.beforeOpcode = (g, ins) => {
      if (g.curTotFile.toUpperCase() !== "INTRO5.TOT" || ins.at !== 726) return;
      turns++;
      if (firstFrame < 0) firstFrame = host.frames;
      lastFrame = host.frames;
    };
    game.hooks.onLoadTot = (_g, tot) => {
      if (tot.toUpperCase() === "MENU.TOT") throw stop;
    };
    await expect(game.start()).rejects.toBe(stop);
    expect(turns).toBe(1000);
    // ≈ 1 000 images d'affichage : ≈ 17 s à 60 Hz (banc : 25 s virtuels, longDelay(1) = 25 ms par tour)
    expect(lastFrame - firstFrame).toBeGreaterThanOrEqual(990);
    expect(lastFrame - firstFrame).toBeLessThanOrEqual(1000);
  });

  it("o1_manageDataFile sur une archive absente (DISK2.STK, DISK3.STK) ne fait rien", async () => {
    const host = new HeadlessHost({ readFile: (n) => (n.toUpperCase() === "INTRO.STK" ? stk() : undefined) });
    const system = createWeenSystem({ host, soundBackend: silentBackend, store: new MemoryStorage() });
    const game = new WeenGame(host, system.sys);
    await game.files.openArchive("INTRO.STK", true);
    expect(await game.files.openArchive("DISK2.STK", true)).toBe(false);
    expect(await game.files.openArchive("DISK3", true)).toBe(false);
    expect(game.files.archiveNames).toEqual(["INTRO.STK"]);
  });
});

const silentBackend = { playSample() {}, stopSample() {}, queuePcm() {}, clearQueue() {} };
const stk = readOriginalStk;
