import { describe, expect, it } from "vitest";
import { defaultProfile, type ControllerProfile } from "../../../src/games/swiv3d/screens/controllers";
import { AXIS_FULL, Controls, DEFAULT_KEYS, MOUSE_AXIS_MAX, PAUSE_KEYS, clipAxis, shapeAxis } from "../../../src/games/swiv3d/ui/controls";

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

  it("écran de fin : clavier, boutons de souris et tactile relâchés, la manette reste lue", () => {
    const c = new Controls();
    down(c, "ArrowUp");
    down(c, "Digit3");
    c.mouseButton(0, true);
    c.touchSink.press("brake");
    c.touchSink.setAxis?.(1, 0);
    const pads = () => [pad({ buttons: [0], axes: [-1, 0, 0, 0] })];
    c.releaseKeys();
    c.poll(pads);
    const input = c.sample();
    expect(input).toMatchObject({ forward: false, weaponDirect: null, brake: false, firePrimary: true });
    expect(input.axes).toEqual({ turn: -AXIS_FULL, forward: 0, strafe: 0 });
    // Sans manette, plus rien.
    c.releaseKeys();
    c.poll(() => []);
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

describe("commandes : profil du pilote", () => {
  const configured = (profile: ControllerProfile): Controls => {
    const c = new Controls();
    c.configure(profile);
    return c;
  };

  it("une touche redéfinie remplace celle d'origine ; les alias restent sur les touches libres", () => {
    const profile = defaultProfile(1);
    profile.keys[6] = 0x1e; // tir principal sur A (Q en AZERTY)
    profile.keys[2] = 0x11; // avancer sur W (Z en AZERTY), qui était un alias d'avancer
    const c = configured(profile);
    expect(down(c, "Space")).toBe(false); // l'espace n'est plus liée
    down(c, "KeyA");
    expect(c.sample()).toMatchObject({ firePrimary: true, turnLeft: false }); // A n'est plus l'alias de « tourner ← »
    up(c, "KeyA");
    expect(down(c, "ArrowUp")).toBe(false); // l'ancienne touche d'avancer
    down(c, "KeyW");
    expect(c.sample().forward).toBe(true);
    expect(down(c, "KeyD")).toBe(true); // alias de « tourner → » toujours libre
  });

  it("P lié par le profil n'est plus la pause (Pause le reste)", () => {
    const profile = defaultProfile(1);
    profile.keys[7] = 0x19; // tir spécial sur P
    const c = configured(profile);
    down(c, "KeyP");
    expect(c.takePauseRequest()).toBe(false);
    expect(c.sample().fireSpecial).toBe(true);
    down(c, "Pause");
    expect(c.takePauseRequest()).toBe(true);
  });

  it("sans profil (null), retour aux touches par défaut", () => {
    const c = configured(defaultProfile(2));
    c.configure(null);
    expect(down(c, "Space")).toBe(true);
    expect(c.usesMouse).toBe(false);
  });

  it("souris : boutons liés, axe X = vitesse bornée à ±190, molette = arme suivante / précédente", () => {
    const c = configured(defaultProfile(2));
    expect(c.usesMouse).toBe(true);
    expect(c.mouseButton(0, true)).toBe(true);
    expect(c.mouseButton(2, true)).toBe(true);
    expect(c.sample()).toMatchObject({ firePrimary: true, fireSpecial: true });
    c.mouseButton(0, false);
    expect(c.sample().firePrimary).toBe(false);
    c.poll(() => [], 1000);
    c.mouseMove(2, -50); // 2 px en 20 ms : 2 × 256 / 20 = 25 ; Y non lié
    c.poll(() => [], 1020);
    expect(c.sample().axes).toEqual({ turn: 25, forward: 0, strafe: 0 });
    c.mouseMove(-100, 0);
    c.poll(() => [], 1040);
    expect(c.sample().axes?.turn).toBe(-MOUSE_AXIS_MAX);
    c.poll(() => [], 1060);
    expect(c.sample().axes).toBeUndefined();
    c.mouseWheel(2);
    expect(c.sample().weaponNext).toBe(true);
    expect(c.sample().weaponNext).toBe(true);
    expect(c.sample().weaponNext).toBe(false);
    c.mouseWheel(-1);
    expect(c.sample().weaponPrev).toBe(true);
  });

  it("souris sous un autre profil : pas d'axe", () => {
    const c = configured(defaultProfile(1));
    c.poll(() => [], 0);
    c.mouseMove(50, 0);
    c.poll(() => [], 20);
    expect(c.sample().axes).toBeUndefined();
  });

  it("manette (type 3) : boutons du profil, axes liés, « Attacher au centre » = zone morte de ±50", () => {
    const c = configured(defaultProfile(3));
    c.poll(() => [pad({ buttons: [0, 2] })]);
    expect(c.sample()).toMatchObject({ firePrimary: true, brake: true, fireSpecial: false });
    c.poll(() => [pad({ buttons: [7, 5] })]); // RT et RB ne sont plus liés d'office
    expect(c.sample()).toMatchObject({ firePrimary: false, weaponNext: false });
    c.poll(() => [pad({ axes: [0.3, -1, 1, 0] })]);
    expect(c.sample().axes).toEqual({ turn: shapeAxis(0.3), forward: AXIS_FULL, strafe: 0 }); // Z non lié par défaut
    const clipped = defaultProfile(3);
    clipped.clip = 0;
    clipped.axes = [3, 1, 0];
    const d = configured(clipped);
    d.poll(() => [pad({ axes: [0.3, 0, 0.5, 0] })]);
    expect(d.sample().axes).toEqual({ turn: 64, forward: 0, strafe: 0 }); // tourner sur Z ; X à 0,3 (38) dans la zone morte
    expect([clipAxis(0.39), clipAxis(0.4), clipAxis(-1)]).toEqual([0, 51, -AXIS_FULL]);
  });
});
