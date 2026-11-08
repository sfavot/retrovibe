/**
 * Diagnostic audio sur l'appareil (jeux Mohawk), activé par l'URL : `?audiodebug#/zoombinis`. Paramètre de requête et non de hash : le hash
 * est la route (`main.ts`), et le paramètre survit au lien de l'accueil et au bouton « Jouer » (qui ne changent que le hash).
 *
 * Panneau texte en haut à gauche de l'écran du jeu, transparent aux touchers sauf son bouton « Bip ». Il affiche en continu :
 *  - pour chaque contexte (WAVE, MIDI) : état, fréquence, `baseLatency`, `outputLatency`, latence mesurée par `getOutputTimestamp()`,
 *    `currentTime`, dérive de `currentTime` par rapport à `performance.now()` depuis le premier relevé, plus grand saut de `currentTime`
 *    entre deux images et durée de l'arrêt le plus long de l'horloge (sur la dernière seconde), dernier changement d'état, et si le contexte
 *    a été créé pendant un geste (`navigator.userActivation`) ;
 *  - les 5 derniers WAVE : id, mise en file (`queue`), appel à `start()`, `currentTime` à ce moment, `start(when)` ou non ;
 *  - durée du dernier tick, images par seconde, plus long écart entre deux images ; état de la musique.
 * Le bouton « Bip » joue un bip court par le même chemin que les WAVE du jeu et fait clignoter le panneau au même instant : l'écart perçu
 * entre l'éclair et le son est le délai de la sortie audio de l'appareil.
 *
 * Paramètres d'essai (lus aussi sans `audiodebug`) : `audio=one` (un seul contexte), `audio=nomidi` (pas de synthétiseur), combinables
 * (`audio=one,nomidi`) ; `latency=interactive|balanced|playback|<secondes>` ; `rate=<Hz>` (fréquence imposée aux contextes).
 */
import type { PcmSound } from "../../engine/mohawk/audio/sink";
import type { AudioContextRole, AudioExperiment, AudioProbe, WaveStartEvent, WebAudioSink } from "./web-sink";

export interface AudioDebugParams {
  /** Affiche le panneau. */
  readonly overlay: boolean;
  readonly experiment: AudioExperiment;
}

const LATENCY_HINTS = new Set<string>(["interactive", "balanced", "playback"]);

/** Lit les paramètres du diagnostic dans `search` (`location.search`). */
export function readAudioDebugParams(search: string): AudioDebugParams {
  const params = new URLSearchParams(search);
  const flags = new Set((params.get("audio") ?? "").split(",").map((flag) => flag.trim()).filter(Boolean));
  const latency = params.get("latency");
  const rate = Number(params.get("rate"));
  let latencyHint: AudioExperiment["latencyHint"];
  if (latency && LATENCY_HINTS.has(latency)) latencyHint = latency as AudioContextLatencyCategory;
  else if (latency && Number(latency) > 0) latencyHint = Number(latency);
  return {
    overlay: params.has("audiodebug"),
    experiment: {
      ...(flags.has("one") ? { singleContext: true } : {}),
      ...(flags.has("nomidi") ? { noMidi: true } : {}),
      ...(latencyHint !== undefined ? { latencyHint } : {}),
      ...(rate >= 3000 && rate <= 384000 ? { sampleRate: rate } : {}),
    },
  };
}

