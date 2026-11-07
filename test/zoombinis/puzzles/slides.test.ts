import { describe, expect, it } from "vitest";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import {
  BOARD_COLS,
  DROP_TOLERANCE,
  FEEDBACK_SOUND,
  STONE_COUNT,
  type SlidesBoard,
  chainLinks,
  createPlay,
  evaluate,
  feedbackSound,
  findDropSlot,
  generateBoard,
  go,
  pairUnits,
  pickWaitingPosition,
  place,
  rankMembers,
  remove,
  robot,
  slotPosition,
  solve,
  stateCode,
  stonePosition,
} from "../../../src/games/zoombinis/game/puzzles/slides";
import type { Attrs } from "../../../src/games/zoombinis/game/state";

const SEEDS = [1, 7, 42, 1234, 99991];

/** Groupe de `n` Zoombinis aux attributs de 1 à 5 tirés avec la graine. */
function group(n: number, seed: number): { attrs: Attrs }[] {
  const rng = new MsvcRandom(seed * 7919 + n);
  return Array.from({ length: n }, () => ({ attrs: [1 + rng.rand(4), 1 + rng.rand(4), 1 + rng.rand(4), 1 + rng.rand(4)] as Attrs }));
}

/** Les 117 couples du segment lointain `14e8:0000` pour la première colonne de chaque rangée. */
const FIRST_COLUMN_X = [477, 461, 487, 471, 497, 481, 507, 491, 517, 501, 527, 511, 537];

function check(board: SlidesBoard, n: number): void {
  expect(board.slots).toHaveLength(n);
  expect(new Set(board.slots).size).toBe(n);
  for (const c of board.slots) expect(board.stones[c]!.kind).toBe("slot");
  // Chaque voisin est réciproque : un treillis cohérent, sans liaison orpheline.
  board.stones.forEach((s, i) => {
    if (s.kind === "void") {
      expect(s.neighbors.every((j) => j === -1)).toBe(true);
      return;
    }
    for (const j of s.neighbors) if (j >= 0) expect(board.stones[j]!.neighbors).toContain(i);
  });
  for (const s of board.starts) expect(board.stones[s]!.kind).toBe("start");
}

describe("géométrie du plateau", () => {
  it("117 pierres en 13 rangées de 9 au treillis décalé", () => {
    expect(STONE_COUNT).toBe(117);
    for (let r = 0; r < 13; r++) {
      expect(stonePosition(9 * r)).toEqual({ x: FIRST_COLUMN_X[r], y: 152 + 18 * r });
      expect(stonePosition(9 * r + 8).x).toBe(FIRST_COLUMN_X[r]! - 8 * 42);
    }
    expect(stonePosition(116)).toEqual({ x: 201, y: 368 });
  });

  it("les emplacements sont décalés de (24, −5) ; les 16 positions d'attente se prennent du début ou de la fin", () => {
    expect(slotPosition(55)).toEqual({ x: stonePosition(55).x + 24, y: stonePosition(55).y - 5 });
    const taken = new Array<boolean>(16).fill(false);
    expect(pickWaitingPosition(taken, false)).toBe(0);
    expect(pickWaitingPosition(taken, true)).toBe(15);
    taken[0] = true;
    taken[15] = true;
    expect(pickWaitingPosition(taken, false)).toBe(1);
    expect(pickWaitingPosition(taken, true)).toBe(14);
    expect(pickWaitingPosition(new Array<boolean>(16).fill(true), true)).toBe(0);
  });

  it("le dépôt vise un carré de ±15 autour de la cible de l'emplacement", () => {
    const members = group(4, 1);
    const board = generateBoard(0, members, new MsvcRandom(5));
    const p = slotPosition(board.slots[2]!);
    expect(DROP_TOLERANCE).toBe(15);
    expect(findDropSlot(board, p.x + 15, p.y - 15)).toBe(2);
    expect(findDropSlot(board, p.x + 16, p.y)).toBe(-1);
  });
});

