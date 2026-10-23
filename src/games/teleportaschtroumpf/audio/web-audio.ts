import type { AudioBackend, PcmSound } from "./backend";

/**
 * Sortie son via Web Audio : la voie et le bruitage (`playEffect`) sont deux sources sur le même `GainNode`, donc
 * le même volume ; leur somme est écrêtée à la sortie, comme la somme saturée de `348d:021a`. Le contexte n'est créé qu'après un geste de
 * l'utilisateur (`unlock()`), comme l'exigent les navigateurs ; avant cela, `play` et `playEffect` ne font rien et
 * `playing` et `effectPlaying` restent faux.
 */
export class WebAudioBackend implements AudioBackend {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private duration = 0;
  private looping = false;
  private active = false;
  private effectSource: AudioBufferSourceNode | null = null;
  private effectActive = false;
  private gain = 1;
  private muted = false;
  /** Figé par `suspend()` (onglet masqué) : le contexte ne doit pas repartir avant `resume()`. */
  private suspended = false;
  /** Reprises lancées dont la promesse `ctx.resume()` n'est pas résolue : le contexte y est encore `suspended`, mais les sons sont seulement en attente. */
  private resuming = 0;
  /** Suite des `suspend()` / `resume()` du contexte : chaque appel attend la fin du précédent, pour que le dernier gagne. */
  private transition: Promise<unknown> = Promise.resolve();
  private transitions = 0;
  private readonly buffers = new WeakMap<Uint8Array, AudioBuffer>();

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.outputGain();
      this.gainNode.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended" && !this.suspended) this.startResume(this.ctx);
  }

  /** Exécute `op` tout de suite si aucune transition n'est en cours, sinon à la suite de la dernière. */
  private enqueue(op: () => Promise<void> | undefined): Promise<unknown> {
    const run = (): Promise<unknown> => Promise.resolve(op()).catch(() => undefined);
    this.transitions++;
    const done = (): void => {
      this.transitions--;
    };
    this.transition = (this.transitions === 1 ? run() : this.transition.then(run)).finally(done);
    return this.transition;
  }

  /** Relance le contexte après les transitions en cours ; tant que la promesse n'est pas résolue, la sortie reste « vivante ». */
  private startResume(ctx: AudioContext): void {
    this.resuming++;
    void this.enqueue(() => ctx.resume()).finally(() => {
      this.resuming--;
    });
  }

  private buffer(ctx: AudioContext, sound: PcmSound): AudioBuffer {
    let buffer = this.buffers.get(sound.samples);
    if (buffer) return buffer;
    // `createBuffer` exige au moins 3000 Hz.
    buffer = ctx.createBuffer(1, sound.samples.length, Math.max(3000, sound.sampleRate));
    const out = buffer.getChannelData(0);
    for (let i = 0; i < out.length; i++) out[i] = (sound.samples[i] - 128) / 128;
    this.buffers.set(sound.samples, buffer);
    return buffer;
  }

  play(sound: PcmSound, loop: boolean): void {
    this.stop();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.gainNode || sound.samples.length === 0) return;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(ctx, sound);
    source.loop = loop;
    source.connect(this.gainNode);
    source.onended = () => {
      if (this.source === source) this.active = false;
    };
    source.start();
    this.source = source;
    this.startedAt = ctx.currentTime;
    this.duration = source.buffer.duration;
    this.looping = loop;
    this.active = true;
  }

  playEffect(sound: PcmSound): void {
    this.stopEffect();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.gainNode || sound.samples.length === 0) return;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(ctx, sound);
    source.connect(this.gainNode);
    source.onended = () => {
      if (this.effectSource === source) this.effectActive = false;
    };
    source.start();
    this.effectSource = source;
    this.effectActive = true;
  }

  stopEffect(): void {
    const source = this.effectSource;
    this.effectSource = null;
    this.effectActive = false;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // déjà arrêté
    }
  }

  /** Vrai si la sortie est utilisable : contexte démarré, figé par `suspend()` ou en cours de reprise (les sons y sont seulement en pause). */
  private get live(): boolean {
    return this.ctx?.state === "running" || ((this.suspended || this.resuming > 0) && this.ctx !== null);
  }

  get effectPlaying(): boolean {
    return this.effectActive && this.live;
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    this.active = false;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // déjà arrêté
    }
  }

  get playing(): boolean {
    return this.active && this.live;
  }

  get position(): number {
    // `currentTime` est figé tant que le contexte est suspendu : la position aussi.
    if (!this.active || !this.ctx) return 0;
    const elapsed = this.ctx.currentTime - this.startedAt;
    return this.looping && this.duration > 0 ? elapsed % this.duration : Math.min(elapsed, this.duration);
  }

  /** Gain réellement envoyé : le volume du jeu, ou 0 si l'utilisateur a coupé le son. */
  private outputGain(): number {
    return this.muted ? 0 : this.gain;
  }

  setGain(gain: number): void {
    this.gain = gain;
    if (this.gainNode) this.gainNode.gain.value = this.outputGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gainNode) this.gainNode.gain.value = this.outputGain();
  }

  suspend(): void {
    this.suspended = true;
    const ctx = this.ctx;
    if (!ctx) return;
    // Chaînée : un `resume()` très proche ne doit pas passer avant et laisser le contexte suspendu.
    void this.enqueue(() => (ctx.state === "running" ? ctx.suspend() : undefined));
  }

  resume(): void {
    this.suspended = false;
    // Appelé quel que soit l'état : une suspension encore en cours est rattrapée par la chaîne.
    if (this.ctx) this.startResume(this.ctx);
  }
}
