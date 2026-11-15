/**
 * Solutions écrites pour le port (`docs/tim3/solutions.md`) : format JSON et application à un `.LEV`.
 *
 * Une solution pose des pièces du **bac** dans l'aire de jeu. Le bac est ce que le jeu y range au chargement du puzzle
 * (43267a, `World.stowUnlocked`) : les pièces sans `flags3 & 0x40`, plus les cordes et courroies qu'elles entraînent (une
 * courroie « du puzzle » tendue vers une pièce du bac part au bac avec elle). Le résultat est un LEV où ces pièces sont
 * verrouillées (bit 0x40) à leur place, avec leurs liens : le chargeur du jeu (431d3f / 43173e) les met alors directement
 * dans l'aire, comme le moteur TypeScript (`World.loadLevel`), et le banc Unicorn dit si le binaire déclare le puzzle
 * réussi (`bench.py trace --lev`).
 *
 * Ce que l'éditeur du jeu écrit quand on pose une pièce (42f24a → 42f4c4 … 42f5f9, traduit dans `engine/editor.ts`) :
 * position d'édition (+0x2C/+0x30, calée sur la grille), retournement (+0x10 & 0x30), image d'édition (+0x1C, après le
 * slot 2), taille (pièces étirables), liste (+0x0C & 0x4000 : statiques, sinon mobiles). Liens (42ee68, 42ed3f, 438ea8) :
 * - courroie : ses deux pièces (+0x84 de la courroie), bit 0x2 de +0x10 levé sur chacune ;
 * - corde : bouts (+0xA8 : pièce, emplacement 0/1), chaque bout désigne dans +0x90/+0x94 (emplacement) l'élément voisin de
 *   la chaîne (l'autre bout, ou la première / dernière poulie) ; une poulie traversée désigne la suivante (+0x90, vers le
 *   bout 2) et la précédente (+0x94), et porte la corde ;
 * - fiche : la pièce à fiche désigne la prise (+0xA0), la prise désigne la pièce sur sa sortie 0 ou 1 (+0xA0 / +0xA4) ;
 * - paire télécommande (22) / explosifs (55) : chacune désigne l'autre dans +0x94.
 * Le chargeur relit ces champs dans l'enregistrement (`appearance`, `width1/height1`, `width2/height2`, `x`, `y`,
 * `flags2 & 0x32`, `flags3 & 0x140`, liens) : la solution les donne, et garde tels quels ceux qu'elle ne donne pas
 * (l'enregistrement du bac a été écrit par le jeu lui-même).
 */
import { type Level, levelParts, type LevPart, PART_LOCKED } from "../../../src/games/tim3/data/lev";
import { World } from "../../../src/games/tim3/engine/world";
import { realTypes } from "../engine/helpers";

/** Bout de corde : pièce (index dans le LEV) et point d'attache (0 ou 1 : `rope1Anchor` / `rope2Anchor` de la pièce). */
export interface RopeEnd {
  part: number;
  slot: 0 | 1;
}

export interface Placement {
  /** Index de la pièce dans le LEV (`levelParts`, fixes puis mobiles) ; elle doit être au bac. */
  part: number;
  /** Type attendu (contrôle). */
  type: number;
  /** Coin haut-gauche dans l'aire (pixels, position d'édition) ; absent pour une corde ou une courroie. */
  x?: number;
  y?: number;
  /** Retournement : `x` (bit 0x10 de +0x10), `y` (0x20), les deux, ou `none`. Absent : celui de l'enregistrement. */
  flip?: "none" | "x" | "y" | "xy";
  /** Taille (pièces étirables : boîte et image). Absente : celle de l'enregistrement. */
  width?: number;
  height?: number;
  /** Image d'édition (+0x1C) : état choisi dans l'éditeur (angle, couleur…). Absente : celle de l'enregistrement. */
  appearance?: number;
  /** Courroie (type 8) : index des deux pièces reliées. */
  belt?: [number, number];
  /** Corde ou câble (10, 76) : les deux bouts, et les poulies traversées du bout 1 vers le bout 2. */
  rope?: [RopeEnd, RopeEnd];
  via?: number[];
  /** Longueur de segment de la corde (`segmentLength`). Absente : celle de l'enregistrement. */
  ropeLength?: number;
  /** Télécommande (22) et explosifs télécommandés (55) : la pièce associée (+0x94 de chacune, 42f978). */
  pair?: number;
  /** Pièce à fiche : index de la prise et sortie (0 par défaut). */
  plug?: { part: number; outlet?: 0 | 1 };
}

