/**
 * Conteneur de ressources Dynamix de TIM3 (`docs/tim3/formats.md` § 2).
 *
 * - Map : magic `00 01 04 07`, u16 nombre de volumes, puis par volume un nom de 13 octets, u16 nombre d'entrées et des paires
 *   (u32 hachage, u32 offset dans le volume).
 * - Volume : à chaque offset, nom de 13 octets (terminé par 0), u32 taille, puis les données.
 * - Les `.DAT` de langue (`FRENCH.DAT`) réunissent map et volume dans un seul fichier : le volume y porte le nom du fichier.
 *
 * Les ressources sont indexées par nom, sans tenir compte de la casse ; le hachage de la map n'est pas recalculé. Une langue se
 * superpose aux volumes de base (`overlay`) : ses ressources remplacent celles de même nom.
 */
import { decodeText } from "../../../data/reader";

const MAGIC = 0x07040100;
const NAME_SIZE = 13;
const ENTRY_HEADER_SIZE = NAME_SIZE + 4;

export interface ResourceEntry {
  /** Nom tel qu'écrit dans le volume (`TIM_NEW.PAL`). */
  readonly name: string;
  /** Volume d'origine (`RESOURCE.001`, `FRENCH.DAT`). */
  readonly volume: string;
  readonly data: Uint8Array;
}

export class ResourceIndex {
  private readonly entries = new Map<string, ResourceEntry>();

  /** Noms de toutes les ressources, dans l'ordre d'ajout (volume par volume, ordre de la map). */
  names(): string[] {
    return [...this.entries.values()].map((e) => e.name);
  }

  has(name: string): boolean {
    return this.entries.has(name.toUpperCase());
  }

  entry(name: string): ResourceEntry | undefined {
    return this.entries.get(name.toUpperCase());
  }

  /** Données d'une ressource ; lève une erreur si elle est absente. */
  get(name: string): Uint8Array {
    const e = this.entry(name);
    if (!e) throw new Error(`TIM3 : ressource introuvable : ${name}`);
    return e.data;
  }

  /** Ajoute (ou remplace) les ressources d'une map et de ses volumes. */
  add(map: Uint8Array, volumes: (name: string) => Uint8Array): this {
    for (const e of readMap(map, volumes)) this.entries.set(e.name.toUpperCase(), e);
    return this;
  }

  /** Superpose un `.DAT` de langue (map et volume dans le même fichier). */
  overlay(dat: Uint8Array, fileName: string): this {
    return this.add(dat, (name) => {
      if (name.toUpperCase() !== fileName.toUpperCase()) throw new Error(`TIM3 : ${fileName} renvoie au volume ${name}`);
      return dat;
    });
  }
}

/** Lit une map et renvoie ses entrées, dans l'ordre. `volumes` fournit le contenu d'un volume d'après son nom. */
export function readMap(map: Uint8Array, volumes: (name: string) => Uint8Array): ResourceEntry[] {
  const view = new DataView(map.buffer, map.byteOffset, map.byteLength);
  if (map.length < 6 || view.getUint32(0, true) !== MAGIC) throw new Error("TIM3 : map de ressources invalide");
  const count = view.getUint16(4, true);
  const out: ResourceEntry[] = [];
  let p = 6;
  for (let v = 0; v < count; v++) {
    const volumeName = cString(map, p, NAME_SIZE);
    const n = view.getUint16(p + NAME_SIZE, true);
    p += NAME_SIZE + 2;
    if (p + 8 * n > map.length) throw new Error(`TIM3 : map tronquée (${volumeName})`);
    const vol = volumes(volumeName);
    const vview = new DataView(vol.buffer, vol.byteOffset, vol.byteLength);
    for (let i = 0; i < n; i++) {
      const offset = view.getUint32(p + 8 * i + 4, true);
      if (offset + ENTRY_HEADER_SIZE > vol.length) throw new Error(`TIM3 : entrée hors du volume ${volumeName} (${offset})`);
      const name = cString(vol, offset, NAME_SIZE);
      const size = vview.getUint32(offset + NAME_SIZE, true);
      const start = offset + ENTRY_HEADER_SIZE;
      if (start + size > vol.length) throw new Error(`TIM3 : ${name} dépasse la fin de ${volumeName}`);
      out.push({ name, volume: volumeName, data: vol.subarray(start, start + size) });
    }
    p += 8 * n;
  }
  return out;
}

function cString(bytes: Uint8Array, offset: number, max: number): string {
  let end = offset;
  while (end < offset + max && bytes[end] !== 0) end++;
  return decodeText(bytes.subarray(offset, end));
}
