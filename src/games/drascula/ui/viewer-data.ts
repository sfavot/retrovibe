/**
 * Logique pure de la visionneuse de ressources (sans DOM, testée) : groupes de la barre latérale, analyse des
 * images, correspondance voix -> texte, courbe d'une voix, cadences. Les palettes (`render/palette.ts`) et la police
 * (`render/font.ts`) sont celles du jeu, partagées avec le rendu.
 */
import type { DatTextName } from "../data/dat";
import { baseName, extensionOf } from "../data/files";
import { HALF_PAL_COLORS } from "../render/palette";

/** Cinématiques au format SSN (les autres `.BIN` sont au format « animate ») : partition vérifiée par `bin-ssn.test.ts`. */
export const SSN_NAMES: ReadonlySet<string> = new Set(["INTRO", "LOGOALC", "LOGODDM", "QPC", "CDR", "CRD", "SCROLLB"]);

/** Nom d'un fichier sans dossier ni extension, en majuscules. */
export function stem(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return (dot < 0 ? name : name.slice(0, dot)).toUpperCase();
}

export function isSsnName(path: string): boolean {
  return SSN_NAMES.has(stem(path));
}

/** Voix : préfixe du nom -> section de `drascula.dat` qui porte les textes (`formats.md`, « Sons et voix »). */
export const VOICE_TEXT: Readonly<Record<string, DatTextName>> = {
  "": "text",
  D: "textd",
  B: "textb",
  BJ: "textbj",
  E: "texte",
  I: "texti",
  L: "textl",
  P: "textp",
  T: "textt",
  VB: "textvb",
};

/** Groupe (dossier de la barre latérale) d'un fichier du jeu. */
export function family(path: string): string {
  const name = baseName(path).toUpperCase();
  switch (extensionOf(path)) {
    case "ALG":
      if (/^\d+\.ALG$/.test(name)) return "Images : décors et écrans (n.ALG)";
      if (name.startsWith("AUX")) return "Images : feuilles annexes (AUX)";
      return "Images : animations et interface";
    case "ALD":
      return "Pièces (.ALD)";
    case "CAL":
      return "Dialogues (.CAL)";
    case "BIN":
      return isSsnName(path) ? "Vidéos : cinématiques (SSN)" : "Vidéos : animations";
    case "ALS": {
      const match = /^([A-Z]*)\d+\.ALS$/.exec(name);
      const prefix = match?.[1] ?? "";
      if (prefix === "S") return "Sons : effets (S)";
      if (prefix === "F") return "Sons : séquence finale (F)";
      return `Voix : ${prefix === "" ? "répliques (n)" : prefix}`;
    }
    case "MP3":
      return "Musique";
    case "PNG":
      return "Jaquette (générée)";
    default:
      return "Données et textes";
  }
}

/** Combien de pixels utilisent une couleur de la moitié réservée (indices 128 à 255) ? */
export function reservedPixels(pixels: Uint8Array): number {
  let count = 0;
  for (const pixel of pixels) if (pixel >= HALF_PAL_COLORS) count++;
  return count;
}

/** Indices distincts utilisés par l'image. */
export function usedColors(pixels: Uint8Array): number {
  const seen = new Uint8Array(256);
  for (const pixel of pixels) seen[pixel] = 1;
  return seen.reduce((sum, flag) => sum + flag, 0);
}

/** Courbe d'une voix : minimum et maximum (échantillons 8 bits non signés) de chaque colonne de `width` pixels. */
export function waveformPeaks(samples: Uint8Array, width: number): { min: number; max: number }[] {
  const peaks: { min: number; max: number }[] = [];
  for (let x = 0; x < width; x++) {
    const from = Math.floor((x * samples.length) / width);
    const to = Math.max(from + 1, Math.floor(((x + 1) * samples.length) / width));
    let min = 255;
    let max = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const value = samples[i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    peaks.push(from < samples.length ? { min, max } : { min: 128, max: 128 });
  }
  return peaks;
}

/** Durée d'une suite d'images à `fps` images par seconde, en secondes. */
export function playDuration(frames: number, fps: number): number {
  return fps > 0 ? frames / fps : 0;
}

/**
 * Cadences d'appel dans ScummVM (`animation.cpp`, `rooms.cpp`) : `playFLI(nom, vitesse)` (SSN : une image ou un
 * bloc vide par tour de `1000 / vitesse` ms) et `animate(nom, ips)` (animations : `1000 / ips` ms d'attente après
 * chaque image). Un fichier appelé plusieurs fois avec des vitesses différentes les liste toutes (`RAYO1`, `RAYO2`).
 * `CDR.BIN` n'est jamais joué par ScummVM.
 */
export const PLAY_SPEEDS: Readonly<Record<string, readonly number[]>> = {
  AG: [14],
  BEB: [10],
  BES: [16],
  BIO: [14],
  BJB: [14],
  CNF: [14],
  CRD: [1],
  DET: [17],
  DRF: [16],
  FIN: [14],
  FREL: [16],
  FREL2: [16],
  FUM: [15],
  GAF: [15],
  HBP: [14],
  INTRO: [12],
  LEV: [15],
  LIB: [16],
  LIB2: [16],
  LOGOALC: [8],
  LOGODDM: [9],
  MAN: [14],
  QPC: [1],
  RAP: [16],
  RAYO1: [16, 23],
  RAYO2: [15, 17],
  RCT: [11],
  SCR2: [17],
  SCR3: [17],
  SCROLLB: [9],
  ST: [14],
  UP: [14],
};

/** Cadence par défaut d'un `.BIN` (la première connue), ou `fallback`. */
export function defaultSpeed(path: string, fallback = 12): number {
  return PLAY_SPEEDS[stem(path)]?.[0] ?? fallback;
}
