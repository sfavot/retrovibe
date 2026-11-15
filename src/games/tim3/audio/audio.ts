/**
 * Son de The Incredible Machine 3 côté hôte : musique HMI (`music.ts`), effets WAV à 16 emplacements (`effects.ts`), voix MP3 du professeur
 * (`voices.ts`), muet du site, préférence « voix activées », pause de l'onglet. Voir `docs/tim3/audio.md`.
 *
 * - Un seul contexte audio et un seul gain général (`WebSampleOutput`) : le synthétiseur de musique s'y branche (`connection()`), donc
 *   `setMuted` (préférence « Son » du site, `SoundPrefs`) coupe musique, effets et voix, et `suspend()` / `resume()` (onglet masqué) figent tout,
 *   horloge de la musique comprise (elle est celle du contexte).
 * - **Le temps du jeu ne dépend pas du son** : voix et effets durent sur l'horloge de l'hôte, que le contexte existe ou non, soit bloqué par
 *   l'autoplay ou coupé.
 * - L'hôte appelle `unlock()` au premier geste, `update()` à chaque image, `suspend()` / `resume()` selon la visibilité.
 */
import { VoiceBank, type SoundFiles } from "../../../audio/voice-bank";
import { WebGmSynth } from "../../../audio/web-gm-synth";
import { WebSampleOutput, type Sample } from "../../../audio/web-sample-output";
import { SoundPrefs, type SoundPrefsStorage } from "../../../ui/sound-prefs";
import { readSoundEffect } from "../data/wave";
import { EffectMixer, type EffectSource } from "./effects";
import { effectFileName, type VoiceRef } from "./ids";
import type { LipSyncTable, MouthPose } from "./lipsync";
import { Tim3Music, type GmPort, type MusicResources } from "./music";
import { Tim3Voices } from "./voices";

/** Clé de la préférence « voix activées » (D4 : activées par défaut). */
export const VOICES_PREF_KEY = "retrovibe:tim3:voices";

/** Ce que l'interface et le moteur demandent au son. */
export interface Tim3Audio {
  /** Musique (1000 à 1023, 0 = aucune) ; le morceau déjà en cours n'est pas relancé. */
  playMusic(music: number): void;
  stopMusic(): void;
  readonly musicNumber: number;
  /** Effet `SX_<id>.WAV` (`priority` 1 et `flags` 0 par défaut : ceux de la commande son d'une animation) ; faux s'il est abandonné. */
  playEffect(id: number, priority?: number, flags?: number): boolean;
  stopEffect(id: number): void;
  stopEffects(): void;
  /** Voix du professeur ; faux (texte seul) si désactivées ou absente. */
  playVoice(ref: VoiceRef): boolean;
  stopVoice(): void;
  readonly voiceActive: boolean;
  /** Pose du professeur pour la voix en cours (bouche fermée sans voix ni synchro). */
  mouth(): MouthPose;
  voicesEnabled: boolean;
  /** Effets activés (interrupteur du son de la guitare, 4115e6(3001, état)) : coupés, `playEffect` ne joue rien. */
  effectsEnabled: boolean;
  /** Volume de la guitare, 0 à 15 (`[0x47796c]`) : musique et effets, pas les voix (411674(1001 / 3001, v), gain v / 15). */
  volume: number;
  /** Entrée dans un puzzle ou le Labo : coupe voix et effets, lance la musique du niveau (`LevInfo.music`). */
  enterPuzzle(music: number): void;
  /** Coupe tout (sortie vers les menus). */
  stopAll(): void;
}

export interface Tim3AudioOptions {
  /** Millisecondes monotones de l'hôte (`host.now()`). */
  now(): number;
  /** `SX_<n>.WAV` et `SX_<n>.HMI` : l'index des ressources du jeu (`ResourceIndex`). */
  resources: MusicResources;
  /** Voix : clé `goals/017` → `voices/goals/017.mp3`. */
  voices: SoundFiles<string>;
  /** Synchro labiale décodée (`parseLipSyncJson`) ; absente : bouche fermée. */
  lipsync?: LipSyncTable;
  /** Stockage des préférences (préférence « voix activées »). */
  storage: SoundPrefsStorage;
  /** URL de la soundfont General MIDI : celle de Mathémagique, `${BASE_URL}mathemagique/mathemagique-gm.sf2`, sans copie. */
  soundfontUrl: string;
  /** Points d'injection (tests). */
  createContext?: () => AudioContext;
  createGmPort?: (ctx: AudioContext, output: AudioNode, onReady: () => void) => GmPort & { load(): Promise<void>; close(): void };
}

export class WebTim3Audio implements Tim3Audio {
  private readonly output: WebSampleOutput;
  private readonly effects: EffectMixer;
  private readonly voices: Tim3Voices;
  private readonly voicePrefs: SoundPrefs;
  private readonly effectCache = new Map<number, Sample | null>();
  private music: Tim3Music | null = null;
  private musicGain: GainNode | null = null;
  private level = 15;
  effectsEnabled = true;
  private port: (GmPort & { load(): Promise<void>; close(): void }) | null = null;

