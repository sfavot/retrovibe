/**
 * Sauvegardes de The Incredible Machine 3 (vague S, D11).
 *
 * - **Progression** (puzzles résolus, dernier puzzle) : `Progress`, dans `session.ts`.
 * - **Machines du Labo** : 10 emplacements de `SaveSlots` (préfixe `tim3:`), un JSON versionné qui reprend les champs d'un LEV
 *   (réglages de `LevInfo` et pièces `LevPart`, celles de `data/lev.ts`) plus le nom saisi par le joueur (le titre du LEV). Le jeu
 *   d'origine écrivait un fichier LEV ; on garde le même contenu, sans fichier. **Version 2** : le puzzle maison (but, indices,
 *   conditions de réussite et délai, `lab-puzzle.ts`) ; une machine de la version 1 se lit avec un puzzle vide (`migrateLabMachine`).
 *   Les pièces verrouillées au cadenas sont celles qui ne sont pas dans `placed`.
 * - **État d'édition** : l'aire d'un puzzle (clé `edit:<puzzle>`) ou du Labo (`edit:lab`) est gardée à la sortie, jamais en pleine
 *   simulation : une photo n'est prise que hors marche, donc c'est toujours l'état d'avant « Démarrer ».
 *
 * **Photo d'un monde** (`snapshotWorld`) : l'inverse de `World.addFromLev` (43173e). Chaque pièce devient un enregistrement de LEV
 * (position, image, retournements, taille, liens de cordes, courroies et branchements par index). Au chargement
 * (`World.loadLevel`) toute pièce sans le drapeau « verrouillée » part au bac (43267a) ; les pièces posées par le joueur sont donc
 * écrites **verrouillées**, et `placed` dit lesquelles le joueur peut de nouveau déplacer (`SessionOptions.unlock`). Les pièces du
 * bac (puzzles) sont écrites déverrouillées : le chargement les y remet.
 *
 * Index d'un puzzle : les pièces d'origine gardent leur index du LEV (les conditions de victoire s'y rapportent, `Part.levIndex`) ;
 * celles que l'éditeur a créées (partenaire d'une télécommande) viennent après. Index du Labo : l'ordre des listes (fixes, puis
 * mobiles).
 *
 * Écarts : l'ordre des pièces dans les listes du monde dépend de l'ordre d'insertion (4393e0, égalités de masse et de position) :
 * une reprise garde l'ordre des enregistrements, qui est celui des listes au moment de la photo, mais n'est pas identique à celui
 * d'une pose à la main en cas d'égalité. Les pièces d'un puzzle créées par l'éditeur sont rangées dans les mobiles au chargement.
 *
 * Module pur : il ne connaît pas le stockage, sauf `EditStore` et `labSaveSlots` qui y branchent `HostStorage` et `SaveSlots`.
 */
import { emptyPart, partKind, PART_LOCKED, type Level, type LevCondition, type LevHint, type LevPart, type LevSolution } from "../data/lev";
import { SaveSlots } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { GOAL_MAX, HINT_TEXT_MAX, LabPuzzle, MAX_CONDITIONS, MAX_HINTS } from "./lab-puzzle";
import { DEFAULT_LAB, labLevel, puzzleList, type LabSettings } from "./session";
import { TYPE_COUNT } from "./types";
import type { Part } from "./part";
import type { World } from "./world";

/** Version écrite ; la version 1 (machines sans puzzle maison) se lit encore. */
export const SAVE_VERSION = 2;
const READABLE_VERSIONS: ReadonlySet<unknown> = new Set([1, 2]);
/** Emplacements de machines du Labo : clés `slot01` … `slot10` sous `tim3:`. */
export const SLOT_COUNT = 10;
/** Longueur maximale du nom d'une machine. */
export const NAME_MAX = 32;
/** Plafond de pièces d'une sauvegarde (le bac d'un puzzle en compte une centaine au plus). */
const MAX_PARTS = 512;

// ------------------------------------------------------------------ photo d'un monde

