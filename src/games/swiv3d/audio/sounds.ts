/**
 * Bruitages de SWIV 3D : banque `SOUNDS.BD`, instances limitées, panoramique et volume 3D.
 *
 * Reprend `gm_sounds_build_buffers` (`00412c84`), `gm_sound_play` (`00412e44`), `gm_sound_loop_*`,
 * `gm_sound_stop_all` (`00412fe0`) et `gm_sounds_update_3d` (`00413058`) :
 *
 * - une ressource d'identifiant `id` donne le son `id / 100` avec `id % 100` instances (tampons dupliqués ;
 *   au moins 1) ;
 * - `play` prend la première instance libre de ce son ; **s'il n'y en a pas, la demande est ignorée**
 *   (aucun vol de voix : le son en cours n'est pas coupé) ;
 * - à chaque image, pour chaque voix liée à un émetteur, pan et volume sont recalculés (formule ci-dessous) ;
 *   une voix ponctuelle est libérée quand elle a fini de jouer ; une boucle (`startLoop`) tourne jusqu'à
 *   `stopLoop` / `stopAll`.
 */
import { createMonoBuffer, s16leToFloat32, u8ToFloat32 } from "../../../audio/pcm";
import type { RiffWave } from "../../../data/riff-wave";
import type { SoundBank } from "../data/sounds";
import type { EmitterState, Listener, SoundRequest } from "./events";

/** Bornes des sorties DirectSound en centièmes de dB. */
export const MAX_ATTENUATION = 10000;
/** `gm_sounds_update_3d` : écart de position au-delà duquel on considère un passage de la couture du tore. */
export const WRAP_THRESHOLD = 10000;
/** Période du tore en x et z en unités monde (2^23 / 256 = 32768). */
export const WRAP_X = 0x8000;
/** Le `+0x7ff6` de l'exécutable pour z < -10000 (et non 0x8000 : probable coquille d'origine, reprise telle quelle). */
export const WRAP_Z_NEGATIVE = 0x7ff6;
/** Plancher de la profondeur (en 1/32 d'unité) utilisée pour le panoramique. */
export const MIN_DEPTH = 5;
/** Constante ajoutée à la profondeur dans le diviseur du panoramique. */
export const PAN_DEPTH_OFFSET = 0x50;

export interface Spatialisation {
  /** Panoramique DirectSound, -10000 (gauche) à 10000 (droite), en centièmes de dB d'atténuation du côté opposé. */
  pan: number;
  /** Volume DirectSound, -10000 à 0, en centièmes de dB. */
  volume: number;
}

/**
 * Formule de `gm_sounds_update_3d` (entiers 32 bits, divisions tronquées, décalages arithmétiques).
 *
 * ```
 * d  = (source >> 8) - cam                       // unités monde ; cam = position entière de la caméra
 * d.x : > 10000 → -0x8000 ; < -10000 → +0x8000    // couture du tore (le code d'origine corrige bien les distances)
 * d.z : > 10000 → -0x8000 ; < -10000 → +0x7ff6    // (0x7ff6 : valeur de l'exécutable)
 * F = trunc(256·avant), R = trunc(256·droite)
 * dep   = F·d                                      // profondeur ×256
 * prof  = max(5, |dep >> 13|)                      // profondeur / 32
 * pan   = clamp(trunc((R·d) / (prof + 0x50)), ±10000)
 * vol   = clamp(-dep >> 8, -10000, 0)              // ≈ -(profondeur en unités) centièmes de dB
 * ```
 *
 * Une source derrière la caméra (`dep < 0`) a donc le volume maximal (0) : comportement d'origine.
 */
