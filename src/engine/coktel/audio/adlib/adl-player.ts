/*
 * Lecteur de musique ADL (Coktel Vision).
 *
 * Port de engines/gob/sound/adlplayer.cpp de ScummVM (https://www.scummvm.org, GPL-3.0-or-later,
 * aussi LGPL-2.1+). Format : octet de mode (0 = mélodique, sinon percussions), nombre de timbres - 1,
 * un octet ignoré, les timbres (28 mots 16 bits LE chacun), puis le morceau : suites de
 * [commande + arguments + délai] dont le délai est compté en ticks de 1 ms.
 */
import { AdLib, MAX_VOICE_COUNT, MAX_VOLUME, MELODY_VOICE_COUNT, OPERATORS_PER_VOICE, PARAM_COUNT } from "./adlib";

/** Nombre de paramètres d'un timbre (2 opérateurs x 14). */
const TIMBRE_SIZE = OPERATORS_PER_VOICE * PARAM_COUNT;
/** Fréquence du séquenceur : un tick par milliseconde. */
const TICKS_PER_SECOND = 1000;

export interface AdlSong {
  /** 0 = voix mélodiques seules, sinon mode percussions. */
  soundMode: number;
  /** Paramètres de départ de chaque timbre. */
  timbres: Uint16Array[];
  /** Commandes du morceau, suivies de quelques octets nuls (lectures au-delà de la fin). */
  song: Uint8Array;
  /** Taille réelle du morceau, sans le remplissage. */
  songSize: number;
}

/**
 * ADLPlayer::load : refuse les fichiers de moins de 60 octets. Un fichier tronqué est accepté comme
 * dans ScummVM (lecture hors fichier = rien à jouer) : les mots manquants valent 0.
 */
export function parseAdl(data: Uint8Array): AdlSong | null {
  if (data.length < 60) return null;
  const soundMode = data[0];
  const timbreCount = data[1] + 1;
  let pos = 3;
  const timbres: Uint16Array[] = [];
  for (let t = 0; t < timbreCount; t++) {
    const params = new Uint16Array(TIMBRE_SIZE);
    for (let i = 0; i < TIMBRE_SIZE; i++, pos += 2) params[i] = (data[pos] ?? 0) | ((data[pos + 1] ?? 0) << 8);
    timbres.push(params);
  }
  const songSize = Math.max(0, data.length - pos);
  const song = new Uint8Array(songSize + 8);
  song.set(data.subarray(Math.min(pos, data.length)));
  return { soundMode, timbres, song, songSize };
}

class Timbre {
  readonly params: Uint16Array;
  constructor(readonly startParams: Uint16Array) {
    this.params = Uint16Array.from(startParams);
  }
}

export class AdlPlayer extends AdLib {
  private soundMode = 0;
  private timbres: Timbre[] = [];
  private song: Uint8Array | null = null;
  private songSize = 0;
  private playPos = 0;
  private index = -1;
  private modifyInstrument = 0xff;
  private readonly currentInstruments = new Uint16Array(MAX_VOICE_COUNT);

  constructor(sampleRate: number) {
    super(sampleRate, TICKS_PER_SECOND);
  }

  /** ADLPlayer::load ; retourne faux si le fichier est refusé. */
  load(data: Uint8Array, index = -1): boolean {
    this.unload();
    const adl = parseAdl(data);
    if (!adl) return false;
    this.soundMode = adl.soundMode;
    this.timbres = adl.timbres.map((p) => new Timbre(p));
    this.song = adl.song;
    this.songSize = adl.songSize;
    this.rewind();
    this.index = index;
    return true;
  }

  unload(): void {
    this.stopPlay();
    this.timbres = [];
    this.song = null;
    this.songSize = 0;
    this.playPos = 0;
  }

  getIndex(): number {
    return this.index;
  }

  protected override pollMusic(first: boolean): number {
    const song = this.song;
    if (this.timbres.length === 0 || !song || this.playPos >= this.songSize) {
      this.end();
      return 0;
    }

    // Le premier délai est ignoré
    if (first) this.playPos += song[this.playPos] & 0x80 ? 2 : 1;

    const cmd = song[this.playPos++];

    // Marqueur de fin
    if (cmd === 0xff) {
      this.end();
      return 0;
    }

    // Instrument à modifier
    if (cmd === 0xfe) this.modifyInstrument = song[this.playPos++];

    if (cmd >= 0xd0) {
      // Modification d'un paramètre de timbre
      if (this.modifyInstrument !== 0xff && this.modifyInstrument < this.timbres.length) {
        const index = song[this.playPos];
        const params = this.timbres[this.modifyInstrument].params;
        if (index < params.length) params[index] = song[this.playPos + 1];
      }
      this.playPos += 2;
      // Si le timbre est chargé quelque part, on le recharge
      for (let i = 0; i < MAX_VOICE_COUNT; i++) {
        if (this.currentInstruments[i] === this.modifyInstrument) this.setInstrument(i, this.modifyInstrument);
      }
    } else {
      // Commande de voix
      const voice = cmd & 0x0f;
      switch (cmd & 0xf0) {
        case 0x00: {
          // Note avec volume
          const note = song[this.playPos++];
          const volume = song[this.playPos++];
          this.setVoiceVolume(voice, volume);
          this.noteOn(voice, note);
          break;
        }
        case 0xa0: // Pitch bend
          this.bendVoicePitch(voice, song[this.playPos++] << 7);
          break;
        case 0xb0: // Volume
          this.setVoiceVolume(voice, song[this.playPos++]);
          break;
        case 0xc0: // Instrument
          this.setInstrument(voice, song[this.playPos++]);
          break;
        case 0x90: // Note
          this.noteOn(voice, song[this.playPos++]);
          break;
        case 0x80: // Fin de note
          this.noteOff(voice);
          break;
        default:
          // Commande inconnue : on arrête sans répéter
          this.end(true);
          return 0;
      }
    }

    let delay = song[this.playPos++];
    if (delay & 0x80) delay = ((delay & 3) << 8) | song[this.playPos++];
    return delay;
  }

  protected override rewind(): void {
    this.playPos = 0;
    this.setPercussionMode(this.soundMode !== 0);

    for (const t of this.timbres) t.params.set(t.startParams);
    this.currentInstruments.fill(0);

    const numVoice = Math.min(this.timbres.length, this.soundMode ? MAX_VOICE_COUNT : MELODY_VOICE_COUNT);
    for (let i = 0; i < numVoice; i++) {
      this.setInstrument(i, this.currentInstruments[i]);
      this.setVoiceVolume(i, MAX_VOLUME);
    }
    this.modifyInstrument = 0xff;
  }

  private setInstrument(voice: number, instrument: number): void {
    if (voice >= MAX_VOICE_COUNT || instrument >= this.timbres.length) return;
    this.currentInstruments[voice] = instrument;
    this.setVoiceTimbre(voice, this.timbres[instrument].params);
  }
}
