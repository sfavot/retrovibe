import { createHash } from "node:crypto";
import { Archive } from "../../src/engine/coktel/data/archive";
import { originalFiles } from "../support/original";

const original = originalFiles("ween", "INTRO.STK");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents. */
export const hasOriginalFiles = original.has;

let archive: Archive | null = null;

/** INTRO.STK, seule archive du jeu (chargée une fois). */
export function loadIntro(): Archive {
  archive ??= new Archive(original.read("INTRO.STK"));
  return archive;
}

/** Entrées de l'archive dont le nom se termine par `ext` (ex. `.TOT`), triées. */
export function entriesWithExt(ext: string): string[] {
  return loadIntro()
    .entries.map((e) => e.name.toUpperCase())
    .filter((n) => n.endsWith(ext))
    .sort();
}

/** Octets d'un fichier de l'archive (échoue si absent). */
export function entry(name: string): Uint8Array {
  const data = loadIntro().get(name);
  if (!data) throw new Error(`${name} absent de INTRO.STK`);
  return data;
}

/** Empreinte sha1 hexadécimale (assertion stable à la place d'un gros instantané). */
export function sha1(...parts: Uint8Array[]): string {
  const hash = createHash("sha1");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

const CP850_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

/** CP850 vers chaîne (Node n'embarque pas ce codage). */
export function cp850(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes)
    out += b < 0x80 ? String.fromCharCode(b) : CP850_HIGH[b - 0x80];
  return out;
}

/**
 * Lignes de texte d'un item `.DAT` (`Draw_v2::printTotText`, `draw_v2.cpp:190-300`) : rectangle de 8 octets, couleur de fond,
 * rectangles de décor de 8 octets + commande jusqu'à `0xFFFF`, puis commandes (`01` fin, `02`/`05` + 4 octets, `03`/`04` + 1 octet,
 * `06` et `0A` à longueur variable) entrecoupées de texte. Un segment de texte devient une ligne.
 */
export function textLines(item: Uint8Array): string[] {
  let p = 8;
  p += 1;
  while (item[p] + (item[p + 1] << 8) !== 0xffff) p += 9;
  p += 2;
  const lines: string[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length) lines.push(cp850(Uint8Array.from(current)));
    current = [];
  };
  while (p < item.length && item[p] !== 1) {
    const c = item[p];
    if (c === 2 || c === 5) {
      flush();
      p += 5;
    } else if (c === 3 || c === 4) {
      flush();
      p += 2;
    } else if (c === 6) {
      flush();
      p++;
      p +=
        (item[p] & 0xc0) === 0x40
          ? 9
          : (item[p] & 0xc0) === 0x80
            ? 3
            : (item[p] & 0xc0) === 0xc0
              ? 11
              : 1;
    } else if (c === 10) {
      flush();
      p += item[p + 1] * 2 + 2;
    } else {
      if (c >= 32) current.push(c);
      p++;
    }
  }
  flush();
  return lines;
}
