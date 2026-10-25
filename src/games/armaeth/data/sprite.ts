import { BinaryReader } from "../../../data/reader";

/** Taille de l'en-tête fixe : 12 octets de compteurs + mot 0x16 + 18 octets de pointeurs mémoire (voir `readSprite`). */
const TABLE_OFFSET = 0x20;

/** Valeur de transparence des pixels d'image. */
export const SPRITE_TRANSPARENT = 0xff;

/** Image : `width * height` pixels indexés, rangés ligne par ligne (le fichier les range colonne par colonne). */
export interface SpriteFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Pas d'animation : un mot `(octet haut << 8) | image`, octet haut = bit 7 miroir + 7 bits de durée en tics (`1833:0006`). */
export interface SpriteStep {
  /** Numéro d'image (octet bas du mot) ; pas toujours dans les bornes de la ressource (`Fig` jamais utilisées, voir les tests). */
  frame: number;
  /** Durée en tics (7 bits de l'octet haut). */
  duration: number;
  /** Bit 7 de l'octet haut : image en miroir (combiné par XOR avec le miroir de direction). */
  mirror: boolean;
}

/** Séquence `[n, pas…]` du tableau de mots : l'octet bas de l'en-tête donne le nombre de pas, son octet haut est conservé tel quel. */
export interface SpriteSequence {
  /** Indice du mot d'en-tête dans le tableau de mots (c'est la valeur stockée dans l'enregistrement). */
  start: number;
  /** Octet haut du mot d'en-tête (0 dans les 189 ressources : sens inconnu). */
  headerHigh: number;
  steps: SpriteStep[];
}

/**
 * Enregistrement d'animation (12 octets) indexé par `Fig` (`animStep` = `1833:0006`, `docs/armaeth/engine.md` § 6.3
 * et `interface.md` § 3.2) : `{u8 index, u8 miroir, u8 dpX, u8 dpY, u16 x 4}`.
 */
export interface SpriteFig {
  /** Octet 0 : numéro de l'enregistrement (égal à `Fig` dans les 189 ressources). */
  index: number;
  /** Octet 1 : non nul = l'image est en miroir quand l'objet regarde à gauche (direction 1). */
  mirrorLeft: number;
  /** Octets 2 et 3 : `dpX` et `dpY` (décalages recopiés dans l'objet). */
  dpX: number;
  dpY: number;
  /** Séquence de chacune des 4 directions (0 droite, 1 gauche, 2 vers l'avant, 3 vers le fond) ; plusieurs directions peuvent partager la même. */
  directions: [SpriteSequence, SpriteSequence, SpriteSequence, SpriteSequence];
}

/**
 * Section d'animation : `12 * records + 2 * words` octets, `records` enregistrements de 12 octets (un par `Fig`)
 * puis `words` mots (u16) qui contiennent les séquences. `bytes` garde la section brute.
 */
export interface SpriteAnimation {
  records: number;
  words: number;
  bytes: Uint8Array;
  figs: SpriteFig[];
}

export interface Sprite {
  /** Identifiant interne : `OBJ` 2000 + id, `DEC` 1000 + id, `ANM` 3000 + id, `INT` id. */
  id: number;
  frames: SpriteFrame[];
  animation: SpriteAnimation;
  /** Mot en +12 (0x16 dans les 189 ressources) puis 18 octets en +14 : pointeurs mémoire sauvegardés tels quels, sans sens dans le fichier. */
  memoryPointers: Uint8Array;
}

function fail(message: string): never {
  throw new Error(`Sprite invalide : ${message}`);
}

/**
 * Décode les enregistrements et les séquences de la section d'animation. Chaque séquence est lue comme le moteur
 * (nombre de pas dans l'octet bas de l'en-tête, pas = mots suivants, pas de terminateur) ; les indices de séquence et
 * hors limites sont refusés ; les numéros d'image ne sont pas contrôlés ici (le moteur non plus), voir les tests.
 */
