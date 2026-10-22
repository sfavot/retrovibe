import { readWave } from "../data/resources";
import { exeSounds, soundFileNames } from "../engine/assets";
import { type MidiNote, parseMidi } from "./midi";

/**
 * Sons du jeu : effets WAV d'origine et musiques MIDI jouées par un petit synthétiseur.
 * Le contexte audio ne démarre qu'après une interaction (règle des navigateurs).
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly midis = new Map<string, Promise<MidiNote[] | null>>();
  private music: { stop(): void } | null = null;
  soundEnabled = true;
  musicEnabled = true;

  private readonly soundNames: string[];

  constructor(
    dawSounds: string[],
    private readonly baseUrl: string,
    /** DESKADV.EXE, déjà chargé : source des effets WAVE enfouis dans ses ressources. */
    private readonly exe: ArrayBuffer,
  ) {
    this.soundNames = soundFileNames(dawSounds);
  }

  /** À appeler dans un gestionnaire d'événement utilisateur. */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private fileName(id: number): string | null {
    const raw = this.soundNames[id];
    if (!raw) return null;
    return raw.split("\\").pop() ?? null;
  }

  play(id: number): void {
    if (id in exeSounds) {
      this.playExeSound(exeSounds[id]);
      return;
    }
    const name = this.fileName(id);
    if (!name || !this.ctx) return;
    if (name.toUpperCase().endsWith(".MID")) {
      this.playMusic(id);
      return;
    }
    if (!this.soundEnabled) return;
    void this.load(name).then((buffer) => buffer && this.playBuffer(buffer));
  }

  /** Effet sonore enfoui dans les ressources WAVE de DESKADV.EXE. */
  private playExeSound(resourceId: number): void {
    if (!this.ctx || !this.soundEnabled) return;
    void this.loadExeWave(resourceId).then((buffer) => buffer && this.playBuffer(buffer));
  }

  private loadExeWave(resourceId: number): Promise<AudioBuffer | null> {
    const key = `DESKADV.EXE#WAVE${resourceId}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = Promise.resolve()
        .then(() => {
          const wave = readWave(this.exe, resourceId);
          if (!wave) throw new Error(`Ressource WAVE ${resourceId} introuvable`);
          // decodeAudioData consomme son tampon : copie pour ne pas toucher à l'exécutable.
          return this.ctx!.decodeAudioData(wave.slice().buffer);
        })
        .catch(() => null);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  private playBuffer(buffer: AudioBuffer): void {
    if (!this.ctx) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.6;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  playMusic(id: number, loop = false): void {
    const name = this.fileName(id);
    if (!name || !this.ctx || !this.musicEnabled) return;
    this.stopMusic();
    let midi = this.midis.get(name);
    if (!midi) {
      midi = fetch(`${this.baseUrl}${name}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then(parseMidi)
        .catch(() => null);
      this.midis.set(name, midi);
    }
    void midi.then((notes) => {
      if (notes && this.ctx && this.musicEnabled) this.music = synthesize(this.ctx, notes, loop);
    });
  }

  stopMusic(): void {
    this.music?.stop();
    this.music = null;
  }

  private load(name: string): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(name);
    if (!buffer) {
      buffer = fetch(`${this.baseUrl}${name}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(name, buffer);
    }
    return buffer;
  }
}

const frequency = (key: number) => 440 * Math.pow(2, (key - 69) / 12);

function synthesize(ctx: AudioContext, notes: MidiNote[], loop: boolean): { stop(): void } {
  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(ctx.destination);
  const nodes: AudioScheduledSourceNode[] = [];
  const length = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
  let timer = 0;
  let stopped = false;

  const schedule = (start: number) => {
    for (const n of notes) {
      const t = start + n.time;
      const gain = ctx.createGain();
      const level = (n.velocity / 127) * (n.channel === 9 ? 0.5 : 1);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.01);
      gain.gain.setTargetAtTime(level * 0.6, t + 0.05, 0.1);
      gain.gain.setTargetAtTime(0, t + n.duration, 0.05);
      gain.connect(master);
      if (n.channel === 9) {
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer(ctx);
        noise.connect(gain);
        noise.start(t);
        noise.stop(t + 0.12);
        nodes.push(noise);
      } else {
        const osc = ctx.createOscillator();
        osc.type = n.program < 8 ? "triangle" : n.program < 48 ? "square" : "sawtooth";
        osc.frequency.value = frequency(n.key);
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + n.duration + 0.3);
        nodes.push(osc);
      }
    }
    if (loop && length > 0) {
      timer = window.setTimeout(() => !stopped && schedule(start + length), Math.max(0, (start + length - ctx.currentTime - 1) * 1000));
    }
  };
  schedule(ctx.currentTime + 0.05);
  return {
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      for (const node of nodes) {
        try {
          node.stop(ctx.currentTime + 0.2);
        } catch {
          // déjà arrêté
        }
      }
    },
  };
}

let cachedNoise: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedNoise) return cachedNoise;
  cachedNoise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const data = cachedNoise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return cachedNoise;
}
