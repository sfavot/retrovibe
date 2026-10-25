import "./style.css";
import { HtmlCdBackend } from "../engine/audio/html-cd";
import { WebAudioSoundBackend } from "../engine/audio/web-audio";
import { AudioPrefs } from "../engine/audio/prefs";
import { Game } from "../engine/game";
import { KEY_ESCAPE, KEY_RETURN, textEditKeys, translateKey } from "../engine/input";
import { LocalStorageStore } from "../engine/saves";
import { createSystem, type System } from "../engine/system";
import { CanvasPresenter } from "../render/canvas";
import { copy } from "../copy";
import { copy as shared } from "../../../ui/copy";
import { mountGameShell, type GameShell } from "../../../ui/game-shell";
import { h } from "../../../ui/dom";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";
import type { BrowserHost } from "./browser-host";

/**
 * Contenu permanent du champ caché de saisie : il reste toujours un caractère à effacer, sinon le
 * clavier virtuel n'émet rien pour un retour arrière dans un champ vide.
 */
const TEXT_SENTINEL = " ";

/** Interface du jeu : un canvas mis à l'échelle (4:3), les entrées du navigateur, l'audio et l'état de fin / d'erreur. */
export class App {
  /** Champ invisible qui reçoit le clavier virtuel pendant une saisie (un canvas ne l'ouvre pas). */
  private readonly textField = h("input", {
    class: "lit-text-field",
    type: "text",
    tabindex: -1,
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    "aria-labelledby": "lit-keyboard",
  });
  private readonly shell: GameShell;
  private readonly soundBackend = new WebAudioSoundBackend();
  private readonly cdBackend: HtmlCdBackend;
  private readonly system: System;
  private readonly game: Game;
  private readonly presenter: CanvasPresenter;
  private readonly prefs: AudioPrefs;
  private readonly menuButton: HTMLButtonElement;
  private readonly inventoryButton: HTMLButtonElement;
  private readonly keyboardButton: HTMLButtonElement;
  private readonly confirmButton: HTMLButtonElement;
  private textEntry = false;

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
    this.prefs = new AudioPrefs(new LocalStorageStore(), [this.soundBackend, this.cdBackend]);
    // la zone qui affiche la barre du haut ne couvre que ses deux premières lignes : trop fine pour un doigt
    this.menuButton = this.touchButton(copy.menu, () => this.movePointerToTop(), { "aria-label": copy.menuLabel });
    this.inventoryButton = this.touchButton(copy.inventory, () => host.input.click(2), { "aria-label": copy.inventoryLabel });
    this.keyboardButton = this.touchButton(copy.keyboard, () => this.textField.focus({ preventScroll: true }), { id: "lit-keyboard", hidden: true });
    this.confirmButton = this.touchButton(copy.confirm, () => host.input.pressKey(KEY_RETURN), { hidden: true });
    // deux groupes : en paysage tactile, l'un à gauche de l'écran, l'autre à droite (sous les pouces) ; ailleurs, une seule rangée
    const touchBar = h(
      "div",
      { class: "touch-bar lit-touch-bar" },
      h(
        "div",
        { class: "lit-touch-group" },
        this.menuButton,
        this.touchButton(copy.skip, () => host.input.pressKey(KEY_ESCAPE), { "aria-label": copy.skipLabel }),
        this.keyboardButton,
      ),
      h("div", { class: "lit-touch-group" }, this.inventoryButton, this.confirmButton),
    );
    this.shell = mountGameShell({
      container,
      logicalWidth: 320,
      logicalHeight: 200,
      fit: "css",
      copy: { canvasLabel: copy.canvasLabel, sound: copy.sound },
      backLabel: shared.backToGames,
      classes: { stage: "lit-stage", canvas: "lit-canvas", footer: "lit-footer" },
      stageChildren: [this.textField],
      afterStage: [touchBar],
    });
    this.presenter = new CanvasPresenter(this.canvas, this.system.gfx, host.input);
    this.bindInput();
    this.bindTextField();
    if (import.meta.env.DEV) {
      Object.assign(window, { __lit: { game: this.game, host, ...this.system } });
    }
  }

  private get canvas(): HTMLCanvasElement {
    return this.shell.canvas;
  }

  /**
   * Bouton de la barre tactile. Il ne prend pas le focus au toucher ou au clic (le clavier physique
   * et le clavier virtuel restent sur le jeu ou le champ de saisie) ; au clavier, il le garde.
   */
  private touchButton(label: string, action: () => void, props: Record<string, string | boolean> = {}): HTMLButtonElement {
    const button = h("button", { type: "button", ...props }, label);
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => {
      this.unlockAudio();
      action();
      if (e.detail > 0 && document.activeElement !== this.textField) this.canvas.focus({ preventScroll: true });
    });
    return button;
  }

  /**
   * Lance la page, la boucle d'affichage et le jeu (INTRO.TOT) ; les erreurs s'affichent à la place de l'écran.
   * Onglet masqué : le jeu s'arrête (horloge, audio CD et effets) et repart au même point au retour,
   * pour que la musique et les scripts restent synchronisés. Autre onglet : la préférence de son suit.
   */
  run(): void {
    // run() part du clic « Jouer » : c'est le geste qui débloque le contexte audio
    this.unlockAudio();
    this.shell.start({
      sound: { prefs: this.prefs, unlock: () => this.unlockAudio() },
      onPause: (hidden) => {
        this.host.setPaused(hidden);
        if (hidden) {
          this.cdBackend.suspend();
          this.soundBackend.suspend();
        } else {
          this.cdBackend.resume();
          this.soundBackend.resume();
        }
      },
      onDispose: () => {
        this.cdBackend.suspend();
        this.soundBackend.suspend();
      },
      onFrame: () => {
        this.presenter.present();
        this.syncTextEntry();
      },
    });
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
    this.shell.showOverlay(message, replay ? { label: copy.replay, onClick: () => location.reload() } : undefined);
  }

  /** L'audio ne démarre qu'après un geste de l'utilisateur (politique d'autoplay des navigateurs). */
  private unlockAudio(): void {
    this.soundBackend.unlock();
    this.cdBackend.unlock();
  }

  /** Taille logique de l'écran du jeu (320x200, ou 640x400 pour l'écran-titre). */
  private screenSize(): { width: number; height: number } {
    const { screenWidth, screenHeight } = this.system.gfx.core;
    return { width: screenWidth, height: screenHeight };
  }

  /** Curseur au bord haut de l'écran du jeu, sans clic : le jeu affiche sa barre du haut. */
  private movePointerToTop(): void {
    const input = this.host.input;
    const { screenWidth, screenHeight } = this.system.gfx.core;
    input.pointerMove(input.mouseX, 0, screenWidth, screenHeight);
  }

  /** Souris et stylet : boutons tenus tels quels. Doigt : gestes de TouchPress (toucher, appui long, glissement). */
  private bindInput(): void {
    const input = this.host.input;
    const move = (x: number, y: number): void => {
      const { width, height } = this.screenSize();
      input.pointerMove(x, y, width, height);
    };
    bindCanvasPointer(
      this.canvas,
      () => this.screenSize(),
      {
        move,
        down: (button, x, y) => {
          move(x, y);
          input.pointerDown(button);
        },
        up: (button, x, y) => {
          move(x, y);
          input.pointerUp(button);
        },
        tap: (button) => {
          if (button === 2) navigator.vibrate?.(15);
          input.click(button);
        },
      },
      { onGesture: () => this.unlockAudio() },
    );
    bindKeyboard(this.canvas, { keyDown: (e) => input.keyDown(e) }, () => this.unlockAudio());
  }

  /**
   * Champ caché de saisie : les frappes du clavier virtuel arrivent par l'événement `input` (sur
   * Android, keydown ne donne que « Unidentified ») ; chaque changement du texte est traduit en codes
   * du jeu, puis le champ reprend son contenu permanent. Pendant une composition (saisie prédictive,
   * accents), le texte suit sans être remis à zéro, ce qui casserait la composition. Les touches sans
   * caractère (Entrée, flèches, Échap) passent par keydown, comme pour le canvas.
   */
  private bindTextField(): void {
    const field = this.textField;
    const input = this.host.input;
    let last = TEXT_SENTINEL;
    const reset = (): void => {
      field.value = last = TEXT_SENTINEL;
      field.setSelectionRange(TEXT_SENTINEL.length, TEXT_SENTINEL.length);
    };
    const sync = (composing: boolean): void => {
      for (const key of textEditKeys(last, field.value)) input.pressKey(key);
      last = field.value;
      if (!composing) reset();
    };
    reset();
    field.addEventListener("focus", reset);
    field.addEventListener("input", (e) => sync((e as InputEvent).isComposing));
    field.addEventListener("compositionend", () => sync(false));
    field.addEventListener("keydown", (e) => {
      if (e.isComposing || e.key.length === 1 || e.key === "Backspace" || e.key === "Unidentified") return;
      this.unlockAudio();
      // les claviers virtuels laissent souvent `code` vide : on se rabat sur `key` (Enter, ArrowLeft…)
      const key = translateKey(e) || translateKey({ code: e.key, key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
      if (input.pressKey(key)) e.preventDefault();
    });
  }

  /** Suit le moteur à chaque image : pendant une saisie, la barre tactile propose Clavier et Valider. */
  private syncTextEntry(): void {
    const active = this.system.hotspots.textEntry;
    if (active === this.textEntry) return;
    this.textEntry = active;
    // pendant la saisie, Menu et Inventaire laissent la place à Clavier et Valider
    this.menuButton.hidden = active;
    this.inventoryButton.hidden = active;
    this.keyboardButton.hidden = !active;
    this.confirmButton.hidden = !active;
    if (!active && document.activeElement === this.textField) {
      // fin de la saisie : le clavier virtuel se ferme, le clavier physique revient au jeu
      this.textField.blur();
      this.canvas.focus({ preventScroll: true });
    }
  }
}
