import { describe, expect, it } from "vitest";
import { TOOLBAR_TEXT, toolbarDecision, toolbarStates, type ToolbarContext } from "../../../src/games/tim3/ui/toolbar";

const play: ToolbarContext = { lab: false, solved: false, running: false };
const lab: ToolbarContext = { lab: true, solved: false, running: false };
const names = (ctx: ToolbarContext) => toolbarStates(ctx).map((b) => b.name);
const state = (ctx: ToolbarContext, name: string) => toolbarStates(ctx).find((b) => b.name === name);

describe("barre d'outils : boutons selon le mode (418b78)", () => {
  it("Jeu : six modes, disquette, musique, globe, balayette, aide, indices, drapeau ; pas de cadenas ni de levier d'essai", () => {
    expect(names(play)).toEqual([
      "TB_GOTO_PUZ",
      "TB_GOTO_WORK",
      "TB_GOTO_H2H",
      "TB_GOTO_TOUR",
      "TB_GOTO_SIGNIN",
      "TB_GOTO_TUTORIAL",
      "TB_DISK",
      "TB_MUSIC",
      "TB_GLOBAL",
      "TB_SWEEP",
      "TB_HELP",
      "TB_HINT",
      "TB_FLAG",
    ]);
  });

  it("Jeu : l'ampoule n'apparaît que pour un puzzle déjà résolu", () => {
    expect(names(play)).not.toContain("TB_SOLUTION");
    expect(names({ ...play, solved: true })).toContain("TB_SOLUTION");
    expect(state({ ...play, solved: true }, "TB_SOLUTION")?.disabled).toBe(false);
  });

  it("Labo : cadenas et levier d'essai montrés (grisés), jamais l'ampoule", () => {
    const shown = names({ ...lab, solved: true });
    expect(shown).toContain("TB_LOCKED");
    expect(shown).toContain("TB_TEST");
    expect(shown).not.toContain("TB_SOLUTION");
    for (const n of ["TB_LOCKED", "TB_TEST", "TB_HINT"]) expect(state(lab, n)?.disabled).toBe(true);
  });

  it("le bouton du mode est enfoncé : Puzzle en Jeu, clé au Labo ; le drapeau pendant la marche", () => {
    expect(toolbarStates(play).filter((b) => b.pressed).map((b) => b.name)).toEqual(["TB_GOTO_PUZ"]);
    expect(toolbarStates(lab).filter((b) => b.pressed).map((b) => b.name)).toEqual(["TB_GOTO_WORK"]);
    expect(toolbarStates({ ...play, running: true }).filter((b) => b.pressed).map((b) => b.name)).toEqual(["TB_GOTO_PUZ", "TB_FLAG"]);
  });

  it("modes non portés grisés partout : deux joueurs, inscription, visite guidée ; le manuel ouvre l'aide", () => {
    for (const ctx of [play, lab]) {
      for (const n of ["TB_GOTO_H2H", "TB_GOTO_SIGNIN", "TB_GOTO_TUTORIAL"]) expect(state(ctx, n)?.disabled).toBe(true);
      expect(state(ctx, "TB_GOTO_TOUR")?.disabled).toBe(false);
    }
    expect(toolbarStates(play).filter((b) => b.disabled)).toHaveLength(3);
  });
});

describe("barre d'outils : clics (418ded)", () => {
  const at = (name: string, ctx: ToolbarContext, fieldEmpty = false) => toolbarDecision(name, { ...ctx, fieldEmpty });

  it("Puzzle : sans effet en Jeu ; depuis le Labo, confirmation 31397 puis le Jeu", () => {
    expect(at("TB_GOTO_PUZ", play)).toEqual({ action: "none" });
    expect(at("TB_GOTO_PUZ", lab)).toEqual({ action: "play", confirm: TOOLBAR_TEXT.openPlay });
  });

  it("clé : sans effet au Labo ; depuis le Jeu, confirmation 31398 puis le Labo", () => {
    expect(at("TB_GOTO_WORK", lab)).toEqual({ action: "none" });
    expect(at("TB_GOTO_WORK", play)).toEqual({ action: "lab", confirm: TOOLBAR_TEXT.openLab });
  });

  it("balayette : sans confirmation en Jeu (43252d), confirmation 31134 au Labo si l'aire n'est pas vide, rien en marche", () => {
    expect(at("TB_SWEEP", play)).toEqual({ action: "clear" });
    expect(at("TB_SWEEP", lab)).toEqual({ action: "clear", confirm: TOOLBAR_TEXT.clearLab });
    expect(at("TB_SWEEP", lab, true)).toEqual({ action: "clear" });
    expect(at("TB_SWEEP", { ...play, running: true })).toEqual({ action: "none" });
  });

  it("ampoule : confirmation 31125 puis la solution ; cachée (sans effet) tant que le puzzle n'est pas résolu", () => {
    expect(at("TB_SOLUTION", { ...play, solved: true })).toEqual({ action: "solution", confirm: TOOLBAR_TEXT.showSolution });
    expect(at("TB_SOLUTION", play)).toEqual({ action: "none" });
  });

  it("boutons grisés : « non disponible » ; boutons cachés : sans effet", () => {
    expect(at("TB_GOTO_H2H", play).action).toBe("unavailable");
    expect(at("TB_GOTO_TOUR", play).action).toBe("help");
    expect(at("TB_LOCKED", lab).action).toBe("unavailable");
    expect(at("TB_HINT", lab).action).toBe("unavailable");
    expect(at("TB_LOCKED", play).action).toBe("none");
    expect(at("TB_TEST", play).action).toBe("none");
  });

  it("autres boutons", () => {
    expect(at("TB_DISK", play).action).toBe("chooser");
    expect(at("TB_DISK", lab).action).toBe("machines");
    expect(at("TB_MUSIC", lab).action).toBe("options");
    expect(at("TB_GLOBAL", play).action).toBe("globals");
    expect(at("TB_HELP", play).action).toBe("help");
    expect(at("TB_HINT", play).action).toBe("hints");
    expect(at("TB_FLAG", play).action).toBe("run");
  });
});
