/**
 * Puzzles `.LEV` de TIM3 (`docs/tim3/formats.md` § 5), lecture et écriture à l'octet près.
 *
 * ```
 * u16 magic 0xACEF ; u16 version (0x111 à 0x114)
 * [version ≥ 0x113] u8 unknown04 (= 0) ; u8 couleur de fond
 * cstring titre ; cstring but ; u16 nombre d'indices
 * 8 × { i16 x ; i16 y ; [version ≥ 0x112] u16 retournement ; cstring texte }
 * infos 16 o : u16 pression, u16 gravité, u16 ?, u16 ?, u16 musique, u16 nFixes, u16 nMobiles, u16 ?
 * nFixes + nMobiles pièces, de taille variable selon le type (48 o ; poulie 56, courroie 52, corde et câble 54,
 *   balle programmable 60)
 * bloc solution 132 o : u16 ? ; 8 × { i16 pièce, état 1, état 2, nombre, x, y, largeur, hauteur } ; u16 délai
 * ```
 * Rien ne suit le bloc solution. Le bac à pièces n'est pas une section : ce sont les pièces sans le drapeau
 * « verrouillée » (`flags3 & 0x40`). Les champs non compris sont gardés bruts sous le nom `unknownXX` (XX = offset
 * hexadécimal dans l'enregistrement), pour que `writeLev(readLev(b))` redonne `b`.
 */
import { BinaryReader, decodeText } from "../../../data/reader";

export const LEV_MAGIC = 0xacef;
export const HINT_SLOTS = 8;
export const CONDITION_SLOTS = 8;
/** `flags3` : pièce verrouillée (posée par le puzzle) ; sans ce bit, elle est dans le bac. */
export const PART_LOCKED = 0x40;
/** `flags1` : pièce fixe (0x6000) ou mobile, soumise à la gravité (0x1000). */
export const PART_FIXED = 0x6000;
export const PART_MOVING = 0x1000;

type FieldType = "u8" | "u16" | "i16";
type Layout = readonly (readonly [string, FieldType])[];
type FieldsOf<L extends Layout> = { [F in L[number] as F[0]]: number };

/** Début commun à tous les enregistrements (24 octets). */
const HEAD = [
  ["type", "u16"],
  ["flags1", "u16"],
  ["flags2", "u16"],
  ["flags3", "u16"],
  ["appearance", "u16"],
  ["unknown0A", "u16"],
  ["width1", "u16"],
  ["height1", "u16"],
  ["width2", "u16"],
  ["height2", "u16"],
  ["x", "i16"],
  ["y", "i16"],
] as const;

/** Liens vers d'autres pièces (index dans la liste des pièces, −1 = aucun). */
const LINKS = [
  ["connected1", "i16"],
  ["connected2", "i16"],
  ["plugged1", "i16"],
  ["plugged2", "i16"],
] as const;

const DEFAULT_TAIL = [
  ["behavior", "u16"],
  ["unknown1A", "u16"],
  ["beltAnchorX", "u8"],
  ["beltAnchorY", "u8"],
  ["beltLineDistance", "u16"],
  ["unknown20", "u16"],
  ["rope1AnchorX", "u8"],
  ["rope1AnchorY", "u8"],
  ["unknown24", "u16"],
  ["rope2AnchorX", "u8"],
  ["rope2AnchorY", "u8"],
  ...LINKS,
] as const;

/** Balle programmable (87) : propriétés physiques choisies dans l'éditeur, 12 octets en plus. */
const BALL_TAIL = [
  ...DEFAULT_TAIL,
  ["density", "u16"],
  ["elasticity", "u16"],
  ["friction", "u16"],
  ["gravityBuoyancy", "i16"],
  ["mass", "u16"],
  ["appearance2", "u16"],
] as const;

/** Corde (10) et câble d'acier (76). */
const ROPE_TAIL = [
  ["segmentLength", "u16"],
  ["unknown1A", "u16"],
  ["unknown1C", "u16"],
  ["unknown1E", "u16"],
  ["unknown20", "u16"],
  ["unknown22", "u16"],
  ["ropePart1", "i16"],
  ["ropePart2", "i16"],
  ["ropeEnd1Usage", "u8"],
  ["ropeEnd2Usage", "u8"],
  ["unknown2A", "u16"],
  ["unknown2C", "u16"],
  ...LINKS,
] as const;

