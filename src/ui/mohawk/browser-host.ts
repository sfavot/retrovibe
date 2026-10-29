import type { Frame } from "../../engine/mohawk/graphics/frame";
import type { MohawkHost } from "../../engine/mohawk/host";
import { Input, mouseButtonFromDom } from "../../engine/mohawk/input";
import { MissingFilesError, fetchBytes } from "../files";
import { localStorageStore } from "../local-storage";
import { bindCanvasPointer, bindKeyboard, toLogical } from "../pointer";
import { CanvasPresenter, type CanvasGeometry } from "./canvas-presenter";
import { WebAudioSink } from "./web-sink";

/** Ce que l'hôte demande à la liste des fichiers d'un jeu (`GameFiles` de chaque jeu) : le chemin réel d'un nom, sans tenir compte de la casse. */
export interface FileResolver {
  resolve(name: string): string | undefined;
}

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

/** Mathémagique : seuls Ctrl+Q (sortie) et Ctrl+V (« À propos ») sont au jeu ; Ctrl+R, Ctrl+W, Ctrl+C… restent au navigateur. */
export function mathCtrlKeys(event: Pick<KeyInfo, "code">): boolean {
  return event.code === "KeyQ" || event.code === "KeyV";
}

/**
 * Touches dont le navigateur ne doit pas faire son action quand le canvas a le focus (défilement par Espace et flèches, retour
 * arrière, recherche rapide des caractères imprimables, Tab…). Le jeu possède Tab et Maj+Tab (focus des boutons, outils de l'Atelier
 * du rythme) : le navigateur ne doit pas déplacer le focus DOM vers le bouton Son ou le lien de retour. La sortie au clavier est
 * Échap, qui rend le focus au navigateur (`BrowserHost.bindKeyboard`). F5, F12 et les autres touches de fonction restent au navigateur.
 */
