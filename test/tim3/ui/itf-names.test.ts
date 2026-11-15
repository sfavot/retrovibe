import { describe, expect, it, vi } from "vitest";
import { readItf, type Itf } from "../../../src/games/tim3/data/itf";
import { loadTexts, parseIdTable, parseLines } from "../../../src/games/tim3/data/text";
import { createPart } from "../../../src/games/tim3/engine/editor";
import { PartProgram, parseProgramRows } from "../../../src/games/tim3/engine/program";
import { puzzleList } from "../../../src/games/tim3/engine/session";
import { World } from "../../../src/games/tim3/engine/world";
import { RenderAssets } from "../../../src/games/tim3/render";
import { binsolveWindow } from "../../../src/games/tim3/ui/binsolve-window";
import { BinScreen, PuzzleCardScreen, PuzzleListScreen } from "../../../src/games/tim3/ui/chooser";
import { CreditsScreen } from "../../../src/games/tim3/ui/credits";
import { globeWindow } from "../../../src/games/tim3/ui/globe-window";
import { helpWindow } from "../../../src/games/tim3/ui/help-window";
import { hintWindow } from "../../../src/games/tim3/ui/hint-window";
import { infoWindow } from "../../../src/games/tim3/ui/info-window";
import { ItfWindow, screenOptions, type ItfScreen, type ItfWindowOptions } from "../../../src/games/tim3/ui/itf-window";
import { loadSaveWindow, machineListWindow } from "../../../src/games/tim3/ui/machines-window";
import { MainMenuScreen } from "../../../src/games/tim3/ui/main-menu";
import { duelSetupWindow } from "../../../src/games/tim3/ui/duel-window";
import { GENERIC, genericWindow, solvedWindow } from "../../../src/games/tim3/ui/menus";
import { MUSICBOX, musicboxWindow } from "../../../src/games/tim3/ui/musicbox-window";
import { programWindow } from "../../../src/games/tim3/ui/program-window";
import { GLOBE } from "../../../src/games/tim3/ui/globe-window";
import { frenchIndex, namesWithExtension, original } from "../data/real";
import { realTypes } from "../engine/helpers";
import { silentAudio } from "./professor-support";

/**
 * Calque des fenêtres `.ITF` (ce que lisent le clavier et les lecteurs d'écran) : chaque contrôle de chaque fenêtre du port a un nom
 * non vide, et unique dans sa fenêtre.
 */
