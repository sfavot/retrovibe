/**
 * Séquenceur MIDI du jeu, pur et piloté par le tick du moteur (aucun minuteur, aucun accès au navigateur).
 *
 * L'original joue le MIDI par `midiOut` avec un séquenceur logiciel (`timeSetEvent`, engine.md §6) : lecture de la piste,
 * repères texte `setup end` / `loop start` / `loop end` pour boucler, et rappel du jeu à chaque repère (Rhythm Shop,
 * rhythm.md §3). Ici, à chaque `tick()`, les événements qui tombent dans la fenêtre d'avance (`lookaheadMs`) partent vers
 * `MidiSink.send(message, atMs)` avec leur instant exact sur l'horloge audio ; les repères, eux, sont signalés quand leur
 * instant est passé (et non quand ils sont planifiés), pour rester synchrones avec ce qu'on entend.
 *
 * - Boucle : `loop start` (sinon `setup end`, sinon le début) → `loop end` (sinon la fin de piste). Premier repère de chaque nom.
 * - Démarrage : `reset()`, messages d'initialisation `MIDIMAP.DAT` (`SYSX`), programmes du bloc `Prg#`, puis le morceau.
 * - Réécriture : `rewrite(events, song)` remplace la liste d'événements avant la lecture (voir `rhythm-rewrite.ts`).
 * - Tempo : `setBpm` change la vitesse en cours de route (les événements déjà planifiés gardent leur instant).
 */
import { type MarkerEvent, type Song, type SongEvent, bpmOf, findNamedMarker, initialMicrosPerQuarter } from "./smf";
import type { MidiSink } from "./sink";

/** Remplace les événements d'un morceau avant sa lecture (liste triée par temps, finissant par un `end`). */
export type SongRewrite = (events: readonly SongEvent[], song: Song) => readonly SongEvent[];

/** Programme du bloc `Prg#` : programme GM et masque de canaux (bit `c` = le canal `c` l'utilise). */
export interface ProgramEntry {
  program: number;
  channelMask: number;
}

export interface PlayOptions {
  /** Rejoue en boucle entre `loop start` (ou `setup end`) et `loop end` (ou la fin). */
  loop?: boolean;
  /** Commence au repère de ce nom (les messages qui le précèdent, hors notes, sont envoyés tout de suite). */
  startMarker?: string;
  /** Noms des repères de boucle ; défaut `loop start` / `loop end`. */
  loopMarkers?: { start?: string; end?: string };
  rewrite?: SongRewrite;
  /** Tempo de départ en battements par minute (défaut : celui du fichier). */
  bpm?: number;
  /** Programmes à régler au départ (bloc `Prg#`, voir `parsePrograms`). */
  programs?: readonly ProgramEntry[];
  /** Un repère texte (`FF 01` / `FF 06` / `FF 07`) vient d'être atteint. */
  onMarker?: (marker: MarkerEvent) => void;
  /** Fin d'un morceau qui ne boucle pas (pas après `stop()`). */
  onEnd?: () => void;
}

export interface MidiPlayerConfig {
  /** Horloge audio en ms (`AudioSink.now`). */
  now: () => number;
  /** Avance de planification, en ms (défaut 100). */
  lookaheadMs?: number;
  /** Délai avant la première note, pour que l'initialisation parte la première (défaut 20). */
  startDelayMs?: number;
  /** Messages envoyés à l'ouverture (`parseSysx` de `MIDIMAP.DAT`). */
  initMessages?: readonly Uint8Array[];
}

/** Bloc `Prg#` (octets bruts de `parseMidi().programs`) : `u16 n` puis `n` couples `u16 programme`, `u16 masque`, big-endian. */
export function parsePrograms(bytes: Uint8Array): ProgramEntry[] {
  if (bytes.length < 2) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.min(view.getUint16(0, false), Math.floor((bytes.length - 2) / 4));
  return Array.from({ length: count }, (_, i) => ({
    program: view.getUint16(2 + i * 4, false),
    channelMask: view.getUint16(4 + i * 4, false),
  }));
}

