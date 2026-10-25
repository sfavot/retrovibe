import { BinaryReader } from "../../../data/reader";

/** Taille de l'en-tête d'une ressource de scène (`lib_fread(buf, 0x30, 1)` dans `gm_load_scene`, `1cc3:01f7`). */
const HEADER_BYTES = 0x30;
/** Mots (u16) réservés avant les couches d'image (`lib_fread(0x4bac, 2, 0x28)`, `1cc3:052c`). */
const WORD_TABLE_BYTES = 2 * 0x28;
const GRID_RECORD_BYTES = 16;
const ZONE_RECORD_BYTES = 16;
const OBJECT_RECORD_BYTES = 20;
const HOTSPOT_RECORD_BYTES = 10;
/** Mots (u16) de la table des étendues horizontales : 20 paires (X min, X max), une par rangée de profondeur. */
const ROW_RANGE_COUNT = 20;
/** Valeur (0xFFFF lu en mot signé) des quatre mots d'un point sensible sans rectangle (message d'ambiance). */
const HOTSPOT_NO_RECT = -1;

/** Largeur de l'écran : les couches se placent dans un tampon de 320 x 200 (`DGROUP:0ee0`). */
export const SCENE_SCREEN_WIDTH = 320;
export const SCENE_SCREEN_HEIGHT = 200;

/** Taille du tampon de décompression d'une ligne (`gm_alloc(0x400)`, `1f94:00a6`). */
const LINE_BUFFER = 0x400;
/** Nombre maximal de passes (`n`) d'une ligne : au-delà `gm_decode_scene_image` renvoie l'erreur 4 (`1f94:02a1`). */
const MAX_PASSES = 100;

/**
 * Type de couche : premier octet de la couche (`gm_decode_scene_image`, `1f94:0068`).
 *
 * - 0 : décompresseur de ligne A (`34bb:0008`), jamais recoloré ;
 * - 1 : décompresseur A, puis recoloration par la table `DGROUP:5312` si le pilote vidéo est en mode 0x13 (VGA) ;
 * - 2 : décompresseur B (`34bb:0142`), puis recoloration par `DGROUP:5412` seulement hors mode 0x13 (donc jamais en VGA).
 */
export type SceneLayerType = 0 | 1 | 2;

/** Rectangle de la scène dans l'écran de 320 x 200 (mots +8, +10, +12, +14 de l'en-tête). */
export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Couche décodée : `width * height` pixels indexés, ligne par ligne, à poser en (`x`, `y`) dans l'écran.
 * Le moteur ne pose pas la couche telle quelle : voir `docs/armaeth/graphics.md` (masque du tampon `0ee0`).
 */
export interface SceneLayer extends SceneRect {
  type: SceneLayerType;
  pixels: Uint8Array;
  /** Nombre de passes `n` de chaque ligne (1 presque partout). */
  passes: number[];
  /** La table de recoloration du type 1 a été appliquée. */
  recolored: boolean;
  /** Octets lus dans la ressource, type compris. */
  size: number;
}

/** En-tête de 0x30 octets. Les champs non nommés sont conservés dans `words` (24 mots). */
export interface SceneHeader extends SceneRect {
  id: number;
  /** Mot +4 : nombre d'enregistrements de 20 octets (décors de type 1, créés par `gm_create_object`, `engine.md` § 5.3). */
  decorCount: number;
  /** Mot +6 : nombre d'enregistrements de 10 octets en fin de ressource (points sensibles à message, `engine.md` § 5.2). */
  hotspotCount: number;
  /** Mot +0x1E : nombre de plans (grilles de marche de 81 x 21 cases chacun, `1cc3`). */
  planeCount: number;
  /** Mot +0x20 : nombre d'enregistrements de 16 octets de la grille de marche. */
  gridCount: number;
  /** Mot +0x22 : nombre d'enregistrements de 16 octets, vérifiés à la lecture (`w[5] >= w[2]` et `w[3] >= w[4]`) : zones des objets de `Dep` 2 et 4 (`engine.md` § 7.2). */
  zoneCount: number;
  /** Limites de la salle (mots 9 à 14). */
  limits: RoomLimits;
  /** Octets +0x24..+0x29 : permutation de 0..5 (`DGROUP:4b88`, `4b94`), `00 01 02 03 04 05` dans presque toutes les scènes. */
  permutation: number[];
  /** Mots +0x2C et +0x2E : taille en octets de la couche A puis de la couche B (0 = couche absente). */
  layerSizes: [number, number];
  words: Uint16Array;
}

