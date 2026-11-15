import type { HostStorage } from "../../../engine/storage";
import type { VoyageursHost, VoyageursInput } from "../engine/host";
import type { VoyageursFiles } from "../engine/part";
import type { VoyageursAudio } from "../engine/services";
import { InputQueue } from "./input";

/** Ce que l'hôte demande au son (`VoyageursSound`) ; tenu à part pour les tests. */
export interface HostAudio extends VoyageursAudio {
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
  setMusicVolume(level: number): void;
}

export interface BrowserHostOptions {
  /** Fichiers du jeu, chargés avant de construire le moteur. */
  files: VoyageursFiles;
  /** Sauvegardes : stockage clé / valeur **déjà préfixé**. */
  storage: HostStorage;
  audio: HostAudio;
  /** Ce que fait `exit()` (« Quitter » confirmé du menu système : retour à l'écran titre du jeu). */
  onExit(): void;
  /** « Sauver la partie » du menu système : l'hôte ouvre la fenêtre commune des emplacements quand le menu est fermé. */
  onSaveRequest(): void;
  /** « Charger une partie » du menu système : même chose pour le chargement. */
  onLoadRequest(): void;
  /** Horloge monotone (millisecondes) ; `performance.now()` par défaut. */
  now?(): number;
}

/**
 * Hôte du navigateur : entrées de la souris, du doigt et du clavier (`InputQueue`), demandes de sauvegarde et de chargement du menu
 * système, son (`VoyageursSound`, passé au moteur par `audio`), sortie vers l'écran titre. Il ne touche pas au DOM : le canvas et les
 * événements sont branchés par `app.ts` ; l'image est composée par `VoyageursLoop`.
 */
export class BrowserHost implements VoyageursHost {
  readonly files: VoyageursFiles;
  readonly storage: HostStorage;
  readonly audio: HostAudio;
  readonly input = new InputQueue();
  private level = 1;

  constructor(private readonly options: BrowserHostOptions) {
    this.files = options.files;
    this.storage = options.storage;
    this.audio = options.audio;
  }

  now(): number {
    return (this.options.now ?? performance.now.bind(performance))();
  }

  exit(): void {
    this.options.onExit();
  }

  pollInput(): readonly VoyageursInput[] {
    return this.input.drain();
  }

  requestSave(): void {
    this.options.onSaveRequest();
  }

  requestLoad(): void {
    this.options.onLoadRequest();
  }

  /** Volume de la musique choisi par la joueuse (0 à 1). */
  setUserVolume(level: number): void {
    this.level = level;
    this.audio.setMusicVolume(level);
  }

  get volume(): number {
    return this.level;
  }

  /** À appeler dans un geste de l'utilisatrice : le navigateur ne laisse démarrer le son qu'après. */
  unlock(): void {
    this.audio.unlock();
  }

  /** Onglet masqué, fenêtre ouverte ou pause : le son s'arrête, plus aucun bouton ni entrée n'est tenu. */
  setPaused(paused: boolean): void {
    this.input.setPaused(paused);
    if (paused) this.audio.suspend();
    else this.audio.resume();
  }

  /** Page quittée. */
  close(): void {
    this.audio.close();
  }
}
