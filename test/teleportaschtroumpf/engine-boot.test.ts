import { describe, expect, it } from "vitest";
import { parseMcg } from "../../src/games/teleportaschtroumpf/data/mcg";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { Palette } from "../../src/games/teleportaschtroumpf/engine/palette";
import { LOGO_WAIT_SECONDS, createBootScene } from "../../src/games/teleportaschtroumpf/scenes/boot";
import { TestHost, runFor } from "./engine-test-host";
import { hasOriginalFiles, readData } from "./helpers";

describe.skipIf(!hasOriginalFiles)("démarrage headless", () => {
  it("logo → intro (passée par Échap) → titre → fond du menu, avec les pixels de S07A001D.MCG", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 42 });
    await engine.start(createBootScene());

    /** Scènes rencontrées, dans l'ordre, avec le temps simulé (ms) de leur entrée. */
    const sequence: { name: string; at: number }[] = [];
    let last: unknown = null;
    const names = () => sequence.map((s) => s.name);
    const advance = (ms: number) =>
      runFor(engine, host, ms, () => {
        const top = engine.ctx.scenes.top;
        if (top && top !== last) {
          last = top;
          sequence.push({ name: top.constructor.name, at: host.time });
        }
      });
    const advanceUntil = async (done: () => boolean, limitMs: number) => {
      for (let t = 0; !done() && t < limitMs; t += 50) await advance(50);
      expect(done()).toBe(true);
    };
    const press = async (code: string) => {
      host.input.keyDown(code);
      await advance(100);
      host.input.keyUp(code);
    };

    // Logo : image (fondu d'entrée), vidéo (≈ 12 s avec son), attente de 3 s sur écran noir.
    await advance(1000);
    expect(names()).toEqual(["PictureScene", "VideoScene"]);
    await advanceUntil(() => sequence.length >= 3, 15_000);
    expect(names()).toEqual(["PictureScene", "VideoScene", "WaitScene"]);
    await advanceUntil(() => sequence.length >= 4, 5000);
    expect(names()[3]).toBe("VideoScene"); // intro S06
    const waited = sequence[3].at - sequence[2].at;
    expect(waited).toBeGreaterThanOrEqual(LOGO_WAIT_SECONDS * 1000 - 50);
    expect(waited).toBeLessThan(LOGO_WAIT_SECONDS * 1000 + 150);

    // L'intro dure plus de deux minutes : Échap la passe.
    await advance(2000);
    expect(sequence).toHaveLength(4);
    await press("Escape");
    await advanceUntil(() => sequence.length >= 5, 3000);
    expect(names()[4]).toBe("VideoScene"); // titre S05 (vidéo)

    // La vidéo du titre n'est pas passable.
    await advance(1000);
    await press("Escape");
    await advance(500);
    expect(sequence).toHaveLength(5);

    // Puis l'image du titre (1 s) et le fond du menu.
    await advanceUntil(() => sequence.length >= 6, 20_000);
    await advanceUntil(() => sequence.length >= 7, 5000);
    expect(names().slice(5)).toEqual(["PictureScene", "MenuScene"]);
    const holdMs = sequence[6].at - sequence[5].at;
    expect(holdMs).toBeGreaterThan(1000);
    expect(holdMs).toBeLessThan(1000 + 700); // 1 s + fondu de sortie

    // Fin du fondu d'entrée du menu : l'écran est celui de S07A001D.MCG.
    await advanceUntil(() => !engine.ctx.fade.active, 2000);
    await advance(100);
    const menu = parseMcg(new Uint8Array(readData("S07/S07A/S07A001D.MCG")));
    const shown = host.lastPresentation;
    expect(shown.surface).toEqual(menu.pixels);
    const palette = new Palette();
    palette.load(menu.palette);
    palette.setColor(120, 0x10, 0xa4, 0xcc); // le premier bouton (Règles) est en surbrillance
    expect(shown.palette).toEqual(palette.display());
    expect([...shown.palette.subarray(0, 3)]).toEqual([0, 0, 0]);

    // Musique de fond : un des trois s52m00Nm.voc, en boucle.
    const music = host.audio.plays[host.audio.plays.length - 1];
    expect(music.loop).toBe(true);
    const sizes = [1430214, 456503, 501701];
    expect(sizes.some((size) => Math.abs(size - music.sound.samples.length) < 200)).toBe(true);
  }, 120_000);
});
