/**
 * `SOUNDS.BD` : conteneur BD (voir `bd.ts`) dont chaque ressource est un fichier RIFF WAVE complet
 * (PCM 8 bits 11025 Hz, mono sauf un son stéréo). Les identifiants (100004, 200104…) sont ceux que le jeu demande ;
 * leur lien avec les événements reste à établir (docs/swiv3d/re-index.md).
 */
import { parseRiffWave, type RiffWave } from "../../../data/riff-wave";
import { parseBd } from "./bd";

export interface SoundEntry {
  id: number;
  offset: number;
  wave: RiffWave;
}

export interface SoundBank {
  /** Dans l'ordre du fichier. */
  sounds: SoundEntry[];
  get(id: number): SoundEntry | undefined;
}

export function parseSoundBank(bytes: Uint8Array): SoundBank {
  const bd = parseBd(bytes, "SOUNDS.BD");
  const sounds = bd.entries.map((e) => ({ id: e.id, offset: e.offset, wave: parseRiffWave(bd.get(e.id)) }));
  const byId = new Map(sounds.map((s) => [s.id, s]));
  return { sounds, get: (id) => byId.get(id) };
}
