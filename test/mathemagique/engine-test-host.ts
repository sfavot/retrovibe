import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AudioSink, MidiSink, PcmSound, WaveHandle } from "../../src/games/mathemagique/audio/sink";
import { GameFiles, type GameFileEntry } from "../../src/games/mathemagique/data/files";
import type { Engine } from "../../src/games/mathemagique/engine/engine";
import type { Frame } from "../../src/games/mathemagique/engine/graphics/frame";
import type { CursorKind, Host, HostStorage } from "../../src/games/mathemagique/engine/host";
import { Input, type MouseButton } from "../../src/games/mathemagique/engine/input";

const ORIGINAL = resolve(import.meta.dirname, "../../original/mathemagique");

/** Un WAVE lancé sur la sortie factice. */
export interface PlayedWave {
  handle: WaveHandle;
  sound: PcmSound;
  loop: boolean;
  /** Temps de l'hôte (ms) du lancement. */
  at: number;
}

/** Sortie MIDI factice : garde les messages et les remises à zéro. */
export class FakeMidi implements MidiSink {
  readonly messages: { message: Uint8Array; atMs: number | undefined }[] = [];
  resets = 0;

  send(message: Uint8Array, atMs?: number): void {
    this.messages.push({ message: message.slice(), atMs });
  }

  reset(): void {
    this.resets++;
  }
}

/**
 * Puits audio factice : enregistre les appels et simule la lecture d'après le temps de l'hôte (un WAVE joue tant que sa durée
 * n'est pas écoulée, ou indéfiniment en boucle ; le temps de lecture est figé pendant une suspension).
 */
export class FakeAudio implements AudioSink {
  readonly midi = new FakeMidi();
  readonly waves: PlayedWave[] = [];
  readonly stopped: WaveHandle[] = [];
  unlocked = false;
  muted = false;
  suspended = false;
  private suspendedAt = 0;
  private pausedMs = 0;
  private nextHandle = 1;
  private readonly active = new Map<WaveHandle, PlayedWave>();

  constructor(private readonly hostNow: () => number) {}

  /** Temps de lecture (ms) : figé pendant une suspension. */
  now(): number {
    return (this.suspended ? this.suspendedAt : this.hostNow()) - this.pausedMs;
  }

  unlock(): void {
    this.unlocked = true;
  }

  playWave(sound: PcmSound, loop: boolean): WaveHandle {
    const handle = this.nextHandle++;
    const played = { handle, sound, loop, at: this.now() };
    this.waves.push(played);
    if (this.unlocked) this.active.set(handle, played);
    return handle;
  }

  stopWave(handle: WaveHandle): void {
    this.stopped.push(handle);
    this.active.delete(handle);
  }

  isWavePlaying(handle: WaveHandle): boolean {
    const played = this.active.get(handle);
    if (!played) return false;
    return played.loop || (this.now() - played.at) / 1000 < played.sound.samples.length / played.sound.sampleRate;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  suspend(): void {
    if (this.suspended) return;
    this.suspendedAt = this.hostNow();
    this.suspended = true;
  }

  resume(): void {
    if (!this.suspended) return;
    this.pausedMs += this.hostNow() - this.suspendedAt;
    this.suspended = false;
  }
}

export class MemoryStorage implements HostStorage {
  readonly data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): boolean {
    this.data.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}

/** Image présentée, copiée. */
export interface CapturedFrame {
  pixels: Uint8Array;
  palette: Uint8Array;
  at: number;
}

let manifest: GameFiles | null = null;
function gameFiles(): GameFiles {
  manifest ??= new GameFiles(JSON.parse(readFileSync(resolve(ORIGINAL, "files.json"), "utf8")) as GameFileEntry[]);
  return manifest;
}

/**
 * Hôte de test : temps simulé (`time`, ms), entrées pilotables (`input` et les raccourcis `click`, `press`), audio factice,
 * stockage en mémoire, images capturées. `loadFile` lit d'abord `virtualFiles` (fichiers synthétiques d'un test), puis
 * `original/mathemagique/` sur disque avec la même résolution insensible à la casse que `GameFiles`.
 */
export class TestHost implements Host {
  time = 0;
  /** Horloge murale simulée (source de la graine par défaut). */
  unix = 1_700_000_000_000;
  readonly input = new Input();
  readonly audio = new FakeAudio(() => this.time);
  readonly storage = new MemoryStorage();
  readonly frames: CapturedFrame[] = [];
  readonly cursors: CursorKind[] = [];
  /** Chemins demandés à `loadFile`, dans l'ordre. */
  readonly loaded: string[] = [];
  /** Fichiers synthétiques, par chemin en minuscules. */
  readonly virtualFiles = new Map<string, Uint8Array>();
  exited = false;

  async loadFile(path: string): Promise<Uint8Array> {
    this.loaded.push(path);
    const virtual = this.virtualFiles.get(path.toLowerCase());
    if (virtual) return virtual;
    if (!existsSync(resolve(ORIGINAL, "files.json"))) throw new Error(`fichier introuvable : ${path}`);
    const real = gameFiles().resolve(path);
    if (!real) throw new Error(`fichier introuvable : ${path}`);
    return new Uint8Array(readFileSync(resolve(ORIGINAL, real)));
  }

  now(): number {
    return this.time;
  }

  unixMillis(): number {
    return this.unix;
  }

  present(frame: Frame): void {
    this.frames.push({ pixels: frame.pixels.slice(), palette: frame.palette.slice(), at: this.time });
  }

  setCursor(cursor: CursorKind): void {
    this.cursors.push(cursor);
  }

  exit(): void {
    this.exited = true;
  }

  /** Dernier curseur demandé. */
  get cursor(): CursorKind | undefined {
    return this.cursors[this.cursors.length - 1];
  }

  /** Appui puis relâchement immédiats (un clic plus court qu'une image). */
  click(x: number, y: number, button: MouseButton = "left"): void {
    this.input.moveMouse(x, y);
    this.input.mouseDown(button);
    this.input.mouseUp(button);
  }

  /** Frappe puis relâche une touche. */
  press(code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; key?: string } = {}): void {
    this.input.keyDown({ code, key: mods.key ?? code, ctrl: mods.ctrl ?? false, shift: mods.shift ?? false, alt: mods.alt ?? false });
    this.input.keyUp(code, { ctrl: false, shift: false, alt: false });
  }
}

/** Durée d'une image affichée simulée (60 Hz). */
export const FRAME_MS = 1000 / 60;

/**
 * Simule `ms` millisecondes d'images à 60 Hz. Après chaque image attend un éventuel chargement de scène (lectures de fichiers
 * réelles), comme le ferait le navigateur entre deux images.
 */
export async function runFor(engine: Engine, host: TestHost, ms: number, onFrame?: (elapsedMs: number) => void): Promise<void> {
  const start = host.time;
  const end = start + ms;
  while (host.time < end - 1e-9) {
    host.time += FRAME_MS;
    engine.frame(host.time);
    onFrame?.(host.time - start);
    const loading = engine.whenLoaded;
    if (loading) await loading;
  }
}

/** Simule des images jusqu'à ce que `done()` soit vrai (échoue après `limitMs`). */
export async function runUntil(engine: Engine, host: TestHost, done: () => boolean, limitMs = 120_000): Promise<void> {
  const end = host.time + limitMs;
  while (!done()) {
    if (host.time >= end) throw new Error(`condition non atteinte après ${limitMs} ms simulées`);
    await runFor(engine, host, FRAME_MS);
  }
}