/** Pièces d'une aire, comme un LEV les range. */
export interface PartsSnapshot {
  fixedParts: LevPart[];
  movingParts: LevPart[];
  /** Index (dans fixes puis mobiles) des pièces que le joueur a posées : les seules qu'il peut déplacer. */
  placed: number[];
}

/** Machine du Labo : réglages de `LevInfo` (gravité, pression, musique), couleur du décor, pièces, et le puzzle maison. */
export interface LabMachine extends PartsSnapshot {
  background: number;
  gravity: number;
  pressure: number;
  music: number;
  /** Texte du but (barre du but au Labo). */
  goal: string;
  /** 8 indices du LEV (texte vide : emplacement libre). */
  hints: LevHint[];
  /** Conditions de réussite (index des pièces dans fixes puis mobiles) et délai. */
  solution: LevSolution;
}

/** Puzzle vide : la machine se joue sans but (Labo de la version 1). */
export function emptyPuzzle(): Pick<LabMachine, "goal" | "hints" | "solution"> {
  const empty = new LabPuzzle();
  const { hints } = empty.levHints();
  return { goal: "", hints, solution: empty.solution(() => -1) };
}

/** La machine a-t-elle un but (au moins une condition) : elle se joue alors comme un puzzle (bac « Maison »). */
export function hasGoal(machine: Pick<LabMachine, "solution">): boolean {
  return machine.solution.conditions.some((c) => c.partIndex >= 0);
}

const FIXED = 0x6000;
const MOVING = 0x1000;
/** `flags0C` : pièce rangée dans les statiques (43965b). */
const STATIC_TYPE = 0x4000;
const int16 = (v: number): number => v | 0;
const byte = (v: number): number => v & 0xff;
const pair = (lo: number, hi: number): number => byte(lo) | (byte(hi) << 8);

/** Enregistrement de LEV d'une pièce (inverse de `World.addFromLev` et de `levLinks`). */
function record(p: Part, flags1: number, locked: boolean, index: (q: Part | null | undefined) => number): LevPart {
  const rec = emptyPart(p.type) as unknown as Record<string, number | string>;
  Object.assign(rec, {
    type: p.type,
    flags1,
    flags2: p.flags10 & 0x32,
    flags3: (p.flags14 & 0x140 & ~PART_LOCKED) | (locked ? PART_LOCKED : 0),
    appearance: int16(p.editFrame),
    unknown0A: int16(p.editF24),
    width1: int16(p.frameW),
    height1: int16(p.frameH),
    width2: int16(p.boxW),
    height2: int16(p.boxH),
    x: int16(p.editX),
    y: int16(p.editY),
  });
  const a = p.ropeAnchor;
  const links = { connected1: index(p.links[0]), connected2: index(p.links[1]), plugged1: index(p.links[4]), plugged2: index(p.links[5]) };
  const common = { f88: pair(p.f88, p.f89), f8C: p.f8C & 0xffff, behavior: p.fFC & 0xffff };
  switch (partKind(p.type)) {
    case "default":
    case "programmableBall": {
      Object.assign(rec, {
        behavior: common.behavior,
        beltAnchorX: byte(p.f88),
        beltAnchorY: byte(p.f89),
        beltLineDistance: common.f8C,
        rope1AnchorX: byte(a[0]!),
        rope1AnchorY: byte(a[1]!),
        rope2AnchorX: byte(a[2]!),
        rope2AnchorY: byte(a[3]!),
        ...links,
      });
      if (rec.kind === "programmableBall") {
        const prog = p.prog ?? new Int32Array(4);
        Object.assign(rec, { density: prog[0]!, elasticity: prog[1]!, friction: prog[2]!, gravityBuoyancy: prog[3]!, mass: int16(p.mass), appearance2: int16(p.editFrame) });
      }
      break;
    }
    case "rope": {
      const r = p.ropes[0];
      Object.assign(rec, {
        segmentLength: common.behavior,
        unknown1C: common.f88,
        unknown1E: common.f8C,
        unknown22: pair(a[0]!, a[1]!),
        unknown2C: pair(a[2]!, a[3]!),
        ropePart1: index(r?.end1),
        ropePart2: index(r?.end2),
        ropeEnd1Usage: byte(r?.slot1 ?? 0),
        ropeEnd2Usage: byte(r?.slot2 ?? 0),
        ...links,
      });
      break;
    }
    case "belt": {
      Object.assign(rec, {
        unknown18: common.behavior,
        unknown1C: common.f88,
        unknown1E: common.f8C,
        beltPart1: index(p.belt?.end1),
        beltPart2: index(p.belt?.end2),
        unknown26: pair(a[0]!, a[1]!),
        unknown2A: pair(a[2]!, a[3]!),
        ...links,
      });
      break;
    }
    case "pulley": {
      const r = p.ropes[0];
      Object.assign(rec, {
        unknown18: common.behavior,
        unknown1C: common.f88,
        unknown1E: common.f8C,
        rope1AnchorX: byte(a[0]!),
        rope1AnchorY: byte(a[1]!),
        rope2AnchorX: byte(a[2]!),
        rope2AnchorY: byte(a[3]!),
        unknown24: index(r?.end1),
        unknown26: index(r?.end2),
        unknown28: pair(r?.slot1 ?? 0, r?.slot2 ?? 0),
        pulleyPart1: links.connected1,
        pulleyPart2: links.connected2,
        unknown32: links.plugged1,
        unknown34: links.plugged2,
        ropeIndex: index(p.ropes[1]?.ropePart),
      });
      break;
    }
  }
  return rec as unknown as LevPart;
}

