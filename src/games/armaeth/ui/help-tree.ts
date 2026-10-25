import type { HelpNode } from "../data/tables";

/**
 * Lecture de l'arbre d'aide de `A1FSOS.SYS` (`docs/armaeth/screens.md` E15) : `child` est la première option d'un sous-menu, `link`
 * l'option suivante du même menu (0 = dernière), un nœud sans enfant est une page de texte. Un menu a 20 options au plus.
 */

/** Une option d'un menu. */
export interface HelpOption {
  /** Indice du nœud. */
  node: number;
  /** Titre ; vide pour les options d'un menu d'indices (le jeu les numérote « Aide n° 1, 2... »). */
  title: string;
}

/** Ce que l'on trouve en ouvrant une option. */
export type HelpTarget =
  /** Page de texte. */
  | { type: "page"; text: string }
  /** Sous-menu : ses options. */
  | { type: "menu"; options: HelpOption[] };

/** Options du menu qui commence au nœud `first` (suit les liens ; arrêt sur un lien déjà vu ou hors de l'arbre). */
export function menuOptions(nodes: readonly HelpNode[], first: number): HelpOption[] {
  const options: HelpOption[] = [];
  const seen = new Set<number>();
  for (let node = first; node > 0 && node < nodes.length && !seen.has(node); node = nodes[node].link) {
    seen.add(node);
    options.push({ node, title: nodes[node].text });
  }
  return options;
}

/** Options de premier niveau (les chapitres : « * Information * », « Niveau de jeu 0 »...). */
export function rootOptions(nodes: readonly HelpNode[]): HelpOption[] {
  return nodes.length > 0 ? menuOptions(nodes, nodes[0].child) : [];
}

/**
 * Ouvre l'option `node` : l'enfant est soit une page (un seul nœud sans enfant), soit le premier nœud d'un sous-menu. Une option sans
 * enfant est elle-même une page.
 */
export function open(nodes: readonly HelpNode[], node: number): HelpTarget {
  const child = nodes[node].child;
  if (child <= 0 || child >= nodes.length) return { type: "page", text: nodes[node].text };
  const options = menuOptions(nodes, child);
  if (options.length === 1 && nodes[options[0].node].child === 0) return { type: "page", text: nodes[options[0].node].text };
  return { type: "menu", options };
}

/** Menu d'indices : toutes les options sont sans titre et s'ouvrent sur une page ; les pages, de plus en plus explicites. */
export function hintTexts(nodes: readonly HelpNode[], options: readonly HelpOption[]): string[] | null {
  if (options.length === 0 || options.some((option) => option.title !== "")) return null;
  const texts: string[] = [];
  for (const option of options) {
    const target = open(nodes, option.node);
    if (target.type !== "page") return null;
    texts.push(target.text);
  }
  return texts;
}
