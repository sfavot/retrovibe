import type { HostStorage } from "../../../engine/storage";
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";
import { WebOpl } from "../audio/web-opl";
import type { ArmaethFrame, ArmaethHost, ArmaethStorage, HostInput, HostKey } from "../engine/host";
import { InputQueue, SCREEN_HEIGHT, SCREEN_WIDTH, buttonMask, mapKey } from "./input";
import { createSaveStorage } from "./saves";
import { HoldToggle, snapTouchTarget } from "./touch";

/**
 * Hôte du navigateur : fichiers préchargés en mémoire (le moteur les lit en synchrone), canvas 320×200 en couleurs indexées, musique
 * AdLib par Web Audio, clavier et souris du canvas, sauvegardes dans le stockage clé / valeur du navigateur.
 */
export class BrowserHost implements ArmaethHost {
  readonly opl: WebOpl;
  readonly storage: ArmaethStorage;
  /** « Tenir » de la barre tactile : le prochain toucher du doigt compte comme Ctrl + clic. */
  readonly hold = new HoldToggle();
  private readonly presenter: IndexedPresenter;
  private readonly input = new InputQueue();
  private readonly detach: (() => void)[] = [];
  /** Fichiers du jeu, par nom en minuscules (le moteur demande les noms exacts du CD, on tolère la casse). */
  private readonly files = new Map<string, Uint8Array>();

  /**
   * `files` : tous les fichiers de `files.json` (nom -> octets), préchargés. `saves` : stockage des sauvegardes (déjà préfixé).
   * `onQuit` : ce que fait `quit()` (retour à l'accueil, redémarrage...).
   */
  constructor(
    files: ReadonlyMap<string, Uint8Array>,
    canvas: HTMLCanvasElement,
    saves: HostStorage,
    private readonly onQuit: () => void,
    opl: WebOpl = new WebOpl(),
  ) {
    for (const [name, bytes] of files) this.files.set(name.toLowerCase(), bytes);
    this.opl = opl;
    this.storage = createSaveStorage(saves);
    this.presenter = IndexedPresenter.forCanvas(canvas, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.bindInput(canvas);
  }

  readFile(name: string): Uint8Array {
    const bytes = this.files.get(name.toLowerCase());
    if (!bytes) throw new Error(`Fichier du jeu introuvable : ${name}`);
    return bytes;
  }

  now(): number {
    return performance.now();
  }

  present(frame: ArmaethFrame): void {
    this.presenter.present(frame.pixels, frame.palette);
  }

  pollInput(): readonly HostInput[] {
    return this.input.drain();
  }

  quit(): void {
    this.onQuit();
  }

  /** Touche venue de la barre tactile ou du champ de saisie caché (même file que le clavier). */
  pressKey(key: HostKey): void {
    this.input.key(key);
  }

  /** Débloque le son : à appeler depuis un geste de l'utilisatrice. */
  unlock(): void {
    this.opl.unlock();
  }

  /** Onglet masqué : le son s'arrête et plus aucun bouton n'est tenu ; au retour il repart (l'horloge est resynchronisée par l'appelant). */
  setPaused(paused: boolean): void {
    if (paused) {
      this.input.releaseAll();
      this.opl.suspend();
    } else this.opl.resume();
  }

  /** Détache clavier et souris. */
  close(): void {
    for (const off of this.detach.splice(0)) off();
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const { input } = this;
    const unlock = (): void => this.opl.unlock();
    this.detach.push(
      bindCanvasPointer(
        canvas,
        { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
        {
          // Souris et stylet : boutons du jeu (gauche / droit). Doigt : `tap` (toucher = clic gauche, appui long = clic droit).
          // `event` nul = geste du doigt : la cible est attirée vers la case d'icône ou d'inventaire voisine (souris et stylet : exacts).
          move: (x, y, event) => {
            if (event) input.move(x, y, event.ctrlKey);
            else {
              const target = snapTouchTarget(x, y);
              input.move(target.x, target.y, false);
            }
          },
          down: (button, x, y, event) => input.down(buttonMask(button), x, y, event.ctrlKey),
          up: (button, x, y, event) => input.up(buttonMask(button), x, y, event.ctrlKey),
          tap: (button) => input.tap(buttonMask(button), this.hold.consume()),
        },
        { onGesture: unlock },
      ),
      bindKeyboard(
        canvas,
        {
          keyDown: (event) => {
            const key = mapKey(event);
            if (!key) return false;
            input.key(key);
            return true;
          },
          // Perdre le focus relâche la souris : sinon un bouton tenu au moment du clic ailleurs resterait enfoncé.
          blur: () => input.releaseAll(),
        },
        unlock,
      ),
    );
  }
}
