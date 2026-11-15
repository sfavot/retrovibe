/**
 * Effets sonores de TIM3 : 16 emplacements, avec priorité, comme `PlaySound` (`41126d`) et `449ea0` de `TIMWIN.EXE` (`docs/tim3/audio.md`).
 *
 * Pour un effet (`SX_<id>.WAV`) :
 * 1. une ambiance (`id < 92`) devient `3800 + id` avec les drapeaux 7 (`normalizeEffect`) ;
 * 2. drapeau 4 : si un emplacement joue déjà ce numéro, il est arrêté puis relancé ; avec le drapeau 1, le premier est gardé et la demande ignorée ;
 * 3. un emplacement libre (son fini ou arrêté) est pris ; s'il n'y en a pas, on remplace l'emplacement de plus basse priorité parmi ceux de priorité
 *    strictement inférieure (ou égale, pour le même numéro sans le drapeau 1) ; s'il n'y en a aucun, la demande est abandonnée ;
 * 4. drapeau 2 : lecture en boucle jusqu'à `stop`.
 * Le jeu met aussi les demandes d'un pas en file (48 entrées, `411863`) et les exécute d'un coup (`411950`) : l'appelant peut le faire en
 * regroupant ses `play` d'un pas (voir `docs/tim3/audio.md`).
 */
import type { PlayOptions, Sample, SampleVoice } from "../../../audio/web-sample-output";
import { EFFECT_VOICES, SOUND_LOOP, SOUND_NO_RESTART, SOUND_UNIQUE, normalizeEffect } from "./ids";

/** Sortie d'échantillons (`WebSampleOutput.play`). */
export interface EffectOutput {
  play(sample: Sample, options?: PlayOptions): SampleVoice;
}

/** Échantillons des effets : `load` rend `null` si le fichier manque ou est illisible. */
export interface EffectSource {
  load(id: number): Sample | null;
}

interface Slot {
  id: number;
  priority: number;
  voice: SampleVoice | null;
}

export class EffectMixer {
  private readonly slots: Slot[] = Array.from({ length: EFFECT_VOICES }, () => ({ id: 0, priority: 0, voice: null }));

  constructor(
    private readonly output: EffectOutput,
    private readonly source: EffectSource,
  ) {}

  private busy(slot: Slot): boolean {
    return slot.voice !== null && slot.voice.playing;
  }

  private release(slot: Slot): void {
    slot.voice?.stop();
    slot.voice = null;
  }

  /** Gain des effets, de 0 à 1 (volume de la guitare, 411674(3001, v)), appliqué aux effets lancés ensuite. */
  volume = 1;

  /** Joue un effet ; faux s'il est abandonné (fichier absent, déjà en cours avec le drapeau 1, tous les emplacements plus prioritaires). */
  play(rawId: number, priority = 1, rawFlags = 0): boolean {
    const { id, flags } = normalizeEffect(rawId, rawFlags);
    const noRestart = (flags & SOUND_NO_RESTART) !== 0;
    if ((flags & SOUND_UNIQUE) !== 0) {
      for (const slot of this.slots) {
        if (!this.busy(slot) || slot.id !== id) continue;
        if (noRestart) return false;
        this.release(slot);
      }
    }
    let target = this.slots.find((slot) => !this.busy(slot));
    if (!target) {
      for (const slot of this.slots) {
        const lower = slot.priority < priority || (slot.priority === priority && slot.id === id && !noRestart);
        if (lower && (!target || slot.priority < target.priority)) target = slot;
      }
      if (!target) return false;
      this.release(target);
    }
    const sample = this.source.load(id);
    if (!sample) return false;
    target.id = id;
    target.priority = priority;
    target.voice = this.output.play(sample, this.volume === 1 ? { loop: (flags & SOUND_LOOP) !== 0 } : { loop: (flags & SOUND_LOOP) !== 0, volume: this.volume });
    return true;
  }

  /** Arrête tous les emplacements qui jouent ce numéro (`41151e`) ; le numéro peut être celui d'une ambiance (< 92). */
  stop(rawId: number): void {
    const { id } = normalizeEffect(rawId, 0);
    for (const slot of this.slots) if (slot.id === id && slot.voice) this.release(slot);
  }

  stopAll(): void {
    for (const slot of this.slots) this.release(slot);
  }

  /** Nombre d'effets en cours. */
  get active(): number {
    return this.slots.filter((slot) => this.busy(slot)).length;
  }

  /** Vrai si un emplacement joue ce numéro. */
  isPlaying(rawId: number): boolean {
    const { id } = normalizeEffect(rawId, 0);
    return this.slots.some((slot) => slot.id === id && this.busy(slot));
  }
}
