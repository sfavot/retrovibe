import { describe, expect, it } from "vitest";
import {
  MAP_SIZE,
  WATER_THRESHOLD,
  WORLD_SIZE,
  heightAt,
  groundTile,
  groundTileTints,
  objectiveGroup,
  tileOffset,
  tileStride,
  parseLevel,
  type Level,
} from "../../src/games/swiv3d/data/level";
import { hasOriginalFiles, readOriginal } from "./helpers";

const NAMES = ["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03", "DEMO"] as const;

/** Nombre d'objets par type, trié par type. */
function histogram(level: Level): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const o of level.objects) counts[o.type] = (counts[o.type] ?? 0) + 1;
  return counts;
}

describe.skipIf(!hasOriginalFiles)(
  "niveaux .SLV de SWIV 3D (fichiers du jeu)",
  () => {
    const levels = new Map(
      NAMES.map((n) => [n, parseLevel(readOriginal(`${n}.SLV`), n)]),
    );
    const level = (n: (typeof NAMES)[number]) => levels.get(n)!;

    it("lit des cartes 512×512 et des tables de tailles fixes", () => {
      for (const l of levels.values()) {
        expect(l.heightmap.length).toBe(MAP_SIZE * MAP_SIZE);
        expect(l.groundMap.length).toBe(MAP_SIZE * MAP_SIZE);
        expect(l.colorMap.length).toBe(MAP_SIZE * MAP_SIZE);
        expect(l.rampTable.length).toBe(1048);
        expect(l.pattern106.length).toBe(16384);
        expect(l.fadeTable.length).toBe(65536);
        expect(l.lightTable109.length).toBe(32768);
        expect(l.shadowSprites.length).toBe(65536);
        expect(l.table500.length).toBe(12288);
      }
    });

    it("a une palette de 256 couleurs RGB dont l'indice 0 est noir", () => {
      for (const l of levels.values()) {
        expect(l.palette.length).toBe(768);
        expect([...l.palette.subarray(0, 3)]).toEqual([0, 0, 0]);
      }
    });

    it("borne la hauteur : eau à 28-30 dans TERRAN00, max 255", () => {
      const l = level("TERRAN00");
      expect(l.heightmap.reduce((a, b) => Math.min(a, b))).toBe(28);
      expect(l.heightmap.reduce((a, b) => Math.max(a, b))).toBe(255);
      const water = new Set<number>();
      l.groundMap.forEach(
        (g, i) => g < WATER_THRESHOLD && water.add(l.heightmap[i]),
      );
      expect([...water].sort((a, b) => a - b)).toEqual([28, 29, 30]);
      expect(
        l.groundMap.reduce((n, g) => n + (g < WATER_THRESHOLD ? 1 : 0), 0),
      ).toBe(5359);
      expect(l.groundMap.reduce((a, b) => Math.max(a, b))).toBe(240);
    });

    it("n'a pas d'eau dans TERRAN03", () => {
      expect(
        level("TERRAN03").groundMap.every((g) => g >= WATER_THRESHOLD),
      ).toBe(true);
    });

    it("replie les cellules modulo 512 (monde torique)", () => {
      const l = level("TERRAN00");
      expect(heightAt(l, -1, 0)).toBe(l.heightmap[MAP_SIZE - 1]);
      expect(heightAt(l, 0, MAP_SIZE)).toBe(l.heightmap[0]);
    });

    it("compte les objets de chaque niveau, sans le terminateur", () => {
      expect(NAMES.map((n) => level(n).objects.length)).toEqual([
        581, 814, 827, 695, 319,
      ]);
    });

    it("répartit les types d'objets de TERRAN00 et DEMO", () => {
      expect(histogram(level("TERRAN00"))).toEqual({
        1000: 1,
        2000: 114,
        2002: 165,
        2003: 225,
        3000: 18,
        4001: 5,
        5000: 5,
        7000: 48,
      });
      expect(histogram(level("DEMO"))).toEqual({
        1001: 1,
        2000: 40,
        2003: 263,
        3000: 9,
        5500: 6,
      });
    });

    it("place un seul départ de joueur dans chaque niveau", () => {
      for (const l of levels.values())
        expect(
          l.objects.filter((o) => o.type >= 1000 && o.type < 1003),
        ).toHaveLength(1);
    });

    it("garde les objets et les angles dans les bornes observées", () => {
      for (const l of levels.values()) {
        for (const o of l.objects) {
          expect(o.params).toHaveLength(12);
          expect(o.x).toBeGreaterThan(0);
          expect(o.z).toBeGreaterThan(0);
          expect(o.angle).toBeGreaterThanOrEqual(0);
          expect(o.angle).toBeLessThan(512);
        }
      }
      // TERRAN03 dépasse du carré de 512 cellules : le monde est torique.
      expect(
        Math.max(...level("TERRAN03").objects.map((o) => o.x)),
      ).toBeGreaterThan(WORLD_SIZE);
      expect(
        Math.max(...level("TERRAN00").objects.flatMap((o) => [o.x, o.z])),
      ).toBeLessThan(WORLD_SIZE);
    });

    it("nomme les champs de l'enregistrement d'objet (REC[4..8]) et lit les groupes d'objectifs", () => {
      for (const l of levels.values()) {
        for (const o of l.objects) {
          expect([o.model, o.childModel, o.hitPoints, o.subtype, o.thrust]).toEqual(o.params.slice(0, 5));
          // REC[7] : code d'arme, bonus 1000+n ou groupe d'objectifs 5000+g, rien d'autre au-delà de 5009.
          expect(o.subtype).toBeLessThan(5010);
          const g = objectiveGroup(o);
          if (g !== null) expect(o.subtype).toBe(5000 + g);
        }
      }
      const groups = level("TERRAN02").objects.filter((o) => objectiveGroup(o) !== null);
      expect(groups.length).toBeGreaterThan(0);
      expect(objectiveGroup({ subtype: 5009 })).toBe(9);
      expect(objectiveGroup({ subtype: 5010 })).toBeNull();
      expect(objectiveGroup({ subtype: 4999 })).toBeNull();
      // Les pv (REC[6]) des 2000 des niveaux sont ceux du tableau de objects.md §5.
      for (const o of level("TERRAN00").objects.filter((o) => o.type === 2002)) expect(o.hitPoints).toBe(10);
    });

    it("lit les capacités des nœuds par classe de véhicule (champs 6, 7, 8)", () => {
      for (const l of levels.values())
        for (const w of l.waypoints)
          for (const c of [w.capacity.ships, w.capacity.aircraft, w.capacity.ground]) expect([0, 1]).toContain(c);
      // Navires : seuls les nœuds d'eau de TERRAN02 (245) et de DEMO (51) en acceptent.
      expect(level("TERRAN02").waypoints.filter((w) => w.capacity.ships > 0)).toHaveLength(245);
      expect(level("DEMO").waypoints.filter((w) => w.capacity.ships > 0)).toHaveLength(51);
      expect(level("TERRAN00").waypoints.filter((w) => w.capacity.ships > 0)).toHaveLength(0);
      // Véhicules terrestres : 1 sur presque tous, 15 nœuds à 0 dans TERRAN02, 51 dans DEMO.
      expect(level("TERRAN02").waypoints.filter((w) => w.capacity.ground === 0)).toHaveLength(15);
      expect(level("DEMO").waypoints.filter((w) => w.capacity.ground === 0)).toHaveLength(51);
    });

    it("compte les points de passage et pointe vers des nœuds existants", () => {
      expect(NAMES.map((n) => level(n).waypoints.length)).toEqual([
        86, 265, 757, 182, 83,
      ]);
      for (const l of levels.values()) {
        for (const w of l.waypoints)
          for (const link of w.links)
            expect(link).toBeLessThan(l.waypoints.length);
      }
    });

    it("découpe les cinq jeux de textures 12000-12004", () => {
      for (const l of levels.values()) {
        expect(l.tilesets.map((t) => t.id)).toEqual([
          12000, 12001, 12002, 12003, 12004,
        ]);
        expect(l.tilesets.map((t) => t.pixels.length)).toEqual([
          0x20000, 0x10000, 0x10000, 0x10000, 0x10000,
        ]);
        expect(l.tilesets.map((t) => t.trailer.length)).toEqual([
          0x180, 0, 0, 0, 0,
        ]);
        for (const t of l.tilesets) {
          expect(t.lightTable.length).toBe(0x8000);
          expect(t.palette.length).toBe(768);
        }
      }
    });

    it("lit 12000 comme 32 tuiles 64×64 contiguës et 12001-12004 comme une grille 4×4", () => {
      for (const l of levels.values()) {
        const [ground, ...models] = l.tilesets;
        expect(ground).toMatchObject({ layout: "tiles", tileCount: 32, width: 64, height: 2048 });
        expect(tileOffset(ground!, 5)).toBe(5 * 4096);
        expect(tileStride(ground!)).toBe(64);
        for (const t of models) {
          expect(t).toMatchObject({ layout: "grid", tileCount: 16, width: 256, height: 256 });
          expect(tileOffset(t, 6)).toBe(64 * 256 + 2 * 64);
          expect(tileStride(t)).toBe(256);
        }
        // Tuile du terrain : valeur de la carte 102 >> 3 ; eau (< 0x20) = tuiles 0 à 3, max 0xf0 = tuile 30.
        expect(groundTile(0x1f)).toBe(3);
        for (const g of l.groundMap) expect(groundTile(g)).toBeLessThan(ground!.tileCount);
      }
    });

    it("lit les 32 teintes de tuiles de la queue de 12000 : couleur moyenne de la tuile, canal maximal à 255", () => {
      for (const l of levels.values()) {
        const [ground, ...models] = l.tilesets;
        const tints = groundTileTints(ground!);
        expect(tints).toHaveLength(32);
        for (const m of models) expect(groundTileTints(m)).toEqual([]);
        tints.forEach((tint, k) => {
          expect(Math.max(...tint)).toBe(255);
          const mean = [0, 0, 0];
          const start = tileOffset(ground!, k);
          for (let i = 0; i < 4096; i++) {
            const index = ground!.pixels[start + i]!;
            for (let c = 0; c < 3; c++) mean[c]! += ground!.palette[index * 3 + c]! / 4096;
          }
          const top = Math.max(...mean);
          mean.forEach((v, c) => expect(Math.abs((v / top) * 255 - tint[c]!)).toBeLessThanOrEqual(4));
        });
        // Les quatre tuiles d'eau ont la même teinte (bleu clair).
        expect(tints[0]).toEqual([98, 221, 255]);
        expect(tints[3]).toEqual(tints[0]);
      }
    });

    it("garde le bloc 104 identique dans les cinq niveaux (aucun exécutable ne le charge)", () => {
      const header = new DataView(level("TERRAN00").rampTable.buffer, level("TERRAN00").rampTable.byteOffset, 24);
      expect([0, 4, 8, 12, 16, 20].map((o) => header.getUint32(o, true))).toEqual([0x93, 0x93, 0x93, 1, 1, 0]);
      for (const l of levels.values()) {
        expect(l.rampTable).toEqual(level("TERRAN00").rampTable);
        expect(Math.max(...l.rampTable.subarray(24))).toBeLessThanOrEqual(0x7f);
      }
    });

    it("marque l'indice 0 des atlas de tuiles en magenta (transparence)", () => {
      for (const t of level("TERRAN00").tilesets.slice(1))
        expect([...t.palette.subarray(0, 3)]).toEqual([255, 0, 255]);
    });
  },
);
