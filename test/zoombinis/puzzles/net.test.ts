import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { TAG_SCRS } from "../../../src/games/zoombinis/data/archives";
import { parseScrs } from "../../../src/games/zoombinis/data/script";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId, type Scene } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import {
  NET_LEVELS,
  SELECTOR_ORDERS,
  aim,
  aimedTile,
  drawWall,
  endOfShot,
  flightKind,
  groupSizes,
  impact,
  isComplete,
  isWon,
  lostCount,
  netRobot,
  newNet,
  placeGroups,
  selectorCount,
  selectorRoles,
  setSelector,
  startingAmmo,
  tileCount,
  totalShots,
  wallColumn,
  wantsRegretVoice,
  type NetState,
} from "../../../src/games/zoombinis/game/puzzles/net";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type Zoombini } from "../../../src/games/zoombinis/game/state";
import {
  NET_ARRIVALS,
  NET_FIRE_REGION,
  NET_PLACES,
  NET_SPOT,
  NET_SYMBOL_REGIONS,
  ballImage,
  createNetScene,
  hopScript,
  jumpScript,
  netProbeOf,
  receptionScript,
  scriptEnd,
} from "../../../src/games/zoombinis/scenes/puzzles/net";
import { BUTTON_GO, BUTTON_MAP, HELP_KEY } from "../../../src/games/zoombinis/scenes/puzzle-kit";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

// ---------------------------------------------------------------------------------------------------------------------------
// Règles

/** Valeurs des sélecteurs (rangées 1 à 3) qui visent `tile` : essai de tous les triplets (les niveaux 0 et 1 ignorent la rangée 1). */
function selectorsFor(state: NetState, tile: number): number[] {
  for (let a = 0; a < 5; a++) {
    for (let b = 0; b < 5; b++) {
      for (let c = 0; c < (state.level < 2 ? 1 : 5); c++) {
        const selectors = [state.level < 2 ? -1 : c, a, b];
        if (aimedTile(state, selectors) === tile) return selectors;
      }
    }
  }
  throw new Error(`aucun réglage ne vise la dalle ${tile}`);
}

describe("règles de la muraille de signes : constantes et groupes", () => {
  it("niveaux : 25 ou 125 dalles, 2 ou 3 sélecteurs, munitions 7 + groupes (+ 1 au niveau 3)", () => {
    expect(NET_LEVELS).toBe(4);
    expect([0, 1, 2, 3].map(tileCount)).toEqual([25, 25, 125, 125]);
    expect([0, 1, 2, 3].map(selectorCount)).toEqual([2, 2, 3, 3]);
    expect([0, 1, 2, 3].map((level) => startingAmmo(level, 8))).toEqual([15, 15, 15, 16]);
  });

  it.each([
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [2, 2]],
    [5, [3, 2]],
    [7, [2, 1, 1, 3]],
    [16, [2, 2, 1, 3, 2, 1, 3, 2]],
  ])("taille des groupes (1120:2d8d) : %i Zoombinis → %j", (n, sizes) => {
    expect(groupSizes(n)).toEqual(sizes);
  });

  it("la somme des groupes vaut toujours le nombre de Zoombinis, et chaque groupe fait 1 à 3", () => {
    for (let n = 1; n <= 16; n++) {
      const sizes = groupSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0), `n = ${n}`).toBe(n);
      for (const size of sizes) {
        expect(size).toBeGreaterThanOrEqual(1);
        expect(size).toBeLessThanOrEqual(3);
      }
    }
    expect(groupSizes(0)).toEqual([]);
  });
});

