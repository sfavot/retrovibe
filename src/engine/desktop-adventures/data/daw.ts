import { BinaryReader } from "../../../data/reader";
import {
  type Action,
  type Character,
  type DawVariant,
  type GameData,
  type Hotspot,
  type MonsterPlacement,
  type Puzzle,
  type ScriptItem,
  type Tile,
  type Zone,
  LAYERS,
  TILE_PIXELS,
} from "./types";

export class DawFormatError extends Error {}

function expectTag(r: BinaryReader, tag: string): void {
  const found = r.tag();
  if (found !== tag) throw new DawFormatError(`Marqueur ${tag} attendu, ${found} trouvé à 0x${(r.offset - 4).toString(16)}`);
}

function readScriptItem(r: BinaryReader): ScriptItem {
  const opcode = r.u16();
  const args = r.i16Array(5);
  const text = r.string(r.u16());
  return { opcode, args, text };
}

function readAction(r: BinaryReader): Action {
  expectTag(r, "IACT");
  r.u32();
  const conditions = Array.from({ length: r.u16() }, () => readScriptItem(r));
  const instructions = Array.from({ length: r.u16() }, () => readScriptItem(r));
  return { name: "", conditions, instructions };
}

function readHotspots(r: BinaryReader): Hotspot[] {
  return Array.from({ length: r.u16() }, () => {
    const type = r.u32();
    const x = r.i16();
    const y = r.i16();
    const enabled = r.u16() !== 0;
    const argument = r.i16();
    return { type, x, y, enabled, argument };
  });
}

/** Monstre d'une zone. Yoda ajoute l'objet lâché et 4 points de passage (44 octets au lieu de 6). */
function readMonster(r: BinaryReader, variant: DawVariant): MonsterPlacement {
  const character = r.u16();
  const x = r.u16();
  const y = r.u16();
  if (variant === "indy") return { character, x, y, loot: -1, dropsLoot: false, waypoints: new Int32Array(0) };
  const loot = r.i16();
  const dropsLoot = r.u32() !== 0;
  const waypoints = Int32Array.from({ length: 8 }, () => r.i32());
  return { character, x, y, loot, dropsLoot, waypoints };
}

/** Bloc IZAX : drapeau, monstres, objets requis et (Yoda) objets d'objectif. */
function readZoneAux(r: BinaryReader, z: Zone, variant: DawVariant): void {
  expectTag(r, "IZAX");
  r.u32();
  z.flag = r.u16();
  z.monsters = Array.from({ length: r.u16() }, () => readMonster(r, variant));
  z.requiredItems = Array.from(r.i16Array(r.u16()));
  if (variant === "yoda") z.goalItems = Array.from(r.i16Array(r.u16()));
}

function readItemList(r: BinaryReader, tag: string): number[] {
  expectTag(r, tag);
  r.u32();
  return Array.from(r.i16Array(r.u16()));
}

function readZoneAux4(r: BinaryReader): void {
  expectTag(r, "IZX4");
  r.u32();
  r.u16(); // sens inconnu (toujours 1 pour Indy)
}

/**
 * En-tête IZON et tuiles d'une zone. Yoda la précède de la planète, de la taille de l'enregistrement et de l'index,
 * et ajoute après le type un compteur (ignoré) puis la planète à nouveau.
 */
function readZoneHeader(r: BinaryReader, id: number, variant: DawVariant): Zone {
  let planet = 0;
  if (variant === "yoda") {
    planet = r.u16();
    r.u32(); // taille de l'enregistrement
    r.u16(); // index de la zone
  }
  expectTag(r, "IZON");
  r.u32(); // taille de l'enregistrement IZON
  const width = r.u16();
  const height = r.u16();
  const type = r.u32();
  if (variant === "yoda") {
    r.u16(); // compteur partagé, toujours 0xffff
    if (r.u16() !== planet) throw new DawFormatError(`Planète incohérente dans la zone ${id}`);
  }
  const tiles = r.i16Array(width * height * LAYERS);
  return {
    id,
    name: "",
    width,
    height,
    type,
    planet,
    tiles,
    hotspots: [],
    monsters: [],
    requiredItems: [],
    goalItems: [],
    providedItems: [],
    npcs: [],
    actions: [],
    flag: 0,
  };
}

/** Itère sur des entrées indexées terminées par l'index -1. */
function forEachIndexed(r: BinaryReader, fn: (index: number) => void): void {
  for (;;) {
    const index = r.i16();
    if (index === -1) return;
    fn(index);
  }
}

/**
 * Analyse le fichier de données du moteur « Desktop Adventures » : DESKTOP.DAW d'« Indiana Jones and his Desktop
 * Adventures » ou YODESK.DTA de « Yoda Stories ». Indy range les données auxiliaires des zones (objets, scripts,
 * points chauds) dans des sections séparées ; Yoda les place à la suite de chaque zone.
 */
