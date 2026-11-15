import { describe, expect, it, vi } from "vitest";
import { helpVoice, professorVoice } from "../../../src/games/tim3/audio/ids";
import { REST_POSE } from "../../../src/games/tim3/audio/lipsync";
import { HELP_INTRO, helpTable } from "../../../src/games/tim3/data/help";
import { readItf } from "../../../src/games/tim3/data/itf";
import { readLev } from "../../../src/games/tim3/data/lev";
import { Tim3Session, puzzleList } from "../../../src/games/tim3/engine/session";
import { BIN_LEFT, BIN_PANEL, BIN_PLAY, GOALBAR, PLAYFIELD, RenderAssets, Surface, mapColor } from "../../../src/games/tim3/render";
import { imageOfState, stateLength } from "../../../src/games/tim3/render/itf-draw";
import { BINSOLVE, binsolveWindow } from "../../../src/games/tim3/ui/binsolve-window";
import { HELP_ITF, helpWindow } from "../../../src/games/tim3/ui/help-window";
import { ItfWindow } from "../../../src/games/tim3/ui/itf-window";
import { MAIN_MENU, MainMenuScreen } from "../../../src/games/tim3/ui/main-menu";
import { BIN_HELP, PlayScreen, type PlayEvent, type ToolbarButton } from "../../../src/games/tim3/ui/play";
import { IDLE_STATES, Professor, professorStarts } from "../../../src/games/tim3/ui/professor";
import { TOOLBAR_NAMES } from "../../../src/games/tim3/ui/toolbar";
import { frenchIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";
import { fakeAudio, silentAudio } from "./professor-support";

describe("professeur : voix qui ne l'animent pas", () => {
  it("help/064 (manuel on-line) laisse l'image de l'ITF (423e50) ; les autres voix l'animent", () => {
    expect(professorStarts(helpVoice(64))).toBe(false);
    expect(professorStarts(helpVoice(63))).toBe(true);
    expect(professorStarts(null)).toBe(true);
  });
});

describe.skipIf(!original.has)("professeur animé (PROFAMBT.ANM, PROFSPCH.ANM)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const idle = assets.anm("PROFAMBT.ANM")!;
  const speech = assets.anm("PROFSPCH.ANM")!;
  const first = (state: number) => imageOfState(speech, state);
  /** Le professeur après ses quatre passes de départ : la voix vient de partir. */
  const speaking = (voice = helpVoice(12), audio = fakeAudio()) => {
    const p = new Professor(assets, audio, voice, () => 0);
    for (let i = 0; i < 3; i++) p.pass();
    return { p, audio };
  };

  it("quatre passes au repos de la parole (la première à l'ouverture), puis la voix part ; la voix en cours est coupée d'abord", () => {
    const audio = fakeAudio();
    const p = new Professor(assets, audio, helpVoice(12));
    expect(audio.stops).toBe(1);
    expect(p.images).toEqual({ body: first(5), mouth: first(27) });
    p.pass();
    p.pass();
    expect(audio.played).toEqual([]);
    p.pass();
    expect(audio.played).toEqual([helpVoice(12)]);
    expect(p.speaking).toBe(true);
  });

  it("parole : bouche de la synchro, geste qui part de sa première image, avance d'une image par passe, puis revient au repos (état 5)", () => {
    const { p, audio } = speaking();
    audio.pose = { viseme: 4, mouthState: 35, gestureState: 49, gestureStartMs: 300 };
    p.pass();
    expect(p.images).toEqual({ body: first(49), mouth: first(35) });
    p.pass();
    expect(p.images).toEqual({ body: first(49) + 1, mouth: first(35) });
    const n = stateLength(speech, first(49));
    for (let i = 2; i < n; i++) p.pass();
    expect(p.images).toMatchObject({ body: first(49) + n - 1 });
    p.pass();
    expect(p.images).toMatchObject({ body: first(5) });
    p.pass();
    expect(p.images).toMatchObject({ body: first(5) + 1 });
  });

  it("voix finie : la bouche se ferme une passe, puis l'attente (PROFAMBT.ANM, état 32) et la voix est coupée", () => {
    const { p, audio } = speaking();
    audio.pose = { ...REST_POSE, viseme: 2, mouthState: 30 };
    p.pass();
    audio.active = false;
    const stops = audio.stops;
    p.pass();
    expect(p.images).toMatchObject({ mouth: first(27) });
    expect(p.speaking).toBe(true);
    p.pass();
    expect(p.speaking).toBe(false);
    expect(p.images).toEqual({ idle: imageOfState(idle, 32) });
    expect(audio.stops).toBe(stops + 1);
  });

  it("voix 63 : la suite 184 s'enchaîne une seule fois, même après un clic qui rejoue la voix", () => {
    const { p, audio } = speaking(helpVoice(63));
    audio.active = false;
    p.pass();
    expect(audio.played).toEqual([helpVoice(63), helpVoice(184)]);
    audio.active = false;
    p.pass();
    p.pass();
    expect(p.speaking).toBe(false);
    p.replay();
    expect(audio.played.at(-1)).toEqual(helpVoice(63));
    audio.active = false;
    p.pass();
    p.pass();
    expect(audio.played).toHaveLength(3);
    expect(p.speaking).toBe(false);
  });

  it("voix 184 (aide de la visite guidée) : remplacée par profesor/000 (423e50)", () => {
    const { audio } = speaking(helpVoice(184));
    expect(audio.played).toEqual([professorVoice(0)]);
  });

  it("voix désactivées : l'attente dès que la voix n'a pas pu partir", () => {
    const { p, audio } = speaking(helpVoice(12), silentAudio());
    expect(audio.played).toEqual([helpVoice(12)]);
    p.pass();
    expect(p.speaking).toBe(false);
  });

  it("attente : 60 boucles de repos, puis un geste tiré au hasard (jamais le dernier tiré), puis 40 + hasard % 80 boucles", () => {
    const draws = [0, 0, 5, 9, 5, 7];
    const p = new Professor(assets, silentAudio(), null, () => draws.shift() ?? 0);
    for (let i = 0; i < 4; i++) p.pass();
    expect(p.images).toEqual({ idle: imageOfState(idle, 32) });
    for (let i = 0; i < 59; i++) p.pass();
    expect(p.images).toEqual({ idle: imageOfState(idle, 32) });
    p.pass();
    expect(p.images).toEqual({ idle: imageOfState(idle, IDLE_STATES[5]!) });
    // Le geste se joue jusqu'au bout, puis le repos reprend pour 40 + 9 boucles (la fin du geste en compte une).
    const n = stateLength(idle, imageOfState(idle, IDLE_STATES[5]!));
    for (let i = 1; i < n; i++) p.pass();
    expect(p.images).toEqual({ idle: imageOfState(idle, IDLE_STATES[5]!) + n - 1 });
    for (let i = 0; i < 48; i++) p.pass();
    expect(p.images).toEqual({ idle: imageOfState(idle, 32) });
    p.pass();
    // 5 est le dernier tiré : refusé, 7 est pris.
    expect(p.images).toEqual({ idle: imageOfState(idle, IDLE_STATES[7]!) });
  });

  it("dessin (424089) : fond de couleur 11, professeur retourné en (x + unknown12 − 396, y + unknown14), découpé au contrôle", () => {
    const itf = readItf(index.get("HELP.ITF"));
    const c = itf.controls.find((k) => k.id === HELP_ITF.professor)!;
    const p = new Professor(assets, silentAudio(), null);
    const s = new Surface(640, 480);
    s.clear(0);
    const rect = { x: c.x, y: c.y, width: c.width, height: c.height };
    p.draw(s, assets, c, rect);
    let minX = 640;
    let maxX = -1;
    for (let y = 0; y < 480; y++) {
      for (let x = 0; x < 640; x++) {
        const v = s.pixels[y * 640 + x]!;
        const inside = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
        if (!inside) expect(v, `${x},${y}`).toBe(0);
        else if (v !== mapColor(11)) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    // Dessin d'origine en 65 … 185 sur 640 : retourné, 454 … 574, puis décalé de 376 − 56 − 396 = −76.
    expect([minX, maxX]).toEqual([378, 498]);
    expect(s.pixels[rect.y * 640 + rect.x]).toBe(mapColor(11));
  });

  it("BINSOLVE : professeur sans voix, dans BS_ANIM, qui passe à l'attente", () => {
    const audio = fakeAudio();
    const w = binsolveWindow(assets, readItf(index.get("BINSOLVE.ITF")), 1, "Bravo", audio, () => 0);
    expect(w.options.state?.draw?.[BINSOLVE.anim]).toBeTypeOf("function");
    for (let i = 0; i < 5; i++) w.options.tick?.();
    expect(audio.played).toEqual([]);
    expect(w.professor.speaking).toBe(false);
    w.options.onClose?.();
  });
});

describe.skipIf(!original.has)("HELP.ITF : fenêtre du professeur", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const help = helpTable(index);
  const itf = () => readItf(index.get("HELP.ITF"));
  const open = (text: string, voice = helpVoice(113), audio = fakeAudio(), another = vi.fn()) => {
    const w = helpWindow(assets, itf(), { text, voice, audio, another, random: () => 0 });
    return { w, m: new ItfWindow(assets, w.itf, w.options), audio, another };
  };
  const original23100 = help.find(HELP_INTRO)!.text;

  it("texte long : flèches montrées, ▼ avance d'une page tant qu'il reste des lignes, ▲ revient ; « ? » par défaut, Échap : Terminé", () => {
    const { w, m } = open(original23100);
    const lines = m.item(HELP_ITF.text)!.lines!;
    expect(lines.total).toBeGreaterThan(lines.visible);
    expect(m.item(HELP_ITF.up)).not.toBeNull();
    expect(m.item(HELP_ITF.done)!.x - m.origin.dx).toBe(400);
    expect(w.options.defaultId).toBe(HELP_ITF.help);
    expect(m.escape()).toBe(HELP_ITF.done);
    const scroll = () => w.options.state!.scroll![HELP_ITF.text];
    expect(w.options.choose(HELP_ITF.down)).toBe(true);
    expect(scroll()).toBe(lines.visible);
    w.options.choose(HELP_ITF.down);
    expect(scroll()).toBe(lines.total - lines.visible > lines.visible ? 2 * lines.visible : lines.visible);
    w.options.choose(HELP_ITF.up);
    w.options.choose(HELP_ITF.up);
    expect(scroll()).toBe(0);
    // Le lecteur d'écran a tout le texte.
    expect(m.texts()).toEqual([original23100]);
  });

  it("texte court : flèches cachées, « Terminé » et « ? » 16 pixels plus à gauche ; Oui, Non, OK, Annuler, titre toujours cachés", () => {
    const { m } = open(help.find(35003)!.text);
    expect(m.item(HELP_ITF.up)).toBeNull();
    expect(m.item(HELP_ITF.down)).toBeNull();
    expect(m.item(HELP_ITF.done)!.x - m.origin.dx).toBe(384);
    expect(m.item(HELP_ITF.help)!.x - m.origin.dx).toBe(384);
    for (const id of [HELP_ITF.yes, HELP_ITF.no, HELP_ITF.ok, HELP_ITF.cancel, HELP_ITF.title]) expect(m.item(id)).toBeNull();
    expect(m.controls().map((c) => c.name)).toContain("Terminé");
  });

  it("« ? » : passe au mode aide et ferme la fenêtre ; clic sur le professeur : la voix repart ; fermeture : voix coupée", () => {
    const { w, m, audio, another } = open("Court.");
    for (let i = 0; i < 3; i++) w.options.tick?.();
    expect(audio.played).toEqual([helpVoice(113)]);
    const zone = m.zones()[0]!;
    m.pointerDown(zone.x + 5, zone.y + 5);
    expect(m.pointerUp(zone.x + 5, zone.y + 5)).toBe(HELP_ITF.professor);
    expect(w.options.choose(HELP_ITF.professor)).toBe(true);
    expect(audio.played).toEqual([helpVoice(113), helpVoice(113)]);
    expect(w.options.choose(HELP_ITF.help)).toBe(false);
    expect(another).toHaveBeenCalledOnce();
    const stops = audio.stops;
    w.options.onClose?.();
    expect(audio.stops).toBe(stops + 1);
  });

  it("voix help/064 : pas de professeur animé ni de zone, le contrôle garde son image", () => {
    const { w, m } = open("Manuel.", helpVoice(64));
    expect(w.professor).toBeNull();
    expect(m.zones()).toEqual([]);
    expect(w.options.state?.draw).toBeUndefined();
  });
});

describe.skipIf(!original.has)("mode aide", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const wtoolbar = readItf(index.get("WTOOLBAR.ITF"));
  const toolbar: ToolbarButton[] = TOOLBAR_NAMES.flatMap((name) => {
    const c = wtoolbar.controls.find((k) => k.name === name);
    return c ? [{ name, id: c.id, x: c.x, y: c.y - 66, width: c.width, height: c.height }] : [];
  });
  const level = readLev(index.get("TLEV1.LEV"));
  const make = () => {
    const events: PlayEvent[] = [];
    const session = new Tim3Session(realTypes(), level, { puzzle: puzzleList()[0] });
    const screen = new PlayScreen(session, assets, level, { goal: "", hints: [], parts: [] }, toolbar, (e) => events.push(e));
    return { screen, events, session };
  };
  const mid = (r: { x: number; y: number; width: number; height: number }) => [r.x + (r.width >> 1), r.y + (r.height >> 1)] as const;

  it("écran de jeu : barre, panneau du bac, bac, but, pièce posée, vide", () => {
    const { screen, session } = make();
    const help = toolbar.find((b) => b.name === "TB_HELP")!;
    expect(screen.helpTargetAt(...mid(help))).toEqual({ kind: "control", id: 35003 });
    expect(screen.helpTargetAt(...mid(BIN_PLAY))).toEqual({ kind: "control", id: BIN_HELP.play });
    expect(screen.helpTargetAt(...mid(BIN_LEFT))).toEqual({ kind: "control", id: BIN_HELP.left });
    expect(screen.helpTargetAt(BIN_PANEL.x + 40, BIN_PANEL.y + 150)).toEqual({ kind: "control", id: 11014 });
    expect(screen.helpTargetAt(...mid(GOALBAR))).toEqual({ kind: "control", id: 9000 });
    const part = [...session.world.staticThenMobile()].find((p) => !(p.flags14 & 0x1000) && screen.editor.partAt(p.px + 2, p.py + 2) === p)!;
    expect(screen.helpTargetAt(PLAYFIELD.x + part.px + 2, PLAYFIELD.y + part.py + 2)).toEqual({ kind: "part", partType: part.type });
    let empty: [number, number] | null = null;
    for (let y = 40; y < 400 && !empty; y += 7) for (let x = 4; x < 550 && !empty; x += 7) if (!screen.editor.partAt(x, y - PLAYFIELD.y)) empty = [x, y];
    expect(screen.helpTargetAt(...empty!)).toEqual({ kind: "none" });
  });

  it("un appui choisit l'élément sans agir et quitte le mode ; Échap l'abandonne ; curseur « aide »", () => {
    const { screen, events } = make();
    screen.startHelpPick();
    expect(screen.cursor()).toBe("help");
    const flag = toolbar.find((b) => b.name === "TB_FLAG")!;
    screen.pointerDown(...mid(flag), false);
    screen.pointerUp(...mid(flag));
    expect(events).toEqual([{ type: "helpPick", target: { kind: "control", id: 35005 } }]);
    expect(screen.helpPicking).toBe(false);
    screen.startHelpPick();
    expect(screen.key("x")).toBe(false);
    expect(screen.key("Escape")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "helpCancel" });
    expect(screen.helpPicking).toBe(false);
  });

  it("menu principal : « ? » ouvre l'aide sans fermer le menu ; en mode aide, les contrôles sous le pointeur sont désignés", () => {
    let picking = false;
    const open = vi.fn();
    const pick = vi.fn();
    const menu = new MainMenuScreen(assets, readItf(index.get("MAINMENU.ITF")), { title: "Menu", describe: () => undefined }, {
      open,
      picking: () => picking,
      pick,
      cancel: vi.fn(),
      prompt: "Aide",
    });
    expect(menu.action(MAIN_MENU.help)).toBeUndefined();
    expect(open).toHaveBeenCalledOnce();
    expect(menu.action(MAIN_MENU.manual)).toBe("help");
    const m = new ItfWindow(assets, menu.itf, menu.options);
    picking = true;
    expect(menu.options.helpMode?.active()).toBe(true);
    expect(menu.options.status?.(m)).toBe("Aide");
    const play = m.item(MAIN_MENU.play)!;
    const ids = m.controlsAt(...mid(play));
    expect(ids[0]).toBe(MAIN_MENU.play);
    expect(ids.at(-1)).toBe(menu.itf.controls.at(-1)!.id);
  });
});
