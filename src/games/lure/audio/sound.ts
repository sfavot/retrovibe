/**
 * Son de *Lure of the Temptress* : le `SoundManager` du jeu (sections de sons, descriptions `0x3F18`, sources, sons actifs, restauration
 * des sauvegardes) sur le pilote AdLib multi-sources (`lure-adlib.ts`) et le lecteur SMF (`smf-player.ts`). Il implémente `LureSound`
 * (`engine/services.ts`).
 *
 * Source : `SoundManager` et `MidiMusic` (`engines/lure/sound.cpp`, `sound.h`, ScummVM, GPL v3 ou ultérieure, lus en entier), voie AdLib
 * seulement (le MT-32 n'est pas porté : D7 de `docs/lure/plan.md`).
 *
 * Reprises de ScummVM, bizarreries comprises :
 * - la musique prend la **source 0**, chaque bruitage la **première source libre de 1 à 9** (`_sourcesInUse`) ; sans source libre, le son
 *   n'est pas joué (avertissement). Plusieurs morceaux peuvent être lancés en « musique » sur la source 0 ;
 * - `addSound` retient la description dans la liste des sons actifs **avant** de lancer le son, même si le son est coupé (`soundFlag` faux) ou
 *   s'il n'a aucune voix AdLib (champ « AdLib » de `numChannels` nul : rien n'est joué) ; `tidySounds` retire de la liste ceux qui ne jouent plus ;
 * - le numéro d'un son porte la boucle (bit 7) ; l'arrêt et le test « joue-t-il ? » comparent les 7 bits bas ;
 * - `addSound2(6)` (la torture chinoise) arrête d'abord le son 6 et le relance ; les autres ne se relancent pas s'ils jouent ;
 * - `removeSounds` (changement de pièce) arrête les sons marqués `SF_IN_USE` après le « bidouillage des cloches » (`bellsBodge`) ;
 * - le volume d'un son (`volume`, 0x80 par défaut) est retenu mais **n'agit pas** sur AdLib, comme dans ScummVM (seul le MT-32 met la
 *   vélocité à l'échelle) ;
 * - `trashReverb` ne fait rien (désactivé dans ScummVM : réverbération du MT-32 seulement), `pause` coupe les notes de tous les sons.
 *
 * Écarts :
 * - le son avance avec l'horloge de l'hôte (`advance`, ticks de 4 ms numérotés pour `WebOpl`), pas avec un fil de minuterie : aucun verrou ;
 * - ce que ScummVM lit dans les ressources et la pièce (`bellsBodge`, `Game::soundFlag`, `preloadFlag`) est injecté (`LureSoundOptions`) ;
 * - un numéro de son hors de la section, qui fait lire ScummVM hors de ses tables (ou une erreur fatale), lève une exception ;
 * - `fadeOut` (boucle bloquante de ScummVM, dans l'introduction) devient `startFadeOut` / `fading` / `finishFadeOut` ; le volume de l'utilisateur de
 *   ScummVM n'est pas porté.
 */
import type { OplSink } from "../../../audio/opl-stream";
import type { Song } from "../../../audio/smf";
import { parseSound, type SoundSection, type SoundSectionName } from "../data/sound";
import type { SoundDesc } from "../data/lure-dat";
import type { LureSound } from "../engine/services";
import { DEFAULT_SOURCE_NEUTRAL_VOLUME, MAXIMUM_SOURCES } from "./adlib-multisource";
import { LureAdlibDriver } from "./lure-adlib";
import { SmfPlayer, TIMER_PERIOD_US, type SmfPlayback } from "./smf-player";

/** `SoundDescResource::flags` : le son est coupé au changement de pièce. */
export const SF_IN_USE = 1;
/** Le son est relancé au chargement d'une partie. */
export const SF_RESTORE = 2;

