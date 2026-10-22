import { BinaryReader } from "../../../data/reader";
import { MuxVideoDecoder } from "./mux";

/** Taille d'un tronçon de voie décodé : 140 lignes de 320 pixels (0x8c lignes dans `23c9:0004`). */
export const MUT_TILE_WIDTH = 320;
export const MUT_TILE_HEIGHT = 140;

/** Octets d'en-tête de chaque enregistrement : u16 `flags` + u32 taille. */
const RECORD_HEADER_BYTES = 6;

/**
 * Bits de `MutTile.flags`, déduits des tests de la boucle de jeu (`23c9:0004`, voir `docs/teleportaschtroumpf/mut.md`).
 * Trois voies parallèles (gauche, centre, droite) ; le chariot peut changer de voie là où le tronçon a un aiguillage,
 * et heurte un obstacle posé sur sa voie. Les noms des bits sont confirmés par le rendu des tronçons (aiguillages
 * visibles dans l'image), pas par un texte du jeu.
 */
export const MutFlag = {
  /** Aiguillage gauche -> centre (le chariot est à gauche et appuie sur « droite »). */
  SwitchLeftToCenter: 0x80,
  /** Aiguillage droite -> centre (le chariot est à droite et appuie sur « gauche »). */
  SwitchRightToCenter: 0x40,
  /** Aiguillage centre -> gauche. */
  SwitchCenterToLeft: 0x20,
  /** Aiguillage centre -> droite. */
  SwitchCenterToRight: 0x10,
  /** Obstacle sur la voie de gauche. */
  ObstacleLeft: 0x08,
  /** Obstacle sur la voie du centre. */
  ObstacleCenter: 0x04,
  /** Obstacle sur la voie de droite. */
  ObstacleRight: 0x02,
} as const;

export interface MutTile {
  /**
   * u16 du début de l'enregistrement : masque d'aiguillages et d'obstacles du tronçon (voir `MutFlag`).
   * Le bit 0x01 seul (valeur 1) désigne un tronçon sans aiguillage ni obstacle.
   */
  flags: number;
  width: number;
  height: number;
  /** Indices de palette, `width * height` octets, à associer à la `.PAL` de la variante (768 octets, `parsePal`). */
  pixels: Uint8Array;
}

/**
 * Fichier `.MUT` d'une variante de la mine : suite d'enregistrements `u16 flags, u32 taille, données`
 * jusqu'à la fin du fichier. Les données sont un chunk vidéo MUX (flags, position, tailles « bits » et « couleurs »,
 * LZ + séries) qui se décode en une image 320x140 ; `parsePrc` donne l'ordre dans lequel ces tronçons défilent.
 */
export interface Mut {
  tiles: MutTile[];
}

export function parseMut(bytes: Uint8Array): Mut {
  const reader = new BinaryReader(bytes);
  const tiles: MutTile[] = [];
  // Le jeu appelle le même décodeur (`357c:011d`) que pour les films MUX : une instance sert à tous les tronçons.
  const decoder = new MuxVideoDecoder();
  while (!reader.isAtEnd) {
    if (reader.length - reader.offset < RECORD_HEADER_BYTES) {
      throw new Error(`MUT : en-tête d'enregistrement tronqué à l'offset ${reader.offset}`);
    }
    const flags = reader.u16();
    const size = reader.u32();
    if (reader.offset + size > reader.length) {
      throw new Error(`MUT : enregistrement ${tiles.length} tronqué (${size} octets annoncés)`);
    }
    const record = bytes.subarray(reader.offset, reader.offset + size);
    reader.offset += size;
    const pixels = new Uint8Array(MUT_TILE_WIDTH * MUT_TILE_HEIGHT);
    decoder.decode(record, pixels, MUT_TILE_WIDTH, MUT_TILE_HEIGHT);
    tiles.push({ flags, width: MUT_TILE_WIDTH, height: MUT_TILE_HEIGHT, pixels });
  }
  return { tiles };
}

/**
 * Fichier `.PRC` : suite de u16 little-endian, chacun l'indice (base 0) d'un tronçon du `.MUT` de la même variante.
 * Le jeu précharge les trois premiers, puis charge le suivant à chaque tronçon franchi et s'arrête avant le
 * dernier élément (la fin de la liste est du remplissage : valeur répétée quatre fois).
 */
export function parsePrc(bytes: Uint8Array): number[] {
  if (bytes.length % 2 !== 0) throw new Error(`PRC invalide : ${bytes.length} octets (nombre impair)`);
  const reader = new BinaryReader(bytes);
  const sequence: number[] = [];
  while (!reader.isAtEnd) sequence.push(reader.u16());
  return sequence;
}
