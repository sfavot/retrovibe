import { describe, expect, it, vi } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { readLev } from "../../../src/games/tim3/data/lev";
import { loadTexts, parseLines } from "../../../src/games/tim3/data/text";
import { readBinSolveRes } from "../../../src/games/tim3/data/solutions";
import { createPart } from "../../../src/games/tim3/engine/editor";
import { PartProgram, parseProgramRows } from "../../../src/games/tim3/engine/program";
import { Tim3Session, puzzleList } from "../../../src/games/tim3/engine/session";
import { World } from "../../../src/games/tim3/engine/world";
import { RenderAssets, Surface } from "../../../src/games/tim3/render";
import { BINSOLVE, binsolveShown, binsolveWindow } from "../../../src/games/tim3/ui/binsolve-window";
import { GLOBE, GRAVITY_MAX, globeWindow } from "../../../src/games/tim3/ui/globe-window";
import { HINT, hintWindow } from "../../../src/games/tim3/ui/hint-window";
import { INFO, infoWindow } from "../../../src/games/tim3/ui/info-window";
import { ItfWindow, inputsOf, type ItfWindowOptions } from "../../../src/games/tim3/ui/itf-window";
import { DOSBOX, LOADSAVE, loadSaveWindow, machineListWindow, machineRowText } from "../../../src/games/tim3/ui/machines-window";
import { CD_TRACKS, MUSICBOX, musicboxWindow, speakerFrame, volumeStep } from "../../../src/games/tim3/ui/musicbox-window";
import { PlayScreen } from "../../../src/games/tim3/ui/play";
import { PROG, PROG_SLIDERS, programWindow } from "../../../src/games/tim3/ui/program-window";
import { frenchIndex, original } from "../data/real";
import { silentAudio } from "./professor-support";
import { realTypes } from "../engine/helpers";

