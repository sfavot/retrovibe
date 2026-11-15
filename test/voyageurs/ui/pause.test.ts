/**
 * La pause du site fige le jeu : onglet masqué, fenêtre des sauvegardes (ou autre) ouverte, bouton Pause. Compte à rebours du
 * vaisseau-bombe (PART04B, 3 600 ticks de jeu) compris : si la pause laissait passer un tick, la Terre serait perdue pendant qu'on
 * lit une fenêtre.
 *
 * Le montage complet (`mountPointClickApp`) a besoin d'un navigateur (canvas, `document.hidden`, fetch) et les tests tournent sous Node :
 * on rejoue donc ici, avec les vraies classes de l'application (`BrowserHost`, `VoyageursSound`, `VoyageursLoop`, `TickScheduler`),
 * la logique d'image de `ui/point-click-app.ts` : `isPaused()` = onglet masqué OU pause OU fenêtre OU aide ; `applyPause` pousse l'état
 * à l'hôte (`host.setPaused` coupe le son) et resynchronise l'horloge à la reprise ; `onFrame` ne fait rien en pause, sinon
 * `scheduler.due(now)` appels à `engine.tick()`. Ce banc ne suit pas `point-click-app.ts` de lui-même : la pause réelle est vérifiée dans
 * le navigateur.
 *
 * Le compte à rebours n'est qu'un compteur de ticks de jeu : `deaths.test.ts` prouve déjà que la pause du menu système le fige et qu'il
 * dure 3 606 ticks ; le test de PART04B ci-dessous (fichiers d'origine) prouve que la pause du site ne le fait pas avancer non plus.
 */

import { describe, expect, it } from "vitest";
import { RecordingMusic, RecordingOpl, VoyageursSound } from "../../../src/games/voyageurs/audio/audio";
import type { VoyageursGame } from "../../../src/games/voyageurs/create";
import { STEP_MS } from "../../../src/games/voyageurs/engine/game";
import { BrowserHost } from "../../../src/games/voyageurs/ui/browser-host";
import { MAX_CATCH_UP_STEPS } from "../../../src/games/voyageurs/ui/app";
import { VoyageursLoop } from "../../../src/games/voyageurs/ui/loop";
import { TickScheduler } from "../../../src/ui/tick-scheduler";
import { hasOriginalFiles } from "../engine/helpers";
import { Driver } from "../solution/driver";
import { playTo } from "../solution/play";

/** Sortie de musique qui compte les suspensions et les reprises. */
class CountingMusic extends RecordingMusic {
  suspends = 0;
  resumes = 0;
  override suspend(): void {
    this.suspends++;
  }
  override resume(): void {
    this.resumes++;
  }
}

class CountingOpl extends RecordingOpl {
  suspends = 0;
  resumes = 0;
  override suspend(): void {
    this.suspends++;
  }
  override resume(): void {
    this.resumes++;
  }
}

/** Page des jeux de pointer-et-cliquer, réduite à sa logique de pause et d'image (voir l'en-tête). */
class Page {
  readonly music = new CountingMusic();
  readonly opl = new CountingOpl();
  readonly host: BrowserHost;
  readonly loop: VoyageursLoop;
  private readonly scheduler = new TickScheduler(STEP_MS, MAX_CATCH_UP_STEPS);
  tabHidden = false;
  userPaused = false;
  modal = false;
  help = false;
  /** Horloge de l'écran (`requestAnimationFrame`), en millisecondes. */
  now = 0;
  frames = 0;

  constructor(game: Pick<VoyageursGame, "engine">) {
    const audio = new VoyageursSound({ now: () => this.now, music: this.music, opl: this.opl });
    this.host = new BrowserHost({
      files: { read: () => null },
      storage: { get: () => null, set: () => true, remove: () => undefined },
      audio,
      onExit: () => undefined,
      onSaveRequest: () => undefined,
      onLoadRequest: () => undefined,
      now: () => this.now,
    });
    this.loop = new VoyageursLoop({
      game: { ...game, renderer: { backBuffer: new Uint8Array(320 * 200), screenRgb: () => new Uint8Array(48) } } as unknown as VoyageursGame,
      present: () => undefined,
      pointer: () => ({ x: 0, y: 0 }),
      touchMode: () => true,
    });
    this.scheduler.due(0);
  }

  private get paused(): boolean {
    return this.tabHidden || this.userPaused || this.modal || this.help;
  }

  private apply(): void {
    this.host.setPaused(this.paused);
    if (!this.paused) this.scheduler.resync();
  }

  hide(hidden: boolean): void {
    this.tabHidden = hidden;
    this.apply();
  }
  togglePause(): void {
    this.userPaused = !this.userPaused;
    this.apply();
  }
  /** Fenêtre des sauvegardes ou du chargement (`openModal` / `closeModal`). */
  setModal(open: boolean): void {
    this.modal = open;
    this.apply();
  }

