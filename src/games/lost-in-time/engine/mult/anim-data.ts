/** Taille d'un Mult_AnimData (structure compactée de ScummVM). */
export const ANIM_DATA_SIZE = 35;

const s8 = (v: number): number => (v << 24) >> 24;

/**
 * Mult_AnimData : état d'animation d'un objet. Les octets vivent soit dans les variables du script
 * (initMult : les scripts les lisent et les écrivent eux-mêmes), soit dans un tampon interne (playMult).
 */
export class AnimData {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly base: number,
  ) {
    if (base < 0 || base + ANIM_DATA_SIZE > bytes.length) {
      throw new RangeError(`AnimData hors des variables (décalage ${base}, taille ${bytes.length})`);
    }
  }

  /** Octet brut `i` (loadMultObject remplit les 11 premiers). */
  setByte(i: number, value: number): void {
    this.bytes[this.base + i] = value;
  }

  get animation(): number { return s8(this.bytes[this.base]); }
  set animation(v: number) { this.bytes[this.base] = v; }
  get layer(): number { return this.bytes[this.base + 1]; }
  set layer(v: number) { this.bytes[this.base + 1] = v; }
  get frame(): number { return this.bytes[this.base + 2]; }
  set frame(v: number) { this.bytes[this.base + 2] = v; }
  get animType(): number { return s8(this.bytes[this.base + 3]); }
  set animType(v: number) { this.bytes[this.base + 3] = v; }
  get order(): number { return s8(this.bytes[this.base + 4]); }
  set order(v: number) { this.bytes[this.base + 4] = v; }
  get isPaused(): number { return s8(this.bytes[this.base + 5]); }
  set isPaused(v: number) { this.bytes[this.base + 5] = v; }
  get isStatic(): number { return s8(this.bytes[this.base + 6]); }
  set isStatic(v: number) { this.bytes[this.base + 6] = v; }
  get maxTick(): number { return s8(this.bytes[this.base + 7]); }
  set maxTick(v: number) { this.bytes[this.base + 7] = v; }
  get newLayer(): number { return this.bytes[this.base + 9]; }
  set newLayer(v: number) { this.bytes[this.base + 9] = v; }
  get newAnimation(): number { return s8(this.bytes[this.base + 10]); }
  set newAnimation(v: number) { this.bytes[this.base + 10] = v; }
  get intersected(): number { return this.bytes[this.base + 11]; }
  set intersected(v: number) { this.bytes[this.base + 11] = v; }
  get newCycle(): number { return this.bytes[this.base + 12]; }
  set newCycle(v: number) { this.bytes[this.base + 12] = v; }
  get newState(): number { return s8(this.bytes[this.base + 15]); }
  set newState(v: number) { this.bytes[this.base + 15] = v; }
  get isBusy(): number { return s8(this.bytes[this.base + 17]); }
  set isBusy(v: number) { this.bytes[this.base + 17] = v; }
  get framesLeft(): number { return s8(this.bytes[this.base + 21]); }
  set framesLeft(v: number) { this.bytes[this.base + 21] = v; }
  get animTypeBak(): number { return s8(this.bytes[this.base + 23]); }
  set animTypeBak(v: number) { this.bytes[this.base + 23] = v; }
  get redrawAnimation(): number { return s8(this.bytes[this.base + 24]); }
  set redrawAnimation(v: number) { this.bytes[this.base + 24] = v; }
  get redrawLayer(): number { return this.bytes[this.base + 25]; }
  set redrawLayer(v: number) { this.bytes[this.base + 25] = v; }
  get redrawFrame(): number { return this.bytes[this.base + 26]; }
  set redrawFrame(v: number) { this.bytes[this.base + 26] = v; }
}
