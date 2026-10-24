import { WebAudioSink } from "../audio/web-sink";
import type { GameFiles } from "../data/files";
import type { Frame } from "../engine/graphics/frame";
import type { CursorKind, Host, HostStorage } from "../engine/host";
import { Input, mouseButtonFromDom } from "../engine/input";
import {
  CanvasPresenter,
  PLAY_ORIGIN_X,
  PLAY_ORIGIN_Y,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from "../render/canvas-presenter";

/** Accès à localStorage : indisponible ou plein, on échoue sans bruit (même principe que l'hôte du Téléportaschtroumpf). */
export const localStorageStore: HostStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // stockage bloqué : rien à effacer
    }
  },
};

/** Un fichier du jeu manque (`files.json` absent, ressource en 404) : le jeu n'est pas installé, ce n'est pas un bogue d'exécution. */
export class MissingFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingFilesError";
  }
}

/** Valeur CSS `cursor` de chaque curseur du moteur. Remplaçable par `setCursorStyle` (bitmaps `CURS` de `MILKYWAY.DAT`). */
const DEFAULT_CURSORS: Readonly<Record<CursorKind, string>> = {
  arrow: "default",
  busy: "progress",
  help: "help",
  hidden: "none",
};

/** Ce qu'il faut savoir d'un `KeyboardEvent` pour décider de son sort (sous-ensemble, pour tester sans DOM). */
export type KeyInfo = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
> & { isComposing?: boolean; altGraph?: boolean };

/**
 * Modificateurs vus par le jeu. AltGr (Ctrl+Alt sous Windows, `getModifierState("AltGraph")`) sert à taper des caractères (@, €, #…) :
 * ce n'est ni Ctrl ni Alt, sinon le jeu prendrait « @ » pour un raccourci.
 */
export function gameModifiers(event: KeyInfo): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
} {
  return {
    ctrl: event.ctrlKey && !event.altGraph,
    alt: event.altKey && !event.altGraph,
    shift: event.shiftKey,
  };
}

/**
 * Touches que le jeu ne lit pas au clavier : le texte composé (accents morts « ^ » puis « e », IME, clavier virtuel) arrive par le champ
 * invisible (`text-input.ts`, événements `compositionend` / `beforeinput`), qui est l'unique source ; lire aussi la touche physique
 * l'insérerait deux fois.
 */
export function isComposedKey(event: Pick<KeyInfo, "key" | "isComposing">): boolean {
  return (
    event.isComposing === true ||
    event.key === "Dead" ||
    event.key === "Process" ||
    event.key === "Unidentified"
  );
}

/**
 * Touches dont le navigateur ne doit pas faire son action quand le canvas a le focus (défilement par Espace et flèches, retour
 * arrière, recherche rapide des caractères imprimables, Tab…). Le jeu possède Tab et Maj+Tab (focus des boutons, outils de l'Atelier
 * du rythme) : le navigateur ne doit pas déplacer le focus DOM vers le bouton Son ou le lien de retour. La sortie au clavier est
 * Échap, qui rend le focus au navigateur (`BrowserHost.bindKeyboard`). F5, F12 et les autres touches de fonction restent au navigateur.
 */
export function gameOwnsKey(
  event: Pick<KeyInfo, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "altGraph">,
): boolean {
  if (event.metaKey) return false;
  const altGraph = event.altGraph === true;
  // Seuls Ctrl+Q (sortie) et Ctrl+V (« À propos ») sont au jeu ; Ctrl+R, Ctrl+W, Ctrl+C… restent au navigateur.
  if (event.ctrlKey && !altGraph) return event.code === "KeyQ" || event.code === "KeyV";
  if (event.altKey && !altGraph) return false;
  if (event.key.length === 1) return true;
  return (
    event.code === "Space" ||
    event.code === "Tab" ||
    event.code === "Enter" ||
    event.code === "NumpadEnter" ||
    event.code === "Escape" ||
    event.code === "Backspace" ||
    event.code === "F1" ||
    event.code.startsWith("Arrow")
  );
}

/**
 * Le canvas perd le focus au profit de `related` : si c'est un autre récepteur clavier du jeu (le champ invisible, qui prend le focus au
 * `pointerup`), rien n'est relâché ; sinon un `reset` jetterait le relâchement du clic en file et les boutons resteraient « enfoncés ».
 */
