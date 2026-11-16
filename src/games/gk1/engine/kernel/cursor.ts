/**
 * Noyau, groupe « curseur » : `SetCursor`.
 *
 * Référence : `engines/sci/engine/kgraphics32.cpp` de ScummVM (`kSetCursor32`), GPL v3 ou ultérieure, lu puis réécrit. Le
 * travail est fait par `render/cursor.ts`. La forme dépend du nombre d'arguments :
 *
 * - `SetCursor(−2)` : lève la zone de déplacement ; `SetCursor(0)` : cache le curseur (les appels s'empilent) ; toute
 *   autre valeur : le montre, quel que soit le nombre de `SetCursor(0)` précédents ;
 * - `SetCursor(x, y)` : place la souris ;
 * - `SetCursor(vue, boucle, cel)` : change l'image du curseur ;
 * - `SetCursor(gauche, haut, droite, bas)` : borne la souris à ce rectangle, bords compris.
 *
 * L'accumulateur ne change pas.
 *
 * **Cinq arguments** : les deux appels des scripts, `SetCursor(curseur, 0, 0, x, y)` à la fin de `Game::setCursor` (script
 * 64994) et de `GK::setCursor` (script 0), demandent que `setCursor` ait reçu plus de quatre arguments ; les 280 envois de
 * `setCursor` en passent quatre au plus. Ce code n'est jamais atteint, et ScummVM ne connaît pas cette forme (signature
 * `i(i)(i)(i)` de `kSetCursor32` dans `kernel_tables.h`, donc une erreur). Relevé figé par
 * `test/gk1/render/script-usage.test.ts`.
 *
 * Écarts volontaires : un autre nombre d'arguments (cinq compris) et une vue absente donnent un avertissement, là où
 * ScummVM s'arrête.
 */
import { frameoutOf } from "../../render/frameout";
import { CURSOR_CLEAR_AREA } from "../../render/ids";
import { makeRect } from "../../render/rect";
import { NULL_REG, type Reg, toSint16 } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;

function setCursor(vm: Vm, argv: Uint32Array): Reg {
  const cursor = frameoutOf(vm).cursor;
  switch (argv.length) {
    case 1:
      if (toSint16(argv[0]) === CURSOR_CLEAR_AREA) cursor.clearRestrictedArea();
      else if (argv[0] === NULL_REG) cursor.hide();
      else cursor.show();
      break;
    case 2:
      cursor.setPosition(toSint16(argv[0]), toSint16(argv[1]));
      break;
    case 3:
      if (!cursor.setView(argv[0] & WORD_MASK, argv[1] & WORD_MASK, argv[2] & WORD_MASK)) vm.warn(`SetCursor : vue ${argv[0] & WORD_MASK} absente ou vide`);
      break;
    case 4:
      cursor.setRestrictedArea(makeRect(toSint16(argv[0]), toSint16(argv[1]), toSint16(argv[2]) + 1, toSint16(argv[3]) + 1));
      break;
    default:
      vm.warn(`SetCursor : ${argv.length} arguments non gérés`);
  }
  return vm.acc;
}

export function registerCursorKernel(kernel: Kernel): void {
  kernel.register("SetCursor", setCursor);
}
