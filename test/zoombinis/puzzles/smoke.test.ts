import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { decodeTbmpImages } from "../../../src/data/mohawk/tbmp";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { parseAnchors } from "../../../src/games/zoombinis/data/regs";
import {
  CRYSTALS,
  ORIENTATION_SET,
  SILHOUETTES,
  SILHOUETTE_SET_FRONT,
  SILHOUETTE_SET_LEFT,
  SILHOUETTE_SET_RIGHT,
  SMOKE_SHEET_ID,
  SMOKE_SHEET_REGS_X,
  SMOKE_SHEET_REGS_Y,
  type SmokeLevel,
  type SmokeState,
  applyCrystal,
  chooseMember,
  chooseSilhouette,
  createSmoke,
  endTurn,
  generateCrystals,
  goActive,
  isFinished,
  leaveSmoke,
  leverArmed,
  newRound,
  objectParts,
  partImage,
  placeCrystal,
  playRobot,
  pull,
  releaseMember,
  releaseSilhouette,
  removeCrystal,
  robotApply,
  robotPlan,
  transform,
} from "../../../src/games/zoombinis/game/puzzles/smoke";
import type { Attrs } from "../../../src/games/zoombinis/game/state";
import { originalFiles } from "../../support/original";

const original = originalFiles("zoombinis", "SMOKE.MHK");

function randomAttrs(rng: MsvcRandom): Attrs {
  return [rng.range(1, 5), rng.range(1, 5), rng.range(1, 5), rng.range(1, 5)];
}

function randomGroup(rng: MsvcRandom, n: number): Attrs[] {
  return Array.from({ length: n }, () => randomAttrs(rng));
}

describe("images de la planche 10000 (1140:0000)", () => {
  it("l'image d'un attribut est base + 5 × attribut + valeur ; les jeux sont aux bases 1, 22 et 43", () => {
    expect([SILHOUETTE_SET_LEFT, SILHOUETTE_SET_FRONT, SILHOUETTE_SET_RIGHT]).toEqual([1, 22, 43]);
    expect(partImage(1, 0, 1)).toBe(2); // cheveux 1
    expect(partImage(1, 1, 1)).toBe(7); // yeux 1
    expect(partImage(1, 2, 1)).toBe(12); // nez 1
    expect(partImage(1, 3, 5)).toBe(21); // pieds 5, dernière image du jeu
    expect(partImage(22, 3, 5)).toBe(42);
    expect(partImage(43, 0, 3)).toBe(46);
  });

  it("une silhouette complète : cristal de fond, corps, pieds, yeux, nez, cheveux ; un cristal partiel : les pièces seules", () => {
    // Silhouette (orientation 1 : jeu 22, cristal 64) : cheveux 2, yeux 3, nez 4, pieds 5.
    expect(objectParts(1, [2, 3, 4, 5])).toEqual([64, 22, 42, 30, 36, 24]);
    // Cristal posé sur l'étagère (orientation 7 : jeu 22, cristal 69) fixant le nez à 1 et les cheveux à 5.
    expect(objectParts(7, [5, 0, 1, 0])).toEqual([69, 33, 27]);
    // Orientation 3 : jeu 43 sans cristal.
    expect(objectParts(3, [1, 1, 1, 1])).toEqual([43, 59, 49, 54, 44]);
    expect(ORIENTATION_SET).toHaveLength(9);
  });

  describe.skipIf(!original.has)("sur SMOKE.MHK", () => {
    const archive = () => MohawkArchive.parse(original.read("SMOKE.MHK"));

    it("69 images : trois jeux de 21 (les jeux gauche et droite ont les mêmes tailles), six cristaux", () => {
      const images = decodeTbmpImages(archive().get("tBMP", SMOKE_SHEET_ID));
      expect(images).toHaveLength(69);
      const sizes = (from: number) => images.slice(from - 1, from + 20).map((s) => `${s.width}x${s.height}`);
      expect(sizes(SILHOUETTE_SET_RIGHT)).toEqual(sizes(SILHOUETTE_SET_LEFT));
      expect(sizes(SILHOUETTE_SET_FRONT)).not.toEqual(sizes(SILHOUETTE_SET_LEFT));
      // Les cinq pièces de chaque famille de silhouette ont des tailles voisines : les yeux, nez et pieds sont groupés par 5.
      expect(images[11]!.width).toBe(8); // nez 1 du jeu gauche
      const anchors = parseAnchors(archive().get("REGS", SMOKE_SHEET_REGS_X), archive().get("REGS", SMOKE_SHEET_REGS_Y));
      expect(anchors.x).toHaveLength(70);
      for (const image of [1, 21, 22, 42, 43, 63, 64, 69]) expect(images[image - 1]!.width).toBeGreaterThan(0);
    });
  });
});

