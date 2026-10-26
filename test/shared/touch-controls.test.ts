import { describe, expect, it } from "vitest";
import { axisToDirections, clampToRadius, stickAxis, toLocalDelta } from "../../src/ui/touch-controls";

const none = { up: false, down: false, left: false, right: false };

describe("clampToRadius", () => {
  it("laisse intact un déplacement dans le rayon", () => {
    expect(clampToRadius(3, 4, 10)).toEqual({ x: 3, y: 4 });
  });
  it("ramène un déplacement trop long sur le cercle, même direction", () => {
    const r = clampToRadius(30, 40, 10);
    expect(r.x).toBeCloseTo(6);
    expect(r.y).toBeCloseTo(8);
  });
  it("gère le déplacement nul", () => {
    expect(clampToRadius(0, 0, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe("stickAxis", () => {
  it("normalise sur le rayon", () => {
    expect(stickAxis(5, 0, 10)).toEqual({ x: 0.5, y: 0 });
    expect(stickAxis(0, -20, 10).y).toBeCloseTo(-1);
  });
  it("reste au repos si le rayon est nul", () => {
    expect(stickAxis(5, 5, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("axisToDirections", () => {
  it("ne donne rien dans la zone morte", () => {
    expect(axisToDirections(0.2, 0.1, 0.3)).toEqual(none);
    expect(axisToDirections(0, 0)).toEqual(none);
  });
  it("donne une direction cardinale", () => {
    expect(axisToDirections(0, -1)).toEqual({ ...none, up: true });
    expect(axisToDirections(0, 1)).toEqual({ ...none, down: true });
    expect(axisToDirections(-1, 0)).toEqual({ ...none, left: true });
    expect(axisToDirections(1, 0)).toEqual({ ...none, right: true });
  });
  it("donne deux directions en diagonale", () => {
    expect(axisToDirections(0.7, -0.7)).toEqual({ ...none, up: true, right: true });
    expect(axisToDirections(-0.7, 0.7)).toEqual({ ...none, down: true, left: true });
  });
  it("ignore un axe négligeable devant l'autre", () => {
    expect(axisToDirections(0.2, -0.9)).toEqual({ ...none, up: true });
  });
  it("respecte la zone morte fournie", () => {
    expect(axisToDirections(0.5, 0, 0.6)).toEqual(none);
    expect(axisToDirections(0.7, 0, 0.6)).toEqual({ ...none, right: true });
  });
});

describe("toLocalDelta", () => {
  it("ne change rien hors plein écran pivoté", () => {
    expect(toLocalDelta(3, 4, false)).toEqual({ x: 3, y: 4 });
  });
  it("tourne les axes quand la page est pivotée de 90° horaire", () => {
    // vers le bas de l'écran = vers la droite du jeu ; vers la droite de l'écran = vers le haut du jeu
    expect(toLocalDelta(0, 5, true)).toEqual({ x: 5, y: -0 });
    expect(toLocalDelta(5, 0, true)).toEqual({ x: 0, y: -5 });
  });
});
