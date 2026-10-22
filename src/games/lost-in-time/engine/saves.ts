import type { SaveSystem, VmContext } from "./host";
import type { GraphicsSystems } from "./graphics";
import type { Variables } from "./variables";

/**
 * Sauvegardes de Lost in Time : port de gob/save/saveload_v3.cpp (SaveLoad_v3, Gob3 / Lost in Time),
 * savehandler.cpp (sprite temporaire, notes) et de la partie « tranches de sauvegarde » de savefile.cpp.
 * Les fichiers de ScummVM (`<cible>.s00`…, `.blo`) sont remplacés par des clés d'un stockage clé / valeur.
 *
 * Fichiers vus par le script :
 *   cat.inf    sauvegardes : propriétés globales (0..499), index des 30 descriptions (500..1699), puis 30 blocs de variables
 *   ima.inf    captures d'écran des sauvegardes : index (50 octets) puis une capture par emplacement (4768 octets)
 *   intro.$$$  sprite temporaire (en mémoire seulement)
 *   bloc.inf   notes (2560 octets)
 *   prot, config  ignorés
 * Tout le reste (INTRO.STK, *.ITK, *.LTK, CAT2-4.INF…) est un fichier du jeu, en lecture seule.
 */

// --- Stockage ----------------------------------------------------------------------------------

export interface KeyValueStore {
  get(key: string): string | null;
  /** Faux si l'écriture a échoué (stockage plein ou bloqué). */
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): boolean {
    this.data.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}

/** `localStorage`, qui peut être absent ou bloqué : on échoue sans bruit. */
export class LocalStorageStore implements KeyValueStore {
  constructor(private readonly prefix = "lost-in-time:") {}

