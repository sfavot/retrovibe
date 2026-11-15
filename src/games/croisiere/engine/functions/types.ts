import type { EngineState } from "../state";

/**
 * Fonction native (`opcodeTablePtr`) : dépile ses arguments (`e.vm.popVar` / `popPtr`) et rend un `int16`, empilé par
 * `opcodeType8`. `args` : nombre de valeurs dépilées (−1 = variable, la première dépilée donnant le compte).
 */
export interface Native {
  readonly name: string;
  readonly args: number;
  readonly impl: (e: EngineState) => number;
}

/** Fonctions d'un groupe, par numéro (0x01..0x7D). */
export type NativeGroup = Readonly<Record<number, Native>>;

/** Overlay courant si `ovl` vaut 0 (convention de presque toutes les fonctions). */
export function orCurrent(e: EngineState, ovl: number): number {
  return ovl || e.currentScript!.overlayNumber;
}
