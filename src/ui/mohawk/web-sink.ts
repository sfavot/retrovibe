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
 * - Le synthétiseur General MIDI (envoi daté par fenêtre de `FLUSH_WINDOW_MS`, `reset()` qui coupe net) est `audio/web-gm-synth.ts`, commun à d'autres
 *   jeux ; ce fichier lui donne son contexte, son gain maître et l'URL de la soundfont, et garde la reprise des contextes.
 * - Muet = gain maître à 0 (WAVE et MIDI) ; la lecture continue, comme le moteur l'attend.
 * - Diagnostic (`audio-debug.ts`) : `setExperiment` change la façon de créer la sortie (un seul contexte, pas de synthétiseur, `latencyHint`,
 *   fréquence) pour comparer sur l'appareil, et `setProbe` signale chaque contexte créé et chaque WAVE lancé, sans rien changer à la lecture.
 */
import { createMonoBuffer } from "../../audio/pcm";
import { WebGmSynth } from "../../audio/web-gm-synth";
import type { AudioSink, MidiSink, PcmSound, WaveHandle } from "../../engine/mohawk/audio/sink";

/** Soundfont réduite, servie par `publicDir` (`original/mathemagique/`). */
export const SOUNDFONT_URL = `${import.meta.env.BASE_URL}mathemagique/mathemagique-gm.sf2`;

/** Délai (ms) pendant lequel un contexte dont l'hôte vient de demander la reprise compte encore comme actif (voix gardées). */
const RESUME_GRACE_MS = 1000;

/** Promesse d'une transition du contexte, sans suite : un refus (pas de geste, contexte fermé) attend simplement la prochaine reprise. */
function settle(promise: Promise<void>): void {
  promise.catch(() => undefined);
}

/** Réglages d'essai de la sortie, pour comparer sur l'appareil (paramètres d'URL de `audio-debug.ts`). Par défaut : réglages normaux. */
export interface AudioExperiment {
  /** Un seul contexte pour les WAVE et le synthétiseur (la sortie d'avant la séparation des contextes). */
  readonly singleContext?: boolean;
  /** Pas de synthétiseur MIDI : la musique est muette, aucun worklet n'est chargé. */
  readonly noMidi?: boolean;
  /** `latencyHint` des contextes (par défaut `"interactive"`). */
  readonly latencyHint?: AudioContextLatencyCategory | number;
  /** Fréquence imposée aux contextes (par défaut celle de la sortie de l'appareil). */
  readonly sampleRate?: number;
}

/** Rôle d'un contexte créé : WAVE, MIDI, ou les deux (`singleContext`). */
export type AudioContextRole = "wave" | "midi" | "shared";

/** Un WAVE demandé à la sortie, vu par le diagnostic. */
export interface WaveStartEvent {
  readonly handle: WaveHandle;
  /** `performance.now()` juste avant `start()` (ou au refus). */
  readonly perfTime: number;
  /** `currentTime` (s) du contexte WAVE à cet instant ; `null` sans contexte. */
  readonly ctxTime: number | null;
  /** État du contexte WAVE au moment de la demande. */
  readonly state: string;
  /** Vrai si `start()` a été appelé ; faux si le son a été abandonné (contexte arrêté, son vide). */
  readonly started: boolean;
  /** Heure passée à `start(when)` ; `undefined` : `start()` sans heure (lecture immédiate). */
  readonly when: number | undefined;
  readonly durationMs: number;
}

/** Observateur de diagnostic : n'agit pas sur la lecture. */
export interface AudioProbe {
  contextCreated?(role: AudioContextRole, ctx: AudioContext): void;
  waveStarted?(event: WaveStartEvent): void;
}

export interface WebAudioSinkOptions {
  soundfontUrl?: string;
  /** Crée chaque contexte audio, WAVE puis MIDI (par défaut `new AudioContext({ latencyHint: "interactive" })`), pour les essais. */
  createContext?: () => AudioContext;
  experiment?: AudioExperiment;
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

  /** Synthétiseur General MIDI (`audio/web-gm-synth.ts`), créé au premier chargement demandé. */
  private gm: WebGmSynth | null = null;
  private midiStarted = false;
  private midiWanted = false;
  private closed = false;
  private readonly readyListeners = new Set<() => void>();
  private experiment: AudioExperiment;
  private probe: AudioProbe | null = null;

  readonly midi: MidiSink = {
    send: (message, atMs) => this.sendMidi(message, atMs),
    reset: () => this.resetMidi(),
  };

  constructor(private readonly options: WebAudioSinkOptions = {}) {
    this.experiment = options.experiment ?? {};
  }

