/**
 * Propriétés d'une pièce, `PART0` à `PART148.PAR` (`docs/tim3/formats.md` § 6, `docs/tim3/engine.md` § 2).
 *
 * ```
 * "PAR:" u32 taille ; "PROP" ; u8 'I' ; u8 1 ; u16 idPièce ;
 * 14 × u16 : densité, masse, élasticité, drapeaux, 0, frottement ?, frottement ?, ?, ?, largeur, hauteur, drapeaux de forme,
 *            nombre de polygones, nombre total de sommets ;
 * par polygone : u16, u16 (sens inconnu) puis des sommets { u16 drapeau, u16 x, u16 y } ; le dernier a le bit 0x4000.
 * ```
 * Les cinq premiers mots remplissent les champs du descripteur de type (densité +0x4C, masse +0x50, élasticité +0x54). Le chargeur
 * de l'exécutable (433b54) lit les « 11 mots » avant les formes. Les sens non établis gardent le nom `unknownXX` (XX = rang du mot).
 */
import { BinaryReader } from "../../../data/reader";

/** Bits de `shapeFlags` qui font produire des copies en miroir des polygones (engine.md § 2 : 0x8 et 0x10 ; supposé pour l'axe). */
export const SHAPE_MIRROR_FLAGS = 0x18;
/** Drapeau du dernier sommet d'un polygone. */
export const VERTEX_LAST = 0x4000;

export interface PartVertex {
  /** Mot de drapeau : 0, ou `VERTEX_LAST` sur le dernier sommet. */
  readonly flag: number;
  readonly x: number;
  readonly y: number;
}

export interface PartPolygon {
  /** 1er mot d'en-tête du polygone (pièce « chat » : 71 ; souvent 0) : sens inconnu. */
  readonly unknownA: number;
  /** 2e mot d'en-tête du polygone : sens inconnu. */
  readonly unknownB: number;
  readonly vertices: PartVertex[];
}

export interface PartDef {
  readonly id: number;
  /** Mot 0 : densité (bowling 2832, ballon 9, murs 4153 ; l'air vaut 67, cf. engine.md). Descripteur +0x4C. */
  readonly density: number;
  /** Mot 1 : masse (bowling 200, ballon 1, murs 1000). Descripteur +0x50. */
  readonly mass: number;
  /** Mot 2 : élasticité (balle magique 0x200, bowling 0x80, murs 0x400). Descripteur +0x54. */
  readonly elasticity: number;
  /** Mot 3 : drapeaux de comportement (0x10, 0x20, 0x18, 0x40…) : bits non décodés. */
  readonly flags: number;
  /** Mot 4 : toujours 0 dans les 149 fichiers. */
  readonly unknown04: number;
  /** Mot 5 : 0, 0x10, 0x20, 0x30 ou 0xF0 ; frottement ? (supposé). */
  readonly unknown05: number;
  /** Mot 6 : mêmes valeurs que le mot 5 ; frottement ? (supposé). */
  readonly unknown06: number;
  /** Mot 7 : 0, 64, 96 ou 576 (murs, pentes) : sens inconnu. */
  readonly unknown07: number;
  /** Mot 8 : 0, 416 ou 512 : sens inconnu. */
  readonly unknown08: number;
  /** Mot 9 : largeur en pixels. */
  readonly width: number;
  /** Mot 10 : hauteur en pixels. */
  readonly height: number;
  /** Mot 11 : drapeaux de forme ; 0x8 et 0x10 = copies en miroir (`SHAPE_MIRROR_FLAGS`). */
  readonly shapeFlags: number;
  readonly polygons: PartPolygon[];
}

export function readPartDef(bytes: Uint8Array): PartDef {
  const r = new BinaryReader(bytes);
  if (r.tag() !== "PAR:") throw new Error("TIM3 : PAR sans signature « PAR: »");
  if (r.u32() !== bytes.length - 8) throw new Error("TIM3 : taille de PAR incohérente");
  if (r.tag() !== "PROP" || r.u8() !== 0x49 || r.u8() !== 1) throw new Error("TIM3 : en-tête PROP inconnu");
  const id = r.u16();
  const w: number[] = [];
  for (let i = 0; i < 14; i++) w.push(r.u16());
  const [polygonCount, vertexTotal] = [w[12], w[13]];

  const polygons: PartPolygon[] = [];
  let vertexCount = 0;
  for (let p = 0; p < polygonCount; p++) {
    const unknownA = r.u16();
    const unknownB = r.u16();
    const vertices: PartVertex[] = [];
    for (;;) {
      if (r.offset + 6 > r.length) throw new Error("TIM3 : polygone de PAR tronqué");
      const v = { flag: r.u16(), x: r.u16(), y: r.u16() };
      vertices.push(v);
      vertexCount++;
      if (v.flag & VERTEX_LAST) break;
    }
    polygons.push({ unknownA, unknownB, vertices });
  }
  if (vertexCount !== vertexTotal) throw new Error("TIM3 : nombre de sommets de PAR incohérent");
  if (!r.isAtEnd) throw new Error("TIM3 : octets restants dans PAR");

  return {
    id,
    density: w[0],
    mass: w[1],
    elasticity: w[2],
    flags: w[3],
    unknown04: w[4],
    unknown05: w[5],
    unknown06: w[6],
    unknown07: w[7],
    unknown08: w[8],
    width: w[9],
    height: w[10],
    shapeFlags: w[11],
    polygons,
  };
}
