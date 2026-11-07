import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import { decodeTbmpImages } from "../../src/data/mohawk/tbmp";
import { TAG_REGS, TAG_SCRS, TAG_TBMP } from "../../src/games/zoombinis/data/archives";
import { parseAnchors, type Anchors } from "../../src/games/zoombinis/data/regs";
import { parseScrs, type ScriptCell } from "../../src/games/zoombinis/data/script";
import {
  composeSnoidCells,
  composeSnoidImage,
  nextWaypoint,
  planPath,
  scriptAnchorOffset,
  SNOID_REGS_IDS,
  SNOID_SCRIPT_COUNT,
  SNOID_SCRIPT_FIRST,
  snoidBases,
  snoidFeetScriptId,
  snoidImageIndex,
  snoidSheet,
  snoidVoiceId,
  snoidVoiceIdForEvent,
  snoidWalkScriptId,
  startWalk,
  TABLES_LARGE,
  tickWalk,
  traitsFromIndex,
  traitsFromRecord,
  traitsIndex,
  walkLeg,
  walkSector,
  walkStep,
  ZOOMBINI_COUNT,
  type SnoidAnchors,
  type SnoidSheet,
  type WalkMap,
  type WalkState,
} from "../../src/games/zoombinis/data/zoombini";
import { originalFiles } from "../support/original";

const original = originalFiles("zoombinis", "files.json");

/** Ancres synthétiques : `REGS[i] = (i, 2 i)` pour les images 1 à 2000. */
function fakeAnchors(): Anchors {
  const x = new Int16Array(2001);
  const y = new Int16Array(2001);
  for (let i = 1; i <= 2000; i++) {
    x[i] = i;
    y[i] = 2 * i;
  }
  return { x, y };
}

const cell = (w: number, x = 0, y = 0): ScriptCell => ({ w, x, y });

