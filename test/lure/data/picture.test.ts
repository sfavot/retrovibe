import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { catalogOf } from "./catalog-helper";
import { SCREEN_SIZE, decodeScreen, loadGameScreen, vgaDecode } from "../../../src/games/lure/data/picture";
import { hasOriginalFiles, lureResources } from "./helpers";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** Flux VGA minimal : table vide, octets bruts à 0x405, bits `0101 0000`. Sortie : un octet brut puis sa répétition, puis la fin. */
function tinyScreen(raw: number[], bits: number): Uint8Array {
  const bytes = new Uint8Array(0x405 + raw.length);
  bytes[0x400] = 0x05;
  bytes[0x401] = 0x04;
  bytes[0x404] = bits;
  bytes.set(raw, 0x405);
  return bytes;
}

describe("vgaDecode (données synthétiques)", () => {
  it("écrit l'octet brut, répète le dernier octet, puis s'arrête sur longueur 0 et octet 0", () => {
    const decoded = vgaDecode(tinyScreen([0x41, 0x03, 0x00, 0x00], 0b01010000), 100);
    expect([...decoded]).toEqual([0x41, 0x41, 0x41, 0x41]);
  });

  it("refuse une sortie plus grande que prévu et un flux tronqué", () => {
    expect(() => vgaDecode(tinyScreen([0x41, 0x03, 0x00, 0x00], 0b01010000), 3)).toThrow(/plus grande/);
    expect(() => vgaDecode(tinyScreen([0x41], 0b01010000), 100)).toThrow(/après la fin/);
    expect(() => vgaDecode(new Uint8Array(10), 100)).toThrow(/trop courtes/);
  });

  it("refuse l'en-tête « 5 bits » (variante EGA) que ScummVM détecte", () => {
    expect(() => decodeScreen(Uint8Array.from([0x01, 0x40, ...new Array(2000).fill(0)]))).toThrow(/5 bits/);
  });
});

describe.skipIf(!hasOriginalFiles)("écrans du jeu", () => {
  const res = { get: (id: number) => lureResources().get(id) };
  const screens = () => catalogOf().filter((entry) => entry.kind === "screen");
  const sequences = () => catalogOf().filter((entry) => entry.kind === "sequence-screen");

  it("décode les 98 écrans en 320 x 192 octets (61 440), sans écran « 5 bits »", () => {
    expect(screens()).toHaveLength(98);
    for (const entry of screens()) {
      const bytes = res.get(entry.id);
      expect(((bytes[0]! << 8) | bytes[1]!) & 0xfffe, `écran 0x${entry.id.toString(16)}`).not.toBe(0x140);
      expect(decodeScreen(bytes).length, `écran 0x${entry.id.toString(16)}`).toBe(61440);
    }
  });

  it("décode les 14 séquences plein écran : écran de départ de 64 000 octets et au moins une image", () => {
    expect(sequences()).toHaveLength(14);
    for (const entry of sequences()) expect(vgaDecode(res.get(entry.id), 300000).length, `séquence 0x${entry.id.toString(16)}`).toBeGreaterThanOrEqual(64000);
  });

  it("décode la barre de menus en 320 x 8 (2 560 octets)", () => {
    expect(decodeScreen(res.get(5)).length).toBe(2560);
  });

  it("pose l'écran sous la barre de menus : 8 premières lignes à zéro", () => {
    const screen = loadGameScreen(res.get(0x18));
    expect(screen).toHaveLength(SCREEN_SIZE);
    expect(screen.subarray(0, 8 * 320).every((value) => value === 0)).toBe(true);
    expect(screen.subarray(8 * 320).some((value) => value !== 0)).toBe(true);
  });

  // Valeurs relevées avec `decode.cpp` de ScummVM (`PictureDecoder::vgaDecode`) compilé tel quel dans un dossier de travail et lancé sur
  // les mêmes ressources ; la comparaison a porté sur les 112 écrans et séquences, octet à octet.
  const pictureCases: Array<[number, number, string]> = [
    [0x18, 61440, "a62d6a0b530bac54"],
    [0x1a, 61440, "4741f38c831f114d"],
    [0x4100, 61440, "0da034832bd2834e"],
    [0x7800, 61440, "d30057ec49154c2b"],
    [0x7900, 61440, "65113adf390fbed3"],
    [0x40, 188199, "e053bf1c71336b9e"],
    [0x4061, 225466, "086ea0eed8adc5bf"],
    [0xff01, 172885, "293f7a6b6dadb44a"],
  ];
  it.each(pictureCases.map(([id, size, hash]) => [id.toString(16), id, size, hash] as [string, number, number, string]))("la ressource 0x%s décode comme ScummVM (%i octets, empreinte %s)", (_name, id, size, hash) => {
    const decoded = vgaDecode(res.get(id), 300000);
    expect(decoded.length).toBe(size);
    expect(sha(decoded)).toBe(hash);
  });
});
