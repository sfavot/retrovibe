/**
 * Sprites animés `.ANI` / `.ANM` et masques `.MSK`.
 *
 * Référence : ScummVM engines/cine/anim.cpp (`loadAnimHeader`, `loadAni`, `loadMsk`, `AnimData::load`, `getAnimTransparentColor`,
 * `generateMask`, `convertMask`, tableau `transparencyData`) (GPL v3 ou ultérieure). Format : docs/voyageurs/formats.md § 2.3 et § 2.4.
 * En-tête de 22 octets (grand-boutiste) : id (u32), largeur d'une frame en octets (i16, pixels = 2 x), hauteur (i16), 6 octets inconnus,
 * nombre de frames (i16), 6 octets inconnus ; puis les frames, planaires pour un ANI/ANM, 1 bit par pixel pour un MSK.
 *
 * Transparence : absente du fichier, donnée par nom dans `transparencyData` (0 par défaut) avec trois cas particuliers : `L2202.ANI`
 * (frames 0-1 : 0, sinon 7), `L4601.ANI` (frame 0 : 0xE, sinon 0) et `TITRE.ANI` de hauteur 37 (0xF). Le premier nom du tableau l'emporte
 * (`L4106` y figure deux fois).
 *
 * Écarts volontaires : les noms sont comparés en majuscules (ScummVM compare à la casse du script, toujours en majuscules ici) ; le hack
 * Amiga/Atari ST d'`ALPHA.ANI` (transparence 0) et le hack `.SET` d'Opération Stealth sont ignorés (version DOS) ; l'attribution des
 * emplacements de `_animDataTable` (`emptyAnimSpace`, `fixAnimDataTableEndFrame`) est du ressort du moteur : ici on rend les frames lues.
 * Convention de ScummVM conservée : `mask` d'un sprite vaut 1 là où le pixel est transparent ; pour un MSK, `data` vaut 0 là où le bit
 * du fichier est à 1 (zone masquante) et 1 ailleurs (`convertMask`).
 */
import { BinaryReader } from "../../../data/reader";
import { planarToIndexed } from "./planar";

export const ANIM_HEADER_SIZE = 22;

