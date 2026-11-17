import { BinaryReader } from "../../../data/reader";

/** Taille de l'en-tête : 6 u32 little-endian. */
const HEADER_BYTES = 24;

/**
 * Image : pixels indexés (palette de la scène), `width * height` octets, 0 = transparent. Une image stockée en miroir
 * (mot d'attributs `HY8_IMAGE_MIRROR_X`) est déjà retournée : `pixels` est ce que le blit d'origine affiche.
 */
export interface Hy8Image {
  width: number;
  height: number;
  pixels: Uint8Array;
  /** Image stockée en miroir (absent : non) : une partie miroir la pose sans la décaler de sa largeur (voir `placeSprite`). */
  storedMirrored?: boolean;
}

/** Point en pixels relativement à la position passée au dessin du sprite (axe y vers le bas). */
export interface Hy8Point {
  x: number;
  y: number;
}

/** Type d'une partie de sprite : ce qu'elle dessine (`31fe:0481`, table de sauts en `CS:0x19`). */
export const HY8_PART_SUB_SPRITE = 0;
export const HY8_PART_IMAGE = 1;

/**
 * Mot d'attributs (u16) qui précède chaque image : le blit `317b:01cc` le combine (XOR, `317b:0279`) au mot d'index reçu,
 * donc 0x8000 = image stockée en miroir horizontal. Seules valeurs rencontrées : 0 et 0x8000 (39 images sur 1136).
 */
const HY8_IMAGE_MIRROR_X = 0x8000;

/** Bit de `flags` d'une partie ou d'une frame : miroir horizontal. */
export const HY8_FLAG_MIRROR_X = 0x80;

/**
 * Partie d'un sprite composé.
 *
 * - `kind` `HY8_PART_IMAGE` : `target` est l'index d'une image, dessinée avec son coin bas-gauche sur
 *   `points[0]` (le moteur n'utilise que le premier point).
 * - `kind` `HY8_PART_SUB_SPRITE` : `target` est l'index d'un autre sprite, dessiné à `points[0]`
 *   (jamais utilisé par les 33 fichiers).
 *
 * `flags` : octet 3 de la partie masqué par `0xf0`, seul `HY8_FLAG_MIRROR_X` (0x80) apparaît.
 * Les 4 bits bas de cet octet sont les bits 8 à 11 de `target`.
 */
export interface Hy8Part {
  kind: number;
  target: number;
  flags: number;
  points: Hy8Point[];
}

/**
 * Sprite de la table à 0x18 : une ou plusieurs parties. `mode` est l'octet 0 du sprite :
 * 0x10 = coordonnées des points sur 8 bits signés, 0x00 = sur 16 bits signés (aucun autre mode).
 * Les index de frames d'animation et le premier paramètre de `31fe:0481` désignent ces sprites.
 */
export interface Hy8Sprite {
  mode: number;
  parts: Hy8Part[];
}

/**
 * Frame d'une animation (section `h[2]`, lue par `12d7:0008` et `12d7:00c1`).
 *
 * - `sprite` : index dans `Hy8.sprites` (12 bits bas du u16).
 * - `flags` : 4 bits hauts du u16 (0x8000 = miroir en x, 0x2000 = miroir en y selon `31fe:0481`).
 * - `duration` : u16 en +2, recopié par le moteur sans que le code étudié le lise ; vaut 1 partout.
 * - `dx`, `dy` : i16 en +4 et +6, cumulés par `12d7:00c1` dans l'objet animation sans que le code
 *   étudié les lise ; valent 0 partout.
 */
export interface Hy8Frame {
  sprite: number;
  flags: number;
  duration: number;
  dx: number;
  dy: number;
}

/** Animation : liste de frames jouées en boucle (`header` = octet 0, toujours 0 ; compteur = octet 1). */
export interface Hy8Animation {
  header: number;
  frames: Hy8Frame[];
}