describe("attributs d'un Zoombini", () => {
  it("numérote les 625 Zoombinis comme le tableau de compteurs du choix", () => {
    const seen = new Set<number>();
    for (let i = 0; i < ZOOMBINI_COUNT; i++) {
      const t = traitsFromIndex(i);
      for (const v of [t.hair, t.eyes, t.nose, t.feet]) expect(v >= 1 && v <= 5).toBe(true);
      expect(traitsIndex(t)).toBe(i);
      seen.add(i);
    }
    expect(seen.size).toBe(625);
    expect(traitsIndex({ hair: 1, eyes: 1, nose: 1, feet: 2 })).toBe(1);
    expect(traitsIndex({ hair: 5, eyes: 5, nose: 5, feet: 5 })).toBe(624);
    expect(() => traitsFromIndex(625)).toThrow(RangeError);
  });

  it("décode une fiche de 19 octets", () => {
    const record = new Uint8Array(19);
    record.set([3, 1, 4, 2], 0);
    record[8] = 1;
    record.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 9);
    expect(traitsFromRecord(record)).toEqual({ hair: 3, eyes: 1, nose: 4, feet: 2, state: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(traitsFromRecord(new Uint8Array([1, 2, 3, 4])).state).toEqual(new Array(10).fill(0));
    expect(() => traitsFromRecord(new Uint8Array(3))).toThrow();
  });
});

describe("composition d'un Zoombini (données synthétiques)", () => {
  const t = { hair: 2, eyes: 3, nose: 4, feet: 5, state: [] as number[] };

  it("range les bases par emplacement selon la pose (1168:4dc9)", () => {
    // pieds 5 = 411, nez 4 = 183, yeux 3 = 123, cheveux 2 = 27 (planche 3000)
    expect(snoidBases(t, 0).slice(0, 7)).toEqual([0, 411, 0, 183, 123, 27, 0]);
    expect(snoidBases(t, 1).slice(0, 7)).toEqual([0, 411, 183, 0, 123, 27, 0]);
    expect(snoidBases(t, 2).slice(0, 7)).toEqual([0, 0, 123, 183, 411, 27, 0]);
    expect(snoidBases(t, 3).every((b) => b === 0)).toBe(true);
    expect(snoidBases(t, 0xffff)).toHaveLength(16);
    // planche 3200 et scripts de rejet (3100)
    expect(snoidBases(t, 0, "base", true).slice(1, 6)).toEqual([278, 0, 123, 99, 27]);
    expect(snoidBases(t, 2, "reject").slice(1, 6)).toEqual([0, 144, 252, 360, 72]);
  });

  it("choisit l'image impaire (droite) ou paire (gauche) de la variante", () => {
    expect(snoidImageIndex(1)).toBe(1);
    expect(snoidImageIndex(1, 1)).toBe(2);
    expect(snoidImageIndex(445)).toBe(889);
    expect(snoidImageIndex(445, 1)).toBe(890);
    expect(snoidSheet("base")).toBe(3000);
    expect(snoidSheet("normal", true)).toBe(3200);
    expect(snoidSheet("reject", true)).toBe(3100);
  });

  it("compose les parties : base + variante, ancres retranchées, cases vides sautées mais comptées", () => {
    const anchors: SnoidAnchors = { 3000: fakeAnchors(), 3100: fakeAnchors() };
    // pose 0 : pieds, corps, nez, yeux, cheveux ; le corps (emplacement 2) est vide
    const parts = composeSnoidCells(t, [cell(2, 10, 20), cell(0), cell(3, 1, 1), cell(4, 2, 2), cell(5, 3, 3)], { pose: 0, origin: { x: 100, y: 200 }, anchors });
    expect(parts.map((p) => [p.sheet, p.index])).toEqual([
      [3000, 2 * (411 + 2) - 1],
      [3000, 2 * (183 + 3) - 1],
      [3000, 2 * (123 + 4) - 1],
      [3000, 2 * (27 + 5) - 1],
    ]);
    expect(parts[0]).toEqual({ sheet: 3000, index: 825, x: 100 + 10 - 825, y: 200 + 20 - 2 * 825 });
    // tourné vers la gauche : images paires, mêmes variantes
    const left = composeSnoidCells(t, [cell(2)], { pose: 0, facing: 1 });
    expect(left[0]!.index).toBe(2 * (411 + 2));
    // sans ancres, la position du script est conservée
    expect(composeSnoidCells(t, [cell(1, 7, 8)], { pose: 0 })[0]).toMatchObject({ x: 7, y: 8 });
  });

  it("décale les emplacements d'un script de rejet dont la première partie est ≥ 0x13", () => {
    const cells = [cell(381), cell(4), cell(3), cell(2), cell(5), cell(1)];
    const parts = composeSnoidCells(t, cells, { pose: 2, kind: "reject" });
    // emplacements 0 (brut), 1 = corps (c4 = 0), 2 = yeux (c6), 3 = nez (c8), 4 = pieds (ca), 5 = cheveux (cc)
    expect(parts.map((p) => (p.index + 1) / 2)).toEqual([381, 4, 144 + 3, 252 + 2, 360 + 5, 72 + 1]);
    expect(parts.every((p) => p.sheet === 3100)).toBe(true);
    // première partie < 0x13 : pas de décalage (emplacement 0 = c4 = corps)
    const small = composeSnoidCells(t, [cell(4), cell(3), cell(2), cell(5), cell(1)], { pose: 2, kind: "reject" });
    expect(small.map((p) => (p.index + 1) / 2)).toEqual([4, 144 + 3, 252 + 2, 360 + 5, 72 + 1]);
  });

  it("limite le nombre d'emplacements lus (6 hors rejet, 16 en rejet)", () => {
    const many = Array.from({ length: 20 }, () => cell(1));
    expect(composeSnoidCells(t, many, { pose: 0 })).toHaveLength(6);
    expect(composeSnoidCells(t, many, { pose: 2, kind: "reject" })).toHaveLength(16);
  });

  it("pose le script de façon que sa première partie tombe sur le point d'ancrage", () => {
    const image = (w: number, x: number, y: number) => ({ cells: [cell(w, x, y)], terminated: true, terminator: 0xff00, event: 0 });
    const images = [image(1, 100, 50), image(0, 0, 0), image(1, 160, 70), image(0, 0, 0)];
    expect(scriptAnchorOffset(images, { x: 10, y: 10 }, false)).toEqual({ x: -90, y: -40 });
    // avec un point d'arrivée : la dernière image dont la première case est une partie
    expect(scriptAnchorOffset(images, { x: 10, y: 10 }, true)).toEqual({ x: -150, y: -60 });
  });

  it("choisit les scripts de marche et d'animation des pieds", () => {
    expect(SNOID_SCRIPT_FIRST).toBe(100);
    expect(SNOID_SCRIPT_COUNT).toBe(51);
    expect([snoidWalkScriptId(1, 0), snoidWalkScriptId(1, 4), snoidWalkScriptId(5, 4)]).toEqual([105, 109, 129]);
    expect([snoidFeetScriptId(1), snoidFeetScriptId(5)]).toEqual([146, 150]);
  });

  it("donne les ids de voix (1168:575b)", () => {
    const rng = (min: number, max: number) => (min === 1800 ? max : min);
    // code 0 (base 100), cheveux 3 (+20), nez 4 (+3)
    expect(snoidVoiceId(0, { hair: 3, nose: 4 }, rng)).toBe(123);
    expect(snoidVoiceId(0, { hair: 1, nose: 1 }, rng)).toBe(100);
    expect(snoidVoiceId(13, { hair: 2, nose: 5 }, rng)).toBe(475 + 5 + 4);
    expect(snoidVoiceId(16, { hair: 2, nose: 5 }, rng)).toBe(1814);
    expect(snoidVoiceId(17, { hair: 2, nose: 5 }, rng)).toBe(99);
    // évènement 0xc9 = code 8 (base 300) ; 0xda = code 17
    expect(snoidVoiceIdForEvent(0xc9, { hair: 1, nose: 1 }, rng)).toBe(300);
    expect(snoidVoiceIdForEvent(0xda, { hair: 1, nose: 1 }, rng)).toBe(99);
    expect(snoidVoiceIdForEvent(0x05, { hair: 1, nose: 1 }, rng)).toBeUndefined();
  });
});

describe("marche (1168:2b30, 1168:2f9f, 1168:0ba8 état 0x70)", () => {
  it("classe la pente en 5 secteurs (y vers le haut)", () => {
    expect(walkSector(100, -500)).toBe(0); // descend à pic
    expect(walkSector(100, -100)).toBe(1); // descend en diagonale
    expect(walkSector(100, 0)).toBe(2);
    expect(walkSector(-100, 0)).toBe(2);
    expect(walkSector(100, 100)).toBe(3);
    expect(walkSector(100, 500)).toBe(4);
    expect(walkSector(0, -10)).toBe(0);
    expect(walkSector(0, 10)).toBe(4);
    // seuils : 1024 × tan 18° = 332, 1024 × tan 54° = 1409
    expect(walkSector(1024, 331)).toBe(2);
    expect(walkSector(1024, 332)).toBe(3);
    expect(walkSector(1024, -331)).toBe(2);
    expect(walkSector(1024, -332)).toBe(1);
    expect(walkSector(1024, 1408)).toBe(3);
    expect(walkSector(1024, 1409)).toBe(4);
    expect(walkSector(1024, -1408)).toBe(1);
    expect(walkSector(1024, -1409)).toBe(0);
    // le quotient est tronqué à 16 bits : 1024 × 100 / 3 = 34133 devient négatif
    expect(walkSector(3, 100)).toBe(0);
  });

  it("calcule les pas d'un trajet", () => {
    // horizontal : 16 px par pas en x, 0 en y
    expect(walkLeg({ x: 0, y: 100 }, { x: 160, y: 100 })).toEqual({ sector: 2, stepX: 16, stepY: 0 });
    // diagonale descendante (secteur 1) : pas x de 13, y réparti sur 100 / 13 = 7 pas
    expect(walkLeg({ x: 0, y: 0 }, { x: 100, y: 80 })).toEqual({ sector: 1, stepX: 13, stepY: -Math.trunc(80 / 7) });
    // presque vertical (secteur 4 : monte) : pas y de 15, soit 12 pas, donc 30 / 12 = 2 en x
    expect(walkLeg({ x: 0, y: 200 }, { x: 30, y: 20 })).toEqual({ sector: 4, stepX: 2, stepY: 15 });
    // vertical pur : |pas x| minimal à 1 quand la distance n'est pas nulle
    expect(walkLeg({ x: 0, y: 0 }, { x: 0, y: 150 })).toEqual({ sector: 0, stepX: 0, stepY: -15 });
    expect(walkLeg({ x: 0, y: 0 }, { x: 3, y: 150 })?.stepX).toBe(1);
    expect(walkLeg({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeUndefined();
  });

  it("avance sans dépasser la cible et oriente le Zoombini", () => {
    expect(walkStep({ x: 0, y: 0 }, { x: 10, y: 0 }, { stepX: 16, stepY: 0 })).toEqual({ x: 10, y: 0, facing: 0 });
    expect(walkStep({ x: 20, y: 0 }, { x: 0, y: 0 }, { stepX: 16, stepY: 0 })).toEqual({ x: 4, y: 0, facing: 1 });
    // y : vers le haut de l'écran = y décroissant
    expect(walkStep({ x: 0, y: 100 }, { x: 0, y: 70 }, { stepX: 0, stepY: 15 })).toEqual({ x: 0, y: 85, facing: undefined });
    expect(walkStep({ x: 0, y: 100 }, { x: 0, y: 105 }, { stepX: 0, stepY: -15 })).toEqual({ x: 0, y: 105, facing: undefined });
  });

  const map: WalkMap = {
    nodes: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ],
    paths: [[1, 2, 3]],
  };

  it("choisit le chemin et les points de passage", () => {
    const cursor = planPath(map, { x: 0, y: 0 }, { x: 200, y: 0 });
    expect(cursor).toEqual({ path: 0, rank: 1, step: 1 });
    const first = nextWaypoint(map, cursor, { x: 0, y: 0 }, { x: 200, y: 0 });
    expect(first.target).toEqual({ x: 100, y: 0 });
    expect(first.cursor).toEqual({ path: 0, rank: 2, step: 1 });
    // à (100, 0) la destination est aussi proche que le nœud 3 : elle l'emporte (≤)
    expect(nextWaypoint(map, first.cursor, { x: 100, y: 0 }, { x: 200, y: 0 }).target).toEqual({ x: 200, y: 0 });
    // destination avant la position dans le chemin : sens −1 (le nœud de la destination n'est pas en tête du chemin)
    expect(planPath(map, { x: 200, y: 0 }, { x: 100, y: 0 })).toEqual({ path: 0, rank: 3, step: -1 });
    // quand il est en tête (rang 0), le moteur garde le sens +1 (défaut du code reproduit)
    expect(planPath(map, { x: 200, y: 0 }, { x: 0, y: 0 })).toEqual({ path: 0, rank: 3, step: 1 });
    // sans NODE / PATH : ligne droite
    expect(planPath({ nodes: [], paths: [] }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeUndefined();
    expect(nextWaypoint({ nodes: [], paths: [] }, undefined, { x: 0, y: 0 }, { x: 9, y: 9 }).target).toEqual({ x: 9, y: 9 });
  });

  it("joue une marche complète jusqu'à l'arrivée", () => {
    const states: WalkState[] = [];
    let state = startWalk(map, { x: 0, y: 40 }, { x: 200, y: 40 });
    expect(state.target).toEqual({ x: 100, y: 0 });
    expect(state.sector).toBe(3); // pente 1024 × 40 / 100 = 409 : monte en diagonale
    for (let i = 0; i < 200 && !state.arrived; i++) {
      state = tickWalk(map, state);
      states.push(state);
    }
    expect(state.arrived).toBe(true);
    expect(state.position).toEqual({ x: 200, y: 40 });
    expect(states.length).toBeLessThan(60);
    // en ligne droite sans carte
    let straight = startWalk({ nodes: [], paths: [] }, { x: 0, y: 0 }, { x: 64, y: 0 });
    let ticks = 0;
    while (!straight.arrived) {
      straight = tickWalk({ nodes: [], paths: [] }, straight);
      ticks++;
    }
    expect(straight.position).toEqual({ x: 64, y: 0 });
    expect(ticks).toBe(4 + 1); // 4 pas de 16 px puis le tick qui constate l'arrivée
    expect(straight.facing).toBe(0);
  });
});

describe.skipIf(!original.has)("Zoombinis composés sur les vrais fichiers", () => {
  const archive = MohawkArchive.parse(original.read("ZOOMBINI.MHK"));
  const counts = {} as Record<SnoidSheet, number>;
  const anchors = {} as Record<SnoidSheet, Anchors>;
  for (const sheet of [3000, 3100, 3200] as const) {
    counts[sheet] = decodeTbmpImages(archive.get(TAG_TBMP, sheet)).length;
    const [x, y] = SNOID_REGS_IDS[sheet];
    anchors[sheet] = parseAnchors(archive.get(TAG_REGS, x), archive.get(TAG_REGS, y));
  }
  const snoidAnchors: SnoidAnchors = anchors;
  const scripts = Array.from({ length: SNOID_SCRIPT_COUNT }, (_, i) => parseScrs(archive.get(TAG_SCRS, SNOID_SCRIPT_FIRST + i)));

  it("a autant d'ancres que d'images dans chaque planche, plus une", () => {
    for (const sheet of [3000, 3100, 3200] as const) expect(anchors[sheet].x).toHaveLength(counts[sheet] + 1);
    expect(counts).toEqual({ 3000: 890, 3100: 798, 3200: 568 });
  });

  /** Scripts de marche (105 à 129) et d'animation des pieds (146 à 150) : propres à une valeur de pieds ; les autres vont à tous. */
  function feetOfScript(id: number): number | undefined {
    if (id >= 105 && id <= 129) return Math.floor((id - 100) / 5);
    if (id >= 146 && id <= 150) return id - 145;
    return undefined;
  }

  it("compose les 51 SCRS communs en indices valides pour les 625 Zoombinis (les scripts de pieds avec leurs pieds)", () => {
    let parts = 0;
    for (let i = 0; i < ZOOMBINI_COUNT; i++) {
      const traits = traitsFromIndex(i);
      scripts.forEach((script, n) => {
        const feet = feetOfScript(SNOID_SCRIPT_FIRST + n);
        if (feet !== undefined && feet !== traits.feet) return;
        for (const image of script.images) {
          for (const part of composeSnoidImage(traits, image, { pose: script.pose, anchors: snoidAnchors })) {
            parts++;
            if (part.sheet !== 3000 || part.index < 1 || part.index > counts[3000]) {
              throw new Error(`SCRS ${SNOID_SCRIPT_FIRST + n}, Zoombini ${i} : image ${part.index} hors de la planche ${part.sheet}`);
            }
            if (!Number.isInteger(part.x) || !Number.isInteger(part.y)) throw new Error("position non entière");
          }
        }
      });
    }
    expect(parts).toBeGreaterThan(100_000);
  });

  it("compose avec la petite planche (3200) les scripts de Zoombiniville, propres à des pieds", () => {
    const town = MohawkArchive.parse(original.read("TOWN.MHK"));
    const covered = new Set<number>();
    for (const id of town.ids(TAG_SCRS)) {
      const script = parseScrs(town.get(TAG_SCRS, id));
      for (let i = 0; i < ZOOMBINI_COUNT; i++) {
        const traits = traitsFromIndex(i);
        let valid = true;
        for (const image of script.images) {
          for (const part of composeSnoidImage(traits, image, { pose: script.pose, kind: "normal", small: true, anchors: snoidAnchors })) {
            expect(part.sheet).toBe(3200);
            if (part.index < 1 || part.index > counts[3200]) valid = false;
          }
        }
        if (valid) covered.add(traits.feet);
      }
    }
    expect([...covered].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("garde les variantes de chaque famille dans leur plage (valide le rangement des bases)", () => {
    // taille de la plage des pieds de valeur 1 à 5 : écart entre bases, la dernière va jusqu'à la fin de la planche
    const feetSize = TABLES_LARGE.feet.slice(1).map((base, i, all) => (all[i + 1] ?? counts[3000] / 2) - base);
    expect(feetSize).toEqual([55, 89, 25, 51, 34]);
    for (let feet = 1; feet <= 5; feet++) {
      const traits = { hair: 1, eyes: 1, nose: 1, feet, state: [] as number[] };
      const base = TABLES_LARGE.feet[feet]!;
      const ids = [...Array.from({ length: 5 }, (_, d) => snoidWalkScriptId(feet, d)), snoidFeetScriptId(feet)];
      for (const id of ids) {
        const script = scripts[id - SNOID_SCRIPT_FIRST]!;
        for (const image of script.images) {
          const bases = snoidBases(traits, script.pose);
          image.cells.forEach((c, slot) => {
            if (c.w > 0 && bases[slot + 1] === base) expect(c.w, `SCRS ${id}`).toBeLessThanOrEqual(feetSize[feet - 1]!);
          });
        }
      }
    }
    // nez 4 variantes, yeux et cheveux 16 variantes, corps 11 : maxima relevés sur les 51 scripts communs
    const maxima: Record<string, number> = {};
    const roles = [
      ["feet", "body", "nose", "eyes", "hair"],
      ["feet", "nose", "body", "eyes", "hair"],
      ["body", "eyes", "nose", "feet", "hair"],
    ];
    for (const script of scripts) {
      for (const image of script.images) {
        image.cells.forEach((c, slot) => {
          const role = roles[script.pose!]![slot]!;
          maxima[role] = Math.max(maxima[role] ?? 0, role === "feet" ? 0 : c.w);
        });
      }
    }
    expect(maxima).toEqual({ feet: 0, body: 11, nose: 4, eyes: 16, hair: 16 });
  });

  it("a un pied de la bonne taille dans les scripts 146 à 150 (un par valeur de pieds)", () => {
    for (let feet = 1; feet <= 5; feet++) {
      const script = scripts[snoidFeetScriptId(feet) - SNOID_SCRIPT_FIRST]!;
      let max = 0;
      for (const image of script.images) max = Math.max(max, image.cells[0]?.w ?? 0);
      expect(max).toBeLessThanOrEqual([55, 89, 25, 51, 34][feet - 1]!);
    }
  });

  it("compose aussi les scripts de rejet (planche 3100) de tous les écrans, pour les 625 Zoombinis", () => {
    let scriptsChecked = 0;
    for (const name of original.list((n) => n.endsWith(".MHK"))) {
      const screen = MohawkArchive.parse(original.read(name));
      for (const id of screen.ids(TAG_SCRS)) {
        const script = parseScrs(screen.get(TAG_SCRS, id));
        if (script.pose !== 2) continue;
        scriptsChecked++;
        for (let i = 0; i < ZOOMBINI_COUNT; i += 7) {
          const traits = traitsFromIndex(i);
          for (const image of script.images) {
            for (const part of composeSnoidImage(traits, image, { pose: 2, kind: "reject", anchors: snoidAnchors })) {
              if (part.index < 1 || part.index > counts[3100]) throw new Error(`${name} SCRS ${id} : image ${part.index} hors de la planche 3100`);
            }
          }
        }
      }
    }
    expect(scriptsChecked).toBeGreaterThan(20);
  });
});
