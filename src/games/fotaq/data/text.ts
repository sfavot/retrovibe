/**
 * Textes du jeu : décodage, découpage en lignes (`QUEEN2.JAS`, `*.CRD`) et découpage d'une réplique en
 * segments (commandes `*`).
 *
 * Sources (engines/queen/, ScummVM) : `Resource::loadTextFile` (lignes), `Logic::readQueenJas` (répartition de
 * `QUEEN2.JAS`), `Talk::speak` et `Talk::getSpeakCommand` (segments et commandes d'une réplique).
 *
 * **Encodage** (écart avec la première étude, `docs/fotaq/formats.md` § 6) : `QUEEN2.JAS` et les `.CRD` sont en
 * Latin-1 (Windows-1252), mais les textes des `.DOG` et des `.CUT` mélangent **deux** encodages selon la
 * réplique : Latin-1 (`é` = 0xE9) ou page de code DOS 850 (`é` = 0x82, `à` = 0x85, `ç` = 0x87…). Les deux
 * ne se mélangent jamais dans une même chaîne et se distinguent par les octets 0x80 à 0x9F, qui sont des
 * accents en CP850 et des caractères de contrôle en Latin-1 : `decodeGameText` choisit chaîne par chaîne.
 * ScummVM, qui dessine les octets tels quels avec une police qui a les deux jeux d'accents, n'a pas ce souci.
 * Écart volontaire : les lignes se terminent par `\r\n`, `\n` ou `\r` comme dans ScummVM, mais une dernière
 * ligne sans terminateur est conservée (ScummVM la perd ; aucun fichier du jeu n'est dans ce cas).
 */

import { decodeCp850 } from "../../../data/cp850";
import { decodeText } from "../../../data/reader";

export type TextEncoding = "ascii" | "cp850" | "latin1";

/** Encodage d'une chaîne : CP850 si elle contient un octet 0x80 à 0x9F (accents en CP850, contrôles en Latin-1), Latin-1 pour tout autre octet >= 0x80. */
export function gameTextEncoding(bytes: Uint8Array): TextEncoding {
  let high = false;
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) return "cp850";
    if (byte >= 0xa0) high = true;
  }
  return high ? "latin1" : "ascii";
}

/** Décode une chaîne du jeu selon `gameTextEncoding`. */
export function decodeGameText(bytes: Uint8Array): string {
  return gameTextEncoding(bytes) === "cp850" ? decodeCp850(bytes) : decodeText(bytes);
}

/** Lignes d'un fichier texte, terminateurs retirés, décodées en Latin-1 (`QUEEN2.JAS`, `.CRD`). */
export function splitLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte !== 0x0a && byte !== 0x0d) continue;
    lines.push(decodeText(bytes.subarray(start, i)));
    if (byte === 0x0d && bytes[i + 1] === 0x0a) i++;
    start = i + 1;
  }
  if (start < bytes.length) lines.push(decodeText(bytes.subarray(start)));
  return lines;
}

/** Nombres d'éléments donnés par `QUEEN.JAS` (`jas.ts`) pour répartir `QUEEN2.JAS`. */
export interface GameTextCounts {
  descriptions: number;
  names: number;
  rooms: number;
  actorAnimations: number;
  actorNames: number;
  actorFiles: number;
}

/** Nombre de verbes (`Logic::verbName`, verbes 1 à 12) et de réponses de Joe (`JOE_RESPONSE_MAX`). */
export const VERB_COUNT = 12;
export const JOE_RESPONSE_COUNT = 40;

/**
 * Textes de `QUEEN2.JAS`. Chaque tableau est **indexé par le numéro du jeu, à partir de 1** (`objectNames[n]`,
 * `roomNames[n]`…) : l'élément 0 est une chaîne vide. Les accesseurs de ScummVM font de même (`n - 1`).
 */
export interface GameTexts {
  objectDescriptions: string[];
  objectNames: string[];
  /** Noms de pièces : aussi les noms de fichiers de leurs images (`B1` -> `B1.PCX`). */
  roomNames: string[];
  /** Les douze verbes (1 à 12). */
  verbs: string[];
  /** Réponses de Joe (1 à 40) ; leur voix est `JOE<n>…` (`files.ts`). */
  joeResponses: string[];
  actorAnimations: string[];
  actorNames: string[];
  /** Noms de fichiers d'acteurs (`sparky.act`). */
  actorFiles: string[];
}

