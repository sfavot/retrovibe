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
 *   - 12000-12004 : jeux de textures (voir `Tileset`) ; 12000 = 32 tuiles de sol 64×64 contiguës.
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

/** Une tuile de texture fait 64×64 octets. */
export const TILE_SIZE = 64;
/** Tuile de sol de la carte 102 : `valeur >> 3` (`< 0x20` : tuiles 0 à 3 = eau, la tuile 0 est animée). */
export const GROUND_TILE_SHIFT = 3;

/** Taille d'un enregistrement du bloc 105, en octets (16 u32). */
export const OBJECT_RECORD_SIZE = 64;
/** Nombre de paramètres d'un objet après `type`, `x`, `z` et `angle`. */
export const OBJECT_PARAM_COUNT = 12;

/** Première valeur de `LevelObject.subtype` qui désigne un groupe d'objectifs (`5000 + g`, `g` de 0 à 9 ; `0043cda4`). */
export const OBJECTIVE_GROUP_BASE = 5000;
/** Nombre de groupes d'objectifs (`5000..5009`). */
export const OBJECTIVE_GROUP_COUNT = 10;

/**
 * Objet placé dans le niveau (bloc 105, `REC[0..15]` dans `docs/swiv3d/objects.md`). Les champs nommés sont ceux que lit
 * `gm_level_spawn_objects` ; `params` garde les champs 4 à 15 bruts, pour les types dont les champs 9 à 15 ne sont pas nommés.
 */
export interface LevelObject {
  /** `REC[0]` : 1000-1002 : départs des joueurs ; 2000-2003 : ennemis ; 3000+ : bâtiments, bonus, décors (liste dans la doc). */
  type: number;
  /** `REC[1]`, `REC[2]` : position dans le plan, en unités d'objet (64 par cellule de carte ; le monde est torique et TERRAN03 dépasse WORLD_SIZE). */
  x: number;
  z: number;
  /** `REC[3]` : cap, sur 512 pas par tour. */
  angle: number;
  /** `REC[4]` : modèle du corps (emplacement `id % 1000` ; modèle des avions engendrés pour 6300 ; non lu pour 1000-1002). */
  model: number;
  /** `REC[5]` : modèle de l'enfant (tourelle, antenne) ou du bonus (porté par un 2000, posé par 7000/7002). */
  childModel: number;
  /** `REC[6]` : points de vie du corps (l'enfant reprend les mêmes). */
  hitPoints: number;
  /**
   * `REC[7]` : code d'arme des tourelles, chars, bateaux et avions (100-701) ; bonus `1000 + n` (porté ou posé) ; groupe
   * d'objectifs `5000 + g` (voir `objectiveGroup`). Aucune autre valeur n'est lue. Ce n'est pas un sous-modèle.
   */
  subtype: number;
  /** `REC[8]` : vitesse/poussée propre au type (`+0x0c` de l'objet ; chars et bateaux : 0, 40 ou 50 ; poussée = `3 × thrust`). */
  thrust: number;
  /** Champs 4 à 15 de l'enregistrement (signés), donc `params[i]` = champ `i + 4`. Les champs 9 et 10 ne sont pas lus par le jeu ; 11 à 15 sont les paramètres des fabriques et hangars. */
  params: number[];
}

/** Groupe d'objectifs (0 à 9) d'un objet, ou `null` si `subtype` n'est pas dans `5000..5009`. */
export function objectiveGroup(object: Pick<LevelObject, "subtype">): number | null {
  const g = object.subtype - OBJECTIVE_GROUP_BASE;
  return g >= 0 && g < OBJECTIVE_GROUP_COUNT ? g : null;
}

/**
 * Compteurs de capacité d'un nœud : nombre de véhicules de la classe que le nœud accepte encore (`> 0` = libre ; vaut 1
 * presque partout, donc un seul véhicule par nœud et par classe). Un véhicule qui s'y engage retranche 1, en partant ajoute 1.
 */
