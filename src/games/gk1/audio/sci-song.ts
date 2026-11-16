/**
 * Morceau SCI : la piste d'un périphérique d'une ressource sound (`data/sound.ts`), mise à plat en une seule suite
 * d'évènements datés en ticks (1/60 s), tous canaux confondus (`docs/gk1/formats.md` § 10).
 *
 * Références : `engines/sci/sound/midiparser_sci.cpp` de ScummVM (`midiMixChannels`, `midiGetNextChannel`, `parseNextEvent`,
 * `processEvent`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * Flux d'un canal : `delta` sur un octet (`F8` = 240 ticks de plus, sans évènement), statut courant (« running status »),
 * `FC` = fin du canal. Les canaux d'une piste se jouent ensemble : ils sont fusionnés par date, et à date égale dans l'ordre
 * de la piste (le canal le plus tôt dans la liste passe en entier d'abord, comme `midiGetNextChannel`).
 *
 * **Canal 15 = canal de contrôle**, jamais envoyé au synthétiseur :
 * - changement de programme 127 : **point de boucle** (le tick courant) ; toute autre valeur : **signal** rendu aux scripts
 *   par la propriété `signal` (ignoré au tick 0) ;
 * - contrôleur 0x60 : **repère cumulatif** (`dataInc` + 1) ; 0x52 : **maintien** (retour au point de boucle tant que la
 *   valeur est celle demandée par `DoSound SetHold`) ; 0x50 : réverbération ; 0x4C : remise à zéro à la pause (sans effet ici).
 * Sur les autres canaux, trois contrôleurs sont propres à SCI et ne partent pas non plus au synthétiseur : 0x4B (nombre de
 * voix du canal), 0x4E (coupure du canal), 0x50 (réverbération).
 *
 * Écarts volontaires :
 * - dates absolues par canal : ScummVM réécrit un flux à deltas et y perd le delta qui précède un `FC` (les canaux suivants
 *   avancent d'autant) ; sans effet sur ce CD, où ce delta est toujours nul (vérifié par `test/gk1/audio/`) ;
 * - la fin du morceau est la date du dernier `FC` ;
 * - les messages système (`F0`…`F7`) et le reste du canal 15 (molette, contrôleurs MIDI ordinaires) sont comptés puis
 *   écartés : ScummVM les envoie à un canal que rien n'écoute.
 */
import { SOUND_CONTROL_CHANNEL, SOUND_END_OF_TRACK } from "../data/ids";
import { CHANNEL_FLAG_MUTED, CHANNEL_FLAG_NO_REMAP, type Sound, type SoundTrack, trackFor } from "../data/sound";

/** Ticks par seconde des flux MIDI de SCI. */
export const SONG_TICKS_PER_SECOND = 60;
/** Octet de delta qui ajoute 240 ticks sans évènement. */
const DELTA_EXTEND = 0xf8;
const DELTA_EXTEND_TICKS = 240;
const STATUS_SYSEX = 0xf0;
const SYSEX_END = 0xf7;

/** Changement de programme du canal 15 qui pose le point de boucle. */
export const SIGNAL_LOOP_POINT = 127;

/** Contrôleurs propres à SCI. */
export const SciController = {
  /** Nombre de voix du canal. */
  Voices: 0x4b,
  /** Canal 15 : remise à zéro à la pause. */
  ResetOnPause: 0x4c,
  /** Coupure du canal (valeur non nulle : muet). */
  Mute: 0x4e,
  Reverb: 0x50,
  /** Canal 15 : maintien. */
  Hold: 0x52,
  /** Canal 15 : repère cumulatif. */
  Cue: 0x60,
} as const;

export const SongEventType = {
  /** Message de canal à jouer : `status` (0x80 à 0xE0), `a`, `b`. */
  Midi: 0,
  /** Signal pour les scripts : `a` = valeur. */
  Signal: 1,
  /** Le point de boucle devient ce tick. */
  LoopPoint: 2,
  /** `dataInc` augmente de 1. */
  Cue: 3,
  /** Retour au point de boucle si `a` est la valeur de maintien demandée. */
  Hold: 4,
  /** `a` = réverbération (127 : celle du pilote). */
  Reverb: 5,
  /** `a` = nombre de voix du canal. */
  Voices: 6,
  /** `a` non nul : le canal se tait. */
  Mute: 7,
} as const;
export type SongEventType = (typeof SongEventType)[keyof typeof SongEventType];

export interface SongEvent {
  /** Date en ticks depuis le début du morceau. */
  readonly tick: number;
  readonly type: SongEventType;
  /** Canal MIDI du morceau, 0 à 15 (avant réaffectation aux canaux du synthétiseur). */
  readonly channel: number;
  /** Quartet haut du statut MIDI (`Midi` seulement, 0 sinon). */
  readonly status: number;
  readonly a: number;
  readonly b: number;
}

/** Canal MIDI utilisé par un morceau (un canal présent deux fois dans la piste n'est décrit qu'une fois). */
export interface SongChannel {
  readonly number: number;
  /** Voix demandées au départ. */
  readonly voices: number;
  /** 0 : indispensable ; sinon, plus le nombre est petit, plus le canal compte. */
  readonly priority: number;
  /** Le canal garde son numéro sur le synthétiseur (batterie). */
  readonly dontRemap: boolean;
  /** Muet au départ. */
  readonly muted: boolean;
}

export interface SciSong {
  /** Périphérique de la piste lue. */
  readonly device: number;
  /** Priorité du son (piste 0xF0), ou `undefined`. */
  readonly priority: number | undefined;
  /** Évènements triés par date. */
  readonly events: readonly SongEvent[];
  /** Fin du morceau, en ticks. */
  readonly endTick: number;
  /** Canaux joués, canal de contrôle exclu, dans l'ordre de la piste. */
  readonly channels: readonly SongChannel[];
  /** Octets écartés : messages système et évènements du canal 15 sans rôle. */
  readonly ignored: number;
}

