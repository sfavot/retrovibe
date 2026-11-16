/**
 * Pilote General MIDI de SCI : ce que faisait `GENMIDI.DRV` avec le patch 4 (`data/gm-patch.ts`, `docs/gk1/formats.md` § 10),
 * vers un `MidiSink` (le synthétiseur du site, `src/audio/web-gm-synth.ts`).
 *
 * Référence : `engines/sci/sound/drivers/midi.cpp` de ScummVM (`MidiPlayer_Midi` : `send`, `noteOn`, `controlChange`,
 * `setPatch`, `setVolume`, `playSwitch`, `readMt32GmPatch`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * - **Programme** : `programs[p]` ; 0xFF = aucun équivalent (le canal se tait) ; 128 et plus = une percussion, jouée sur le
 *   canal de batterie par la note `programs[p] − 128`. Le programme porte aussi une transposition, une correction de volume
 *   et une courbe de vélocité.
 * - **Note** : transposée (ramenée dans 0…127 par octaves), vélocité passée par la courbe du programme ; sur le canal de
 *   batterie (9), la note passe par la table des percussions (0xFF : note écartée).
 * - **Volume (contrôleur 7)** : valeur + correction du programme, bornée à 1…127, puis × volume maître / 15 (jamais ramenée
 *   à 0 par l'arrondi). **Volume maître** : 0 à 15 (`DoSound MasterVolume`), 15 au départ.
 * - **Initialisation** : les octets MIDI du patch partent tels quels, sans passer par les tables.
 * - Pression (0xA0, 0xD0) ignorée ; molette (0xE0) transmise telle quelle ; contrôleur 0x4B (voix, propre à SCI) retenu.
 * - Canaux mélodiques réaffectables : 1 à 8 ; batterie : 9 ; 32 voix annoncées (`DoSound GetPolyphony`).
 *
 * **Sur ce CD, le patch 4 est neutre** (vérifié, `test/gk1/audio/gm-driver.test.ts`) : programmes et percussions identiques,
 * aucune transposition ni correction, courbe de vélocité 0 (identité) partout. Seule son initialisation agit : remise à zéro
 * GS, puis étendue de la molette à 12 demi-tons sur les 16 canaux. Les pistes du périphérique 7 sont donc écrites en
 * General MIDI ; les tables restent appliquées, pour un autre patch.
 *
 * Écarts volontaires :
 * - le synthétiseur peut manquer (tests, navigateur sans audio) ou arriver plus tard (soundfont en cours de chargement) :
 *   l'état des canaux est tenu sans lui, et `attach` lui renvoie l'initialisation puis l'état courant ;
 * - un note-off part en 0x80 (ScummVM envoie un note-on de vélocité nulle) : `WebGmSynth.reset` s'appuie sur la distinction ;
 * - le programme du canal de batterie part tel quel (ScummVM le ramène à un kit General MIDI standard par une table) ;
 * - pas de réverbération (`GENMIDI.DRV` n'en a pas), pas de message de panoramique factice après un changement de programme
 *   (contournement d'interfaces USB dans ScummVM), pas d'attente après un message système.
 */
import type { MidiSink } from "../../../audio/midi-sink";
import { SoundDevice } from "../data/ids";
import { GM_PATCH_UNMAPPED, type GmPatch } from "../data/gm-patch";
import { declareState } from "../engine/save-codec";

export const MIDI_CHANNELS = 16;
export const RHYTHM_CHANNEL = 9;
export const MASTER_VOLUME_MAX = 15;
/** Premier programme qui désigne une percussion du canal de batterie. */
const PROGRAM_IS_PERCUSSION = 128;
const VOLUME_MAX = 0x7f;
const OCTAVE = 12;

const Controller = { Volume: 0x07, Pan: 0x0a, Hold: 0x40, SciVoices: 0x4b, AllNotesOff: 0x7b } as const;

/** Ce que le gestionnaire de sons demande à un pilote. */
export interface SoundDriver {
  /** Périphérique dont les pistes sont jouées (`SoundDevice`). */
  readonly device: number;
  /** Canaux du synthétiseur donnés aux canaux réaffectables d'un morceau. */
  readonly firstChannel: number;
  readonly lastChannel: number;
  readonly polyphony: number;
  masterVolume: number;
  /** Message de canal : `status` avec le canal du synthétiseur, à jouer à `atMs` (horloge du synthétiseur) ou tout de suite. */
  send(status: number, a: number, b: number, atMs?: number): void;
  /** Coupe tout et revient à l'état de départ. */
  reset(): void;
}

interface DeviceChannel {
  /** Programme demandé par le morceau, ou `GM_PATCH_UNMAPPED` avant le premier. */
  patch: number;
  /** Programme General MIDI envoyé (`GM_PATCH_UNMAPPED` : aucun). */
  mappedPatch: number;
  velocityCurve: number;
  keyShift: number;
  volumeAdjust: number;
  /** Dernier volume demandé (contrôleur 7), avant corrections. */
  volume: number;
  pan: number;
  hold: number;
}

