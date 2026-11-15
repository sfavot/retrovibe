import "./style.css";
import type { Mutable } from "../../engine/coktel/audio/backend";
import { WebAudioSoundBackend } from "../../engine/coktel/audio/web-audio";
import type { Game, RandomSource } from "../../engine/coktel/game";
import { KEY_ESCAPE, KEY_RETURN, textEditKeys, translateKey } from "../../engine/coktel/input";
import { CanvasPresenter } from "../../engine/coktel/render/canvas";
import type { System } from "../../engine/coktel/system";
import { randomSeed, scummvmRandom } from "../../engine/rng";
import { copy as shared } from "../copy";
import { h } from "../dom";
import { mountGameShell, type GameShell, type ShellSoundPrefs } from "../game-shell";
import { bindCanvasPointer, bindKeyboard } from "../pointer";
import { BrowserHost, type RemoteGameFiles } from "./browser-host";

/**
 * Contenu permanent du champ caché de saisie : il reste toujours un caractère à effacer, sinon le
 * clavier virtuel n'émet rien pour un retour arrière dans un champ vide.
 */
const TEXT_SENTINEL = " ";

/** Textes de la page du jeu (dans le `copy.ts` du jeu). */
export interface CoktelAppCopy {
  canvasLabel: string;
  sound: string;
  ended: string;
  replay: string;
  runtimeError: string;
  menu: string;
  menuLabel: string;
  skip: string;
  skipLabel: string;
  keyboard: string;
  confirm: string;
  /** Bouton « clic droit » de la barre tactile (sans lui, seul l'appui long fait un clic droit). */
  inventory?: string;
  inventoryLabel?: string;
}

/** Sortie audio d'un jeu en plus des effets (piste CD de Lost in Time) : coupée, débloquée et suspendue avec eux. */
export interface CoktelAudioOutput extends Mutable {
  unlock(): void;
  suspend(): void;
  resume(): void;
}

/** Ce que le jeu construit au lancement : sous-systèmes, partie et sorties audio en plus des effets. */
export interface CoktelSession {
  system: System;
  game: Game;
  outputs?: CoktelAudioOutput[];
}

/** Ce dont dispose le jeu pour construire sa partie. */
export interface CoktelEnvironment {
  host: BrowserHost;
  soundBackend: WebAudioSoundBackend;
  /** Hasard des scripts : graine tirée au lancement (les tests en fixent une). */
  random: RandomSource;
}

/** Paramètres d'un jeu du moteur Coktel dans l'interface commune. */
export interface CoktelAppOptions {
  /** Nom de l'objet exposé en développement (`window.__<debugName>` : jeu, hôte, sous-systèmes). */
  debugName: string;
  copy: CoktelAppCopy;
  create(env: CoktelEnvironment): CoktelSession;
  /** Préférence « Son » appliquée à toutes les sorties ; `storageKey` : clé suivie entre onglets (sans clé, tout changement). */
  soundPrefs(targets: readonly Mutable[]): ShellSoundPrefs;
  soundStorageKey?: string;
  /**
   * Fin du jeu (le script s'est terminé : « Quitter » du jeu, TOT absent) : le jeu reprend la main (retour à son écran titre…) ;
   * sans elle, un voile « partie terminée » propose de rejouer.
   */
  onEnded?(game: Game): void;
}

/**
 * Interface des jeux du moteur Coktel (Lost in Time, Ween) : un canvas mis à l'échelle (4:3), les entrées du navigateur
 * (souris, doigt, clavier physique et virtuel), l'audio et l'état de fin / d'erreur, sur `src/ui/game-shell`.
 */
export class CoktelApp {
  /** Champ invisible qui reçoit le clavier virtuel pendant une saisie (un canvas ne l'ouvre pas). */
  private readonly textField = h("input", {
    class: "coktel-text-field",
    type: "text",
    tabindex: -1,
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    "aria-labelledby": "coktel-keyboard",
  });
  private readonly shell: GameShell;
  private readonly soundBackend = new WebAudioSoundBackend();
  private readonly outputs: CoktelAudioOutput[];
  private readonly system: System;
  private readonly game: Game;
  private readonly presenter: CanvasPresenter;
  private readonly prefs: ShellSoundPrefs;
  private readonly menuButton: HTMLButtonElement;
  private readonly inventoryButton: HTMLButtonElement | null;
  private readonly keyboardButton: HTMLButtonElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly host: BrowserHost;
  private textEntry = false;

