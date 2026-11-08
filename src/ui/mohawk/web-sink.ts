/**
 * `AudioSink` pour le navigateur (partagé par Mathémagique et Zoombinis) : Web Audio pour les WAVE, `spessasynth_lib` (soundfont General MIDI) pour le MIDI.
 *
 * - Deux contextes, créés au premier `unlock()` (geste de l'utilisateur) ; avant, `now()` vaut 0 et rien ne sort. Les WAVE ont leur propre
 *   contexte, sans worklet : WebKit (Safari, iPad) rend tout un contexte qui a un `AudioWorklet` sur le fil du worklet, puis le fait passer
 *   par une FIFO de 96 quanta (`AudioDestinationResampler`) qui retarde sa sortie et cède quand le synthétiseur peine ; les bruitages et les
 *   voix arrivaient alors bien après l'image qui les déclenche. Le synthétiseur MIDI vit dans le second contexte, qui donne `now()`.
 * - WAVE : un `AudioBufferSourceNode` par voix (plusieurs en même temps, boucle, détection de fin par `onended`).
 * - MIDI : le synthétiseur (`WorkletSynthesizer`) est créé quand `unlock()` a eu lieu **et** que `startMidiLoading()` a été demandé
 *   (l'app attend la première image pour ne pas concurrencer le chargement du jeu) ; la soundfont réduite (18 Mo) se charge en tâche
 *   de fond (`scripts/lib/soundfont.mts`). Tant qu'il n'est pas prêt, les messages MIDI sont ignorés sans erreur ;
 *   `onReady` signale le moment où il le devient.
 * - Reprise : chaque geste (`unlock()`), le retour de l'onglet (`resume()`), un `statechange` et un son demandé relancent tout contexte qui ne
 *   tourne pas, `interrupted` d'iOS compris (appel, Siri, verrouillage, changement de sortie). Les appels partent directement au navigateur :
 *   WebKit garde en attente un `resume()` fait pendant une interruption, et une file de transitions resterait bloquée derrière lui. Une voix
 *   d'un contexte qui ne repart pas est abandonnée (`isWavePlaying` faux) au lieu de rester « en cours » sans fin.
 * - `close()` libère tout (voix, synthétiseur, contexte) quand la page est quittée.
 * - Les messages MIDI datés partent vers le worklet au plus `FLUSH_WINDOW_MS` avant leur heure : le worklet ne sait pas
 *   annuler un message planifié, alors que `reset()` doit pouvoir couper net ce que le séquenceur a planifié d'avance. Les note-on
 *   déjà partis mais pas encore joués reçoivent de `reset()` un note-off à la même heure : sinon la note démarre après la coupure et
 *   reste tenue sans fin.
 * - Muet = gain maître à 0 (WAVE et MIDI) ; la lecture continue, comme le moteur l'attend.
 */
import { WorkletSynthesizer } from "spessasynth_lib";
// Le processeur du worklet est un fichier à part : `?url` le fait copier par Vite dans les assets (chemin relatif à `base`).
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import { createMonoBuffer } from "../../audio/pcm";
import type { AudioSink, MidiSink, PcmSound, WaveHandle } from "../../engine/mohawk/audio/sink";

/** Soundfont réduite, servie par `publicDir` (`original/mathemagique/`). */
export const SOUNDFONT_URL = `${import.meta.env.BASE_URL}mathemagique/mathemagique-gm.sf2`;

/** Au plus cette avance (ms) entre l'envoi au worklet et l'heure d'un message. */
const FLUSH_WINDOW_MS = 30;
const FLUSH_INTERVAL_MS = 8;
/** Délai (ms) pendant lequel un contexte dont l'hôte vient de demander la reprise compte encore comme actif (voix gardées). */
const RESUME_GRACE_MS = 1000;

/** Promesse d'une transition du contexte, sans suite : un refus (pas de geste, contexte fermé) attend simplement la prochaine reprise. */
function settle(promise: Promise<void>): void {
  promise.catch(() => undefined);
}

export interface WebAudioSinkOptions {
  soundfontUrl?: string;
  /** Crée chaque contexte audio, WAVE puis MIDI (par défaut `new AudioContext({ latencyHint: "interactive" })`), pour les essais. */
  createContext?: () => AudioContext;
}

interface QueuedMessage {
  at: number;
  message: Uint8Array;
}

