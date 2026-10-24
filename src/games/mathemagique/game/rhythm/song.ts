/**
 * Musique du Rhythm Shop (rhythm.md §3) : options de lecture du `MidiPlayer`, routage des repères `Cue` en événements typés pour la scène, et
 * temps du jeu (minuterie de 4 ms). Pur : le séquenceur (celui de `SoundService`, `playSong`) et son horloge viennent de l'appelant.
 *
 * Le morceau ne dépend pas de la variante : les 4 variantes d'un morceau changent les outils, ni le motif ni la musique. Seuls les emplacements
 * remplis du Pattern Bin comptent (`rhythmRewrite`) : les autres sont muets, la mesure est jouée une fois.
 */
import { rhythmRewrite } from "../../audio/rhythm-rewrite";
import { type PlayOptions, type ProgramEntry } from "../../audio/sequencer";
import { type MarkerEvent, type Song, bpmOf, initialMicrosPerQuarter } from "../../audio/smf";
import { type PlaySongOptions } from "../../engine/sound";
import { MEASURE } from "./pieces";
import { filledSlots, isPatternComplete } from "./logic";

// --- Repères ---

/** Repère `Cue Point` (`FF 07`) : méta-type des repères du Rhythm Shop. */
const CUE_META_TYPE = 0x07;

/** Début d'une pièce du motif : `a` à `x` = emplacement 0 à 23. */
export interface SlotCue {
  type: "slot";
  slot: number;
  tick: number;
  ms: number;
}

/** Temps de la mesure : `1` à `8`. */
export interface BeatCue {
  type: "beat";
  beat: number;
  tick: number;
  ms: number;
}

export type RhythmCue = SlotCue | BeatCue;

/**
 * Repère → événement (`1028:26b0`, type texte) : le premier caractère décide (`"e  "` vaut `e`). `a`-`x` → emplacement ; `1`-`8` → temps ;
 * le reste (`y`, `z`, `z - end`, autres types de méta) est ignoré (`null`).
 */
export function cueOf(marker: MarkerEvent): RhythmCue | null {
  if (marker.metaType !== CUE_META_TYPE) return null;
  const code = marker.text.charCodeAt(0);
  if (code >= 0x61 && code <= 0x78) return { type: "slot", slot: code - 0x61, tick: marker.tick, ms: marker.ms };
  if (code >= 0x31 && code <= 0x38) return { type: "beat", beat: code - 0x30, tick: marker.tick, ms: marker.ms };
  return null;
}

// --- Options de lecture ---

/** Tempo entier du jeu (`1058:16e8`) : `60 000 000 / µs par noire` en division entière (170 pour 352 941 µs). */
export function songBpm(song: Song): number {
  return Math.floor(bpmOf(initialMicrosPerQuarter(song)) + 1e-6);
}

/** Temps par mesure : le numérateur de `FF 58` s'il vaut 3, 4 ou 6, sinon 4. */
export function songBeats(song: Song): number {
  return [3, 4, 6].includes(song.beatsPerBar) ? song.beatsPerBar : 4;
}

export interface RhythmPlayRequest {
  /** Contenu du Pattern Bin (`board.pattern` : négatif = emplacement vide). */
  pattern: readonly number[];
  /** Blocs `Prg#` du MIDI (`parsePrograms(parseMidi(...).programs)`). */
  programs?: readonly ProgramEntry[];
  /** Un repère `a`-`x` ou `1`-`8` est atteint (à l'instant où il est entendu, à un tick du moteur près). */
  onCue?(cue: RhythmCue): void;
  /** Fin de la mesure (pas après `stop()`). */
  onEnd?(): void;
  /** Rejoue la mesure en boucle (hors original : le jeu la joue une fois). */
  loop?: boolean;
  /** Impose un tempo (défaut : le tempo entier du jeu, `songBpm`). */
  bpm?: number;
}

/** Options de lecture (`MidiPlayer.play` via `SoundService.playSong`) : réécriture (une mesure, emplacements vides muets), tempo entier, routage des repères. */
export function rhythmPlayOptions(song: Song, request: RhythmPlayRequest): PlayOptions {
  const options: PlayOptions = {
    rewrite: rhythmRewrite(filledSlots(request.pattern)),
    bpm: request.bpm ?? songBpm(song),
    onMarker: (marker) => {
      const cue = cueOf(marker);
      if (cue) request.onCue?.(cue);
    },
  };
  if (request.programs) options.programs = request.programs;
  if (request.loop) options.loop = true;
  if (request.onEnd) options.onEnd = request.onEnd;
  return options;
}

/** Ce dont `playRhythmSong` a besoin du séquenceur : `SoundService.playSong` (un seul séquenceur, celui du son de la scène). */
export interface RhythmSongPlayer {
  playSong(song: Song, options?: PlaySongOptions): unknown;
}

/**
 * Joue le morceau avec le motif donné sur le séquenceur du `SoundService` (la musique en cours est remplacée). Renvoie `true` si le motif est
 * complet (la scène fait alors danser Algebird sur les repères).
 */
export function playRhythmSong(player: RhythmSongPlayer, song: Song, request: RhythmPlayRequest): boolean {
  player.playSong(song, rhythmPlayOptions(song, request));
  return isPatternComplete(request.pattern);
}

// --- Temps du jeu (minuterie de 4 ms, rhythm.md §3.4) ---

/** Ticks de 4 ms par temps : `15000 / bpm` (170 → 88). */
export function ticksPerBeat(bpm: number): number {
  return Math.trunc(15000 / bpm);
}

/** Ticks de 4 ms par mesure : `temps × 15000 / bpm`, en entier (170, 4 temps → 352 ; 130 → 461). */
export function ticksPerMeasure(bpm: number, beats: number): number {
  return Math.trunc((beats * 15000) / bpm);
}

/** Ticks de 4 ms par double croche : `15000 / (4 × bpm)` (170 → 22). */
export function ticksPerSixteenth(bpm: number): number {
  return Math.trunc(15000 / (4 * bpm));
}

/** Pas de danse par mesure : `clamp(temps × 4, 4, 24)` (3/4 → 12, 4/4 → 16, 6/4 → 24). */
export function danceStepsPerMeasure(beats: number): number {
  return Math.min(24, Math.max(4, beats * 4));
}

export interface PartStart {
  /** Indice de la case dans le Parts Bin. */
  index: number;
  size: number;
  /** Début en ticks de 4 ms depuis le départ : `ticksParMesure × (somme des tailles avant) / 144`. */
  startTick: number;
}

/**
 * Chronologie de Play Parts : les pièces (> 0) du Parts Bin dans l'ordre, chacune démarrant après la somme des tailles qui la précèdent
 * (fantômes compris : leur place reste vide). Hypothèse : un fantôme garde sa durée (rhythm.md §9 question 2).
 */
export function partsTimeline(words: readonly number[], bpm: number, beats: number): PartStart[] {
  const measure = ticksPerMeasure(bpm, beats);
  const starts: PartStart[] = [];
  let before = 0;
  for (let index = 0; index < words.length; index++) {
    const size = Math.abs(words[index]!);
    if (size === 0) break;
    if (words[index]! > 0) starts.push({ index, size, startTick: Math.trunc((measure * before) / MEASURE) });
    before += size;
  }
  return starts;
}
