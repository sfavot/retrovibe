/**
 * Hidden, Patterns, Sticklers : le robot résout un puzzle par des clics, des glissés et des touches (Espace pour tourner), avec l'un
 * ou l'autre mode de souris. Les solutions viennent de l'état public des scènes, comme dans les tests de scène.
 */
import { SceneId } from "../../../src/games/mathemagique/engine/scene";
import { puzzId } from "../../../src/games/mathemagique/game/puzz";
import { rotateHiddenCells, type HiddenBoard, type HiddenPiece, type PatternsPiece, type StickPiece, THUMB_LAYOUTS, thumbRect } from "../../../src/games/mathemagique/game/puzzle-kit";
import type { HiddenScene } from "../../../src/games/mathemagique/scenes/hidden";
import { PatternsScene } from "../../../src/games/mathemagique/scenes/patterns";
import { BUTTONS, type ButtonRole } from "../../../src/games/mathemagique/scenes/patterns-view";
import type { SticklersScene } from "../../../src/games/mathemagique/scenes/sticklers";
import { BUTTON_EDGES, pieceRect, piecePixelHit } from "../../../src/games/mathemagique/scenes/sticklers-view";
import { HUB_OBJECT } from "../../../src/games/mathemagique/scenes/hub-logic";
import { launch } from "./hub";
import { monkey } from "./chaos";
import { helpSession } from "./help";
import type { Robot } from "./robot";

// --- Hidden --------------------------------------------------------------------------------------------------------------------

const HIDDEN_ORIGIN = { x: 53, y: 50 };
const HIDDEN_BUTTON = { level: [[68, 324], [104, 324], [140, 324]], help: [244, 322], reset: [73, 362], rotate: [281, 323], exit: [136, 362] } as const;
const HIDDEN_TV: [number, number] = [173, 170];
const HIDDEN_POLY: [number, number] = [350, 360];

const hiddenThumb = (k: number): [number, number] => [59 + 78 * (k % 3) + 36, 56 + 78 * Math.floor(k / 3) + 36];

/** Pavage de la grille `n × n` par les pièces (rotations seules) : quarts de tour et coin de la boîte de chaque pièce. */
export function solveHidden(board: HiddenBoard): Map<number, { turns: number; col: number; row: number }> | null {
  const n = board.level + 4;
  const grid = new Array<boolean>(n * n).fill(false);
  const orientations = board.pieces.map((piece) => {
    const copy: HiddenPiece = { ...piece, cells: piece.cells.map((c) => ({ ...c })) };
    return Array.from({ length: 4 }, () => {
      const shape = { cells: copy.cells.map((c) => ({ ...c })), w: copy.w, h: copy.h };
      rotateHiddenCells(copy);
      return shape;
    });
  });
  const result = new Map<number, { turns: number; col: number; row: number }>();
  const used = new Set<number>();
  let steps = 0;
  const search = (): boolean => {
    if (++steps > 2_000_000) return false;
    const empty = grid.indexOf(false);
    if (empty < 0) return used.size === board.pieces.length;
    const ex = empty % n;
    const ey = Math.floor(empty / n);
    for (let i = 0; i < board.pieces.length; i++) {
      if (used.has(i)) continue;
      for (let turns = 0; turns < 4; turns++) {
        const o = orientations[i]![turns]!;
        const anchor = [...o.cells].sort((a, b) => a.y - b.y || a.x - b.x)[0]!;
        const col = ex - anchor.x;
        const row = ey - anchor.y;
        if (col < 0 || row < 0 || col + o.w > n || row + o.h > n) continue;
        if (o.cells.some((c) => grid[(row + c.y) * n + col + c.x])) continue;
        for (const c of o.cells) grid[(row + c.y) * n + col + c.x] = true;
        used.add(i);
        result.set(board.pieces[i]!.id, { turns, col, row });
        if (search()) return true;
        used.delete(i);
        result.delete(board.pieces[i]!.id);
        for (const c of o.cells) grid[(row + c.y) * n + col + c.x] = false;
      }
    }
    return false;
  };
  return search() ? result : null;
}

