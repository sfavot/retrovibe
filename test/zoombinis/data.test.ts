import { describe, expect, it } from "vitest";
import { MohawkArchive, TAG_SHPL, TAG_SND, TAG_STRL } from "../../src/data/mohawk/mohawk";
import { parseMidi } from "../../src/data/mohawk/midi";
import { decodeShap } from "../../src/data/mohawk/shap";
import { parseShpl } from "../../src/data/mohawk/shpl";
import { parseStrl } from "../../src/data/mohawk/strl";
import { decodeTbmp, decodeTbmpImages, isTbmpSheet } from "../../src/data/mohawk/tbmp";
import { isWave, parseWave } from "../../src/data/mohawk/wave";
import {
  ARCHIVE_NAMES,
  BACKGROUND_ID,
  MIDIMAP_NAME,
  screenInfo,
  screensOfArchive,
  TAG_CURS,
  TAG_NODE,
  TAG_PATH,
  TAG_REGS,
  TAG_SCRB,
  TAG_SCRS,
  TAG_SYSX,
  TAG_TBMP,
  TAG_TMID,
  ZOOMBINI_SCREENS,
} from "../../src/games/zoombinis/data/archives";
import { cursorToRgba, parseCurs } from "../../src/games/zoombinis/data/curs";
import { GameFiles } from "../../src/games/zoombinis/data/files";
import { parseNode, parsePath } from "../../src/games/zoombinis/data/node-path";
import { anchorPosition, parseAnchors, parseRegs } from "../../src/games/zoombinis/data/regs";
import { parseScrb, parseScrs, SCRIPT_MAX_CELLS, snoidVoiceCode, visibleCells } from "../../src/games/zoombinis/data/script";
import { parseSysx } from "../../src/games/zoombinis/data/sysx";
import { originalFiles } from "../support/original";

const original = originalFiles("zoombinis", "files.json");

/** Ouvre une archive du jeu. */
function open(name: string): MohawkArchive {
  return MohawkArchive.parse(original.read(name));
}

/** Octets d'un script : mots big-endian. */
function words(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint16(i * 2, value & 0xffff));
  return out;
}

describe("tBMP multi-images (données synthétiques)", () => {
  /** Planche de 2 sous-images : une RLE 2x1 (alignée sur 4 avec 2 octets de bourrage) et une brute 3x1. */
  function sheet(): Uint8Array {
    const rle = [0, 2, 0, 1, 0, 2, 0, 0x12, 0, 2, 0x81, 5]; // 12 octets, ligne : répétition de 2 x 5
    const raw = [0, 3, 0, 1, 0, 4, 0, 2, 7, 8, 9, 0];
    const start = 8 + 4 * 2;
    const bytes = new Uint8Array(start + 12 + 4 + 12);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 2);
    view.setUint16(2, 7);
    view.setUint16(4, 4);
    view.setUint16(6, 2);
    view.setUint32(8, start);
    view.setUint32(12, start + 16);
    bytes.set(rle, start);
    bytes.set(raw, start + 16);
    return bytes;
  }

  it("reconnaît une planche et décode toutes ses sous-images", () => {
    const bytes = sheet();
    expect(isTbmpSheet(bytes)).toBe(true);
    const images = decodeTbmpImages(bytes);
    expect(images).toHaveLength(2);
    expect([images[0]!.width, images[0]!.height, [...images[0]!.pixels]]).toEqual([2, 1, [5, 5]]);
    expect([images[1]!.width, images[1]!.height, [...images[1]!.pixels]]).toEqual([3, 1, [7, 8, 9]]);
  });

  it("rend une seule image pour une ressource simple, sans la prendre pour une planche", () => {
    // 3x2 brute, pas 4 (n = 3 donnerait aussi un pas de 4 : seul le premier décalage les distingue).
    const raw = new Uint8Array([0, 3, 0, 2, 0, 4, 0, 2, 1, 2, 3, 0, 4, 5, 6, 0]);
    expect(isTbmpSheet(raw)).toBe(false);
    const images = decodeTbmpImages(raw);
    expect(images).toHaveLength(1);
    expect([...images[0]!.pixels]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...decodeTbmp(raw).pixels]).toEqual([...images[0]!.pixels]);
  });

  it("décode une planche compressée en LZ (drapeaux 0x0102)", () => {
    // Données décompressées : table d'une entrée (décalage 12) puis une sous-image brute 2x1.
    const plain = [0, 0, 0, 12, 0, 2, 0, 1, 0, 4, 0, 2, 6, 7, 0, 0];
    const packed: number[] = [];
    for (let i = 0; i < plain.length; i += 8) packed.push(0xff, ...plain.slice(i, i + 8));
    const bytes = new Uint8Array(18 + packed.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(4, 4);
    view.setUint16(6, 0x0102);
    view.setUint32(8, plain.length);
    view.setUint32(12, packed.length);
    view.setUint16(16, 0x400);
    bytes.set(packed, 18);
    expect(isTbmpSheet(bytes)).toBe(true);
    const images = decodeTbmpImages(bytes);
    expect(images).toHaveLength(1);
    expect([images[0]!.width, images[0]!.height, [...images[0]!.pixels]]).toEqual([2, 1, [6, 7]]);
  });

  it("refuse une planche aux décalages invalides", () => {
    const bytes = sheet();
    new DataView(bytes.buffer).setUint32(12, 8); // décalage décroissant
    expect(isTbmpSheet(bytes)).toBe(false);
  });
});

