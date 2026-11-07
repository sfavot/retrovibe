import { describe, expect, it } from "vitest";
import {
  PLAY_SPEEDS,
  SSN_NAMES,
  defaultSpeed,
  family,
  isSsnName,
  playDuration,
  reservedPixels,
  stem,
  usedColors,
  waveformPeaks,
} from "../../../src/games/drascula/ui/viewer-data";
import { parseSsn } from "../../../src/games/drascula/data/bin-ssn";
import { byExtension, hasOriginalFiles, listOriginal, readOriginal } from "../helpers";

describe("groupes de la barre latérale", () => {
  it("range chaque famille de fichiers dans son groupe", () => {
    expect(family("14.ALG")).toBe("Images : décors et écrans (n.ALG)");
    expect(family("AUX14.ALG")).toBe("Images : feuilles annexes (AUX)");
    expect(family("OP_1.ALG")).toBe("Images : animations et interface");
    expect(family("14.ALD")).toBe("Pièces (.ALD)");
    expect(family("OP_5.CAL")).toBe("Dialogues (.CAL)");
    expect(family("INTRO.BIN")).toBe("Vidéos : cinématiques (SSN)");
    expect(family("FIN.BIN")).toBe("Vidéos : animations");
    expect(family("214.ALS")).toBe("Voix : répliques (n)");
    expect(family("BJ12.ALS")).toBe("Voix : BJ");
    expect(family("S4.ALS")).toBe("Sons : effets (S)");
    expect(family("F2.ALS")).toBe("Sons : séquence finale (F)");
    expect(family("track3.mp3")).toBe("Musique");
    expect(family("drascula.dat")).toBe("Données et textes");
  });

  it("ignore la casse et le dossier", () => {
    expect(family("sub/intro.bin")).toBe("Vidéos : cinématiques (SSN)");
    expect(stem("dir/Lev.bin")).toBe("LEV");
    expect(isSsnName("scrollb.bin")).toBe(true);
    expect(isSsnName("lev.bin")).toBe(false);
  });
});

describe("analyse des images", () => {
  it("compte les pixels de la moitié réservée et les indices utilisés", () => {
    const pixels = Uint8Array.of(0, 127, 128, 255, 255, 3);
    expect(reservedPixels(pixels)).toBe(3);
    expect(usedColors(pixels)).toBe(5);
  });
});

describe("cadence", () => {
  it("durée d'une suite d'images", () => {
    expect(playDuration(542, 12)).toBeCloseTo(45.17, 2);
    expect(playDuration(10, 0)).toBe(0);
  });

  it("cadence par défaut : la première connue", () => {
    expect(defaultSpeed("INTRO.BIN")).toBe(12);
    expect(defaultSpeed("rayo1.bin")).toBe(16);
    expect(defaultSpeed("CDR.BIN")).toBe(12);
    expect(defaultSpeed("CDR.BIN", 7)).toBe(7);
  });
});

describe("courbe d'une voix", () => {
  it("minimum et maximum de chaque colonne", () => {
    const peaks = waveformPeaks(Uint8Array.of(128, 200, 50, 128, 128, 128, 10, 250), 4);
    expect(peaks).toEqual([
      { min: 128, max: 200 },
      { min: 50, max: 128 },
      { min: 128, max: 128 },
      { min: 10, max: 250 },
    ]);
  });

  it("plus de colonnes que d'échantillons : les colonnes au-delà restent au silence", () => {
    const peaks = waveformPeaks(Uint8Array.of(10, 20), 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toEqual({ min: 10, max: 10 });
  });
});

describe.skipIf(!hasOriginalFiles)("fichiers du jeu", () => {
  const bins = listOriginal(byExtension("BIN"));

  it("les noms SSN de la visionneuse sont exactement les .BIN qui se lisent en SSN", () => {
    const ssn = bins.filter((name) => {
      try {
        parseSsn(readOriginal(name));
        return true;
      } catch {
        return false;
      }
    });
    expect(ssn.map(stem).sort()).toEqual([...SSN_NAMES].sort());
  });

  it("la table des cadences couvre tous les .BIN sauf CDR, jamais joué par ScummVM", () => {
    const missing = bins.map(stem).filter((name) => !(name in PLAY_SPEEDS));
    expect(missing).toEqual(["CDR"]);
    expect(Object.keys(PLAY_SPEEDS).every((name) => bins.map(stem).includes(name))).toBe(true);
  });
});
