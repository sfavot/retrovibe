import { encodeCp850 } from "../../src/data/cp850";
import { originalFiles } from "../support/original";

const original = originalFiles("drascula", "drascula.dat");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/drascula-extract.sh`). */
export const hasOriginalFiles = original.has;

/** Lit un fichier de `original/drascula/`, tel que `14.ALD`. */
export function readOriginal(path: string): Uint8Array {
  return original.read(path);
}

/** Noms des fichiers de `original/drascula/` qui satisfont `match`, triés. */
export function listOriginal(match: (name: string) => boolean): string[] {
  return original.list(match);
}

/** Entrées de `files.json`. */
export function readManifest() {
  const manifest = original.manifest();
  if (!manifest) throw new Error("files.json absent");
  return manifest;
}

export const byExtension = (extension: string) => (name: string) => name.toUpperCase().endsWith(`.${extension}`);

/** Encodeur RLE de type PCX (inverse de `decodeRle`) : répétitions de 63 au plus ; un pixel >= 0xC0 isolé passe par une répétition de 1. */
export function encodeRle(pixels: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < pixels.length; ) {
    let run = 1;
    while (i + run < pixels.length && pixels[i + run] === pixels[i] && run < 63) run++;
    if (run > 1 || pixels[i] >= 0xc0) out.push(0xc0 | run);
    out.push(pixels[i]);
    i += run;
  }
  return out;
}

/** Image 320 x 200 déterministe, avec des à-plats, des pixels isolés et des valeurs >= 0xC0. */
export function sampleImage(seed = 1): Uint8Array {
  const pixels = new Uint8Array(320 * 200);
  let state = seed;
  for (let i = 0; i < pixels.length; ) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const run = 1 + (state >> 8) % 90;
    const value = (state >> 16) & 0xff;
    for (let k = 0; k < run && i < pixels.length; k++) pixels[i++] = value;
  }
  return pixels;
}

/** Fichier texte du jeu : lignes séparées par `\n`, CP850, octets inversés. */
export function encodeGameText(lines: readonly string[], separator = "\n"): Uint8Array {
  return Uint8Array.from(encodeCp850(lines.join(separator) + separator), (byte) => byte ^ 0xff);
}
