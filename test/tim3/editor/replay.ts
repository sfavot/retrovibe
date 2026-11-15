import { levelParts, type Level, type LevPart } from "../../../src/games/tim3/data/lev";
import { Zone } from "../../../src/games/tim3/engine/editor";
import type { Part } from "../../../src/games/tim3/engine/part";
import { BALL_STEPS, BUCKET_MAX, LASER_GUN_MAX, PROGRAM_TYPES, type ProgramRow } from "../../../src/games/tim3/engine/program";
import type { Tim3Session } from "../../../src/games/tim3/engine/session";
import type { Placement, Solution } from "../solutions/apply";

/**
 * Une solution (`test/tim3/solutions/*.json`) rejouée **par l'API de l'éditeur**, comme un joueur : prendre chaque pièce
 * dans le bac, la retourner, l'étirer et l'orienter en main, la poser à sa place (grille de 42f24a), tendre courroies et
 * cordes par appuis sur leurs pièces (et les poulies traversées). Les champs absents de la solution sont ceux de
 * l'enregistrement du bac, comme pour `applySolution`.
 */
const GRID8 = new Set([0x56, 0x0e, 3, 0x8b]);
const LOW_Y = new Set([0x39, 0x62, 0x61, 0x58]);

/** Point de l'aire où appuyer pour que 42f24a pose la pièce tenue au coin (x, y). */
function pointerFor(p: Part, x: number, y: number, grabX: number, grabY: number): [number, number] {
  if (p.flags14 & 8 || GRID8.has(p.type)) return [x + grabX, y + grabY];
  return [x - 8 + grabX, y - (LOW_Y.has(p.type) ? 3 : 8) + grabY];
}

function center(s: Tim3Session, p: Part): [number, number] {
  const r = s.editor.partRect(p);
  return [r.x + (r.w >> 1), r.y + (r.h >> 1)];
}

