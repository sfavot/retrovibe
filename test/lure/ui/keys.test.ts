import { describe, expect, it } from "vitest";
import { keyAction, keyReleaseAction } from "../../../src/games/lure/ui/keys";

const key = (k: string, extra: { code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) =>
  keyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe("touches du jeu (carte de ScummVM, version française)", () => {
  it("F5 sauvegarde, F7 restitue, F9 recommence, Échap", () => {
    expect(key("F5")).toEqual({ type: "engine", action: "saveGame" });
    expect(key("F7")).toEqual({ type: "engine", action: "restoreGame" });
    expect(key("F9")).toEqual({ type: "engine", action: "restartGame" });
    expect(key("Escape")).toEqual({ type: "engine", action: "escape" });
  });

  it("menus et dialogues : flèches et pavé 8 / 2 pour changer de ligne, pavé 3 (ou Entrée) pour valider", () => {
    expect(key("ArrowUp")).toEqual({ type: "engine", action: "indexPrevious" });
    expect(key("ArrowDown")).toEqual({ type: "engine", action: "indexNext" });
    expect(key("8", { code: "Numpad8" })).toEqual({ type: "engine", action: "indexPrevious" });
    expect(key("ArrowUp", { code: "Numpad8" })).toEqual({ type: "engine", action: "indexPrevious" });
    expect(key("2", { code: "Numpad2" })).toEqual({ type: "engine", action: "indexNext" });
    expect(key("3", { code: "Numpad3" })).toEqual({ type: "engine", action: "fightCursorRightBottom", orElse: "indexSelect" });
    expect(key("Enter")).toEqual({ type: "engine", action: "indexSelect" });
  });

  it("confirmation : O et N (en français ; Y n'est pas associée)", () => {
    for (const yes of ["o", "O"]) expect(key(yes)).toEqual({ type: "engine", action: "yes" });
    for (const no of ["n", "N"]) expect(key(no)).toEqual({ type: "engine", action: "no" });
    expect(key("y")).toBeNull();
  });

  it("combats : flèches gauche et droite, pavé numérique 7 4 1 9 6 3 par position (verrouillage numérique ou non)", () => {
    expect(key("ArrowLeft")).toEqual({ type: "engine", action: "fightMoveLeft" });
    expect(key("ArrowRight")).toEqual({ type: "engine", action: "fightMoveRight" });
    const pad = { Numpad7: "fightCursorLeftTop", Numpad4: "fightCursorLeftMiddle", Numpad1: "fightCursorLeftBottom", Numpad9: "fightCursorRightTop", Numpad6: "fightCursorRightMiddle" };
    for (const [code, action] of Object.entries(pad)) {
      expect(key(code.slice(-1), { code })).toEqual({ type: "engine", action });
      // Sans verrouillage numérique, le pavé envoie Home, ArrowLeft… : la position décide.
      expect(key("Home", { code })).toEqual({ type: "engine", action });
    }
    expect(key("5", { code: "Numpad5" })).toBeNull();
  });

  it("le site garde le menu (F1), le volume (F10, car F9 est « recommencer ») et la pause (Espace)", () => {
    expect(key("F1")).toEqual({ type: "host", command: "menu" });
    expect(key("F10")).toEqual({ type: "host", command: "volume" });
    expect(key(" ")).toEqual({ type: "host", command: "pause" });
  });

  it("le navigateur garde Ctrl / Cmd + touche, Alt + lettre, Tab, F11, F12 ; les autres touches ne font rien", () => {
    expect(key("o", { ctrlKey: true })).toBeNull();
    expect(key("n", { metaKey: true })).toBeNull();
    expect(key("n", { altKey: true })).toBeNull();
    for (const k of ["Tab", "F11", "F12", "Shift", "Control", "Dead", "a", "1", "x"]) expect(key(k)).toBeNull();
  });
});

describe("relâchement des touches de combat", () => {
  const release = (k: string, code?: string) => keyReleaseAction({ key: k, code, ctrlKey: false, metaKey: false, altKey: false });

  it("seules les actions de combat ont un relâchement", () => {
    expect(release("ArrowLeft")).toBe("fightMoveLeft");
    expect(release("ArrowRight")).toBe("fightMoveRight");
    expect(release("Home", "Numpad7")).toBe("fightCursorLeftTop");
    expect(release("Escape")).toBeNull();
    expect(release("ArrowUp")).toBeNull();
    expect(release("o")).toBeNull();
    expect(release("F7")).toBeNull();
  });

  it("une touche tenue est relâchée même si Ctrl a été pressé entre-temps", () => {
    expect(keyReleaseAction({ key: "ArrowLeft", ctrlKey: true, metaKey: false, altKey: false })).toBe("fightMoveLeft");
  });
});
