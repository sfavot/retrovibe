/**
 * Gestionnaire des sons MIDI de SCI : les emplacements que `DoSound` crée pour les objets `Sound` des scripts, leur lecture
 * tick par tick (1/60 s), leurs priorités, volumes, fondus et pauses, et le partage des canaux du synthétiseur entre les
 * morceaux joués en même temps (musique + bruitages MIDI). Pur : ni navigateur, ni machine virtuelle ; les propriétés des
 * objets (`signal`, `dataInc`, `min`, `sec`, `frame`, `vol`…) sont écrites par `engine/kernel/sound.ts` d'après l'état tenu ici.
 *
 * Références : `engines/sci/sound/music.cpp` (`SciMusic::soundPlay`, `soundStop`, `soundPause`, `soundResume`, `sortPlayList`,
 * `remapChannels`, `determineChannelMap`, `MusicEntry::onTimer`, `doFade`) et `midiparser_sci.cpp` (`processEvent`,
 * `sendInitCommands`, `sendFromScriptToDriver`, `trackState`, `remapChannel`, `allNotesOff`) de ScummVM, GPL v3 ou
 * ultérieure, lus puis réécrits.
 *
 * - **Horloge** : `advanceTo(ticks)` avance d'un pas par tick du jeu (`Vm.ticks`). À chaque pas, pour chaque son en lecture :
 *   un pas de fondu, puis les évènements échus du morceau. Le noyau l'appelle à chaque `DoSound` ; la boucle du jeu peut
 *   l'appeler à chaque image pour que la musique ne dépende pas de la cadence des scripts.
 * - **Signaux** : un signal du canal 15 remplace le précédent (`signal`) ; la fin du morceau vaut `SIGNAL_END` ; un repère
 *   cumulatif augmente `dataInc`. Le noyau les recopie dans l'objet à `DoSound UpdateCues`.
 * - **Boucle** : à la fin, `loop` diminue de 1 ; s'il reste non nul (ou si un maintien est demandé), retour au point de
 *   boucle (le début, ou le dernier changement de programme 127 du canal 15), notes coupées.
 * - **Fondu** : toutes les `fadeTickerStep + 1` ticks, le volume avance de `fadeStep` jusqu'à `fadeTo`.
 * - **Canaux** : un morceau parle à ses canaux MIDI, le gestionnaire les pose sur les canaux libres du pilote (1 à 8 pour
 *   General MIDI ; la batterie, marquée « ne pas réaffecter », garde le 9), dans l'ordre des priorités des sons puis des
 *   canaux. Un canal indispensable (priorité 0) prend la place du canal facultatif le moins important ; un son dont un
 *   canal indispensable ne trouve pas de place ne reçoit aucun canal. Un canal qui change de place retrouve son état
 *   (programme, volume, panoramique, modulation, pédale, molette).
 * - **Datation** : avec une horloge audio (`clock`), chaque message part daté (`tick` → ms, plus une avance fixe), pour que
 *   le rythme ne dépende pas de la cadence d'affichage ; sans elle (tests, pas d'audio), tout part sans date.
 *
 * Écarts volontaires :
 * - le minuteur de ScummVM tourne à la cadence du pilote et convertit les durées de fondu ; ici il tourne à 60 Hz ;
 * - la position rendue aux scripts (`ticker`) avance à chaque tick ; ScummVM rend la date du dernier évènement joué ;
 * - les voix ne sont pas comptées : avec une voix par canal (tous les sons de ce CD) et 32 voix, la limite ne joue jamais ;
 * - pause globale (`DoSound Pause` sans objet) : un compteur par son suffit, sans compteur global ;
 * - un retard de plus d'une demi-seconde (onglet masqué) se rattrape sans jouer les notes passées ;
 * - sons numérisés : relayés vers `SampleOutput` (`audio/digital.ts`). Leur fondu est celui d'`Audio32::fadeChannel` et
 *   `processFade` de ScummVM (`engines/sci/sound/audio32.cpp`, lu puis réécrit) : le volume va en ligne droite jusqu'à la
 *   cible en `tickerStep × step` ticks, puis le son s'arrête si c'était demandé ; sans durée, le volume change aussitôt.
 */