/** Octets de données d'un message de canal, par quartet haut du statut (0x8 à 0xE). */
function dataLength(status: number): number {
  const kind = status & 0xf0;
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2;
}

interface Pending extends SongEvent {
  /** Rang du canal dans la piste, puis rang dans le canal : ordre à date égale. */
  readonly order: number;
}

/** Évènement du canal de contrôle, ou `undefined` s'il n'a pas de rôle. */
function controlEvent(tick: number, kind: number, a: number, b: number): Omit<SongEvent, "channel"> | undefined {
  const make = (type: SongEventType, value: number) => ({ tick, type, status: 0, a: value, b: 0 });
  if (kind === 0xc0) return a === SIGNAL_LOOP_POINT ? make(SongEventType.LoopPoint, 0) : make(SongEventType.Signal, a);
  if (kind !== 0xb0) return undefined;
  if (a === SciController.Cue) return make(SongEventType.Cue, 1);
  if (a === SciController.Hold) return make(SongEventType.Hold, b);
  if (a === SciController.Reverb) return make(SongEventType.Reverb, b);
  return undefined;
}

/** Évènement d'un canal ordinaire. */
function channelEvent(tick: number, kind: number, a: number, b: number): Omit<SongEvent, "channel"> {
  if (kind === 0xb0) {
    if (a === SciController.Voices) return { tick, type: SongEventType.Voices, status: 0, a: b, b: 0 };
    if (a === SciController.Mute) return { tick, type: SongEventType.Mute, status: 0, a: b, b: 0 };
    if (a === SciController.Reverb) return { tick, type: SongEventType.Reverb, status: 0, a: b, b: 0 };
  }
  // Un note-on de vélocité nulle est un note-off.
  if (kind === 0x90 && b === 0) return { tick, type: SongEventType.Midi, status: 0x80, a, b: 0 };
  return { tick, type: SongEventType.Midi, status: kind, a, b };
}

/** Met à plat une piste. Lève une erreur sur un flux tronqué. */
export function parseTrack(track: SoundTrack, priority?: number): SciSong {
  const pending: Pending[] = [];
  const channels = new Map<number, SongChannel>();
  let endTick = 0;
  let ignored = 0;
  track.channels.forEach((channel, rank) => {
    if (channel.number !== SOUND_CONTROL_CHANNEL && !channels.has(channel.number)) {
      channels.set(channel.number, {
        number: channel.number,
        voices: channel.voices,
        priority: channel.priority,
        dontRemap: (channel.flags & CHANNEL_FLAG_NO_REMAP) !== 0,
        muted: (channel.flags & CHANNEL_FLAG_MUTED) !== 0,
      });
    }
    const data = channel.data;
    const need = (count: number): void => {
      if (pos + count > data.length) throw new Error(`GK1 : flux MIDI du canal ${channel.number} tronqué`);
    };
    let pos = 0;
    let tick = 0;
    let status = 0;
    while (pos < data.length) {
      const delta = data[pos++];
      if (delta === DELTA_EXTEND) {
        tick += DELTA_EXTEND_TICKS;
        continue;
      }
      tick += delta;
      need(1);
      if (data[pos] === SOUND_END_OF_TRACK) break;
      if (data[pos] & 0x80) status = data[pos++];
      if (status === STATUS_SYSEX) {
        const end = data.indexOf(SYSEX_END, pos);
        if (end < 0) throw new Error(`GK1 : message système sans fin sur le canal ${channel.number}`);
        ignored += end + 1 - pos;
        pos = end + 1;
        continue;
      }
      if (status < 0x80 || status >= STATUS_SYSEX) throw new Error(`GK1 : statut MIDI 0x${status.toString(16)} inattendu sur le canal ${channel.number}`);
      const length = dataLength(status);
      need(length);
      const a = data[pos];
      const b = length === 2 ? data[pos + 1] : 0;
      pos += length;
      const target = status & 0x0f;
      const event = target === SOUND_CONTROL_CHANNEL ? controlEvent(tick, status & 0xf0, a, b) : channelEvent(tick, status & 0xf0, a, b);
      if (event) pending.push({ ...event, channel: target, order: rank * 0x100000 + pending.length });
      else ignored += length;
    }
    endTick = Math.max(endTick, tick);
  });
  pending.sort((x, y) => x.tick - y.tick || x.order - y.order);
  const events = pending.map(({ tick, type, channel, status, a, b }) => ({ tick, type, channel, status, a, b }));
  return { device: track.device, priority, events, endTick, channels: [...channels.values()], ignored };
}

/** Morceau d'un son pour un périphérique, ou `undefined` si le son n'a pas de piste pour lui. */
export function parseSong(sound: Sound, device: number): SciSong | undefined {
  const track = trackFor(sound, device);
  return track ? parseTrack(track, sound.priority) : undefined;
}

/** Signaux du morceau, dans l'ordre (points de boucle exclus). */
export function songSignals(song: SciSong): { tick: number; value: number }[] {
  return song.events.filter((e) => e.type === SongEventType.Signal).map((e) => ({ tick: e.tick, value: e.a }));
}

/** Dates des points de boucle, dans l'ordre. */
export function songLoopPoints(song: SciSong): number[] {
  return song.events.filter((e) => e.type === SongEventType.LoopPoint).map((e) => e.tick);
}

/** Rang du premier évènement daté de `tick` ou plus tard. */
export function firstEventAt(song: SciSong, tick: number): number {
  let low = 0;
  let high = song.events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (song.events[middle].tick < tick) low = middle + 1;
    else high = middle;
  }
  return low;
}
