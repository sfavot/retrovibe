/**
 * Pilote AdLib de *Lure of the Temptress* : le pilote multi-sources (`adlib-multisource.ts`) spécialisé comme `MidiDriver_ADLIB_Lure`.
 *
 * Source : `MidiDriver_ADLIB_Lure` et `OPL_FREQUENCY_LOOKUP` (`engines/lure/sound.cpp`, `sound.h`, ScummVM, GPL v3 ou ultérieure, lus en
 * entier) ; l'original DOS (`SOUND.COM`, jamais exécuté ici) n'est pas consulté.
 *
 * Ce que le jeu change au pilote :
 * - **instruments** : dans le fichier MIDI lui-même, par des méta-événements « spécifiques au séquenceur » (`FF 7F`) `00 00 3F 00`, type,
 *   argument. Type 1 : canal puis 28 octets d'une définition BNK sans ses deux premiers champs (instrument du canal **de cette source**) ;
 *   type 2 : mode rythme (jamais activé dans les données, ignoré comme dans ScummVM) ; type 3 : sensibilité de l'inflexion de hauteur en
 *   demi-tons (réglage global, jamais réinitialisé). Un type inconnu est ignoré (ScummVM avertit) ;
 * - **allocation statique** : chaque canal MIDI de chaque source garde une voix fixe (les canaux sont monophoniques), première arrivée
 *   première servie ; plus de voix libre, la note n'est pas jouée ; les voix reviennent à la fin de la source ;
 * - **notes abaissées d'une octave** (les notes de la première octave valent 0), table de fréquences propre (`OPL_FREQUENCY_LOOKUP`, 12 demi-tons
 *   en 16 pas) ; inflexion en 1/16 de demi-ton, doublée par demi-ton de sensibilité au-delà de 1 ;
 * - **pression de canal** (`Dn`) : fixe la vélocité de la note en cours du canal et réécrit les niveaux ;
 * - **niveau d'un opérateur** : mis à l'échelle de la vélocité (`(63 - niveau) * vélocité`, arrondi, sur 7 bits), sans volume de canal ni
 *   expression ; profondeurs de modulation et de vibrato faibles.
 *
 * Écart : le volume de l'utilisateur de ScummVM (réglage « musique » / « bruitages », 192 sur 256 par défaut) n'est pas appliqué ici
 * (256, neutre) : le volume de la page passe par `WebOpl.setVolume`. `setUserVolumes` le rétablit si besoin.
 */
import type { OplSink } from "../../../audio/opl-stream";
import {
  AdlibMultisourceDriver,
  BNK_INSTRUMENT_SIZE,
  MAXIMUM_SOURCES,
  META_SEQUENCER,
  MIDI_CHANNEL_COUNT,
  OPL2_NUM_CHANNELS,
  bnkToInstrument,
  emptyInstrument,
  type InstrumentInfo,
  type OplInstrument,
} from "./adlib-multisource";

/** Taille des données d'un `FF 7F` de type 1 : signature, type, canal, 28 octets de BNK. */
const INSTRUMENT_META_LENGTH = 0x22;
const META_SIGNATURE = [0x00, 0x00, 0x3f, 0x00] as const;
const META_INSTRUMENT = 0x01;
const META_RHYTHM = 0x02;
const META_PITCH_BEND_SENSITIVITY = 0x03;

/**
 * F-num de chaque pas de 1/16 de demi-ton d'une octave. Les valeurs supérieures à `0xF000` sont à une octave plus haut que les autres ;
 * seuls les 10 bits bas comptent (`OPL_FREQUENCY_LOOKUP`).
 */
