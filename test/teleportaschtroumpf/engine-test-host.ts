import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AudioBackend, PcmSound } from "../../src/games/teleportaschtroumpf/audio/backend";
import { GameFiles, type GameFileEntry } from "../../src/games/teleportaschtroumpf/data/files";
import type { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import type { Host, HostStorage } from "../../src/games/teleportaschtroumpf/engine/host";
import { Input } from "../../src/games/teleportaschtroumpf/engine/input";
import { resolveGameFile } from "../../src/games/teleportaschtroumpf/engine/paths";

const ORIGINAL = resolve(import.meta.dirname, "../../original/teleportaschtroumpf");

/** Un son lancé sur la voie factice. */
export interface PlayedSound {
  sound: PcmSound;
  loop: boolean;
  /** Temps (ms) du lancement. */
  at: number;
}

/**
 * Voie son factice : enregistre les lancements et simule la lecture d'après un temps injecté
 * (`position` = temps écoulé depuis le lancement, `playing` faux une fois la durée dépassée, sauf en boucle).
 */
export class FakeAudio implements AudioBackend {
  readonly plays: PlayedSound[] = [];
  stops = 0;
  gain = 1;
  unlocked = false;
  /** Si faux, simule une sortie verrouillée : rien ne joue. */
  enabled = true;
  /** Bruitages mélangés lancés (`playEffect`), dans l'ordre. */
  readonly effects: PlayedSound[] = [];
  effectStops = 0;
  private current: PlayedSound | null = null;
  private currentEffect: PlayedSound | null = null;

  constructor(private readonly nowMs: () => number) {}

  unlock(): void {
    this.unlocked = true;
  }

  play(sound: PcmSound, loop: boolean): void {
    this.current = null;
    if (!this.enabled) return;
    this.current = { sound, loop, at: this.nowMs() };
    this.plays.push(this.current);
  }

  stop(): void {
    this.stops++;
    this.current = null;
  }

  playEffect(sound: PcmSound): void {
    this.currentEffect = null;
    if (!this.enabled) return;
    this.currentEffect = { sound, loop: false, at: this.nowMs() };
    this.effects.push(this.currentEffect);
  }

  stopEffect(): void {
    this.effectStops++;
    this.currentEffect = null;
  }

  get effectPlaying(): boolean {
    const e = this.currentEffect;
    return !!e && (this.nowMs() - e.at) / 1000 < e.sound.samples.length / e.sound.sampleRate;
  }

  private elapsed(): number {
    return this.current ? (this.nowMs() - this.current.at) / 1000 : 0;
  }

  get playing(): boolean {
    const c = this.current;
    if (!c) return false;
    return c.loop || this.elapsed() < c.sound.samples.length / c.sound.sampleRate;
  }

  get position(): number {
    const c = this.current;
    if (!c) return 0;
    const duration = c.sound.samples.length / c.sound.sampleRate;
    return c.loop ? this.elapsed() % duration : Math.min(this.elapsed(), duration);
  }

  setGain(gain: number): void {
    this.gain = gain;
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
}

export interface Presentation {
  surface: Uint8Array;
  palette: Uint8Array;
  at: number;
}

/**
 * Hôte de test : lit `original/teleportaschtroumpf/` sur disque, temps simulé (`time`, en ms), entrées pilotables
 * (`input`), sons et présentations enregistrés.
 */
export class TestHost implements Host {
  time = 0;
  seconds = 1_700_000_000;
  readonly input = new Input();
  readonly audio = new FakeAudio(() => this.time);
  readonly storage = new MemoryStorage();
  readonly presentations: Presentation[] = [];
  readonly loaded: string[] = [];
  /** Vrai après `exit()` (sortie du jeu). */
  exited = false;
  private files: GameFiles | null = null;

  async loadFile(name: string): Promise<Uint8Array> {
    this.files ??= new GameFiles(JSON.parse(readFileSync(resolve(ORIGINAL, "files.json"), "utf8")) as GameFileEntry[]);
    const path = resolveGameFile(this.files, name);
    if (!path) throw new Error(`fichier introuvable : ${name}`);
    this.loaded.push(path);
    return new Uint8Array(readFileSync(resolve(ORIGINAL, path)));
  }

  now(): number {
    return this.time;
  }

  unixSeconds(): number {
    return this.seconds;
  }

  present(surface: Uint8Array, palette: Uint8Array): void {
    this.presentations.push({ surface: surface.slice(), palette: palette.slice(), at: this.time });
  }

  exit(): void {
    this.exited = true;
  }

  get lastPresentation(): Presentation {
    return this.presentations[this.presentations.length - 1];
  }
}

const FRAME_MS = 1000 / 60;

/** Simule `ms` millisecondes d'images à 60 Hz ; attend les chargements de scène (vraies lectures de fichiers). */
export async function runFor(engine: Engine, host: TestHost, ms: number, onFrame?: (elapsedMs: number) => void): Promise<void> {
  const end = host.time + ms;
  const start = host.time;
  while (host.time < end) {
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