/** Rectangle d'un point sensible, en coordonnées relatives à la fenêtre de la scène (`x`, `y` de l'en-tête). */
export interface HotspotRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Point sensible : enregistrement de 10 octets `{id de message u16, x0, x1, y0, y1}` (mots signés : un rectangle peut déborder de la fenêtre), testé par `1564:0004`
 * (`engine.md` § 5.2 ; le déclenchement par `1e58:000a` est probable). Les quatre mots valent `0xFFFF` pour un message
 * d'ambiance sans rectangle (`rect` nul).
 */
export interface SceneHotspot {
  messageId: number;
  rect: HotspotRect | null;
}

/**
 * Décor : enregistrement de 20 octets, un objet de type 1 par enregistrement (`1cc3:0745..07f5`, `engine.md` § 5.3).
 * Les noms entre parenthèses sont ceux des champs de l'objet de 144 octets (`engine.md` § 6.1).
 */
export interface SceneDecor {
  /** Octets 0-1 `Num` : identifiant de la ressource `DEC`. */
  num: number;
  /** Octets 2-3 : non utilisés par le chargeur (hypothèse : identifiant de salle ou de ressource). */
  unused: number;
  /** Octets 4 à 9 : `Gst`, `Mob`, `Dep`, `Txt`, `Ego`, `Fig` (indice d'animation). */
  gst: number;
  mob: number;
  dep: number;
  txt: number;
  ego: number;
  fig: number;
  /** Octet 10 `Lum` (signé) : lumière émise. */
  light: number;
  /** Octet 11 `Hor` : 0 est remplacé par 1 au chargement (regarde à droite). */
  hor: number;
  /** Octets 12 à 17 `X`, `Y`, `P` (signés). */
  x: number;
  y: number;
  p: number;
  /** Octet 18 `N` : plan de marche. */
  plane: number;
  /** Octet 19 `Sol`. */
  ground: number;
}

/**
 * Limites de la salle : mots +0x12..+0x1C de l'en-tête, `header.words[9..14]` (`1cc3:0290..02d1`, `DGROUP:4ac8`, `4aca`, `4ace`,
 * `4ad0`, `4ad4`, `4ad6` ; `docs/armaeth/movement.md` § 1.1 et § 2.8). Bornes incluses : X (abscisse), Y (hauteur à l'écran,
 * relative à la fenêtre de la scène) et P (profondeur) ; typiquement `0, 319, 0, 179, 8, 159`.
 */
export interface RoomLimits {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  pMin: number;
  pMax: number;
}

/**
 * Zone des objets de `Dep` 2 et 4 : enregistrement de 16 octets `{u8 type, u8 0xFF, s16 rangée, s16 col début, s16 Y haut (hi),
 * s16 Y bas (lo), s16 col fin, 4 octets non lus}`, copié en `DGROUP:4ada` (`movement.md` § 1.1 et § 2.5). Un objet dont la case
 * `(P >> 3, X >> 2)` et la hauteur tombent dedans prend `type` comme type de sol. Le chargeur exige `colEnd >= colStart`
 * et `high >= low`.
 */
export interface SceneZone {
  /** Octet 0 : type de sol donné à l'objet (11, 15, 16, 17, 19, 48 à 51, 59 dans les données). */
  type: number;
  /** Octet 1 : toujours 0xFF (jamais un plan). */
  plane: number;
  /** Mot +2 : rangée de profondeur (`P >> 3`). */
  row: number;
  /** Mot +4 : première colonne (`X >> 2`). */
  colStart: number;
  /** Mot +6 : Y maximal (`hi`, `Y' <= high`). */
  high: number;
  /** Mot +8 : Y minimal (`lo`, `Y' >= low`). */
  low: number;
  /** Mot +10 : dernière colonne. */
  colEnd: number;
  /** Octets 12 à 15 : conservés tels quels (rôle inconnu). */
  spare: Uint8Array;
}