/** Résumé court des réglages d'essai (`—` : réglages normaux). */
export function describeExperiment(experiment: AudioExperiment): string {
  const parts = [
    experiment.singleContext ? "1 contexte" : "",
    experiment.noMidi ? "sans synthé" : "",
    experiment.latencyHint !== undefined ? `latencyHint=${experiment.latencyHint}` : "",
    experiment.sampleRate ? `rate=${experiment.sampleRate}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

/** Service sonore observé : la file (pour l'heure de mise en file), l'id du dernier effet démarré et l'état de la musique. */
export interface DiagnosedSound {
  queue(id: number): void;
  readonly currentEffect: number;
  readonly musicPlaying: boolean;
  readonly lastMusicId: number;
}

/** Bip de test : 70 ms à 1 kHz, attaque et chute de 5 ms (pas de clic). */
export function beepSound(sampleRate = 22050): PcmSound {
  const length = Math.round(sampleRate * 0.07);
  const ramp = Math.round(sampleRate * 0.005);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const envelope = Math.min(1, i / ramp, (length - 1 - i) / ramp);
    samples[i] = 0.5 * envelope * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  }
  return { samples, sampleRate };
}

/** Relevés d'une horloge de contexte, image après image. */
class ClockTrack {
  /** `performance.now() − currentTime` (ms) au premier relevé où l'horloge tourne. */
  private origin: number | null = null;
  private lastCtx = -1;
  private lastPerf = 0;
  /** Début de l'arrêt en cours de l'horloge (contexte « running » dont `currentTime` ne bouge pas). */
  private frozenSince: number | null = null;
  private window: { at: number; step: number; frozen: number }[] = [];
  createdInGesture: boolean | null = null;
  createdAt = 0;
  lastState = "";
  stateLog = "";

  constructor(readonly role: AudioContextRole) {}

  sample(ctx: AudioContext, now: number): void {
    const time = ctx.currentTime * 1000;
    if (ctx.state === "running" && this.origin === null && time > 0) this.origin = now - time;
    let step = 0;
    let frozen = 0;
    if (this.lastCtx >= 0) {
      step = time - this.lastCtx;
      if (ctx.state === "running" && step === 0) this.frozenSince ??= this.lastPerf;
      else this.frozenSince = null;
      if (this.frozenSince !== null) frozen = now - this.frozenSince;
    }
    this.lastCtx = time;
    this.lastPerf = now;
    this.window.push({ at: now, step, frozen });
    while (this.window.length > 0 && now - this.window[0].at > 1000) this.window.shift();
  }

  /** Dérive (ms) : de combien `performance.now()` a pris d'avance sur `currentTime` depuis le premier relevé. */
  drift(ctx: AudioContext, now: number): number | null {
    return this.origin === null ? null : now - ctx.currentTime * 1000 - this.origin;
  }

  get maxStep(): number {
    return Math.max(0, ...this.window.map((s) => s.step));
  }

  get maxFrozen(): number {
    return Math.max(0, ...this.window.map((s) => s.frozen));
  }
}

interface SoundRow {
  label: string;
  queuedAt: number | null;
  event: WaveStartEvent;
}

const ROWS = 5;
const RENDER_INTERVAL_MS = 250;

const ms = (value: number | null | undefined, digits = 0): string => (value === null || value === undefined || Number.isNaN(value) ? "?" : value.toFixed(digits));
const sec = (value: number): string => (value / 1000).toFixed(3);

/** Panneau de diagnostic : à créer avant le premier `unlock()` pour voir la création des contextes. */
export class AudioDebugOverlay implements AudioProbe {
  readonly element: HTMLElement;
  private readonly text: HTMLElement;
  private readonly clocks = new Map<AudioContext, ClockTrack>();
  private readonly queued = new Map<number, number[]>();
  private readonly rows: SoundRow[] = [];
  private pendingLabel: string | null = null;
  private readonly beep = beepSound();
  private readonly frames: number[] = [];
  private lastTick = 0;
  private maxTick = 0;
  private lastRender = 0;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private sound: DiagnosedSound | null = null;
  private restoreQueue: (() => void) | null = null;

  constructor(
    private readonly sink: WebAudioSink,
    private readonly experiment: AudioExperiment,
  ) {
    this.element = document.createElement("div");
    this.element.className = "audio-debug";
    Object.assign(this.element.style, {
      position: "absolute",
      top: "4px",
      left: "4px",
      zIndex: "50",
      maxWidth: "calc(100% - 8px)",
      padding: "4px 6px",
      font: "11px/1.3 ui-monospace, Menlo, monospace",
      color: "#e8ffe8",
      background: "rgba(0, 0, 0, 0.62)",
      borderRadius: "4px",
      pointerEvents: "none",
      whiteSpace: "pre-wrap",
      overflow: "hidden",
      lineHeight: "1.3",
    } satisfies Partial<CSSStyleDeclaration>);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Bip";
    button.setAttribute("aria-label", "Bip de test");
    Object.assign(button.style, {
      pointerEvents: "auto",
      float: "right",
      marginLeft: "8px",
      minWidth: "44px",
      minHeight: "32px",
      font: "bold 13px ui-monospace, Menlo, monospace",
      color: "#000",
      background: "#9f9",
      border: "0",
      borderRadius: "4px",
      touchAction: "manipulation",
    } satisfies Partial<CSSStyleDeclaration>);
    // `pointerdown` et non `click` : pas d'attente de fin de geste ; le toucher reste un geste qui peut débloquer le son.
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.playBeep();
    });
    this.text = document.createElement("div");
    this.element.append(button, this.text);
    sink.setProbe(this);
  }

  /** Observe le service sonore du jeu (heure de mise en file des ids, musique). */
  watch(sound: DiagnosedSound): void {
    this.restoreQueue?.();
    this.sound = sound;
    const original = sound.queue;
    // Enveloppe de l'instance seulement (diagnostic) : l'appel d'origine reste inchangé.
    sound.queue = (id: number) => {
      const now = performance.now();
      const list = this.queued.get(id) ?? [];
      list.push(now);
      this.queued.set(id, list);
      original.call(sound, id);
    };
    this.restoreQueue = () => {
      delete (sound as { queue?: unknown }).queue;
      if (sound.queue !== original) sound.queue = original;
    };
  }

  contextCreated(role: AudioContextRole, ctx: AudioContext): void {
    const track = new ClockTrack(role);
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    track.createdInGesture = activation ? activation.isActive : null;
    track.createdAt = performance.now();
    track.lastState = ctx.state;
    track.stateLog = `${ctx.state}@${sec(track.createdAt)}`;
    ctx.addEventListener("statechange", () => {
      track.lastState = ctx.state;
      track.stateLog = `${track.stateLog.split(" > ").slice(-2).join(" > ")} > ${ctx.state}@${sec(performance.now())}`;
    });
    this.clocks.set(ctx, track);
  }

  waveStarted(event: WaveStartEvent): void {
    let label: string;
    let queuedAt: number | null = null;
    if (this.pendingLabel !== null) {
      label = this.pendingLabel;
    } else if (this.sound) {
      const id = this.sound.currentEffect;
      label = String(id);
      const list = this.queued.get(id);
      if (list && list.length > 0) queuedAt = list[0];
      this.queued.delete(id);
    } else {
      label = "?";
    }
    this.rows.unshift({ label, queuedAt, event });
    this.rows.length = Math.min(this.rows.length, ROWS);
    // Ids jamais joués (écartés par la priorité) : oubliés après 5 s.
    for (const [id, list] of this.queued) {
      const kept = list.filter((at) => event.perfTime - at < 5000);
      if (kept.length > 0) this.queued.set(id, kept);
      else this.queued.delete(id);
    }
    this.lastRender = 0;
  }

  /** À chaque image : `tickMs` est la durée du tick du moteur. */
  frame(tickMs: number): void {
    const now = performance.now();
    this.lastTick = tickMs;
    this.frames.push(now);
    while (this.frames.length > 0 && now - this.frames[0] > 2000) this.frames.shift();
    this.maxTick = Math.max(this.maxTick * 0.98, tickMs);
    for (const [ctx, track] of this.clocks) track.sample(ctx, now);
    if (now - this.lastRender >= RENDER_INTERVAL_MS) {
      this.lastRender = now;
      this.render(now);
    }
  }

  playBeep(): void {
    this.sink.unlock();
    this.pendingLabel = "BIP";
    try {
      this.sink.playWave(this.beep, false);
    } finally {
      this.pendingLabel = null;
    }
    this.element.style.background = "rgba(255, 255, 255, 0.95)";
    this.element.style.color = "#000";
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.element.style.background = "rgba(0, 0, 0, 0.62)";
      this.element.style.color = "#e8ffe8";
    }, 120);
    this.render(performance.now());
  }

  dispose(): void {
    clearTimeout(this.flashTimer);
    this.restoreQueue?.();
    this.restoreQueue = null;
    this.sink.setProbe(null);
    this.element.remove();
  }

  private render(now: number): void {
    const lines: string[] = [];
    lines.push(`essai: ${describeExperiment(this.experiment)}  t=${sec(now)}`);
    const { wave, midi, synth } = this.sink.diagnostics;
    if (!wave) lines.push("audio: pas encore débloqué (toucher l'écran)");
    const seen = new Set<AudioContext>();
    for (const [name, ctx] of [["WAVE", wave], ["MIDI", midi]] as const) {
      if (!ctx || seen.has(ctx)) continue;
      seen.add(ctx);
      const track = this.clocks.get(ctx);
      const label = wave === midi ? "W+M " : name;
      lines.push(this.contextLine(label, ctx, track, now));
      if (track) {
        const gesture = track.createdInGesture === null ? "?" : track.createdInGesture ? "oui" : "NON";
        lines.push(`     geste:${gesture} états: ${track.stateLog}`);
      }
    }
    const fps = this.frames.length > 1 ? ((this.frames.length - 1) * 1000) / (this.frames[this.frames.length - 1] - this.frames[0]) : 0;
    let gap = 0;
    for (let i = 1; i < this.frames.length; i++) gap = Math.max(gap, this.frames[i] - this.frames[i - 1]);
    lines.push(`tick ${ms(this.lastTick, 1)}ms (max ${ms(this.maxTick, 0)})  fps ${ms(fps, 0)}  écart max ${ms(gap)}ms`);
    const music = this.sound ? (this.sound.musicPlaying ? `joue #${this.sound.lastMusicId}` : this.sound.lastMusicId ? `arrêtée (#${this.sound.lastMusicId})` : "aucune") : "?";
    lines.push(`musique ${music}  synthé ${synth}`);
    lines.push("id      file→start  start(s)  ctx(s)    when");
    for (const { label, queuedAt, event } of this.rows) {
      const wait = queuedAt === null ? "    —" : `${ms(event.perfTime - queuedAt, 0).padStart(4)}ms`;
      const ctxTime = event.ctxTime === null ? "—" : event.ctxTime.toFixed(3);
      const when = event.when === undefined ? "∅" : event.when.toFixed(3);
      const status = event.started ? "" : ` ABANDONNÉ (${event.state})`;
      lines.push(`${label.padEnd(7)} ${wait.padStart(10)}  ${sec(event.perfTime).padStart(8)}  ${ctxTime.padStart(8)}  ${when} ${ms(event.durationMs)}ms${status}`);
    }
    this.text.textContent = lines.join("\n");
  }

  private contextLine(label: string, ctx: AudioContext, track: ClockTrack | undefined, now: number): string {
    const base = ctx.baseLatency * 1000;
    const output = (ctx as AudioContext & { outputLatency?: number }).outputLatency;
    let pipeline = "?";
    if (typeof ctx.getOutputTimestamp === "function") {
      const stamp = ctx.getOutputTimestamp();
      if (stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0) {
        // Temps entre l'échantillon que le contexte produit et celui qui sort du haut-parleur (horloges du contexte et de la page).
        pipeline = `${ms((ctx.currentTime - stamp.contextTime) * 1000)}/${ms(now - stamp.performanceTime)}`;
      }
    }
    const drift = track?.drift(ctx, now);
    return (
      `${label} ${ctx.state} ${ctx.sampleRate}Hz base ${ms(base, 1)} out ${output === undefined ? "n/a" : ms(output * 1000, 1)} ` +
      `ts ${pipeline}ms t ${ctx.currentTime.toFixed(3)} dérive ${drift === null || drift === undefined ? "?" : ms(drift)}ms ` +
      `saut ${ms(track?.maxStep)} figée ${ms(track?.maxFrozen)}ms`
    );
  }
}
