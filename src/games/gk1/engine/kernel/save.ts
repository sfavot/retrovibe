/**
 * Noyau, groupe « sauvegardes » : `SaveGame`, `RestoreGame`, `CheckSaveGame`, `GetSaveFiles`, `GetSaveDir`, `MakeSaveCatName`,
 * `MakeSaveFileName`, `CheckFreeSpace`, `ValidPath`, `GetCWD`, `GameIsRestarting`, `RestartGame` (`docs/gk1/plan.md`, D10 et
 * vague S2). L'image d'une partie et sa reprise sont dans `engine/save.ts`.
 *
 * Référence : `engines/sci/engine/kfile.cpp` (`kSaveGame32`, `kRestoreGame32`, `kCheckSaveGame32`, `kGetSaveFiles32`,
 * `kGetSaveDir`, `kMakeSaveCatName`, `kMakeSaveFileName`, `kCheckFreeSpace`, `kValidPath`, `kGetCWD`) et `kmisc.cpp`
 * (`kGameIsRestarting`, `kRestartGame`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Ce que les fenêtres du jeu (scripts 64990 et 64994) en attendent :
 * - `GetSaveDir()` rend un tableau de caractères (le dossier, vide ici) que `Game::init` range dans une `Str` ; `ValidPath` dit
 *   oui, `CheckFreeSpace(dossier, 2)` aussi (0 : taille d'une sauvegarde, inconnue ; 1 : place libre, « beaucoup ») ;
 * - `GetSaveFiles(jeu, noms, numéros)` rend le nombre de sauvegardes, écrit leurs noms dans des cases de 36 octets (plus un 0
 *   final) et leurs numéros (plus un 0 final) ;
 * - `SaveGame(jeu, numéro, nom[, version])` rend 1, ou 0 si la sauvegarde échoue (cinématique, stockage plein) : le jeu
 *   affiche alors son propre message ;
 * - `CheckSaveGame(jeu, numéro, version)` dit si la sauvegarde existe, se relit et vient de la même version du jeu ;
 *   `RestoreGame(jeu, numéro, version)` la reprend : **la fonction « revient » alors dans la partie reprise**, à la suite du
 *   `SaveGame` d'origine, accumulateur à 1 ;
 * - `MakeSaveCatName` et `MakeSaveFileName` donnent les noms d'origine (`GKsg.cat`, `GKsg.007`) : `FileIO` les reconnaît
 *   (`fileio.ts`), c'est par `FileIO(Unlink)` que la fenêtre efface une sauvegarde ;
 * - `RestartGame` remet tout à neuf et relance `play` ; `GameIsRestarting` rend 1 ensuite, jusqu'à `GameIsRestarting(0)`.
 *
 * Écarts volontaires : le numéro `n` du jeu est l'emplacement `n + 1` de `SaveSlots` (ScummVM décale aussi, pour sa
 * sauvegarde automatique) ; pas de `FrameOut` avant de sauver (ScummVM en fait un pour cacher ses propres fenêtres) ; après
 * `RestoreGame` les scripts ne passent pas par `replay` (l'image reprend l'exécution elle-même) ; `CheckSaveGame` ne compare
 * pas la taille du script 0, l'image porte sa version de format.
 */
import { ArrayType } from "../ids";
import { fromInt, NULL_REG, type Reg, SciArray, toSint16 } from "../memory";
import { canSaveGame, captureGame, collectBeforeSave, restartGame, restoreGame, SAVE_NAME_LENGTH, saveStoreOf } from "../save";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const TRUE_REG: Reg = 1;
const CheckFreeSpaceOp = { SaveSize: 0, FreeSpace: 1, Enough: 2 } as const;
/** Place libre annoncée, en kilo-octets (le maximum d'un entier signé). */
const FREE_SPACE = 0x7fff;
const SAVE_NUMBER_DIGITS = 3;

/** Nom du catalogue d'origine des sauvegardes d'un jeu. */
export function saveCatalogueName(game: string): string {
  return `${game}sg.cat`;
}

/** Nom du fichier d'origine de la sauvegarde `number` d'un jeu. */
export function saveFileName(game: string, number: number): string {
  return `${game}sg.${String(number).padStart(SAVE_NUMBER_DIGITS, "0")}`;
}

/** Emplacement de `SaveSlots` de la sauvegarde numéro `number` du jeu. */
export function slotOfSaveNumber(number: number): number {
  return number + 1;
}

function stringArgument(vm: Vm, argv: Uint32Array, index: number): string {
  return argv.length > index && argv[index] !== NULL_REG ? vm.memory.getString(argv[index]) : "";
}