/** Courroie (8). */
const BELT_TAIL = [
  ["unknown18", "u16"],
  ["unknown1A", "u16"],
  ["unknown1C", "u16"],
  ["unknown1E", "u16"],
  ["beltPart1", "i16"],
  ["beltPart2", "i16"],
  ["unknown24", "u16"],
  ["unknown26", "u16"],
  ["unknown28", "u16"],
  ["unknown2A", "u16"],
  ...LINKS,
] as const;

/** Poulie (7). Les deux points d'attache de corde sont supposés (mêmes valeurs que `rope1Anchor` des autres pièces). */
const PULLEY_TAIL = [
  ["unknown18", "u16"],
  ["unknown1A", "u16"],
  ["unknown1C", "u16"],
  ["unknown1E", "u16"],
  ["unknown20", "u16"],
  ["rope1AnchorX", "u8"],
  ["rope1AnchorY", "u8"],
  ["unknown24", "i16"],
  ["unknown26", "i16"],
  ["unknown28", "u16"],
  ["unknown2A", "u16"],
  ["rope2AnchorX", "u8"],
  ["rope2AnchorY", "u8"],
  ["pulleyPart1", "i16"],
  ["pulleyPart2", "i16"],
  ["unknown32", "i16"],
  ["unknown34", "i16"],
  ["ropeIndex", "i16"],
] as const;

const LAYOUTS = {
  default: [...HEAD, ...DEFAULT_TAIL],
  programmableBall: [...HEAD, ...BALL_TAIL],
  rope: [...HEAD, ...ROPE_TAIL],
  belt: [...HEAD, ...BELT_TAIL],
  pulley: [...HEAD, ...PULLEY_TAIL],
} as const;

export type LevPartKind = keyof typeof LAYOUTS;

export type LevDefaultPart = { kind: "default" } & FieldsOf<typeof LAYOUTS.default>;
export type LevProgrammableBall = { kind: "programmableBall" } & FieldsOf<typeof LAYOUTS.programmableBall>;
export type LevRope = { kind: "rope" } & FieldsOf<typeof LAYOUTS.rope>;
export type LevBelt = { kind: "belt" } & FieldsOf<typeof LAYOUTS.belt>;
export type LevPulley = { kind: "pulley" } & FieldsOf<typeof LAYOUTS.pulley>;
export type LevPart = LevDefaultPart | LevProgrammableBall | LevRope | LevBelt | LevPulley;

/** Forme d'enregistrement selon le type de pièce. */
export function partKind(type: number): LevPartKind {
  switch (type) {
    case 7:
      return "pulley";
    case 8:
      return "belt";
    case 10:
    case 76:
      return "rope";
    case 87:
      return "programmableBall";
    default:
      return "default";
  }
}

/** Taille en octets de l'enregistrement d'une pièce de ce type. */
export function partRecordSize(type: number): number {
  return layoutSize(LAYOUTS[partKind(type)]);
}

/** Pièce de ce type dont tous les champs valent 0. */
export function emptyPart(type: number): LevPart {
  const kind = partKind(type);
  const part: Record<string, number | string> = { kind };
  for (const [name] of LAYOUTS[kind]) part[name] = 0;
  part.type = type;
  return part as unknown as LevPart;
}

export interface LevHint {
  /** Position de la flèche d'indice. */
  x: number;
  y: number;
  /** Retournement de la flèche (0 à 3) ; absent en version 0x111. */
  flip?: number;
  /** Texte anglais (vide pour un emplacement libre). */
  text: string;
}

export interface LevInfo {
  /** Pression de l'air (67 par défaut). */
  pressure: number;
  /** Gravité (272 par défaut). */
  gravity: number;
  /** 0, sauf 568 dans les sept fichiers 0x114. */
  unknown04: number;
  /** 0, sauf 378 dans les sept fichiers 0x114. */
  unknown06: number;
  /** Musique : `SX_<musique>.HMI` (1000 à 1023), 0 = aucune. */
  music: number;
  /** Toujours 0. */
  unknown0E: number;
}

/** Condition de réussite. `partIndex` = −1 : emplacement libre. */
export interface LevCondition {
  /** Index de la pièce dans `levelParts()` (fixes puis mobiles). */
  partIndex: number;
  /** Plage d'états visée (numérotation interne du jeu, non reliée ici à `SOLVE.RES`). */
  state1: number;
  state2: number;
  count: number;
  /** Zone où doit se trouver la pièce : (0,0,0,0) = pas de test de position ; (−1,−1,−1,−1) = hors de l'écran. */
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
}

