import { afterEach, describe, expect, it, vi } from "vitest";
import { HtmlCdBackend } from "../../src/games/lost-in-time/engine/audio/html-cd";
import { AudioPrefs } from "../../src/games/lost-in-time/engine/audio/prefs";
import { MemoryStore } from "../../src/games/lost-in-time/engine/saves";
import { PausableClock } from "../../src/games/lost-in-time/ui/clock";

describe("PausableClock", () => {
  it("n'avance pas pendant la pause et reprend sans saut", () => {
    let real = 1000;
    const clock = new PausableClock(() => real);
    real = 1100;
    expect(clock.now()).toBe(1100);
    clock.pause();
    real = 9100;
    expect(clock.now()).toBe(1100);
    clock.resume();
    expect(clock.now()).toBe(1100);
    real = 9150;
    expect(clock.now()).toBe(1150);
  });

  it("cumule plusieurs pauses et ignore les appels redondants", () => {
    let real = 0;
    const clock = new PausableClock(() => real);
    clock.pause();
    real = 100;
    clock.pause();
    clock.resume();
    clock.resume();
    real = 150;
    clock.pause();
    real = 400;
    clock.resume();
    real = 410;
    expect(clock.now()).toBe(410 - 100 - 250);
  });
});

/** Faux HTMLAudioElement : pas de lecture réelle, seulement l'état. */
class FakeAudio {
  paused = true;
  ended = false;
  muted = false;
  preload = "";
  src = "";
  readyState = 4;
  currentTime = 0;
  plays = 0;
  addEventListener(): void {}
  play(): Promise<void> {
    this.paused = false;
    this.plays++;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

describe("HtmlCdBackend en pause", () => {
  afterEach(() => vi.unstubAllGlobals());

  function make(): { cd: HtmlCdBackend; audio: FakeAudio } {
    const audio = new FakeAudio();
    vi.stubGlobal("Audio", function () {
      return audio;
    });
    return { cd: new HtmlCdBackend("x.mp3"), audio };
  }

  it("suspend met en pause sans finir la plage, resume reprend à la même position", () => {
    const { cd, audio } = make();
    cd.play(10, 60);
    expect(audio.paused).toBe(false);
    audio.currentTime = 20;
    expect(cd.playing).toBe(true);
    cd.suspend();
    expect(audio.paused).toBe(true);
    // le moteur ne doit pas voir une fin de plage pendant la pause
    expect(cd.playing).toBe(true);
    expect(audio.currentTime).toBe(20);
    cd.unlock(); // un geste utilisateur pendant la pause ne relance pas la lecture
    expect(audio.paused).toBe(true);
    cd.resume();
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(20);
    cd.stop();
  });

  it("ne relance pas une plage arrêtée pendant la pause", () => {
    const { cd, audio } = make();
    cd.play(10, 60);
    cd.suspend();
    cd.stop();
    cd.resume();
    expect(audio.paused).toBe(true);
    expect(cd.playing).toBe(false);
  });
});

describe("AudioPrefs.reload (autre onglet)", () => {
  it("reprend la valeur écrite par un autre onglet et l'applique aux sorties", () => {
    const store = new MemoryStore();
    const target = { muted: false };
    const prefs = new AudioPrefs(store, [target]);
    expect(prefs.reload()).toBe(false);
    store.set("audio.sound", "0"); // écrit par un autre onglet
    expect(prefs.reload()).toBe(true);
    expect(prefs.isEnabled()).toBe(false);
    expect(target.muted).toBe(true);
    expect(prefs.reload()).toBe(false);
  });
});

describe("style de l'écran", () => {
  it("l'anneau de focus entoure l'écran au lieu de recouvrir les bords du canvas", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../../src/games/lost-in-time/ui/style.css", import.meta.url), "utf8");
    // Le jeu dessine jusqu'à x = 0 (libellés du bas) : un anneau intérieur masquait la 1re colonne (« U » lu « J »).
    expect(css).not.toMatch(/\.lit-canvas:focus-visible\s*\{[^}]*outline-offset:\s*-/);
    expect(css).toMatch(/\.lit-stage:has\(\.lit-canvas:focus-visible\)/);
  });
});