describe("transformations et comparaison (1158:31e8, 2ad9, 2d23)", () => {
  it("un cristal fixe ses attributs ; l'attribut incrémenté passe de 5 à 1", () => {
    const a: Attrs = [2, 5, 3, 1];
    applyCrystal({ fixed: [4, 0, 0, 0], incr: 1 }, a);
    expect(a).toEqual([4, 1, 3, 1]);
    applyCrystal({ fixed: [0, 0, 0, 0], incr: 1 }, a);
    expect(a).toEqual([4, 2, 3, 1]);
  });

  function crystalState(level: 3 | 4, left: number[], right: number[]): SmokeState {
    const s = createSmoke(new MsvcRandom(1), level, [[1, 1, 1, 1]]);
    s.crystals = [
      { fixed: [0, 0, 0, 0], incr: 0 }, // 1 : cheveux + 1
      { fixed: [3, 0, 0, 0], incr: null }, // 2 : cheveux = 3
      { fixed: [0, 2, 0, 0], incr: 3 }, // 3 : yeux = 2, pieds + 1
      { fixed: [0, 0, 0, 0], incr: null },
      { fixed: [0, 0, 0, 0], incr: null },
      { fixed: [0, 0, 0, 0], incr: null },
    ];
    s.left = left;
    s.right = right;
    return s;
  }

  it("la chaîne de gauche s'applique de gauche à droite", () => {
    const s = crystalState(3, [1, 2], []);
    expect(transform(s, 0).left).toEqual([3, 1, 1, 1]); // +1 puis = 3
    const t = crystalState(3, [2, 1], []);
    expect(transform(t, 0).left).toEqual([4, 1, 1, 1]); // = 3 puis +1
  });

  it("la chaîne de droite s'applique de droite à gauche (le cristal le plus proche de la cible agit en premier)", () => {
    const s = crystalState(3, [], [2, 1]); // 1 agit d'abord (cible 1 → 2), puis 2 fixe à 3
    s.target = [1, 4, 4, 4];
    expect(transform(s, 0).right).toEqual([3, 4, 4, 4]);
    const t = crystalState(3, [], [1, 2]); // 2 fixe à 3, puis 1 ajoute 1
    t.target = [1, 4, 4, 4];
    expect(transform(t, 0).right).toEqual([4, 4, 4, 4]);
  });

  it("sauvé quand les quatre attributs sont égaux, piégé dès qu'un seul diffère", () => {
    const s = crystalState(3, [2], []);
    s.target = [3, 1, 1, 1];
    expect(transform(s, 0).saved).toBe(true);
    s.target = [3, 1, 1, 2];
    expect(transform(s, 0).saved).toBe(false);
  });
});

