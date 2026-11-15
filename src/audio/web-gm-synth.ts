/**
 * Synthétiseur General MIDI du navigateur : `spessasynth_lib` (`WorkletSynthesizer`) branché sur un contexte audio fourni par l'appelant.
 * Commun à tous les jeux qui jouent du MIDI sur une soundfont (Mathémagique, Zoombinis, The Incredible Machine 3). Aucune dépendance à un moteur.
 * Sorti de `src/ui/mohawk/web-sink.ts` (évolution M2 de `docs/tim3/plan.md`), sans changement de comportement.
 *
 * - Le contexte et son gain de sortie sont créés par l'appelant au déverrouillage (geste de l'utilisateur) ; le synthétiseur est créé par
 *   `load()`, que l'appelant lance au bon moment (après la première image, pour ne pas concurrencer le chargement du jeu). La soundfont, dont
 *   l'URL est un paramètre, se charge en tâche de fond. Tant qu'il n'est pas prêt, les messages sont ignorés sans erreur.
 * - Les messages datés partent vers le worklet au plus `FLUSH_WINDOW_MS` avant leur heure : le worklet ne sait pas annuler un message
 *   planifié, alors que `reset()` doit pouvoir couper net ce que le séquenceur a planifié d'avance. Les note-on déjà partis mais pas encore
 *   joués reçoivent de `reset()` un note-off à la même heure : sinon la note démarre après la coupure et reste tenue sans fin.
 * - La reprise du contexte (iOS interrompu), le gain maître et la fermeture du contexte restent à l'appelant : `close()` ne détruit que le synthétiseur.
 */
import { WorkletSynthesizer } from "spessasynth_lib";
// Le processeur du worklet est un fichier à part : `?url` le fait copier par Vite dans les assets (chemin relatif à `base`).
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";

/** Au plus cette avance (ms) entre l'envoi au worklet et l'heure d'un message. */
export const FLUSH_WINDOW_MS = 30;
const FLUSH_INTERVAL_MS = 8;

interface QueuedMessage {
  at: number;
  message: Uint8Array;
}

export interface WebGmSynthOptions {
  /** URL de la soundfont (`.sf2`) à charger. */
  soundfontUrl: string;
  /** Appelé une fois, quand le synthétiseur devient prêt. */
  onReady?: () => void;
  /** Appelé si le chargement échoue (et que la sortie n'a pas été fermée entre-temps) ; par défaut, un avertissement console. */
  onError?: (error: unknown) => void;
}

export class WebGmSynth {
  private synth: WorkletSynthesizer | null = null;
  private isReady = false;
  private started = false;
  private closed = false;
  private queue: QueuedMessage[] = [];
  /** Note-on confiés au worklet avec une heure encore à venir (le worklet les jouera même après `reset()`). */
  private posted: QueuedMessage[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  /** `ctx` : contexte du worklet, dont l'horloge date les messages ; `output` : nœud auquel le synthétiseur se connecte. */
  constructor(
    private readonly ctx: AudioContext,
    private readonly output: AudioNode,
    private readonly options: WebGmSynthOptions,
  ) {}

  /** Le synthétiseur est chargé : les messages sont joués. */
  get ready(): boolean {
    return this.isReady;
  }

  /** Horloge du contexte (ms), celle des messages datés. */
  now(): number {
    return this.ctx.currentTime * 1000;
  }

  /** Charge le worklet, le synthétiseur et la soundfont. Sans effet répété. */
  async load(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    try {
      await this.ctx.audioWorklet.addModule(processorUrl);
      if (this.closed) return;
      const synth = new WorkletSynthesizer(this.ctx);
      try {
        synth.connect(this.output);
        const response = await fetch(this.options.soundfontUrl);
        if (!response.ok) throw new Error(`soundfont : HTTP ${response.status}`);
        const bank = await response.arrayBuffer();
        if (this.closed) throw new Error("fermé");
        await synth.soundBankManager.addSoundBank(bank, "main");
        await synth.isReady;
        if (this.closed) throw new Error("fermé");
      } catch (error) {
        synth.destroy();
        throw error;
      }
      this.synth = synth;
      this.isReady = true;
      this.options.onReady?.();
    } catch (error) {
      // Le jeu reste jouable sans musique MIDI (et rien à signaler si la page a été quittée pendant le chargement).
      if (!this.closed) (this.options.onError ?? ((e) => console.warn("synthétiseur MIDI indisponible", e)))(error);
    }
  }

  /** Envoie un message MIDI, à `atMs` (horloge de `now()`) ou tout de suite. */
  send(message: Uint8Array, atMs?: number): void {
    if (!this.isReady || !this.synth) return;
    if (atMs === undefined || atMs - this.now() <= FLUSH_WINDOW_MS) {
      this.post(message, atMs);
      return;
    }
    this.queue.push({ at: atMs, message });
    this.queue.sort((a, b) => a.at - b.at);
    this.flushTimer ??= setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private post(message: Uint8Array, atMs?: number): void {
    this.synth?.sendMessage(message, 0, atMs === undefined ? undefined : { time: atMs / 1000 });
    if (atMs === undefined || (message[0] & 0xf0) !== 0x90 || message[2] === 0) return;
    const now = this.now();
    this.posted = this.posted.filter((m) => m.at > now);
    if (atMs > now) this.posted.push({ at: atMs, message });
  }

  private flush(): void {
    const limit = this.now() + FLUSH_WINDOW_MS;
    while (this.queue.length > 0 && this.queue[0].at <= limit) {
      const { at, message } = this.queue.shift()!;
      this.post(message, at);
    }
    if (this.queue.length === 0 && this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /** Coupe net : messages en attente abandonnés, voix coupées, y compris les note-on déjà confiés au worklet. */
  reset(): void {
    this.queue = [];
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    const synth = this.synth;
    const posted = this.posted;
    this.posted = [];
    if (!this.isReady || !synth) return;
    synth.stopAll(true);
    // Le worklet garde ses messages datés : chaque note-on encore à venir reçoit son note-off à la même heure (traité juste après lui).
    const now = this.now();
    for (const { at, message } of posted) {
      if (at > now) this.post(Uint8Array.of(0x80 | (message[0] & 0x0f), message[1], 0), at);
    }
    for (let channel = 0; channel < 16; channel++) {
      this.post(Uint8Array.of(0xb0 | channel, 123, 0)); // toutes les notes coupées
      this.post(Uint8Array.of(0xb0 | channel, 121, 0)); // contrôleurs remis à zéro
    }
  }

  /** Coupe le son puis détruit le synthétiseur (le contexte reste à l'appelant). Définitif et idempotent. */
  close(): void {
    if (this.closed) return;
    this.reset();
    this.closed = true;
    const { synth } = this;
    this.synth = null;
    this.isReady = false;
    try {
      synth?.destroy();
    } catch {
      // déjà libéré
    }
  }
}