export function parseGameTexts(bytes: Uint8Array, counts: GameTextCounts): GameTexts {
  const lines = splitLines(bytes);
  const expected =
    counts.descriptions + counts.names + counts.rooms + VERB_COUNT + JOE_RESPONSE_COUNT + counts.actorAnimations + counts.actorNames + counts.actorFiles;
  if (lines.length !== expected) throw new Error(`QUEEN2.JAS invalide : ${lines.length} lignes au lieu de ${expected}`);
  let position = 0;
  const section = (count: number): string[] => {
    const part = ["", ...lines.slice(position, position + count)];
    position += count;
    return part;
  };
  return {
    objectDescriptions: section(counts.descriptions),
    objectNames: section(counts.names),
    roomNames: section(counts.rooms),
    verbs: section(VERB_COUNT),
    joeResponses: section(JOE_RESPONSE_COUNT),
    actorAnimations: section(counts.actorAnimations),
    actorNames: section(counts.actorNames),
    actorFiles: section(counts.actorFiles),
  };
}

export type FaceDirection = "left" | "right" | "front" | "back";

/** Commande qui suit un `*` (`Talk::getSpeakCommand`) ; `none` pour le dernier segment, qui n'en a pas. */
export type SpeechCommand =
  | { kind: "none" }
  /** `*NN` : numéro d'animation de bouche. */
  | { kind: "mouth"; animation: number }
  /** `*AO`. */
  | { kind: "amalOn" }
  /** `*FL`, `*FR`, `*FF`, `*FB`. */
  | { kind: "face"; direction: FaceDirection }
  /** `*GD`, `*GM` : Joe saisit un objet ; ce segment n'est pas dit et n'a pas de voix. */
  | { kind: "grab"; pose: "down" | "mid" }
  /** `*WT`. */
  | { kind: "pause" }
  /** `*XYnn(x,y)`. */
  | { kind: "move"; animation: number; x: number; y: number }
  | { kind: "unknown"; raw: string };

export interface SpeechSegment {
  /** Texte du segment, sans la commande qui le termine. */
  text: string;
  command: SpeechCommand;
  /** Rang du segment dans la réplique (à partir de 0, y compris les segments `grab`). */
  index: number;
}

const FACES: Record<string, FaceDirection> = { FL: "left", FR: "right", FF: "front", FB: "back" };

/** Valeur de `atoi` : chiffres éventuels en tête, 0 sinon. */
function leadingInt(text: string, from: number): number {
  const match = /^[+-]?\d+/.exec(text.slice(from));
  return match ? Number.parseInt(match[0], 10) : 0;
}

/**
 * Découpe une réplique en segments, comme `Talk::speak` : chaque `*` termine un segment et introduit une
 * commande de deux caractères (`*XY` en prend treize) ; le texte restant forme un dernier segment sans
 * commande. Chaque segment a sa propre voix, `<préfixe><rang + 1 en hexadécimal>`, sauf les segments `grab`.
 */
export function splitSpeech(sentence: string): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let start = 0;
  let i = 0;
  while (i < sentence.length) {
    if (sentence[i] !== "*") {
      i++;
      continue;
    }
    const text = sentence.slice(start, i);
    i++;
    const code = sentence.slice(i, i + 2);
    let command: SpeechCommand;
    if (code === "AO") command = { kind: "amalOn" };
    else if (code in FACES) command = { kind: "face", direction: FACES[code] };
    else if (code === "GD") command = { kind: "grab", pose: "down" };
    else if (code === "GM") command = { kind: "grab", pose: "mid" };
    else if (code === "WT") command = { kind: "pause" };
    else if (code === "XY") {
      command = { kind: "move", animation: leadingInt(sentence, i + 2), x: leadingInt(sentence, i + 5), y: leadingInt(sentence, i + 9) };
      i += 11;
    } else if (/^\d\d$/.test(code)) command = { kind: "mouth", animation: Number.parseInt(code, 10) };
    else command = { kind: "unknown", raw: code };
    i += 2;
    segments.push({ text, command, index: segments.length });
    start = i;
  }
  if (start < sentence.length) segments.push({ text: sentence.slice(start), command: { kind: "none" }, index: segments.length });
  return segments;
}

/** Suffixe de voix d'un segment : son rang + 1, en hexadécimal majuscule (`%1x` de ScummVM). */
export function voiceSuffix(segmentIndex: number): string {
  return (segmentIndex + 1).toString(16).toUpperCase();
}
