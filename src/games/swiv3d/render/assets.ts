/**
 * Ressources du rendu, construites une fois à partir du niveau, des modèles et de `GLOBAL.BD`. Aucune donnée du niveau n'est
 * modifiée : la tuile d'eau animée vit dans une copie (`groundTiles`).
 */
import { MAP_SIZE, type Level } from "../data/level";
import type { GlobalData } from "../data/global";
import type { Model } from "../data/model";

/** Emplacement de texture d'un modèle (`005b0690[t]` / `005b1950[t]`, `render.md` §2) : tuile de pixels et table de lumière. */
export interface TextureSlot {
  /** Pixels indexés ; le texel `(u, v)` est à `offset + v * 256 + u` (pas de ligne de 256, même pour 12000). */
  pixels: Uint8Array;
  offset: number;
  /** Table de lumière 128 × 256 : `light[ligne << 8 | texel]` → indice de la palette 11003. */
  light: Uint8Array;
}

/** Modèle réduit à des tableaux typés (sommets `x y z mode`, faces, normales). */
export interface PreparedModel {
  slot: number;
  ambient: number;
  groundOffset: number;
  vertexCount: number;
  /** `x, y, z, mode` par sommet. */
  vertices: Int32Array;
  faceCount: number;
  indices: Int32Array; // 3 par face
  normalIndices: Int32Array; // 3 par face
  texture: Int32Array;
  u: Int32Array; // 3 par face
  v: Int32Array; // 3 par face
  kind: Uint8Array;
  flags: Uint8Array;
  normalCount: number;
  normals: Int32Array; // 3 par normale
}

export interface RenderAssets {
  /** Palette d'exécution (SLV 11003 en RGB 8 bits, 768 octets). */
  palette: Uint8Array;
  /** Cartes 100 et 102 (512×512, toriques). */
  heightmap: Uint8Array;
  groundMap: Uint8Array;
  /** 32 tuiles de sol 64×64 contiguës (12000), copie modifiable (tuile 0 = eau animée). */
  groundTiles: Uint8Array;
  /** Table de lumière du sol (12000). */
  groundLight: Uint8Array;
  /** 200 emplacements de texture des modèles. */
  slots: TextureSlot[];
  /** Modèles par emplacement (`id % 1000`). */
  models: Map<number, PreparedModel>;
  /** SLV 110 (silhouettes d'ombre 256×256, 0..31) et SLV 500 (48 × 256 : assombrissement puis flou du rotor). */
  shadowSprites: Uint8Array;
  table500: Uint8Array;
  /** SLV 109 : table de teintes 128 × 256 (sprites, faces de type 5). */
  table109: Uint8Array;
  /** `GLOBAL 504` : images 64×64 ligne par ligne ; `GLOBAL 505` : images 21×35 ligne par ligne. */
  images504: Uint8Array[];
  images505: Uint8Array[];
}

export interface RenderAssetsInput {
  level: Level;
  /** Modèles du niveau (`parseModel`) ; un modèle par emplacement. */
  models: readonly Model[];
  global: Pick<GlobalData, "textures" | "sprites21x35">;
}

const SLOT_COUNT = 200;

function prepareModel(model: Model): PreparedModel {
  const { faces, vertices, normals } = model;
  const prepared: PreparedModel = {
    slot: model.slot,
    ambient: model.ambient,
    groundOffset: model.groundOffset,
    vertexCount: vertices.length,
    vertices: new Int32Array(vertices.length * 4),
    faceCount: faces.length,
    indices: new Int32Array(faces.length * 3),
    normalIndices: new Int32Array(faces.length * 3),
    texture: new Int32Array(faces.length),
    u: new Int32Array(faces.length * 3),
    v: new Int32Array(faces.length * 3),
    kind: new Uint8Array(faces.length),
    flags: new Uint8Array(faces.length),
    normalCount: normals.length,
    normals: new Int32Array(normals.length * 3),
  };
  vertices.forEach((p, i) => prepared.vertices.set([p.x, p.y, p.z, p.mode], i * 4));
  normals.forEach((n, i) => prepared.normals.set([n.x, n.y, n.z], i * 3));
  faces.forEach((f, i) => {
    prepared.indices.set(f.indices, i * 3);
    prepared.normalIndices.set(f.normalIndices, i * 3);
    prepared.texture[i] = f.texture;
    prepared.u.set(f.u, i * 3);
    prepared.v.set(f.v, i * 3);
    prepared.kind[i] = f.kind;
    prepared.flags[i] = f.flags;
  });
  return prepared;
}

/** Construit les ressources du rendu (`docs/swiv3d/render.md` §2 : tables de lumière, emplacements de texture). */
export function createRenderAssets({ level, models, global }: RenderAssetsInput): RenderAssets {
  const tileset = (id: number) => {
    const found = level.tilesets.find((t) => t.id === id);
    if (!found) throw new Error(`rendu : jeu de textures ${id} absent`);
    return found;
  };
  const ground = tileset(12000);
  const groundTiles = ground.pixels.slice();

  // Table de lumière : pour 12001-12004 la colonne 0 de chaque ligne est remise à 0 (le texel 0 devient noir).
  const lightOf = (id: number): Uint8Array => {
    const light = tileset(id).lightTable.slice();
    if (id !== 12000) for (let row = 0; row < 128; row++) light[row * 256] = 0;
    return light;
  };
  const groundLight = lightOf(12000);
  const lights = new Map<number, Uint8Array>([[12000, groundLight]]);
  for (let n = 1; n <= 4; n++) lights.set(12000 + n, lightOf(12000 + n));

  // `t = 0..199` pointent d'abord sur 12000 ; les emplacements 16n..16n+15 (n = 1..4) sont remplacés par la tuile k de 12000+n.
  const slots: TextureSlot[] = [];
  for (let t = 0; t < SLOT_COUNT; t++) {
    const n = t >> 4;
    if (t >= 16 && t < 80) {
      const k = t & 15;
      slots.push({
        pixels: tileset(12000 + n).pixels,
        offset: (k >> 2) * 0x4000 + (k & 3) * 0x40,
        light: lights.get(12000 + n)!,
      });
    } else {
      slots.push({ pixels: groundTiles, offset: 0, light: groundLight });
    }
  }

  const prepared = new Map<number, PreparedModel>();
  for (const model of models) prepared.set(model.slot, prepareModel(model));

  if (level.heightmap.length !== MAP_SIZE * MAP_SIZE) throw new Error("rendu : carte de hauteur invalide");
  return {
    palette: level.palette,
    heightmap: level.heightmap,
    groundMap: level.groundMap,
    groundTiles,
    groundLight,
    slots,
    models: prepared,
    shadowSprites: level.shadowSprites,
    table500: level.table500,
    table109: level.lightTable109,
    images504: global.textures,
    images505: global.sprites21x35,
  };
}
