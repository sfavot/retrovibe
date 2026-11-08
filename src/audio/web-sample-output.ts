import { MIN_BUFFER_RATE, createMonoBuffer } from "./pcm";

/**
 * Sortie d'échantillons PCM via Web Audio, commune aux jeux (extraite de `WebAudioSoundBackend` de Lost in Time). Utilisée par
 * Drascula, Flight of the Amazon Queen et Lost in Time (`playSample`). Les autres jeux gardent leur sortie propre : leur besoin n'est
 * pas le même (Téléportaschtroumpf : position et fin de lecture lues sur l'horloge réelle du contexte pour synchroniser les vidéos ;
 * SWIV 3D : gain, panoramique et vitesse changés pendant la lecture, rappel de fin ; Mathémagique et Zoombinis : deux contextes, reprise
 * des interruptions iOS, diagnostic ; Indiana Jones : WAV stéréo décodés par le navigateur, sans mute ni pause).
 *
 * - Le contexte n'est créé qu'à `unlock()` (à appeler dans un geste de l'utilisateur). Avant cela, ou tant qu'un contexte
 *   reste bloqué par la politique d'autoplay, `play` ne produit aucun son.
 * - **Le temps du jeu ne dépend jamais du son réel** : une voix est « en cours » (`playing`) pendant sa durée calculée sur
 *   l'horloge du jeu (`now`, ms), qu'un son sorte ou non (contexte absent ou bloqué, son coupé). Les moteurs qui attendent la
 *   fin d'une voix ne sont donc ni bloqués ni accélérés par le navigateur.
 * - Couper le son (`setMuted`) ramène le gain général à 0 sans arrêter les sources : même durée, même fin.
 * - `suspend()` / `resume()` (onglet masqué) figent le contexte ; la durée passée suspendue est ajoutée à la fin des voix.
 *
 * `decode` (voix compressées de Flight of the Amazon Queen) est la seule entrée d'octets compressés.
 *
 * Lost in Time garde sa file de lecture planifiée (`queuePcm`) et sa musique AdLib, qu'il branche sur le même contexte et le même
 * gain général (`onContext`, `connection()`) ; pas de rappel de fin (les moteurs interrogent `playing`), pour que la fin reste celle de l'horloge du jeu.
 */

/** Échantillons mono flottants dans [-1, 1[ (voir `pcm.ts` pour convertir un PCM 8 ou 16 bits). */
export interface Sample {
  readonly data: Float32Array;
  /** Fréquence d'origine (Hz) ; relevée à `MIN_BUFFER_RATE` si plus basse, comme le fait `createMonoBuffer`. */
  readonly rate: number;
}

export interface PlayOptions {
  /** Joue en boucle jusqu'à `stop()` (équivaut à `passes: Infinity`). */
  loop?: boolean;
  /** Nombre total de passes (1 par défaut) ; `Infinity` : en boucle. Ignoré si `loop` est vrai. */
  passes?: number;
}

/** Lecture d'un échantillon. */
export interface SampleVoice {
  /** Vrai pendant la durée de l'échantillon (toujours, en boucle) tant que `stop()` n'a pas été appelé. */
  readonly playing: boolean;
  /** Durée d'une passe, en secondes. */
  readonly duration: number;
  /**
   * Arrête la voix. Avec `fadeSeconds` > 0, le volume de la voix descend à 0 en autant de secondes puis elle s'arrête : elle ne
   * compte plus comme « en cours » que pendant ce fondu.
   */
  stop(fadeSeconds?: number): void;
}

export interface WebSampleOutputOptions {
  /** Millisecondes monotones de l'hôte (`host.now()`). */
  now(): number;
  /** Crée le contexte (par défaut `new AudioContext()`) ; point d'injection des tests. */
  createContext?: () => AudioContext;
  /** Appelé une fois, à la création du contexte, avec son gain général : pour y brancher une autre source (musique, file de lecture). */
  onContext?: (ctx: AudioContext, master: GainNode) => void;
}