import { firstEventAt, type SciSong, type SongChannel, type SongEvent, SongEventType, SONG_TICKS_PER_SECOND } from "./sci-song";
import { MIDI_CHANNELS, type SoundDriver } from "./gm-driver";
import { declareState } from "../engine/save-codec";

export const SoundStatus = { Stopped: 0, Initialized: 1, Paused: 2, Playing: 3 } as const;
export type SoundStatus = (typeof SoundStatus)[keyof typeof SoundStatus];

/** Signal de fin d'un son (−1). */
export const SIGNAL_END = 0xffff;
export const SOUND_VOLUME_MAX = 127;
/** `loop` d'un son qui boucle sans fin (−1). */
export const LOOP_FOREVER = 0xffff;

const MS_PER_TICK = 1000 / SONG_TICKS_PER_SECOND;
/** Avance des messages datés sur l'horloge audio, en ms. */
const DEFAULT_LATENCY_MS = 50;
/** Au-delà de ce retard (en ticks), les notes passées ne sont pas jouées. */
const CATCH_UP_TICKS = 30;
const PITCH_CENTER_HIGH = 0x40;
const WORD_MASK = 0xffff;
/** Coupures demandées par les scripts : au plus 15 par canal. */
const SCRIPT_MUTE_MAX = 15;

const Controller = { Modulation: 0x01, Volume: 0x07, Pan: 0x0a, Hold: 0x40, SciMute: 0x4e, AllNotesOff: 0x7b } as const;

/** Sortie des sons numérisés lancés par `DoSound` (vague A2). */
export interface SampleOutput {
  /** Y a-t-il un son numérisé de ce numéro, à jouer à la place du MIDI ? */
  has(resourceId: number): boolean;
  play(key: number, resourceId: number, loop: boolean, volume: number): void;
  stop(key: number): void;
  pause(key: number, paused: boolean): void;
  setVolume(key: number, volume: number): void;
  /** La lecture lancée par `play` est-elle finie ? */
  finished(key: number): boolean;
}

export interface SoundManagerOptions {
  driver: SoundDriver;
  /** Morceau du son `resourceId` pour le périphérique du pilote, ou `undefined`. */
  loadSong(resourceId: number): SciSong | undefined;
  samples?: SampleOutput;
  /** Horloge du synthétiseur, en ms (`WebGmSynth.now`) ; peut aussi se brancher plus tard (`SoundManager.clock`). */
  clock?: () => number;
  latencyMs?: number;
}

/** État d'un canal MIDI d'un morceau, tenu même quand le canal n'a pas de place sur le synthétiseur. */
interface ChannelState {
  readonly info: SongChannel;
  voices: number;
  /** Coupé par le morceau (drapeau du canal ou contrôleur 0x4E). */
  songMute: boolean;
  /** Coupures demandées par les scripts. */
  scriptMute: number;
  patch: number;
  volume: number;
  pan: number;
  modulation: number;
  sustain: number;
  pitchLow: number;
  pitchHigh: number;
  readonly notes: Set<number>;
  /** Canal du synthétiseur, ou −1. */
  device: number;
}

export interface PlayOptions {
  loop: number;
  /** Priorité de l'objet, prise si le son n'en a pas ou si elle a été fixée par `DoSound SetPriority`. */
  priority: number;
  volume: number;
  playBed: boolean;
}

export class SoundSlot {
  song: SciSong | undefined;
  isSample = false;
  status: SoundStatus = SoundStatus.Stopped;
  priority = 0;
  overridePriority = false;
  loop = 0;
  volume = SOUND_VOLUME_MAX;
  hold = -1;
  reverb = -1;
  playBed = false;
  dataInc = 0;
  signal = 0;
  /** Position de lecture en ticks, rendue aux scripts par `min`, `sec`, `frame`. */
  ticker = 0;
  /** Rang de lancement : à priorité égale, le plus récent passe devant. */
  time = 0;
  pauseCounter = 0;
  fadeTo = 0;
  fadeStep = 0;
  fadeTicker = 0;
  fadeTickerStep = 0;
  fadeCompleted = false;
  stopAfterFading = false;
  /** Fondu d'un son numérisé : volume et tick de départ, durée en ticks. */
  fadeFrom = 0;
  fadeStartTick = 0;
  fadeDuration = 0;
  /** @internal */
  position = 0;
  /** @internal */
  index = 0;
  /** @internal */
  loopTick = 0;
  /** Le morceau est arrivé à sa fin sans boucler. */
  ended = false;
  /** @internal */
  readonly channels = new Map<number, ChannelState>();

