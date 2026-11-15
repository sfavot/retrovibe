// Brouillon de solution tiré d'un LEV : les pièces du bac **sans** le bit 0x100 de flags3 sont, dans les puzzles du jeu,
// à la place où le concepteur les a posées (docs/tim3/solutions.md, « Pièces du concepteur »). Écrit
// test/tim3/solutions/<LEV>.json (goalStep à 0 : à mesurer avec solution-check.mts --bench … --update).
// Usage : npx vite-node scripts/tim3/solution-extract.mts TLEV1 [TLEV2 …] [--force] [--dir DIR]   (DIR : autre dossier de sortie)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { levelParts, readLev } from "../../src/games/tim3/data/lev";
import { baseIndex } from "../../test/tim3/data/real";
import { realTypes } from "../../test/tim3/engine/helpers";
import { binIndices, formatSolution, type Placement, type Solution } from "../../test/tim3/solutions/apply";

/** Bit 0x100 de flags3 : pièce du bac laissée hors de la solution du concepteur (observé, docs/tim3/solutions.md). */
const UNUSED = 0x100;

const args = process.argv.slice(2);
const force = args.includes("--force");
const dirAt = args.indexOf("--dir");
const dir = dirAt >= 0 ? resolve(args[dirAt + 1]!) : resolve(import.meta.dirname, "../../test/tim3/solutions");
const types = realTypes();
mkdirSync(dir, { recursive: true });

for (const name of args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--dir")) {
  const level = readLev(baseIndex().get(`${name}.LEV`));
  const all = levelParts(level);
  const bin = binIndices(level);
  const parts: Placement[] = [];
  const links: Placement[] = [];
  for (const i of [...bin].sort((a, b) => a - b)) {
    const p = all[i]!;
    if (p.flags3 & UNUSED) continue;
    // Corde ou courroie (jamais marquée) dont une pièce est un leurre du bac : leurre aussi.
    const unused = (e: number) => bin.has(e) && (all[e]!.flags3 & UNUSED) !== 0;
    if (p.kind === "belt") {
      if (unused(p.beltPart1) || unused(p.beltPart2)) continue;
      links.push({ part: i, type: p.type, belt: [p.beltPart1, p.beltPart2] });
      continue;
    }
    if (p.kind === "rope") {
      // Poulies traversées : du bout 1, son lien d'emplacement, puis +0x90 de poulie en poulie.
      const via: number[] = [];
      const end1 = all[p.ropePart1]! as unknown as Record<string, number>;
      for (let q = end1[`connected${(p.ropeEnd1Usage & 1) + 1}`]!; all[q]?.kind === "pulley" && via.length < 16; q = (all[q] as { pulleyPart1: number }).pulleyPart1) via.push(q);
      if ([p.ropePart1, p.ropePart2, ...via].some(unused)) continue;
      links.push({
        part: i,
        type: p.type,
        rope: [
          { part: p.ropePart1, slot: (p.ropeEnd1Usage & 1) as 0 | 1 },
          { part: p.ropePart2, slot: (p.ropeEnd2Usage & 1) as 0 | 1 },
        ],
        ...(via.length ? { via } : {}),
        ropeLength: p.segmentLength,
      });
      continue;
    }
    const d = types.get(p.type);
    const a: Placement = { part: i, type: p.type, x: p.x, y: p.y };
    const flip = p.flags2 & 0x30;
    if (flip) a.flip = flip === 0x30 ? "xy" : flip === 0x10 ? "x" : "y";
    // Pièce étirable (bornes d'édition +0x3C / +0x40 non nulles : murs, pentes, tapis…) : taille toujours donnée.
    if (d.f3C !== 0 || d.f40 !== 0) {
      a.width = p.width2;
      a.height = p.height2;
    }
    if (p.appearance !== 0) a.appearance = p.appearance;
    // Paire télécommande (22) / explosifs (55) : donnée une fois, sur la première des deux.
    if ((p.type === 22 || p.type === 55) && p.kind === "default" && p.connected2 > i && !unused(p.connected2)) a.pair = p.connected2;
    if (p.kind !== "pulley" && d.flags14 & 1 && p.plugged1 >= 0) {
      const s = all[p.plugged1]!;
      const outlet = "plugged2" in s && s.plugged2 === i ? 1 : 0;
      a.plug = { part: p.plugged1, ...(outlet ? { outlet } : {}) };
    }
    parts.push(a);
  }
  const solution: Solution = { level: name, goalStep: 0, parts: [...parts, ...links], note: "Pièces du concepteur (bac sans le bit 0x100)." };
  const file = resolve(dir, `${name}.json`);
  if (existsSync(file) && !force) {
    console.log(`${name} : ${file} existe (--force pour l'écraser)`);
    continue;
  }
  writeFileSync(file, formatSolution(solution));
  console.log(`${name} : ${parts.length + links.length} pièces`);
}

