import { SONGS, SFX_NAMES, TUNES } from "./tables";
import type { SampleChannel } from "./channel";
import { soundFileName } from "./voices";

/**
 * Logique de son de *Flight of the Amazon Queen* : `Sound` et `PCSound` (`engines/queen/sound.cpp`, `sound.h`, ScummVM, GPL v3
 * ou ultérieure, lus en entier) pour la version PC. Décide, pour un numéro de morceau des listes de commandes, entre une
 * musique, un effet et un changement de volume ; joue les effets (`_sfxName`) et les voix sur leurs voies.
 *
 * `playSong(n)` (lu) :
 * 1. `n <= 0` arrête la musique ; sinon `_song[n]` désigne une liste de morceaux (`_tune`) ;
 * 2. si la liste a un effet, il est joué (si les effets sont actifs) et c'est tout ;
 * 3. sinon, musique active requise, puis selon `overrideCmd` : 1 joue la musique et la retient (`lastOverride`), 2 bascule le
 *    volume (`toggleVChange`), 0 ne fait rien.
 *
 * Écarts : les bascules « effets », « voix » et « musique » du journal (`toggleSfx`…) sont des propriétés ; la version Amiga, la
 * démo et les listes de la démo ne sont pas portées ; un numéro hors des tables est ignoré (ScummVM lit hors de ses tableaux).
 */

/** La musique, vue de la logique de son (`QueenMusic`). */
export interface MusicControl {
  queueTuneList(tuneList: number): void;
  playMusic(): void;
  stopSong(): void;
  toggleVChange(): void;
}

export interface QueenSoundOptions {
  music: MusicControl;
  /** Voie des effets (`_sfxHandle`). */
  sfx: SampleChannel;
  /** Voie des voix (`_speechHandle`). */
  speech: SampleChannel;
}

export class QueenSound {
  sfxOn = true;
  speechOn = true;
  musicOn = true;
  /** Dernier morceau de musique joué (`_lastOverride`), 0 si aucun. */
  lastOverride = 0;
  /** Le dernier `playSpeech` a trouvé son fichier (`_speechSfxExists`). */
  speechSfxExists = false;

  constructor(private readonly options: QueenSoundOptions) {}

  /** `PCSound::playSong`. */
  playSong(songNum: number): void {
    if (songNum <= 0) {
      this.options.music.stopSong();
      return;
    }
    const song = SONGS[songNum - 1];
    if (!song) return;
    const newTune = song.tune - 1;
    const tune = TUNES[newTune];
    if (!tune) return;
    if (tune.sfx) {
      this.playSfx(tune.sfx);
      return;
    }
    if (!this.musicOn) return;
    switch (song.override) {
      case 1:
        break;
      case 2:
        this.options.music.toggleVChange();
        return;
      default:
        return;
    }
    this.lastOverride = songNum;
    this.options.music.queueTuneList(newTune);
    this.options.music.playMusic();
  }

  /** `playLastSong` : relance le dernier morceau retenu (après un chargement, ou la musique rallumée). */
  playLastSong(): void {
    this.playSong(this.lastOverride);
  }

  stopSong(): void {
    this.options.music.stopSong();
  }

  /** `PCSound::playSfx` : effet `sfx` (à partir de 1, 0 = aucun) de `SFX_NAMES`. */
  playSfx(sfx: number): void {
    if (!this.sfxOn || sfx === 0) return;
    const name = SFX_NAMES[sfx - 1];
    if (name === undefined) return;
    this.options.sfx.play(soundFileName(name));
    this.speechSfxExists = false;
  }

  /** `PCSound::playSpeech` : voix `base` (nom calculé par le moteur, espaces pour des zéros). */
  playSpeech(base: string): void {
    if (!this.speechOn) return;
    this.speechSfxExists = this.options.speech.play(soundFileName(base));
  }

  stopSfx(): void {
    this.options.sfx.stop();
  }

  stopSpeech(): void {
    this.options.speech.stop();
  }

  get isSpeechActive(): boolean {
    return this.options.speech.active;
  }

  get isSfxActive(): boolean {
    return this.options.sfx.active;
  }
}