/** Ressource `SYSX` de `MIDIMAP.DAT` : suite de messages courts de canal (3 octets, 2 pour `Cn`/`Dn`). Le bourrage final est ignoré. */
export function parseSysx(bytes: Uint8Array): Uint8Array[] {
  const messages: Uint8Array[] = [];
  let pos = 0;
  while (pos < bytes.length && bytes[pos] >= 0x80 && bytes[pos] < 0xf0) {
    const length = (bytes[pos] & 0xf0) === 0xc0 || (bytes[pos] & 0xf0) === 0xd0 ? 2 : 3;
    if (pos + length > bytes.length) break;
    messages.push(bytes.slice(pos, pos + length));
    pos += length;
  }
  return messages;
}

interface PendingMarker {
  at: number;
  marker: MarkerEvent;
}

export class MidiPlayer {
  private readonly lookahead: number;
  private readonly startDelay: number;
  private initMessages: readonly Uint8Array[];

  private active = false;
  private events: readonly SongEvent[] = [];
  private options: PlayOptions = {};
  private index = 0;
  private looping = false;
  private loopStartMs = 0;
  private limitMs = 0;
  private endMs = 0;
  private baseBpm = 120;
  private speed = 1;
  /** Instant d'horloge où la position `anchorSong` du morceau est atteinte. */
  private anchorClock = 0;
  private anchorSong = 0;
  /** Fin de la fenêtre planifiée au dernier tick (sert à recaler le tempo sans inverser l'ordre). */
  private scheduledTo = 0;
  private pending: PendingMarker[] = [];
  /** Notes en cours (`canal << 7 | touche`), pour les couper à la boucle et à l'arrêt. */
  private readonly sounding = new Set<number>();

  constructor(
    private readonly sink: MidiSink,
    private readonly config: MidiPlayerConfig,
  ) {
    this.lookahead = config.lookaheadMs ?? 100;
    this.startDelay = config.startDelayMs ?? 20;
    this.initMessages = config.initMessages ?? [];
  }

  /** Messages envoyés à chaque départ (le `SYSX` de `MIDIMAP.DAT` n'est lu qu'une fois, après le chargement de l'archive). */
  setInitMessages(messages: readonly Uint8Array[]): void {
    this.initMessages = messages;
  }

  get playing(): boolean {
    return this.active;
  }

  /** Tempo courant en battements par minute (celui du début du fichier, à l'échelle près). */
  get bpm(): number {
    return this.baseBpm * this.speed;
  }

  /** Position de lecture dans le morceau, en ms à la vitesse du fichier (0 hors lecture). */
  get positionMs(): number {
    if (!this.active) return 0;
    return Math.max(0, this.songAt(this.config.now()));
  }

  play(song: Song, options: PlayOptions = {}): void {
    this.halt();
    const events = options.rewrite ? options.rewrite(song.events, song) : song.events;
    const end = [...events].reverse().find((e) => e.kind === "end");
    this.events = events;
    this.options = options;
    this.endMs = end ? end.ms : (events[events.length - 1]?.ms ?? 0);

    const now = this.config.now();
    this.sink.reset();
    for (const message of this.initMessages) this.sink.send(message, now);
    for (const { program, channelMask } of options.programs ?? []) {
      for (let channel = 0; channel < 16; channel++) {
        if (channelMask & (1 << channel)) this.sink.send(Uint8Array.of(0xc0 | channel, program & 0x7f), now);
      }
    }

    // Départ : au repère demandé s'il existe ; avant lui, on ne garde que les réglages (pas les notes).
    const startMs = (options.startMarker ? findNamedMarker(events, options.startMarker)?.ms : undefined) ?? 0;
    let index = 0;
    while (index < events.length && events[index].ms < startMs) {
      const event = events[index++];
      if (event.kind === "midi" && !isNote(event.bytes)) this.sink.send(event.bytes, now);
    }
    this.index = index;

    const loopStart = findNamedMarker(events, options.loopMarkers?.start ?? "loop start") ?? findNamedMarker(events, "setup end");
    const loopEnd = findNamedMarker(events, options.loopMarkers?.end ?? "loop end");
    this.loopStartMs = loopStart?.ms ?? 0;
    this.limitMs = loopEnd?.ms ?? this.endMs;
    // Boucle sans intervalle (fin avant le début) : lecture simple, jamais de boucle infinie dans un tick.
    this.looping = !!options.loop && this.limitMs > this.loopStartMs;

    this.baseBpm = bpmOf(initialMicrosPerQuarter(song));
    this.speed = options.bpm && options.bpm > 0 ? options.bpm / this.baseBpm : 1;
    this.anchorClock = now + this.startDelay;
    this.anchorSong = startMs;
    this.scheduledTo = this.anchorClock;
    this.pending = [];
    this.active = true;
    this.tick();
  }