describe("niveau 0 : paires", () => {
  it("l'appariement prend le premier partenaire à partir du premier attribut tiré", () => {
    // Trois Zoombinis ; 0 et 2 partagent l'attribut 1 (valeur 2), 1 est seul.
    const members = [{ attrs: [1, 2, 3, 4] as Attrs }, { attrs: [5, 5, 5, 5] as Attrs }, { attrs: [2, 2, 4, 3] as Attrs }];
    const units = pairUnits(members, new MsvcRandom(3));
    expect(units).toHaveLength(2);
    expect(units).toContain(1);
    expect(units).toContain(-1);
  });

  it("une rangée par unité : départ, emplacement, liaison à symbole, emplacement", () => {
    const members = [{ attrs: [1, 2, 3, 4] as Attrs }, { attrs: [1, 5, 5, 5] as Attrs }];
    const board = generateBoard(0, members, new MsvcRandom(1));
    expect(board.slots).toEqual([55, 57]); // une unité : départ 54 (`DS:1d78[1]`), emplacements 55 et 57, liaison 56
    expect(board.stones[54]!.kind).toBe("start");
    expect(board.stones[56]).toMatchObject({ kind: "link", attr: 0 });
    expect(board.stones[55]!.neighbors[1]).toBe(54);
    expect(board.stones[55]!.neighbors[4]).toBe(56);
    expect(board.stones[57]!.neighbors[1]).toBe(56);
    expect([...board.solution].sort()).toEqual([0, 1]);
  });

  it("deux Zoombinis sans attribut commun : deux rangées de singletons", () => {
    const members = [{ attrs: [1, 1, 1, 1] as Attrs }, { attrs: [2, 2, 2, 2] as Attrs }];
    const board = generateBoard(0, members, new MsvcRandom(1));
    expect(board.slots).toHaveLength(2);
    expect(board.stones.filter((s) => s.kind === "link")).toHaveLength(0);
    expect(board.starts).toHaveLength(2);
  });

  it("la liaison monte si les deux Zoombinis partagent l'attribut, pas sinon ; seul l'emplacement de tête est relié", () => {
    const members = [{ attrs: [1, 2, 3, 4] as Attrs }, { attrs: [1, 5, 5, 5] as Attrs }, { attrs: [3, 3, 2, 2] as Attrs }];
    const board = generateBoard(0, members, new MsvcRandom(1));
    const link = board.stones.findIndex((s) => s.kind === "link");
    expect(board.stones[link]!.attr).toBe(0);
    const row = board.slots.slice(0, 2);
    const play = createPlay(board, members);
    place(play, 0, 0);
    expect(evaluate(play).slotState[0]).toBe("connected");
    place(play, 2, 1); // 3 ≠ 1 sur l'attribut 0 : la liaison reste basse
    let ev = evaluate(play);
    expect(ev.raised[link]).toBe(false);
    expect(ev.slotState[1]).toBe("occupied");
    place(play, 1, 1); // 1 = 1 : elle monte
    ev = evaluate(play);
    expect(ev.raised[link]).toBe(true);
    expect(ev.slotState.slice(0, 2)).toEqual(["connected", "connected"]);
    expect(stateCode(board, ev, link)).toBe(0x1f6);
    expect(stateCode(board, ev, row[0]!)).toBe(0x1fc);
  });

  it("l'emplacement de queue n'est pas relié si celui de tête est vide", () => {
    const members = [{ attrs: [1, 2, 3, 4] as Attrs }, { attrs: [1, 5, 5, 5] as Attrs }];
    const board = generateBoard(0, members, new MsvcRandom(1));
    const play = createPlay(board, members);
    place(play, 1, 1);
    expect(evaluate(play).slotState).toEqual(["free", "occupied"]);
    expect(evaluate(play).goEnabled).toBe(false);
    expect(go(play)).toBeNull();
  });
});