describe("SCRB / SCRS (données synthétiques)", () => {
  it("lit les parties, les cases vides, l'évènement et le son d'un SCRB", () => {
    // Exemple d'engine.md §3.2 (PICKER.MHK, SCRB 1200), tronqué à trois images.
    const bytes = words(3, 1, 320, 240, 0xff00, 2, 320, 240, 0xfe01, 1200, 0, 0, 0, 0xff00);
    const script = parseScrb(bytes);
    expect(script.pose).toBeUndefined();
    expect(script.images).toHaveLength(3);
    expect(script.images[0]).toEqual({ cells: [{ w: 1, x: 320, y: 240 }], terminated: true, terminator: 0xff00, event: 0 });
    expect(script.images[1]).toEqual({ cells: [{ w: 2, x: 320, y: 240 }], terminated: true, terminator: 0xfe01, event: 1, soundId: 1200 });
    expect(script.images[2]!.cells).toEqual([{ w: 0, x: 0, y: 0 }]);
    expect(visibleCells(script.images[2]!)).toEqual([]);
    expect(script.trailingWords).toBe(0);
  });

  it("lit l'entête et les coordonnées signées d'un SCRS", () => {
    const script = parseScrs(words(1, 2, 4, 1, 0xfffe, 0xffc9));
    expect(script.pose).toBe(2);
    expect(script.images[0]).toMatchObject({ cells: [{ w: 4, x: 1, y: -2 }], event: 0xc9 });
    expect(snoidVoiceCode(0xc9)).toBe(8);
    expect(snoidVoiceCode(0xd9)).toBe(16);
    expect(snoidVoiceCode(0)).toBeUndefined();
  });

  it("reproduit la boucle de 24 cases : le terminateur est relu par l'image suivante", () => {
    const cells = Array.from({ length: SCRIPT_MAX_CELLS }, (_, i) => [i + 1, i, i]).flat();
    // Deux images annoncées : la première a 24 cases puis un terminateur (évènement 3), la seconde ne sera jamais atteinte.
    const script = parseScrb(words(2, ...cells, 0xff03, 1, 0, 0, 0xff00));
    expect(script.images[0]).toMatchObject({ terminated: false, terminator: 0, event: 0 });
    expect(script.images[0]!.cells).toHaveLength(SCRIPT_MAX_CELLS);
    expect(script.images[1]).toMatchObject({ cells: [], terminated: true, event: 3 });
    expect(script.trailingWords).toBe(4);
  });

  it("refuse les ressources tronquées", () => {
    expect(() => parseScrb(words(1, 1, 5))).toThrow(/tronquée/);
    expect(() => parseScrb(words(1, 0xfe00))).toThrow(/tronquée/);
    expect(() => parseScrs(words(1))).toThrow(/trop courte/);
  });
});

