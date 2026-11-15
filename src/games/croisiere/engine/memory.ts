/**
 * Mémoire des scripts (plan.md D6) : blocs `Uint8Array` grand-boutistes et pointeurs (bloc, offset).
 *
 * Référence : `engines/cruise/script.cpp` (`scriptDataPtrTable`, lectures `READ_BE_UINT16`), `stack.cpp` (pile d'unions short /
 * pointeur), `function.cpp` (`Op_Strcpy`, `Op_Strcat`, `Op_Itoa` qui écrivent sans borne) de ScummVM (GPL v3+).
 *
 * Un pointeur est un couple (bloc, offset) : le bloc est le `Uint8Array` lui-même (BSS d'un processus, BSS d'overlay, bloc de script
 * pour les chaînes, données initiales), donc deux pointeurs vers le même bloc partagent les écritures, comme en C.
 * Écart volontaire : une lecture hors du bloc rend 0 et une écriture hors du bloc est ignorée (ScummVM lirait ou écrirait le tas
 * voisin) ; `outOfBounds` les compte pour le débogage.
 */

export interface Ptr {
  readonly block: Uint8Array;
  readonly offset: number;
}

/** Accès hors bloc constatés depuis le démarrage (débogage). */
export const memoryStats = { outOfBounds: 0 };

/** Entier signé 16 bits (troncature C de `int16`). */
export function int16(value: number): number {
  return (value << 16) >> 16;
}

function inBlock(block: Uint8Array, offset: number, size: number): boolean {
  if (offset >= 0 && offset + size <= block.length) return true;
  memoryStats.outOfBounds++;
  return false;
}

/** `READ_BE_UINT16` converti en `int16`. */
export function readI16(block: Uint8Array, offset: number): number {
  if (!inBlock(block, offset, 2)) return 0;
  return int16((block[offset]! << 8) | block[offset + 1]!);
}

/** `WRITE_BE_UINT16`. */
export function writeI16(block: Uint8Array, offset: number, value: number): void {
  if (!inBlock(block, offset, 2)) return;
  block[offset] = (value >> 8) & 0xff;
  block[offset + 1] = value & 0xff;
}

/** Octet non signé (lecture `*address` d'un `uint8 *`). */
export function readU8(block: Uint8Array, offset: number): number {
  if (!inBlock(block, offset, 1)) return 0;
  return block[offset]!;
}

export function writeU8(block: Uint8Array, offset: number, value: number): void {
  if (!inBlock(block, offset, 1)) return;
  block[offset] = value & 0xff;
}

/** Chaîne C (Latin-1) depuis un pointeur, jusqu'au NUL ou la fin du bloc. */
export function readCString(ptr: Ptr, max = Infinity): string {
  let out = "";
  for (let i = ptr.offset; i < ptr.block.length && out.length < max; i++) {
    const c = ptr.block[i]!;
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

/** Écrit `text` puis un NUL à partir du pointeur, sans autre borne que la fin du bloc (`strcpy`). */
export function writeCString(ptr: Ptr, text: string): void {
  for (let i = 0; i < text.length; i++) writeU8(ptr.block, ptr.offset + i, text.charCodeAt(i));
  writeU8(ptr.block, ptr.offset + text.length, 0);
}

/** Majuscules ASCII seulement, comme `strToUpper` (les accents restent tels quels). */
export function strToUpper(text: string): string {
  return text.replace(/[a-z]/g, (c) => c.toUpperCase());
}

/** `Common::strlcpy(dest, src, size)` : tronque à `size - 1` caractères. */
export function strlcpy(text: string, size: number): string {
  return text.length >= size ? text.slice(0, size - 1) : text;
}