  /** Réglages d'essai (diagnostic) ; sans effet une fois les contextes créés (premier `unlock()`). */
  setExperiment(experiment: AudioExperiment): void {
    if (!this.ctx) this.experiment = experiment;
  }

  /** Observateur de diagnostic (`null` pour le retirer). */
  setProbe(probe: AudioProbe | null): void {
    this.probe = probe;
  }

  /** Contextes et état du synthétiseur, pour le diagnostic (lecture seule). */
  get diagnostics(): { wave: AudioContext | null; midi: AudioContext | null; synth: "off" | "waiting" | "loading" | "ready" } {
    const synth = this.experiment.noMidi ? "off" : this.ready ? "ready" : this.midiStarted ? "loading" : "waiting";
    return { wave: this.ctx, midi: this.midiCtx, synth };
  }

  unlock(): void {
    if (this.closed) return;
    if (!this.ctx) {
      const single = this.experiment.singleContext === true;
      [this.ctx, this.master] = this.createOutput(single ? "shared" : "wave");
      [this.midiCtx, this.midiMaster] = single ? [this.ctx, this.master] : this.createOutput("midi");
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
    return this.gm?.ready ?? false;
  }

  /**
   * `listener` est appelé une fois, quand le synthétiseur devient prêt (tout de suite s'il l'est déjà). Ne l'est jamais en cas d'échec
   * du chargement. Renvoie la fonction qui retire l'écouteur.
   */
  onReady(listener: () => void): () => void {
    if (this.ready) {
      listener();
      return () => {};
    }
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  private createOutput(role: AudioContextRole): [AudioContext, GainNode] {
    const { latencyHint = "interactive", sampleRate } = this.experiment;
    const ctx = this.options.createContext?.() ?? new AudioContext(sampleRate ? { latencyHint, sampleRate } : { latencyHint });
    this.probe?.contextCreated?.(role, ctx);
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);
    // iOS arrête un contexte de lui-même (`interrupted` : appel, Siri, verrouillage, changement de sortie…, puis parfois `suspended`) : on
    // redemande aussitôt la reprise, que WebKit tient en attente jusqu'à la fin de l'interruption ; le prochain geste la redemande aussi.
    ctx.onstatechange = () => this.revive(ctx);
    return [ctx, master];
  }

  private get contexts(): AudioContext[] {
    const contexts = [this.ctx, this.midiCtx].filter((ctx): ctx is AudioContext => ctx !== null);
    return contexts.length === 2 && contexts[0] === contexts[1] ? [contexts[0]] : contexts;
  }

  private tryStartMidi(): void {
    if (this.closed || this.experiment.noMidi || !this.midiWanted || this.midiStarted || !this.midiCtx || !this.midiMaster) return;
    this.midiStarted = true;
    const gm = new WebGmSynth(this.midiCtx, this.midiMaster, {
      soundfontUrl: this.options.soundfontUrl ?? SOUNDFONT_URL,
      onReady: () => {
        const listeners = [...this.readyListeners];
        this.readyListeners.clear();
        for (const listener of listeners) listener();
      },
      onError: (error) => console.warn("Mathémagique : synthétiseur MIDI indisponible", error),
    });
    this.gm = gm;
    void gm.load();
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
    if (!ctx || ctx.state !== "running" || !this.master || sound.samples.length === 0) {
      this.reportWave(handle, ctx, sound, false);
      return handle;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.bufferOf(ctx, sound);
    source.loop = loop;
    source.connect(this.master);
    source.onended = () => {
      if (this.voices.get(handle) === source) this.voices.delete(handle);
    };
    this.voices.set(handle, source);
    this.reportWave(handle, ctx, sound, true);
    source.start();
    return handle;
  }

  private reportWave(handle: WaveHandle, ctx: AudioContext | null, sound: PcmSound, started: boolean): void {
    this.probe?.waveStarted?.({
      handle,
      perfTime: performance.now(),
      ctxTime: ctx?.currentTime ?? null,
      state: ctx?.state ?? "absent",
      started,
      // `start()` est appelé sans heure : lecture dès le prochain quantum du contexte.
      when: undefined,
      durationMs: (sound.samples.length / sound.sampleRate) * 1000,
    });
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

  private sendMidi(message: Uint8Array, atMs?: number): void {
    this.gm?.send(message, atMs);
  }

  private resetMidi(): void {
    this.gm?.reset();
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
    this.gm?.close();
    this.closed = true;
    this.readyListeners.clear();
    for (const handle of [...this.voices.keys()]) this.stopWave(handle);
    const contexts = this.contexts;
    this.master = null;
    this.ctx = null;
    this.midiMaster = null;
    this.midiCtx = null;
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
