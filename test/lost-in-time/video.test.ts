import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ImdDecoder, usedPaletteIndices } from "../../src/games/lost-in-time/data/imd";
import { createSurface } from "../../src/games/lost-in-time/data/surface";
import { Game } from "../../src/games/lost-in-time/engine/game";
import { installGraphics } from "../../src/games/lost-in-time/engine/graphics";
import { BACK_SURFACE } from "../../src/games/lost-in-time/engine/graphics/core";
import { HeadlessHost, NullSubsystems, WaitingForInput, type PlayImdArgs } from "../../src/games/lost-in-time/engine/host";
import { KEY_ESCAPE } from "../../src/games/lost-in-time/engine/input";
import { StepBudgetExceeded } from "../../src/games/lost-in-time/engine/interpreter";
import { loadResources } from "../../src/games/lost-in-time/engine/resources";
import { installVideo, videoProps } from "../../src/games/lost-in-time/engine/video";
import { composeFrame } from "../../src/games/lost-in-time/render/canvas";
import { hasOriginalFiles, loadArchive } from "./helpers";
import { snapshot } from "./snapshot";

const ORIGINAL = resolve(import.meta.dirname, "../../original/lost-in-time");

/** Position de PORTA03 dans l'image : x 45, y 48, 95 x 67. */
const GATE = { left: 45, top: 48, right: 140, bottom: 115 };

/** Palette attendue après recopie de la plage 128-255 : seuls les index dessinés par le film viennent du film (écart voulu). */
function expectedRange(data: Uint8Array, filmPalette: Uint8Array, before: Uint8Array): Uint8Array {
  const used = usedPaletteIndices(data)!;
  const out = before.slice();
  for (let i = 128; i < 256; i++) if (used[i]) out.set(filmPalette.subarray(i * 3, i * 3 + 3), i * 3);
  return out;
}

function makeGame(extra: Record<string, Uint8Array> = {}, maxSteps = 400_000) {
  const host = new HeadlessHost({
    readFile: (name) => {
      if (extra[name]) return extra[name];
      const path = resolve(ORIGINAL, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
  });
  const sys = new NullSubsystems({
    overrides: {
      hotspots: {
        evaluate: () => {
          throw new WaitingForInput("zones de la souris");
        },
        check: () => {
          throw new WaitingForInput("hotspots.check");
        },
      },
    },
  });
  const gfx = installGraphics(sys);
  const video = installVideo(sys, gfx);
  const game = new Game(host, sys, { maxSteps });
  game.inter.keyFuncLimit = 3000;
  return { host, sys, gfx, video, game };
}

/** Décor de EMAM1000 (EXT n°4, palette n°4) : la scène où le script joue PORTA03. */
async function scene() {
  const ctx = makeGame();
  const { game, gfx } = ctx;
  await game.files.openArchive("INTRO.STK", true);
  await game.files.openArchive("COMMUN1.ITK", false);
  await game.files.openArchive("PARTIE2.ITK", false);
  const tot = game.files.get("EMAM1000.TOT")!;
  game.inter.allocateVars(new DataView(tot.buffer, tot.byteOffset, tot.byteLength).getUint32(0x2c, true) & 0xffff);
  game.resources = loadResources(game.files, "EMAM1000.TOT", "fr");
  game.sys.draw.loadSprite(30004, BACK_SURFACE, -1, 0, 0);
  await game.sys.palette.load({ cmd: 53, applyNow: false, data: new Uint8Array([4, 0]) });
  gfx.draw.forceBlit();
  return ctx;
}

function args(over: Partial<PlayImdArgs> = {}): PlayImdArgs {
  const flags = over.flags ?? 0;
  return {
    name: "PORTA03",
    x: -1,
    y: -1,
    startFrame: 0,
    lastFrame: 0,
    breakKey: 0,
    flags,
    palStart: 128,
    palEnd: 255,
    palCmd: 1 << (flags & 0x3f),
    ...over,
  };
}

async function playImd(video: ReturnType<typeof makeGame>["video"], a: PlayImdArgs): Promise<number> {
  const slot = await video.open(a.name, a);
  if (slot < 0) return slot;
  await video.play(slot, { startFrame: a.startFrame, lastFrame: a.lastFrame, noBlock: false }, a);
  return slot;
}

/** Rectangle englobant les pixels différents entre deux images indexées (null si identiques). */
function diffBox(before: Uint8Array, after: Uint8Array, width = 320) {
  let box: { left: number; top: number; right: number; bottom: number } | null = null;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    box = box
      ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x + 1), bottom: Math.max(box.bottom, y + 1) }
      : { left: x, top: y, right: x + 1, bottom: y + 1 };
  }
  return box;
}

