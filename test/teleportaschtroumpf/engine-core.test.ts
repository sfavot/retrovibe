import { describe, expect, it } from "vitest";
import { parsePfn, measureText } from "../../src/games/teleportaschtroumpf/data/font";
import { parseHy8, HY8_PART_IMAGE } from "../../src/games/teleportaschtroumpf/data/hy8";
import { Clock, TICKS_PER_SECOND } from "../../src/games/teleportaschtroumpf/engine/clock";
import { Input, actionForKey } from "../../src/games/teleportaschtroumpf/engine/input";
import { DEFAULT_OPTIONS, isLocked, loadOptions, saveOptions, STORAGE_KEY, gameSeconds } from "../../src/games/teleportaschtroumpf/engine/options";
import { Fade, Palette } from "../../src/games/teleportaschtroumpf/engine/palette";
import { expandName, musicName, resolveGameFile, voiceName } from "../../src/games/teleportaschtroumpf/engine/paths";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";
import { AnimationPlayer } from "../../src/games/teleportaschtroumpf/engine/sprites";
import { SCREEN_PIXELS, Surface } from "../../src/games/teleportaschtroumpf/engine/surface";
import { GameFiles } from "../../src/games/teleportaschtroumpf/data/files";
import { MemoryStorage } from "./engine-test-host";
import { hasOriginalFiles, readData } from "./helpers";

/** Avance l'horloge de `ms` millisecondes par images de 1000/60 ms et compte les ticks consommés. */
function run(clock: Clock, fromMs: number, ms: number, frameMs = 1000 / 60): number {
  let ticks = 0;
  for (let t = fromMs + frameMs; t <= fromMs + ms + 1e-9; t += frameMs) {
    clock.update(t);
    while (clock.consume()) ticks++;
  }
  return ticks;
}

describe("Clock", () => {
  it("avance à pas fixe de 60 ticks/s, quelle que soit la cadence des images", () => {
    for (const frameMs of [1000 / 60, 1000 / 144, 1000 / 30, 7]) {
      const clock = new Clock();
      clock.update(0);
      run(clock, 0, 2000, frameMs);
      expect(clock.ticks).toBeGreaterThanOrEqual(2 * TICKS_PER_SECOND - 2);
      expect(clock.ticks).toBeLessThanOrEqual(2 * TICKS_PER_SECOND);
    }
  });

  it("expose centisecondes et secondes", () => {
    const clock = new Clock();
    clock.update(0);
    run(clock, 0, 3000);
    expect(clock.ticks).toBe(180);
    expect(clock.centiseconds).toBe(300);
    expect(clock.seconds).toBe(3);
  });

  it("le premier appel ne fait que fixer l'origine ; un grand saut de temps est borné", () => {
    const clock = new Clock();
    clock.update(5000);
    expect(clock.consume()).toBe(false);
    clock.update(5000 + 60_000);
    let n = 0;
    while (clock.consume()) n++;
    expect(n).toBeLessThanOrEqual(15);
  });

  it("ticks n'avance que par consume()", () => {
    const clock = new Clock();
    clock.update(0);
    clock.update(100);
    expect(clock.ticks).toBe(0);
    expect(clock.consume()).toBe(true);
    expect(clock.ticks).toBe(1);
  });

  it("chrono gelable : le temps écoulé ne bouge plus pendant le gel", () => {
    const clock = new Clock();
    clock.update(0);
    const timer = clock.createTimer();
    run(clock, 0, 1000);
    expect(timer.seconds).toBe(1);
    timer.freeze();
    run(clock, 1000, 2000);
    expect(timer.ticks).toBe(60);
    expect(timer.frozen).toBe(true);
    timer.resume();
    run(clock, 3000, 500);
    expect(timer.ticks).toBe(90);
    timer.start();
    expect(timer.ticks).toBe(0);
  });
});

