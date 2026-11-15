/**
 * Chunks Dynamix « XXX: » (`docs/tim3/formats.md` § 3) : 4 caractères de tag, u32 taille ; le bit 31 de la taille marque un
 * conteneur dont le contenu est une suite de sous-chunks. Tout se parcourt à l'octet près : un reste ou un débordement est une erreur.
 */
import { BinaryReader, decodeText } from "../../../data/reader";

export interface DgdsChunk {
  /** Tag avec les deux-points, `BMP:`, `VGA:`… */
  readonly tag: string;
  readonly container: boolean;
  /** Contenu brut (pour un conteneur : les octets des sous-chunks). */
  readonly data: Uint8Array;
  /** Sous-chunks (vide si `container` est faux). */
  readonly children: DgdsChunk[];
}

const CONTAINER_BIT = 0x80000000;

/** Lit une suite de chunks qui remplit exactement `bytes`. */
export function readChunks(bytes: Uint8Array): DgdsChunk[] {
  const r = new BinaryReader(bytes);
  const out: DgdsChunk[] = [];
  while (!r.isAtEnd) {
    if (r.offset + 8 > r.length) throw new Error("TIM3 : en-tête de chunk tronqué");
    const tag = r.tag();
    if (tag[3] !== ":") throw new Error(`TIM3 : chunk inattendu (${tag})`);
    const raw = r.u32();
    const size = raw & 0x7fffffff;
    if (r.offset + size > r.length) throw new Error(`TIM3 : chunk ${tag} dépasse la fin des données`);
    const data = r.bytesView(size);
    const container = (raw & CONTAINER_BIT) !== 0;
    out.push({ tag, container, data, children: container ? readChunks(data) : [] });
  }
  return out;
}

/** Premier sous-chunk portant ce tag, ou `undefined`. */
export function findChunk(chunks: readonly DgdsChunk[], tag: string): DgdsChunk | undefined {
  return chunks.find((c) => c.tag === tag);
}

/** Liste `u16 n` puis `n × { u16 id, cstring }` (chunks `TAG:` et `LAB:` des ANM et ITF), lue jusqu'au dernier octet. */
export function readIdStrings(data: Uint8Array): [number, string][] {
  const r = new BinaryReader(data);
  const n = r.u16();
  const out: [number, string][] = [];
  for (let i = 0; i < n; i++) {
    const id = r.u16();
    const end = data.indexOf(0, r.offset);
    if (end === -1) throw new Error("TIM3 : chaîne sans terminateur");
    out.push([id, decodeText(data.subarray(r.offset, end))]);
    r.offset = end + 1;
  }
  if (!r.isAtEnd) throw new Error(`TIM3 : ${data.length - r.offset} octets en trop après la liste`);
  return out;
}