export interface LevSolution {
  /** 1 dans les 206 puzzles (ce n'est pas le nombre de conditions, qui va de 1 à 8). */
  unknown00: number;
  /** Les 8 emplacements, libres compris. */
  conditions: LevCondition[];
  /** Délai avant que le jeu commence à vérifier la solution (0 sauf pour 4 puzzles). */
  delay: number;
}

export interface Level {
  version: number;
  /** Octets 4 et 5, présents à partir de la version 0x113. */
  prefix?: { unknown04: number; backgroundColor: number };
  title: string;
  goal: string;
  hintCount: number;
  /** Toujours 8 emplacements. */
  hints: LevHint[];
  info: LevInfo;
  /** Pièces fixes (`flags1` = 0x6000), en premier dans le fichier. */
  fixedParts: LevPart[];
  /** Pièces mobiles (`flags1` = 0x1000). */
  movingParts: LevPart[];
  solution: LevSolution;
}

const CONDITION_FIELDS = ["partIndex", "state1", "state2", "count", "rectX", "rectY", "rectWidth", "rectHeight"] as const;
const SOLUTION_SIZE = 2 + CONDITION_SLOTS * 16 + 2;

export function readLev(bytes: Uint8Array): Level {
  const r = new BinaryReader(bytes);
  if (bytes.length < 4 || r.u16() !== LEV_MAGIC) throw new Error("TIM3 : LEV invalide (magic)");
  const version = r.u16();
  if (version < 0x111 || version > 0x114) throw new Error(`TIM3 : version de LEV inconnue (0x${version.toString(16)})`);
  const prefix = version >= 0x113 ? { unknown04: r.u8(), backgroundColor: r.u8() } : undefined;
  const title = cString(r);
  const goal = cString(r);
  const hintCount = r.u16();
  const hints: LevHint[] = [];
  for (let i = 0; i < HINT_SLOTS; i++) {
    const x = r.i16();
    const y = r.i16();
    const flip = version >= 0x112 ? r.u16() : undefined;
    hints.push(flip === undefined ? { x, y, text: cString(r) } : { x, y, flip, text: cString(r) });
  }
  const info: LevInfo = {
    pressure: r.u16(),
    gravity: r.u16(),
    unknown04: r.u16(),
    unknown06: r.u16(),
    music: r.u16(),
    unknown0E: 0,
  };
  const fixedCount = r.u16();
  const movingCount = r.u16();
  info.unknown0E = r.u16();
  const fixedParts = readParts(r, fixedCount);
  const movingParts = readParts(r, movingCount);
  if (r.offset + SOLUTION_SIZE !== bytes.length) {
    throw new Error(`TIM3 : LEV mal lu (${bytes.length - r.offset} octets après les pièces, ${SOLUTION_SIZE} attendus)`);
  }
  const unknown00 = r.u16();
  const conditions: LevCondition[] = [];
  for (let i = 0; i < CONDITION_SLOTS; i++) {
    const c = {} as LevCondition;
    for (const f of CONDITION_FIELDS) c[f] = r.i16();
    conditions.push(c);
  }
  const delay = r.u16();
  return { version, prefix, title, goal, hintCount, hints, info, fixedParts, movingParts, solution: { unknown00, conditions, delay } };
}

export function writeLev(level: Level): Uint8Array {
  const w = new Writer();
  const { version } = level;
  w.u16(LEV_MAGIC);
  w.u16(version);
  if (version >= 0x113) {
    if (!level.prefix) throw new Error("TIM3 : LEV ≥ 0x113 sans octets 4 et 5");
    w.u8(level.prefix.unknown04);
    w.u8(level.prefix.backgroundColor);
  }
  w.cString(level.title);
  w.cString(level.goal);
  w.u16(level.hintCount);
  if (level.hints.length !== HINT_SLOTS) throw new Error(`TIM3 : un LEV a ${HINT_SLOTS} emplacements d'indice`);
  for (const h of level.hints) {
    w.i16(h.x);
    w.i16(h.y);
    if (version >= 0x112) w.u16(h.flip ?? 0);
    w.cString(h.text);
  }
  const { info } = level;
  for (const v of [info.pressure, info.gravity, info.unknown04, info.unknown06, info.music]) w.u16(v);
  w.u16(level.fixedParts.length);
  w.u16(level.movingParts.length);
  w.u16(info.unknown0E);
  for (const p of [...level.fixedParts, ...level.movingParts]) writePart(w, p);
  const { solution } = level;
  if (solution.conditions.length !== CONDITION_SLOTS) throw new Error(`TIM3 : un LEV a ${CONDITION_SLOTS} conditions`);
  w.u16(solution.unknown00);
  for (const c of solution.conditions) for (const f of CONDITION_FIELDS) w.i16(c[f]);
  w.u16(solution.delay);
  return w.bytes();
}

