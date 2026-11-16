/**
 * Sortie MIDI datée, commune aux jeux qui jouent du MIDI General MIDI (Mathémagique, Zoombinis, The Incredible Machine 3) :
 * `midi-sequencer.ts` y envoie ses messages, `web-gm-synth.ts` la réalise dans le navigateur.
 */

export interface MidiSink {
  /** Envoie un message MIDI brut (statut + données, SysEx compris), à jouer à `atMs` (temps de `AudioSink.now`) ou tout de suite. */
  send(message: Uint8Array, atMs?: number): void;
  /** Coupe toutes les notes et remet les contrôleurs à zéro sur les 16 canaux. */
  reset(): void;
}
