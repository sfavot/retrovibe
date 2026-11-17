import { describe, expect, it } from "vitest";
import { audioDuration, parseAudioIndex } from "../../../src/engine/infogrames/data/audio-index";
import { VideoDecoder } from "../../../src/games/asterix/data/video";
import { hasOriginalFiles, listOriginal, readOriginal, withSuffix } from "../helpers";

describe("parseAudioIndex (sans fichier)", () => {
  it("lit les entrées et donne la durée exacte", () => {
    const index = parseAudioIndex('{"MDF/01/A.VOC.mp3":[19231,19231],"MDF/06/B.MUX.mp3":[9433,18867]}');
    expect([...index.keys()]).toEqual(["MDF/01/A.VOC.mp3", "MDF/06/B.MUX.mp3"]);
    expect(audioDuration(index.get("MDF/01/A.VOC.mp3")!)).toBe(1);
    expect(index.get("MDF/06/B.MUX.mp3")).toEqual({ samples: 9433, sampleRate: 18867 });
  });

  it("refuse une entrée mal formée", () => {
    expect(() => parseAudioIndex("[]")).toThrow("objet attendu");
    expect(() => parseAudioIndex('{"a.mp3":[1]}')).toThrow("entrée invalide pour a.mp3");
    expect(() => parseAudioIndex('{"a.mp3":[1.5,19231]}')).toThrow("entrée invalide");
    expect(() => parseAudioIndex('{"a.mp3":[10,0]}')).toThrow("entrée invalide");
  });
});

/**
 * Inventaire de `original/asterix/` : chaque fichier a un lecteur ou un contrôle. Les lecteurs du moteur commun aux
 * Schtroumpfs (MCG, HY8, PFN, PAL) ne sont pas importés ici tant qu'ils ne sont pas dans `src/engine/infogrames/` : ces
 * formats n'ont qu'un contrôle de structure (ils ont été lus en entier par ces lecteurs pendant l'étude). Les MCC, les
 * conteneurs vidéo, le quiz et le générique sont lus jusqu'au dernier octet dans leurs propres tests.
 */
describe.skipIf(!hasOriginalFiles)("original/asterix", () => {
  const SUFFIXES: Record<string, number> = {
    ".VOC.mp3": 736,
    ".MUX.mp3": 116,
    ".MUX.vid": 117,
    ".MUK.vid": 31,
    ".MCG": 106,
    ".MCC": 80,
    ".HY8": 30,
    ".TXT": 9,
    ".PFN": 4,
    ".DAT": 1,
    ".PAL": 1,
  };
  const OUTSIDE = ["ASTERIX.EXE", "COVER.webp", "audio.json", "files.json"];

  it("ne contient que les fichiers prévus, rangés par module", () => {
    const counts: Record<string, number> = {};
    for (const path of listOriginal()) {
      if (OUTSIDE.includes(path)) continue;
      const match = /^MDF\/\d\d\/[A-Z0-9_]+(\.[A-Z0-9]+(?:\.mp3|\.vid)?)$/.exec(path);
      expect(match, path).not.toBeNull();
      const suffix = match![1];
      counts[suffix] = (counts[suffix] ?? 0) + 1;
    }
    expect(counts).toEqual(SUFFIXES);
  });

  it("a un manifeste files.json à jour", () => {
    const manifest: { path: string; size: number }[] = JSON.parse(new TextDecoder().decode(readOriginal("files.json")));
    const listed = listOriginal().filter((path) => path !== "files.json");
    expect(manifest.map((entry) => entry.path).sort()).toEqual(listed);
    for (const entry of manifest) expect(readOriginal(entry.path).length, entry.path).toBe(entry.size);
  });

  it("indexe chaque MP3, et seulement eux, avec la durée du son d'origine", () => {
    const index = parseAudioIndex(new TextDecoder().decode(readOriginal("audio.json")));
    const mp3 = listOriginal(withSuffix(".mp3"));
    expect([...index.keys()].sort()).toEqual(mp3);
    const rates: Record<number, number> = {};
    let vocSeconds = 0;
    for (const path of mp3) {
      const entry = index.get(path)!;
      rates[entry.sampleRate] = (rates[entry.sampleRate] ?? 0) + 1;
      if (path.endsWith(".VOC.mp3")) vocSeconds += audioDuration(entry);
      // Étiquette ID3v2 vide (en-tête de 10 octets et 10 octets de remplissage, écrits par ffmpeg), puis une trame
      // MPEG audio couche III.
      const bytes = readOriginal(path);
      expect([...bytes.subarray(0, 10)], path).toEqual([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10]);
      expect(bytes[20] === 0xff && (bytes[21] & 0xe6) === 0xe2, path).toBe(true);
      // 32 kb/s : 4 000 octets par seconde, à l'amorce et au remplissage de l'encodeur près.
      expect(Math.abs(bytes.length - audioDuration(entry) * 4000), path).toBeLessThan(1200);
    }
    expect(rates).toEqual({ 11111: 2, 18867: 91, 18868: 4, 19230: 23, 19231: 731, 19607: 1 });
    expect(Math.round(vocSeconds)).toBe(3442);
  });

  it("accorde le son de chaque vidéo MUX à son conteneur", () => {
    const index = parseAudioIndex(new TextDecoder().decode(readOriginal("audio.json")));
    const silent: string[] = [];
    for (const path of listOriginal(withSuffix(".MUX.vid"))) {
      const { header } = new VideoDecoder(readOriginal(path));
      const entry = index.get(path.replace(/\.vid$/, ".mp3"));
      expect(header.framesPerSecond, path).toBeGreaterThan(3);
      expect(header.framesPerSecond, path).toBeLessThan(14);
      if (!entry) {
        silent.push(path);
        expect(header.audioSamples, path).toBe(0);
        continue;
      }
      expect({ samples: header.audioSamples, sampleRate: header.audioFrequency }, path).toEqual(entry);
    }
    expect(silent).toEqual(["MDF/23/M23AA.MUX.vid"]);
    for (const path of listOriginal(withSuffix(".MUK.vid"))) {
      const { header } = new VideoDecoder(readOriginal(path));
      expect([header.frameDivisor, header.audioFrequency, header.audioSamples], path).toEqual([0, 0, 0]);
    }
  });

  it("garde tels quels les fichiers lus par le moteur commun (contrôle de structure)", () => {
    const u32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
    for (const path of listOriginal(withSuffix(".MCG"))) {
      const bytes = readOriginal(path);
      // En-tête nul de 2 octets, palette de 768 octets, 64 000 pixels.
      expect([bytes.length, bytes[0], bytes[1]], path).toEqual([64770, 0, 0]);
    }
    for (const path of listOriginal(withSuffix(".HY8"))) {
      const bytes = readOriginal(path);
      // Six u32 : début de la table (0x18) … taille du fichier.
      expect([u32(bytes, 0), u32(bytes, 20)], path).toEqual([0x18, bytes.length]);
    }
    expect(readOriginal("MDF/27/M27S.PAL").length).toBe(768);
    expect(listOriginal(withSuffix(".PFN"))).toEqual(["MDF/52/M52D0.PFN", "MDF/52/M52D1.PFN", "MDF/52/M52D2.PFN", "MDF/52/M52D3.PFN"]);
    const exe = readOriginal("ASTERIX.EXE");
    expect([exe.length, String.fromCharCode(exe[0], exe[1])]).toEqual([153328, "MZ"]);
  });
});