/**
 * Photo de l'aire d'un monde **en édition** (rien n'est gardé en marche : `null`). La pièce tenue doit avoir été rendue
 * (`Editor.release`). `base` : le puzzle ouvert (nombre de pièces du LEV, dont le bac est écrit aussi) ; sans `base`, le Labo
 * (seules les pièces posées comptent : le bac est la palette). `null` aussi si une pièce du puzzle manque.
 */
export function snapshotWorld(world: World, base?: Level): PartsSnapshot | null {
  if (world.running) return null;
  const aire = [...world.statics, ...world.mobiles];
  let ordered: Part[];
  let fixedCount: number;
  if (base) {
    const baseCount = base.fixedParts.length + base.movingParts.length;
    const slots: (Part | undefined)[] = new Array<Part | undefined>(baseCount);
    const extras: Part[] = [];
    for (const p of [...aire, ...world.bin]) {
      if (p.levIndex >= 0 && p.levIndex < baseCount) slots[p.levIndex] = p;
      else if (aire.includes(p)) extras.push(p);
    }
    for (let i = 0; i < baseCount; i++) if (!slots[i]) return null;
    extras.sort((x, y) => x.levIndex - y.levIndex);
    ordered = [...(slots as Part[]), ...extras];
    fixedCount = base.fixedParts.length;
  } else {
    ordered = aire;
    fixedCount = world.statics.toArray().length;
  }
  const numbers = new Map<Part, number>(ordered.map((p, i) => [p, i]));
  const index = (q: Part | null | undefined): number => (q ? (numbers.get(q) ?? -1) : -1);
  const inAire = new Set(aire);
  const placed: number[] = [];
  const records = ordered.map((p, i): LevPart => {
    const here = inAire.has(p);
    if (here && !(p.flags14 & PART_LOCKED)) placed.push(i);
    const flags1 = base ? (i < fixedCount ? FIXED : MOVING) : p.flags0C & STATIC_TYPE ? FIXED : MOVING;
    return record(p, flags1, here, index);
  });
  return { fixedParts: records.slice(0, fixedCount), movingParts: records.slice(fixedCount), placed };
}

/** Le niveau d'un puzzle ouvert avec les pièces d'une photo (les conditions de victoire, le but et les indices restent ceux du LEV). */
export function levelWithParts(base: Level, parts: PartsSnapshot): Level {
  return { ...base, fixedParts: parts.fixedParts, movingParts: parts.movingParts };
}

