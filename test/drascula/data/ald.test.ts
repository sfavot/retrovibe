import { describe, expect, it } from "vitest";
import { parseAld } from "../../../src/games/drascula/data/ald";
import { TextResource } from "../../../src/games/drascula/data/text-resource";
import { byExtension, encodeGameText, hasOriginalFiles, listOriginal, readOriginal } from "../helpers";

describe("TextResource", () => {
  it("inverse les octets, ignore \\r et saute les lignes vides", () => {
    const resource = new TextResource(encodeGameText(["12", "", " 7 ", "ÉCOLE suite", "-3"], "\r\n"));
    expect(resource.int()).toBe(12);
    expect(resource.int()).toBe(7);
    expect(resource.word()).toBe("ÉCOLE");
    expect(resource.int()).toBe(-3);
    expect(resource.unread()).toEqual([]);
  });

  it("rend les lignes non lues", () => {
    const resource = new TextResource(encodeGameText(["1", "2", "3"]));
    resource.int();
    expect(resource.unread()).toEqual(["2", "3"]);
  });

  it("refuse un entier mal formé et une fin de fichier", () => {
    expect(() => new TextResource(encodeGameText(["PORTE"]), "X").int()).toThrow(/entier attendu/);
    expect(() => new TextResource(encodeGameText([])).int()).toThrow(/fin de fichier/);
  });
});

const door = ["2", "15", "182", "0", "123"];
const object = (id: number, name: string, ...rest: string[]) => [String(id), name, "10", "20", "30", "40", "25", "45", "1", "1", ...rest];

