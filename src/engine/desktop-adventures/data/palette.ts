import type { DawVariant } from "./types";

/**
 * Palette 256 couleurs (BGRx), extraite de l'exécutable du jeu.
 * Les couleurs sont stockées en entiers 0xAABBGGRR, prêts à écrire dans un Uint32Array d'ImageData (little-endian).
 */
export type Palette = Uint32Array;

/** Position de la palette : `offset` octets après le début d'un marqueur (négatif : avant). */
const PALETTE_LOCATION: Record<DawVariant, { marker: number[]; offset: number }> = {
  // DESKADV.EXE : 100 octets avant la chaîne « sss ».
  indy: { marker: [0x73, 0x73, 0x73], offset: -100 },
  // YODESK.EXE : juste après le nom de classe « CDeskcppDoc » (et son 0 final), dans la section .data.
  yoda: { marker: [...Array.from("CDeskcppDoc", (c) => c.charCodeAt(0)), 0], offset: 12 },
};

export function extractPalette(exe: ArrayBuffer | Uint8Array, variant: DawVariant = "indy"): Palette {
  const bytes = exe instanceof Uint8Array ? exe : new Uint8Array(exe);
  const { marker, offset } = PALETTE_LOCATION[variant];
  const found = indexOf(bytes, marker);
  const start = found + offset;
  if (found < 0 || start < 0 || start + 1024 > bytes.length) throw new Error("Palette introuvable dans l'exécutable");
  const palette = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const b = bytes[start + i * 4];
    const g = bytes[start + i * 4 + 1];
    const r = bytes[start + i * 4 + 2];
    palette[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
  }
  palette[0] = 0; // transparent
  return palette;
}

function indexOf(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Plage animée de la palette : [début, nombre de couleurs]. */
type ColorCycle = [number, number];

/** Plages animées de chaque jeu (valeurs de WebFun), rapides (chaque tick) et lentes (un tick sur deux). */
export const COLOR_CYCLES: Record<DawVariant, { fast: ColorCycle[]; slow: ColorCycle[] }> = {
  indy: {
    fast: [
      [0xa0, 8],
      [0xe0, 5],
      [0xe5, 9],
    ],
    slow: [
      [0xee, 6],
      [0xf4, 2],
    ],
  },
  yoda: {
    fast: [
      [0x0a, 6],
      [0xca, 2],
      [0xcc, 2],
      [0xce, 2],
      [0xe0, 5],
      [0xee, 6],
    ],
    slow: [
      [0xc6, 2],
      [0xc8, 2],
      [0xd7, 9],
      [0xe5, 9],
      [0xf4, 2],
    ],
  },
};

/** Rotation de palette (eau, feu, lumières) avancée à chaque tick du jeu. */
export class PaletteAnimation {
  readonly current: Palette;
  private slowPhase = false;

  constructor(
    private readonly original: Palette,
    private readonly cycles = COLOR_CYCLES.indy,
  ) {
    this.current = original.slice();
  }

  reset(): void {
    this.current.set(this.original);
    this.slowPhase = false;
  }

  step(): void {
    for (const [start, count] of this.cycles.fast) this.cycle(start, count);
    this.slowPhase = !this.slowPhase;
    if (this.slowPhase) return;
    for (const [start, count] of this.cycles.slow) this.cycle(start, count);
  }

  private cycle(start: number, count: number): void {
    const p = this.current;
    const last = p[start + count - 1];
    for (let i = count - 1; i > 0; i--) p[start + i] = p[start + i - 1];
    p[start] = last;
  }
}
