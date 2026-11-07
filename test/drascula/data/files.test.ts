import { describe, expect, it } from "vitest";
import { dialogFile, extensionOf, GameFiles, parseVoiceName, roomFile, voiceFile } from "../../../src/games/drascula/data/files";
import { hasOriginalFiles, readManifest } from "../helpers";

const synthetic = new GameFiles([
  { path: "14.ALD", size: 1 },
  { path: "2.ALD", size: 1 },
  { path: "OP_5.CAL", size: 1 },
  { path: "OP_12.CAL", size: 1 },
  { path: "214.ALS", size: 1 },
  { path: "BJ1.ALS", size: 1 },
  { path: "VB10.ALS", size: 1 },
  { path: "VB2.ALS", size: 1 },
  { path: "96.ALG", size: 1 },
  { path: "AUX14.ALG", size: 1 },
]);

describe("noms de fichiers", () => {
  it("compose les noms demandés par le jeu", () => {
    expect(roomFile(14)).toBe("14.ald");
    expect(dialogFile(5)).toBe("op_5.cal");
    expect(voiceFile("BJ", 3)).toBe("BJ3.als");
    expect(voiceFile("", 214)).toBe("214.als");
  });

  it("découpe un nom de voix", () => {
    expect(parseVoiceName("214.als")).toEqual({ prefix: "", number: 214 });
    expect(parseVoiceName("bj12.ALS")).toEqual({ prefix: "BJ", number: 12 });
    expect(parseVoiceName("VB62.ALS")).toEqual({ prefix: "VB", number: 62 });
    expect(parseVoiceName("14.ALD")).toBeNull();
    expect(parseVoiceName("AUX14.ALG")).toBeNull();
  });

  it("donne l'extension en majuscules", () => {
    expect(extensionOf("original/x.als")).toBe("ALS");
    expect(extensionOf("README")).toBe("");
  });
});

describe("GameFiles (données synthétiques)", () => {
  it("résout les noms sans tenir compte de la casse", () => {
    expect(synthetic.resolve("214.als")).toBe("214.ALS");
    expect(synthetic.resolve("bj1.als")).toBe("BJ1.ALS");
    expect(synthetic.resolve("op_5.cal")).toBe("OP_5.CAL");
    expect(synthetic.resolve("96.alg")).toBe("96.ALG");
    expect(synthetic.resolve("999.als")).toBeUndefined();
  });

  it("liste les pièces, les dialogues et les voix, triés numériquement", () => {
    expect(synthetic.rooms()).toEqual([2, 14]);
    expect(synthetic.dialogs()).toEqual([5, 12]);
    expect([...synthetic.voices()]).toEqual([["", [214]], ["BJ", [1]], ["VB", [2, 10]]]);
  });
});

describe.skipIf(!hasOriginalFiles)("files.json du jeu", () => {
  const manifest = readManifest();
  const files = new GameFiles(manifest);
  const count = (extension: string) => manifest.filter((entry) => extensionOf(entry.path) === extension).length;

  it("compte les fichiers de chaque famille", () => {
    expect([count("ALG"), count("ALD"), count("CAL"), count("BIN"), count("ALS")]).toEqual([225, 57, 13, 33, 783]);
    expect(count("DAT")).toBe(1);
    expect(count("MP3")).toBe(31);
  });

  it("a les 31 pistes de musique track1.mp3 à track31.mp3 et le QPC.BIN français (163 900 octets)", () => {
    for (let track = 1; track <= 31; track++) expect(files.has(`track${track}.mp3`), `track${track}.mp3`).toBe(true);
    expect(files.size("QPC.BIN")).toBe(163900);
  });

  it("résout les noms que le jeu demande, en toute casse", () => {
    expect(files.resolve(roomFile(14))).toBe("14.ALD");
    expect(files.resolve(dialogFile(5))).toBe("OP_5.CAL");
    expect(files.resolve(voiceFile("BJ", 1))).toBe("BJ1.ALS");
    expect(files.resolve("214.als")).toBe("214.ALS");
    expect(files.resolve("96.alg")).toBe("96.ALG");
    expect(files.resolve("qpc.bin")).toBe("QPC.BIN");
    expect(files.resolve("DRASCULA.DAT")).toBe("drascula.dat");
  });

  it("liste 57 pièces et 13 dialogues", () => {
    expect(files.rooms()).toHaveLength(57);
    expect(files.rooms().slice(0, 3)).toEqual([1, 2, 3]);
    expect(files.rooms().at(-1)).toBe(102);
    expect(files.dialogs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("répartit les 783 voix par préfixe", () => {
    const counts = Object.fromEntries([...files.voices()].map(([prefix, numbers]) => [prefix, numbers.length]));
    expect(counts).toEqual({ "": 463, D: 68, VB: 62, I: 32, L: 30, BJ: 28, T: 24, E: 23, P: 19, B: 16, S: 15, F: 3 });
    expect(Math.max(...files.voices().get("")!)).toBe(500);
    expect(Math.max(...files.voices().get("D")!)).toBe(83);
    expect(Math.max(...files.voices().get("S")!)).toBe(15);
  });
});
