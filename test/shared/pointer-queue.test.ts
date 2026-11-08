import { describe, expect, it } from "vitest";
import { PointerQueue, buttonMask } from "../../src/ui/pointer-queue";

type TestEvent = { type: "pointer"; x: number; y: number; buttons: number } | { type: "key"; key: string };

/** Écran de 320 x 200, appui retardé de 10 ticks après un saut de position. */
const TAP_DELAY_TICKS = 10;
const queue = (): PointerQueue<TestEvent> =>
  new PointerQueue<TestEvent>({
    width: 320,
    height: 200,
    tapDelayTicks: TAP_DELAY_TICKS,
    pointer: (x, y, buttons) => ({ type: "pointer", x, y, buttons }),
    key: (key) => ({ type: "key", key }),
  });

describe("PointerQueue : souris en échantillons d'état", () => {
  it("les déplacements consécutifs sont fusionnés ; coordonnées arrondies et ramenées dans l'écran", () => {
    const q = queue();
    q.move(10.7, 20.2);
    q.move(30, 40);
    q.move(-5, 999);
    expect(q.drain()).toEqual([{ type: "pointer", x: 0, y: 199, buttons: 0 }]);
    q.move(400, 3);
    expect(q.drain()).toEqual([{ type: "pointer", x: 319, y: 3, buttons: 0 }]);
    expect(q.drain()).toEqual([]);
  });

  const settle = (q: PointerQueue<TestEvent>, ticks = TAP_DELAY_TICKS + 3): ReturnType<PointerQueue<TestEvent>["drain"]> => Array.from({ length: ticks }, () => q.drain()).flat();

  it("appui et relâchement ne sont jamais fusionnés avec les déplacements (un clic bref reste vu du moteur)", () => {
    const q = queue();
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
    const q = queue();
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
    const q = queue();
    q.down(0, 0, 0);
    q.down(2, 0, 0);
    q.down(1, 0, 0);
    q.up(0, 0, 0);
    expect(q.drain().map((e) => (e.type === "pointer" ? e.buttons : -1))).toEqual([1, 3, 3, 2]);
  });

  it("une touche est un événement, dans l'ordre", () => {
    const q = queue();
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
    const q = queue();
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
    const q = queue();
    q.tap(2, 10, 20);
    const events = Array.from({ length: TAP_DELAY_TICKS + 1 }, () => q.drain()).flat();
    expect(events.filter((e) => e.type === "pointer" && e.buttons === 2)).toHaveLength(1);
  });

  it("releaseAll relâche un bouton tenu à la dernière position connue", () => {
    const q = queue();
    q.down(0, 7, 8);
    q.drain();
    q.releaseAll();
    expect(q.drain()).toEqual([{ type: "pointer", x: 7, y: 8, buttons: 0 }]);
  });

  it("releaseAll oublie les touchers différés", () => {
    const q = queue();
    q.tap(0, 4, 4);
    q.drain();
    q.releaseAll();
    expect(q.tapPending).toBe(false);
    expect(settle(q)).toEqual([]);
  });
});

describe("buttonMask", () => {
  it("bouton gauche = 1, droit = 2, autre = 0", () => {
    expect([buttonMask(0), buttonMask(2), buttonMask(1), buttonMask(4)]).toEqual([1, 2, 0, 0]);
  });
});

describe("PointerQueue : clavier et durée d'appui", () => {
  it("une touche garde son ordre avec les autres événements", () => {
    const q = queue();
    q.move(1, 2);
    q.key("Enter");
    expect(q.drain()).toEqual([{ type: "pointer", x: 1, y: 2, buttons: 0 }, { type: "key", key: "Enter" }]);
  });

  it("tapHoldTicks règle la durée pendant laquelle le bouton reste enfoncé", () => {
    const q = new PointerQueue<TestEvent>({ width: 320, height: 200, tapDelayTicks: 0, tapHoldTicks: 3, pointer: (x, y, buttons) => ({ type: "pointer", x, y, buttons }), key: (key) => ({ type: "key", key }) });
    q.tap(0, 5, 5);
    const ticks = Array.from({ length: 5 }, () => q.drain().map((e) => (e.type === "pointer" ? e.buttons : -1)));
    expect(ticks).toEqual([[0, 1], [], [], [0], []]);
  });
});
