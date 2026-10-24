/**
 * Rockets (screens/rockets.md) : logique pure (vecteurs du §7.4, graine 0), adaptation du niveau (dont le défaut d'origine), données réelles de
 * `NIM.DAT`, et une partie complète jouée au clic sur le moteur (TestHost) jusqu'à la victoire de l'enfant.
 */
import { describe, expect, it } from "vitest";
import { TAG_SCR, TAG_SHAP, TAG_SND, MohawkArchive } from "../../src/games/mathemagique/data/mohawk";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { Archive } from "../../src/games/mathemagique/engine/resources";
import { MsvcRandom, NoRepeatPool } from "../../src/games/mathemagique/engine/rng";
import { SceneId, type Scene } from "../../src/games/mathemagique/engine/scene";
import { installServices } from "../../src/games/mathemagique/engine/services";
import { ROCKETS_POLY, polyScriptIds } from "../../src/games/mathemagique/game/poly-config";
import {
  DEFAULT_RULES,
  LAUNCH_SOUNDS,
  RocketsPools,
  ROCKET_OFFSET_X,
  ROCKET_OFFSET_Y,
  ROCKET_SHAPES,
  ROCKET_SIZES,
  allPolyScripts,
  applyGameResult,
  autoTurnPending,
  canChangeMaxTake,
  choosePadValue,
  createState,
  drawLaunchSounds,
  flightClip,
  flightScrId,
  hitTestSlots,
  launch,
  layoutScrId,
  maxTakeForPoly,
  newGame,
  nextMaxTake,
  padCell,
  parseLayout,
  planAnnounceMaxTake,
  planAnnounceTake,
  polyChooseTake,
  polyClickKind,
  polyPickSlots,
  randomTotalSequence,
  remaining,
  rocketMaskId,
  rocketShapeId,
  slotsFromLayout,
  type LayoutCell,
  type RocketsState,
} from "../../src/games/mathemagique/scenes/rockets-logic";
import { createRocketsScene, type RocketsScene } from "../../src/games/mathemagique/scenes/rockets";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

const seq = (n: number, count: number, seed = 0): number[] => {
  const rng = new MsvcRandom(seed);
  return Array.from({ length: count }, () => rng.rand(n));
};

describe("hasard et tirages sans remise (vecteurs de rockets.md §7.4)", () => {
  it("rand(n) à graine fixe", () => {
    expect(seq(4, 8)).toEqual([3, 4, 1, 2, 3, 2, 0, 0]);
    expect(seq(100, 8)).toEqual([38, 43, 72, 13, 11, 81, 83, 66]);
    expect(seq(5, 8)).toEqual([2, 3, 0, 1, 1, 1, 1, 5]);
    expect(seq(4, 8, 1)).toEqual([1, 0, 4, 3, 2, 4, 3, 3]);
  });

  it("poolPick : n = 3 puis n = 12", () => {
    const three = new NoRepeatPool(3);
    const rng3 = new MsvcRandom(0);
    expect(Array.from({ length: 7 }, () => three.pick(rng3))).toEqual([2, 0, 1, 1, 2, 0, 1]);
    const twelve = new NoRepeatPool(12);
    const rng12 = new MsvcRandom(0);
    expect(Array.from({ length: 13 }, () => twelve.pick(rng12))).toEqual([2, 3, 6, 1, 7, 4, 5, 8, 9, 0, 10, 11, 10]);
  });
});

