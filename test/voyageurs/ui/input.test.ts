import { describe, expect, it } from "vitest";
import type { VoyageursInput } from "../../../src/games/voyageurs/engine/host";
import { InputQueue, SETTLE_STEPS, TAP_HOLD_STEPS } from "../../../src/games/voyageurs/ui/input";

/** Rend, pas par pas, les entrées de `queue` avec le numéro du pas. */
function run(queue: InputQueue, steps: number): { step: number; input: VoyageursInput }[] {
  const out: { step: number; input: VoyageursInput }[] = [];
  for (let step = 0; step < steps; step++) for (const input of queue.drain()) out.push({ step, input });
  return out;
}

describe("InputQueue", () => {
  it("fusionne les déplacements consécutifs et rend la dernière position", () => {
    const q = new InputQueue();
    q.move(10, 10);
    q.move(20, 30);
    expect(run(q, 1)).toEqual([{ step: 0, input: { type: "move", x: 20, y: 30 } }]);
    expect(q.position).toEqual({ x: 20, y: 30 });
  });

  it("borne les coordonnées à l'écran 320 x 200", () => {
    const q = new InputQueue();
    q.move(999, -5);
    expect(q.position).toEqual({ x: 319, y: 0 });
  });

  it("retarde un clic qui suit un saut de position, et garde l'ordre", () => {
    const q = new InputQueue();
    q.down(0, 100, 50);
    q.up(0, 100, 50);
    const events = run(q, SETTLE_STEPS + 2);
    expect(events.map((e) => e.input.type)).toEqual(["move", "down", "up"]);
    expect(events[0]!.step).toBe(0);
    expect(events[1]!.step).toBe(SETTLE_STEPS);
    expect(events[2]!.step).toBeGreaterThanOrEqual(SETTLE_STEPS);
  });

  it("n'attend rien quand la souris survole déjà la cible", () => {
    const q = new InputQueue();
    q.move(100, 50);
    run(q, SETTLE_STEPS + 1);
    q.down(0, 100, 50);
    expect(run(q, 1)).toEqual([{ step: 0, input: { type: "down", button: "left", x: 100, y: 50 } }]);
  });

  it("traduit les boutons du DOM : gauche, droit, et le milieu en « les deux boutons »", () => {
    const q = new InputQueue();
    q.move(5, 5);
    run(q, SETTLE_STEPS + 1);
    q.down(2, 5, 5);
    q.up(2, 5, 5);
    q.down(1, 5, 5);
    q.up(1, 5, 5);
    const types = run(q, 3).map((e) => (e.input.type === "down" || e.input.type === "up" ? `${e.input.type}:${e.input.button}` : e.input.type));
    expect(types).toEqual(["down:right", "up:right", "down:both", "up:both"]);
  });

  it("deux boutons enfoncés l'un après l'autre : « les deux » une fois, relâché avec le dernier", () => {
    const q = new InputQueue();
    q.move(5, 5);
    run(q, SETTLE_STEPS + 1);
    q.down(0, 5, 5);
    q.down(2, 5, 5);
    q.up(0, 5, 5);
    q.up(2, 5, 5);
    const types = run(q, 3).map((e) => (e.input.type === "down" || e.input.type === "up" ? `${e.input.type}:${e.input.button}` : e.input.type));
    expect(types).toEqual(["down:left", "down:both", "up:both"]);
  });

  it("un toucher enfonce puis relâche le bouton après TAP_HOLD_STEPS ; un appui long est un clic droit ; le curseur se cache", () => {
    const q = new InputQueue();
    q.tap(2, 40, 60);
    expect(q.touchMode).toBe(true);
    const events = run(q, SETTLE_STEPS + TAP_HOLD_STEPS + 1);
    const down = events.find((e) => e.input.type === "down")!;
    const up = events.find((e) => e.input.type === "up")!;
    expect(down.input).toMatchObject({ button: "right", x: 40, y: 60 });
    expect(up.step - down.step).toBe(TAP_HOLD_STEPS);
    q.down(0, 40, 60);
    expect(q.touchMode).toBe(false);
  });

  it("Entrée et Échap : bouton enfoncé puis relâché à la position du curseur", () => {
    const q = new InputQueue();
    q.move(70, 80);
    run(q, SETTLE_STEPS + 1);
    q.key("left", true);
    q.key("left", false);
    expect(run(q, 2).map((e) => e.input)).toEqual([
      { type: "down", button: "left", x: 70, y: 80 },
      { type: "up", button: "left", x: 70, y: 80 },
    ]);
  });

  it("en pause : plus d'entrée, mais les boutons tenus sont relâchés à la reprise", () => {
    const q = new InputQueue();
    q.move(10, 10);
    run(q, SETTLE_STEPS + 1);
    q.down(0, 10, 10);
    run(q, 1);
    q.setPaused(true);
    q.move(50, 50);
    q.action("take");
    q.tap(0, 60, 60);
    q.setPaused(false);
    expect(run(q, 1).map((e) => e.input)).toEqual([{ type: "up", button: "left", x: 10, y: 10 }]);
  });

  it("transmet les actions du clavier dans l'ordre", () => {
    const q = new InputQueue();
    q.action("examine");
    q.action("systemMenu");
    expect(run(q, 1).map((e) => e.input)).toEqual([
      { type: "action", action: "examine" },
      { type: "action", action: "systemMenu" },
    ]);
  });

  it("marche au clavier : sens tenu puis arrêt ; un relâchement sans marche tenue n'envoie rien", () => {
    const q = new InputQueue();
    q.walk(0, 0);
    q.walk(-1, 1);
    q.walk(0, 0);
    q.walk(0, 0);
    expect(run(q, 1).map((e) => e.input)).toEqual([
      { type: "walk", dx: -1, dy: 1 },
      { type: "walk", dx: 0, dy: 0 },
    ]);
  });

  it("marche au clavier en pause : rien n'entre, et la marche tenue est arrêtée à la reprise", () => {
    const q = new InputQueue();
    q.walk(1, 0);
    run(q, 1);
    q.setPaused(true);
    q.walk(0, 1);
    q.setPaused(false);
    expect(run(q, 1).map((e) => e.input)).toEqual([{ type: "walk", dx: 0, dy: 0 }]);
  });
});