export const OPL_FREQUENCY_LOOKUP: readonly number[] = [
  0x02b2, 0x02b4, 0x02b7, 0x02b9, 0x02bc, 0x02be, 0x02c1, 0x02c3, 0x02c6, 0x02c9, 0x02cb, 0x02ce, 0x02d0, 0x02d3, 0x02d6, 0x02d8,
  0x02db, 0x02dd, 0x02e0, 0x02e3, 0x02e5, 0x02e8, 0x02eb, 0x02ed, 0x02f0, 0x02f3, 0x02f6, 0x02f8, 0x02fb, 0x02fe, 0x0301, 0x0303,
  0x0306, 0x0309, 0x030c, 0x030f, 0x0311, 0x0314, 0x0317, 0x031a, 0x031d, 0x0320, 0x0323, 0x0326, 0x0329, 0x032b, 0x032e, 0x0331,
  0x0334, 0x0337, 0x033a, 0x033d, 0x0340, 0x0343, 0x0346, 0x0349, 0x034c, 0x034f, 0x0352, 0x0356, 0x0359, 0x035c, 0x035f, 0x0362,
  0x0365, 0x0368, 0x036b, 0x036f, 0x0372, 0x0375, 0x0378, 0x037b, 0x037f, 0x0382, 0x0385, 0x0388, 0x038c, 0x038f, 0x0392, 0x0395,
  0x0399, 0x039c, 0x039f, 0x03a3, 0x03a6, 0x03a9, 0x03ad, 0x03b0, 0x03b4, 0x03b7, 0x03bb, 0x03be, 0x03c1, 0x03c5, 0x03c8, 0x03cc,
  0x03cf, 0x03d3, 0x03d7, 0x03da, 0x03de, 0x03e1, 0x03e5, 0x03e8, 0x03ec, 0x03f0, 0x03f3, 0x03f7, 0x03fb, 0x03fe, 0xfe01, 0xfe03,
  0xfe05, 0xfe07, 0xfe08, 0xfe0a, 0xfe0c, 0xfe0e, 0xfe10, 0xfe12, 0xfe14, 0xfe16, 0xfe18, 0xfe1a, 0xfe1c, 0xfe1e, 0xfe20, 0xfe21,
  0xfe23, 0xfe25, 0xfe27, 0xfe29, 0xfe2b, 0xfe2d, 0xfe2f, 0xfe31, 0xfe34, 0xfe36, 0xfe38, 0xfe3a, 0xfe3c, 0xfe3e, 0xfe40, 0xfe42,
  0xfe44, 0xfe46, 0xfe48, 0xfe4a, 0xfe4c, 0xfe4f, 0xfe51, 0xfe53, 0xfe55, 0xfe57, 0xfe59, 0xfe5c, 0xfe5e, 0xfe60, 0xfe62, 0xfe64,
  0xfe67, 0xfe69, 0xfe6b, 0xfe6d, 0xfe6f, 0xfe72, 0xfe74, 0xfe76, 0xfe79, 0xfe7b, 0xfe7d, 0xfe7f, 0xfe82, 0xfe84, 0xfe86, 0xfe89,
  0xfe8b, 0xfe8d, 0xfe90, 0xfe92, 0xfe95, 0xfe97, 0xfe99, 0xfe9c, 0xfe9e, 0xfea1, 0xfea3, 0xfea5, 0xfea8, 0xfeaa, 0xfead, 0xfeaf,
];

export class LureAdlibDriver extends AdlibMultisourceDriver {
  /** Instruments définis par les `FF 7F` : un par canal MIDI de chaque source. Modifiés en place (les notes en cours suivent). */
  private readonly instrumentDefs: OplInstrument[][] = Array.from({ length: MAXIMUM_SOURCES }, () => Array.from({ length: MIDI_CHANNEL_COUNT }, emptyInstrument));
  /** Sensibilité de l'inflexion de hauteur en demi-tons : réglage global, 1 au départ. */
  private pitchBendSensitivity = 1;

  /** Les avertissements de ScummVM (`warning`), un `FF 7F` de type inconnu. */
  constructor(
    sink: OplSink,
    private readonly warn: (message: string) => void = () => {},
  ) {
    super(sink, { allocationMode: "static", modulationDepth: 0, vibratoDepth: 0 });
    this.open();
  }

