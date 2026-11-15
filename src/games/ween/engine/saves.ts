/**
 * Sauvegardes de Ween : port de SaveLoad_v2 de ScummVM (`engines/gob/save/saveload_v2.cpp`, `savehandler.cpp`,
 * `savefile.cpp` : GameHandler, TempSpriteHandler, NotesHandler ; GPL v3+) sur le stockage du navigateur
 * (clés préfixées par `ween:`), à la façon de Lost in Time. Les fichiers `<cible>.sNN` et `.blo` de ScummVM sont
 * remplacés par des clés d'un stockage clé / valeur, en JSON versionné (octets en base64).
 *
 * Fichiers vus par le script :
 *   cat.inf (alias cat.cat)  index de 15 descriptions de 40 octets (offset 0, 600 octets), puis 15 emplacements
 *                            de la taille de toutes les variables (offset 600 + emplacement × taille)
 *   save.inf                 sprite temporaire (en mémoire seulement, comme ScummVM ; vu absent tant qu'aucun
 *                            sprite n'a été écrit)
 *   bloc.inf                 bloc-notes de 600 octets (persistant)
 * Tout le reste est un fichier du jeu.
 *
 * Clés : `cat.sNN` (emplacement NN), `bloc` (bloc-notes). Format : `{"v":1,…}` ; une version inconnue, un JSON
 * invalide ou une taille inattendue valent « fichier absent » (jamais d'exception). Stockage indisponible
 * (navigation privée, quota) : les lectures voient « absent », les écritures échouent (`false`).
 */
import { MemoryStorage, prefixedStorage, type HostStorage } from "../../../engine/storage";
import type { GameSaveSystem } from "../../../engine/coktel/definition";
import type { GraphicsSystems } from "../../../engine/coktel/graphics";
import type { VmContext } from "../../../engine/coktel/host";
import type { Variables } from "../../../engine/coktel/variables";
import { localStorageStore } from "../../../ui/local-storage";

/** SaveLoad_v2 : 15 emplacements, descriptions de 40 octets (`saveload.h`). */
export const SLOT_COUNT = 15;
export const SLOT_NAME_LENGTH = 40;
export const INDEX_SIZE = SLOT_COUNT * SLOT_NAME_LENGTH;
/** NotesHandler(600) : bloc-notes. */
export const NOTES_SIZE = 600;
/** Version du format de stockage (`v` des valeurs JSON). */
export const SAVE_FORMAT_VERSION = 1;
/** Préfixe des clés du jeu dans `localStorage`. */
export const WEEN_STORAGE_PREFIX = "ween:";

const SPRITE_COUNT = 100;
const PALETTE_BYTES = 768;

/** Stockage durable de Ween : `localStorage` (qui peut être absent ou bloqué), clés préfixées par `ween:`. */
export function weenStorage(): HostStorage {
  return prefixedStorage(localStorageStore(), WEEN_STORAGE_PREFIX);
}

/** Clé de stockage d'un emplacement de sauvegarde. */
export function slotKey(slot: number): string {
  return `cat.s${String(slot).padStart(2, "0")}`;
}

/** Clé du bloc-notes. */
export const NOTES_KEY = "bloc";

/** Ce que le sprite temporaire lit et écrit dans l'affichage (sous-ensemble de GraphicsSystems). */
export type SaveGraphics = {
  core: Pick<GraphicsSystems["core"], "wanted" | "setFullPalette" | "touch">;
  draw: { readonly sprites: ArrayLike<{ width: number; height: number; pixels: Uint8Array } | null>; forceBlit(): void };
};

type Handler = "game" | "notes" | "sprite";

/** `_saveFiles` de SaveLoad_v2 (comparaison sans casse, chemin retiré). */
const SAVE_FILES: Record<string, Handler> = {
  "cat.inf": "game",
  "cat.cat": "game",
  "save.inf": "sprite",
  "bloc.inf": "notes",
};

function handlerOf(file: string): Handler | null {
  const base = file.replace(/^.*[\\/:]/, "").toLowerCase();
  return SAVE_FILES[base] ?? null;
}

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

/** Emplacement : description (40 octets), taille des variables à l'écriture (SavePartInfo::_varCount) et variables. */
interface SlotFile {
  varSize: number;
  desc: Uint8Array;
  vars: Uint8Array;
}

interface SlotJson {
  v: number;
  varSize: number;
  desc: string;
  vars: string;
}

/** Sprite temporaire (SavePartSprite) : image 8 bits et palette (768 octets, 6 bits par composante). */
interface SpritePart {
  width: number;
  height: number;
  pixels: Uint8Array;
  palette: Uint8Array;
}