describe("niveau 1 : silhouettes", () => {
  it("ordre des tirages de Enter : membre de référence, jumelle, 4 attributs par silhouette, deux indices, voix", () => {
    const group = randomGroup(new MsvcRandom(7), 6);
    const s = createSmoke(new MsvcRandom(42), 1, group);

    const mirror = new MsvcRandom(42);
    const ref = mirror.range(0, 5);
    const twin = mirror.range(0, 7);
    const expected: Attrs[] = [];
    for (let k = 0; k < SILHOUETTES; k++) {
      const attrs: Attrs = [mirror.range(1, 5), mirror.range(1, 5), mirror.range(1, 5), mirror.range(1, 5)];
      expected.push(k === twin ? [...group[ref]!] : attrs);
    }
    mirror.range(0, 1);
    mirror.range(0, 1);
    const voice = mirror.range(20066, 20067);
    expect(s.silhouettes).toEqual(expected);
    expect(s.reference).toEqual(group[ref]);
    expect(s.introVoice).toBe(voice);
    expect([20066, 20067]).toContain(s.introVoice);
  });

  it("la machine teste l'égalité : poser le Zoombini sur sa jumelle le sauve, sur une autre silhouette le piège", () => {
    const group = randomGroup(new MsvcRandom(3), 4);
    const rng = new MsvcRandom(11);
    const s = createSmoke(rng, 1, group);
    const ref = group.findIndex((g) => g.every((v, i) => v === s.reference[i]));
    const twin = s.silhouettes.findIndex((x) => x.every((v, i) => v === s.reference[i]));
    expect(twin).toBeGreaterThanOrEqual(0);
    expect(chooseMember(s, ref)).toBe(true);
    expect(leverArmed(s)).toBe(false);
    expect(pull(s)).toBeNull();
    expect(chooseSilhouette(s, twin)).toBe(true);
    expect(leverArmed(s)).toBe(true);
    const wrong = s.silhouettes.findIndex((x, k) => k !== twin && !x.every((v, i) => v === group[ref]![i]));
    expect(wrong).toBeGreaterThanOrEqual(0);
    chooseSilhouette(s, wrong);
    expect(transform(s, ref).saved).toBe(false);
    chooseSilhouette(s, twin);
    expect(pull(s)!.saved).toBe(true);
    // Rien ne bouge pendant un test non enregistré.
    expect(chooseSilhouette(s, wrong)).toBe(false);
    expect(chooseMember(s, 0)).toBe(false);
    expect(goActive(s)).toBe(false);
    const end = endTurn(s, rng)!;
    expect(end.test.saved).toBe(true);
    expect(goActive(s)).toBe(true);
    expect(s.tested).toBe(1);
    expect(s.outcome[ref]).toBe(true);
    expect(end.roundAvailable).toBe(true);
    // Entre deux tours : aucune pose avant le levier « nouveau tirage ».
    expect(chooseMember(s, ref === 0 ? 1 : 0)).toBe(false);
    expect(newRound(s, rng)).toBe(true);
    expect(chooseMember(s, ref)).toBe(false); // déjà sauvé
  });

  it("reprendre le Zoombini ou la silhouette vide le cristal", () => {
    const s = createSmoke(new MsvcRandom(5), 1, randomGroup(new MsvcRandom(2), 3));
    chooseMember(s, 1);
    chooseSilhouette(s, 4);
    expect(leverArmed(s)).toBe(true);
    releaseMember(s);
    expect(leverArmed(s)).toBe(false);
    chooseMember(s, 2);
    releaseSilhouette(s);
    expect(leverArmed(s)).toBe(false);
  });

  it("une silhouette jumelle existe toujours : 100 000 tirages, le membre de référence passe avec une silhouette", { timeout: 60_000 }, () => {
    expect(referenceAlwaysPasses(1, 100000, 2024)).toBe(0);
  });
});

/** Compte les tirages (`Enter`, puis le tirage suivant après un tour) où aucune silhouette ne sauve le membre de référence. */
function referenceAlwaysPasses(level: 1 | 2, draws: number, seed: number): number {
  const rng = new MsvcRandom(seed);
  let missing = 0;
  const check = (s: SmokeState): void => {
    const probe = { ...s } as SmokeState;
    let ok = false;
    for (let k = 0; k < SILHOUETTES && !ok; k++) {
      probe.silhouette = k;
      ok = transform(probe, s.referenceMember!).saved;
    }
    if (!ok) missing++;
  };
  for (let i = 0; i < draws; i++) {
    const s = createSmoke(rng, level, randomGroup(rng, rng.range(1, 16)));
    check(s);
    // Un tour (le robot), puis le tirage suivant.
    robotApply(s, robotPlan(s)!);
    if (endTurn(s, rng)!.roundAvailable) {
      newRound(s, rng);
      check(s);
    }
  }
  return missing;
}

