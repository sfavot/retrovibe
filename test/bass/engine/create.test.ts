import { describe, expect, it } from "vitest";
import { createBassEngine } from "../../../src/games/bass/create";
import { TestHost } from "../../../src/games/bass/engine/host";
import { BassTextManager } from "../../../src/games/bass/engine/text";
import { NullScreen, SilentSound } from "../../../src/games/bass/engine/services";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { skyCpt, skyDisk } from "../data/helpers";
import { hasOriginalFiles } from "./helpers";

describe.skipIf(!hasOriginalFiles)("createBassEngine : branchement des services", () => {
  const data = () => ({ disk: skyDisk(), cpt: skyCpt() });

  it("sans option : moteur de logique (NullScreen, SilentSound) avec textes, grille et route réels", () => {
    const { engine, renderer, audio } = createBassEngine(data(), new TestHost());
    expect([renderer, audio]).toEqual([null, null]);
    expect(engine.screen).toBeInstanceOf(NullScreen);
    expect(engine.sound).toBeInstanceOf(SilentSound);
    expect(engine.text).toBeInstanceOf(BassTextManager);
  });

  it("render : l'écran réel est lié au moteur et composé à chaque tour, sans appel de l'hôte", () => {
    const { engine, renderer } = createBassEngine(data(), new TestHost(), { render: true });
    expect(engine.screen).toBe(renderer);
    engine.startAfterIntro();
    engine.runCycles(3);
    expect(renderer!.presented).toBeGreaterThan(0);
    expect(renderer!.frame.pixels.some((p) => p !== 0)).toBe(true);
  });

  it("render et screen sont exclusifs ; screen peut être une fabrique", () => {
    expect(() => createBassEngine(data(), new TestHost(), { render: true, screen: new NullScreen() })).toThrow(/exclusifs/);
    let seen: unknown = null;
    const { engine } = createBassEngine(data(), new TestHost(), { screen: (e) => ((seen = e), new BassScreenRenderer().attach(e)) });
    expect(seen).toBe(engine);
  });

  it("restartGame remet la grille et les écrans à zéro avant la palette", () => {
    const { engine, renderer } = createBassEngine(data(), new TestHost(), { render: true });
    renderer!.workScreen.fill(7);
    renderer!.grid.fill(0);
    engine.restartGame();
    expect(renderer!.grid.every((b) => b === 0x80)).toBe(true);
    expect(renderer!.workScreen.every((p) => p === 0)).toBe(true);
  });
});
