/**
 * Zones de marche `.CTP` de Croisière pour un cadavre (docs/croisiere/formats.md § 3.5).
 *
 * Référence : `engines/cruise/ctp.cpp::initCt` (lecture du fichier), `computeAllDistance` et `getWalkBoxCenter` (usage des tables) de
 * ScummVM (GPL v3+, release 2026.4.0). Tout est grand-boutiste (i16).
 *
 * Fichier : `"CTP "`, `numNodes` i16, sept tailles de segment i16 (octets), puis les segments dans l'ordre : nœuds (paires x, y),
 * routes (lignes de 10 mots), polygones de marche (lignes de 40 mots), couleur, état, indice de couleur et zoom de chaque zone.
 * Le nombre de zones est `seg6 / 2`.
 *
 * Écarts volontaires : l'analyse échoue (au lieu d'un `assert`) si un segment n'est pas un multiple de sa ligne ou si la somme des
 * segments ne tombe pas sur la taille du fichier (vérifié sur les 33 `.CTP` distincts) ; la rastérisation des zones (`makeCtStruct`)
 * n'est pas faite ici (moteur de marche, `walk.ts`).
 */

export const CTP_MAGIC = "CTP ";
/** Nombre maximal de points d'un polygone de marche (ligne de 40 mots : compte, puis 19 paires). */
export const CTP_MAX_POINTS = 19;
/** Nombre de voisins maximal d'un nœud (ligne de 10 mots : compte, puis 9 indices). */
export const CTP_MAX_NEIGHBOURS = 9;

export interface CtpNode {
  x: number;
  y: number;
}

export interface CtpWalkbox {
  /** Sommets du polygone (`nbPoints` paires de la ligne de 40 mots). */
  points: CtpNode[];
  /** Type de zone (`walkboxColor`) : 0 non marchable, 1 marchable, 2 sortie, d'après les commentaires de ScummVM. */
  color: number;
  /** Zone bloquée par un objet (`walkboxState`, 0 ou 1) : modifiable par les scripts. */
  state: number;
  /** `walkboxColorIndex`. */
  colorIndex: number;
  /** Zoom de la zone (`walkboxZoom`) : la liste « étendue » est rastérisée à l'échelle `zoom * 20 + 0x200`. */
  zoom: number;
}

export interface CtpData {
  /** Nombre de nœuds de routage déclaré dans l'en-tête (`ctp_routeCoordCount`). */
  numNodes: number;
  /** Les sept tailles de segment, en octets, telles que dans le fichier. */
  segmentSizes: number[];
  /** Nœuds de routage (`seg0 / 4` paires ; peut dépasser `numNodes`, que ScummVM n'exploite que jusqu'à `numNodes`). */
  nodes: CtpNode[];
  /** Voisins de chaque nœud (`ctp_routes` : `[nbVoisins, id1..id9]` → indices des voisins, `nbVoisins` premiers). */
  routes: number[][];
  /** Lignes brutes des routes (10 mots chacune), pour la VM. */
  routeRows: Int16Array[];
  walkboxes: CtpWalkbox[];
  /** Lignes brutes des polygones (40 mots chacune : `[nbPoints, x0, y0, ...]`), pour le moteur de marche. */
  walkboxRows: Int16Array[];
}

function segmentCount(size: number, row: number, what: string): number {
  if (size < 0 || size % row !== 0) throw new RangeError(`CTP : segment ${what} de ${size} octets (multiple de ${row} attendu)`);
  return size / row;
}

/** Analyse un `.CTP` dépacké. */
export function parseCtp(file: Uint8Array): CtpData {
  if (file.length < 20) throw new RangeError("CTP trop court");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let magic = "";
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(file[i]!);
  if (magic !== CTP_MAGIC) throw new RangeError(`CTP : signature « ${magic} » inattendue`);
  const numNodes = view.getInt16(4);
  const segmentSizes: number[] = [];
  for (let i = 0; i < 7; i++) segmentSizes.push(view.getInt16(6 + 2 * i));
  const [s0, s1, s2, s3, s4, s5, s6] = segmentSizes as [number, number, number, number, number, number, number];
  const total = 20 + segmentSizes.reduce((a, b) => a + b, 0);
  if (total !== file.length) throw new RangeError(`CTP : segments de ${total} octets pour un fichier de ${file.length}`);

  let pos = 20;
  const i16At = (at: number): number => view.getInt16(at);

  const nodes: CtpNode[] = [];
  for (let i = 0; i < segmentCount(s0, 4, "nœuds"); i++) nodes.push({ x: i16At(pos + 4 * i), y: i16At(pos + 4 * i + 2) });
  pos += s0;

  const routeRows: Int16Array[] = [];
  for (let i = 0; i < segmentCount(s1, 20, "routes"); i++) {
    const row = new Int16Array(10);
    for (let k = 0; k < 10; k++) row[k] = i16At(pos + 20 * i + 2 * k);
    routeRows.push(row);
  }
  pos += s1;
  const routes = routeRows.map((row) => Array.from(row.subarray(1, 1 + Math.max(0, Math.min(row[0]!, CTP_MAX_NEIGHBOURS)))));

  const walkboxRows: Int16Array[] = [];
  for (let i = 0; i < segmentCount(s2, 80, "polygones"); i++) {
    const row = new Int16Array(40);
    for (let k = 0; k < 40; k++) row[k] = i16At(pos + 80 * i + 2 * k);
    walkboxRows.push(row);
  }
  pos += s2;

  const readWords = (size: number, what: string): number[] => {
    const count = segmentCount(size, 2, what);
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(i16At(pos + 2 * i));
    pos += size;
    return out;
  };
  const colors = readWords(s3, "couleurs");
  const states = readWords(s4, "états");
  const colorIndexes = readWords(s5, "indices de couleur");
  const zooms = readWords(s6, "zooms");

  const count = zooms.length;
  const walkboxes: CtpWalkbox[] = [];
  for (let i = 0; i < count; i++) {
    const row = walkboxRows[i];
    const n = row ? Math.max(0, Math.min(row[0]!, CTP_MAX_POINTS)) : 0;
    const points: CtpNode[] = [];
    for (let p = 0; p < n; p++) points.push({ x: row![1 + 2 * p]!, y: row![2 + 2 * p]! });
    walkboxes.push({ points, color: colors[i] ?? 0, state: states[i] ?? 0, colorIndex: colorIndexes[i] ?? 0, zoom: zooms[i]! });
  }
  return { numNodes, segmentSizes, nodes, routes, routeRows, walkboxes, walkboxRows };
}