  /** Une image d'écran à 60 Hz (`onFrame`). */
  frame(): void {
    this.now += 1000 / 60;
    this.frames++;
    if (this.paused) return;
    for (let ticks = this.scheduler.due(this.now); ticks > 0; ticks--) this.loop.tick();
    this.loop.render();
  }

  /** `ms` millisecondes d'images d'écran. */
  run(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) this.frame();
  }
}

/** Faux moteur : un compteur de pas, pour le gating seul (aucun fichier d'origine). */
function counter() {
  const engine = { steps: 0, step: () => void engine.steps++ };
  return engine;
}

const PAUSES: { name: string; start(p: Page): void; end(p: Page): void }[] = [
  { name: "onglet masqué", start: (p) => p.hide(true), end: (p) => p.hide(false) },
  { name: "fenêtre des sauvegardes ouverte", start: (p) => p.setModal(true), end: (p) => p.setModal(false) },
  { name: "bouton Pause", start: (p) => p.togglePause(), end: (p) => p.togglePause() },
];

describe("pause du site : aucun tick ne passe", () => {
  for (const pause of PAUSES) {
    it(`${pause.name} : ni pas du moteur pendant 10 minutes, la reprise repart sans rattraper l'absence`, () => {
      const engine = counter();
      const page = new Page({ engine } as never);
      page.run(1000);
      const running = engine.steps;
      // 1 s à 100 pas par seconde (STEP_MS = 10 ms), à une image près.
      expect(running).toBeGreaterThanOrEqual(98);
      expect(running).toBeLessThanOrEqual(101);

      pause.start(page);
      expect(page.music.suspends).toBe(1);
      expect(page.opl.suspends).toBe(1);
      page.run(10 * 60 * 1000);
      expect(engine.steps).toBe(running);
      expect(page.music.resumes).toBe(0);

      pause.end(page);
      expect(page.music.resumes).toBe(1);
      expect(page.opl.resumes).toBe(1);
      page.run(1000);
      // Reprise : 1 s de jeu de plus, pas 10 minutes de rattrapage.
      expect(engine.steps - running).toBeGreaterThanOrEqual(98);
      expect(engine.steps - running).toBeLessThanOrEqual(101);
    });
  }

  it("plusieurs causes à la fois : le jeu ne repart que quand toutes sont levées", () => {
    const engine = counter();
    const page = new Page({ engine } as never);
    page.run(100);
    page.hide(true);
    page.setModal(true);
    page.togglePause();
    const frozen = engine.steps;
    page.hide(false);
    page.run(5000);
    page.setModal(false);
    page.run(5000);
    expect(engine.steps).toBe(frozen);
    page.togglePause();
    page.run(1000);
    expect(engine.steps).toBeGreaterThan(frozen);
  });
});

describe.skipIf(!hasOriginalFiles || process.env.VOYAGEURS_FULL_GAME === "0")("compte à rebours du vaisseau-bombe (PART04B) et pause du site", () => {
  /** Chiffres du compteur (objets 208 à 211, script 34 de PART04B). */
  const digits = (d: Driver): number[] => [208, 209, 210, 211].map((idx) => d.state.objects[idx]!.frame);

  for (const pause of PAUSES) {
    it(`${pause.name} : ticks de jeu, globales et chiffres figés, la reprise continue le compte`, () => {
      const d = playTo("5.", 0);
      const page = new Page({ engine: d.engine });
      // Quelques secondes de jeu : le compte à rebours tourne.
      page.run(2000);
      const ticks = d.engine.ticks;
      const globals = Array.from(d.state.globals);
      const shown = digits(d);
      expect(ticks).toBeGreaterThan(0);

      pause.start(page);
      // 30 minutes de temps d'écran : la limite du compte à rebours (3 600 ticks, environ 11 minutes de pas à 12 pas par tick) est
      // dépassée plusieurs fois si la pause laissait passer du temps.
      page.run(30 * 60 * 1000);
      expect(d.engine.ticks).toBe(ticks);
      expect(Array.from(d.state.globals)).toEqual(globals);
      expect(digits(d)).toEqual(shown);
      expect(d.saw("La bombe vient de détruire le dernier pole")).toBe(false);

      pause.end(page);
      page.run(5000);
      // Reprise : le jeu avance de 5 s (environ 40 ticks), pas de saut.
      expect(d.engine.ticks).toBeGreaterThan(ticks);
      expect(d.engine.ticks - ticks).toBeLessThan(60);
      expect(page.music.suspends).toBe(1);
      expect(page.music.resumes).toBe(1);
    }, 60_000);
  }
});