/** Étendue horizontale du sol pour une rangée de profondeur `P >> 3` : mots (X min, X max) de `DGROUP:4bac` (`engine.md` § 7.4). */
export interface RowRange {
  min: number;
  max: number;
}

export interface Scene {
  header: SceneHeader;
  /** Couches dans l'ordre du fichier (A puis B, absentes ignorées). */
  layers: SceneLayer[];
  /** Enregistrements bruts de 16 octets : grille de marche (`engine.md` § 7.1), dans l'ordre du fichier. */
  grid: Uint8Array;
  /** Zones des objets de `Dep` 2 et 4, dans l'ordre du fichier (`engine.md` § 7.2, `movement.md` § 1.1). */
  zones: SceneZone[];
  /** Les 40 mots bruts qui précèdent les couches (voir `rowRanges`). */
  words: Uint8Array;
  /** 20 paires (X min, X max), une par rangée de profondeur (`engine.md` § 5.2 et § 7.4). */
  rowRanges: RowRange[];
  hotspots: SceneHotspot[];
  decors: SceneDecor[];
}

export interface SceneOptions {
  /** Table `DGROUP:5312` (256 octets, `readRecolorTables`) appliquée aux couches de type 1. */
  recolorType1?: Uint8Array;
}

function fail(message: string): never {
  throw new Error(`Scène invalide : ${message}`);
}

/**
 * Décompresseur de ligne A (`34bb:0008`, `gm_unpack_rle`) : paquets `00 k <k littéraux>` ou `c v` (`v` répété `c` fois),
 * jusqu'à épuisement de l'entrée. Le nombre de passes `n` n'est testé que contre 0 (l'entrée est alors rendue telle quelle).
 */
export function unpackRle(input: Uint8Array, passes: number): Uint8Array {
  if (passes === 0) return input.slice();
  if (input.length >= LINE_BUFFER) fail("ligne compressée trop longue");
  const out: number[] = [];
  let p = 0;
  do {
    if (p + 2 > input.length) fail("paquet RLE tronqué");
    const count = input[p++];
    if (count === 0) {
      const literal = input[p++];
      if (out.length + literal > LINE_BUFFER)
        fail("ligne décompressée trop longue");
      if (p + literal > input.length) fail("littéraux RLE tronqués");
      for (let i = 0; i < literal; i++) out.push(input[p++]);
    } else {
      const value = input[p++];
      if (out.length + count > LINE_BUFFER)
        fail("ligne décompressée trop longue");
      for (let i = 0; i < count; i++) out.push(value);
    }
  } while (p < input.length);
  return Uint8Array.from(out);
}

/**
 * Décompresseur de ligne B (`34bb:0142`, `gm_unpack_nibble`), `passes` fois de suite, la sortie d'une passe servant d'entrée
 * à la suivante. Paquets `00 k <k littéraux>` ou `c base <ceil(c/2) octets>` : chaque octet donne `base + (b >> 4)` puis
 * `base + (b & 15)` (modulo 256) ; si `c` est impair le dernier pixel est écarté.
 */
export function unpackNibble(input: Uint8Array, passes: number): Uint8Array {
  let data = input;
  for (let pass = 0; pass < passes; pass++) {
    if (data.length > LINE_BUFFER) fail("ligne compressée trop longue");
    const out: number[] = [];
    let p = 0;
    do {
      if (p + 2 > data.length) fail("paquet nibble tronqué");
      const count = data[p++];
      if (count === 0) {
        const literal = data[p++];
        if (out.length + literal > LINE_BUFFER)
          fail("ligne décompressée trop longue");
        if (p + literal > data.length) fail("littéraux nibble tronqués");
        for (let i = 0; i < literal; i++) out.push(data[p++]);
      } else {
        if (out.length + count > LINE_BUFFER + 1)
          fail("ligne décompressée trop longue");
        const base = data[p++];
        const bytes = (count + 1) >> 1;
        if (p + bytes > data.length) fail("paquet nibble tronqué");
        const start = out.length;
        for (let i = 0; i < bytes; i++) {
          const b = data[p++];
          out.push((base + (b >> 4)) & 0xff, (base + (b & 15)) & 0xff);
        }
        out.length = start + count;
      }
    } while (p < data.length);
    data = Uint8Array.from(out);
  }
  return passes === 0 ? data.slice() : data;
}

