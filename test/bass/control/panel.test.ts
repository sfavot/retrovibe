import { describe, expect, it } from "vitest";
import { MouseButton } from "../../../src/games/bass/engine/host";
import { Cursor, SF, Var } from "../../../src/games/bass/engine/ids";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { textVoiceModeOf } from "../../../src/games/bass/engine/text";
import { type Controlled, FakeAudio, fingerprint, hasOriginalFiles, makeControlled } from "./harness";

/** Positions absolues des éléments du panneau (`createResource` : décalage 60, 10 ; boutons de 23 x 14). */
const AT = {
  exit: [80, 140],
  restore: [122, 33],
  save: [122, 53],
  quit: [122, 73],
  restart: [122, 93],
  fx: [122, 113],
  text: [122, 133],
  speedSlide: [85, 112],
  musicSlide: [85, 62],
  yes: [95, 95],
  no: [175, 95],
} as const;

function start(options: Parameters<typeof makeControlled>[0] = {}): Controlled {
  const game = makeControlled(options);
  game.engine.startAfterIntro();
  game.cycles(3);
  return game;
}

function openPanel(game: Controlled): void {
  game.push({ type: "action", action: "panel" });
  game.ticks(2);
}

/** Appui puis relâchement au même endroit, puis le temps de l'animation du bouton. */
function click(game: Controlled, [x, y]: readonly [number, number], wait = 14): void {
  game.push({ type: "click", x, y, button: MouseButton.Left });
  game.ticks(2);
  game.push({ type: "release", x, y });
  game.ticks(wait);
}

/** Glisse un curseur : appui en (x, y), déplacement jusqu'à `toY`, relâchement. */
function drag(game: Controlled, [x, y]: readonly [number, number], toY: number): void {
  game.push({ type: "click", x, y, button: MouseButton.Left });
  game.ticks(2);
  game.push({ type: "move", x, y: toY });
  game.ticks(3);
  game.push({ type: "release", x, y: toY });
  game.ticks(3);
}

const withScreen = (): Parameters<typeof makeControlled>[0] => ({ screen: (e) => new BassScreenRenderer().attach(e) });

describe.skipIf(!hasOriginalFiles)("panneau de contrôle : ouverture, fermeture, jeu figé", () => {
  it("F5 ouvre le panneau, fige le jeu, Échap le ferme et le jeu reprend", () => {
    const g = start();
    const cycles = g.engine.completedCycles;
    g.engine.mouse.sprite(Cursor.DOWN, 3, 4);
    openPanel(g);
    expect(g.control.panelOpen).toBe(true);
    expect(g.control.frozen).toBe(true);
    expect(g.engine.mouse.cursor).toBe(Cursor.NORMAL);
    g.ticks(60);
    expect(g.engine.completedCycles).toBe(cycles); // aucun tour pendant le panneau
    g.push({ type: "action", action: "skip" });
    g.ticks(3);
    expect(g.control.panelOpen).toBe(false);
    expect(g.engine.mouse.cursor).toBe(Cursor.DOWN); // curseur et point chaud d'avant
    expect(g.engine.mouse.cursorHotspot).toEqual([3, 4]);
    g.cycles(2);
    expect(g.engine.completedCycles).toBe(cycles + 2);
  });

  it("le bouton « Jouer » ferme le panneau ; une demande pendant un effet bloquant attend la fin du tour", () => {
    const g = start();
    openPanel(g);
    click(g, AT.exit);
    expect(g.control.panelOpen).toBe(false);
    // Un tour bloqué par un effet : la demande est gardée, le panneau s'ouvre dès que le jeu reprend la main.
    let guard = 0;
    while (!g.engine.blocked && guard++ < 5000) g.tick();
    if (g.engine.blocked) {
      g.push({ type: "action", action: "panel" });
      g.tick();
      expect(g.control.panelOpen).toBe(false);
      while (g.engine.blocked && guard++ < 6000) g.tick();
      g.ticks(2);
      expect(g.control.panelOpen).toBe(true);
    }
  });

  it("dessine le panneau d'origine sur l'écran (palette 60510, boutons, texte du bouton survolé) puis rend l'écran du jeu", () => {
    const g = start(withScreen());
    const renderer = g.engine.screen as BassScreenRenderer;
    openPanel(g);
    g.ticks(3);
    const pixels = renderer.frame.pixels;
    expect(pixels.some((p) => p !== 0)).toBe(true);
    // Hors du panneau (60, 10, 153 x 166) : noir.
    expect(pixels[5 * 320 + 5]).toBe(0);
    expect(pixels[100 * 320 + 100]).not.toBe(0);
    const before = pixels.slice();
    g.push({ type: "move", x: AT.exit[0], y: AT.exit[1] });
    g.ticks(3);
    // Le texte du bouton (« Jouer ») apparaît près du pointeur.
    let changed = 0;
    for (let y = AT.exit[1] - 16; y < AT.exit[1] - 4; y++) for (let x = AT.exit[0] + 12; x < AT.exit[0] + 60; x++) if (pixels[y * 320 + x] !== before[y * 320 + x]) changed++;
    expect(changed).toBeGreaterThan(10);
    g.push({ type: "action", action: "skip" });
    g.ticks(3);
    g.cycles(3);
    expect(pixels.some((p) => p !== 0)).toBe(true); // le décor revient
  });
});

