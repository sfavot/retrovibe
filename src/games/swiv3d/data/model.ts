/**
 * Modèles 3D des niveaux `*.SLV` (blocs 10100-10991) : sommets, triangles texturés et normales d'ombrage.
 * Format établi par `gm_slv_index_models` (`004543f0`) et la boucle de rendu des objets de `gm_render_terrain`
 * (`0042718c`) ; voir `docs/swiv3d/models.md`. Le bloc est un seul tampon sans pointeur absolu : `+0x18` et
 * `+0x1c` sont des offsets relatifs au début du bloc (le jeu les transforme en pointeurs au chargement).
 *
 * En-tête (8 × i32 LE) puis trois tableaux contigus qui couvrent exactement le bloc :
 *   +0x00 nombre de sommets      +0x04 nombre de triangles     +0x08 nombre de normales
 *   +0x0c rayon² de collision    +0x10 décalage de pose (y)     +0x14 lumière ambiante
 *   +0x18 offset des triangles   +0x1c offset des normales
 * Sommets : 16 octets (x, y, z, mode) i32. Triangles : 42 octets. Normales : 12 octets (x, y, z) i32 d'environ 100.
 */
import { BinaryReader } from "../../../data/reader";
import type { BdArchive } from "./bd";

const HEADER_SIZE = 0x20;
const VERTEX_SIZE = 16;
const FACE_SIZE = 42;
const NORMAL_SIZE = 12;

/** Plage d'ids des blocs de modèles (`id / 1000 == 10`) ; l'emplacement de l'objet est `id % 1000`. */
export const MODEL_ID_MIN = 10000;
export const MODEL_ID_MAX = 10999;

/** Valeurs de `ModelVertex.mode` rencontrées (0, 1 et 2 dans les 5 niveaux). */
export const VERTEX_FREE = 0;
export const VERTEX_ON_GROUND = 1;
export const VERTEX_ABOVE_GROUND = 2;

export interface ModelVertex {
  x: number;
  y: number;
  z: number;
  /**
   * Quatrième i32 du sommet. 0 : sommet libre (y relatif à l'objet) ; 1 : collé au terrain (y = hauteur du sol sous le
   * sommet, seul le lacet est appliqué : ombre et pieds de coque) ; 2 : y de l'objet, mais jamais sous le sol.
   */
  mode: number;
}

export interface ModelNormal {
  x: number;
  y: number;
  z: number;
}

export interface ModelFace {
  /** Indices des trois sommets. */
  indices: [number, number, number];
  /** Indices (dans `normals`) de la normale d'ombrage de chaque sommet ; sans effet pour les types qui n'ombrent pas. */
  normalIndices: [number, number, number];
  /** Numéro de texture (champ `+0x18`, passé tel quel au rasteriseur) ; 16 dans la plupart des modèles. */
  texture: number;
  /** Coordonnées de texture par sommet (i16 signés, dans le repère de la tuile 64 × 64 ; 4 × en rendu). */
  u: [number, number, number];
  v: [number, number, number];
  /** Type de rendu (octet bas de `+0x28`) : 0, 1 (disque rotatif d'hélice), 2, 4, 5 ou 0x28 ; voir `docs/swiv3d/models.md`. */
  kind: number;
  /** Octet haut de `+0x28` : bit 1 = texture animée (décalage de v selon l'image). */
  flags: number;
}

export interface Model {
  id: number;
  /** Emplacement dans la table des modèles du jeu : `id % 1000`. */
  slot: number;
  vertexCount: number;
  faceCount: number;
  normalCount: number;
  /** Champ `+0x0c` : rayon de collision au carré (comparé à des distances au carré) ; valeur d'auteur, pas recalculable des sommets. */
  radiusSquared: number;
  /** Champ `+0x10` : le jeu pose l'objet à `hauteur du terrain - groundOffset` (négatif : le modèle est relevé de cette valeur). */
  groundOffset: number;
  /** Champ `+0x14` : lumière ambiante ajoutée à l'intensité calculée (plafond 0x6e). */
  ambient: number;
  facesOffset: number;
  normalsOffset: number;
  vertices: ModelVertex[];
  faces: ModelFace[];
  normals: ModelNormal[];
}

/** Lit un bloc 10xxx ; lève si les offsets de l'en-tête ne recouvrent pas exactement le bloc. */
export function parseModel(bytes: Uint8Array, id: number): Model {
  if (bytes.length < HEADER_SIZE) throw new Error(`modèle ${id} : bloc trop court`);
  const r = new BinaryReader(bytes);
  const vertexCount = r.u32();
  const faceCount = r.u32();
  const normalCount = r.u32();
  const radiusSquared = r.i32();
  const groundOffset = r.i32();
  const ambient = r.i32();
  const facesOffset = r.u32();
  const normalsOffset = r.u32();

  const expectedFaces = HEADER_SIZE + vertexCount * VERTEX_SIZE;
  const expectedNormals = facesOffset + faceCount * FACE_SIZE;
  if (facesOffset !== expectedFaces || normalsOffset !== expectedNormals || normalsOffset + normalCount * NORMAL_SIZE !== bytes.length) {
    throw new Error(`modèle ${id} : tableaux incohérents avec la taille du bloc (${bytes.length} octets)`);
  }

  const vertices: ModelVertex[] = [];
  for (let i = 0; i < vertexCount; i++) vertices.push({ x: r.i32(), y: r.i32(), z: r.i32(), mode: r.i32() });

  const faces: ModelFace[] = [];
  for (let i = 0; i < faceCount; i++) {
    const indices: [number, number, number] = [r.u32(), r.u32(), r.u32()];
    const normalIndices: [number, number, number] = [r.u32(), r.u32(), r.u32()];
    const texture = r.i32();
    const u: [number, number, number] = [r.i16(), r.i16(), r.i16()];
    const v: [number, number, number] = [r.i16(), r.i16(), r.i16()];
    const type = r.u16();
    faces.push({ indices, normalIndices, texture, u, v, kind: type & 0xff, flags: type >> 8 });
  }

  const normals: ModelNormal[] = [];
  for (let i = 0; i < normalCount; i++) normals.push({ x: r.i32(), y: r.i32(), z: r.i32() });

  return {
    id,
    slot: id % 1000,
    vertexCount,
    faceCount,
    normalCount,
    radiusSquared,
    groundOffset,
    ambient,
    facesOffset,
    normalsOffset,
    vertices,
    faces,
    normals,
  };
}

/** Ids des blocs de modèles présents dans un niveau, par ordre croissant. */
export function listModels(bd: BdArchive): number[] {
  return bd.entries
    .map((entry) => entry.id)
    .filter((id) => id >= MODEL_ID_MIN && id <= MODEL_ID_MAX)
    .sort((a, b) => a - b);
}