/** Entier du flux de lignes : somme d'octets tant qu'ils valent 0xFF (`1f94:028e` et `1f94:02d6`). */
function readVarInt(
  bytes: Uint8Array,
  reader: BinaryReader,
  what: string,
): number {
  let total = 0;
  let b: number;
  do {
    if (reader.offset >= bytes.length) fail(`${what} : fin de ressource`);
    b = reader.u8();
    total += b;
  } while (b === 0xff);
  return total;
}

/**
 * Décode une couche d'image (`gm_decode_scene_image`, `1f94:0008`) à partir de `reader.offset` : un octet de type, puis pour
 * chacune des `rect.height` lignes un entier `n` (passes), un entier `m` (longueur compressée, < 0x400) et `m` octets, qui
 * doivent se décompresser en exactement `rect.width` pixels.
 */
export function readSceneLayer(
  bytes: Uint8Array,
  reader: BinaryReader,
  rect: SceneRect,
  options: SceneOptions = {},
): SceneLayer {
  const start = reader.offset;
  if (start >= bytes.length) fail("couche hors de la ressource");
  const rawType = reader.u8();
  if (rawType > 2) fail(`type de couche ${rawType} inconnu`);
  const type = rawType as SceneLayerType;
  const nibble = type === 2;
  const recolor = type === 1 ? options.recolorType1 : undefined;
  const pixels = new Uint8Array(rect.width * rect.height);
  const passes: number[] = [];
  for (let y = 0; y < rect.height; y++) {
    const n = readVarInt(bytes, reader, `ligne ${y}`);
    if (n > MAX_PASSES) fail(`ligne ${y} : ${n} passes`);
    const m = readVarInt(bytes, reader, `ligne ${y}`);
    if (m >= LINE_BUFFER) fail(`ligne ${y} : ${m} octets compressés`);
    if (reader.offset + m > bytes.length)
      fail(`ligne ${y} : données tronquées`);
    const packed = reader.bytesView(m);
    const line = nibble ? unpackNibble(packed, n) : unpackRle(packed, n);
    if (line.length !== rect.width)
      fail(`ligne ${y} : ${line.length} pixels au lieu de ${rect.width}`);
    if (recolor)
      for (let x = 0; x < line.length; x++) line[x] = recolor[line[x]];
    pixels.set(line, y * rect.width);
    passes.push(n);
  }
  return {
    ...rect,
    type,
    pixels,
    passes,
    recolored: recolor !== undefined,
    size: reader.offset - start,
  };
}

/**
 * Ressource de scène complète, dans l'ordre lu par `gm_load_scene` (`1cc3:000e`) : en-tête de 0x30 octets, enregistrements
 * de 16 octets (grille), zones de 16 octets, 40 mots, couche A, couche B, points sensibles de 10 octets puis décors de 20 octets.
 * Les tailles de couche de l'en-tête et la taille totale de la ressource doivent tomber juste.
 */
