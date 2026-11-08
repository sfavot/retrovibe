import { FakeStorage } from "../../support/fake-host";
import { FRAME_TICKS, TICK_MS } from "../../../src/games/drascula/engine/cadence";
import type { DrasculaHost, DrasculaInput } from "../../../src/games/drascula/engine/host";
import { DrasculaEngine, type DrasculaEngineOptions } from "../../../src/games/drascula/engine/loop";
import type { Sequence } from "../../../src/engine/sequence";
import { readManifest, readOriginal } from "../helpers";

/** Fréquence des `.ALS` et marges de silence sautées par le jeu (`formats.md`). */
const ALS_RATE = 11025;
const ALS_MARGINS = 64;

/**
 * Hôte de test : fichiers de `original/drascula/` (noms insensibles à la casse), horloge manuelle, sons simulés (un son dure
 * le temps de ses échantillons), musique et entrées enregistrées.
 */
export class TestHost implements DrasculaHost {
  readonly storage = new FakeStorage();
  clock = 0;
  exits = 0;
  /** Sons demandés, dans l'ordre (`214.als`, `s3.als`). */
  readonly sounds: string[] = [];
  /** Pistes demandées (`playMusic`). */
  readonly music: number[] = [];
  /** Volumes de musique demandés (fondu de fin de chapitre), dans l'ordre. */
  readonly volumes: number[] = [];
  /** Dernière image présentée (tableaux du moteur, valables jusqu'au tick suivant) et nombre d'images présentées. */
  screen: Uint8Array | null = null;
  screenPalette: Uint8Array | null = null;
  presented = 0;
  private soundEnd = 0;
  private musicOn = false;
  private readonly queue: DrasculaInput[] = [];
  private readonly sizes = new Map<string, { path: string; size: number }>();
  private readonly cache = new Map<string, Uint8Array>();

  constructor() {
    for (const entry of readManifest()) this.sizes.set(entry.path.toUpperCase(), entry);
  }

  now(): number {
    return this.clock;
  }

  exit(): void {
    this.exits++;
  }

  readFile(name: string): Uint8Array {
    const entry = this.sizes.get(name.toUpperCase());
    if (!entry) throw new Error(`fichier absent : ${name}`);
    let bytes = this.cache.get(entry.path);
    if (!bytes) this.cache.set(entry.path, (bytes = readOriginal(entry.path)));
    return bytes;
  }

  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.screen = pixels;
    this.screenPalette = palette;
    this.presented++;
  }

  pollInput(): readonly DrasculaInput[] {
    return this.queue.splice(0);
  }

  playSound(name: string): boolean {
    this.sounds.push(name.toLowerCase());
    const entry = this.sizes.get(name.toUpperCase());
    if (!entry) {
      this.soundEnd = 0;
      return false;
    }
    this.soundEnd = this.clock + ((entry.size - ALS_MARGINS) * 1000) / ALS_RATE;
    return true;
  }

  stopSound(): void {
    this.soundEnd = 0;
  }

  soundActive(): boolean {
    return this.clock < this.soundEnd;
  }

  playMusic(track: number): void {
    this.music.push(track);
    this.musicOn = true;
  }

  stopMusic(): void {
    this.musicOn = false;
  }

  musicPlaying(): boolean {
    return this.musicOn;
  }

  setMusicVolume(level: number): void {
    this.volumes.push(level);
  }

  push(input: DrasculaInput): void {
    this.queue.push(input);
  }
}

/** Un joueur devant le moteur : il fait avancer le temps, clique, tape et attend la fin des séquences. */
export class Player {
  readonly host = new TestHost();
  readonly engine: DrasculaEngine;

  constructor(options: DrasculaEngineOptions = {}) {
    this.engine = new DrasculaEngine(this.host, { seed: 1, ...options });
  }

  get state() {
    return this.engine.state;
  }

  get hero() {
    return this.engine.state.hero;
  }

  /** Avance de `ticks` ticks (l'horloge de l'hôte suit). */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.host.clock += TICK_MS;
      this.engine.tick();
    }
  }

  /** Avance jusqu'à ce que la boucle principale ait la main et que le héros soit arrêté ; lève au-delà de `max` ticks. */
  settle(max = 20_000): number {
    for (let i = 0; i < max; i++) {
      if (!this.engine.busy && !this.hero.moving) {
        this.run(1);
        if (!this.engine.busy && !this.hero.moving) return i;
      }
      this.run(1);
    }
    throw new Error(`le jeu ne s'est pas arrêté en ${max} ticks`);
  }

  /** Lance une séquence et attend sa fin. */
  perform(sequence: Sequence<unknown>): void {
    this.engine.run(sequence);
    this.settle();
  }

  move(x: number, y: number, buttons = 0): void {
    this.host.push({ type: "pointer", x, y, buttons });
  }

  /**
   * Clic gauche bref (appui et relâchement dans le même tick), après avoir amené la souris au point le temps d'une image ; rend
   * la main une fois le clic traité par la boucle principale.
   */
  click(x: number, y: number): void {
    this.move(x, y);
    this.run(FRAME_TICKS);
    this.move(x, y, 1);
    this.move(x, y, 0);
    this.run(FRAME_TICKS); // l'image suivante de la boucle principale traite le clic
  }

  rightClick(x = 160, y = 100): void {
    this.move(x, y, 2);
    this.move(x, y, 0);
    this.run(1);
  }

  key(key: string): void {
    this.host.push({ type: "key", key });
    this.run(1);
  }
}
