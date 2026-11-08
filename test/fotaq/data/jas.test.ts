import { describe, expect, it } from "vitest";
import { JAS_HEADER_SIZE, parseQueenJas } from "../../../src/games/fotaq/data/jas";
import { hasOriginalFiles, readOriginal } from "../helpers";

/** `QUEEN.JAS` minimal à une pièce et un objet, tous les autres comptes à 0 (ScummVM lit alors un enregistrement quand même). */
function minimalJas(): Uint8Array {
  const words: number[] = [];
  words.push(1, 0, 1, 0); // pièces, noms, objets, descriptions
  words.push(10, 11, 12, 13, 14, 15, 16, 17); // objet 1
  words.push(0, 1); // roomData : 0 puis pièces + 1 valeurs
  words.push(5); // effet sonore de la pièce 1
  words.push(1, 21, 22, 23, 24, 25); // un objet d'inventaire
  words.push(0, 31, 32, 33, 34, 35); // graphiques : compte nul, mais un enregistrement est lu
  words.push(2, 0); // grille de la pièce 1 : 2 objets, 0 zone
  words.push(41, 42, 43, 44); // boîte de l'objet 1
  words.push(0, 51, 52, 53); // marches : compte nul + 1 enregistrement
  words.push(0, 61, 62, 63, 64); // descriptions d'objets : idem
  words.push(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10); // listes de commandes : idem (10 mots)
  words.push(0, 1, 2, 3); // zones de commande (3 mots)
  words.push(0, 1, 2, 3); // objets de commande
  words.push(0, 1, 2, 3); // inventaire de commande
  words.push(0, 1, 2, 3, 4); // états de commande (4 mots)
  words.push(1); // objet d'entrée
  words.push(0, 1, 2); // meubles : compte nul + 1 enregistrement (2 mots)
  words.push(0, 3, 4, 5); // acteurs : quatre comptes (dont 0 acteur)
  words.push(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0); // l'acteur lu quand même : fichier 0
  words.push(0, 7, 8, 9); // animations graphiques
  const bytes = new Uint8Array(20 + words.length * 2 + 6);
  const view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setUint16(20 + i * 2, word, false));
  bytes.set(new TextEncoder().encode("CFM10"), 20 + words.length * 2);
  return bytes;
}

describe("parseQueenJas (données synthétiques)", () => {
  it("lit les objets, l'inventaire et les tables aux comptes nuls (un enregistrement est lu quand même)", () => {
    const bytes = minimalJas();
    const jas = parseQueenJas(bytes);
    expect(jas.objects).toHaveLength(2);
    expect(jas.objects[1]).toEqual({ name: 10, x: 11, y: 12, description: 13, entryObject: 14, room: 15, state: 16, image: 17 });
    // roomData : 0, la valeur lue pour la pièce 1, puis le nombre d'objets à la place de la dernière valeur.
    expect(jas.roomFirstObject).toEqual([0, 0, 1]);
    expect(jas.roomSfx).toEqual([0, 5]);
    expect(jas.items[1]).toEqual({ name: 21, description: 22, state: 23, frame: 24, sfxDescription: 25 });
    expect(jas.graphics).toHaveLength(1);
    expect(jas.graphics[0]).toEqual({ x: 31, y: 32, firstFrame: 33, lastFrame: 34, speed: 35 });
    expect(jas.rooms[1]).toMatchObject({ objectCount: 2, areas: [expect.anything()] });
    expect(jas.objectBoxes[1]).toEqual({ x1: 41, y1: 42, x2: 43, y2: 44 });
    expect(jas.walkOffs[0]).toEqual({ entryObject: 51, x: 52, y: 53 });
    expect(jas.commands.lists[0]).toMatchObject({ verb: 1, object1: 2, object2: 3, song: 4, setAreas: true, setObjects: true, setItems: true, setConditions: true, imageOrder: 9, specialSection: 10 });
    expect(jas.entryObject).toBe(1);
    expect(jas.furniture[0]).toEqual({ room: 1, object: 2 });
    expect(jas.actors[0]).toMatchObject({ room: 1, bobNumber: 2, name: 3, file: 0, bank: 15 });
    expect(jas.version).toBe("CFM10");
    expect(jas.endOffset).toBe(bytes.length - 6);
  });

  it("refuse un fichier tronqué avant la version", () => {
    const bytes = minimalJas();
    expect(() => parseQueenJas(bytes.subarray(0, bytes.length - 3))).toThrow();
    expect(() => parseQueenJas(new Uint8Array(JAS_HEADER_SIZE + 8))).toThrow();
  });
});

