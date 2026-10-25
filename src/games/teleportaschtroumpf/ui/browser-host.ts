import type { AudioBackend } from "../audio/backend";
import { WebAudioBackend } from "../audio/web-audio";
import type { GameFiles } from "../data/files";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";
import type { Host } from "../engine/host";
import { Input } from "../engine/input";
import { resolveGameFile } from "../engine/paths";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { localStorageStore } from "../../../ui/local-storage";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";

/**
 * Hôte du navigateur : fichiers par `fetch` (le cache HTTP du navigateur fait le reste ; les décodés sont gardés par
 * `Resources`), canvas 320×200, Web Audio, clavier et souris du canvas.
 */
export class BrowserHost implements Host {
  readonly input = new Input();
  readonly audio: AudioBackend;
  readonly storage = localStorageStore();
  private readonly presenter: IndexedPresenter;

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
    this.presenter = IndexedPresenter.forCanvas(canvas, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.bindInput(audio);
  }

  async loadFile(name: string): Promise<Uint8Array> {
    const path = resolveGameFile(this.files, name);
    if (!path) throw new MissingFilesError(`fichier introuvable : ${name}`);
    return fetchBytes(this.base, path);
  }

  now(): number {
    return performance.now();
  }

  unixSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  present(surface: Uint8Array, palette: Uint8Array): void {
    this.presenter.present(surface, palette);
  }

  exit(): void {
    this.audio.stop();
    this.audio.stopEffect();
    this.onExit();
  }

  /** Branche clavier et souris du canvas sur `input` ; le son se débloque au premier geste. */
  private bindInput(audio: WebAudioBackend): void {
    const { canvas, input } = this;
    const unlock = (): void => audio.unlock();
    bindCanvasPointer(
      canvas,
      { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
      {
        move: (x, y, event) => {
          // Un doigt ne survole rien : seul un pointeur de souris (ou de stylet) qui passe sur l'écran fixe la position.
          if (event) input.pointerHovering = event.pointerType !== "touch";
          input.mouseMove(x, y);
        },
        leave: () => {
          input.pointerHovering = false;
        },
        down: (button, x, y) => {
          input.mouseMove(x, y);
          input.mouseDown(button);
        },
        up: (button, x, y) => {
          input.mouseMove(x, y);
          input.mouseUp(button);
        },
      },
      { onGesture: unlock },
    );
    bindKeyboard(
      canvas,
      {
        keyDown: (event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return false;
          return input.keyDown(event.code);
        },
        keyUp: (event) => input.keyUp(event.code),
        // Perdre le focus relâche tout : sinon une touche tenue au moment du clic ailleurs resterait enfoncée.
        blur: () => input.reset(),
      },
      unlock,
    );
  }
}
