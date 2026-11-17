import { describe, expect, it } from "vitest";
import { audioDuration, parseAudioIndex } from "../../../src/engine/infogrames/data/audio-index";
import { parsePfn } from "../../../src/engine/infogrames/data/font";
import { HY8_PART_IMAGE, HY8_PART_RECT, HY8_PART_SUB_SPRITE, parseHy8 } from "../../../src/engine/infogrames/data/hy8";
import { parseMcg, parsePal } from "../../../src/engine/infogrames/data/mcg";
import { VidDecoder } from "../../../src/engine/infogrames/data/vid";
import { boundsOf, placeFrame, placeSprite } from "../../../src/engine/infogrames/sprites";
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
 * Inventaire de `original/asterix/` : chaque fichier a un lecteur. Les MCG, HY8, PFN et PAL sont lus ici jusqu'au dernier
 * octet par les lecteurs du moteur commun (`src/engine/infogrames/`) ; les MCC, les conteneurs vidéo, le quiz et le
 * générique le sont dans leurs propres tests.
 */
/** Totaux des 30 HY8 (mesurés par ce test ; une seule partie n'est pas une image : le rectangle de `M32SA000`). */
const HY8_TOTALS = { images: 476, sprites: 636, animations: 112, imageParts: 661, subSprites: 26, empty: 10 };

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
      const { header } = new VidDecoder(readOriginal(path));
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
      const { header } = new VidDecoder(readOriginal(path));
      expect([header.frameDivisor, header.audioFrequency, header.audioSamples], path).toEqual([0, 0, 0]);
    }
  });

  it("lit les 106 MCG avec le lecteur du moteur commun", () => {
    const list = listOriginal(withSuffix(".MCG"));
    expect(list).toHaveLength(106);
    for (const path of list) {
      // `parseMcg` refuse toute autre taille que 2 + 768 + 64 000 octets : le fichier est lu en entier.
      const mcg = parseMcg(readOriginal(path));
      expect([mcg.header, mcg.palette.length, mcg.pixels.length], path).toEqual([0, 768, 64000]);
    }
  });

  it("lit les 30 HY8 avec le lecteur du moteur commun, et pose chaque sprite et chaque image d'animation", () => {
    const u32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
    const list = listOriginal(withSuffix(".HY8"));
    expect(list).toHaveLength(30);
    const totals = { images: 0, sprites: 0, animations: 0, imageParts: 0, subSprites: 0, empty: 0 };
    const withRect: string[] = [];
    for (const path of list) {
      const bytes = readOriginal(path);
      // Six u32 : début de la table (0x18) … fin de la dernière section, qui est la fin du fichier.
      expect([u32(bytes, 0), u32(bytes, 20)], path).toEqual([0x18, bytes.length]);
      const hy8 = parseHy8(bytes);
      expect(hy8.trailer.byteOffset + hy8.trailer.length - bytes.byteOffset, path).toBe(bytes.length);
      totals.images += hy8.images.length;
      totals.sprites += hy8.sprites.length;
      totals.animations += hy8.animations.length;
      hy8.sprites.forEach((sprite, index) => {
        for (const part of sprite.parts) {
          if (part.kind === HY8_PART_IMAGE) totals.imageParts++;
          else if (part.kind === HY8_PART_SUB_SPRITE) totals.subSprites++;
          else {
            expect(part.kind, `${path} sprite ${index}`).toBe(HY8_PART_RECT);
            withRect.push(`${path}#${index}`);
          }
        }
        const bounds = boundsOf(placeSprite(hy8, index, false));
        if (sprite.parts.length === 0) totals.empty++;
        else expect(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY, `${path} sprite ${index}`).toBe(true);
      });
      for (const animation of hy8.animations) for (const frame of animation.frames) placeFrame(hy8, frame);
    }
    expect(totals).toEqual(HY8_TOTALS);
    expect(withRect).toEqual(["MDF/32/M32SA000.HY8#60"]);
  });

  it("lit les 4 PFN et la palette PAL avec les lecteurs du moteur commun", () => {
    const fonts = listOriginal(withSuffix(".PFN")).map((path) => {
      // `parsePfn` impose que la table des glyphes aille de la fin de la bande à la fin du fichier.
      const font = parsePfn(readOriginal(path));
      return [path, font.height, font.firstChar, font.glyphs.size];
    });
    expect(fonts).toEqual([
      ["MDF/52/M52D0.PFN", 12, 1, 253],
      ["MDF/52/M52D1.PFN", 10, 0x20, 223],
      ["MDF/52/M52D2.PFN", 10, 0x20, 223],
      ["MDF/52/M52D3.PFN", 12, 1, 253],
    ]);
    expect(listOriginal(withSuffix(".PAL"))).toEqual(["MDF/27/M27S.PAL"]);
    expect(parsePal(readOriginal("MDF/27/M27S.PAL")).length).toBe(768);
  });

  it("garde l'exécutable tel quel", () => {
    const exe = readOriginal("ASTERIX.EXE");
    expect([exe.length, String.fromCharCode(exe[0], exe[1])]).toEqual([153328, "MZ"]);
  });
});