describe("niveau 1 : chaînes de 3", () => {
  it("la liaison est libre quand personne ne convient, et monte dès que l'emplacement précédent est relié", () => {
    const members = [{ attrs: [1, 1, 1, 1] as Attrs }, { attrs: [2, 2, 2, 2] as Attrs }];
    const codes = chainLinks(members, new MsvcRandom(1));
    expect(codes[0]).toBe(-1); // marqueur de liaison libre
    const board = generateBoard(1, members, new MsvcRandom(1));
    const link = board.stones.findIndex((s) => s.kind === "link");
    expect(board.stones[link]!.attr).toBeNull();
    const play = createPlay(board, members);
    place(play, 0, 0);
    place(play, 1, 1);
    expect(evaluate(play).raised[link]).toBe(true);
    expect(evaluate(play).victory).toBe(true);
  });

  it("une chaîne par tranche de trois membres, dernière chaîne tronquée", () => {
    for (const [n, rows] of [[1, 1], [3, 1], [4, 2], [7, 3], [16, 6]] as const) {
      const board = generateBoard(1, group(n, 2), new MsvcRandom(9));
      expect(board.starts).toHaveLength(rows);
      expect(board.slots).toHaveLength(n);
    }
  });

  it("le bris de la chaîne bloque la suite : le troisième ne se relie que si les deux liaisons montent", () => {
    // 0 = (1,1,1,1), 1 = (1,2,2,2), 2 = (3,2,3,3) : chaîne 0 -a0- 1 -a1- 2 ; l'ordre 0, 2, 1 casse la chaîne.
    const members = [{ attrs: [1, 1, 1, 1] as Attrs }, { attrs: [1, 2, 2, 2] as Attrs }, { attrs: [3, 2, 3, 3] as Attrs }];
    const board = generateBoard(1, members, new MsvcRandom(4));
    const play = createPlay(board, members);
    const plan = solve(board, members)!;
    expect(plan).toHaveLength(3);
    for (const p of plan) place(play, p.member, p.slot);
    expect(evaluate(play).victory).toBe(true);
    // Le même groupe dans l'ordre inverse sur la chaîne : le dernier emplacement n'est pas relié si le milieu n'est pas compatible.
    const swapped = createPlay(board, members);
    place(swapped, 0, 0);
    place(swapped, 2, 1);
    place(swapped, 1, 2);
    expect(evaluate(swapped).victory).toBe(false);
  });
});

describe("niveau 2 : échelle à 3 entrées", () => {
  it("18 emplacements possibles, les inutilisés deviennent des pierres libres, 3 départs", () => {
    const board = generateBoard(2, group(16, 3), new MsvcRandom(11));
    expect(board.starts).toEqual([18, 54, 90]);
    check(board, 16);
    // 3 départs + 18 liaisons + 18 emplacements (dont 2 inutilisés, devenus de simples pierres libres).
    expect(board.stones.filter((s) => s.kind !== "void")).toHaveLength(39);
    expect(board.stones.filter((s) => s.kind === "slot")).toHaveLength(16);
  });

  it("une entrée vide ne relie rien : le rail reste bas", () => {
    const members = group(6, 5);
    const board = generateBoard(2, members, new MsvcRandom(13));
    const play = createPlay(board, members);
    const ev = evaluate(play);
    expect(ev.raisedCount).toBe(0);
    expect(ev.goEnabled).toBe(false);
  });
});

describe("niveau 3 : nid d'abeilles à une entrée", () => {
  it("26 emplacements au plus, un seul départ en 54, entrée 55 ; la variante de départ est tirée en premier", () => {
    const board = generateBoard(3, group(16, 1), new MsvcRandom(21));
    expect(board.starts).toEqual([54]);
    expect([0, 1]).toContain(board.startVariant);
    expect(board.slots).toContain(55);
    expect(board.stones[55]!.neighbors).toContain(54);
    expect(new MsvcRandom(21).rand(1)).toBe(board.startVariant);
    check(board, 16);
  });

  it("5 membres et moins : chaîne droite sur la rangée 6 (55, 57, 59, 61 puis 44)", () => {
    const expected: Record<number, number[]> = { 1: [55], 2: [55, 57], 3: [55, 57, 59], 4: [55, 57, 59, 61], 5: [44, 55, 57, 59, 61] };
    for (const n of [1, 2, 3, 4, 5]) {
      const board = generateBoard(3, group(n, 6), new MsvcRandom(2));
      expect([...board.slots].sort((a, b) => a - b)).toEqual(expected[n]);
      expect(board.stones.filter((s) => s.kind !== "void").length).toBeLessThanOrEqual(10);
    }
  });

  it("sans Zoombini sur l'entrée 55 rien ne se relie, même avec tous les autres emplacements remplis", () => {
    const members = group(8, 4);
    const board = generateBoard(3, members, new MsvcRandom(31));
    const play = createPlay(board, members);
    let m = 0;
    board.slots.forEach((c, k) => {
      if (c !== 55) place(play, m++, k);
    });
    expect(evaluate(play).goEnabled).toBe(false);
  });

  it("cycle de palette : 57, 59, 61 reliés et exactement 4 emplacements occupés", () => {
    const members = group(4, 8);
    const board = generateBoard(3, members, new MsvcRandom(5));
    const play = createPlay(board, members);
    robot(play);
    expect(evaluate(play).paletteCycle).toBe(true);
    const five = group(5, 8);
    const board5 = generateBoard(3, five, new MsvcRandom(5));
    const play5 = createPlay(board5, five);
    robot(play5);
    expect(evaluate(play5).paletteCycle).toBe(false);
  });
});

