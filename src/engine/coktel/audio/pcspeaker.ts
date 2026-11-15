/**
 * Haut-parleur du PC, d'après ScummVM (`engines/gob/sound/pcspeaker.cpp`, `sound/sound.cpp:160-184`, et
 * `audio/softsynth/pcspk.cpp` pour la forme du son ; GPL v3+). Une onde carrée à la fréquence demandée,
 * jouée sans fin (durée -1) ou pendant `length` ms, coupée par speakerOff ou après le délai de speakerOnUpdate.
 *
 * L'état est tenu ici, sur l'horloge du jeu (testable sans navigateur) ; la sortie, si elle existe, n'est
 * qu'un générateur d'onde carrée (`SpeakerOutput`).
 */

/** Volume de PCSpeaker::play par défaut (PCSPK_DEFAULT_VOLUME = 20, onde de ±128) : 20 × 128 / 32 768. */
export const SPEAKER_GAIN = (20 * 128) / 32768;

/** Générateur d'onde carrée (Web Audio dans le navigateur). */
export interface SpeakerOutput {
  /** Onde carrée à `frequency` Hz, pendant `durationMs` ms (Infinity : jusqu'à `stop`), en remplacement de la précédente. */
  play(frequency: number, durationMs: number): void;
  /** Fixe la fin de la note à `delayMs` ms d'ici (0 : tout de suite), quitte à la prolonger. */
  stop(delayMs: number): void;
}

export class PcSpeaker {
  /** Fréquence de la dernière note demandée (Hz), 0 avant la première. */
  frequency = 0;
  /** Instant (horloge du jeu) où la note s'arrête ; Infinity tant qu'elle joue sans fin, 0 sans note. */
  private endMs = 0;

  constructor(
    private readonly now: () => number,
    private readonly output: SpeakerOutput | null = null,
  ) {}

  /** Vrai tant qu'une note sonne (PCSpeakerStream::isPlaying). */
  get playing(): boolean {
    return this.now() < this.endMs;
  }

  /** PCSpeaker::speakerOn : `length` -1 = jusqu'à l'arrêt, sinon en millisecondes. */
  speakerOn(frequency: number, length: number): void {
    this.frequency = frequency;
    // Fréquence nulle ou négative : la division de PCSpeakerStream::play n'a pas de sens, on ne joue rien.
    if (frequency <= 0) {
      this.speakerOff();
      return;
    }
    const duration = length === -1 ? Infinity : Math.max(0, length);
    this.endMs = this.now() + duration;
    this.output?.play(frequency, duration);
  }

  /** PCSpeaker::speakerOff : arrêt immédiat. */
  speakerOff(): void {
    this.stop(0);
  }

  /**
   * PCSpeaker::onUpdate (o1_keyFunc, attente de `millis` ms) : une note en cours s'arrête à la fin de
   * l'attente. Comme PCSpeakerStream::stop pour une note lancée par play (pas de file de commandes), la
   * fin est fixée à `millis` ms, même si la note devait s'arrêter plus tôt.
   */
  onUpdate(millis: number): void {
    if (this.playing) this.stop(millis);
  }

  /** PCSpeakerStream::stop(delay). */
  private stop(delayMs: number): void {
    this.endMs = delayMs > 0 ? this.now() + delayMs : 0;
    this.output?.stop(Math.max(0, delayMs));
  }
}