export interface WaypointCapacity {
  /** Champ 6 (`+0x18`) : navires (`5500`, `004263bc`) ; 0 partout sauf les nœuds d'eau de TERRAN02 et DEMO. */
  ships: number;
  /** Champ 7 (`+0x1c`) : aéronefs (`4002`, `004264d4`). */
  aircraft: number;
  /** Champ 8 (`+0x20`) : véhicules terrestres (`5000`, `5002`, `6000` et ses chars, `004262a4`). */
  ground: number;
}

/** Nœud du réseau du bloc 107 : liens vers d'autres nœuds (indice, -1 si aucun), position et capacités. Chemins suivis par les véhicules ennemis. */
export interface Waypoint {
  /** Quatre liens : précédent, suivant, puis deux branches. */
  links: [number, number, number, number];
  x: number;
  z: number;
  /** Champs 6, 7, 8 : capacité par classe de véhicule. */
  capacity: WaypointCapacity;
}

/** Jeu de textures d'un bloc 12xxx. */
export interface Tileset {
  id: number;
  /** 0x8000 octets (128 lignes de 256) copiés par le jeu à une adresse alignée : table de lumière `[lumière][texel] → indice de la palette 11003` ; la ligne 100 sert aux faces de type 4 (non éclairées). */
  lightTable: Uint8Array;
  /**
   * Disposition des pixels. `"tiles"` (12000) : 32 tuiles 64×64 **contiguës** (4096 octets chacune, pas de ligne 64), lues
   * ainsi par le terrain. `"grid"` (12001-12004) : atlas 256×256 de 4×4 tuiles 64×64, pas de ligne 256.
   */
  layout: "tiles" | "grid";
  /** Nombre de tuiles 64×64 : 32 (12000) ou 16 (12001-12004). */
  tileCount: number;
  /** Largeur des pixels stockés : 64 (`"tiles"`) ou 256 (`"grid"`). */
  width: number;
  /** Hauteur des pixels stockés : 2048 (`"tiles"`, 32 tuiles empilées) ou 256 (`"grid"`). */
  height: number;
  /** Pixels indexés, `width × height` (indices de la palette de queue ; voir `tileOffset` pour adresser une tuile). */
  pixels: Uint8Array;
  /** Palette RGB 8 bits (768 octets) stockée à la suite des pixels : RVB de la couleur d'atlas à pleine luminosité (≈ ligne 126 de `lightTable`). Le jeu ne la lit pas ; le rendu logiciel passe par `lightTable` puis la palette 11003. L'indice 0 est le magenta de transparence dans 12001-12004. */
  palette: Uint8Array;
  /** Octets restants après la palette : 0x180 dans 12000 (motif de 3 u32 répété), vide sinon. */
  trailer: Uint8Array;
}

/** Offset, dans `Tileset.pixels`, du texel (0, 0) de la tuile `k`, et pas de ligne à utiliser (`tileStride`) pour la lire. */
export function tileOffset(tileset: Pick<Tileset, "layout">, k: number): number {
  return tileset.layout === "tiles"
    ? k * TILE_SIZE * TILE_SIZE
    : (k >> 2) * TILE_SIZE * 256 + (k & 3) * TILE_SIZE;
}

/** Pas de ligne des pixels d'une tuile : 64 (12000) ou 256 (12001-12004). */
export function tileStride(tileset: Pick<Tileset, "layout">): number {
  return tileset.layout === "tiles" ? TILE_SIZE : 256;
}