async function placeHiddenPieces(r: Robot, drag: boolean, max: number): Promise<boolean> {
  const scene = r.engine.scenes.current as HiddenScene;
  const board = scene.board!;
  const plan = solveHidden(board);
  if (!plan) {
    r.problem("jeu", `Hidden : le découpage du niveau ${scene.level} (vignette ${scene.puzzle}) n'a pas de pavage avec les pièces de la scène`);
    return false;
  }
  const c = board.cell;
  let placed = 0;
  while (!board.complete && placed < max) {
    const piece = board.pieces.find((p) => !p.placed)!;
    const target = plan.get(piece.id)!;
    const b0 = board.boundsOf(piece);
    const spot = piece.cells
      .map((cell) => ({ x: b0.left + cell.x * c + Math.floor(c / 2), y: b0.top + cell.y * c + Math.floor(c / 2) }))
      .find((p) => board.pickAt(p.x, p.y)?.item === piece);
    if (!spot) {
      r.problem("jeu", `Hidden : la pièce ${piece.id} ne peut pas être prise (aucun point de ses cellules ne la désigne)`);
      return false;
    }
    r.host.input.moveMouse(spot.x, spot.y);
    if (drag) r.host.input.mouseDown("left");
    else r.host.click(spot.x, spot.y);
    await r.run(100);
    if (r.services.pointer.carried?.item !== piece) {
      r.problem("jeu", `Hidden (${drag ? "glisser" : "cliquer-poser"}) : la pièce ${piece.id} n'est pas portée après la prise`);
      if (drag) r.host.input.mouseUp("left");
      return false;
    }
    for (let t = 0; t < target.turns; t++) await r.press("Space", " ", 100);
    const b = board.boundsOf(piece);
    const dx = HIDDEN_ORIGIN.x + target.col * c + (r.host.input.mouseX - b.left);
    const dy = HIDDEN_ORIGIN.y + target.row * c + (r.host.input.mouseY - b.top);
    r.host.input.moveMouse(dx, dy);
    await r.run(100);
    if (drag) r.host.input.mouseUp("left");
    else r.host.click(dx, dy);
    await r.run(100);
    if (!piece.placed) {
      r.problem("jeu", `Hidden (${drag ? "glisser" : "cliquer-poser"}) : la pièce ${piece.id} déposée sur sa case n'est pas posée`);
      return false;
    }
    placed++;
  }
  return true;
}