describe("règles de la muraille de signes : mur et tirages", () => {
  // Valeurs relevées une fois (n = 16, graines 1 à 3) : une régression de l'ordre des tirages les ferait bouger.
  it.each([
    [0, 1, [1, 0, 4], "2:2 6:3 9:1 11:2 13:2 17:3 21:1 24:2", false, 0, [3, 3, 3, 3, 3, 2, 2, 2, 2, 2], [2, 0, 3, 1, 4, 2, 0, 3, 1, 4]],
    [0, 2, [0, 1, 3], "2:2 4:3 7:3 9:2 10:2 15:1 18:1 19:2", false, 0, [3, 3, 3, 3, 3, 0, 0, 0, 0, 0], [2, 1, 0, 4, 3, 2, 1, 0, 4, 3]],
    [0, 3, [3, 1, 2], "1:2 2:2 4:3 7:3 16:1 17:2 18:2 20:1", false, 0, [4, 4, 4, 4, 4, 2, 2, 2, 2, 2], [1, 3, 4, 2, 0, 1, 3, 4, 2, 0]],
    [1, 1, [1, 0, 4], "2:3 6:1 9:2 11:2 13:3 17:1 18:2 21:2", false, 0, [3, 3, 3, 3, 3, 2, 2, 2, 2, 2], [2, 0, 3, 1, 4, 3, 1, 4, 2, 0]],
    [1, 2, [0, 1, 3], "2:2 4:1 7:1 10:3 15:2 18:2 19:3 20:2", true, 0, [3, 3, 3, 3, 3, 0, 0, 0, 0, 0], [2, 1, 0, 4, 3, 4, 3, 2, 1, 0]],
    [1, 3, [3, 1, 2], "1:2 2:3 4:1 6:2 7:1 16:2 17:3 20:2", false, 0, [4, 4, 4, 4, 4, 2, 2, 2, 2, 2], [1, 3, 4, 2, 0, 2, 0, 1, 3, 4]],
    [2, 1, [1, 0, 4], "2:2 7:2 41:3 77:1 88:3 93:1 105:2 110:2", false, 0, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 0, 0, 0, 0, 0]],
    [2, 2, [0, 1, 3], "4:2 26:2 31:3 33:2 34:3 75:1 106:1 122:2", false, 0, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 0, 0, 0, 0, 0]],
    [2, 3, [3, 1, 2], "13:1 16:3 32:2 47:2 100:2 103:2 109:1 111:3", false, 0, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4], [1, 1, 1, 1, 1, 3, 3, 3, 3, 3]],
    [3, 1, [1, 0, 4], "21:2 41:2 64:3 77:2 88:2 93:3 105:1 110:1", false, 2, [3, 0, 4, 2, 1, 3, 0, 4, 2, 1], [2, 2, 2, 2, 2, 0, 0, 0, 0, 0]],
    [3, 2, [0, 1, 3], "31:2 33:1 34:2 64:2 75:2 77:3 106:3 122:1", false, 0, [3, 2, 0, 1, 4, 3, 2, 0, 1, 4], [2, 2, 2, 2, 2, 0, 0, 0, 0, 0]],
    [3, 3, [3, 1, 2], "13:2 16:2 32:1 71:2 100:1 107:3 109:3 111:2", false, 4, [4, 1, 0, 2, 3, 4, 1, 0, 2, 3], [1, 1, 1, 1, 1, 3, 3, 3, 3, 3]],
  ])("niveau %i, graine %i : sélecteurs %j, groupes « %s », échange %s, ordre %i, début de P %j et de Q %j", (level, seed, selectors, marked, swap, order, p, q) => {
    const state = newNet(new MsvcRandom(seed), level, 16);
    expect(state.selectors).toEqual(selectors);
    expect(state.groups.map((g, t) => (g > 0 ? `${t}:${g}` : "")).filter(Boolean).join(" ")).toBe(marked);
    expect(state.swap).toBe(swap);
    expect(state.order).toBe(order);
    expect(state.wall.p.slice(0, 10)).toEqual(p);
    expect(state.wall.q.slice(0, 10)).toEqual(q);
  });

  it("les signes sont une bijection avec les dalles : chaque réglage vise une dalle, chaque dalle un seul réglage (2000 tirages par niveau)", () => {
    for (let level = 0; level < NET_LEVELS; level++) {
      for (let seed = 1; seed <= 2000; seed++) {
        const state = newNet(new MsvcRandom(seed), level, 16);
        const seen = new Set<number>();
        for (let a = 0; a < 5; a++) {
          for (let b = 0; b < 5; b++) {
            for (let c = 0; c < (level < 2 ? 1 : 5); c++) {
              const tile = aimedTile(state, [level < 2 ? -1 : c, a, b]);
              expect(tile, `niveau ${level}, graine ${seed}`).toBeGreaterThanOrEqual(0);
              seen.add(tile);
            }
          }
        }
        expect(seen.size, `niveau ${level}, graine ${seed}`).toBe(tileCount(level));
      }
    }
  });

  it("niveau 0 : un rang par valeur de P, une colonne par valeur de Q (carré direct) ; les rôles des sélecteurs sont (P, Q) = (2, 3) ou (3, 2)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = newNet(new MsvcRandom(seed), 0, 16);
      const { p, q } = state.wall;
      for (let t = 0; t < 25; t++) {
        expect(p[t]).toBe(p[Math.floor(t / 5) * 5]);
        expect(q[t]).toBe(q[t % 5]);
      }
      expect(new Set(p).size).toBe(5);
      expect(selectorRoles(state)).toEqual(state.swap ? [2, 1, -1] : [1, 2, -1]);
    }
  });

  it("niveau 1 : les colonnes de Q forment un carré latin, chaque rang est le précédent tourné de 2 ou de 3 crans (le même pour tous)", () => {
    const shifts = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const { q } = newNet(new MsvcRandom(seed), 1, 16).wall;
      const candidates = [2, 3].filter((s) => {
        for (let row = 1; row < 5; row++) for (let c = 0; c < 5; c++) if (q[row * 5 + c] !== q[(row - 1) * 5 + ((c - s + 5) % 5)]) return false;
        return true;
      });
      expect(candidates, `graine ${seed}`).toHaveLength(1);
      shifts.add(candidates[0]!);
      // Carré latin : chaque valeur une fois par rang et par colonne.
      for (let i = 0; i < 5; i++) {
        expect(new Set([0, 1, 2, 3, 4].map((c) => q[i * 5 + c])).size).toBe(5);
        expect(new Set([0, 1, 2, 3, 4].map((row) => q[row * 5 + i])).size).toBe(5);
      }
    }
    expect([...shifts].sort()).toEqual([2, 3]);
  });

  it("niveau 2 : P par plan, Q par rang, R par colonne ; R reprend les valeurs de Q (le `b` de 1120:1646, la troisième valeur tirée ne sert qu'au rejet)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { p, q, r } = newNet(new MsvcRandom(seed), 2, 16).wall;
      for (let t = 0; t < 125; t++) {
        expect(p[t]).toBe(p[Math.floor(t / 25) * 25]);
        expect(q[t]).toBe(q[Math.floor((t % 25) / 5) * 5]);
        // La dalle d'indice `5 × colonne` du plan 0 a pour rang la colonne de `t` : même valeur de b.
        expect(r[t]).toBe(q[(t % 5) * 5]);
      }
    }
  });

  it("niveau 3 : seul P est mélangé ; pour chaque rang, la colonne c reprend celle de c − 1 avec les cinq plans tournés de 2 ou de 3 crans (le même pour tout le mur)", () => {
    const shifts = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const { p, q, r } = newNet(new MsvcRandom(seed), 3, 16).wall;
      const candidates = [2, 3].filter((s) => {
        for (let row = 0; row < 5; row++) {
          for (let c = 1; c < 5; c++) {
            for (let plane = 0; plane < 5; plane++) {
              if (p[plane * 25 + row * 5 + c] !== p[((plane - s + 5) % 5) * 25 + row * 5 + c - 1]) return false;
            }
          }
        }
        return true;
      });
      expect(candidates, `graine ${seed}`).toHaveLength(1);
      shifts.add(candidates[0]!);
      // Q et R ne sont pas mélangés (comme au niveau 2).
      for (let t = 0; t < 125; t++) {
        expect(q[t]).toBe(q[Math.floor((t % 25) / 5) * 5]);
        expect(r[t]).toBe(q[(t % 5) * 5]);
      }
    }
    expect([...shifts].sort()).toEqual([2, 3]);
  });

  it("niveau 3 : les six affectations des sélecteurs sont tirées, le niveau 2 garde la première (`[8ba8]` = 0)", () => {
    const orders = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      orders.add(newNet(new MsvcRandom(seed), 3, 16).order);
      expect(newNet(new MsvcRandom(seed), 2, 16).order).toBe(0);
    }
    expect([...orders].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(SELECTOR_ORDERS).toHaveLength(6);
    // Cas de 1120:2657 (sélecteur 1, 2, 3 = indices 0, 1, 2) : 0 → P = s3, Q = s2, R = s1 ; 5 → P = s1, Q = s2, R = s3.
    expect(SELECTOR_ORDERS[0]).toEqual([2, 1, 0]);
    expect(SELECTOR_ORDERS[5]).toEqual([0, 1, 2]);
  });

  it("groupes : une dalle différente par groupe, taille et nombre de groupes conformes, aucune dalle déjà passée", () => {
    for (let level = 0; level < NET_LEVELS; level++) {
      for (let n = 1; n <= 16; n++) {
        const state = newNet(new MsvcRandom(n * 31 + level), level, n);
        const marked = state.groups.filter((g) => g > 0);
        expect(marked).toHaveLength(state.sizes.length);
        expect(marked.reduce((a, b) => a + b, 0)).toBe(n);
        expect([...marked].sort()).toEqual([...state.sizes].sort());
        expect(state.groups.every((g) => g >= 0)).toBe(true);
        expect(state.ammo).toBe(startingAmmo(level, state.sizes.length));
      }
    }
  });

  it("l'ordre des tirages est celui de l'original : trois sélecteurs (rand 4), le mur, les groupes, puis l'affectation", () => {
    const rng = new MsvcRandom(5);
    const selectors = [rng.rand(4), rng.rand(4), rng.rand(4)];
    const sizes = groupSizes(16);
    const wall = drawWall(rng, 3);
    const groups = placeGroups(rng, 3, sizes);
    const state = newNet(new MsvcRandom(5), 3, 16);
    expect(state.selectors).toEqual(selectors);
    expect(state.wall).toEqual(wall);
    expect(state.groups).toEqual(groups);
  });
});