/** Volume d'un son quand le jeu n'en donne pas (`musicInterface_Play`) : neutre. */
export const DEFAULT_SOUND_VOLUME = 0x80;
/** Nombre de sources du pilote (`LURE_MAX_SOURCES`) : la musique et 9 bruitages. */
export const LURE_MAX_SOURCES = MAXIMUM_SOURCES;

/** Durée d'un tick de 4 ms, en ms. */
export const TICK_MS = TIMER_PERIOD_US / 1000;
/** Au-delà de ce retard (ms), `advance` oublie le surplus au lieu de rattraper (onglet resté en arrière-plan). */
const MAX_CATCH_UP_MS = 1000;

/** Description d'un son jouée (`SoundList`) : copie de l'enregistrement `0x3F18` avec le nombre de voix AdLib. */
export interface ActiveSound {
  soundNumber: number;
  channel: number;
  numChannels: number;
  flags: number;
  volume: number;
}

/** Un son en train de jouer (`MidiMusic` de `_playingSounds`). */
interface PlayingSound {
  /** Numéro du son dans la section (7 bits). */
  soundNumber: number;
  source: number;
  isMusic: boolean;
  /** Volume retenu (`MidiMusic::_volume`) : sans effet audible sur AdLib. */
  volume: number;
  playback: SmfPlayback;
}

/**
 * Ce que `bellsBodge` lit dans le moteur : l'indicateur de zone de la pièce courante (`RoomData::areaFlag`, `undefined` si la pièce n'existe
 * pas) et le champ `AREA_FLAG` du jeu, que le bidouillage met à jour quand la zone change.
 */
export interface BellsArea {
  roomAreaFlag(): number | undefined;
  getAreaField(): number;
  setAreaField(value: number): void;
}

export interface LureSoundOptions {
  /** Les trois sections AdLib du jeu (`readSoundSections`). */
  sections: Readonly<Record<SoundSectionName, SoundSection>>;
  /** Table `0x3F18` (`parseSoundDescs`). */
  descs: readonly SoundDesc[];
  /** Puce OPL2 : reçoit les écritures de registres, horodatées par tick de 4 ms (`beginTick`). */
  sink: OplSink;
  /** `Game::soundFlag` : faux, rien ne joue. Vrai par défaut. */
  soundEnabled?: () => boolean;
  /** `Game::preloadFlag` : vrai pendant le préchargement d'une pièce, où `addSound` ne joue rien. Faux par défaut. */
  preloading?: () => boolean;
  /** Pour `removeSounds` ; sans lui, le bidouillage des cloches est sauté. */
  area?: BellsArea;
  /** Avertissements de ScummVM (`warning`). */
  warn?: (message: string) => void;
}