export async function playHidden(r: Robot, drag: boolean, withHelp: boolean): Promise<void> {
  if (!(await launch(r, HUB_OBJECT.television, SceneId.hidden, "Hidden"))) return;
  const scene = () => r.engine.scenes.current as HiddenScene;
  if (!(await r.until(() => scene().phase === "menu", 90_000, "Hidden : menu après l'accueil"))) return;
  if (withHelp) {
    await helpSession(r, "Hidden", HIDDEN_BUTTON.help, () => scene().poly?.active === true, HIDDEN_POLY, [HIDDEN_TV]);
    await r.until(() => scene().phase === "menu", 60_000, "Hidden : menu après l'aide");
  }
  const level = r.rng.below(3);
  if (level > 0) {
    const [lx, ly] = HIDDEN_BUTTON.level[level]!;
    await r.click(lx, ly, 100);
    if (!(await r.until(() => scene().phase === "menu" && scene().level === level, 60_000, `Hidden : menu du niveau ${level}`))) return;
  }
  const thumb = r.rng.below(9);
  await r.click(...hiddenThumb(thumb), 50);
  if (!(await r.until(() => scene().phase === "playing", 90_000, `Hidden : début du puzzle ${thumb}`))) return;
  r.note(`Hidden niveau ${level} vignette ${thumb} (${drag ? "glisser" : "cliquer-poser"})`);
  // Quelques pièces, puis Reset (la moitié du temps).
  if (r.rng.chance(0.5)) {
    await placeHiddenPieces(r, drag, 2);
    await r.click(...HIDDEN_BUTTON.reset, 50);
    if (await r.until(() => scene().phase === "playing", 60_000, "Hidden : Reset")) {
      const board = scene().board!;
      if (board.pieces.some((p) => p.placed)) r.problem("jeu", "Hidden : Reset laisse des pièces posées");
    }
  }
  if (!(await placeHiddenPieces(r, drag, 99))) return;
  await r.until(() => scene().phase === "solved", 180_000, "Hidden : fin du puzzle (jingle, animation de récompense)");
  // La télé rejoue l'animation.
  await r.click(...HIDDEN_TV, 50);
  if (await r.until(() => scene().phase === "reward" || scene().phase === "solved", 20_000, "Hidden : la télé rejoue")) {
    await r.until(() => scene().phase === "solved", 120_000, "Hidden : fin du rejeu");
  }
  r.checkRoster("Hidden résolu", false);
  if (r.rng.chance(0.5) && r.currentId === SceneId.hidden) await monkey(r, 4000, [[136, 362, 40], [...HIDDEN_BUTTON.help, 40]]);
  if (r.currentId !== SceneId.hidden) return;
  await r.leave("Hidden : Exit → hub", () => r.click(...HIDDEN_BUTTON.exit, 50));
}

// --- Patterns ------------------------------------------------------------------------------------------------------------------

function patternsButton(role: ButtonRole): [number, number] {
  const b = BUTTONS.find((def) => def.role === role)!;
  return [Math.floor((b.edges.left + b.edges.right) / 2), Math.floor((b.edges.top + b.edges.bottom) / 2)];
}

async function solvePatterns(r: Robot, scene: () => PatternsScene, drag: boolean): Promise<boolean> {
  const board = scene().currentBoard!;
  const { puzzle } = board;
  const correct = (p: PatternsPiece) => p.placed && p.rot === 0 && p.col === puzzle.col[p.id] && p.row === puzzle.row[p.id];
  for (let guard = 0; guard < 12; guard++) {
    const piece = board.pieces.find((p) => !correct(p));
    if (!piece) return true;
    const { cx, cy } = piece;
    if (drag) {
      r.host.input.moveMouse(cx, cy);
      r.host.input.mouseDown("left");
    } else r.host.click(cx, cy);
    await r.run(50);
    if (r.services.pointer.carried?.item !== piece) {
      r.problem("jeu", `Patterns (${drag ? "glisser" : "cliquer-poser"}) : la pièce ${piece.id} n'est pas portée après la prise`);
      if (drag) r.host.input.mouseUp("left");
      return false;
    }
    for (let k = (4 - piece.rot) % 4; k > 0; k--) await r.press("Space", " ", 40);
    const tx = 78 + 60 * puzzle.col[piece.id]! + Math.floor((60 * piece.w + 1) / 2);
    const ty = 76 + 60 * puzzle.row[piece.id]! + Math.floor((60 * piece.h + 1) / 2);
    r.host.input.moveMouse(tx, ty);
    await r.run(50);
    if (drag) r.host.input.mouseUp("left");
    else r.host.click(tx, ty);
    await r.run(60);
    if (!correct(piece)) {
      r.problem("jeu", `Patterns (${drag ? "glisser" : "cliquer-poser"}) : la pièce ${piece.id} déposée sur sa case n'est pas posée (rot ${piece.rot}, posée ${piece.placed})`);
      return false;
    }
  }
  return false;
}

