import { describe, expect, it } from "vitest";
import { FRAME_TICKS } from "../../../src/games/drascula/engine/cadence";
import { DrasculaEngine } from "../../../src/games/drascula/engine/loop";
import { drasculaScript } from "../../../src/games/drascula/engine/rooms";
import { InputQueue, TAP_DELAY_TICKS } from "../../../src/games/drascula/ui/input";
import { keyAction } from "../../../src/games/drascula/ui/keys";
import { TestHost } from "../engine/test-host";
import { hasOriginalFiles } from "../helpers";

describe("InputQueue : souris en échantillons d'état", () => {
  it("les déplacements consécutifs sont fusionnés ; coordonnées arrondies et ramenées dans l'écran", () => {
    const q = new InputQueue();
    q.move(10.7, 20.2);
    q.move(30, 40);
    q.move(-5, 999);
    expect(q.drain()).toEqual([{ type: "pointer", x: 0, y: 199, buttons: 0 }]);
    q.move(400, 3);
    expect(q.drain()).toEqual([{ type: "pointer", x: 319, y: 3, buttons: 0 }]);
    expect(q.drain()).toEqual([]);
  });

  const settle = (q: InputQueue, ticks = TAP_DELAY_TICKS + 3): ReturnType<InputQueue["drain"]> => Array.from({ length: ticks }, () => q.drain()).flat();

  it("appui et relâchement ne sont jamais fusionnés avec les déplacements (un clic bref reste vu du moteur)", () => {
    const q = new InputQueue();
    q.move(6, 7);
    settle(q);
    q.down(0, 6, 7);
    q.up(0, 6, 7);
    q.move(8, 9);
    expect(q.drain()).toEqual([
      { type: "pointer", x: 6, y: 7, buttons: 1 },
      { type: "pointer", x: 6, y: 7, buttons: 0 },
      { type: "pointer", x: 8, y: 9, buttons: 0 },
    ]);
  });

  it("une souris qui bouge puis clique plus tard n'attend rien ; un saut de position suivi tout de suite d'un clic retarde l'appui (et le relâchement)", () => {
    const q = new InputQueue();
    q.move(100, 100);
    expect(q.drain()).toHaveLength(1);
    for (let i = 0; i < TAP_DELAY_TICKS; i++) q.drain();
    q.down(0, 100, 100);
    expect(q.drain().map((e) => e.type === "pointer" && e.buttons)).toEqual([1]);
    q.up(0, 100, 100);
    q.drain();
    // saut de position puis clic dans le même tick : le moteur doit voir la nouvelle position pendant deux images avant l'appui
    q.move(250, 10);
    q.down(0, 250, 10);
    q.up(0, 250, 10);
    const ticks = Array.from({ length: TAP_DELAY_TICKS + 2 }, () => q.drain());
    expect(ticks[0]).toEqual([{ type: "pointer", x: 250, y: 10, buttons: 0 }]);
    expect(ticks.slice(1, TAP_DELAY_TICKS).flat()).toEqual([]);
    expect(ticks[TAP_DELAY_TICKS]).toEqual([
      { type: "pointer", x: 250, y: 10, buttons: 1 },
      { type: "pointer", x: 250, y: 10, buttons: 0 },
    ]);
  });

  it("bouton gauche = 1, droit = 2, milieu ignoré ; les deux tenus se cumulent", () => {
    const q = new InputQueue();
    q.down(0, 0, 0);
    q.down(2, 0, 0);
    q.down(1, 0, 0);
    q.up(0, 0, 0);
    expect(q.drain().map((e) => (e.type === "pointer" ? e.buttons : -1))).toEqual([1, 3, 3, 2]);
  });

  it("une touche est un événement, dans l'ordre", () => {
    const q = new InputQueue();
    q.move(1, 1);
    q.key("F1");
    q.move(2, 2);
    expect(q.drain()).toEqual([
      { type: "pointer", x: 1, y: 1, buttons: 0 },
      { type: "key", key: "F1" },
      { type: "pointer", x: 2, y: 2, buttons: 0 },
    ]);
    q.move(3, 3);
    q.move(4, 4);
    expect(q.drain()).toEqual([{ type: "pointer", x: 4, y: 4, buttons: 0 }]);
  });

  it("un toucher : le pointeur va tout de suite en (x, y), le bouton est enfoncé deux images plus tard puis relâché", () => {
    const q = new InputQueue();
    q.tap(0, 100, 120);
    expect(q.tapPending).toBe(true);
    // un drain par tick du moteur : le tick 0 donne le déplacement, puis rien jusqu'à l'appui, puis le relâchement
    const ticks = Array.from({ length: TAP_DELAY_TICKS + 3 }, () => q.drain());
    expect(ticks[0]).toEqual([{ type: "pointer", x: 100, y: 120, buttons: 0 }]);
    const pressed = ticks.findIndex((events) => events.some((e) => e.type === "pointer" && e.buttons === 1));
    const released = ticks.findIndex((events, tick) => tick > pressed && events.length > 0);
    expect(pressed).toBe(TAP_DELAY_TICKS);
    expect(released).toBe(pressed + 1);
    expect(ticks[released]).toEqual([{ type: "pointer", x: 100, y: 120, buttons: 0 }]);
    expect(q.tapPending).toBe(false);
  });

  it("appui long : clic droit différé de la même façon", () => {
    const q = new InputQueue();
    q.tap(2, 10, 20);
    const events = Array.from({ length: TAP_DELAY_TICKS + 1 }, () => q.drain()).flat();
    expect(events.filter((e) => e.type === "pointer" && e.buttons === 2)).toHaveLength(1);
  });

  it("releaseAll relâche un bouton tenu à la dernière position connue", () => {
    const q = new InputQueue();
    q.down(0, 7, 8);
    q.drain();
    q.releaseAll();
    expect(q.drain()).toEqual([{ type: "pointer", x: 7, y: 8, buttons: 0 }]);
  });

  it("releaseAll oublie les touchers différés", () => {
    const q = new InputQueue();
    q.tap(0, 4, 4);
    q.drain();
    q.releaseAll();
    expect(q.tapPending).toBe(false);
    expect(settle(q)).toEqual([]);
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
