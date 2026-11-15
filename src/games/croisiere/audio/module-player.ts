/**
 * Lecteur des modules musicaux `CORPn` de Croisière pour un cadavre : ordres, lignes de motif, tempo, fondu et état de sauvegarde.
 *
 * Référence : `engines/cruise/sound.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `PCSoundFxPlayer` (`load`, `play`, `stop`, `unload`,
 * `fadeOut`, `update`, `handleEvents`, `handlePattern`, `doSync`) ; lu puis réécrit. Disposition du module : `data/music.ts`.
 *
 * Écarts volontaires : pas de minuterie ni de `delayMillis` : `update()` est le callback de 50 Hz et c'est l'appelant qui le cadence
 * (plan.md D7) ; l'attente de la fin d'un fondu avant `load` (boucle active de ScummVM) revient à l'appelant (`CroisiereSound.loadSong`) ;
 * le module est copié dans un tampon complété de zéros, car ScummVM lit au-delà de la fin du fichier (numéro de motif tronqué à 16 bits
 * puis tas) ; un module introuvable lève `loadFile` à `undefined` : `load` rend faux et laisse la place nette, comme `warning` + `return 0`.
 * Conservé : les ordres tournent toujours (la fin d'un module n'arrête rien, seul le fondu arrête) ; `stop()` décharge et pose `songPlayed`
 * même si rien ne jouait ; `SongSize` ne prend effet qu'au prochain `play` (`_numOrders` est lu à ce moment).
 */
import { adlFileName } from "../data/music";
import type { AdlibDriver } from "./adlib-driver";

export const MODULE_CHANNELS = 4;
export const MODULE_INSTRUMENTS = 15;
const NUM_ORDERS_OFFSET = 470;
const TEMPO_OFFSET = 471;
const ORDER_TABLE_OFFSET = 472;
const INSTRUMENT_CARD_OFFSET = 20;
const INSTRUMENT_CARD_SIZE = 30;
const INSTRUMENT_NAME_SIZE = 12;
const PATTERNS_OFFSET = 600 + 1800;
const PATTERN_SIZE = 1024;
const ROW_SIZE = 16;
/** `char _musicName[33]` : 32 caractères et le zéro final. */
export const MUSIC_NAME_SIZE = 33;
/** Un fondu s'achève (module arrêté et déchargé) quand son compteur atteint 100. */
const FADE_END = 100;
const FADE_STEP = 2;
/** Plus grande lecture possible : motif `uint16` tronqué, ligne et voix. */
const READ_LIMIT = PATTERNS_OFFSET + 0x10000 + PATTERN_SIZE + ROW_SIZE;

/** Lit un fichier dépacké du jeu par son nom (majuscules) ; `undefined` s'il est absent. */
export type SoundFileLoader = (name: string) => Uint8Array | undefined;

/** État de `PCSoundFxPlayer::doSync` (entiers 16 bits petit-boutistes dans la sauvegarde). */
export interface ModulePlayerState {
  musicName: string;
  loaded: boolean;
  songPlayed: boolean;
  looping: boolean;
  currentPos: number;
  currentOrder: number;
  playing: boolean;
}

export class ModulePlayer {
  private musicName = "";
  private playing = false;
  private songPlayedFlag = false;
  private currentPos = 0;
  private currentOrder = 0;
  private numOrdersAtPlay = 0;
  private eventsDelay = 0;
  private loopingFlag = false;
  private fadeOutCounter = 0;
  private updateTicksCounter = 0;
  private readonly instrumentsChannelTable: number[] = [-1, -1, -1, -1];
  private sfxData: Uint8Array | null = null;
  private readonly instrumentsData: (Uint8Array | null)[] = Array.from({ length: MODULE_INSTRUMENTS }, () => null);

  constructor(
    private readonly driver: AdlibDriver,
    private readonly loadFile: SoundFileLoader,
  ) {}

  get songLoaded(): boolean {
    return this.sfxData !== null;
  }

