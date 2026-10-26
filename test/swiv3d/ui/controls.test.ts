import { describe, expect, it } from "vitest";
import { AXIS_FULL, Controls, DEFAULT_KEYS, PAUSE_KEYS, shapeAxis } from "../../../src/games/swiv3d/ui/controls";

const down = (c: Controls, code: string, repeat = false) => c.keyDown({ code, repeat });
const up = (c: Controls, code: string) => c.keyUp({ code });

function pad(overrides: { buttons?: number[]; axes?: number[] } = {}) {
  const pressed = new Set(overrides.buttons ?? []);
  return {
    connected: true,
    mapping: "standard",
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) })),
    axes: overrides.axes ?? [0, 0, 0, 0],
  };
}

describe("commandes : touches", () => {
  it("lie les touches d'origine par position physique (AZERTY compris)", () => {
    const c = new Controls();
    // flèches d'origine, plus W/A/S/D physiques (Z/Q/S/D en AZERTY)
    for (const code of ["ArrowUp", "KeyW", "ArrowLeft", "KeyA", "Comma", "Period", "Space", "ControlLeft"]) {
      expect(down(c, code)).toBe(true);
      up(c, code);
    }
    expect(down(c, "KeyZ")).toBe(false); // lettre non liée : la position, pas le caractère
    expect(DEFAULT_KEYS.forward).toContain("KeyW");
    expect(DEFAULT_KEYS.turnLeft).toContain("KeyA");
    expect(DEFAULT_KEYS.brake).toContain("ShiftLeft");
  });

  it("garde l'état maintenu d'un tick à l'autre et le relâche", () => {
    const c = new Controls();
    down(c, "ArrowUp");
    down(c, "ArrowRight");
    expect(c.sample()).toMatchObject({ forward: true, turnRight: true, turnLeft: false, back: false });
    expect(c.sample()).toMatchObject({ forward: true, turnRight: true });
    up(c, "ArrowUp");
    expect(c.sample()).toMatchObject({ forward: false, turnRight: true });
  });

  it("garde un appui plus court qu'un tick pour le tick suivant, une seule fois", () => {
    const c = new Controls();
    down(c, "Space");
    up(c, "Space");
    expect(c.sample().firePrimary).toBe(true);
    expect(c.sample().firePrimary).toBe(false);
  });

  it("tir spécial, changement d'arme et sélection directe sont des appuis brefs", () => {
    const c = new Controls();
    down(c, "KeyM");
    down(c, "PageUp");
    down(c, "Digit3");
    const first = c.sample();
    expect(first).toMatchObject({ fireSpecial: true, weaponNext: true, weaponPrev: false, weaponDirect: 3 });
    // touche toujours tenue : ni répétition du tir spécial, ni nouveau changement d'arme
    expect(c.sample()).toMatchObject({ fireSpecial: false, weaponNext: false, weaponDirect: null });
    expect(down(c, "Digit0")).toBe(true);
    expect(c.sample().weaponDirect).toBe(10);
  });

  it("ignore la répétition automatique du clavier mais garde la touche liée (preventDefault)", () => {
    const c = new Controls();
    down(c, "PageDown");
    c.sample();
    expect(down(c, "PageDown", true)).toBe(true);
    expect(c.sample().weaponPrev).toBe(false);
  });

  it("« Strafe On » (Ctrl gauche ou Maj gauche) et le déplacement latéral", () => {
    const c = new Controls();
    down(c, "ShiftLeft");
    down(c, "KeyE");
    expect(c.sample()).toMatchObject({ brake: true, strafeRight: true, strafeLeft: false });
  });

  it("laisse passer les raccourcis du navigateur avec Cmd", () => {
    const c = new Controls();
    expect(c.keyDown({ code: "KeyW", metaKey: true })).toBe(false);
    expect(c.sample().forward).toBe(false);
  });

  it("la perte de focus relâche tout", () => {
    const c = new Controls();
    down(c, "ArrowUp");
    down(c, "Space");
    c.clear();
    expect(c.sample()).toMatchObject({ forward: false, firePrimary: false });
  });

  it("la touche Pause (ou P) demande une pause une seule fois, sans répétition", () => {
    const c = new Controls();
    expect(PAUSE_KEYS).toContain("KeyP");
    expect(down(c, "Pause")).toBe(true);
    expect(down(c, "Pause", true)).toBe(true);
    expect(c.takePauseRequest()).toBe(true);
    expect(c.takePauseRequest()).toBe(false);
    expect(c.sample().pause).toBe(false); // la simulation n'est pas mise en pause par l'entrée : l'application saute les ticks
  });

  it("sans axe analogique, `axes` est absent (les touches décident)", () => {
    expect(new Controls().sample().axes).toBeUndefined();
  });
});

