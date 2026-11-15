/**
 * Listes chaînées de pièces de TIMWIN.EXE : statiques (tête 0x48117c), mobiles (0x481184), bac (0x48118c).
 * L'ordre d'insertion fait partie du comportement (ordre des passes du pas, des collisions) : 4393e0 trie par masse du
 * type, puis par position, avec des cas propres aux cordes et aux paniers.
 */
import { BIN_ORDER } from "../data/tables/bin-order";
import { F0C, Part } from "./part";
import type { TypeTable } from "./types";

export type ListKind = "static" | "mobile" | "bin";

const LIST_FLAG: Record<ListKind, number> = { static: F0C.IN_STATIC, mobile: F0C.IN_MOBILE, bin: F0C.IN_BIN };

export class PartList {
  head: Part | null = null;

  constructor(readonly kind: ListKind) {}

  *[Symbol.iterator](): IterableIterator<Part> {
    for (let p = this.head; p; p = p.next) yield p;
  }

  toArray(): Part[] {
    return [...this];
  }

  /** Retire une pièce de la liste (sans toucher à ses drapeaux). */
  remove(part: Part): void {
    if (part.prev) part.prev.next = part.next;
    else if (this.head === part) this.head = part.next;
    if (part.next) part.next.prev = part.prev;
    part.next = part.prev = null;
  }

  /** Insère après `after` (`null` : en tête). */
  insertAfter(part: Part, after: Part | null): void {
    part.prev = after;
    part.next = after ? after.next : this.head;
    if (after) after.next = part;
    else this.head = part;
    if (part.next) part.next.prev = part;
  }
}

/** 417133(a, b) : celui des deux types qui vient le premier dans l'ordre du bac (0x47201c) ; `a` si aucun n'y est. */
export function binFirst(a: number, b: number): number {
  for (const t of BIN_ORDER) {
    if (t === a) return a;
    if (t === b) return b;
  }
  return a;
}

const ROPE_TYPES = new Set([0x31, 0x0a, 0x4c]);

/**
 * 4393e0(part, liste, chargement) : insertion triée.
 * - Bac : avant la première pièce dont le type vient au plus tôt avec celui de la pièce dans l'ordre du bac (417133).
 * - Drapeau +0x15 & 0x10 : ces pièces vont après les autres (au chargement, `loading` vrai : tout au bout).
 * - Sinon, par masse du type croissante ; à masse égale, cordes d'abord, puis y décroissant, puis x décroissant
 *   (paniers 11 entre eux : y croissant).
 * Pose ensuite le drapeau de liste de +0x0C.
 */
export function insertSorted(list: PartList, part: Part, types: TypeTable, loading: boolean): void {
  const mass = types.get(part.type).mass;
  let after: Part | null = null;
  let next = list.head;
  while (next) {
    let stop = false;
    if (list.kind === "bin") {
      stop = binFirst(next.type, part.type) === part.type;
    } else if (part.flags14 & 0x1000) {
      stop = (next.flags14 & 0x1000) !== 0 && !loading;
    } else {
      const nextMass = types.get(next.type).mass;
      if (mass === nextMass) {
        // Au premier tour, l'exe teste aussi le « type » de la tête de liste (+8 de la globale de tête : la tête de la
        // liste voisine, un pointeur), qui n'est jamais 10, 0x31 ou 0x4c : sans effet.
        if (ROPE_TYPES.has(part.type)) stop = true;
        else if (part.type === 0x0b && next.type === 0x0b) {
          stop = next.editY > part.editY || (next.editY === part.editY && next.editX < part.editX);
        } else {
          stop = next.editY < part.editY || (next.editY === part.editY && next.editX < part.editX);
        }
      } else {
        stop = mass < nextMass;
      }
    }
    if (stop) break;
    after = next;
    next = next.next;
  }
  list.insertAfter(part, after);
  part.flags0C &= ~0x3800;
  part.flags0C |= LIST_FLAG[list.kind];
}
