import { describe, expect, it } from "vitest";
import { FRAME_TICKS } from "../../../src/games/drascula/engine/cadence";
import { DrasculaEngine } from "../../../src/games/drascula/engine/loop";
import { drasculaScript } from "../../../src/games/drascula/engine/rooms";
import { InputQueue, SCREEN_HEIGHT, SCREEN_WIDTH, TAP_DELAY_TICKS } from "../../../src/games/drascula/ui/input";
import { keyAction } from "../../../src/games/drascula/ui/keys";
import { TestHost } from "../engine/test-host";
import { hasOriginalFiles } from "../helpers";

describe("InputQueue : réglage de Drascula", () => {
  it("écran de 320 x 200, événements du moteur, appui retardé de deux images après un saut de position", () => {
    const q = new InputQueue();
    q.move(400, 999);
    expect(q.drain()).toEqual([{ type: "pointer", x: SCREEN_WIDTH - 1, y: SCREEN_HEIGHT - 1, buttons: 0 }]);
    q.key("Escape");
    expect(q.drain()).toEqual([{ type: "key", key: "Escape" }]);
    q.tap(0, 10, 10);
    const ticks = Array.from({ length: TAP_DELAY_TICKS + 2 }, () => q.drain());
    expect(ticks[TAP_DELAY_TICKS].map((e) => e.type === "pointer" && e.buttons)).toEqual([1]);
    expect(TAP_DELAY_TICKS).toBe(2 * FRAME_TICKS);
  });
});

describe("keyAction : touches du navigateur", () => {
  const key = (name: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...extra });

  it("F10 sauvegarde, F7 charge, F9 règle le volume, T bascule les sous-titres, Espace met en pause", () => {
    expect(keyAction(key("F10"))).toEqual({ type: "host", command: "save" });
    expect(keyAction(key("F7"))).toEqual({ type: "host", command: "load" });
    expect(keyAction(key("F9"))).toEqual({ type: "host", command: "volume" });
    expect(keyAction(key("t"))).toEqual({ type: "host", command: "subtitles" });
    expect(keyAction(key("T"))).toEqual({ type: "host", command: "subtitles" });
    expect(keyAction(key(" "))).toEqual({ type: "host", command: "pause" });
  });

  it("verbes, Échap, Entrée, chiffres : transmis au moteur tels quels", () => {
    for (const name of ["F1", "F6", "F8", "Escape", "Enter", "0", "a"]) expect(keyAction(key(name))).toEqual({ type: "engine", key: name });
  });

  it("Ctrl / Cmd + touche, Alt + lettre, modificateurs, Tab, F11 et F12 restent au navigateur", () => {
    expect(keyAction(key("r", { ctrlKey: true }))).toBeNull();
    expect(keyAction(key("r", { metaKey: true }))).toBeNull();
    expect(keyAction(key("å", { altKey: true }))).toBeNull();
    for (const name of ["Shift", "Control", "Alt", "Meta", "Dead", "Tab", "F11", "F12"]) expect(keyAction(key(name))).toBeNull();
  });
});

/** Hôte de test dont les entrées passent par l'`InputQueue` de l'hôte du navigateur. */
class QueueHost extends TestHost {
  readonly input = new InputQueue();
  override pollInput() {
    return [...this.input.drain(), ...super.pollInput()];
  }
}

describe.skipIf(!hasOriginalFiles)("toucher juste après un survol de la barre des verbes (rooms.md § 7)", () => {
  const setup = () => {
    const host = new QueueHost();
    const engine = new DrasculaEngine(host, { seed: 1, script: { ...drasculaScript, animations: {} } });
    const run = (ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        host.clock += 10;
        engine.tick();
      }
    };
    run(5);
    for (let i = 0; i < 5000 && engine.busy; i++) run(1);
    // le doigt s'est posé sur l'icône « regarder » de la barre, puis le jeu a eu le temps de s'en apercevoir
    host.input.move(engine.data.dat.verbBarX[1] + 3, 5);
    run(FRAME_TICKS * 2);
    expect(engine.state.menuBar).toBe(true);
    return { host, engine, run };
  };

  it("un appui immédiat dans la pièce choisirait encore un verbe (le comportement de ScummVM)", () => {
    const { host, engine, run } = setup();
    // appui brut, sans l'attente de la file (`host.push` : entrées du TestHost)
    host.push({ type: "pointer", x: 250, y: 150, buttons: 0 });
    host.push({ type: "pointer", x: 250, y: 150, buttons: 1 });
    host.push({ type: "pointer", x: 250, y: 150, buttons: 0 });
    run(FRAME_TICKS);
    expect(engine.state.takeObject).toBe(true);
  });

  it("le toucher du doigt laisse le jeu voir que le doigt a quitté la barre : il fait marcher le héros, sans choisir de verbe", () => {
    const { host, engine, run } = setup();
    const before = { x: engine.state.hero.x, y: engine.state.hero.y };
    host.input.tap(0, 250, 150);
    run(TAP_DELAY_TICKS + FRAME_TICKS * 3);
    expect(engine.state.takeObject).toBe(false);
    expect(engine.state.hero.x !== before.x || engine.state.hero.y !== before.y).toBe(true);
  });

  it("à l'inverse, un clic immédiat sur une icône de la barre (souris téléportée, pavé tactile) choisit bien le verbe", () => {
    const host = new QueueHost();
    const engine = new DrasculaEngine(host, { seed: 1, script: { ...drasculaScript, animations: {} } });
    const run = (ticks: number): void => {
      for (let i = 0; i < ticks; i++) {
        host.clock += 10;
        engine.tick();
      }
    };
    run(5);
    for (let i = 0; i < 5000 && engine.busy; i++) run(1);
    host.input.move(250, 150);
    run(FRAME_TICKS * 2);
    const x = engine.data.dat.verbBarX[5] + 3;
    host.input.move(x, 5);
    host.input.down(0, x, 5);
    host.input.up(0, x, 5);
    run(TAP_DELAY_TICKS + FRAME_TICKS * 3);
    expect(engine.state.takeObject).toBe(true);
    expect(engine.state.pickedObject).toBe(5);
  });
});
