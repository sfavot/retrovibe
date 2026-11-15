/**
 * Musique au format HMI (« Human Machine Interfaces », SOS) → `Song` de `smf.ts`, joué par le séquenceur du jeu sur un synthétiseur General MIDI.
 * Pur (aucun accès au navigateur). Variante lue ici : `HMI-MIDISONG061595` (pistes `HMI-MIDITRACK`), celle de *The Incredible Machine 3* ;
 * les variantes `HMIMIDIP` (HMP de *Descent*) ne sont pas prises en charge.
 *
 * Le format n'a pas de spécification officielle. Lu sur les 24 morceaux de TIM3 (`docs/tim3/formats.md` § 10), avec pour recoupement la
 * description incomplète de WildMIDI (`docs/formats/HmiFileFormat.txt`, GPL) : signatures, `0x9n` suivi de la durée, taille des évènements `0xFE`.
 *
 * Fichier (octets, petit boutiste) :
 * - `0x00` signature `HMI-MIDISONG061595` ;
 * - `0xD4` u16 : 120. Lu comme la cadence du séquenceur HMI, **120 ticks par seconde**, et aussi comme division (120 ticks par noire) ;
 * - `0xE4` u32 nombre de pistes, `0xE8` u32 position de la table des pistes (une position u32 par piste, dans l'ordre du fichier).
 *   `0xD2` (u16, 192 sauf 480 pour un morceau) et `0xD6` (position d'une table suivante) ne sont pas utilisés.
 * - Piste : signature `HMI-MIDITRACK`, u32 à `+0x57` = position des évènements depuis le début de la piste ; la piste va jusqu'à la suivante.
 * - Évènements : durée variable standard (delta, 7 bits par octet, bit 7 = suite), puis un message MIDI avec running status, qui diffère du SMF :
 *   - `0x9n kk vv` est suivi de la **durée** de la note (durée variable) ; il n'y a pas de Note Off : ils sont recréés ici (`0x8n kk 00`),
 *     une note de durée nulle dure un tick, une seule note à la fois par canal et touche (`placeNotes`) ;
 *   - `FF 2F 00` termine la piste ; les autres méta-évènements sont lus comme en SMF ;
 *   - `FE tt …` : évènements propres à HMI. `FE 10` = 2 octets, un octet de longueur `n`, `n` octets, 4 octets (point de branchement, un par piste,
 *     ignoré) ; `FE 14` = 2 octets `FF FF` (**début de boucle**) ; `FE 15` = 6 octets `80 01` + u32 (**fin de boucle**, sur la piste maîtresse :
 *     renvoie à la position de `FE 14` + 2 dans la même piste) ; `FE 11`, `FE 12` = 2 octets (absents des 24 morceaux, taille supposée).
 *
 * Boucle : l'état des canaux au début de boucle y est reposé à chaque tour (`chaseLoopStart`).
 *
 * Tempo : un seul, 1 000 000 µs par noire, soit 120 ticks par seconde (voir ci-dessus). Les durées ainsi obtenues (58 à 155 s, un morceau de
 * 14 s) sont celles de boucles musicales, alors que lire `0xD2` comme un tempo en battements par minute donnerait des notes de 20 ms.
 * Confirmé par le désassemblage de la bibliothèque SOS du jeu (`SOSLIBS2.DLL`, 16 bits) : `sosMIDISongAlterTempo` calcule le nouveau rythme
 * du minuteur par `u16(+0xD4) × pourcentage / 100` et le passe à `sosTIMERAlterEventRate` ; `0xD4` est donc la cadence du minuteur à 100 %
 * (évènements par seconde, un tick par évènement). `0xD2` (192, 480) ne sert qu'au calcul des positions mesure:temps (`sosMIDIGetSongLocation`).
 * Seule une écoute du jeu original lèverait le doute restant (un tick par évènement du minuteur).
 */
import { tickToMs, type Song, type SongEvent, type TempoChange } from "./smf";

const SONG_SIGNATURE = "HMI-MIDISONG";
const TRACK_SIGNATURE = "HMI-MIDITRACK";
const DIVISION_OFFSET = 0xd4;
const TRACK_COUNT_OFFSET = 0xe4;
const TRACK_TABLE_OFFSET = 0xe8;
const TRACK_DATA_OFFSET = 0x57;

/** Boucle du morceau : de `startTick` à `endTick`, toutes pistes confondues. */
export interface HmiLoop {
  readonly startTick: number;
  readonly startMs: number;
  readonly endTick: number;
  readonly endMs: number;
}