describe("règles de la muraille de signes : tir, impact, munitions", () => {
  it("sélecteurs : les valeurs précédentes suivent `1120:1b9b` ; la rangée 1 n'existe pas aux niveaux 0 et 1", () => {
    const state = newNet(new MsvcRandom(1), 2, 16);
    state.selectors = [1, 2, 3];
    state.previous = [-1, -1, -1];
    expect(setSelector(state, 0, 4)).toBe(true);
    expect(state.selectors).toEqual([4, 2, 3]);
    expect(state.previous).toEqual([1, 2, -1]);
    expect(setSelector(state, 2, 0)).toBe(true);
    expect(state.previous).toEqual([4, 2, 3]);
    expect(setSelector(state, 2, 0)).toBe(false);
    expect(isComplete(state)).toBe(true);
    state.selectors[0] = -1;
    expect(isComplete(state)).toBe(false);
    const flat = newNet(new MsvcRandom(1), 0, 16);
    flat.selectors = [-1, 0, 0];
    expect(setSelector(flat, 0, 3)).toBe(false);
    expect(flat.selectors[0]).toBe(-1);
    expect(isComplete(flat)).toBe(true);
    expect(() => setSelector(flat, 1, 5)).toThrow(RangeError);
  });

  it("tir : la dalle visée est connue, `aim` mémorise les valeurs, la colonne et le vol viennent de la dalle", () => {
    for (let level = 0; level < NET_LEVELS; level++) {
      const state = newNet(new MsvcRandom(3), level, 16);
      const tile = 7;
      state.selectors = selectorsFor(state, tile) as [number, number, number];
      expect(aim(state)).toBe(tile);
      expect(state.previous).toEqual(state.selectors);
    }
    expect([0, 1, 2, 3, 4].map(flightKind)).toEqual([1, 0, 0, 0, 2]);
    expect(wallColumn(0, 13)).toBe(3);
    expect(wallColumn(1, 24)).toBe(4);
    // Niveaux 2 et 3 : 25 colonnes de dalles par rang, cinq grandes colonnes de cinq.
    expect(wallColumn(2, 25 * 3 + 12)).toBe(2);
    expect(wallColumn(3, 124)).toBe(4);
  });

  it("un groupe ne passe qu'une fois ; dalle vide, déjà passée ou hors du mur : tir manqué", () => {
    const state = newNet(new MsvcRandom(1), 0, 16);
    const full = state.groups.findIndex((g) => g > 0);
    const size = state.groups[full]!;
    expect(impact(state, full)).toBe(size);
    expect(state.freed).toBe(size);
    expect(state.hits).toBe(1);
    expect(state.groups[full]).toBe(-1);
    expect(impact(state, full)).toBe(0);
    const empty = state.groups.findIndex((g) => g === 0);
    expect(impact(state, empty)).toBe(0);
    expect(impact(state, -1)).toBe(0);
    expect(state.misses).toBe(3);
    expect(state.freed).toBe(size);
  });

  it("munitions : `munitions + 1` tirs, le dernier est joué avant l'arrêt (`[8b4a]` lu avant la décrémentation)", () => {
    for (const level of [0, 3]) {
      const state = newNet(new MsvcRandom(1), level, 16);
      expect(totalShots(state)).toBe(state.startAmmo + 1);
      let last = 0;
      for (let shot = 1; shot <= totalShots(state); shot++) {
        expect(state.exhausted).toBe(false);
        if (endOfShot(state)) last = shot;
      }
      expect(last).toBe(totalShots(state));
      expect(state.exhausted).toBe(true);
      expect(state.ammo).toBe(-1);
      // 16 tirs pour 16 Zoombinis aux niveaux 0 à 2, 17 au niveau 3.
      expect(totalShots(state)).toBe(level === 3 ? 17 : 16);
    }
  });

  it("fin : tous libérés = victoire ; les perdus sont ceux qui n'ont pas franchi le mur ; la voix de regret suppose un échec partiel", () => {
    const state = newNet(new MsvcRandom(1), 0, 16);
    expect(isWon(state)).toBe(false);
    for (let t = 0; t < 25; t++) if (state.groups[t]! > 0) impact(state, t);
    expect(isWon(state)).toBe(true);
    expect(lostCount(16, 16)).toBe(0);
    expect(lostCount(16, 5)).toBe(11);
    expect(lostCount(3, 7)).toBe(0);
    const partial = newNet(new MsvcRandom(1), 1, 16);
    partial.freed = 5;
    // `rand(4) > niveau` (ou joueur débutant) et dernier tir manqué, avec 0 < libérés < n.
    expect(wantsRegretVoice(partial, 4, true, false)).toBe(true);
    expect(wantsRegretVoice(partial, 1, true, false)).toBe(false);
    expect(wantsRegretVoice(partial, 1, true, true)).toBe(true);
    expect(wantsRegretVoice(partial, 4, false, false)).toBe(false);
    partial.freed = 0;
    expect(wantsRegretVoice(partial, 4, true, false)).toBe(false);
    partial.freed = 16;
    expect(wantsRegretVoice(partial, 4, true, false)).toBe(false);
  });
});

