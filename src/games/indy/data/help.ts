/**
 * Lecteur de DESKADV.HLP, le manuel d'origine (fichier d'aide WinHelp 3.1 de 1996).
 *
 * Format : un conteneur de « fichiers internes » indexés par un arbre B+ ; `|TOPIC` contient les rubriques,
 * `|FONT` les styles de texte, `|CONTEXT` et `|TTLBTREE` les repères des rubriques, `|bmN` les images (MRB).
 * Seul ce qu'utilise le fichier du jeu est géré (rubriques non compressées, images 24 bits) ; le reste lève une erreur.
 */
import { BinaryReader, decodeText } from "../../../data/reader";

export interface HelpFont {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Taille en points. */
  size: number;
  monospace: boolean;
}

export interface HelpImage {
  width: number;
  height: number;
  /** Pixels RGBA, ligne du haut en premier. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export type HelpSpan =
  /** `link` : indice de la rubrique ouverte par un clic sur ce texte (les définitions en fenêtre sont traitées comme des sauts). */
  | { kind: "text"; text: string; font: HelpFont; link?: number }
  | { kind: "image"; image: number; link?: number }
  | { kind: "tab" }
  | { kind: "break" };

export interface HelpParagraph {
  spans: HelpSpan[];
}

export interface HelpTopic {
  title: string;
  paragraphs: HelpParagraph[];
}

export interface HelpDocument {
  title: string;
  /** La rubrique 0 est le sommaire. */
  topics: HelpTopic[];
  images: HelpImage[];
}

const HLP_MAGIC = 0x00035f3f;
const BTREE_MAGIC = 0x293b;
const FILE_HEADER_SIZE = 9;
const BTREE_HEADER_SIZE = 38;
const TOPIC_BLOCK_SIZE = 4096;
const TOPIC_BLOCK_HEADER_SIZE = 12;
const TOPIC_LINK_HEADER_SIZE = 21;

const RecordType = { TopicHeader: 0x02, Text: 0x20 } as const;

const Command = {
  Font: 0x80,
  LineBreak: 0x81,
  EndParagraph: 0x82,
  Tab: 0x83,
  InlinePicture: 0x86,
  LeftPicture: 0x87,
  RightPicture: 0x88,
  EndHotspot: 0x89,
  PopupLegacy: 0xe0,
  JumpLegacy: 0xe1,
  Popup: 0xe2,
  Jump: 0xe3,
  PopupPlain: 0xe6,
  JumpPlain: 0xe7,
  End: 0xff,
} as const;

const PICTURE_BY_NUMBER = 0x22;

/** Lit un fichier d'aide complet. */
export function parseHelp(buffer: ArrayBuffer | Uint8Array): HelpDocument {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== HLP_MAGIC) throw new Error("Ce n'est pas un fichier d'aide Windows");
  const files = new HelpContainer(bytes, view.getUint32(4, true));

  const system = new BinaryReader(files.file("|SYSTEM"));
  system.offset = 10;
  const flags = system.u16();
  if (flags !== 0) throw new Error("Rubriques compressées non gérées");

  const fonts = parseFonts(files.file("|FONT"));
  const titles = files.btree("|TTLBTREE", (r) => {
    const position = r.u32();
    return { position, title: readCString(r) };
  });
  const contexts = files.btree("|CONTEXT", (r) => ({ hash: r.u32(), position: r.u32() }));
  // Les positions de |CONTEXT et |TTLBTREE ne se comparent pas à celles du flux : seul leur ordre compte,
  // qui est celui des rubriques dans |TOPIC.
  const order = titles.map((t) => t.position).sort((a, b) => a - b);
  const topicByHash = new Map(contexts.map((c) => [c.hash, order.indexOf(c.position)]));

  const topics = parseTopics(files.file("|TOPIC"), fonts, topicByHash);
  const images: HelpImage[] = [];
  for (let i = 0; files.has(`|bm${i}`); i++) images.push(parseBitmap(files.file(`|bm${i}`)));
  for (const topic of topics) {
    for (const p of topic.paragraphs) {
      for (const s of p.spans) if (s.kind === "image" && !images[s.image]) throw new Error(`Image ${s.image} introuvable`);
    }
  }
  return { title: readSystemTitle(files.file("|SYSTEM")) ?? topics[0].title, topics, images };
}

/** Le titre figure dans |SYSTEM sous forme d'enregistrement (type 1) : `Guide for Indy's Desktop Adventures`. */
function readSystemTitle(system: Uint8Array): string | null {
  const r = new BinaryReader(system);
  r.offset = 12;
  while (r.offset + 4 <= r.length) {
    const type = r.u16();
    const size = r.u16();
    if (type === 1) return decodeText(r.bytesView(size).subarray(0, size - 1));
    r.offset += size;
  }
  return null;
}

