import { describe, expect, it, vi } from "vitest";
import { fetchGameFiles } from "../../../src/data/game-files";
import { copy } from "../../../src/games/gk1/copy";
import { readFont } from "../../../src/games/gk1/data/font";
import { ResourceType, SoundDevice } from "../../../src/games/gk1/data/ids";
import { readMessages } from "../../../src/games/gk1/data/message";
import { readPic } from "../../../src/games/gk1/data/pic";
import { readSound } from "../../../src/games/gk1/data/sound";
import { decodeViewCel, readView } from "../../../src/games/gk1/data/view";
import {
  celOffset,
  deviceName,
  distinctValues,
  filterMessages,
  flipHorizontal,
  folderItems,
  formatLocation,
  GLYPH_SHEET_COLUMNS,
  glyphSheet,
  loopBounds,
  parseLocation,
  parseResourceName,
  picDrawOrder,
  renderText,
  resourceItems,
  soundRows,
  TAB_IDS,
  TAB_RESOURCE_TYPES,
  textWidth,
  viewCelImage,
} from "../../../src/games/gk1/ui/viewer-data";
import { altIndex, mainIndex, original } from "../data/real";

describe("visionneuse de Gabriel Knight : manifeste et adresses", () => {
  it("fetchGameFiles lit files.json sous /gk1 et les dossiers deviennent des listes", async () => {
    const entries = ["RESOURCE.MAP", "SEQ/10.SEQ", "SEQ/2.SEQ", "SEQ/BLAST.SEQ", "audio/12.mp3", "audio/index.json", "voices/50/1-2-3-4.mp3"].map((path) => ({ path, size: 1 }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(entries)));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const files = await fetchGameFiles("/gk1");
      expect(fetchMock).toHaveBeenCalledWith("/gk1/files.json");
      expect(folderItems(files.list(), "SEQ", "SEQ").map((item) => item.name)).toEqual(["2", "10", "BLAST"]);
      expect(folderItems(files.list(), "audio", "mp3")).toEqual([{ name: "12", note: "" }]);
      expect(folderItems(files.list(), "voices", "mp3")).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("un manifeste absent est une erreur lisible", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    try {
      await expect(fetchGameFiles("/gk1")).rejects.toThrow(/files\.json : HTTP 404/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lit et écrit l'adresse d'une ressource", () => {
    expect(parseLocation("#pics/100")).toEqual({ tab: "pics", name: "100" });
    expect(parseLocation("#other/vocab.997")).toEqual({ tab: "other", name: "vocab.997" });
    expect(parseLocation("#seq")).toEqual({ tab: "seq", name: undefined });
    expect(parseLocation("")).toEqual({ tab: "views", name: undefined });
    expect(parseLocation("#inconnu/3")).toEqual({ tab: "views", name: undefined });
    expect(parseLocation("#%E0%A4%A")).toEqual({ tab: "views", name: undefined });
    expect(formatLocation({ tab: "other", name: "vocab.997" })).toBe("#other/vocab.997");
    expect(formatLocation({ tab: "seq", name: undefined })).toBe("#seq");
    expect(parseLocation(formatLocation({ tab: "seq", name: "BLAST" }))).toEqual({ tab: "seq", name: "BLAST" });
  });

  it("retrouve le type et le numéro d'un nom de liste", () => {
    expect(parseResourceName("views", "12")).toEqual({ type: ResourceType.View, number: 12 });
    expect(parseResourceName("other", "vocab.997")).toEqual({ type: ResourceType.Vocab, number: 997 });
    expect(parseResourceName("other", "heap.64999")).toEqual({ type: ResourceType.Heap, number: 64999 });
    expect(parseResourceName("other", "997")).toBeUndefined();
    expect(parseResourceName("other", "view.1")).toBeUndefined();
    expect(parseResourceName("views", "abc")).toBeUndefined();
  });

  it("donne un libellé à chaque onglet", () => {
    for (const id of TAB_IDS) {
      expect(copy.viewer.tabs[id], id).toBeTruthy();
      expect(copy.viewer.kinds[id], id).toBeTruthy();
    }
  });
});

describe("visionneuse de Gabriel Knight : images et polices", () => {
  it("retourne une image de gauche à droite", () => {
    expect([...flipHorizontal(Uint8Array.from([1, 2, 3, 4, 5, 6]), 3, 2)]).toEqual([3, 2, 1, 6, 5, 4]);
  });

  it("place un cel par son point d'ancrage, celui du moteur, miroir compris", () => {
    // Marche de Gabriel : 43×56, décalage (2, 0), ancrée en bas au milieu.
    expect(celOffset({ width: 43, height: 56, originX: 2, originY: 0 }, false)).toEqual({ x: -19, y: -55 });
    expect(celOffset({ width: 43, height: 56, originX: 2, originY: 5 }, true)).toEqual({ x: -23, y: -50 });
    // Bouton de l'écran titre : 35×10, décalage (17, 9), ancré en haut à gauche.
    expect(celOffset({ width: 35, height: 10, originX: 17, originY: 9 }, false)).toEqual({ x: -0, y: -0 });
  });

  it("rend un texte et la planche des glyphes d'une police", () => {
    // Police de trois glyphes (codes 0 à 2) : vide, barre verticale 1×2, carré 2×2.
    const font = readFont(Uint8Array.from([0, 0, 3, 0, 3, 0, 12, 0, 14, 0, 18, 0, 0, 0, 1, 2, 0x80, 0x80, 2, 2, 0xc0, 0xc0]));
    expect(textWidth(font, Uint8Array.from([1, 2, 9]))).toBe(3);
    const text = renderText(font, "\u0001\u0002");
    expect([text.width, text.height]).toEqual([3, 3]);
    expect([...text.pixels]).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0]);
    expect(renderText(font, "")).toMatchObject({ width: 1, height: 3 });
    const sheet = glyphSheet(font);
    expect([sheet.cellWidth, sheet.cellHeight, sheet.width, sheet.height]).toEqual([3, 4, 3 * GLYPH_SHEET_COLUMNS, 4]);
    expect([...sheet.pixels.subarray(0, 9)]).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
  });
});

describe("visionneuse de Gabriel Knight : messages et sons", () => {
  // Deux entrées : (1, 2, 0, 1) « Bonjour » et (1, 3, 0, 1) « Au revoir ».
  const texts = [..."Bonjour\0Au revoir\0"].map((c) => c.charCodeAt(0));
  const header = [0xe1, 0x10, 0, 0, 32 + texts.length - 6, 0, 0, 0, 2, 0];
  const entries = [1, 2, 0, 1, 99, 32, 0, 0, 0, 0, 0, 1, 3, 0, 1, 1, 40, 0, 0, 0, 0, 0];
  const resource = readMessages(Uint8Array.from([...header, ...entries, ...texts, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  it("filtre par nom, verbe et texte", () => {
    expect(resource.entries.map((e) => e.text)).toEqual(["Bonjour", "Au revoir"]);
    expect(filterMessages(resource, {})).toHaveLength(2);
    expect(filterMessages(resource, { verb: 3 }).map((e) => e.text)).toEqual(["Au revoir"]);
    expect(filterMessages(resource, { noun: 1, text: " BON " }).map((e) => e.text)).toEqual(["Bonjour"]);
    expect(filterMessages(resource, { noun: 2 })).toEqual([]);
    expect(distinctValues(resource, "verb")).toEqual([2, 3]);
    expect(distinctValues(resource, "noun")).toEqual([1]);
  });

  it("nomme les périphériques connus", () => {
    expect(deviceName(SoundDevice.GeneralMidi)).toBe("General MIDI");
    expect(deviceName(6)).toBe("périphérique 6");
  });
});

describe.skipIf(!original.has)("visionneuse de Gabriel Knight : fichiers réels", () => {
  it("range chaque ressource de la map dans un onglet", () => {
    const index = mainIndex();
    const listed = TAB_IDS.reduce((sum, tab) => sum + resourceItems(index, tab).length, 0);
    expect(listed).toBe(index.size);
    expect(new Set(Object.values(TAB_RESOURCE_TYPES).flat()).size).toBe(new Set(index.list().map((r) => r.type)).size);
    expect(resourceItems(index, "views")).toHaveLength(837);
    expect(resourceItems(index, "fonts").map((item) => item.name)).toEqual(["0", "1", "2", "3", "4", "7", "8", "30", "40", "999", "9561"]);
    const other = resourceItems(index, "other");
    expect(other.slice(0, 4).map((item) => item.name)).toEqual(["vocab.994", "vocab.996", "vocab.997", "vocab.998"]);
    for (const item of other) expect(parseResourceName("other", item.name), item.name).toBeDefined();
    expect(resourceItems(altIndex(), "views")[0]).toEqual({ name: "1050", note: "RESOURCE.ALT" });
  });

  it("retourne les cels d'une boucle miroir et borne l'animation", () => {
    const view = readView(mainIndex().get(ResourceType.View, 0));
    expect(view.loops[1]).toMatchObject({ source: 0, mirrored: true });
    const plain = viewCelImage(view, 0, 0);
    const mirrored = viewCelImage(view, 1, 0);
    expect(mirrored.pixels).toEqual(flipHorizontal(plain.pixels, plain.width, plain.height));
    expect(plain.pixels).toEqual(decodeViewCel(view, 0, 0));
    expect(plain.transparent).toBe(view.loops[0].cels[0].skipColor);
    expect(loopBounds(view, 0)).toEqual({ left: -19, top: -55, width: 43, height: 56 });
    expect(loopBounds(view, 1)).toEqual({ left: -23, top: -55, width: 43, height: 56 });
  });

  it("dessine les cels d'un pic du fond vers l'avant", () => {
    const index = mainIndex();
    for (const number of index.numbers(ResourceType.Pic)) {
      const pic = readPic(index.get(ResourceType.Pic, number));
      const order = picDrawOrder(pic);
      expect(order[0], `pic ${number}`).toBe(0);
      expect([...order].sort((a, b) => a - b)).toEqual(pic.cels.map((_, i) => i));
      for (let i = 1; i < order.length; i++) expect(pic.cels[order[i]].priority).toBeGreaterThanOrEqual(pic.cels[order[i - 1]].priority);
    }
  });

  it("liste les pistes et les canaux d'un son", () => {
    const sound = readSound(mainIndex().get(ResourceType.Sound, 1));
    const rows = soundRows(sound);
    expect(rows.length).toBe(sound.tracks.reduce((sum, track) => sum + track.channels.length, 0));
    expect(rows.some((row) => row.isControl && row.midiChannel === 15)).toBe(true);
    expect(new Set(rows.map((row) => row.deviceName)).has("General MIDI")).toBe(true);
    expect(soundRows(readSound(mainIndex().get(ResourceType.Sound, 264)))).toEqual([]);
  });

  it("rend une réplique accentuée avec la police 0", () => {
    const font = readFont(mainIndex().get(ResourceType.Font, 0));
    const image = renderText(font, "Évêque à Noël");
    expect(image.height).toBeGreaterThanOrEqual(font.lineHeight);
    expect(image.width).toBeGreaterThan(40);
    expect(image.pixels.includes(1)).toBe(true);
  });
});
