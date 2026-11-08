import type { SampleVoice, Sample } from "../../../audio/web-sample-output";
import { LOAD_TIMEOUT_MS, type VoiceBank } from "./voices";

/** Ce que la voie demande à la sortie audio : jouer un échantillon, et l'horloge du jeu. */
export interface SamplePlayer {
  play(sample: Sample): SampleVoice;
  clockNow(): number;
}

/**
 * Une voie sonore (la voix, ou l'effet) : un seul son à la fois, le suivant remplace le précédent (`stopHandle` de ScummVM pour
 * un effet ; pour une voix, ScummVM attend la fin de la précédente, ici la nouvelle la remplace comme à Drascula : le moteur
 * attend la fin de ses répliques de lui-même).
 *
 * Un son en cours de chargement est « actif » (jusqu'à `LOAD_TIMEOUT_MS` ou à son échec), puis pendant sa durée sur l'horloge du
 * jeu : le temps du jeu ne dépend ni du décodage ni du son réel (voir `voices.ts`).
 */
export class SampleChannel {
  private voice: SampleVoice | null = null;
  private serial = 0;
  /** Date (horloge du jeu) de la demande d'un son encore en chargement, sinon `null`. */
  private waitingSince: number | null = null;

  constructor(
    private readonly bank: VoiceBank,
    private readonly output: SamplePlayer,
  ) {}

  /** Lance le son `name` (nom de fichier) ; faux si le fichier n'existe pas. */
  play(name: string): boolean {
    this.stop();
    if (!this.bank.has(name)) return false;
    const cached = this.bank.peek(name);
    if (cached) {
      this.voice = this.output.play(cached);
      return true;
    }
    const mine = ++this.serial;
    this.waitingSince = this.output.clockNow();
    void this.bank.sample(name).then((sample) => {
      if (mine !== this.serial) return;
      this.waitingSince = null;
      if (sample) this.voice = this.output.play(sample);
    });
    return true;
  }

  get active(): boolean {
    if (this.voice?.playing) return true;
    return this.waitingSince !== null && this.output.clockNow() - this.waitingSince < LOAD_TIMEOUT_MS;
  }

  stop(): void {
    this.serial++;
    this.waitingSince = null;
    this.voice?.stop();
    this.voice = null;
  }
}