export async function playPatterns(r: Robot, drag: boolean): Promise<void> {
  if (!(await launch(r, HUB_OBJECT.frame, SceneId.patterns, "Patterns"))) return;
  const scene = () => r.engine.scenes.current as PatternsScene;
  await r.run(2500);
  const level = r.rng.below(3);
  if (level > 0) await r.click(...patternsButton(level === 1 ? "orange" : "red"), 150);
  if (scene().puzzleSession.level !== level) r.problem("jeu", `Patterns : le bouton du niveau ${level} laisse le niveau ${scene().puzzleSession.level}`);
  const thumb = r.rng.below(9);
  const rect = thumbRect(THUMB_LAYOUTS.patterns, thumb);
  await r.click(rect.x + 36, rect.y + 36, 150);
  if (scene().puzzleSession.mode !== "playing") {
    r.problem("jeu", `Patterns : la vignette ${thumb} du niveau ${level} ne lance pas le puzzle (mode ${scene().puzzleSession.mode})`);
  } else {
    r.note(`Patterns niveau ${level} vignette ${thumb} (${drag ? "glisser" : "cliquer-poser"})`);
    if (r.rng.chance(0.4)) {
      await r.click(...patternsButton("reset"), 150);
      if (scene().puzzleSession.mode !== "playing") r.problem("jeu", "Patterns : Reset sort du mode jeu");
    }
    if (await solvePatterns(r, scene, drag)) {
      if (!scene().currentBoard!.solved) r.problem("jeu", "Patterns : toutes les pièces sont posées mais le puzzle n'est pas résolu");
      await r.until(() => scene().flowKind === "reward" || scene().flowKind === "free", 120_000, "Patterns : voix puis animation de récompense");
      if (r.rng.chance(0.5) && scene().flowKind === "reward") {
        await r.run(2000);
        await r.click(300, 200, 100);
      }
      await r.until(() => scene().flowKind === "free", 120_000, "Patterns : fin de l'animation de récompense");
      await r.click(200, 150, 100); // rejeu par un clic sur le tableau
      await r.until(() => scene().flowKind === "free", 120_000, "Patterns : fin du rejeu");
      await r.click(...patternsButton("reset"), 150);
    }
  }
  r.checkRoster("Patterns", false);
  if (r.rng.chance(0.5) && r.currentId === SceneId.patterns) await monkey(r, 4000, [[...patternsButton("exit"), 40], [...patternsButton("help"), 40]]);
  if (r.currentId !== SceneId.patterns) return;
  await r.leave("Patterns : Exit → hub", () => r.click(...patternsButton("exit"), 50));
}

// --- Sticklers -----------------------------------------------------------------------------------------------------------------

const stickButton = (i: number): [number, number] => {
  const [l, t, rr, b] = BUTTON_EDGES[i - 1]!;
  return [(l + rr) >> 1, (t + b) >> 1];
};