function changedIn(before: Uint8Array, after: Uint8Array, r: typeof GATE, width = 320): number {
  let n = 0;
  for (let y = r.top; y < r.bottom; y++) for (let x = r.left; x < r.right; x++) if (before[y * width + x] !== after[y * width + x]) n++;
  return n;
}

describe.skipIf(!hasOriginalFiles)("vidéo IMD", () => {
  it("PORTA03 sur le décor de EMAM1000 : seule la zone de la porte change, palette 128-255 du film", async () => {
    const { gfx, video, host, game } = await scene();
    const reference = new ImdDecoder(game.files.get("PORTA03.IMD")!);
    const before = gfx.core.front.pixels.slice();
    const palBefore = gfx.core.shown.slice();

    // flags 3 : palette du film appliquée aussitôt (plage 128-255), puis image 0 et image 2
    await playImd(video, args({ flags: 3, startFrame: 0, lastFrame: 0 }));
    await playImd(video, args({ flags: 3, name: "", startFrame: 2, lastFrame: 2 }));
    gfx.draw.blitInvalidated();

    const after = gfx.core.front.pixels;
    const box = diffBox(before, after);
    expect(box).not.toBeNull();
    expect(box!.left).toBeGreaterThanOrEqual(GATE.left);
    expect(box!.top).toBeGreaterThanOrEqual(GATE.top);
    expect(box!.right).toBeLessThanOrEqual(GATE.right);
    expect(box!.bottom).toBeLessThanOrEqual(GATE.bottom);
    expect(changedIn(before, after, GATE)).toBeGreaterThan(500);
    expect(gfx.draw.back.pixels).toEqual(after);
    expect(host.now()).toBeGreaterThan(0);

    // La plage 128-255 vient du film, le reste de la palette du décor est intact
    // (seuls les index dessinés par le film sont recopiés, voir `copyPalette`)
    expect(gfx.core.shown).toEqual(expectedRange(game.files.get("PORTA03.IMD")!, reference.palette, palBefore));

    snapshot("video-porta03-image2", composeFrame(gfx, 0, 0));
  });

  it("flags 0 (comme MENU.TOT) : la palette du jeu n'est pas modifiée", async () => {
    const { gfx, video } = await scene();
    const wanted = gfx.core.wanted.slice();
    const shown = gfx.core.shown.slice();
    await playImd(video, args({ startFrame: 0, lastFrame: 0 }));
    await playImd(video, args({ name: "", startFrame: 2, lastFrame: 2 }));
    gfx.draw.blitInvalidated();
    expect(gfx.core.wanted).toEqual(wanted);
    expect(gfx.core.shown).toEqual(shown);
  });

  it("les zones creuses laissent le décor visible (MALCAD image 1 sans l'image 0)", async () => {
    const { gfx, video, game } = await scene();
    await game.files.openArchive("BATCOM.ITK", false);
    const data = game.files.get("MALCAD.IMD")!;
    // Référence : la même image décodée sur deux fonds de sentinelles ; les pixels qui gardent leur sentinelle
    // dans les deux cas sont ceux que le film saute.
    const decode = (fill: number): Uint8Array => {
      const probe = createSurface(320, 200);
      probe.pixels.fill(fill);
      const reference = new ImdDecoder(data, probe);
      reference.seek(0);
      reference.decodeNextFrame();
      return probe.pixels;
    };
    const a = decode(0x01);
    const b = decode(0xfe);
    const skipped: number[] = [];
    for (let y = 0; y < 80; y++) for (let x = 0; x < 148; x++) if (a[y * 320 + x] === 0x01 && b[y * 320 + x] === 0xfe) skipped.push(y * 320 + x);
    expect(skipped.length).toBeGreaterThan(500);

    gfx.draw.back.pixels.fill(7);
    gfx.core.front.pixels.fill(7);
    await playImd(video, args({ name: "MALCAD", startFrame: 1, lastFrame: 1 }));
    gfx.draw.blitInvalidated();
    const front = gfx.core.front.pixels;
    expect(skipped.every((i) => front[i] === 7)).toBe(true);
    // Le reste de la zone a été dessiné
    let drawn = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 148; x++) if (front[y * 320 + x] !== 7) drawn++;
    expect(drawn).toBeGreaterThan(5000);
    // Hors de la zone du film : rien
    expect(front[100 * 320 + 200]).toBe(7);
  });

  it("palette : flags 1 recopie la plage 128-255 du film (et rien en dessous)", async () => {
    const { gfx, video, game } = await scene();
    const data = game.files.get("PORTA03.IMD")!;
    const reference = new ImdDecoder(data);
    reference.decodeNextFrame();
    const wantedBefore = gfx.core.wanted.slice();

    await playImd(video, args({ flags: 1, startFrame: 0, lastFrame: 0 }));

    const wanted = gfx.core.wanted;
    expect(wanted).toEqual(expectedRange(data, reference.palette, wantedBefore));
    // La palette affichée a rejoint la voulue (fondu terminé)
    expect(gfx.core.shown.subarray(128 * 3)).toEqual(wanted.subarray(128 * 3));
  });

  it("palette : flags 3 (palCmd 8) applique la palette du film tout de suite", async () => {
    const { gfx, video, game } = await scene();
    const data = game.files.get("PORTA03.IMD")!;
    const reference = new ImdDecoder(data);
    const before = gfx.core.shown.slice();
    await playImd(video, args({ flags: 3, startFrame: 0, lastFrame: 0, palStart: 128, palEnd: 255 }));
    expect(gfx.core.shown).toEqual(expectedRange(data, reference.palette, before));
  });

  it("position x / y imposée : le film est dessiné ailleurs", async () => {
    const { gfx, video } = await scene();
    const before = gfx.core.front.pixels.slice();
    await playImd(video, args({ x: 100, y: 20, startFrame: 0, lastFrame: 0 }));
    gfx.draw.blitInvalidated();
    const box = diffBox(before, gfx.core.front.pixels)!;
    expect(box.left).toBeGreaterThanOrEqual(100);
    expect(box.top).toBeGreaterThanOrEqual(20);
    expect(box.right).toBeLessThanOrEqual(195);
    expect(box.bottom).toBeLessThanOrEqual(87);
  });

  it("drapeau 0x80 : dessine directement sur la surface avant, sans toucher la surface arrière", async () => {
    const { gfx, video } = await scene();
    const front = gfx.core.front.pixels.slice();
    const back = gfx.draw.back.pixels.slice();
    await playImd(video, args({ flags: 0x80, startFrame: 0, lastFrame: 0 }));
    expect(gfx.draw.back.pixels).toEqual(back);
    expect(diffBox(front, gfx.core.front.pixels)).not.toBeNull();
  });

  it("cadence : 37 images à 12 par seconde prennent environ 3 s simulées, en attendant l'affichage", async () => {
    const { video, host, game } = await scene();
    game.timer.setFrameRate(12);
    const t0 = host.now();
    const f0 = host.frames;
    const slot = await playImd(video, args({ startFrame: 0, lastFrame: 36 }));
    const elapsed = host.now() - t0;
    expect(elapsed).toBeGreaterThan(36 * 80);
    expect(elapsed).toBeLessThan(40 * 100);
    expect(host.frames - f0).toBeGreaterThan(37);
    expect(video.currentFrame(slot)).toBe(36);
    expect(game.vars.readVar32(7)).toBe(37);
    expect(game.vars.readVar32(11)).toBe(36);
  });

  it("lecture à l'envers : de l'image 5 à l'image 2", async () => {
    const { video, game } = await scene();
    await playImd(video, args({ startFrame: 5, lastFrame: 2 }));
    // Joue les images 5 puis 4 (la dernière demandée est exclue, comme l'original)
    expect(game.vars.readVar32(11)).toBe(4);
  });

  it("Échap interrompt la lecture et se place sur la dernière image de la séquence", async () => {
    const { video, host, game } = await scene();
    const next = host.nextFrame.bind(host);
    const at = host.frames + 40;
    host.nextFrame = () => {
      if (host.frames === at) host.input.pushKey(KEY_ESCAPE);
      return next();
    };
    const t0 = host.now();
    const slot = await playImd(video, args({ startFrame: 0, lastFrame: 36 }));
    expect(host.now() - t0).toBeLessThan(1500);
    // Position de la dernière image (endFrame - 1 + 1), pour que le script reprenne là
    expect(video.currentFrame(slot)).toBe(35);
    expect(game.vars.readVar32(0)).toBe(0x1b);
  });

  it("recherche du film : insensible à la casse, suffixe .IMD facultatif, introuvable = -1", async () => {
    const { video } = await scene();
    expect(await video.open("porta03.imd", args())).toBe(0);
    video.close(0);
    expect(await video.open("Porta03a", args({ name: "Porta03a" }))).toBe(0);
    expect(video.fileName(0)).toBe("Porta03a");
    expect(video.frameCount(0)).toBe(21);
    video.close(0);
    expect(video.slotIsOpen(0)).toBe(false);
    expect(await video.open("INTROUVABLE", args())).toBe(-1);
  });

  it("sans l'ITK ouvert, la vidéo est introuvable ; fermer l'archive ne ferme pas les films", async () => {
    const { video, game } = await scene();
    expect(await video.open("PORTA03", args())).toBe(0);
    game.files.closeArchive(false);
    video.reopenAll();
    expect(video.slotIsOpen(0)).toBe(true);
    expect(await video.open("PORTA03B", args({ name: "PORTA03B" }))).toBe(-1);
  });

  it("o2_getImdInfo : position, nombre d'images et taille", async () => {
    const { video, game } = await scene();
    await video.writeInfo("PORTA03", 0, 4, 8, 12, 16);
    const v = game.vars;
    expect([v.readOff32(0), v.readOff32(4), v.readOff32(8), v.readOff32(12), v.readOff32(16)]).toEqual([45, 48, 37, 95, 67]);
    await video.writeInfo("NOPE", 0, 4, 8, 12, 16);
    expect(v.readOff32(8)).toBe(0xffffffff);
    // L'emplacement temporaire est libéré
    for (let i = 0; i < 32; i++) expect(video.slotIsOpen(i)).toBe(false);
  });

  it("vidéo live (noBlock) : une image par mise à jour, fin = variable 53 à -1 et film fermé", async () => {
    const { video, host, game } = await scene();
    const a = args({ startFrame: 0, lastFrame: -1 });
    const props = videoProps({ flags: 0, startFrame: 0, lastFrame: -1, noBlock: true, sprite: BACK_SURFACE });
    const slot = video.openVideo(false, "PORTA03A", props);
    expect(slot).toBeGreaterThan(6);
    await video.playVideo(slot, props);
    expect(video.currentFrame(slot)).toBe(0);
    // Pas d'avance sans écoulement du temps
    await video.update();
    expect(video.currentFrame(slot)).toBe(0);
    for (let i = 0; i < 400 && video.slotIsOpen(slot); i++) {
      await host.nextFrame();
      await video.update();
    }
    expect(video.slotIsOpen(slot)).toBe(false);
    expect(game.vars.readVar32(53)).toBe(0xffffffff);
    expect(a.name).toBe("PORTA03");
  });

  it("surface propre (sprite) : le film est décodé à part et copiable avec transparence", async () => {
    const { video, gfx } = await scene();
    const props = videoProps({ flags: 0, startFrame: 0, lastFrame: 0, sprite: 50, x: 0, y: 0 });
    const slot = video.openVideo(false, "PORTA03", props);
    await video.playVideo(slot, props);
    const sprite = gfx.draw.sprites[50]!;
    expect(sprite.width).toBe(96);
    expect(sprite.height).toBe(67);
    expect(sprite.pixels.some((p) => p !== 0)).toBe(true);
    const back = gfx.draw.back;
    const copy = back.pixels.slice();
    video.copyFrame(slot, back, 0, 0, 95, 67, 10, 10, 0, false);
    expect(diffBox(copy, back.pixels)).not.toBeNull();
    // Le décor n'a pas été touché par le décodage
    expect(gfx.draw.back.pixels.slice(0, 5)).toEqual(copy.slice(0, 5));
  });

  it("MENU.TOT : le script joue PORTA03 (image 0 puis 2) sans erreur", async () => {
    const { game, gfx, video, host } = makeGame();
    const calls: string[] = [];
    const open = video.open.bind(video);
    video.open = async (name, a) => {
      const slot = await open(name, a);
      calls.push(`${name}:${slot}:${a.palStart}-${a.palEnd}`);
      return slot;
    };
    await game.files.openArchive("INTRO.STK", true);
    const data = game.files.get("MENU.TOT")!;
    game.inter.allocateVars(new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0x2c, true) & 0xffff);
    game.sys.draw.loadFont(0, "jeulet1.let");
    try {
      await game.runTot("MENU.TOT");
    } catch (e) {
      if (!(e instanceof WaitingForInput) && !(e instanceof StepBudgetExceeded)) throw e;
    }
    game.sys.draw.blitInvalidated();
    expect(calls[0]).toBe("PORTA03:0:128-255");
    expect(video.slotIsOpen(0)).toBe(true);
    expect(video.currentFrame(0)).toBe(2);
    expect(host.frames).toBeGreaterThan(10);
    snapshot("video-menu", composeFrame(gfx, 0, 0));
  });

  it("son : les tranches audio vont au moteur audio à la fréquence du film, qui rythme la lecture", async () => {
    // Film synthétique : 2 images, tranches de 10 octets à 1000 Hz (100 images/s), 2 tranches d'avance
    const palette = 18;
    const soundAt = palette + 768;
    const frames = soundAt + 6;
    const file = new Uint8Array(frames + 2 + 20 + 2 + 2 + 10 + 2);
    const dv = new DataView(file.buffer);
    dv.setUint8(2, 2); // version
    dv.setUint8(3, 0x40); // son
    dv.setUint16(4, 2, true); // images
    dv.setInt16(10, 4, true); // largeur
    dv.setInt16(12, 4, true); // hauteur
    dv.setUint16(16, frames, true); // première image
    dv.setInt16(soundAt, 1000, true); // fréquence
    dv.setInt16(soundAt + 2, 10, true); // taille d'une tranche
    dv.setInt16(soundAt + 4, 2, true); // tranches d'avance
    // image 0 : début du son (2 tranches), pas de vidéo
    dv.setUint16(frames, 0xff01, true);
    file.fill(0x90, frames + 2, frames + 22);
    dv.setUint16(frames + 22, 0, true);
    // image 1 : tranche suivante
    dv.setUint16(frames + 24, 0xff00, true);
    file.fill(0x70, frames + 26, frames + 36);
    dv.setUint16(frames + 36, 0, true);

    const { video, game, sys, host } = makeGame({ "SYNTH.IMD": file });
    await game.files.openArchive("INTRO.STK", true);
    await game.files.fetch("SYNTH.IMD");
    game.inter.allocateVars(100);
    const a = args({ name: "SYNTH", startFrame: 0, lastFrame: 1 });
    const t0 = host.now();
    const slot = await video.open("SYNTH", a);
    expect(slot).toBe(0);
    expect(video.hasSound(0)).toBe(true);
    await video.play(slot, { startFrame: 0, lastFrame: 1, noBlock: false }, a);
    const queued = sys.calls.filter((c) => c.system === "sound" && c.method === "queueImdSlice");
    expect(queued.map((c) => [(c.args[0] as Uint8Array).length, c.args[1]])).toEqual([
      [20, 1000],
      [10, 1000],
    ]);
    // 2 images à 100 images/s : environ 20 ms, et pas plus d'une image d'affichage par image du film
    expect(host.now() - t0).toBeLessThan(80);
    video.close(0);
    expect(sys.count("sound", "stopImdAudio")).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("vidéo : données réelles", () => {
  it("tous les films de PARTIE2.ITK s'ouvrent et se jouent sur une surface vide", async () => {
    const { game, video, gfx } = makeGame();
    await game.files.openArchive("INTRO.STK", true);
    await game.files.openArchive("PARTIE2.ITK", false);
    const tot = game.files.get("MENU.TOT")!;
    game.inter.allocateVars(new DataView(tot.buffer, tot.byteOffset, tot.byteLength).getUint32(0x2c, true) & 0xffff);
    game.timer.setFrameRate(1000);
    const names = loadArchive("PARTIE2.ITK")
      .entries.map((e) => e.name)
      .filter((n) => /\.IMD$/i.test(n))
      .slice(0, 12);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const base = name.replace(/\.IMD$/i, "");
      const slot = await playImd(video, args({ name: base, startFrame: 0, lastFrame: -1, flags: 0 }));
      expect(slot).toBeGreaterThanOrEqual(0);
      video.close(slot);
    }
    expect(gfx.core.front.pixels.length).toBe(320 * 200);
  });
});