describe("BorlandRandom", () => {
  it("donne les premières valeurs de seed = seed × 0x015A4E35 + 1, (seed >> 16) & 0x7FFF", () => {
    // Calculées à la main : graine 0 → 1 → 0x015A4E36 → … ; (1 >> 16) = 0, (0x015A4E36 >> 16) = 0x15A = 346.
    const rng = new BorlandRandom(0);
    expect([rng.next(), rng.next(), rng.next(), rng.next(), rng.next()]).toEqual([0, 346, 130, 10982, 1090]);
    const rng1 = new BorlandRandom(1);
    expect([rng1.next(), rng1.next(), rng1.next()]).toEqual([346, 130, 10982]);
    const rng2 = new BorlandRandom(12345);
    expect([rng2.next(), rng2.next(), rng2.next(), rng2.next(), rng2.next()]).toEqual([15301, 24996, 10921, 23577, 19316]);
  });

  it("tire dans [0, n[ par rand() × n / 0x8000", () => {
    const rng = new BorlandRandom(12345);
    expect([1, 2, 3, 4, 5].map(() => rng.below(3))).toEqual([1, 2, 0, 2, 1]);
  });

  it("est reproductible avec seed()", () => {
    const rng = new BorlandRandom(7);
    const first = [rng.next(), rng.next()];
    rng.seed(7);
    expect([rng.next(), rng.next()]).toEqual(first);
  });
});