function readCString(r: BinaryReader): string {
  const start = r.offset;
  while (r.u8() !== 0);
  const end = r.offset - 1;
  r.offset = start;
  const text = r.string(end - start);
  r.offset = end + 1;
  return text;
}

// ------------------------------------------------------------------ conteneur

class HelpContainer {
  private readonly offsets = new Map<string, number>();

  constructor(
    private readonly bytes: Uint8Array,
    directory: number,
  ) {
    const r = new BinaryReader(bytes);
    for (const entry of readBtree(r, directory, (e) => ({ name: readCString(e), offset: e.u32() }))) {
      this.offsets.set(entry.name, entry.offset);
    }
  }

  has(name: string): boolean {
    return this.offsets.has(name);
  }

  file(name: string): Uint8Array {
    const offset = this.offsets.get(name);
    if (offset === undefined) throw new Error(`Fichier interne ${name} absent`);
    const r = new BinaryReader(this.bytes);
    r.offset = offset + 4;
    const used = r.u32();
    return this.bytes.subarray(offset + FILE_HEADER_SIZE, offset + FILE_HEADER_SIZE + used);
  }

  btree<T>(name: string, entry: (r: BinaryReader) => T): T[] {
    const offset = this.offsets.get(name);
    if (offset === undefined) throw new Error(`Fichier interne ${name} absent`);
    return readBtree(new BinaryReader(this.bytes), offset, entry);
  }
}

/** Parcourt les feuilles d'un arbre B+ stocké à `fileOffset` ; `entry` lit une entrée à la position courante. */
function readBtree<T>(r: BinaryReader, fileOffset: number, entry: (r: BinaryReader) => T): T[] {
  const base = fileOffset + FILE_HEADER_SIZE;
  r.offset = base;
  if (r.u16() !== BTREE_MAGIC) throw new Error("Arbre B+ invalide");
  r.u16(); // drapeaux
  const pageSize = r.u16();
  r.offset = base + 26;
  const root = r.u16();
  r.offset = base + 32;
  const levels = r.u16();
  const pages = base + BTREE_HEADER_SIZE;
  const out: T[] = [];
  const walk = (page: number, level: number): void => {
    r.offset = pages + page * pageSize + 2;
    const count = r.i16();
    if (level === 1) {
      r.offset += 4; // pages précédente et suivante
      for (let i = 0; i < count; i++) out.push(entry(r));
      return;
    }
    const first = r.i16();
    const children = [first];
    for (let i = 0; i < count; i++) {
      readCString(r);
      children.push(r.u16());
    }
    for (const child of children) walk(child, level - 1);
  };
  walk(root, levels);
  return out;
}

// ------------------------------------------------------------------ polices

function parseFonts(data: Uint8Array): HelpFont[] {
  const r = new BinaryReader(data);
  const faceCount = r.u16();
  const descriptorCount = r.u16();
  const facesOffset = r.u16();
  const descriptorsOffset = r.u16();
  const faceSize = descriptorsOffset > facesOffset && faceCount > 0 ? (descriptorsOffset - facesOffset) / faceCount : 0;
  const faces: string[] = [];
  for (let i = 0; i < faceCount; i++) {
    r.offset = facesOffset + i * faceSize;
    faces.push(r.fixedString(faceSize));
  }
  const fonts: HelpFont[] = [];
  for (let i = 0; i < descriptorCount; i++) {
    r.offset = descriptorsOffset + i * 11;
    const attributes = r.u8();
    const halfPoints = r.u8();
    r.u8(); // famille
    const face = faces[r.u16()] ?? "";
    fonts.push({
      bold: (attributes & 0x01) !== 0,
      italic: (attributes & 0x02) !== 0,
      underline: (attributes & 0x04) !== 0,
      size: halfPoints / 2,
      monospace: /courier/i.test(face),
    });
  }
  return fonts;
}

// ------------------------------------------------------------------ rubriques

/** Entiers « compressés » du format : la taille dépend du bit de poids faible de l'octet de tête. */
class Packed {
  constructor(private readonly r: BinaryReader) {}

  /** Entier non signé court : 1 octet si pair, 2 sinon. */
  word(): number {
    const first = this.r.u8();
    return first & 1 ? (first | (this.r.u8() << 8)) >> 1 : first >> 1;
  }

  /** Entier non signé long : 2 octets si pair, 4 sinon. */
  ulong(): number {
    const first = this.r.u8();
    if (first & 1) return ((first | (this.r.u8() << 8) | (this.r.u8() << 16) | (this.r.u8() << 24)) >>> 1) >>> 0;
    return (first | (this.r.u8() << 8)) >> 1;
  }