/** Sauvegardes de Ween (SaveLoad_v2) sur un stockage clé / valeur. */
export class WeenSaves implements GameSaveSystem {
  private vm: VmContext | null = null;
  /** Index des descriptions tel que le script l'a écrit (`_index`), en attente de l'écriture d'un emplacement. */
  private readonly index = new Uint8Array(INDEX_SIZE);
  private hasIndex = false;
  private tempSprite: SpritePart | null = null;

  /** Sans `gfx`, `save.inf` reste vu absent ; sans `store`, tout reste en mémoire le temps de la partie. */
  constructor(
    private readonly gfx: SaveGraphics | null = null,
    private readonly store: HostStorage = new MemoryStorage(),
  ) {}

  attach(vm: VmContext): void {
    this.vm = vm;
  }

  /** Variables courantes (null avant leur allocation). */
  private get vars(): Variables | null {
    try {
      return this.vm?.vars ?? null;
    } catch {
      return null;
    }
  }

  /** SaveHandler::getVarSize : taille des variables courantes (0 sans variables). */
  private varSize(): number {
    return this.vars?.size ?? 0;
  }

  // --- SaveSystem ---

  getSaveMode(file: string): "none" | "save" | "exists" | "ignore" {
    return handlerOf(file) ? "save" : "none";
  }

  getSize(file: string): number {
    switch (handlerOf(file)) {
      case "game": {
        // SlotFileIndexed::tallyUpFiles : (dernier emplacement rempli + 1) × taille + index, -1 sans emplacement
        const varSize = this.varSize();
        if (varSize === 0) return -1;
        for (let i = SLOT_COUNT - 1; i >= 0; i--) if (this.slotExists(i)) return (i + 1) * varSize + INDEX_SIZE;
        return -1;
      }
      case "notes":
        return this.readNotes() ? NOTES_SIZE : -1;
      case "sprite":
        // SavePartSprite : en-tête de taille (4 + 4 + 1 + pixels + palette)
        return this.tempSprite ? 4 + 4 + 1 + this.tempSprite.pixels.length + PALETTE_BYTES : -1;
      default:
        return -1;
    }
  }

  load(file: string, dataVar: number, size: number, offset: number): boolean {
    switch (handlerOf(file)) {
      case "game":
        return this.gameLoad(dataVar, size, offset);
      case "notes":
        return this.notesLoad(dataVar, size, offset);
      case "sprite":
        return this.spriteLoad(size);
      default:
        return false;
    }
  }

  save(file: string, dataVar: number, size: number, offset: number): boolean {
    switch (handlerOf(file)) {
      case "game":
        return this.gameSave(dataVar, size, offset);
      case "notes":
        return this.notesSave(dataVar, size, offset);
      case "sprite":
        return this.spriteSave(size);
      default:
        return false;
    }
  }

  // --- Stockage ---

  /** Valeur JSON versionnée d'une clé ; null si absente, illisible ou d'une version inconnue. */
  private readJson(key: string): Record<string, unknown> | null {
    try {
      const text = this.store.get(key);
      if (text === null) return null;
      const json: unknown = JSON.parse(text);
      if (typeof json !== "object" || json === null) return null;
      const record = json as Record<string, unknown>;
      return record.v === SAVE_FORMAT_VERSION ? record : null;
    } catch {
      return null;
    }
  }

  private writeJson(key: string, value: object): boolean {
    try {
      return this.store.set(key, JSON.stringify({ v: SAVE_FORMAT_VERSION, ...value }));
    } catch {
      return false;
    }
  }

  private readSlot(slot: number): SlotFile | null {
    if (!(slot >= 0 && slot < SLOT_COUNT)) return null;
    const json = this.readJson(slotKey(slot)) as Partial<SlotJson> | null;
    if (!json || typeof json.varSize !== "number" || typeof json.desc !== "string" || typeof json.vars !== "string") {
      return null;
    }
    try {
      const desc = fromBase64(json.desc);
      const vars = fromBase64(json.vars);
      if (desc.length !== SLOT_NAME_LENGTH || vars.length !== json.varSize) return null;
      return { varSize: json.varSize, desc, vars };
    } catch {
      return null;
    }
  }

  private slotExists(slot: number): boolean {
    return this.readSlot(slot) !== null;
  }

  private writeSlot(slot: number, file: SlotFile): boolean {
    const json: Omit<SlotJson, "v"> = {
      varSize: file.varSize,
      desc: toBase64(file.desc),
      vars: toBase64(file.vars),
    };
    return this.writeJson(slotKey(slot), json);
  }

  // --- cat.inf (GameHandler) ---

  /** Numéro d'emplacement et reste d'un décalage (`getSlot` / `getSlotRemainder`, divisions entières de C). */
  private slotAt(offset: number, varSize: number): { slot: number; rem: number } {
    const rel = offset - INDEX_SIZE;
    return { slot: Math.trunc(rel / varSize), rem: rel % varSize };
  }

