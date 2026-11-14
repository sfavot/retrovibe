/**
 * Son de l'introduction : voix et ambiances en PCM 8 bits non signé à 11 025 Hz, jouées directement par la sortie d'échantillons.
 *
 * Référence : ScummVM engines/sky/intro.cpp (`PLAYVOICE`, `WAITVOICE`, `LOADBG`, `LOOPBG`, `PLAYBG`, `STOPBG` : `Audio::makeRawStream`
 * en `FLAG_UNSIGNED`, `playStream` en `kSpeechSoundType` / `kSFXSoundType`, `makeLoopingAudioStream`), GPL v3 ou ultérieure.
 *
 * Comme pour les voix des répliques (`audio/speech.ts`), **la durée ne dépend pas du son réel** : une voix « joue » pendant sa durée
 * calculée (octets / 11 025 Hz) sur l'horloge de la sortie d'échantillons, que le contexte soit bloqué, muet ou absent. Sans sortie
 * (`player` absent : test, hôte sans son), l'horloge de l'introduction (`clock`) fait de même.
 *
 * Écart : ScummVM joue la voix de l'introduction sans la couper avant la suivante (`WAITVOICE` précède toujours un `PLAYVOICE`, sauf le
 * `PLAYVOICE` suivant un `PLAYVOICE` sans attente, qui les superpose) ; ici une nouvelle voix remplace la précédente.
 */

import { u8ToFloat32 } from "../../../../audio/pcm";
import type { SamplePlayer } from "../../../../audio/sample-channel";
import type { SampleVoice } from "../../../../audio/web-sample-output";
import type { BassSound } from "../services";
import { INTRO_SAMPLE_RATE, type IntroAudio, type IntroVoice } from "./intro";

export interface IntroAudioOptions {
  /** Section (`loadSection(0)`) et musique (`STARTMUSIC`) : le son du moteur. */
  sound: Pick<BassSound, "loadSection" | "startMusic">;
  /** Sortie d'échantillons (`BassAudio` / `WebSampleOutput`) ; sans elle, rien ne sonne mais les durées restent les mêmes. */
  player?: SamplePlayer;
  /** Horloge de l'introduction (ms), pour les durées sans `player`. */
  clock(): number;
}

/** Voix qui ne sonne pas : « en cours » pendant sa durée, sur une horloge. */
class TimedVoice implements IntroVoice {
  private stopped = false;
  constructor(
    private readonly clock: () => number,
    private readonly endAt: number,
  ) {}
  get playing(): boolean {
    return !this.stopped && this.clock() < this.endAt;
  }
  stop(): void {
    this.stopped = true;
  }
}

export function createIntroAudio(options: IntroAudioOptions): IntroAudio {
  const { sound, player, clock } = options;
  let voice: IntroVoice | null = null;
  let background: SampleVoice | null = null;

  return {
    loadSection: (section) => sound.loadSection(section),
    startMusic: (song) => sound.startMusic(song),
    playVoice(pcm) {
      voice?.stop();
      const durationMs = (pcm.length / INTRO_SAMPLE_RATE) * 1000;
      voice = player ? player.play({ data: u8ToFloat32(pcm), rate: INTRO_SAMPLE_RATE }) : new TimedVoice(clock, clock() + durationMs);
      return voice;
    },
    playBackground(pcm, loop) {
      background?.stop();
      background = player?.play({ data: u8ToFloat32(pcm), rate: INTRO_SAMPLE_RATE }, { loop }) ?? null;
    },
    stopBackground() {
      background?.stop();
      background = null;
    },
  };
}