describe.skipIf(!original.has)("noms accessibles des contrôles de chaque fenêtre .ITF", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const texts = loadTexts(index);
  // Comme `app.ts` : infobulles de DESCRIPT.RES sans leurs marques.
  const descriptions = new Map(parseIdTable(index.get("DESCRIPT.RES")).map((e) => [e.id, e.text.replace(/^[@!&%$*]+/, "")]));
  const itf = (name: string): Itf => readItf(index.get(name));
  const open = (w: { itf: Itf; options: ItfWindowOptions }) => new ItfWindow(assets, w.itf, w.options, descriptions);
  const screen = <R,>(s: ItfScreen<R>) => new ItfWindow(assets, s.itf, screenOptions(s, () => undefined), descriptions);
  const puzzles = puzzleList();
  const progress = { isSolved: (n: string) => n === "TLEV1" };
  const chooserTexts = { title: "Choisir un puzzle", puzzleTitle: () => "Titre", solved: "résolu" };
  const slots = Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, name: i === 2 ? "Fusée" : null }));
  const musicbox = {
    musicList: texts.music,
    soundList: texts.sounds,
    initial: { music: 1000, musicOn: true, effectsOn: true, volume: 15, voicesOn: true, effect: 0 },
    playMusic: vi.fn(),
    stopMusic: vi.fn(),
    playEffect: vi.fn(),
    stopEffect: vi.fn(),
    setMusicOn: vi.fn(),
    setEffectsOn: vi.fn(),
    setVolume: vi.fn(),
    setVoices: vi.fn(),
    musicChosen: vi.fn(),
    effectChosen: vi.fn(),
  };
  const program = (type: number) => {
    const world = new World(realTypes());
    const p = new PartProgram(world, createPart(world, type), parseProgramRows(parseLines(index.get("PROGPART.RES"))));
    return open(programWindow(assets, itf(`PROG${type}.ITF`), { title: "Programmer", program: p, changed: vi.fn(), refuse: vi.fn() }));
  };
  const progTypes = namesWithExtension(index, "ITF")
    .map((n) => /^PROG(\d+)\.ITF$/i.exec(n)?.[1])
    .filter((t): t is string => t !== undefined)
    .map(Number)
    .sort((a, b) => a - b);

  const windows: [string, () => ItfWindow][] = [
    ["GENERIC message", () => open(genericWindow(assets, itf("GENERIC.ITF"), { text: "Message", buttons: [GENERIC.okLabel], choose: vi.fn() }))],
    ["GENERIC question", () => open(genericWindow(assets, itf("GENERIC.ITF"), { text: "Sûr ?", buttons: [GENERIC.yes, GENERIC.no], choose: vi.fn() }))],
    ["PUZZSOLV", () => open(solvedWindow(assets, itf("PUZZSOLV.ITF"), { hasNext: false, canReplay: true, same: vi.fn(), replay: vi.fn(), next: vi.fn() }))],
    ["INFO (texte long)", () => open(infoWindow(assets, itf("INFO.ITF"), 4, texts.parts.find((p) => p.id === 4)))],
    ["INFO (texte court)", () => open(infoWindow(assets, itf("INFO.ITF"), 41, texts.parts.find((p) => p.id === 41)))],
    ...progTypes.map((t): [string, () => ItfWindow] => [`PROG${t}`, () => program(t)]),
    ["GRAVITY (Labo)", () => open(globeWindow(assets, itf("GRAVITY.ITF"), { settings: { gravity: 272, pressure: 67, background: 15 }, lab: true, change: vi.fn(), refused: vi.fn() }))],
    ["GRAVITY (Jeu)", () => open(globeWindow(assets, itf("GRAVITY.ITF"), { settings: { gravity: 272, pressure: 67, background: 15 }, lab: false, change: vi.fn(), refused: vi.fn() }))],
    ["MUSICBOX", () => open(musicboxWindow(assets, itf("MUSICBOX.ITF"), musicbox))],
    ["BINSOLVE", () => open(binsolveWindow(assets, itf("BINSOLVE.ITF"), 1, "Bravo", silentAudio()))],
    ["HELP (texte court)", () => open(helpWindow(assets, itf("HELP.ITF"), { text: "Court.", voice: null, audio: silentAudio(), another: vi.fn() }))],
    ["HELP (texte long)", () => open(helpWindow(assets, itf("HELP.ITF"), { text: "Long. ".repeat(200), voice: null, audio: silentAudio(), another: vi.fn() }))],
    ["HINT", () => open(hintWindow(itf("HINT.ITF"), { text: "Regardez la balle.", replay: vi.fn() }))],
    ["LOADSAVE", () => open(loadSaveWindow(itf("LOADSAVE.ITF"), { modified: true, choose: vi.fn() }))],
    ["DOSBOX (charger une machine)", () => open(machineListWindow(assets, itf("DOSBOX.ITF"), { mode: "load", slots: () => slots, name: "", validate: vi.fn() }))],
    ["DOSBOX (sauvegarder une machine)", () => open(machineListWindow(assets, itf("DOSBOX.ITF"), { mode: "save", slots: () => slots, name: "Ma machine", validate: vi.fn() }))],
    ["MAINMENU", () => screen(new MainMenuScreen(assets, itf("MAINMENU.ITF"), { title: "Menu principal", describe: (id) => descriptions.get(id) }))],
    ["CREDITS", () => screen(new CreditsScreen(assets, itf("CREDITS.ITF"), ["_Producteur", "Jeff Tunnell"], "Crédits"))],
    ["DOSBOX (choix du puzzle)", () => screen(new PuzzleListScreen(assets, itf("DOSBOX.ITF"), puzzles, progress, chooserTexts, 0, null))],
    ["DOSBIN", () => screen(new BinScreen(itf("DOSBIN.ITF"), "Catégories de puzzles", 1))],
    ["PUZZDISP", () => screen(new PuzzleCardScreen(assets, itf("PUZZDISP.ITF"), puzzles[0]!, "Titre"))],
    [
      "HEDTOHED (deux joueurs)",
      () => open(duelSetupWindow(itf("HEDTOHED.ITF"), { settings: { games: 3, times: [45_000, 45_000], names: ["Joueur 1", "Joueur 2"] }, text: () => "", message: vi.fn(), start: vi.fn(), cancel: vi.fn() })),
    ],
  ];

  it("toutes les fenêtres « programmer » sont couvertes", () => {
    expect(progTypes.length).toBeGreaterThanOrEqual(10);
  });

  it.each(windows)("%s : chaque contrôle a un nom non vide, unique dans la fenêtre", (_, make) => {
    const m = make();
    const controls = m.controls();
    expect(controls.length).toBeGreaterThan(0);
    const names = controls.map((c) => c.name.trim());
    for (const [i, name] of names.entries()) expect(name, `contrôle ${controls[i]!.key}`).not.toBe("");
    expect(new Set(names).size, names.join(" | ")).toBe(names.length);
  });

  it("globe : l'aide (non portée, grisée) a un nom", () => {
    const m = windows.find(([n]) => n === "GRAVITY (Labo)")![1]();
    expect(m.controls().find((c) => c.key === `b${GLOBE.help}`)).toMatchObject({ name: "Aide", disabled: true });
  });

  it("guitare : noms qui disent de quoi il s'agit (les textes du jeu restent ceux du dessin)", () => {
    const m = windows.find(([n]) => n === "MUSICBOX")![1]();
    const name = (id: number) => m.controls().find((c) => c.key === `b${id}`)?.name;
    expect(name(MUSICBOX.music)).toBe("Relancer la musique");
    expect(name(MUSICBOX.sound)).toBe("Relancer l'effet");
    expect(name(MUSICBOX.musicSwitch)).toBe("Musique : marche/arrêt");
    expect(name(MUSICBOX.soundSwitch)).toBe("Effets sonores : marche/arrêt");
    expect(name(MUSICBOX.voiceSwitch)).toBe("Voix du professeur (en anglais) : marche/arrêt");
    expect(name(MUSICBOX.musicPrevious)).toBe("Musique précédente");
    expect(name(MUSICBOX.soundNext)).toBe("Effet suivant");
    // Infobulles d'origine inchangées.
    expect(descriptions.get(MUSICBOX.music)).toBe("Relancer");
    expect(descriptions.get(MUSICBOX.soundSwitch)).toBe("On/Off");
  });

  it("listes : un `listbox` nommé, des rangées nommées", () => {
    const m = windows.find(([n]) => n === "DOSBOX (choix du puzzle)")![1]();
    const list = m.controls().find((c) => c.kind === "list")!;
    expect(list.name).toBe("Choisir un puzzle : Puzzles des Travaux Pratiques");
    expect(list.kind === "list" && list.list.label(0)).toBe(" 1. Titre, résolu");
  });
});
