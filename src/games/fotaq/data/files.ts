/**
 * Fichiers du jeu (`original/fotaq/files.json`, généré par `scripts/manifest.py`) : la résolution de noms est dans
 * `src/data/game-files.ts` ; ce module y ajoute ce qui est propre au jeu : extensions, noms des fichiers par
 * pièce, voix (`voices/<NOM>.mp3`, converties des `.SB` d'origine) et leur classement.
 *
 * Noms des voix (engines/queen/talk.cpp, cutaway.cpp, logic.cpp, ScummVM) : le nom est calculé par le moteur, les
 * espaces remplacés par `0` (`%2d`, `%4x`) et la casse relevée. Quatre familles :
 * - dialogue : `TT` `HHHH` `P`|`J` `S` : clé du dialogue (`talkKey`, 2 chiffres), tête (4 chiffres hexadécimaux),
 *   personnage ou Joe, rang du segment (1 chiffre hexadécimal) ; `TT` `SSSS`|`XXXX` `P`|`J` `S` pour les répliques
 *   d'ouverture (premier échange, personnage déjà rencontré) ;
 * - cinématique : nom du `.CUT` complété à 5 caractères par `_`, rang de l'objet sur 2 chiffres, rang du segment
 *   (`findCdCut`) ; un texte affiché et dit ajoute `1` ;
 * - Joe : `JOE` + numéro sur 4 chiffres + rang du segment (descriptions d'objets : numéro + 40) ;
 * - effets : le reste (`116BSSSS`, `MON_0001`, `BLANK000`…), tirés d'une table de ScummVM (`_sfxName`) ou de la
 *   pièce (`sfxName` de `QUEEN.JAS`).
 */

import { GameFiles as BaseGameFiles, baseName, fetchGameFileEntries } from "../../../data/game-files";

export { baseName };
export type { GameFileEntry } from "../../../data/game-files";

/** Extension en majuscules, sans le point ; chaîne vide s'il n'y en a pas. */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toUpperCase();
}

/** Nom d'un fichier sans son extension. */
export function stemOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/** Images d'une pièce d'après son nom de `QUEEN2.JAS` (`B1` -> `B1.PCX`, `B1.MSK`, `B1.LUM`). */
export function roomImageFile(roomName: string): string {
  return `${roomName}.PCX`;
}

export function roomMaskFile(roomName: string): string {
  return `${roomName}.MSK`;
}

export function roomLightFile(roomName: string): string {
  return `${roomName}.LUM`;
}

/** Chemin d'une voix ou d'un effet (`020001P2` -> `voices/020001P2.mp3`). */
export function voiceFile(name: string): string {
  return `voices/${name.toUpperCase()}.mp3`;
}