export class SoundManager implements LureSound {
  private readonly driver: LureAdlibDriver;
  private readonly player: SmfPlayer;
  private readonly sources = new Array<boolean>(LURE_MAX_SOURCES).fill(false);
  private activeSounds: ActiveSound[] = [];
  private playingSounds: PlayingSound[] = [];
  private readonly songs = new Map<string, Song>();
  private current: SoundSectionName | null = null;
  private paused = false;
  private timerTicks = 0;
  private remainder = 0;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: LureSoundOptions) {
    this.warn = options.warn ?? (() => {});
    options.sink.beginTick?.(0);
    this.driver = new LureAdlibDriver(options.sink, this.warn);
    this.player = new SmfPlayer(this.driver);
  }

  /** La section chargée (`loadSection`), `null` avant la première. */
  get section(): SoundSectionName | null {
    return this.current;
  }

  /** Numéro du dernier tick de 4 ms (celui de `beginTick`). */
  get tickCount(): number {
    return this.timerTicks;
  }

  /** `loadSection` : coupe tout puis passe à la section (`main` : le jeu, `intro`, `ending`). */
  loadSection(name: SoundSectionName): void {
    this.killSounds();
    this.current = name;
  }

  // --- horloge ----------------------------------------------------------------------------------------------------------

  /** Avance de `ms` millisecondes de temps réel (tronqué à une seconde) : autant de ticks de 4 ms que possible. */
  advance(ms: number): void {
    this.remainder += Math.min(MAX_CATCH_UP_MS, Math.max(0, ms));
    while (this.remainder >= TICK_MS) {
      this.remainder -= TICK_MS;
      this.tick();
    }
  }

  /** Un appel de la minuterie de 250 Hz (`SoundManager::doTimer`). */
  tick(): void {
    this.timerTicks++;
    this.options.sink.beginTick?.(this.timerTicks);
    // Le fondu suit la minuterie du pilote, la pause ne l'arrête pas ; seuls les morceaux s'arrêtent.
    this.driver.updateFading();
    if (this.paused) return;
    this.player.tick();
  }

  // --- interface `LureSound` --------------------------------------------------------------------------------------------

  addSound(soundIndex: number, tidy = true): void {
    if (tidy) this.tidySounds();
    if (this.options.preloading?.()) return;
    const rec = this.desc(soundIndex);
    // Ne joue que les sons qui ont au moins une voix AdLib (bits 2 et 3 de `numChannels`).
    const numChannels = (rec.numChannels >> 2) & 3;
    if (numChannels === 0) return;
    this.activeSounds.push({ soundNumber: rec.soundNumber, channel: rec.channel, numChannels, flags: rec.flags, volume: rec.volume });
    this.musicInterfacePlay(rec.soundNumber, false, numChannels, rec.volume);
  }

  addSound2(soundIndex: number): void {
    this.tidySounds();
    if (soundIndex === 6) {
      // La torture chinoise : encore en cours quand on la relance.
      this.stopSound(6);
      this.addSound(6, false);
    } else if (!this.findSound(this.desc(soundIndex).soundNumber)) {
      this.addSound(soundIndex, false);
    }
  }

  stopSound(soundIndex: number): void {
    this.musicInterfaceStop(this.desc(soundIndex).soundNumber);
  }

  killSound(soundNumber: number): void {
    this.musicInterfaceStop(soundNumber);
  }

  killSounds(): void {
    this.musicInterfaceKillAll();
    this.activeSounds = [];
  }

  removeSounds(): void {
    this.bellsBodge();
    for (const rec of [...this.activeSounds]) {
      if (rec.flags & SF_IN_USE) this.musicInterfaceStop(rec.soundNumber);
    }
  }

  isSoundActive(soundNumber: number): boolean {
    this.tidySounds();
    return this.findSound(soundNumber) !== undefined;
  }

  playMusic(soundNumber: number, isMusic: boolean): void {
    this.musicInterfacePlay(soundNumber, isMusic);
  }

  /** Réverbération du MT-32 : désactivée dans ScummVM, sans objet avec AdLib. */
  trashReverb(): void {}

  /** Une fois par image dans ScummVM : rien à faire ici, le son avance avec l'horloge de l'hôte (`advance`). */
  continuePlaying(): void {}

  pause(): void {
    this.paused = true;
    this.player.pause();
    // Coupe aussi les notes qui pendraient encore.
    this.driver.stopAllNotes();
  }

  resume(): void {
    this.paused = false;
    this.player.resume();
  }

  // --- reste de `SoundManager` ------------------------------------------------------------------------------------------

  /** `setVolume` : règle le volume d'un son actif (retenu seulement, voir l'en-tête). */
  setVolume(soundNumber: number, volume: number): void {
    this.tidyPlaying();
    const entry = this.findSound(soundNumber);
    if (entry) this.musicInterfaceSetVolume(entry.soundNumber, volume);
  }

  /** `saveToStream` : numéros des sons actifs, dans l'ordre où ils ont été lancés. */
  activeSoundNumbers(): number[] {
    return this.activeSounds.map((s) => s.soundNumber);
  }

  /**
   * `loadFromStream` : coupe tout, puis relance ceux des sons sauvegardés dont la description porte `SF_RESTORE` (`addSound2` de la première
   * description de ce numéro).
   */
  restoreSounds(soundNumbers: readonly number[]): void {
    this.killSounds();
    for (const soundNumber of soundNumbers) {
      const index = this.descIndexOf(soundNumber);
      if (index === undefined) continue;
      if (this.options.descs[index]!.flags & SF_RESTORE) this.addSound2(index);
    }
  }

  /** `SoundManager::restoreSounds()` (sans argument) : relance les sons actifs marqués `SF_RESTORE` qui ont des voix. */
  replayRestorable(): void {
    for (const rec of [...this.activeSounds]) {
      if (rec.numChannels !== 0 && rec.flags & SF_RESTORE) this.musicInterfacePlay(rec.soundNumber, false, rec.numChannels, rec.volume);
    }
  }

  /**
   * `fadeOut` (fondu de 3 s avant un changement de musique de l'introduction) : ScummVM boucle en attendant la fin du fondu ; ici l'appelant
   * lance `startFadeOut`, attend que `fading` soit faux (ou que le joueur passe l'introduction) puis appelle `finishFadeOut`.
   */
  startFadeOut(): void {
    this.tidyPlaying();
    this.driver.startFade(3000, 0);
  }

  /** Un fondu est en cours. */
  get fading(): boolean {
    return this.driver.isFading();
  }

  /** Fin du fondu (`aborted` : le joueur l'a interrompu, le volume va à sa valeur finale) : coupe tous les sons et rend le volume neutre. */
  finishFadeOut(aborted = false): void {
    if (aborted) this.driver.abortFade();
    this.musicInterfaceKillAll();
    this.driver.setAllSourceVolumes(DEFAULT_SOURCE_NEUTRAL_VOLUME);
  }

  /** `descIndexOf` : rang de la première description de ce numéro de son (bit de boucle compris). */
  descIndexOf(soundNumber: number): number | undefined {
    const index = this.options.descs.findIndex((d) => d.soundNumber === soundNumber);
    return index < 0 ? undefined : index;
  }

  /** `tidySounds` : retire des sons actifs ceux qui ne jouent plus (et rend les sources des sons finis). */
  tidySounds(): void {
    this.activeSounds = this.activeSounds.filter((s) => this.musicInterfaceCheckPlaying(s.soundNumber));
  }

  /** `findSound` : le son actif de ce numéro. */
  findSound(soundNumber: number): ActiveSound | undefined {
    return this.activeSounds.find((s) => s.soundNumber === soundNumber);
  }

  /** Sources du pilote occupées (`_sourcesInUse`), pour les tests. */
  get sourcesInUse(): readonly boolean[] {
    return this.sources;
  }

  /** Numéros (7 bits) des sons en train de jouer, avec leur source. */
  get playing(): readonly { soundNumber: number; source: number }[] {
    return this.playingSounds.filter((s) => s.playback.playing).map((s) => ({ soundNumber: s.soundNumber, source: s.source }));
  }

  /** Volume retenu d'un son en train de jouer (`MidiMusic::getVolume`). */
  volumeOf(soundNumber: number): number | undefined {
    return this.playingSounds.find((s) => s.soundNumber === soundNumber)?.volume;
  }

  /** Le pilote OPL (pour les tests et le volume de source). */
  get oplDriver(): LureAdlibDriver {
    return this.driver;
  }

  // --- interne ----------------------------------------------------------------------------------------------------------

  private desc(soundIndex: number): SoundDesc {
    const rec = this.options.descs[soundIndex];
    if (!rec) throw new Error(`description de son ${soundIndex} inconnue (${this.options.descs.length} descriptions)`);
    return rec;
  }


  /** `bellsBodge` : le son d'ambiance de la ville (cloches) suit la zone de la pièce où l'on entre. */
  private bellsBodge(): void {
    const area = this.options.area;
    if (!area) return;
    const roomFlag = area.roomAreaFlag();
    if (roomFlag === undefined || roomFlag === area.getAreaField()) return;
    area.setAreaField(roomFlag);
    switch (roomFlag) {
      case 0:
        this.killSound(1);
        break;
      case 1:
        this.addSound(2);
        this.killSound(33);
        break;
      case 2:
        this.setVolume(0, 15);
        this.killSound(1);
        break;
      default:
        this.killSound(1);
        break;
    }
  }

  private song(index: number): Song {
    const name = this.current;
    if (!name) throw new Error("section de sons non chargée");
    const key = `${name}:${index}`;
    let song = this.songs.get(key);
    if (!song) {
      song = parseSound(this.options.sections[name].sounds[index]!);
      this.songs.set(key, song);
    }
    return song;
  }

  /** `musicInterface_Play` : lance un son (`isMusic` : source 0, sinon la première source libre de 1 à 9). */
  private musicInterfacePlay(soundNumber: number, isMusic: boolean, _numChannels = 4, volume = DEFAULT_SOUND_VOLUME): void {
    if (!this.current) throw new Error("section de sons non chargée");
    const soundNum = soundNumber & 0x7f;
    const total = this.options.sections[this.current].sounds.length;
    if (soundNum >= total) throw new Error(`son ${soundNum} hors de la section (${total} sons)`);
    // Le bit de poids fort du numéro demande une boucle.
    const loop = (soundNumber & 0x80) !== 0;
    if (this.options.soundEnabled && !this.options.soundEnabled()) return;

    let source = -1;
    if (isMusic) {
      source = 0;
    } else {
      for (let i = 1; i < LURE_MAX_SOURCES; i++) {
        if (!this.sources[i]) {
          source = i;
          break;
        }
      }
    }
    if (source === -1) {
      this.warn(`Insufficient sources to play sound ${soundNumber}`);
      return;
    }
    this.sources[source] = true;
    const playback = this.player.start(this.song(soundNum), source, loop);
    this.playingSounds.push({ soundNumber: soundNum, source, isMusic, volume, playback });
  }

  /** `musicInterface_Stop` : arrête le premier son en cours de ce numéro. */
  private musicInterfaceStop(soundNumber: number): void {
    this.tidyPlaying();
    const soundNum = soundNumber & 0x7f;
    const index = this.playingSounds.findIndex((s) => s.soundNumber === soundNum);
    if (index < 0) return;
    const [sound] = this.playingSounds.splice(index, 1);
    this.sources[sound!.source] = false;
    this.player.remove(sound!.playback);
  }

  private musicInterfaceCheckPlaying(soundNumber: number): boolean {
    this.tidyPlaying();
    const soundNum = soundNumber & 0x7f;
    return this.playingSounds.some((s) => s.soundNumber === soundNum);
  }

  private musicInterfaceSetVolume(soundNumber: number, volume: number): void {
    this.tidyPlaying();
    for (const s of this.playingSounds) if (s.soundNumber === soundNumber) s.volume = Math.min(255, Math.max(0, volume));
  }

  /** `musicInterface_KillAll`. */
  private musicInterfaceKillAll(): void {
    this.tidyPlaying();
    for (const s of this.playingSounds) s.playback.stop();
    this.sources.fill(false);
    for (const s of this.playingSounds) this.player.remove(s.playback);
    this.playingSounds = [];
    this.activeSounds = [];
  }

  /** `musicInterface_TidySounds` : retire les sons finis et rend leur source. */
  private tidyPlaying(): void {
    const finished = this.playingSounds.filter((s) => !s.playback.playing);
    if (finished.length === 0) return;
    this.playingSounds = this.playingSounds.filter((s) => s.playback.playing);
    for (const s of finished) {
      this.sources[s.source] = false;
      this.player.remove(s.playback);
    }
  }
}
