/**
 * Fichier MIDI standard (SMF) → liste d'événements triée, avec le temps en millisecondes (table des tempos).
 * Pur (aucun accès au navigateur) ; utilisé par le séquenceur (`sequencer.ts`) et par le script de réduction de la soundfont ; partagé par Mathémagique et Zoombinis.
 *
 * Les jeux n'utilisent que des fichiers de format 0 (une piste), division en ticks par noire ; les formats 1 sont fusionnés
 * par commodité (tests). Un fichier SMPTE (division négative) est refusé.
 */

interface Timed {
  /** Position en ticks depuis le début. */
  readonly tick: number;
  /** Position en millisecondes à la vitesse du fichier (avant tout changement de tempo à l'exécution). */
  readonly ms: number;
}

/** Message de voix (statut `8n` à `En`) ou SysEx (commençant par `F0`), octets bruts prêts à envoyer. */
export interface MessageEvent extends Timed {
  readonly kind: "midi";
  readonly bytes: Uint8Array;
}

/** Méta-événement texte : `FF 01` texte, `FF 06` marqueur, `FF 07` point de repère (« Cue Point »). */
export interface MarkerEvent extends Timed {
  readonly kind: "marker";
  readonly text: string;
  readonly metaType: number;
}

export interface TempoEvent extends Timed {
  readonly kind: "tempo";
  readonly microsPerQuarter: number;
}

/** Fin de piste (`FF 2F`) : borne la durée du morceau. */
export interface EndEvent extends Timed {
  readonly kind: "end";
}

export type SongEvent = MessageEvent | MarkerEvent | TempoEvent | EndEvent;

export interface TempoChange {
  tick: number;
  ms: number;
  microsPerQuarter: number;
}

export interface Song {
  /** Ticks par noire. */
  readonly division: number;
  readonly format: number;
  /** Nom de la piste (`FF 03`), s'il existe. */
  readonly name: string | undefined;
  /** Numérateur de la mesure (`FF 58`), 4 par défaut. */
  readonly beatsPerBar: number;
  readonly events: readonly SongEvent[];
  readonly tempoMap: readonly TempoChange[];
  /** Fin du morceau : position de l'événement `end` (ou du dernier événement). */
  readonly endTick: number;
  readonly endMs: number;
}

/** Tempo par défaut du standard MIDI (120 bpm) si le fichier n'en déclare aucun. */
export const DEFAULT_MICROS_PER_QUARTER = 500_000;

/** Battements par minute d'un tempo en µs par noire. */
export function bpmOf(microsPerQuarter: number): number {
  return 60_000_000 / microsPerQuarter;
}

/** Tempo de départ du morceau, en µs par noire. */
export function initialMicrosPerQuarter(song: Pick<Song, "tempoMap">): number {
  return song.tempoMap[0]?.tick === 0 ? song.tempoMap[0].microsPerQuarter : DEFAULT_MICROS_PER_QUARTER;
}

/** Temps (ms) d'un tick, d'après la table des tempos. */
export function tickToMs(tempoMap: readonly TempoChange[], division: number, tick: number): number {
  let segment: TempoChange = { tick: 0, ms: 0, microsPerQuarter: DEFAULT_MICROS_PER_QUARTER };
  for (const change of tempoMap) {
    if (change.tick > tick) break;
    segment = change;
  }
  return segment.ms + ((tick - segment.tick) * segment.microsPerQuarter) / division / 1000;
}

const decoder = new TextDecoder("latin1");

interface RawEvent {
  tick: number;
  order: number;
  event: { kind: "midi"; bytes: Uint8Array } | { kind: "marker"; text: string; metaType: number } | { kind: "tempo"; microsPerQuarter: number } | { kind: "end" } | { kind: "name"; text: string } | { kind: "bar"; beats: number };
}

/** Octets de données d'un message de voix selon son statut (`undefined` pour un statut qui n'en est pas un). */
function dataLength(status: number): number | undefined {
  switch (status & 0xf0) {
    case 0xc0:
    case 0xd0:
      return 1;
    case 0x80:
    case 0x90:
    case 0xa0:
    case 0xb0:
    case 0xe0:
      return 2;
    default:
      return undefined;
  }
}

