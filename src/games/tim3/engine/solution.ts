/**
 * « Montrer la solution » (ampoule `TB_SOLUTION`, 419185 → 43252d avec le mode 9) : le puzzle rechargé avec la solution du
 * concepteur posée.
 *
 * Chaque LEV garde cette solution dans les enregistrements de son bac (`docs/tim3/solutions.md` § 1) : les pièces du bac
 * **sans** le bit 0x100 de `flags3` sont à leur place de solution (position, retournement, taille, image, liens) ; celles qui
 * l'ont sont des leurres, comme une corde ou une courroie dont une pièce (ou une poulie traversée) est un leurre.
 *
 * Le niveau rendu verrouille (bit 0x40) les pièces de la solution : le chargement (`World.loadLevel`) les laisse dans l'aire avec
 * leurs liens et ne range que les leurres au bac (43267a). `placed` donne leurs index, que la session déverrouille
 * (`SessionOptions.unlock`) : le joueur peut ensuite les déplacer, comme celles qu'il a posées lui-même.
 */
import { levelParts, PART_LOCKED, type Level, type LevPart } from "../data/lev";
import { Tim3Session, type SessionOptions } from "./session";
import type { TypeTable } from "./types";
import { World } from "./world";

/** Bit 0x100 de `flags3` : pièce du bac laissée hors de la solution du concepteur (observé, `docs/tim3/solutions.md`). */
export const DECOY = 0x100;

/** Garde-fou du parcours des poulies d'une corde. */
const MAX_PULLEYS = 16;

export interface DesignerSolution {
  /** Niveau où les pièces de la solution sont verrouillées à leur place. */
  level: Level;
  /** Index (`levelParts` : fixes puis mobiles) des pièces de la solution, à déverrouiller. */
  placed: number[];
}

/** Index des pièces que le chargement range au bac (43267a) : les pièces non verrouillées et les liens qu'elles entraînent. */
function binIndices(types: TypeTable, level: Level): Set<number> {
  const world = new World(types);
  world.loadLevel(level);
  return new Set([...world.bin].map((p) => p.levIndex));
}

/** Pièces de la solution du concepteur et niveau qui les pose. */
export function designerSolution(types: TypeTable, source: Level): DesignerSolution {
  const level = structuredClone(source);
  const all = levelParts(level);
  const bin = binIndices(types, source);
  const decoy = (i: number): boolean => bin.has(i) && ((all[i]?.flags3 ?? 0) & DECOY) !== 0;
  const placed: number[] = [];
  for (const i of [...bin].sort((a, b) => a - b)) {
    const p = all[i]!;
    if (decoy(i) || linkedToDecoy(p, all, decoy)) continue;
    p.flags3 |= PART_LOCKED;
    placed.push(i);
  }
  return { level, placed };
}

/** Corde ou courroie dont une pièce, ou une poulie traversée, est un leurre (HLEV16 : câble entre deux taquets leurres). */
function linkedToDecoy(p: LevPart, all: readonly LevPart[], decoy: (i: number) => boolean): boolean {
  if (p.kind === "belt") return decoy(p.beltPart1) || decoy(p.beltPart2);
  if (p.kind !== "rope") return false;
  // Poulies traversées : depuis le bout 1, son lien d'emplacement, puis +0x90 de poulie en poulie.
  const ends: number[] = [p.ropePart1, p.ropePart2];
  const end1 = all[p.ropePart1] as unknown as Record<string, number> | undefined;
  let q = end1?.[`connected${(p.ropeEnd1Usage & 1) + 1}`] ?? -1;
  for (let n = 0; n < MAX_PULLEYS; n++) {
    const pulley = all[q];
    if (pulley?.kind !== "pulley") break;
    ends.push(q);
    q = pulley.pulleyPart1;
  }
  return ends.some(decoy);
}

/** Session du puzzle avec la solution du concepteur posée (pièces déplaçables). */
export function solutionSession(types: TypeTable, source: Level, options: Omit<SessionOptions, "unlock" | "originalCount"> = {}): Tim3Session {
  const { level, placed } = designerSolution(types, source);
  return new Tim3Session(types, level, { ...options, unlock: placed });
}