describe.skipIf(!hasOriginalFiles)("panneau de contrôle : réglages", () => {
  it("vitesse du jeu : le curseur donne 2 à 134 ms par tour (cran de 12), un simple clic arrondit 80 à 74", () => {
    const g = start();
    expect(g.engine.system.gameSpeed).toBe(80);
    openPanel(g);
    click(g, AT.speedSlide, 4);
    expect(g.engine.system.gameSpeed).toBe(74); // (109 - 103) * 12 + 2, comme ScummVM
    drag(g, AT.speedSlide, AT.speedSlide[1] - 20);
    expect(g.engine.system.gameSpeed).toBe(2); // haut : le plus rapide
    drag(g, [AT.speedSlide[0], 105], 105 + 30);
    expect(g.engine.system.gameSpeed).toBe(134); // bas : le plus lent
    expect(g.host.settings.at(-1)?.gameSpeed).toBe(134);
    g.push({ type: "action", action: "skip" });
    g.ticks(3);
    // Plus lent : un tour tous les 134 ms (7 ticks).
    const before = g.engine.completedCycles;
    g.ticks(70);
    expect(g.engine.completedCycles - before).toBeLessThanOrEqual(11);
  });

  it("volume de la musique : 127 en haut, 0 en bas, valeur du curseur sinon ; mémorisé par l'hôte", () => {
    const sound = new FakeAudio();
    const g = start({ sound });
    openPanel(g);
    drag(g, AT.musicSlide, AT.musicSlide[1] + 16);
    expect(sound.musicVolume).toBe(127 - 16 * 4);
    drag(g, [AT.musicSlide[0], 75], 75 + 40);
    expect(sound.musicVolume).toBe(0);
    drag(g, [AT.musicSlide[0], 91], 91 - 60);
    expect(sound.musicVolume).toBe(127);
    expect(g.host.settings.at(-1)?.musicVolume).toBe(127);
  });

  it("texte / voix : texte seul, voix seule, texte et voix, dans cet ordre (départ : texte et voix)", () => {
    const sound = new FakeAudio();
    const g = start({ sound });
    const mode = (): string => textVoiceModeOf(g.engine.system.systemFlags);
    expect(mode()).toBe("both");
    openPanel(g);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      click(g, AT.text);
      seen.push(`${mode()}/${sound.speechOn}`);
    }
    expect(seen).toEqual(["text/false", "voice/true", "both/true", "text/false"]);
    expect(g.host.settings.at(-1)?.textMode).toBe("text");
    expect(g.control.settings.textMode).toBe("text");
  });

  it("effets : bascule SF_FX_OFF et le son", () => {
    const sound = new FakeAudio();
    const g = start({ sound });
    openPanel(g);
    click(g, AT.fx);
    expect(g.engine.system.systemFlags & SF.FX_OFF).toBeTruthy();
    expect(sound.fxOff).toBe(true);
    click(g, AT.fx);
    expect(g.engine.system.systemFlags & SF.FX_OFF).toBe(0);
    expect(sound.fxOff).toBe(false);
  });

  it("applySettings remet les réglages mémorisés", () => {
    const sound = new FakeAudio();
    const g = start({ sound });
    g.control.applySettings({ musicVolume: 40, gameSpeed: 50, fxOff: true, textMode: "voice" });
    expect(g.control.settings).toEqual({ musicVolume: 40, gameSpeed: 50, fxOff: true, textMode: "voice" });
    expect(sound.musicVolume).toBe(40);
    expect(sound.speechOn).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("panneau de contrôle : recommencer, quitter, sauvegardes", () => {
  it("« Recommencer » : non revient au panneau ; oui remet l'état d'une nouvelle partie, sans résidu", () => {
    const g = start();
    g.push({ type: "move", x: 160, y: 100 });
    g.cycles(119);
    g.push({ type: "click", x: 200, y: 150, button: MouseButton.Left });
    g.cycles(40);
    g.engine.vars[Var.RESULT] = 77;
    openPanel(g);
    click(g, AT.restart);
    expect(g.control.panelOpen).toBe(true);
    click(g, AT.no);
    expect(g.control.panelOpen).toBe(true);
    click(g, AT.restart);
    g.push({ type: "click", x: AT.yes[0], y: AT.yes[1], button: MouseButton.Left }, { type: "release", x: AT.yes[0], y: AT.yes[1] });
    for (let t = 0; g.control.panelOpen && t < 100; t++) g.tick();
    expect(g.control.panelOpen).toBe(false);
    const fresh = makeControlled();
    fresh.engine.startAfterIntro();
    expect(fingerprint(g.engine, true, false)).toBe(fingerprint(fresh.engine, true, false));
    // La suite est celle d'une nouvelle partie (le hasard et le curseur ne sont pas remis : comme ScummVM).
    fresh.engine.mouse.moved(g.engine.mouse.x, g.engine.mouse.y);
    g.cycles(30);
    fresh.cycles(30);
    expect(fingerprint(g.engine, true, false)).toBe(fingerprint(fresh.engine, true, false));
  });

  it("« Quitter » : oui sort vers l'écran titre (`BaseHost.exit`), non revient au panneau", () => {
    const g = start();
    openPanel(g);
    click(g, AT.quit);
    click(g, AT.no);
    expect(g.host.exited).toBe(false);
    expect(g.control.panelOpen).toBe(true);
    click(g, AT.quit);
    click(g, AT.yes);
    expect(g.host.exited).toBe(true);
  });

  it("« Sauvegarder » : demande le dialogue du site, annuler revient au panneau, sauvegarder le ferme", () => {
    const g = start();
    g.cycles(5);
    openPanel(g);
    click(g, AT.save);
    expect(g.host.saveRequests).toBe(1);
    expect(g.control.panelOpen).toBe(true);
    g.control.finishDialog(); // fermé sans rien choisir
    g.ticks(3);
    expect(g.control.panelOpen).toBe(true);
    click(g, AT.save);
    expect(g.host.saveRequests).toBe(2);
    const save = g.control.capture();
    expect(typeof save).toBe("object");
    g.control.finishDialog();
    g.ticks(3);
    expect(g.control.panelOpen).toBe(false);
  });

  it("refusé pendant un choix (SF_CHOOSING) : le bouton n'ouvre rien", () => {
    const g = start();
    g.engine.system.systemFlags |= SF.CHOOSING;
    openPanel(g);
    click(g, AT.save);
    click(g, AT.restore);
    expect(g.host.saveRequests + g.host.restoreRequests).toBe(0);
    expect(g.control.panelOpen).toBe(true);
  });

  it("« Restituer » : une partie restituée ferme le panneau et remet curseur, palette et état", () => {
    const g = start(withScreen());
    g.cycles(8);
    g.engine.mouse.sprite(Cursor.DOWN, 1, 2);
    const save = g.control.capture();
    if (typeof save === "string") throw new Error(save);
    const state = fingerprint(g.engine);
    g.cycles(20);
    openPanel(g);
    click(g, AT.restore);
    expect(g.host.restoreRequests).toBe(1);
    expect(g.control.load(save)).toBe(true);
    g.control.finishDialog();
    g.ticks(3);
    expect(g.control.panelOpen).toBe(false);
    expect(g.engine.mouse.cursor).toBe(Cursor.DOWN);
    expect(fingerprint(g.engine)).toBe(state.replace(/^(\[.*?)$/, "$1")); // état d'avant le panneau
  });
});

describe.skipIf(!hasOriginalFiles)("fnRestoreGame, pause, restitution pendant un effet", () => {
  it("fnRestoreGame demande la restitution et fige le jeu jusqu'à la fermeture du dialogue", () => {
    const g = start();
    const save = g.control.capture();
    if (typeof save === "string") throw new Error(save);
    g.cycles(10);
    g.engine.logic.deps.control.restoreGame();
    expect(g.host.restoreRequests).toBe(1);
    g.ticks(30);
    const cycles = g.engine.completedCycles;
    g.ticks(30);
    expect(g.engine.completedCycles).toBe(cycles); // figé
    expect(g.control.frozen).toBe(true);
    expect(g.control.load(save)).toBe(true);
    g.control.finishDialog();
    g.cycles(2);
    expect(g.control.frozen).toBe(false);
  });

  it("sans méthode de restitution dans l'hôte, le jeu n'est pas figé", () => {
    const g = start();
    (g.host as { requestRestore?: unknown }).requestRestore = undefined;
    g.engine.logic.deps.control.restoreGame();
    g.cycles(3);
    expect(g.control.frozen).toBe(false);
  });

  it("pause (p) : palette assombrie, jeu figé, une touche reprend (et n'est pas transmise)", () => {
    const sound = new FakeAudio();
    const g = start({ sound, ...withScreen() });
    const renderer = g.engine.screen as BassScreenRenderer;
    const normal = renderer.frame.palette.slice();
    g.push({ type: "action", action: "pause" });
    g.ticks(2);
    expect(g.control.paused).toBe(true);
    expect(sound.fxPaused).toBe(1);
    expect(renderer.frame.palette.some((v, i) => v !== normal[i])).toBe(true);
    const cycles = g.engine.completedCycles;
    g.ticks(40);
    expect(g.engine.completedCycles).toBe(cycles);
    g.push({ type: "action", action: "key" });
    g.ticks(2);
    expect(g.control.paused).toBe(false);
    expect(sound.fxPaused).toBe(0);
    expect(Array.from(renderer.frame.palette)).toEqual(Array.from(normal));
    g.cycles(2);
    expect(g.engine.completedCycles).toBeGreaterThan(cycles);
  });

  it("restitution demandée pendant un effet bloquant : appliquée à la fin du tour", () => {
    const g = start();
    g.push({ type: "move", x: 160, y: 100 });
    g.cycles(119);
    const save = g.control.capture();
    if (typeof save === "string") throw new Error(save);
    const state = fingerprint(g.engine, false);
    g.push({ type: "click", x: 200, y: 150, button: MouseButton.Left }); // Foster marche jusqu'à la sortie : fondu au changement d'écran
    let guard = 0;
    while (!g.engine.blocked && guard++ < 30000) g.tick();
    expect(g.engine.blocked).toBe(true);
    expect(g.control.capture()).toBe("busy");
    expect(g.control.load(save)).toBe(true);
    expect(fingerprint(g.engine, false)).not.toBe(state); // pas encore
    while (g.engine.blocked && guard++ < 9000) g.tick();
    g.control.tick([]); // la reprise s'applique avant le tour suivant
    expect(fingerprint(g.engine, false)).toBe(state);
  });
});

// --- Comparaison au banc ScummVM (`b-panel.txt` : F5 après Échap, survol, textes, croix, question « Recommencer ») ---

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/** Capture du banc : 320 x 200 indices bruts de la surface de l'écran (sans le curseur). */
function bench(name: string): Uint8Array {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`./fixtures/${name}.idx.gz`, import.meta.url))));
}

