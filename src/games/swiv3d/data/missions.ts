/**
 * Script des missions : bloc 600 de `GLOBAL.BD` (voir docs/swiv3d/global-bd.md).
 *
 * Suite d'éléments de 16 octets `(étiquette i32, a, b, c)` interprétée par `gm_main_game` (`00421614`), qui avance de l'un à l'autre
 * jusqu'à l'étiquette -1 ; le menu « Rejouer la mission » saute en avant jusqu'à l'élément `200 n` voulu.
 *   - 100 à 103 `(variable, valeur)` : affecte (100), maximise (101), minimise (102) ou additionne (103) une variable du joueur ;
 *   - 200 `n` : début de la mission n ; 300 : nom du niveau (fichier `<nom>.SLV`) ; 500 : nom d'une vidéo Smacker (`BR_TER0`, `END_TER`…) ;
 *   - 400 : six u16 (pistes CD par contexte, table `005bba10`) ; 600 `(r, g, b)` : couleur d'ambiance (stockée dans `00484650`) ;
 *   - -2 : fin de l'aventure livrée (le profil passe à la mission 0xb4c69) ; -1 : fin du script.
 * Les noms (300 et 500) occupent les 12 octets après l'étiquette, terminés par NUL ; le reste du champ est du résidu mémoire.
 */
import { BinaryReader } from "../../../data/reader";
import type { BdArchive } from "./bd";

export const MISSIONS_BLOCK = 600;

const ELEMENT_SIZE = 16;
/** Numéro de mission des éléments terminaux (`200 999`, `-2 999`, `-1 999`). */
export const END_MISSION = 999;

export type VariableOperation = "set" | "max" | "min" | "add";

export type ScriptElement =
  | { kind: "variable"; operation: VariableOperation; variable: number; value: number }
  | { kind: "mission"; index: number }
  | { kind: "level"; name: string }
  | { kind: "tracks"; tracks: number[] }
  | { kind: "video"; name: string }
  | { kind: "color"; r: number; g: number; b: number }
  | { kind: "complete" }
  | { kind: "end" }
  | { kind: "unknown"; label: number; values: [number, number, number] };

export interface Mission {
  /** Numéro tel que l'écrit l'élément `200`. */
  index: number;
  /** Éléments qui suivent le `200`, jusqu'au prochain `200` (exclu). */
  elements: ScriptElement[];
  /** Nom du niveau (`TERRAN00`…), absent pour la mission finale. */
  level: string | undefined;
  /** Vidéos jouées par la mission, dans l'ordre (briefing `BR_TER0`, fin `END_TER`…). */
  videos: string[];
  /** Couleur d'ambiance `(r, g, b)` de l'élément 600, sinon `undefined`. */
  color: [number, number, number] | undefined;
  /** Pistes CD de l'élément 400, sinon `undefined`. */
  tracks: number[] | undefined;
}

export interface MissionScript {
  /** Tous les éléments, dans l'ordre du fichier (jusqu'au dernier `-1` inclus). */
  elements: ScriptElement[];
  /** Les missions, dans l'ordre du fichier (la mission 999 qui porte `-2` et `-1` n'en fait pas partie). */
  missions: Mission[];
  /** Indice dans `elements` du premier `-1` : au-delà, les missions ne s'enchaînent plus (elles ne sont atteintes que par le menu). */
  chainEnd: number;
}

const VARIABLE_OPERATIONS: VariableOperation[] = ["set", "max", "min", "add"];

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end < 0 ? bytes.length : end));
}

export function parseMissions(bd: BdArchive): MissionScript {
  const bytes = bd.get(MISSIONS_BLOCK);
  if (bytes.length % ELEMENT_SIZE !== 0) throw new Error(`missions : ${bytes.length} octets, pas un multiple de ${ELEMENT_SIZE}`);
  const r = new BinaryReader(bytes);
  const elements: ScriptElement[] = [];
  for (let i = 0; i < bytes.length / ELEMENT_SIZE; i++) {
    r.offset = i * ELEMENT_SIZE;
    const label = r.i32();
    const a = r.i32();
    const b = r.i32();
    const c = r.i32();
    const text = bytes.subarray(i * ELEMENT_SIZE + 4, (i + 1) * ELEMENT_SIZE);
    if (label >= 100 && label <= 103) elements.push({ kind: "variable", operation: VARIABLE_OPERATIONS[label - 100]!, variable: a, value: b });
    else if (label === 200) elements.push({ kind: "mission", index: a });
    else if (label === 300) elements.push({ kind: "level", name: cString(text) });
    else if (label === 400) {
      const view = new BinaryReader(bytes);
      view.offset = i * ELEMENT_SIZE + 4;
      elements.push({ kind: "tracks", tracks: Array.from({ length: 6 }, () => view.u16()) });
    } else if (label === 500) elements.push({ kind: "video", name: cString(text) });
    else if (label === 600) elements.push({ kind: "color", r: a, g: b, b: c });
    else if (label === -2) elements.push({ kind: "complete" });
    else if (label === -1) elements.push({ kind: "end" });
    else elements.push({ kind: "unknown", label, values: [a, b, c] });
  }

  const missions: Mission[] = [];
  let current: Mission | undefined;
  for (const element of elements) {
    if (element.kind === "mission") {
      current = { index: element.index, elements: [], level: undefined, videos: [], color: undefined, tracks: undefined };
      if (element.index !== END_MISSION) missions.push(current);
      continue;
    }
    if (!current || current.index === END_MISSION) continue;
    current.elements.push(element);
    if (element.kind === "level") current.level = element.name;
    else if (element.kind === "video") current.videos.push(element.name);
    else if (element.kind === "color") current.color = [element.r, element.g, element.b];
    else if (element.kind === "tracks") current.tracks = element.tracks;
  }
  return { elements, missions, chainEnd: elements.findIndex((e) => e.kind === "end") };
}
