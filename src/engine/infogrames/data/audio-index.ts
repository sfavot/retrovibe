/**
 * Index des sons d'un jeu (`audio.json`, écrit par les scripts d'extraction : `ecrire_index_audio` de
 * `scripts/lib/extract_common.py`).
 *
 * Les VOC (et, pour Astérix, le son des MUX) sont versionnés en MP3 ; l'index garde, pour chacun, le nombre
 * d'échantillons et la fréquence du PCM d'origine : la durée exacte (le moteur attend la fin des sons) et le calage
 * des vidéos en dépendent, et un MP3 décodé ne les redonne pas à l'échantillon près.
 */

export interface AudioEntry {
  /** Nombre d'échantillons du PCM d'origine (8 bits, mono). */
  samples: number;
  /** Fréquence d'origine en Hz. */
  sampleRate: number;
}

/** Durée exacte en secondes. */
export function audioDuration(entry: AudioEntry): number {
  return entry.samples / entry.sampleRate;
}

/** Lit `audio.json` : `{"<chemin du MP3 dans le dossier du jeu>": [échantillons, fréquence]}`. Clés : chemins des MP3. */
export function parseAudioIndex(json: string): Map<string, AudioEntry> {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("audio.json : objet attendu");
  const index = new Map<string, AudioEntry>();
  for (const [path, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isInteger(n) && n > 0)) {
      throw new Error(`audio.json : entrée invalide pour ${path}`);
    }
    index.set(path, { samples: value[0], sampleRate: value[1] });
  }
  return index;
}
