import type { HostText } from "../../../engine/mohawk/host";
import { BrowserHost, type BrowserHostOptions, type FileResolver } from "../../../ui/mohawk/browser-host";
import type { CanvasGeometry } from "../../../ui/mohawk/canvas-presenter";
import { CanvasText, loadFontFace } from "../../../ui/mohawk/font-raster";
import { createBrowserTextInput, type BrowserTextInput } from "../../../ui/mohawk/text-input";
import { WebAudioSink, type WebAudioSinkOptions } from "../../../ui/mohawk/web-sink";
import type { Archive } from "../../../engine/mohawk/resources";
import { cursorToRgba, type Cursor } from "../data/curs";
import type { GameFiles } from "../data/files";
import type { CursorKind, VideoPlayback } from "../engine/host";
import { curs } from "../engine/resources";
import { isShortcutCtrlKey } from "../engine/shortcuts";
import { FONT_FAMILY, FONT_FILE } from "../engine/text";

/** Canvas de Zoombinis : 640×480, zone de jeu plein cadre, sans bordure (`engine.md` §5). */
export const ZOOMBINIS_GEOMETRY: CanvasGeometry = { screenWidth: 640, screenHeight: 480, originX: 0, originY: 0 };

/** Valeur CSS `cursor` des curseurs qui ne viennent pas d'une ressource ; `curs1` à `curs5` sont remplacés par `loadCursors`. */
const CURSORS: Readonly<Record<CursorKind, string>> = {
  system: "default",
  busy: "wait",
  hidden: "none",
  curs1: "default",
  curs2: "default",
  curs3: "default",
  curs4: "default",
  curs5: "default",
};

/**
 * Sortie audio du site, qui prévient aussi les films (`<video>`, hors Web Audio) : la préférence « Son » (`setMuted`, appelée par
 * `SoundPrefs`) et la pause de l'onglet masqué (`suspend` / `resume`, appelées par le moteur) s'appliquent à la vidéo comme au reste.
 */
class ZoombinisAudio extends WebAudioSink {
  private soundOff = false;
  private paused = false;
  private readonly listeners = new Set<() => void>();

  constructor(options: WebAudioSinkOptions) {
    super(options);
  }

  get isMuted(): boolean {
    return this.soundOff;
  }

  get isSuspended(): boolean {
    return this.paused;
  }

  /** Appelé après chaque changement de préférence ou de pause ; renvoie de quoi se désabonner. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  override setMuted(muted: boolean): void {
    super.setMuted(muted);
    this.soundOff = muted;
    this.notify();
  }

  override suspend(): void {
    super.suspend();
    this.paused = true;
    this.notify();
  }

  override resume(): void {
    super.resume();
    this.paused = false;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Film déjà fini (fichier absent ou lecture impossible) : la scène passe tout de suite à la suite. */
const NO_VIDEO: VideoPlayback = { ended: true, stop() {} };

/**
 * Hôte navigateur de Zoombinis : le commun plus le texte TrueType (`loadText`, absent tant que la police n'est pas chargée) et les films
 * (`playVideo`). Le film est un `<video>` posé exactement sur le canvas, sans contrôles ni gestes propres : les clics et les touches
 * traversent jusqu'au canvas (`pointer-events: none`), que la scène lit comme n'importe quel événement.
 */
export class ZoombinisBrowserHost extends BrowserHost<CursorKind> {
  /** Champ invisible de saisie du nom de partie (`Host.textInput`) ; son `element` est à poser dans la page, près du canvas (`app.ts`). */
  textInput?: BrowserTextInput;

  text?: HostText;
  /** Le dernier appui sur le canvas venait d'un doigt (`Host.pointerIsTouch`). */
  pointerIsTouch = false;
  private readonly videoBase: string;
  private readonly videoFiles: FileResolver;
  private readonly videoCanvas: HTMLCanvasElement;
  private readonly videoAudio: ZoombinisAudio | null;

  constructor(options: BrowserHostOptions<CursorKind>) {
    super(options);
    this.videoBase = options.base;
    this.videoFiles = options.files;
    this.videoCanvas = options.canvas;
    this.videoAudio = options.audio instanceof ZoombinisAudio ? options.audio : null;
    // En phase de capture : lu avant que le pointeur commun ne traduise l'appui en clic.
    options.canvas.addEventListener("pointerdown", (event) => (this.pointerIsTouch = event.pointerType === "touch"), { capture: true });
  }

