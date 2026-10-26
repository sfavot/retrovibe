import { BinaryReader } from "./reader";

/**
 * Décodeur Smacker (SMK2 / SMK4) indépendant du jeu : image 8 bits indexée + palette RVB, pistes audio DPCM.
 *
 * Disposition du fichier : en-tête (104 octets), tailles des images (u32 par image, les 2 bits de poids faible sont des
 * drapeaux dont le bit 0 = image clé), types des images (u8 : bit 0 = palette, bits 1 à 7 = pistes audio 0 à 6),
 * arbres de Huffman (MMAP, MCLR, FULL, TYPE), puis les images : [palette][audio piste 0..6][vidéo].
 */

/** Description d'une piste audio déclarée dans l'en-tête (champ « rate » : octet de poids fort = drapeaux, 24 bits bas = fréquence). */
export interface SmackerAudioTrack {
  /** Numéro de piste (0 à 6) : bit `index + 1` du type d'image. */
  index: number;
  /** Fréquence d'échantillonnage en Hz. */
  rate: number;
  channels: 1 | 2;
  bits: 8 | 16;
  /** Vrai si les images contiennent un flux DPCM compressé (drapeau 0x80000000), sinon du PCM brut. */
  packed: boolean;
}

export interface SmackerFile {
  signature: "SMK2" | "SMK4";
  width: number;
  height: number;
  /** Nombre d'images lisibles, y compris l'image « anneau » (qui reprend la première) quand le drapeau `ring` est posé. */
  frameCount: number;
  /** Durée d'une image en millisecondes (peut être fractionnaire : 71,42 ms pour -7142). */
  frameDurationMs: number;
  fps: number;
  /** Drapeaux de l'en-tête : anneau (bit 0), Y entrelacé (bit 1), Y doublé (bit 2). */
  flags: { ring: boolean; yInterlaced: boolean; yDouble: boolean };
  audioTracks: SmackerAudioTrack[];
}

/** PCM décodé d'une piste pour une image : échantillons entrelacés, signés 16 bits (l'audio 8 bits est recentré et mis à l'échelle). */
export interface SmackerAudio {
  samples: Int16Array;
  rate: number;
  channels: 1 | 2;
}

export interface SmackerFrame {
  index: number;
  keyframe: boolean;
  /** `width * height` indices de palette (copie, indépendante des images suivantes). */
  pixels: Uint8Array;
  /** 256 × RVB 8 bits (copie). */
  palette: Uint8Array;
  paletteChanged: boolean;
  /**
   * À l'affichage, les lignes sont à doubler (Y doublé ou entrelacé) : l'image décodée garde `height` lignes,
   * le jeu d'origine l'étire à `height * 2`. Faux pour tous les fichiers de SWIV.
   */
  yDouble: boolean;
  /** Une entrée par élément de `SmackerFile.audioTracks` ; `null` si la piste n'a rien pour cette image. */
  audio: (SmackerAudio | null)[];
}

const HEADER_SIZE = 104;
const AUDIO_TRACKS = 7;
/** Nombre d'images consécutives codées par un bloc, selon les bits 2 à 7 du code de type. */
const BLOCK_RUNS = [...Array.from({ length: 59 }, (_, i) => i + 1), 128, 256, 512, 1024, 2048];

/** Lecteur de bits Smacker : octets lus du bit de poids faible vers le fort, les valeurs multi-bits se lisent bit de poids faible d'abord. */
class BitReader {
  private pos: number;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.pos = start * 8;
  }

  /** Vrai une fois les octets épuisés (les lectures suivantes renvoient 0). */
  get exhausted(): boolean {
    return this.pos >= this.end * 8;
  }

  bit(): number {
    const p = this.pos++;
    if (p >= this.end * 8) return 0;
    return (this.bytes[p >> 3]! >> (p & 7)) & 1;
  }

  bits(count: number): number {
    let v = 0;
    for (let i = 0; i < count; i++) v |= this.bit() << i;
    return v >>> 0;
  }
}

