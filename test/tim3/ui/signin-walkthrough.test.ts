import { describe, expect, it, vi } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { parseLines } from "../../../src/games/tim3/data/text";
import { WALK_NAME_LINE, WALK_STEP, Walkthrough, type WalkEffect, type WalkFacts } from "../../../src/games/tim3/engine/walkthrough";
import { RenderAssets } from "../../../src/games/tim3/render";
import { layoutItf } from "../../../src/games/tim3/render/itf-draw";
import { measureText } from "../../../src/games/tim3/render/text";
import { listGeometry } from "../../../src/games/tim3/render/itf-list";
import { HELP_ITF, walkthroughWindow } from "../../../src/games/tim3/ui/help-window";
import { ItfWindow } from "../../../src/games/tim3/ui/itf-window";
import { SIGNIN, SIGNIN_LIST_STYLE, signInWindow, withReadableHeading } from "../../../src/games/tim3/ui/signin-window";
import { frenchIndex, original } from "../data/real";
import { fakeAudio } from "./professor-support";

describe.skipIf(!original.has)("écran d'inscription (SIGNIN.ITF, 426362)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const itf = readItf(index.get("SIGNIN.ITF"));
  const make = (names: string[], current = 0) => {
    const done = vi.fn();
    const help = vi.fn();
    const w = signInWindow(assets, itf, { names: () => names, current, done, help });
    return { w, done, help, m: new ItfWindow(assets, itf, w.options) };
  };

  it("noms dans la liste, invité d'abord ; le champ porte le nom du joueur courant ; Entrée et Échap valent « Terminé » (4263eb)", () => {
    const { w, m, done } = make(["Hôte", "Suzy", "Tom"], 1);
    const input = m.controls().find((c) => c.kind === "input")!;
    expect(input).toMatchObject({ name: "Votre nom", input: { value: "Suzy", maxLength: 19, edit: { color: "#ffffff", background: "#0000ef" } } });
    expect(w.options.list!.view.selected).toBe(1);
    expect(w.options.defaultId).toBe(SIGNIN.done);
    expect(m.escape()).toBe(SIGNIN.done);
    expect(w.options.choose(SIGNIN.done)).toBe(true);
    expect(done).toHaveBeenCalledWith("Suzy", 1);
  });

  it("taper un nom choisit sa rangée (casse ignorée) ou aucune ; une rangée choisie copie son nom ; un second clic valide", () => {
    const { w, done } = make(["Hôte", "Suzy", "Tom"]);
    const input = w.options.input as { input(v: string): void; value: string };
    input.input(" tom ");
    expect(w.selected()).toBe(2);
    input.input("Léa");
    expect(w.selected()).toBeNull();
    w.options.choose(SIGNIN.done);
    expect(done).toHaveBeenLastCalledWith("Léa", null);
    const list = w.options.list!;
    expect(list.click(1, 0)).toBeUndefined();
    expect(input.value).toBe("Suzy");
    expect(w.selected()).toBe(1);
    expect(list.click(1, 0)).toBe(SIGNIN.done);
  });

  it("liste : texte en x + 30, (hauteur − 12) / rangée ; flèches cachées tant que tout tient (426cce)", () => {
    const font = assets.font("SYS12.PFT")!;
    const list = itf.controls.find((c) => c.id === SIGNIN.list)!;
    const g = listGeometry(font, list, SIGNIN_LIST_STYLE);
    expect(g.textX).toBe(list.x + 30);
    expect(g.visible).toBe(Math.floor((list.height - 12) / (font.height + 2)));
    const few = make(["Hôte", "Suzy"]).m;
    expect(few.item(SIGNIN.up)).toBeNull();
    expect(few.item(SIGNIN.down)).toBeNull();
    const many = make(Array.from({ length: 30 }, (_, i) => `J${i}`), 20);
    expect(many.m.item(SIGNIN.up)).not.toBeNull();
    expect(many.w.options.list!.view.top).toBeGreaterThan(0);
    const top = many.w.options.list!.view.top;
    expect(many.w.options.choose(SIGNIN.up)).toBe(true);
    expect(many.w.options.list!.view.top).toBe(top - 1);
  });

  it("titre : le jeu n'en pose qu'une ligne de 20 pixels dans 85 × 27 (« ENTREZ ») ; le port élargit le contrôle pour « ENTREZ VOTRE NOM »", () => {
    const heading = (i: typeof itf) => layoutItf(assets, i).items.find((it) => it.id === SIGNIN.heading)!;
    const before = heading(itf);
    expect(before).toMatchObject({ width: 85, height: 27, text: "ENTREZ VOTRE NOM", more: true });
    expect(before.lines).toEqual({ visible: 1, total: 3 });
    const wide = withReadableHeading(assets, itf);
    const after = heading(wide);
    expect(after.more).toBe(false);
    expect(after.lines).toEqual({ visible: 1, total: 1 });
    // Même hauteur, de la gauche du champ du nom jusqu'à la plume, sans la chevaucher.
    const name = itf.controls.find((c) => c.id === SIGNIN.name)!;
    const picture = itf.controls.find((c) => c.id === SIGNIN.picture)!;
    expect(after).toMatchObject({ y: before.y, height: 27, x: name.x, width: picture.x - name.x });
    expect(measureText(assets.font("SYS12.PFT")!, after.text)).toBeLessThanOrEqual(after.width);
    // Rien d'autre ne bouge ; un titre qui tient déjà n'est pas touché.
    expect(wide.controls.filter((c) => c.id !== SIGNIN.heading)).toEqual(itf.controls.filter((c) => c.id !== SIGNIN.heading));
    expect(withReadableHeading(assets, wide)).toBe(wide);
  });

  it("« ? » ferme l'écran pour l'aide", () => {
    const { w, help } = make(["Hôte"]);
    expect(w.options.choose(SIGNIN.help)).toBe(false);
    expect(help).toHaveBeenCalledOnce();
  });
});