/** Le niveau d'une machine du Labo (`title` : son nom). Les pièces sont toutes écrites verrouillées : `placed` dit lesquelles libérer. */
export function machineLevel(machine: LabMachine, title = ""): Level {
  const settings: LabSettings = { gravity: machine.gravity, pressure: machine.pressure, background: machine.background, music: machine.music };
  const hintCount = machine.hints.filter((h) => h.text !== "").length;
  return { ...levelWithParts(labLevel(settings), machine), title, goal: machine.goal, hintCount, hints: machine.hints.map((h) => ({ ...h })), solution: machine.solution };
}

/**
 * Le niveau qu'on joue d'une machine (essai du Labo, mode 8, et bac « Maison ») : comme 43252d le recharge hors des modes 1 et 6, les
 * pièces non verrouillées (`placed`) partent au bac (43267a), les verrouillées restent à leur place.
 */
export function puzzleLevel(machine: LabMachine, title = ""): Level {
  const level = machineLevel(machine, title);
  const free = new Set(machine.placed);
  const fixedCount = machine.fixedParts.length;
  const unlock = (p: LevPart, i: number): LevPart => (free.has(i) ? { ...p, flags3: p.flags3 & ~PART_LOCKED } : p);
  return { ...level, fixedParts: level.fixedParts.map((p, i) => unlock(p, i)), movingParts: level.movingParts.map((p, i) => unlock(p, fixedCount + i)) };
}

/** Les réglages du Labo d'une machine. */
export function machineSettings(machine: LabMachine): LabSettings {
  return { gravity: machine.gravity, pressure: machine.pressure, background: machine.background, music: machine.music };
}

/** Photo du Labo avec ses réglages et son puzzle maison ; `null` si le monde est en marche. */
export function snapshotLab(world: World, settings: LabSettings, puzzle: LabPuzzle | null = null): LabMachine | null {
  const parts = snapshotWorld(world);
  if (!parts) return null;
  const order = [...world.statics, ...world.mobiles];
  const p = puzzle ?? new LabPuzzle();
  return { ...parts, ...settings, goal: p.goal, hints: p.levHints().hints, solution: p.solution((q) => order.indexOf(q)) };
}

// ------------------------------------------------------------------ lecture d'une valeur inconnue

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Enregistrement de pièce lisible : type connu, forme et champs de ce type, entiers de 16 bits. */
function parsePart(value: unknown): LevPart | null {
  if (!isRecord(value) || !isInt(value.type, 0, TYPE_COUNT - 1)) return null;
  const template = emptyPart(value.type) as unknown as Record<string, unknown>;
  if (value.kind !== template.kind) return null;
  const out: Record<string, unknown> = { kind: template.kind };
  for (const key of Object.keys(template)) {
    if (key === "kind") continue;
    const v = value[key];
    if (!isInt(v, -0x8000, 0xffff)) return null;
    out[key] = v;
  }
  return out as unknown as LevPart;
}