/**
 * Écart de ScummVM, non reproduit : quand le texte d'état change une deuxième fois, `TextResource::flushForRedraw` restaure 184 colonnes
 * (`PAN_LINE_WIDTH`) depuis un tampon qui n'en a sauvegardé que 146 (la largeur du texte) : le reste est de la mémoire non initialisée
 * (0 dans le banc). Les deux colonnes du cadre qui dépassent (x 210 et 211, y 163 à 174) passent à 0 dans le banc.
 */
function restoredFromBlankBuffer(i: number, expected: number): boolean {
  const x = i % 320;
  const y = Math.floor(i / 320);
  return expected === 0 && x >= 64 + 146 && x < 64 + 184 && y >= 163 && y < 175;
}

/** Première différence (x, y, indice du banc, indice du portage) et nombre de pixels différents. */
function diff(expected: Uint8Array, actual: Uint8Array, ignoreBlankRestore = false): string {
  let count = 0;
  let first = "";
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === actual[i]) continue;
    if (ignoreBlankRestore && restoredFromBlankBuffer(i, expected[i]!)) continue;
    if (!count) first = `(${i % 320}, ${Math.floor(i / 320)}) banc ${expected[i]} portage ${actual[i]}`;
    count++;
  }
  return count ? `${count} pixels différents, premier ${first}` : "identique";
}

