import { describe, expect, it, vi } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { parseIdTable } from "../../../src/games/tim3/data/text";
import { RenderAssets, Surface } from "../../../src/games/tim3/render";
import { leaveGame } from "../../../src/ui/game-shell";
import { ITF_TICK_MS, ItfWindow, screenOptions } from "../../../src/games/tim3/ui/itf-window";
import { MAIN_MENU, MainMenuScreen, QUIT_TEXT, mainMenuAction, quitMainMenu } from "../../../src/games/tim3/ui/main-menu";
import { frenchIndex, original } from "../data/real";

describe("menu principal : ce que fait chaque bouton (422e31)", () => {
  it("Jeu, Labo, manuel, aide, options, quitter ; les modes non portés répondent « non disponible »", () => {
    expect(mainMenuAction(MAIN_MENU.play)).toBe("play");
    expect(mainMenuAction(MAIN_MENU.lab)).toBe("lab");
    expect(mainMenuAction(MAIN_MENU.manual)).toBe("help");
    expect(mainMenuAction(MAIN_MENU.help)).toBe("help");
    expect(mainMenuAction(MAIN_MENU.options)).toBe("options");
    expect(mainMenuAction(MAIN_MENU.quit)).toBe("quit");
    expect(mainMenuAction(MAIN_MENU.duel)).toBe("unavailable");
    expect(mainMenuAction(MAIN_MENU.signIn)).toBe("unavailable");
    expect(mainMenuAction(MAIN_MENU.tutorial)).toBe("unavailable");
    expect(mainMenuAction(MAIN_MENU.text)).toBeUndefined();
  });
});

describe("menu principal : Quitter (422f00)", () => {
  it("la question 31113 est toujours posée ; Oui quitte, Non revient au menu", () => {
    const asked: number[] = [];
    let answer: "yes" | "no" = "yes";
    const ask = (text: number, yes: () => void, no: () => void) => {
      asked.push(text);
      (answer === "yes" ? yes : no)();
    };
    const leave = vi.fn();
    const stay = vi.fn();
    quitMainMenu(ask, leave, stay);
    expect(asked).toEqual([QUIT_TEXT]);
    expect(QUIT_TEXT).toBe(31113);
    expect(leave).toHaveBeenCalledOnce();
    expect(stay).not.toHaveBeenCalled();
    answer = "no";
    quitMainMenu(ask, leave, stay);
    expect(asked).toEqual([QUIT_TEXT, QUIT_TEXT]);
    expect(stay).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
  });

  it("Oui sur la page de dev (sans lien de retour) : le jeu est relancé", () => {
    const restart = vi.fn();
    leaveGame(undefined, restart);
    expect(restart).toHaveBeenCalledOnce();
  });
});