function parseParts(value: unknown): LevPart[] | null {
  if (!Array.isArray(value) || value.length > MAX_PARTS) return null;
  const out: LevPart[] = [];
  for (const v of value) {
    const p = parsePart(v);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/** Photo lisible, ou `null` (corrompue). Les liens hors des pièces sont permis : le chargement les lit comme « aucun ». */
export function parsePartsSnapshot(value: unknown): PartsSnapshot | null {
  if (!isRecord(value)) return null;
  const fixedParts = parseParts(value.fixedParts);
  const movingParts = parseParts(value.movingParts);
  if (!fixedParts || !movingParts || fixedParts.length + movingParts.length > MAX_PARTS) return null;
  const total = fixedParts.length + movingParts.length;
  const placed = value.placed;
  if (!Array.isArray(placed) || placed.length > total || !placed.every((i) => isInt(i, 0, total - 1))) return null;
  return { fixedParts, movingParts, placed: [...placed] as number[] };
}

function parseHints(value: unknown): LevHint[] | null {
  if (!Array.isArray(value) || value.length !== MAX_HINTS) return null;
  const out: LevHint[] = [];
  for (const h of value) {
    if (!isRecord(h) || !isInt(h.x, -0x8000, 0x7fff) || !isInt(h.y, -0x8000, 0x7fff) || !isInt(h.flip, 0, 3) || typeof h.text !== "string" || h.text.length > HINT_TEXT_MAX) return null;
    out.push({ x: h.x, y: h.y, flip: h.flip, text: h.text });
  }
  return out;
}

function parseSolution(value: unknown, total: number): LevSolution | null {
  if (!isRecord(value) || !isInt(value.unknown00, 0, 0xffff) || !isInt(value.delay, 0, 0xffff)) return null;
  const list = value.conditions;
  if (!Array.isArray(list) || list.length !== MAX_CONDITIONS) return null;
  const conditions: LevCondition[] = [];
  for (const c of list) {
    if (!isRecord(c) || !isInt(c.partIndex, -1, total - 1)) return null;
    const out = { partIndex: c.partIndex } as Record<string, number>;
    for (const key of ["state1", "state2", "count", "rectX", "rectY", "rectWidth", "rectHeight"] as const) {
      const v = c[key];
      if (!isInt(v, -0x80000000, 0x7fffffff)) return null;
      out[key] = v;
    }
    conditions.push(out as unknown as LevCondition);
  }
  return { unknown00: value.unknown00, conditions, delay: value.delay };
}

/**
 * Machine du Labo lisible, ou `null`. `version` 1 : pas de puzzle maison, il est vide (migration) ; version 2 : but, indices et
 * solution obligatoires.
 */
export function parseLabMachine(value: unknown, version: number = SAVE_VERSION): LabMachine | null {
  if (!isRecord(value)) return null;
  const parts = parsePartsSnapshot(value);
  const { background, gravity, pressure, music } = value;
  if (!parts || !isInt(background, 1, 11) || !isInt(gravity, 0, 999) || !isInt(pressure, 0, 999) || !isInt(music, 0, 1023)) return null;
  const machine = { ...parts, background, gravity, pressure, music };
  if (version === 1) return migrateLabMachine(machine);
  const total = parts.fixedParts.length + parts.movingParts.length;
  const goal = value.goal;
  const hints = parseHints(value.hints);
  const solution = parseSolution(value.solution, total);
  if (typeof goal !== "string" || goal.length > GOAL_MAX || !hints || !solution) return null;
  return { ...machine, goal, hints, solution };
}

/** Version 1 → 2 : la machine garde ses pièces et ses réglages, sans but, indice ni condition. */
export function migrateLabMachine(machine: Omit<LabMachine, "goal" | "hints" | "solution">): LabMachine {
  return { ...machine, ...emptyPuzzle() };
}

// ------------------------------------------------------------------ machines du Labo (emplacements)

/** Contenu d'un emplacement. */
export interface LabSave {
  version: typeof SAVE_VERSION;
  /** Nom saisi par le joueur (1 à `NAME_MAX` caractères). */
  name: string;
  machine: LabMachine;
}

/** Nom nettoyé (espaces de bord retirés, longueur bornée), ou `null` s'il est vide. */
export function cleanName(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return clean === "" ? null : clean;
}

/**
 * Valide la valeur d'un emplacement : `null` si c'est une version inconnue, un JSON étranger ou des données corrompues. Une machine de
 * la version 1 est rendue en version 2 (puzzle vide).
 */
export function parseLabSave(value: unknown): LabSave | null {
  if (!isRecord(value) || !READABLE_VERSIONS.has(value.version) || typeof value.name !== "string") return null;
  const name = cleanName(value.name);
  const machine = parseLabMachine(value.machine, value.version as number);
  return name !== null && machine ? { version: SAVE_VERSION, name, machine } : null;
}

export type LabSlots = SaveSlots<LabSave>;

/** Les emplacements de machines sur `store` (déjà préfixé par `tim3:`). */
export function labSaveSlots(store: HostStorage): LabSlots {
  return new SaveSlots(store, { count: SLOT_COUNT, parse: parseLabSave, name: "The Incredible Machine 3" });
}

/** Résultat de `saveMachine` : `occupied` demande confirmation (rappeler avec `replace`). */
export type SaveOutcome = "saved" | "noName" | "empty" | "occupied" | "failed";
/** Résultat de `loadMachine` : `empty` = rien de lisible dans l'emplacement. */
export type LoadOutcome = { status: "loaded"; name: string; machine: LabMachine } | { status: "empty" };

/**
 * Range `machine` dans l'emplacement `slot` sous le nom `name`. Refus : nom vide (`noName`), aire sans pièce posée (`empty` :
 * « aucun élément à sauvegarder »), emplacement déjà plein sans `replace` (`occupied`), stockage qui refuse (`failed`).
 */
export function saveMachine(slots: LabSlots, slot: number, name: string, machine: LabMachine, now: number, replace = false): SaveOutcome {
  const clean = cleanName(name);
  if (clean === null) return "noName";
  if (machine.fixedParts.length + machine.movingParts.length === 0) return "empty";
  if (!replace && slots.read(slot)) return "occupied";
  return slots.write(slot, { version: SAVE_VERSION, name: clean, machine }, now) ? "saved" : "failed";
}

/** Lit l'emplacement `slot` ; jamais d'exception (vide, illisible ou d'une autre version : `empty`). */
export function loadMachine(slots: LabSlots, slot: number): LoadOutcome {
  const stored = slots.read(slot);
  return stored ? { status: "loaded", name: stored.save.name, machine: stored.save.machine } : { status: "empty" };
}

// ------------------------------------------------------------------ état d'édition

/** Valeur gardée pour l'aire d'un puzzle (`edit:<puzzle>`) ou du Labo (`edit:lab`). */
interface EditValue<T> {
  version: number;
  parts: T;
}

/** Clé de l'état d'édition du Labo. */
export const LAB_EDIT_KEY = "edit:lab";

/** Garde l'état d'édition à la sortie : un puzzle (nom du LEV) ou le Labo, sur un stockage préfixé `tim3:`. */
export class EditStore {
  constructor(private readonly storage: HostStorage) {}

  private read<T>(key: string, parse: (value: unknown, version: number) => T | null): T | null {
    const text = this.storage.get(key);
    if (text === null) return null;
    try {
      const value: unknown = JSON.parse(text);
      // Version 1 : l'aire d'un puzzle n'a pas changé ; celle du Labo se lit sans puzzle maison.
      if (isRecord(value) && READABLE_VERSIONS.has(value.version)) return parse(value.parts, value.version as number);
    } catch {
      // JSON cassé : comme s'il n'y avait rien
    }
    return null;
  }

  private write<T>(key: string, parts: T): boolean {
    return this.storage.set(key, JSON.stringify({ version: SAVE_VERSION, parts } satisfies EditValue<T>));
  }

  private static puzzleKey(name: string): string | null {
    return puzzleList().some((p) => p.name === name) ? `edit:${name}` : null;
  }

  /** L'aire gardée du puzzle `name`, ou `null`. */
  puzzle(name: string): PartsSnapshot | null {
    const key = EditStore.puzzleKey(name);
    return key ? this.read(key, parsePartsSnapshot) : null;
  }

  savePuzzle(name: string, parts: PartsSnapshot): boolean {
    const key = EditStore.puzzleKey(name);
    return key !== null && this.write(key, parts);
  }

  clearPuzzle(name: string): void {
    const key = EditStore.puzzleKey(name);
    if (key) this.storage.remove(key);
  }

  /** Le Labo gardé, ou `null`. */
  lab(): LabMachine | null {
    return this.read(LAB_EDIT_KEY, parseLabMachine);
  }

  saveLab(machine: LabMachine): boolean {
    return this.write(LAB_EDIT_KEY, machine);
  }

  clearLab(): void {
    this.storage.remove(LAB_EDIT_KEY);
  }
}

/** Réglages du Labo d'une machine gardée, sinon ceux par défaut. */
export function labSettingsOf(machine: LabMachine | null): LabSettings {
  return machine ? machineSettings(machine) : { ...DEFAULT_LAB };
}