/** Rejoue une solution dans une session ; rend les écarts (vide : tout a été posé comme dans la solution). */
export function replay(s: Tim3Session, level: Level, solution: Solution, programs: readonly ProgramRow[] = []): string[] {
  const ed = s.editor;
  const records = levelParts(level);
  const expected: [Part, number][] = [];
  const problems: string[] = [];
  /** Partenaires créés par l'éditeur à la pose d'une télécommande ou d'explosifs (42f57b) : index du LEV → pièce tenue. */
  const partners = new Map<number, Part>();
  const byIndex = (i: number): Part | undefined => partners.get(i) ?? [...s.world.bin, ...s.world.staticThenMobile()].find((p) => p.levIndex === i);
  const todo = plugOrder(solution.parts);
  while (todo.length > 0) {
    const a = todo.shift()!;
    const p = partners.get(a.part) ?? ed.binParts().find((q) => q.levIndex === a.part);
    if (!p) {
      problems.push(`${a.part} : absente du bac`);
      continue;
    }
    if (p.type !== a.type) problems.push(`${a.part} : type ${p.type}, ${a.type} attendu`);
    if (!partners.has(a.part)) ed.takeFromBin(p);
    if (a.belt) {
      for (const end of a.belt) {
        const t = byIndex(end)!;
        const [x, y] = center(s, t);
        ed.hover(x, y);
        ed.click(x, y);
      }
      if (p.belt?.end1 !== byIndex(a.belt[0]) || p.belt?.end2 !== byIndex(a.belt[1])) problems.push(`${a.part} : courroie non tendue`);
      continue;
    }
    if (a.rope) {
      const stops = [{ part: a.rope[0].part, slot: a.rope[0].slot }, ...(a.via ?? []).map((v) => ({ part: v, slot: -1 })), { part: a.rope[1].part, slot: a.rope[1].slot }];
      for (const stop of stops) {
        const t = byIndex(stop.part)!;
        const [x, y] = stop.slot < 0 || !(t.flags10 & 8) ? center(s, t) : [t.px + t.ropeAnchor[2 * stop.slot]!, t.py + t.ropeAnchor[2 * stop.slot + 1]!];
        ed.click(x, y);
      }
      const r = p.ropes[0];
      if (r?.end1 !== byIndex(a.rope[0].part) || r?.end2 !== byIndex(a.rope[1].part)) problems.push(`${a.part} : corde non tendue`);
      continue;
    }
    // Champs absents de la solution : ceux de l'enregistrement du bac (comme `applySolution`).
    const rec = records[a.part]!;
    const flip = a.flip ?? (["none", "x", "y", "xy"] as const)[(rec.flags2 >> 4) & 3]!;
    const d = s.types.get(p.type);
    const width = a.width ?? (d.f3C ? rec.width2 : undefined);
    const height = a.height ?? (d.f40 ? rec.height2 : undefined);
    const edges = retouch(s, p, { ...a, flip, width, height }, problems);
    // Pièce qui tourne par quarts (+0x0C & 0x600) : le retournement fait défiler ses orientations jusqu'à la bonne image.
    const appearance = a.appearance ?? rec.appearance;
    const flips = { none: 0, x: 0x10, y: 0x20, xy: 0x30 }[flip];
    if ((p.flags0C & 0x600) === 0x600) for (let i = 0; i < 64 && (p.frame !== appearance || (p.flags10 & 0x30) !== flips); i++) ed.flip(p, "turn");
    // Bascules (43ec0c) : le retournement en X fait passer la planche d'un bout à l'autre (image 0 ↔ 2), sans drapeau.
    else if (p.frame !== appearance && p.flags0C & 0x400 && ed.flip(p, "x") && p.frame !== appearance) ed.flip(p, "x");
    expected.push([p, appearance]);
    const [mx, my] = pointerFor(p, a.x!, a.y!, ed.grabX, ed.grabY);
    const result = ed.click(mx, my);
    if (result !== "placed") problems.push(`${a.part} : ${result}`);
    else if (p.px !== a.x || p.py !== a.y) problems.push(`${a.part} : posée en (${p.px}, ${p.py}) au lieu de (${a.x}, ${a.y})`);
    else {
      stretch(s, p, a.part, edges, problems);
      program(s, p, rec, appearance, programs, problems);
    }
    if (a.plug && p.links[4] !== byIndex(a.plug.part)) problems.push(`${a.part} : non branchée`);
    if (ed.held && a.pair !== undefined) {
      // Le partenaire neuf est en main : on le pose tout de suite (prendre une autre pièce le rendrait au bac).
      partners.set(a.pair, ed.held);
      const i = todo.findIndex((b) => b.part === a.pair);
      if (i >= 0) todo.unshift(...todo.splice(i, 1));
    }
  }
  if (ed.held) problems.push(`pièce ${ed.held.levIndex} encore en main`);
  // Image d'édition une fois tout posé (une prise ou un générateur changent d'image quand on les branche ou les relie).
  // Une prise où une fiche est branchée (+0x14 & 2) tire son image de ses branchements (slot 2) : l'image du LEV peut être
  // antérieure, le chargeur la recalcule de même ; on ne la compare pas.
  for (const [p, appearance] of expected) if (!(p.flags14 & 2 && (p.links[4] || p.links[5])) && p.editFrame !== appearance) problems.push(`${p.levIndex} (type ${p.type}) : image ${p.editFrame}, ${appearance} attendue`);
  return problems;
}

/**
 * Ordre de pose d'un joueur : une pièce à fiche ne se branche qu'en se posant près d'une prise déjà posée (438ea8), sur la
 * première sortie libre ; les prises passent donc avant leurs fiches, et la fiche de la sortie 0 avant celle de la sortie 1.
 */
export function plugOrder(parts: readonly Placement[]): Placement[] {
  const order = [...parts];
  for (const a of parts) {
    if (!a.plug) continue;
    const i = order.indexOf(a);
    const o = order.findIndex((b) => b.part === a.plug!.part);
    if (o > i) order.splice(i, 0, ...order.splice(o, 1));
  }
  for (let i = 0; i < order.length; i++) {
    const a = order[i]!;
    if (!a.plug || (a.plug.outlet ?? 0) !== 1) continue;
    const j = order.findIndex((b, k) => k > i && b.plug?.part === a.plug!.part && (b.plug.outlet ?? 0) === 0);
    if (j > i) order.splice(i, 0, ...order.splice(j, 1));
  }
  return order;
}

