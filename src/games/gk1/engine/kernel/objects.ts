/**
 * Noyau, groupe « objets » : `Clone`, `DisposeClone`, `RespondsTo`.
 *
 * Référence : `engines/sci/engine/kscripts.cpp` (`kClone`, `kDisposeClone`, `kRespondsTo`) de ScummVM, GPL v3 ou ultérieure,
 * lu puis réécrit.
 *
 * Un clone copie les propriétés de son modèle ; `-info-` perd le bit « classe » et prend le bit « clone », `-script-` reçoit
 * l'adresse de l'objet de script d'origine et, si le modèle est une classe, `-super-` aussi. `DisposeClone` marque le clone
 * libéré : il reste lisible (des scripts finissent leur méthode après `dispose`) jusqu'au ramasse-miettes (`gc.ts`).
 *
 * Écart volontaire : pas de comptage des demandes de chargement sur le script du modèle (ScummVM l'incrémente pour le
 * garder en mémoire ; ici un script déchargé reste lisible et le ramasse-miettes ne libère que les clones).
 */
import { INFO_CLASS, INFO_CLONE } from "../../data/ids";
import { OBJECT_PROPERTY } from "../../data/script";
import { INFO_NO_DISPOSE } from "../ids";
import { formatReg, NULL_REG, type Reg, SciError } from "../memory";
import { lookupSelector, newLookup, SelectorKind } from "../object";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const lookup = newLookup();

function clone(vm: Vm, argv: Uint32Array): Reg {
  const parent = vm.memory.getObject(argv[0]);
  if (!parent) throw new SciError(`Clone de ${formatReg(argv[0])}, qui n'est pas un objet`);
  const copy = parent.cloneObject();
  copy.vars[OBJECT_PROPERTY.Info] = (parent.info & ~INFO_CLASS) | INFO_CLONE;
  copy.vars[OBJECT_PROPERTY.Species] = parent.origin;
  if (parent.isClass) copy.vars[OBJECT_PROPERTY.SuperClass] = parent.origin;
  return vm.memory.clones.allocate(copy);
}

function disposeClone(vm: Vm, argv: Uint32Array): Reg {
  const object = vm.memory.getObject(argv[0]);
  if (!object) throw new SciError(`DisposeClone de ${formatReg(argv[0])}, qui n'est pas un objet`);
  // Seul un « vrai » clone est libéré : bit clone levé, bit « ne pas libérer » baissé.
  if ((object.info & (INFO_CLONE | INFO_NO_DISPOSE)) === INFO_CLONE) object.freed = true;
  return vm.acc;
}

function respondsTo(vm: Vm, argv: Uint32Array): Reg {
  if (!vm.memory.isObject(argv[0])) return NULL_REG;
  return lookupSelector(vm.memory, vm.memory.getObject(argv[0])!, argv[1] & 0xffff, lookup) !== SelectorKind.None ? 1 : 0;
}

export function registerObjectKernel(kernel: Kernel): void {
  kernel.register("Clone", clone).register("DisposeClone", disposeClone).register("RespondsTo", respondsTo);
}
