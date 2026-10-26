/**
 * Correction gamma (`gm_gamma_build` `0042469c`, docs/swiv3d/screens.md §4.6) : 4 tables de 64 entrées sur les composantes VGA 6 bits,
 * `63 · (i/63)^(1 − 0,125 · g)` tronqué (`gm_ftol_trunc`), la table 0 étant l'identité. L'original la passe à **chaque** palette envoyée à
 * la carte (`gm_palette_set` `0042fddc` : écrans fixes, vidéos Smacker, niveau ; `gm_modex_enter` la réémet au changement de réglage) ;
 * le port l'applique au moment de présenter l'image, sur la table de couleurs RGBA de l'écran.
 */
import { GAMMA_LEVELS } from "../screens/pilots";

/** Table 6 bits -> 6 bits du niveau `g` (0 à 3). */
export function gammaTable(g: number): Uint8Array {
  const table = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    // Constantes de l'exe : 1/63 (`00480364`), 0,125 (`0048036c`), 63 (`00480374`).
    table[i] = g === 0 ? i : Math.trunc(Math.pow(i * (1 / 63), 1 - g * 0.125) * 63);
  }
  return table;
}

const TABLES = Array.from({ length: GAMMA_LEVELS }, (_, g) => gammaTable(g));

/** Une composante 8 bits du port (`v6 << 2 | v6 >> 4`, `vga6ToRgb8` et Smacker) passée par la table : retour au 6 bits, table, 8 bits. */
function correct(table: Uint8Array, v8: number): number {
  const v = table[v8 >> 2]!;
  return (v << 2) | (v >> 4);
}

/**
 * Table de couleurs (`paletteToLut`) corrigée. En mémoire, chaque entrée est rangée R, V, B, A quel que soit le boutisme (c'est
 * l'ordre d'`ImageData`) : on corrige les trois premiers octets et on garde l'alpha.
 */
export function applyGamma(lut: Uint32Array, g: number): Uint32Array {
  const table = TABLES[g];
  if (!table || g === 0) return lut;
  const out = lut.slice();
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = correct(table, bytes[i]!);
    bytes[i + 1] = correct(table, bytes[i + 1]!);
    bytes[i + 2] = correct(table, bytes[i + 2]!);
  }
  return out;
}

/** Présentation corrigée : garde la dernière table calculée par table source (les palettes changent rarement). */
export class GammaCache {
  private readonly cache = new WeakMap<Uint32Array, { g: number; lut: Uint32Array }>();
  level = 0;

  lut(source: Uint32Array): Uint32Array {
    if (this.level === 0) return source;
    const hit = this.cache.get(source);
    if (hit && hit.g === this.level) return hit.lut;
    const lut = applyGamma(source, this.level);
    this.cache.set(source, { g: this.level, lut });
    return lut;
  }
}
