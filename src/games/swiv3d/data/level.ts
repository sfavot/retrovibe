/**
 * Niveau `*.SLV` de SWIV 3D, hors modèles 3D (blocs 10xxx, lus par `model.ts`). Format détaillé dans `docs/swiv3d/slv.md`.
 *
 * Conteneur `.BD` (voir `bd.ts`). Blocs lus ici :
 *   - 100 : carte de hauteur 512×512 octets, torique ;
 *   - 102 : carte « sol » 512×512 (indice de couleur du terrain) ; < 0x20 = eau ;
 *   - 103 : carte de couleurs 512×512 précalculée (palette du bloc 11003) ;
 *   - 104 : table de rampes de couleurs (non lue par le code, brute) ;
 *   - 105 : placement des objets, enregistrements de 64 octets terminés par un type -1 ;
 *   - 106, 108, 109, 110, 500 : tables et sprites de rendu, exposés bruts ;
 *   - 107 : réseau de points de passage (nœuds de 36 octets) ;
 *   - 11003 : seuls ses 0x300 premiers octets (palette VGA 6 bits du jeu) sont lus ici ;
 *   - 12000-12004 : jeux de textures (voir `Tileset`).
 */
import { BinaryReader } from "../../../data/reader";
import { vga6ToRgb8 } from "../../../ui/indexed-canvas";
import { parseBd } from "./bd";

/** Côté des cartes 100, 102 et 103, en cellules (le monde est torique : les indices sont pris modulo 512). */
export const MAP_SIZE = 512;
/** Unités de position des objets (et des nœuds 107) par cellule de carte : `gm_terrain_height` prend `x << 8` et décale de 14. */
export const UNITS_PER_CELL = 64;
/** Côté du monde en unités de position d'objet. */
export const WORLD_SIZE = MAP_SIZE * UNITS_PER_CELL;
/** Une unité de hauteur de la carte 100 vaut 4 unités de position d'objet (`octet * 0x400 >> 8`). */
export const HEIGHT_UNITS = 4;
/** Valeurs de la carte 102 strictement inférieures à ce seuil : eau (`octet & 0xe0 == 0`, surface animée par le jeu). */
export const WATER_THRESHOLD = 0x20;

/** Taille d'un enregistrement du bloc 105, en octets (16 u32). */
export const OBJECT_RECORD_SIZE = 64;
/** Nombre de paramètres d'un objet après `type`, `x`, `z` et `angle`. */
export const OBJECT_PARAM_COUNT = 12;

/** Objet placé dans le niveau (bloc 105). Les champs 4 à 15 dépendent du type : seuls ceux utilisés par `gm_level_spawn_objects` sont décrits dans la doc. */
export interface LevelObject {
  /** 1000-1002 : départs des joueurs ; 2000-2003 : ennemis ; 3000+ : bâtiments, bonus, décors (liste dans la doc). */
  type: number;
  /** Position dans le plan, en unités d'objet (64 par cellule de carte ; le monde est torique et TERRAN03 dépasse WORLD_SIZE). */
  x: number;
  z: number;
  /** Cap, sur 512 pas par tour. */
  angle: number;
  /** Champs 4 à 15 de l'enregistrement (signés), donc `params[i]` = champ `i + 4` ; `params[3]` (champ 7) est le sous-type des ennemis 2000 et 2003, `params[1]` et `params[2]` (champs 5 et 6) sont passés aux comportements. */
  params: number[];
}

/** Nœud du réseau du bloc 107 : liens vers d'autres nœuds (indice, -1 si aucun) et position. Hypothèse : chemins ou routes suivis par les unités. */
export interface Waypoint {
  /** Quatre liens : précédent, suivant, puis deux branches. */
  links: [number, number, number, number];
  x: number;
  z: number;
  /** Trois derniers u32 de l'enregistrement : `0, 1, 1` presque partout ; sens inconnu. */
  flags: [number, number, number];
}

/** Jeu de textures d'un bloc 12xxx. */
export interface Tileset {
  id: number;
  /** 0x8000 octets (128 lignes de 256) copiés par le jeu à une adresse alignée : table de teintes ; la ligne 100 sert de table de recodage des couleurs. */
  lightTable: Uint8Array;
  /** Largeur de l'atlas (256). */
  width: number;
  /** Hauteur de l'atlas : 256 (12001-12004 : 4×4 tuiles de 64×64) ou 512 (12000 : texture de sol). */
  height: number;
  /** Pixels indexés, `width × height`. */
  pixels: Uint8Array;
  /** Palette RGB 8 bits (768 octets) stockée à la suite de l'atlas ; l'indice 0 est le magenta de transparence dans 12001-12004. */
  palette: Uint8Array;
  /** Octets restants après la palette : 0x180 dans 12000 (motif de 3 u32 répété), vide sinon. */
  trailer: Uint8Array;
}