function parseTrack(bytes: Uint8Array, start: number, end: number, raw: RawEvent[]): void {
  let pos = start;
  let tick = 0;
  let running = 0;
  const vlq = (): number => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      if (pos >= end) throw new Error("MIDI : piste tronquée");
      const b = bytes[pos++];
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new Error("MIDI : durée variable invalide");
  };
  const push = (event: RawEvent["event"]) => raw.push({ tick, order: raw.length, event });

  while (pos < end) {
    tick += vlq();
    if (pos >= end) throw new Error("MIDI : piste tronquée");
    let status = bytes[pos];
    if (status & 0x80) pos++;
    else if (running) status = running;
    else throw new Error("MIDI : statut manquant (running status sans message précédent)");

    if (status === 0xff) {
      const type = bytes[pos++];
      const length = vlq();
      if (pos + length > end) throw new Error("MIDI : méta-événement tronqué");
      const data = bytes.subarray(pos, pos + length);
      pos += length;
      if (type === 0x2f) {
        push({ kind: "end" });
        return;
      }
      if (type === 0x51 && length === 3) push({ kind: "tempo", microsPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
      else if (type === 0x58 && length >= 2) push({ kind: "bar", beats: data[0] });
      else if (type === 0x03) push({ kind: "name", text: decoder.decode(data) });
      else if (type === 0x01 || type === 0x06 || type === 0x07) push({ kind: "marker", text: decoder.decode(data), metaType: type });
    } else if (status === 0xf0 || status === 0xf7) {
      const length = vlq();
      if (pos + length > end) throw new Error("MIDI : SysEx tronqué");
      // Un SysEx complet commence par F0 ; la suite d'un SysEx fractionné (F7) est envoyée telle quelle.
      push({ kind: "midi", bytes: Uint8Array.from([status, ...bytes.subarray(pos, pos + length)]) });
      pos += length;
      running = 0;
    } else {
      const count = dataLength(status);
      if (count === undefined) throw new Error(`MIDI : statut 0x${status.toString(16)} inattendu`);
      if (pos + count > end) throw new Error("MIDI : message tronqué");
      push({ kind: "midi", bytes: Uint8Array.from([status, ...bytes.subarray(pos, pos + count)]) });
      pos += count;
      running = status;
    }
  }
}

/** Lit un fichier MIDI standard (format 0 ou 1). */
export function parseSong(smf: Uint8Array): Song {
  const view = new DataView(smf.buffer, smf.byteOffset, smf.byteLength);
  const tag = (offset: number) => String.fromCharCode(...smf.subarray(offset, offset + 4));
  if (smf.length < 14 || tag(0) !== "MThd") throw new Error("MIDI : en-tête MThd absent");
  const headerSize = view.getUint32(4, false);
  const format = view.getUint16(8, false);
  const trackCount = view.getUint16(10, false);
  const division = view.getUint16(12, false);
  if (division & 0x8000) throw new Error("MIDI : division SMPTE non prise en charge");
  if (division === 0) throw new Error("MIDI : division nulle");

  const raw: RawEvent[] = [];
  let pos = 8 + headerSize;
  for (let t = 0; t < trackCount; t++) {
    if (pos + 8 > smf.length || tag(pos) !== "MTrk") throw new Error("MIDI : piste MTrk absente");
    const size = view.getUint32(pos + 4, false);
    const end = pos + 8 + size;
    if (end > smf.length) throw new Error("MIDI : piste MTrk tronquée");
    parseTrack(smf, pos + 8, end, raw);
    pos = end;
  }
  raw.sort((a, b) => a.tick - b.tick || a.order - b.order);

  // Table des tempos (le premier tempo avant le tick 0 vaut pour le début).
  const tempoMap: TempoChange[] = [];
  let ms = 0;
  let lastTick = 0;
  let micros = DEFAULT_MICROS_PER_QUARTER;
  for (const { tick, event } of raw) {
    if (event.kind !== "tempo") continue;
    ms += ((tick - lastTick) * micros) / division / 1000;
    lastTick = tick;
    micros = event.microsPerQuarter;
    const previous = tempoMap[tempoMap.length - 1];
    if (previous?.tick === tick) tempoMap[tempoMap.length - 1] = { tick, ms, microsPerQuarter: micros };
    else tempoMap.push({ tick, ms, microsPerQuarter: micros });
  }

  const events: SongEvent[] = [];
  let name: string | undefined;
  let beatsPerBar: number | undefined;
  let endTick = 0;
  let hasEnd = false;
  for (const { tick, event } of raw) {
    const at = { tick, ms: tickToMs(tempoMap, division, tick) };
    switch (event.kind) {
      case "name":
        name ??= event.text;
        break;
      case "bar":
        beatsPerBar ??= event.beats;
        break;
      case "end":
        hasEnd = true;
        endTick = Math.max(endTick, tick);
        events.push({ kind: "end", ...at });
        break;
      default:
        endTick = Math.max(endTick, tick);
        events.push({ ...event, ...at });
    }
  }
  if (!hasEnd) events.push({ kind: "end", tick: endTick, ms: tickToMs(tempoMap, division, endTick) });
  return {
    division,
    format,
    name,
    beatsPerBar: beatsPerBar ?? 4,
    events,
    tempoMap,
    endTick,
    endMs: tickToMs(tempoMap, division, endTick),
  };
}

/** `true` pour un Note On de vélocité non nulle. */
export function isNoteOn(bytes: Uint8Array): boolean {
  return (bytes[0] & 0xf0) === 0x90 && bytes[2] > 0;
}


/** Nom d'un marqueur pour la comparaison : espaces de fin retirés, casse ignorée (`"loop end "` et `"setup end "` existent dans les données). */
export function markerName(text: string): string {
  return text.trim().toLowerCase();
}

/** Premier marqueur de ce nom (voir `markerName`). */
export function findNamedMarker(events: readonly SongEvent[], name: string): MarkerEvent | undefined {
  const wanted = markerName(name);
  return events.find((e): e is MarkerEvent => e.kind === "marker" && markerName(e.text) === wanted);
}