/** Arbre binaire : le bit 0 descend à gauche, le bit 1 à droite ; une feuille porte une valeur. */
class Tree {
  private readonly left: number[] = [];
  private readonly right: number[] = [];
  /** Valeur des feuilles ; négative = renvoi vers le cache `-(v + 1)` (arbres 16 bits). */
  private readonly value: number[] = [];

  /** Construit récursivement : bit 1 = nœud (gauche puis droite), bit 0 = feuille lue par `leaf`. */
  static read(br: BitReader, leaf: () => number): Tree {
    const tree = new Tree();
    const build = (): number => {
      const id = tree.value.length;
      tree.value.push(0);
      tree.left.push(-1);
      tree.right.push(-1);
      if (br.bit()) {
        tree.left[id] = build();
        tree.right[id] = build();
      } else {
        tree.value[id] = leaf();
      }
      return id;
    };
    build();
    return tree;
  }

  /** Arbre absent : toute lecture renvoie 0 sans consommer de bit. */
  static empty(): Tree {
    const tree = new Tree();
    tree.value.push(0);
    tree.left.push(-1);
    tree.right.push(-1);
    return tree;
  }

  /** Valeur brute de la feuille atteinte (peut être un renvoi vers le cache pour les arbres 16 bits). */
  lookup(br: BitReader): number {
    let node = 0;
    while (this.left[node]! >= 0) node = br.bit() ? this.right[node]! : this.left[node]!;
    return this.value[node]!;
  }
}

/** Arbre 8 bits : présence (1 bit), arbre, bit de fin à 0. Un arbre absent renvoie toujours 0. */
function readTree8(br: BitReader): Tree {
  if (!br.bit()) return Tree.empty();
  const tree = Tree.read(br, () => br.bits(8));
  br.bit(); // bit de fin (0)
  return tree;
}

/** Arbre 16 bits (feuilles = octet bas + octet haut, chacun lu dans un sous-arbre 8 bits) avec cache de 3 valeurs. */
class BigTree {
  private readonly cache = [0, 0, 0];

  private constructor(private readonly tree: Tree) {}

  static read(br: BitReader): BigTree {
    if (!br.bit()) return new BigTree(Tree.empty());
    const low = readTree8(br);
    const high = readTree8(br);
    const escapes = [br.bits(16), br.bits(16), br.bits(16)];
    const tree = Tree.read(br, () => {
      const v = low.lookup(br) | (high.lookup(br) << 8);
      const k = escapes.indexOf(v);
      return k >= 0 ? -(k + 1) : v;
    });
    br.bit(); // bit de fin (0)
    return new BigTree(tree);
  }

  /** Le cache est remis à zéro au début de chaque image. */
  resetCache(): void {
    this.cache.fill(0);
  }

  decode(br: BitReader): number {
    let v = this.tree.lookup(br);
    if (v < 0) v = this.cache[-v - 1]!;
    if (v !== this.cache[0]) {
      this.cache[2] = this.cache[1]!;
      this.cache[1] = this.cache[0]!;
      this.cache[0] = v;
    }
    return v;
  }
}

/** Palette 6 bits → 8 bits utilisée par les couleurs neuves des palettes Smacker (0..63 → 0..255). */
function palmap(v: number): number {
  return v * 4 + (v >> 4);
}