  get(key: string): string | null {
    try {
      return localStorage.getItem(this.prefix + key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(this.prefix + key, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      // ignoré
    }
  }
}

/** Clé de stockage d'un emplacement de sauvegarde. */
export function slotKey(slot: number): string {
  return `cat.s${String(slot).padStart(2, "0")}`;
}

// --- Constantes (SaveLoad_v3) ---------------------------------------------------------------

export const SLOT_COUNT = 30;
export const SLOT_NAME_LENGTH = 40;
export const PROPS_SIZE = 500;
export const INDEX_SIZE = SLOT_COUNT * SLOT_NAME_LENGTH;
/** kScreenshotTypeLost */
export const SHOT_SIZE = 4768;
export const SHOT_INDEX_SIZE = 50;
export const NOTES_SIZE = 2560;
const SPRITE_COUNT = 100;
const PALETTE_BYTES = 768;

type SaveFileKind = "game" | "screenshot" | "sprite" | "notes";

const SAVE_FILES: Record<string, SaveFileKind | "ignore"> = {
  "cat.inf": "game",
  "ima.inf": "screenshot",
  "intro.$$$": "sprite",
  "bloc.inf": "notes",
  prot: "ignore",
  config: "ignore",
};

/** SaveLoad::stripPath puis recherche insensible à la casse. */
function lookup(file: string): SaveFileKind | "ignore" | null {
  const name = file.slice(Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/")) + 1).toLowerCase();
  return SAVE_FILES[name] ?? null;
}

// --- Sprite (SavePartSprite) ----------------------------------------------------------------

/** Image 8 bits indexée et sa palette (768 octets, 6 bits par composante). */
interface SpritePart {
  width: number;
  height: number;
  pixels: Uint8Array;
  palette: Uint8Array;
}

/** Ce que les sauvegardes lisent et écrivent dans l'affichage (sous-ensemble de GraphicsSystems). */
export type SaveGraphics = {
  core: Pick<GraphicsSystems["core"], "wanted" | "setFullPalette" | "touch">;
  draw: { readonly sprites: ArrayLike<{ width: number; height: number; pixels: Uint8Array } | null>; forceBlit(): void };
};

// --- Encodage (le stockage ne contient que du texte) --------------------------------------

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Fichier d'un emplacement : ses trois parties (info, variables, capture). */
interface SlotFile {
  /** Nombre de variables au moment de l'écriture (SavePartInfo::_varCount). */
  varSize: number;
  desc: Uint8Array;
  vars: Uint8Array;
  shot: SpritePart;
}

interface SlotJson {
  varSize: number;
  desc: string;
  vars: string;
  shot: { width: number; height: number; pixels: string; palette: string };
}

/** Parties d'un emplacement en cours d'écriture : le fichier n'existe qu'une fois les trois écrites (SaveWriter). */
interface PendingWriter {
  slot: number;
  info?: { desc: Uint8Array; varSize: number };
  vars?: Uint8Array;
  shot?: SpritePart;
}

/** Vrai si au moins un emplacement est sauvegardé. Une erreur de lecture vaut « aucune sauvegarde ». */
export function hasSavedGame(store: KeyValueStore = new LocalStorageStore()): boolean {
  try {
    for (let i = 0; i < SLOT_COUNT; i++) if (store.get(slotKey(i)) !== null) return true;
  } catch {
    // ignoré
  }
  return false;
}

export class GameSaves implements SaveSystem {
  private vm: VmContext | null = null;
  private readonly props = new Uint8Array(PROPS_SIZE);
  /** Index des descriptions tel que le script l'a écrit (en attente de la sauvegarde d'un emplacement). */
  private readonly index = new Uint8Array(INDEX_SIZE);
  private hasIndex = false;
  private firstSize = true;
  private writer: PendingWriter | null = null;
  /** Index des captures (80 octets alloués, 50 utilisés pour Lost in Time). */
  private readonly shotIndex = new Uint8Array(80);
  private tempSprite: SpritePart | null = null;

  constructor(
    private readonly gfx: SaveGraphics,
    private readonly store: KeyValueStore,
  ) {}

  attach(vm: VmContext): void {
    this.vm = vm;
  }

  // --- SaveSystem ---

  getSaveMode(file: string): "none" | "save" | "exists" | "ignore" {
    const kind = lookup(file);
    return kind === null ? "none" : kind === "ignore" ? "ignore" : "save";
  }

  getSize(file: string): number {
    switch (lookup(file)) {
      case "game":
        return this.gameSize();
      case "screenshot":
        return this.tally(SHOT_SIZE, SHOT_INDEX_SIZE);
      case "sprite":
        return this.tempSprite ? 4 + 4 + 1 + this.tempSprite.pixels.length + PALETTE_BYTES : -1;
      case "notes":
        return this.readNotes() ? NOTES_SIZE : -1;
      default:
        return -1;
    }
  }

  load(file: string, varOffset: number, size: number, offset: number): boolean {
    switch (lookup(file)) {
      case "game":
        return this.gameLoad(varOffset, size, offset);
      case "screenshot":
        return this.shotLoad(varOffset, size, offset);
      case "sprite":
        return this.spriteLoad(size);
      case "notes":
        return this.notesLoad(varOffset, size, offset);
      default:
        return false;
    }
  }

  save(file: string, varOffset: number, size: number, offset: number): boolean {
    switch (lookup(file)) {
      case "game":
        return this.gameSave(varOffset, size, offset);
      case "screenshot":
        return this.shotSave(varOffset, size, offset);
      case "sprite":
        return this.spriteSave(size);
      case "notes":
        return this.notesSave(varOffset, size, offset);
      default:
        return false;
    }
  }

  // --- Accès aux variables ---

  private get vars(): Variables | null {
    try {
      return this.vm?.vars ?? null;
    } catch {
      return null; // variables non allouées
    }
  }

  // --- Fichiers d'emplacements ---

  private readSlot(slot: number): SlotFile | null {
    if (!(slot >= 0 && slot < SLOT_COUNT)) return null;
    const text = this.store.get(slotKey(slot));
    if (text === null) return null;
    try {
      const json = JSON.parse(text) as SlotJson;
      return {
        varSize: json.varSize,
        desc: fromBase64(json.desc),
        vars: fromBase64(json.vars),
        shot: {
          width: json.shot.width,
          height: json.shot.height,
          pixels: fromBase64(json.shot.pixels),
          palette: fromBase64(json.shot.palette),
        },
      };
    } catch {
      return null;
    }
  }

  private writeSlot(slot: number, file: SlotFile): boolean {
    const json: SlotJson = {
      varSize: file.varSize,
      desc: toBase64(file.desc),
      vars: toBase64(file.vars),
      shot: {
        width: file.shot.width,
        height: file.shot.height,
        pixels: toBase64(file.shot.pixels),
        palette: toBase64(file.shot.palette),
      },
    };
    return this.store.set(slotKey(slot), JSON.stringify(json));
  }

  private slotExists(slot: number): boolean {
    return this.store.get(slotKey(slot)) !== null;
  }

  /** SlotFileIndexed::tallyUpFiles : taille calculée sur le dernier emplacement rempli ; -1 s'il n'y en a aucun. */
  private tally(slotSize: number, indexSize: number): number {
    for (let i = SLOT_COUNT - 1; i >= 0; i--) if (this.slotExists(i)) return (i + 1) * slotSize + indexSize;
    return -1;
  }

  /** SaveWriter : accumule les parties d'un emplacement ; un autre emplacement abandonne celui en cours. */
  private writePart(slot: number, part: Partial<Omit<PendingWriter, "slot">>): boolean {
    if (this.writer?.slot !== slot) this.writer = { slot };
    Object.assign(this.writer, part);
    const w = this.writer;
    if (!(w.info && w.vars && w.shot)) return true;
    this.writer = { slot };
    return this.writeSlot(slot, { varSize: w.info.varSize, desc: w.info.desc, vars: w.vars, shot: w.shot });
  }

  // --- cat.inf (GameHandler) ---

  private gameSize(): number {
    // Un faux fichier vide pour la toute première question, afin d'avoir des propriétés vierges.
    if (this.firstSize) {
      this.firstSize = false;
      return -1;
    }
    const varSize = this.vars?.size ?? 0;
    if (varSize === 0) return -1;
    return this.tally(varSize, PROPS_SIZE + INDEX_SIZE);
  }

  /** Numéro d'emplacement et reste pour un décalage de cat.inf ; null si le décalage n'est pas un bloc de variables. */
  private slotAt(offset: number, varSize: number): { slot: number; rem: number } | null {
    const rel = offset - (PROPS_SIZE + INDEX_SIZE);
    if (rel < 0) return null;
    return { slot: Math.trunc(rel / varSize), rem: rel % varSize };
  }

  private buildIndex(): Uint8Array {
    const out = new Uint8Array(INDEX_SIZE);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = this.readSlot(i);
      if (slot) out.set(slot.desc.subarray(0, SLOT_NAME_LENGTH), i * SLOT_NAME_LENGTH);
    }
    return out;
  }

  private gameLoad(dataVar: number, size: number, offset: number): boolean {
    const vars = this.vars;
    const varSize = vars?.size ?? 0;
    if (!vars || varSize === 0) return false;
    if (size === 0) {
      // tout charger
      dataVar = 0;
      size = varSize;
    }
    if (offset >= 0 && offset < PROPS_SIZE) {
      // propriétés globales (joker utilisé…)
      if (size < 0 || offset + size > PROPS_SIZE) return false;
      return vars.copyFrom(dataVar, this.props.subarray(offset, offset + size));
    }
    if (offset === PROPS_SIZE) {
      // index des sauvegardes, reconstruit à chaque fois
      if (size !== INDEX_SIZE) return false;
      return vars.copyFrom(dataVar, this.buildIndex());
    }
    const at = this.slotAt(offset, varSize);
    if (!at || at.slot >= SLOT_COUNT || at.rem !== 0 || dataVar !== 0 || size !== varSize) return false;
    this.hasIndex = false;
    const file = this.readSlot(at.slot);
    if (!file || file.varSize !== varSize || file.vars.length !== varSize) return false;
    return vars.copyFrom(0, file.vars);
  }

  private gameSave(dataVar: number, size: number, offset: number): boolean {
    const vars = this.vars;
    const varSize = vars?.size ?? 0;
    if (!vars || varSize === 0) return false;
    if (size === 0) {
      dataVar = 0;
      size = varSize;
    }
    if (offset >= 0 && offset < PROPS_SIZE) {
      if (size < 0 || offset + size > PROPS_SIZE) return false;
      const data = vars.copyTo(dataVar, size);
      if (!data) return false;
      this.props.set(data, offset);
      return true;
    }
    if (offset === PROPS_SIZE) {
      if (size !== INDEX_SIZE) return false;
      const data = vars.copyTo(dataVar, INDEX_SIZE);
      if (!data) return false;
      this.index.set(data);
      this.hasIndex = true;
      return true;
    }
    const at = this.slotAt(offset, varSize);
    if (!at || at.slot >= SLOT_COUNT || at.rem !== 0 || dataVar !== 0 || size !== varSize) return false;
    // La description de l'emplacement vient de l'index écrit juste avant.
    if (!this.hasIndex) return false;
    this.hasIndex = false;
    const data = vars.copyTo(0, varSize);
    if (!data) return false;
    const desc = this.index.slice(at.slot * SLOT_NAME_LENGTH, (at.slot + 1) * SLOT_NAME_LENGTH);
    return this.writePart(at.slot, { info: { desc, varSize }, vars: data });
  }

  // --- ima.inf (ScreenshotHandler) ---

  private shotLoad(dataVar: number, size: number, offset: number): boolean {
    const vars = this.vars;
    if (!vars) return false;
    if (offset < SHOT_INDEX_SIZE) {
      // index des captures : un octet par emplacement existant
      if (offset < 0 || size < 0 || size + offset > SHOT_INDEX_SIZE) return false;
      for (let i = 0; i < SLOT_COUNT; i++) this.shotIndex[i] = this.slotExists(i) ? 1 : 0;
      this.shotIndex[SLOT_COUNT] = 0;
      return vars.copyFrom(dataVar, this.shotIndex.subarray(offset, offset + size));
    }
    const rel = offset - SHOT_INDEX_SIZE;
    const slot = Math.trunc(rel / SHOT_SIZE);
    if (slot >= SLOT_COUNT || rel % SHOT_SIZE !== 0) return false;
    const target = this.spriteAt(size);
    if (!target) return false;
    const shot = this.readSlot(slot)?.shot;
    // les dimensions doivent concorder (SavePartSprite::read)
    if (!shot || shot.width * shot.height !== target.width * target.height) return false;
    return this.restoreSprite(shot, size);
  }

  private shotSave(dataVar: number, size: number, offset: number): boolean {
    const vars = this.vars;
    if (!vars) return false;
    if (offset < SHOT_INDEX_SIZE) {
      if (offset < 0 || size < 0 || size + offset > SHOT_INDEX_SIZE) return false;
      const data = vars.copyTo(dataVar, size);
      if (!data) return false;
      this.shotIndex.set(data, offset);
      return true;
    }
    const part = this.captureSprite(size);
    if (!part) return false;
    const rel = offset - SHOT_INDEX_SIZE;
    const slot = Math.trunc(rel / SHOT_SIZE);
    if (slot >= SLOT_COUNT || rel % SHOT_SIZE !== 0) return false;
    return this.writePart(slot, { shot: part });
  }

  // --- intro.$$$ (TempSpriteHandler) ---

  private spriteLoad(size: number): boolean {
    if (size === 0) return true;
    const sprite = this.tempSprite;
    if (!sprite) return false;
    const target = this.spriteAt(size);
    if (!target || target.width * target.height !== sprite.width * sprite.height) return false;
    return this.restoreSprite(sprite, size);
  }

  private spriteSave(size: number): boolean {
    if (size === 0) return true;
    const part = this.captureSprite(size);
    if (!part) return false;
    this.tempSprite = part;
    return true;
  }

  /** Index de sprite codé dans une « taille » négative (-1 - index) ; -1000 : avec la palette, -3000 en plus. */
  private static spriteIndex(size: number): number {
    if (size < -3000) size += 3000;
    if (size < -1000) size += 1000;
    return -size - 1;
  }

  private spriteAt(size: number) {
    if (size >= 0) return null;
    const index = GameSaves.spriteIndex(size);
    if (index < 0 || index >= SPRITE_COUNT) return null;
    return this.gfx.draw.sprites[index] ?? null;
  }

  /** TempSpriteHandler::createSprite + readSprite (+ readPalette) : copie le sprite désigné. */
  private captureSprite(size: number): SpritePart | null {
    const sprite = this.spriteAt(size);
    if (!sprite) return null;
    return {
      width: sprite.width,
      height: sprite.height,
      pixels: sprite.pixels.slice(),
      palette: size < -1000 ? this.gfx.core.wanted.slice(0, PALETTE_BYTES) : new Uint8Array(PALETTE_BYTES),
    };
  }

  /** writeSprite (+ writePalette), puis réaffichage : le sprite 21 est recopié à l'écran, le 20 est l'écran. */
  private restoreSprite(part: SpritePart, size: number): boolean {
    const target = this.spriteAt(size)!;
    target.pixels.set(part.pixels.subarray(0, target.pixels.length));
    if (size < -1000) {
      this.gfx.core.wanted.set(part.palette.subarray(0, PALETTE_BYTES));
      this.gfx.core.setFullPalette();
    }
    const index = GameSaves.spriteIndex(size);
    if (index === 21) this.gfx.draw.forceBlit();
    else if (index === 20) this.gfx.core.touch();
    return true;
  }

  // --- bloc.inf (NotesHandler) ---

  private readNotes(): Uint8Array | null {
    const text = this.store.get("bloc");
    if (text === null) return null;
    try {
      const data = fromBase64(text);
      return data.length === NOTES_SIZE ? data : null;
    } catch {
      return null;
    }
  }

  private notesLoad(dataVar: number, size: number, offset: number): boolean {
    if (dataVar < 0 || size < 0 || offset < 0) return false;
    const vars = this.vars;
    const notes = this.readNotes();
    if (!vars || !notes || offset + size > NOTES_SIZE) return false;
    return vars.copyFrom(dataVar, notes.subarray(offset, offset + size));
  }

  private notesSave(dataVar: number, size: number, offset: number): boolean {
    if (dataVar < 0 || size < 0 || offset < 0) return false;
    const vars = this.vars;
    if (!vars || offset + size > NOTES_SIZE) return false;
    const data = vars.copyTo(dataVar, size);
    if (!data) return false;
    // ScummVM réécrit tout le fichier avec le seul segment demandé ; ici le reste des notes est conservé.
    const notes = this.readNotes() ?? new Uint8Array(NOTES_SIZE);
    notes.set(data, offset);
    return this.store.set("bloc", toBase64(notes));
  }
}