describe("parseAld (données synthétiques)", () => {
  const standard = [
    "9", "21", "AUX9.ALG", "3",
    "2",
    ...object(101, "PORTE", "1", ...door),
    ...object(102, "TABLE", "0"),
    "5", "6", "7", "8",
    "30", "70",
  ];

  it("lit la disposition des chapitres autres que 2 : objets, porte, zone de marche et limites", () => {
    const room = parseAld(encodeGameText(standard), 3);
    expect(room).toMatchObject({ number: 9, music: 21, disk: "AUX9.ALG", paletteLevel: 3, hero: null });
    expect(room.objects).toHaveLength(2);
    expect(room.objects[0]).toEqual({
      id: 101,
      name: "PORTE",
      rect: { x1: 10, y1: 20, x2: 30, y2: 40 },
      approach: { x: 25, y: 45 },
      track: 1,
      visible: true,
      door: { room: 2, x: 15, y: 182, direction: 0, exit: 123 },
    });
    expect(room.objects[1].door).toBeNull();
    expect(room.walk).toEqual({ x1: 5, y1: 6, x2: 7, y2: 8 });
    expect(room.limits).toEqual({ upper: 30, lower: 70 });
    expect(room.unread).toEqual([]);
  });

  it("au chapitre 2, une largeur nulle ne lit rien de plus et les limites sont absentes", () => {
    const lines = ["1", "10", "AUX1.ALG", "1", "0", "1", ...object(118, "PORTE", "0"), "14", "164", "309", "199"];
    const room = parseAld(encodeGameText(lines), 2);
    expect(room.hero).toBeNull();
    expect(room.limits).toBeNull();
    expect(room.objects.map((o) => o.name)).toEqual(["PORTE"]);
    expect(room.walk).toEqual({ x1: 14, y1: 164, x2: 309, y2: 199 });
  });

  it("au chapitre 2, une largeur non nulle ajoute la taille du héros et quatre images", () => {
    const lines = ["14", "21", "AUX14.ALG", "0", "39", "64", "7", "6", "2", "a.alg", "b.alg", "c.alg", "d.alg", "0", "1", "2", "3", "4"];
    const room = parseAld(encodeGameText(lines), 2);
    expect(room.hero).toEqual({ width: 39, height: 64, feetHeight: 7, stepX: 6, stepY: 2, surfaces: ["a.alg", "b.alg", "c.alg", "d.alg"] });
    expect(room.objects).toEqual([]);
    expect(room.walk).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });

  it("refuse de lire comme chapitre 2 une fiche d'un autre chapitre", () => {
    expect(() => parseAld(encodeGameText(standard), 2)).toThrow(/ALD invalide/);
  });

  it("laisse dans unread ce que ScummVM ne lit pas", () => {
    const lines = ["1", "10", "AUX1.ALG", "1", "0", "0", "1", "2", "3", "4", "67", "113"];
    expect(parseAld(encodeGameText(lines), 2).unread).toEqual(["67", "113"]);
  });

  it("refuse un fichier tronqué", () => {
    expect(() => parseAld(encodeGameText(standard.slice(0, 14)), 3)).toThrow(/ALD invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("fiches .ALD du jeu", () => {
  const names = listOriginal(byExtension("ALD"));
  /** Pièces dont la fiche a la disposition du chapitre 2 : 1 à 19, sauf 13. */
  const chapter2 = (room: number) => room >= 1 && room <= 19 && room !== 13;
  const rooms = new Map(names.map((name) => {
    const number = Number.parseInt(name, 10);
    return [number, parseAld(readOriginal(name), chapter2(number) ? 2 : 3)] as const;
  }));

  it("compte 57 fiches, de 1 à 63 et 102, et 270 objets dont 107 portes", () => {
    expect(names).toHaveLength(57);
    expect([...rooms.values()].reduce((sum, room) => sum + room.objects.length, 0)).toBe(270);
    expect([...rooms.keys()].filter((n) => n <= 63)).toHaveLength(56);
    expect(rooms.has(102)).toBe(true);
  });

  it("annonce le numéro de la pièce dans son nom de fichier", () => {
    for (const [number, room] of rooms) expect(room.number, `${number}.ALD`).toBe(number);
  });

  it("se lit entièrement : rien ne reste, sauf deux valeurs en trop dans 2.ALD", () => {
    for (const [number, room] of rooms) {
      expect(room.unread, `${number}.ALD`).toEqual(number === 2 ? ["67", "113"] : []);
    }
  });

  it("a une disposition propre au chapitre : l'autre disposition lance une erreur", () => {
    for (const name of names) {
      const number = Number.parseInt(name, 10);
      expect(() => parseAld(readOriginal(name), chapter2(number) ? 3 : 2), name).toThrow(/ALD invalide/);
    }
  });

  it("donne aux pièces du chapitre 2 une taille de héros ou les valeurs par défaut, sans limites", () => {
    const withHero = [...rooms].filter(([, room]) => room.hero);
    expect(withHero.map(([n]) => n).sort((a, b) => a - b)).toEqual([2, 4, 5, 7, 8, 10, 12, 14, 15, 17]);
    for (const [number, room] of rooms) {
      if (chapter2(number)) expect(room.limits, `${number}.ALD`).toBeNull();
      else expect(room.limits, `${number}.ALD`).not.toBeNull();
    }
    expect(rooms.get(14)?.hero).toMatchObject({ width: 39, height: 64, feetHeight: 7, stepX: 7, stepY: 2 });
    expect(rooms.get(14)?.hero?.surfaces).toEqual(["964.alg", "974.alg", "984.alg", "994.alg"]);
    expect(rooms.get(1)?.hero).toBeNull();
  });

  it("lit 14.ALD : taverne, 12 objets, musique 21, noms français", () => {
    const room = rooms.get(14)!;
    expect([room.music, room.disk, room.paletteLevel]).toEqual([21, "AUX14.ALG", 0]);
    expect(room.objects).toHaveLength(12);
    expect(room.objects.map((o) => o.name)).toEqual([
      "ESCALERA", "HABITACIONES", "PUERTA", "TAVERNIER", "PIANISTE", "IVROGNE", "PIANO", "AFFICHE", "TETE", "AFFICHE", "AFFICHE", "CORBEILLE",
    ]);
    expect(room.objects[0]).toEqual({
      id: 159,
      name: "ESCALERA",
      rect: { x1: 4, y1: 66, x2: 40, y2: 134 },
      approach: { x: 38, y: 128 },
      track: 0,
      visible: true,
      door: { room: 12, x: 49, y: 140, direction: 3, exit: 156 },
    });
    expect(room.walk).toEqual({ x1: 44, y1: 121, x2: 210, y2: 156 });
  });

  it("lit 62.ALD (disposition hors chapitre 2) : 10 objets, zone de marche puis limites de perspective", () => {
    const room = rooms.get(62)!;
    expect([room.music, room.disk, room.paletteLevel, room.objects.length]).toEqual([21, "AUX62.ALG", 0, 10]);
    expect(room.objects[0].name).toBe("TAVERNIER");
    expect(room.walk).toEqual({ x1: 53, y1: 121, x2: 213, y2: 151 });
    expect(room.limits).toEqual({ upper: 91, lower: 93 });
  });

  it("a 19 numéros de musique distincts, de 4 à 28", () => {
    const music = new Set([...rooms.values()].map((room) => room.music));
    expect(music.size).toBe(19);
    expect(Math.min(...music)).toBe(4);
    expect(Math.max(...music)).toBe(28);
  });

  it("a des noms d'un seul mot et des rectangles dans l'ordre", () => {
    for (const [number, room] of rooms) {
      for (const object of room.objects) {
        expect(object.name, `${number}.ALD`).toMatch(/^\S+$/);
        expect(object.rect.x2, `${number}.ALD ${object.id}`).toBeGreaterThanOrEqual(object.rect.x1);
        expect(object.rect.y2, `${number}.ALD ${object.id}`).toBeGreaterThanOrEqual(object.rect.y1);
      }
    }
  });

  it("a des portes qui mènent à une fiche existante, vers un objet de la pièce d'arrivée", () => {
    const orphans: string[] = [];
    let doors = 0;
    for (const [number, room] of rooms) {
      for (const { id, door } of room.objects) {
        if (!door) continue;
        doors++;
        const target = rooms.get(door.room);
        expect(target, `${number}.ALD:${id} -> ${door.room}`).toBeDefined();
        if (!target?.objects.some((o) => o.id === door.exit)) orphans.push(`${number}:${id}->${door.room}/${door.exit}`);
      }
    }
    expect(doors).toBe(107);
    // Trois sorties n'ont pas d'objet d'arrivée : 174 n'existe pas dans la pièce 20, 999 est un repère de la pièce 62.
    expect(orphans).toEqual(["19:173->20/174", "62:104->63/999", "62:105->63/999"]);
  });
});