describe.skipIf(!hasOriginalFiles)("QUEEN.JAS du jeu", () => {
  const file = readOriginal("QUEEN.JAS");
  const jas = parseQueenJas(file);

  it("pèse 79 390 octets, avec un en-tête AMOS de 20 octets", () => {
    expect(file).toHaveLength(79390);
    expect(String.fromCharCode(...file.subarray(0, 4))).toBe("AmBk");
    expect(String.fromCharCode(...file.subarray(12, 20))).toBe("Datas   ");
  });

  it("annonce 126 pièces, 325 noms, 792 objets et 724 descriptions", () => {
    expect([jas.roomCount, jas.nameCount, jas.objectCount, jas.descriptionCount]).toEqual([126, 325, 792, 724]);
  });

  it("lit les tables aux effectifs relevés", () => {
    // Les tableaux comptent un élément de plus que le fichier : l'élément 0 est nul.
    expect(jas.objects).toHaveLength(792 + 1);
    expect(jas.items).toHaveLength(100 + 1);
    expect(jas.graphics).toHaveLength(679 + 1);
    expect(jas.rooms).toHaveLength(126 + 1);
    expect(jas.objectBoxes).toHaveLength(792 + 1);
    expect(jas.walkOffs).toHaveLength(149 + 1);
    expect(jas.objectDescriptions).toHaveLength(4 + 1);
    expect(jas.commands.lists).toHaveLength(866 + 1);
    expect(jas.commands.areas).toHaveLength(34 + 1);
    expect(jas.commands.objects).toHaveLength(338 + 1);
    expect(jas.commands.inventory).toHaveLength(249 + 1);
    expect(jas.commands.states).toHaveLength(1356 + 1);
    expect(jas.furniture).toHaveLength(203 + 1);
    expect(jas.actors).toHaveLength(140 + 1);
    expect([jas.actorAnimationCount, jas.actorNameCount, jas.actorFileCount]).toEqual([62, 74, 64]);
    expect(jas.graphicAnimations).toHaveLength(220 + 1);
  });

  it("s'arrête à l'offset 74 884, sur la chaîne de version CFM10, suivie d'octets nuls", () => {
    expect(jas.endOffset).toBe(74884);
    expect(jas.version).toBe("CFM10");
    expect(file.subarray(jas.endOffset + 6).every((byte) => byte === 0)).toBe(true);
    expect(file.length - jas.endOffset).toBe(4506);
  });

  it("place l'objet d'entrée (639) dans la pièce 95, pièce de départ", () => {
    expect(jas.entryObject).toBe(639);
    expect(jas.objects[jas.entryObject].room).toBe(95);
  });

  it("range les objets par pièce : l'écart entre deux pièces successives est le nombre d'objets de la pièce", () => {
    expect(jas.roomFirstObject).toHaveLength(126 + 2);
    expect(jas.roomFirstObject[jas.roomCount + 1]).toBe(792);
    let total = 0;
    for (let room = 1; room <= jas.roomCount; room++) {
      const count = jas.rooms[room].objectCount;
      expect(jas.roomFirstObject[room + 1] - jas.roomFirstObject[room], `pièce ${room}`).toBe(count);
      total += count;
    }
    expect(total).toBe(792);
  });

  it("donne un effet sonore par pièce (à partir de la pièce 1)", () => {
    expect(jas.roomSfx).toHaveLength(126 + 1);
  });

  it("lit les zones de la pièce 1 : quatre zones voisines, échelles à 100", () => {
    const room = jas.rooms[1];
    expect(room.objectCount).toBe(6);
    expect(room.areas).toHaveLength(4 + 1);
    expect(room.areas[1]).toMatchObject({ mapNeighbors: 5, box: { x1: 149, y1: 104, x2: 164, y2: 133 }, bottomScaleFactor: 100, topScaleFactor: 100 });
  });

  it("lit les premiers enregistrements : objet 1, objet d'inventaire 1, graphique 1, acteur 1, liste de commandes 1", () => {
    expect(jas.objects[1]).toEqual({ name: 6, x: 150, y: 130, description: 11, entryObject: 0, room: 1, state: 1377, image: 1 });
    expect(jas.items[1]).toEqual({ name: 31, description: 577, state: 204, frame: 1, sfxDescription: 98 });
    expect(jas.graphics[1]).toEqual({ x: 139, y: 124, firstFrame: 4, lastFrame: 0, speed: 0 });
    expect(jas.actors[1]).toMatchObject({ room: 1, bobNumber: 1, name: 1, color: 11, standingFrame: 38, x: 143, y: 100, animation: 1, bank: 10, file: 1 });
    expect(jas.commands.lists[1]).toEqual({
      verb: 1,
      object1: 1,
      object2: 0,
      song: 138,
      setAreas: false,
      setObjects: false,
      setItems: false,
      setConditions: true,
      imageOrder: 4,
      specialSection: 0,
    });
  });

  it("garde les coordonnées de marche en 16 bits non signés, comme ScummVM", () => {
    expect(jas.walkOffs[1]).toEqual({ entryObject: 106, x: 65506, y: 143 });
  });

  it("applique le correctif de ScummVM sur la commande d'objet 175 (309 copié dans 308)", () => {
    expect(jas.commands.objects[175]).toEqual({ id: 320, destination: 308, source: 309 });
    expect(jas.appliedFixes).toHaveLength(1);
  });

  it("donne la banque 15 aux acteurs sans fichier", () => {
    const withoutFile = jas.actors.slice(1).filter((actor) => actor.file === 0);
    for (const actor of withoutFile) expect(actor.bank).toBe(15);
  });

  it("référence des numéros cohérents : commandes vers des listes existantes, objets et pièces dans les bornes", () => {
    const lists = jas.commands.lists.length;
    for (const table of [jas.commands.areas, jas.commands.objects, jas.commands.inventory, jas.commands.states]) {
      for (const entry of table.slice(1)) expect(entry.id).toBeLessThan(lists);
    }
    for (const object of jas.objects.slice(1)) expect(object.room).toBeLessThanOrEqual(126);
    for (const actor of jas.actors.slice(1)) expect(actor.file).toBeLessThanOrEqual(jas.actorFileCount);
  });
});
