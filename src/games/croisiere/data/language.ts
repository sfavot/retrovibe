/**
 * `DELPHINE.LNG` : textes système du jeu (docs/croisiere/formats.md § 3.9).
 *
 * Référence : `engines/cruise/cruise.cpp::CruiseEngine::loadLanguageStrings` de ScummVM (GPL v3+, release 2026.4.0) : le moteur lit
 * `MAX_LANGUAGE_STRINGS` (25) chaînes, chacune entre deux guillemets `"`, en sautant tout ce qui les sépare (ici `\r\n`).
 * Les octets sont du Latin-1 (`é` = 0xE9). Le fichier prime sur les chaînes de repli de `staticres.cpp` (13 chaînes, pause vide).
 *
 * Écart volontaire : ScummVM boucle sans contrôle de bornes si le fichier a moins de 25 chaînes ; ici l'analyse échoue.
 */
import { latin1String } from "./overlay";

/** Nombre de chaînes lues par le moteur (`MAX_LANGUAGE_STRINGS`). */
export const LANGUAGE_STRING_COUNT = 25;

/**
 * Indices des chaînes que ScummVM nomme (`LangStringId` de `cruise.h`). Les autres, relevées dans le fichier : 1 « INSERER LE DISQUE »,
 * 2 « EN », 3 et 4 erreurs mémoire, 8 « Lecteur de Sauvegarde », 13 « Confirmez vous ce choix? », 14 « Oui », 15 « Non »,
 * 16 à 24 messages de sauvegarde (jamais lus par ScummVM, qui a son propre dialogue).
 */
export const LangId = {
  pause: 0,
  inventory: 5,
  speakAbout: 6,
  playerMenu: 7,
  save: 9,
  load: 10,
  restart: 11,
  quit: 12,
} as const;

/** Chaînes de `DELPHINE.LNG`, en Latin-1 converties une à une (un caractère par octet). */
export function parseLanguageFile(file: Uint8Array): string[] {
  const strings: string[] = [];
  let pos = 0;
  for (let i = 0; i < LANGUAGE_STRING_COUNT; i++) {
    const open = file.indexOf(0x22, pos);
    if (open < 0) throw new RangeError(`DELPHINE.LNG : chaîne ${i} absente (guillemet ouvrant)`);
    const close = file.indexOf(0x22, open + 1);
    if (close < 0) throw new RangeError(`DELPHINE.LNG : chaîne ${i} non terminée`);
    strings.push(latin1String(file.subarray(open + 1, close)));
    pos = close + 1;
  }
  return strings;
}