export function gameOwnsKey(
  event: Pick<KeyInfo, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "altGraph">,
  ownsCtrlKey: (event: Pick<KeyInfo, "key" | "code">) => boolean = mathCtrlKeys,
): boolean {
  if (event.metaKey) return false;
  const altGraph = event.altGraph === true;
  if (event.ctrlKey && !altGraph) return ownsCtrlKey(event);
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
 * Coordonnées d'un point de l'écran dans la zone de jeu : le canvas fait `screenWidth × screenHeight` logiques (zone de jeu posée à
 * `(originX, originY)`, par exemple 576×432 au centre d'une bordure noire pour Mathémagique) et s'affiche à la taille CSS
 * `width × height`. Peut sortir de la zone (négatif ou au-delà).
 */
export function toPlayArea(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  geometry: CanvasGeometry,
): { x: number; y: number } {
  const { x, y } = toLogical(clientX, clientY, rect, { width: geometry.screenWidth, height: geometry.screenHeight });
  return { x: x - geometry.originX, y: y - geometry.originY };
}

export interface BrowserHostOptions<Cursor extends string> {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./mathemagique`). */
  base: string;
  /** Liste des fichiers du jeu (résolution insensible à la casse). */
  files: FileResolver;
  canvas: HTMLCanvasElement;
  /** Ce que fait `exit()` une fois le son coupé (retour à l'accueil, redémarrage…). */
  onExit: () => void;
  /** Taille logique du canvas et position de la zone de jeu. */
  geometry: CanvasGeometry;
  /** Valeur CSS `cursor` de chaque curseur du jeu ; remplaçable par `setCursorStyle`. */
  cursors: Readonly<Record<Cursor, string>>;
  /** Curseur affiché au départ. */
  defaultCursor: Cursor;
  /** URL de la soundfont réduite du jeu ; défaut : celle de `web-sink.ts`. Ignoré si `audio` est fourni. */
  soundfontUrl?: string;
  /** Sortie audio toute faite (tests, réglages particuliers) ; défaut : `WebAudioSink` sur `soundfontUrl`. */
  audio?: WebAudioSink;
  /** Combinaisons `Ctrl+touche` gardées par le jeu (action du navigateur empêchée) ; défaut : celles de Mathémagique. */
  ownsCtrlKey?: (event: Pick<KeyInfo, "key" | "code">) => boolean;
}

/**
 * Hôte du navigateur des jeux Mohawk : fichiers par `fetch` (le cache HTTP du navigateur fait le reste ; les archives décodées sont
 * gardées par `Resources`), canvas (`CanvasPresenter`), Web Audio + soundfont, clavier et souris du canvas. Les clés `localStorage`
 * (joueurs, préférences de son) sont celles des jeux, jamais de l'hôte.
 */
export class BrowserHost<Cursor extends string> implements MohawkHost<Cursor> {
  readonly input = new Input();
  readonly audio: WebAudioSink;
  readonly storage = localStorageStore();
  private readonly presenter: CanvasPresenter;
  private readonly cursors: Record<Cursor, string>;
  private readonly ownsCtrlKey: (event: Pick<KeyInfo, "key" | "code">) => boolean;
  private cursor: Cursor;
  private readonly base: string;
  private readonly files: FileResolver;
  private readonly canvas: HTMLCanvasElement;
  private readonly onExit: () => void;
  private readonly geometry: CanvasGeometry;
  private presented = false;
  /** Éléments qui reçoivent le clavier du jeu (le canvas et le champ invisible). */
  private readonly keyTargets = new Set<EventTarget>();
  /** Appui long d'un doigt (position dans la zone de jeu) : l'équivalent tactile de Ctrl + clic. */
  onLongPress: ((x: number, y: number) => void) | null = null;

  constructor(options: BrowserHostOptions<Cursor>) {
    this.base = options.base;
    this.files = options.files;
    this.canvas = options.canvas;
    this.onExit = options.onExit;
    this.geometry = options.geometry;
    this.cursors = { ...options.cursors };
    this.ownsCtrlKey = options.ownsCtrlKey ?? mathCtrlKeys;
    this.audio = options.audio ?? new WebAudioSink({ soundfontUrl: options.soundfontUrl });
    this.presenter = new CanvasPresenter(options.canvas, options.geometry);
    this.cursor = options.defaultCursor;
    this.setCursor(options.defaultCursor);
    this.bindInput();
  }

  async loadFile(name: string): Promise<Uint8Array> {
    const path = this.files.resolve(name);
    if (!path) throw new MissingFilesError(`fichier introuvable : ${name}`);
    return fetchBytes(this.base, path);
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

  setCursor(cursor: Cursor): void {
    this.cursor = cursor;
    this.canvas.style.cursor = this.cursors[cursor];
  }

  /**
   * Remplace l'apparence d'un curseur par une valeur CSS `cursor` (ex. `url(blob:…) 0 0, progress`) : crochet pour les bitmaps `CURS`
   * de `MILKYWAY.DAT` (`loadCursorImages` + `cssCursor`). Prend effet tout de suite si c'est le curseur affiché.
   */
  setCursorStyle(cursor: Cursor, css: string): void {
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

  /** Branche souris et doigt du canvas sur `input` (coordonnées dans la zone de jeu) ; le son se débloque au premier geste. */
  private bindInput(): void {
    const { canvas, input, audio, geometry } = this;
    const mods = (event: PointerEvent) => ({ ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey });
    const inPlayArea = (x: number, y: number): { x: number; y: number } => ({ x: x - geometry.originX, y: y - geometry.originY });
    bindCanvasPointer(
      canvas,
      { width: geometry.screenWidth, height: geometry.screenHeight },
      {
        move: (x, y) => {
          const at = inPlayArea(x, y);
          input.moveMouse(at.x, at.y);
        },
        down: (domButton, x, y, event) => {
          const button = mouseButtonFromDom(domButton);
          if (!button) return;
          const at = inPlayArea(x, y);
          input.moveMouse(at.x, at.y);
          input.mouseDown(button, mods(event));
        },
        up: (domButton, x, y, event) => {
          const button = mouseButtonFromDom(domButton);
          if (!button) return;
          const at = inPlayArea(x, y);
          input.moveMouse(at.x, at.y);
          input.mouseUp(button, mods(event));
        },
        longPress: (x, y) => {
          const at = inPlayArea(x, y);
          this.onLongPress?.(at.x, at.y);
        },
      },
      { onGesture: () => audio.unlock() },
    );
    this.bindKeyboard(canvas);
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
    bindKeyboard(
      target,
      {
        keyDown: (event) => {
          // Raccourcis du système (Cmd sur Mac) : jamais au jeu.
          if (event.metaKey) return false;
          const key = info(event);
          // Texte composé : il arrive par le champ invisible, pas par la touche physique.
          if (isComposedKey(key)) return false;
          // Maj+Échap est la sortie au clavier (le jeu possède Tab) : le canvas rend le focus au navigateur. Échap seul reste au jeu
          // (code 27 du moniteur et du hub).
          if (event.key === "Escape" && event.shiftKey && target === this.canvas) {
            this.canvas.blur();
            return true;
          }
          input.keyDown({ key: event.key, code: event.code, repeat: event.repeat, ...gameModifiers(key) });
          return gameOwnsKey(key, this.ownsCtrlKey);
        },
        keyUp: (event) => {
          const key = info(event);
          input.keyUp(event.code, gameModifiers(key));
          return gameOwnsKey(key, this.ownsCtrlKey);
        },
        // Le focus passe à un autre récepteur du jeu (canvas ↔ champ invisible) : on ne relâche rien. Perdre le focus
        // relâche tout, sinon une touche tenue au moment du clic ailleurs resterait enfoncée.
        blur: (event) => {
          if (!keepsInputOnBlur(event.relatedTarget, this.keyTargets)) input.reset();
        },
      },
      () => audio.unlock(),
    );
  }
}