class Voice implements SampleVoice {
  stopped = false;
  source: AudioBufferSourceNode | null = null;
  /** Gain du fondu, créé à l'arrêt progressif. */
  fade: GainNode | null = null;

  constructor(
    private readonly output: WebSampleOutput,
    readonly duration: number,
    public loop: boolean,
    /** Fin logique, sur l'horloge de l'hôte (ms) ; décalée par les suspensions. */
    public endAt: number,
  ) {}

  get playing(): boolean {
    return !this.stopped && (this.loop || this.output.clockNow() < this.endAt);
  }

  stop(fadeSeconds = 0): void {
    if (fadeSeconds > 0) this.output.fadeOut(this, fadeSeconds);
    else this.output.release(this);
  }
}

export class WebSampleOutput {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mutedFlag = false;
  /** Instant (horloge de l'hôte) où `suspend()` a figé le jeu ; null si le jeu tourne. */
  private suspendedAt: number | null = null;
  /** Reprises dont la promesse n'est pas résolue : le contexte y est encore `suspended`, mais les sons y sont seulement en attente. */
  private resuming = 0;
  /** `suspend()` / `resume()` du contexte, chaînés : le dernier appel gagne. */
  private transition: Promise<unknown> = Promise.resolve();
  private readonly voices = new Set<Voice>();
  private readonly buffers = new WeakMap<Float32Array, AudioBuffer>();

  constructor(private readonly options: WebSampleOutputOptions) {}

