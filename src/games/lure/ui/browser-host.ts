import type { HostStorage } from "../../../engine/storage";
import type { LureAudio } from "../audio/audio";
import type { LureHost, LureInput } from "../engine/host";
import { InputQueue } from "./input";

export interface BrowserHostOptions {
  audio: LureAudio;
  /** Sauvegardes : stockage clé / valeur **déjà préfixé** (`prefixedStorage(store, SAVE_PREFIX)`). */
  storage: HostStorage;
  /** Ce que fait `exit()` (fin de partie, « Quitter » confirmé : retour à l'accueil). */
  onExit(): void;
  /** « Sauvegarder » ou « Restituer » (barre de menus du jeu) : l'hôte ouvre la fenêtre commune des emplacements. */
  onSaveDialog(save: boolean): void;
  /** Fin de partie : le jeu demande « Recommencer » ou « Restituer » ; l'hôte pose sa fenêtre et rappelle `answer(true)` pour recommencer. */
  onRestartRestore(answer: (restart: boolean) => void): void;
  /** Horloge monotone (millisecondes) ; `performance.now()` par défaut. */
  now?(): number;
}

/**
 * Hôte du navigateur : entrées de la souris, du doigt et du clavier (`InputQueue`), sauvegardes dans le stockage clé / valeur, son par
 * `LureAudio` (le moteur, lui, reçoit `audio.sound`), sortie vers l'accueil. Il ne touche pas au DOM : le canvas et les événements sont
 * branchés par `app.ts` ; l'image est composée par `LureLoop`. Les fichiers sont déjà décodés (`LureData`) : pas de `readFile`.
 *
 * Fin de partie (le joueur est mort ou pris) : `chooseRestartRestore`, fenêtre à deux réponses posée par `app.ts`.
 */
export class BrowserHost implements LureHost {
  readonly storage: HostStorage;
  readonly input = new InputQueue();
  private readonly options: BrowserHostOptions;

  constructor(options: BrowserHostOptions) {
    this.options = options;
    this.storage = options.storage;
  }

  now(): number {
    return (this.options.now ?? performance.now.bind(performance))();
  }

  exit(): void {
    this.options.onExit();
  }

  openSaveDialog(save: boolean): void {
    this.options.onSaveDialog(save);
  }

  chooseRestartRestore(answer: (restart: boolean) => void): void {
    this.options.onRestartRestore(answer);
  }

  pollInput(): readonly LureInput[] {
    return this.input.drain();
  }

  /** Volume du son choisi par la joueuse (0 à 1). */
  setUserVolume(level: number): void {
    this.options.audio.volume = level;
  }

  get volume(): number {
    return this.options.audio.volume;
  }

  /** Une fois par image d'écran : le son avance au rythme de l'horloge de l'hôte. */
  update(): void {
    this.options.audio.update();
  }

  /** À appeler dans un geste de l'utilisatrice : le navigateur ne laisse démarrer le son qu'après. */
  unlock(): void {
    this.options.audio.unlock();
  }

  /** Onglet masqué, fenêtre ouverte ou pause : le son s'arrête, plus aucun bouton ni touche n'est tenu. */
  setPaused(paused: boolean): void {
    if (paused) {
      this.input.releaseAll();
      this.options.audio.suspend();
    } else this.options.audio.resume();
  }

  /** Page quittée. */
  close(): void {
    this.options.audio.close();
  }
}