describe("treillis des niveaux 2 et 3 (masques de `1150:0000`)", () => {
  it("échelle : entrée 19 entre les rails 10 et 28, sortie 24 au bout des liaisons 14 et 32, rail 11 - 12 - 13", () => {
    const board = generateBoard(2, group(16, 9), new MsvcRandom(9));
    const nb = (i: number) => board.stones[i]!.neighbors.filter((j) => j >= 0).sort((a, b) => a - b);
    expect(nb(18)).toEqual([19]);
    expect(nb(19)).toEqual([10, 18, 28]);
    expect(nb(10)).toEqual([11, 19]);
    expect(nb(12)).toEqual([11, 13]);
    expect(nb(14)).toEqual([13, 24]);
    expect(nb(32)).toEqual([24, 31]);
    expect(nb(24)).toEqual([14, 32]);
  });

  it("nid d'abeilles complet (16 membres) : l'entrée 55 touche le départ 54 et les liaisons 46, 56 et 64 ; chaque liaison relie deux emplacements", () => {
    const board = generateBoard(3, group(16, 9), new MsvcRandom(9));
    expect([...board.stones[55]!.neighbors].filter((j) => j >= 0).sort((a, b) => a - b)).toEqual([46, 54, 56, 64]);
    for (const [i, s] of board.stones.entries()) {
      if (s.kind !== "link") continue;
      const around = s.neighbors.filter((j) => j >= 0);
      expect(around.length, `case ${i}`).toBeLessThanOrEqual(6);
      if (s.attr !== null) expect(around.filter((j) => board.stones[j]!.kind === "slot")).toHaveLength(2);
    }
  });

  it("chaîne de trois sur la rangée 6 : la liaison à symbole ne monte que si les deux membres le partagent", () => {
    const members = [{ attrs: [1, 1, 1, 1] as Attrs }, { attrs: [1, 2, 3, 4] as Attrs }, { attrs: [5, 2, 5, 5] as Attrs }];
    const board = generateBoard(3, members, new MsvcRandom(2));
    expect(board.slots).toEqual([55, 57, 59]);
    expect(board.stones[56]!.attr).not.toBeNull();
    expect(board.stones[58]!.attr).not.toBeNull();
    const plan = solve(board, members)!;
    const play = createPlay(board, members);
    for (const p of plan) place(play, p.member, p.slot);
    expect(evaluate(play).victory).toBe(true);
    // Deux membres qui ne partagent pas l'attribut de la liaison 56 : le troisième emplacement reste bas.
    const bad = createPlay(board, members);
    const attr = board.stones[56]!.attr!;
    const other = members.findIndex((m, i) => i !== 0 && m.attrs[attr] !== members[0]!.attrs[attr]);
    place(bad, 0, 0);
    if (other >= 0) {
      place(bad, other, 1);
      expect(evaluate(bad).raised[56]).toBe(false);
    }
  });

  it("la solution complète des niveaux 0 et 1 est une permutation du groupe qui relie tout le monde", () => {
    for (const level of [0, 1]) {
      for (const seed of SEEDS) {
        const members = group(13, seed);
        const board = generateBoard(level, members, new MsvcRandom(seed));
        expect([...board.solution].sort((a, b) => a - b)).toEqual(members.map((_, i) => i));
        const play = createPlay(board, members);
        board.solution.forEach((m, k) => place(play, m, k));
        expect(evaluate(play).victory).toBe(true);
      }
    }
  });
});

