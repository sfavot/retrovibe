import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { parseLines } from "../../../src/games/tim3/data/text";
import { Editor } from "../../../src/games/tim3/engine/editor";
import type { Part } from "../../../src/games/tim3/engine/part";
import { hasGoal, labSaveSlots, puzzleLevel, saveMachine, snapshotLab } from "../../../src/games/tim3/engine/save";
import { DEFAULT_LAB, Tim3Session, labLevel } from "../../../src/games/tim3/engine/session";
import { WALK_MIN_PARTS, WALK_NAME_LINE, WALK_STEP, Walkthrough, walkFacts, type WalkEffect, type WalkFacts } from "../../../src/games/tim3/engine/walkthrough";
import { frenchIndex } from "../data/real";
import { original, realTypes } from "../engine/helpers";

const empty: WalkFacts = { parts: 0, goal: "", hints: 0, solution: false };

describe("visite guidée : textes et boutons (41eaaa)", () => {
  it("bienvenue : présentation (ligne 0) la première fois, « Salut! Professeur Tim… » (ligne 1) ensuite ; pas de « Retourner »", () => {
    const w = new Walkthrough();
    expect(w.view(empty)).toEqual({ step: WALK_STEP.intro, line: 0, voice: 0, buttons: { yes: true, no: false, cancel: true, done: false }, naming: false });
    expect(w.met).toBe(true);
    expect(w.view(empty).line).toBe(1);
    expect(new Walkthrough(true).view(empty).line).toBe(1);
  });

  it("pièces : 2, puis 4 (moins de cinq) ou 5 une fois demandé ; 3 si les pièces sont déjà là", () => {
    const w = new Walkthrough(true);
    w.press("yes", empty);
    expect(w.view(empty).line).toBe(2);
    expect(w.view({ ...empty, parts: 5 }).line).toBe(3);
    expect(w.press("yes", empty)).toEqual({ kind: "close", then: "build" });
    expect(w.view({ ...empty, parts: 4 })).toMatchObject({ line: 4, buttons: { no: true } });
    expect(w.press("yes", { ...empty, parts: 4 })).toEqual({ kind: "close", then: "build" });
    expect(w.view({ ...empty, parts: WALK_MIN_PARTS }).line).toBe(5);
    expect(w.press("no", { ...empty, parts: 5 })).toEqual({ kind: "close", then: "build" });
    expect(w.press("yes", { ...empty, parts: 5 })).toEqual({ kind: "refresh" });
    expect(w.step).toBe(WALK_STEP.music);
  });

  it("un but ou un nom effacé rouvre son étape (41eb12, 41eb2f)", () => {
    const w = new Walkthrough(true);
    w.done = WALK_STEP.intro | WALK_STEP.parts | WALK_STEP.music | WALK_STEP.goal | WALK_STEP.name;
    w.visited = w.done;
    w.name = "Fusée";
    expect(w.view({ ...empty, parts: 5, goal: "But" }).step).toBe(WALK_STEP.solution);
    expect(w.view({ ...empty, parts: 5 })).toMatchObject({ step: WALK_STEP.goal, line: 11, buttons: { no: false } });
    // Le but réécrit ne refait pas l'étape : il faut la valider de nouveau (« Continuer »).
    expect(w.view({ ...empty, parts: 5, goal: "But" })).toMatchObject({ step: WALK_STEP.goal, line: 12, buttons: { no: true } });
    w.press("yes", { ...empty, parts: 5, goal: "But" });
    w.name = "";
    expect(w.view({ ...empty, parts: 5, goal: "But" })).toMatchObject({ step: WALK_STEP.name, line: 15, buttons: { no: false } });
  });

  it("« Salut! » : 31136 avant la fin ; « Terminé » seul à la fin ; « tout verrouiller » refusé passe l'étape", () => {
    const w = new Walkthrough();
    expect(w.press("cancel", empty)).toEqual({ kind: "leave", confirm: true });
    expect(w.press("done", empty)).toEqual({ kind: "none" });
    w.done = WALK_STEP.lock - 1;
    w.name = "N";
    const facts = { parts: 5, goal: "G", hints: 1, solution: true };
    expect(w.view(facts).line).toBe(25);
    expect(w.press("no", facts)).toEqual({ kind: "refresh" });
    expect(w.step).toBe(WALK_STEP.unlock);
    w.done = WALK_STEP.end - 1;
    expect(w.view(facts)).toEqual({ step: WALK_STEP.end, line: 32, voice: 32, buttons: { yes: false, no: false, cancel: false, done: true }, naming: false });
    expect(w.press("cancel", facts)).toEqual({ kind: "leave", confirm: false });
    expect(w.press("done", facts)).toEqual({ kind: "leave", confirm: false });
  });

  it("sauvegarde ratée : ligne 30 et nouvel essai ; réussie : ligne 31 sans « Retourner »", () => {
    const w = new Walkthrough(true);
    w.done = WALK_STEP.save - 1;
    w.name = "N";
    const facts = { parts: 5, goal: "G", hints: 0, solution: false };
    expect(w.view(facts).line).toBe(29);
    expect(w.press("yes", facts)).toEqual({ kind: "save" });
    w.saved(false);
    expect(w.view(facts)).toMatchObject({ line: 30, buttons: { no: false } });
    expect(w.press("yes", facts)).toEqual({ kind: "save" });
    w.saved(true);
    expect(w.view(facts)).toMatchObject({ line: 31, buttons: { no: false } });
    expect(w.press("yes", facts)).toEqual({ kind: "refresh" });
    expect(w.finished).toBe(true);
  });
});

