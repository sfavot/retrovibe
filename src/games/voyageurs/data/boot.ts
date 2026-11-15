/**
 * Script de démarrage `AUTO00.PRC` (hors bundle) de la version CD Sony.
 *
 * Référence : ScummVM engines/cine/part.cpp (`readFile`, `rolByte`), prc.cpp (`loadPrc`) et cine.h (`BOOT_PRC_NAME`, `BOOT_SCRIPT_INDEX`)
 * (GPL v3 ou ultérieure). Avec `GF_CRYPTED_BOOT_PRC`, chaque octet est tourné d'un bit vers la gauche : la version Sony l'a stocké tourné
 * vers la droite. Une fois décodé, c'est un PRC ordinaire (docs/voyageurs/formats.md § 2.6).
 *
 * Écart volontaire : le décodage est toujours appliqué (le jeu livré est la version CD ; la version disquette n'est pas gérée).
 */
import { readPrc, type Prc } from "./prc";

export const BOOT_PRC_NAME = "AUTO00.PRC";
/** Script de boot lancé par `CineEngine::run`. */
export const BOOT_SCRIPT_INDEX = 1;

/** `rolByte(octet, 1)` sur tout le fichier. */
export function decodeBootPrc(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = ((raw[i]! << 1) | (raw[i]! >> 7)) & 0xff;
  return out;
}

export function readBootPrc(raw: Uint8Array): Prc {
  return readPrc(decodeBootPrc(raw));
}
