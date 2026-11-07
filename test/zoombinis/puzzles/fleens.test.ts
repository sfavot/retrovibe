import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { parseRegs } from "../../../src/games/zoombinis/data/regs";
import { parseScrs } from "../../../src/games/zoombinis/data/script";
import {
  FLEENS_BRANCH_POINTS,
  FLEENS_QUEUE,
  FLEENS_RULE_BYTES,
  FLEENS_TERRACE_POINTS,
  canGo,
  canTry,
  cousinAttrs,
  endClosure,
  fleensView,
  goExit,
  groupAfterExit,
  isSolved,
  mapExit,
  newFleensRule,
  possibleSpecials,
  prepareFleens,
  robotChoice,
  runRobot,
  tryMember,
} from "../../../src/games/zoombinis/game/puzzles/fleens";
import { type Zoombini, makeZoombini } from "../../../src/games/zoombinis/game/state";
import { originalFiles } from "../../support/original";

// Le robot explore les mondes possibles sur 48 parties : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

/** Un groupe de `n` Zoombinis tous différents, tirés avec la graine. */
function group(n: number, seed: number): Zoombini[] {
  const rng = new MsvcRandom(seed);
  const seen = new Set<string>();
  const out: Zoombini[] = [];
  while (out.length < n) {
    const attrs = [rng.range(1, 5), rng.range(1, 5), rng.range(1, 5), rng.range(1, 5)];
    if (seen.has(attrs.join())) continue;
    seen.add(attrs.join());
    out.push(makeZoombini(attrs, out.length + 1));
  }
  return out;
}

describe("nizibooms : cousins", () => {
  it("un décalage de 1 laisse l'attribut, 2 à 5 le décalent de 1 à 4 crans (cyclique)", () => {
    const identity = Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(cousinAttrs([1, 2, 3, 4], identity)).toEqual([1, 2, 3, 4]);
    const shifted = Uint8Array.from([2, 3, 4, 5, 0, 0, 0, 0]);
    expect(cousinAttrs([1, 2, 3, 4], shifted)).toEqual([2, 4, 1, 3]);
    expect(cousinAttrs([5, 5, 5, 5], shifted)).toEqual([1, 2, 3, 4]);
  });

  it("la permutation range l'attribut j à la position S[0x10 + j]", () => {
    const rule = Uint8Array.from([1, 1, 1, 1, 3, 1, 4, 2]);
    // attribut 0 (cheveux) en position 3, attribut 1 en 1, attribut 2 en 4, attribut 3 en 2
    expect(cousinAttrs([5, 4, 3, 2], rule)).toEqual([4, 2, 5, 3]);
  });
});