/** Comptes de lecture d'une piste, pour le contrôle de la lecture. */
export interface HmiTrackInfo {
  /** Début de la piste dans le fichier. */
  readonly start: number;
  /** Fin de la piste (début de la suivante, ou fin du fichier). */
  readonly end: number;
  /** Position après `FF 2F 00` : égale à `end` quand la piste a été lue jusqu'au dernier octet. */
  readonly parsedEnd: number;
  readonly notes: number;
  readonly endTick: number;
}

export interface HmiSong extends Song {
  /** Boucle déclarée par `FE 14` / `FE 15` ; absente d'un morceau qui ne boucle pas. */
  readonly loop: HmiLoop | undefined;
  readonly tracks: readonly HmiTrackInfo[];
}

/** Texte des marqueurs posés au début et à la fin de la boucle (comme les `loop start` / `loop end` des SMF des autres jeux). */
export const LOOP_START_MARKER = "loop start";
export const LOOP_END_MARKER = "loop end";

type RawEvent =
  | { kind: "midi"; bytes: Uint8Array }
  | { kind: "marker"; text: string; metaType: number }
  | { kind: "tempo"; microsPerQuarter: number };
interface Raw {
  tick: number;
  priority: number;
  event: RawEvent;
}

/** Fin d'une note avant tout, début d'une note après tout : une note répétée repart proprement. */
const PRIORITY_TEMPO = -2;
/** État des canaux reposé au début de boucle : avant les évènements du fichier au même instant, qui le remplacent. */
const PRIORITY_CHASE = -1;
const PRIORITY_OFF = 0;
const PRIORITY_OTHER = 1;
const PRIORITY_ON = 2;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

interface TrackResult {
  info: HmiTrackInfo;
  loopStart: number | undefined;
  loopEnd: number | undefined;
}

/** Note lue (`0x9n kk vv` + durée) : `velocity` 0 vaut un note-off de la touche à `on`. */
interface Note {
  channel: number;
  key: number;
  velocity: number;
  on: number;
  off: number;
}

/**
 * Pose les note-on et note-off des notes de toutes les pistes.
 *
 * - **Durée nulle** (`0x9n kk vv 00`, des centaines dans `SX_1004`, `SX_1009`…) : la note dure un tick. Posé au même tick, son note-off
 *   passait avant son note-on (les fins avant les débuts) ; la note n'était jamais relâchée et restait tenue sans fin. Le pilote SOS de
 *   l'original ne peut couper la note qu'à un évènement suivant de son minuteur (120 par seconde) : un tick est l'approximation retenue.
 * - **Une seule note à la fois par canal et touche** : une note qui repart sur
 * une touche encore tenue termine la précédente à cet instant (son note-off, prévu plus tard, est retiré) ; deux notes au même instant n'en
 * font qu'une (la plus longue) ; un `0x9n kk 00` termine la note tenue. Les morceaux de TIM3 rejouent souvent une touche tenue (3 358 fois
 * dans `SX_1009`) : sans cela, une note-on n'avait pas de note-off à elle (le synthétiseur les apparie dans l'ordre, le séquenceur ne compte
 * qu'une note par touche) et restait tenue sans fin au tour de boucle. C'est aussi ce que fait un synthétiseur General MIDI matériel, où le
 * premier note-off d'une touche la coupe (le pilote SOS de l'original envoie les note-off à l'échéance de chaque durée ; non lu).
 */
function placeNotes(notes: Note[], raw: Raw[]): void {
  for (const n of notes) if (n.velocity > 0 && n.off <= n.on) n.off = n.on + 1;
  const order = notes.map((n, i) => [n, i] as const).sort(([a, i], [b, j]) => a.on - b.on || i - j);
  const sounding = new Map<number, Note>();
  const kept: Note[] = [];
  for (const [note] of order) {
    const id = (note.channel << 7) | note.key;
    const previous = sounding.get(id);
    if (previous && previous.off > note.on) {
      if (previous.on === note.on) {
        previous.off = Math.max(previous.off, note.off);
        if (note.velocity > 0) previous.velocity = Math.max(previous.velocity, note.velocity);
        continue;
      }
      previous.off = note.on;
    }
    if (note.velocity === 0) {
      sounding.delete(id);
      continue;
    }
    sounding.set(id, note);
    kept.push(note);
  }
  for (const n of kept) {
    raw.push({ tick: n.on, priority: PRIORITY_ON, event: { kind: "midi", bytes: Uint8Array.of(0x90 | n.channel, n.key, n.velocity) } });
    raw.push({ tick: n.off, priority: PRIORITY_OFF, event: { kind: "midi", bytes: Uint8Array.of(0x80 | n.channel, n.key, 0) } });
  }
}

