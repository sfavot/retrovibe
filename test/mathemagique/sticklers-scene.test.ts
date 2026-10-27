import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import type { ShapeList } from "../../src/data/mohawk/shpl";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { Palette } from "../../src/games/mathemagique/engine/graphics/palette";
import { Archive } from "../../src/games/mathemagique/engine/resources";
import { SceneId } from "../../src/games/mathemagique/engine/scene";
import { installServices } from "../../src/games/mathemagique/engine/services";
import { parseSticklersPuzz, puzzId, rewardId } from "../../src/games/mathemagique/game/puzz";
import { STICKLERS, thumbRect, THUMB_LAYOUTS, type StickPiece } from "../../src/games/mathemagique/game/puzzle-kit";
import { createSticklersScene } from "../../src/games/mathemagique/scenes/sticklers";
import {
  BUTTON_EDGES,
  BUTTON_PRESSED_EDGES,
  HYSTERESIS,
  HitHysteresis,
  INK_HOVER,
  INK_PIECE,
  partialShpl,
  pieceRect,
  piecePixelHit,
} from "../../src/games/mathemagique/scenes/sticklers-view";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

const real = describe.skipIf(!hasOriginalFiles);

// --- Aides pures ---------------------------------------------------------------------------------------------------------------

function shplOf(first: number, count: number): ShapeList {
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = i % 251;
  return { firstShapeId: 1, shapeCount: 1, paletteFirst: first, rgb };
}

describe("sticklers-view : palette partielle", () => {
  it("ne garde que les entrées 154 à 185", () => {
    const shpl = shplOf(10, 236);
    const part = partialShpl(shpl);
    expect(part.paletteFirst).toBe(154);
    expect(part.rgb.length / 3).toBe(32);
    expect([...part.rgb.subarray(0, 3)]).toEqual([...shpl.rgb.subarray((154 - 10) * 3, (154 - 10) * 3 + 3)]);
  });

  it("une SHPL qui ne couvre pas la plage donne une part vide", () => {
    expect(partialShpl(shplOf(156, 14), 10, 20).rgb.length).toBe(0);
    const inside = partialShpl(shplOf(156, 14));
    expect(inside.paletteFirst).toBe(156);
    expect(inside.rgb.length / 3).toBe(14);
  });
});

describe("sticklers-view : prise au pixel avec hystérésis", () => {
  const shape = { width: 40, height: 4, pitch: 40, flags: 0, bitsPerPixel: 1 as const, pixels: new Uint8Array(160), consumed: 0, declaredEnd: 0 };
  shape.pixels[0] = 1; // seul pixel allumé : (0, 0)
  const piece = { id: 0, orientations: 1, rotation: 0, placed: false, shapeBase: 3, targetCx: 0, targetCy: 0, cx: 120, cy: 100, w: 40, h: 4 } as StickPiece;
  const left = piece.cx - 20;
  const top = piece.cy - 2;

  it("sans succès précédent, il faut viser le trait", () => {
    const h = new HitHysteresis();
    expect(h.test(piece, shape, left + 5, top + 1)).toBe(false);
    expect(h.test(piece, shape, left, top)).toBe(true);
  });

  it("après un succès, un point à moins de 20 px en x et y est accepté sans test de pixel (19 oui, 20 non)", () => {
    const h = new HitHysteresis();
    h.test(piece, shape, left, top);
    expect(h.test(piece, shape, left + HYSTERESIS - 1, top + 3)).toBe(true);
    const h2 = new HitHysteresis();
    h2.test(piece, shape, left, top);
    // x = left + 20 est hors de l'hystérésis ; il reste dans le rectangle (40 de large) mais pas sur le trait.
    expect(h2.test(piece, shape, left + HYSTERESIS, top)).toBe(false);
  });

  it("la cible doit être la même fragment, et le point dans son rectangle", () => {
    const h = new HitHysteresis();
    h.test(piece, shape, left, top);
    expect(h.test({ ...piece, shapeBase: 4 }, shape, left + 5, top + 1)).toBe(false);
    expect(h.test(piece, shape, left - 1, top)).toBe(false);
    h.reset();
    expect(h.test(piece, shape, left + 5, top + 1)).toBe(false);
  });
});

// --- Scène sur les vraies données -----------------------------------------------------------------------------------------------