/** Retournement et taille de la pièce tenue (touches X, Y, + et − de 42f63c) ; rend les tailles restées à étirer. */
function retouch(s: Tim3Session, p: Part, a: Placement, problems: string[]): Edge[] {
  const ed = s.editor;
  const edges: Edge[] = [];
  if (a.flip !== undefined && (p.flags0C & 0x600) !== 0x600) {
    const want = { none: 0, x: 0x10, y: 0x20, xy: 0x30 }[a.flip];
    if ((p.flags10 & 0x10) !== (want & 0x10)) ed.flip(p, "x");
    if ((p.flags10 & 0x20) !== (want & 0x20)) ed.flip(p, "y");
    if ((p.flags10 & 0x30) !== want) problems.push(`${a.part} : retournement ${p.flags10 & 0x30}, ${want} attendu`);
  }
  for (const [axis, target] of [["w", a.width], ["h", a.height]] as const) {
    if (target === undefined) continue;
    for (let i = 0; i < 40; i++) {
      const v = axis === "w" ? p.boxW : p.boxH;
      const other = axis === "w" ? p.boxH : p.boxW;
      const delta = v < target ? 1 : -1;
      if (v === target || !ed.resize(p, delta)) break;
      if ((axis === "w" ? p.boxH : p.boxW) !== other) {
        // + et − changent l'autre axe (pièce plus haute que large) : on défait, la poignée du bord s'en chargera.
        ed.resize(p, delta > 0 ? -1 : 1);
        break;
      }
    }
    const v = axis === "w" ? p.boxW : p.boxH;
    if (v !== target) edges.push({ axis, target });
  }
  return edges;
}

/**
 * Taille hors de portée de + et − (l'autre axe) : étirée par la poignée du bord droit ou bas une fois posée (42fc4c…). Deux
 * passes, hauteur d'abord : le tuyau 97 met l'autre côté à 38 px quand on l'étire (44750d).
 */
function stretch(s: Tim3Session, p: Part, part: number, edges: Edge[], problems: string[]): void {
  const sorted = [...edges].sort((a, b) => (a.axis === b.axis ? 0 : a.axis === "h" ? -1 : 1));
  const value = (e: Edge) => (e.axis === "w" ? p.boxW : p.boxH);
  for (let pass = 0; pass < 2; pass++) {
    for (const e of sorted) {
      // Le bord suit la grille de 16 de l'aire, pas celle de la pièce (tuyau posé 3 px sous la grille) : trois points essayés.
      for (const k of [-8, 8, 0]) {
        if (value(e) === e.target) break;
        if (e.axis === "w") s.editor.resizeEdge(p, Zone.WidthRight, p.px + e.target + k, p.py);
        else s.editor.resizeEdge(p, Zone.HeightBottom, p.px, p.py + e.target + k);
      }
    }
  }
  for (const e of sorted) if (value(e) !== e.target) problems.push(`${part} : ${e.axis === "w" ? "largeur" : "hauteur"} ${value(e)}, ${e.target} attendue`);
}

/**
 * Poignée « programmer » (`Editor.program`) : choix dont l'image est celle de la solution, compteur du pistolet laser
 * (+0xFC du LEV), réglettes de la balle programmable (valeurs du LEV), puis « Terminé ».
 */
function program(s: Tim3Session, p: Part, rec: LevPart, appearance: number, rows: readonly ProgramRow[], problems: string[]): void {
  if (!PROGRAM_TYPES.includes(p.type) || rows.length === 0) return;
  const prog = s.editor.program(p, rows);
  if (!prog) {
    problems.push(`${rec.type} : pas de poignée « programmer »`);
    return;
  }
  const f = rec as unknown as Record<string, number>;
  if (prog.kind === "counter") {
    while (prog.counter < (f.behavior ?? 0) && prog.counter < LASER_GUN_MAX) prog.up();
    while (prog.counter > (f.behavior ?? 0)) prog.down();
  } else if (prog.kind === "ball" && rec.kind === "programmableBall") {
    for (const [k, v] of [["mass", rec.mass], ["elasticity", rec.elasticity], ["density", rec.density], ["friction", rec.friction]] as const) {
      const rank = BALL_STEPS[k].indexOf(v as never);
      if (rank < 0) problems.push(`${p.levIndex} : ${k} ${v} hors des paliers`);
      else prog.setBall(k, rank);
    }
  }
  // Prise laser 96 : l'image ajoute 7 par sortie branchée (slot 2, `parts-electric.md`) ; la couleur est l'image modulo 7.
  const i = prog.choices.findIndex((c) => c.frame === (p.type === 96 ? appearance % 7 : appearance));
  if (i >= 0 && prog.kind === "bucket") prog.setBucket(BUCKET_MAX - i);
  else if (i >= 0) for (let n = 0; n < 16 && prog.index !== i; n++) prog.down();
  if (!prog.done()) problems.push(`${p.levIndex} : programmation refusée (${prog.refusal})`);
}

interface Edge {
  axis: "w" | "h";
  target: number;
}

/** Pas où la session déclare le puzzle résolu (0 : jamais dans la limite). */
export function run(s: Tim3Session, limit: number): number {
  s.start();
  for (let k = 1; k <= limit; k++) if (s.tick().solved) return k;
  return 0;
}
