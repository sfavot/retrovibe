import type { HostStorage } from "../../../engine/storage";
import type { DrasculaAudio } from "../audio/audio";
import type { SoundFiles } from "../audio/voice";
import { type GameFiles } from "../data/files";
import type { DrasculaHost, DrasculaInput } from "../engine/host";
import { type Fetcher, FileStore } from "./preload";
import { InputQueue } from "./input";

/**
 * Voix et effets `.ALS` lus à la demande (783 fichiers, 32 Mo : pas de préchargement). `has` est synchrone (liste de `files.json`),
 * `load` rend une promesse ; les fichiers déjà lus sont gardés (une voix revient souvent, et le navigateur ne la relirait pas plus vite).
 */
export function createSoundFiles(files: GameFiles, fetcher: Fetcher): SoundFiles {
  const cache = new Map<string, Uint8Array>();
  return {
    has: (name) => files.has(name),
    load(name) {
      const path = files.resolve(name);
      if (path === undefined) return Promise.reject(new Error(`Son introuvable : ${name}`));
      const cached = cache.get(path);
      if (cached) return cached;
      return fetcher(path).then((bytes) => {
        cache.set(path, bytes);
        return bytes;
      });
    },
  };
}

export interface BrowserHostOptions {
  files: FileStore;
  audio: DrasculaAudio;
  /** Sauvegardes : stockage clé / valeur **déjà préfixé** (`prefixedStorage(store, SAVE_PREFIX)`). */
  storage: HostStorage;
  /** Reçoit chaque image du moteur (`IndexedPresenter.present`) ; les tableaux ne sont valables que pendant l'appel. */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Ce que fait `exit()` (retour à l'accueil, redémarrage). */
  onExit(): void;
  /** Horloge monotone (millisecondes) ; `performance.now()` par défaut. */
  now?(): number;
}

/**
 * Hôte du navigateur : fichiers préchargés en mémoire (le moteur les lit en synchrone), image présentée sur le canvas, voix et musique
 * par `DrasculaAudio`, entrées de la souris, du doigt et du clavier (`InputQueue`), sauvegardes dans le stockage clé / valeur. Il ne
 * touche pas au DOM : le canvas et les événements sont branchés par `app.ts`.
 */
export class BrowserHost implements DrasculaHost {
  readonly storage: HostStorage;
  readonly input = new InputQueue();
  private readonly options: BrowserHostOptions;
  /** Volume demandé par le moteur (fondu de fin de chapitre), de 0 à 1. */
  private fade = 1;
  /** Volume choisi par la joueuse (touche F9), de 0 à 1. */
  private userVolume = 1;

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

  readFile(name: string): Uint8Array {
    const bytes = this.options.files.get(name);
    if (!bytes) throw new Error(`Fichier du jeu introuvable : ${name}`);
    return bytes;
  }

  pollInput(): readonly DrasculaInput[] {
    return this.input.drain();
  }

  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.options.present(pixels, palette);
  }

  playSound(name: string): boolean {
    return this.options.audio.playSound(name);
  }

  stopSound(): void {
    this.options.audio.stopSound();
  }

  soundActive(): boolean {
    return this.options.audio.soundActive();
  }

  playMusic(track: number): void {
    this.options.audio.playMusic(track);
  }

  stopMusic(): void {
    this.options.audio.stopMusic();
  }

  musicPlaying(): boolean {
    return this.options.audio.musicPlaying();
  }

  /** Fondu du moteur (`musicFadeout`) : se combine au volume choisi par la joueuse. */
  setMusicVolume(level: number): void {
    this.fade = level;
    this.applyVolume();
  }

  /** Volume de la musique choisi par la joueuse (0 à 1). */
  setUserVolume(level: number): void {
    this.userVolume = Math.min(Math.max(level, 0), 1);
    this.applyVolume();
  }

  get volume(): number {
    return this.userVolume;
  }

  private applyVolume(): void {
    this.options.audio.setMusicVolume(this.fade * this.userVolume);
  }

  /** À appeler dans un geste de l'utilisatrice : le navigateur ne laisse démarrer le son qu'après. */
  unlock(): void {
    this.options.audio.unlock();
  }

  /** Onglet masqué, fenêtre ouverte ou pause : les voix et la musique s'arrêtent, plus aucun bouton n'est tenu. */
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