describe.skipIf(!original.has)("fenêtres .ITF de la vague F", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const texts = loadTexts(index);
  const itf = (name: string) => readItf(index.get(name));
  const model = (w: { itf: ReturnType<typeof itf>; options: ItfWindowOptions }) => new ItfWindow(assets, w.itf, w.options);
  const center = (m: ItfWindow, id: number) => {
    const r = m.item(id)!;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  /** Clic court sur une flèche : elle agit à la fin de son animation (44ee9d). */
  const clickArrow = (m: ItfWindow, id: number): number[] => {
    const p = center(m, id);
    m.pointerDown(p.x, p.y);
    m.pointerUp(p.x, p.y);
    const fired: number[] = [];
    for (let i = 0; i < 20; i++) fired.push(...m.pass().fire);
    return fired;
  };

  describe("moteur : flèches et réglettes", () => {
    const prog = () => {
      const world = new World(realTypes());
      const program = new PartProgram(world, createPart(world, 87), parseProgramRows(parseLines(index.get("PROGPART.RES"))));
      const w = programWindow(assets, itf("PROG87.ITF"), { title: "", program, changed: vi.fn(), refuse: vi.fn() });
      return { program, w, m: model(w) };
    };

    it("une flèche agit une fois à la fin de son animation ; tenue, elle se répète", () => {
      const { m } = prog();
      const p = center(m, PROG.up);
      m.pointerDown(p.x, p.y);
      expect(m.state().frames?.[PROG.up]).toBe(1);
      // PROGPART.ANM, état 6 : 3 images ; une action toutes les deux passes tant que le bouton est tenu.
      const fired: number[] = [];
      for (let i = 0; i < 6; i++) fired.push(...m.pass().fire);
      expect(fired).toEqual([PROG.up, PROG.up, PROG.up]);
      m.pointerUp(p.x, p.y);
      expect(clickArrow(m, PROG.down)).toEqual([PROG.down]);
      expect(m.state().frames?.[PROG.down]).toBeUndefined();
    });

    it("réglette horizontale (425a46) : bouton placé sur la valeur, clic dans la glissière cranté, flèches ±1", () => {
      const { program, w, m } = prog();
      const ids = PROG_SLIDERS.mass;
      program.setBall("mass", 10);
      m.render(new Surface(640, 480));
      const slider = m.item(ids.slider)!;
      // Course = 180 − 14 − 10 = 156 : valeur 10 au bout.
      expect(m.item(ids.knob)!.x - slider.x).toBe(156);
      m.pointerDown(slider.x + 7 + 78, slider.y + 5);
      m.pointerUp(slider.x + 7 + 78, slider.y + 5);
      expect(program.ball.mass).toBe(5);
      w.options.choose(ids.left);
      expect(program.ball.mass).toBe(4);
      w.options.choose(ids.right);
      w.options.choose(ids.right);
      expect(program.ball.mass).toBe(6);
    });

    it("réglette au clavier : flèches, Origine, Fin", () => {
      const { w, m } = prog();
      const s = w.options.sliders![0]!;
      expect(m.sliderKey(s, "End")).toBe(10);
      expect(m.sliderKey(s, "Home")).toBe(0);
      expect(m.sliderKey(s, "ArrowRight")).toBe(Math.min(10, s.value() + 1));
      expect(m.sliderKey(s, "a")).toBeNull();
    });
  });

  describe("INFO.ITF", () => {
    const balloon = texts.parts.find((p) => p.id === 4);
    it("texte long : flèches visibles, ▼ avance d'une page, ▲ revient", () => {
      const w = infoWindow(assets, itf("INFO.ITF"), 4, balloon);
      const m = model(w);
      expect(m.item(INFO.up)).not.toBeNull();
      expect(m.item(INFO.text)!.width).toBe(283 - 27);
      const lines = m.item(INFO.text)!.lines!;
      expect(lines.total).toBeGreaterThan(lines.visible);
      expect(w.options.choose(INFO.down)).toBe(true);
      expect(w.options.state!.scroll![INFO.text]).toBe(lines.visible);
      w.options.choose(INFO.up);
      expect(w.options.state!.scroll![INFO.text]).toBe(0);
      expect(w.options.choose(INFO.done)).toBe(false);
    });

    it("texte court : flèches cachées ; pièce sans INFO<type>.ANM : zone vide sans erreur", () => {
      const w = infoWindow(assets, itf("INFO.ITF"), 41, texts.parts.find((p) => p.id === 41));
      const m = model(w);
      expect(m.item(INFO.up)).toBeNull();
      expect(w.options.tick!()).toBe(false);
      m.render(new Surface(640, 480));
    });

    it("l'animation avance d'une image par passe et redessine", () => {
      const w = infoWindow(assets, itf("INFO.ITF"), 4, balloon);
      w.options.tick!();
      expect(w.options.tick!()).toBe(true);
    });
  });

  describe("GRAVITY.ITF", () => {
    const open = (lab: boolean) => {
      const change = vi.fn();
      const refused = vi.fn();
      const w = globeWindow(assets, itf("GRAVITY.ITF"), { settings: { gravity: 272, pressure: 67, background: 15 }, lab, change, refused });
      return { w, m: model(w), change, refused };
    };

    it("Labo : la réglette verticale suit le pointeur, 0 en haut ; la couleur boucle sur 1..15", () => {
      const { w, m, change } = open(true);
      const slider = m.item(GLOBE.gravitySlider)!;
      expect(m.item(GLOBE.gravityKnob)!.y - slider.y).toBe(Math.trunc((272 * 178) / 512));
      m.pointerDown(slider.x + 5, slider.y + 11);
      expect(change).toHaveBeenLastCalledWith({ gravity: 0 });
      m.pointerMove(slider.x + 5, slider.y + 1000);
      expect(change).toHaveBeenLastCalledWith({ gravity: GRAVITY_MAX });
      m.pointerUp(slider.x + 5, slider.y + 1000);
      w.options.choose(GLOBE.colorRight);
      expect(change).toHaveBeenLastCalledWith({ background: 1 });
      w.options.choose(GLOBE.colorLeft);
      expect(change).toHaveBeenLastCalledWith({ background: 15 });
    });

    it("Jeu : consultation, un appui sur une réglette donne le message 31137", () => {
      const { m, change, refused } = open(false);
      const p = center(m, GLOBE.pressureSlider);
      expect(m.pointerDown(p.x, p.y)).toBe(false);
      expect(change).not.toHaveBeenCalled();
      expect(refused).toHaveBeenCalledWith(expect.stringContaining("labo"));
    });
  });

  describe("MUSICBOX.ITF", () => {
    const open = () => {
      const calls: string[] = [];
      const o = {
        musicList: texts.music,
        soundList: texts.sounds,
        initial: { music: 1000, musicOn: true, effectsOn: true, volume: 15, voicesOn: true, effect: 0 },
        playMusic: (id: number) => calls.push(`music ${id}`),
        stopMusic: () => calls.push("stop"),
        playEffect: (id: number) => calls.push(`effect ${id}`),
        stopEffect: () => undefined,
        setMusicOn: (on: boolean) => calls.push(`musicOn ${on}`),
        setEffectsOn: (on: boolean) => calls.push(`effectsOn ${on}`),
        setVolume: (v: number) => calls.push(`volume ${v}`),
        setVoices: (on: boolean) => calls.push(`voices ${on}`),
        musicChosen: (id: number) => calls.push(`chosen ${id}`),
        effectChosen: () => undefined,
      };
      const w = musicboxWindow(assets, itf("MUSICBOX.ITF"), o);
      return { w, m: model(w), calls };
    };

    it("volume par paliers {0, 3, 5, 8, 10, 13, 15}, image du haut-parleur", () => {
      expect(volumeStep(15, true)).toBe(15);
      expect(volumeStep(15, false)).toBe(13);
      expect(volumeStep(4, false)).toBe(3);
      expect(volumeStep(0, false)).toBe(0);
      expect([0, 3, 4, 15].map(speakerFrame)).toEqual([0, 1, 1, 6]);
    });

    it("▲ en boucle vers le dernier morceau joué sans CD, qui part 5 passes plus tard", () => {
      const { w, calls } = open();
      w.options.choose(MUSICBOX.musicPrevious);
      const last = texts.music.filter((m) => !CD_TRACKS.includes(m.id)).at(-1)!.id;
      expect(calls).toEqual(["stop", `chosen ${last}`]);
      for (let i = 0; i < 5; i++) w.options.tick!();
      expect(calls.at(-1)).toBe(`chosen ${last}`);
      w.options.tick!();
      expect(calls.at(-1)).toBe(`music ${last}`);
    });

    it("« Relancer » (MB_MUSIC, 423a29) : le morceau repart du début 5 passes plus tard, même s'il jouait", () => {
      const { w, calls } = open();
      w.options.choose(MUSICBOX.music);
      for (let i = 0; i < 6; i++) w.options.tick!();
      // `PlaySound(choix, 0, 0)` : arrêt puis départ, et non `playMusic` seul, qui laisserait jouer le morceau en cours.
      expect(calls).toEqual(["stop", "music 1000"]);
    });

    it("les morceaux du CD sont sautés", () => {
      const { w, calls } = open();
      const seen = new Set<number>();
      for (let i = 0; i < 20; i++) w.options.choose(MUSICBOX.musicNext);
      for (const c of calls) if (c.startsWith("chosen")) seen.add(Number(c.split(" ")[1]));
      for (const id of CD_TRACKS) expect(seen.has(id)).toBe(false);
    });

    it("interrupteurs : image 0 = marche, dernière = arrêt ; bande « Voix du professeur » ajoutée", () => {
      const { w, m, calls } = open();
      expect(m.state().frames?.[MUSICBOX.soundSwitch]).toBe(0);
      w.options.choose(MUSICBOX.soundSwitch);
      expect(calls).toContain("effectsOn false");
      expect(w.options.state!.frames?.[MUSICBOX.soundSwitch]).toBe(1);
      expect(w.options.checked!(MUSICBOX.soundSwitch)).toBe(false);
      w.options.choose(MUSICBOX.voiceSwitch);
      expect(calls).toContain("voices false");
      expect(m.item(MUSICBOX.voiceSwitch)).not.toBeNull();
      const frame = m.layout.frame;
      expect(m.item(MUSICBOX.voicePanel)!.y + m.item(MUSICBOX.voicePanel)!.height).toBeLessThanOrEqual(frame.y + frame.height);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(480);
    });
  });

  describe("BINSOLVE.ITF", () => {
    it("coupe d'argent et bac de la catégorie, ou coupe d'or et tous les bacs ; texte de BINSOLVE.RES", () => {
      expect(binsolveShown(3)).toEqual([BINSOLVE.silver, 32023]);
      expect(binsolveShown("all")).toEqual([BINSOLVE.gold, BINSOLVE.allBins]);
      const text = readBinSolveRes(index.get("BINSOLVE.RES"))[1]!;
      const m = model(binsolveWindow(assets, itf("BINSOLVE.ITF"), 1, text, silentAudio()));
      const shown = m.layout.items.map((i) => i.id).filter((id) => id >= BINSOLVE.gold && id <= BINSOLVE.allBins);
      expect(shown.sort()).toEqual([BINSOLVE.silver, 32021]);
      expect(m.item(BINSOLVE.text)!.text).toBe(text);
      expect(m.escape()).toBe(BINSOLVE.done);
    });
  });

  describe("HINT.ITF et mains des indices", () => {
    it("texte de l'indice, éditeur caché, clic sur le professeur : la voix est rejouée", () => {
      const replay = vi.fn();
      const w = hintWindow(itf("HINT.ITF"), { text: "Regardez la balle.", replay });
      const m = model(w);
      expect(m.item(HINT.text)!.text).toBe("Regardez la balle.");
      expect(m.item(HINT.create)).toBeNull();
      const zone = m.zones()[0]!;
      m.pointerDown(zone.x + 5, zone.y + 5);
      expect(m.pointerUp(zone.x + 5, zone.y + 5)).toBe(HINT.professor);
      expect(w.options.choose(HINT.professor)).toBe(true);
      expect(replay).toHaveBeenCalled();
    });

    it("la main de la barre montre toutes les mains ; un clic sur l'une donne son emplacement LEV", () => {
      const ref = puzzleList().find((p) => (texts.levels[p.index]?.hints.filter((h) => h !== "").length ?? 0) >= 2)!;
      const level = readLev(index.get(`${ref.name}.LEV`));
      const hints = texts.levels[ref.index]!.hints;
      const events: unknown[] = [];
      const screen = new PlayScreen(new Tim3Session(realTypes(), level, { puzzle: ref }), assets, level, { goal: "", hints, parts: [] }, [], (e) => events.push(e));
      const slots = screen.hintSlots();
      expect(slots.length).toBeGreaterThanOrEqual(2);
      const h = level.hints[slots[1]!]!;
      expect(screen.hintAt(h.x + 10, 36 + h.y + 10)).toBeNull();
      expect(screen.toggleHints()).toBe(true);
      screen.pointerDown(h.x + 10, 36 + h.y + 10, false);
      expect(events).toContainEqual({ type: "hint", slot: slots[1] });
      expect(screen.toggleHints()).toBe(false);
    });
  });

  describe("LOADSAVE.ITF et DOSBOX.ITF", () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, name: i === 2 ? "Fusée" : null }));

    it("LOADSAVE : Sauvegarder par défaut si le Labo est modifié", () => {
      const choose = vi.fn();
      const w = loadSaveWindow(itf("LOADSAVE.ITF"), { modified: true, choose });
      expect(w.options.defaultId).toBe(LOADSAVE.save);
      expect(w.options.choose(LOADSAVE.load)).toBe(false);
      expect(choose).toHaveBeenCalledWith("load");
      expect(model(w).escape()).toBe(LOADSAVE.cancel);
    });

    /** Point au milieu d'une rangée de la liste (écran). */
    const rowPoint = (m: ItfWindow, row: number) => {
      const r = m.listRect()!;
      const g = m.options.list!.view.geometry()!;
      return { x: r.x + 100, y: m.origin.dy + g.y + (row - m.options.list!.view.top) * g.rowHeight + 2 };
    };
    /** Clic du pointeur sur une rangée, puis les choix qu'il déclenche (comme l'hôte). */
    const clickRow = (w: { options: ItfWindowOptions }, m: ItfWindow, row: number) => {
      const p = rowPoint(m, row);
      m.pointerDown(p.x, p.y);
      m.pointerUp(p.x, p.y);
      for (const id of m.drain()) if (m.canActivate(id)) w.options.choose(id);
    };

    it("chargement : rangées cliquables, Lancer grisé sur un emplacement vide, second clic = valider", () => {
      const validate = vi.fn();
      const click = vi.fn();
      const w = machineListWindow(assets, itf("DOSBOX.ITF"), { mode: "load", slots: () => slots, name: "", validate, click });
      const m = model(w);
      expect(m.item(DOSBOX.title)).toBeNull();
      expect(m.item(DOSBOX.bin)).toBeNull();
      expect(w.selected()).toBe(3);
      const list = m.controls().find((c) => c.kind === "list")!;
      expect(list.kind === "list" && list.list.view.rows.length).toBe(10);
      expect(w.options.list!.label(2)).toBe("Emplacement 3, Fusée");
      clickRow(w, m, 0);
      expect(w.selected()).toBe(1);
      expect(w.options.state!.disabled).toEqual([DOSBOX.load]);
      // Second clic sur une rangée vide : Lancer est grisé, rien n'est chargé.
      clickRow(w, m, 0);
      expect(validate).not.toHaveBeenCalled();
      clickRow(w, m, 2);
      m.relayout();
      clickRow(w, m, 2);
      expect(validate).toHaveBeenCalledWith(3, "");
      expect(click).toHaveBeenCalledTimes(4);
      expect(machineRowText(slots[2]!)).toBe(" 3. Fusée");
    });

    it("liste au clavier : flèches, Origine, Fin ; ▲ / ▼ font défiler d'une rangée", () => {
      const w = machineListWindow(assets, itf("DOSBOX.ITF"), { mode: "load", slots: () => slots, name: "", validate: vi.fn() });
      const m = model(w);
      expect(m.listKey("ArrowDown")).toBe(3);
      expect(m.listKey("Home")).toBe(0);
      expect(m.listKey("End")).toBe(9);
      expect(m.listKey("a")).toBeNull();
      w.options.list!.select(9);
      expect(w.selected()).toBe(10);
      const view = w.options.list!.view;
      expect(view.top + view.visible()).toBeGreaterThan(9);
      const top = view.top;
      w.options.choose(DOSBOX.up);
      expect(view.top).toBe(Math.max(0, top - 1));
    });

    it("sauvegarde : champ du titre, « Sauvegarder », une rangée pleine copie son nom", () => {
      const validate = vi.fn();
      const w = machineListWindow(assets, itf("DOSBOX.ITF"), { mode: "save", slots: () => slots, name: "Ma machine", validate });
      const m = model(w);
      expect(m.item(DOSBOX.load)!.text).toBe("Sauvegarder");
      expect(inputsOf(w.options)[0]!.value).toBe("Ma machine");
      // La liste s'arrête au-dessus du champ du titre.
      expect(w.options.list!.view.rect.y + w.options.list!.view.rect.height).toBeLessThan(m.rect(DOSBOX.title)!.y - m.origin.dy);
      clickRow(w, m, 2);
      expect(w.name()).toBe("Fusée");
      expect(inputsOf(w.options)[0]!.value).toBe("Fusée");
      w.options.choose(DOSBOX.load);
      expect(validate).toHaveBeenCalledWith(3, "Fusée");
    });
  });
});