describe("CURS (données synthétiques)", () => {
  it("lit les plans image et masque et le point chaud", () => {
    const bytes = new Uint8Array(68);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0x8001); // ligne 0 de l'image : pixels 0 et 15 noirs
    view.setUint16(32, 0xc000); // ligne 0 du masque : pixels 0 et 1 opaques
    view.setUint16(64, 8);
    view.setUint16(66, 6);
    const cursor = parseCurs(bytes);
    expect(cursor.hotspot).toEqual({ x: 8, y: 6 });
    expect([cursor.image[0], cursor.image[1], cursor.image[15]]).toEqual([1, 0, 1]);
    expect([cursor.mask[0], cursor.mask[1], cursor.mask[2]]).toEqual([1, 1, 0]);
    const rgba = cursorToRgba(cursor);
    expect([...rgba.subarray(0, 4)]).toEqual([0, 0, 0, 255]); // image 1, masque 1 : noir
    expect([...rgba.subarray(4, 8)]).toEqual([255, 255, 255, 255]); // image 0, masque 1 : blanc
    expect(rgba[11]).toBe(0); // masque 0 : transparent
    expect(() => parseCurs(new Uint8Array(10))).toThrow(/trop courte/);
  });
});

describe("NODE / PATH / REGS / SYSX (données synthétiques)", () => {
  it("lit les points de passage", () => {
    expect(parseNode(words(2, 11, 325, 69, 355))).toEqual([
      { x: 11, y: 325 },
      { x: 69, y: 355 },
    ]);
    expect(() => parseNode(words(2, 11, 325))).toThrow(/tronqués/);
  });

  it("lit les chemins terminés par 0 et ignore le bourrage", () => {
    const bytes = new Uint8Array(2 + 48);
    bytes[1] = 2;
    bytes.set([1, 2, 7], 2);
    bytes.fill(5, 26, 50); // second chemin sans 0 : 24 indices
    const paths = parsePath(bytes);
    expect(paths[0]).toEqual([1, 2, 7]);
    expect(paths[1]).toHaveLength(24);
    expect(() => parsePath(bytes.subarray(0, 40))).toThrow(/tronqués/);
  });

  it("lit les mots signés de REGS et recale une partie sur son ancrage", () => {
    const anchors = parseAnchors(words(0, 0xfffe, 3), words(0, 5, 0xfff0));
    expect([...anchors.x]).toEqual([0, -2, 3]);
    expect(anchorPosition(anchors, { w: 1, x: 10, y: 20 })).toEqual({ x: 12, y: 15 });
    expect(anchorPosition(anchors, { w: 2, x: 10, y: 20 })).toEqual({ x: 7, y: 36 });
    expect(anchorPosition(undefined, { w: 2, x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(() => parseRegs(new Uint8Array(3))).toThrow(/impaire/);
    expect(() => parseAnchors(words(0, 1), words(0))).toThrow(/ancrages/);
  });

  it("découpe les messages SYSX par trois octets", () => {
    expect(parseSysx(new Uint8Array([0xb0, 0x79, 0, 0xb1, 7, 0x7f]))).toEqual([
      { status: 0xb0, data1: 0x79, data2: 0 },
      { status: 0xb1, data1: 7, data2: 0x7f },
    ]);
    expect(() => parseSysx(new Uint8Array(4))).toThrow(/multiple de 3/);
  });
});

describe("table des écrans", () => {
  it("couvre les 23 écrans du moteur et les archives de jeu", () => {
    expect(ZOOMBINI_SCREENS.map((s) => s.screen)).toEqual(Array.from({ length: 21 }, (_, i) => i));
    expect(screenInfo(21)).toBe(screenInfo(19));
    expect(screenInfo(22)).toBe(screenInfo(0));
    expect(screenInfo(23)).toBeUndefined();
    expect(screenInfo(10)).toMatchObject({ archive: "FERRY.MHK", trial: 4, nameIndex: 5 });
    expect(screensOfArchive("picker.mhk").map((s) => s.screen)).toEqual([3, 19, 20]);
    const used = new Set(ZOOMBINI_SCREENS.flatMap((s) => (s.archive ? [s.archive] : [])));
    for (const name of used) expect(ARCHIVE_NAMES).toContain(name);
  });

  it("suit l'ordre des noms de STRL 2000 le long du parcours", () => {
    const route = [7, 8, 9, 4, 10, 11, 12, 13, 14, 15, 5, 16, 17, 18, 6];
    expect(route.map((screen) => screenInfo(screen)!.nameIndex)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
});

describe.skipIf(!original.has)("archives de Zoombinis", () => {
  const manifest = original.manifest() ?? [];
  const names = manifest.map((entry) => entry.path).filter((path) => /\.(MHK|DAT)$/.test(path));
  const archives = new Map(names.map((name) => [name, open(name)]));

  /** Parcourt toutes les ressources d'un tag dans toutes les archives. */
  function each(tag: string, visit: (bytes: Uint8Array, where: string, archive: string, id: number) => void): number {
    let count = 0;
    for (const [name, archive] of archives)
      for (const id of archive.ids(tag)) {
        visit(archive.get(tag, id), `${name} ${tag} ${id}`, name, id);
        count++;
      }
    return count;
  }

  it("trouve les 21 archives .MHK et MIDIMAP.DAT", () => {
    expect([...archives.keys()].sort()).toEqual([...ARCHIVE_NAMES, MIDIMAP_NAME].sort());
    expect(new GameFiles(manifest).resolve("midimap.dat")).toBe(MIDIMAP_NAME);
  });

  it("décode toutes les tBMP et leurs sous-images (174 ressources)", () => {
    // engine.md annonce 8 711 images et 83 planches : il ignore les 27 planches compressées en LZ (drapeaux 0x0102), dont
    // les sous-images portent le total à 10 068.
    let images = 0;
    let sheets = 0;
    const resources = each(TAG_TBMP, (bytes, where) => {
      const decoded = decodeTbmpImages(bytes);
      if (isTbmpSheet(bytes)) sheets++;
      images += decoded.length;
      for (const image of decoded) {
        expect(image.pixels.length, where).toBe(image.width * image.height);
        expect(image.bitsPerPixel, where).toBe(8);
      }
    });
    expect(resources).toBe(174);
    expect(sheets).toBe(110);
    expect(images).toBe(10068);
  });

  it("décode les planches compressées en LZ (BRIDGE 1100 : 7 sous-images, XFER 1200 : 4)", () => {
    for (const [name, id, count] of [["BRIDGE.MHK", 1100, 7], ["XFER.MHK", 1200, 4]] as const) {
      const bytes = open(name).get(TAG_TBMP, id);
      expect(isTbmpSheet(bytes), name).toBe(true);
      expect(decodeTbmpImages(bytes), name).toHaveLength(count);
    }
  });

  it("décode les fonds en 640 x 480 et le terrain en 160 x 120", () => {
    const background = decodeTbmp(open("BASECAMP.MHK").get(TAG_TBMP, BACKGROUND_ID));
    expect([background.width, background.height]).toEqual([640, 480]);
    // Dans les autres archives, la tBMP 1000 est une planche (MAP, PICKER, TOWN, FLEENS…) ou n'est pas un fond plein écran.
    for (const name of ["BASECAMP.MHK", "BRIDGE.MHK", "XFER.MHK"]) {
      const images = decodeTbmpImages(open(name).get(TAG_TBMP, BACKGROUND_ID));
      expect([name, images.length, images[0]!.width, images[0]!.height]).toEqual([name, 1, 640, 480]);
    }
    const terrain = decodeTbmp(open("BASECAMP.MHK").get(TAG_TBMP, 100));
    expect([terrain.width, terrain.height]).toEqual([160, 120]);
  });

  it("lit les 41 SHPL, les STRL en Mac Roman, les sons WAVE et les musiques tMID", () => {
    expect(each(TAG_SHPL, (bytes, where) => expect(parseShpl(bytes).rgb.length, where).toBeGreaterThan(0))).toBe(41);
    expect(each(TAG_STRL, (bytes) => parseStrl(bytes, "mac-roman"))).toBe(40);
    expect(each(TAG_SND, (bytes, where) => {
      expect(isWave(bytes), where).toBe(true);
      expect(parseWave(bytes).sampleRate, where).toBe(11025);
    })).toBe(1333);
    expect(each(TAG_TMID, (bytes, where) => expect(parseMidi(bytes).smf.length, where).toBeGreaterThan(14))).toBe(18);
  });

  it("donne les noms des écrans dans la STRL 2000", () => {
    const names = parseStrl(open("TEXTSTR.MHK").get(TAG_STRL, 2000), "mac-roman");
    expect(names).toHaveLength(16);
    expect(names[0]).toBe("zoombinîle");
    expect(names[15]).toBe("zoombiniville");
    expect(names.join("")).not.toMatch(/[�\u0080-\u009F]/);
  });

  it("décode les 1 784 SCRB", () => {
    let overflowing = 0;
    const count = each(TAG_SCRB, (bytes, where) => {
      const script = parseScrb(bytes);
      expect(script.images, where).toHaveLength(script.imageCount);
      if (script.images.some((image) => !image.terminated)) {
        overflowing++;
        expect(script.trailingWords, where).toBeGreaterThan(0);
      } else {
        expect(script.trailingWords, where).toBe(0);
      }
    });
    expect(count).toBe(1784);
    // engine.md annonce 18 SCRB à 24 parties ; il y en a 8 (7 dans FERRY.MHK : 1517, 1518, 1519, 1523, 1524, 1527, 1529, et LILLY.MHK 10169).
    expect(overflowing).toBe(8);
  });

  it("décode les 719 SCRS", () => {
    const poses = new Map<number, number>();
    const count = each(TAG_SCRS, (bytes, where) => {
      const script = parseScrs(bytes);
      expect(script.trailingWords, where).toBe(0);
      poses.set(script.pose!, (poses.get(script.pose!) ?? 0) + 1);
    });
    expect(count).toBe(719);
    expect(Object.fromEntries(poses)).toEqual({ 0: 436, 1: 95, 2: 127, 3: 59, 0xffff: 2 });
  });

  it("retrouve l'exemple de SCRB 1200 de PICKER.MHK (6 images) et celui de SCRS 105", () => {
    const script = parseScrb(open("PICKER.MHK").get(TAG_SCRB, 1200));
    expect(script.images).toHaveLength(6);
    expect(script.images[1]).toMatchObject({ cells: [{ w: 2, x: 320, y: 240 }], event: 1, soundId: 1200 });
    expect(script.images[5]!.cells).toEqual([{ w: 0, x: 0, y: 0 }]);
    const snoid = parseScrs(open("ZOOMBINI.MHK").get(TAG_SCRS, 105));
    expect(snoid.images).toHaveLength(8);
    expect(snoid.pose).toBe(0);
    expect(snoid.images[0]!.cells.slice(0, 2)).toEqual([
      { w: 4, x: 1, y: -2 },
      { w: 4, x: 2, y: -2 },
    ]);
  });

  it("référence des sous-images existantes dans les planches de BASECAMP", () => {
    const archive = open("BASECAMP.MHK");
    const sheet = decodeTbmpImages(archive.get(TAG_TBMP, 1100));
    const script = parseScrb(archive.get(TAG_SCRB, 1100));
    for (const image of script.images) for (const cell of image.cells) expect(cell.w).toBeLessThanOrEqual(sheet.length);
  });

  it("lit les NODE (9 archives) et les PATH qui les référencent", () => {
    const counts = [0, 0];
    each(TAG_NODE, (bytes, where, name, id) => {
      expect(id, where).toBe(BACKGROUND_ID);
      const nodes = parseNode(bytes);
      expect(nodes.length, where).toBeGreaterThan(0);
      for (const node of nodes) expect([node.x < 720, node.y < 480], where).toEqual([true, true]);
      for (const path of parsePath(archives.get(name)!.get(TAG_PATH, id))) for (const index of path) expect(index, where).toBeLessThanOrEqual(nodes.length);
      counts[0]!++;
    });
    each(TAG_PATH, () => counts[1]!++);
    expect(counts).toEqual([9, 9]);
    expect(parseNode(open("BASECAMP.MHK").get(TAG_NODE, 1000))).toHaveLength(8);
    expect(parsePath(open("BASECAMP.MHK").get(TAG_PATH, 1000)).slice(0, 3)).toEqual([[1, 2], [1, 2, 7], [1, 2, 7, 8]]);
  });

  it("lit les REGS et fait coïncider les ancrages avec les planches des Zoombinis", () => {
    const count = each(TAG_REGS, (bytes) => parseRegs(bytes));
    expect(count).toBe(79);
    const zoombini = open("ZOOMBINI.MHK");
    for (const id of [3000, 3100, 3200]) {
      const sheet = decodeTbmpImages(zoombini.get(TAG_TBMP, id));
      const regsId = id === 3200 ? 3200 : 100 + (id - 3000) / 50;
      const anchors = parseAnchors(zoombini.get(TAG_REGS, regsId), zoombini.get(TAG_REGS, regsId + 1));
      expect(anchors.x.length, `tBMP ${id}`).toBe(sheet.length + 1);
      expect(anchors.x[0]).toBe(0);
    }
    expect(parseAnchors(zoombini.get(TAG_REGS, 100), zoombini.get(TAG_REGS, 101)).x).toHaveLength(891);
  });

  it("lit les 5 curseurs de ZOOMBINI.MHK", () => {
    const zoombini = open("ZOOMBINI.MHK");
    expect(zoombini.ids(TAG_CURS)).toEqual([1, 2, 3, 4, 5]);
    expect(parseCurs(zoombini.get(TAG_CURS, 1)).hotspot).toEqual({ x: 8, y: 6 });
    for (const id of [2, 3, 4, 5]) expect(parseCurs(zoombini.get(TAG_CURS, id)).hotspot).toEqual({ x: 0, y: 0 });
    for (const id of zoombini.ids(TAG_CURS)) expect(cursorToRgba(parseCurs(zoombini.get(TAG_CURS, id))).some((v) => v !== 0)).toBe(true);
  });

  it("lit les 64 messages SYSX de MIDIMAP.DAT", () => {
    const midimap = open(MIDIMAP_NAME);
    expect(midimap.ids(TAG_SYSX)).toEqual([1, 0xffff]);
    const [first, second] = [1, 0xffff].map((id) => parseSysx(midimap.get(TAG_SYSX, id)));
    expect(first).toHaveLength(64);
    expect(second).toEqual(first);
    // Ordre : les 16 réinitialisations, puis les 16 volumes, les 16 expressions et les 16 panoramiques.
    const kinds = [[0x79, 0], [0x07, 0x7f], [0x0b, 0x5a], [0x0a, 0x40]];
    kinds.forEach(([data1, data2], kind) => {
      for (let channel = 0; channel < 16; channel++) {
        expect(first![kind * 16 + channel], `type ${kind} canal ${channel}`).toEqual({ status: 0xb0 | channel, data1, data2 });
      }
    });
  });

  it("garde decodeShap inchangé pour les images isolées", () => {
    const bytes = open("BASECAMP.MHK").get(TAG_TBMP, BACKGROUND_ID);
    expect(decodeTbmp(bytes).pixels).toEqual(decodeShap(bytes).pixels);
  });
});