describe.skipIf(!original.has)("menu principal sur les données d'origine (MAINMENU.ITF)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const descriptions = new Map(parseIdTable(index.get("DESCRIPT.RES")).map((e) => [e.id, e.text.replace(/^[@!&%$*]+/, "")]));
  const menu = () => new MainMenuScreen(assets, readItf(index.get("MAINMENU.ITF")), { title: "Menu principal", describe: (id) => descriptions.get(id) });
  const make = () => {
    const screen = menu();
    return new ItfWindow(assets, screen.itf, screenOptions(screen, () => undefined), descriptions);
  };
  /** Ce que fait le bouton relâché (`undefined` : rien). */
  const act = (id: number | null) => (id === null ? undefined : mainMenuAction(id));
  /** Centre d'un bouton sur l'écran. */
  const center = (m: ItfWindow, id: number) => {
    const r = m.rect(id)!;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };

  it("fenêtre centrée ; rectangles des modes", () => {
    const m = make();
    expect(m.rect(MAIN_MENU.play)).toEqual({ x: 55 + m.origin.dx, y: 44 + m.origin.dy, width: 131, height: 124 });
    expect(m.origin).toEqual({ dx: 5, dy: 38 });
  });

  it("boutons dans l'ordre de lecture, avec le texte de DESCRIPT.RES ; grisés annoncés ; Entrée : Jeu, Échap : Quitter (450d44)", () => {
    const m = make();
    const labels = m.buttons().map((b) => [b.id, m.name(b)]);
    expect(labels[0]).toEqual([MAIN_MENU.play, "Jeu: Jouer les puzzles dans l'ordre ou charger un nouveau puzzle."]);
    expect(labels.find(([id]) => id === MAIN_MENU.duel)?.[1]).toBe("Duel: Jouer une partie contre un ami. (non disponible)");
    expect(labels.find(([id]) => id === MAIN_MENU.quit)?.[1]).toBe("Quitter la Partie");
    expect(labels.find(([id]) => id === MAIN_MENU.options)?.[1]).toBe("Vos Options");
    expect(m.options.defaultId).toBe(MAIN_MENU.play);
    expect(act(m.escape())).toBe("quit");
  });

  it("clic : appui puis relâché sur le même bouton ; un mode grisé répond « non disponible »", () => {
    const m = make();
    const p = center(m, MAIN_MENU.lab);
    m.pointerDown(p.x, p.y);
    expect(act(m.pointerUp(p.x, p.y))).toBe("lab");
    const d = center(m, MAIN_MENU.duel);
    m.pointerDown(d.x, d.y);
    expect(act(m.pointerUp(d.x, d.y))).toBe("unavailable");
    m.pointerDown(p.x, p.y);
    expect(act(m.pointerUp(10, 10))).toBeUndefined();
    const q = center(m, MAIN_MENU.quit);
    m.pointerDown(q.x, q.y);
    expect(act(m.pointerUp(q.x, q.y))).toBe("quit");
  });

  it("survol : texte du mode dans la bande MM_TEXT (contrôle + 100), dessiné", () => {
    const m = make();
    const s = new Surface(640, 480);
    m.pointerMove(5, 5);
    m.render(s);
    const before = s.pixels.slice();
    const p = center(m, MAIN_MENU.play);
    m.pointerMove(p.x, p.y);
    expect(m.status()).toBe("Jeu: Jouer les puzzles dans l'ordre ou charger un nouveau puzzle.");
    m.render(s);
    const band = m.rect(MAIN_MENU.text)!;
    let changed = 0;
    for (let y = band.y; y < band.y + band.height; y++) for (let x = band.x; x < band.x + band.width; x++) if (s.pixels[y * 640 + x] !== before[y * 640 + x]) changed++;
    expect(changed).toBeGreaterThan(200);
    m.pointerLeave();
    expect(m.status()).toBe("");
    m.focus(MAIN_MENU.lab);
    expect(m.status()).toBe("Labo du Professeur Tim: Construire ou modifier des puzzles.");
  });

  it("Options, Quitter, Aide (sans texte + 100, 4233a3) et hors des boutons : la bande se vide, au survol comme au focus", () => {
    const m = make();
    const s = new Surface(640, 480);
    const band = m.rect(MAIN_MENU.text)!;
    const bandPixels = (): number[] => {
      m.render(s);
      const out: number[] = [];
      for (let y = band.y; y < band.y + band.height; y++) for (let x = band.x; x < band.x + band.width; x++) out.push(s.pixels[y * 640 + x]!);
      return out;
    };
    m.pointerMove(5, 5);
    const empty = bandPixels();
    for (const id of [MAIN_MENU.options, MAIN_MENU.quit, MAIN_MENU.help]) {
      // Le dernier mode survolé ne reste pas dans la bande.
      const p = center(m, MAIN_MENU.play);
      m.pointerMove(p.x, p.y);
      expect(m.status()).not.toBe("");
      const c = center(m, id);
      m.pointerMove(c.x, c.y);
      expect(m.active()).toBe(id);
      expect(m.status()).toBe("");
      expect(bandPixels()).toEqual(empty);
      // Au clavier : focus sur un mode, puis sur le bouton.
      m.focus(MAIN_MENU.lab);
      expect(m.status()).not.toBe("");
      m.focus(id);
      expect(m.status()).toBe("");
      expect(bandPixels()).toEqual(empty);
    }
    // Entre deux boutons, la souris ne ramène pas le texte du bouton qui a le focus (« Jeu » à l'ouverture).
    m.focus(MAIN_MENU.play);
    m.pointerMove(5, 5);
    expect(m.status()).toBe("");
  });

  it("survol : l'image du mode s'anime à chaque passe (50 ms), et revient à la première en partant", () => {
    const m = make();
    const s = new Surface(640, 480);
    const p = center(m, MAIN_MENU.play);
    m.pointerMove(p.x, p.y);
    m.tick(0);
    m.render(s);
    const first = s.pixels.slice();
    let moved = false;
    for (let t = ITF_TICK_MS; t <= ITF_TICK_MS * 40 && !moved; t += ITF_TICK_MS) {
      m.tick(t);
      m.render(s);
      moved = s.pixels.some((v, i) => v !== first[i]);
    }
    expect(moved).toBe(true);
    m.pointerMove(5, 5);
    m.tick(ITF_TICK_MS * 41);
    m.render(s);
    // Sans survol, plus de texte ni d'animation : la fenêtre de départ.
    const fresh = make();
    fresh.pointerMove(5, 5);
    const f = new Surface(640, 480);
    fresh.render(f);
    expect(s.pixels).toEqual(f.pixels);
  });
});
