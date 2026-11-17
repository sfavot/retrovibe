/**
 * Décodeur des vidéos `.MUX` du Téléportaschtroumpf (voir `docs/teleportaschtroumpf/mux.md`).
 *
 * Un MUX est un conteneur : une table d'offsets, puis une suite de chunks (audio PCM, palette,
 * vidéo, fin d'image). La vidéo est en 8 bits indexés, 320×200, codée par séquences de pixels
 * identiques (RLE) avec, en mode inter, des sauts sur l'image précédente.
 */

/** Signature d'un fichier MUX. */
const SIGNATURE = 0xaa07;

/** Octets de l'en-tête fixe, avant la table d'offsets. */
const HEADER_BYTES = 0x20;
const PALETTE_BYTES = 768;
const CHUNK_HEADER_BYTES = 6;
const VIDEO_HEADER_BYTES = 13;
/** Les 2 bits de poids fort des offsets de la table sont des drapeaux, ignorés ici. */
const OFFSET_MASK = 0x3fffffff;

/** Horloge du PIT 8253 (Hz) : la cadence est exprimée par un diviseur de cette horloge. */
const PIT_CLOCK = 1_193_182;
/** Ticks du minuteur par image (déduit du relevé : audio / images, voir la note technique). */
const TICKS_PER_FRAME = 12;

const CHUNK_END_OF_FILE = 0x04;
const CHUNK_END_OF_FRAME = 0x05;
const CHUNK_AUDIO = 0x06;
const CHUNK_AUDIO_FIRST = 0x07;
const CHUNK_MARKER = 0x08;
const CHUNK_VIDEO = 0x64;
const CHUNK_VIDEO_FIRST = 0x6f;
const CHUNK_PALETTE = 0x65;
const CHUNK_PALETTE_FIRST = 0x70;

const FLAG_LZ_PARTIAL = 0x01;
const FLAG_INTER = 0x02;
const FLAG_LZ = 0x04;
const FLAG_UNKNOWN_8 = 0x08;

export interface MuxHeader {
  signature: number;
  /** Taille de l'en-tête (0x1800 : table d'offsets comprise). */
  headerSize: number;
  /** Nombre d'entrées de la table d'offsets. */
  entryCount: number;
  unknown1: number;
  unknown2: number;
  /** Diviseur du PIT qui donne la cadence (9039 pour 11 images/s). */
  frameDivisor: number;
  /** Fréquence audio en Hz, 0 si la vidéo n'a pas de son. */
  audioFrequency: number;
  videoBufferSize: number;
  audioBufferSize: number;
  chunkBufferSize: number;
  audioBufferCount: number;
  width: number;
  height: number;
  /** Offset du premier chunk. */
  firstChunkOffset: number;
  /** Images par seconde déduites du diviseur. */
  framesPerSecond: number;
}

export interface MuxFrame {
  /** Numéro de l'image (payload du chunk 05). */
  index: number;
  /** Vrai si un chunk palette a été lu depuis l'image précédente. */
  paletteChanged: boolean;
  /** Chunks audio (PCM 8 bits non signé) rencontrés depuis l'image précédente, vues sur le fichier. */
  audio: Uint8Array[];
  /** Charges utiles des chunks 08 (marqueurs de signification inconnue, 1 à 2 octets) rencontrés. */
  markers: Uint8Array[];
}

/**
 * Flux de bits / quartets / octets sur une plage d'un tampon.
 * Les bits viennent de mots 32 bits little-endian lus MSB d'abord ; un quartet est un octet dont on sert
 * d'abord le poids fort, le poids faible étant gardé pour l'appel suivant (il survit aux lectures d'octet).
 */
class Stream {
  private buf: Uint8Array = new Uint8Array(0);
  private end = 0;
  private bits = 0;
  private bitCount = 0;
  private pendingNibble = -1;
  pos = 0;

  init(buf: Uint8Array, start: number, end: number): void {
    this.buf = buf;
    this.pos = start;
    this.end = end;
    this.bits = 0;
    this.bitCount = 0;
    this.pendingNibble = -1;
  }

  byte(): number {
    if (this.pos >= this.end) throw new Error("MUX : flux vidéo épuisé");
    return this.buf[this.pos++];
  }

  nibble(): number {
    if (this.pendingNibble >= 0) {
      const v = this.pendingNibble;
      this.pendingNibble = -1;
      return v;
    }
    const v = this.byte();
    this.pendingNibble = v & 15;
    return v >> 4;
  }

  bit(): number {
    if (this.bitCount === 0) {
      if (this.pos + 4 > this.end) throw new Error("MUX : flux vidéo épuisé");
      const b = this.buf;
      const p = this.pos;
      this.bits = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
      this.pos += 4;
      this.bitCount = 32;
    }
    this.bitCount--;
    return (this.bits >>> this.bitCount) & 1;
  }
}

export class MuxDecoder {
  readonly header: MuxHeader;
  /** Image courante (largeur × hauteur, indices de palette), conservée d'une image à l'autre. */
  readonly pixels: Uint8Array;
  /** Palette courante, 768 octets RGB 8 bits. */
  readonly palette = new Uint8Array(PALETTE_BYTES);