  /** Entier signé long : même taille que le non signé, décalé de la moitié de sa plage. */
  long(): number {
    const first = this.r.u8();
    if (first & 1) return (((first | (this.r.u8() << 8) | (this.r.u8() << 16) | (this.r.u8() << 24)) >>> 1) >>> 0) - 0x40000000;
    return ((first | (this.r.u8() << 8)) >> 1) - 0x4000;
  }

  /** Entier signé court. */
  int(): number {
    const first = this.r.u8();
    return first & 1 ? ((first | (this.r.u8() << 8)) >> 1) - 0x4000 : (first >> 1) - 0x40;
  }
}

/** Zone cliquable dont la cible (un hash de contexte) n'est résolue qu'une fois toutes les rubriques lues. */
interface PendingLink {
  span: HelpSpan;
  hash: number;
}

interface TopicRecord {
  type: number;
  linkData1: Uint8Array;
  linkData2: Uint8Array;
}

/** Les blocs de |TOPIC sont des tranches de 4 Ko dont seul le début (12 octets) est un en-tête. */
function readRecords(topic: Uint8Array): TopicRecord[] {
  const dataSize = TOPIC_BLOCK_SIZE - TOPIC_BLOCK_HEADER_SIZE;
  const blockCount = Math.ceil(topic.length / TOPIC_BLOCK_SIZE);
  const flat = new Uint8Array(blockCount * dataSize);
  flat.fill(0);
  for (let b = 0; b < blockCount; b++) {
    const chunk = topic.subarray(b * TOPIC_BLOCK_SIZE + TOPIC_BLOCK_HEADER_SIZE, (b + 1) * TOPIC_BLOCK_SIZE);
    flat.set(chunk, b * dataSize);
  }
  const reader = new BinaryReader(flat);
  // Une position de rubrique compte 0x4000 par bloc, dont 12 octets d'en-tête.
  const flatOffset = (position: number): number => (position >> 14) * dataSize + (position & 0x3fff) - TOPIC_BLOCK_HEADER_SIZE;

  const records: TopicRecord[] = [];
  let at = 0;
  for (;;) {
    reader.offset = at;
    const size = reader.i32();
    reader.i32(); // taille décompressée des données 2
    reader.i32(); // lien précédent
    const next = reader.i32();
    const headerSize = reader.i32();
    const type = reader.u8();
    if (size < TOPIC_LINK_HEADER_SIZE || headerSize < TOPIC_LINK_HEADER_SIZE || headerSize > size) {
      throw new Error("Enregistrement de rubrique invalide");
    }
    records.push({
      type,
      linkData1: flat.subarray(at + TOPIC_LINK_HEADER_SIZE, at + headerSize),
      linkData2: flat.subarray(at + headerSize, at + size),
    });
    if (next <= 0) break;
    at = flatOffset(next);
  }
  return records;
}

function parseTopics(topicFile: Uint8Array, fonts: HelpFont[], topicByHash: Map<number, number>): HelpTopic[] {
  const topics: HelpTopic[] = [];
  const pending: PendingLink[] = [];
  for (const record of readRecords(topicFile)) {
    if (record.type === RecordType.TopicHeader) {
      const end = record.linkData2.indexOf(0);
      topics.push({ title: decodeText(end === -1 ? record.linkData2 : record.linkData2.subarray(0, end)), paragraphs: [] });
    } else if (record.type === RecordType.Text) {
      const topic = topics.at(-1);
      if (!topic) throw new Error("Texte avant la première rubrique");
      topic.paragraphs.push(...parseParagraphs(record, fonts, pending));
    } else {
      throw new Error(`Type d'enregistrement ${record.type} non géré`);
    }
  }
  // Les liens sont résolus à la fin : une rubrique peut en désigner une qui la suit.
  for (const { span, hash } of pending) {
    const topic = topicByHash.get(hash);
    if (topic === undefined || topic < 0) throw new Error(`Lien vers une rubrique inconnue (${hash.toString(16)})`);
    if (span.kind === "text" || span.kind === "image") span.link = topic;
  }
  return topics;
}

/**
 * Découpe un enregistrement de texte. LinkData1 porte la mise en forme (en-tête de paragraphe puis commandes),
 * LinkData2 le texte en chaînes nulles : avant chaque commande, on place la chaîne suivante.
 */