/** Décode le PCM d'une piste pour une image. `chunk` = contenu après le champ de taille de 4 octets. */
function decodeAudio(chunk: Uint8Array, track: SmackerAudioTrack): SmackerAudio | null {
  if (chunk.length === 0) return null;
  const { rate } = track;
  if (!track.packed) {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const count = track.bits === 16 ? chunk.length >> 1 : chunk.length;
    const samples = new Int16Array(count);
    for (let i = 0; i < count; i++) samples[i] = track.bits === 16 ? view.getInt16(i * 2, true) : (chunk[i]! - 128) << 8;
    return { samples, rate, channels: track.channels };
  }

  if (chunk.length < 4) return null;
  const unpackedSize = new DataView(chunk.buffer, chunk.byteOffset, 4).getUint32(0, true);
  const br = new BitReader(chunk, 4, chunk.length);
  if (!br.bit()) return null; // image sans son
  const stereo = br.bit() === 1;
  const wide = br.bit() === 1;
  const channels = stereo ? 2 : 1;
  const total = wide ? unpackedSize >> 1 : unpackedSize; // échantillons, toutes voies confondues
  const frames = Math.floor(total / channels);

  // Un arbre par octet de chaque voie : 8 bits = 1 par voie ; 16 bits = octet bas puis octet haut par voie.
  const trees = Array.from({ length: channels * (wide ? 2 : 1) }, () => readTree8(br));

  const pred = new Int32Array(channels);
  // Valeurs initiales : voie droite lue avant la gauche ; en 16 bits l'octet haut précède l'octet bas.
  for (let c = channels - 1; c >= 0; c--) pred[c] = wide ? ((br.bits(8) << 8) | br.bits(8)) << 16 >> 16 : br.bits(8);

  const samples = new Int16Array(frames * channels);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      if (i > 0) {
        if (wide) {
          const low = trees[c * 2]!.lookup(br);
          const high = trees[c * 2 + 1]!.lookup(br);
          pred[c] = (pred[c]! + (((high << 8) | low) << 16 >> 16)) << 16 >> 16;
        } else {
          pred[c] = (pred[c]! + (trees[c]!.lookup(br) << 24 >> 24)) & 0xff;
        }
      }
      samples[i * channels + c] = wide ? pred[c]! : (pred[c]! - 128) << 8;
    }
  }
  return { samples, rate, channels };
}

/** Lit l'en-tête et les tableaux d'images ; lance si la signature ou les tailles sont invalides. */
export function parseSmacker(bytes: Uint8Array): SmackerFile {
  return readHeader(bytes).file;
}

interface Header {
  file: SmackerFile;
  treesSize: number;
  frameSizes: number[];
  frameTypes: Uint8Array;
  /** Début des arbres dans le fichier ; les images suivent. */
  treesOffset: number;
}

function readHeader(bytes: Uint8Array): Header {
  if (bytes.length < HEADER_SIZE) throw new Error("Smacker : fichier trop court");
  const r = new BinaryReader(bytes);
  const signature = r.tag();
  if (signature !== "SMK2" && signature !== "SMK4") throw new Error(`Smacker : signature « ${signature} » inconnue`);
  const width = r.u32();
  const height = r.u32();
  const frames = r.u32();
  const rawRate = r.i32();
  const flagBits = r.u32();
  r.offset += AUDIO_TRACKS * 4; // tailles maximales des tampons audio : inutiles ici
  const treesSize = r.u32();
  r.offset += 4 * 4; // tailles décompressées MMAP, MCLR, FULL, TYPE
  const rates = Array.from({ length: AUDIO_TRACKS }, () => r.u32());
  r.offset += 4; // réservé

  if (width % 4 !== 0 || height % 4 !== 0 || width === 0 || height === 0) {
    throw new Error(`Smacker : dimensions ${width}x${height} non multiples de 4`);
  }
  const ring = (flagBits & 1) !== 0;
  const frameCount = frames + (ring ? 1 : 0);
  if (frameCount > 1 << 20 || bytes.length < HEADER_SIZE + frameCount * 5 + treesSize) throw new Error("Smacker : en-tête incohérent");

  // Cadence : > 0 = millisecondes par image, < 0 = 1/100000 s par image (valeur absolue), 0 = 10 images/s.
  const frameDurationMs = rawRate > 0 ? rawRate : rawRate < 0 ? -rawRate / 100 : 100;

  const audioTracks: SmackerAudioTrack[] = [];
  rates.forEach((value, index) => {
    if (!(value & 0x40000000)) return; // piste absente
    audioTracks.push({
      index,
      rate: value & 0xffffff,
      channels: value & 0x10000000 ? 2 : 1,
      bits: value & 0x20000000 ? 16 : 8,
      packed: (value & 0x80000000) !== 0,
    });
  });

  const frameSizes = Array.from({ length: frameCount }, () => r.u32());
  const frameTypes = r.bytesView(frameCount);
  return {
    file: {
      signature,
      width,
      height,
      frameCount,
      frameDurationMs,
      fps: 1000 / frameDurationMs,
      flags: { ring, yInterlaced: (flagBits & 2) !== 0, yDouble: (flagBits & 4) !== 0 },
      audioTracks,
    },
    treesSize,
    frameSizes,
    frameTypes,
    treesOffset: r.offset,
  };
}

