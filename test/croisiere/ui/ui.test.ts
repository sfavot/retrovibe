import { describe, expect, it } from "vitest";
import { InputQueue } from "../../../src/games/croisiere/ui/browser-host";
import { keyAction } from "../../../src/games/croisiere/ui/keys";
import { FrameQueue, cursorColors } from "../../../src/games/croisiere/ui/loop";
import { parseSlot } from "../../../src/games/croisiere/ui/saves";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("touches", () => {
  it("F10 ouvre le menu joueur, P et F1 restent au site, Ctrl au navigateur", () => {
    expect(keyAction(key("F10"))).toEqual({ type: "engine", action: "playerMenu" });
    expect(keyAction(key(" "))).toEqual({ type: "engine", action: "endUserWaiting" });
    expect(keyAction(key("Escape"))).toEqual({ type: "engine", action: "escape" });
    expect(keyAction(key("p"))).toEqual({ type: "host", command: "pause" });
    expect(keyAction(key("F1"))).toEqual({ type: "host", command: "menu" });
    expect(keyAction(key("r", { ctrlKey: true }))).toBeNull();
    expect(keyAction(key("a"))).toBeNull();
  });
});

describe("file des entrées", () => {
  it("un toucher pousse déplacement, appui et relâchement d'un coup", () => {
    const q = new InputQueue();
    q.tap(2, 10.7, 500);
    expect(q.drain()).toEqual([
      { type: "move", x: 10, y: 199 },
      { type: "down", button: 2 },
      { type: "up", button: 2 },
    ]);
    expect(q.touchMode).toBe(true);
  });

  it("deux déplacements de suite n'en font qu'un ; « Passer » clique sur place", () => {
    const q = new InputQueue();
    q.move(1, 1);
    q.move(2, 2);
    q.clickInPlace();
    expect(q.drain()).toEqual([{ type: "move", x: 2, y: 2 }, { type: "down", button: 1 }, { type: "up", button: 1 }]);
  });

  it("Échap est tenue jusqu'au relâchement", () => {
    const q = new InputQueue();
    q.action("escape");
    q.action("escape");
    expect(q.drain()).toEqual([{ type: "actionStart", action: "escape" }]);
    q.endAction("escape");
    expect(q.drain()).toEqual([{ type: "actionEnd", action: "escape" }]);
  });

  it("la pause jette les appuis en attente, relâche tout et refuse les nouvelles entrées", () => {
    const q = new InputQueue();
    q.action("escape");
    q.down(0, 5, 5);
    q.setPaused(true);
    q.tap(0, 1, 1);
    const events = q.drain();
    expect(events.some((e) => e.type === "actionStart")).toBe(false);
    expect(events.some((e) => e.type === "down")).toBe(false);
    expect(events).toContainEqual({ type: "up", button: 1 });
    expect(events).toContainEqual({ type: "actionEnd", action: "escape" });
  });
});

describe("images et curseur", () => {
  it("montre chaque image d'un fondu à sa date en temps virtuel", () => {
    const frames = new FrameQueue();
    const at = (time: number, value: number) =>
      frames.present({ virtualTime: time, display: { globalScreen: new Uint8Array([value]), hardwarePalette: new Uint8Array(3) } } as never);
    at(100, 1);
    at(120, 2);
    at(140, 3);
    expect(frames.at(110)?.pixels[0]).toBe(1);
    expect(frames.at(125)?.pixels[0]).toBe(2);
    expect(frames.at(1000)?.pixels[0]).toBe(3);
  });

  it("emprunte deux indices absents de l'image, sinon les plus proches du noir et du blanc", () => {
    const palette = new Uint8Array(768);
    palette.fill(255, 30, 33);
    expect(cursorColors(new Uint8Array([0, 1, 2]), palette)).toEqual({ black: 255, white: 254, borrowed: true });
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(cursorColors(all, palette)).toEqual({ black: 0, white: 10, borrowed: false });
  });
});

describe("emplacements", () => {
  it("accepte { place, state } et refuse le reste", () => {
    expect(parseSlot({ place: "S33", state: { version: 1 } })).toEqual({ place: "S33", state: { version: 1 } });
    expect(parseSlot({ place: 3, state: {} })).toBeNull();
    expect(parseSlot(null)).toBeNull();
  });
});