export class WebAudioSink implements AudioSink {
  /** Contexte des WAVE (sans worklet : sortie directe). */
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Contexte du synthétiseur MIDI (worklet) ; son horloge est `now()`. */
  private midiCtx: AudioContext | null = null;
  private midiMaster: GainNode | null = null;
  private muted = false;
  /** Pause demandée par le jeu (onglet masqué) : les contextes doivent rester arrêtés, et les voix n'y sont qu'en pause. */
  private suspended = false;
  /** Heure (`performance.now()`) de la dernière reprise demandée par l'hôte (geste, retour de l'onglet). */
  private resumedAt = Number.NEGATIVE_INFINITY;

  private nextHandle = 1;
  private readonly voices = new Map<WaveHandle, AudioBufferSourceNode>();
  private readonly buffers = new WeakMap<PcmSound, AudioBuffer>();

  private synth: WorkletSynthesizer | null = null;
  private midiReady = false;
  private midiStarted = false;
  private midiWanted = false;
  private closed = false;
  private readonly readyListeners = new Set<() => void>();
  private queue: QueuedMessage[] = [];
  /** Note-on confiés au worklet avec une heure encore à venir (le worklet les jouera même après `reset()`). */
  private posted: QueuedMessage[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  readonly midi: MidiSink = {
    send: (message, atMs) => this.sendMidi(message, atMs),
    reset: () => this.resetMidi(),
  };

  constructor(private readonly options: WebAudioSinkOptions = {}) {}

  unlock(): void {
    if (this.closed) return;
    if (!this.ctx) {
      [this.ctx, this.master] = this.createOutput();
      [this.midiCtx, this.midiMaster] = this.createOutput();
    }
    this.requestResume();
    this.tryStartMidi();
  }

  /**
   * Demande le chargement du synthétiseur et de la soundfont. Sans effet répété ; si le son n'est pas encore débloqué, le chargement
   * démarre à l'`unlock()`.
   */
  startMidiLoading(): void {
    this.midiWanted = true;
    this.tryStartMidi();
  }

  /** Le synthétiseur est chargé : les messages MIDI sont joués. */
  get ready(): boolean {
    return this.midiReady;
  }

  /**
   * `listener` est appelé une fois, quand le synthétiseur devient prêt (tout de suite s'il l'est déjà). Ne l'est jamais en cas d'échec
   * du chargement. Renvoie la fonction qui retire l'écouteur.
   */
  onReady(listener: () => void): () => void {
    if (this.midiReady) {
      listener();
      return () => {};
    }
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  private createOutput(): [AudioContext, GainNode] {
    const ctx = this.options.createContext?.() ?? new AudioContext({ latencyHint: "interactive" });
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);
    // iOS arrête un contexte de lui-même (`interrupted` : appel, Siri, verrouillage, changement de sortie…, puis parfois `suspended`) : on
    // redemande aussitôt la reprise, que WebKit tient en attente jusqu'à la fin de l'interruption ; le prochain geste la redemande aussi.
    ctx.onstatechange = () => this.revive(ctx);
    return [ctx, master];
  }

  private get contexts(): AudioContext[] {
    return [this.ctx, this.midiCtx].filter((ctx): ctx is AudioContext => ctx !== null);
  }

  private tryStartMidi(): void {
    if (this.closed || !this.midiWanted || this.midiStarted || !this.midiCtx || !this.midiMaster) return;
    this.midiStarted = true;
    void this.startMidi(this.midiCtx, this.midiMaster);
  }

  /** Horloge du contexte MIDI (celle des messages datés). */
  now(): number {
    return (this.midiCtx?.currentTime ?? 0) * 1000;
  }

  // --- WAVE ---------------------------------------------------------------------------------------------------

  playWave(sound: PcmSound, loop: boolean): WaveHandle {
    const handle = this.nextHandle++;
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running") this.revive(ctx);
    if (!ctx || ctx.state !== "running" || !this.master || sound.samples.length === 0) return handle;
    const source = ctx.createBufferSource();
    source.buffer = this.bufferOf(ctx, sound);
    source.loop = loop;
    source.connect(this.master);
    source.onended = () => {
      if (this.voices.get(handle) === source) this.voices.delete(handle);
    };
    this.voices.set(handle, source);
    source.start();
    return handle;
  }

  stopWave(handle: WaveHandle): void {
    const source = this.voices.get(handle);
    if (!source) return;
    this.voices.delete(handle);
    source.onended = null;
    try {
      source.stop();
    } catch {
      // déjà arrêté
    }
  }

  /**
   * Faux dès que la sortie ne progresse plus d'elle-même (contexte interrompu ou arrêté hors pause du jeu, au-delà du délai de reprise) :
   * la voix est alors abandonnée, sinon un moteur qui attend sa fin (canal unique des Zoombinis, voix enchaînées) resterait bloqué, et
   * elle repartirait au retour du son par-dessus les suivantes.
   */
  isWavePlaying(handle: WaveHandle): boolean {
    if (!this.voices.has(handle)) return false;
    if (this.live) return true;
    this.stopWave(handle);
    return false;
  }

  private bufferOf(ctx: AudioContext, sound: PcmSound): AudioBuffer {
    let buffer = this.buffers.get(sound);
    if (!buffer) {
      buffer = createMonoBuffer(ctx, sound.samples, sound.sampleRate);
      this.buffers.set(sound, buffer);
    }
    return buffer;
  }

  /**
   * Sortie des WAVE qui avance ou va avancer : contexte démarré, figé par la pause du jeu (les voix y sont seulement en pause), ou dont la
   * reprise vient d'être demandée (`RESUME_GRACE_MS`). Une reprise que le navigateur tient en attente (iOS interrompu) ne compte pas au-delà.
   */
  private get live(): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return false;
    return ctx.state === "running" || this.suspended || performance.now() - this.resumedAt < RESUME_GRACE_MS;
  }

