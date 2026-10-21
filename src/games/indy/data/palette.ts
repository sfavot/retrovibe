/**
 * Palette 256 couleurs, extraite de DESKADV.EXE (BGRx, juste avant la chaîne « sss »).
 * Les couleurs sont stockées en entiers 0xAABBGGRR, prêts à écrire dans un Uint32Array d'ImageData (little-endian).
 */
export type Palette = Uint32Array;

const PALETTE_MARKER = [0x73, 0x73, 0x73]; // "sss"
const PALETTE_OFFSET_FROM_MARKER = 100;

export function extractPalette(exe: ArrayBuffer | Uint8Array): Palette {
  const bytes = exe instanceof Uint8Array ? exe : new Uint8Array(exe);
  const marker = indexOf(bytes, PALETTE_MARKER);
  if (marker < PALETTE_OFFSET_FROM_MARKER) throw new Error("Palette introuvable dans l'exécutable");
  const start = marker - PALETTE_OFFSET_FROM_MARKER;
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

/** Plages animées de la palette d'Indy : [début, nombre de couleurs]. */
const FAST_CYCLES: Array<[number, number]> = [
  [0xa0, 8],
  [0xe0, 5],
  [0xe5, 9],
];
const SLOW_CYCLES: Array<[number, number]> = [
  [0xee, 6],
  [0xf4, 2],
];

/** Rotation de palette (eau, feu, lumières) avancée à chaque tick du jeu. */
export class PaletteAnimation {
  readonly current: Palette;
  private slowPhase = false;

  constructor(private readonly original: Palette) {
    this.current = original.slice();
  }

  reset(): void {
    this.current.set(this.original);
    this.slowPhase = false;
  }

  step(): void {
    for (const [start, count] of FAST_CYCLES) this.cycle(start, count);
    this.slowPhase = !this.slowPhase;
    if (this.slowPhase) return;
    for (const [start, count] of SLOW_CYCLES) this.cycle(start, count);
  }

  private cycle(start: number, count: number): void {
    const p = this.current;
    const last = p[start + count - 1];
    for (let i = count - 1; i > 0; i--) p[start + i] = p[start + i - 1];
    p[start] = last;
  }
}
