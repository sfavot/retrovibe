/**
 * Son de Croisière pour un cadavre : façade des fonctions natives de son du moteur (`PlaySong`, `FadeSong`, `PlayFX`...) au-dessus du
 * pilote AdLib et du lecteur de modules.
 *
 * Référence : `engines/cruise/sound.cpp` (`PCSound`) et `function.cpp` (`Op_PlayFX`, `Op_LoopFX`, `Op_StopFX`, `Op_FreqFX`, `Op_LoadSong`,
 * `Op_PlaySong`, `Op_StopSong`, `Op_RestoreSong`, `Op_SongSize`, `Op_SetPattern`, `Op_FadeSong`, `Op_FreeSong`, `Op_SongLoop`, `Op_SongPlayed`,
 * `Op_SetVolume`, `Op_SongExist`, `Op_TrackPos`) de ScummVM (GPL v3+, release 2026.4.0), plus `PCSound::doSync` de `saveload.cpp` ; lu puis réécrit.
 *
 * Écarts volontaires : pas de minuterie ; le moteur appelle `tick()` une fois par tick de 50 Hz de son horloge (plan.md D7), donc `SongPlayed`
 * est déterministe. `loadSong` rend le nombre de ticks que l'attente d'un fondu en cours a consommés (la boucle active `delayMillis(50)` de
 * ScummVM, 2,5 ticks par tour) : le moteur doit les compter sur son horloge. `FreqFX` ne fait rien (`startNote` n'est qu'un « TODO » dans
 * ScummVM). Les arguments de pile des fonctions natives (`popVar`) sont lus par le moteur : seules les valeurs utiles arrivent ici.
 */
import type { OplSink } from "../../../audio/opl-stream";
import { AdlibDriver, DEFAULT_VOLUME, SFX_CHANNEL } from "./adlib-driver";
import { MUSIC_NAME_SIZE, ModulePlayer, type ModulePlayerState, type SoundFileLoader } from "./module-player";

/** Tick de la minuterie OPL de ScummVM (`_opl->start(..., 50)`) et durée de l'attente de `load` (`delayMillis(50)`). */
export const SOUND_TICK_RATE = 50;
const FADE_WAIT_MS = 50;
const TICK_MS = 1000 / SOUND_TICK_RATE;
/** Taille de l'état sérialisé : nom (33 octets) puis 7 entiers de 16 bits petit-boutistes. */
export const SOUND_STATE_SIZE = MUSIC_NAME_SIZE + 7 * 2;

export interface CroisiereSoundState extends ModulePlayerState {
  /** `_genVolume` (`SetVolume`) : jamais utilisé par le jeu d'origine, mais sauvegardé. */
  genVolume: number;
}

export class CroisiereSound {
  private readonly driver: AdlibDriver;
  private readonly player: ModulePlayer;
  private genVolume = 0;
  private tickNumber = 0;

  /** `loadFile` : fichier dépacké des volumes par son nom en majuscules (`CORPn`, `XXX.ADL`) ; `undefined` s'il est absent. */
  constructor(
    private readonly sink: OplSink,
    loadFile: SoundFileLoader,
    musicVolume = DEFAULT_VOLUME,
    sfxVolume = DEFAULT_VOLUME,
  ) {
    this.driver = new AdlibDriver(sink, musicVolume, sfxVolume);
    this.player = new ModulePlayer(this.driver, loadFile);
  }

  /** Numéro du prochain tick (nombre de ticks déjà joués). */
  get ticks(): number {
    return this.tickNumber;
  }