describe("Palette et fondus", () => {
  const vga = (v: number) => Math.round(((v >> 2) * 255) / 63);

  function demoPalette(): Palette {
    const palette = new Palette();
    const source = new Uint8Array(768);
    for (let i = 0; i < 768; i++) source[i] = (i * 37 + 11) & 0xff;
    palette.load(source);
    return palette;
  }

  it("force l'entrée 0 à noir et convertit comme le DAC VGA", () => {
    const palette = new Palette();
    const source = new Uint8Array(768).fill(0xff);
    palette.load(source);
    const shown = palette.display();
    expect([...shown.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([...shown.subarray(3, 6)]).toEqual([255, 255, 255]);
    palette.setColor(5, 0x10, 0xa4, 0xcc);
    expect([...palette.display().subarray(15, 18)]).toEqual([vga(0x10), vga(0xa4), vga(0xcc)]);
    expect(vga(0x80)).toBe(Math.round((32 * 255) / 63));
  });

  it("fadeOut : palette à mi-chemin (pal − floor(cur × pal / n)) puis noire", () => {
    const palette = demoPalette();
    const fade = new Fade(palette);
    fade.out(16);
    expect(fade.active).toBe(true);
    let guard = 0;
    while (palette.fadeStep < 8 && guard++ < 100) fade.tick();
    expect(palette.fadeStep).toBe(8);
    const shown = palette.display();
    for (let i = 3; i < 768; i++) {
      const base = palette.colors[i];
      expect(shown[i]).toBe(vga(base - Math.floor((8 * base) / 16)));
    }
    while (fade.active && guard++ < 200) fade.tick();
    expect(palette.black).toBe(true);
    expect([...palette.display()].every((v) => v === 0)).toBe(true);
  });

  it("dure 17 pas à ≈ 70 Hz, soit moins de 15 ticks de 1/60 s", () => {
    const palette = demoPalette();
    const fade = new Fade(palette);
    fade.out();
    let ticks = 0;
    const steps = new Set<number>();
    while (fade.active) {
      fade.tick();
      ticks++;
      steps.add(palette.fadeStep);
    }
    expect(ticks).toBe(14);
    expect(steps.size).toBeGreaterThanOrEqual(14);
    expect(palette.fadeStep).toBe(16);
  });

  it("fadeIn part du noir et revient à la palette pleine", () => {
    const palette = demoPalette();
    const fade = new Fade(palette);
    fade.in();
    expect(palette.black).toBe(true);
    for (let i = 0; i < 7; i++) fade.tick();
    const mid = palette.display();
    expect(mid[300]).toBeGreaterThan(0);
    while (fade.active) fade.tick();
    expect([...palette.display()]).toEqual([...demoPalette().display()]);
  });

  it("reset et blackout", () => {
    const palette = demoPalette();
    const fade = new Fade(palette);
    fade.blackout();
    expect(palette.black).toBe(true);
    fade.reset();
    expect(palette.fadeStep).toBe(0);
    expect(fade.active).toBe(false);
  });
});

describe("Input", () => {
  it("distingue tenu et vient d'être appuyé, mémorisé jusqu'à endUpdate()", () => {
    const input = new Input();
    expect(input.pressed("validate")).toBe(false);
    input.keyDown("Space");
    expect(input.pressed("validate")).toBe(true);
    expect(input.justPressed("validate")).toBe(true);
    input.endUpdate();
    expect(input.justPressed("validate")).toBe(false);
    expect(input.pressed("validate")).toBe(true);
    // Répétition clavier : pas de nouvel appui.
    input.keyDown("Space");
    expect(input.justPressed("validate")).toBe(false);
    input.keyUp("Space");
    expect(input.pressed("validate")).toBe(false);
  });

  it("un appui plus court qu'un pas de scène n'est pas perdu", () => {
    const input = new Input();
    input.keyDown("Escape");
    input.keyUp("Escape");
    expect(input.pressed("skip")).toBe(false);
    expect(input.justPressed("skip")).toBe(true);
  });

  it("plusieurs appuis rapides dans un même pas sont rendus un par un aux pas suivants", () => {
    const input = new Input();
    for (let i = 0; i < 3; i++) {
      input.keyDown("ArrowDown");
      input.keyUp("ArrowDown");
    }
    for (let i = 0; i < 3; i++) {
      expect(input.justPressed("down")).toBe(true);
      input.endUpdate();
    }
    expect(input.justPressed("down")).toBe(false);
    // Plafond : un clavier qui s'emballe n'accumule pas plus de 4 appuis d'avance.
    for (let i = 0; i < 10; i++) {
      input.keyDown("ArrowUp");
      input.keyUp("ArrowUp");
    }
    let count = 0;
    while (input.justPressed("up")) {
      count++;
      input.endUpdate();
    }
    expect(count).toBe(4);
  });

  it("traduit clavier et souris vers les mêmes actions", () => {
    expect(actionForKey("ArrowUp")).toBe("up");
    expect(actionForKey("KeyQ")).toBe("up");
    expect(actionForKey("KeyA")).toBe("down");
    expect(actionForKey("KeyZ")).toBe("left");
    expect(actionForKey("KeyX")).toBe("right");
    expect(actionForKey("Space")).toBe("validate");
    expect(actionForKey("Enter")).toBe("cancel");
    expect(actionForKey("Escape")).toBe("skip");
    expect(actionForKey("KeyP")).toBe("pause");
    expect(actionForKey("F1")).toBe("volumeDown");
    expect(actionForKey("F2")).toBe("volumeUp");
    expect(actionForKey("KeyW")).toBeUndefined();
    const input = new Input();
    input.mouseDown(0);
    input.keyDown("Space");
    input.mouseUp(0);
    expect(input.pressed("validate")).toBe(true); // Espace tient encore
    input.keyUp("Space");
    input.mouseDown(2);
    expect(input.justPressed("cancel")).toBe(true);
  });

  it("borne la position de la souris à 320×200", () => {
    const input = new Input();
    input.mouseMove(-5, 500);
    expect([input.mouseX, input.mouseY]).toEqual([0, 199]);
    input.mouseMove(319.6, 10);
    expect(input.mouseX).toBe(319);
  });

  it("recentrage (`14b3:0039`) : la souris va au point donné, sauf si une vraie souris survole l'écran", () => {
    const input = new Input();
    input.mouseMove(30, 40);
    input.warpMouse(0xa0, 100);
    expect([input.mouseX, input.mouseY]).toEqual([0xa0, 100]);
    input.mouseMove(30, 40);
    input.pointerHovering = true;
    input.warpMouse(0xa0, 100);
    expect([input.mouseX, input.mouseY]).toEqual([30, 40]);
  });

  it("pilote clavier du curseur (`3134:03c8`) : 1 << keyPointerShift pixels par appel, 4 px au départ puis 2 px une fois le pas posé à 1", () => {
    const input = new Input();
    expect(input.keyPointerShift).toBe(2);
    input.mouseMove(100, 100);
    input.keyDown("ArrowRight");
    input.keyDown("ArrowDown");
    input.moveMouseByKeys();
    expect([input.mouseX, input.mouseY]).toEqual([104, 104]);
    input.keyPointerShift = 1;
    input.moveMouseByKeys();
    expect([input.mouseX, input.mouseY]).toEqual([106, 106]);
    input.keyUp("ArrowRight");
    input.keyUp("ArrowDown");
    input.keyDown("ArrowLeft");
    input.moveMouseByKeys();
    expect([input.mouseX, input.mouseY]).toEqual([104, 106]);
  });
});

describe("Options parents", () => {
  it("valeurs par défaut sans données, valeurs bornées avec des données douteuses", () => {
    const storage = new MemoryStorage();
    expect(loadOptions(storage)).toEqual(DEFAULT_OPTIONS);
    storage.set(STORAGE_KEY, "pas du json");
    expect(loadOptions(storage)).toEqual(DEFAULT_OPTIONS);
    storage.set(STORAGE_KEY, JSON.stringify({ durationIndex: 9, pauseIndex: -2, messageIndex: 4.7, lastGameMinutes: "x" }));
    expect(loadOptions(storage)).toEqual({ durationIndex: 3, pauseIndex: 0, messageIndex: 4, lastGameMinutes: 0 });
  });

  it("enregistre et relit ; durée et verrou parental", () => {
    const storage = new MemoryStorage();
    const options = { durationIndex: 2, pauseIndex: 2, messageIndex: 8, lastGameMinutes: 1000 };
    expect(saveOptions(storage, options)).toBe(true);
    expect(loadOptions(storage)).toEqual(options);
    expect(gameSeconds(options)).toBe(5400);
    expect(isLocked(options, 1059)).toBe(true); // pause de 60 min
    expect(isLocked(options, 1060)).toBe(false);
    expect(isLocked({ ...options, pauseIndex: 0 }, 1000)).toBe(false);
  });
});

describe("noms de fichiers", () => {
  const files = new GameFiles([
    { path: "DATA/S52/S52D/S52D0.MUX", size: 1 },
    { path: "DATA/S07/S07A/S07A001D.MCG", size: 1 },
    { path: "DATA/S36/S36A/S36A000S.HY8", size: 1 },
    { path: "DATA/S36/S36E/S36A000S.HY8", size: 1 },
    { path: "DATA/DESCRIPT.ION", size: 1 },
  ]);

  it("développe sNNxXXX.ext en DATA/SNN/SNNx/SNNXXX.EXT", () => {
    expect(expandName("s07a001d.mcg")).toBe("DATA/S07/S07A/S07A001D.MCG");
    expect(expandName("descript.ion")).toBeUndefined();
  });

  it("résout un nom d'origine ou un chemin DATA/…", () => {
    expect(resolveGameFile(files, "s07a001d.mcg")).toBe("DATA/S07/S07A/S07A001D.MCG");
    expect(resolveGameFile(files, "s52d0.mux")).toBe("DATA/S52/S52D/S52D0.MUX");
    expect(resolveGameFile(files, "data/s36/s36e/s36a000s.hy8")).toBe("DATA/S36/S36E/S36A000S.HY8");
    expect(resolveGameFile(files, "descript.ion")).toBe("DATA/DESCRIPT.ION");
    expect(resolveGameFile(files, "nope.mcg")).toBeUndefined();
  });

  it("fabrique voix et musiques", () => {
    expect(voiceName("s07v", 4)).toBe("s07v004t.voc");
    expect(voiceName("s09v", 12)).toBe("s09v012t.voc");
    expect(musicName(2)).toBe("s52m002m.voc");
  });
});

describe("Surface (sans fichier)", () => {
  it("tampons A, B, C", () => {
    const s = new Surface();
    expect(s.work.length).toBe(SCREEN_PIXELS);
    s.clear(3);
    s.commitBackground();
    s.clear(9);
    expect(s.background[0]).toBe(3);
    s.restoreBackground();
    expect(s.work[100]).toBe(3);
    s.work[5] = 77;
    s.save();
    s.clear(0);
    s.restoreSaved();
    expect(s.work[5]).toBe(77);
  });

  it("blitImage : 0 transparent, miroir, mode opaque, clipping", () => {
    const image = { width: 16, height: 2, pixels: new Uint8Array(32) };
    image.pixels[0] = 5;
    image.pixels[1] = 0;
    image.pixels[2] = 6;
    image.pixels[15] = 7;
    const s = new Surface();
    s.work.fill(1);
    s.blitImage(image, 10, 20);
    expect(s.work[20 * 320 + 10]).toBe(5);
    expect(s.work[20 * 320 + 11]).toBe(1); // transparent : le fond reste
    expect(s.work[20 * 320 + 12]).toBe(6);
    expect(s.work[20 * 320 + 25]).toBe(7);
    s.work.fill(1);
    s.blitImage(image, 10, 20, { mirrorX: true });
    expect(s.work[20 * 320 + 10]).toBe(7);
    expect(s.work[20 * 320 + 25]).toBe(5);
    s.work.fill(1);
    s.blitImage(image, 10, 20, { opaque: true });
    expect(s.work[20 * 320 + 11]).toBe(0);
    // Hors écran : pas d'exception, rien d'écrit hors du tampon.
    s.work.fill(1);
    s.blitImage(image, -8, 199);
    expect(s.work[199 * 320]).toBe(1);
    s.blitImage(image, 310, -1);
    s.blitImage(image, 400, 400);
    expect(s.work.length).toBe(SCREEN_PIXELS);
  });
});

describe.skipIf(!hasOriginalFiles)("Surface et sprites HY8 (fichiers du jeu)", () => {
  const hy8 = () => parseHy8(readData("S01/S01A/S01A000S.HY8"));

  /** Premier sprite fait d'une seule image, sans miroir. */
  function plainSprite(file = hy8()) {
    const index = file.sprites.findIndex((s) => s.parts.length === 1 && s.parts[0].kind === HY8_PART_IMAGE && s.parts[0].flags === 0);
    expect(index).toBeGreaterThanOrEqual(0);
    const part = file.sprites[index].parts[0];
    return { file, index, part, image: file.images[part.target], point: part.points[0] };
  }

  it("drawSprite : pixels identiques à parseHy8, ancrage bas-gauche, transparence", () => {
    const { file, index, image, point } = plainSprite();
    const s = new Surface();
    s.work.fill(200);
    const x = 100;
    const y = 120;
    s.drawSprite(file, index, x, y);
    const left = x + point.x;
    const top = y + point.y - image.height + 1;
    for (let row = 0; row < image.height; row++) {
      for (let col = 0; col < image.width; col++) {
        const expected = image.pixels[row * image.width + col] || 200;
        expect(s.work[(top + row) * 320 + left + col]).toBe(expected);
      }
    }
    expect(image.pixels.some((p) => p === 0)).toBe(true);
  });

  it("drawSprite en miroir : image retournée, bord droit sur le point", () => {
    const { file, index, image, point } = plainSprite();
    const s = new Surface();
    s.work.fill(200);
    s.drawSprite(file, index, 150, 120, { mirrorX: true });
    const left = 150 - point.x - image.width;
    const top = 120 + point.y - image.height + 1;
    for (let row = 0; row < image.height; row++) {
      for (let col = 0; col < image.width; col++) {
        const expected = image.pixels[row * image.width + (image.width - 1 - col)] || 200;
        expect(s.work[(top + row) * 320 + left + col]).toBe(expected);
      }
    }
    // Le bit 0x8000 de l'indice a le même effet que l'option.
    const t = new Surface();
    t.work.fill(200);
    t.drawSprite(file, index | 0x8000, 150, 120);
    expect(t.work).toEqual(s.work);
  });

  it("blitImage opaque écrit aussi les pixels 0", () => {
    const { image } = plainSprite();
    const s = new Surface();
    s.work.fill(200);
    s.blitImage(image, 10, 10, { opaque: true });
    for (let i = 0; i < image.pixels.length; i++) {
      const row = Math.floor(i / image.width);
      expect(s.work[(10 + row) * 320 + 10 + (i % image.width)]).toBe(image.pixels[i]);
    }
  });

  it("lecteur d'animation : frame courante, boucle", () => {
    const file = parseHy8(readData("S22/S22A/S22A000S.HY8"));
    const index = file.animations.findIndex((a) => a.frames.length > 1);
    expect(index).toBeGreaterThanOrEqual(0);
    const player = new AnimationPlayer(file, index);
    const count = file.animations[index].frames.length;
    expect(player.frame).toBe(file.animations[index].frames[0]);
    for (let i = 0; i < count - 1; i++) player.advance();
    expect(player.frameIndex).toBe(count - 1);
    expect(player.looped).toBe(false);
    player.advance();
    expect(player.frameIndex).toBe(0);
    expect(player.looped).toBe(true);
    player.restart();
    expect(player.looped).toBe(false);
    const s = new Surface();
    s.drawFrame(file, player.frame!, 100, 100);
    expect(() => new AnimationPlayer(file, 9999)).toThrow();
  });

  it("drawText : largeur = measureText, glyphes peints, centrage et contour", () => {
    const font = parsePfn(readData("S52/S52D/S52D001F.PFN"));
    const text = new TextEncoder().encode("Hello");
    const s = new Surface();
    const width = s.drawText(font, text, 10, 20, 200);
    expect(width).toBe(measureText(font, text));
    // Chaque pixel d'encre du premier glyphe est peint.
    const glyph = font.glyphs.get(0x48)!;
    for (let row = 0; row < font.height; row++) {
      for (let col = 0; col < glyph.width; col++) {
        expect(s.work[(20 + row) * 320 + 10 + col]).toBe(glyph.bitmap[row * glyph.width + col] ? 200 : 0);
      }
    }
    // Rien en dehors de la boîte du texte.
    let painted = 0;
    for (let i = 0; i < s.work.length; i++) if (s.work[i] === 200) painted++;
    expect(painted).toBeGreaterThan(20);

    const centered = new Surface();
    centered.drawText(font, text, 160, 20, 200, { align: "center" });
    const left = 160 - Math.ceil(width / 2);
    const reference = new Surface();
    reference.drawText(font, text, left, 20, 200);
    expect(centered.work).toEqual(reference.work);

    const right = new Surface();
    right.drawText(font, text, 300, 20, 200, { align: "right" });
    const ref2 = new Surface();
    ref2.drawText(font, text, 300 - width, 20, 200);
    expect(right.work).toEqual(ref2.work);

    const outlined = new Surface();
    outlined.drawText(font, text, 10, 20, 200, { outline: 100 });
    expect(outlined.work.some((p) => p === 100)).toBe(true);
    // Le centre est repeint par-dessus le contour.
    for (let i = 0; i < s.work.length; i++) if (s.work[i] === 200) expect(outlined.work[i]).toBe(200);
  });

  it("drawText : un octet nul termine le texte, un glyphe vide avance sans dessiner", () => {
    const font = parsePfn(readData("S52/S52D/S52D001F.PFN"));
    const s = new Surface();
    expect(s.drawText(font, Uint8Array.of(0x41, 0, 0x42), 0, 0, 9)).toBe(measureText(font, Uint8Array.of(0x41)));
    const blank = new Surface();
    expect(blank.drawText(font, Uint8Array.of(0x20), 0, 0, 9)).toBe(measureText(font, Uint8Array.of(0x20)));
    expect(blank.work.every((p) => p === 0)).toBe(true);
  });
});
