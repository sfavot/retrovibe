/**
 * Modèles vectoriels (entrées de type 0 des `.SET`) : lecture de l'enregistrement, sans rastérisation (docs/croisiere/formats.md § 3.3).
 *
 * Référence : `engines/cruise/mainDraw.cpp` de ScummVM (GPL v3+) : `flipPoly` (renvoi miroir), `getPolySize` (octets 1 à 4),
 * `buildPolyModel` et `findPoly` (liste de points, puis polygones jusqu'à `0xFF`). Le rastériseur (vague R1) consomme `PolyModel`.
 *
 * Écarts volontaires : l'enregistrement est lu avec contrôle des bornes (ScummVM lit sans limite) ; une liste de moins de deux points est
 * refusée (la boucle de ScummVM bouclerait sur un compteur négatif) ; la liste de polygones se lit tant que l'octet courant n'est pas
 * `0xFF`, donc un modèle sans polygone est accepté (ScummVM, en `do … while`, prendrait ce `0xFF` pour un polygone de 255 sommets).
 * Les 4 octets qui suivent le `0xFF` sont conservés dans `trailer` mais ignorés par le moteur.
 */

/** Un polygone : sommets donnés par indices dans `PolyModel.points`. */
export interface PolyPolygon {
  /** Index de palette. */
  readonly color: number;
  /** Octet qui suit la couleur, ignoré par le moteur. */
  readonly unused: number;
  /** Échelle minimale (|scale| ≥ `minScale`) pour que le polygone soit dessiné. */
  readonly minScale: number;
  /** Indices de points (au moins 2). */
  readonly indices: Uint8Array;
}

export interface PolyModel {
  readonly kind: "model";
  /** Octet 1 (`upperX`) : demi-largeur maximale, utilisée par `getPolySize`. */
  readonly upperX: number;
  /** Octet 2 (`upperY`) : hauteur maximale. */
  readonly upperY: number;
  /** Octets 3 et 4 : pivot du modèle dans son propre repère. */
  readonly lowerX: number;
  readonly lowerY: number;
  /** Paires (x, y) d'octets non signés, à plat : `points[2 * i]`, `points[2 * i + 1]`. Le premier point est l'origine du rendu. */
  readonly points: Uint8Array;
  readonly polygons: readonly PolyPolygon[];
  /** Les octets qui suivent le `0xFF` final (4 dans les données du jeu). */
  readonly trailer: Uint8Array;
}

/** Renvoi vers une autre entrée du même set, dessinée en miroir (`flipPoly`). */
export interface PolyMirror {
  readonly kind: "mirror";
  /** Écart d'index d'entrée : la cible est l'entrée `idEntrée + offset`. */
  readonly offset: number;
  /** Décalage de position : le dessin se fait en `(X - newX, Y - newY)` avec l'échelle opposée. */
  readonly newX: number;
  readonly newY: number;
}

export type PolyRecord = PolyModel | PolyMirror;

const MIRROR_SIZE = 8;
const MODEL_HEADER_SIZE = 6;
const POLYGON_HEADER_SIZE = 5;
const END_MARKER = 0xff;

export function parsePolyRecord(data: Uint8Array): PolyRecord {
  if (data.length < MODEL_HEADER_SIZE) throw new Error("Modèle polygonal trop court");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(0) === 0) {
    if (data.length < MIRROR_SIZE) throw new Error("Renvoi miroir tronqué");
    return { kind: "mirror", offset: view.getInt16(2), newX: view.getInt16(4), newY: view.getInt16(6) };
  }

  const count = data[5]!;
  if (count < 2) throw new Error(`Modèle polygonal : ${count} point(s)`);
  let at = MODEL_HEADER_SIZE + count * 2;
  if (at >= data.length) throw new Error("Modèle polygonal : liste de points tronquée");
  const points = data.slice(MODEL_HEADER_SIZE, at);

  const polygons: PolyPolygon[] = [];
  while (data[at] !== END_MARKER) {
    const vertices = data[at]!;
    if (vertices > 1) {
      const end = at + POLYGON_HEADER_SIZE + vertices;
      if (end >= data.length) throw new Error("Modèle polygonal : polygone tronqué");
      const indices = data.slice(at + POLYGON_HEADER_SIZE, end);
      for (const index of indices) if (index >= count) throw new Error(`Modèle polygonal : point ${index} hors liste`);
      polygons.push({ color: data[at + 1]!, unused: data[at + 2]!, minScale: view.getUint16(at + 3), indices });
      at = end;
    } else {
      at += POLYGON_HEADER_SIZE;
      if (at >= data.length) throw new Error("Modèle polygonal : polygone vide tronqué");
    }
  }

  return {
    kind: "model",
    upperX: data[1]!,
    upperY: data[2]!,
    lowerX: data[3]!,
    lowerY: data[4]!,
    points,
    polygons,
    trailer: data.slice(at + 1),
  };
}