export interface Solution {
  /** Nom du LEV (`TLEV1`). */
  level: string;
  /** Premier pas après lequel le test de but du jeu (436dc6) rend 2 (« réussi »), mesuré au banc. */
  goalStep: number;
  /** Remarque libre (origine de la solution). */
  note?: string;
  /** Pièces du bac posées, dans l'ordre de pose (une corde ou une courroie après ses pièces). */
  parts: Placement[];
}

const FLIP_BITS = { none: 0, x: 0x10, y: 0x20, xy: 0x30 } as const;

/** Champs de liens (index de pièce, −1 = aucun) selon la forme d'enregistrement. */
const LINK_FIELDS: Record<LevPart["kind"], readonly string[]> = {
  default: ["connected1", "connected2", "plugged1", "plugged2"],
  programmableBall: ["connected1", "connected2", "plugged1", "plugged2"],
  rope: ["ropePart1", "ropePart2", "connected1", "connected2", "plugged1", "plugged2"],
  belt: ["beltPart1", "beltPart2", "connected1", "connected2", "plugged1", "plugged2"],
  pulley: ["pulleyPart1", "pulleyPart2", "unknown32", "unknown34", "ropeIndex", "unknown24", "unknown26"],
};

type Fields = Record<string, number>;
const fields = (p: LevPart) => p as unknown as Fields;

/** Index (dans le LEV) des pièces que le jeu met au bac au chargement du puzzle : celles du moteur, `World.bin`. */
export function binIndices(level: Level): Set<number> {
  const w = new World(realTypes());
  w.loadLevel(level);
  return new Set([...w.bin].map((p) => p.levIndex));
}

/**
 * Applique une solution : rend un nouveau niveau où les pièces posées sont verrouillées à leur place, avec leurs liens.
 * Les liens qui touchaient le bac dans le LEV d'origine sont d'abord défaits et les pièces du bac déverrouillées (le jeu
 * les y range au chargement, 43267a), puis ceux de la solution sont écrits des deux côtés.
 */