function getSaveDir(vm: Vm): Reg {
  const store = saveStoreOf(vm);
  if (store.saveDir === NULL_REG) store.saveDir = vm.memory.arrays.allocate(new SciArray(ArrayType.String, 1));
  return store.saveDir;
}

function getSaveFiles(vm: Vm, argv: Uint32Array): Reg {
  const { slots } = saveStoreOf(vm);
  const names = vm.memory.array(argv[1]);
  const numbers = vm.memory.array(argv[2]);
  const saves: { number: number; name: string }[] = [];
  for (let slot = 1; slot <= slots.count; slot++) {
    const stored = slots.read(slot);
    if (stored) saves.push({ number: slot - 1, name: stored.save.name });
  }
  names.resize(SAVE_NAME_LENGTH * saves.length + 1, true);
  names.fill(0, names.size, 0);
  numbers.resize(saves.length + 1, true);
  saves.forEach((save, index) => {
    for (let i = 0; i < Math.min(save.name.length, SAVE_NAME_LENGTH); i++) names.set(SAVE_NAME_LENGTH * index + i, save.name.charCodeAt(i));
    numbers.set(index, fromInt(save.number));
  });
  numbers.set(saves.length, 0);
  return fromInt(saves.length);
}

function saveGame(vm: Vm, argv: Uint32Array): Reg {
  if (!canSaveGame(vm)) return NULL_REG;
  const store = saveStoreOf(vm);
  collectBeforeSave(vm, argv);
  const image = captureGame(vm, stringArgument(vm, argv, 2), stringArgument(vm, argv, 3));
  // L'image reprend au retour de cette fonction, réussie.
  image.vm.acc = TRUE_REG;
  return store.slots.write(slotOfSaveNumber(toSint16(argv[1])), image, store.now()) ? TRUE_REG : NULL_REG;
}

function checkSaveGame(vm: Vm, argv: Uint32Array): Reg {
  const stored = saveStoreOf(vm).slots.read(slotOfSaveNumber(toSint16(argv[1])));
  if (!stored) return NULL_REG;
  const version = stringArgument(vm, argv, 2);
  return version === "" || stored.save.gameVersion === "" || stored.save.gameVersion === version ? TRUE_REG : NULL_REG;
}

function restoreGameKernel(vm: Vm, argv: Uint32Array): Reg {
  const stored = saveStoreOf(vm).slots.read(slotOfSaveNumber(toSint16(argv[1])));
  if (!stored) return NULL_REG;
  try {
    restoreGame(vm, stored.save);
  } catch (error) {
    vm.warn(`RestoreGame : ${error instanceof Error ? error.message : String(error)}`);
    return NULL_REG;
  }
  // L'accumulateur de la partie reprise : 1, la valeur de son `SaveGame`.
  return vm.acc;
}

function checkFreeSpace(vm: Vm, argv: Uint32Array): Reg {
  const op = argv.length > 1 ? argv[1] : CheckFreeSpaceOp.Enough;
  switch (op) {
    case CheckFreeSpaceOp.SaveSize:
      return NULL_REG;
    case CheckFreeSpaceOp.FreeSpace:
      return FREE_SPACE;
    case CheckFreeSpaceOp.Enough:
      return TRUE_REG;
    default:
      vm.warn(`CheckFreeSpace : sous-fonction ${op} inconnue`);
      return NULL_REG;
  }
}

function writeName(vm: Vm, target: Reg, name: string): Reg {
  vm.memory.setString(target, name);
  return target;
}

function gameIsRestarting(vm: Vm, argv: Uint32Array): Reg {
  const store = saveStoreOf(vm);
  const restarting = store.restarting;
  if (argv.length > 0 && argv[0] === 0) store.restarting = 0;
  return restarting;
}

export function registerSaveKernel(kernel: Kernel): void {
  kernel
    .register("GetSaveDir", getSaveDir)
    .register("GetSaveFiles", getSaveFiles)
    .register("SaveGame", saveGame)
    .register("CheckSaveGame", checkSaveGame)
    .register("RestoreGame", restoreGameKernel)
    .register("CheckFreeSpace", checkFreeSpace)
    .register("ValidPath", () => TRUE_REG)
    .register("GetCWD", (vm, argv) => writeName(vm, argv[0], "/"))
    .register("MakeSaveCatName", (vm, argv) => writeName(vm, argv[0], saveCatalogueName(vm.memory.getString(argv[1]))))
    .register("MakeSaveFileName", (vm, argv) => writeName(vm, argv[0], saveFileName(vm.memory.getString(argv[1]), toSint16(argv[2]))))
    .register("GameIsRestarting", gameIsRestarting)
    .register("RestartGame", (vm) => {
      restartGame(vm);
      return vm.acc;
    });
}
