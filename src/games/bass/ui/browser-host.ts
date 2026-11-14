import type { HostStorage } from "../../../engine/storage";
import type { BassHost, BassInput, BassSettings } from "../engine/host";
import { InputQueue } from "./input";

/** Ce que l'hôte demande au son (`BassAudio`) ; tenu à part pour les tests. */
export interface HostAudio {
  update(): void;
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
}

export interface BrowserHostOptions {
  /** Sauvegardes : stockage clé / valeur **déjà préfixé** (`prefixedStorage(store, SAVE_PREFIX)`). */
  storage: HostStorage;
  /** Ce que fait `exit()` (« Quitter » confirmé du panneau, fin du jeu : retour à l'accueil). */
  onExit(): void;
  /** « Sauvegarder » du panneau de contrôle : l'hôte ouvre la fenêtre commune des emplacements puis appelle `GameControl.finishDialog`. */
  onSaveRequest(): void;
  /** « Restituer » du panneau ou `fnRestoreGame` (partie perdue) : même chose pour la restitution. */
  onRestoreRequest(): void;
  /** Un réglage du panneau a changé : à mémoriser. */
  onSettings(settings: BassSettings): void;
  /** Volume de la musique choisi dans la fenêtre du site (0 à 1). */
  onVolume(level: number): void;
  /** Boutons de la souris tenus (`Mouse.held`, que `fnLookAt` attend). */
  onButtons(mask: number): void;
  /** Page quittée. */
  onClose?(): void;
  /** Horloge monotone (millisecondes) ; `performance.now()` par défaut. */
  now?(): number;
}

/**
 * Hôte du navigateur : entrées de la souris, du doigt et du clavier (`InputQueue`), demandes de sauvegarde et de restitution du panneau,
 * réglages à mémoriser, son par `BassAudio` (lié après la construction du moteur : le moteur reçoit l'hôte avant de créer son son), sortie
 * vers l'accueil. Il ne touche pas au DOM : le canvas et les événements sont branchés par `app.ts` ; l'image est composée par `BassLoop`.
 */
export class BrowserHost implements BassHost {
  readonly storage: HostStorage;
  readonly input: InputQueue;
  private audio: HostAudio | null = null;
  private level = 1;
  private readonly options: BrowserHostOptions;

  constructor(options: BrowserHostOptions) {
    this.options = options;
    this.storage = options.storage;
    this.input = new InputQueue((mask) => options.onButtons(mask));
  }

  /** Lie le son (créé avec le moteur). */
  bindAudio(audio: HostAudio): void {
    this.audio = audio;
  }

  now(): number {
    return (this.options.now ?? performance.now.bind(performance))();
  }

  exit(): void {
    this.options.onExit();
  }

  pollInput(): readonly BassInput[] {
    return this.input.drain();
  }

  requestSave(): void {
    this.options.onSaveRequest();
  }

  requestRestore(): void {
    this.options.onRestoreRequest();
  }

  settingsChanged(settings: BassSettings): void {
    this.options.onSettings(settings);
  }

  /** Volume de la musique choisi par la joueuse (0 à 1). */
  setUserVolume(level: number): void {
    this.level = level;
    this.options.onVolume(level);
  }

  get volume(): number {
    return this.level;
  }

  /** Une fois par image d'écran : la musique avance au rythme de l'horloge de l'hôte. */
  update(): void {
    this.audio?.update();
  }

  /** À appeler dans un geste de l'utilisatrice : le navigateur ne laisse démarrer le son qu'après. */
  unlock(): void {
    this.audio?.unlock();
  }

  /** Onglet masqué, fenêtre ouverte ou pause : le son s'arrête, plus aucun bouton ni entrée n'est tenu. */
  setPaused(paused: boolean): void {
    this.input.setPaused(paused);
    if (paused) this.audio?.suspend();
    else this.audio?.resume();
  }

  /** Page quittée. */
  close(): void {
    this.audio?.close();
    this.options.onClose?.();
  }
}
