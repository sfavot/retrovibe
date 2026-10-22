import { BinaryReader } from "../../../data/reader";

export interface LicTrack {
  name: string;
  /** Premier et dernier secteurs CD (75 par seconde). */
  startSector: number;
  endSector: number;
}

/** LOST.LIC (version 3) : table des pistes audio du CD. */
export function parseLic(file: Uint8Array): LicTrack[] {
  const reader = new BinaryReader(file);
  const version = reader.u16();
  const startChunk = reader.u16();
  const count = reader.u16();
  if (version !== 3) throw new Error(`LIC : version ${version} non gérée`);

  reader.offset = 50;
  for (let i = 0; i < startChunk; i++) {
    const size = reader.u16();
    if (size === 0) break;
    reader.offset += size;
  }

  const tracks: LicTrack[] = [];
  for (let i = 0; i < count; i++) {
    const name = reader.fixedString(12);
    const startSector = reader.u32();
    const endSector = reader.u32();
    reader.offset += 2;
    tracks.push({ name, startSector, endSector });
  }
  return tracks;
}