describe("niveau 2 : filtres", () => {
  it("quatre filtres de 0 à 2 attributs ; 100 000 tirages : le membre de référence passe toujours avec une silhouette", { timeout: 60_000 }, () => {
    const rng = new MsvcRandom(99);
    for (let i = 0; i < 2000; i++) {
      const s = createSmoke(rng, 2, randomGroup(rng, rng.range(2, 16)));
      expect(s.filters).toHaveLength(4);
      for (const f of s.filters) expect(f.filter((v) => v !== 0).length).toBeLessThanOrEqual(2);
    }
    expect(referenceAlwaysPasses(2, 100000, 2025)).toBe(0);
  });

  it("l'ordre des filtres : le filtre 2 (case 4) l'emporte sur le filtre 3 (case 5) à droite, 1 sur 0 ne le fait pas : le plus tardif gagne à gauche", () => {
    const s = createSmoke(new MsvcRandom(1), 2, [[1, 1, 1, 1]]);
    s.filters = [
      [2, 0, 0, 0],
      [3, 0, 0, 0],
      [4, 0, 0, 0],
      [5, 0, 0, 0],
    ];
    s.silhouettes[0] = [1, 1, 1, 1];
    s.silhouette = 0;
    const t = transform(s, 0);
    expect(t.left[0]).toBe(3);
    expect(t.right[0]).toBe(4);
  });

  it("à la création les silhouettes vont de 1 à 5 ; aux tirages suivants de 1 à 4, la jumelle seule pouvant porter un 5 (celui de la référence)", () => {
    const rng = new MsvcRandom(31);
    const s = createSmoke(rng, 2, randomGroup(rng, 8));
    expect(s.silhouettes).toHaveLength(8);
    expect(Math.max(...s.silhouettes.flat())).toBeLessThanOrEqual(5);
    for (let i = 0; i < 300; i++) {
      const t = createSmoke(rng, 2, randomGroup(rng, 8));
      chooseMember(t, 0);
      chooseSilhouette(t, 0);
      pull(t);
      endTurn(t, rng);
      newRound(t, rng);
      expect(t.silhouettes.filter((x) => x.includes(5)).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("niveaux 3 et 4 : cristaux, tirage et résolubilité", () => {
  const rng = new MsvcRandom(20240229);

  function solvable(level: 3 | 4, withB: boolean, draws: number, bugMissingB: boolean): number {
    let unsolvable = 0;
    for (let i = 0; i < draws; i++) {
      const a = randomAttrs(rng);
      const b = withB ? randomAttrs(rng) : null;
      const p = generateCrystals(rng, level, a, b, bugMissingB);
      const s = createSmoke(new MsvcRandom(1), level, b ? [a, b] : [a]);
      s.crystals = p.crystals;
      s.target = p.target;
      s.target2 = level === 4 ? p.target2 : null;
      if (!robotPlan(s)) unsolvable++;
    }
    return unsolvable;
  }

  it("100 000 tirages au niveau 3 avec un Zoombini suivant : toujours résolubles", { timeout: 60_000 }, () => {
    expect(solvable(3, true, 100000, true)).toBe(0);
  });

  it("100 000 tirages au niveau 4 (paire) : une même disposition sauve A contre la cible 7 et B contre la cible 8", { timeout: 60_000 }, () => {
    expect(solvable(4, true, 100000, true)).toBe(0);
  });

  it("sans Zoombini suivant, l'écriture fautive de 1158:5017 rend ~3 % des tirages insolubles ; corrigée, aucun", { timeout: 120_000 }, () => {
    const bad3 = solvable(3, false, 20000, true);
    const bad4 = solvable(4, false, 20000, true);
    expect(bad3).toBeGreaterThan(100);
    expect(bad3).toBeLessThan(1000);
    expect(bad4).toBeGreaterThan(100);
    expect(bad4).toBeLessThan(1000);
    expect(solvable(3, false, 50000, false)).toBe(0);
    expect(solvable(4, false, 50000, false)).toBe(0);
  });

  it("chaque cristal a au plus un attribut incrémenté et deux attributs au total ; les cibles sont de 1 à 5", () => {
    for (let i = 0; i < 5000; i++) {
      const level = (3 + (i & 1)) as 3 | 4;
      const p = generateCrystals(rng, level, randomAttrs(rng), randomAttrs(rng));
      expect(p.crystals).toHaveLength(CRYSTALS);
      for (const c of p.crystals) {
        const fixed = c.fixed.filter((v) => v !== 0).length;
        expect(fixed + (c.incr === null ? 0 : 1)).toBeLessThanOrEqual(2);
        expect(fixed + (c.incr === null ? 0 : 1)).toBeGreaterThanOrEqual(1);
        for (const v of c.fixed) expect(v).toBeLessThanOrEqual(5);
        if (c.incr !== null) expect(c.fixed[c.incr]).toBe(0);
      }
      for (const v of p.target) expect(v >= 1 && v <= 5).toBe(true);
      expect(p.target2).not.toBeNull();
    }
  });

  it("ordre des tirages de Enter aux niveaux 3 et 4 : membre de référence, indice, cristaux, un indice, voix", () => {
    const group = randomGroup(new MsvcRandom(5), 5);
    for (const level of [3, 4] as const) {
      const s = createSmoke(new MsvcRandom(77), level, group);
      const mirror = new MsvcRandom(77);
      mirror.range(0, 4);
      mirror.range(0, level === 3 ? 6 : 7);
      const p = generateCrystals(mirror, level, group[0]!, group[1]!);
      mirror.range(0, 1);
      const voice = mirror.range(20066, 20067);
      expect(s.crystals).toEqual(p.crystals);
      expect(s.target).toEqual(p.target);
      expect(s.target2).toEqual(level === 4 ? p.target2 : null);
      expect(s.introVoice).toBe(voice);
      expect(s.current).toBe(0);
    }
  });

  it("pose des cristaux : 3 au plus par côté, insertion à la place visée, retrait", () => {
    const s = createSmoke(new MsvcRandom(3), 3, randomGroup(new MsvcRandom(4), 3));
    expect(placeCrystal(s, 1, "left", 0)).toBe(true);
    expect(placeCrystal(s, 2, "left", 0)).toBe(true); // insère avant 1
    expect(s.left).toEqual([2, 1]);
    expect(placeCrystal(s, 3, "left", 2)).toBe(true);
    expect(placeCrystal(s, 4, "left", 0)).toBe(false); // côté plein
    expect(s.left).toEqual([2, 1, 3]);
    expect(placeCrystal(s, 4, "right", 2)).toBe(false); // place inexistante
    expect(placeCrystal(s, 4, "right", 0)).toBe(true);
    // Déplacer un cristal posé : retiré puis réinséré ; refusé sans rien perdre.
    expect(placeCrystal(s, 3, "right", 1)).toBe(true);
    expect(s.left).toEqual([2, 1]);
    expect(s.right).toEqual([4, 3]);
    removeCrystal(s, 4);
    expect(s.right).toEqual([3]);
    expect(placeCrystal(s, 7, "left", 0)).toBe(false);
  });

  it("niveau 3 : un nouveau tirage par Zoombini, permutation des étagères, le suivant se pose sur le cristal gauche", () => {
    const rng = new MsvcRandom(8);
    const group = randomGroup(rng, 4);
    const s = createSmoke(rng, 3, group);
    const before = s.crystals;
    const plan = robotPlan(s)!;
    expect(robotApply(s, plan)!.saved).toBe(true);
    const end = endTurn(s, rng)!;
    expect(end.roundAvailable).toBe(true);
    expect(end.autoTest).toBe(false);
    expect(s.current).toBeNull();
    expect(placeCrystal(s, 1, "left", 0)).toBe(false);
    expect(newRound(s, rng)).toBe(true);
    expect(s.rank).toBe(1);
    expect(s.current).toBe(1);
    expect(s.crystals).not.toEqual(before);
    expect([...s.shelf].slice(1).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(newRound(s, rng)).toBe(false);
  });

  it("mode de test (`[950a]`, F4) : le nouveau tirage laisse les étagères dans l'ordre et ne tire pas leur permutation ; sinon elles sont mélangées", () => {
    const run = (keepShelves: boolean) => {
      const rng = new MsvcRandom(8);
      const s = createSmoke(rng, 3, randomGroup(rng, 4));
      expect(s.keepShelves).toBe(false);
      s.keepShelves = keepShelves;
      expect(robotApply(s, robotPlan(s)!)!.saved).toBe(true);
      endTurn(s, rng);
      expect(newRound(s, rng)).toBe(true);
      return s;
    };
    expect(run(true).shelf).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(run(false).shelf).not.toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("niveau 4 : le second de la paire est testé sans geste, avec la même disposition, contre la cible 8", () => {
    const rng = new MsvcRandom(15);
    const group = randomGroup(rng, 4);
    const s = createSmoke(rng, 4, group);
    expect(s.target2).not.toBeNull();
    const plan = robotPlan(s)!;
    const first = robotApply(s, plan)!;
    expect(first.saved).toBe(true);
    const arrangement = { left: [...s.left], right: [...s.right] };
    const end = endTurn(s, rng)!;
    expect(end.autoTest).toBe(true);
    expect(end.roundAvailable).toBe(false);
    expect(s.second).toBe(true);
    expect(s.current).toBe(1);
    expect(placeCrystal(s, 1, "left", 0)).toBe(false);
    expect(newRound(s, rng)).toBe(false);
    const second = pull(s)!;
    expect(second.member).toBe(1);
    expect(second.saved).toBe(true);
    expect({ left: s.left, right: s.right }).toEqual(arrangement);
    const end2 = endTurn(s, rng)!;
    expect(end2.autoTest).toBe(false);
    expect(end2.roundAvailable).toBe(true);
    expect(s.second).toBe(false);
    expect(newRound(s, rng)).toBe(true);
    expect(s.rank).toBe(2);
    expect(s.current).toBe(2);
  });

  it("niveau 4, groupe impair : le dernier Zoombini est testé seul (pas de cible 8)", () => {
    const rng = new MsvcRandom(2);
    const s = createSmoke(rng, 4, randomGroup(rng, 3), false);
    playRobot(s, rng, false);
    expect(isFinished(s)).toBe(true);
    expect(s.outcome).toEqual([true, true, true]);
  });
});

describe("parties complètes avec le robot", () => {
  const rng = new MsvcRandom(555);

  for (const level of [1, 2, 3, 4] as SmokeLevel[]) {
    it(`niveau ${level} : le robot sauve tous les Zoombinis de 300 groupes de 1 à 16`, () => {
      for (let i = 0; i < 300; i++) {
        const n = rng.range(1, 16);
        const group = randomGroup(rng, n);
        const s = createSmoke(rng, level, group, false);
        const turns = playRobot(s, rng, false);
        expect(turns).toBe(n);
        expect(isFinished(s)).toBe(true);
        expect(s.savedCount).toBe(n);
        expect(leaveSmoke(s)).toEqual({ saved: group.map((_, k) => k), lost: [] });
      }
    });
  }

  it("graine fixe : la partie est reproductible", () => {
    const run = (): number[] => {
      const r = new MsvcRandom(1234);
      const s = createSmoke(r, 3, randomGroup(new MsvcRandom(9), 7), false);
      playRobot(s, r, false);
      return [s.savedCount, s.tested, r.current];
    };
    expect(run()).toEqual(run());
  });
});

describe("bilan de sortie", () => {
  it("« go » s'allume au premier sauvé ; les piégés et les non testés sont perdus", () => {
    const rng = new MsvcRandom(61);
    const group = randomGroup(rng, 5);
    const s = createSmoke(rng, 1, group);
    // Premier : un test raté (aucune silhouette ne correspond au Zoombini 0 posé sur une silhouette qui diffère).
    const twin = s.silhouettes.findIndex((x) => x.every((v, i) => v === s.reference[i]));
    const ref = group.findIndex((g) => g.every((v, i) => v === s.reference[i]));
    const other = (ref + 1) % 5;
    const wrong = s.silhouettes.findIndex((x, k) => k !== twin && !x.every((v, i) => v === group[other]![i]));
    chooseMember(s, other);
    chooseSilhouette(s, wrong);
    const lostTest = pull(s)!;
    expect(lostTest.saved).toBe(false);
    endTurn(s, rng);
    expect(goActive(s)).toBe(false);
    newRound(s, rng);
    const plan = robotPlan(s)!;
    robotApply(s, plan);
    endTurn(s, rng);
    expect(goActive(s)).toBe(true);
    expect(s.outcome.filter((o) => o === true)).toHaveLength(1);
    const { saved, lost } = leaveSmoke(s);
    expect(saved).toHaveLength(1);
    expect(lost).toHaveLength(4);
    expect(lost).toContain(other);
    expect(isFinished(s)).toBe(false);
  });
});