/** `transparencyData` : couleur transparente par nom de fichier sans extension. */
const TRANSPARENCY_DATA: readonly (readonly [string, number])[] = [
  ["ALPHA", 0xF], ["TITRE2", 0xF], ["ET", 0xC], ["L311", 0x3],
  ["L405", 0x1], ["L515", 0xC], ["L009", 0xE], ["L010", 0xE],
  ["FUTUR", 0x6], ["PAYSAN3", 0xB], ["L801", 0xC], ["L802", 0xC],
  ["L803", 0xC], ["L901", 0xD], ["L902", 0x8], ["L903", 0xD],
  ["L904", 0xD], ["L905", 0xD], ["L906", 0xD], ["L907", 0xD],
  ["LA03", 0x4], ["MOINE", 0xB], ["L908", 0x8], ["L909", 0x8],
  ["L807", 0xC], ["L808", 0xC], ["LA01", 0xB], ["L1201", 0xC],
  ["L1202", 0xC], ["L1203", 0xC], ["L1210", 0x5], ["L1211", 0xC],
  ["L1214", 0xC], ["L1215", 0xC], ["L1216", 0xC], ["L1217", 0xC],
  ["L1218", 0xC], ["L1219", 0xC], ["L1220", 0xC], ["SEIGNEUR", 0x6],
  ["PERE0", 0xD], ["L1302", 0x4], ["L1303", 0x4], ["L1304", 0x4],
  ["L1401", 0xF], ["L1402", 0xF], ["L1501", 0x8], ["L1503", 0x8],
  ["L1504", 0x4], ["L1505", 0x8], ["L1506", 0x8], ["L1601", 0xB],
  ["L1602", 0xB], ["L1603", 0xB], ["L1604", 0x4], ["L1605", 0x4],
  ["L1701", 0x4], ["L1702", 0x4], ["L1801", 0x6], ["L1904", 0x8],
  ["L2002", 0x8], ["L2003", 0x8], ["L2101", 0x4], ["L2102", 0x4],
  ["L2201", 0x7], ["L2202", 0x7], ["L2203", 0xE], ["L2305", 0x9],
  ["L2306", 0x9], ["GARDE1", 0x7], ["L2402", 0x7], ["L2407", 0x7],
  ["L2408", 0x7], ["GARDE2", 0x6], ["L2601", 0x6], ["L2602", 0x6],
  ["L2603", 0x6], ["L2604", 0x6], ["L2605", 0x8], ["L2606", 0x8],
  ["L2607", 0x8], ["L2610", 0x6], ["L2611", 0x6], ["L2612", 0x6],
  ["L2613", 0x8], ["L2614", 0x6], ["VOYAGEUR", 0x6], ["L2701", 0xD],
  ["L2702", 0xD], ["L2703", 0x6], ["L2801", 0xD], ["L2802", 0xD],
  ["L2803", 0xD], ["L2804", 0xD], ["L2807", 0xD], ["L2902", 0x8],
  ["L2903", 0x8], ["L3101", 0xA], ["L3102", 0xA], ["L3103", 0xA],
  ["L3203", 0xF], ["L3204", 0xF], ["L3001", 0x7], ["L3002", 0x7],
  ["L3416", 0xC], ["L3601", 0x5], ["L3602", 0x5], ["L3603", 0x5],
  ["L3607", 0x5], ["L3701", 0x8], ["L3702", 0x8], ["L3703", 0x8],
  ["L4001", 0xD], ["L4002", 0xD], ["L4103", 0xF], ["L4106", 0xF],
  ["CRUGHON1", 0xC], ["L4203", 0xC], ["L4301", 0xC], ["L4302", 0xC],
  ["L4303", 0xC], ["FUTUR2", 0x6], ["L4601", 0xE], ["L4603", 0x1],
  ["L4106", 0xF], ["L4801", 0xD], ["L4802", 0xD], ["FIN01", 0xB],
  ["FIN02", 0xB], ["FIN03", 0xB], ["FIN", 0x9],
];

const TRANSPARENCY_BY_NAME = (() => {
  const map = new Map<string, number>();
  for (const [name, color] of TRANSPARENCY_DATA) if (!map.has(name)) map.set(name, color);
  return map;
})();

export interface AnimHeader {
  /** Identifiant (0xBABEEBEA, ou 0 pour 9 fichiers) : non testé par le moteur. */
  readonly id: number;
  /** Largeur d'une frame en octets de source (2 pixels par octet pour un ANI, 8 pour un MSK). */
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly numFrames: number;
  /** Octets 8 à 13 et 16 à 21, non interprétés par ScummVM. */
  readonly unknown: Uint8Array;
}

export interface AnimFrame {
  readonly width: number;
  readonly height: number;
  /** Indices de couleur (0 à 15), `width x height`. */
  readonly pixels: Uint8Array;
  /** 1 là où le pixel vaut la couleur transparente (`generateMask`), 0 ailleurs. */
  readonly mask: Uint8Array;
  readonly transparentColor: number;
}

export interface AnimFile {
  readonly header: AnimHeader;
  /** Frames lues : toutes, ou la seule `frameIndex` demandée. */
  readonly frames: readonly AnimFrame[];
  /** Index (dans le fichier) de la première frame de `frames`. */
  readonly firstFrame: number;
}

export interface MaskFrame {
  /** 8 pixels par octet source. */
  readonly width: number;
  readonly height: number;
  /** `convertMask` : 0 là où le bit est à 1, 1 ailleurs. */
  readonly data: Uint8Array;
}

export interface MskFile {
  readonly header: AnimHeader;
  readonly frames: readonly MaskFrame[];
  readonly firstFrame: number;
}