/** Décodeur séquentiel : `nextFrame()` renvoie les images dans l'ordre, `reset()` revient au début. */
export class SmackerDecoder {
  readonly file: SmackerFile;
  private readonly bytes: Uint8Array;
  private readonly frameSizes: number[];
  private readonly frameTypes: Uint8Array;
  private readonly framesOffset: number;
  private readonly treesStart: number;
  private readonly treesEnd: number;

  private trees!: { mmap: BigTree; mclr: BigTree; full: BigTree; type: BigTree };
  private pixels: Uint8Array;
  private palette = new Uint8Array(768);
  private frameIndex = 0;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    const header = readHeader(bytes);
    this.bytes = bytes;
    this.file = header.file;
    this.frameSizes = header.frameSizes;
    this.frameTypes = header.frameTypes;
    this.treesStart = header.treesOffset;
    this.treesEnd = header.treesOffset + header.treesSize;
    this.framesOffset = this.treesEnd;
    this.pixels = new Uint8Array(header.file.width * header.file.height);
    this.reset();
  }

  /** Index de la prochaine image à décoder. */
  get position(): number {
    return this.frameIndex;
  }

  get done(): boolean {
    return this.frameIndex >= this.file.frameCount;
  }

  /** Revient à la première image : réinitialise l'image courante, la palette et les caches des arbres. */
  reset(): void {
    this.frameIndex = 0;
    this.offset = this.framesOffset;
    this.pixels.fill(0);
    this.palette.fill(0);
    const br = new BitReader(this.bytes, this.treesStart, this.treesEnd);
    this.trees = { mmap: BigTree.read(br), mclr: BigTree.read(br), full: BigTree.read(br), type: BigTree.read(br) };
  }

  /** Décode l'image suivante ; `null` après la dernière. Les tampons renvoyés sont des copies. */
  nextFrame(): SmackerFrame | null {
    if (this.done) return null;
    const index = this.frameIndex++;
    const size = this.frameSizes[index]! & ~3;
    const keyframe = (this.frameSizes[index]! & 1) !== 0;
    const type = this.frameTypes[index]!;
    const start = this.offset;
    const end = Math.min(start + size, this.bytes.length);
    this.offset += size;
    let pos = start;

    let paletteChanged = false;
    if (type & 1) {
      const length = this.bytes[pos]! * 4;
      if (length > 0) {
        this.decodePalette(pos + 1, pos + length);
        paletteChanged = true;
      }
      pos += length;
    }

    const audio: (SmackerAudio | null)[] = this.file.audioTracks.map(() => null);
    for (let t = 0; t < AUDIO_TRACKS; t++) {
      if (!(type & (2 << t)) || pos + 4 > end) continue;
      const length = new DataView(this.bytes.buffer, this.bytes.byteOffset + pos, 4).getUint32(0, true);
      const slot = this.file.audioTracks.findIndex((track) => track.index === t);
      if (slot >= 0 && length >= 4) audio[slot] = decodeAudio(this.bytes.subarray(pos + 4, Math.min(pos + length, end)), this.file.audioTracks[slot]!);
      pos += length;
    }

    if (pos < end) this.decodeVideo(new BitReader(this.bytes, pos, end));

    return {
      index,
      keyframe,
      pixels: this.pixels.slice(),
      palette: this.palette.slice(),
      paletteChanged,
      yDouble: this.file.flags.yDouble || this.file.flags.yInterlaced,
      audio,
    };
  }

  /** Met à jour `this.palette` à partir d'un bloc de palette : [0..0x3f] couleur neuve (3 octets), 0x40+ copie de l'ancienne palette, 0x80+ saut. */
  private decodePalette(start: number, end: number): void {
    const old = this.palette.slice();
    const out = this.palette;
    const b = this.bytes;
    let p = start;
    let i = 0;
    while (i < 256 && p < end) {
      const t = b[p++]!;
      if (t & 0x80) {
        i += (t & 0x7f) + 1; // garde les couleurs courantes
      } else if (t & 0x40) {
        const run = (t & 0x3f) + 1;
        const from = b[p++]!;
        if (i + run > 256 || from + run > 256) throw new Error("Smacker : palette invalide (copie hors limites)");
        out.set(old.subarray(from * 3, (from + run) * 3), i * 3);
        i += run;
      } else {
        out[i * 3] = palmap(t & 0x3f);
        out[i * 3 + 1] = palmap(b[p++]! & 0x3f);
        out[i * 3 + 2] = palmap(b[p++]! & 0x3f);
        i++;
      }
    }
  }

  /** Décode les blocs 4×4 de l'image dans `this.pixels` (les blocs « vides » conservent l'image précédente). */
  private decodeVideo(br: BitReader): void {
    const { width, height } = this.file;
    const { mmap, mclr, full, type: typeTree } = this.trees;
    const px = this.pixels;
    const blocksPerRow = width >> 2;
    const blocks = blocksPerRow * (height >> 2);
    const smk4 = this.file.signature === "SMK4";
    for (const tree of [mmap, mclr, full, typeTree]) tree.resetCache();
    let blk = 0;

    while (blk < blocks && !br.exhausted) {
      const code = typeTree.decode(br);
      let run = BLOCK_RUNS[(code >> 2) & 0x3f]!;
      const kind = code & 3;
      while (run-- > 0 && blk < blocks) {
        const base = (blk % blocksPerRow) * 4 +Math.floor(blk / blocksPerRow) * 4 * width;
        blk++;
        if (kind === 0) {
          // Bloc bicolore : couleurs (octet haut = bit à 1, octet bas = bit à 0) et masque de 16 bits.
          const colors = mclr.decode(br);
          let map = mmap.decode(br);
          const hi = colors >> 8;
          const lo = colors & 0xff;
          for (let y = 0; y < 4; y++) {
            const row = base + y * width;
            for (let x = 0; x < 4; x++, map >>= 1) px[row + x] = map & 1 ? hi : lo;
          }
        } else if (kind === 1) {
          let mode = 0; // SMK4 seulement : 1 = demi-résolution verticale en quarts, 2 = lignes doublées
          if (smk4 && br.bit()) mode = br.bit() ? 1 : br.bit() ? 2 : 0;
          if (mode === 0) {
            for (let y = 0; y < 4; y++) {
              const row = base + y * width;
              const right = full.decode(br);
              const left = full.decode(br);
              px[row] = left & 0xff;
              px[row + 1] = left >> 8;
              px[row + 2] = right & 0xff;
              px[row + 3] = right >> 8;
            }
          } else if (mode === 1) {
            for (let half = 0; half < 2; half++) {
              const v = full.decode(br);
              for (let y = half * 2; y < half * 2 + 2; y++) {
                const row = base + y * width;
                px[row] = px[row + 1] = v & 0xff;
                px[row + 2] = px[row + 3] = v >> 8;
              }
            }
          } else {
            for (let half = 0; half < 2; half++) {
              const right = full.decode(br);
              const left = full.decode(br);
              for (let y = half * 2; y < half * 2 + 2; y++) {
                const row = base + y * width;
                px[row] = left & 0xff;
                px[row + 1] = left >> 8;
                px[row + 2] = right & 0xff;
                px[row + 3] = right >> 8;
              }
            }
          }
        } else if (kind === 3) {
          const color = code >> 8;
          for (let y = 0; y < 4; y++) px.fill(color, base + y * width, base + y * width + 4);
        }
        // kind === 2 : bloc inchangé
      }
    }
  }
}