type Mode = "clickAndStick" | "drag";

async function boot(options: { mode?: Mode; ambient?: boolean; player?: boolean } = {}) {
  const host = new TestHost();
  const engine = new Engine(host, { seed: 11 });
  const services = installServices(engine);
  const roster = engine.ctx.roster;
  roster.roster.clickAndStick = (options.mode ?? "clickAndStick") === "clickAndStick";
  roster.roster.ambient = options.ambient ?? true;
  let playerId = 0;
  if (options.player ?? true) {
    const added = roster.roster.addPlayer("Test");
    if (!added.ok) throw new Error("joueur");
    playerId = added.id;
    roster.currentPlayerId = playerId;
  }
  const scene = createSticklersScene(services);
  const hub = { entered: 0 };
  engine.register(SceneId.sticklers, () => scene);
  engine.register(SceneId.hub, () => ({
    enter: () => void hub.entered++,
    leave: () => {},
    tick: () => {},
  }));
  engine.start(SceneId.sticklers);
  await runFor(engine, host, 300);
  const archive = new Archive("STICKLER.DAT", MohawkArchive.parse(readOriginal("STICKLER.DAT")));
  return { host, engine, services, scene, roster, playerId, hub, archive };
}

type Rig = Awaited<ReturnType<typeof boot>>;

const frames = (rig: Rig, n: number) => runFor(rig.engine, rig.host, n * (1000 / 60));

/** Centre de la vignette `k` (0 à 8). */
function thumbCenter(k: number) {
  const r = thumbRect(THUMB_LAYOUTS.sticklers, k);
  return { x: r.x + 36, y: r.y + 36 };
}

const buttonCenter = (i: number) => {
  const [l, t, r, b] = BUTTON_EDGES[i - 1]!;
  return { x: (l + r) >> 1, y: (t + b) >> 1 };
};

/** Laisse finir les stores vénitiens en cours (15 ou 30 ticks, éventuellement deux à la suite). */
async function settle(rig: Rig) {
  for (let guard = 0; guard < 200 && rig.scene.inspect().transitioning; guard++) await frames(rig, 1);
}

async function clickAt(rig: Rig, p: { x: number; y: number }, n = 4) {
  rig.host.click(p.x, p.y);
  await frames(rig, n);
  await settle(rig);
}

async function chooseLevel(rig: Rig, level: number) {
  await clickAt(rig, buttonCenter(level + 1));
}

async function choosePuzzle(rig: Rig, level: number, k: number) {
  if (level !== rig.scene.inspect().level) await chooseLevel(rig, level);
  await clickAt(rig, thumbCenter(k));
  await frames(rig, 2);
}

const shapeOf = (rig: Rig, piece: StickPiece) => {
  const snap = rig.scene.inspect();
  const first = puzzId(snap.level, snap.puzzle!);
  return rig.archive.shap(first + piece.shapeBase + piece.rotation);
};

/** Un pixel du masque du fragment qu'aucun fragment libre plus haut dans la pile ne recouvre : la prise y touchera bien ce fragment. */
function pickPoint(rig: Rig, piece: StickPiece): { x: number; y: number } {
  const pieces = rig.scene.inspect().pieces;
  const rank = pieces.indexOf(piece);
  const shape = shapeOf(rig, piece);
  const r = pieceRect(piece);
  const above = pieces.slice(0, rank).filter((p) => !p.placed);
  for (let py = 0; py < shape.height; py++) {
    for (let px = 0; px < shape.width; px++) {
      if (shape.pixels[py * shape.width + px] === 0) continue;
      const pt = { x: r.x + px, y: r.y + py };
      if (pt.x < 0 || pt.x >= 576 || pt.y < 0 || pt.y >= 432) continue;
      if (above.some((q) => piecePixelHit(q, shapeOf(rig, q), pt.x, pt.y))) continue;
      return pt;
    }
  }
  throw new Error(`fragment ${piece.id} entièrement recouvert`);
}