export function applySolution(source: Level, solution: Solution, bin = binIndices(source)): Level {
  const level = structuredClone(source);
  const all = levelParts(level);
  const err = (msg: string) => new Error(`${solution.level} : ${msg}`);
  const at = (i: number): LevPart => {
    const p = all[i];
    if (!p) throw err(`pièce ${i} absente du LEV`);
    return p;
  };

  // 1. Liens à réécrire défaits : ceux des pièces posées (et des poulies que traverse une corde posée), ceux qui les
  //    désignent depuis les pièces du puzzle, le bit 0x2 de +0x10 des pièces d'une courroie posée. Les pièces du bac non
  //    posées gardent leur enregistrement et sont déverrouillées : le jeu les range au bac au chargement et défait alors
  //    leurs liens (43267a, comme pour le LEV d'origine).
  const placed = new Set(solution.parts.map((a) => a.part));
  if (placed.size !== solution.parts.length) throw err("pièce posée deux fois");
  for (const i of placed) {
    const b = at(i);
    if (b.kind === "belt") for (const e of [b.beltPart1, b.beltPart2]) if (all[e]) all[e].flags2 &= ~2;
  }
  for (const [i, p] of all.entries()) {
    const f = fields(p);
    if (bin.has(i) && !placed.has(i)) {
      p.flags3 &= ~PART_LOCKED;
      continue;
    }
    const own = placed.has(i) || (p.kind === "pulley" && placed.has(p.ropeIndex));
    for (const k of LINK_FIELDS[p.kind]) if (own || placed.has(f[k]!)) f[k] = -1;
    if (own && p.kind === "rope") f.ropeEnd1Usage = f.ropeEnd2Usage = 0;
  }

  // 2. Pièces posées.
  for (const a of solution.parts) {
    const p = at(a.part);
    const f = fields(p);
    if (p.type !== a.type) throw err(`pièce ${a.part} de type ${p.type}, ${a.type} attendu`);
    if (!bin.has(a.part)) throw err(`pièce ${a.part} (type ${p.type}) hors du bac`);
    p.flags3 |= PART_LOCKED;
    if (p.kind === "belt") {
      if (!a.belt) throw err(`courroie ${a.part} sans « belt »`);
      [f.beltPart1, f.beltPart2] = a.belt;
      for (const e of a.belt) at(e).flags2 |= 2;
      continue;
    }
    if (p.kind === "rope") {
      if (!a.rope) throw err(`corde ${a.part} sans « rope »`);
      const [r1, r2] = a.rope;
      f.ropePart1 = r1.part;
      f.ropePart2 = r2.part;
      f.ropeEnd1Usage = r1.slot;
      f.ropeEnd2Usage = r2.slot;
      if (a.ropeLength !== undefined) f.segmentLength = a.ropeLength;
      const chain = [r1.part, ...(a.via ?? []), r2.part];
      for (let k = 1; k < chain.length - 1; k++) {
        const q = at(chain[k]!);
        if (q.kind !== "pulley") throw err(`corde ${a.part} : la pièce ${chain[k]} n'est pas une poulie`);
        q.pulleyPart1 = chain[k + 1]!;
        q.pulleyPart2 = chain[k - 1]!;
        q.ropeIndex = a.part;
      }
      fields(at(r1.part))[`connected${r1.slot + 1}`] = chain[1]!;
      fields(at(r2.part))[`connected${r2.slot + 1}`] = chain.at(-2)!;
      continue;
    }
    if (a.x === undefined || a.y === undefined) throw err(`pièce ${a.part} sans position`);
    p.x = a.x;
    p.y = a.y;
    if (a.flip) p.flags2 = (p.flags2 & ~0x30) | FLIP_BITS[a.flip];
    if (a.width !== undefined) p.width1 = p.width2 = a.width;
    if (a.height !== undefined) p.height1 = p.height2 = a.height;
    if (a.appearance !== undefined) p.appearance = a.appearance;
    if (a.pair !== undefined) {
      f.connected2 = a.pair;
      fields(at(a.pair)).connected2 = a.part;
    }
    if (a.plug) {
      if (p.kind === "pulley") throw err(`poulie ${a.part} avec une fiche`);
      f.plugged1 = a.plug.part;
      fields(at(a.plug.part))[`plugged${(a.plug.outlet ?? 0) + 1}`] = a.part;
    }
  }

  // 3. Aucune pièce posée ne désigne une pièce restée au bac.
  for (const [i, p] of all.entries()) {
    if (!placed.has(i)) continue;
    const f = fields(p);
    for (const k of LINK_FIELDS[p.kind]) {
      const v = f[k]!;
      if (bin.has(v) && !placed.has(v)) throw err(`pièce ${i} reliée (${k}) à la pièce ${v}, restée au bac`);
    }
  }
  return level;
}

/** JSON lisible et stable : en-tête, puis une ligne par pièce posée. */
export function formatSolution(s: Solution): string {
  const head = { level: s.level, goalStep: s.goalStep, ...(s.note ? { note: s.note } : {}) };
  const body = s.parts.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
  return `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "parts": [\n${body}\n  ]\n}\n`;
}
