/**
 * Objets des overlays : classes, états dans `globalVars`, paramètres X / Y / Z / frame / scale / state.
 *
 * Référence : `engines/cruise/object.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `getObjectDataFromOverlay`,
 * `getMultipleObjectParam`, `setObjectPosition`, `objInit`, `getSingleObjectParam`, `objectReset`, `getObjectName`,
 * `getObjectClass`. Lu puis réécrit.
 *
 * Bizarreries reproduites : un objet MULTIPLE ou THEME lit `arrayStates[first + state]` ; un indice global négatif est ramené à 0
 * (seul cas protégé), un indice d'état négatif mais global positif lit donc les états de l'objet précédent. `objInit` d'un objet
 * VARIABLE accepte `first + state == size8` (une entrée au-delà du tableau). Modifier Z ou l'état d'un objet appelle `sortCells`.
 * Écart volontaire : un indice au-delà du tableau lit des paramètres nuls (ScummVM lit le tas voisin) ; `objectStats` les compte.
 */
import { ObjClass, ScriptError } from "./ids";
import { int16 } from "./memory";
import { emptyParams, type ObjectParams } from "./overlays";
import type { OvlObject } from "../data/overlay";
import type { EngineState } from "./state";

/** Résultat de `getMultipleObjectParam` (`objectParamsQuery`). */
export interface ObjectQuery {
  X: number;
  Y: number;
  baseFileIdx: number;
  fileIdx: number;
  scale: number;
  state: number;
  state2: number;
  nbState: number;
}

export const objectStats = { outOfRangeStates: 0 };

function stateAt(states: ObjectParams[], index: number): ObjectParams {
  const s = states[index];
  if (s) return s;
  objectStats.outOfRangeStates++;
  return emptyParams();
}

/** `getObjectDataFromOverlay`. */
export function getObjectData(e: EngineState, ovl: number, obj: number): OvlObject | null {
  if (ovl < 1 || obj < 0) return null;
  const data = e.overlays.entries[ovl]?.data;
  if (!data || obj >= data.objects.length) return null;
  return data.objects[obj]!;
}

function stateVarIndex(e: EngineState, ovl: number, obj: OvlObject): number {
  return e.overlays.entries[ovl]!.state + obj.stateTableIdx;
}

/** `globalVars[i]` avec la lecture d'un indice hors tableau à 0. */
function globalVar(e: EngineState, index: number): number {
  return index >= 0 && index < e.globalVars.length ? e.globalVars[index]! : 0;
}

function setGlobalVar(e: EngineState, index: number, value: number): void {
  if (index >= 0 && index < e.globalVars.length) e.globalVars[index] = value;
}

/** `getMultipleObjectParam` : `null` (−11 dans ScummVM) si l'objet n'existe pas. */
export function getMultipleObjectParam(e: EngineState, ovl: number, obj: number): ObjectQuery | null {
  const o = getObjectData(e, ovl, obj);
  if (!o) return null;
  const data = e.overlays.entries[ovl]!.data!;
  let params: ObjectParams;
  let state: number;
  let state2: number;
  switch (o.class) {
    case ObjClass.THEME:
    case ObjClass.MULTIPLE: {
      state = globalVar(e, stateVarIndex(e, ovl, o));
      const index = o.firstStateIdx + state;
      params = stateAt(data.states, index < 0 ? 0 : index);
      state2 = params.state;
      break;
    }
    case ObjClass.VARIABLE: {
      params = stateAt(data.objVars, o.varTableIdx);
      state = params.state;
      state2 = state;
      if (o.firstStateIdx + state < data.states.length) state2 = stateAt(data.states, o.firstStateIdx + state).state;
      break;
    }
    default:
      throw new Error(`getMultipleObjectParam : classe ${o.class} non gérée`);
  }
  return {
    X: params.X,
    Y: params.Y,
    baseFileIdx: params.Z,
    fileIdx: params.frame,
    scale: params.scale,
    state,
    state2,
    nbState: o.numStates,
  };
}

