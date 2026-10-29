import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AudioSink, MidiSink, PcmSound, WaveHandle } from "../../src/engine/mohawk/audio/sink";
import type { Frame } from "../../src/engine/mohawk/graphics/frame";
import type { HostFontSpec, HostText, HostTextMetrics, TextMask } from "../../src/engine/mohawk/host";
import { Input, type MouseButton } from "../../src/engine/mohawk/input";
import type { TextInputPort } from "../../src/engine/mohawk/text-input";
import { GameFiles, type GameFileEntry } from "../../src/games/zoombinis/data/files";
import type { ZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import type { CursorKind, Host, VideoPlayback } from "../../src/games/zoombinis/engine/host";
import { FakeStorage } from "../support/fake-host";

const ORIGINAL = resolve(import.meta.dirname, "../../original/zoombinis");

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

/** Puits audio factice : enregistre les appels ; un WAVE joue tant que sa durée n'est pas écoulée (ou en boucle). */
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

/**
 * Texte factice à chasse fixe : chaque caractère fait `round(0,6 × h)` de large (h = |hauteur|) et la cellule est pleine (tous les
 * pixels d'encre), ascendante `round(0,8 × h)`. Sert à tester la mise en page sans police.
 */
export class FakeText implements HostText {
  charWidth(font: HostFontSpec): number {
    return Math.round(0.6 * Math.abs(font.height));
  }

  metrics(font: HostFontSpec): HostTextMetrics {
    const height = Math.abs(font.height);
    const ascent = Math.round(0.8 * height);
    return { ascent, descent: height - ascent, lineHeight: height };
  }

  measure(font: HostFontSpec, text: string): number {
    return text.length * this.charWidth(font);
  }

  rasterize(font: HostFontSpec, text: string): TextMask {
    const { ascent, lineHeight } = this.metrics(font);
    const width = this.measure(font, text);
    return { width, height: lineHeight, ascent, bits: new Uint8Array(width * lineHeight).fill(1) };
  }
}

/** Champ de saisie invisible factice : `emit(texte)` simule du texte arrivé par le clavier virtuel ou une composition. */
export class FakeTextInput implements TextInputPort {
  focused = false;
  /** Nombre d'appels à `focus()` et à `blur()`. */
  focusCalls = 0;
  blurCalls = 0;
  private readonly listeners = new Set<(text: string) => void>();

  get subscribed(): boolean {
    return this.listeners.size > 0;
  }

  focus(): void {
    this.focused = true;
    this.focusCalls++;
  }

  blur(): void {
    this.focused = false;
    this.blurCalls++;
  }

  onText(callback: (text: string) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(text: string): void {
    for (const listener of [...this.listeners]) listener(text);
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

/** Film lancé sur l'hôte factice : fini par `finish()` (fin naturelle) ou `stop()` (arrêt demandé par la scène). */
export class FakeVideo implements VideoPlayback {
  ended = false;
  /** Arrêté par `stop()` (et non fini de lui-même). */
  stopped = false;

  constructor(readonly path: string) {}

  stop(): void {
    if (this.ended) return;
    this.ended = true;
    this.stopped = true;
  }

  /** Fin naturelle du film. */
  finish(): void {
    this.ended = true;
  }
}

/**
 * Hôte de test : temps simulé (`time`, ms), entrées pilotables, audio factice, stockage en mémoire, images capturées.
 * `loadFile` lit d'abord `virtualFiles`, puis `original/zoombinis/` (résolution insensible à la casse).
 */
export class TestHost implements Host {
  time = 0;
  /** Horloge murale simulée (source de la graine par défaut). */
  unix = 1_700_000_000_000;
  readonly input = new Input();
  readonly audio = new FakeAudio(() => this.time);
  readonly storage = new FakeStorage();
  readonly text = new FakeText();
  readonly textInput = new FakeTextInput();
  readonly frames: CapturedFrame[] = [];
  readonly cursors: CursorKind[] = [];
  /** Chemins demandés à `loadFile`, dans l'ordre. */
  readonly loaded: string[] = [];
  /** Films demandés à `playVideo`, dans l'ordre. */
  readonly videos: FakeVideo[] = [];
  /** Faux : `playVideo` rend un film déjà fini (fichier absent ou lecture impossible dans le navigateur). */
  videoPlayable = true;
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

  playVideo(path: string): VideoPlayback {
    const video = new FakeVideo(path);
    if (!this.videoPlayable) video.finish();
    this.videos.push(video);
    return video;
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

  get cursor(): CursorKind | undefined {
    return this.cursors[this.cursors.length - 1];
  }

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

/** Simule `ms` millisecondes d'images à 60 Hz, en attendant les chargements d'écran entre deux images. */
export async function runFor(engine: ZoombinisEngine, host: TestHost, ms: number): Promise<void> {
  const end = host.time + ms;
  while (host.time < end - 1e-9) {
    host.time += FRAME_MS;
    engine.frame(host.time);
    const loading = engine.whenLoaded;
    if (loading) await loading;
  }
}