export function readScene(data: Uint8Array, options: SceneOptions = {}): Scene {
  if (data.length < HEADER_BYTES) fail("ressource plus courte que l'en-tête");
  const reader = new BinaryReader(data);
  const words = new Uint16Array(HEADER_BYTES / 2);
  for (let i = 0; i < words.length; i++) words[i] = reader.u16();
  const rect: SceneRect = {
    x: words[4],
    y: words[5],
    width: words[6],
    height: words[7],
  };
  if (
    rect.x + rect.width > SCENE_SCREEN_WIDTH ||
    rect.y + rect.height > SCENE_SCREEN_HEIGHT
  ) {
    fail("rectangle hors de l'écran de 320 x 200");
  }
  const header: SceneHeader = {
    ...rect,
    id: words[0],
    decorCount: words[2],
    hotspotCount: words[3],
    planeCount: words[15],
    gridCount: words[16],
    zoneCount: words[17],
    limits: {
      xMin: words[9],
      xMax: words[10],
      yMin: words[11],
      yMax: words[12],
      pMin: words[13],
      pMax: words[14],
    },
    permutation: [...data.subarray(0x24, 0x2a)],
    layerSizes: [words[22], words[23]],
    words,
  };

  const take = (bytes: number, what: string): Uint8Array => {
    if (reader.offset + bytes > data.length)
      fail(`${what} hors de la ressource`);
    return reader.bytesView(bytes);
  };
  const grid = take(header.gridCount * GRID_RECORD_BYTES, "grille");
  const zoneBytes = take(header.zoneCount * ZONE_RECORD_BYTES, "zones");
  const wordTable = take(WORD_TABLE_BYTES, "table de mots");

  const layers: SceneLayer[] = [];
  for (const expected of header.layerSizes) {
    if (expected === 0) continue;
    const layer = readSceneLayer(data, reader, rect, options);
    if (layer.size !== expected)
      fail(`couche de ${layer.size} octets au lieu de ${expected}`);
    layers.push(layer);
  }

  const hotspotBytes = take(
    header.hotspotCount * HOTSPOT_RECORD_BYTES,
    "enregistrements de 10 octets",
  );
  const decorBytes = take(
    header.decorCount * OBJECT_RECORD_BYTES,
    "enregistrements de 20 octets",
  );
  if (reader.offset !== data.length)
    fail(`${data.length - reader.offset} octets en trop en fin de ressource`);

  const rangeView = new DataView(wordTable.buffer, wordTable.byteOffset, wordTable.byteLength);
  const rowRanges: RowRange[] = [];
  for (let i = 0; i < ROW_RANGE_COUNT; i++)
    rowRanges.push({ min: rangeView.getUint16(4 * i, true), max: rangeView.getUint16(4 * i + 2, true) });

  const zones: SceneZone[] = [];
  const zoneView = new DataView(zoneBytes.buffer, zoneBytes.byteOffset, zoneBytes.byteLength);
  for (let i = 0; i < header.zoneCount; i++) {
    const at = i * ZONE_RECORD_BYTES;
    zones.push({
      type: zoneBytes[at],
      plane: zoneBytes[at + 1],
      row: zoneView.getInt16(at + 2, true),
      colStart: zoneView.getInt16(at + 4, true),
      high: zoneView.getInt16(at + 6, true),
      low: zoneView.getInt16(at + 8, true),
      colEnd: zoneView.getInt16(at + 10, true),
      spare: zoneBytes.slice(at + 12, at + ZONE_RECORD_BYTES),
    });
  }

  const hotspots: SceneHotspot[] = [];
  const hotView = new DataView(hotspotBytes.buffer, hotspotBytes.byteOffset, hotspotBytes.byteLength);
  for (let i = 0; i < header.hotspotCount; i++) {
    const at = i * HOTSPOT_RECORD_BYTES;
    const [x0, x1, y0, y1] = [2, 4, 6, 8].map((o) => hotView.getInt16(at + o, true));
    const none = [x0, x1, y0, y1].every((v) => v === HOTSPOT_NO_RECT);
    hotspots.push({ messageId: hotView.getUint16(at, true), rect: none ? null : { x0, x1, y0, y1 } });
  }

  const decors: SceneDecor[] = [];
  const decorView = new DataView(decorBytes.buffer, decorBytes.byteOffset, decorBytes.byteLength);
  for (let i = 0; i < header.decorCount; i++) {
    const at = i * OBJECT_RECORD_BYTES;
    decors.push({
      num: decorView.getUint16(at, true),
      unused: decorView.getUint16(at + 2, true),
      gst: decorBytes[at + 4],
      mob: decorBytes[at + 5],
      dep: decorBytes[at + 6],
      txt: decorBytes[at + 7],
      ego: decorBytes[at + 8],
      fig: decorBytes[at + 9],
      light: decorView.getInt8(at + 10),
      hor: decorBytes[at + 11],
      x: decorView.getInt16(at + 12, true),
      y: decorView.getInt16(at + 14, true),
      p: decorView.getInt16(at + 16, true),
      plane: decorBytes[at + 18],
      ground: decorBytes[at + 19],
    });
  }
  return { header, layers, grid, zones, words: wordTable, rowRanges, hotspots, decors };
}
