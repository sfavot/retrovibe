import { describe, expect, it } from "vitest";
import { EventQueue, EventType, eventsOf, KeyModifier, MouseButton, SciKey, sciKeyOf } from "../../../src/games/gk1/engine/events";
import { original } from "../data/real";
import { Scene } from "../render/scene";

describe("file des évènements", () => {
  it("sert les évènements dans l'ordre, avec la position du pointeur à leur création", () => {
    const queue = new EventQueue();
    queue.move(12.7, 40.2);
    queue.down(MouseButton.Left, 100, 50);
    queue.move(300, 199);
    queue.up(MouseButton.Left, 110, 60);
    expect(queue.next(0x7fff)).toEqual({ type: EventType.MousePress, message: 0, modifiers: 0, x: 100, y: 50 });
    expect(queue.next(0x7fff)).toEqual({ type: EventType.MouseRelease, message: 0, modifiers: 0, x: 110, y: 60 });
    // File vide : évènement nul, à la position courante.
    expect(queue.next(0x7fff)).toEqual({ type: EventType.None, message: 0, modifiers: 0, x: 110, y: 60 });
  });

  it("borne le pointeur à l'écran de 320×200", () => {
    const queue = new EventQueue();
    queue.move(-5, 250);
    expect([queue.x, queue.y]).toEqual([0, 199]);
    queue.move(320, -1);
    expect([queue.x, queue.y]).toEqual([319, 0]);
  });

  it("bouton droit = Maj, bouton du milieu = Ctrl (D7)", () => {
    const queue = new EventQueue();
    queue.down(MouseButton.Right, 1, 1);
    queue.up(MouseButton.Right, 1, 1);
    queue.down(MouseButton.Middle, 1, 1);
    expect(queue.next(0x7fff).modifiers).toBe(KeyModifier.Shift);
    expect(queue.next(0x7fff)).toMatchObject({ type: EventType.MouseRelease, modifiers: KeyModifier.Shift });
    expect(queue.next(0x7fff).modifiers).toBe(KeyModifier.Ctrl);
  });

  it("filtre par masque, et laisse en file avec Peek", () => {
    const queue = new EventQueue();
    queue.down(MouseButton.Left, 5, 5);
    queue.keyDown(SciKey.Enter);
    expect(queue.next(EventType.KeyDown | EventType.Peek).message).toBe(SciKey.Enter);
    expect(queue.pending).toBe(2);
    expect(queue.next(EventType.KeyDown).message).toBe(SciKey.Enter);
    expect(queue.next(EventType.KeyDown).type).toBe(EventType.None);
    expect(queue.next(EventType.MousePress).type).toBe(EventType.MousePress);
    expect(queue.pending).toBe(0);
  });

  it("relâche tout ce qui est tenu", () => {
    const queue = new EventQueue();
    queue.down(MouseButton.Left, 5, 5);
    queue.keyDown(0, KeyModifier.Alt);
    queue.next(0x7fff);
    queue.releaseAll();
    expect(queue.next(0x7fff)).toMatchObject({ type: EventType.MouseRelease, x: 5, y: 5 });
    expect(queue.modifiers).toBe(0);
    queue.releaseAll();
    expect(queue.pending).toBe(0);
  });

  it("une interception avale l'appui, son relâchement et Échap", () => {
    const queue = new EventQueue();
    let movie = true;
    queue.intercept = () => movie;
    queue.down(MouseButton.Left, 5, 5);
    movie = false;
    queue.up(MouseButton.Left, 5, 5);
    expect(queue.pending).toBe(0);
    movie = true;
    queue.keyDown(SciKey.Escape);
    queue.keyDown(SciKey.Enter);
    expect(queue.pending).toBe(1);
  });

  it("traduit les touches du navigateur en codes SCI", () => {
    expect(sciKeyOf({ key: "a" })).toBe(0x61);
    expect(sciKeyOf({ key: "A", shiftKey: true })).toBe(0x41);
    expect(sciKeyOf({ key: "Enter" })).toBe(13);
    expect(sciKeyOf({ key: "Escape" })).toBe(27);
    expect(sciKeyOf({ key: "Tab" })).toBe(9);
    expect(sciKeyOf({ key: "Tab", shiftKey: true })).toBe(0x0f00);
    expect(sciKeyOf({ key: "ArrowUp" })).toBe(0x4800);
    expect(sciKeyOf({ key: "PageDown" })).toBe(0x5100);
    expect(sciKeyOf({ key: "F1" })).toBe(0x3b00);
    expect(sciKeyOf({ key: "F10" })).toBe(0x4400);
    expect(sciKeyOf({ key: "F5", shiftKey: true })).toBe(0x5800);
    expect(sciKeyOf({ key: "F11" })).toBe(0);
    expect(sciKeyOf({ key: "s", ctrlKey: true })).toBe(19);
    expect(sciKeyOf({ key: "x", altKey: true })).toBe(0x2d00);
    expect(sciKeyOf({ key: "é" })).toBe(0x82);
    expect(sciKeyOf({ key: "Shift" })).toBe(0);
    expect(sciKeyOf({ key: "Dead" })).toBe(0);
  });
});

