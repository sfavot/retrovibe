import { describe, expect, it } from "vitest";
import {
  GameInput,
  KEY_BACKSPACE,
  KEY_DELETE,
  KEY_DOWN,
  KEY_ESCAPE,
  KEY_LEFT,
  KEY_RETURN,
  KEY_SPACE,
  textEditKeys,
  toCP850,
  translateKey,
} from "../../src/games/lost-in-time/engine/input";
import { MOUSE_LEFT, MOUSE_NONE, MOUSE_RIGHT } from "../../src/games/lost-in-time/engine/host";
import { convertSpecialKey } from "../../src/games/lost-in-time/engine/hotspots";

describe("translateKey", () => {
  it("convertit les touches spéciales en codes du jeu", () => {
    expect(translateKey({ code: "Enter", key: "Enter" })).toBe(KEY_RETURN);
    expect(translateKey({ code: "NumpadEnter", key: "Enter" })).toBe(KEY_RETURN);
    expect(translateKey({ code: "Escape", key: "Escape" })).toBe(KEY_ESCAPE);
    expect(translateKey({ code: "Space", key: " " })).toBe(KEY_SPACE);
    expect(translateKey({ code: "Backspace", key: "Backspace" })).toBe(KEY_BACKSPACE);
    expect(translateKey({ code: "Delete", key: "Delete" })).toBe(KEY_DELETE);
    expect(translateKey({ code: "ArrowLeft", key: "ArrowLeft" })).toBe(KEY_LEFT);
    expect(translateKey({ code: "ArrowDown", key: "ArrowDown" })).toBe(KEY_DOWN);
  });

  it("F1..F10, F5 valant Échap", () => {
    expect(translateKey({ code: "F1", key: "F1" })).toBe(0x3b00);
    expect(translateKey({ code: "F5", key: "F5" })).toBe(KEY_ESCAPE);
    expect(translateKey({ code: "F10", key: "F10" })).toBe(0x4400);
    expect(translateKey({ code: "F11", key: "F11" })).toBe(0);
  });

  it("caractères ASCII, accents en CP850, modificateurs ignorés", () => {
    expect(translateKey({ code: "KeyA", key: "a" })).toBe(0x61);
    expect(translateKey({ code: "KeyA", key: "A" })).toBe(0x41);
    expect(translateKey({ code: "Digit1", key: "1" })).toBe(0x31);
    expect(translateKey({ code: "Digit2", key: "é" })).toBe(0x82);
    expect(toCP850(0xe0)).toBe(0x85);
    expect(translateKey({ code: "KeyA", key: "a", ctrlKey: true })).toBe(0);
    expect(translateKey({ code: "ShiftLeft", key: "Shift" })).toBe(0);
    expect(translateKey({ code: "KeyZ", key: "€" })).toBe(0);
  });

  it("convertSpecialKey remplace les chiffres de la rangée haute par leur caractère", () => {
    expect(convertSpecialKey(0x0261)).toBe(0x0231); // scan 2 -> '1'
    expect(convertSpecialKey(0x0b30)).toBe(0x0b30); // scan 11 -> '0'
    expect(convertSpecialKey(0x1c0d)).toBe(0x1c0d);
    expect(convertSpecialKey(0x61)).toBe(0x61);
  });
});

