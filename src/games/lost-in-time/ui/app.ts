import "./style.css";
import { HtmlCdBackend } from "../engine/audio/html-cd";
import { WebAudioSoundBackend } from "../engine/audio/web-audio";
import { AudioPrefs } from "../engine/audio/prefs";
import { Game } from "../engine/game";
import { LocalStorageStore } from "../engine/saves";
import { createSystem, type System } from "../engine/system";
import { CanvasPresenter } from "../render/canvas";
import { copy } from "../copy";
import { copy as shared } from "../../../ui/copy";
import { h } from "../../../ui/dom";
import type { BrowserHost } from "./browser-host";

/** Interface du jeu : un canvas mis à l'échelle (4:3), les entrées du navigateur, l'audio et l'état de fin / d'erreur. */
export class App {
  private readonly canvas = h("canvas", {
    class: "lit-canvas",
    width: 320,
    height: 200,
    tabindex: 0,
    "aria-label": copy.canvasLabel,
  });
  private readonly stage = h("div", { class: "lit-stage" }, this.canvas);
  private readonly soundBackend = new WebAudioSoundBackend();
  private readonly cdBackend: HtmlCdBackend;
  private readonly system: System;
  private readonly game: Game;
  private readonly presenter: CanvasPresenter;
  private readonly prefs: AudioPrefs;
  private readonly soundButton: HTMLButtonElement;

  constructor(
    container: HTMLElement,
    private readonly host: BrowserHost,
    gameUrl: string,
  ) {
    this.cdBackend = new HtmlCdBackend(`${gameUrl}MUSIC.mp3`);
    this.system = createSystem({
      host,
      soundBackend: this.soundBackend,
      cdBackend: this.cdBackend,
      store: new LocalStorageStore(),
      peekFile: (name) => host.peek(name),
    });
    this.game = new Game(host, this.system.sys);
    this.presenter = new CanvasPresenter(this.canvas, this.system.gfx, host.input);
    this.prefs = new AudioPrefs(new LocalStorageStore(), [this.soundBackend, this.cdBackend]);
    this.soundButton = this.soundToggle();
    const footer = h(
      "div",
      { class: "lit-footer" },
      h("a", { class: "back-link", href: "#/" }, shared.backToGames),
      h("div", { class: "lit-toggles" }, this.soundButton),
    );
    container.replaceChildren(h("main", { class: "lit" }, this.stage, footer));
    this.bindInput();
    this.bindLifecycle();
    if (import.meta.env.DEV) {
      Object.assign(window, { __lit: { game: this.game, host, ...this.system } });
    }
  }

  private soundToggle(): HTMLButtonElement {
    const button = h("button", { type: "button", class: "toggle", "aria-pressed": String(this.prefs.isEnabled()) }, copy.sound);
    button.addEventListener("click", () => {
      button.setAttribute("aria-pressed", String(this.prefs.toggle()));
      this.unlockAudio();
    });
    return button;
  }

  /**
   * Onglet masqué : le jeu s'arrête (horloge, audio CD et effets) et repart au même point au retour,
   * pour que la musique et les scripts restent synchronisés. Autre onglet : la préférence de son suit.
   */
  private bindLifecycle(): void {
    const sync = (): void => {
      const hidden = document.hidden;
      this.host.setPaused(hidden);
      if (hidden) {
        this.cdBackend.suspend();
        this.soundBackend.suspend();
      } else {
        this.cdBackend.resume();
        this.soundBackend.resume();
      }
    };
    document.addEventListener("visibilitychange", sync);
    if (document.hidden) sync();
    window.addEventListener("storage", () => {
      if (this.prefs.reload()) this.soundButton.setAttribute("aria-pressed", String(this.prefs.isEnabled()));
    });
  }

  /** Lance la boucle d'affichage et le jeu (INTRO.TOT) ; les erreurs s'affichent à la place de l'écran. */
  run(): void {
    // run() part du clic « Jouer » : c'est le geste qui débloque le contexte audio
    this.unlockAudio();
    const frame = (): void => {
      this.presenter.present();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    this.canvas.focus();
    this.game.start().then(
      () => this.showOverlay(copy.ended, true),
      (e) => {
        console.error(e);
        this.showOverlay(`${copy.runtimeError} ${e instanceof Error ? e.message : e}`, true);
      },
    );
  }

  private showOverlay(message: string, replay: boolean): void {
    this.stage.append(
      h(
        "div",
        { class: "lit-overlay", role: "alert" },
        h("p", {}, message),
        replay && h("button", { type: "button", class: "primary", onclick: () => location.reload() }, copy.replay),
      ),
    );
  }

  /** L'audio ne démarre qu'après un geste de l'utilisateur (politique d'autoplay des navigateurs). */
  private unlockAudio(): void {
    this.soundBackend.unlock();
    this.cdBackend.unlock();
  }

  /** Position du pointeur dans l'écran du jeu (320x200, ou 640x400 pour l'écran-titre). */
  private movePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const { screenWidth: w, screenHeight: height } = this.system.gfx.core;
    this.host.input.pointerMove(((e.clientX - rect.left) * w) / rect.width, ((e.clientY - rect.top) * height) / rect.height, w, height);
  }

  private bindInput(): void {
    const canvas = this.canvas;
    const input = this.host.input;
    canvas.addEventListener("pointermove", (e) => this.movePointer(e));
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      this.unlockAudio();
      this.movePointer(e);
      input.pointerDown(e.button);
    });
    const release = (e: PointerEvent): void => {
      this.movePointer(e);
      input.pointerUp(e.button);
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    // Le clic droit est un bouton du jeu.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("keydown", (e) => {
      this.unlockAudio();
      if (input.keyDown(e)) e.preventDefault();
    });
  }
}
