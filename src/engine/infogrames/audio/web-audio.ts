import { createMonoBuffer, u8ToFloat32 } from "../../../audio/pcm";
import type { AudioBackend } from "./backend";
import { soundDuration, type Sound } from "./sound";

/**
 * Fréquence des MP3 du site (`ec_encoder_voix` de `scripts/lib/extract-common.sh`) : c'est celle du contexte de
 * décodage, pour garder les sons décodés tels qu'ils sont encodés (le contexte de sortie rééchantillonne à la lecture).
 */
const DECODE_RATE = 22050;

/**
 * Sortie son via Web Audio : la voie et le bruitage (`playEffect`) sont deux sources sur le même `GainNode`, donc
 * le même volume ; leur somme est écrêtée à la sortie, comme la somme saturée de `348d:021a`. Le contexte n'est créé qu'après un geste de
 * l'utilisateur (`unlock()`), comme l'exigent les navigateurs ; avant cela, `play` et `playEffect` ne font rien et
 * `playing` et `effectPlaying` restent faux.
 *
 * Un MP3 est décodé une fois par `prepare()` (possible avant tout geste : le décodage passe par un
 * `OfflineAudioContext`), puis joué sur la durée exacte du son d'origine (`soundDuration`) : les échantillons que le
 * décodage laisserait en trop à la fin ne sont pas joués, et `position` boucle sur cette durée.
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
  /** Tampons prêts à jouer, par données du son (`Sound.data`) : PCM converti à la première lecture, MP3 décodé par `prepare()`. */
  private readonly buffers = new WeakMap<Uint8Array, AudioBuffer>();
  private decoder: OfflineAudioContext | null = null;

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

  async prepare(sound: Sound): Promise<void> {
    if (sound.format !== "mp3" || this.buffers.has(sound.data)) return;
    this.decoder ??= new OfflineAudioContext(1, 1, DECODE_RATE);
    // `decodeAudioData` détache le tampon qu'on lui passe : les octets du fichier sont copiés.
    const { data } = sound;
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    this.buffers.set(data, await this.decoder.decodeAudioData(copy));
  }

  /**
   * Tampon du son, début (s, non nul pour un son repris en cours de route : `Sound.skipSamples`) et durée à jouer (s) ;
   * `null` si le son est vide ou si c'est un MP3 qui n'a pas été préparé.
   */
  private playable(ctx: AudioContext, sound: Sound): { buffer: AudioBuffer; offset: number; duration: number } | null {
    if (sound.sampleCount === 0) return null;
    let buffer = this.buffers.get(sound.data);
    const offset = (sound.skipSamples ?? 0) / sound.sampleRate;
    if (sound.format === "mp3") return buffer ? { buffer, offset, duration: soundDuration(sound) } : null;
    if (!buffer) {
      buffer = createMonoBuffer(ctx, u8ToFloat32(sound.data), sound.sampleRate);
      this.buffers.set(sound.data, buffer);
    }
    return { buffer, offset, duration: buffer.duration - offset };
  }

  play(sound: Sound, loop: boolean): void {
    this.stop();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.gainNode) return;
    const ready = this.playable(ctx, sound);
    if (!ready) return;
    const source = ctx.createBufferSource();
    source.buffer = ready.buffer;
    source.connect(this.gainNode);
    source.onended = () => {
      if (this.source === source) this.active = false;
    };
    if (loop) {
      source.loop = true;
      source.loopStart = ready.offset;
      source.loopEnd = ready.offset + ready.duration;
      source.start(0, ready.offset);
    } else {
      source.start(0, ready.offset, ready.duration);
    }
    this.source = source;
    this.startedAt = ctx.currentTime;
    this.duration = ready.duration;
    this.looping = loop;
    this.active = true;
  }

  playEffect(sound: Sound): void {
    this.stopEffect();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.gainNode) return;
    const ready = this.playable(ctx, sound);
    if (!ready) return;
    const source = ctx.createBufferSource();
    source.buffer = ready.buffer;
    source.connect(this.gainNode);
    source.onended = () => {
      if (this.effectSource === source) this.effectActive = false;
    };
    source.start(0, ready.offset, ready.duration);
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
