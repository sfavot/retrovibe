/**
 * Qui possède quoi (`docs/fotaq/specials.md`, § 1) : les pièces et les mouvements spéciaux de chaque groupe. `assemble.test.ts`
 * vérifie qu'un groupe ne définit que ce qui est à lui et que les groupes ne se recouvrent pas. Fichier partagé : ne pas le
 * modifier ; un déplacement de pièce ou de mouvement entre groupes se décide avec le coordinateur.
 */

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export interface GroupOwnership {
  /** Zone du jeu. */
  name: string;
  /** Pièces du groupe (tous les cas de pièce : zones éteintes, `roomUpdates`, pièce spéciale). */
  rooms: readonly number[];
  /** Mouvements spéciaux du groupe (`cutaway.md` § 5). */
  moves: readonly number[];
}

export const OWNERSHIP: Readonly<Record<number, GroupOwnership>> = {
  1: { name: "jungle et Amazones", rooms: [...range(1, 6), ...range(8, 21)], moves: [] },
  2: { name: "Floda", rooms: [...range(22, 42), 103], moves: [19, 21, 22, 23, 25] },
  3: { name: "temple et labyrinthe", rooms: [...range(43, 63), ...range(97, 102)], moves: [20, 24, 33] },
  4: { name: "vallée, hôtel et course de voiture", rooms: [...range(64, 68), ...range(70, 74), 76], moves: [2, 3, 4, 5, 6, 7, 8, 31, 32] },
  5: { name: "fin", rooms: [69, 75, ...range(104, 114), 126], moves: [9, 10, 11, 12, 13, 14, 26, 27, 28, 29, 30] },
  6: { name: "introduction, générique et piton", rooms: [7, 95, ...range(115, 125)], moves: [15, 16, 17, 18, 34, 36, 37, 38, 39] },
};