describe("plateau résoluble et robot", () => {
  for (const level of [0, 1, 2, 3]) {
    it(`niveau ${level} : n de 1 à 16, ${SEEDS.length} graines, autant d'emplacements que de membres, le robot relie tout le groupe`, () => {
      for (let n = 1; n <= 16; n++) {
        for (const seed of SEEDS) {
          const members = group(n, seed);
          const board = generateBoard(level, members, new MsvcRandom(seed));
          check(board, n);
          const plan = solve(board, members);
          expect(plan, `niveau ${level} n=${n} graine ${seed}`).not.toBeNull();
          const play = createPlay(board, members);
          // Chaque pose est reliée au moment où elle est faite (ordre de pose valide pour l'écran).
          for (const p of plan!) {
            place(play, p.member, p.slot);
            expect(evaluate(play).connected).toContain(p.member);
          }
          const ev = evaluate(play);
          expect(ev.victory).toBe(true);
          expect(ev.goEnabled).toBe(true);
          const result = go(play)!;
          expect(result.perfect).toBe(true);
          expect(result.saved.sort((a, b) => a - b)).toEqual(members.map((_, i) => i));
        }
      }
    });
  }

  it("groupes extrêmes : tous identiques, tous différents sur l'attribut 0, un seul membre", () => {
    const same = Array.from({ length: 16 }, () => ({ attrs: [3, 3, 3, 3] as Attrs }));
    const distinct = Array.from({ length: 16 }, (_, i) => ({ attrs: [1 + (i % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5), 1 + ((i * 4) % 5)] as Attrs }));
    for (const members of [same, distinct, same.slice(0, 1), distinct.slice(0, 5)]) {
      for (const level of [0, 1, 2, 3]) {
        const board = generateBoard(level, members, new MsvcRandom(17));
        expect(board.slots).toHaveLength(members.length);
        expect(solve(board, members), `niveau ${level} n=${members.length}`).not.toBeNull();
      }
    }
  });

  it("la solution prévue par le générateur relie ses membres (niveaux 2 et 3)", () => {
    for (const level of [2, 3]) {
      for (const seed of SEEDS) {
        const members = group(14, seed);
        const board = generateBoard(level, members, new MsvcRandom(seed));
        const play = createPlay(board, members);
        const used = new Set<number>();
        board.solution.forEach((m, k) => {
          if (m >= 0) {
            place(play, m, k);
            used.add(m);
          }
        });
        const ev = evaluate(play);
        expect(ev.connected.length).toBe(used.size);
      }
    }
  });

  it("reprendre un membre : retirer ou déplacer rabaisse les liaisons dépendantes", () => {
    const members = [{ attrs: [1, 2, 3, 4] as Attrs }, { attrs: [1, 5, 5, 5] as Attrs }];
    const board = generateBoard(0, members, new MsvcRandom(1));
    const play = createPlay(board, members);
    place(play, 0, 0);
    place(play, 1, 1);
    expect(evaluate(play).victory).toBe(true);
    remove(play, 0);
    const ev = evaluate(play);
    expect(ev.connected).toEqual([]);
    expect(ev.raisedCount).toBe(0);
    expect(place(play, 0, 0)).toBe(-1);
    expect(place(play, 1, 0)).toBe(0); // 1 prend l'emplacement de 0 : 0 revient en attente
    expect(play.seat).toEqual([1, -1]);
  });

  it("robot : reprend une partie en cours et pose tout le groupe", () => {
    const members = group(10, 3);
    const board = generateBoard(2, members, new MsvcRandom(3));
    const play = createPlay(board, members);
    place(play, 0, 0);
    const plan = robot(play);
    expect(plan).not.toBeNull();
    expect(evaluate(play).victory).toBe(true);
  });
});

describe("retour d'information et rangs", () => {
  it("son de bilan selon l'évolution du nombre de pierres montées", () => {
    const at = (raisedCount: number, raisedSum = 0) => ({ raisedCount, raisedSum });
    expect(feedbackSound(at(2), at(3))).toBe(FEEDBACK_SOUND.upSmall);
    expect(feedbackSound(at(2), at(7))).toBe(FEEDBACK_SOUND.upBig);
    expect(feedbackSound(at(7), at(4))).toBe(FEEDBACK_SOUND.downSmall);
    expect(feedbackSound(at(9), at(2))).toBe(FEEDBACK_SOUND.downBig);
    expect(feedbackSound(at(3, 10), at(3, 12))).toBe(FEEDBACK_SOUND.shuffle);
    expect(feedbackSound(at(3, 10), at(3, 10))).toBeNull();
  });

  it("le rang d'un membre dépend du nombre de partenaires (le plus « partenaire » d'abord)", () => {
    const members = [{ attrs: [1, 1, 1, 1] as Attrs }, { attrs: [2, 2, 2, 2] as Attrs }, { attrs: [1, 2, 3, 4] as Attrs }];
    expect(rankMembers(members)).toEqual([2, 0, 1]);
  });

  it("colonnes du plateau : 9", () => {
    expect(BOARD_COLS).toBe(9);
  });
});