describe("nizibooms : fabrication de l'écran (10e0:1b29)", () => {
  it("suit l'ordre des tirages de l'original (niveau 0, règle neuve)", () => {
    const members = group(16, 7);
    const state = prepareFleens(members, 0, newFleensRule(), new MsvcRandom(42));
    const rng = new MsvcRandom(42);
    const a = rng.range(1, 16);
    let b = a;
    while (b === a) b = rng.range(1, 16);
    let c = a;
    while (c === a || c === b) c = rng.range(1, 16);
    expect(state.specials).toEqual([a - 1, b - 1, c - 1]);
    const shifts = [0, 1, 2, 3].map(() => rng.range(1, 5));
    expect([...state.rule]).toEqual([...shifts, 0, 0, 0, 0]);
    const idles = members.map(() => rng.range(0, 80));
    expect(state.cousins.map((x) => x.idle)).toEqual(idles);
  });

  it("niveau 3 : permutation tirée avec un tirage sans remise sur le masque 1 << (k - 1)", () => {
    const state = prepareFleens(group(16, 3), 3, newFleensRule(), new MsvcRandom(5));
    const rng = new MsvcRandom(5);
    const a = rng.range(1, 16);
    let b = a;
    while (b === a) b = rng.range(1, 16);
    let c = a;
    while (c === a || c === b) c = rng.range(1, 16);
    for (let j = 0; j < 4; j++) rng.range(1, 5);
    const k = rng.range(2, 4);
    // même suite que le jeu : départ = rand(3), balayage circulaire, bits déjà pris sautés
    let bits = 1 << (k - 1);
    const expected = [k];
    for (let j = 0; j < 3; j++) {
      const start = rng.rand1(4);
      let v = start;
      while (bits & (1 << v)) v = (v + 1) % 4;
      bits |= 1 << v;
      expected.push(v + 1);
    }
    expect([...state.rule].slice(4)).toEqual(expected);
  });

  it("4 niveaux : spéciaux, positions, règle valide", () => {
    for (let level = 0; level < 4; level++) {
      for (let seed = 1; seed <= 20; seed++) {
        const members = group(16, seed);
        const state = prepareFleens(members, level, newFleensRule(), new MsvcRandom(seed * 17));
        expect(state.cousins).toHaveLength(16);
        expect(state.specials).toHaveLength(3);
        expect(new Set(state.specials).size).toBe(3);
        const branch = state.cousins.filter((c) => c.special);
        expect(branch.map((c) => c.member).sort((x, y) => x - y)).toEqual([...state.specials].sort((x, y) => x - y));
        expect(branch.map((c) => c.position)).toEqual([17, 18, 19]);
        expect(branch.map((c) => c.origin)).toEqual(FLEENS_BRANCH_POINTS);
        expect(state.cousins.filter((c) => !c.special).map((c) => c.position)).toEqual(Array.from({ length: 13 }, (_, i) => i));
        for (const c of state.cousins) expect(c.idle).toBeGreaterThanOrEqual(0), expect(c.idle).toBeLessThanOrEqual(80);
        const [s0, s1, s2, s3, p0, p1, p2, p3] = [...state.rule];
        for (const s of [s0, s1, s2, s3]) expect(s).toBeGreaterThanOrEqual(1), expect(s).toBeLessThanOrEqual(5);
        if (level < 2) expect([p0, p1, p2, p3]).toEqual([0, 0, 0, 0]);
        else {
          expect([p0, p1, p2, p3].sort()).toEqual([1, 2, 3, 4]);
          expect(p0).toBeGreaterThanOrEqual(2);
          // les cousins sont une bijection des Zoombinis
          expect(new Set(state.cousins.map((c) => c.attrs.join())).size).toBe(16);
        }
        for (const c of state.cousins) expect(c.attrs).toEqual(cousinAttrs(members[c.member]!.attrs, state.rule));
      }
    }
  });

  it("niveaux 0 et 2 gardent la règle d'une entrée à l'autre ; niveaux 1 et 3 la tirent de nouveau", () => {
    for (const level of [0, 2]) {
      const rule = newFleensRule();
      prepareFleens(group(16, 1), level, rule, new MsvcRandom(11));
      const before = [...rule];
      prepareFleens(group(16, 1), level, rule, new MsvcRandom(99));
      expect([...rule]).toEqual(before);
    }
    for (const level of [1, 3]) {
      const rule = newFleensRule();
      prepareFleens(group(16, 1), level, rule, new MsvcRandom(11));
      const before = [...rule];
      const rng = new MsvcRandom(99);
      prepareFleens(group(16, 1), level, rule, rng);
      const check = new MsvcRandom(99);
      check.range(1, 16);
      expect([...rule].slice(0, 4).every((v) => v >= 1 && v <= 5)).toBe(true);
      expect(rule.length).toBe(FLEENS_RULE_BYTES);
      expect(before).not.toEqual([...rule]);
    }
  });

  it("n = 1, 2, 3 : cocons remplis d'avance et nombre de spéciaux", () => {
    const cases: [number, number, number][] = [
      [1, 2, 1],
      [2, 1, 2],
      [3, 0, 3],
      [8, 0, 3],
    ];
    for (const [n, cocoons, specials] of cases) {
      const state = prepareFleens(group(n, 2), 0, newFleensRule(), new MsvcRandom(n));
      expect(state.cocoons).toBe(cocoons);
      expect(state.specials).toHaveLength(specials);
      expect(state.cousins.filter((c) => c.special)).toHaveLength(specials);
    }
    const none = prepareFleens([], 0, newFleensRule(), new MsvcRandom(1));
    expect(none.cousins).toHaveLength(0);
  });

  it("les membres perdus ne comptent pas ; la boucle de l'original lit les n premières fiches (n = vivants)", () => {
    const members = group(6, 4);
    members[2]!.present = false;
    const state = prepareFleens(members, 0, newFleensRule(), new MsvcRandom(8));
    expect(state.count).toBe(5);
    expect(state.cousins.map((c) => c.member)).toEqual([0, 1, 3, 4]);
  });
});

