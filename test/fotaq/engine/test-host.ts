import { FakeStorage } from "../../support/fake-host";
import { TICK_MS } from "../../../src/games/fotaq/engine/cadence";
import type { FotaqAction, FotaqHost, FotaqInput } from "../../../src/games/fotaq/engine/host";
import { FotaqEngine, type FotaqEngineOptions } from "../../../src/games/fotaq/engine/loop";
import { FotaqCutaways } from "../../../src/games/fotaq/engine/cutaway";
import { FotaqTalk } from "../../../src/games/fotaq/engine/dialogs";
import { StubCutaways, StubStage, StubTalk } from "../../../src/games/fotaq/engine/services";
import { GameStage } from "../../../src/games/fotaq/engine/stage";
import { type GameData, JoeWalk, loadGameData } from "../../../src/games/fotaq/engine/state";
import type { Sequence } from "../../../src/engine/sequence";
import { readManifest, readOriginal } from "../helpers";

/** Données du jeu lues une fois pour tous les tests. */
let sharedData: GameData | null = null;
export function gameData(): GameData {
  sharedData ??= loadGameData((name) => readOriginal(name.toUpperCase()));
  return sharedData;
}

/** Chemins de `files.json` par nom en majuscules, lus une fois. */
let paths: Map<string, string> | null = null;
let sizes: Map<string, number> | null = null;
function manifestPaths(): Map<string, string> {
  paths ??= new Map(readManifest().map((entry) => [entry.path.toUpperCase(), entry.path]));
  return paths;
}

/** Durée d'une voix en ms : les MP3 de `voices/` sont à débit constant de 24 kb/s (D1), donc la taille donne la durée. */
export function voiceDurationMs(name: string): number | undefined {
  sizes ??= new Map(readManifest().map((entry) => [entry.path.toUpperCase(), entry.size]));
  const size = sizes.get(`VOICES/${name.toUpperCase()}.MP3`);
  return size === undefined ? undefined : Math.round((size * 8) / 24);
}

/** Hôte de test : fichiers de `original/fotaq/` (noms insensibles à la casse), horloge manuelle, morceaux et entrées enregistrés. */
export class TestHost implements FotaqHost {
  /** Les fichiers d'un décor sont-ils prêts (`roomFilesReady`) ? Absent : toujours. */
  roomFilesReady?: (files: readonly string[]) => boolean;
  readonly storage = new FakeStorage();
  clock = 0;
  exits = 0;
  journals = 0;
  /** Morceaux demandés (`playSong`), dans l'ordre. */
  readonly songs: number[] = [];
  /** Voix demandées (`playSpeech`) : nom, et durée de la voix (`undefined` : fichier absent), dans l'ordre. */
  readonly spoken: { name: string; duration: number | undefined; start: number }[] = [];
  /** Les voix sont actives (faux : `playSpeech` ne trouve rien, les répliques durent le temps du texte). */
  voices = true;
  speechStops = 0;
  sfxStops = 0;
  /** Listes de voix demandées au préchargement. */
  readonly preloads: (readonly string[])[] = [];
  private speechEnd = 0;
  private readonly queue: FotaqInput[] = [];

  now(): number {
    return this.clock;
  }

  exit(): void {
    this.exits++;
  }

  readFile(name: string): Uint8Array {
    const path = manifestPaths().get(name.toUpperCase());
    if (!path) throw new Error(`fichier absent : ${name}`);
    return readOriginal(path);
  }

  fileExists(name: string): boolean {
    return manifestPaths().has(name.toUpperCase());
  }

  /** Dernière image présentée (`present`). */
  readonly frames: { pixels: Uint8Array; palette: Uint8Array }[] = [];

  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.frames.push({ pixels: pixels.slice(), palette: palette.slice() });
    if (this.frames.length > 4) this.frames.shift();
  }

  pollInput(): readonly FotaqInput[] {
    return this.queue.splice(0);
  }

  playSong(song: number): void {
    this.songs.push(song);
  }

  playSpeech(name: string): boolean {
    const duration = this.voices ? voiceDurationMs(name) : undefined;
    this.spoken.push({ name, duration, start: this.clock });
    this.speechEnd = duration === undefined ? 0 : this.clock + duration;
    return duration !== undefined;
  }

  speechActive(): boolean {
    return this.clock < this.speechEnd;
  }

  stopSpeech(): void {
    this.speechStops++;
    this.speechEnd = 0;
  }

  stopSfx(): void {
    this.sfxStops++;
  }

  preloadSpeech(names: readonly string[]): void {
    this.preloads.push(names);
  }

  openJournal(): void {
    this.journals++;
  }

  push(input: FotaqInput): void {
    this.queue.push(input);
  }
}

/** Un joueur devant le moteur : il fait avancer le temps, clique, tape et attend la fin des séquences. */
export class Player {
  readonly host = new TestHost();
  readonly stage = new StubStage();
  readonly talk = new StubTalk();
  readonly cutaways = new StubCutaways();
  readonly engine: FotaqEngine;

  constructor(options: FotaqEngineOptions = {}) {
    this.engine = new FotaqEngine(this.host, {
      data: gameData(),
      seed: 1,
      stage: this.stage,
      talk: this.talk,
      cutaways: this.cutaways,
      ...options,
    });
  }

  get state() {
    return this.engine.state;
  }

  /** Avance de `ticks` ticks (l'horloge de l'hôte suit). */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.host.clock += TICK_MS;
      this.engine.tick();
    }
  }

  /** Avance jusqu'à ce que la boucle principale ait la main sans rien à faire ; lève au-delà de `max` ticks. */
  settle(max = 2_000): number {
    for (let i = 0; i < max; i++) {
      this.run(1);
      if (!this.engine.busy && this.state.newRoom === 0 && this.engine.joeWalk !== JoeWalk.Execute) return i;
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

  /** Clic (gauche par défaut) bref au point d'écran, après une image de survol ; attend que l'action soit jouée. */
  click(x: number, y: number, button = 1): void {
    this.move(x, y);
    this.run(1);
    this.move(x, y, button);
    this.move(x, y, 0);
    this.settle();
  }

  /** Clic au milieu de la zone de l'objet du jeu `object` (pièce courante, sans défilement). */
  clickObject(object: number, button = 1): void {
    const box = this.engine.data.jas.objectBoxes[object];
    this.click(Math.trunc((box.x1 + box.x2) / 2), Math.trunc((box.y1 + box.y2) / 2), button);
  }

  /** Clic sur le verbe `n` du panneau (1 à 8 : ouvrir, fermer, déplacer, donner, examiner, prendre, parler, utiliser). */
  clickVerb(n: number): void {
    this.click((n - 1) * 20 + 10, 175);
  }

  /** Clic sur la case d'inventaire `slot` (0 à 3). */
  clickInventory(slot: number, button = 1): void {
    this.click([196, 231, 267, 302][slot], 175, button);
  }

  action(action: FotaqAction): void {
    this.host.push({ type: "action", action });
    this.settle();
  }
}

/** Un joueur avec la vraie scène, les vraies répliques et les vraies cinématiques (vagues T et C). */
export function realPlayer(options: FotaqEngineOptions = {}) {
  const stage = new GameStage();
  const talk = new FotaqTalk();
  const cutaways = new FotaqCutaways();
  const player = new Player({ stage, talk, cutaways, ...options });
  return { player, stage, talk, cutaways, engine: player.engine, host: player.host, state: player.state };
}