  /** SlotFileIndexed::buildIndex : description des emplacements lisibles avec la taille de variables courante, zéros ailleurs. */
  private buildIndex(varSize: number): Uint8Array {
    const out = new Uint8Array(INDEX_SIZE);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = this.readSlot(i);
      // SavePartInfo::read échoue si le nombre de variables diffère : entrée de zéros
      if (slot && slot.varSize === varSize) out.set(slot.desc, i * SLOT_NAME_LENGTH);
    }
    return out;
  }

  private gameLoad(dataVar: number, size: number, offset: number): boolean {
    const vars = this.vars;
    const varSize = vars?.size ?? 0;
    if (!vars || varSize === 0) return false;
    if (size === 0) {
      // Tout charger
      dataVar = 0;
      size = varSize;
    }
    if (offset === 0) {
      if (size !== INDEX_SIZE) return false;
      return vars.copyFrom(dataVar, this.buildIndex(varSize));
    }
    const { slot, rem } = this.slotAt(offset, varSize);
    if (slot < 0 || slot >= SLOT_COUNT || rem !== 0 || dataVar !== 0 || size !== varSize) return false;
    const file = this.readSlot(slot);
    if (!file || file.varSize !== varSize) return false;
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
    if (offset === 0) {
      if (size !== INDEX_SIZE) return false;
      const index = vars.copyTo(dataVar, INDEX_SIZE);
      if (!index) return false;
      this.index.set(index);
      this.hasIndex = true;
      return true;
    }
    const { slot, rem } = this.slotAt(offset, varSize);
    if (slot < 0 || slot >= SLOT_COUNT || rem !== 0 || dataVar !== 0 || size !== varSize) return false;
    // La description de l'emplacement vient de l'index écrit juste avant
    if (!this.hasIndex) return false;
    this.hasIndex = false;
    const all = vars.copyTo(0, varSize);
    if (!all) return false;
    const desc = this.index.slice(slot * SLOT_NAME_LENGTH, (slot + 1) * SLOT_NAME_LENGTH);
    return this.writeSlot(slot, { varSize, desc, vars: all });
  }

  // --- bloc.inf (NotesHandler) ---

  private readNotes(): Uint8Array | null {
    const json = this.readJson(NOTES_KEY);
    if (!json || typeof json.data !== "string") return null;
    try {
      const data = fromBase64(json.data);
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
    // ScummVM : SavePartVars(600) neuve à chaque écriture, réécrite en entier ; seul le segment demandé est
    // renseigné (le reste n'est pas initialisé dans ScummVM : ici des zéros).
    const notes = new Uint8Array(NOTES_SIZE);
    notes.set(data, offset);
    return this.writeJson(NOTES_KEY, { data: toBase64(notes) });
  }

  // --- save.inf (TempSpriteHandler) ---

  /** Index de sprite codé dans une « taille » négative (-1 - index) ; en dessous de -1000 : avec la palette. */
  private static spriteIndex(size: number): number {
    if (size < -3000) size += 3000;
    if (size < -1000) size += 1000;
    return -size - 1;
  }

  private spriteAt(size: number) {
    if (size >= 0 || !this.gfx) return null;
    const index = WeenSaves.spriteIndex(size);
    if (index < 0 || index >= SPRITE_COUNT) return null;
    return this.gfx.draw.sprites[index] ?? null;
  }

  private spriteLoad(size: number): boolean {
    if (size === 0) return true; // taille nulle : ni sprite, ni erreur
    const sprite = this.tempSprite;
    if (!sprite) return false;
    const target = this.spriteAt(size);
    if (!target || target.width * target.height !== sprite.width * sprite.height) return false;
    // writeSprite, puis writePalette et setFullPalette si la taille l'indique
    target.pixels.set(sprite.pixels.subarray(0, target.pixels.length));
    if (size < -1000) {
      this.gfx!.core.wanted.set(sprite.palette.subarray(0, PALETTE_BYTES));
      this.gfx!.core.setFullPalette();
    }
    const index = WeenSaves.spriteIndex(size);
    if (index === 21) this.gfx!.draw.forceBlit();
    else if (index === 20) this.gfx!.core.touch();
    return true;
  }

  private spriteSave(size: number): boolean {
    if (size === 0) return true;
    const sprite = this.spriteAt(size);
    if (!sprite) return false;
    this.tempSprite = {
      width: sprite.width,
      height: sprite.height,
      pixels: sprite.pixels.slice(),
      palette: size < -1000 ? this.gfx!.core.wanted.slice(0, PALETTE_BYTES) : new Uint8Array(PALETTE_BYTES),
    };
    return true;
  }
}