async function solveSticklers(r: Robot, drag: boolean): Promise<boolean> {
  const scene = r.engine.scenes.current as SticklersScene;
  const archive = r.engine.ctx.resources.require("STICKLER.DAT");
  const shapeOf = (piece: StickPiece) => {
    const snap = scene.inspect();
    return archive.shap(puzzId(snap.level, snap.puzzle!) + piece.shapeBase + piece.rotation);
  };
  const pickPoint = (piece: StickPiece): { x: number; y: number } | null => {
    const pieces = scene.inspect().pieces;
    const rank = pieces.indexOf(piece);
    const shape = shapeOf(piece);
    const rect = pieceRect(piece);
    const above = pieces.slice(0, rank).filter((p) => !p.placed);
    for (let py = 0; py < shape.height; py++) {
      for (let px = 0; px < shape.width; px++) {
        if (shape.pixels[py * shape.width + px] === 0) continue;
        const pt = { x: rect.x + px, y: rect.y + py };
        if (pt.x < 0 || pt.x >= 576 || pt.y < 0 || pt.y >= 432) continue;
        if (above.some((q) => piecePixelHit(q, shapeOf(q), pt.x, pt.y))) continue;
        return pt;
      }
    }
    return null;
  };
  const attempts = new Map<number, number>();
  for (let guard = 0; guard < 80; guard++) {
    const piece = scene.inspect().pieces.find((p) => !p.placed);
    if (!piece) return true;
    const from = pickPoint(piece);
    if (!from) {
      r.problem("jeu", `Sticklers : le fragment ${piece.id} est entièrement recouvert (aucun point à prendre)`);
      return false;
    }
    const to = { x: from.x + piece.targetCx - piece.cx, y: from.y + piece.targetCy - piece.cy };
    if (!drag) {
      r.host.click(from.x, from.y);
      await r.run(50);
      r.host.click(to.x, to.y);
      await r.run(50);
    } else {
      r.host.input.moveMouse(from.x, from.y);
      r.host.input.mouseDown("left");
      await r.run(50);
      r.host.input.moveMouse((from.x + to.x) >> 1, (from.y + to.y) >> 1);
      await r.run(50);
      r.host.input.moveMouse(to.x, to.y);
      await r.run(50);
      r.host.input.mouseUp("left");
      await r.run(50);
    }
    for (let k = 0; k < 4 && !piece.placed && piece.rotation !== 0; k++) await r.press("Space", " ", 40);
    if (!piece.placed) {
      // Un fragment tourné peut être poussé par les bords de la zone de jeu : on le reprend et on le replace (comme un joueur).
      const tries = (attempts.get(piece.id) ?? 0) + 1;
      attempts.set(piece.id, tries);
      if (tries > 4) {
        r.problem(
          "jeu",
          `Sticklers (${drag ? "glisser" : "cliquer-poser"}) : le fragment ${piece.id} n'est pas collé après ${tries} essais (rotation ${piece.rotation}/${piece.orientations}, centre ${piece.cx},${piece.cy}, cible ${piece.targetCx},${piece.targetCy}, taille ${piece.w}x${piece.h})`,
        );
        return false;
      }
    }
  }
  return false;
}

export async function playSticklers(r: Robot, drag: boolean, pick?: { level: number; thumb: number }): Promise<void> {
  if (!(await launch(r, HUB_OBJECT.easel, SceneId.sticklers, "Sticklers"))) return;
  const scene = () => r.engine.scenes.current as SticklersScene;
  await r.run(2500);
  const level = pick?.level ?? r.rng.below(3);
  if (level > 0) await r.click(...stickButton(level + 1), 150);
  if (scene().inspect().level !== level) r.problem("jeu", `Sticklers : le bouton du niveau ${level} laisse le niveau ${scene().inspect().level}`);
  const thumb = pick?.thumb ?? r.rng.below(9);
  const rect = thumbRect(THUMB_LAYOUTS.sticklers, thumb);
  await r.click(rect.x + 36, rect.y + 36, 200);
  if (scene().inspect().mode !== "playing") {
    r.problem("jeu", `Sticklers : la vignette ${thumb} du niveau ${level} ne lance pas le puzzle (mode ${scene().inspect().mode})`);
  } else {
    r.note(`Sticklers niveau ${level} vignette ${thumb} (${drag ? "glisser" : "cliquer-poser"})`);
    if (r.rng.chance(0.4)) {
      await r.click(...stickButton(5), 150); // Reset
      if (scene().inspect().mode !== "playing") r.problem("jeu", "Sticklers : Reset sort du mode jeu");
    }
    if (await solveSticklers(r, drag)) {
      await r.until(() => scene().inspect().mode === "solved", 30_000, "Sticklers : mode résolu");
      if (r.rng.chance(0.5)) {
        await r.run(3000);
        await r.click(300, 200, 100);
      }
      await r.until(() => scene().inspect().reward === null, 180_000, "Sticklers : fin de l'animation de récompense");
    }
  }
  r.checkRoster("Sticklers", false);
  if (r.rng.chance(0.5) && r.currentId === SceneId.sticklers) await monkey(r, 4000, [[...stickButton(7), 40], [...stickButton(4), 40]]);
  if (r.currentId !== SceneId.sticklers) return;
  await r.leave("Sticklers : Exit → hub", () => r.click(...stickButton(7), 50));
}