export interface Hy8 {
  images: Hy8Image[];
  /** Table à 0x18 (`h[0]`). */
  sprites: Hy8Sprite[];
  /** Section `h[2]` : une animation par entrée de sa table d'offsets. */
  animations: Hy8Animation[];
  /** Section `h[3]`..`h[5]` brute (12 octets `0a 00 ...` partout) : aucun lecteur trouvé dans SMURF.EXE. */
  trailer: Uint8Array;
}

function fail(message: string): never {
  throw new Error(`HY8 invalide : ${message}`);
}

function readImage(bytes: Uint8Array, start: number, limit: number, index: number): Hy8Image {
  if (start + 2 > limit) fail(`image ${index} : en-tête hors du fichier`);
  const attributes = bytes[start - 2] | (bytes[start - 1] << 8);
  const width = bytes[start] * 16;
  const height = bytes[start + 1];
  const pixels = new Uint8Array(width * height);
  let p = start + 2;
  const need = (count: number, y: number) => {
    if (p + count > limit) fail(`image ${index} : données tronquées à la ligne ${y}`);
  };
  for (let y = 0; y < height; y++) {
    need(1, y);
    const spans = bytes[p++];
    let x = 0;
    for (let s = 0; s < spans; s++) {
      need(3, y);
      const skip = bytes[p];
      const count = 4 * bytes[p + 1] + bytes[p + 2];
      p += 3;
      x += skip;
      if (x + count > width) fail(`image ${index} : ligne ${y} déborde de la largeur ${width}`);
      need(count, y);
      pixels.set(bytes.subarray(p, p + count), y * width + x);
      p += count;
      x += count;
    }
    need(1, y);
    if (bytes[p] !== width - x) {
      fail(`image ${index} : écart de fin ${bytes[p]} au lieu de ${width - x} à la ligne ${y}`);
    }
    p++;
  }
  if (attributes & HY8_IMAGE_MIRROR_X) for (let y = 0; y < height; y++) pixels.subarray(y * width, (y + 1) * width).reverse();
  return { width, height, pixels, storedMirrored: (attributes & HY8_IMAGE_MIRROR_X) !== 0 };
}

/**
 * Table de u32 relatifs à `base` ; le nombre d'entrées est `premier offset / 4`.
 * `padding` : octets entre la table et le premier enregistrement (2 pour la table d'images : le mot d'attributs de la
 * première image, voir `HY8_IMAGE_MIRROR_X` ; 0 ailleurs).
 */
function readOffsetTable(bytes: Uint8Array, base: number, limit: number, what: string, padding: number): number[] {
  if (base + 4 > limit) fail(`${what} : table hors du fichier`);
  const reader = new BinaryReader(bytes);
  reader.offset = base;
  const first = reader.u32();
  if (first < 4 || first % 4 !== padding) fail(`${what} : premier offset ${first} incohérent`);
  const count = first >> 2;
  if (base + count * 4 > limit) fail(`${what} : table hors du fichier`);
  const offsets = [first];
  for (let i = 1; i < count; i++) offsets.push(reader.u32());
  for (const offset of offsets) {
    if (base + offset >= limit) fail(`${what} : offset ${offset} hors de la section`);
  }
  return offsets;
}

function readSprite(bytes: Uint8Array, start: number, limit: number, index: number): Hy8Sprite {
  const reader = new BinaryReader(bytes);
  reader.offset = start;
  const need = (count: number) => {
    if (reader.offset + count > limit) fail(`sprite ${index} : enregistrement tronqué`);
  };
  need(2);
  const mode = reader.u8();
  const partCount = reader.u8();
  if (mode !== 0x00 && mode !== 0x10) fail(`sprite ${index} : mode 0x${mode.toString(16)} non géré`);
  const parts: Hy8Part[] = [];
  for (let i = 0; i < partCount; i++) {
    need(4);
    const kind = reader.u8();
    const pointCount = reader.u8();
    const low = reader.u8();
    const high = reader.u8();
    if (kind !== HY8_PART_SUB_SPRITE && kind !== HY8_PART_IMAGE) {
      fail(`sprite ${index} : partie de type ${kind} non gérée`);
    }
    const points: Hy8Point[] = [];
    need(pointCount * (mode === 0x10 ? 2 : 4));
    for (let k = 0; k < pointCount; k++) {
      if (mode === 0x10) {
        const x = (reader.u8() << 24) >> 24;
        const y = (reader.u8() << 24) >> 24;
        points.push({ x, y });
      } else {
        const x = reader.i16();
        const y = reader.i16();
        points.push({ x, y });
      }
    }
    parts.push({ kind, target: low | ((high & 0x0f) << 8), flags: high & 0xf0, points });
  }
  return { mode, parts };
}