  /** Pression de canal : devient la vélocité de la note en cours du canal, dont le niveau est réécrit (`channelAftertouch`). */
  protected override channelAftertouch(channel: number, pressure: number, source: number): void {
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const active = this.activeNotes[oplChannel]!;
      if (active.noteActive && active.source === source && active.channel === channel) {
        active.velocity = pressure;
        this.recalculateVolumes(channel, source);
        break;
      }
    }
  }

  override metaEvent(source: number, type: number, data: Uint8Array): void {
    if (type === META_SEQUENCER && data.length >= 6 && META_SIGNATURE.every((b, i) => data[i] === b)) {
      switch (data[4]) {
        case META_INSTRUMENT: {
          const channel = data[5]!;
          if (data.length !== INSTRUMENT_META_LENGTH || source < 0 || channel >= MIDI_CHANNEL_COUNT) throw new Error(`FF 7F : instrument invalide (source ${source}, canal ${channel}, ${data.length} octets)`);
          // Une définition BNK sans ses deux premiers champs (type et voix rythmique), remis à zéro.
          const bnk = new Uint8Array(BNK_INSTRUMENT_SIZE);
          bnk.set(data.subarray(6, INSTRUMENT_META_LENGTH), 2);
          bnkToInstrument(bnk, this.instrumentDefs[source]![channel]!);
          break;
        }
        case META_RHYTHM:
          // Mode rythme : jamais activé dans les données, non porté (comme ScummVM).
          break;
        case META_PITCH_BEND_SENSITIVITY:
          this.pitchBendSensitivity = data[5]!;
          break;
        default:
          this.warn(`FF 7F : type ${data[4]!.toString(16)} inconnu`);
          break;
      }
      return;
    }
    super.metaEvent(source, type, data);
  }

  protected override determineInstrument(channel: number, source: number, note: number): InstrumentInfo {
    // Pas de canal rythmique ; l'instrument est celui du dernier `FF 7F` de la source pour ce canal.
    return { oplNote: note, instrument: this.instrumentDefs[source]![channel]!, instrumentId: (source << 4) | channel };
  }

  protected override calculateFrequency(channel: number, source: number, note: number): number {
    // Note abaissée d'une octave ; celles de la première octave valent 0.
    note -= note >= 0xc ? 0xc : note;
    // Inflexion : demi-tons dans les bits 8 et plus, fraction de demi-ton sur 8 bits dont les 4 bits hauts comptent.
    const pitchBend = this.calculatePitchBend(channel, source, 0);
    // On écarte les 4 bits bas (+8 pour arrondir), on ajoute la note et on borne à 0..0x5FF : les notes 60 à 7F sont ramenées à 5F.
    const noteValue = Math.min(0x5ff, Math.max(0, (note << 4) + ((pitchBend + 8) >> 4)));
    const octaveNote = (noteValue >> 4) % 12;
    let block = Math.floor((noteValue >> 4) / 12);
    let frequency = OPL_FREQUENCY_LOOKUP[(octaveNote << 4) | (noteValue & 0xf)]!;
    if (frequency < 0xf000) {
      // Les valeurs de la table dont les 6 bits hauts sont nuls sont à baisser d'une octave.
      if (block > 0) block--;
      else frequency >>= 1;
    }
    return (frequency & 0x3ff) | (block << 10);
  }

  protected override calculatePitchBend(channel: number, source: number, _oplFrequency: number): number {
    // Valeur MIDI de 14 bits signée (-0x2000 à 0x2000), ramenée à 9 bits, doublée par demi-ton de sensibilité au-delà de 1 (entier de 16 bits).
    let bend = this.controlData[source]![channel]!.pitchBend - 0x2000;
    bend >>= 5;
    bend <<= this.pitchBendSensitivity - 1;
    return (bend << 16) >> 16;
  }

  protected override calculateUnscaledVolume(_channel: number, _source: number, velocity: number, instrument: OplInstrument, operatorNum: number): number {
    const operator = operatorNum === 0 ? instrument.operator0 : instrument.operator1;
    const operatorVolume = operator.level & 0x3f;
    // Niveau inversé multiplié par la vélocité, +0x40 pour arrondir, divisé par 0x7F, puis inversé de nouveau.
    const inverted = ((0x3f - operatorVolume) * velocity + 0x40) >> 7;
    return 0x3f - inverted;
  }
}