/** Labo vide et sa palette (onglet 0), comme le mode 6 (42332c). */
function emptyLab(): Tim3Session {
  const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: { ...DEFAULT_LAB } });
  s.editor.stockLab(Editor.labTypes(s.world, 0));
  return s;
}

/** Pose une pièce neuve du Labo au point (x, y) de l'aire, par l'éditeur. */
function place(s: Tim3Session, type: number, x: number, y: number): Part {
  const p = s.editor.takeNew(type);
  s.editor.hover(x, y);
  expect(s.editor.click(x, y), `pose du type ${type}`).toBe("placed");
  return p;
}

describe.skipIf(!original.has)("visite guidée de bout en bout, par l'éditeur (mode 6)", () => {
  it("le professeur fait construire, nommer, résoudre, verrouiller et sauvegarder un puzzle maison qui se joue ensuite", () => {
    const lines = parseLines(frenchIndex().get("PROFESOR.RES"));
    expect(lines[WALK_NAME_LINE]).toMatch(/^Entrez le nom du puzzle/);
    const s = emptyLab();
    const lab = s.labPuzzle!;
    const slots = labSaveSlots(new MemoryStorage());
    const w = new Walkthrough();
    const said: number[] = [];
    const effects: WalkEffect["kind"][] = [];
    const facts = () => walkFacts(s.world, lab);
    /** Ce que montre la fenêtre, puis le bouton pressé. */
    const press = (button: "yes" | "no" | "cancel" | "done" | "title"): WalkEffect => {
      const e = w.press(button, facts());
      effects.push(e.kind);
      return e;
    };
    const show = () => {
      const v = w.view(facts());
      said.push(v.line);
      expect(lines[v.line], `ligne ${v.line}`).not.toBe("");
      return v;
    };

    show();
    press("yes");
    show();
    expect(press("yes")).toEqual({ kind: "close", then: "build" });
    const parts = [place(s, 0, 100, 100), place(s, 1, 200, 150), place(s, 2, 300, 200)];
    expect(show().line).toBe(4);
    press("yes");
    parts.push(place(s, 0, 400, 100), place(s, 1, 450, 250));
    expect(show().line).toBe(5);
    press("yes");

    // Musique : la guitare, puis « Écoutez cette mélodie ».
    expect(show().line).toBe(6);
    expect(press("yes")).toEqual({ kind: "music" });
    s.setLab({ music: 1005 });
    expect(show().line).toBe(8);
    press("yes");

    // But : écrit dans la barre du but.
    expect(show()).toMatchObject({ line: 9, buttons: { no: false } });
    expect(press("yes")).toEqual({ kind: "close", then: "goal" });
    expect(show().line).toBe(11);
    lab.goal = "Faire tomber les balles";
    expect(show()).toMatchObject({ line: 12, buttons: { no: true } });
    press("yes");

    // Nom : saisie dans la fenêtre (HP_TITLE), Entrée la valide.
    expect(show().line).toBe(13);
    press("yes");
    expect(show()).toMatchObject({ line: WALK_NAME_LINE, voice: null, naming: true, buttons: { yes: true, no: false, cancel: false } });
    w.draft = "  Chute libre  ";
    press("title");
    expect(w.name).toBe("Chute libre");
    expect(show().line).toBe(16);
    press("yes");

    // Solution : une condition posée sur une pièce (poignée « solution »).
    expect(show().line).toBe(21);
    expect(press("yes")).toEqual({ kind: "close", then: "solution" });
    expect(show().line).toBe(23);
    expect(lab.setCondition(parts[0]!, { state1: 0, state2: 0, count: 0, rectX: 0, rectY: 300, rectWidth: 560, rectHeight: 80 })).toBe(true);
    expect(show().line).toBe(24);
    press("yes");

    // Indices : l'éditeur d'indices.
    expect(show().line).toBe(17);
    expect(press("yes")).toEqual({ kind: "close", then: "hints" });
    expect(show().line).toBe(19);
    lab.addHint(120, 80, "Poussez la balle");
    expect(show().line).toBe(20);
    press("yes");

    // Cadenas : tout verrouiller, puis déverrouiller ce qui ira dans le bac.
    expect(show().line).toBe(25);
    expect(press("yes")).toEqual({ kind: "lockAll" });
    expect(s.editor.lockAll(true)).toBe(5);
    expect(show().line).toBe(27);
    expect(press("yes")).toEqual({ kind: "close", then: "unlock" });
    expect(s.editor.toggleLock(parts[4]!)).toBe(false);
    expect(show().line).toBe(28);
    press("yes");

    // Sauvegarde : premier emplacement libre (le jeu : PUZB<n>.TIM).
    expect(show().line).toBe(29);
    expect(press("yes")).toEqual({ kind: "save" });
    const machine = snapshotLab(s.world, s.lab!, lab)!;
    w.saved(saveMachine(slots, 1, w.name, machine, 1) === "saved");
    expect(show()).toMatchObject({ line: 31, buttons: { no: false } });
    press("yes");
    expect(show()).toMatchObject({ step: WALK_STEP.end, line: 32, buttons: { done: true, yes: false, cancel: false } });
    expect(press("done")).toEqual({ kind: "leave", confirm: false });

    expect(said).toEqual([0, 2, 4, 5, 6, 8, 9, 11, 12, 13, WALK_NAME_LINE, 16, 21, 23, 24, 17, 19, 20, 25, 27, 28, 29, 31, 32]);
    // Le puzzle maison se joue : but, nom, musique, indice, une pièce au bac, les autres à leur place.
    const stored = slots.read(1)!;
    expect(stored.save.name).toBe("Chute libre");
    expect(hasGoal(stored.save.machine)).toBe(true);
    const level = puzzleLevel(stored.save.machine, stored.save.name);
    expect(level.goal).toBe("Faire tomber les balles");
    expect(level.info.music).toBe(1005);
    expect(level.hints.filter((h) => h.text !== "").map((h) => h.text)).toEqual(["Poussez la balle"]);
    const play = new Tim3Session(realTypes(), level);
    expect([...play.world.bin].length).toBe(1);
    expect([...play.world.statics, ...play.world.mobiles].length).toBe(4);
  });
});
