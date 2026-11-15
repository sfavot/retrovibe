import type { HostStorage } from "../../../engine/storage";
import type { CroisiereAction, CroisiereHost, CroisiereInput } from "../engine/host";

/** Écran logique du jeu. */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/** Ce que l'hôte demande à la sortie AdLib (`WebOpl`). */
export interface HostAudio {
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
  setVolume(level: number): void;
}

/** Bouton du DOM (0 gauche, 2 droit) -> bouton du moteur (1 gauche, 2 droit) ; les autres ne servent pas. */
function gameButton(domButton: number): 1 | 2 | undefined {
  if (domButton === 0) return 1;
  if (domButton === 2) return 2;
  return undefined;
}

/**
 * File des entrées du moteur (`CroisiereHost.pollInput`), en coordonnées de l'écran de 320 × 200. Le moteur lit au plus un changement
 * de bouton par tour (`manageEvents`) : un toucher (déplacement, appui, relâchement poussés d'un coup) est donc vu comme un bouton
 * enfoncé pendant un tour, comme un clic rapide sous ScummVM. Deux déplacements de suite n'en font qu'un. En pause, plus rien n'entre,
 * sauf les relâchements (un bouton ne reste jamais enfoncé).
 */
export class InputQueue {
  private queue: CroisiereInput[] = [];
  private held = 0;
  private paused = false;
  private escapeHeld = false;
  /** Dernier geste au doigt : le curseur n'est plus dessiné jusqu'au prochain geste de la souris. */
  touchMode = false;

  private static clamp(x: number, y: number): { x: number; y: number } {
    return { x: Math.max(0, Math.min(SCREEN_WIDTH - 1, Math.floor(x))), y: Math.max(0, Math.min(SCREEN_HEIGHT - 1, Math.floor(y))) };
  }

  private push(event: CroisiereInput): void {
    const last = this.queue[this.queue.length - 1];
    if (event.type === "move" && last?.type === "move") this.queue[this.queue.length - 1] = event;
    else this.queue.push(event);
  }

  move(x: number, y: number): void {
    if (this.paused) return;
    this.push({ type: "move", ...InputQueue.clamp(x, y) });
  }

  /** Bouton de la souris ou du stylet enfoncé (`button` du DOM). */
  down(domButton: number, x: number, y: number): void {
    const button = gameButton(domButton);
    if (button === undefined || this.paused || this.held & button) return;
    this.touchMode = false;
    this.held |= button;
    this.push({ type: "move", ...InputQueue.clamp(x, y) });
    this.push({ type: "down", button });
  }

  /** Bouton relâché (aussi en pause). */
  up(domButton: number, _x: number, _y: number): void {
    const button = gameButton(domButton);
    if (button === undefined || !(this.held & button)) return;
    this.held &= ~button;
    this.push({ type: "up", button });
  }

  /** Plus aucun bouton ni touche tenus (perte du focus, pause). */
  releaseAll(): void {
    for (const dom of [0, 2]) this.up(dom, 0, 0);
    this.endAction("escape");
  }

  /** Toucher (0) ou appui long (2) : le pointeur va en (x, y), puis clique et relâche. */
  tap(domButton: 0 | 2, x: number, y: number): void {
    const button = gameButton(domButton);
    if (button === undefined || this.paused) return;
    this.touchMode = true;
    this.push({ type: "move", ...InputQueue.clamp(x, y) });
    this.push({ type: "down", button });
    this.push({ type: "up", button });
  }

  /** Action du clavier ou d'un bouton : appuyée puis relâchée, sauf Échap, tenue jusqu'à `endAction`. */
  action(action: CroisiereAction): void {
    if (this.paused) return;
    if (action === "escape") {
      if (this.escapeHeld) return;
      this.escapeHeld = true;
      this.push({ type: "actionStart", action });
      return;
    }
    this.push({ type: "actionStart", action });
    this.push({ type: "actionEnd", action });
  }

  /** Fin d'une action tenue (Échap relâchée). */
  endAction(action: CroisiereAction): void {
    if (action !== "escape" || !this.escapeHeld) return;
    this.escapeHeld = false;
    this.push({ type: "actionEnd", action });
  }

  /**
   * Clic gauche sur place (bouton « Passer ») : les scripts de l'introduction et des scènes lisent le bouton (`GetMouseButton`) pour
   * avancer, et un clic gauche fait disparaître le texte affiché (`userWait`) ; sans la main, il n'agit pas sur le décor.
   */
  clickInPlace(): void {
    if (this.paused || this.held & 1) return;
    this.push({ type: "down", button: 1 });
    this.push({ type: "up", button: 1 });
  }

  /** En pause : boutons relâchés, entrées en attente gardées (le moteur, arrêté, les lira à la reprise) ; plus rien n'est accepté. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    if (paused) {
      this.releaseAll();
      // Seuls les relâchements comptent : un clic commencé avant la pause ne doit pas agir à la reprise.
      this.queue = this.queue.filter((event) => event.type === "up" || event.type === "actionEnd" || event.type === "move");
    }
    this.paused = paused;
  }

  /** Les entrées reçues depuis l'appel précédent. */
  drain(): readonly CroisiereInput[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

export interface BrowserHostOptions {
  /** Sauvegardes : stockage clé / valeur **déjà préfixé**. */
  storage: HostStorage;
  /** « Quitter » du menu joueur : retour à l'écran titre du jeu. */
  onExit(): void;
  /** « Sauvegarde » du menu joueur : fenêtre commune des emplacements. */
  onSaveRequest(): void;
  /** « Chargement » du menu joueur. */
  onLoadRequest(): void;
}

/**
 * Hôte du navigateur : entrées de la souris, du doigt et du clavier (`InputQueue`), demandes de sauvegarde et de chargement du menu
 * joueur, sortie vers l'écran titre, son (sortie AdLib liée après la construction). Il ne touche pas au DOM : le canvas et les
 * événements sont branchés par `point-click-app.ts` ; l'image est composée par `CroisiereLoop`.
 */
export class BrowserHost implements CroisiereHost {
  readonly storage: HostStorage;
  readonly input = new InputQueue();
  private audio: HostAudio | null = null;
  private level = 1;

  constructor(private readonly options: BrowserHostOptions) {
    this.storage = options.storage;
  }

  bindAudio(audio: HostAudio): void {
    this.audio = audio;
    audio.setVolume(this.level);
  }

  now(): number {
    return performance.now();
  }

  exit(): void {
    this.options.onExit();
  }

  pollInput(): readonly CroisiereInput[] {
    return this.input.drain();
  }

  log(message: string): void {
    if (import.meta.env.DEV) console.debug(`[croisiere] ${message}`);
  }

  onSaveRequest(): void {
    this.options.onSaveRequest();
  }

  onLoadRequest(): void {
    this.options.onLoadRequest();
  }

  /** Volume choisi par la joueuse (0 à 1). */
  setUserVolume(level: number): void {
    this.level = level;
    this.audio?.setVolume(level);
  }

  get volume(): number {
    return this.level;
  }

  /** À appeler dans un geste de l'utilisatrice : le navigateur ne laisse démarrer le son qu'après. */
  unlock(): void {
    this.audio?.unlock();
  }

  /** Onglet masqué, fenêtre ouverte ou pause : le son s'arrête, plus aucun bouton n'est tenu. */
  setPaused(paused: boolean): void {
    this.input.setPaused(paused);
    if (paused) this.audio?.suspend();
    else this.audio?.resume();
  }

  close(): void {
    this.audio?.close();
  }
}
