/**
 * Frontière audio entre le moteur (pur, testable sous node) et le navigateur ; partagée par Mathémagique et Zoombinis.
 *
 * L'original joue les WAVE par `waveOut` (plusieurs sons à la fois, par ex. voix de Poly + bruitage) et le MIDI par
 * `midiOut` avec un séquenceur logiciel (`docs/mathemagique/engine.md` §6). Côté navigateur : Web Audio pour les WAVE, `spessasynth_lib`
 * (soundfont General MIDI) pour le MIDI. Implémentations : `src/ui/mohawk/web-sink.ts` (navigateur) et un faux puits dans
 * l'hôte de test.
 */

/** Échantillons prêts à jouer, mono, en flottants [-1, 1] (convertis depuis le PCM 8 bits non signé). */
export interface PcmSound {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export type WaveHandle = number;

export interface MidiSink {
  /** Envoie un message MIDI brut (statut + données, SysEx compris), à jouer à `atMs` (temps de `AudioSink.now`) ou tout de suite. */
  send(message: Uint8Array, atMs?: number): void;
  /** Coupe toutes les notes et remet les contrôleurs à zéro sur les 16 canaux. */
  reset(): void;
}

export interface AudioSink {
  /** Autorise la sortie (politique d'autoplay) : à appeler depuis un geste de l'utilisateur. */
  unlock(): void;
  /** Horloge de l'audio, en millisecondes : référence de `MidiSink.send(…, atMs)`. */
  now(): number;
  /** Joue un son ; plusieurs peuvent jouer en même temps. Sans effet (mais renvoie un handle valide) si la sortie est verrouillée. */
  playWave(sound: PcmSound, loop: boolean): WaveHandle;
  stopWave(handle: WaveHandle): void;
  /** Vrai tant que le son sort réellement (faux s'il est fini, arrêté, ou si la sortie est verrouillée). */
  isWavePlaying(handle: WaveHandle): boolean;
  readonly midi: MidiSink;
  /** Préférence « Son » du site : coupe tout, WAVE et MIDI. */
  setMuted(muted: boolean): void;
  /** Onglet masqué / visible. */
  suspend(): void;
  resume(): void;
}