describe("IA de Poly : polyChooseTake", () => {
  const cases: { name: string; R: number; M: number; level: number; played: boolean; expected: number }[] = [
    { name: "premier coup (coup gagnant 2) : erreur délibérée", R: 14, M: 3, level: 2, played: false, expected: 3 },
    { name: "niveau 1 hors seuil (9 > 7) : erreur", R: 9, M: 3, level: 1, played: true, expected: 3 },
    { name: "niveau 2 dans le seuil (9 ≤ 10) : joue juste", R: 9, M: 3, level: 2, played: true, expected: 1 },
    { name: "niveau 1 dans le seuil (7 ≤ 7)", R: 7, M: 3, level: 1, played: true, expected: 3 },
    { name: "pas de coup gagnant (8 mod 4 = 0)", R: 8, M: 3, level: 4, played: true, expected: 3 },
    { name: "fin de partie (R < M + 1) : toujours juste", R: 2, M: 5, level: 0, played: true, expected: 2 },
    { name: "niveau 0, R multiple de M + 1", R: 20, M: 4, level: 0, played: true, expected: 3 },
    { name: "niveau 3, seuil 21", R: 17, M: 5, level: 3, played: true, expected: 5 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(polyChooseTake(c.R, c.M, c.level, c.played, new MsvcRandom(0))).toBe(c.expected);
    });
  }

  it("ne consomme aucun tirage quand elle joue juste", () => {
    const rng = new MsvcRandom(0);
    polyChooseTake(9, 3, 2, true, rng);
    polyChooseTake(7, 3, 1, true, rng);
    expect(rng.current).toBe(0);
  });

  it("propriétés sur 10 000 tirages à graines variées", () => {
    for (let seed = 0; seed < 10_000; seed++) {
      const rng = new MsvcRandom(seed);
      const M = 2 + (seed % 4);
      const R = 1 + (seed % 21);
      const level = seed % 5;
      const played = seed % 3 !== 0;
      const k = polyChooseTake(R, M, level, played, rng);
      expect(k).toBeGreaterThanOrEqual(1);
      expect(k).toBeLessThanOrEqual(Math.min(M, R));
      const t = R % (M + 1);
      if (t >= 1 && R >= 11 && !played) expect(k).not.toBe(t); // premier coup : jamais le coup gagnant
      if (t >= 1 && played && level === 0 && R >= M + 1) expect(k).not.toBe(t); // niveau 0 : erreur tant que R >= M + 1
      if (t >= 1 && played && level >= 1 && R <= (level + 1) * M + 1) expect(k).toBe(t); // niveaux 1 à 4 : juste dans le seuil
      if (t >= 1 && played && R < M + 1) expect(k).toBe(t);
    }
  });

  it("la fréquence de k = t est nulle hors du seuil (niveaux 1 à 4)", () => {
    for (let level = 1; level <= 4; level++) {
      const M = 3;
      const R = (level + 1) * M + 3;
      const t = R % (M + 1);
      if (t === 0) continue;
      for (let seed = 0; seed < 500; seed++) expect(polyChooseTake(R, M, level, true, new MsvcRandom(seed))).not.toBe(t);
    }
  });
});

describe("sélection des fusées de Poly", () => {
  const layout: LayoutCell[] = Array.from({ length: 11 }, (_, i) => ({ type: i % 21, x: 10 * i, y: 5 }));
  it("graine 0, 11 emplacements pleins : k = 1 → [5], k = 3 → [5, 1, 6]", () => {
    const slots = slotsFromLayout(layout);
    expect(polyPickSlots(slots, 1, new MsvcRandom(0))).toEqual([5]);
    expect(polyPickSlots(slots, 3, new MsvcRandom(0))).toEqual([5, 1, 6]);
  });

  it("ne retient jamais un emplacement vide et s'arrête quand le plateau est vide", () => {
    const slots = slotsFromLayout(layout);
    for (let i = 0; i < 9; i++) slots[i]!.type = null;
    const rng = new MsvcRandom(7);
    expect(polyPickSlots(slots, 5, rng).sort((a, b) => a - b)).toEqual([9, 10]);
  });
});