/** Contrôleurs non rejoués au début de boucle : séquences RPN / NRPN (l'étendue du pitch bend reste réglée d'un tour à l'autre). */
const UNCHASED_CONTROLLERS = new Set([6, 38, 96, 97, 98, 99, 100, 101]);

/**
 * État des canaux au début de la boucle (programme, contrôleurs, pitch bend, tels que les a laissés tout ce qui précède `loopStart`),
 * reposé à `loopStart` avant les autres évènements de cet instant : chaque tour repart comme le premier. Sans cela, un tour suivant
 * gardait ce que la fin du précédent avait laissé (`SX_1013` : canal 6 au volume 8 et sur un autre programme, `SX_1004` : pitch bend
 * remis à zéro au lieu d'être tiré, `SX_1015`, `SX_1019` : programmes changés). Au premier tour, ces valeurs sont déjà en place.
 */
function chaseLoopStart(raw: readonly Raw[], loopStart: number): Raw[] {
  const state = new Map<string, Uint8Array>();
  const before = raw.filter((r) => r.tick < loopStart).sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  for (const { event } of before) {
    if (event.kind !== "midi") continue;
    const [status, first] = event.bytes;
    const type = status & 0xf0;
    const channel = status & 0x0f;
    if (type === 0xc0) state.set(`${channel}:program`, event.bytes);
    else if (type === 0xe0) state.set(`${channel}:bend`, event.bytes);
    else if (type === 0xb0 && !UNCHASED_CONTROLLERS.has(first)) state.set(`${channel}:cc${first}`, event.bytes);
  }
  return [...state.values()].map((bytes) => ({ tick: loopStart, priority: PRIORITY_CHASE, event: { kind: "midi", bytes } }));
}

function parseTrack(bytes: Uint8Array, view: DataView, start: number, end: number, raw: Raw[], noteList: Note[]): TrackResult {
  if (start + TRACK_DATA_OFFSET + 4 > end || ascii(bytes, start, TRACK_SIGNATURE.length) !== TRACK_SIGNATURE) throw new Error("HMI : piste HMI-MIDITRACK absente");
  let pos = start + view.getUint32(start + TRACK_DATA_OFFSET, true);
  let tick = 0;
  let running = 0;
  let notes = 0;
  let maxTick = 0;
  let loopStart: number | undefined;
  let loopEnd: number | undefined;
  const need = (count: number) => {
    if (pos + count > end) throw new Error("HMI : piste tronquée");
  };
  const byte = (): number => {
    need(1);
    return bytes[pos++];
  };
  const data = (): number => {
    const value = byte();
    if (value > 0x7f) throw new Error(`HMI : octet de données 0x${value.toString(16)} invalide`);
    return value;
  };
  const vlq = (): number => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = byte();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new Error("HMI : durée variable invalide");
  };
  const push = (at: number, priority: number, event: Raw["event"]) => {
    raw.push({ tick: at, priority, event });
    maxTick = Math.max(maxTick, at);
  };

  for (;;) {
    tick += vlq();
    let status = byte();
    if (!(status & 0x80)) {
      if (!running) throw new Error("HMI : statut manquant (running status sans message précédent)");
      status = running;
      pos--;
    }
    if (status === 0xff) {
      const type = byte();
      const length = vlq();
      need(length);
      const text = ascii(bytes, pos, length);
      pos += length;
      if (type === 0x2f) break;
      if (type === 0x01 || type === 0x06 || type === 0x07) push(tick, PRIORITY_OTHER, { kind: "marker", text, metaType: type });
    } else if (status === 0xfe) {
      const type = byte();
      switch (type) {
        case 0x10: {
          pos += 2;
          need(1);
          pos += 1 + bytes[pos] + 4;
          break;
        }
        case 0x11:
        case 0x12:
          pos += 2;
          break;
        case 0x14:
          pos += 2;
          loopStart = tick;
          break;
        case 0x15:
          pos += 6;
          loopEnd = tick;
          break;
        default:
          throw new Error(`HMI : évènement FE ${type.toString(16)} inconnu`);
      }
    } else if (status === 0xf0 || status === 0xf7) {
      const length = vlq();
      need(length);
      push(tick, PRIORITY_OTHER, { kind: "midi", bytes: Uint8Array.from([status, ...bytes.subarray(pos, pos + length)]) });
      pos += length;
      running = 0;
    } else {
      const channel = status & 0x0f;
      switch (status & 0xf0) {
        case 0x90: {
          const key = data();
          const velocity = data();
          const length = vlq();
          notes++;
          // Les paires note-on / note-off sont posées par `placeNotes`, une fois toutes les pistes lues.
          noteList.push({ channel, key, velocity, on: tick, off: tick + length });
          maxTick = Math.max(maxTick, tick + length);
          break;
        }
        case 0xc0:
        case 0xd0:
          push(tick, PRIORITY_OTHER, { kind: "midi", bytes: Uint8Array.of(status, data()) });
          break;
        case 0x80:
        case 0xa0:
        case 0xb0:
        case 0xe0: {
          const first = data();
          push(tick, PRIORITY_OTHER, { kind: "midi", bytes: Uint8Array.of(status, first, data()) });
          break;
        }
        default:
          throw new Error(`HMI : statut 0x${status.toString(16)} inattendu`);
      }
      running = status;
    }
  }
  return { info: { start, end, parsedEnd: pos, notes, endTick: maxTick }, loopStart, loopEnd };
}