/** Prend le fragment, le dépose pour que son centre tombe à `target + offset`. */
async function moveTo(rig: Rig, piece: StickPiece, offset = { x: 0, y: 0 }, mode: Mode = "clickAndStick") {
  const from = pickPoint(rig, piece);
  const to = { x: from.x + piece.targetCx - piece.cx + offset.x, y: from.y + piece.targetCy - piece.cy + offset.y };
  if (mode === "clickAndStick") {
    rig.host.click(from.x, from.y);
    await frames(rig, 3);
    rig.host.click(to.x, to.y);
    await frames(rig, 3);
  } else {
    rig.host.input.moveMouse(from.x, from.y);
    rig.host.input.mouseDown("left");
    await frames(rig, 3);
    rig.host.input.moveMouse((from.x + to.x) >> 1, (from.y + to.y) >> 1);
    await frames(rig, 3);
    rig.host.input.moveMouse(to.x, to.y);
    await frames(rig, 3);
    rig.host.input.mouseUp("left");
    await frames(rig, 3);
  }
}

/** Résout le puzzle affiché par prises et dépôts simulés, rotation à la touche Espace. */
async function solve(rig: Rig, mode: Mode) {
  for (let guard = 0; guard < 40; guard++) {
    const piece = rig.scene.inspect().pieces.find((p) => !p.placed);
    if (!piece) return;
    await moveTo(rig, piece, { x: 0, y: 0 }, mode);
    for (let r = 0; r < 4 && !piece.placed; r++) {
      rig.host.press("Space");
      await frames(rig, 2);
    }
    if (!piece.placed) throw new Error(`fragment ${piece.id} non collé (rotation ${piece.rotation})`);
  }
  throw new Error("trop de passes");
}

const finishReward = (rig: Rig) => runUntil(rig.engine, rig.host, () => rig.scene.inspect().reward === null);

real("Super Sticklers : entrée et menu", () => {
  it("entre au menu vert, 9 vignettes, musique 100 selon la préférence Ambient", async () => {
    const rig = await boot();
    const snap = rig.scene.inspect();
    expect(snap).toMatchObject({ mode: "menu", level: 0, puzzle: null, pieces: [] });
    expect(rig.services.sound.musicPlaying).toBe(true);
    // Les vignettes sont dessinées (une vignette de 72×72 : pas de brique du fond).
    const t = thumbCenter(4);
    const frame = rig.host.frames.at(-1)!;
    const expected = rig.archive.shap(2020 + 4).pixels[36 * 72 + 36];
    expect(frame.pixels[t.y * 576 + t.x]).toBe(expected);

    const quiet = await boot({ ambient: false });
    expect(quiet.services.sound.musicPlaying).toBe(false);
  });

  it("peint tout l'écran à l'entrée : aucun pixel de l'image précédente ne survit", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 11 });
    const services = installServices(engine);
    // Une couleur que le décor n'emploie nulle part (le fond SHPL 104 et ses vignettes).
    const archive = new Archive("STICKLER.DAT", MohawkArchive.parse(readOriginal("STICKLER.DAT")));
    const used = new Set<number>([...archive.shap(104).pixels]);
    for (let i = 0; i < 2000; i++) for (const id of [2000 + i]) if (archive.has("SHAP", id)) archive.shap(id).pixels.forEach((v) => used.add(v));
    const marker = [...Array(256).keys()].find((v) => !used.has(v))!;
    services.graphics.screen.fill(marker);
    const scene = createSticklersScene(services);
    engine.register(SceneId.sticklers, () => scene);
    engine.start(SceneId.sticklers);
    await runFor(engine, host, 300);
    const out = host.frames.at(-1)!.pixels;
    expect(out.includes(marker)).toBe(false);
  });

  it("ne pousse que les entrées 154 à 185 de la palette du menu", async () => {
    const rig = await boot();
    const background = new Palette();
    background.loadShpl(rig.archive.shpl(104));
    const menu = new Palette();
    menu.loadShpl(rig.archive.shpl(2020));
    const colors = rig.services.graphics.palette.colors;
    for (const i of [11, 100, 153, 186, 245]) expect([...colors.subarray(i * 3, i * 3 + 3)]).toEqual([...background.colors.subarray(i * 3, i * 3 + 3)]);
    for (const i of [154, 155, 163, 185]) expect([...colors.subarray(i * 3, i * 3 + 3)]).toEqual([...menu.colors.subarray(i * 3, i * 3 + 3)]);
  });

  it("le niveau est toujours vert à l'entrée ; les boutons de niveau changent de menu, le niveau courant ne fait rien", async () => {
    const rig = await boot();
    await chooseLevel(rig, 2);
    expect(rig.scene.inspect()).toMatchObject({ mode: "menu", level: 2 });
    await chooseLevel(rig, 2);
    expect(rig.scene.inspect()).toMatchObject({ mode: "menu", level: 2 });
    const t = thumbCenter(0);
    expect(rig.host.frames.at(-1)!.pixels[t.y * 576 + t.x]).toBe(rig.archive.shap(2040).pixels[36 * 72 + 36]);
    // Retour du puzzle au menu par un bouton de niveau.
    await choosePuzzle(rig, 2, 0);
    expect(rig.scene.inspect().mode).toBe("playing");
    await chooseLevel(rig, 0);
    expect(rig.scene.inspect()).toMatchObject({ mode: "menu", level: 0, pieces: [] });
  });

  it("survol d'une vignette : son 2010 et cadre teinté 163 + niveau", async () => {
    const rig = await boot();
    const waves = rig.host.audio.waves.length;
    const c = thumbCenter(1);
    rig.host.input.moveMouse(c.x, c.y);
    await frames(rig, 3);
    expect(rig.scene.inspect().hoverThumb).toBe(1);
    expect(rig.host.audio.waves.length).toBeGreaterThan(waves);
    // Le cadre (forme 10, 80×80) est dessiné 4 px autour de la vignette, à l'encre 163 au niveau vert.
    const r = thumbRect(THUMB_LAYOUTS.sticklers, 1);
    const frame = rig.archive.shap(2029);
    const out = rig.host.frames.at(-1)!.pixels;
    let drawn = 0;
    for (let py = 0; py < 80; py++) for (let px = 0; px < 80; px++) if (frame.pixels[py * 80 + px] !== 0 && out[(r.y - 4 + py) * 576 + (r.x - 4 + px)] === 163) drawn++;
    expect(drawn).toBeGreaterThan(100);
    rig.host.input.moveMouse(5, 5);
    await frames(rig, 3);
    expect(rig.scene.inspect().hoverThumb).toBe(-1);
  });
});