  get songPlayed(): boolean {
    return this.songPlayedFlag;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Vrai pendant un fondu en cours (`load` d'origine attend sa fin). */
  get fading(): boolean {
    return this.fadeOutCounter !== 0 && this.fadeOutCounter < FADE_END;
  }

  get name(): string {
    return this.musicName;
  }

  get looping(): boolean {
    return this.loopingFlag;
  }

  set looping(value: boolean) {
    this.loopingFlag = value;
  }

  /** Nombre d'ordres du module chargé (octet 470). */
  get numOrders(): number {
    return this.requireData()[NUM_ORDERS_OFFSET]!;
  }

  setNumOrders(value: number): void {
    this.requireData()[NUM_ORDERS_OFFSET] = value;
  }

  setPattern(offset: number, value: number): void {
    this.requireData()[ORDER_TABLE_OFFSET + offset] = value;
  }

  private requireData(): Uint8Array {
    if (!this.sfxData) throw new Error("ModulePlayer : aucun module chargé");
    return this.sfxData;
  }

  /** `load` : arrête le morceau en cours, lit le module et ses timbres `.ADL`. Rend faux si le module est absent. */
  load(song: string): boolean {
    this.fadeOutCounter = 0;
    if (this.playing) this.stop();
    this.musicName = song.slice(0, MUSIC_NAME_SIZE - 1);
    this.songPlayedFlag = false;
    this.loopingFlag = false;
    const file = this.loadFile(song);
    if (!file) {
      this.sfxData = null;
      return false;
    }
    const data = new Uint8Array(Math.max(file.length, READ_LIMIT));
    data.set(file);
    this.sfxData = data;
    for (let i = 0; i < MODULE_INSTRUMENTS; i++) {
      this.instrumentsData[i] = null;
      const base = INSTRUMENT_CARD_OFFSET + i * INSTRUMENT_CARD_SIZE;
      let end = base;
      while (end < base + INSTRUMENT_NAME_SIZE && data[end] !== 0) end++;
      if (end > base) {
        let name = "";
        for (let k = base; k < end; k++) name += String.fromCharCode(data[k]!);
        this.instrumentsData[i] = this.loadFile(adlFileName(name)) ?? null;
      }
    }
    return true;
  }

  /** `play` : départ au premier ordre ; sans module chargé, ne fait rien. */
  play(): void {
    const data = this.sfxData;
    if (!data) return;
    this.instrumentsChannelTable.fill(-1);
    this.currentPos = 0;
    this.currentOrder = 0;
    this.numOrdersAtPlay = data[NUM_ORDERS_OFFSET]!;
    this.eventsDelay = Math.trunc(((244 - data[TEMPO_OFFSET]!) * 100) / 1060);
    this.updateTicksCounter = 0;
    this.playing = true;
  }

  /** `stop` : coupe les quatre voix et tous les opérateurs si le morceau jouait ou fondait, puis décharge (`songPlayed` devient vrai). */
  stop(): void {
    if (this.playing || this.fadeOutCounter !== 0) {
      this.fadeOutCounter = 0;
      this.playing = false;
      for (let i = 0; i < MODULE_CHANNELS; i++) this.driver.stopChannel(i);
      this.driver.stopAll();
    }
    this.unload();
  }

  unload(): void {
    this.instrumentsData.fill(null);
    this.sfxData = null;
    this.songPlayedFlag = true;
  }

  /** `fadeOut` : sans effet si le morceau ne joue pas ; `update` finit le fondu (`stop`) au cinquantième pas. */
  fadeOut(): void {
    if (this.playing) {
      this.fadeOutCounter = 1;
      this.playing = false;
    }
  }

  /** `update`, le callback de la minuterie de 50 Hz : une ligne de motif tous les `eventsDelay + 1` ticks. */
  update(): void {
    if (this.playing || this.fading) {
      this.updateTicksCounter++;
      if (this.updateTicksCounter > this.eventsDelay) {
        this.handleEvents();
        this.updateTicksCounter = 0;
      }
    }
  }

  private handleEvents(): void {
    const data = this.sfxData!;
    // `uint16 patternNum = ordre * 1024` : tronqué à 16 bits
    const patternNum = (data[ORDER_TABLE_OFFSET + this.currentOrder]! * PATTERN_SIZE) & 0xffff;
    for (let i = 0; i < MODULE_CHANNELS; i++) {
      this.handlePattern(i, PATTERNS_OFFSET + i * 4 + patternNum + this.currentPos);
    }
    if (this.fading) this.fadeOutCounter += FADE_STEP;
    if (this.fadeOutCounter >= FADE_END) {
      this.stop();
      return;
    }
    this.currentPos += ROW_SIZE;
    if (this.currentPos >= PATTERN_SIZE) {
      this.currentPos = 0;
      this.currentOrder++;
      if (this.currentOrder === this.numOrdersAtPlay) this.currentOrder = 0;
    }
  }

  private handlePattern(channel: number, at: number): void {
    const data = this.sfxData!;
    let instrument = data[at + 2]! >> 4;
    if (instrument !== 0) {
      instrument--;
      if (this.instrumentsChannelTable[channel] !== instrument || this.fadeOutCounter !== 0) {
        this.instrumentsChannelTable[channel] = instrument;
        const volume = data[instrument]! - this.fadeOutCounter;
        this.driver.setupChannel(channel, this.instrumentsData[instrument] ?? null, volume);
      }
    }
    const freq = (((data[at]! << 8) | data[at + 1]!) << 16) >> 16;
    if (freq > 0) {
      this.driver.stopChannel(channel);
      this.driver.setChannelFrequency(channel, freq);
    }
  }

  /** Partie du `doSync` écrite dans une sauvegarde. */
  getState(): ModulePlayerState {
    return {
      musicName: this.musicName,
      loaded: this.songLoaded,
      songPlayed: this.songPlayedFlag,
      looping: this.loopingFlag,
      currentPos: this.currentPos,
      currentOrder: this.currentOrder,
      playing: this.playing,
    };
  }

  /**
   * Partie lecture du `doSync` : le nom est repris, le module est rechargé s'il l'était (sans lancer `play` : les timbres des voix sont
   * reprogrammés au prochain événement), puis les cinq états. Sans module sauvegardé, l'éventuel module en mémoire reste (comme ScummVM).
   * L'appelant a attendu la fin d'un éventuel fondu.
   */
  setState(state: ModulePlayerState): void {
    this.musicName = state.musicName.slice(0, MUSIC_NAME_SIZE - 1);
    if (state.loaded) {
      if (!this.load(this.musicName)) throw new Error(`ModulePlayer : module ${this.musicName} introuvable`);
      this.instrumentsChannelTable.fill(-1);
      this.numOrdersAtPlay = this.sfxData![NUM_ORDERS_OFFSET]!;
      this.eventsDelay = Math.trunc(((244 - this.sfxData![TEMPO_OFFSET]!) * 100) / 1060);
      this.updateTicksCounter = 0;
    }
    this.songPlayedFlag = state.songPlayed;
    this.loopingFlag = state.looping;
    this.currentPos = state.currentPos;
    this.currentOrder = state.currentOrder;
    this.playing = state.playing;
  }
}