describe("adaptation du niveau (applyGameResult)", () => {
  const fresh = (): RocketsState => createState(Array.from({ length: 11 }, () => ({ type: 0, x: 0, y: 0 })), new MsvcRandom(0));

  it("départ : niveau 2, séries à 0, M dans [2, 5]", () => {
    const state = fresh();
    expect(state.polyLevel).toBe(2);
    expect([state.childStreak, state.polyStreak]).toEqual([0, 0]);
    expect(state.maxTake).toBeGreaterThanOrEqual(2);
    expect(state.maxTake).toBeLessThanOrEqual(5);
  });

  it("défaut d'origine reproduit : 4 victoires de Poly → niveaux 2, 1, 1, 1 (séries 1, 2, 3, 4) ; puis 6 victoires de l'enfant → 1, 2, 2, 3, 3, 4", () => {
    expect(DEFAULT_RULES.polyStreakResets).toBe(false);
    const state = fresh();
    const levels: number[] = [];
    const polyStreaks: number[] = [];
    for (let i = 0; i < 4; i++) {
      applyGameResult(state, "poly");
      levels.push(state.polyLevel);
      polyStreaks.push(state.polyStreak);
    }
    expect(levels).toEqual([2, 1, 1, 1]);
    expect(polyStreaks).toEqual([1, 2, 3, 4]);
    const childLevels: number[] = [];
    const childStreaks: number[] = [];
    for (let i = 0; i < 6; i++) {
      applyGameResult(state, "child");
      childLevels.push(state.polyLevel);
      childStreaks.push(state.childStreak);
    }
    expect(childLevels).toEqual([1, 2, 2, 3, 3, 4]);
    expect(childStreaks).toEqual([1, 0, 1, 0, 1, 0]);
    expect(state.polyStreak).toBe(0); // une victoire de l'enfant remet la série de Poly à 0
  });

  it("polyStreakResets = true (correction) : 4 victoires de Poly → niveaux 2, 1, 1, 0", () => {
    const state = fresh();
    const levels: number[] = [];
    for (let i = 0; i < 4; i++) {
      applyGameResult(state, "poly", { polyStreakResets: true });
      levels.push(state.polyLevel);
    }
    expect(levels).toEqual([2, 1, 1, 0]);
  });

  it("le niveau reste borné entre 0 et 4 et polyHasPlayed repart à faux", () => {
    const state = fresh();
    state.polyHasPlayed = true;
    for (let i = 0; i < 20; i++) applyGameResult(state, "child");
    expect(state.polyLevel).toBe(4);
    expect(state.polyHasPlayed).toBe(false);
    for (let i = 0; i < 20; i++) {
      applyGameResult(state, i % 3 === 2 ? "child" : "poly", { polyStreakResets: true });
      expect(state.polyLevel).toBeGreaterThanOrEqual(0);
      expect(state.polyLevel).toBeLessThanOrEqual(4);
    }
  });
});

describe("règles d'une partie", () => {
  const layout11 = Array.from({ length: 11 }, (_, i) => ({ type: i % 21, x: i * 20, y: 0 }));
  const make = (): RocketsState => {
    const state = createState(layout11, new MsvcRandom(0));
    state.maxTake = 3;
    return state;
  };

  it("M : cycle 5 → 2 contre Poly, 10 → 2 contre un ami ; ramené à 3 hors de [2, 5] en passant en mode Poly", () => {
    expect(nextMaxTake("poly", 2)).toBe(3);
    expect(nextMaxTake("poly", 5)).toBe(2);
    expect(nextMaxTake("friend", 9)).toBe(10);
    expect(nextMaxTake("friend", 10)).toBe(2);
    expect(maxTakeForPoly(8)).toBe(3);
    expect(maxTakeForPoly(4)).toBe(4);
  });

  it("M ne change qu'au début ou à la fin d'une partie", () => {
    const state = make();
    expect(canChangeMaxTake(state)).toBe(true);
    launch(state, 0, "child");
    expect(canChangeMaxTake(state)).toBe(false);
  });

  it("tour automatique de Poly quand l'enfant a lancé M fusées et qu'il en reste ; rappel s'il n'en a lancé aucune", () => {
    const state = make();
    expect(polyClickKind(state)).toBe("play"); // Poly commence
    for (let i = 0; i < 3; i++) launch(state, i, "child");
    expect(autoTurnPending(state)).toBe(true);
    state.launchedThisTurn = 0;
    expect(polyClickKind(state)).toBe("remind");
    for (let i = 3; i < 11; i++) launch(state, i, "child");
    expect(polyClickKind(state)).toBe("over");
    expect(autoTurnPending(state)).toBe(false);
  });

  it("mode ami : aucune limite par tour, launchedThisTurn reste à 0", () => {
    const state = make();
    state.mode = "friend";
    for (let i = 0; i < 6; i++) launch(state, i, "child");
    expect(state.launchedThisTurn).toBe(0);
    expect(remaining(state)).toBe(5);
  });

  it("une nouvelle partie ne touche ni polyHasPlayed ni les séries", () => {
    const state = make();
    state.polyHasPlayed = true;
    state.polyStreak = 1;
    launch(state, 0, "poly");
    newGame(state, 11, layout11);
    expect([state.launched, state.started, state.polyHasPlayed, state.polyStreak]).toEqual([0, false, true, 1]);
  });
});

