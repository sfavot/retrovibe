/**
 * Noyau, groupe « ressources et scripts » : `Load`, `Unload`, `Lock`, `ResCheck`, `Purge`, `ScriptID`, `DisposeScript`.
 *
 * Références : `engines/sci/engine/kscripts.cpp` (`kLoad`, `kUnLoad`, `kLock`, `kResCheck`, `kScriptID`, `kDisposeScript`) et
 * `kmisc.cpp` (`kFlushResources`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Écarts volontaires : rien n'est jamais déchargé (`resources.ts`), `Unload` et `Purge` ne font donc rien ; `Load` d'un bloc
 * de mémoire (type 0x85, inutilisé par SCI2) est refusé avec un avertissement ; `ScriptID` d'un export qui est une procédure
 * rend 0 (ScummVM rend un pointeur de code, dont aucun script ne peut rien faire) ; les ressources audio, audio36 et sync36
 * ne sont pas dans le volume (`plan.md`, D3) : `ResCheck` répond faux pour elles tant que la vague A2 ne l'a pas branché.
 */
import { ResourceType } from "../../data/ids";
import { isPointer, NULL_REG, type Reg } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

/** Type « bloc de mémoire » de `Load`. */
const RESOURCE_TYPE_MEMORY = 0x85;
/** Les scripts passent le type avec ou sans le bit 7 de la map. */
const RESOURCE_TYPE_FLAG = 0x80;
/** Identifiant rendu par `Load` : `type << 11 | numéro`. */
const LOAD_HANDLE_TYPE_SHIFT = 11;
/** `Lock` : numéro qui désigne toutes les ressources du type. */
const LOCK_ALL = 0xffff;
const WORD_MASK = 0xffff;

function resourceType(arg: Reg): number {
  return (arg & 0x7f) | RESOURCE_TYPE_FLAG;
}

function load(vm: Vm, argv: Uint32Array): Reg {
  const type = resourceType(argv[0]);
  const number = argv[1] & WORD_MASK;
  if (type === RESOURCE_TYPE_MEMORY) {
    vm.warn("Load d'un bloc de mémoire non géré");
    return NULL_REG;
  }
  return (((type & 0x7f) << LOAD_HANDLE_TYPE_SHIFT) | number) & WORD_MASK;
}

function lock(vm: Vm, argv: Uint32Array): Reg {
  const type = resourceType(argv[0]);
  const number = argv[1] & WORD_MASK;
  const state = argv.length > 2 ? argv[2] : 1;
  if (state !== 0) vm.resources.lock(type, number);
  else if (number === LOCK_ALL) vm.resources.unlockAll(type);
  else vm.resources.unlock(type, number);
  return vm.acc;
}

function resCheck(vm: Vm, argv: Uint32Array): Reg {
  const type = resourceType(argv[0]);
  if (type === ResourceType.Audio || type > ResourceType.Heap) vm.warn("ResCheck d'une ressource audio : à brancher sur l'index audio (vague A2)");
  return vm.resources.has(type, argv[1] & WORD_MASK) ? 1 : 0;
}

function scriptId(vm: Vm, argv: Uint32Array): Reg {
  if (isPointer(argv[0])) return argv[0];
  const index = argv.length > 1 ? argv[1] & WORD_MASK : 0;
  const segment = vm.scripts.instantiate(argv[0]);
  return vm.scripts.exportedObject(segment, index);
}

function disposeScript(vm: Vm, argv: Uint32Array): Reg {
  const segment = vm.scripts.loaded(argv[0] & WORD_MASK);
  // Toujours déchargé, même depuis son propre code (`DisposeScript(64990, valeur)` à la fin de la fenêtre de sauvegarde) :
  // ses objets restent lisibles et son code continue jusqu'au retour. ScummVM garde un test « pas sous son propre code », mais
  // il compare le segment de la trame du noyau, jamais celui du script : il décharge toujours, lui aussi. Ne rendre qu'une
  // demande laissait le script chargé, et ses objets gardaient leurs valeurs d'une ouverture à l'autre (fenêtre qui dérive).
  if (segment) segment.lockers = 1;
  vm.scripts.uninstantiate(argv[0] & WORD_MASK);
  return argv.length === 2 ? argv[1] : vm.acc;
}

export function registerResourceKernel(kernel: Kernel): void {
  kernel
    .register("Load", load)
    .register("Unload", (vm) => vm.acc)
    .register("Lock", lock)
    .register("ResCheck", resCheck)
    .register("Purge", (vm) => vm.acc)
    .register("ScriptID", scriptId)
    .register("DisposeScript", disposeScript);
}