export function spatialize(listener: Listener, x: number, y: number, z: number): Spatialisation {
  const f = listener.forward ?? [Math.sin(listener.yaw), 0, Math.cos(listener.yaw)];
  const r = listener.right ?? [Math.cos(listener.yaw), 0, -Math.sin(listener.yaw)];
  const F = f.map((v) => Math.trunc(256 * v));
  const R = r.map((v) => Math.trunc(256 * v));
  let dx = Math.floor(x) - Math.trunc(listener.x);
  const dy = Math.floor(y) - Math.trunc(listener.y);
  let dz = Math.floor(z) - Math.trunc(listener.z);
  if (dx > WRAP_THRESHOLD) dx -= WRAP_X;
  if (dz > WRAP_THRESHOLD) dz -= WRAP_X;
  if (dx < -WRAP_THRESHOLD) dx += WRAP_X;
  if (dz < -WRAP_THRESHOLD) dz += WRAP_Z_NEGATIVE;
  const depth = dy * F[1] + dx * F[0] + dz * F[2];
  let prof = depth >> 13;
  if (prof < 0) prof = -prof;
  if (prof < MIN_DEPTH) prof = MIN_DEPTH;
  const side = dy * R[1] + dx * R[0] + dz * R[2];
  const pan = clamp(Math.trunc(side / (prof + PAN_DEPTH_OFFSET)), -MAX_ATTENUATION, MAX_ATTENUATION);
  const volume = Math.min(0, Math.max(-MAX_ATTENUATION, (-depth) >> 8));
  return { pan: pan || 0, volume: volume || 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Centièmes de dB (DirectSound, ≤ 0) → gain linéaire. */
export function centibelToGain(cdb: number): number {
  return cdb <= -MAX_ATTENUATION ? 0 : 10 ** (cdb / 2000);
}

/**
 * Panoramique DirectSound (atténuation en centièmes de dB du canal opposé) → position `StereoPannerNode` (-1 à 1)
 * qui donne le même rapport entre les deux canaux (loi à puissance constante de Web Audio).
 */
export function directSoundPanToStereo(pan: number): number {
  if (pan === 0) return 0;
  const ratio = 10 ** (Math.abs(pan) / 2000); // canal fort / canal faible
  return Math.sign(pan) * ((4 / Math.PI) * Math.atan(ratio) - 1);
}

// --- Sortie audio --------------------------------------------------------------------------------------------

export type BufferHandle = number;
export type VoiceHandle = number;

export interface PlayOptions {
  loop: boolean;
  /** Gain linéaire. */
  gain: number;
  /** -1 (gauche) à 1 (droite). */
  pan: number;
  /** Rapport de la fréquence de lecture à la fréquence native du son (1 = natif). */
  rate: number;
  /** Appelé quand un son non bouclé a fini de jouer (jamais après `stop`). */
  onEnded: () => void;
}

/** Sortie audio : ce que `SoundSystem` demande, indépendamment de Web Audio. */
export interface SoundSink {
  createBuffer(wave: RiffWave): BufferHandle;
  play(buffer: BufferHandle, options: PlayOptions): VoiceHandle;
  setGain(voice: VoiceHandle, gain: number): void;
  setPan(voice: VoiceHandle, pan: number): void;
  setRate(voice: VoiceHandle, rate: number): void;
  stop(voice: VoiceHandle): void;
  setMuted(muted: boolean): void;
}

// --- Système -------------------------------------------------------------------------------------------------

interface Slot {
  /** Numéro de son. */
  sound: number;
  buffer: BufferHandle;
  sampleRate: number;
}

interface Voice {
  sound: number;
  handle: VoiceHandle;
  objectId?: number;
  loop: boolean;
  spatial: boolean;
  sampleRate: number;
  x: number;
  y: number;
  z: number;
  /** Dernières valeurs envoyées au sink (évite les appels redondants). */
  pan: number;
  volume: number;
  rate: number;
}

export class SoundSystem {
  private readonly slots = new Map<number, Slot>();
  /** Nombre d'instances par son (`id % 100`, au moins 1). */
  private readonly instances = new Map<number, number>();
  private readonly voices = new Set<Voice>();
  private listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private resolver: ((objectId: number) => EmitterState | undefined) | null = null;
  private mutedFlag = false;

  constructor(
    bank: SoundBank,
    private readonly sink: SoundSink,
  ) {
    for (const entry of bank.sounds) {
      const sound = Math.floor(entry.id / 100);
      // Un identifiant en double rend les instances du premier : comme le répertoire, qui n'est lu qu'une fois.
      if (this.slots.has(sound)) continue;
      this.slots.set(sound, { sound, buffer: sink.createBuffer(entry.wave), sampleRate: entry.wave.sampleRate });
      this.instances.set(sound, Math.max(1, entry.id % 100));
    }
  }

  /** Numéros de son disponibles. */
  get sounds(): number[] {
    return [...this.slots.keys()];
  }

  /** Nombre maximal de voix simultanées du son (0 s'il n'existe pas). */
  maxInstances(sound: number): number {
    return this.instances.get(sound) ?? 0;
  }

  /** Voix actuellement occupées par ce son. */
  activeCount(sound: number): number {
    let n = 0;
    for (const v of this.voices) if (v.sound === sound) n++;
    return n;
  }

  get activeVoices(): number {
    return this.voices.size;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  set muted(value: boolean) {
    this.mutedFlag = value;
    this.sink.setMuted(value);
  }

  setListener(listener: Listener): void {
    this.listener = listener;
  }

  /** Relie un `objectId` à sa position courante ; `undefined` = objet disparu (la voix garde sa dernière position). */
  setEmitterResolver(resolver: ((objectId: number) => EmitterState | undefined) | null): void {
    this.resolver = resolver;
  }

  /** `gm_sound_play` : joue le son une fois. Renvoie faux si le son est inconnu ou si toutes ses instances sont prises. */
  play(request: SoundRequest): boolean {
    return this.start(request, false, undefined);
  }

  /** `gm_sound_loop_start` : boucle liée à `request.objectId`, à la fréquence `frequency` (Hz) si donnée. */
  startLoop(request: SoundRequest, frequency?: number): boolean {
    return this.start(request, true, frequency);
  }

  /** `gm_sound_loop_stop(objet, son)` : arrête les boucles de ce son pour cet émetteur. */
  stopLoop(sound: number, objectId?: number): void {
    for (const v of [...this.voices]) {
      if (v.loop && v.sound === sound && v.objectId === objectId) this.release(v);
    }
  }

  /** `gm_sound_stop_all` : changement de niveau, pause d'un écran plein. */
  stopAll(): void {
    for (const v of [...this.voices]) this.release(v);
  }

  /** `gm_sounds_update_3d` : à appeler à chaque image après `setListener`. */
  update(): void {
    for (const v of this.voices) {
      if (v.objectId !== undefined && this.resolver) {
        const e = this.resolver(v.objectId);
        if (e) {
          v.x = e.x;
          v.y = e.y;
          v.z = e.z;
          if (v.loop && e.frequency !== undefined) this.applyRate(v, e.frequency);
        }
      }
      this.applySpatial(v);
    }
  }

  private start(request: SoundRequest, loop: boolean, frequency: number | undefined): boolean {
    const slot = this.slots.get(request.sound);
    if (!slot) return false;
    if (this.activeCount(request.sound) >= (this.instances.get(request.sound) ?? 1)) return false; // pas de vol de voix
    const voice: Voice = {
      sound: request.sound,
      handle: -1,
      objectId: request.objectId,
      loop,
      spatial: request.spatial !== false,
      sampleRate: slot.sampleRate,
      x: request.x,
      y: request.y,
      z: request.z,
      pan: 0,
      volume: 0,
      rate: 1,
    };
    if (voice.spatial) {
      const s = spatialize(this.listener, voice.x, voice.y, voice.z);
      voice.pan = s.pan;
      voice.volume = s.volume;
    }
    voice.rate = frequency !== undefined ? frequency / slot.sampleRate : 1;
    voice.handle = this.sink.play(slot.buffer, {
      loop,
      gain: centibelToGain(voice.volume),
      pan: directSoundPanToStereo(voice.pan),
      rate: voice.rate,
      onEnded: () => this.voices.delete(voice),
    });
    this.voices.add(voice);
    return true;
  }

  private applySpatial(v: Voice): void {
    if (!v.spatial) return;
    const s = spatialize(this.listener, v.x, v.y, v.z);
    if (s.volume !== v.volume) {
      v.volume = s.volume;
      this.sink.setGain(v.handle, centibelToGain(s.volume));
    }
    if (s.pan !== v.pan) {
      v.pan = s.pan;
      this.sink.setPan(v.handle, directSoundPanToStereo(s.pan));
    }
  }

  private applyRate(v: Voice, frequency: number): void {
    const rate = frequency / v.sampleRate;
    if (rate === v.rate) return;
    v.rate = rate;
    this.sink.setRate(v.handle, rate);
  }

  private release(v: Voice): void {
    this.voices.delete(v);
    this.sink.stop(v.handle);
  }
}

// --- Web Audio -----------------------------------------------------------------------------------------------

/** Sortie Web Audio : un `AudioContext` injecté ; chaque voix = source → gain → panoramique → sortie générale. */
export class WebAudioSoundSink implements SoundSink {
  private readonly master: GainNode;
  private readonly buffers: AudioBuffer[] = [];
  private readonly voices = new Map<VoiceHandle, { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode }>();
  private nextVoice = 1;

  constructor(private readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  createBuffer(wave: RiffWave): BufferHandle {
    const channels = wave.channels;
    const frames = Math.floor(wave.data.length / (wave.bitsPerSample / 8) / channels);
    // Les bruitages sont mono ; l'unique son stéréo (3002) est ramené en mono pour que le panoramique agisse.
    const mono = new Float32Array(frames);
    for (let c = 0; c < channels; c++) {
      const ch =
        wave.bitsPerSample === 16
          ? s16leToFloat32(wave.data, channels, c)
          : u8ToFloat32(channelOf8(wave.data, channels, c));
      for (let i = 0; i < frames; i++) mono[i] += ch[i] / channels;
    }
    this.buffers.push(createMonoBuffer(this.ctx, mono, wave.sampleRate));
    return this.buffers.length - 1;
  }

  play(buffer: BufferHandle, o: PlayOptions): VoiceHandle {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers[buffer];
    source.loop = o.loop;
    source.playbackRate.value = o.rate;
    const gain = this.ctx.createGain();
    gain.gain.value = o.gain;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = o.pan;
    source.connect(gain).connect(pan).connect(this.master);
    const handle = this.nextVoice++;
    this.voices.set(handle, { source, gain, pan });
    source.onended = () => {
      if (this.voices.delete(handle)) o.onEnded();
    };
    source.start();
    return handle;
  }

  setGain(voice: VoiceHandle, gain: number): void {
    const v = this.voices.get(voice);
    if (v) v.gain.gain.value = gain;
  }

  setPan(voice: VoiceHandle, pan: number): void {
    const v = this.voices.get(voice);
    if (v) v.pan.pan.value = pan;
  }

  setRate(voice: VoiceHandle, rate: number): void {
    const v = this.voices.get(voice);
    if (v) v.source.playbackRate.value = rate;
  }

  stop(voice: VoiceHandle): void {
    const v = this.voices.get(voice);
    if (!v) return;
    this.voices.delete(voice); // `onended` ne doit plus rien libérer
    v.source.onended = null;
    try {
      v.source.stop();
    } catch {
      // déjà arrêtée
    }
    v.source.disconnect();
  }

  setMuted(muted: boolean): void {
    this.master.gain.value = muted ? 0 : 1;
  }
}

/** Canal `channel` d'un PCM 8 bits entrelacé. */
function channelOf8(data: Uint8Array, channels: number, channel: number): Uint8Array {
  const out = new Uint8Array(Math.floor(data.length / channels));
  for (let i = 0; i < out.length; i++) out[i] = data[i * channels + channel];
  return out;
}
