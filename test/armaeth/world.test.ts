import { describe, expect, it } from "vitest";
import { EXIT_SLOTS, OBJECT_BYTES, OPPOSITE_EXIT, ROOM_BYTES, maxScore, parseWorld } from "../../src/games/armaeth/data/world";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("monde : données invalides", () => {
  it("refuse une mauvaise signature ou un fichier tronqué", () => {
    expect(() => parseWorld(new Uint8Array(54))).toThrow(/signature/);
    expect(() => parseWorld(new Uint8Array(10))).toThrow(/tronqué/);
  });
});

describe.skipIf(!hasOriginalFiles)("monde d'Armaeth (fichiers du jeu)", () => {
  const cfg = parseWorld(readOriginal("A1FCFG.SYS"));

  it("lit l'en-tête, 35 entrées de score, 60 salles et 132 objets sans reste", () => {
    expect(cfg.header).toMatchObject({
      lastSerial: 213,
      dictionaryLetters: 8,
      heroSerial: 158,
      currentRoom: 1,
      objectCount: 132,
      roomCount: 60,
    });
    expect(cfg.header.words).toHaveLength(27);
    expect(cfg.scoreTable.map((z) => z.id)).toEqual([
      ...[0, 1, 2, 3, 4, 5],
      ...[100, 101, 102, 103, 104, 105, 106, 107, 108],
      ...[200, 201, 202, 203, 204, 205],
      ...[300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313],
    ]);
    expect(cfg.deferredEvents).toEqual({ capacity: 0, events: [] });
    expect(54 + 2 + 35 * 8 + 4 + 60 * ROOM_BYTES + 132 * OBJECT_BYTES).toBe(readOriginal("A1FCFG.SYS").length);
  });

  it("la table de score totalise 725 points et ne contient que des valeurs connues", () => {
    expect(maxScore(cfg)).toBe(725);
    expect(new Set(cfg.scoreTable.map((e) => e.points))).toEqual(new Set([0, 5, 10, 20, 30, 40, 50]));
    expect(cfg.header).toMatchObject({ chapterLevel: 3, score: 0 });
    expect(cfg.scoreTable.every((e) => e.repeats === 0)).toBe(true);
  });

  it("les sorties des salles sont symétriques (156 liaisons) et les barrages ne portent que sur des sorties", () => {
    let links = 0;
    cfg.rooms.forEach((room, index) => {
      expect(room.exits).toHaveLength(EXIT_SLOTS);
      expect(room.barriers).toHaveLength(EXIT_SLOTS);
      room.exits.forEach((dest, slot) => {
        if (room.barriers[slot] !== 0) expect(dest, `salle ${room.id}`).not.toBe(0);
        if (dest === 0) return;
        links++;
        expect(cfg.rooms[dest].exits[OPPOSITE_EXIT[slot]], `salle ${room.id} emplacement ${slot}`).toBe(index);
      });
    });
    expect(links).toBe(156);
  });

  it("les champs nommés d'une salle et d'un objet viennent des bons offsets", () => {
    // engine.md § 5.1 annonce 0 sauf salle 7 ; les données ont aussi 32 (303, 304) et 48 (314)
    expect(cfg.rooms.filter((r) => r.lightOffset !== 0).map((r) => [r.id, r.lightOffset])).toEqual([[7, -32], [303, 32], [304, 32], [314, 48]]);
    // salle 0 (cadre d'interface) sans musique ; les autres sont de classe « M »
    expect(cfg.rooms.filter((r) => r.musicClass !== 0x4d).map((r) => r.id)).toEqual([0]);
    const hero = cfg.objects.find((o) => o.serial === cfg.header.heroSerial)!;
    expect(hero.raw[0x54]).toBe(hero.x & 0xff);
    expect(hero.p).toBeGreaterThanOrEqual(8);
    expect(hero.p).toBeLessThanOrEqual(159);
    expect(cfg.objects.filter((o) => o.pickable === 7)).toHaveLength(38);
    expect(cfg.objects.filter((o) => o.canContain === 7)).toHaveLength(29);
    expect(cfg.objects.filter((o) => o.light === 16 || o.light === 32).length).toBeGreaterThan(0);
  });

  it("les salles portent les identifiants des scènes", () => {
    const ids = cfg.rooms.map((r) => r.id);
    expect(ids).toEqual([
      ...Array.from({ length: 19 }, (_, i) => i),
      20, 21, 22,
      ...Array.from({ length: 11 }, (_, i) => 101 + i),
      ...Array.from({ length: 12 }, (_, i) => 201 + i),
      ...Array.from({ length: 15 }, (_, i) => 301 + i),
    ]);
    expect(ids).toContain(cfg.header.currentRoom);
  });

  it("les objets sont cohérents : séries uniques, types et conteneurs valides", () => {
    expect(new Set(cfg.objects.map((o) => o.serial)).size).toBe(132);
    expect(Math.max(...cfg.objects.map((o) => o.serial))).toBeLessThanOrEqual(cfg.header.lastSerial);
    expect(cfg.objects.some((o) => o.serial === cfg.header.heroSerial)).toBe(true);
    const roomIds = new Set(cfg.rooms.map((r) => r.id));
    const serials = new Set(cfg.objects.map((o) => o.serial));
    for (const o of cfg.objects) {
      expect([0, 1, 2]).toContain(o.typ);
      expect([1, 2]).toContain(o.location);
      if (o.location === 1 && o.container !== 0) expect(roomIds.has(o.container), `objet ${o.serial}`).toBe(true);
      if (o.location === 2) expect(serials.has(o.container), `objet ${o.serial}`).toBe(true);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThanOrEqual(320);
    }
  });

  it("A1FCFG.SYS et SVG001.STD sont identiques, enregistrement par enregistrement", () => {
    const std = parseWorld(readOriginal("SVG001.STD"));
    expect(std).toEqual(cfg);
    expect(Buffer.compare(readOriginal("SVG001.STD"), readOriginal("A1FCFG.SYS"))).toBe(0);
  });

  it("A1FTMP.SVG est un autre instantané du même format", () => {
    const svg = parseWorld(readOriginal("A1FTMP.SVG"));
    expect(svg.header.objectCount).toBe(136);
    expect(svg.rooms.map((r) => r.id)).toEqual(cfg.rooms.map((r) => r.id));
    expect(svg.scoreTable).toHaveLength(35);
    expect(svg.objects).toHaveLength(136);
  });
});