  /** `files` : fichiers du jeu, partagés par les parties successives de la page ; chaque partie a son hôte (horloge, entrées). */
  constructor(
    container: HTMLElement,
    files: RemoteGameFiles,
    private readonly options: CoktelAppOptions,
  ) {
    const { copy } = options;
    const host = (this.host = new BrowserHost(files));
    const session = options.create({ host, soundBackend: this.soundBackend, random: scummvmRandom(randomSeed()) });
    this.system = session.system;
    this.game = session.game;
    this.outputs = [this.soundBackend, ...(session.outputs ?? [])];
    this.prefs = options.soundPrefs(this.outputs);
    // la zone qui affiche la barre du haut ne couvre que ses deux premières lignes : trop fine pour un doigt
    this.menuButton = this.touchButton(copy.menu, () => this.movePointerToTop(), { "aria-label": copy.menuLabel });
    this.inventoryButton = copy.inventory
      ? this.touchButton(copy.inventory, () => host.input.click(2), copy.inventoryLabel ? { "aria-label": copy.inventoryLabel } : {})
      : null;
    this.keyboardButton = this.touchButton(copy.keyboard, () => this.textField.focus({ preventScroll: true }), { id: "coktel-keyboard", hidden: true });
    this.confirmButton = this.touchButton(copy.confirm, () => host.input.pressKey(KEY_RETURN), { hidden: true });
    // deux groupes : en paysage tactile, l'un à gauche de l'écran, l'autre à droite (sous les pouces) ; ailleurs, une seule rangée
    const touchBar = h(
      "div",
      { class: "touch-bar coktel-touch-bar" },
      h(
        "div",
        { class: "coktel-touch-group" },
        this.menuButton,
        this.touchButton(copy.skip, () => host.input.pressKey(KEY_ESCAPE), { "aria-label": copy.skipLabel }),
        this.keyboardButton,
      ),
      h("div", { class: "coktel-touch-group" }, ...(this.inventoryButton ? [this.inventoryButton] : []), this.confirmButton),
    );
    this.shell = mountGameShell({
      container,
      logicalWidth: 320,
      logicalHeight: 200,
      fit: "css",
      copy: { canvasLabel: copy.canvasLabel, sound: copy.sound },
      backLabel: shared.backToGames,
      classes: { stage: "coktel-stage", canvas: "coktel-canvas", footer: "coktel-footer" },
      stageChildren: [this.textField],
      afterStage: [touchBar],
    });
    this.presenter = new CanvasPresenter(this.canvas, this.system.gfx, host.input);
    this.bindInput();
    this.bindTextField();
    if (import.meta.env.DEV) {
      Object.assign(window, { [`__${options.debugName}`]: { game: this.game, host, ...this.system } });
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
   * Lance la page, la boucle d'affichage et le jeu ; les erreurs s'affichent à la place de l'écran.
   * Onglet masqué : le jeu s'arrête (horloge, audio) et repart au même point au retour, pour que la
   * musique et les scripts restent synchronisés. Autre onglet : la préférence de son suit.
   * Page quittée : le jeu s'arrête pour de bon et l'audio est libéré.
   */
  run(): void {
    // run() part du clic « Jouer » : c'est le geste qui débloque le contexte audio
    this.unlockAudio();
    this.shell.start({
      sound: { prefs: this.prefs, storageKey: this.options.soundStorageKey, unlock: () => this.unlockAudio() },
      onPause: (hidden) => {
        this.host.setPaused(hidden);
        for (const output of this.outputs) {
          if (hidden) output.suspend();
          else output.resume();
        }
      },
      onDispose: () => {
        this.host.halt();
        for (const output of this.outputs) output.suspend();
        this.soundBackend.close();
      },
      onFrame: () => {
        this.presenter.present();
        this.syncTextEntry();
      },
    });
    this.canvas.focus();
    this.game.start().then(
      () => {
        if (this.options.onEnded) this.options.onEnded(this.game);
        else this.showOverlay(this.options.copy.ended, true);
      },
      (e) => {
        console.error(e);
        this.showOverlay(`${this.options.copy.runtimeError} ${e instanceof Error ? e.message : e}`, true);
      },
    );
  }

  private showOverlay(message: string, replay: boolean): void {
    this.shell.showOverlay(message, replay ? { label: this.options.copy.replay, onClick: () => location.reload() } : undefined);
  }

  /** L'audio ne démarre qu'après un geste de l'utilisateur (politique d'autoplay des navigateurs). */
  private unlockAudio(): void {
    for (const output of this.outputs) output.unlock();
  }

  /** Taille logique de l'écran du jeu (320x200, ou 640x400 pour l'écran-titre de Lost in Time). */
  private screenSize(): { width: number; height: number } {
    const { screenWidth, screenHeight } = this.system.gfx.core;
    return { width: screenWidth, height: screenHeight };
  }

  /** Curseur au bord haut de l'écran du jeu, sans clic : le jeu affiche sa barre du haut. */
  private movePointerToTop(): void {
    const input = this.host.input;
    const { width, height } = this.screenSize();
    input.pointerMove(input.mouseX, 0, width, height);
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
    if (this.inventoryButton) this.inventoryButton.hidden = active;
    this.keyboardButton.hidden = !active;
    this.confirmButton.hidden = !active;
    if (!active && document.activeElement === this.textField) {
      // fin de la saisie : le clavier virtuel se ferme, le clavier physique revient au jeu
      this.textField.blur();
      this.canvas.focus({ preventScroll: true });
    }
  }
}
