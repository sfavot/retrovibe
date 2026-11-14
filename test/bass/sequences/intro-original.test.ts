import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createBassEngine } from "../../../src/games/bass/create";
import { TestHost } from "../../../src/games/bass/engine/host";
import { Var } from "../../../src/games/bass/engine/ids";
import { BassIntro, INTRO_SCRIPT, VIRGIN_PALETTE, VIRGIN_SCREEN, startGameAfterIntro } from "../../../src/games/bass/engine/sequences/intro";
import { createIntroAudio } from "../../../src/games/bass/engine/sequences/intro-audio";
import { Op } from "../../../src/games/bass/engine/sequences/intro-script";
import { SCREEN_WIDTH } from "../../../src/games/bass/render/frame-buffer";
import { hasOriginalFiles, skyCpt, skyDisk } from "../data/helpers";
import { decodePng } from "../render/png";
import { frameHash } from "../render/harness";

const here = (...parts: string[]): string => resolve(import.meta.dirname, ...parts);
const png = (path: string) => decodePng(new Uint8Array(readFileSync(path)));
const captures = JSON.parse(readFileSync(here("fixtures/intro-captures.json"), "utf8")) as { intro: string[]; text: string[]; afterEscA: string; afterEscB: string };

function mismatches(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function makeIntro(canvas = { scummvmBottomLines: true }) {
  const disk = skyDisk();
  let intro!: BassIntro;
  const clock = () => intro.clockMs;
  intro = new BassIntro({
    disk,
    audio: createIntroAudio({ sound: { loadSection() {}, startMusic() {} }, clock }),
    canvas,
  });
  return intro;
}

describe.skipIf(!hasOriginalFiles)("introduction sur les fichiers d'origine", () => {
  const disk = hasOriginalFiles ? skyDisk() : undefined!;

  it("tous les fichiers de la liste sont dans sky.dnr (voix et ambiances comprises, qui y sont restées)", () => {
    expect(disk.has(VIRGIN_SCREEN) && disk.has(VIRGIN_PALETTE)).toBe(true);
    for (const c of INTRO_SCRIPT) {
      if (c[0] === Op.ShowScreen || c[0] === Op.FadeUp || c[0] === Op.DoFlirt || c[0] === Op.BgFlirt || c[0] === Op.PlayVoice || c[0] === Op.LoadBg) {
        expect(disk.has(c[1]), `fichier ${c[1]}`).toBe(true);
      }
    }
    // Images : 64 000 octets ; palettes : 768 ; voix : PCM de plus d'un en-tête.
    for (const c of INTRO_SCRIPT) {
      if (c[0] === Op.ShowScreen) expect(disk.load(c[1]).length).toBe(64000);
      if (c[0] === Op.FadeUp) expect(disk.load(c[1]).length).toBeGreaterThanOrEqual(768);
      if (c[0] === Op.PlayVoice) expect(disk.load(c[1]).length).toBeGreaterThan(22 + 1000);
    }
  });

  /** Joue l'introduction en entier dans les deux modes (192 lignes comme ScummVM, 200 lignes comme l'original) ; garde l'empreinte de chaque tick. */
  const played = (() => {
    let cached: { hashes: string[]; end: number; outcome: string | null; rgba: Map<number, Uint8ClampedArray>; wide: Map<number, Uint8Array>; narrow: Map<number, Uint8Array> } | undefined;
    return (keep: number[] = []) => {
      if (cached) return cached;
      const narrow = makeIntro();
      const wide = makeIntro({ scummvmBottomLines: false });
      narrow.start();
      wide.start();
      const hashes: string[] = [];
      const rgba = new Map<number, Uint8ClampedArray>();
      const narrowRows = new Map<number, Uint8Array>();
      const wideRows = new Map<number, Uint8Array>();
      let end = 0;
      for (let t = 0; narrow.running; t++) {
        const frame = narrow.canvas!.frame;
        hashes.push(frameHash(frame.pixels, frame.palette));
        if (keep.includes(t) || t % 25 === 0) {
          rgba.set(t, new Uint8ClampedArray(frame.toRgba()));
          narrowRows.set(t, new Uint8Array(frame.pixels));
          wideRows.set(t, new Uint8Array(wide.canvas!.frame.pixels));
        }
        // Mêmes palettes, mêmes 192 premières lignes dans les deux modes.
        const w = wide.canvas!.frame;
        if (t % 25 === 0) {
          expect(mismatches(w.palette, frame.palette)).toBe(0);
          expect(mismatches(w.pixels.subarray(0, 61440), frame.pixels.subarray(0, 61440))).toBe(0);
        }
        end = narrow.clockMs;
        narrow.tick();
        wide.tick();
      }
      cached = { hashes, end, outcome: narrow.outcome, rgba, wide: wideRows, narrow: narrowRows };
      return cached;
    };
  })();

  /** Instants (ms) de la chronologie pour lesquels on garde l'image : pause de Virgin, Revolution, Gibbo, noir, premières images de l'orateur. */
  const KEEP = [1000, 10_000, 17_000, 20_000, 24_740, 24_880, 24_940].map((ms) => ms / 20);

  it("l'introduction va au bout : fin à 300,62 s, issue « completed »", () => {
    const run = played(KEEP);
    expect(run.outcome).toBe("completed");
    expect(run.end).toBe(300_620);
  });

  // Captures du banc (ScummVM, `b-intro`), 320 x 200 : instants déduits de la liste de commandes et de la durée des voix du disque.
  it.each([
    ["fixtures/i-0001.png", 1000, "écran de Virgin (3 s + 3 s)"],
    ["fixtures/i-0003.png", 10_000, "Revolution, fondu fini, avant les 8 s"],
    ["fixtures/i-0007.png", 17_000, "Gibbo"],
    ["fixtures/i-0008.png", 20_000, "noir avant la première voix (19 400 ms)"],
    ["../render/fixtures/i-0011.png", 24_740, "orateur (CD_1_LOG) à la fin du fondu, 0 image de séquence"],
    ["../render/fixtures/i-0012.png", 24_880, "2 images de CD_1 (60 ms chacune)"],
    ["../render/fixtures/i-0013.png", 24_940, "3 images de CD_1"],
  ])("%s à %i ms (%s) : RGBA identique au pixel près", (file, ms) => {
    const run = played(KEEP);
    const reference = png(here(file));
    expect(mismatches(run.rgba.get(ms / 20)!, reference.rgba)).toBe(0);
  });

  it("les 59 captures de b-intro qui suivent la première sont produites par la chronologie, dans l'ordre (empreinte indices + 240 couleurs)", () => {
    const run = played(KEEP);
    let from = 0;
    const ticks: number[] = [];
    // La capture 0 est l'écran noir de la machine avant `initVirgin` : la chronologie commence par Virgin.
    for (const hash of captures.intro.slice(1)) {
      const at = run.hashes.indexOf(hash, from);
      expect(at, `capture ${ticks.length} absente après le tick ${from}`).toBeGreaterThanOrEqual(0);
      ticks.push(at);
      from = at;
    }
    expect(ticks).toHaveLength(59);
    expect(ticks[ticks.length - 1]! * 20).toBeLessThan(run.end);
  });

  it("les 73 premières captures de b-intro-text (fin de l'introduction) aussi ; les 7 dernières sont le jeu", () => {
    const run = played(KEEP);
    let from = 0;
    let found = 0;
    for (const hash of captures.text) {
      const at = run.hashes.indexOf(hash, from);
      if (at < 0) break;
      found++;
      from = at;
    }
    expect(found).toBe(73);
  });

  it("image plein écran : 200 lignes comme l'original ; ScummVM 2.x n'en montre que 192 (capture i-0036)", () => {
    const run = played(KEEP);
    const hash = captures.intro[36]!;
    const tick = run.hashes.indexOf(hash);
    expect(tick).toBeGreaterThan(0);
    // `played` ne garde qu'un tick sur 25 : on rejoue jusqu'à celui-là dans les deux modes.
    const narrow = makeIntro();
    const wide = makeIntro({ scummvmBottomLines: false });
    narrow.start();
    wide.start();
    for (let t = 0; t < tick; t++) {
      narrow.tick();
      wide.tick();
    }
    const reference = png(here("fixtures/i-0036.png"));
    expect(mismatches(narrow.canvas!.frame.toRgba(), reference.rgba)).toBe(0);
    const bottom = SCREEN_WIDTH * 192;
    expect(wide.canvas!.frame.pixels.subarray(bottom).some((p) => p !== 0)).toBe(true);
    expect(narrow.canvas!.frame.pixels.subarray(bottom).every((p) => p === 0)).toBe(true);
    expect(mismatches(wide.canvas!.frame.pixels.subarray(0, bottom), narrow.canvas!.frame.pixels.subarray(0, bottom))).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("départ du jeu après l'introduction (moteur sur les vrais fichiers)", () => {
  const data = () => ({ disk: skyDisk(), cpt: skyCpt() });

  function skipped(atTick: number) {
    const host = new TestHost();
    const game = createBassEngine(data(), host, { render: true, intro: {} });
    const intro = game.intro!;
    intro.start();
    for (let t = 0; t < atTick; t++) intro.tick();
    host.push({ type: "move", x: 5, y: 5 }, { type: "action", action: "skip" });
    intro.tick();
    return { game, host, intro };
  }

  it.each([0, 100, 400, 972, 1500, 4000, 9000])("saut au tick %i : même état que Control::restartGame (variables, curseur, écran noir, palette de la pièce)", (tick) => {
    const { game, intro } = skipped(tick);
    expect(intro.running).toBe(false);
    expect(intro.outcome).toBe("skipped");
    startGameAfterIntro(game.engine, intro.outcome!);

    const reference = createBassEngine(data(), new TestHost(), { render: true });
    reference.engine.startAfterIntro();
    expect(game.engine.system.pastIntro).toBe(true);
    expect([...game.engine.vars]).toEqual([...reference.engine.vars]);
    expect(game.engine.savedMouse).toBe(reference.engine.savedMouse);
    expect(frameHash(game.renderer!.frame.pixels, game.renderer!.frame.palette)).toBe(frameHash(reference.renderer!.frame.pixels, reference.renderer!.frame.palette));
  });

  it("après le saut, l'image du jeu est celle de la capture du banc prise 2,5 s après Échap (after-esc-a, after-esc-b)", () => {
    const { game, intro } = skipped(400);
    startGameAfterIntro(game.engine, intro.outcome!);
    const seen = new Set<string>();
    for (let t = 0; t < 300; t++) {
      game.engine.tick();
      seen.add(frameHash(game.renderer!.frame.pixels, game.renderer!.frame.palette));
    }
    expect(seen.has(captures.afterEscA)).toBe(true);
    expect(seen.has(captures.afterEscB)).toBe(true);
  });

  it("un clic passe l'introduction comme Échap ; un simple déplacement, non", () => {
    const host = new TestHost();
    const game = createBassEngine(data(), host, { intro: {} });
    game.intro!.start();
    host.push({ type: "move", x: 10, y: 10 });
    for (let t = 0; t < 5; t++) game.intro!.tick();
    expect(game.intro!.running).toBe(true);
    host.push({ type: "click", x: 10, y: 10, button: 2 });
    game.intro!.tick();
    expect(game.intro!.outcome).toBe("skipped");
  });

  it("introduction jouée jusqu'au bout : initScreen0 (section 0, musique 2, pastIntro faux), l'animation d'ouverture joue", () => {
    const host = new TestHost();
    const game = createBassEngine(data(), host, { render: true, intro: {} });
    const intro = game.intro!;
    intro.start();
    let ticks = 0;
    while (intro.running) {
      intro.tick();
      ticks++;
    }
    expect(intro.outcome).toBe("completed");
    expect(ticks).toBe(15_032);

    const music: number[] = [];
    const startMusic = game.engine.sound.startMusic.bind(game.engine.sound);
    game.engine.sound.startMusic = (m: number) => (music.push(m), startMusic(m));
    startGameAfterIntro(game.engine, intro.outcome!);
    expect(music).toEqual([2]);
    expect(game.engine.system.currentMusic).toBe(2);
    expect(game.engine.system.pastIntro).toBe(false);
    expect(game.engine.vars[Var.CUR_SECTION]).toBe(0);

    // Captures de b-intro-text 73 à 79 : le jeu, une toutes les 2 s (100 ticks), la première à 64 ticks (fondu de 32 + 32 pas).
    const frames: string[] = [];
    for (let t = 0; t < 700; t++) {
      frames.push(frameHash(game.renderer!.frame.pixels, game.renderer!.frame.palette));
      game.engine.tick();
    }
    const [first, ...others] = captures.text.slice(73);
    expect(frames[64]).toBe(first);
    others.forEach((hash, i) => {
      const near = frames.slice(100 * (i + 1) + 20, 100 * (i + 1) + 31);
      expect(near, `capture ${74 + i}`).toContain(hash);
    });

    // Échap dans le jeu passe l'animation d'ouverture (`handleKey` : `restartGame` tant que `pastIntro` est faux).
    host.push({ type: "action", action: "skip" });
    game.engine.runCycles(2);
    expect(game.engine.system.pastIntro).toBe(true);
  });
});
