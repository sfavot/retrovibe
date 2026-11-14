/**
 * Fichier d'effets sonores d'une section (`60203 + 4 * section`) : code x86 du pilote d'origine, tables et PCM 8 bits non signé.
 *
 * Référence : ScummVM engines/sky/sound.cpp (`Sound::loadSection`, `Sound::playSound`), GPL v3 ou ultérieure. Version visée : v0.0372
 * (`asmOfs = 0x7E`). Toutes les tables d'informations sont en gros-boutiste (ScummVM : « Don't ask me why »).
 *
 * Écarts : ScummVM n'écarte que `sound > soundsTotal` (le son de rang `soundsTotal` est donc lu hors table) ; ici le rang doit être
 * strictement inférieur au nombre de sons, et un son qui déborde du fichier est refusé à la lecture.
 */

/** Position de l'octet de code (`0x3C`) suivi du nombre de sons. */
export const SFX_ASM_OFFSET = 0x7e;
/** Plafond de fréquence appliqué par `playSound` (bogue n°2688 de ScummVM : le taux vient des données). */
export const SFX_MAX_RATE = 11025;

const INFO_ENTRY_SIZE = 8;
const RATE_ENTRY_SIZE = 4;

export interface SfxSound {
  /** Fréquence en Hz, plafonnée à `SFX_MAX_RATE`. */
  readonly rate: number;
  /** Position du PCM dans le fichier. */
  readonly offset: number;
  /** Octets de PCM. */
  readonly size: number;
  /** Nombre d'octets de fin rejoués en boucle (0 = pas de boucle). */
  readonly loop: number;
}

export class SfxFile {
  readonly data: Uint8Array;
  readonly soundsTotal: number;
  /** Position de la table des taux (`LE16 @asmOfs + 0x29`). */
  readonly rateTableOffset: number;
  /** Position de la table d'informations et base des positions de PCM (`LE16 @asmOfs + 0x31`). */
  readonly baseOffset: number;
  private readonly view: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const a = SFX_ASM_OFFSET;
    if (data.length < a + 0x33) throw new Error("fichier d'effets invalide : trop court");
    const signature =
      data[a] === 0x3c && data[a + 0x27] === 0x8d && data[a + 0x28] === 0x1e && data[a + 0x2f] === 0x8d && data[a + 0x30] === 0x36;
    if (!signature) throw new Error("fichier d'effets invalide : version du pilote inconnue");
    this.soundsTotal = data[a + 1]!;
    this.rateTableOffset = this.view.getUint16(a + 0x29, true);
    this.baseOffset = this.view.getUint16(a + 0x31, true);
    if (this.rateTableOffset + this.soundsTotal * RATE_ENTRY_SIZE > data.length || this.baseOffset + this.soundsTotal * INFO_ENTRY_SIZE > data.length) {
      throw new Error("fichier d'effets invalide : tables hors du fichier");
    }
  }

  /** Taux, position, taille et boucle du son `n` (0 à `soundsTotal - 1`). */
  sound(n: number): SfxSound {
    if (!Number.isInteger(n) || n < 0 || n >= this.soundsTotal) throw new RangeError(`son ${n} hors de 0 à ${this.soundsTotal - 1}`);
    const info = this.baseOffset + n * INFO_ENTRY_SIZE;
    const rate = Math.min(this.view.getUint16(this.rateTableOffset + n * RATE_ENTRY_SIZE, false), SFX_MAX_RATE);
    return {
      rate,
      offset: this.baseOffset + (this.view.getUint16(info, false) << 4),
      size: this.view.getUint16(info + 2, false),
      loop: this.view.getUint16(info + 6, false),
    };
  }

  sounds(): SfxSound[] {
    return Array.from({ length: this.soundsTotal }, (_, n) => this.sound(n));
  }

  /** PCM 8 bits non signé, mono, du son `n` (vue sur le fichier, sans copie). */
  sample(n: number): Uint8Array {
    const s = this.sound(n);
    if (s.offset + s.size > this.data.length) throw new Error(`son ${n} : PCM hors du fichier`);
    return this.data.subarray(s.offset, s.offset + s.size);
  }
}