  /** Arrête sans rappel de fin et coupe les notes. */
  stop(): void {
    if (!this.active) return;
    this.halt();
    this.sink.reset();
  }

  /** Change le tempo (battements par minute) sans interrompre la lecture. */
  setBpm(bpm: number): void {
    if (!(bpm > 0)) throw new Error(`Tempo invalide : ${bpm}`);
    if (!this.active) {
      this.speed = bpm / this.baseBpm;
      return;
    }
    // Recalage à la fin de la fenêtre déjà planifiée : les événements suivants partent de là au nouveau rythme.
    if (this.scheduledTo > this.anchorClock) {
      this.anchorSong = this.songAt(this.scheduledTo);
      this.anchorClock = this.scheduledTo;
    }
    this.speed = bpm / this.baseBpm;
  }

  /** À appeler à chaque tick du moteur : planifie la fenêtre d'avance et signale les repères échus. */
  tick(): void {
    if (!this.active) return;
    const now = this.config.now();
    const horizon = now + this.lookahead;
    this.scheduledTo = Math.max(this.scheduledTo, horizon);

    for (;;) {
      const event = this.events[this.index];
      if (this.looping && (!event || this.beyondLoopEnd(event))) {
        if (this.clockAt(this.limitMs) > horizon) break;
        this.wrap();
        continue;
      }
      if (!event || this.clockAt(event.ms) > horizon) break;
      this.index++;
      this.dispatch(event);
    }

    while (this.pending.length > 0 && this.pending[0].at <= now) {
      const { marker } = this.pending.shift()!;
      this.options.onMarker?.(marker);
      if (!this.active) return; // le rappel a pu arrêter ou relancer la lecture
    }

    if (!this.looping && this.index >= this.events.length && this.pending.length === 0 && now >= this.clockAt(this.endMs)) {
      const onEnd = this.options.onEnd;
      this.release(this.clockAt(this.endMs));
      this.active = false;
      onEnd?.();
    }
  }

  private halt(): void {
    this.active = false;
    this.pending = [];
    this.sounding.clear();
  }

  private songAt(clock: number): number {
    return this.anchorSong + (clock - this.anchorClock) * this.speed;
  }

  private clockAt(songMs: number): number {
    return this.anchorClock + (songMs - this.anchorSong) / this.speed;
  }

  /** Les événements au-delà de la fin de boucle (les repères exactement à la fin restent dans le tour). */
  private beyondLoopEnd(event: SongEvent): boolean {
    return event.ms > this.limitMs || (event.ms === this.limitMs && event.kind !== "marker");
  }

  private dispatch(event: SongEvent): void {
    const at = this.clockAt(event.ms);
    if (event.kind === "midi") {
      this.sink.send(event.bytes, at);
      this.track(event.bytes);
    } else if (event.kind === "marker") {
      this.pending.push({ at, marker: event });
    }
  }

  private track(bytes: Uint8Array): void {
    const type = bytes[0] & 0xf0;
    const id = ((bytes[0] & 0x0f) << 7) | bytes[1];
    if (type === 0x90 && bytes[2] > 0) this.sounding.add(id);
    else if (type === 0x80 || type === 0x90) this.sounding.delete(id);
  }

  /** Coupe les notes encore tenues à l'instant `at`. */
  private release(at: number): void {
    for (const id of this.sounding) this.sink.send(Uint8Array.of(0x80 | (id >> 7), id & 0x7f, 0), at);
    this.sounding.clear();
  }

  /** Fin de boucle : retour au début de boucle, sans trou ni recouvrement sur l'horloge. */
  private wrap(): void {
    const at = this.clockAt(this.limitMs);
    this.release(at);
    this.anchorClock = at;
    this.anchorSong = this.loopStartMs;
    let index = 0;
    while (index < this.events.length && this.events[index].ms < this.loopStartMs) index++;
    this.index = index;
  }
}

function isNote(bytes: Uint8Array): boolean {
  const type = bytes[0] & 0xf0;
  return type === 0x80 || type === 0x90;
}
