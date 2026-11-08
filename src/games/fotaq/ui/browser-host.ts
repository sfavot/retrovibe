import type { HostStorage } from "../../../engine/storage";
import type { Fetcher, FileStore } from "../../../ui/file-store";
import type { FotaqAudio } from "../audio/audio";
import type { SoundFiles } from "../audio/voices";
import { type GameFiles, voiceFile } from "../data/files";
import type { FotaqHost, FotaqInput } from "../engine/host";
import { InputQueue } from "./input";
import type { RoomFiles } from "./preload";

/**
 * Voix et effets `voices/<NOM>.mp3` lus à la demande (6 751 fichiers, 42,6 Mo : pas de préchargement général ; le moteur donne les voix
 * d'une scène à `preloadSpeech`). `has` est synchrone (liste de `files.json`), `load` rend une promesse ; les fichiers déjà lus sont
 * gardés (le décodage, lui, est mis en cache par `VoiceBank`).
 */
export function createSoundFiles(files: GameFiles, fetcher: Fetcher): SoundFiles {
  const cache = new Map<string, Uint8Array>();
  return {
    has: (name) => files.has(voiceFile(name)),
    load(name) {
      const path = files.resolve(voiceFile(name));
      if (path === undefined) return Promise.reject(new Error(`Son introuvable : ${name}`));
      const cached = cache.get(path);
      if (cached) return Promise.resolve(cached);
      return fetcher(path).then((bytes) => {
        cache.set(path, bytes);
        return bytes;
      });
    },
  };
}

export interface BrowserHostOptions {
  /** Fichiers préchargés en mémoire (`readFile`). */
  files: FileStore;
  /** Liste des fichiers du jeu (`fileExists`, dont la présence des fichiers de lumière d'une pièce). */
  gameFiles: GameFiles;
  /** Décors par pièce (`roomFilesReady`). */
  rooms: RoomFiles;
  audio: FotaqAudio;
  /** Sauvegardes : stockage clé / valeur **déjà préfixé** (`prefixedStorage(store, SAVE_PREFIX)`). */
  storage: HostStorage;
  /** Reçoit chaque image du moteur (`IndexedPresenter.present`) ; les tableaux ne sont valables que pendant l'appel. */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Ce que fait `exit()` (fin du jeu : retour à l'accueil, redémarrage). */
  onExit(): void;
  /** Le journal est demandé (touche F1 ou F5, verbe du journal) : l'hôte ouvre son menu. */
  onJournal(): void;
  /** Horloge monotone (millisecondes) ; `performance.now()` par défaut. */
  now?(): number;
}

/**
 * Hôte du navigateur : fichiers préchargés en mémoire (le moteur les lit en synchrone), image présentée sur le canvas, voix et musique
 * par `FotaqAudio`, entrées de la souris, du doigt et du clavier (`InputQueue`), sauvegardes dans le stockage clé / valeur. Il ne
 * touche pas au DOM : le canvas et les événements sont branchés par `app.ts`.
 */
export class BrowserHost implements FotaqHost {
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

  openJournal(): void {
    this.options.onJournal();
  }

  readFile(name: string): Uint8Array {
    const bytes = this.options.files.get(name);
    if (!bytes) throw new Error(`Fichier du jeu introuvable : ${name}`);
    return bytes;
  }

  fileExists(name: string): boolean {
    return this.options.gameFiles.has(name);
  }

  /** Le moteur attend le décor d'une pièce depuis le dernier passage à faux de `app.ts` (pastille de chargement). */
  waitingForRoom = false;

  roomFilesReady(files: readonly string[]): boolean {
    const ready = this.options.rooms.ready(files);
    if (!ready) this.waitingForRoom = true;
    return ready;
  }

  pollInput(): readonly FotaqInput[] {
    return this.input.drain();
  }

  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.options.present(pixels, palette);
  }

  playSong(song: number): void {
    this.options.audio.playSong(song);
  }

  playSfx(sfx: number): void {
    this.options.audio.playSfx(sfx);
  }

  /** La voix est lancée ; vrai si les voix sont actives et si le fichier existe (la réplique dure alors autant que la voix). */
  playSpeech(name: string): boolean {
    this.options.audio.playSpeech(name);
    return this.options.audio.speechOn && this.options.audio.speechFound;
  }

  stopSpeech(): void {
    this.options.audio.stopSpeech();
  }

  speechActive(): boolean {
    return this.options.audio.speechActive;
  }

  stopSfx(): void {
    this.options.audio.stopSfx();
  }

  preloadSpeech(names: readonly string[]): void {
    void this.options.audio.preload(names);
  }

  lastSong(): number {
    return this.options.audio.lastSong;
  }

  /** Volume de la musique choisi par la joueuse (0 à 1). */
  setUserVolume(level: number): void {
    this.options.audio.volume = level;
  }

  get volume(): number {
    return this.options.audio.volume;
  }

  /** Une fois par image d'écran : la musique avance au rythme de l'horloge de l'hôte. */
  update(): void {
    this.options.audio.update();
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