real("Super Sticklers : puzzle", () => {
  it("choisit le puzzle 2100 : 8 fragments éparpillés à droite, gabarit dans le chevalet, palette du puzzle", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const snap = rig.scene.inspect();
    expect(snap).toMatchObject({ mode: "playing", level: 0, puzzle: 0 });
    expect(snap.pieces).toHaveLength(8);
    const puzz = parseSticklersPuzz(rig.archive.raw("PUZZ", 2100));
    expect(puzz.count).toBe(8);
    for (const p of snap.pieces) {
      expect(p.placed).toBe(false);
      const r = pieceRect(p);
      // Centre dans la zone d'éparpillement (295,2,575,379).
      expect(p.cx).toBeGreaterThanOrEqual(295);
      expect(p.cx).toBeLessThan(575);
      expect(p.cy).toBeGreaterThanOrEqual(2);
      expect(p.cy).toBeLessThanOrEqual(379);
      expect(r.w).toBeGreaterThan(0);
    }
    const frame = rig.host.frames.at(-1)!;
    // Gabarit 250×250 à (40,29) : index 154 (lignes) ou 155 (fond) au centre.
    expect([154, 155]).toContain(frame.pixels[150 * 576 + 160]);
    const colors = rig.services.graphics.palette.colors;
    expect(colors[154 * 3]).toBe(251);
    expect(colors[155 * 3]).toBe(255);
    // Entrées hors de 154–185 : celles du fond, pas du puzzle (rembourrage gris).
    const bg = new Palette();
    bg.loadShpl(rig.archive.shpl(104));
    expect([...colors.subarray(100 * 3, 100 * 3 + 3)]).toEqual([...bg.colors.subarray(100 * 3, 100 * 3 + 3)]);
  });

  it("niveau rouge : la miniature 100×100 est dessinée à (300,30) et aucun fragment ne la recouvre", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 2, 0);
    const mini = rig.archive.shap(puzzId(2, 0) + 1);
    expect([mini.width, mini.height]).toEqual([100, 100]);
    const frame = rig.host.frames.at(-1)!;
    expect(frame.pixels[80 * 576 + 350]).toBe(mini.pixels[50 * 100 + 50]);
    for (const p of rig.scene.inspect().pieces) {
      const r = pieceRect(p);
      const overlaps = r.x < 395 && 295 < r.x + r.w && r.y < 125 && 25 < r.y + r.h;
      expect(overlaps).toBe(false);
    }
  });

  it("les fragments sont tintés : noir 245 au repos, accent 183 au survol", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const piece = rig.scene.inspect().pieces[1]!;
    const pt = pickPoint(rig, piece);
    rig.host.input.moveMouse(5, 5);
    await frames(rig, 3);
    expect(rig.host.frames.at(-1)!.pixels[pt.y * 576 + pt.x]).toBe(INK_PIECE);
    rig.host.input.moveMouse(pt.x, pt.y);
    await frames(rig, 3);
    expect(rig.host.frames.at(-1)!.pixels[pt.y * 576 + pt.x]).toBe(INK_HOVER);
  });

  it("prise au pixel : un clic dans le rectangle mais hors du trait ne prend rien", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    // Cherche un point dans le rectangle d'un fragment fin, hors masque, hors de tout autre fragment, hors de l'hystérésis.
    const pieces = rig.scene.inspect().pieces;
    let blank: { x: number; y: number } | null = null;
    for (const p of pieces.slice(1)) {
      const r = pieceRect(p);
      const shape = shapeOf(rig, p);
      for (let py = 0; py < r.h && !blank; py += 3) {
        for (let px = 0; px < r.w && !blank; px += 3) {
          const pt = { x: r.x + px, y: r.y + py };
          if (shape.pixels[py * r.w + px] !== 0 || pt.x < 296 || pt.x > 570 || pt.y < 4) continue;
          if (pieces.some((q) => piecePixelHit(q, shapeOf(rig, q), pt.x, pt.y))) continue;
          blank = pt;
        }
      }
      if (blank) break;
    }
    expect(blank).not.toBeNull();
    const order = pieces.map((p) => p.id);
    await clickAt(rig, blank!);
    await clickAt(rig, { x: blank!.x, y: blank!.y + 1 });
    expect(rig.services.pointer.carried).toBeNull();
    expect(rig.scene.inspect().pieces.map((p) => p.id)).toEqual(order);
  });

  it("collage : tolérance de 10 px incluse (10 collé, 11 non), recentré exactement", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const [a, b] = rig.scene.inspect().pieces.filter((p) => p.rotation === 0);
    expect(a && b).toBeTruthy();
    await moveTo(rig, a!, { x: 10, y: 10 });
    expect(a!.placed).toBe(true);
    expect([a!.cx, a!.cy]).toEqual([a!.targetCx, a!.targetCy]);
    await moveTo(rig, b!, { x: 11, y: 0 });
    expect(b!.placed).toBe(false);
    await moveTo(rig, b!, { x: 0, y: -11 });
    expect(b!.placed).toBe(false);
    await moveTo(rig, b!, { x: -10, y: -10 });
    expect(b!.placed).toBe(true);
    // Un fragment collé n'est plus saisissable.
    const at = { x: a!.cx, y: a!.cy };
    await clickAt(rig, at);
    expect(rig.services.pointer.carried).toBeNull();
  });

  it("orientation : un fragment mal orienté ne se colle pas, Espace le tourne sur place et le colle", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const turned = rig.scene.inspect().pieces.find((p) => p.rotation !== 0)!;
    expect(turned.orientations).toBe(4);
    const waves = rig.host.audio.waves.length;
    await moveTo(rig, turned);
    expect(turned.placed).toBe(false);
    for (let i = 0; i < 4 && !turned.placed; i++) {
      rig.host.press("Space");
      await frames(rig, 2);
    }
    expect(turned.placed).toBe(true);
    expect(turned.rotation).toBe(0);
    expect(rig.host.audio.waves.length).toBeGreaterThan(waves);
  });

  it("le bouton Rotate tourne le dernier fragment saisi", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const turned = rig.scene.inspect().pieces.find((p) => p.orientations === 4)!;
    await moveTo(rig, turned, { x: 0, y: 80 });
    expect(rig.scene.inspect().pieces[0]).toBe(turned);
    const r = turned.rotation;
    await clickAt(rig, buttonCenter(6));
    expect(turned.rotation).toBe((r + 1) & 3);
  });

  it("Espace pendant la prise (cliquer-poser) tourne le fragment tenu sans le lâcher, centre conservé", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const piece = rig.scene.inspect().pieces.find((p) => p.orientations === 4)!;
    const from = pickPoint(rig, piece);
    rig.host.click(from.x, from.y);
    await frames(rig, 3);
    expect(rig.services.pointer.carried).not.toBeNull();
    const center = { x: piece.cx, y: piece.cy };
    const r = piece.rotation;
    rig.host.press("Space");
    await frames(rig, 3);
    expect(piece.rotation).toBe((r + 1) & 3);
    expect(rig.services.pointer.carried).not.toBeNull();
    expect(Math.abs(piece.cx - center.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(piece.cy - center.y)).toBeLessThanOrEqual(1);
  });

  it("un fragment lâché sur le bandeau des boutons est repoussé dehors", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const piece = rig.scene.inspect().pieces[0]!;
    const from = pickPoint(rig, piece);
    rig.host.click(from.x, from.y);
    await frames(rig, 3);
    rig.host.click(150, 330);
    await frames(rig, 3);
    const r = pieceRect(piece);
    const band = STICKLERS.buttons;
    const inside = r.x < band.right && band.left < r.x + r.w && r.y < band.bottom && band.top < r.y + r.h;
    expect(inside).toBe(false);
  });

  it("résout un puzzle au cliquer-poser : récompense SCR 8000, musique coupée puis relancée, rejouable en cliquant le chevalet", async () => {
    const rig = await boot({ mode: "clickAndStick" });
    await choosePuzzle(rig, 0, 0);
    await solve(rig, "clickAndStick");
    expect(rig.scene.inspect()).toMatchObject({ mode: "solved", reward: rewardId(0, 0) });
    expect(rig.services.sound.musicPlaying).toBe(false);
    expect(rig.scene.inspect().pieces.every((p) => p.placed && p.cx === p.targetCx && p.cy === p.targetCy)).toBe(true);
    await finishReward(rig);
    expect(rig.services.sound.musicPlaying).toBe(true);
    expect(rig.scene.inspect().mode).toBe("solved");

    // Rejouer : un clic sur le chevalet relance la même animation (et un clic la coupe).
    await clickAt(rig, { x: 160, y: 150 }, 3);
    expect(rig.scene.inspect().reward).toBe(8000);
    await runFor(rig.engine, rig.host, 500);
    expect(rig.scene.inspect().reward).toBe(8000);
    await clickAt(rig, { x: 160, y: 150 }, 3);
    expect(rig.scene.inspect().reward).toBeNull();
    // L'état « résolu » est conservé : pas de saisie possible, les fragments sont collés.
    expect(rig.scene.inspect().mode).toBe("solved");
  }, 60_000);

  it("résout un puzzle au glisser : niveau orange, récompense 8000 + 50 × (9 × 1 + 2)", async () => {
    const rig = await boot({ mode: "drag" });
    await choosePuzzle(rig, 1, 2);
    expect(rig.scene.inspect()).toMatchObject({ level: 1, puzzle: 2 });
    await solve(rig, "drag");
    expect(rig.scene.inspect()).toMatchObject({ mode: "solved", reward: rewardId(1, 2) });
    expect(rewardId(1, 2)).toBe(8550);
    await finishReward(rig);
  }, 60_000);

  it("Reset : réparpille et décolle les fragments, y compris depuis un puzzle terminé (palette du puzzle rétablie)", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const piece = rig.scene.inspect().pieces.find((p) => p.rotation === 0)!;
    await moveTo(rig, piece);
    expect(piece.placed).toBe(true);
    const waves = rig.host.audio.waves.length;
    await clickAt(rig, buttonCenter(5));
    expect(rig.host.audio.waves.length).toBeGreaterThan(waves);
    expect(rig.scene.inspect().pieces.every((p) => !p.placed)).toBe(true);
    expect(rig.scene.inspect().mode).toBe("playing");

    await solve(rig, "clickAndStick");
    await finishReward(rig);
    await clickAt(rig, buttonCenter(5));
    const snap = rig.scene.inspect();
    expect(snap).toMatchObject({ mode: "playing", reward: null });
    expect(snap.pieces.every((p) => !p.placed)).toBe(true);
    const colors = rig.services.graphics.palette.colors;
    expect(colors[154 * 3]).toBe(251);
    // Le fragment reste saisissable après le Reset.
    const again = snap.pieces.find((p) => p.rotation === 0)!;
    await moveTo(rig, again);
    expect(again.placed).toBe(true);
    // Reset au menu : rien.
    await chooseLevel(rig, 1);
    await clickAt(rig, buttonCenter(5));
    expect(rig.scene.inspect().mode).toBe("menu");
  }, 60_000);

  it("boutons enfoncés : la forme « appuyé » est posée à son rectangle, sans reste de la forme normale", async () => {
    const rig = await boot();
    // L'animation d'accueil passe sur le décor et le restaure à la fin : on attend qu'elle soit finie.
    await runUntil(rig.engine, rig.host, () => rig.services.scr.running.length === 0);
    await frames(rig, 3);
    const wall = rig.archive.shap(104);
    const screen = rig.services.graphics.screen;
    for (let i = 0; i < BUTTON_EDGES.length; i++) {
      const [l, t, r, b] = BUTTON_EDGES[i]!;
      const [pl, pt] = BUTTON_PRESSED_EDGES[i]!;
      const pressed = rig.archive.shap(2001 + 2 * i);
      const normal = rig.archive.shap(2000 + 2 * i);
      // Attendu : le mur, la forme dessinée par-dessus (0 = transparent), sans jamais mélanger les deux formes.
      const expected = (shape: typeof pressed, ox: number, oy: number, x: number, y: number) => {
        const v = x >= ox && y >= oy && x < ox + shape.width && y < oy + shape.height ? shape.pixels[(y - oy) * shape.width + (x - ox)]! : 0;
        return v !== 0 ? v : wall.pixels[y * 576 + x]!;
      };
      const c = buttonCenter(i + 1);
      rig.host.input.moveMouse(c.x, c.y);
      rig.host.input.mouseDown("left");
      await frames(rig, 3);
      for (let y = t; y < b; y++) for (let x = l; x < r; x++) expect(screen.get(x, y), `bouton ${i + 1} appuyé (${x}, ${y})`).toBe(expected(pressed, pl, pt, x, y));
      // Relâché hors du bouton : rien n'est déclenché, la forme normale revient sur le mur.
      rig.host.input.moveMouse(5, 5);
      rig.host.input.mouseUp("left");
      await frames(rig, 3);
      for (let y = t; y < b; y++) for (let x = l; x < r; x++) expect(screen.get(x, y), `bouton ${i + 1} repos (${x}, ${y})`).toBe(expected(normal, l, t, x, y));
    }
    expect(rig.scene.inspect().transitioning).toBe(false);
  });

  it("stores vénitiens : 15 ticks entre deux menus, 30 puis 15 depuis un puzzle actif, un clic les achève", async () => {
    const rig = await boot();
    const run = async (click: { x: number; y: number }) => {
      rig.host.click(click.x, click.y);
      let n = 0;
      await frames(rig, 1);
      while (rig.scene.inspect().transitioning && n < 200) {
        await frames(rig, 1);
        n++;
      }
      return n;
    };
    // Menu → menu d'un autre niveau : une seule révélation du chevalet, 15 ticks.
    const menuToMenu = await run(buttonCenter(2));
    expect(menuToMenu).toBeGreaterThanOrEqual(13);
    expect(menuToMenu).toBeLessThanOrEqual(18);
    expect(rig.scene.inspect()).toMatchObject({ mode: "menu", level: 1 });
    // Vignette → puzzle : 15 ticks sur le chevalet, fragments gelés pendant ce temps.
    const toPuzzle = await run(thumbCenter(0));
    expect(toPuzzle).toBeGreaterThanOrEqual(13);
    expect(toPuzzle).toBeLessThanOrEqual(18);
    expect(rig.scene.inspect().mode).toBe("playing");
    // Puzzle actif → autre niveau : effacement sur l'écran entier (30 ticks) puis vignettes (15 ticks).
    const back = await run(buttonCenter(1));
    expect(back).toBeGreaterThanOrEqual(43);
    expect(back).toBeLessThanOrEqual(50);
    expect(rig.scene.inspect()).toMatchObject({ mode: "menu", level: 0 });
    // Un clic pendant la transition la termine d'un coup.
    rig.host.click(buttonCenter(3).x, buttonCenter(3).y);
    await frames(rig, 4);
    expect(rig.scene.inspect().transitioning).toBe(true);
    rig.host.click(300, 200);
    await frames(rig, 3);
    expect(rig.scene.inspect().transitioning).toBe(false);
    expect(rig.scene.inspect()).toMatchObject({ mode: "menu", level: 2 });
  });

  it("Exit rend la main au hub", async () => {
    const rig = await boot();
    await clickAt(rig, buttonCenter(7), 6);
    expect(rig.engine.scenes.currentId).toBe(SceneId.hub);
    expect(rig.hub.entered).toBe(1);
    expect(rig.services.sound.musicPlaying).toBe(false);
  });
});

