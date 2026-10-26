import { describe, expect, it } from "vitest";
import {
  MAP_SIZE,
  WATER_THRESHOLD,
  WORLD_SIZE,
  heightAt,
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

    it("marque l'indice 0 des atlas de tuiles en magenta (transparence)", () => {
      for (const t of level("TERRAN00").tilesets.slice(1))
        expect([...t.palette.subarray(0, 3)]).toEqual([255, 0, 255]);
    });
  },
);