describe.skipIf(!original.has)("fenêtre de la visite guidée (HELP.ITF, 41eaaa, 41dce4)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const itf = readItf(index.get("HELP.ITF"));
  const lines = parseLines(index.get("PROFESOR.RES"));
  const make = (walk: Walkthrough, facts: WalkFacts = { parts: 0, goal: "", hints: 0, solution: false }) => {
    const audio = fakeAudio();
    const after = vi.fn<(e: WalkEffect | null) => void>();
    const confirmLeave = vi.fn<(leave: () => void) => void>();
    const w = walkthroughWindow(assets, itf, { walk, facts: () => facts, lines, audio, confirmLeave, after, random: () => 0 });
    return { w, m: new ItfWindow(assets, itf, w.options), audio, after, confirmLeave };
  };
  const shown = (m: ItfWindow) => [HELP_ITF.yes, HELP_ITF.no, HELP_ITF.cancel, HELP_ITF.done, HELP_ITF.ok, HELP_ITF.help, HELP_ITF.title].filter((id) => m.item(id) !== null);

  it("présentation : texte et voix de la ligne 0, « Continuer » (défaut) et « Salut! » (Échap) ; « Continuer » passe aux pièces sans fermer", () => {
    const { w, m, audio } = make(new Walkthrough());
    expect(w.options.state!.texts![HELP_ITF.text]).toBe(lines[0]);
    expect(shown(m)).toEqual([HELP_ITF.yes, HELP_ITF.cancel]);
    expect(m.controls().filter((c) => c.kind === "button").map((c) => c.name)).toEqual(expect.arrayContaining(["Continuer", "Salut!"]));
    expect(w.options.defaultId).toBe(HELP_ITF.yes);
    expect(m.escape()).toBe(HELP_ITF.cancel);
    for (let i = 0; i < 4; i++) w.options.tick!();
    expect(audio.played).toEqual([{ archive: "profesor", index: 0 }]);
    expect(w.options.choose(HELP_ITF.yes)).toBe(true);
    expect(w.options.state!.texts![HELP_ITF.text]).toBe(lines[2]);
    for (let i = 0; i < 4; i++) w.options.tick!();
    expect(audio.played.at(-1)).toEqual({ archive: "profesor", index: 2 });
  });

  it("une action ferme la fenêtre, puis l'hôte reçoit son effet ; « Retourner » une fois l'étape demandée", () => {
    const walk = new Walkthrough(true);
    walk.done = WALK_STEP.intro;
    const { w, m, after } = make(walk);
    expect(w.options.choose(HELP_ITF.yes)).toBe(false);
    w.options.onClose!();
    expect(after).toHaveBeenCalledWith({ kind: "close", then: "build" });
    w.update();
    const again = new ItfWindow(assets, itf, w.options);
    expect(shown(again)).toEqual([HELP_ITF.yes, HELP_ITF.no, HELP_ITF.cancel]);
    expect(again.controls().some((c) => c.kind === "button" && c.name === "Retourner")).toBe(true);
    void m;
  });

  it("« Salut! » : 31136 par l'hôte, la fenêtre reste ; accepté, l'hôte reçoit « quitter »", () => {
    const { w, after, confirmLeave } = make(new Walkthrough());
    expect(w.options.choose(HELP_ITF.cancel)).toBe(true);
    expect(confirmLeave).toHaveBeenCalledOnce();
    confirmLeave.mock.calls[0]![0]();
    w.options.onClose!();
    expect(after).toHaveBeenCalledWith({ kind: "leave", confirm: false });
  });

  it("nom : la saisie (EDIT noir sur blanc, 29 caractères) remplace HP_TITLE ; Entrée la valide", () => {
    const walk = new Walkthrough(true);
    walk.done = WALK_STEP.name - 1;
    const facts = { parts: 5, goal: "But", hints: 0, solution: false };
    const { w, audio } = make(walk, facts);
    expect(w.options.choose(HELP_ITF.yes)).toBe(true);
    const m = new ItfWindow(assets, itf, w.options);
    expect(w.options.state!.texts![HELP_ITF.text]).toBe(lines[WALK_NAME_LINE]);
    expect(shown(m)).toEqual([HELP_ITF.yes]);
    const input = m.controls().find((c) => c.kind === "input")!;
    expect(input).toMatchObject({ name: "Nom du puzzle", input: { maxLength: 29, edit: { color: "#000000", background: "#ffffff" } } });
    const played = audio.played.length;
    if (input.kind === "input") input.input.input("Ma fusée");
    expect(w.options.choose(w.options.defaultId!)).toBe(true);
    expect(walk.name).toBe("Ma fusée");
    expect(w.options.state!.texts![HELP_ITF.text]).toBe(lines[16]);
    expect(new ItfWindow(assets, itf, w.options).controls().some((c) => c.kind === "input")).toBe(false);
    // La saisie ne relance pas le professeur ; le texte suivant, si.
    for (let i = 0; i < 4; i++) w.options.tick!();
    expect(audio.played.length).toBe(played + 1);
  });

  it("fin : « Terminé » seul, par défaut et à Échap", () => {
    const walk = new Walkthrough(true);
    walk.done = WALK_STEP.end - 1;
    walk.name = "N";
    const { w, m, after } = make(walk, { parts: 5, goal: "But", hints: 1, solution: true });
    expect(shown(m)).toEqual([HELP_ITF.done]);
    expect(m.escape()).toBe(HELP_ITF.done);
    expect(w.options.defaultId).toBe(HELP_ITF.done);
    expect(w.options.choose(HELP_ITF.done)).toBe(false);
    w.options.onClose!();
    expect(after).toHaveBeenCalledWith({ kind: "leave", confirm: false });
  });
});
