/**
 * Noyau, groupe « divers » : `Platform`, `GetTime`, et les fonctions de débogage que l'interpréteur vendu nomme « Dummy ».
 *
 * Référence : `engines/sci/engine/kmisc.cpp` (`kPlatform32`, `kGetTime`, `kMemoryInfo`, `kSetDebug`, `kEmpty`) de ScummVM,
 * GPL v3 ou ultérieure, lu puis réécrit.
 *
 * - `Platform` : sans argument ou avec 0, rend 1 (DOS) ; toute autre demande rend 0 (SCI2 n'a pas les sous-fonctions de SCI2.1).
 * - `GetTime` : sans argument ou avec 0, l'horloge du jeu en ticks de 1/60 s ; 1 : heure sur 12 h (`h << 12 | min << 6 | s`) ;
 *   2 : heure sur 24 h (`h << 11 | min << 5 | s / 2`) ; 3 : date DOS (`(année − 1980) << 9 | mois << 5 | jour`).
 * - `MemoryInfo` : toujours « beaucoup de mémoire » (0x7FEA octets, moins 2 pour le plus grand bloc).
 *
 * Écarts volontaires : les ticks viennent de `vm.ticks`, que la boucle du jeu avance (ScummVM lit l'horloge de la machine) ;
 * l'heure vient de `vm.wallClock`, fixe par défaut, pour des exécutions reproductibles.
 */
import { DOS_EPOCH_YEAR, GetTimeMode, PLATFORM_DOS, PLATFORM_GET } from "../ids";
import { NULL_REG, type Reg } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
/** Mémoire libre annoncée par `MemoryInfo`. */
const FREE_MEMORY = 0x7fea;
const MEMORY_INFO_LARGEST_HEAP_BLOCK = 0;
/** Fonctions de débogage, sans effet dans le jeu vendu : elles laissent l'accumulateur tel quel. */
const DEBUG_FUNCTIONS = ["SetDebug", "InspectObject", "Profiler", "Record", "PlayBack", "MonoOut", "SetFatalStr", "IntegrityChecking", "CheckIntegrity", "MarkMemory"];

function platform(_vm: Vm, argv: Uint32Array): Reg {
  return argv.length === 0 || argv[0] === PLATFORM_GET ? PLATFORM_DOS : NULL_REG;
}

function getTime(vm: Vm, argv: Uint32Array): Reg {
  const mode = argv.length > 0 ? argv[0] : GetTimeMode.Ticks;
  if (mode === GetTimeMode.Ticks) return vm.ticks & WORD_MASK;
  const now = vm.wallClock();
  switch (mode) {
    case GetTimeMode.Time12:
      return (((now.hour % 12) << 12) | (now.minute << 6) | now.second) & WORD_MASK;
    case GetTimeMode.Time24:
      return ((now.hour << 11) | (now.minute << 5) | (now.second >> 1)) & WORD_MASK;
    case GetTimeMode.Date:
      return ((((now.year - DOS_EPOCH_YEAR) & 0x7f) << 9) | (now.month << 5) | now.day) & WORD_MASK;
    default:
      vm.warn(`GetTime : mode ${mode} inconnu`);
      return NULL_REG;
  }
}

export function registerMiscKernel(kernel: Kernel): void {
  kernel
    .register("Platform", platform)
    .register("GetTime", getTime)
    .register("MemoryInfo", (_vm, argv) => (argv[0] === MEMORY_INFO_LARGEST_HEAP_BLOCK ? FREE_MEMORY - 2 : FREE_MEMORY));
  for (const name of DEBUG_FUNCTIONS) kernel.register(name, (vm) => vm.acc);
}
