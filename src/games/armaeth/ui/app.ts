import "./style.css";
import { baseName, fetchGameFiles } from "../../../data/game-files";
import { prefixedStorage } from "../../../engine/storage";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { leaveGame, mountGameShell } from "../../../ui/game-shell";
import { localStorageStore } from "../../../ui/local-storage";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { h } from "../../../ui/dom";
import { type IconName, withIcons } from "../../../ui/icons";
import { copy } from "../copy";
import { parseHelp } from "../data/tables";
import { parsePlainMessages } from "../data/text";
import { ArmaethEngine } from "../engine/engine";
import { BrowserHost } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH, mapKey } from "./input";
import { TickScheduler } from "./scheduler";
import { TEXT_SENTINEL, textFieldKeys } from "./touch";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./armaeth`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Expose `window.__armaeth` (`engine`, `host`) pour la console (page de dev). */
  debug?: boolean;
}

/** Identifiant du jeu : préférence « Son » (`retrovibe:armaeth:sound`) et préfixe des sauvegardes (`armaeth:`). */
const GAME_ID = "armaeth";
/** Préférence « Flèches tenues » (`"1"` = activée ; désactivée par défaut, comme le jeu d'origine). */
const HOLD_ARROWS_KEY = `retrovibe:${GAME_ID}:hold-arrows`;

/**
 * Sortie du jeu (`quit()`) : retour à l'accueil du site quand le jeu est monté depuis le site (lien de retour présent), sinon,
 * sur la page de dev, redémarrage du jeu.
 */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, options));
}

/**
 * Champ caché de saisie : les frappes du clavier virtuel arrivent par l'événement `input` (sur Android, keydown ne donne que
 * « Unidentified ») ; chaque changement du texte est traduit en touches du jeu (`textFieldKeys`), puis le champ reprend son contenu
 * permanent. Pendant une composition (saisie prédictive, accents), le texte suit sans être remis à zéro, ce qui casserait la
 * composition. Les touches sans caractère (Entrée, flèches, Échap) passent par keydown, comme pour le canvas.
 */
function bindTextField(field: HTMLInputElement, host: BrowserHost): void {
  let last = TEXT_SENTINEL;
  const reset = (): void => {
    field.value = last = TEXT_SENTINEL;
    field.setSelectionRange(TEXT_SENTINEL.length, TEXT_SENTINEL.length);
  };
  const sync = (composing: boolean): void => {
    for (const key of textFieldKeys(last, field.value)) host.pressKey(key);
    last = field.value;
    if (!composing) reset();
  };
  reset();
  field.addEventListener("focus", reset);
  field.addEventListener("input", (e) => sync((e as InputEvent).isComposing));
  field.addEventListener("compositionend", () => sync(false));
  field.addEventListener("keydown", (e) => {
    if (e.isComposing || e.key.length === 1 || e.key === "Backspace" || e.key === "Unidentified") return;
    host.unlock();
    // les claviers virtuels laissent souvent `code` vide : `mapKey` lit `key` (Enter, ArrowLeft...)
    const key = mapKey(e);
    if (key) {
      host.pressKey(key);
      e.preventDefault();
    }
  });
}

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : écran 320×200 à l'échelle entière, états de
 * chargement et d'erreur, bouton « Son », pause quand l'onglet est masqué. Le moteur tourne à 70 Hz (images VGA) sur les images de l'écran
 * (`TickScheduler`). Les erreurs de chargement et d'exécution remplacent l'écran par un message.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  let host: BrowserHost | undefined;
  const textField = h("input", {
    class: "aeth-text-field",
    type: "text",
    tabindex: -1,
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    "aria-label": copy.keyboardLabel,
  });
  /**
   * Bouton de la barre tactile. Il ne prend pas le focus au toucher ou au clic (le clavier virtuel reste sur le champ de saisie,
   * le clavier physique sur le jeu) ; au clavier, il le garde.
   */
  const touchButton = (
    label: string,
    ariaLabel: string,
    iconName: IconName,
    action: () => void,
    props: Record<string, string | boolean> = {},
  ): HTMLButtonElement => {
    const button = h("button", { type: "button", "aria-label": ariaLabel, ...props }, ...withIcons(label, iconName));
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => {
      host?.unlock();
      action();
      if (e.detail > 0 && document.activeElement !== textField) shell.canvas.focus({ preventScroll: true });
    });
    return button;
  };
  const key = (char: string) => (): void => host?.pressKey({ type: "char", char });
  const keyboardButton = touchButton(copy.keyboard, copy.keyboardLabel, "keyboard", () => textField.focus({ preventScroll: true }), {
    class: "aeth-idle-only",
  });
  const cancelButton = touchButton(copy.cancel, copy.cancelLabel, "undo", key("\x1b"), { hidden: true });
  const confirmButton = touchButton(copy.confirm, copy.confirmLabel, "enter", key("\r"), { hidden: true });
  const holdButton = touchButton(copy.hold, copy.holdLabel, "hand", () => host?.hold.toggle(), {
    "aria-pressed": "false",
    class: "aeth-idle-only",
  });
  // une seule rangée de boutons ; en paysage tactile, une colonne d'icônes à gauche de l'écran (`touch-bar--icons`)
  const touchBar = h(
    "div",
    { class: "touch-bar touch-bar--icons aeth-touch-bar" },
    h("div", { class: "aeth-touch-group" }, keyboardButton, cancelButton),
    h("div", { class: "aeth-touch-group" }, holdButton, confirmButton),
  );
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    copy,
    backLabel: options.backLabel,
    classes: { root: "aeth", stage: "aeth-stage", canvas: "aeth-canvas" },
    stageChildren: [textField],
    afterStage: [touchBar],
  });
  // En portrait, la barre a la largeur de l'écran du jeu (que le shell dimensionne).
  new ResizeObserver(() => touchBar.style.setProperty("--aeth-screen-width", `${shell.canvas.offsetWidth}px`)).observe(shell.canvas);
  const store = localStorageStore();

  let engine: ArmaethEngine;
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const manifest = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    // Le moteur lit les fichiers en synchrone : on les charge tous avant de le construire (2,8 Mo).
    const files = new Map(await Promise.all(manifest.entries.map(async ({ path }) => [baseName(path), await fetchBytes(options.base, path)] as const)));
    const created = new BrowserHost(files, shell.canvas, prefixedStorage(store, `${GAME_ID}:`), () => leave(container, options));
    // « Tenir » est un état de l'hôte : le bouton le pilote (le toucher du doigt le consomme).
    created.hold.onChange = (armed) => holdButton.setAttribute("aria-pressed", String(armed));
    host = created;
    // Débloque le son tant que l'activation du clic (« Jouer ») est valable.
    created.unlock();
    engine = new ArmaethEngine(created);
  } catch (error) {
    shell.fail(error, "load");
    return;
  }
  const game = host;
  let openHelp = (): void => {};
  if (options.debug) (window as unknown as { __armaeth: unknown }).__armaeth = { engine, host: game };

  bindTextField(textField, game);
  // Saisie ouverte : la barre propose aussi Échap et Entrée ; à sa fermeture, le clavier virtuel se ferme et le jeu reprend le clavier.
  let typing = false;
  const syncTyping = (): void => {
    const open = engine.inputLine.open;
    if (open === typing) return;
    typing = open;
    cancelButton.hidden = !open;
    confirmButton.hidden = !open;
    touchBar.classList.toggle("is-typing", open);
    if (!open && document.activeElement === textField) {
      textField.blur();
      shell.canvas.focus({ preventScroll: true });
    }
  };

  const scheduler = new TickScheduler();
  // Pause : onglet masqué ou aide ouverte par-dessus le jeu. Le son s'arrête et le jeu repart au même point (pas de rattrapage).
  let tabHidden = false;
  let helpView: HTMLElement | null = null;
  const applyPause = (): void => {
    const paused = tabHidden || helpView !== null;
    game.setPaused(paused);
    if (!paused) scheduler.resync();
  };
  const closeHelp = (): void => {
    helpView?.remove();
    helpView = null;
    shell.main.style.display = "";
    shell.stage.style.display = "";
    applyPause();
    shell.focusCanvas();
  };
  // Aide (indices de `SOS.EXE`) : même page que l'écran titre, par-dessus le jeu qui attend ; fichiers déjà en mémoire.
  openHelp = () => {
    if (helpView) return;
    try {
      helpView = h("div", { class: "aeth-help-overlay" }, renderHelp(parseHelp(game.readFile("A1FSOS.SYS")), parsePlainMessages(game.readFile("MSGUTL")), closeHelp, copy.helpResume));
    } catch (error) {
      console.error(error);
      shell.setError(`${copy.helpLoadError} ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (shell.main.classList.contains("is-fullscreen")) {
      // En plein écran, c'est `main` qui occupe l'écran : l'aide s'ouvre dedans, par-dessus l'écran du jeu masqué.
      helpView.classList.add("is-inside");
      shell.stage.style.display = "none";
      shell.main.append(helpView);
    } else {
      shell.main.style.display = "none";
      container.append(helpView);
    }
    applyPause();
  };
  const helpLink = h(
    "button",
    { type: "button", class: "toggle aeth-help-link", onclick: () => openHelp() },
    ...withIcons(copy.helpLink, "help"),
  );
  // Flèches tenues : clavier seulement (masqué sur écran tactile, où le héros marche au doigt).
  const holdArrowsButton = h(
    "button",
    { type: "button", class: "toggle aeth-keyboard-only", title: copy.holdArrowsTitle, "aria-pressed": "false" },
    copy.holdArrows,
  );
  const setHoldArrows = (on: boolean): void => {
    game.setHoldArrows(on);
    holdArrowsButton.setAttribute("aria-pressed", String(on));
  };
  setHoldArrows(store.get(HOLD_ARROWS_KEY) === "1");
  holdArrowsButton.addEventListener("click", (event) => {
    const on = holdArrowsButton.getAttribute("aria-pressed") !== "true";
    setHoldArrows(on);
    store.set(HOLD_ARROWS_KEY, on ? "1" : "0");
    // Clic souris (`detail` > 0) : le canvas reprend la main ; activation au clavier : le focus reste sur le bouton.
    if (event.detail > 0) shell.focusCanvas();
  });
  shell.toggles.append(holdArrowsButton, helpLink);

  shell.start({
    onPause: (hidden) => {
      tabHidden = hidden;
      applyPause();
    },
    sound: { prefs: new SoundPrefs(store, game.opl, GAME_ID), storageKey: soundPrefKey(GAME_ID), unlock: () => game.unlock() },
    onDispose: () => {
      game.close();
      game.opl.close();
      game.setPaused(true);
    },
    onFrame: (now) => {
      if (helpView) return;
      for (let ticks = scheduler.due(now); ticks > 0; ticks--) engine.tick();
      syncTyping();
    },
  });
}