/** `loadAnimHeader`. */
export function readAnimHeader(data: Uint8Array): AnimHeader {
  if (data.length < ANIM_HEADER_SIZE) throw new RangeError(`en-tête ANI/MSK trop court : ${data.length} octets`);
  const reader = new BinaryReader(data);
  const id = reader.u32be();
  const frameWidth = reader.i16be();
  const frameHeight = reader.i16be();
  const unknown = new Uint8Array(12);
  unknown.set(reader.bytesView(6), 0);
  const numFrames = reader.i16be();
  unknown.set(reader.bytesView(6), 6);
  return { id, frameWidth, frameHeight, numFrames, unknown };
}

/** `getAnimTransparentColor` (+ cas `TITRE.ANI` de hauteur 37) pour un fichier entier, avant les cas par frame. */
export function animTransparentColor(name: string, frameHeight: number): number {
  const upper = name.toUpperCase();
  if (upper === "TITRE.ANI" && frameHeight === 37) return 0xf;
  const dot = upper.indexOf(".");
  return TRANSPARENCY_BY_NAME.get(dot === -1 ? upper : upper.slice(0, dot)) ?? 0;
}

/** Couleur transparente de la frame `frame` (cas par frame de `L2202.ANI` et `L4601.ANI`). */
export function frameTransparentColor(name: string, frameHeight: number, frame: number): number {
  const upper = name.toUpperCase();
  if (upper === "L2202.ANI") return frame < 2 ? 0 : 7;
  if (upper === "L4601.ANI") return frame < 1 ? 0xe : 0;
  return animTransparentColor(name, frameHeight);
}

function frameRange(header: AnimHeader, frameIndex: number | undefined, dataLength: number, frameBytes: number): [number, number] {
  const start = frameIndex !== undefined && frameIndex >= 0 ? frameIndex : 0;
  const end = frameIndex !== undefined && frameIndex >= 0 ? frameIndex + 1 : header.numFrames;
  if (ANIM_HEADER_SIZE + end * frameBytes > dataLength) throw new RangeError("ANI/MSK tronqué : frames hors du fichier");
  return [start, end];
}

/**
 * `loadAni` (ANI et ANM). `name` sert à la table de transparence ; `frameIndex` >= 0 ne charge que cette frame (le décalage est alors
 * `frameIndex x taille de frame`, comme dans ScummVM), sinon toutes.
 */
export function readAni(name: string, data: Uint8Array, frameIndex?: number): AnimFile {
  const header = readAnimHeader(data);
  const frameBytes = header.frameWidth * header.frameHeight;
  const [start, end] = frameRange(header, frameIndex, data.length, frameBytes);
  const width = (header.frameWidth >> 3) * 16;
  const frames: AnimFrame[] = [];
  for (let i = start; i < end; i++) {
    const transparentColor = frameTransparentColor(name, header.frameHeight, i);
    const pixels = planarToIndexed(data, ANIM_HEADER_SIZE + i * frameBytes, header.frameWidth, header.frameHeight);
    const mask = new Uint8Array(pixels.length);
    for (let p = 0; p < pixels.length; p++) mask[p] = pixels[p] === transparentColor ? 1 : 0;
    frames.push({ width, height: header.frameHeight, pixels, mask, transparentColor });
  }
  return { header, frames, firstFrame: start };
}

/** `loadMsk` : mêmes règles de frames que `readAni`. */
export function readMsk(data: Uint8Array, frameIndex?: number): MskFile {
  const header = readAnimHeader(data);
  const frameBytes = header.frameWidth * header.frameHeight;
  const [start, end] = frameRange(header, frameIndex, data.length, frameBytes);
  const frames: MaskFrame[] = [];
  for (let i = start; i < end; i++) {
    const out = new Uint8Array(frameBytes * 8);
    const base = ANIM_HEADER_SIZE + i * frameBytes;
    for (let b = 0; b < frameBytes; b++) {
      const entry = data[base + b]!;
      for (let bit = 0; bit < 8; bit++) out[b * 8 + bit] = entry & (0x80 >> bit) ? 0 : 1;
    }
    frames.push({ width: header.frameWidth * 8, height: header.frameHeight, data: out });
  }
  return { header, frames, firstFrame: start };
}
