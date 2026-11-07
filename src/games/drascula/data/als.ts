/**
 * Voix et sons `.ALS` : PCM brut 8 bits non signé, mono, 11 025 Hz, avec 32 octets de silence (`0x80`) au
 * début et 32 à la fin que le jeu ne joue pas.
 *
 * Comportement tiré de `playFile` (engines/drascula/sound.cpp, ScummVM), dont le contournement de `3.ALS`
 * (grand silence au début et à la fin de la voix anglaise). Écart : la condition de ScummVM compare la taille
 * *moins 64* à 145 166, alors que ce fichier fait 145 166 octets en tout, donc le contournement ne se
 * déclenche jamais chez ScummVM et le silence est joué. Ici il est coupé, comme le voulait le contournement :
 * le silence initial mesuré est exactement le décalage de départ (73 959 octets).
 */

export const ALS_SAMPLE_RATE = 11025;

/** Silence conservé dans le fichier avant et après les échantillons joués. */
const EDGE_BYTES = 32;

const SILENT_VOICE = { name: "3.als", size: 145166, start: 73959, ignoredAtEnd: 26306 } as const;

/** Échantillons PCM (8 bits non signé) à jouer pour le fichier `name` ; vue sur `bytes`, sans copie. */
export function alsSamples(bytes: Uint8Array, name = ""): Uint8Array {
  if (bytes.length < 2 * EDGE_BYTES) throw new Error("ALS invalide : fichier trop court");
  if (name.toLowerCase() === SILENT_VOICE.name && bytes.length === SILENT_VOICE.size)
    return bytes.subarray(SILENT_VOICE.start, bytes.length - 2 * EDGE_BYTES - SILENT_VOICE.ignoredAtEnd);
  return bytes.subarray(EDGE_BYTES, bytes.length - EDGE_BYTES);
}