  constructor(
    /** Référence de l'objet `Sound` des scripts. */
    readonly key: number,
    readonly resourceId: number,
  ) {}

  /** Y a-t-il quelque chose à jouer (morceau pour ce pilote, ou son numérisé) ? */
  get hasData(): boolean {
    return this.song !== undefined || this.isSample;
  }
}

interface Claim {
  readonly slot: SoundSlot;
  readonly channel: ChannelState;
  /** 0 : indispensable ; sinon, plus c'est grand, moins le canal compte. */
  readonly priority: number;
  /** Canal imposé du synthétiseur, ou −1. */
  readonly fixed: number;
}

export class SoundManager {
  readonly driver: SoundDriver;
  /** Horloge du synthétiseur, en ms, qui date les messages ; `undefined` : messages sans date. */
  clock: (() => number) | undefined;
  private readonly slots = new Map<number, SoundSlot>();
  /** Tous les sons, triés par priorité décroissante puis du plus récent au plus ancien. */
  private playlist: SoundSlot[] = [];
  private owners: (ChannelState | undefined)[] = new Array(MIDI_CHANNELS).fill(undefined);
  private timeCounter = 0;
  private ticks = 0;
  private needsRemap = false;
  private quiet = false;
  private anchorTick = 0;
  private anchorMs: number | undefined;
  private readonly latency: number;

