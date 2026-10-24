/**
 * Son `\0SND` Mohawk de type `MIDI` : `MHWK`, taille u32, `MIDI`, puis `MThd` (en-tête SMF standard, 14 octets),
 * `Prg#` (table de programmes propre à Mohawk : taille u32 + données, ignorée ici) et un unique `MTrk`
 * (format 0, une piste). Les ressources sont souvent complétées (2048 / 4096 octets) après la piste.
 *
 * `extractMidi` renvoie un fichier MIDI standard (`MThd` + `MTrk`), sans le bloc `Prg#` ni le bourrage.
 */
import { BinaryReader } from "../../../data/reader";

/** `true` si la ressource `\0SND` contient un MIDI. */
export function isMidi(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "MHWK" && String.fromCharCode(...bytes.subarray(8, 12)) === "MIDI";
}

export interface MidiResource {
  /** Fichier MIDI standard (SMF). */
  smf: Uint8Array;
  /** Contenu brut du bloc `Prg#` (voir formats.md). */
  programs: Uint8Array;
}

export function parseMidi(bytes: Uint8Array): MidiResource {
  const r = new BinaryReader(bytes);
  if (r.tag() !== "MHWK") throw new Error("MIDI : signature MHWK absente");
  r.u32be();
  if (r.tag() !== "MIDI") throw new Error("MIDI : signature MIDI absente");

  let header: Uint8Array | undefined;
  let track: Uint8Array | undefined;
  let programs: Uint8Array = new Uint8Array(0);
  while (!track && r.offset + 8 <= r.length) {
    const start = r.offset;
    const tag = r.tag();
    const size = r.u32be(); // big-endian pour MThd / MTrk (SMF) comme pour Prg#
    if (start + 8 + size > r.length) throw new Error(`MIDI : bloc ${tag} tronqué`);
    const chunk = bytes.subarray(start, start + 8 + size);
    if (tag === "MThd") header = chunk;
    else if (tag === "MTrk") track = chunk;
    else if (tag === "Prg#") programs = chunk.subarray(8);
    else throw new Error(`MIDI : bloc ${JSON.stringify(tag)} inattendu`);
    r.offset = start + 8 + size;
  }
  if (!header || !track) throw new Error("MIDI : MThd ou MTrk absent");
  const smf = new Uint8Array(header.length + track.length);
  smf.set(header, 0);
  smf.set(track, header.length);
  return { smf, programs };
}

/** Fichier MIDI standard contenu dans la ressource `\0SND`. */
export function extractMidi(bytes: Uint8Array): Uint8Array {
  return parseMidi(bytes).smf;
}