  playVideo(path: string): VideoPlayback {
    const resolved = this.videoFiles.resolve(path);
    const parent = this.videoCanvas.parentElement;
    if (!resolved || !parent) return NO_VIDEO;
    const canvas = this.videoCanvas;
    const audio = this.videoAudio;
    const video = document.createElement("video");
    video.src = `${this.videoBase}/${resolved.split("/").map(encodeURIComponent).join("/")}`;
    video.controls = false;
    video.playsInline = true;
    video.preload = "auto";
    video.disablePictureInPicture = true;
    video.setAttribute("aria-hidden", "true");
    video.tabIndex = -1;
    Object.assign(video.style, {
      position: "absolute",
      pointerEvents: "none",
      background: "#000",
      objectFit: "fill",
      imageRendering: "pixelated",
    });
    // Posée exactement sur le canvas, quelle que soit sa taille à l'écran (échelle fractionnaire, redimensionnement de la fenêtre) : les
    // rectangles réels, pas `offsetWidth` qui arrondit.
    const place = (): void => {
      const at = canvas.getBoundingClientRect();
      const from = parent.getBoundingClientRect();
      video.style.left = `${at.left - from.left - parent.clientLeft}px`;
      video.style.top = `${at.top - from.top - parent.clientTop}px`;
      video.style.width = `${at.width}px`;
      video.style.height = `${at.height}px`;
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(canvas);
    // « Son » coupé ou onglet masqué : le film suit (la lecture reprend à l'endroit où elle s'était arrêtée).
    const follow = (): void => {
      video.muted = audio?.isMuted ?? false;
      if (audio?.isSuspended) video.pause();
      else if (!video.ended && video.paused && !state.ended) void video.play().catch(() => undefined);
    };
    const state = { ended: false };
    const finish = (): void => {
      if (state.ended) return;
      state.ended = true;
      unfollow?.();
      observer?.disconnect();
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    };
    const unfollow = audio?.onChange(follow);
    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    parent.append(video);
    video.muted = audio?.isMuted ?? false;
    void video.play().catch(() => {
      // Lecture avec son refusée (pas de geste récent) : on retente sans le son plutôt que de perdre le film.
      video.muted = true;
      return video.play().catch(finish);
    });
    return {
      get ended() {
        return state.ended;
      },
      stop: finish,
    };
  }
}

/**
 * Hôte navigateur de Zoombinis.
 * `base` : URL du dossier des fichiers du jeu, sans barre finale (ex. `./zoombinis`) ; la soundfont réduite y est servie.
 * `onExit` : ce que fait `exit()` une fois le son coupé (retour à l'accueil, redémarrage…).
 */
export function createZoombinisBrowserHost(base: string, files: GameFiles, canvas: HTMLCanvasElement, onExit: () => void): ZoombinisBrowserHost {
  const soundfontUrl = `${base}/zoombinis-gm.sf2`;
  const host = new ZoombinisBrowserHost({
    base,
    audio: new ZoombinisAudio({ soundfontUrl }),
    files,
    canvas,
    onExit,
    geometry: ZOOMBINIS_GEOMETRY,
    cursors: CURSORS,
    defaultCursor: "system",
    soundfontUrl,
    ownsCtrlKey: isShortcutCtrlKey,
  });
  host.textInput = createBrowserTextInput({ canvas, bindKeyboard: (target) => host.bindKeyboard(target), className: "zb-text-input" });
  return host;
}

/**
 * Charge `CORNER.TTF` (police CornerStone) et branche le texte de l'hôte (`host.text`). À attendre avant `installText` / `engine.start()` :
 * le rendu du texte est synchrone ensuite. Rejette si le fichier manque ou n'est pas une police lisible.
 */
export async function loadText(host: ZoombinisBrowserHost): Promise<void> {
  await loadFontFace(FONT_FAMILY, await host.loadFile(FONT_FILE));
  host.text = new CanvasText();
}

/**
 * Valeur CSS `cursor` d'un `CURS` : PNG 16×16 en `data:` (canvas du navigateur) et point chaud.
 * Approximation : le plan « masque » donne l'opacité et le plan « image » noir ou blanc (`cursorToRgba`) ; l'original combine des
 * masques AND / XOR, donc les pixels qui s'inversent sur le fond (XOR) sont rendus en blanc ou noir fixe.
 */
export function cssCursor(cursor: Cursor, fallback: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = cursor.width;
  canvas.height = cursor.height;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  const image = context.createImageData(cursor.width, cursor.height);
  image.data.set(cursorToRgba(cursor));
  context.putImageData(image, 0, 0);
  return `url("${canvas.toDataURL("image/png")}") ${cursor.hotspot.x} ${cursor.hotspot.y}, ${fallback}`;
}

/** Applique les `CURS` 1 à 5 de `ZOOMBINI.MHK` aux curseurs `curs1` à `curs5` de l'hôte. */
export function loadCursors(host: ZoombinisBrowserHost, common: Archive): void {
  for (let id = 1; id <= 5; id++) host.setCursorStyle(`curs${id}` as CursorKind, cssCursor(curs(common, id), "default"));
}
