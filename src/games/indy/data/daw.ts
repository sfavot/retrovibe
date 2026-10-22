import { BinaryReader } from "../../../data/reader";
import {
  type Action,
  type Character,
  type GameData,
  type Hotspot,
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

/** Itère sur des entrées indexées terminées par l'index -1. */
function forEachIndexed(r: BinaryReader, fn: (index: number) => void): void {
  for (;;) {
    const index = r.i16();
    if (index === -1) return;
    fn(index);
  }
}

/** Analyse le fichier de données d'« Indiana Jones and his Desktop Adventures ». */
export function parseDaw(buffer: ArrayBuffer | Uint8Array): GameData {
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
        r.u32();
        const count = r.u16();
        for (let id = 0; id < count; id++) {
          expectTag(r, "IZON");
          r.u32(); // taille totale de l'enregistrement (marqueur et taille compris), toujours 16 + largeur × hauteur × 6
          const width = r.u16();
          const height = r.u16();
          const type = r.u32();
          const tiles = r.i16Array(width * height * LAYERS);
          data.zones.push({
            id,
            name: "",
            width,
            height,
            type,
            tiles,
            hotspots: [],
            monsters: [],
            requiredItems: [],
            providedItems: [],
            npcs: [],
            actions: [],
            flag: 0,
          });
        }
        break;
      }
      case "ZAUX":
        r.u32();
        for (const z of data.zones) {
          expectTag(r, "IZAX");
          r.u32();
          z.flag = r.u16();
          const monsterCount = r.u16();
          for (let i = 0; i < monsterCount; i++) z.monsters.push({ character: r.u16(), x: r.u16(), y: r.u16() });
          z.requiredItems = Array.from(r.i16Array(r.u16()));
        }
        break;
      case "ZAX2":
        r.u32();
        for (const z of data.zones) {
          expectTag(r, "IZX2");
          r.u32();
          z.providedItems = Array.from(r.i16Array(r.u16()));
        }
        break;
      case "ZAX3":
        r.u32();
        for (const z of data.zones) {
          expectTag(r, "IZX3");
          r.u32();
          z.npcs = Array.from(r.i16Array(r.u16()));
        }
        break;
      case "ZAX4":
        r.u32();
        for (let i = 0; i < data.zones.length; i++) {
          expectTag(r, "IZX4");
          r.u32();
          r.u16(); // toujours 1 pour les 366 zones : aucune information
        }
        break;
      case "HTSP":
        r.u32();
        forEachIndexed(r, (zoneId) => {
          const count = r.u16();
          const hotspots: Hotspot[] = [];
          for (let i = 0; i < count; i++) {
            const type = r.u32();
            const x = r.i16();
            const y = r.i16();
            const enabled = r.u16() !== 0;
            const argument = r.i16();
            hotspots.push({ type, x, y, enabled, argument });
          }
          zone(zoneId).hotspots = hotspots;
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
          const unknown = r.u16();
          const texts = Array.from({ length: 5 }, () => r.string(r.u16()));
          const item = r.u16();
          r.offset = end;
          const puzzle: Puzzle = { id, name: "", type, itemClass, unknown, texts, item };
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
          const name = r.fixedString(16);
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
      case "ENDF":
        r.u32();
        return data;
      default:
        throw new DawFormatError(`Catégorie inconnue « ${category} » à 0x${(r.offset - 4).toString(16)}`);
    }
  }
}
