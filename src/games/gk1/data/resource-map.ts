/**
 * Ressources SCI2 de Gabriel Knight : `RESOURCE.MAP` + `RESOURCE.000`, `ALT.MAP` + `RESOURCE.ALT`, fichiers de patch de
 * `PATCHES/` (`docs/gk1/formats.md` § 2, § 13, § 14).
 *
 * Référence : `engines/sci/resource/resource.cpp` de ScummVM (`readResourceMapSCI1`, `Resource::readResourceInfo`,
 * `processPatch`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * - Map : table `{ u8 type ; u16 offset }` terminée par le type 0xFF (dont l'offset est la fin du fichier), 4 octets
 *   `34 12 00 00` que rien ne lit, puis par type des entrées de 6 octets `u16 numéro ; u32 offset dans le volume`.
 * - Volume, à chaque offset : `u8 type | u16 numéro | u32 taille compressée | u32 taille décompressée | u16 méthode`, puis les
 *   données (méthode 0 = brutes, 32 = LZS).
 * - Patch (`PATCHES/316.SND`) : `u8 type | u8 n`, `n` octets d'en-tête supplémentaires, puis la ressource telle quelle. Le
 *   numéro vient du nom du fichier, le type de son extension.
 *
 * **Doublons** : 7 ressources ont deux entrées dans `RESOURCE.MAP` (vues 663 et 9591, pic 900, scripts et heaps 93 et 94).
 * Comme ScummVM, **la dernière entrée lue remplace la précédente** ; les deux copies se décompressent en octets identiques
 * (vérifié par les tests), le choix est donc sans effet. **Priorités** : un patch remplace toujours une ressource de volume
 * et n'est jamais remplacé par elle ; entre volumes, le dernier ajouté gagne.
 *
 * Écarts volontaires : pas de cache borné ni de verrouillage (`Lock`), qui relèvent du gestionnaire de `engine/resources.ts` ;
 * les tailles et le type de l'en-tête de volume sont comparés à la map et toute incohérence lève une erreur.
 */
import { BinaryReader } from "../../../data/reader";
import { COMPRESSION_LZS, COMPRESSION_NONE, MAP_END_OF_TYPES, PATCH_EXTENSIONS, resourceTypeName, VOLUME_HEADER_SIZE } from "./ids";
import { decompressLzs } from "./lzs";

const MAP_TYPE_ENTRY_SIZE = 3;
const MAP_ENTRY_SIZE = 6;
/** Octets `34 12 00 00` entre la table des types et les entrées. */
const MAP_PADDING_SIZE = 4;
const PATCH_HEADER_SIZE = 2;

export interface MapEntry {
  readonly type: number;
  readonly number: number;
  /** Offset de l'en-tête dans le volume. */
  readonly offset: number;
}

export interface VolumeHeader {
  readonly type: number;
  readonly number: number;
  readonly packedSize: number;
  readonly unpackedSize: number;
  readonly method: number;
}

/** Entrées d'une map, dans l'ordre du fichier (doublons compris). */
export function readResourceMap(map: Uint8Array): MapEntry[] {
  const r = new BinaryReader(map);
  const types: { type: number; offset: number }[] = [];
  for (;;) {
    if (r.offset + MAP_TYPE_ENTRY_SIZE > map.length) throw new Error("GK1 : table des types de la map tronquée");
    const type = r.u8();
    const offset = r.u16();
    types.push({ type, offset });
    if (type === MAP_END_OF_TYPES) break;
  }
  const end = types[types.length - 1].offset;
  if (end !== map.length) throw new Error("GK1 : la map ne finit pas à l'offset annoncé");
  if (types.length > 1 && types[0].offset !== r.offset + MAP_PADDING_SIZE) throw new Error("GK1 : début des entrées de la map inattendu");
  const entries: MapEntry[] = [];
  for (let t = 0; t + 1 < types.length; t++) {
    const { type, offset } = types[t];
    const next = types[t + 1].offset;
    if (next < offset || (next - offset) % MAP_ENTRY_SIZE !== 0 || next > map.length) throw new Error(`GK1 : entrées de map mal bornées (${resourceTypeName(type)})`);
    r.offset = offset;
    while (r.offset < next) entries.push({ type, number: r.u16(), offset: r.u32() });
  }
  return entries;
}

export function readVolumeHeader(volume: Uint8Array, offset: number): VolumeHeader {
  if (offset + VOLUME_HEADER_SIZE > volume.length) throw new Error(`GK1 : en-tête de ressource hors du volume (${offset})`);
  const r = new BinaryReader(volume);
  r.offset = offset;
  return { type: r.u8(), number: r.u16(), packedSize: r.u32(), unpackedSize: r.u32(), method: r.u16() };
}