  constructor(private readonly options: SoundManagerOptions) {
    this.driver = options.driver;
    this.clock = options.clock;
    this.latency = options.latencyMs ?? DEFAULT_LATENCY_MS;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Emplacements
  // -------------------------------------------------------------------------------------------------------------------------------

  slot(key: number): SoundSlot | undefined {
    return this.slots.get(key);
  }

  /** Références des objets qui ont un emplacement (racines du ramasse-miettes). */
  keys(): IterableIterator<number> {
    return this.slots.keys();
  }

  /** Sons dans l'ordre de priorité. */
  sounds(): readonly SoundSlot[] {
    return this.playlist;
  }

  /** Crée l'emplacement d'un objet (l'ancien, s'il existe, est d'abord libéré). */
  init(key: number, resourceId: number, settings: { loop: number; priority: number; volume: number }): SoundSlot {
    this.dispose(key);
    const slot = new SoundSlot(key, resourceId);
    slot.loop = settings.loop & WORD_MASK;
    slot.priority = settings.priority;
    slot.volume = clampVolume(settings.volume);
    slot.song = resourceId === 0 ? undefined : this.options.loadSong(resourceId);
    slot.isSample = resourceId !== 0 && (this.options.samples?.has(resourceId) ?? false);
    if (slot.song && !slot.isSample) for (const info of slot.song.channels) slot.channels.set(info.number, newChannelState(info));
    this.slots.set(key, slot);
    this.playlist.push(slot);
    return slot;
  }

  dispose(key: number): void {
    const slot = this.slots.get(key);
    if (!slot) return;
    this.stop(slot);
    this.slots.delete(key);
    this.playlist = this.playlist.filter((s) => s !== slot);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Commandes de `DoSound`
  // -------------------------------------------------------------------------------------------------------------------------------

  play(slot: SoundSlot, options: PlayOptions): void {
    const resourcePriority = slot.song?.priority;
    slot.loop = options.loop & WORD_MASK;
    slot.priority = !slot.overridePriority && resourcePriority !== undefined ? resourcePriority : options.priority;
    slot.hold = -1;
    slot.playBed = options.playBed;
    slot.volume = clampVolume(options.volume);
    slot.time = ++this.timeCounter;
    this.sortPlaylist();
    this.stamp();
    if (slot.isSample) this.options.samples?.play(slot.key, slot.resourceId, slot.loop === LOOP_FOREVER, slot.volume);
    else if (slot.song) {
      this.allNotesOff(slot);
      for (const channel of slot.channels.values()) resetChannelState(channel);
      slot.position = slot.index = slot.loopTick = 0;
      slot.ended = false;
      for (const channel of slot.channels.values()) if (channel.device >= 0) this.restoreChannel(slot, channel);
    }
    slot.ticker = 0;
    slot.pauseCounter = 0;
    slot.status = SoundStatus.Playing;
    slot.signal = 0;
    slot.fadeStep = 0;
    slot.fadeCompleted = false;
    this.remap();
  }

  /** Arrête le son : `signal` passe à `SIGNAL_END`. */
  stop(slot: SoundSlot): void {
    slot.dataInc = 0;
    slot.signal = SIGNAL_END;
    slot.fadeStep = 0;
    if (slot.status === SoundStatus.Stopped) return;
    const wasPlaying = slot.status === SoundStatus.Playing;
    slot.status = SoundStatus.Stopped;
    this.stamp();
    if (slot.isSample) this.options.samples?.stop(slot.key);
    else if (wasPlaying) this.allNotesOff(slot);
    this.remap();
  }

  /** Met en pause ou relance un son ; sans son, tous. Les pauses se comptent : il faut autant de reprises. */
  pause(slot: SoundSlot | undefined, paused: boolean): void {
    this.stamp();
    for (const target of slot ? [slot] : [...this.playlist]) {
      if (paused) this.pauseSlot(target);
      else this.resumeSlot(target);
    }
    this.remap();
  }

  /**
   * Lance un fondu vers `to` : un pas de `step` toutes les `tickerStep + 1` ticks ; pour un son numérisé, une ligne droite de
   * `tickerStep × step` ticks.
   */
  fade(slot: SoundSlot, to: number, tickerStep: number, step: number, stopAfterFading: boolean): void {
    const target = clampVolume(to);
    if (slot.isSample) {
      if (slot.volume === target) return;
      slot.stopAfterFading = stopAfterFading;
      slot.fadeTo = target;
      if (tickerStep > 0 && step > 0) {
        slot.fadeFrom = slot.volume;
        slot.fadeStartTick = this.ticks;
        slot.fadeDuration = tickerStep * step;
        slot.fadeStep = slot.volume > target ? -step : step;
      } else {
        slot.volume = target;
        this.applyVolume(slot);
      }
      return;
    }
    if (slot.volume === target && !stopAfterFading) return;
    slot.fadeTo = target;
    slot.fadeStep = slot.volume > target ? -step : step;
    slot.fadeTickerStep = tickerStep;
    slot.fadeTicker = 0;
    slot.stopAfterFading = stopAfterFading;
  }

  setHold(slot: SoundSlot, hold: number): void {
    slot.hold = hold;
  }

  /** Renvoie vrai si le volume a changé. */
  setVolume(slot: SoundSlot, volume: number): boolean {
    const value = clampVolume(volume);
    if (slot.volume === value) return false;
    slot.volume = value;
    this.stamp();
    this.applyVolume(slot);
    return true;
  }

  /** Fixe la priorité (elle ne viendra plus du son) ; `undefined` rend la main au son. */
  setPriority(slot: SoundSlot, priority: number | undefined): void {
    if (priority === undefined) {
      slot.overridePriority = false;
      slot.priority = 0;
      return;
    }
    slot.overridePriority = true;
    slot.priority = priority;
    slot.time = ++this.timeCounter;
    this.sortPlaylist();
  }

  setLoop(slot: SoundSlot, loop: number): void {
    slot.loop = loop & WORD_MASK;
  }

  /**
   * Message MIDI envoyé par un script à un canal du son (`DoSound SendMidi`). Le contrôleur 0x4E coupe ou rouvre le canal,
   * en comptant les demandes.
   */
  sendMidi(slot: SoundSlot, channelNumber: number, status: number, a: number, b: number): void {
    const channel = slot.channels.get(channelNumber & 0x0f);
    if (!channel) return;
    this.stamp();
    if ((status & 0xf0) === 0xb0 && a === Controller.SciMute) {
      const before = channel.scriptMute;
      if (b !== 0 && channel.scriptMute < SCRIPT_MUTE_MAX) channel.scriptMute++;
      else if (b === 0 && channel.scriptMute > 0) channel.scriptMute--;
      if (channel.scriptMute !== before) this.remap();
      return;
    }
    this.channelMessage(slot, channel, status & 0xf0, a & 0x7f, b & 0x7f);
  }

  get masterVolume(): number {
    return this.driver.masterVolume;
  }

  set masterVolume(value: number) {
    this.driver.masterVolume = value;
  }

  /** Coupe toutes les notes sans rien arrêter (jeu mis en pause par la page, onglet masqué). */
  silence(): void {
    this.stamp();
    for (const slot of this.playlist) if (slot.status === SoundStatus.Playing) this.allNotesOff(slot);
  }

  /** Canal du synthétiseur donné au canal `channelNumber` d'un son, ou −1. */
  deviceChannel(slot: SoundSlot, channelNumber: number): number {
    return slot.channels.get(channelNumber)?.device ?? -1;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Sauvegarde
  // -------------------------------------------------------------------------------------------------------------------------------

  /**
   * Après la reprise d'une sauvegarde (`engine/save.ts`, qui a relu les champs) : les morceaux sont relus des ressources,
   * l'horloge se recale sur celle du synthétiseur et chaque canal attribué retrouve ses réglages. Les notes qui sonnaient ne
   * sont pas rejouées (ScummVM non plus : `SoundCommandParser::reconstructPlayList`) ; elles restent notées, leur fin suivra.
   */
  resync(): void {
    for (const slot of this.slots.values()) slot.song = slot.resourceId === 0 ? undefined : this.options.loadSong(slot.resourceId);
    this.quiet = false;
    this.anchorMs = undefined;
    this.stamp();
    this.owners.forEach((channel, device) => {
      const slot = channel && this.playlist.find((candidate) => candidate.channels.get(channel.info.number) === channel);
      if (!channel || !slot) return;
      this.releaseDeviceChannel(device);
      this.restoreChannel(slot, channel);
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Horloge
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Avance jusqu'au tick `ticks` de l'horloge du jeu. Un recul (partie restaurée) recale sans rien jouer. */
  advanceTo(ticks: number): void {
    let steps = ticks - this.ticks;
    if (steps < 0) {
      this.ticks = ticks;
      this.anchorMs = undefined;
      return;
    }
    for (; steps > 0; steps--) {
      this.quiet = steps > CATCH_UP_TICKS;
      this.ticks++;
      this.stamp();
      if (this.needsRemap) this.remap();
      for (const slot of [...this.playlist]) this.runSlot(slot);
    }
    this.quiet = false;
    if (this.needsRemap) this.remap();
  }

  /** Heure (horloge audio, ms) des messages du tick courant, ou `undefined` sans horloge. */
  private at: number | undefined;

  private stamp(): void {
    const clock = this.clock;
    if (!clock) {
      this.at = undefined;
      return;
    }
    const now = clock();
    let at = this.anchorMs === undefined ? -Infinity : this.anchorMs + (this.ticks - this.anchorTick) * MS_PER_TICK;
    if (at < now) {
      // En retard (départ, onglet masqué, image longue) : l'horloge du jeu se recale sur celle du synthétiseur.
      at = now + this.latency;
      this.anchorMs = at;
      this.anchorTick = this.ticks;
    }
    this.at = at;
  }

  private runSlot(slot: SoundSlot): void {
    if (slot.status !== SoundStatus.Playing) return;
    if (slot.fadeStep !== 0) {
      if (slot.isSample) this.sampleFade(slot);
      else this.fadeStep(slot);
    }
    const song = slot.song;
    if (!song || slot.isSample || slot.ended) return;
    // Au plus un retour au point de boucle par tick : une boucle vide ne bloque pas.
    let jumped = false;
    for (;;) {
      const event = song.events[slot.index];
      let jump: boolean;
      if (event && event.tick <= slot.position) {
        slot.index++;
        jump = this.processEvent(slot, event);
      } else if (!event && slot.position >= song.endTick) {
        jump = this.endOfTrack(slot);
        if (!jump) break;
      } else break;
      if (jump) {
        if (jumped) break;
        jumped = true;
      }
    }
    slot.ticker = slot.position & WORD_MASK;
    if (!slot.ended) slot.position++;
  }

  private sampleFade(slot: SoundSlot): void {
    const elapsed = this.ticks - slot.fadeStartTick;
    if (elapsed > slot.fadeDuration) {
      slot.fadeStep = 0;
      slot.fadeCompleted = true;
      slot.volume = slot.fadeTo;
      if (slot.stopAfterFading) this.options.samples?.stop(slot.key);
      else this.applyVolume(slot);
      return;
    }
    const volume = slot.fadeFrom + Math.trunc(((slot.fadeTo - slot.fadeFrom) * elapsed) / slot.fadeDuration);
    if (volume === slot.volume) return;
    slot.volume = volume;
    this.applyVolume(slot);
  }

  private fadeStep(slot: SoundSlot): void {
    if (slot.fadeTicker > 0) {
      slot.fadeTicker--;
      return;
    }
    slot.fadeTicker = slot.fadeTickerStep;
    slot.volume += slot.fadeStep;
    if ((slot.fadeStep > 0 && slot.volume >= slot.fadeTo) || (slot.fadeStep < 0 && slot.volume <= slot.fadeTo)) {
      slot.volume = slot.fadeTo;
      slot.fadeStep = 0;
      slot.fadeCompleted = true;
    }
    this.applyVolume(slot);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Lecture d'un morceau
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Joue un évènement ; renvoie vrai s'il a renvoyé la lecture au point de boucle. */
  private processEvent(slot: SoundSlot, event: SongEvent): boolean {
    switch (event.type) {
      case SongEventType.Signal:
        // Un signal posé au tout début du morceau ne compte pas.
        if (event.tick !== 0) slot.signal = event.a;
        return false;
      case SongEventType.LoopPoint:
        slot.loopTick = event.tick;
        return false;
      case SongEventType.Cue:
        slot.dataInc = (slot.dataInc + event.a) & WORD_MASK;
        return false;
      case SongEventType.Hold:
        if (event.a !== slot.hold) return false;
        this.jumpToLoop(slot, false);
        return true;
      case SongEventType.Reverb:
        slot.reverb = event.a;
        return false;
      default:
        break;
    }
    const channel = slot.channels.get(event.channel);
    if (!channel) return false;
    if (event.type === SongEventType.Voices) channel.voices = event.a;
    else if (event.type === SongEventType.Mute) {
      const mute = event.a !== 0;
      if (channel.songMute !== mute) {
        channel.songMute = mute;
        this.needsRemap = true;
      }
    } else this.channelMessage(slot, channel, event.status, event.a, event.b);
    return false;
  }

  /** Fin du morceau : boucle (renvoie vrai) ou signal de fin. */
  private endOfTrack(slot: SoundSlot): boolean {
    if (slot.loop !== 0) slot.loop = (slot.loop - 1) & WORD_MASK;
    if (slot.loop !== 0 || slot.hold > 0) {
      this.jumpToLoop(slot, true);
      return true;
    }
    slot.signal = SIGNAL_END;
    slot.ended = true;
    this.allNotesOff(slot);
    return false;
  }

  private jumpToLoop(slot: SoundSlot, stopNotes: boolean): void {
    if (stopNotes) this.allNotesOff(slot);
    slot.position = slot.loopTick;
    slot.index = firstEventAt(slot.song!, slot.loopTick);
  }

  /** Message d'un canal du morceau : état retenu, puis envoi si le canal a une place sur le synthétiseur. */
  private channelMessage(slot: SoundSlot, channel: ChannelState, status: number, a: number, b: number): void {
    switch (status) {
      case 0x90:
        if (this.quiet) return;
        channel.notes.add(a);
        break;
      case 0x80:
        channel.notes.delete(a);
        break;
      case 0xc0:
        channel.patch = a;
        break;
      case 0xe0:
        channel.pitchLow = a;
        channel.pitchHigh = b;
        break;
      case 0xb0:
        if (a === Controller.Modulation) channel.modulation = b;
        else if (a === Controller.Volume) channel.volume = b;
        else if (a === Controller.Pan) channel.pan = b;
        else if (a === Controller.Hold) channel.sustain = b;
        else if (a === Controller.AllNotesOff) channel.notes.clear();
        break;
      default:
        break;
    }
    if (channel.device < 0) return;
    if (status === 0xb0 && a === Controller.Volume) b = scaleVolume(b, slot.volume);
    this.driver.send(status | channel.device, a, b, this.at);
  }

  private applyVolume(slot: SoundSlot): void {
    if (slot.isSample) {
      this.options.samples?.setVolume(slot.key, slot.volume);
      return;
    }
    for (const channel of slot.channels.values()) {
      if (channel.device >= 0) this.driver.send(0xb0 | channel.device, Controller.Volume, scaleVolume(channel.volume, slot.volume), this.at);
    }
  }

  private allNotesOff(slot: SoundSlot): void {
    for (const channel of slot.channels.values()) {
      if (channel.device >= 0) {
        for (const note of channel.notes) this.driver.send(0x80 | channel.device, note, 0, this.at);
        this.releaseDeviceChannel(channel.device);
      }
      channel.notes.clear();
    }
  }

  private releaseDeviceChannel(device: number): void {
    this.driver.send(0xb0 | device, Controller.Hold, 0, this.at);
    this.driver.send(0xb0 | device, Controller.AllNotesOff, 0, this.at);
  }

  /** Rend à un canal du synthétiseur l'état du canal du morceau qui vient de s'y poser. */
  private restoreChannel(slot: SoundSlot, channel: ChannelState): void {
    const device = channel.device;
    this.driver.send(0xb0 | device, Controller.Hold, 0, this.at);
    this.driver.send(0xc0 | device, channel.patch, 0, this.at);
    this.driver.send(0xb0 | device, Controller.Volume, scaleVolume(channel.volume, slot.volume), this.at);
    this.driver.send(0xb0 | device, Controller.Pan, channel.pan, this.at);
    this.driver.send(0xb0 | device, Controller.Modulation, channel.modulation, this.at);
    this.driver.send(0xb0 | device, Controller.Hold, channel.sustain, this.at);
    this.driver.send(0xe0 | device, channel.pitchLow, channel.pitchHigh, this.at);
  }

  private pauseSlot(slot: SoundSlot): void {
    slot.pauseCounter++;
    if (slot.status !== SoundStatus.Playing) return;
    slot.status = SoundStatus.Paused;
    if (slot.isSample) this.options.samples?.pause(slot.key, true);
    else this.allNotesOff(slot);
  }

  private resumeSlot(slot: SoundSlot): void {
    if (slot.pauseCounter > 0) slot.pauseCounter--;
    if (slot.pauseCounter !== 0 || slot.status !== SoundStatus.Paused) return;
    slot.status = SoundStatus.Playing;
    if (slot.isSample) this.options.samples?.pause(slot.key, false);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Partage des canaux du synthétiseur
  // -------------------------------------------------------------------------------------------------------------------------------

  private sortPlaylist(): void {
    this.playlist.sort((a, b) => b.priority - a.priority || b.time - a.time);
  }

  private remap(): void {
    this.needsRemap = false;
    const next = this.assign(this.claims());
    for (let device = 0; device < MIDI_CHANNELS; device++) {
      const old = this.owners[device];
      if (!old || old === next[device]?.channel) continue;
      this.releaseDeviceChannel(device);
      old.device = -1;
      old.notes.clear();
    }
    for (let device = 0; device < MIDI_CHANNELS; device++) {
      const claim = next[device];
      if (!claim || this.owners[device] === claim.channel) continue;
      claim.channel.device = device;
      this.restoreChannel(claim.slot, claim.channel);
    }
    this.owners = next.map((claim) => claim?.channel);
  }

  /** Canaux qui obtiennent une place, sons par priorité décroissante. */
  private claims(): Claim[] {
    let claims: Claim[] = [];
    let songIndex = 0;
    for (const slot of this.playlist) {
      if (slot.status !== SoundStatus.Playing || slot.isSample || slot.ended) continue;
      const backup = claims.slice();
      let placed = true;
      for (const channel of slot.channels.values()) {
        if (channel.songMute || channel.scriptMute > 0) continue;
        const essential = channel.info.priority === 0;
        const claim: Claim = {
          slot,
          channel,
          priority: essential ? 0 : 16 - channel.info.priority + 16 * songIndex,
          fixed: channel.info.dontRemap || slot.playBed ? channel.info.number : -1,
        };
        while (!this.fits(claims, claim)) {
          const victim = essential ? this.victim(claims, claim) : undefined;
          if (!victim) break;
          claims.splice(claims.indexOf(victim), 1);
        }
        if (this.fits(claims, claim)) claims.push(claim);
        else if (essential) {
          placed = false;
          break;
        }
      }
      // Un son privé d'un canal indispensable ne joue pas : il rend ce qu'il a pris.
      if (!placed) claims = backup;
      songIndex++;
    }
    return claims;
  }

  private inRange(device: number): boolean {
    return device >= this.driver.firstChannel && device <= this.driver.lastChannel;
  }

  private fits(claims: readonly Claim[], claim: Claim): boolean {
    if (claim.fixed >= 0 && claims.some((c) => c.fixed === claim.fixed)) return false;
    let floating = claim.fixed < 0 ? 1 : 0;
    let room = this.driver.lastChannel - this.driver.firstChannel + 1 - (claim.fixed >= 0 && this.inRange(claim.fixed) ? 1 : 0);
    for (const c of claims) {
      if (c.fixed < 0) floating++;
      else if (this.inRange(c.fixed)) room--;
    }
    return floating <= room;
  }

  /** Canal facultatif à déloger pour faire place à `claim`. */
  private victim(claims: readonly Claim[], claim: Claim): Claim | undefined {
    const rival = claim.fixed >= 0 ? claims.find((c) => c.fixed === claim.fixed) : undefined;
    if (rival) return rival.priority > 0 ? rival : undefined;
    let worst: Claim | undefined;
    for (const c of claims) if (c.fixed < 0 && c.priority > 0 && (!worst || c.priority >= worst.priority)) worst = c;
    return worst;
  }

  /** Place chaque canal retenu : canal imposé, sinon celui qu'il occupait déjà, sinon le plus haut canal libre. */
  private assign(claims: readonly Claim[]): (Claim | undefined)[] {
    const next: (Claim | undefined)[] = new Array(MIDI_CHANNELS).fill(undefined);
    for (const claim of claims) if (claim.fixed >= 0) next[claim.fixed] = claim;
    const waiting: Claim[] = [];
    for (const claim of claims) {
      if (claim.fixed >= 0) continue;
      const device = claim.channel.device;
      if (device >= 0 && this.inRange(device) && !next[device] && this.owners[device] === claim.channel) next[device] = claim;
      else waiting.push(claim);
    }
    let device = this.driver.lastChannel;
    for (const claim of waiting) {
      while (device >= this.driver.firstChannel && next[device]) device--;
      if (device < this.driver.firstChannel) break;
      next[device] = claim;
    }
    return next;
  }
}

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(SOUND_VOLUME_MAX, volume | 0));
}

function scaleVolume(channelVolume: number, songVolume: number): number {
  return Math.floor((channelVolume * songVolume) / SOUND_VOLUME_MAX);
}

function newChannelState(info: SongChannel): ChannelState {
  const state: ChannelState = {
    info,
    voices: info.voices,
    songMute: info.muted,
    scriptMute: 0,
    patch: 0,
    volume: SOUND_VOLUME_MAX,
    pan: 0x40,
    modulation: 0,
    sustain: 0,
    pitchLow: 0,
    pitchHigh: PITCH_CENTER_HIGH,
    notes: new Set(),
    device: -1,
  };
  return state;
}

/** État d'un canal au départ du morceau (les coupures demandées par les scripts restent). */
function resetChannelState(channel: ChannelState): void {
  channel.voices = channel.info.voices;
  channel.songMute = channel.info.muted;
  channel.patch = 0;
  channel.volume = SOUND_VOLUME_MAX;
  channel.pan = 0x40;
  channel.modulation = 0;
  channel.sustain = 0;
  channel.pitchLow = 0;
  channel.pitchHigh = PITCH_CENTER_HIGH;
  channel.notes.clear();
}

// État sauvegardé (`engine/save.ts`) : emplacements, ordre de jeu, canaux attribués, compteurs. Les morceaux sont relus des
// ressources et l'ancrage de l'horloge refait (`SoundManager.resync`).
declareState(SoundSlot, { name: "SoundSlot", skip: ["song"], create: (fields) => new SoundSlot(fields.key as number, fields.resourceId as number) });
declareState(SoundManager, { name: "SoundManager", skip: ["driver", "options", "latency", "quiet", "anchorTick", "anchorMs", "at"] });
