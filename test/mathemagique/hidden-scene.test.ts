import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/games/mathemagique/data/mohawk";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { Archive } from "../../src/games/mathemagique/engine/resources";
import { SceneId, type Scene } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import { HIDDEN_POLY } from "../../src/games/mathemagique/game/poly-config";
import { hiddenRewardId, parseHiddenPuzz } from "../../src/games/mathemagique/game/puzz";
import { rotateHiddenCells, type HiddenBoard, type HiddenPiece } from "../../src/games/mathemagique/game/puzzle-kit";
import { createHiddenScene, type HiddenScene } from "../../src/games/mathemagique/scenes/hidden";
import {
  borderShapeId,
  HIDDEN_FLAT_COLORS,
  photoRevealRects,
  pieceBorders,
  revealRect,
} from "../../src/games/mathemagique/scenes/hidden-view";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

// --- Fonctions pures (sans fichiers) ---

describe("Hidden : bordures des pièces", () => {
  const cell = (x: number, y: number) => ({ x, y });

  it("une cellule seule a ses quatre côtés et ses quatre coins convexes", () => {
    const [only] = pieceBorders({ cells: [cell(0, 0)] });
    expect(only).toMatchObject({ n: 2, e: 3, s: 4, w: 1, nw: 9, ne: 11, se: 12, sw: 10 });
  });

  it("un L : côtés absents entre cellules voisines, coin concave à l'angle rentrant", () => {
    // (0,0) (1,0) / (0,1) : la cellule (0,0) a des voisines à l'est et au sud, mais pas en diagonale (1,1).
    const borders = pieceBorders({ cells: [cell(0, 0), cell(1, 0), cell(0, 1)] });
    const corner = borders[0]!;
    expect(corner).toMatchObject({ n: 2, w: 1, e: 0, s: 0, nw: 9, se: 8, ne: 0, sw: 0 });
    // La cellule (1,0) : son côté ouest est une voisine, son sud est libre.
    expect(borders[1]).toMatchObject({ n: 2, e: 3, s: 4, w: 0, sw: 0 });
  });

  it("la photo est visible sur la cellule rétrécie de 5 px sur chaque côté exposé", () => {
    const [only] = pieceBorders({ cells: [cell(0, 0)] });
    expect(revealRect(only!, 53, 50, 60)).toEqual({ x: 58, y: 55, w: 50, h: 50 });
    const [west, east] = pieceBorders({ cells: [cell(0, 0), cell(1, 0)] });
    expect(revealRect(west!, 53, 50, 60)).toEqual({ x: 58, y: 55, w: 55, h: 50 });
    expect(revealRect(east!, 113, 50, 60)).toEqual({ x: 113, y: 55, w: 55, h: 50 });
  });

  it("les formes de bordure sont 12 par niveau", () => {
    expect(borderShapeId(5030, 0, 1)).toBe(5030);
    expect(borderShapeId(5030, 2, 12)).toBe(5030 + 24 + 11);
    expect(HIDDEN_FLAT_COLORS).toEqual([86, 61, 140]);
  });

  it("l'union des cellules posées couvre exactement les cellules rétrécies", () => {
    const piece = { id: 0, cells: [cell(0, 0)], w: 1, h: 1, cx: 83, cy: 80, placed: true } satisfies HiddenPiece;
    expect(photoRevealRects([piece], 60)).toEqual([{ x: 58, y: 55, w: 50, h: 50 }]);
  });
});

// --- Scène sur les vraies données ---

const ORIGIN = { x: 53, y: 50 };

/** Centre des boutons (hidden.md §1.7). */
const BUTTON = {
  level0: [68, 324],
  level1: [104, 324],
  level2: [140, 324],
  help: [244, 322],
  reset: [73, 362],
  rotate: [281, 323],
  exit: [136, 362],
} as const;

const TV = [173, 170] as const;
const POLY = [350, 360] as const;

const thumbCenter = (k: number): [number, number] => [59 + 78 * (k % 3) + 36, 56 + 78 * Math.floor(k / 3) + 36];

class HubStub implements Scene {
  entered = 0;
  constructor(private readonly services: () => MathServices) {}
  enter(): void {
    this.entered++;
  }
  leave(): void {
    this.services().endScene();
  }
  tick(): void {}
}