function readFigs(
  bytes: Uint8Array,
  records: number,
  words: number,
): SpriteFig[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (index: number) => view.getUint16(12 * records + 2 * index, true);
  const cache = new Map<number, SpriteSequence>();
  const sequence = (start: number, fig: number): SpriteSequence => {
    const known = cache.get(start);
    if (known) return known;
    if (start >= words) fail(`Fig ${fig} : séquence ${start} hors du tableau de ${words} mots`);
    const header = word(start);
    const total = header & 0xff;
    if (start + 1 + total > words) fail(`Fig ${fig} : séquence ${start} déborde du tableau de mots`);
    const steps: SpriteStep[] = [];
    for (let i = 1; i <= total; i++) {
      const step = word(start + i);
      const frame = step & 0xff;
      steps.push({ frame, duration: (step >> 8) & 0x7f, mirror: (step & 0x8000) !== 0 });
    }
    const result = { start, headerHigh: header >> 8, steps };
    cache.set(start, result);
    return result;
  };
  const figs: SpriteFig[] = [];
  for (let fig = 0; fig < records; fig++) {
    const at = 12 * fig;
    const direction = (d: number) => sequence(view.getUint16(at + 4 + 2 * d, true), fig);
    figs.push({
      index: bytes[at],
      mirrorLeft: bytes[at + 1],
      dpX: bytes[at + 2],
      dpY: bytes[at + 3],
      directions: [direction(0), direction(1), direction(2), direction(3)],
    });
  }
  return figs;
}

/**
 * Ressource sprite (`INT`, `DEC`, `OBJ`, `ANM`), lue comme `gm_load_sprite_resource` (`1735:000e`) :
 *
 * - +0 u16 id, +2 u16 `n` images, +4 u16 `a` enregistrements d'animation, +6 u16 `b` mots d'animation,
 *   +8 u32 `P` taille des images brutes, +12 u16 0x16, +14 18 octets de pointeurs mémoire ;
 * - +0x20 : `n` u32, offsets des images relatifs au début de la zone d'images ; puis la section d'animation ;
 * - zone d'images = les `P` derniers octets de la ressource ; image : `u8 H, u8 L`, puis `L` colonnes de `H` pixels.
 *
 * Les images doivent se suivre sans trou et finir exactement à la fin de la ressource.
 */
export function readSprite(data: Uint8Array): Sprite {
  if (data.length < TABLE_OFFSET) fail("ressource plus courte que l'en-tête");
  const reader = new BinaryReader(data);
  const id = reader.u16();
  const count = reader.u16();
  const records = reader.u16();
  const words = reader.u16();
  const imageBytes = reader.u32();
  const memoryPointers = data.subarray(12, TABLE_OFFSET);
  const animationOffset = TABLE_OFFSET + 4 * count;
  const animationBytes = 12 * records + 2 * words;
  const base = data.length - imageBytes;
  if (imageBytes > data.length || animationOffset + animationBytes !== base) {
    fail(
      `sections incohérentes (images à ${base}, animation finit à ${animationOffset + animationBytes})`,
    );
  }

  reader.offset = TABLE_OFFSET;
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(reader.u32());

  const frames: SpriteFrame[] = [];
  let next = base;
  for (let i = 0; i < count; i++) {
    if (base + offsets[i] !== next)
      fail(`image ${i} : offset ${offsets[i]} au lieu de ${next - base}`);
    if (next + 2 > data.length)
      fail(`image ${i} : en-tête hors de la ressource`);
    const height = data[next];
    const width = data[next + 1];
    const start = next + 2;
    next = start + width * height;
    if (next > data.length) fail(`image ${i} : pixels hors de la ressource`);
    const pixels = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++)
        pixels[y * width + x] = data[start + x * height + y];
    }
    frames.push({ width, height, pixels });
  }
  if (next !== data.length)
    fail(`${data.length - next} octets après la dernière image`);

  const animationData = data.subarray(animationOffset, base);
  return {
    id,
    frames,
    animation: {
      records,
      words,
      bytes: animationData,
      figs: readFigs(animationData, records, words),
    },
    memoryPointers,
  };
}