  constructor(private readonly options: Tim3AudioOptions) {
    this.output = new WebSampleOutput({ now: options.now, createContext: options.createContext });
    const bank = new VoiceBank<string>(options.voices, this.output);
    const source: EffectSource = { load: (id) => this.loadEffect(id) };
    this.effects = new EffectMixer(this.output, source);
    this.voices = new Tim3Voices(bank, this.output, options.lipsync);
    // « Voix activées » : `SoundPrefs` lit la préférence (défaut : activée), l'écrit, et nous dit quoi appliquer (`setMuted` = voix coupées).
    this.voicePrefs = new SoundPrefs(options.storage, { setMuted: (muted) => (this.voices.enabled = !muted) }, "tim3", { key: VOICES_PREF_KEY });
  }

  private loadEffect(id: number): Sample | null {
    if (this.effectCache.has(id)) return this.effectCache.get(id) ?? null;
    let sample: Sample | null = null;
    const name = effectFileName(id);
    if (this.options.resources.has(name)) {
      try {
        const effect = readSoundEffect(this.options.resources.get(name));
        sample = { data: effect.channels[0], rate: effect.sampleRate };
      } catch {
        sample = null;
      }
    }
    this.effectCache.set(id, sample);
    return sample;
  }

  /** Crée le synthétiseur à la première musique demandée (le contexte reste suspendu jusqu'à `unlock()`). */
  private engine(): Tim3Music {
    if (this.music) return this.music;
    const { ctx, master } = this.output.connection();
    // Volume de la musique : un gain entre le synthétiseur et le gain général (celui du muet du site).
    const gain = ctx.createGain();
    gain.gain.value = this.level / 15;
    gain.connect(master);
    this.musicGain = gain;
    const onReady = (): void => this.music?.tick();
    const create =
      this.options.createGmPort ??
      ((c: AudioContext, node: AudioNode, ready: () => void) => new WebGmSynth(c, node, { soundfontUrl: this.options.soundfontUrl, onReady: ready }));
    const port = create(ctx, gain, onReady);
    this.port = port;
    this.music = new Tim3Music(this.options.resources, port);
    void port.load();
    return this.music;
  }

  // --- musique -----------------------------------------------------------------------------------------------------------

  playMusic(music: number): void {
    if (music === 0) {
      this.music?.stop();
      return;
    }
    this.engine().play(music);
  }

  stopMusic(): void {
    this.music?.stop();
  }

  get musicNumber(): number {
    return this.music?.current ?? 0;
  }

  // --- effets ------------------------------------------------------------------------------------------------------------

  playEffect(id: number, priority = 1, flags = 0): boolean {
    if (!this.effectsEnabled) return false;
    return this.effects.play(id, priority, flags);
  }

  get volume(): number {
    return this.level;
  }

  set volume(v: number) {
    this.level = Math.max(0, Math.min(15, Math.round(v)));
    this.effects.volume = this.level / 15;
    if (this.musicGain) this.musicGain.gain.value = this.level / 15;
  }

  stopEffect(id: number): void {
    this.effects.stop(id);
  }

  stopEffects(): void {
    this.effects.stopAll();
  }

  /** Nombre d'effets en cours (diagnostic, tests). */
  get activeEffects(): number {
    return this.effects.active;
  }

  // --- voix --------------------------------------------------------------------------------------------------------------

  playVoice(ref: VoiceRef): boolean {
    return this.voices.play(ref);
  }

  stopVoice(): void {
    this.voices.stop();
  }

  get voiceActive(): boolean {
    return this.voices.active;
  }

  mouth(): MouthPose {
    return this.voices.mouth();
  }

  get voicesEnabled(): boolean {
    return this.voicePrefs.isEnabled();
  }

  set voicesEnabled(on: boolean) {
    this.voicePrefs.set(on);
  }

  // --- ensemble ----------------------------------------------------------------------------------------------------------

  enterPuzzle(music: number): void {
    this.voices.stop();
    this.effects.stopAll();
    this.playMusic(music);
  }

  stopAll(): void {
    this.voices.stop();
    this.effects.stopAll();
    this.stopMusic();
  }

  /** Préférence « Son » du site (`SoundPrefs`) : coupe tout sans arrêter ni décaler quoi que ce soit. */
  setMuted(muted: boolean): void {
    this.output.setMuted(muted);
  }

  /** À appeler dans un geste de l'utilisateur. */
  unlock(): void {
    this.output.unlock();
  }

  /** Onglet masqué : contexte suspendu, voix et horloge de la musique figées. */
  suspend(): void {
    this.output.suspend();
  }

  resume(): void {
    this.output.resume();
  }

  /** À chaque image. */
  update(): void {
    this.music?.tick();
  }

  close(): void {
    this.stopAll();
    this.port?.close();
    this.port = null;
    this.music = null;
    this.output.close();
  }
}