/** Entier rempli de zéros à gauche (`%2d` avec espaces remplacés par `0`). */
function padded(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Préfixe des voix d'une phrase de dialogue (`%2d%4xP` / `J`, hexadécimal majuscule). */
export function dialogVoicePrefix(talkKey: number, head: number, who: "P" | "J"): string {
  return `${padded(talkKey, 2)}${head.toString(16).toUpperCase().padStart(4, "0")}${who}`;
}

/** Préfixe des voix d'ouverture d'un dialogue : `S` premier échange (Joe), `X` personnage déjà rencontré. */
export function dialogOpeningVoicePrefix(talkKey: number, kind: "SSSS" | "XXXX", who: "P" | "J"): string {
  return `${padded(talkKey, 2)}${kind}${who}`;
}

/** Préfixe des voix de la phrase de rang `objectRank` (à partir de 1) d'une cinématique (`findCdCut`). */
export function cutawayVoicePrefix(cutawayName: string, objectRank: number): string {
  return `${stemOf(cutawayName).toUpperCase().padEnd(5, "_")}${padded(objectRank, 2)}`;
}

/** Préfixe des voix de Joe pour la description ou réponse `number` (`JOE%04i`). */
export function joeVoicePrefix(number: number): string {
  return `JOE${padded(number, 4)}`;
}

export type VoiceName =
  | { kind: "dialog"; talkKey: number; head: number; who: "P" | "J"; segment: number }
  | { kind: "dialogOpening"; talkKey: number; opening: "SSSS" | "XXXX"; who: "P" | "J"; segment: number }
  | { kind: "joe"; number: number; segment: number }
  | { kind: "cutaway"; cutaway: string; objectRank: number; segment: number }
  | { kind: "effect"; name: string };

const DIALOG = /^(\d\d)([0-9A-F]{4})([PJ])([0-9A-F])$/;
const DIALOG_OPENING = /^(\d\d)(SSSS|XXXX)([PJ])([0-9A-F])$/;
const JOE = /^JOE(\d{4})([0-9A-F])$/;
const CUTAWAY = /^([A-Z0-9]{1,5}?)_*(\d\d)([0-9A-F])$/;

/**
 * Classe un nom de voix (sans extension, casse indifférente). Quelques effets ont la forme d'un nom de cinématique
 * (`MON_0001`) : `cutaways` (noms des `.CUT`, `GameFiles.cutaways()`) départage ; sans lui, la seule forme décide.
 */
export function parseVoiceName(name: string, cutaways?: ReadonlySet<string>): VoiceName {
  const upper = stemOf(name).toUpperCase();
  let match = DIALOG.exec(upper);
  if (match) return { kind: "dialog", talkKey: Number.parseInt(match[1], 10), head: Number.parseInt(match[2], 16), who: match[3] as "P" | "J", segment: Number.parseInt(match[4], 16) };
  match = DIALOG_OPENING.exec(upper);
  if (match) return { kind: "dialogOpening", talkKey: Number.parseInt(match[1], 10), opening: match[2] as "SSSS" | "XXXX", who: match[3] as "P" | "J", segment: Number.parseInt(match[4], 16) };
  match = JOE.exec(upper);
  if (match) return { kind: "joe", number: Number.parseInt(match[1], 10), segment: Number.parseInt(match[2], 16) };
  if (upper.length === 8 && /^[A-Z0-9_]{5}\d\d[0-9A-F]$/.test(upper)) {
    match = CUTAWAY.exec(upper);
    // Le rang d'un objet commence à 1 (`BLANK000` n'est donc pas une cinématique).
    if (match && Number.parseInt(match[2], 10) >= 1 && (!cutaways || cutaways.has(match[1]))) {
      return { kind: "cutaway", cutaway: match[1], objectRank: Number.parseInt(match[2], 10), segment: Number.parseInt(match[3], 16) };
    }
  }
  return { kind: "effect", name: upper };
}

export class GameFiles extends BaseGameFiles {
  /** Noms (sans extension, majuscules) des fichiers d'une extension donnée, hors dossiers, triés. */
  stems(extension: string): string[] {
    return this.list((path) => !path.includes("/") && extensionOf(path) === extension)
      .map((path) => stemOf(path).toUpperCase())
      .sort();
  }

  /** Dialogues `.DOG`. */
  dialogs(): string[] {
    return this.stems("DOG");
  }

  /** Cinématiques `.CUT`. */
  cutaways(): string[] {
    return this.stems("CUT");
  }

  /** Noms (sans extension) des voix et effets du dossier `voices/`, triés. */
  voices(): string[] {
    return this.list((path) => path.startsWith("voices/") && extensionOf(path) === "MP3")
      .map((path) => stemOf(path).toUpperCase())
      .sort();
  }

  /** Pièces qui ont un masque `.MSK` et une table `.LUM` : celles où la lumière dynamique s'applique. */
  roomsWithLight(): string[] {
    const lum = new Set(this.stems("LUM"));
    return this.stems("MSK").filter((name) => lum.has(name));
  }
}

/** Charge `files.json` sous `base` (ex. `/fotaq`). */
export async function fetchGameFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}