export function keepsInputOnBlur(
  related: EventTarget | null,
  keyTargets: ReadonlySet<EventTarget>,
): boolean {
  return related !== null && keyTargets.has(related);
}

/**
 * Coordonnées d'un point de l'écran dans la zone de jeu (576×432) : le canvas fait 640×480 logiques (zone de jeu centrée dans une
 * bordure noire) et s'affiche à la taille CSS `width × height`. Peut sortir de la zone (négatif ou au-delà).
 */
export function toPlayArea(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) * SCREEN_WIDTH) / rect.width - PLAY_ORIGIN_X,
    y: ((clientY - rect.top) * SCREEN_HEIGHT) / rect.height - PLAY_ORIGIN_Y,
  };
}

/** Durée d'un appui long du doigt (ms) et déplacement toléré (pixels CSS) : comme Lost in Time. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 10;

/** Suivi d'un doigt posé : appelle `onLongPress` s'il reste en place 500 ms. */
class TouchPress {
  readonly id: number;
  private readonly startX: number;
  private readonly startY: number;
  private timer: ReturnType<typeof setTimeout> | null;

  constructor(
    event: PointerEvent,
    onLongPress: (clientX: number, clientY: number) => void,
  ) {
    this.id = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.timer = setTimeout(() => {
      this.timer = null;
      onLongPress(this.startX, this.startY);
    }, LONG_PRESS_MS);
  }