function newChannel(): DeviceChannel {
  return { patch: GM_PATCH_UNMAPPED, mappedPatch: GM_PATCH_UNMAPPED, velocityCurve: 0, keyShift: 0, volumeAdjust: 0, volume: VOLUME_MAX, pan: 0x40, hold: 0 };
}

/** Découpe les octets d'initialisation du patch en messages (statut courant ; un message système va de `F0` à `F7`). */
export function splitInitData(data: Uint8Array): Uint8Array[] {
  const messages: Uint8Array[] = [];
  let pos = 0;
  let status = 0;
  while (pos < data.length) {
    if (data[pos] === 0xf0) {
      const end = data.indexOf(0xf7, pos);
      if (end < 0) throw new Error("GK1 : message système d'initialisation sans fin");
      messages.push(data.slice(pos, end + 1));
      pos = end + 1;
      continue;
    }
    if (data[pos] & 0x80) status = data[pos++];
    const kind = status & 0xf0;
    if (kind < 0x80 || kind === 0xf0) throw new Error(`GK1 : statut 0x${status.toString(16)} inattendu dans l'initialisation du patch`);
    const length = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
    if (pos + length > data.length) throw new Error("GK1 : initialisation du patch tronquée");
    messages.push(Uint8Array.of(status, ...data.subarray(pos, pos + length)));
    pos += length;
  }
  return messages;
}

export class GmDriver implements SoundDriver {
  readonly device = SoundDevice.GeneralMidi;
  readonly firstChannel = 1;
  readonly lastChannel = 8;
  readonly polyphony = 32;

  private readonly channels: DeviceChannel[] = [];
  private readonly initMessages: readonly Uint8Array[];
  private sink: MidiSink | undefined;
  private master = MASTER_VOLUME_MAX;
  private enabled = true;

  /** Sans patch, les tables sont neutres. */
  constructor(
    private readonly patch?: GmPatch,
    sink?: MidiSink,
  ) {
    this.initMessages = patch ? splitInitData(patch.initData) : [];
    this.resetChannels();
    if (sink) this.attach(sink);
  }

  private resetChannels(): void {
    for (let number = 0; number < MIDI_CHANNELS; number++) this.channels[number] = newChannel();
    this.channels[RHYTHM_CHANNEL].volumeAdjust = this.patch?.rhythmVolumeAdjust ?? 0;
  }

  /** Branche (ou débranche) le synthétiseur : il reçoit l'initialisation du patch, puis l'état courant des canaux. */
  attach(sink: MidiSink | undefined, atMs?: number): void {
    this.sink = sink;
    if (!sink) return;
    for (const message of this.initMessages) sink.send(message, atMs);
    this.channels.forEach((channel, number) => {
      if (channel.mappedPatch < PROGRAM_IS_PERCUSSION) this.out(0xc0 | number, channel.mappedPatch, undefined, atMs);
      else if (number === RHYTHM_CHANNEL && channel.patch !== GM_PATCH_UNMAPPED) this.out(0xc0 | number, channel.patch, undefined, atMs);
      if (this.enabled) this.sendVolume(number, atMs);
      else this.out(0xb0 | number, Controller.Volume, 0, atMs);
      this.out(0xb0 | number, Controller.Pan, channel.pan, atMs);
      if (channel.hold) this.out(0xb0 | number, Controller.Hold, channel.hold, atMs);
    });
  }

  get masterVolume(): number {
    return this.master;
  }

  /** Volume maître, 0 à 15 : tous les volumes de canal sont renvoyés. */
  set masterVolume(value: number) {
    this.master = Math.max(0, Math.min(MASTER_VOLUME_MAX, value | 0));
    if (this.enabled) for (let number = 0; number < MIDI_CHANNELS; number++) this.sendVolume(number);
  }

  /** Le son est-il ouvert (`DoSound Mute`) ? Fermé, les canaux passent au volume 0 sans perdre leur réglage. */
  get soundOn(): boolean {
    return this.enabled;
  }

  set soundOn(on: boolean) {
    this.enabled = on;
    for (let number = 0; number < MIDI_CHANNELS; number++) {
      if (on) this.sendVolume(number);
      else this.out(0xb0 | number, Controller.Volume, 0);
    }
  }

  send(status: number, a: number, b: number, atMs?: number): void {
    const number = status & 0x0f;
    switch (status & 0xf0) {
      case 0x80:
        this.note(number, a & 0x7f, 0, atMs);
        break;
      case 0x90:
        this.note(number, a & 0x7f, b & 0x7f, atMs);
        break;
      case 0xb0:
        this.controlChange(number, a & 0x7f, b & 0x7f, atMs);
        break;
      case 0xc0:
        this.setPatch(number, a & 0x7f, atMs);
        break;
      case 0xe0:
        this.out(status, a & 0x7f, b & 0x7f, atMs);
        break;
      default:
        // Pression de touche ou de canal : ignorée, comme le pilote d'origine.
        break;
    }
  }