describe("pavé de nombres et tirage « ? »", () => {
  it("géométrie (rockets.md §7.4)", () => {
    expect(choosePadValue(55, 339)).toEqual({ kind: "total", total: 11 });
    expect(choosePadValue(54, 339)).toBeNull();
    expect(choosePadValue(100, 350)).toEqual({ kind: "total", total: 12 });
    expect(choosePadValue(150, 357)).toEqual({ kind: "total", total: 13 });
    expect(choosePadValue(200, 358)).toEqual({ kind: "total", total: 21 });
    expect(choosePadValue(245, 375)).toEqual({ kind: "random" });
    expect(padCell(245, 375)).toBe(11);
    expect(choosePadValue(246, 339)).toBeNull();
  });

  it("15 images, jamais N courant ni le tirage précédent", () => {
    for (let seed = 0; seed < 200; seed++) {
      const frames = randomTotalSequence(13, new MsvcRandom(seed));
      expect(frames).toHaveLength(15);
      let previous = 13;
      for (const n of frames) {
        expect(n).toBeGreaterThanOrEqual(11);
        expect(n).toBeLessThanOrEqual(21);
        expect(n).not.toBe(13);
        expect(n).not.toBe(previous);
        previous = n;
      }
    }
  });
});

describe("tirages de sons et de scripts de Poly", () => {
  it("sons de lancement : 21 ids tous parmi les 12 de DS:27f8, les 12 premiers distincts", () => {
    const ids = drawLaunchSounds(new RocketsPools(), new MsvcRandom(0));
    expect(ids).toHaveLength(21);
    for (const id of ids) expect(LAUNCH_SOUNDS).toContain(id);
    expect(new Set(ids.slice(0, 12)).size).toBe(12);
  });

  it("12ed(M, 8) : 2 → 3300 ; 3 → 3900 ou 3600 ; hors 2..5 → rien", () => {
    const rng = new MsvcRandom(3);
    expect(planAnnounceMaxTake(2, rng)).toEqual([{ scr: 3300, interruptible: true }]);
    for (let i = 0; i < 20; i++) expect([3900, 3600]).toContain(planAnnounceMaxTake(3, rng)[0]!.scr);
    expect(planAnnounceMaxTake(7, rng)).toEqual([]);
  });

  it("12ed(k, 1) : annonce de k (ou remarque rare à la place), jamais interruptible", () => {
    const pools = new RocketsPools();
    const rng = new MsvcRandom(1);
    const rare = new Set([8800, 8900]);
    const fillers = new Set([4800, 5000, 5100, 5200, 5300]);
    for (let i = 0; i < 400; i++) {
      const steps = planAnnounceTake(1 + (i % 5), rng, pools);
      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps.length).toBeLessThanOrEqual(2);
      for (const s of steps) expect(s.interruptible).toBe(false);
      if (steps.length === 1) expect(rare.has(steps[0]!.scr) || (steps[0]!.scr >= 5400 && steps[0]!.scr <= 8700)).toBe(true);
      else expect(fillers.has(steps[0]!.scr)).toBe(true);
    }
    expect(planAnnounceTake(9, new MsvcRandom(2), new RocketsPools()).every((s) => s.scr !== undefined)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("données réelles de NIM.DAT", () => {
  const archive = () => new Archive("NIM.DAT", MohawkArchive.parse(readOriginal("NIM.DAT")));

  it("dispositions : N cellules, composition par type (§2.4), premières positions de N = 11", () => {
    const a = archive();
    const composition: Record<number, Record<number, number>> = {
      11: { 7: 3, 6: 5, 15: 3 },
      12: { 8: 3, 20: 4, 18: 2, 2: 3 },
      13: { 5: 7, 9: 6 },
      14: { 0: 4, 11: 3, 14: 7 },
      15: { 12: 3, 3: 3, 4: 3, 19: 3, 16: 3 },
      16: { 17: 3, 14: 3, 0: 4, 3: 4, 10: 2 },
      17: { 11: 7, 8: 7, 2: 3 },
      18: { 16: 3, 9: 6, 1: 9 },
      19: { 20: 3, 18: 6, 9: 9, 5: 1 },
      20: { 6: 2, 13: 3, 4: 4, 12: 6, 3: 5 },
      21: { 7: 3, 19: 3, 17: 6, 15: 6, 16: 3 },
    };
    for (let total = 11; total <= 21; total++) {
      const layout = parseLayout(a.scr(layoutScrId(total)), total);
      expect(layout).toHaveLength(total);
      const counts: Record<number, number> = {};
      for (const cell of layout) counts[cell.type] = (counts[cell.type] ?? 0) + 1;
      expect(counts).toEqual(composition[total]);
    }
    const first = parseLayout(a.scr(30021), 11);
    expect(first.slice(0, 3).map((c) => [c.x, c.y])).toEqual([
      [122, 163],
      [97, 188],
      [72, 213],
    ]);
  });

  it("tables des fusées : forme pleine taille, masque 1 bit et scripts de vol présents ; tailles conformes", () => {
    const a = archive();
    expect(ROCKET_SHAPES).toHaveLength(21);
    for (let type = 0; type < 21; type++) {
      const shape = a.shap(rocketShapeId(type));
      expect([shape.width, shape.height]).toEqual([...ROCKET_SIZES[type]!]);
      const mask = a.shap(rocketMaskId(type));
      expect(mask.bitsPerPixel).toBe(1);
      expect(a.has(TAG_SCR, flightScrId(type))).toBe(true);
    }
    // Masques cités par le tableau du §2.4.
    expect([0, 1, 2, 3, 4, 5].map(rocketMaskId)).toEqual([42015, 42007, 42005, 42019, 42017, 42020]);
  });

  it("vol : zone réécrite (1070:1778) et script de 21 images de 105 ticks", () => {
    const a = archive();
    const clip = flightClip({ x: 122, y: 163 }, 7);
    expect(clip).toEqual({ left: 122 - ROCKET_OFFSET_X[7]!, right: 122 - ROCKET_OFFSET_X[7]! + 72, bottom: 163 + ROCKET_OFFSET_Y[7]!, top: 163 + ROCKET_OFFSET_Y[7]! - 354 });
    const script = a.scr(flightScrId(7));
    expect(script.frames).toHaveLength(21);
    expect(script.duration).toBe(105);
  });

  it("tous les scripts de Poly, les sons de la scène et ceux de l'aide existent dans l'archive", () => {
    const a = archive();
    for (const id of [...allPolyScripts(), ...polyScriptIds(ROCKETS_POLY)]) expect(a.has(TAG_SCR, id), `SCR ${id}`).toBe(true);
    for (const id of [3043, 3012, 3013, 3114, 3115, 3116, 201, ...LAUNCH_SOUNDS]) expect(a.has(TAG_SND, id), `SND ${id}`).toBe(true);
    for (let id = 40000; id < 40031; id++) expect(a.has(TAG_SHAP, id)).toBe(true);
  });

  it("test de clic : un pixel opaque touche, un pixel hors masque traverse ; l'indice le plus élevé est devant", () => {
    const a = archive();
    const layout = parseLayout(a.scr(layoutScrId(11)), 11);
    const slots = slotsFromLayout(layout);
    const mask = (type: number) => a.shap(rocketMaskId(type));
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      let found = false;
      for (let y = slot.y; y < slot.y + slot.h && !found; y++) {
        for (let x = slot.x; x < slot.x + slot.w; x++) {
          const hit = hitTestSlots(slots, x, y, mask);
          if (hit === i) {
            found = true;
            // Aucun emplacement d'indice supérieur ne doit toucher ce point.
            for (let j = i + 1; j < slots.length; j++) expect(hitTestSlots([slots[j]!], x, y, mask)).toBe(-1);
            break;
          }
        }
      }
      expect(found, `emplacement ${i} touchable`).toBe(true);
    }
    // Hors de tout rectangle.
    expect(hitTestSlots(slots, 0, 0, mask)).toBe(-1);
    // Une fusée lancée n'est plus touchée.
    const state = createState(layout, new MsvcRandom(0));
    launch(state, 10, "child");
    for (let y = slots[10]!.y; y < slots[10]!.y + slots[10]!.h; y++) {
      for (let x = slots[10]!.x; x < slots[10]!.x + slots[10]!.w; x++) expect(hitTestSlots(state.slots, x, y, mask)).not.toBe(10);
    }
  });
});

// --- Scène sur le moteur, données réelles ---

interface Rig {
  host: TestHost;
  engine: Engine;
  scene: RocketsScene;
  archive: Archive;
  hubEntered: () => boolean;
  frames(ms: number): Promise<void>;
  until(done: () => boolean, limitMs?: number): Promise<void>;
  idle(): Promise<void>;
}

async function boot(seed = 0): Promise<Rig> {
  const host = new TestHost();
  const engine = new Engine(host, { seed });
  const services = installServices(engine);
  const scene = createRocketsScene(services);
  let hub = false;
  const hubScene: Scene = {
    enter: () => {
      hub = true;
    },
    leave: () => services.endScene(),
    tick: () => undefined,
  };
  engine.register(SceneId.rockets, () => scene);
  engine.register(SceneId.hub, () => hubScene);
  engine.start(SceneId.rockets);
  await runFor(engine, host, 100);
  const rig: Rig = {
    host,
    engine,
    scene,
    archive: engine.ctx.resources.require("NIM.DAT"),
    hubEntered: () => hub,
    frames: (ms) => runFor(engine, host, ms),
    until: (done, limitMs = 300_000) => runUntil(engine, host, done, limitMs),
    // Quelques images pour que le clic soit traité, puis jusqu'à la fin de toute animation.
    idle: async () => {
      await runFor(engine, host, 100);
      await runUntil(engine, host, () => !scene.busy, 300_000);
    },
  };
  return rig;
}

/** Un pixel (x, y) du champ qui touche l'emplacement `slot` et que la zone de Poly (x ≥ 472) ne capte pas. */
function pixelOf(rig: Rig, slot: number): [number, number] {
  const slots = rig.scene.state.slots;
  const mask = (type: number) => rig.archive.shap(rocketMaskId(type));
  const s = slots[slot]!;
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < Math.min(s.x + s.w, 470); x++) if (hitTestSlots(slots, x, y, mask) === slot) return [x, y];
  throw new Error(`aucun pixel libre sur l'emplacement ${slot}`);
}

const POLY_BODY: [number, number] = [500, 300];
const FRIEND_BUTTON: [number, number] = [437, 360];
const POLY_BUTTON: [number, number] = [366, 360];
const HELP_BUTTON: [number, number] = [275, 338];
const EXIT_BUTTON: [number, number] = [308, 338];
const RESET_BUTTON: [number, number] = [290, 368];
const M_DIGIT: [number, number] = [284, 136];

describe.skipIf(!hasOriginalFiles)("scène Rockets sur le moteur (NIM.DAT)", () => {
  it("entrée : décor affiché, Poly entre (2000) puis salue (2100) et annonce M ; la musique 201 démarre", async () => {
    const rig = await boot();
    const { scene, host } = rig;
    expect(scene.state.mode).toBe("poly");
    expect(scene.state.total).toBe(11);
    expect(scene.state.polyLevel).toBe(2);
    expect(scene.state.maxTake).toBeGreaterThanOrEqual(2);
    expect(scene.state.maxTake).toBeLessThanOrEqual(5);
    expect(scene.polyVisible).toBe(false); // le fondu d'entrée d'abord
    await rig.idle();
    expect(scene.polyVisible).toBe(true);
    expect(scene.played[0]).toBe(2000);
    expect(scene.played[1]).toBe(2100);
    expect([3300, 3900, 3600, 4000, 3700, 4100, 3800]).toContain(scene.played[2]);
    expect(host.frames.length).toBeGreaterThan(5);
    expect(host.cursor).toBe("arrow");
    // L'écran n'est pas vide : le fond de NIM.DAT occupe la zone de jeu.
    const last = host.frames.at(-1)!;
    expect(new Set(last.pixels).size).toBeGreaterThan(50);
  });

  it("un clic interrompt la salutation (2100) ; l'annonce de M est jouée ensuite", async () => {
    const rig = await boot();
    await rig.until(() => rig.scene.played.includes(2100));
    await rig.frames(100);
    rig.host.click(300, 200);
    await rig.frames(100);
    expect(rig.scene.played[2]).toBeDefined(); // annonce de M enchaînée
    await rig.idle();
  });

  it("limite M : un clic sur le chiffre la fait cycler (5 → 2) avant la partie ; Poly la commente 2 s plus tard", async () => {
    const rig = await boot();
    await rig.idle();
    const before = rig.scene.state.maxTake;
    const announced = rig.scene.played.length;
    rig.host.click(...M_DIGIT);
    await rig.frames(100);
    expect(rig.scene.state.maxTake).toBe(before === 5 ? 2 : before + 1);
    await rig.frames(2500);
    await rig.idle();
    if (rig.scene.state.maxTake <= 5) expect(rig.scene.played.length).toBeGreaterThan(announced);
    // Quatre clics de plus : retour à la valeur de départ.
    for (let i = 0; i < 3; i++) {
      rig.host.click(...M_DIGIT);
      await rig.frames(100);
      await rig.idle();
    }
    expect(rig.scene.state.maxTake).toBe(before);
  });

  it("pavé : choisir 14 recommence avec 14 fusées ; « ? » donne un autre nombre", async () => {
    const rig = await boot();
    await rig.idle();
    rig.host.click(150, 357); // case 13
    await rig.frames(100);
    expect(rig.scene.state.total).toBe(13);
    expect(rig.scene.state.slots).toHaveLength(13);
    rig.host.click(245, 375); // « ? »
    await rig.frames(100);
    await rig.idle();
    expect(rig.scene.state.total).not.toBe(13);
    expect(rig.scene.state.total).toBeGreaterThanOrEqual(11);
    expect(rig.scene.state.total).toBeLessThanOrEqual(21);
    expect(rig.scene.state.slots.filter((s) => s.type !== null)).toHaveLength(rig.scene.state.total);
    // Reset : même N, plateau rempli.
    const total = rig.scene.state.total;
    rig.host.click(...POLY_BODY);
    await rig.idle();
    expect(rig.scene.state.launched).toBeGreaterThan(0);
    rig.host.click(...RESET_BUTTON);
    await rig.frames(100);
    expect(rig.scene.state.launched).toBe(0);
    expect(rig.scene.state.total).toBe(total);
  });

  it("partie complète : l'enfant joue le coup gagnant, Poly se trompe, l'enfant lance la dernière et gagne ; le niveau n'est pas encore remonté", async () => {
    const rig = await boot(0);
    const { scene, host } = rig;
    await rig.idle();
    host.click(...POLY_BODY); // Poly commence : son premier coup est toujours une erreur
    await rig.idle();
    let guard = 0;
    while (scene.lastResult === null) {
      if (++guard > 40) throw new Error("la partie ne se termine pas");
      const state = scene.state;
      const M = state.maxTake;
      let take = remaining(state) % (M + 1);
      if (take === 0) take = 1; // position perdante : n'arrive pas après la première erreur de Poly
      for (let i = 0; i < take; i++) {
        let slot = -1;
        for (let j = state.slots.length - 1; j >= 0; j--) if (state.slots[j]!.type !== null) { slot = j; break; }
        // Le plus en avant n'est pas forcément touchable hors de la zone de Poly : on essaie tous les emplacements pleins, du devant vers le fond.
        let point: [number, number] | null = null;
        for (let j = state.slots.length - 1; j >= 0 && !point; j--) {
          if (state.slots[j]!.type === null) continue;
          try {
            point = pixelOf(rig, j);
            slot = j;
          } catch {
            point = null;
          }
        }
        expect(point, "un emplacement touchable").not.toBeNull();
        host.click(...point!);
        await rig.idle();
        expect(state.slots[slot]!.type).toBeNull();
        if (scene.lastResult !== null) break;
      }
      if (scene.lastResult !== null) break;
      if (state.launchedThisTurn < M) {
        host.click(...POLY_BODY); // fin du tour : Poly joue
        await rig.idle();
      }
    }
    expect(scene.lastResult).toBe("child");
    expect(scene.state.launched).toBe(scene.state.total);
    expect(scene.state.childStreak).toBe(1);
    expect(scene.state.polyLevel).toBe(2);
    expect(scene.state.polyHasPlayed).toBe(false);
    // La voix de félicitations de Poly a été jouée (1200 à 1900) et la partie est terminée : un clic sur Poly rejoue « la partie est finie » (9200).
    expect(scene.played.some((id) => id >= 1200 && id <= 1900)).toBe(true);
    host.click(...POLY_BODY);
    await rig.idle();
    expect(scene.played.at(-1)).toBe(9200);
  }, 120_000);

  it("Poly joue seule quand l'enfant a lancé M fusées, puis dit « à toi »", async () => {
    const rig = await boot(2);
    const { scene, host } = rig;
    await rig.idle();
    const M = scene.state.maxTake;
    for (let i = 0; i < M; i++) {
      const state = scene.state;
      const slot = state.slots.findIndex((s, j) => s.type !== null && (() => { try { pixelOf(rig, j); return true; } catch { return false; } })());
      host.click(...pixelOf(rig, slot));
      await rig.idle();
    }
    // Le tour automatique de Poly est déjà joué (idle attend toute la file) : l'enfant a repris la main.
    expect(scene.state.launchedThisTurn).toBe(0);
    expect(scene.state.polyHasPlayed).toBe(true);
    expect(scene.state.launched).toBeGreaterThan(M);
    expect([9300, 9400, 9500, 9600]).toContain(scene.played.at(-1));
  }, 120_000);

  it("clic sur Poly sans avoir lancé de fusée alors que la partie a commencé : rappel, Poly ne joue pas", async () => {
    const rig = await boot(2);
    const { scene, host } = rig;
    await rig.idle();
    host.click(...POLY_BODY); // Poly commence
    await rig.idle();
    const launched = scene.state.launched;
    host.click(...POLY_BODY);
    await rig.idle();
    expect(scene.state.launched).toBe(launched);
    expect([9300, 9400, 9500, 9600, 4900]).toContain(scene.played.at(-1));
  }, 120_000);

  it("mode ami : Poly s'en va (9700), plus aucune limite par tour, aucune voix à la fin ; retour en mode Poly : elle revient (2000)", async () => {
    const rig = await boot(0);
    const { scene, host } = rig;
    await rig.idle();
    host.click(...FRIEND_BUTTON);
    await rig.idle();
    expect(scene.state.mode).toBe("friend");
    expect(scene.polyVisible).toBe(false);
    expect(scene.played).toContain(9700);
    expect(rig.engine.scenes.currentId).toBe(SceneId.rockets);
    const voices = scene.played.length;
    // Plus de limite : on lance M + 2 fusées d'affilée.
    const count = scene.state.maxTake + 2;
    for (let i = 0; i < count; i++) {
      const slot = scene.state.slots.findIndex((s, j) => s.type !== null && (() => { try { pixelOf(rig, j); return true; } catch { return false; } })());
      host.click(...pixelOf(rig, slot));
      await rig.idle();
    }
    expect(scene.state.launched).toBe(count);
    expect(scene.state.launchedThisTurn).toBe(0);
    expect(scene.played.length).toBe(voices);
    // Retour contre Poly : elle entre, M est annoncée, la partie est réinitialisée.
    host.click(...POLY_BUTTON);
    await rig.idle();
    expect(scene.state.mode).toBe("poly");
    expect(scene.polyVisible).toBe(true);
    expect(scene.state.launched).toBe(0);
    expect(scene.played.filter((id) => id === 2000).length).toBe(2);
  }, 120_000);

  it("aide : première fois l'introduction complète (1100) et le drapeau du roster est posé et enregistré ; ensuite la courte (4500) ; clic sur Poly : elle sort", async () => {
    const rig = await boot(0);
    const { scene, host, engine } = rig;
    const added = engine.ctx.roster.roster.addPlayer("Zoe");
    if (!added.ok) throw new Error("joueur");
    engine.ctx.roster.currentPlayerId = added.id;
    await rig.idle();
    host.click(...HELP_BUTTON);
    await rig.frames(200);
    expect(scene.helpOpen).toBe(true);
    expect(scene.helper!.played[0]).toBe(1100);
    expect(engine.ctx.roster.roster.getVar(added.id, "rocketsHelpIntroSeen")).toBe(1);
    expect(host.storage.data.size).toBeGreaterThan(0); // roster enregistré tout de suite
    host.click(300, 200); // interrompt l'introduction
    await rig.frames(300);
    expect(scene.helper!.phase).toBe("listening");
    // Un clic sur le panneau « Launch up to » : explication 1000.
    host.click(250, 136);
    await rig.frames(200);
    expect(scene.helper!.played).toContain(1000);
    host.click(300, 200); // interrompt
    await rig.frames(300);
    // Clic sur Poly : sa réplique (4300 puis 4400), l'aide se ferme.
    host.click(...POLY_BODY);
    await rig.until(() => !scene.helpOpen);
    expect(scene.helper!.played).toContain(4300);
    // Deuxième ouverture : introduction courte.
    host.click(...HELP_BUTTON);
    await rig.frames(200);
    expect(scene.helper!.played.filter((id) => id === 4500)).toHaveLength(1);
    expect(scene.helper!.played.filter((id) => id === 1100)).toHaveLength(1);
    host.click(300, 200);
    await rig.frames(300);
    host.click(...POLY_BODY);
    await rig.until(() => !scene.helpOpen);
  }, 120_000);

  it("Exit : Poly dit au revoir, fondu de sortie, retour au hub", async () => {
    const rig = await boot(0);
    await rig.idle();
    rig.host.click(...EXIT_BUTTON);
    await rig.until(() => rig.hubEntered());
    expect(rig.engine.scenes.currentId).toBe(SceneId.hub);
    expect([2200, 2300, 2400]).toContain(rig.scene.played.at(-1));
  }, 60_000);

  it("pas de commande clavier propre : les touches ne sont pas consommées", async () => {
    const rig = await boot(0);
    await rig.idle();
    expect(rig.scene.key).toBeUndefined();
  });
});