  move(event: PointerEvent): void {
    if (
      this.timer !== null &&
      Math.hypot(event.clientX - this.startX, event.clientY - this.startY) >
        LONG_PRESS_SLOP
    )
      this.stop();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Hôte du navigateur : fichiers par `fetch` (le cache HTTP du navigateur fait le reste ; les archives décodées sont gardées par
 * `Resources`), canvas 640×480 (`CanvasPresenter`), Web Audio + soundfont, clavier et souris du canvas.
 */
export class BrowserHost implements Host {
  readonly input = new Input();
  readonly audio: WebAudioSink;
  readonly storage = localStorageStore;
  private readonly presenter: CanvasPresenter;
  private readonly cursors: Record<CursorKind, string> = { ...DEFAULT_CURSORS };
  private cursor: CursorKind = "arrow";
  private presented = false;
  private touch: TouchPress | null = null;
  /** Éléments qui reçoivent le clavier du jeu (le canvas et le champ invisible). */
  private readonly keyTargets = new Set<EventTarget>();
  /** Appui long d'un doigt (position dans la zone de jeu) : l'équivalent tactile de Ctrl + clic. */
  onLongPress: ((x: number, y: number) => void) | null = null;

  /**
   * `base` : URL du dossier des fichiers du jeu, sans barre finale (ex. `./mathemagique`).
   * `onExit` : ce que fait `exit()` une fois le son coupé (retour à l'accueil, redémarrage…).
   */
  constructor(
    private readonly base: string,
    private readonly files: GameFiles,
    private readonly canvas: HTMLCanvasElement,
    private readonly onExit: () => void,
    audio: WebAudioSink = new WebAudioSink(),
  ) {
    this.audio = audio;
    this.presenter = new CanvasPresenter(canvas);
    this.setCursor("arrow");
    this.bindInput();
  }

  async loadFile(name: string): Promise<Uint8Array> {
    const path = this.files.resolve(name);
    if (!path) throw new MissingFilesError(`fichier introuvable : ${name}`);
    const url = `${this.base}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url);
    if (response.status === 404)
      throw new MissingFilesError(`${path} : HTTP 404`);
    if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  now(): number {
    return performance.now();
  }

  unixMillis(): number {
    return Date.now();
  }

  present(frame: Frame): void {
    this.presenter.present(frame);
    // Première image affichée : le jeu est lancé, on peut charger la soundfont (18 Mo) sans retarder le premier écran.
    if (!this.presented) {
      this.presented = true;
      this.audio.startMidiLoading();
    }
  }

  setCursor(cursor: CursorKind): void {
    this.cursor = cursor;
    this.canvas.style.cursor = this.cursors[cursor];
  }

  /**
   * Remplace l'apparence d'un curseur par une valeur CSS `cursor` (ex. `url(blob:…) 0 0, progress`) : crochet pour les bitmaps `CURS`
   * de `MILKYWAY.DAT` (`loadCursorImages` + `cssCursor`). Prend effet tout de suite si c'est le curseur affiché.
   */
  setCursorStyle(cursor: CursorKind, css: string): void {
    this.cursors[cursor] = css;
    if (cursor === this.cursor) this.canvas.style.cursor = css;
  }

  /** Coupe le son (musique et bruitages) : à appeler quand la page du jeu est quittée. */
  silence(): void {
    this.audio.midi.reset();
    this.audio.suspend();
  }

  /** Libère la sortie audio (contexte fermé) : à appeler une fois, quand la page du jeu est quittée. */
  close(): void {
    this.audio.close();
  }

  exit(): void {
    this.silence();
    this.onExit();
  }

  private longPress(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const { x, y } = toPlayArea(clientX, clientY, rect);
    this.onLongPress?.(x, y);
  }

  /** Position du pointeur dans la zone de jeu (576×432). */
  private pointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const { x, y } = toPlayArea(event.clientX, event.clientY, rect);
    this.input.moveMouse(x, y);
  }

  /** Branche clavier et souris du canvas sur `input` ; le son se débloque au premier geste. */
  private bindInput(): void {
    const { canvas, input, audio } = this;
    canvas.addEventListener("pointermove", (event) => {
      if (this.touch?.id === event.pointerId) this.touch.move(event);
      this.pointer(event);
    });
    // Glisser une pièce au doigt ne fait pas défiler la page (en plus de `touch-action: none`, pour les navigateurs qui l'ignorent).
    canvas.addEventListener("touchmove", (event) => event.preventDefault(), {
      passive: false,
    });
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (event.pointerType === "touch" && event.isPrimary)
        this.touch = new TouchPress(event, (x, y) => this.longPress(x, y));
      canvas.focus();
      audio.unlock();
      const button = mouseButtonFromDom(event.button);
      if (!button) return;
      canvas.setPointerCapture(event.pointerId);
      this.pointer(event);
      input.mouseDown(button, {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      });
    });
    const release = (event: PointerEvent): void => {
      if (this.touch?.id === event.pointerId) {
        this.touch.stop();
        this.touch = null;
      }
      const button = mouseButtonFromDom(event.button);
      if (!button) return;
      this.pointer(event);
      input.mouseUp(button, {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      });
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    // Le clic droit est un bouton du jeu.
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.bindKeyboard(canvas);
    // Perdre le focus relâche tout : sinon une touche tenue au moment du clic ailleurs resterait enfoncée.
    canvas.addEventListener("blur", (event) => {
      if (!keepsInputOnBlur(event.relatedTarget, this.keyTargets)) input.reset();
    });
  }

  /**
   * Branche le clavier de `target` sur `input`. Le canvas l'est de base ; le champ invisible du clavier virtuel (`text-input.ts`) l'est
   * aussi, parce que le focus y va pendant la saisie du nom : les touches d'un clavier physique doivent y arriver au jeu quand même.
   */
  bindKeyboard(target: HTMLElement): void {
    const { input, audio } = this;
    this.keyTargets.add(target);
    const info = (event: KeyboardEvent): KeyInfo => ({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isComposing: event.isComposing,
      altGraph: event.getModifierState("AltGraph"),
    });
    target.addEventListener("keydown", (event) => {
      audio.unlock();
      // Raccourcis du système (Cmd sur Mac) : jamais au jeu.
      if (event.metaKey) return;
      const key = info(event);
      // Texte composé : il arrive par le champ invisible, pas par la touche physique.
      if (isComposedKey(key)) return;
      const mods = gameModifiers(key);
      // Maj+Échap est la sortie au clavier (le jeu possède Tab) : le canvas rend le focus au navigateur. Échap seul reste au jeu
      // (code 27 du moniteur et du hub).
      if (event.key === "Escape" && event.shiftKey && target === this.canvas) {
        event.preventDefault();
        this.canvas.blur();
        return;
      }
      input.keyDown({
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        ...mods,
      });
      if (gameOwnsKey(key)) event.preventDefault();
    });
    target.addEventListener("keyup", (event) => {
      const key = info(event);
      input.keyUp(event.code, gameModifiers(key));
      if (gameOwnsKey(key)) event.preventDefault();
    });
    // Le focus passe à un autre récepteur du jeu (canvas ↔ champ invisible) : on ne relâche rien.
    if (target !== this.canvas)
      target.addEventListener("blur", (event) => {
        if (!keepsInputOnBlur(event.relatedTarget, this.keyTargets)) input.reset();
      });
  }
}