export interface Level {
  name: string;
  /** Bloc 100 : hauteur, `MAP_SIZE²` octets, index `z * 512 + x`. Bornes observées 28..255 ; l'eau est à 28-30. */
  heightmap: Uint8Array;
  /** Bloc 102 : indice de couleur du sol par cellule ; `< WATER_THRESHOLD` = eau. Dans 12000, la ligne de texture est `2 × valeur` (hypothèse forte, vue sur le rendu). */
  groundMap: Uint8Array;
  /** Bloc 103 : couleurs précalculées du terrain vu de dessus (le jeu le passe à `gm_draw_overlay_sw`), indices de `palette`. */
  colorMap: Uint8Array;
  /** Palette RGB 8 bits (768 octets) du jeu : 0x300 premiers octets du bloc 11003 (VGA 6 bits) via `vga6ToRgb8`. */
  palette: Uint8Array;
  /** Bloc 104 : 1 048 octets, en-tête de 6 u32 (`0x93 0x93 0x93 1 1 0`) puis 64 groupes de 4 u32 ; rampes de couleurs ? Non lu par le code. */
  rampTable: Uint8Array;
  /** Bloc 105 sans le terminateur. */
  objects: LevelObject[];
  /** Bloc 107 sans le nœud terminal. */
  waypoints: Waypoint[];
  /** Bloc 106 : 128×128 octets, motif périodique (rôle inconnu, lu par un tracé de spans texturés). */
  pattern106: Uint8Array;
  /** Bloc 108 : table 256×256 de fondu des sprites RLE (`005bc180`). */
  fadeTable: Uint8Array;
  /** Bloc 109 : table de 128 lignes de 256 octets (`005bc13c`, ligne 0 = identité), utilisée par les tracés de sprites. */
  lightTable109: Uint8Array;
  /** Bloc 110 : 256×256 octets, silhouettes d'avions à 32 niveaux (0..31), apparemment les ombres au sol. */
  shadowSprites: Uint8Array;
  /** Bloc 500 : 12 288 octets (3 × 64 × 64) ; commence par trois lignes `00..3f`, `40..7f`, `80..bf` ; rôle inconnu. */
  table500: Uint8Array;
  /** Jeux de textures 12000-12004 (dans l'ordre des ids). */
  tilesets: Tileset[];
}

/** Lit un tableau d'entiers signés de 32 bits à partir d'une plage d'octets. */
function i32s(r: BinaryReader, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(r.u32() | 0);
  return out;
}

function parseObjects(bytes: Uint8Array, name: string): LevelObject[] {
  if (bytes.length % OBJECT_RECORD_SIZE !== 0)
    throw new Error(`${name} : bloc 105 de ${bytes.length} octets`);
  const r = new BinaryReader(bytes);
  const objects: LevelObject[] = [];
  while (!r.isAtEnd) {
    const [type, x, z, angle, ...params] = i32s(r, OBJECT_RECORD_SIZE / 4);
    if (type === -1) break;
    objects.push({ type, x, z, angle, params });
  }
  return objects;
}

const WAYPOINT_SIZE = 36;

function parseWaypoints(bytes: Uint8Array, name: string): Waypoint[] {
  if (bytes.length % WAYPOINT_SIZE !== 0)
    throw new Error(`${name} : bloc 107 de ${bytes.length} octets`);
  const r = new BinaryReader(bytes);
  const nodes: Waypoint[] = [];
  while (!r.isAtEnd) {
    const [l0, l1, l2, l3, x, z, f0, f1, f2] = i32s(r, WAYPOINT_SIZE / 4);
    // Le nœud terminal est entièrement à zéro, sauf `-1` à la place du premier drapeau.
    if (f0 === -1) break;
    nodes.push({ links: [l0, l1, l2, l3], x, z, flags: [f0, f1, f2] });
  }
  return nodes;
}

const LIGHT_TABLE_SIZE = 0x8000;
const TILESET_HEADER = 0x100;

function parseTileset(id: number, bytes: Uint8Array): Tileset {
  const height = id === 12000 ? 512 : 256;
  const pixelsStart = TILESET_HEADER + LIGHT_TABLE_SIZE;
  const paletteStart = pixelsStart + 256 * height;
  if (bytes.length < paletteStart + 768)
    throw new Error(`bloc ${id} trop court (${bytes.length} octets)`);
  return {
    id,
    lightTable: bytes.subarray(TILESET_HEADER, pixelsStart),
    width: 256,
    height,
    pixels: bytes.subarray(pixelsStart, paletteStart),
    palette: bytes.subarray(paletteStart, paletteStart + 768),
    trailer: bytes.subarray(paletteStart + 768),
  };
}

function expectSize(
  name: string,
  id: number,
  bytes: Uint8Array,
  size: number,
): Uint8Array {
  if (bytes.length !== size)
    throw new Error(
      `${name} : bloc ${id} de ${bytes.length} octets au lieu de ${size}`,
    );
  return bytes;
}

export function parseLevel(bytes: Uint8Array, name = "SLV"): Level {
  const bd = parseBd(bytes, name);
  const sized = (id: number, size: number) =>
    expectSize(name, id, bd.get(id), size);
  const cells = MAP_SIZE * MAP_SIZE;

  const tilesets = bd.entries
    .map((e) => e.id)
    .filter((id) => Math.floor(id / 1000) === 12)
    .sort((a, b) => a - b)
    .map((id) => parseTileset(id, bd.get(id)));

  const paletteBlock = bd.get(11003);
  if (paletteBlock.length < 768)
    throw new Error(`${name} : bloc 11003 trop court`);

  return {
    name,
    heightmap: sized(100, cells),
    groundMap: sized(102, cells),
    colorMap: sized(103, cells),
    palette: vga6ToRgb8(paletteBlock.subarray(0, 768)),
    rampTable: sized(104, 1048),
    objects: parseObjects(bd.get(105), name),
    waypoints: parseWaypoints(bd.get(107), name),
    pattern106: sized(106, 128 * 128),
    fadeTable: sized(108, 256 * 256),
    lightTable109: sized(109, 128 * 256),
    shadowSprites: sized(110, 256 * 256),
    table500: sized(500, 3 * 64 * 64),
    tilesets,
  };
}

/** Hauteur de la carte 100 à la cellule (cx, cz), avec repli torique. */
export function heightAt(
  level: Pick<Level, "heightmap">,
  cx: number,
  cz: number,
): number {
  return level.heightmap[
    (cz & (MAP_SIZE - 1)) * MAP_SIZE + (cx & (MAP_SIZE - 1))
  ];
}