describe("règles de la muraille de signes : robot", () => {
  it.each([0, 1, 2, 3])("niveau %i : le robot déduit la disposition des impacts et fait passer tout le groupe dans les munitions (40 graines)", (level) => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = newNet(new MsvcRandom(seed), level, 16);
      const result = netRobot(state);
      expect(isWon(state), `niveau ${level}, graine ${seed}`).toBe(true);
      expect(state.freed).toBe(16);
      expect(result.shots.length).toBeLessThanOrEqual(totalShots(state));
      expect(result.remaining).toBeGreaterThan(0);
      // Le robot ne vise jamais deux fois la même dalle marquée.
      const released = result.shots.filter((shot) => shot.released > 0);
      expect(new Set(released.map((shot) => shot.tile)).size).toBe(released.length);
      expect(released).toHaveLength(state.sizes.length);
    }
  });

  it.each([0, 1, 2, 3])("niveau %i : tous les effectifs de 1 à 16 Zoombinis passent", (level) => {
    for (let n = 1; n <= 16; n++) {
      const state = newNet(new MsvcRandom(n * 7 + level), level, n);
      netRobot(state);
      expect(isWon(state), `niveau ${level}, ${n} Zoombinis`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Tables de l'écran et scripts

const original = originalFiles("zoombinis", "files.json");

describe("muraille : tables de l'écran", () => {
  it("quinze régions de symboles (trois rangées de cinq, de gauche à droite) et la région de tir, sans recouvrement", () => {
    expect(NET_SYMBOL_REGIONS).toHaveLength(3);
    const all = NET_SYMBOL_REGIONS.flat();
    expect(all).toHaveLength(15);
    for (const rows of NET_SYMBOL_REGIONS) {
      expect(rows).toHaveLength(5);
      for (let k = 1; k < 5; k++) expect(rows[k]!.left).toBeGreaterThan(rows[k - 1]!.left);
    }
    expect(NET_SYMBOL_REGIONS[0]![0]).toEqual({ left: 446, top: 378, right: 475, bottom: 407 });
    expect(NET_SYMBOL_REGIONS[2]![4]).toEqual({ left: 554, top: 416, right: 577, bottom: 441 });
    expect(NET_FIRE_REGION).toEqual({ left: 450, top: 275, right: 587, bottom: 362 });
    const overlap = (a: (typeof all)[number], b: (typeof all)[number]) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
    for (let i = 0; i < all.length; i++) expect(overlap(all[i]!, NET_FIRE_REGION)).toBe(false);
    // Les symboles de rangées différentes ne se recouvrent pas ; ceux d'une même rangée se touchent à 3 pixels au plus (rectangles de l'original).
    for (let row = 0; row < 3; row++) {
      for (let k = 1; k < 5; k++) expect(NET_SYMBOL_REGIONS[row]![k - 1]!.right - NET_SYMBOL_REGIONS[row]![k]!.left).toBeLessThanOrEqual(3);
      for (let other = row + 1; other < 3; other++) for (const a of NET_SYMBOL_REGIONS[row]!) for (const b of NET_SYMBOL_REGIONS[other]!) expect(overlap(a, b)).toBe(false);
    }
  });

  it("seize places d'attente (DS:19c4), seize points d'arrivée (1468:01F4) ; le départ de la balançoire est la première place", () => {
    expect(NET_PLACES).toHaveLength(16);
    expect(NET_ARRIVALS).toHaveLength(16);
    expect(NET_PLACES[0]).toEqual(NET_SPOT);
    expect(NET_PLACES[15]).toEqual({ x: 62, y: 404 });
    expect(NET_ARRIVALS[0]).toEqual({ x: 16, y: 58 });
    expect(NET_ARRIVALS[15]).toEqual({ x: 147, y: 32 });
  });

  it("image de la boule (1120:213e) : les symboles réglés choisissent l'image de la planche 7000", () => {
    const none = { selectors: [-1, -1, -1], previous: [-1, -1, -1] };
    for (const w of [1, 6, 12, 70, 190, 300]) expect(ballImage(w, none)).toBe(w);
    // Couleur (sélecteur 1 = 0 → 4) et forme (sélecteur 2 = 3 → 1) : image 6 + 4 × 12 + 1.
    expect(ballImage(6, { selectors: [0, 3, -1], previous: [-1, -1, -1] })).toBe(55);
    // Forme précédente seule : 1 + forme ; avec couleur précédente : 6 + couleur × 12 + forme.
    expect(ballImage(1, { selectors: [-1, -1, -1], previous: [-1, 1, -1] })).toBe(4);
    expect(ballImage(1, { selectors: [-1, -1, -1], previous: [2, 1, -1] })).toBe(33);
    // Style (sélecteur 3 = 2 → 2) : 66 + 2 × 22.
    expect(ballImage(66, { selectors: [-1, -1, 2], previous: [-1, -1, -1] })).toBe(110);
    expect(ballImage(185, { selectors: [-1, -1, -1], previous: [-1, -1, 1] })).toBe(185);
  });

  it("scripts des Zoombinis : identifiants selon la place et le nez", () => {
    expect([2, 1, 0].map((slot) => hopScript(slot, 1))).toEqual([13001, 13006, 13011]);
    expect(hopScript(0, 5)).toBe(13015);
    expect([2, 1, 0].map((slot) => jumpScript(slot, 1))).toEqual([13016, 13017, 13018]);
    expect(jumpScript(0, 5)).toBe(13030);
    expect([0, 1, 2].map((slot) => receptionScript(slot, 1))).toEqual([13031, 13032, 13033]);
    expect(receptionScript(2, 5)).toBe(13045);
  });

  describe.skipIf(!original.has)("sur NET.MHK", () => {
    const archive = original.has ? MohawkArchive.parse(original.read("NET.MHK")) : null;
    const script = (id: number) => parseScrs(archive!.get(TAG_SCRS, id));

    it("les 54 SCRS de l'écran existent et finissent aux points attendus (montée, saut, vol, réception)", () => {
      for (let id = 13000; id <= 13050; id++) expect(archive!.has(TAG_SCRS, id), `SCRS ${id}`).toBe(true);
      for (let id = 14000; id <= 14002; id++) expect(archive!.has(TAG_SCRS, id), `SCRS ${id}`).toBe(true);
      // Montée : la place 2 (la plus à droite) finit vers x = 405, la place 0 vers x = 325.
      expect(scriptEnd(script(hopScript(2, 1)))).toEqual({ x: 409, y: 304 });
      expect(scriptEnd(script(hopScript(0, 1))).x).toBeLessThan(335);
      expect(scriptEnd(script(hopScript(0, 1))).x).toBeGreaterThan(315);
      // Les montées partent toutes de (233, 392), le départ de la balançoire.
      for (let id = 13001; id <= 13015; id++) expect(script(id).images[0]!.cells[0]).toMatchObject({ x: 233, y: 392 });
      // Vol : il finit au-dessus du mur, de gauche à droite selon la place.
      expect([0, 1, 2].map((slot) => scriptEnd(script(14000 + slot)))).toEqual([
        { x: 203, y: 42 },
        { x: 242, y: 35 },
        { x: 283, y: 28 },
      ]);
      expect(scriptEnd(script(receptionScript(0, 1)))).toEqual({ x: 220, y: 41 });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Écran

const S = ScreenId;
const TICK_MS = 17;

function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1 + (i % 5)], i + 1));
}

const center = (rect: { left: number; top: number; right: number; bottom: number }) => ({ x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) });

describe.skipIf(!original.has)("muraille de signes : écran (écran 15, NET.MHK)", () => {
  /** L'épreuve au niveau `level` (graine 11) avec `size` Zoombinis. Le son n'est pas déverrouillé : les voix durent 0 ms. */
  async function start(level: number, options: { size?: number; lessAction?: boolean } = {}) {
    const host = new TestHost();
    const engine = createZoombinisEngine(host, { seed: 11 });
    const services = await installServices(engine);
    let scene: Scene | undefined;
    const entered: number[] = [];
    for (const id of Object.values(ScreenId)) {
      if (id === S.net) engine.register(id, () => (scene = createNetScene()));
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const zoombinis = services.game;
    zoombinis.game.group.members = party(options.size ?? 16);
    zoombinis.game.stageUnbroken = true;
    zoombinis.game.levels = [level, level, level, level];
    zoombinis.game.options.lessAction = options.lessAction ?? false;
    zoombinis.session.screen = S.net;
    engine.start(S.net);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const features = engine.services.get(FEATURES);
    const probe = () => netProbeOf(scene!)!;
    const ticks = (n: number) => runFor(engine, host, n * TICK_MS);
    /** Attend que le tir soit permis (la boule rechargée, le verrou levé). */
    const ready = async (limit = 4000) => {
      let waited = 0;
      while (!probe().canFire && waited < limit) {
        await ticks(10);
        waited += 10;
      }
      expect(probe().canFire, "le tir devrait être permis").toBe(true);
    };
    const clickRect = async (rect: { left: number; top: number; right: number; bottom: number }, wait = 6) => {
      const c = center(rect);
      host.click(c.x, c.y);
      await ticks(wait);
    };
    /** Règle les sélecteurs sur `selectors` (rangées 1 à 3) par des clics. */
    const choose = async (selectors: readonly number[]) => {
      for (let row = 0; row < 3; row++) {
        if (row === 0 && level < 2) continue;
        await clickRect(NET_SYMBOL_REGIONS[row]![selectors[row]!]!);
      }
    };
    const fire = () => clickRect(NET_FIRE_REGION, 3);
    const scripts = () => features.features.map((f) => f.scriptId);
    /** Horloge du moteur (ticks) : `ticks(1)` en avance parfois de deux (images de 16,7 ms contre des ticks de 17 ms). */
    const now = () => engine.ctx.clock.ticks;
    const crossed = () => probe().statuses.filter((status) => status === "crossed").length;
    return { host, engine, services, zoombinis, entered, features, probe, ticks, now, ready, choose, fire, scripts, crossed, clickRect, scene: scene!, dialog: engine.services.get(DIALOG), sound: engine.services.get(ZOOMBINIS_SOUND) };
  }

  it.each([0, 1, 2, 3])("niveau %i : entrée sur le fond de NET.MHK, mur, colonnes, balançoire, bulle, sélecteurs et groupe du kit", async (level) => {
    const { host, probe, ticks, scripts, features, zoombinis } = await start(level);
    const state = probe().state;
    expect(state.level).toBe(level);
    expect(state.tiles).toBe(level < 2 ? 25 : 125);
    expect(host.frames[host.frames.length - 1]!.pixels.some((p) => p !== 0)).toBe(true);
    let ids = scripts();
    // Colonnes 8000 à 8004, balançoire 8005, bulle (7001 : première étape du remplissage), catapulte 7018, bouton 10018 ; l'animation de la muraille (9151 ou 9153) joue au début.
    for (const id of [8000, 8001, 8002, 8003, 8004, 8005, 7001, 7018, 10018]) expect(ids, `SCRB ${id}`).toContain(id);
    expect(ids).toContain(level < 2 ? 9151 : 9153);
    // Les sélecteurs : rangées 2 et 3 seulement aux niveaux 0 et 1, les trois aux niveaux 2 et 3.
    expect(ids).toContain(10007 + state.selectors[1]!);
    expect(ids).toContain(10012 + state.selectors[2]!);
    expect(ids.includes(10002 + state.selectors[0]!)).toBe(level >= 2);
    expect(zoombinis.session.screen).toBe(S.net);
    // Le groupe : un personnage par Zoombini, debout ou entrant.
    expect(features.features.filter((f) => f.hasFlag(1))).toHaveLength(16);
    // Fin de l'animation de la muraille : une dalle marquée par groupe (`SCRB` 9000 + t ou 9025 + t).
    await ticks(260);
    ids = scripts();
    expect(ids).not.toContain(level < 2 ? 9151 : 9153);
    const base = level < 2 ? 9000 : 9025;
    const tiles = ids.filter((id) => id >= base && id < base + state.tiles);
    expect(tiles).toHaveLength(state.sizes.length);
    expect([...tiles].sort((a, b) => a - b)).toEqual(state.groups.map((g, t) => (g > 0 ? base + t : -1)).filter((id) => id >= 0));
  });

  it("les clics sont bloqués pendant l'entrée (bulle qui se remplit) puis le bouton de tir est prêt ; la bulle contient une étape par boule", async () => {
    const { probe, ticks, fire, choose, ready } = await start(0);
    expect(probe().inputBlocked).toBe(true);
    expect(probe().canFire).toBe(false);
    await fire();
    expect(probe().state.shots).toBe(0);
    expect(probe().locked).toBe(true);
    await ready();
    expect(probe().inputBlocked).toBe(false);
    // Les trois premiers Zoombinis sont montés sur la balançoire, le premier à la place la plus à droite.
    await ticks(300);
    expect(probe().lever.map((entry) => entry.member)).toEqual([2, 1, 0]);
    expect(probe().lever.every((entry) => entry.ready)).toBe(true);
    await choose([-1, 1, 2]);
    expect(probe().state.selectors).toEqual([-1, 1, 2]);
  });

  it("réglage des sélecteurs : le clic règle la rangée, la rangée 1 est inerte aux niveaux 0 et 1, rien ne bouge pendant un tir", async () => {
    for (const level of [0, 2]) {
      const { probe, scripts, ready, choose, fire, clickRect, ticks } = await start(level);
      await ready();
      const state = probe().state;
      await choose([3, 4, 0]);
      expect(state.selectors[1]).toBe(4);
      expect(state.selectors[2]).toBe(0);
      expect(scripts()).toContain(10007 + 4);
      expect(scripts()).toContain(10012 + 0);
      if (level < 2) {
        // Rangée 1 : région 4 à 8 inerte (la valeur reste « aucune »).
        expect(state.selectors[0]).toBe(-1);
        await clickRect(NET_SYMBOL_REGIONS[0]![2]!);
        expect(state.selectors[0]).toBe(-1);
      } else {
        expect(state.selectors[0]).toBe(3);
        expect(scripts()).toContain(10002 + 3);
      }
      // Pendant un tir (verrou `[8b8c]`), les sélecteurs sont inertes.
      await fire();
      expect(probe().locked).toBe(true);
      await clickRect(NET_SYMBOL_REGIONS[2]![3]!);
      expect(state.selectors[2]).toBe(0);
      await ticks(1);
    }
  });

  it("tir sur une dalle vide : manqué, une munition de moins, personne ne passe, le tir est de nouveau permis après le rechargement", async () => {
    const { probe, ready, choose, fire, ticks, crossed, engine } = await start(0);
    await ready();
    const state = probe().state;
    const empty = state.groups.findIndex((g) => g === 0);
    await choose(selectorsFor(state, empty));
    await fire();
    expect(probe().locked).toBe(true);
    expect(probe().shotPending).toBe(true);
    expect(probe().canFire).toBe(false);
    await ticks(160);
    // La boule a atterri : tir manqué, `[8ba6]` retombe tout de suite.
    expect(state.misses).toBe(1);
    expect(probe().shotPending).toBe(false);
    expect(state.groups[empty]).toBe(-1);
    await ready();
    expect(state.shots).toBe(1);
    expect(state.ammo).toBe(state.startAmmo - 1);
    expect(state.freed).toBe(0);
    expect(crossed()).toBe(0);
    expect(probe().pendingRelease).toBe(0);
    expect(engine.error).toBeNull();
  });

  it.each([0, 3])("niveau %i, tir qui libère un groupe : il passe le mur (balançoire, saut, vol, réception, file d'arrivée), « go » devient actif, la dalle est passée", async (level) => {
    const { probe, ready, choose, fire, ticks, crossed, engine, zoombinis, scripts } = await start(level, { size: 6 });
    await ready();
    const state = probe().state;
    const target = state.groups.findIndex((g) => g > 0);
    const size = state.groups[target]!;
    await choose(selectorsFor(state, target));
    await fire();
    await ticks(170);
    expect(state.hits).toBe(1);
    expect(state.freed).toBe(size);
    expect(state.groups[target]).toBe(-1);
    // La dalle marquée disparaît.
    expect(scripts().includes((level < 2 ? 9000 : 9025) + target)).toBe(false);
    expect(probe().kit.goEnabled).toBe(false);
    // Le verrou `[8ba6]` d'un tir qui a libéré un groupe ne tombe que 720 ticks après le dernier mouvement du groupe.
    expect(probe().shotPending).toBe(true);
    expect(probe().canFire).toBe(false);
    await ticks(1400);
    expect(engine.error).toBeNull();
    expect(crossed()).toBe(size);
    expect(probe().pendingRelease).toBe(0);
    expect(probe().kit.goEnabled).toBe(true);
    // Les Zoombinis passés sont marqués sauvés (`+0x127`), les autres non.
    const members = probe().kit.members;
    expect(members.filter((m) => m.zoombini.present)).toHaveLength(size);
    // Ils se tiennent sur les points d'arrivée, dans l'ordre.
    const places = probe().statuses.map((status, i) => (status === "crossed" ? members[i]!.snoid.position : null)).filter(Boolean);
    expect(places).toHaveLength(size);
    for (const place of places) expect(NET_ARRIVALS.some((a) => Math.abs(a.x - place!.x) <= 1 && Math.abs(a.y - place!.y) <= 1)).toBe(true);
    await ready(3000);
    expect(probe().shotPending).toBe(false);
    expect(zoombinis.game.group.members).toHaveLength(6);
  });

  it("une dalle déjà passée donne un tir manqué", async () => {
    const { probe, ready, choose, fire, ticks } = await start(0, { size: 6 });
    await ready();
    const state = probe().state;
    const target = state.groups.findIndex((g) => g > 0);
    const selectors = selectorsFor(state, target);
    await choose(selectors);
    await fire();
    await ticks(200);
    expect(state.hits).toBe(1);
    await ready(5000);
    // Même réglage : la dalle est passée.
    await choose(selectors);
    await fire();
    await ticks(170);
    expect(state.hits).toBe(1);
    expect(state.misses).toBe(1);
    expect(probe().shotPending).toBe(false);
  });

  it("munitions épuisées : `munitions + 1` tirs, puis plus aucun tir ; « go » reste éteint tant que personne n'a passé, la carte abandonne le groupe", async () => {
    const { probe, ready, choose, fire, ticks, host, dialog, zoombinis, scripts, clickRect } = await start(0, { size: 3 });
    await ready();
    const state = probe().state;
    expect(state.startAmmo).toBe(8);
    const empty = state.groups.findIndex((g) => g === 0);
    const selectors = selectorsFor(state, empty);
    for (let shot = 1; shot <= totalShots(state); shot++) {
      await ready();
      await choose(selectors);
      await fire();
      await ticks(30);
    }
    await ticks(400);
    expect(state.shots).toBe(9);
    expect(state.exhausted).toBe(true);
    expect(state.ammo).toBe(-1);
    expect(probe().canFire).toBe(false);
    await fire();
    await ticks(200);
    expect(state.shots).toBe(9);
    // Les sélecteurs restent réglables après le dernier tir.
    await clickRect(NET_SYMBOL_REGIONS[2]![(selectors[2]! + 1) % 5]!);
    expect(state.selectors[2]).toBe((selectors[2]! + 1) % 5);
    expect(scripts()).toContain(10012 + state.selectors[2]!);
    // « go » est éteint : le clic n'y change rien.
    expect(probe().kit.goEnabled).toBe(false);
    host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await ticks(40);
    expect(zoombinis.lastChange).toBeNull();
    // La carte : avertissement, « Tant pis… » abandonne le groupe entier.
    host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
    await ticks(4);
    expect(dialog.isOpen).toBe(true);
    host.press("Enter");
    await ticks(6);
    expect(zoombinis.lastChange).toMatchObject({ screen: S.map });
    expect(zoombinis.game.group.members).toHaveLength(0);
  });

  it("sortie par « go » : ceux qui ont passé sont sauvés, les autres sont perdus et rendus au camp 1", async () => {
    const { probe, ready, choose, fire, ticks, host, zoombinis, crossed } = await start(1, { size: 6 });
    await ready();
    const state = probe().state;
    // Le plus petit groupe : 1 Zoombini sauvé, 5 perdus.
    const target = state.groups.findIndex((g) => g === Math.min(...state.sizes));
    const saved = state.groups[target]!;
    await choose(selectorsFor(state, target));
    await fire();
    await ticks(1500);
    expect(crossed()).toBe(saved);
    expect(probe().kit.goEnabled).toBe(true);
    host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await ticks(600);
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.net, "success") });
    expect(zoombinis.game.group.members).toHaveLength(saved);
    expect(zoombinis.game.counters.camp1).toBe(6 - saved);
    expect(zoombinis.game.stageUnbroken).toBe(false);
  });

  it.each([0, 1, 2, 3])("niveau %i : le robot joue par l'écran, tous les Zoombinis passent et « go » mène à l'écran suivant sans perdus", async (level) => {
    const { probe, ready, choose, fire, ticks, host, zoombinis, crossed, engine } = await start(level, { size: 5 });
    await ready();
    const state = probe().state;
    // Le robot joue sur une copie de l'état : le même mur, vu seulement par ses impacts.
    const shots = netRobot(structuredClone(state)).shots;
    for (const shot of shots) {
      await ready(5000);
      await choose(shot.selectors);
      await fire();
      await ticks(30);
    }
    await ticks(1600);
    expect(engine.error).toBeNull();
    expect(state.freed).toBe(5);
    expect(isWon(state)).toBe(true);
    expect(crossed()).toBe(5);
    expect(probe().kit.members.every((m) => m.zoombini.present)).toBe(true);
    host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await ticks(700);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.net, "success") });
    expect(zoombinis.game.group.members).toHaveLength(5);
    expect(zoombinis.game.counters.camp1).toBe(0);
    // Dernière épreuve de l'étape 3 sans perdus : le monument est posé.
    expect(zoombinis.game.monuments.some((m) => m !== null && m.stage === 3 && m.level === level + 1)).toBe(true);
  }, 120000);

  it("F1 rejoue la voix d'introduction (20064) ; aucune musique", async () => {
    const { host, sound, ticks } = await start(0);
    await ticks(30);
    const before = host.audio.waves.length;
    host.press(HELP_KEY, { key: HELP_KEY });
    await ticks(4);
    expect(host.audio.waves.length).toBeGreaterThan(before);
    expect(sound.lastMusicId).toBe(0);
  });

  it("une partie enregistrée pendant l'épreuve retrouve son groupe entier", async () => {
    const { engine, zoombinis } = await start(0);
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(16);
  });

  it.each([false, true])("« moins d'action » = %s : la boule atteint la dalle en cinq pas de 3 ticks, sans trajet avec l'option", async (lessAction) => {
    const { probe, ready, choose, fire, ticks, scripts, now } = await start(0, { size: 6, lessAction });
    await ready();
    const state = probe().state;
    const empty = state.groups.findIndex((g) => g === 0);
    await choose(selectorsFor(state, empty));
    await fire();
    let started = -1;
    let landed = -1;
    for (let i = 0; i < 200 && landed < 0; i++) {
      await ticks(1);
      if (started < 0 && scripts().some((id) => id >= 7020 && id <= 7022)) started = now();
      if (state.misses === 1) landed = now();
    }
    expect(started).toBeGreaterThanOrEqual(0);
    expect(landed).toBeGreaterThan(started);
    // Cinq positions de 3 ticks avant l'impact ; avec l'option, un seul pas.
    if (lessAction) expect(landed - started).toBeLessThanOrEqual(6);
    else expect(landed - started).toBeGreaterThanOrEqual(12);
  });
});
