import { describe, expect, it } from "vitest";
import { TICK_MS } from "../../../src/games/lure/engine/cadence";
import { SequenceScreen } from "../../../src/games/lure/engine/sequences/screen";
import { barrelSequence, chuteSequence } from "../../../src/games/lure/engine/sequences/index";
import { SCREEN_SIZE } from "../../../src/games/lure/data/picture";
import { FADE_STEP_MS } from "../../../src/games/lure/render/palette";
import { LureRenderer } from "../../../src/games/lure/render/renderer";
import { SequenceView } from "../../../src/games/lure/render/sequence";
import { hasOriginalFiles, makeEngine } from "../engine/test-host";

function blankScreen(): SequenceScreen {
  return new SequenceScreen({ numEntries: 256, rgb: new Uint8Array(768) });
}

describe("SequenceView (sans fichiers du jeu)", () => {
  const previous = (valid: boolean) => ({ image: new Uint8Array(SCREEN_SIZE).fill(7), palette: new Uint8Array(768).fill(200), valid });

  it("montre l'écran de la séquence tel quel", () => {
    const screen = blankScreen();
    screen.pixels.fill(3);
    screen.palette.fill(9);
    const view = new SequenceView();
    const image = new Uint8Array(SCREEN_SIZE);
    const palette = new Uint8Array(768);
    expect(view.render(screen, previous(true), image, palette, 80)).toBe(true);
    expect(image.every((v) => v === 3)).toBe(true);
    expect(palette.every((v) => v === 9)).toBe(true);
    expect(view.fading).toBe(false);
  });

  it("éteint d'abord la dernière image de la pièce (220 entrées, pas de 4 toutes les 20 ms), pendant que l'hôte suspend le moteur", () => {
    const screen = blankScreen();
    screen.holdRoom = true;
    const view = new SequenceView();
    const image = new Uint8Array(SCREEN_SIZE);
    const palette = new Uint8Array(768);
    const prev = previous(true);
    expect(view.render(screen, prev, image, palette, 0)).toBe(false);
    expect(view.fading).toBe(true);
    expect(image.every((v) => v === 7)).toBe(true);
    expect(palette[0]).toBe(200);
    view.render(screen, prev, image, palette, FADE_STEP_MS * 3);
    expect(palette[0]).toBe(188);
    expect(palette[659]).toBe(188);
    // les entrées au-delà de 220 gardent leur couleur (`paletteFadeOut()` sans argument)
    expect(palette[660]).toBe(200);
    view.render(screen, prev, image, palette, 5000);
    expect(view.fading).toBe(false);
    expect(palette.subarray(0, 660).every((v) => v === 0)).toBe(true);
    // la séquence reprend la main : son écran
    screen.holdRoom = false;
    screen.pixels.fill(5);
    expect(view.render(screen, prev, image, palette, 0)).toBe(true);
    expect(image.every((v) => v === 5)).toBe(true);
  });

  it("sans image précédente (introduction), pas de fondu à attendre", () => {
    const screen = blankScreen();
    screen.holdRoom = true;
    const view = new SequenceView();
    view.render(screen, previous(false), new Uint8Array(SCREEN_SIZE), new Uint8Array(768), 0);
    expect(view.fading).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("LureRenderer et les séquences plein écran", () => {
  it("l'introduction : image et palette de la séquence, curseur flèche, jamais de fondu à attendre ; puis la cellule sans fondu", () => {
    const { engine, host, data } = makeEngine({ intro: true });
    const renderer = new LureRenderer(data);
    const bare = new LureRenderer(data, { cursor: false });
    host.push({ type: "pointer", x: 150, y: 90, buttons: 0 });
    for (let i = 0; i < 30; i++) {
      engine.tick();
      renderer.render(engine, TICK_MS);
      bare.render(engine, TICK_MS);
      expect(renderer.fading).toBe(false);
    }
    const screen = engine.sequenceScreen!;
    expect(bare.output).toEqual(screen.pixels);
    expect(bare.palette).toEqual(screen.palette);
    // le curseur est dans l'image (flèche en (150, 90)) et nulle part ailleurs
    const diff = renderer.output.reduce((n, v, i) => n + (v !== screen.pixels[i] ? 1 : 0), 0);
    expect(diff).toBeGreaterThan(5);
    expect(diff).toBeLessThan(200);
    // Échap : l'introduction s'arrête, la cellule apparaît tout de suite (pas de fondu au premier affichage)
    host.push({ type: "action", action: "escape" });
    for (let i = 0; i < 40; i++) {
      engine.tick();
      renderer.render(engine, TICK_MS);
    }
    expect(engine.sequenceScreen).toBeNull();
    expect(engine.room.roomNumber).toBe(1);
    expect(renderer.fading).toBe(false);
    expect(renderer.palette.some((v) => v !== 0)).toBe(true);
    expect(renderer.output.some((v) => v !== 0)).toBe(true);
  });

  it("une séquence de partie : la pièce s'éteint (moteur suspendu), la séquence se joue, puis la pièce suivante apparaît en fondu depuis le dernier écran", () => {
    const { engine, host, data } = makeEngine();
    const renderer = new LureRenderer(data, { cursor: false });
    engine.tick();
    renderer.render(engine, TICK_MS);
    const roomImage = renderer.output.slice();
    const roomPalette = renderer.palette.slice();

    engine.block(barrelSequence(engine));
    engine.tick();
    renderer.render(engine, 0);
    // première image : on est dans la séquence, la pièce est encore là et va s'éteindre
    expect(engine.sequenceScreen!.holdRoom).toBe(true);
    expect(renderer.fading).toBe(true);
    expect(renderer.output).toEqual(roomImage);
    renderer.render(engine, FADE_STEP_MS * 5);
    expect(renderer.output).toEqual(roomImage);
    expect(renderer.palette.subarray(0, 660).some((v, i) => v < roomPalette[i]!)).toBe(true);
    renderer.render(engine, 5000);
    expect(renderer.fading).toBe(false);
    expect(renderer.palette.subarray(0, 660).every((v) => v === 0)).toBe(true);

    // la séquence joue : son écran
    let ticks = 0;
    let sawAnimation = false;
    while (engine.busy && ticks < 3000) {
      engine.tick();
      host.clock += TICK_MS;
      renderer.render(engine, TICK_MS);
      ticks++;
      // l'image montrée est celle de la séquence, en couleurs
      if (engine.sequenceScreen && !engine.sequenceScreen.holdRoom && renderer.output.every((v, i) => v === engine.sequenceScreen!.pixels[i]) && renderer.palette.some((v) => v > 100)) sawAnimation = true;
    }
    expect(sawAnimation).toBe(true);
    expect(engine.sequenceScreen).toBeNull();
    expect(renderer.fading).toBe(false);
  });

  it("le dernier écran d'une chute est celui que le changement de pièce éteint", () => {
    const { engine, host, data } = makeEngine();
    const renderer = new LureRenderer(data, { cursor: false });
    engine.tick();
    renderer.render(engine, TICK_MS);
    const fields = engine.world.fields;
    fields.set(76, 1);
    fields.playerNewPos.roomNumber = 14;
    let last: Uint8Array | null = null;
    let ticks = 0;
    do {
      engine.tick();
      host.clock += TICK_MS;
      renderer.render(engine, renderer.fading ? 5000 : TICK_MS);
      if (engine.sequenceScreen && !engine.sequenceScreen.holdRoom) last = renderer.output.slice();
      ticks++;
    } while (engine.busy && ticks < 3000);
    expect(engine.room.roomNumber).toBe(14);
    expect(last).not.toBeNull();
    // juste après la séquence : la nouvelle pièce s'annonce par un fondu qui part de la dernière image de la séquence
    renderer.render(engine, 0);
    expect(renderer.fading).toBe(true);
    expect(renderer.output).toEqual(last);
    for (let i = 0; i < 200 && renderer.fading; i++) renderer.render(engine, 100);
    expect(renderer.fading).toBe(false);
  });

  it("chaque animation plein écran se décode et se joue sans erreur (palette et écran de départ)", () => {
    const { engine, host } = makeEngine();
    engine.tick();
    for (const make of [chuteSequence, barrelSequence]) {
      engine.block(make(engine));
      let ticks = 0;
      do {
        engine.tick();
        host.clock += TICK_MS;
        ticks++;
      } while (engine.busy && ticks < 3000);
      expect(engine.busy).toBe(false);
    }
  });
});