real("Super Sticklers : aide de Poly", () => {
  it("Help : la grande présentation la première fois (drapeau posé et enregistré à la sortie), la courte ensuite ; un clic sur Poly referme", async () => {
    const rig = await boot();
    const flag = () => rig.roster.roster.getVar(rig.playerId, "sticklersPolyIntroSeen");
    expect(flag()).toBe(0);
    await clickAt(rig, buttonCenter(4), 3);
    expect(rig.scene.inspect().polyPhase).not.toBe("closed");
    expect(flag()).toBe(1);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "listening");
    expect(rig.scene.inspect().polyPlayed).toEqual([30000, 30100]);
    // Les boutons ne réagissent plus : Reset/Exit ne font rien, ils font parler Poly (30750 encadré de 30150 et 30200).
    await clickAt(rig, buttonCenter(7), 3);
    expect(rig.engine.scenes.currentId).toBe(SceneId.sticklers);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "listening");
    expect(rig.scene.inspect().polyPlayed.slice(2)).toEqual([30500]);
    await clickAt(rig, buttonCenter(5), 3);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "listening");
    expect(rig.scene.inspect().polyPlayed.slice(3)).toEqual([30150, 30750, 30200]);
    // Le chevalet au menu : 30850.
    await clickAt(rig, { x: 160, y: 150 }, 3);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "listening");
    expect(rig.scene.inspect().polyPlayed.at(-2)).toBe(30850);
    // Clic sur Poly : réplique 32000 + 50 r, départ 30050, aide fermée, groupes rendus.
    await clickAt(rig, { x: 350, y: 380 }, 3);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "closed");
    const played = rig.scene.inspect().polyPlayed;
    expect(played.at(-1)).toBe(30050);
    expect(played.at(-2)! >= 32000 && played.at(-2)! <= 32600).toBe(true);
    // Rouvrir : présentation courte (30250), puisque le drapeau est posé.
    await clickAt(rig, buttonCenter(4), 3);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "listening");
    expect(rig.scene.inspect().polyPlayed.slice(-2)).toEqual([30000, 30250]);
    await clickAt(rig, { x: 350, y: 380 }, 3);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "closed");
    // Les boutons répondent de nouveau : Exit part vers le hub, le roster est enregistré.
    await clickAt(rig, buttonCenter(7), 6);
    expect(rig.engine.scenes.currentId).toBe(SceneId.hub);
    expect(rig.host.storage.data.size).toBeGreaterThan(0);
  }, 120_000);

  it("pendant l'aide : Espace est ignoré et aucun fragment n'est saisissable ; un fragment cliqué fait parler Poly (30900)", async () => {
    const rig = await boot();
    await choosePuzzle(rig, 0, 0);
    const piece = rig.scene.inspect().pieces[0]!;
    const rotation = rig.scene.inspect().pieces.find((p) => p.orientations === 4)!.rotation;
    await clickAt(rig, buttonCenter(4), 3);
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "listening");
    rig.host.press("Space");
    await frames(rig, 2);
    expect(rig.scene.inspect().pieces.find((p) => p.orientations === 4)!.rotation).toBe(rotation);
    const pt = pickPoint(rig, piece);
    rig.host.click(pt.x, pt.y);
    await frames(rig, 3);
    expect(rig.services.pointer.carried).toBeNull();
    await runUntil(rig.engine, rig.host, () => rig.scene.inspect().polyPhase === "listening");
    expect(rig.scene.inspect().polyPlayed).toContain(30900);
  }, 120_000);
});