function readAnimation(bytes: Uint8Array, start: number, limit: number, index: number): Hy8Animation {
  const reader = new BinaryReader(bytes);
  reader.offset = start;
  if (start + 2 > limit) fail(`animation ${index} : enregistrement tronqué`);
  const header = reader.u8();
  const frameCount = reader.u8();
  if (start + 2 + frameCount * 8 > limit) fail(`animation ${index} : frames tronquées`);
  const frames: Hy8Frame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const word = reader.u16();
    const duration = reader.u16();
    const dx = reader.i16();
    const dy = reader.i16();
    frames.push({ sprite: word & 0x0fff, flags: word & 0xf000, duration, dx, dy });
  }
  return { header, frames };
}

/**
 * Décode un `.HY8` : en-tête de 6 u32 `h[0..5]`, puis (voir `docs/teleportaschtroumpf/hy8.md`)
 * la table de sprites à `h[0]` = 0x18, la table d'images à `h[1]`, les animations à `h[2]`,
 * une section inutilisée à `h[3]` et la fin de fichier à `h[5]`. `h[4]` vaut 0.
 *
 * Refuse tout fichier dont une section sort des bornes, dont une ligne d'image déborde ou dont
 * l'écart de fin de ligne diffère de `largeur - x` (vrai pour les 33 fichiers d'origine).
 */
export function parseHy8(bytes: Uint8Array): Hy8 {
  if (bytes.length < HEADER_BYTES) fail(`${bytes.length} octets, en-tête incomplet`);
  const reader = new BinaryReader(bytes);
  const h: number[] = [];
  for (let i = 0; i < 6; i++) h.push(reader.u32());
  const [spritesStart, imagesStart, animationsStart, trailerStart, , end] = h;
  if (spritesStart !== HEADER_BYTES) fail(`h[0] = ${spritesStart} au lieu de ${HEADER_BYTES}`);
  if (!(imagesStart > spritesStart && imagesStart <= animationsStart && animationsStart < trailerStart && trailerStart <= end && end <= bytes.length)) {
    fail(`sections dans le désordre ou hors du fichier (${h.join(", ")}, ${bytes.length} octets)`);
  }

  const spriteOffsets = readOffsetTable(bytes, spritesStart, imagesStart, "table de sprites", 0);
  const sprites = spriteOffsets.map((offset, i) => readSprite(bytes, spritesStart + offset, imagesStart, i));

  const imageOffsets = readOffsetTable(bytes, imagesStart, animationsStart, "table d'images", 2);
  const images = imageOffsets.map((offset, i) => readImage(bytes, imagesStart + offset, animationsStart, i));

  const animationOffsets = readOffsetTable(bytes, animationsStart, trailerStart, "table d'animations", 0);
  const animations = animationOffsets.map((offset, i) => readAnimation(bytes, animationsStart + offset, trailerStart, i));
  for (const [i, animation] of animations.entries()) {
    for (const frame of animation.frames) {
      if (frame.sprite >= sprites.length) fail(`animation ${i} : sprite ${frame.sprite} inexistant`);
    }
  }
  for (const [i, sprite] of sprites.entries()) {
    for (const part of sprite.parts) {
      const count = part.kind === HY8_PART_IMAGE ? images.length : sprites.length;
      if (part.target >= count) fail(`sprite ${i} : cible ${part.target} inexistante`);
    }
  }

  return { images, sprites, animations, trailer: bytes.subarray(trailerStart, end) };
}