describe("GameInput", () => {
  it("garde un clic bref jusqu'à ce que le moteur l'ait lu", () => {
    const input = new GameInput();
    input.pointerDown(0);
    input.pointerUp(0); // relâché avant d'avoir été vu
    expect(input.mouseButtons).toBe(MOUSE_LEFT);
    expect(input.mouseButtons).toBe(MOUSE_NONE);
  });

  it("un bouton maintenu reste enfoncé, le droit a son propre bit", () => {
    const input = new GameInput();
    input.pointerDown(2);
    expect(input.mouseButtons).toBe(MOUSE_RIGHT);
    expect(input.mouseButtons).toBe(MOUSE_RIGHT);
    input.pointerUp(2);
    expect(input.mouseButtons).toBe(MOUSE_NONE);
  });

  it("file de touches et position bornée", () => {
    const input = new GameInput();
    expect(input.keyDown({ code: "KeyA", key: "a" })).toBe(true);
    expect(input.keyDown({ code: "ShiftLeft", key: "Shift" })).toBe(false);
    expect(input.popKey()).toBe(0x61);
    expect(input.popKey()).toBe(0);
    input.pointerMove(400, -5);
    expect([input.mouseX, input.mouseY]).toEqual([319, 0]);
  });
});

describe("GameInput : barre et gestes tactiles", () => {
  it("pressKey pousse un code du jeu, sauf 0 ou tampon plein", () => {
    const input = new GameInput();
    expect(input.pressKey(KEY_ESCAPE)).toBe(true);
    expect(input.pressKey(0)).toBe(false);
    expect(input.popKey()).toBe(KEY_ESCAPE);
    for (let i = 0; i < 16; i++) input.pressKey(0x61);
    expect(input.pressKey(0x62)).toBe(false);
  });

  it("clic droit court : vu une fois puis relâché", () => {
    const input = new GameInput();
    input.click(2);
    expect(input.mouseButtons).toBe(MOUSE_RIGHT);
    expect(input.mouseButtons).toBe(MOUSE_NONE);
  });

  it("clic court après un déplacement : le moteur lit d'abord la nouvelle position sans bouton", () => {
    const input = new GameInput();
    input.pointerMove(10, 180);
    input.click(0);
    // lecture 1 (checkKeys) : position nouvelle, pas encore de bouton -> le survol est joué
    expect([input.mouseX, input.mouseY, input.mouseButtons]).toEqual([10, 180, MOUSE_NONE]);
    // lecture 2 : le clic, puis le relâchement
    expect(input.mouseButtons).toBe(MOUSE_LEFT);
    expect(input.mouseButtons).toBe(MOUSE_NONE);
  });

  it("peekButtons annonce le clic sans le consommer (forceMouseUp de keyFunc)", () => {
    const input = new GameInput();
    input.click(0);
    expect(input.peekButtons()).toBe(MOUSE_LEFT);
    expect(input.peekButtons()).toBe(MOUSE_LEFT);
    expect(input.mouseButtons).toBe(MOUSE_LEFT);
    expect(input.peekButtons()).toBe(MOUSE_NONE);
    input.pointerMove(10, 10);
    input.click(2);
    expect(input.peekButtons()).toBe(MOUSE_NONE); // la position doit d'abord être lue
  });

  it("un déplacement vers la même case ne retarde pas le clic", () => {
    const input = new GameInput();
    input.pointerMove(152, 92);
    input.click(0);
    expect(input.mouseButtons).toBe(MOUSE_LEFT);
  });
});

describe("textEditKeys (champ caché du clavier virtuel)", () => {
  it("caractères ajoutés, espace et accents", () => {
    expect(textEditKeys(" ", " ab")).toEqual([0x61, 0x62]);
    expect(textEditKeys(" ", "  ")).toEqual([KEY_SPACE]);
    expect(textEditKeys(" ", " é")).toEqual([0x82]);
    expect(textEditKeys(" ", " €")).toEqual([]);
  });

  it("suppression : retour arrière, saut de ligne : Entrée", () => {
    expect(textEditKeys(" ", "")).toEqual([KEY_BACKSPACE]);
    expect(textEditKeys(" ", " \n")).toEqual([KEY_RETURN]);
  });

  it("composition corrigée : retours arrière puis le nouveau texte", () => {
    expect(textEditKeys(" helo", " hello")).toEqual([KEY_BACKSPACE, 0x6c, 0x6f]);
    expect(textEditKeys(" hel", " hel")).toEqual([]);
  });
});
