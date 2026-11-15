/**
 * Voix du professeur : fichiers MP3 chargés à la demande (`VoiceBank`), une seule voix à la fois (`SampleChannel` : la nouvelle remplace
 * l'ancienne). Une voix absente ne joue rien (`play` rend faux : l'interface montre le texte seul) ; une voix lente à charger reste « active »
 * au plus `LOAD_TIMEOUT_MS` (voir `voice-bank.ts`), puis l'interface n'attend plus.
 *
 * La synchro labiale se lit sur la voix en cours (`mouth`) : l'instant est celui de l'horloge du jeu depuis le début réel de la lecture, donc
 * figé quand l'onglet est masqué, comme la voix.
 */
import { SampleChannel, type SamplePlayer } from "../../../audio/sample-channel";
import { VoiceBank } from "../../../audio/voice-bank";
import type { PlayOptions, Sample, SampleVoice } from "../../../audio/web-sample-output";
import { REST_POSE, mouthAt, type LipSyncTable, type MouthPose } from "./lipsync";
import { voiceKey, type VoiceRef } from "./ids";

export class Tim3Voices {
  private readonly channel: SampleChannel<string>;
  private current: string | null = null;
  /** Horloge du jeu (ms) au début réel de la lecture de la voix courante, `null` tant qu'elle charge. */
  private startedAt: number | null = null;
  private on = true;

  constructor(
    bank: VoiceBank<string>,
    private readonly output: SamplePlayer,
    private readonly lipsync: LipSyncTable = new Map(),
  ) {
    const recording: SamplePlayer = {
      clockNow: () => output.clockNow(),
      play: (sample: Sample, options?: PlayOptions): SampleVoice => {
        this.startedAt = output.clockNow();
        return output.play(sample, options);
      },
    };
    this.channel = new SampleChannel(bank, recording);
  }

  /** Préférence « voix activées » (D4) : désactivée, `play` ne fait rien et la voix en cours est coupée. */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    this.on = value;
    if (!value) this.stop();
  }

  /** Lance une voix ; faux si les voix sont désactivées ou si le fichier n'existe pas (texte seul). */
  play(ref: VoiceRef): boolean {
    this.stop();
    if (!this.on) return false;
    const key = voiceKey(ref);
    this.startedAt = null;
    if (!this.channel.play(key)) return false;
    this.current = key;
    return true;
  }

  /** La voix est en cours de chargement ou de lecture. */
  get active(): boolean {
    return this.current !== null && this.channel.active;
  }

  stop(): void {
    this.channel.stop();
    this.current = null;
    this.startedAt = null;
  }

  /** Pose du professeur pour la voix en cours : bouche fermée sans voix, sans synchro, ou tant que la voix charge. */
  mouth(): MouthPose {
    if (this.current === null || this.startedAt === null || !this.channel.active) return REST_POSE;
    return mouthAt(this.lipsync.get(this.current), this.output.clockNow() - this.startedAt);
  }
}