describe.skipIf(!hasOriginalFiles)("panneau de contrôle : images identiques au banc ScummVM (surface de l'écran, 320 x 200)", () => {
  it("ouverture, survol d'un bouton, texte seul puis voix seule, effets coupés, question « Recommencer », réponse « non »", () => {
    // Le banc pose la question en anglais (ScummVM l'écrit dans son code) : même texte ici pour comparer l'image entière.
    const g = start({ ...withScreen(), questions: { restart: "Restart?", quit: "Quit to DOS?" } });
    const frame = (g.engine.screen as BassScreenRenderer).frame;
    const shot = (name: string, secondStatus = false): string => {
      g.ticks(2);
      return diff(bench(name), frame.pixels, secondStatus);
    };
    g.engine.mouse.moved(160, 100);
    openPanel(g);
    g.ticks(10);
    expect(shot("panel-a")).toBe("identique");
    g.push({ type: "move", x: 90, y: 145 });
    g.ticks(10);
    expect(shot("panel-exit")).toBe("identique");
    g.push({ type: "move", x: 125, y: 135 });
    g.ticks(10);
    expect(shot("panel-text")).toBe("identique");
    click(g, [125, 135], 12);
    click(g, [125, 135], 12);
    expect(shot("panel-text2", true)).toBe("identique");
    click(g, [125, 115], 12);
    expect(shot("panel-fxoff", true)).toBe("identique");
    click(g, [125, 95], 12);
    g.push({ type: "move", x: 95, y: 95 });
    g.ticks(10);
    expect(shot("panel-yes", true)).toBe("identique");
    click(g, [175, 95], 12);
    expect(shot("panel-no", true)).toBe("identique");
  });
});