  private readonly bytes: Uint8Array;
  private pos = 0;
  private finished = false;
  private readonly video = new MuxVideoDecoder();

  constructor(bytes: Uint8Array) {
    if (bytes.length < HEADER_BYTES + 4) throw new Error("MUX : fichier trop court");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const signature = view.getUint32(0, true);
    if (signature !== SIGNATURE) {
      throw new Error(`MUX : signature invalide (0x${signature.toString(16)})`);
    }
    const frameDivisor = view.getUint16(0x0c, true);
    const firstChunkOffset = view.getUint32(HEADER_BYTES, true) & OFFSET_MASK;
    this.header = {
      signature,
      headerSize: view.getUint16(4, true),
      entryCount: view.getUint16(6, true),
      unknown1: view.getUint16(8, true),
      unknown2: view.getUint16(10, true),
      frameDivisor,
      audioFrequency: view.getUint16(0x0e, true),
      videoBufferSize: view.getUint32(0x10, true),
      audioBufferSize: view.getUint16(0x14, true),
      chunkBufferSize: view.getUint32(0x16, true),
      audioBufferCount: view.getUint16(0x1a, true),
      width: view.getUint16(0x1c, true),
      height: view.getUint16(0x1e, true),
      firstChunkOffset,
      framesPerSecond: frameDivisor ? PIT_CLOCK / frameDivisor / TICKS_PER_FRAME : 0,
    };
    if (firstChunkOffset >= bytes.length) throw new Error("MUX : offset du premier chunk invalide");
    this.bytes = bytes;
    this.pixels = new Uint8Array(this.header.width * this.header.height);
    this.pos = firstChunkOffset;
  }

  /** Revient avant la première image (image et palette remises à zéro). */
  reset(): void {
    this.pos = this.header.firstChunkOffset;
    this.finished = false;
    this.pixels.fill(0);
    this.palette.fill(0);
  }

  /** Décode jusqu'à la prochaine fin d'image ; `null` à la fin du fichier. */
  nextFrame(): MuxFrame | null {
    if (this.finished) return null;
    const bytes = this.bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const audio: Uint8Array[] = [];
    const markers: Uint8Array[] = [];
    let paletteChanged = false;

    while (this.pos + CHUNK_HEADER_BYTES <= bytes.length) {
      const type = bytes[this.pos];
      const size = view.getUint32(this.pos + 2, true);
      const start = this.pos + CHUNK_HEADER_BYTES;
      const end = start + size;
      if (end > bytes.length) throw new Error(`MUX : chunk ${hex(type)} tronqué à l'offset ${this.pos}`);
      this.pos = end;

      switch (type) {
        case CHUNK_AUDIO:
        case CHUNK_AUDIO_FIRST:
          audio.push(bytes.subarray(start, end));
          break;
        case CHUNK_PALETTE:
        case CHUNK_PALETTE_FIRST:
          if (size < PALETTE_BYTES) throw new Error("MUX : palette trop courte");
          this.palette.set(bytes.subarray(start, start + PALETTE_BYTES));
          paletteChanged = true;
          break;
        case CHUNK_VIDEO:
        case CHUNK_VIDEO_FIRST:
          this.video.decode(bytes.subarray(start, end), this.pixels, this.header.width, this.header.height);
          break;
        case CHUNK_MARKER:
          markers.push(bytes.subarray(start, end));
          break;
        case CHUNK_END_OF_FRAME:
          if (size < 2) throw new Error("MUX : fin d'image sans numéro");
          return { index: view.getUint16(start, true), paletteChanged, audio, markers };
        case CHUNK_END_OF_FILE:
          this.finished = true;
          return null;
        default:
          throw new Error(`MUX : chunk inconnu ${hex(type)} à l'offset ${start - CHUNK_HEADER_BYTES}`);
      }
    }
    // Fichier terminé sans chunk 04.
    this.finished = true;
    return null;
  }
}

/**
 * Décodeur d'un chunk vidéo MUX (types 6f / 64) : en-tête de 13 octets (drapeaux, pixel de départ, tailles des
 * flux « bits » et « couleurs »), puis les flux, éventuellement compressés en LZ. Il est aussi utilisé tel quel
 * pour les tronçons des fichiers `.MUT`, dont les enregistrements sont des payloads de chunk vidéo.
 * Une instance garde son tampon LZ et ses flux d'une image à l'autre : en créer une et la réutiliser.
 */
export class MuxVideoDecoder {
  /** Tampon de décompression LZ, réutilisé (agrandi au besoin). */
  private lzBuffer: Uint8Array = new Uint8Array(1 << 16);
  private readonly control = new Stream();
  private readonly colors = new Stream();