/** Données décompressées de la ressource dont l'en-tête est à `offset`. */
export function readVolumeResource(volume: Uint8Array, offset: number): Uint8Array {
  const header = readVolumeHeader(volume, offset);
  const start = offset + VOLUME_HEADER_SIZE;
  if (start + header.packedSize > volume.length) throw new Error(`GK1 : ${describe(header.type, header.number)} dépasse la fin du volume`);
  const packed = volume.subarray(start, start + header.packedSize);
  switch (header.method) {
    case COMPRESSION_NONE:
      if (header.packedSize !== header.unpackedSize) throw new Error(`GK1 : ${describe(header.type, header.number)} : tailles brutes incohérentes`);
      return packed;
    case COMPRESSION_LZS:
      return decompressLzs(packed, header.unpackedSize);
    default:
      throw new Error(`GK1 : ${describe(header.type, header.number)} : méthode de compression ${header.method} inconnue`);
  }
}

/** Type et numéro d'un fichier de patch d'après son nom (`316.SND`, `PATCHES/803.snd`), ou `undefined` si ce n'en est pas un. */
export function parsePatchFileName(path: string): { type: number; number: number } | undefined {
  const match = /(?:^|[\\/])(\d{1,5})\.([A-Za-z0-9]{3})$/.exec(path);
  if (!match) return undefined;
  const type = PATCH_EXTENSIONS[match[2].toUpperCase()];
  const number = Number(match[1]);
  return type === undefined || number > 0xffff ? undefined : { type, number };
}

/** Données d'un fichier de patch, sans son en-tête ; `type` est celui que donne le nom du fichier. */
export function readPatchFile(bytes: Uint8Array, type: number): Uint8Array {
  if (bytes.length < PATCH_HEADER_SIZE) throw new Error("GK1 : fichier de patch tronqué");
  if (bytes[0] !== type) throw new Error(`GK1 : patch de type ${resourceTypeName(bytes[0])} pour un fichier ${resourceTypeName(type)}`);
  const start = PATCH_HEADER_SIZE + bytes[1];
  if (start > bytes.length) throw new Error("GK1 : en-tête de patch plus long que le fichier");
  return bytes.subarray(start);
}

export interface ResourceInfo {
  readonly type: number;
  readonly number: number;
  /** Fichier d'origine : nom du volume (`RESOURCE.000`) ou du patch (`PATCHES/316.SND`). */
  readonly source: string;
  readonly isPatch: boolean;
}

interface StoredResource extends ResourceInfo {
  load(): Uint8Array;
  data?: Uint8Array;
}

/**
 * Ressources indexées par (type, numéro). Les données ne sont décompressées qu'à la première lecture, puis gardées.
 * `RESOURCE.ALT` (vues haute résolution, numéros 1050 et 10100 à 19841) se charge dans un index à part ou dans le même :
 * ses numéros ne recouvrent aucun de ceux de `RESOURCE.000`.
 */
export class ResourceIndex {
  private readonly entries = new Map<number, StoredResource>();

  /** Ajoute les ressources d'une map et de son volume ; renvoie le nombre d'entrées de la map (doublons compris). */
  addVolume(map: Uint8Array, volume: Uint8Array, source: string): number {
    const mapEntries = readResourceMap(map);
    for (const { type, number, offset } of mapEntries) {
      const header = readVolumeHeader(volume, offset);
      if (header.type !== type || header.number !== number) {
        throw new Error(`GK1 : ${source} contient ${describe(header.type, header.number)} là où la map annonce ${describe(type, number)}`);
      }
      const k = key(type, number);
      if (this.entries.get(k)?.isPatch) continue;
      this.entries.set(k, { type, number, source, isPatch: false, load: () => readVolumeResource(volume, offset) });
    }
    return mapEntries.length;
  }

  /** Ajoute un fichier de patch (`PATCHES/316.SND`) : il remplace la ressource de même type et numéro. */
  addPatch(path: string, bytes: Uint8Array): this {
    const id = parsePatchFileName(path);
    if (!id) throw new Error(`GK1 : nom de patch non reconnu : ${path}`);
    const data = readPatchFile(bytes, id.type);
    this.entries.set(key(id.type, id.number), { ...id, source: path, isPatch: true, load: () => data });
    return this;
  }

  has(type: number, number: number): boolean {
    return this.entries.has(key(type, number));
  }

  info(type: number, number: number): ResourceInfo | undefined {
    return this.entries.get(key(type, number));
  }

  /** Données décompressées ; lève une erreur si la ressource est absente. */
  get(type: number, number: number): Uint8Array {
    const entry = this.entries.get(key(type, number));
    if (!entry) throw new Error(`GK1 : ressource introuvable : ${describe(type, number)}`);
    entry.data ??= entry.load();
    return entry.data;
  }

  /** Numéros des ressources d'un type, triés. */
  numbers(type: number): number[] {
    return [...this.entries.values()].filter((e) => e.type === type).map((e) => e.number).sort((a, b) => a - b);
  }

  /** Toutes les ressources, triées par type puis numéro. */
  list(): ResourceInfo[] {
    return [...this.entries.values()].sort((a, b) => a.type - b.type || a.number - b.number);
  }

  get size(): number {
    return this.entries.size;
  }
}

function key(type: number, number: number): number {
  return (type << 16) | number;
}

function describe(type: number, number: number): string {
  return `${resourceTypeName(type)} ${number}`;
}