export interface Level {
  name: string;
  /** Bloc 100 : hauteur, `MAP_SIZE²` octets, index `z * 512 + x`. Bornes observées 28..255 ; l'eau est à 28-30. */
  heightmap: Uint8Array;
  /** Bloc 102 : indice de couleur du sol par cellule ; `< WATER_THRESHOLD` = eau. Tuile de 12000 (`tileOffset`) = `valeur >> GROUND_TILE_SHIFT` (`docs/swiv3d/render.md` §6.1). Sert aussi d'indice de colonne à la table 106 (terrain de faible détail). */
  groundMap: Uint8Array;
  /** Bloc 103 : couleurs précalculées du terrain vu de dessus (le jeu le passe à `gm_draw_overlay_sw`), indices de `palette`. */
  colorMap: Uint8Array;
  /** Palette RGB 8 bits (768 octets) du jeu : 0x300 premiers octets du bloc 11003 (VGA 6 bits) via `vga6ToRgb8`. C'est la palette d'exécution : tout pixel du niveau est un indice de celle-ci (le jeu la passe par une gamma 4×64, identité au niveau 0), les textures y arrivent par `Tileset.lightTable`. */
  palette: Uint8Array;
  /** Bloc 104 : 1 048 octets, en-tête de 6 u32 (`0x93 0x93 0x93 1 1 0`) puis 64 groupes de 4 u32 ; rampes de couleurs ? Non lu par le code. */
  rampTable: Uint8Array;
  /** Bloc 105 sans le terminateur. */
  objects: LevelObject[];
  /** Bloc 107 sans le nœud terminal. */
  waypoints: Waypoint[];
  /** Bloc 106 : 64 lignes × 256 octets, terrain de faible détail : `couleur = t106[(lumière >> 1) << 8 | carte102]` (`004147df`). */
  pattern106: Uint8Array;
  /** Bloc 108 : table 256×256 de fondu des sprites RLE (`005bc180`). */
  fadeTable: Uint8Array;
  /** Bloc 109 : table de 128 lignes de 256 octets (`005bc13c`, ligne 0 = identité), utilisée par les tracés de sprites. */
  lightTable109: Uint8Array;
  /** Bloc 110 : 256×256 octets, silhouettes d'ombres à 32 niveaux (0..31), projetées au sol par les faces de type 0x28. */
  shadowSprites: Uint8Array;
  /** Bloc 500 : 48 lignes × 256 octets (12 288) ; lignes 0..31 : table d'assombrissement `dst' = t500[s << 8 | dst]` (ombres) ; lignes 32..47 : image 64×64 de flou du rotor (type 1, valeurs 0..31). */
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
    const [model, childModel, hitPoints, subtype, thrust] = params as [number, number, number, number, number];
    objects.push({ type, x, z, angle, model, childModel, hitPoints, subtype, thrust, params });
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
    const [l0, l1, l2, l3, x, z, ships, aircraft, ground] = i32s(r, WAYPOINT_SIZE / 4);
    // Le nœud terminal est entièrement à zéro, sauf `-1` dans le compteur des navires (champ 6).
    if (ships === -1) break;
    nodes.push({ links: [l0, l1, l2, l3], x, z, capacity: { ships, aircraft, ground } });
  }
  return nodes;
}

const LIGHT_TABLE_SIZE = 0x8000;
const TILESET_HEADER = 0x100;

function parseTileset(id: number, bytes: Uint8Array): Tileset {
  const layout = id === 12000 ? "tiles" : "grid";
  const tileCount = id === 12000 ? 32 : 16;
  const pixelsStart = TILESET_HEADER + LIGHT_TABLE_SIZE;
  const paletteStart = pixelsStart + tileCount * TILE_SIZE * TILE_SIZE;
  if (bytes.length < paletteStart + 768)
    throw new Error(`bloc ${id} trop court (${bytes.length} octets)`);
  return {
    id,
    lightTable: bytes.subarray(TILESET_HEADER, pixelsStart),
    layout,
    tileCount,
    width: layout === "tiles" ? TILE_SIZE : 256,
    height: (tileCount * TILE_SIZE * TILE_SIZE) / (layout === "tiles" ? TILE_SIZE : 256),
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

/** Tuile de 12000 qui texture la cellule de la carte 102 de valeur `ground`. */
export function groundTile(ground: number): number {
  return ground >> GROUND_TILE_SHIFT;
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
