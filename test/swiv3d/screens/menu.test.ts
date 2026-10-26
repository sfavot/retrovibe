import { describe, expect, it } from "vitest";
import { ENTER_GUARD_FRAMES, Menu, SLIDER_STEP, standardLines, type MenuLine } from "../../../src/games/swiv3d/screens/menu";
import { stubText } from "./support";

const choices = (...ids: number[]): MenuLine[] => ids.map((id) => ({ type: "choice", id, text: `choix ${id}` }));

function menu(body: MenuLine[], options: { noCancel?: boolean; initial?: number } = {}): Menu {
  return new Menu(standardLines(["Titre"], body), { y: 100, ...options }, stubText());
}

const warm = (m: Menu): void => {
  for (let i = 0; i <= ENTER_GUARD_FRAMES; i++) m.tick();
};

describe("moteur de menu : navigation", () => {
  it("sélectionne la première ligne sélectionnable, ou celle demandée", () => {
    expect(menu(choices(10, 20, 30)).selected).toBe(10);
    expect(menu(choices(10, 20, 30), { initial: 30 }).selected).toBe(30);
    expect(menu(choices(10, 20, 30), { initial: 99 }).selected).toBe(10);
  });

  it("passe d'une ligne à l'autre avec bouclage, en ignorant les textes", () => {
    const m = menu([{ type: "text", text: "info" }, ...choices(1, 2, 3)]);
    expect(m.ids()).toEqual([1, 2, 3]);
    expect(m.press("down")).toEqual({ kind: "moved" });
    expect(m.selected).toBe(2);
    m.press("down");
    m.press("down");
    expect(m.selected).toBe(1);
    m.press("up");
    expect(m.selected).toBe(3);
  });

  it("ignore Entrée pendant les 3 premières images, puis renvoie l'id", () => {
    const m = menu(choices(1, 2));
    for (let i = 0; i < ENTER_GUARD_FRAMES; i++) {
      m.tick();
      expect(m.press("enter")).toBeNull();
    }
    m.tick();
    m.press("down");
    expect(m.press("enter")).toEqual({ kind: "chosen", id: 2 });
  });

  it("Échap annule, sauf dans les menus sans annulation (principal, pilote)", () => {
    expect(menu(choices(1)).press("escape")).toEqual({ kind: "cancelled" });
    expect(menu(choices(1), { noCancel: true }).press("escape")).toBeNull();
  });

  it("règle un curseur de 0 à 255 par pas, avec butées", () => {
    const m = menu([{ type: "slider", id: 1, text: "Volume", value: 250 }]);
    expect(m.press("right")).toEqual({ kind: "adjusted", id: 1, value: 255 });
    m.setLines(standardLines(["T"], [{ type: "slider", id: 1, text: "Volume", value: 255 }]));
    expect(m.press("right")).toBeNull();
    m.setLines(standardLines(["T"], [{ type: "slider", id: 1, text: "Volume", value: 3 }]));
    expect(m.press("left")).toEqual({ kind: "adjusted", id: 1, value: 0 });
    m.setLines(standardLines(["T"], [{ type: "slider", id: 1, text: "Volume", value: 100 }]));
    expect(m.press("left")).toEqual({ kind: "adjusted", id: 1, value: 100 - SLIDER_STEP });
    // Gauche / Droite ne font rien sur un choix simple.
    expect(menu(choices(1)).press("left")).toBeNull();
  });

  it("garde la sélection quand les lignes sont remplacées et qu'elle existe encore", () => {
    const m = menu(choices(1, 2, 3));
    m.press("down");
    m.setLines(standardLines(["T"], choices(1, 2, 3)));
    expect(m.selected).toBe(2);
    m.setLines(standardLines(["T"], choices(7, 8)));
    expect(m.selected).toBe(7);
  });
});

describe("moteur de menu : souris et doigt", () => {
  // Lignes de 19 px à partir de y = 100 : espaceur 3, trait 1, bandeau 19, trait 1, espaceur 3 -> premier choix en y = 127.
  const firstChoiceY = 100 + 3 + 1 + 19 + 1 + 3;

  it("valide le choix touché, et seulement une fois le menu prêt", () => {
    const m = menu(choices(1, 2, 3));
    expect(m.tap(160, firstChoiceY + 19 + 5)).toEqual({ kind: "moved" });
    expect(m.selected).toBe(2);
    warm(m);
    expect(m.tap(160, firstChoiceY + 19 * 2 + 5)).toEqual({ kind: "chosen", id: 3 });
  });

  it("annule en touchant hors du cadre, sauf sans annulation", () => {
    expect(menu(choices(1)).tap(5, 5)).toEqual({ kind: "cancelled" });
    expect(menu(choices(1), { noCancel: true }).tap(5, 5)).toBeNull();
  });

  it("règle un curseur à l'endroit touché sur sa piste", () => {
    const m = menu([{ type: "slider", id: 1, text: "Volume", value: 0 }]);
    const y = firstChoiceY + 5;
    const right = m.tap(235, y);
    expect(right).toMatchObject({ kind: "adjusted", id: 1 });
    expect((right as { value: number }).value).toBe(255);
  });
});

describe("moteur de menu : mise en page", () => {
  it("centre le cadre sur x = 160 (largeur du texte le plus large + 10)", () => {
    const filled: [number, number, number, number, number][] = [];
    const text = { ...stubText(), fill: (_fb: Uint8Array, x0: number, y0: number, x1: number, y1: number, row: number) => filled.push([x0, y0, x1, y1, row]) };
    const m = new Menu(standardLines(["Titre"], choices(1)), { y: 100 }, text as never);
    m.draw(new Uint8Array(320 * 400));
    // « choix 1 » : 7 caractères × 8 px = 56 px -> demi-largeur 28 + 5 = 33
    const veil = filled.find((f) => f[4] === 0x3);
    expect(veil && [veil[0], veil[2]]).toEqual([160 - 33, 160 + 33]);
    // la première ligne est l'espaceur de 3 px (ligne 0xa1) en y = 100
    expect(filled[0]).toEqual([160 - 33, 100, 160 + 33, 103, 0xa1]);
  });

  it("centre le menu verticalement quand y vaut « center »", () => {
    const tops: number[] = [];
    const text = { ...stubText(), fill: (_fb: Uint8Array, _x0: number, y0: number) => tops.push(y0) };
    const m = new Menu(standardLines(["T"], choices(1)), { y: "center" }, text as never);
    m.draw(new Uint8Array(320 * 400));
    // hauteur : 3 + 1 + 19 + 1 + 3 + 19 + 3 + 1 + 3 = 53
    expect(tops[0]).toBe(Math.round((400 - 53) / 2));
  });
});