async function boot(options: { seed?: number; dragMode?: boolean; player?: boolean } = {}) {
  const host = new TestHost();
  host.audio.unlock();
  const engine = new Engine(host, { seed: options.seed ?? 3 });
  const services = installServices(engine);
  const hub = new HubStub(() => services);
  let scene!: HiddenScene;
  engine.register(SceneId.hub, () => hub);
  engine.register(SceneId.hidden, () => (scene = createHiddenScene(services) as HiddenScene));
  if (options.dragMode) engine.ctx.roster.roster.clickAndStick = false;
  let playerId = 0;
  if (options.player) {
    const added = engine.ctx.roster.roster.addPlayer("Test");
    if (!added.ok) throw new Error("joueur");
    playerId = added.id;
    engine.ctx.roster.currentPlayerId = playerId;
  }
  engine.start(SceneId.hidden);
  await runFor(engine, host, 100);
  const api = {
    host,
    engine,
    services,
    hub,
    playerId,
    get scene() {
      return scene;
    },
    run: (ms: number) => runFor(engine, host, ms),
    until: (done: () => boolean, limitMs = 120_000) => runUntil(engine, host, done, limitMs),
    phase: (name: string) => runUntil(engine, host, () => scene.phase === name),
    async click(x: number, y: number, ms = 100) {
      host.click(x, y);
      await runFor(engine, host, ms);
    },
    /** Passe l'accueil (SCR 2000 bloquant) jusqu'au menu. */
    async toMenu() {
      await runUntil(engine, host, () => scene.phase === "menu");
    },
    /** Choisit la vignette `k` et attend le début du jeu. */
    async startPuzzle(k: number) {
      await api.toMenu();
      await api.click(...thumbCenter(k));
      await runUntil(engine, host, () => scene.phase === "playing");
    },
  };
  return api;
}

type Api = Awaited<ReturnType<typeof boot>>;

