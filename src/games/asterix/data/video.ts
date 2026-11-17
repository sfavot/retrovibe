import { LzmaDecoder } from "../../../data/lzma";

/**
 * Lecteur des vidéos `.vid` d'Astérix : le conteneur maison qui remplace les `.MUX` et les `.MUK` d'origine, réencodés
 * sans perte par `scripts/asterix-extract.sh` (voir `docs/asterix/formats.md`).
 *
 * Le fichier est un flux LZMA « alone » ; décompressé (little-endian) :
 *  - en-tête de 24 octets : `"AVID"`, u16 version, u8 origine (0 = MUX, 1 = MUK), u8 0, u16 largeur, u16 hauteur,
 *    u16 diviseur du PIT (0 pour un MUK), u16 fréquence audio (0 = muet), u32 échantillons audio, u32 nombre d'images ;
 *  - par image : u8 drapeaux, u16 numéro, u32 échantillons audio lus avant la fin de l'image, puis selon les drapeaux,
 *    dans cet ordre : palette, marqueurs, valeurs, champ MUK, masque, différence.
 *
 * Les images sont décodées une à une, dans l'ordre, sans décompresser le fichier d'un bloc. Le son n'est pas dans le
 * conteneur : il est dans le `.mp3` voisin, dont `audio.json` donne la durée exacte.
 */

const MAGIC = "AVID";
const VERSION = 1;
const HEADER_BYTES = 24;
const FRAME_HEADER_BYTES = 7;
const PALETTE_BYTES = 768;

/** Horloge du PIT 8253 (Hz) et nombre de ticks par image : la cadence d'un MUX est un diviseur de cette horloge. */
const PIT_CLOCK = 1_193_182;
const TICKS_PER_FRAME = 12;

const FLAG_PALETTE = 0x01;
const FLAG_DIFF = 0x02;
const FLAG_MASK = 0x04;
const FLAG_VIDEO = 0x08;
const FLAG_MARKERS = 0x10;
const FLAG_VALUES = 0x20;
const FLAG_FIELD = 0x40;
const KNOWN_FLAGS = 0x7f;

export interface VideoHeader {
  /** Format d'origine du fichier. */
  source: "mux" | "muk";
  width: number;
  height: number;
  /** Diviseur du PIT qui donne la cadence (0 pour un MUK, qui n'en a pas). */
  frameDivisor: number;
  /** Images par seconde déduites du diviseur, 0 s'il est nul. */
  framesPerSecond: number;
  /** Fréquence d'origine du son en Hz, 0 si la vidéo est muette. */
  audioFrequency: number;
  /** Nombre total d'échantillons du son d'origine (celui du `.mp3` voisin). */
  audioSamples: number;
  frameCount: number;
}

export interface VideoFrame {
  /** Numéro de l'image : celui du bloc de fin d'image du MUX, ou le rang de l'image dans le MUK. */
  index: number;
  /** Échantillons audio que le fichier d'origine avait fournis avant la fin de cette image (horodatage du son). */
  audioEnd: number;
  /** Vrai si l'image apporte une palette. */
  paletteChanged: boolean;
  /** Vrai si les pixels diffèrent de ceux de l'image précédente. */
  changed: boolean;
  /**
   * Ce que le bloc vidéo d'origine écrivait : rien (pas de bloc), toute l'image, ou une partie (voir
   * `VideoDecoder.written`).
   */
  coverage: "none" | "all" | "partial";
  /** Charges utiles des marqueurs MUX de type 08 (1 ou 2 octets ASCII). */
  markers: Uint8Array[];
  /** Valeurs des enregistrements de type 0 d'un MUK. */
  values: number[];
  /** Second champ de l'enregistrement vidéo d'un MUK (rôle inconnu), `null` pour un MUX. */
  mukField: number | null;
}

export class VideoDecoder {
  readonly header: VideoHeader;
  /** Image courante (indices de palette), cumulée d'une image à l'autre comme le fait le décodeur MUX. */
  readonly pixels: Uint8Array;
  /** Palette courante, 768 octets RVB 8 bits. */
  readonly palette = new Uint8Array(PALETTE_BYTES);
  /**
   * Pour l'image courante, 1 pour chaque pixel que le bloc vidéo d'origine écrivait, 0 pour ceux qu'il sautait. Une
   * vidéo en surimpression se compose avec `compose` : seuls les pixels écrits recouvrent le fond.
   */
  readonly written: Uint8Array;

