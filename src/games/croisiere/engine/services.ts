/**
 * Services injectés dans le moteur sans tête : sortie de l'image (hôte) et son (vague A).
 *
 * Le moteur garde toute la logique, et la composition de l'image en fait partie (`render/draw.ts`, toujours exécutée : état du
 * rastériseur partagé avec le hit-test et la marche, incrustations dans les fonds, placement des menus). Le rendu injecté ne fait que
 * présenter `display.globalScreen` (320 × 200 indices) avec `display.hardwarePalette` (768 octets RGB) ; `NullRenderer` ne présente
 * rien. Le son par défaut (`NullSound`) tient l'état logique de la musique, ce qui suffit aux tests sans tête et à la trace.
 *
 * Références : `gfxModule.cpp` (`gfxModuleData_flipScreen`, `gfxModuleData_updateScreen`), `mainDraw.cpp` (`flipScreen`, `fadeIn`),
 * `function.cpp::Op_FadeOut`, `sound.cpp` (`PCSound`) de ScummVM (GPL v3+).
 */
import type { CroisiereSoundState } from "../audio/sound";
import type { Cell } from "./cells";
import type { EngineState } from "./state";

export interface CroisiereRenderer {
  /**
   * Présentation (`updateScreen`) : à chaque `flipScreen`, à chaque pas des fondus et à l'affichage de la pause. L'image est
   * `e.display.globalScreen`, la palette `e.display.hardwarePalette`.
   */
  present?(e: EngineState): void;
  /** Avis de libération du texte rendu d'une cellule (`freeGfx`) ; rien à faire, le texte est un objet ordinaire. */
  freeText?(cell: Cell): void;
}

/** Aucune présentation : le moteur compose l'image sans l'afficher. */
export class NullRenderer implements CroisiereRenderer {}

export interface CroisiereSound {
  loadMusic(name: string): void;
  playMusic(): void;
  stopMusic(): void;
  removeMusic(): void;
  fadeSong(): void;
  songLoaded(): boolean;
  songPlayed(): boolean;
  isPlaying(): boolean;
  musicName(): string;
  numOrders(): number;
  setNumOrders(n: number): void;
  setPattern(offset: number, value: number): void;
  musicLooping(): boolean;
  musicLoop(loop: boolean): void;
  getVolume(): number;
  setVolume(volume: number): void;
  /** Bruitage : instrument `.ADL` chargé dans la base de fichiers (`playSound`). */
  playSound(data: Uint8Array, size: number, volume: number): void;
  stopChannel(channel: number): void;
  startNote(channel: number, volume: number, freq: number): void;
  /** Temps virtuel écoulé (ms) : le pilote compte ses pas de 20 ms dessus (D7). */
  elapse(ms: number): void;
  /** État musical d'une sauvegarde (`PCSoundFxPlayer::doSync`). */
  saveState(): CroisiereSoundState;
  /** Reprise d'une sauvegarde : le morceau sauvegardé est rechargé (sans être relancé), puis sa position. */
  restoreState(state: CroisiereSoundState): void;
}

/**
 * Son muet qui garde l'état que lisent les scripts (nom du morceau, chargé, joué, ordres, volume).
 * Écart connu (vague A) : le fondu (`fadeSong`) n'avance pas en pas de 20 ms ; il termine le morceau tout de suite.
 */
export class NullSound implements CroisiereSound {
  private name = "";
  private loaded = false;
  private playing = false;
  private played = false;
  private looping = true;
  private orders = 0;
  private volume = 0;

  loadMusic(name: string): void {
    this.name = name;
    this.loaded = true;
    this.played = false;
  }
  playMusic(): void {
    this.playing = true;
  }
  stopMusic(): void {
    this.playing = false;
  }
  removeMusic(): void {
    this.name = "";
    this.loaded = false;
  }
  fadeSong(): void {
    this.playing = false;
    this.played = true;
  }
  songLoaded(): boolean {
    return this.loaded;
  }
  songPlayed(): boolean {
    return this.played;
  }
  isPlaying(): boolean {
    return this.playing;
  }
  musicName(): string {
    return this.name;
  }
  numOrders(): number {
    return this.orders;
  }
  setNumOrders(n: number): void {
    this.orders = n;
  }
  setPattern(): void {}
  musicLooping(): boolean {
    return this.looping;
  }
  musicLoop(loop: boolean): void {
    this.looping = loop;
  }
  getVolume(): number {
    return this.volume;
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  playSound(): void {}
  stopChannel(): void {}
  startNote(): void {}
  elapse(): void {}
  saveState(): CroisiereSoundState {
    return {
      musicName: this.name, loaded: this.loaded, songPlayed: this.played, looping: this.looping, currentPos: 0, currentOrder: 0,
      playing: this.playing, genVolume: this.volume,
    };
  }
  restoreState(state: CroisiereSoundState): void {
    this.name = state.musicName;
    this.loaded = state.loaded;
    this.played = state.songPlayed;
    this.looping = state.looping;
    this.playing = state.playing;
    this.volume = state.genVolume;
  }
}