describe.skipIf(!original.has)("noyau des évènements, sur les classes du jeu", () => {
  it("GetEvent écrit position, type, message et modificateurs, et rend 0 pour l'évènement nul", () => {
    const scene = new Scene();
    const events = eventsOf(scene.vm);
    const event = scene.make("Event", {});
    const getEvent = (mask: number): number => scene.vm.kernel.call(scene.vm, scene.vm.kernel.indexOf("GetEvent"), Uint32Array.of(mask, event));
    const fields = (): number[] => ["type", "message", "modifiers", "x", "y"].map((name) => scene.get(event, name));

    events.move(33, 44);
    expect(getEvent(0x7fff)).toBe(0);
    expect(fields()).toEqual([0, 0, 0, 33, 44]);
    events.down(MouseButton.Right, 200, 150);
    events.keyDown(SciKey.Up, KeyModifier.Ctrl);
    expect(getEvent(0x7fff)).toBe(1);
    expect(fields()).toEqual([EventType.MousePress, 0, KeyModifier.Shift, 200, 150]);
    expect(getEvent(0x7fff)).toBe(1);
    expect(fields()).toEqual([EventType.KeyDown, SciKey.Up, KeyModifier.Ctrl, 200, 150]);
    expect(scene.vm.kernel.journal.stubs.has("GetEvent")).toBe(false);
  });

  it("MapKeyToDir fait d'une flèche une direction", () => {
    const scene = new Scene();
    const mapKey = (type: number, message: number): number[] => {
      const event = scene.make("Event", { type, message });
      scene.vm.acc = 77;
      return [scene.kernelOn("MapKeyToDir", event), scene.get(event, "type"), scene.get(event, "message")];
    };
    expect(mapKey(EventType.KeyDown, SciKey.Up)).toEqual([1, EventType.Direction, 1]);
    expect(mapKey(EventType.KeyDown, SciKey.Left)).toEqual([1, EventType.Direction, 7]);
    expect(mapKey(EventType.KeyDown, SciKey.Center)).toEqual([1, EventType.Direction, 0]);
    expect(mapKey(EventType.KeyDown, 0x61)).toEqual([0, EventType.KeyDown, 0x61]);
    // Pas un appui de touche : rien ne change, pas même l'accumulateur.
    expect(mapKey(EventType.MousePress, SciKey.Up)).toEqual([77, EventType.MousePress, SciKey.Up]);
  });

  it("GlobalToLocal et LocalToGlobal décalent du coin du plan", () => {
    const scene = new Scene();
    const plane = scene.plane(20, 10, 319, 199);
    const event = scene.make("Event", { x: 100, y: 50 });
    expect(scene.kernelOn("GlobalToLocal", event, plane)).toBe(1);
    expect([scene.get(event, "x"), scene.get(event, "y")]).toEqual([80, 40]);
    expect(scene.kernelOn("LocalToGlobal", event, plane)).toBe(1);
    expect([scene.get(event, "x"), scene.get(event, "y")]).toEqual([100, 50]);
    // Un seul argument : le plan est celui de l'évènement, s'il en a un.
    scene.kernelOn("GlobalToLocal", event);
    expect(scene.get(event, "x")).toBe(100);
    scene.set(event, { plane });
    scene.kernelOn("GlobalToLocal", event);
    expect([scene.get(event, "x"), scene.get(event, "y")]).toEqual([80, 40]);
    expect(scene.vm.warnings.size).toBe(0);
  });

  it("HaveMouse répond oui", () => {
    expect(new Scene().kernel("HaveMouse")).not.toBe(0);
  });
});
