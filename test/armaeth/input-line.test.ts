import { describe, expect, it } from "vitest";
import {
  INPUT_LINE_MAX,
  type InputKey,
  type InputLineState,
  createInputLine,
  finishSubmit,
  handleInputKey,
  openInputLine,
  opensInputLine,
  recallInputLine,
} from "../../src/games/armaeth/engine/input-line";

function type(state: InputLineState, text: string): InputLineState {
  let s = state;
  for (const char of text) s = handleInputKey(s, { type: "char", char }).state;
  return s;
}

const key = (state: InputLineState, k: InputKey) => handleInputKey(state, k);

describe("ligne de saisie : ouverture", () => {
  it("n'est pas ouverte au départ et ignore les touches", () => {
    const s = createInputLine();
    expect(key(s, { type: "char", char: "a" })).toEqual({ state: s, effect: { type: "none" } });
  });

  it("espace, Entrée, retour arrière, Tab, Échap et + = - _ n'ouvrent pas la ligne", () => {
    for (const c of [" ", "\r", "\b", "\t", "\x1b", "+", "=", "-", "_"]) expect(opensInputLine(c), JSON.stringify(c)).toBe(false);
    for (const c of ["p", "P", "é", "1", "'", "/"]) expect(opensInputLine(c), c).toBe(true);
  });

  it("le caractère d'ouverture est le premier de la ligne", () => {
    const s = openInputLine(createInputLine(), "p");
    expect(s).toMatchObject({ open: true, text: "p", cursor: 1 });
  });
});

describe("ligne de saisie : édition", () => {
  it("ajoute à la fin, le curseur suit", () => {
    const s = type(openInputLine(createInputLine(), "p"), "rendre");
    expect(s).toMatchObject({ text: "prendre", cursor: 7 });
  });

  it("accepte l'espace, la tabulation et les accents dans la ligne", () => {
    const s = type(openInputLine(createInputLine(), "p"), " \té");
    expect(s.text).toBe("p \té");
  });

  it("limite la ligne à 40 caractères et sonne au-delà", () => {
    let s = openInputLine(createInputLine(), "a");
    s = type(s, "b".repeat(INPUT_LINE_MAX - 1));
    expect(s.text).toHaveLength(40);
    const step = key(s, { type: "char", char: "c" });
    expect(step.effect).toEqual({ type: "bell" });
    expect(step.state).toBe(s);
  });

  it("Retour arrière efface le dernier caractère, sans effet sur une ligne vide", () => {
    let s = type(openInputLine(createInputLine(), "a"), "b");
    s = key(s, { type: "backspace" }).state;
    expect(s.text).toBe("a");
    s = key(key(s, { type: "backspace" }).state, { type: "backspace" }).state;
    expect(s).toMatchObject({ text: "", cursor: 0, open: true });
  });

  it("Suppr efface toute la ligne", () => {
    const s = key(type(openInputLine(createInputLine(), "a"), "bcd"), { type: "delete" }).state;
    expect(s).toMatchObject({ text: "", cursor: 0, open: true });
  });

  it("Échap annule et ferme sans toucher à l'historique", () => {
    const s = type(openInputLine(createInputLine(), "a"), "bc");
    const step = key(s, { type: "escape" });
    expect(step.effect).toEqual({ type: "cancel" });
    expect(step.state).toMatchObject({ open: false, history: "" });
  });
});

describe("ligne de saisie : validation et historique", () => {
  it("Entrée transmet le texte brut et mémorise la phrase", () => {
    const s = type(openInputLine(createInputLine(), "P"), "rendre la clé");
    const step = key(s, { type: "enter" });
    expect(step.effect).toEqual({ type: "submit", text: "Prendre la clé" });
    expect(step.state).toMatchObject({ history: "Prendre la clé", awaiting: true });
    // En attente de l'analyse, les touches sont ignorées.
    expect(key(step.state, { type: "char", char: "x" }).state).toBe(step.state);
  });

  it("phrase reconnue : la boîte se ferme", () => {
    const step = key(type(openInputLine(createInputLine(), "a"), "b"), { type: "enter" });
    expect(finishSubmit(step.state, true)).toMatchObject({ open: false, awaiting: false, history: "ab" });
  });

  it("phrase refusée : elle revient dans la ligne pour correction", () => {
    const step = key(type(openInputLine(createInputLine(), "n"), "ord"), { type: "enter" });
    const s = finishSubmit(step.state, false);
    expect(s).toMatchObject({ open: true, text: "nord", cursor: 4, awaiting: false });
  });

  it("Inser rappelle la dernière phrase, y compris à l'ouverture", () => {
    let s = key(type(openInputLine(createInputLine(), "r"), "egarder"), { type: "enter" }).state;
    s = finishSubmit(s, true);
    expect(recallInputLine(s)).toMatchObject({ open: true, text: "regarder", cursor: 8 });
    const editing = type(openInputLine(s, "x"), "yz");
    expect(key(editing, { type: "insert" }).state.text).toBe("regarder");
  });

  it("Entrée sur une ligne vide écrase l'historique par du vide (original)", () => {
    let s = finishSubmit(key(type(openInputLine(createInputLine(), "r"), "r"), { type: "enter" }).state, true);
    s = recallInputLine(s);
    s = key(s, { type: "delete" }).state;
    const step = key(s, { type: "enter" });
    expect(step.effect).toEqual({ type: "submit", text: "" });
    expect(finishSubmit(step.state, false)).toMatchObject({ open: true, text: "", history: "" });
  });
});