  /** Avance de `count` ticks de 50 Hz (le callback de la minuterie OPL). */
  tick(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.sink.beginTick?.(this.tickNumber);
      this.tickNumber++;
      this.player.update();
    }
  }

  /** Nouveaux volumes 0..255 (`syncSounds`). */
  setVolumes(musicVolume: number, sfxVolume: number): void {
    this.driver.setVolumes(musicVolume, sfxVolume);
  }

  // --- Musique ---

  /** `LoadSong` : le nom est mis en majuscules (33 octets au plus). Rend les ticks consommés par l'attente d'un fondu, 0 sinon. */
  loadSong(name: string): number {
    const waited = this.waitFade();
    this.player.load(name.toUpperCase().slice(0, MUSIC_NAME_SIZE - 1));
    return waited;
  }

  /** `PlaySong` : seulement si le module est chargé et pas déjà joué. */
  playSong(): void {
    if (this.player.songLoaded && !this.player.songPlayed) this.player.play();
  }

  /** `StopSong` : seulement si le morceau joue. */
  stopSong(): void {
    if (this.player.isPlaying) this.player.stop();
  }

  /** `FadeSong` : fondu de 50 lignes (+2 par ligne), puis arrêt, déchargement et `songPlayed`. */
  fadeSong(): void {
    this.player.fadeOut();
  }

  /** `FreeSong` : arrête, puis décharge (le nom reste). */
  freeSong(): void {
    this.player.stop();
    this.player.unload();
  }

  /** `SongPlayed` : vrai une fois le morceau arrêté et déchargé, jusqu'au prochain `LoadSong`. */
  songPlayed(): boolean {
    return this.player.songPlayed;
  }

  get songLoaded(): boolean {
    return this.player.songLoaded;
  }

  get isPlaying(): boolean {
    return this.player.isPlaying;
  }

  /** `SongExist` : vrai si le nom (mis en majuscules) est celui du dernier module chargé, déchargé ou non. */
  songExist(name: string | null): boolean {
    return name !== null && name !== "" && this.player.name === name.toUpperCase().slice(0, MUSIC_NAME_SIZE - 1);
  }

  /**
   * `SongSize` : rend le nombre d'ordres actuel (0 sans module). Si un module est chargé, `readSize` est appelé (le moteur y dépile son argument,
   * ScummVM ne le dépile que dans ce cas) ; une valeur de 1 à 127 devient le nombre d'ordres, pris en compte au prochain `PlaySong`.
   */
  songSize(readSize: () => number): number {
    if (!this.player.songLoaded) return 0;
    const old = this.player.numOrders;
    const size = readSize();
    if (size >= 1 && size < 128) this.player.setNumOrders(size);
    return old;
  }

  /** `SetPattern` : remplace l'entrée `offset` de la table d'ordre (sans effet sans module). */
  setPattern(offset: number, value: number): void {
    if (this.player.songLoaded) this.player.setPattern(offset, value);
  }

  /** `SongLoop` : rend l'ancienne valeur (le jeu d'origine ne s'en sert pas : les modules bouclent toujours). */
  songLoop(value: boolean): boolean {
    const old = this.player.looping;
    this.player.looping = value;
    return old;
  }

  /** `RestoreSong` : sans effet (rend 0 côté moteur). */
  restoreSong(): void {}

  /** `TrackPos` : toujours 0. */
  trackPos(): number {
    return 0;
  }

  /** `SetVolume` : rend l'ancien volume (`>> 2`) ; une valeur de 0 à 63 (plafonnée) devient `63 - valeur`. Sans effet sur le son. */
  setVolume(newVolume: number): number {
    const old = this.genVolume >> 2;
    if (newVolume > 63) newVolume = 63;
    if (newVolume >= 0) this.genVolume = 63 - newVolume;
    return old;
  }

  // --- Bruitages ---

  /** `PlayFX` : `sample` est le timbre `.ADL` chargé de l'entrée (`undefined` : rien ; vitesse et canal du script ignorés). Voix 4, note 48. */
  playFX(sample: Uint8Array | undefined): void {
    if (sample) this.driver.playSample(sample, SFX_CHANNEL);
  }

  /** `LoopFX` : identique à `PlayFX` (pas de boucle). */
  loopFX(sample: Uint8Array | undefined): void {
    this.playFX(sample);
  }

  /** `StopFX` : -1 coupe les voix 0 à 3, sinon la voix donnée (0 à 4). */
  stopFX(channel: number): void {
    if (channel === -1) {
      for (let i = 0; i < 4; i++) this.driver.stopChannel(i);
    } else {
      this.driver.stopChannel(channel);
    }
  }

  /** `FreqFX` : sans effet (voir l'en-tête). */
  freqFX(): void {}

  // --- Sauvegarde ---

  /** État pour une sauvegarde (nom du morceau et position). */
  getState(): CroisiereSoundState {
    return { ...this.player.getState(), genVolume: this.genVolume };
  }

  /** Charge un état : recharge le module sauvegardé s'il y en avait un (après le fondu en cours), rend les ticks d'attente consommés. */
  restoreState(state: CroisiereSoundState): number {
    const waited = this.waitFade();
    this.player.setState(state);
    this.genVolume = state.genVolume;
    return waited;
  }

  /** Sérialise comme `PCSound::doSync` (nom de 33 octets complété de zéros, puis `songLoaded`, `songPlayed`, `looping`, `currentPos`, `currentOrder`, `playing`, `genVolume`). */
  serialize(): Uint8Array {
    const state = this.getState();
    const out = new Uint8Array(SOUND_STATE_SIZE);
    for (let i = 0; i < state.musicName.length && i < MUSIC_NAME_SIZE - 1; i++) out[i] = state.musicName.charCodeAt(i) & 0xff;
    const view = new DataView(out.buffer);
    const values = [state.loaded, state.songPlayed, state.looping, state.currentPos, state.currentOrder, state.playing, state.genVolume];
    values.forEach((v, i) => view.setInt16(MUSIC_NAME_SIZE + 2 * i, Number(v), true));
    return out;
  }

  /** Relit ce que `serialize` a écrit ; rend les ticks d'attente consommés. */
  deserialize(bytes: Uint8Array): number {
    if (bytes.length < SOUND_STATE_SIZE) throw new RangeError(`CroisiereSound : ${bytes.length} octets, ${SOUND_STATE_SIZE} attendus`);
    let end = 0;
    while (end < MUSIC_NAME_SIZE && bytes[end] !== 0) end++;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v = (i: number) => view.getInt16(MUSIC_NAME_SIZE + 2 * i, true);
    return this.restoreState({
      musicName: String.fromCharCode(...bytes.subarray(0, end)),
      loaded: v(0) !== 0,
      songPlayed: v(1) !== 0,
      looping: v(2) !== 0,
      currentPos: v(3),
      currentOrder: v(4),
      playing: v(5) !== 0,
      genVolume: v(6),
    });
  }

  /** Boucle `while (fade en cours) delayMillis(50)` de `PCSoundFxPlayer::load` : joue les ticks de l'attente, rend leur nombre. */
  private waitFade(): number {
    let ms = 0;
    let ran = 0;
    while (this.player.fading) {
      ms += FADE_WAIT_MS;
      const due = Math.floor(ms / TICK_MS);
      this.tick(due - ran);
      ran = due;
    }
    return ran;
  }
}