describe("commandes : axes", () => {
  it("zone morte de 0,2 puis course remise à l'échelle des valeurs d'origine (±128)", () => {
    expect(shapeAxis(0)).toBe(0);
    expect(shapeAxis(0.2)).toBe(0);
    expect(shapeAxis(-0.15)).toBe(0);
    expect(shapeAxis(1)).toBe(AXIS_FULL);
    expect(shapeAxis(-1)).toBe(-AXIS_FULL);
    expect(shapeAxis(2)).toBe(AXIS_FULL);
    expect(shapeAxis(0.6)).toBe(64);
  });
});

describe("commandes : manette", () => {
  it("stick gauche : tourner (X) et avancer (Y inversé), stick droit : latéral", () => {
    const c = new Controls();
    c.poll(() => [pad({ axes: [1, -1, -1, 0] })]);
    expect(c.sample().axes).toEqual({ turn: AXIS_FULL, forward: AXIS_FULL, strafe: -AXIS_FULL });
    c.poll(() => [pad({ axes: [0.1, 0.1, 0, 0] })]);
    expect(c.sample().axes).toBeUndefined(); // dans la zone morte
  });

  it("boutons : A/RT tir, B/X spécial, LT freine, LB/RB armes, croix en secours", () => {
    const c = new Controls();
    c.poll(() => [pad({ buttons: [7, 6, 5, 14] })]);
    expect(c.sample()).toMatchObject({ firePrimary: true, brake: true, weaponNext: true, turnLeft: true, fireSpecial: false });
    c.poll(() => [pad({ buttons: [1] })]);
    expect(c.sample()).toMatchObject({ fireSpecial: true, firePrimary: false, brake: false });
  });

  it("Start demande la pause sur le front montant seulement ; sans manette, tout est relâché", () => {
    const c = new Controls();
    c.poll(() => [pad({ buttons: [9] })]);
    c.poll(() => [pad({ buttons: [9] })]);
    expect(c.takePauseRequest()).toBe(true);
    expect(c.takePauseRequest()).toBe(false);
    c.poll(() => [pad({ axes: [1, 0, 0, 0] })]);
    c.poll(() => []);
    expect(c.sample().axes).toBeUndefined();
  });
});

describe("commandes : tactile", () => {
  it("les boutons tactiles tiennent les actions, le manche donne tourner et avancer", () => {
    const c = new Controls();
    c.touchSink.press("fire");
    c.touchSink.press("brake");
    c.touchSink.setAxis?.(0.6, -1); // à droite, vers le haut
    const input = c.sample();
    expect(input).toMatchObject({ firePrimary: true, brake: true });
    expect(input.axes).toEqual({ turn: 64, forward: AXIS_FULL, strafe: 0 });
    c.touchSink.release("fire");
    c.touchSink.setAxis?.(0, 0);
    expect(c.sample().firePrimary).toBe(false);
    expect(c.sample().axes).toBeUndefined();
  });

  it("le bouton « arme suivante » est un appui bref", () => {
    const c = new Controls();
    c.touchSink.press("next");
    expect(c.sample().weaponNext).toBe(true);
    expect(c.sample().weaponNext).toBe(false);
  });

  it("ignore un bouton inconnu", () => {
    const c = new Controls();
    c.touchSink.press("inconnu");
    expect(c.sample().firePrimary).toBe(false);
  });
});