describe("nizibooms : essais, cocons, fin", () => {
  function play(seed = 3, n = 16, level = 0) {
    const members = group(n, seed);
    const state = prepareFleens(members, level, newFleensRule(), new MsvcRandom(seed));
    return { members, state };
  }

  it("un essai faux ne change rien et n'est pas limité", () => {
    const { state } = play();
    const wrong = state.cousins.filter((c) => !c.special).map((c) => c.member);
    for (let i = 0; i < 40; i++) expect(tryMember(state, wrong[i % wrong.length]!)).toMatchObject({ special: false, cocoons: 0, done: false });
    expect(state.cocoons).toBe(0);
    expect(state.trials).toHaveLength(40);
    expect(canTry(state)).toBe(true);
  });

  it("trois essais justes remplissent les trois cocons ; un spécial trouvé ne compte pas deux fois", () => {
    const { state } = play(5);
    const [a, b, c] = state.specials as [number, number, number];
    expect(tryMember(state, a)).toMatchObject({ special: true, cocoons: 1, done: false });
    expect(tryMember(state, a)).toMatchObject({ special: false, cocoons: 1 });
    expect(tryMember(state, b)).toMatchObject({ special: true, cocoons: 2 });
    expect(isSolved(state)).toBe(false);
    expect(tryMember(state, c)).toMatchObject({ special: true, cocoons: 3, done: true });
    expect(isSolved(state)).toBe(true);
    // plus aucun essai (`10e0:0ae5` : [7324] < 3)
    expect(canTry(state)).toBe(false);
    expect(tryMember(state, 0)).toBeNull();
  });

  it("un membre inconnu est refusé", () => {
    const { state } = play();
    expect(tryMember(state, 99)).toBeNull();
    expect(tryMember(state, -1)).toBeNull();
  });

  it("n = 2 : deux essais justes suffisent ; n = 1 : un seul", () => {
    const two = play(2, 2).state;
    for (const m of two.specials) tryMember(two, m);
    expect(isSolved(two)).toBe(true);
    expect(two.trials).toHaveLength(2);
    const one = play(2, 1).state;
    expect(tryMember(one, 0)).toMatchObject({ special: true, done: true });
  });

  it("la file garde 7 essais au plus : le plus ancien sort quand le 7e est présent", () => {
    const { state } = play(4);
    const wrong = state.cousins.filter((c) => !c.special).map((c) => c.member);
    const ejected: (number | null)[] = [];
    expect(FLEENS_QUEUE).toBe(7);
    for (let i = 0; i < 7; i++) ejected.push(tryMember(state, wrong[i]!)!.ejected);
    expect(ejected).toEqual([null, null, null, null, null, null, wrong[0]]);
    expect(state.queue).toEqual(wrong.slice(1, 7));
    // le 8e essai remplit de nouveau la 7e place, le 9e... : chaque essai suivant éjecte le plus ancien
    expect(tryMember(state, wrong[7]!)!.ejected).toBe(wrong[1]);
    expect(state.queue).toEqual(wrong.slice(2, 8));
  });

  it("« Go » attend la fin de la clôture ; tous sauvés, attributs inchangés", () => {
    const { state, members } = play(6);
    expect(goExit(state)).toBeNull();
    for (const m of state.specials) tryMember(state, m);
    expect(canGo(state)).toBe(false);
    expect(goExit(state)).toBeNull();
    endClosure(state);
    expect(canGo(state)).toBe(true);
    const exit = goExit(state)!;
    expect(exit).toEqual({ lost: [], clean: true });
    const after = groupAfterExit(members, exit);
    expect(after.map((z) => z.attrs)).toEqual(members.map((z) => z.attrs));
    expect(after.every((z) => z.present)).toBe(true);
  });

  it("endClosure est sans effet avant le succès", () => {
    const { state } = play(6);
    endClosure(state);
    expect(state.closed).toBe(false);
  });

  it("n = 1 : le Zoombini disparaît (événement 137) et est perdu à la sortie (probable)", () => {
    const { state, members } = play(2, 1);
    tryMember(state, 0);
    endClosure(state);
    const exit = goExit(state)!;
    expect(exit).toEqual({ lost: [0], clean: false });
    expect(groupAfterExit(members, exit)[0]!.present).toBe(false);
  });

  it("le bouton carte abandonne : tout le groupe est perdu", () => {
    const { state } = play(7, 5);
    expect(mapExit(state)).toEqual({ lost: [0, 1, 2, 3, 4], clean: false });
  });
});