  // --- MIDI ---------------------------------------------------------------------------------------------------

  private async startMidi(ctx: AudioContext, output: AudioNode): Promise<void> {
    try {
      await ctx.audioWorklet.addModule(processorUrl);
      if (this.closed) return;
      const synth = new WorkletSynthesizer(ctx);
      try {
        synth.connect(output);
        const response = await fetch(this.options.soundfontUrl ?? SOUNDFONT_URL);
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
      this.midiReady = true;
      const listeners = [...this.readyListeners];
      this.readyListeners.clear();
      for (const listener of listeners) listener();
    } catch (error) {
      // Le jeu reste jouable sans musique MIDI (et rien à signaler si la page a été quittée pendant le chargement).
      if (!this.closed) console.warn("Mathémagique : synthétiseur MIDI indisponible", error);
    }
  }

  private sendMidi(message: Uint8Array, atMs?: number): void {
    if (!this.midiReady || !this.synth) return;
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

  private resetMidi(): void {
    this.queue = [];
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    const synth = this.synth;
    const posted = this.posted;
    this.posted = [];
    if (!this.midiReady || !synth) return;
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

  // --- Préférence « Son » et cycle de vie ------------------------------------------------------------------------

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const master of [this.master, this.midiMaster]) if (master) master.gain.value = muted ? 0 : 1;
  }

  suspend(): void {
    this.suspended = true;
    for (const ctx of this.contexts) if (ctx.state !== "closed") settle(ctx.suspend());
  }

  resume(): void {
    this.suspended = false;
    this.requestResume();
  }

  /**
   * Libère toute la sortie (page quittée) : voix WAVE arrêtées, MIDI coupé, synthétiseur détruit, contextes fermés. Définitif et
   * idempotent ; `unlock()` ne fait plus rien ensuite.
   */
  close(): void {
    if (this.closed) return;
    this.resetMidi();
    this.closed = true;
    this.readyListeners.clear();
    for (const handle of [...this.voices.keys()]) this.stopWave(handle);
    const { synth } = this;
    const contexts = this.contexts;
    this.synth = null;
    this.midiReady = false;
    this.master = null;
    this.ctx = null;
    this.midiMaster = null;
    this.midiCtx = null;
    try {
      synth?.destroy();
    } catch {
      // déjà libéré
    }
    for (const ctx of contexts) {
      ctx.onstatechange = null;
      if (ctx.state !== "closed") settle(ctx.close());
    }
  }

  /** Reprise demandée par l'hôte (geste, retour de l'onglet) : chaque contexte arrêté, quelle qu'en soit la raison, est relancé. */
  private requestResume(): void {
    if (this.suspended || this.closed) return;
    this.resumedAt = performance.now();
    for (const ctx of this.contexts) this.revive(ctx);
  }

  /**
   * Relance `ctx` s'il ne tourne pas alors qu'il le devrait. Chaque appel part directement au navigateur : une reprise tenue en attente
   * (iOS interrompu) ne doit retenir ni les suivantes ni `suspend` / `close`.
   */
  private revive(ctx: AudioContext): void {
    if (this.suspended || this.closed || ctx.state === "running" || ctx.state === "closed") return;
    settle(ctx.resume());
  }

}