  private readonly bytes: Uint8Array;
  private lzma: LzmaDecoder;
  private decoded = 0;
  private readonly diff: Uint8Array;
  private readonly mask: Uint8Array;
  private readonly scratch = new Uint8Array(256);

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.lzma = new LzmaDecoder(bytes);
    const head = new Uint8Array(HEADER_BYTES);
    this.fill(head, HEADER_BYTES);
    if (String.fromCharCode(head[0], head[1], head[2], head[3]) !== MAGIC) throw new Error("Vidéo : signature AVID absente");
    const view = new DataView(head.buffer);
    const version = view.getUint16(4, true);
    if (version !== VERSION) throw new Error(`Vidéo : version ${version} inconnue`);
    const source = head[6];
    if (source > 1) throw new Error(`Vidéo : origine ${source} inconnue`);
    const frameDivisor = view.getUint16(12, true);
    this.header = {
      source: source === 0 ? "mux" : "muk",
      width: view.getUint16(8, true),
      height: view.getUint16(10, true),
      frameDivisor,
      framesPerSecond: frameDivisor ? PIT_CLOCK / frameDivisor / TICKS_PER_FRAME : 0,
      audioFrequency: view.getUint16(14, true),
      audioSamples: view.getUint32(16, true),
      frameCount: view.getUint32(20, true),
    };
    const size = this.header.width * this.header.height;
    if (size === 0 || size % 8 !== 0) throw new Error("Vidéo : dimensions invalides");
    this.pixels = new Uint8Array(size);
    this.written = new Uint8Array(size);
    this.diff = new Uint8Array(size);
    this.mask = new Uint8Array(size / 8);
  }

  /** Revient avant la première image (image et palette remises à zéro). */
  reset(): void {
    this.lzma = new LzmaDecoder(this.bytes);
    this.fill(this.diff, HEADER_BYTES);
    this.decoded = 0;
    this.pixels.fill(0);
    this.palette.fill(0);
    this.written.fill(0);
  }

  /** Décode l'image suivante ; `null` après la dernière (la fin du flux est alors contrôlée). */
  nextFrame(): VideoFrame | null {
    if (this.decoded >= this.header.frameCount) {
      if (!this.lzma.finished && (this.lzma.read(this.scratch, 0, 1) !== 0 || !this.lzma.finished)) {
        throw new Error("Vidéo : octets après la dernière image");
      }
      return null;
    }
    const { scratch, pixels, written, diff, mask } = this;
    this.fill(scratch, FRAME_HEADER_BYTES);
    const flags = scratch[0];
    if (flags & ~KNOWN_FLAGS) throw new Error(`Vidéo : drapeaux d'image inconnus (0x${flags.toString(16)})`);
    const index = scratch[1] | (scratch[2] << 8);
    const audioEnd = (scratch[3] | (scratch[4] << 8) | (scratch[5] << 16) | (scratch[6] << 24)) >>> 0;

    if (flags & FLAG_PALETTE) this.fill(this.palette, PALETTE_BYTES);
    const markers: Uint8Array[] = [];
    if (flags & FLAG_MARKERS) {
      this.fill(scratch, 1);
      for (let count = scratch[0]; count > 0; count--) {
        this.fill(scratch, 1);
        const marker = new Uint8Array(scratch[0]);
        this.fill(marker, marker.length);
        markers.push(marker);
      }
    }
    const values: number[] = [];
    if (flags & FLAG_VALUES) {
      this.fill(scratch, 1);
      for (let count = scratch[0]; count > 0; count--) {
        this.fill(scratch, 2);
        values.push(scratch[0] | (scratch[1] << 8));
      }
    }
    let mukField: number | null = null;
    if (flags & FLAG_FIELD) {
      this.fill(scratch, 4);
      mukField = (scratch[0] | (scratch[1] << 8) | (scratch[2] << 16) | (scratch[3] << 24)) >>> 0;
    }

    let coverage: VideoFrame["coverage"] = "none";
    if (flags & FLAG_MASK) {
      if (!(flags & FLAG_VIDEO)) throw new Error("Vidéo : masque sans bloc vidéo");
      coverage = "partial";
      this.fill(mask, mask.length);
      for (let i = 0, p = 0; i < mask.length; i++) {
        const bits = mask[i];
        for (let bit = 7; bit >= 0; bit--) written[p++] = (bits >> bit) & 1;
      }
    } else if (flags & FLAG_VIDEO) {
      coverage = "all";
      written.fill(1);
    } else written.fill(0);

    if (flags & FLAG_DIFF) {
      this.fill(diff, diff.length);
      for (let i = 0; i < diff.length; i++) pixels[i] ^= diff[i];
    }
    this.decoded++;
    return {
      index,
      audioEnd,
      paletteChanged: (flags & FLAG_PALETTE) !== 0,
      changed: (flags & FLAG_DIFF) !== 0,
      coverage,
      markers,
      values,
      mukField,
    };
  }

  /**
   * Applique l'image courante à `target` comme le faisait le bloc vidéo d'origine décodé sur ce tampon : seuls les
   * pixels écrits sont recopiés, les autres gardent la valeur de `target`.
   */
  compose(target: Uint8Array): void {
    const { pixels, written } = this;
    if (target.length < pixels.length) throw new Error("Vidéo : tampon cible trop petit");
    for (let i = 0; i < pixels.length; i++) if (written[i]) target[i] = pixels[i];
  }

  private fill(out: Uint8Array, length: number): void {
    if (this.lzma.read(out, 0, length) !== length) throw new Error("Vidéo : fichier tronqué");
  }
}
