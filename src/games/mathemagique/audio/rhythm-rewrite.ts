/**
 * Réécriture du MIDI du Rhythm Shop avant lecture (`1058:125e`, rhythm.md §3.3), version sur liste d'événements.
 *
 * Les morceaux portent des repères `Cue Point` (`FF 07`) d'un seul caractère : `a` à `x` = emplacement du motif cible
 * (posé à chaque début de pièce) et `1` à `8` = temps de la mesure. L'original :
 * 1. ne garde qu'**une mesure** : de la 1re à la 2e apparition des repères `a` / `1` (coupure à la plus proche des deux) ;
 * 2. met à **vélocité 0** les Note On de chaque emplacement vide (la note existe mais ne sonne pas, les durées restent).
 */
import type { MarkerEvent, SongEvent } from "./smf";
import type { SongRewrite } from "./sequencer";

const CUE_META_TYPE = 0x07;

function isCue(event: SongEvent, text: string): event is MarkerEvent {
  return event.kind === "marker" && event.metaType === CUE_META_TYPE && event.text === text;
}

/** Indice d'emplacement (0 à 23) d'un repère `a` à `x` (le texte peut être complété d'espaces : `"e  "`), sinon `undefined`. */
export function slotOfCue(event: SongEvent): number | undefined {
  if (event.kind !== "marker" || event.metaType !== CUE_META_TYPE) return undefined;
  const code = event.text.charCodeAt(0) - 0x61;
  return code >= 0 && code < 24 ? code : undefined;
}

/** Ne garde qu'une mesure : coupe à la plus proche des deuxièmes occurrences des repères de début (`a`) et de temps 1 (`1`). */
export function keepFirstMeasure(events: readonly SongEvent[]): readonly SongEvent[] {
  const firstA = events.findIndex((e) => isCue(e, "a"));
  const firstBeat = events.findIndex((e) => isCue(e, "1"));
  if (firstA < 0 || firstBeat < 0) return events;
  const from = Math.max(firstA, firstBeat) + 1;
  const cuts = [events.findIndex((e, i) => i >= from && isCue(e, "a")), events.findIndex((e, i) => i >= from && isCue(e, "1"))].filter((i) => i >= 0);
  if (cuts.length === 0) return events;
  const cutIndex = Math.min(...cuts);
  const cut = events[cutIndex];
  return [...events.slice(0, cutIndex).filter((e) => e.kind !== "end"), { kind: "end", tick: cut.tick, ms: cut.ms }];
}

/** Vélocité 0 pour les Note On des emplacements vides (`filled[i]` faux). L'emplacement courant est `a` avant le premier repère. */
export function silenceEmptySlots(events: readonly SongEvent[], filled: readonly boolean[]): readonly SongEvent[] {
  let slot = 0;
  return events.map((event) => {
    const marked = slotOfCue(event);
    if (marked !== undefined) slot = marked;
    if (event.kind === "midi" && (event.bytes[0] & 0xf0) === 0x90 && event.bytes[2] > 0 && !filled[slot]) {
      const bytes = Uint8Array.from(event.bytes);
      bytes[2] = 0;
      return { ...event, bytes };
    }
    return event;
  });
}

/** Réécriture complète du Rhythm Shop : une mesure, les emplacements vides muets. `filled` est relu à chaque lecture. */
export function rhythmRewrite(filled: readonly boolean[]): SongRewrite {
  return (events) => silenceEmptySlots(keepFirstMeasure(events), filled);
}
