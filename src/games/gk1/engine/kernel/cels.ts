/**
 * Noyau, groupe « cels » : `CelWide`, `CelHigh`, `NumLoops`, `NumCels`, `SetNowSeen`, `OnMe`.
 *
 * Référence : `engines/sci/engine/kgraphics32.cpp` (`kCelWide32`, `kCelHigh32`, `kSetNowSeen32`, `kIsOnMe`) et
 * `kgraphics.cpp` (`kNumLoops`, `kNumCels`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - `CelWide(vue, boucle, cel)` et `CelHigh` : taille du cel ; une boucle ou un cel trop grands désignent le dernier.
 * - `NumLoops(objet)` : nombre de boucles de la vue de l'objet ; `NumCels(objet)` : nombre de cels de sa boucle.
 * - `SetNowSeen(objet)` : écrit `nsLeft` … `nsBottom` (`render/frameout.ts`) ; l'accumulateur ne change pas en SCI2.
 * - `OnMe(x, y, objet, pixel)` : `x` et `y` dans le repère du plan de l'objet. C'est la fonction que SCI2.1 renomme `IsOnMe`.
 *
 * Écarts volontaires : une vue absente rend 0 avec un avertissement (ScummVM s'arrête) ; `CelInfo`, de SCI2.1, n'existe pas
 * dans la table du noyau de ce CD.
 */
import { frameoutOf } from "../../render/frameout";
import { NULL_REG, type Reg, toSint16 } from "../memory";
import { readSelector } from "../object";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;

function celSize(dimension: "width" | "height") {
  return (vm: Vm, argv: Uint32Array): Reg => {
    if (argv.length < 3) return NULL_REG;
    const cel = frameoutOf(vm).cels.viewCel(argv[0] & WORD_MASK, argv[1] & WORD_MASK, argv[2] & WORD_MASK);
    if (!cel) vm.warn(`vue ${argv[0] & WORD_MASK} absente ou vide (${dimension === "width" ? "CelWide" : "CelHigh"})`);
    return cel ? cel[dimension] : NULL_REG;
  };
}

function numLoops(vm: Vm, argv: Uint32Array): Reg {
  const view = frameoutOf(vm).cels.view(readSelector(vm.memory, argv[0], vm.selectors.id("view")) & WORD_MASK);
  return view ? view.loops.length : NULL_REG;
}

function numCels(vm: Vm, argv: Uint32Array): Reg {
  const cels = frameoutOf(vm).cels;
  const viewNumber = readSelector(vm.memory, argv[0], vm.selectors.id("view")) & WORD_MASK;
  const loop = cels.clampLoop(viewNumber, readSelector(vm.memory, argv[0], vm.selectors.id("loop")) & WORD_MASK);
  return loop < 0 ? NULL_REG : cels.view(viewNumber)!.loops[loop].cels.length;
}

function setNowSeen(vm: Vm, argv: Uint32Array): Reg {
  if (!frameoutOf(vm).setNowSeen(argv[0])) vm.warn(`SetNowSeen : ${vm.nameOf(argv[0])} n'a pas d'élément d'écran`);
  return vm.acc;
}

function onMe(vm: Vm, argv: Uint32Array): Reg {
  return frameoutOf(vm).isOnMe(argv[2], toSint16(argv[0]), toSint16(argv[1]), argv.length > 3 && argv[3] !== 0) ? 1 : 0;
}

export function registerCelKernel(kernel: Kernel): void {
  kernel
    .register("CelWide", celSize("width"))
    .register("CelHigh", celSize("height"))
    .register("NumLoops", numLoops)
    .register("NumCels", numCels)
    .register("SetNowSeen", setNowSeen)
    .register("OnMe", onMe);
}