function parseParagraphs(
  record: TopicRecord,
  fonts: HelpFont[],
  pending: PendingLink[],
): HelpParagraph[] {
  const r = new BinaryReader(record.linkData1);
  const packed = new Packed(r);
  packed.long(); // taille de la rubrique
  packed.word(); // longueur du texte
  packed.long();
  r.u8();
  r.u8();
  const flags = r.u16();
  if (flags & 0x0001) packed.long();
  for (const bit of [0x0002, 0x0004, 0x0008, 0x0010, 0x0020, 0x0040]) if (flags & bit) packed.int();
  if (flags & 0x0100) r.offset += 3;
  if (flags & 0x0200) {
    const tabs = packed.int();
    for (let i = 0; i < tabs; i++) if (packed.word() & 0x4000) packed.word();
  }

  const text = new BinaryReader(record.linkData2);
  const nextString = (): string => (text.isAtEnd ? "" : readCString(text));

  const paragraphs: HelpParagraph[] = [];
  let spans: HelpSpan[] = [];
  let font = fonts[0];
  let hotspot: number | null = null;
  const push = (span: HelpSpan): void => {
    spans.push(span);
    if (hotspot !== null) pending.push({ span, hash: hotspot });
  };

  for (;;) {
    const content = nextString();
    if (content) push({ kind: "text", text: content, font });
    const command = r.u8();
    switch (command) {
      case Command.Font:
        font = fonts[r.u16()] ?? font;
        break;
      case Command.LineBreak:
        spans.push({ kind: "break" });
        break;
      case Command.EndParagraph:
        paragraphs.push({ spans });
        spans = [];
        break;
      case Command.Tab:
        spans.push({ kind: "tab" });
        break;
      case Command.InlinePicture:
      case Command.LeftPicture:
      case Command.RightPicture: {
        const type = r.u8();
        const size = packed.long();
        const end = r.offset + size + 1;
        if (type !== PICTURE_BY_NUMBER) throw new Error(`Image de type ${type} non gérée`);
        r.offset += 3;
        push({ kind: "image", image: r.u16() });
        if (r.offset !== end) throw new Error("Commande d'image inattendue");
        break;
      }
      case Command.EndHotspot:
        hotspot = null;
        break;
      case Command.Popup:
      case Command.PopupLegacy:
      case Command.PopupPlain:
      case Command.Jump:
      case Command.JumpLegacy:
      case Command.JumpPlain:
        hotspot = r.u32();
        break;
      case Command.End:
        if (spans.length > 0) paragraphs.push({ spans });
        if (!r.isAtEnd) throw new Error("Données après la fin du paragraphe");
        return paragraphs;
      default:
        throw new Error(`Commande de mise en forme 0x${command.toString(16)} non gérée`);
    }
  }
}

// ------------------------------------------------------------------ images (MRB)

const MRB_MAGIC = 0x706c;
const PICTURE_DIB = 6;
const PACKING_NONE = 0;
const PACKING_RUN_LENGTH = 1;

function parseBitmap(file: Uint8Array): HelpImage {
  const r = new BinaryReader(file);
  if (r.u16() !== MRB_MAGIC) throw new Error("Image invalide");
  r.u16(); // nombre d'images
  r.offset = r.u32();
  const start = r.offset;
  const type = r.u8();
  const packing = r.u8();
  const packed = new Packed(r);
  packed.ulong(); // résolution horizontale
  packed.ulong(); // résolution verticale
  const planes = packed.word();
  const bitCount = packed.word();
  const width = packed.ulong();
  const height = packed.ulong();
  packed.ulong(); // couleurs utilisées
  packed.ulong(); // couleurs importantes
  const compressedSize = packed.ulong();
  packed.ulong(); // taille des zones cliquables
  const dataOffset = r.u32();
  if (type !== PICTURE_DIB || planes !== 1 || bitCount !== 24) throw new Error("Format d'image non géré");

  const raw = file.subarray(start + dataOffset, start + dataOffset + compressedSize);
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = packing === PACKING_RUN_LENGTH ? runLengthDecode(raw, rowSize * height) : packing === PACKING_NONE ? raw : null;
  if (!pixels || pixels.length < rowSize * height) throw new Error("Image corrompue");

  // DIB : lignes de bas en haut, pixels en BGR.
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = source + x * 3;
      const d = (y * width + x) * 4;
      rgba[d] = pixels[s + 2];
      rgba[d + 1] = pixels[s + 1];
      rgba[d + 2] = pixels[s];
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** Octet de tête : bit 7 levé = N octets recopiés tels quels, sinon l'octet suivant répété N fois. */
function runLengthDecode(source: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  let o = 0;
  while (at < source.length && o < size) {
    const head = source[at++];
    const count = head & 0x7f;
    if (head & 0x80) {
      out.set(source.subarray(at, at + count), o);
      at += count;
    } else {
      out.fill(source[at++], o, o + count);
    }
    o += count;
  }
  return out;
}