  /**
   * Après la reprise d'une sauvegarde : le synthétiseur repart de zéro puis reçoit l'état des canaux repris (programmes,
   * volumes, panoramiques, pédales). Les notes qui sonnaient à la sauvegarde ne sont pas rejouées.
   */
  resync(): void {
    this.sink?.reset();
    this.attach(this.sink);
  }

  reset(): void {
    this.sink?.reset();
    this.resetChannels();
    for (const message of this.initMessages) this.sink?.send(message);
  }

  private out(status: number, a: number, b: number | undefined, atMs?: number): void {
    this.sink?.send(b === undefined ? Uint8Array.of(status, a) : Uint8Array.of(status, a, b), atMs);
  }

  private note(number: number, key: number, velocity: number, atMs?: number): void {
    const channel = this.channels[number];
    let target = number;
    let curve = channel.velocityCurve;
    if (number === RHYTHM_CHANNEL) {
      const mapped = this.patch ? this.patch.percussion[key] : key;
      if (mapped === GM_PATCH_UNMAPPED) return;
      key = mapped;
      curve = -1;
    } else if (channel.mappedPatch >= PROGRAM_IS_PERCUSSION) {
      if (channel.mappedPatch === GM_PATCH_UNMAPPED) return;
      // Programme traduit en percussion : une seule note, sur le canal de batterie.
      target = RHYTHM_CHANNEL;
      key = channel.mappedPatch - PROGRAM_IS_PERCUSSION;
      curve = -1;
    } else {
      key += channel.keyShift;
      while (key < 0) key += OCTAVE;
      while (key > 0x7f) key -= OCTAVE;
    }
    if (velocity === 0) {
      this.out(0x80 | target, key, 0, atMs);
      return;
    }
    if (curve >= 0 && this.patch) velocity = this.patch.velocityCurves[curve][velocity];
    this.out(0x90 | target, key, velocity, atMs);
  }

  private controlChange(number: number, control: number, value: number, atMs?: number): void {
    const channel = this.channels[number];
    switch (control) {
      case Controller.Volume:
        channel.volume = value;
        if (this.enabled) this.sendVolume(number, atMs);
        return;
      case Controller.Pan:
        channel.pan = value;
        break;
      case Controller.Hold:
        channel.hold = value;
        break;
      case Controller.SciVoices:
        return;
      default:
        break;
    }
    this.out(0xb0 | number, control, value, atMs);
  }

  private sendVolume(number: number, atMs?: number): void {
    const channel = this.channels[number];
    let value = channel.volume + channel.volumeAdjust;
    if (value > VOLUME_MAX) value = VOLUME_MAX;
    if (value < 0) value = 1;
    value *= this.master;
    if (value !== 0) value = Math.max(1, Math.floor(value / MASTER_VOLUME_MAX));
    this.out(0xb0 | number, Controller.Volume, value, atMs);
  }

  private setPatch(number: number, patch: number, atMs?: number): void {
    const channel = this.channels[number];
    if (channel.patch === patch) return;
    channel.patch = patch;
    if (number === RHYTHM_CHANNEL) {
      this.out(0xc0 | number, patch, undefined, atMs);
      return;
    }
    const table = this.patch;
    const wasSilent = channel.mappedPatch === GM_PATCH_UNMAPPED;
    channel.velocityCurve = table ? table.velocityCurve[patch] : 0;
    channel.mappedPatch = table ? table.programs[patch] : patch;
    if (channel.mappedPatch === GM_PATCH_UNMAPPED) {
      this.silence(number, atMs);
      return;
    }
    if (channel.mappedPatch >= PROGRAM_IS_PERCUSSION) return;
    let resendVolume = wasSilent;
    const keyShift = table ? table.keyShift[patch] : 0;
    if (channel.keyShift !== keyShift) {
      // Les notes tenues ne retrouveraient pas leur note-off sous l'ancienne transposition.
      channel.keyShift = keyShift;
      this.silence(number, atMs);
      resendVolume = true;
    }
    const volumeAdjust = table ? table.volumeAdjust[patch] : 0;
    if (resendVolume || channel.volumeAdjust !== volumeAdjust) {
      channel.volumeAdjust = volumeAdjust;
      if (this.enabled) this.sendVolume(number, atMs);
    }
    this.out(0xc0 | number, channel.mappedPatch, undefined, atMs);
  }

  private silence(number: number, atMs?: number): void {
    this.out(0xb0 | number, Controller.AllNotesOff, 0, atMs);
    this.out(0xb0 | number, Controller.Hold, 0, atMs);
  }
}

// État sauvegardé (`engine/save.ts`) : les canaux et le volume général. Le son coupé (`enabled`) est un réglage du site.
declareState(GmDriver, { name: "GmDriver", skip: ["patch", "initMessages", "sink", "enabled"] });
