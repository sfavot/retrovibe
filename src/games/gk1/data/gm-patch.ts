/**
 * Patch 4 : table de conversion MT-32 → General MIDI de `GENMIDI.DRV` (`docs/gk1/formats.md` § 10).
 *
 * Référence : `engines/sci/sound/drivers/midi.cpp` de ScummVM (`MidiPlayer_Midi::readMt32GmPatch`), GPL v3 ou ultérieure,
 * lu puis réécrit. Structure seulement : l'application des tables est l'affaire de `audio/gm-driver.ts`.
 *
 * ```
 * 128 programmes | 128 transpositions (i8) | 128 volumes (i8) | 128 percussions | 1 volume de la batterie (i8)
 * 128 indices de courbe de vélocité | 4 × 128 courbes de vélocité | u16 n | n octets MIDI d'initialisation
 * ```
 */
import { BinaryReader } from "../../../data/reader";

const TABLE_SIZE = 128;
const VELOCITY_CURVES = 4;

/** Programme sans équivalent General MIDI (canal muet). */
export const GM_PATCH_UNMAPPED = 0xff;

export interface GmPatch {
  /** Programme MT-32 → programme General MIDI (`GM_PATCH_UNMAPPED` = aucun). */
  readonly programs: Uint8Array;
  /** Transposition par programme, en demi-tons. */
  readonly keyShift: Int8Array;
  /** Correction de volume par programme. */
  readonly volumeAdjust: Int8Array;
  /** Note de percussion MT-32 → note General MIDI. */
  readonly percussion: Uint8Array;
  /** Correction de volume du canal de batterie. */
  readonly rhythmVolumeAdjust: number;
  /** Courbe de vélocité (0 à 3) par programme. */
  readonly velocityCurve: Uint8Array;
  /** Quatre courbes de 128 vélocités. */
  readonly velocityCurves: readonly Uint8Array[];
  /** Octets MIDI à envoyer au périphérique à l'initialisation. */
  readonly initData: Uint8Array;
}

export function readGmPatch(data: Uint8Array): GmPatch {
  const fixed = TABLE_SIZE * 4 + 1 + TABLE_SIZE + VELOCITY_CURVES * TABLE_SIZE + 2;
  if (data.length < fixed) throw new Error("GK1 : patch General MIDI tronqué");
  const r = new BinaryReader(data);
  const programs = r.bytesView(TABLE_SIZE).slice();
  const keyShift = new Int8Array(r.bytesView(TABLE_SIZE).slice().buffer);
  const volumeAdjust = new Int8Array(r.bytesView(TABLE_SIZE).slice().buffer);
  const percussion = r.bytesView(TABLE_SIZE).slice();
  const rhythmVolumeAdjust = (r.u8() << 24) >> 24;
  const velocityCurve = r.bytesView(TABLE_SIZE).slice();
  const velocityCurves: Uint8Array[] = [];
  for (let i = 0; i < VELOCITY_CURVES; i++) velocityCurves.push(r.bytesView(TABLE_SIZE).slice());
  const initSize = r.u16();
  if (r.offset + initSize !== data.length) throw new Error("GK1 : patch General MIDI de taille incohérente");
  return { programs, keyShift, volumeAdjust, percussion, rhythmVolumeAdjust, velocityCurve, velocityCurves, initData: r.bytesView(initSize).slice() };
}