  /**
   * Décode un payload de chunk vidéo (en-tête de 13 octets compris) dans `pixels`.
   * `pixels` (au moins `width * height` octets, indices de palette) est modifié en place : en mode inter, les
   * pixels sautés gardent leur valeur, il faut donc rappeler `decode` avec le même tampon d'une image à l'autre.
   */
  decode(payload: Uint8Array, pixels: Uint8Array, width: number, height: number): void {
    const limit = width * height;
    if (pixels.length < limit) throw new Error("MUX : tampon de pixels trop petit");
    if (payload.length < VIDEO_HEADER_BYTES) throw new Error("MUX : chunk vidéo trop court");
    const flags = payload[0];
    if (flags & FLAG_LZ_PARTIAL) throw new Error("MUX : LZ partiel (flag 1) non utilisé par ce jeu");
    if (flags & FLAG_UNKNOWN_8) throw new Error("MUX : flag vidéo 8 non utilisé par ce jeu");
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const startPixel = view.getUint32(1, true);
    const bitsSize = view.getUint32(5, true);
    const colorsSize = view.getUint32(9, true);

    let data: Uint8Array;
    let dataStart: number;
    let dataEnd: number;
    if (flags & FLAG_LZ) {
      dataEnd = this.unpack(payload, VIDEO_HEADER_BYTES, payload.length, bitsSize + colorsSize);
      data = this.lzBuffer;
      dataStart = 0;
    } else {
      data = payload;
      dataStart = VIDEO_HEADER_BYTES;
      dataEnd = payload.length;
    }
    // Comme le prototype : les deux flux sont bornés par leurs tailles annoncées.
    const bitsEnd = Math.min(dataStart + bitsSize, dataEnd);
    this.control.init(data, dataStart, bitsEnd);
    this.colors.init(data, dataStart + bitsSize, Math.min(dataStart + bitsSize + colorsSize, dataEnd));
    this.paint(pixels, limit, startPixel, (flags & FLAG_INTER) !== 0);
  }

  /** Remplit `pixels` (jusqu'à `limit`) d'après les flux de contrôle et de couleurs. */
  private paint(pixels: Uint8Array, limit: number, startPixel: number, inter: boolean): void {
    const { control, colors } = this;
    let p = startPixel;
    while (p < limit) {
      let n: number;
      if (!control.bit()) n = 1;
      else if (!control.bit()) {
        n = control.nibble();
        n = n ? n + 4 : control.byte() + 20;
      } else if (!control.bit()) n = 2;
      else if (!control.bit()) n = 3;
      else if (!inter || !control.bit()) n = 4;
      else {
        p += control.byte(); // saut : ces pixels gardent la valeur de l'image précédente
        continue;
      }
      const end = Math.min(p + n, limit);
      pixels.fill(colors.byte(), p, end);
      p += n;
    }
  }

  /**
   * Décompresse `src[start, end)` dans `lzBuffer` (jusqu'à avoir au moins `outLength` octets ou épuiser
   * la source) et renvoie la longueur produite. Mots de 32 bits de drapeaux, MSB d'abord, avec un bit
   * sentinelle : on quitte la boucle quand le mot devient nul après décalage. Bit à 1 : 1 à 16 octets
   * littéraux (quartet + 1) ; bit à 0 : copie arrière (décalage = octet, longueur = quartet + 2).
   */
  private unpack(src: Uint8Array, start: number, end: number, outLength: number): number {
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
    let out: Uint8Array = this.lzBuffer;
    if (out.length < outLength + 1024) out = this.lzBuffer = new Uint8Array(outLength + 1024);
    let p = start;
    let o = 0;
    let pendingNibble = -1;
    const nibble = (): number => {
      if (pendingNibble >= 0) {
        const v = pendingNibble;
        pendingNibble = -1;
        return v;
      }
      if (p >= end) throw new Error("MUX : flux LZ tronqué");
      const v = src[p++];
      pendingNibble = v & 15;
      return v >> 4;
    };

    while (p < end && o < outLength) {
      if (p + 4 > end) throw new Error("MUX : flux LZ tronqué");
      let flags = view.getUint32(p, true);
      p += 4;
      for (;;) {
        const bit = flags >>> 31;
        flags = (flags << 1) >>> 0;
        if (!flags) break;
        if (bit) {
          const n = nibble() + 1;
          const count = Math.min(n, end - p);
          if (o + count > out.length) out = this.growLz(o);
          out.set(src.subarray(p, p + count), o);
          o += count;
          p += n;
        } else {
          if (p >= end) throw new Error("MUX : flux LZ tronqué");
          const offset = src[p++];
          const n = nibble() + 2;
          if (offset === 0 || offset > o) throw new Error("MUX : copie LZ hors fenêtre");
          if (o + n > out.length) out = this.growLz(o);
          for (let i = 0; i < n; i++, o++) out[o] = out[o - offset];
        }
        if (p >= end) break;
      }
    }
    return o;
  }

  private growLz(used: number): Uint8Array {
    const bigger = new Uint8Array(this.lzBuffer.length * 2);
    bigger.set(this.lzBuffer.subarray(0, used));
    this.lzBuffer = bigger;
    return bigger;
  }
}

function hex(n: number): string {
  return `0x${n.toString(16).padStart(2, "0")}`;
}