/** `getSingleObjectParam` : paramètre 0..5 (X, Y, Z, frame, scale, state), `null` si l'objet n'existe pas. */
export function getSingleObjectParam(e: EngineState, ovl: number, obj: number, param: number): number | null {
  const o = getObjectData(e, ovl, obj);
  if (!o) return null;
  const data = e.overlays.entries[ovl]!.data!;
  let params: ObjectParams;
  let state: number;
  switch (o.class) {
    case ObjClass.THEME:
    case ObjClass.MULTIPLE: {
      state = globalVar(e, stateVarIndex(e, ovl, o));
      const index = o.firstStateIdx + state;
      params = stateAt(data.states, index < 0 ? 0 : index);
      break;
    }
    case ObjClass.VARIABLE:
      params = stateAt(data.objVars, o.varTableIdx);
      state = params.state;
      break;
    default:
      throw new Error(`getSingleObjectParam : classe ${o.class} non gérée`);
  }
  switch (param) {
    case 0:
      return params.X;
    case 1:
      return params.Y;
    case 2:
      return params.Z;
    case 3:
      return params.frame;
    case 4:
      return params.scale;
    case 5:
      return state;
    default:
      throw new Error(`getSingleObjectParam : paramètre ${param} non géré`);
  }
}

/** `setObjectPosition` : écrit le paramètre `param` (seul l'état pour MULTIPLE / THEME, rien pour UNIQUE). */
export function setObjectPosition(e: EngineState, ovl: number, obj: number, param: number, value: number): void {
  const o = getObjectData(e, ovl, obj);
  if (!o) return;
  value = int16(value);
  switch (o.class) {
    case ObjClass.THEME:
    case ObjClass.MULTIPLE:
      if (param !== 5) return;
      setGlobalVar(e, stateVarIndex(e, ovl, o), value);
      e.cells.sortCells(e, ovl, obj);
      return;
    case ObjClass.UNIQUE:
      return;
    case ObjClass.VARIABLE: {
      const p = stateAt(e.overlays.entries[ovl]!.data!.objVars, o.varTableIdx);
      switch (param) {
        case 0:
          p.X = value;
          break;
        case 1:
          p.Y = value;
          break;
        case 2:
          p.Z = value;
          e.cells.sortCells(e, ovl, obj);
          break;
        case 3:
          p.frame = value;
          break;
        case 4:
          p.scale = value;
          break;
        case 5:
          p.state = value;
          break;
        default:
          throw new Error(`setObjectPosition : paramètre ${param} non géré`);
      }
      return;
    }
    default:
      throw new Error(`setObjectPosition : classe ${o.class} non gérée`);
  }
}

/** `objInit` : met l'objet dans l'état `newState` (copie de l'état pour un objet VARIABLE). */
export function objInit(e: EngineState, ovl: number, obj: number, newState: number): number {
  const o = getObjectData(e, ovl, obj);
  if (!o) return ScriptError.noObject;
  const data = e.overlays.entries[ovl]!.data!;
  newState = int16(newState);
  switch (o.class) {
    case ObjClass.THEME:
    case ObjClass.MULTIPLE:
      setGlobalVar(e, stateVarIndex(e, ovl, o), newState);
      e.cells.sortCells(e, ovl, obj);
      break;
    case ObjClass.UNIQUE:
      break;
    case ObjClass.VARIABLE: {
      if (o.firstStateIdx + newState > data.states.length) return 0;
      const dest = stateAt(data.objVars, o.varTableIdx);
      const src = stateAt(data.states, o.firstStateIdx + newState);
      Object.assign(dest, src);
      dest.state = newState;
      e.cells.sortCells(e, ovl, obj);
      break;
    }
    default:
      e.warn(`objInit : classe ${o.class} non gérée`);
  }
  return 0;
}

/** `objectReset` : les THEME à l'état −2 (déjà évoqués) reviennent à 0. */
export function objectReset(e: EngineState): void {
  for (let i = 1; i < e.overlays.numOfLoadedOverlay; i++) {
    const entry = e.overlays.entries[i]!;
    if (!entry.alreadyLoaded || !entry.data) continue;
    for (const o of entry.data.objects) {
      const index = entry.state + o.stateTableIdx;
      if (o.class === ObjClass.THEME && globalVar(e, index) === -2) setGlobalVar(e, index, 0);
    }
  }
}

/** `getObjectClass` : classe, ou −11. */
export function getObjectClass(e: EngineState, ovl: number, obj: number): number {
  return getObjectData(e, ovl, obj)?.class ?? ScriptError.noObject;
}

/** `getObjectName` : `index`-ième chaîne d'un bloc (sans borne dans ScummVM ; ici chaîne vide au-delà). */
export function getObjectName(blob: Uint8Array, index: number): string {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    while (pos < blob.length && blob[pos] !== 0) pos++;
    pos++;
  }
  let out = "";
  while (pos < blob.length && blob[pos] !== 0) out += String.fromCharCode(blob[pos++]!);
  return out;
}