/** Lit un morceau `HMI-MIDISONG061595`. */
export function parseHmi(hmi: Uint8Array): HmiSong {
  const view = new DataView(hmi.buffer, hmi.byteOffset, hmi.byteLength);
  if (hmi.length < TRACK_TABLE_OFFSET + 4 || ascii(hmi, 0, SONG_SIGNATURE.length) !== SONG_SIGNATURE) throw new Error("HMI : signature HMI-MIDISONG absente");
  const ticksPerSecond = view.getUint16(DIVISION_OFFSET, true);
  if (ticksPerSecond === 0) throw new Error("HMI : cadence nulle");
  const trackCount = view.getUint32(TRACK_COUNT_OFFSET, true);
  const table = view.getUint32(TRACK_TABLE_OFFSET, true);
  if (trackCount === 0 || table + 4 * trackCount > hmi.length) throw new Error("HMI : table des pistes invalide");
  const starts = Array.from({ length: trackCount }, (_, i) => view.getUint32(table + 4 * i, true));
  const bounds = [...starts, hmi.length].sort((a, b) => a - b);

  const raw: Raw[] = [];
  const notes: Note[] = [];
  const tracks: HmiTrackInfo[] = [];
  let loopStart: number | undefined;
  let loopEnd: number | undefined;
  for (const start of starts) {
    if (start >= hmi.length) throw new Error("HMI : piste hors du fichier");
    const end = bounds[bounds.indexOf(start) + 1];
    const result = parseTrack(hmi, view, start, end, raw, notes);
    tracks.push(result.info);
    loopStart ??= result.loopStart;
    loopEnd ??= result.loopEnd;
  }
  placeNotes(notes, raw);
  if (loopStart !== undefined && loopEnd !== undefined && loopStart > 0) raw.push(...chaseLoopStart(raw, loopStart));

  // Cadence fixe : `ticksPerSecond` ticks par seconde et par noire (division = cadence), soit 1 s par noire.
  const division = ticksPerSecond;
  const microsPerQuarter = 1_000_000;
  const tempoMap: TempoChange[] = [{ tick: 0, ms: 0, microsPerQuarter }];
  const ms = (tick: number) => tickToMs(tempoMap, division, tick);
  raw.push({ tick: 0, priority: PRIORITY_TEMPO, event: { kind: "tempo", microsPerQuarter } });
  const loop: HmiLoop | undefined =
    loopStart !== undefined && loopEnd !== undefined ? { startTick: loopStart, startMs: ms(loopStart), endTick: loopEnd, endMs: ms(loopEnd) } : undefined;
  if (loopStart !== undefined && loopEnd !== undefined) {
    raw.push({ tick: loopStart, priority: PRIORITY_OTHER, event: { kind: "marker", text: LOOP_START_MARKER, metaType: 6 } });
    raw.push({ tick: loopEnd, priority: PRIORITY_OTHER, event: { kind: "marker", text: LOOP_END_MARKER, metaType: 6 } });
  }
  const order = raw.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => a.tick - b.tick || a.priority - b.priority || i - j);
  const events: SongEvent[] = [];
  let endTick = 0;
  for (const [{ tick, event }] of order) {
    endTick = Math.max(endTick, tick);
    events.push({ ...event, tick, ms: ms(tick) });
  }
  events.push({ kind: "end", tick: endTick, ms: ms(endTick) });
  return { division, format: 1, name: undefined, beatsPerBar: 4, events, tempoMap, endTick, endMs: ms(endTick), loop, tracks };
}