/** Toutes les pièces, dans l'ordre du fichier (celui des index de liens et de conditions). */
export function levelParts(level: Level): LevPart[] {
  return [...level.fixedParts, ...level.movingParts];
}

/** Pièces du bac (non verrouillées), dans l'ordre du fichier. */
export function binParts(level: Level): LevPart[] {
  return levelParts(level).filter((p) => (p.flags3 & PART_LOCKED) === 0);
}

/** Conditions de réussite utilisées (emplacements non libres). */
export function activeConditions(level: Level): LevCondition[] {
  return level.solution.conditions.filter((c) => c.partIndex !== -1);
}

function readParts(r: BinaryReader, count: number): LevPart[] {
  const out: LevPart[] = [];
  for (let i = 0; i < count; i++) {
    if (r.offset + 2 > r.length) throw new Error("TIM3 : LEV tronqué dans les pièces");
    const type = peekU16(r);
    const kind = partKind(type);
    const layout = LAYOUTS[kind];
    if (r.offset + layoutSize(layout) > r.length) throw new Error("TIM3 : LEV tronqué dans les pièces");
    const part: Record<string, number | string> = { kind };
    for (const [name, t] of layout) part[name] = t === "u8" ? r.u8() : t === "u16" ? r.u16() : r.i16();
    out.push(part as unknown as LevPart);
  }
  return out;
}

function writePart(w: Writer, part: LevPart): void {
  const kind = partKind(part.type);
  if (kind !== part.kind) throw new Error(`TIM3 : pièce de type ${part.type} décrite comme ${part.kind}`);
  const fields = part as unknown as Record<string, number>;
  for (const [name, t] of LAYOUTS[kind]) {
    const v = fields[name];
    if (v === undefined) throw new Error(`TIM3 : champ ${name} absent (pièce ${part.type})`);
    if (t === "u8") w.u8(v);
    else if (t === "u16") w.u16(v);
    else w.i16(v);
  }
}

function peekU16(r: BinaryReader): number {
  const v = r.u16();
  r.offset -= 2;
  return v;
}

function layoutSize(layout: Layout): number {
  return layout.reduce((n, [, t]) => n + (t === "u8" ? 1 : 2), 0);
}

function cString(r: BinaryReader): string {
  const start = r.offset;
  const all = r.bytesView(r.length - start);
  const end = all.indexOf(0);
  if (end === -1) throw new Error("TIM3 : chaîne de LEV sans terminateur");
  r.offset = start + end + 1;
  return decodeText(all.subarray(0, end));
}

/** Table inverse de Windows-1252, construite à partir du décodeur du lecteur (aller-retour exact sur les 256 octets). */
let cp1252: Map<string, number> | undefined;

function encodeCp1252(text: string): number[] {
  if (!cp1252) {
    cp1252 = new Map();
    for (let b = 0; b < 256; b++) cp1252.set(decodeText(Uint8Array.of(b)), b);
  }
  const table = cp1252;
  return [...text].map((ch) => {
    const b = table.get(ch);
    if (b === undefined) throw new Error(`TIM3 : caractère hors Windows-1252 : ${ch}`);
    return b;
  });
}

class Writer {
  private readonly out: number[] = [];

  u8(v: number): void {
    this.out.push(v & 0xff);
  }

  u16(v: number): void {
    this.out.push(v & 0xff, (v >> 8) & 0xff);
  }

  i16(v: number): void {
    this.u16(v & 0xffff);
  }

  cString(text: string): void {
    for (const b of encodeCp1252(text)) {
      if (b === 0) throw new Error("TIM3 : octet nul dans une chaîne de LEV");
      this.out.push(b);
    }
    this.out.push(0);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