  /** Crée le contexte et le gain général une seule fois. */
  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = this.options.createContext?.() ?? new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.options.onContext?.(this.ctx, this.master);
      // Créé pendant une suspension (onglet masqué) : un contexte déjà `running` doit être figé aussi.
      if (this.suspendedAt !== null) {
        const ctx = this.ctx;
        void this.enqueue(() => (ctx.state === "running" ? ctx.suspend() : undefined));
      }
    }
    return this.ctx;
  }

  /** Contexte et gain général (créés au besoin, restent suspendus jusqu'à `unlock()`), pour brancher une autre source sur la même sortie. */
  connection(): { ctx: AudioContext; master: GainNode } {
    const ctx = this.ensure();
    return { ctx, master: this.master! };
  }

  /**
   * Décode un fichier audio compressé (MP3, Ogg, WAV selon le navigateur) en échantillon mono, à la fréquence du contexte
   * (`decodeAudioData` rééchantillonne). Le contexte est créé au besoin (il reste suspendu jusqu'à `unlock()`), pour pouvoir
   * précharger avant le premier geste ; `bytes` n'est pas modifié (copié avant le décodage, qui détache son tampon).
   * Un fichier à plusieurs canaux ne garde que le premier.
   */
  async decode(bytes: Uint8Array): Promise<Sample> {
    const ctx = this.ensure();
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const buffer = await ctx.decodeAudioData(copy);
    return { data: new Float32Array(buffer.getChannelData(0)), rate: buffer.sampleRate };
  }

  /** À appeler de façon synchrone dans un geste de l'utilisateur : crée puis reprend le contexte. */
  unlock(): void {
    const ctx = this.ensure();
    if (this.suspendedAt === null && ctx.state === "suspended") this.startResume(ctx);
  }

  private enqueue(op: () => Promise<void> | undefined): Promise<unknown> {
    const run = (): Promise<unknown> => Promise.resolve().then(op).catch(() => undefined);
    this.transition = this.transition.then(run);
    return this.transition;
  }

  private startResume(ctx: AudioContext): void {
    this.resuming++;
    void this.enqueue(() => ctx.resume()).finally(() => {
      this.resuming--;
    });
  }

  /** Temps du jeu : l'horloge de l'hôte, figée pendant une suspension. */
  clockNow(): number {
    return this.suspendedAt ?? this.options.now();
  }

  /** Onglet masqué : le contexte est suspendu et les voix ne vieillissent plus. */
  suspend(): void {
    if (this.suspendedAt !== null) return;
    this.suspendedAt = this.options.now();
    const ctx = this.ctx;
    if (ctx) void this.enqueue(() => (ctx.state === "running" ? ctx.suspend() : undefined));
  }

  resume(): void {
    if (this.suspendedAt === null) return;
    const away = this.options.now() - this.suspendedAt;
    this.suspendedAt = null;
    for (const voice of this.voices) voice.endAt += away;
    if (this.ctx) this.startResume(this.ctx);
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** Coupe ou rétablit le son sans arrêter les sources : la durée des voix ne change pas. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  private buffer(ctx: AudioContext, sample: Sample): AudioBuffer {
    let buffer = this.buffers.get(sample.data);
    if (buffer && buffer.sampleRate === Math.max(MIN_BUFFER_RATE, sample.rate)) return buffer;
    buffer = createMonoBuffer(ctx, sample.data, sample.rate);
    this.buffers.set(sample.data, buffer);
    return buffer;
  }

  /** Le contexte peut-il porter un son maintenant (ou le portera-t-il à la reprise en cours) ? */
  private get live(): boolean {
    const ctx = this.ctx;
    return ctx !== null && (ctx.state === "running" || this.resuming > 0 || this.suspendedAt !== null);
  }

  /** Joue un échantillon (en plus de ceux en cours : le remplacement d'une voix est l'affaire de l'appelant). */
  play(sample: Sample, options: PlayOptions = {}): SampleVoice {
    const duration = sample.data.length / Math.max(MIN_BUFFER_RATE, sample.rate);
    const passes = options.loop ? Infinity : Math.max(1, options.passes ?? 1);
    const loop = passes === Infinity;
    const voice = new Voice(this, duration, loop, this.clockNow() + duration * passes * 1000);
    if (sample.data.length === 0) {
      voice.stopped = true;
      return voice;
    }
    for (const old of this.voices) if (!old.playing) this.voices.delete(old);
    this.voices.add(voice);
    const ctx = this.ctx;
    if (ctx && this.master && this.live) {
      const source = ctx.createBufferSource();
      source.buffer = this.buffer(ctx, sample);
      source.loop = passes > 1;
      source.connect(this.master);
      source.onended = () => {
        source.disconnect();
        voice.fade?.disconnect();
        if (voice.source === source) voice.source = null;
      };
      if (passes === Infinity || passes === 1) source.start();
      else source.start(0, 0, source.buffer.duration * passes);
      voice.source = source;
    }
    return voice;
  }

  /** Retire la voix (arrêt demandé) et coupe sa source. */
  release(voice: Voice): void {
    voice.stopped = true;
    this.voices.delete(voice);
    const source = voice.source;
    voice.source = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // déjà arrêtée
    }
    source.disconnect();
    voice.fade?.disconnect();
  }

  /** Arrêt progressif : la source passe par un gain qui descend à 0, et la voix s'achève avec le fondu. */
  fadeOut(voice: Voice, seconds: number): void {
    const source = voice.source;
    const ctx = this.ctx;
    if (!source || !ctx || !this.master || voice.fade || voice.stopped) {
      if (!voice.fade) this.release(voice);
      return;
    }
    const fade = ctx.createGain();
    const end = ctx.currentTime + seconds;
    fade.gain.setValueAtTime(fade.gain.value, ctx.currentTime);
    fade.gain.linearRampToValueAtTime(0, end);
    source.disconnect();
    source.connect(fade);
    fade.connect(this.master);
    source.stop(end);
    voice.fade = fade;
    voice.loop = false;
    voice.endAt = Math.min(voice.endAt, this.clockNow() + seconds * 1000);
  }

  /** Voix encore en cours (les voix finies sont oubliées au passage). */
  get activeCount(): number {
    for (const voice of this.voices) if (!voice.playing) this.voices.delete(voice);
    return this.voices.size;
  }

  stopAll(): void {
    for (const voice of [...this.voices]) this.release(voice);
  }

  /** Libère tout (page quittée). */
  close(): void {
    this.stopAll();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
