import { parseTot } from "../../../src/engine/coktel/data/tot";
import { entry, textLines } from "../helpers";

const cache = new Map<string, string[]>();

/** Texte d'un item du `.DAT` d'un TOT (lignes jointes par « / »), « ? » s'il n'existe pas. */
export function textOf(tot: string, id: number): string {
  const base = tot.toUpperCase().replace(/\.TOT$/, "");
  let items = cache.get(base);
  if (!items) {
    items = [];
    try {
      const table = parseTot(entry(`${base}.TOT`), entry(`${base}.DAT`)).texts;
      for (let i = 0; table && i < table.count; i++) {
        const item = table.get(i);
        items.push(item ? textLines(item).join(" / ") : "");
      }
    } catch {
      // TOT sans textes
    }
    cache.set(base, items);
  }
  return items[id] ?? "?";
}
