import type { AudioBackend } from "../audio/backend";
import { WebAudioBackend } from "../audio/web-audio";
import type { GameFiles } from "../data/files";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";
import type { Host, HostStorage } from "../engine/host";
import { Input } from "../engine/input";
import { resolveGameFile } from "../engine/paths";

/** Accès à localStorage : indisponible ou plein, on échoue sans bruit (même principe que `games/indy/ui/storage.ts`). */
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

/**
 * Hôte du navigateur : fichiers par `fetch` (le cache HTTP du navigateur fait le reste ; les décodés sont gardés par
 * `Resources`), canvas 320×200, Web Audio, clavier et souris du canvas.
 */
export class BrowserHost implements Host {
  readonly input = new Input();
  readonly audio: AudioBackend;
  readonly storage = localStorageStore;
  private readonly context: CanvasRenderingContext2D;
  private readonly image = new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  private readonly pixels = new Uint32Array(this.image.data.buffer);
  private readonly table = new Uint32Array(256);

  /**
   * `base` : URL du dossier des fichiers du jeu, sans barre finale (ex. `./teleportaschtroumpf`).
   * `onExit` : ce que fait `exit()` une fois le son coupé (retour à l'accueil, redémarrage…).
   */
  constructor(
    private readonly base: string,
    private readonly files: GameFiles,
    private readonly canvas: HTMLCanvasElement,
    private readonly onExit: () => void,
    audio: WebAudioBackend = new WebAudioBackend(),
  ) {
    this.audio = audio;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2D indisponible");
    this.context = context;
    this.bindInput(audio);
  }

  async loadFile(name: string): Promise<Uint8Array> {
    const path = resolveGameFile(this.files, name);
    if (!path) throw new MissingFilesError(`fichier introuvable : ${name}`);
    const url = `${this.base}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url);
    if (response.status === 404) throw new MissingFilesError(`${path} : HTTP 404`);
    if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  now(): number {
    return performance.now();
  }

  unixSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  present(surface: Uint8Array, palette: Uint8Array): void {
    const { table, pixels } = this;
    for (let i = 0; i < 256; i++) {
      // Little-endian : 0xAABBGGRR.
      table[i] = (0xff000000 | (palette[i * 3 + 2] << 16) | (palette[i * 3 + 1] << 8) | palette[i * 3]) >>> 0;
    }
    for (let i = 0; i < pixels.length; i++) pixels[i] = table[surface[i]];
    this.context.putImageData(this.image, 0, 0);
  }

  exit(): void {
    this.audio.stop();
    this.audio.stopEffect();
    this.onExit();
  }

  /** Position du pointeur dans l'écran du jeu (320×200). */
  private pointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.input.mouseMove(((event.clientX - rect.left) * SCREEN_WIDTH) / rect.width, ((event.clientY - rect.top) * SCREEN_HEIGHT) / rect.height);
  }

  /** Branche clavier et souris du canvas sur `input` ; le son se débloque au premier geste. */
  private bindInput(audio: WebAudioBackend): void {
    const { canvas, input } = this;
    canvas.addEventListener("pointermove", (event) => {
      // Un doigt ne survole rien : seul un pointeur de souris (ou de stylet) qui passe sur l'écran fixe la position.
      input.pointerHovering = event.pointerType !== "touch";
      this.pointer(event);
    });
    canvas.addEventListener("pointerleave", () => {
      input.pointerHovering = false;
    });
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      audio.unlock();
      this.pointer(event);
      input.mouseDown(event.button);
    });
    const release = (event: PointerEvent): void => {
      this.pointer(event);
      input.mouseUp(event.button);
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    // Le clic droit est un bouton du jeu.
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("keydown", (event) => {
      audio.unlock();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (input.keyDown(event.code)) event.preventDefault();
    });
    canvas.addEventListener("keyup", (event) => {
      if (input.keyUp(event.code)) event.preventDefault();
    });
    // Perdre le focus relâche tout : sinon une touche tenue au moment du clic ailleurs resterait enfoncée.
    canvas.addEventListener("blur", () => input.reset());
  }
}