export function parseDaw(buffer: ArrayBuffer | Uint8Array, variant: DawVariant = "indy"): GameData {
  const r = new BinaryReader(buffer);
  const data: GameData = {
    version: 0,
    startupImage: new Uint8Array(0),
    sounds: [],
    tiles: [],
    zones: [],
    puzzles: [],
    characters: [],
  };
  const zone = (id: number): Zone => {
    const z = data.zones[id];
    if (!z) throw new DawFormatError(`Zone ${id} inconnue`);
    return z;
  };

  for (;;) {
    const category = r.tag();
    switch (category) {
      case "VERS":
        data.version = r.u32();
        break;
      case "STUP":
        data.startupImage = r.bytesView(r.u32()).slice();
        break;
      case "SNDS": {
        r.u32();
        const count = -r.i16();
        for (let i = 0; i < count; i++) data.sounds.push(r.fixedString(r.u16()));
        break;
      }
      case "TILE": {
        const count = r.u32() / (TILE_PIXELS + 4);
        for (let id = 0; id < count; id++) {
          const attributes = r.u32();
          data.tiles.push({ id, attributes, pixels: r.bytesView(TILE_PIXELS).slice(), name: "" });
        }
        break;
      }
      case "ZONE": {
        if (variant === "indy") r.u32();
        const count = r.u16();
        for (let id = 0; id < count; id++) {
          const z = readZoneHeader(r, id, variant);
          data.zones.push(z);
          if (variant === "indy") continue;
          z.hotspots = readHotspots(r);
          readZoneAux(r, z, variant);
          z.providedItems = readItemList(r, "IZX2");
          z.npcs = readItemList(r, "IZX3");
          readZoneAux4(r);
          z.actions = Array.from({ length: r.u16() }, () => readAction(r));
        }
        break;
      }
      case "ZAUX":
        r.u32();
        for (const z of data.zones) readZoneAux(r, z, variant);
        break;
      case "ZAX2":
        r.u32();
        for (const z of data.zones) z.providedItems = readItemList(r, "IZX2");
        break;
      case "ZAX3":
        r.u32();
        for (const z of data.zones) z.npcs = readItemList(r, "IZX3");
        break;
      case "ZAX4":
        r.u32();
        for (let i = 0; i < data.zones.length; i++) readZoneAux4(r);
        break;
      case "HTSP":
        r.u32();
        forEachIndexed(r, (zoneId) => {
          zone(zoneId).hotspots = readHotspots(r);
        });
        break;
      case "ACTN":
        r.u32();
        forEachIndexed(r, (zoneId) => {
          const count = r.u16();
          zone(zoneId).actions = Array.from({ length: count }, () => readAction(r));
        });
        break;
      case "PUZ2":
        r.u32();
        forEachIndexed(r, (id) => {
          expectTag(r, "IPUZ");
          const size = r.u32();
          const end = r.offset + size;
          const type = r.i32();
          const itemClass = r.i32();
          if (variant === "yoda") r.i32(); // classe du second objet
          const unknown = r.u16();
          const texts = Array.from({ length: 5 }, () => r.string(r.u16()));
          const item = r.u16();
          const item2 = variant === "yoda" ? r.i16() : -1;
          r.offset = end;
          const puzzle: Puzzle = { id, name: "", type, itemClass, unknown, texts, item, item2 };
          data.puzzles[id] = puzzle;
        });
        break;
      case "CHAR":
        r.u32();
        forEachIndexed(r, (id) => {
          expectTag(r, "ICHA");
          const size = r.u32();
          const end = r.offset + size;
          const name = r.fixedString(16);
          const type = r.i16();
          const movementType = r.i16();
          if (variant === "yoda") r.offset += 6; // 2 champs sans usage connu
          const frames: Character["frames"] = [r.i16Array(8), r.i16Array(8), r.i16Array(8)];
          r.offset = end;
          data.characters[id] = { id, name, type, movementType, frames, reference: -1, health: 0, damage: 0 };
        });
        break;
      case "CHWP":
        r.u32();
        forEachIndexed(r, (id) => {
          const c = data.characters[id];
          c.reference = r.i16();
          c.health = r.i16();
        });
        break;
      case "CAUX":
        r.u32();
        forEachIndexed(r, (id) => {
          data.characters[id].damage = r.i16();
        });
        break;
      case "TNAM":
        r.u32();
        forEachIndexed(r, (id) => {
          const name = r.fixedString(variant === "yoda" ? 24 : 16);
          const tile: Tile | undefined = data.tiles[id];
          if (tile) tile.name = name.trim();
        });
        break;
      case "ZNAM":
        r.u32();
        forEachIndexed(r, (id) => {
          zone(id).name = r.fixedString(16);
        });
        break;
      case "PNAM": {
        r.u32();
        const count = r.i16();
        for (let i = 0; i < count; i++) {
          const name = r.fixedString(16);
          if (data.puzzles[i]) data.puzzles[i].name = name;
        }
        break;
      }
      case "ANAM":
        r.u32();
        forEachIndexed(r, (zoneId) => {
          const actions = zone(zoneId).actions;
          forEachIndexed(r, (actionId) => {
            const name = r.fixedString(16);
            if (actions[actionId]) actions[actionId].name = name;
          });
        });
        break;
      case "TGEN": {
        const size = r.u32();
        r.offset += size; // Yoda : genre grammatical des noms de tuiles, inutile ici
        break;
      }
      case "ENDF":
        r.u32();
        return data;
      default:
        throw new DawFormatError(`Catégorie inconnue « ${category} » à 0x${(r.offset - 4).toString(16)}`);
    }
  }
}