describe("nizibooms : robot", () => {
  it("à partir de la vue seule : les trois spéciaux font partie des cas possibles", () => {
    for (let level = 0; level < 4; level++) {
      for (let seed = 1; seed <= 6; seed++) {
        const members = group(16, seed);
        const state = prepareFleens(members, level, newFleensRule(), new MsvcRandom(seed));
        const worlds = possibleSpecials(fleensView(state, members));
        const truth = [...state.specials].sort((a, b) => a - b);
        expect(worlds.some((w) => w.join() === truth.join())).toBe(true);
      }
    }
  });

  it("réussit aux 4 niveaux, sans essai raté quand la vue détermine les spéciaux", () => {
    let exact = 0;
    let total = 0;
    for (let level = 0; level < 4; level++) {
      for (let seed = 1; seed <= 12; seed++) {
        const members = group(16, seed);
        const state = prepareFleens(members, level, newFleensRule(), new MsvcRandom(seed * 3));
        const worlds = possibleSpecials(fleensView(state, members));
        const trials = runRobot(state, members);
        expect(trials).not.toBeNull();
        expect(isSolved(state)).toBe(true);
        total++;
        if (worlds.length === 1) {
          expect(trials).toBe(3);
          exact++;
        } else {
          // plusieurs règles possibles : au plus un essai raté par cas écarté
          expect(trials!).toBeLessThanOrEqual(3 + worlds.length - 1);
        }
      }
    }
    expect(exact).toBeGreaterThan(total / 2);
  });

  it("petits groupes (n = 1, 2, 3, 5) et groupes avec des doublons", () => {
    for (const n of [1, 2, 3, 5]) {
      const members = group(n, 9);
      const state = prepareFleens(members, 2, newFleensRule(), new MsvcRandom(n + 20));
      expect(runRobot(state, members)).toBeLessThanOrEqual(Math.min(n, 3) + 6);
      expect(isSolved(state)).toBe(true);
    }
    const twins = [...group(6, 3), ...group(6, 3)].map((z, i) => makeZoombini(z.attrs, i + 1));
    const state = prepareFleens(twins, 1, newFleensRule(), new MsvcRandom(77));
    expect(runRobot(state, twins)).not.toBeNull();
    expect(isSolved(state)).toBe(true);
  });

  it("ne retente pas un Zoombini déjà essayé, et s'arrête quand c'est fini", () => {
    const members = group(10, 2);
    const state = prepareFleens(members, 0, newFleensRule(), new MsvcRandom(2));
    const seen = new Set<number>();
    while (!isSolved(state)) {
      const m = robotChoice(fleensView(state, members))!;
      expect(seen.has(m)).toBe(false);
      seen.add(m);
      tryMember(state, m);
    }
  });
});

describe.skipIf(!original.has)("nizibooms : données de FLEENS.MHK", () => {
  const archive = () => MohawkArchive.parse(original.read("FLEENS.MHK"));

  it("les points de départ sont ceux de REGS 5000 et 5001", () => {
    const regs = (id: number) => {
      const w = parseRegs(archive().get("REGS", id));
      const out: [number, number][] = [];
      for (let i = 0; i < w[0]!; i++) out.push([w[1 + 2 * i]!, w[2 + 2 * i]!]);
      return out;
    };
    expect(regs(5000)).toEqual(FLEENS_BRANCH_POINTS.map((p) => [...p]));
    expect(regs(5001)).toEqual(FLEENS_TERRACE_POINTS.map((p) => [...p]));
  });

  it("les scripts des spéciaux et des autres existent, tels que le jeu les choisit (1fd1)", () => {
    const a = archive();
    // 4004 + position (terrasse) commence au point de la position ; 4017 + i (branche) au point de la branche.
    // Les 13 premiers points suffisent à 16 membres : 4004 + 13 = 4017 est déjà le script de la branche (les 4 derniers points de la terrasse ne servent jamais).
    FLEENS_TERRACE_POINTS.slice(0, 13).forEach((p, i) => {
      const cell = parseScrs(a.get("SCRS", 4004 + i)).images[0]!.cells[0]!;
      expect([cell.x, cell.y]).toEqual([...p]);
    });
    FLEENS_BRANCH_POINTS.forEach((p, i) => {
      const cell = parseScrs(a.get("SCRS", 4017 + i)).images[0]!.cells[0]!;
      expect(Math.abs(cell.x - p[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(cell.y - p[1])).toBeLessThanOrEqual(3);
    });
    for (let id = 7000; id <= 7045; id++) expect(parseScrs(a.get("SCRS", id)).imageCount).toBeGreaterThan(0);
  });

  it("seuls les scripts du cas n = 1 font disparaître l'objet (événement 137)", () => {
    const a = archive();
    const withVanish: number[] = [];
    for (const id of [...Array.from({ length: 59 }, (_, i) => 4000 + i), ...Array.from({ length: 46 }, (_, i) => 7000 + i)]) {
      if (parseScrs(a.get("SCRS", id)).images.some((im) => im.event === 138)) withVanish.push(id);
    }
    expect(withVanish).toEqual([4026, 4027, 4028, 4029, 4030, 7041, 7042, 7043, 7044, 7045]);
  });
});
