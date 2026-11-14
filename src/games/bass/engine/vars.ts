/**
 * Variables de script : 838 mots `u32` (`Logic::_scriptVariables`), bus entre les scripts et le moteur.
 *
 * Référence : ScummVM engines/sky/logic.cpp (`Logic::initScriptVariables`), logic.h (GPL v3 ou ultérieure).
 *
 * Un `Uint32Array` garde la sémantique `uint32` du C (une affectation négative s'enroule modulo 2³²). Un script adresse une variable en
 * octets (`push_variable n` lit la variable `n / 4`).
 *
 * Écart volontaire : la liste « en avant » de la v0.0288 (`forwardList1b288`) n'est pas portée (seule la v0.0372 est visée).
 */

import {
  FORWARD_LIST_1,
  FORWARD_LIST_1B,
  FORWARD_LIST_2,
  FORWARD_LIST_2B,
  FORWARD_LIST_3,
  FORWARD_LIST_3B,
  FORWARD_LIST_4,
  FORWARD_LIST_4B,
  FORWARD_LIST_5,
  FORWARD_LIST_5B,
  NUM_SCRIPT_VARS,
  Var,
} from "./ids";

export type ScriptVars = Uint32Array;

/** Valeurs initiales non nulles (`initScriptVariables`). */
const INITIAL: ReadonlyArray<readonly [number, number]> = [
  [Var.LOGIC_LIST_NO, 141],
  [Var.LAMB_GREET, 62],
  [Var.JOEY_SECTION, 1],
  [Var.LAMB_SECTION, 2],
  [Var.S15_FLOOR, 8371],
  [Var.GUARDIAN_THERE, 1],
  [Var.DOOR_67_68_FLAG, 1],
  [Var.SC70_IRIS_FLAG, 3],
  [Var.DOOR_73_75_FLAG, 1],
  [Var.SC76_CABINET1_FLAG, 1],
  [Var.SC76_CABINET2_FLAG, 1],
  [Var.SC76_CABINET3_FLAG, 1],
  [Var.DOOR_77_78_FLAG, 1],
  [Var.SC80_EXIT_FLAG, 1],
  [Var.SC31_LIFT_FLAG, 1],
  [Var.SC32_LIFT_FLAG, 1],
  [Var.SC33_SHED_DOOR_FLAG, 1],
  [Var.BAND_PLAYING, 1],
  [Var.COLSTON_AT_TABLE, 1],
  [Var.SC36_NEXT_DEALER, 16731],
  [Var.SC36_DOOR_FLAG, 1],
  [Var.SC37_DOOR_FLAG, 2],
  [Var.SC40_LOCKER_1_FLAG, 1],
  [Var.SC40_LOCKER_2_FLAG, 1],
  [Var.SC40_LOCKER_3_FLAG, 1],
  [Var.SC40_LOCKER_4_FLAG, 1],
  [Var.SC40_LOCKER_5_FLAG, 1],
];

/** `initScriptVariables` : remet `vars` à l'état du constructeur de `Logic` (zéros, valeurs initiales, listes « en avant »). */
export function initScriptVariables(vars: ScriptVars): void {
  if (vars.length !== NUM_SCRIPT_VARS) throw new RangeError(`variables de script : ${vars.length} au lieu de ${NUM_SCRIPT_VARS}`);
  vars.fill(0);
  for (const [index, value] of INITIAL) vars[index] = value;
  vars.set(FORWARD_LIST_1B, FORWARD_LIST_1);
  vars.set(FORWARD_LIST_2B, FORWARD_LIST_2);
  vars.set(FORWARD_LIST_3B, FORWARD_LIST_3);
  vars.set(FORWARD_LIST_4B, FORWARD_LIST_4);
  vars.set(FORWARD_LIST_5B, FORWARD_LIST_5);
}

/** Nouvelles variables, initialisées. */
export function createScriptVars(): ScriptVars {
  const vars = new Uint32Array(NUM_SCRIPT_VARS);
  initScriptVariables(vars);
  return vars;
}