/** Pavage de la grille `n × n` par les pièces (rotations seules) : pour chaque pièce, nombre de quarts de tour et coin de la boîte (cellules). */
function solve(board: HiddenBoard): Map<number, { turns: number; col: number; row: number }> | null {
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

  const search = (): boolean => {
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

/** Pose toutes les pièces par des clics (cliquer-poser) ou des glissés, en tournant avec Espace. */
async function placeAll(api: Api, drag: boolean): Promise<void> {
  const board = api.scene.board!;
  const plan = solve(board);
  expect(plan, "le découpage a un pavage").not.toBeNull();
  const c = board.cell;
  const { host } = api;
  while (!board.complete) {
    const piece = board.pieces.find((p) => !p.placed)!;
    const target = plan!.get(piece.id)!;
    // Un point de la pièce qui la désigne bien (la pièce du dessus d'abord).
    const b0 = board.boundsOf(piece);
    const spot = piece.cells
      .map((cell) => ({ x: b0.left + cell.x * c + Math.floor(c / 2), y: b0.top + cell.y * c + Math.floor(c / 2) }))
      .find((p) => board.pickAt(p.x, p.y)?.item === piece);
    expect(spot, `pièce ${piece.id} prenable`).toBeDefined();
    host.input.moveMouse(spot!.x, spot!.y);
    if (drag) host.input.mouseDown("left");
    else host.click(spot!.x, spot!.y);
    await api.run(100);
    expect(api.services.pointer.carried?.item).toBe(piece);
    for (let t = 0; t < target.turns; t++) {
      host.press("Space");
      await api.run(100);
    }
    expect(piece.cells.length).toBeGreaterThan(0);
    const b = board.boundsOf(piece);
    const grabX = host.input.mouseX - b.left;
    const grabY = host.input.mouseY - b.top;
    const dx = ORIGIN.x + target.col * c + grabX;
    const dy = ORIGIN.y + target.row * c + grabY;
    host.input.moveMouse(dx, dy);
    await api.run(100);
    if (drag) host.input.mouseUp("left");
    else host.click(dx, dy);
    await api.run(100);
    expect(piece.placed, `pièce ${piece.id} posée`).toBe(true);
  }
}

describe.skipIf(!hasOriginalFiles)("Hidden : scène (vraies données)", () => {
  it("accueil puis menu : les 9 vignettes du niveau vert sont à l'écran, la musique joue", async () => {
    const api = await boot();
    expect(api.scene.phase).toBe("welcome");
    expect(api.services.scr.running.map((a) => a.scrId)).toEqual([2000]);
    await api.toMenu();
    expect(api.services.scr.running).toHaveLength(0);
    expect(api.services.sound.musicPlaying).toBe(true);

    const hidden = new Archive("HIDDEN.DAT", MohawkArchive.parse(readOriginal("HIDDEN.DAT")));
    const screen = api.services.graphics.screen;
    for (const k of [0, 4, 8]) {
      const first = hidden.shpl(7800).firstShapeId;
      const thumb = hidden.shap(first + k);
      const x = 59 + 78 * (k % 3);
      const y = 56 + 78 * Math.floor(k / 3);
      for (const [dx, dy] of [[3, 3], [36, 36], [68, 40]] as const) expect(screen.get(x + dx, y + dy)).toBe(thumb.pixels[dy * 72 + dx]);
    }
    // Les 7 boutons sont posés (forme de repos).
    const buttons = hidden.shpl(5000).firstShapeId;
    expect(screen.get(52 + 16, 308 + 16)).toBe(hidden.shap(buttons).pixels[16 * 33 + 16]);
  });

  it("niveau : un visage change de menu (télé seule), le même niveau ne fait rien", async () => {
    const api = await boot();
    await api.toMenu();
    await api.click(...BUTTON.level0);
    expect(api.scene.phase).toBe("menu");
    await api.click(...BUTTON.level2);
    expect(api.scene.phase).toBe("transition");
    await api.phase("menu");
    expect(api.scene.level).toBe(2);
    const hidden = new Archive("HIDDEN.DAT", MohawkArchive.parse(readOriginal("HIDDEN.DAT")));
    const thumb = hidden.shap(hidden.shpl(7820).firstShapeId);
    expect(api.services.graphics.screen.get(59 + 36, 56 + 36)).toBe(thumb.pixels[36 * 72 + 36]);
  });

  it("vignette : découpage, pièces dispersées dans la pile, photo et récompense du bon niveau", async () => {
    const api = await boot();
    await api.toMenu();
    await api.click(...thumbCenter(4), 20);
    expect(api.scene.phase).toBe("launching");
    await api.phase("playing");
    const board = api.scene.board!;
    expect(api.scene.puzzle).toBe(4);
    expect(api.scene.rewardScr).toBe(5100 + 400);
    expect(api.scene.jingleSnd).toBeGreaterThanOrEqual(5020);
    expect(api.scene.jingleSnd).toBeLessThanOrEqual(5023);
    expect(board.level).toBe(0);
    expect(board.pieces.reduce((n, p) => n + p.cells.length, 0)).toBe(16);
    for (const piece of board.pieces) {
      const b = board.boundsOf(piece);
      expect(piece.placed).toBe(false);
      expect(b.left).toBeGreaterThanOrEqual(332 - 60);
      expect(b.right).toBeLessThanOrEqual(544 + 60);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.bottom).toBeLessThanOrEqual(432);
    }
    // Une pièce libre est un aplat de la couleur du niveau (86) sur ses cellules.
    const top = board.pieces[0]!;
    const b = board.boundsOf(top);
    const first = top.cells[0]!;
    expect(api.services.graphics.screen.get(b.left + first.x * 60 + 30, b.top + first.y * 60 + 30)).toBe(86);
  });

  it("niveau orange : cellules de 48 px, 25 cellules ; photo et récompense de la bonne série", async () => {
    const api = await boot();
    await api.toMenu();
    await api.click(...BUTTON.level1);
    await api.phase("menu");
    await api.click(...thumbCenter(2), 20);
    await api.phase("playing");
    expect(api.scene.board!.cell).toBe(48);
    expect(api.scene.board!.pieces.reduce((n, p) => n + p.cells.length, 0)).toBe(25);
    expect(api.scene.rewardScr).toBe(hiddenRewardId(1, 2));
    expect(api.scene.rewardScr).toBe(6200);
  });

  it("Reset garde le découpage, remet les pièces dans la pile ; un visage ramène au menu", async () => {
    const api = await boot();
    await api.startPuzzle(0);
    const board = api.scene.board!;
    const before = board.pieces.map((p) => p.id).sort();
    const plan = solve(board)!;
    // Pose une pièce à la main (sans tourner si possible) pour voir Reset la défaire.
    const piece = board.pieces[board.pieces.length - 1]!;
    const target = plan.get(piece.id)!;
    board.pieces.splice(board.pieces.indexOf(piece), 1);
    board.pieces.unshift(piece);
    for (let t = 0; t < target.turns; t++) rotateHiddenCells(piece);
    piece.cx = ORIGIN.x + target.col * 60 + Math.floor((piece.w * 60) / 2);
    piece.cy = ORIGIN.y + target.row * 60 + Math.floor((piece.h * 60) / 2);
    piece.placed = true;
    await api.click(...BUTTON.reset, 10);
    expect(api.scene.phase).toBe("resetting");
    await api.phase("playing");
    expect(api.scene.board).toBe(board);
    expect(board.pieces.map((p) => p.id).sort()).toEqual(before);
    expect(board.pieces.every((p) => !p.placed)).toBe(true);
    await api.click(...BUTTON.level1);
    expect(api.scene.phase).toBe("transition");
    await api.phase("menu");
    expect(api.scene.board).toBeNull();
    expect(api.scene.level).toBe(1);
  });

  it("Reset au menu ne fait rien", async () => {
    const api = await boot();
    await api.toMenu();
    await api.click(...BUTTON.reset, 200);
    expect(api.scene.phase).toBe("menu");
  });

  it("une pièce prise passe au-dessus ; Espace tourne la dernière pièce prise même lâchée", async () => {
    const api = await boot();
    await api.startPuzzle(1);
    const board = api.scene.board!;
    const piece = board.pieces.find((p) => p.cells.length > 1)!;
    const c = board.cell;
    const b = board.boundsOf(piece);
    const spot = piece.cells.map((cell) => ({ x: b.left + cell.x * c + 30, y: b.top + cell.y * c + 30 })).find((p) => board.pickAt(p.x, p.y)?.item === piece)!;
    await api.click(spot.x, spot.y);
    expect(board.pieces[0]).toBe(piece);
    expect(api.services.pointer.carried?.item).toBe(piece);
    const { w, h } = piece;
    api.host.press("Space");
    await api.run(100);
    expect(piece.w).toBe(h);
    expect(piece.h).toBe(w);
    // Dépose sur place (clic), puis Rotate : la pièce n'est plus tenue, elle est reprise, tournée et redéposée.
    const m = api.host;
    await api.click(m.input.mouseX, m.input.mouseY);
    expect(api.services.pointer.carried).toBeNull();
    await api.click(...BUTTON.rotate);
    expect(piece.w).toBe(w);
    expect(piece.h).toBe(h);
  });

  for (const drag of [false, true]) {
    it(`pose toutes les pièces (${drag ? "glisser" : "cliquer-poser"}) : jingle, SCR de fin, la télé rejoue, Exit ramène au hub`, async () => {
      const api = await boot({ dragMode: drag });
      await api.startPuzzle(2);
      expect(api.services.pointer.mode).toBe(drag ? "drag" : "clickAndStick");
      const reward = api.scene.rewardScr!;
      expect(reward).toBe(5100 + 200);

      await placeAll(api, drag);
      expect(api.scene.board!.complete).toBe(true);
      // Fin : musique coupée, jingle en entier, pièces désactivées.
      expect(api.scene.phase).toBe("jingle");
      expect(api.services.sound.musicPlaying).toBe(false);
      const wavesBefore = api.host.audio.waves.length;
      await api.phase("reward");
      expect(api.services.scr.running.map((a) => a.scrId)).toEqual([reward]);
      expect(api.host.audio.waves.length).toBeGreaterThan(wavesBefore);
      await api.phase("solved");
      expect(api.services.scr.running).toHaveLength(0);
      expect(api.services.sound.musicPlaying).toBe(true);

      // Un clic sur une pièce posée ne la reprend plus.
      const placed = api.scene.board!.pieces[0]!;
      const pb = api.scene.board!.boundsOf(placed);
      await api.click(pb.left + 30, pb.top + 30);
      expect(api.services.pointer.carried).toBeNull();

      // La télé rejoue la même animation.
      await api.click(...TV, 10);
      expect(api.scene.phase).toBe("reward");
      expect(api.services.scr.running.map((a) => a.scrId)).toEqual([reward]);
      await api.phase("solved");

      await api.click(...BUTTON.exit, 10);
      expect(api.scene.phase).toBe("leaving");
      await api.until(() => api.engine.scenes.currentId === SceneId.hub);
      expect(api.hub.entered).toBe(1);
      expect(api.host.exited).toBe(false);
    }, 120_000);
  }

  it("Reset après la fin remet le puzzle en jeu", async () => {
    const api = await boot();
    await api.startPuzzle(8);
    await placeAll(api, false);
    await api.phase("solved");
    await api.click(...BUTTON.reset, 10);
    await api.phase("playing");
    expect(api.scene.board!.pieces.every((p) => !p.placed)).toBe(true);
    // Le puzzle peut être refait.
    await placeAll(api, false);
    await api.phase("solved");
  }, 120_000);

  it("Exit au menu et la demande de sortie du moteur ramènent au hub", async () => {
    const api = await boot();
    await api.toMenu();
    expect(api.engine.requestExit()).toBe(true);
    await api.until(() => api.engine.scenes.currentId === SceneId.hub);

    const second = await boot();
    await second.toMenu();
    await second.click(...BUTTON.exit, 10);
    await second.until(() => second.engine.scenes.currentId === SceneId.hub);
  });

  it("aide de Poly : présentation longue la première fois (drapeau du roster), explication, sortie par un clic sur Poly", async () => {
    const api = await boot({ player: true });
    await api.toMenu();
    expect(api.engine.ctx.roster.roster.getVar(api.playerId, "hiddenPolyIntroSeen")).toBe(0);
    await api.click(...BUTTON.help, 10);
    const poly = api.scene.poly!;
    expect(poly.active).toBe(true);
    expect(poly.played[0]).toBe(HIDDEN_POLY.arrival);
    await api.until(() => poly.currentScr === HIDDEN_POLY.introLong);
    expect(api.engine.ctx.roster.roster.getVar(api.playerId, "hiddenPolyIntroSeen")).toBe(1);
    // Un clic coupe la présentation ; Espace n'agit pas pendant l'aide.
    await api.click(300, 100, 50);
    await api.until(() => poly.phase === "listening");
    expect(api.scene.key!({ code: "Space", key: " ", ctrl: false, shift: false, alt: false, repeat: false }, api.engine.ctx)).toBe(false);
    // Clic sur la télé au menu : explication du menu (25850), encadrée.
    await api.click(...TV, 10);
    await api.until(() => poly.played.includes(25850));
    expect(poly.played.slice(-2)).toEqual([25150, 25850]);
    await api.until(() => poly.phase === "listening", 300_000);
    expect(poly.played.slice(-3)).toEqual([25150, 25850, 25200]);
    // Poly elle-même : réplique de sortie puis départ.
    await api.click(...POLY, 10);
    await api.until(() => !poly.active, 300_000);
    expect(poly.played.at(-1)).toBe(HIDDEN_POLY.exit.kind === "tips" ? HIDDEN_POLY.exit.departure : -1);
    expect(api.scene.phase).toBe("menu");
    // Les boutons répondent de nouveau.
    await api.click(...BUTTON.level1);
    await api.phase("menu");
    expect(api.scene.level).toBe(1);
  }, 180_000);

  it("le puzzle est un pavage : les 27 découpages se résolvent avec les pièces de la scène", async () => {
    const hidden = new Archive("HIDDEN.DAT", MohawkArchive.parse(readOriginal("HIDDEN.DAT")));
    for (const level of [0, 1, 2]) {
      for (let draw = 0; draw < 9; draw++) {
        const puzz = parseHiddenPuzz(hidden.raw("PUZZ", 1000 + 32 * level + draw));
        const total = puzz.pieces.reduce((n, p) => n + p.cells.length, 0);
        expect(total).toBe((level + 4) ** 2);
      }
    }
  });
});
