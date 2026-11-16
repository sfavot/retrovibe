/**
 * Noyau, groupe « cinématiques » : `ShowMovie`, forme DOS (`docs/gk1/engine.md` § 5).
 *
 * Référence : `engines/sci/engine/kvideo.cpp` (`kShowMovie32`) et `engines/sci/graphics/video32.cpp` (`SEQPlayer::play`) de
 * ScummVM, GPL v3 ou ultérieure, lus puis réécrits. Le travail est fait par `render/seq-player.ts`.
 *
 * - `ShowMovie(nom, durée[, x, y])` : joue le fichier `SEQ` de ce nom, `durée` ticks de 1/60 s par image (7 ou 8 dans les
 *   scripts), toile posée en (`x`, `y`) à l'écran (0, 0 par défaut). La fonction ne revient qu'à la fin de la cinématique ou à
 *   son interruption, et laisse l'accumulateur tel quel.
 * - **Attente** : la fonction empile une trame du noyau dont la continuation avance la cinématique puis rend la main
 *   (`SUSPEND_SHOW_MOVIE`), une fois par image du jeu, jusqu'à la fin : les scripts ne tournent pas pendant la lecture.
 * - Forme Windows (`ShowMovie(0 | 1 | 2 | 6, …)`, fichiers AVI absents du CD) : jamais appelée puisque `Platform` répond
 *   DOS ; signalée par un avertissement, sans effet.
 *
 * Écarts volontaires : ScummVM ne lit `x` et `y` que s'il y a quatre arguments, puis les ignore ; ici aussi il en faut
 * quatre, et ils placent l'image.
 */
import { seqPlayerOf } from "../../render/seq-player";
import { isPointer, type Reg, toSint16 } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

/** Motif de suspension pendant une cinématique (`RunResult.reason`). */
export const SUSPEND_SHOW_MOVIE = "ShowMovie";

const SHOW_MOVIE = "ShowMovie";
/** Nombre d'arguments à partir duquel `x` et `y` sont donnés. */
const ARGC_WITH_POSITION = 4;

function showMovie(vm: Vm, argv: Uint32Array): Reg {
  if (argv.length < 2 || !isPointer(argv[0])) {
    vm.warn(`ShowMovie : forme Windows (${argv.length > 0 ? toSint16(argv[0]) : "sans argument"}) non portée`);
    return vm.acc;
  }
  const positioned = argv.length >= ARGC_WITH_POSITION;
  seqPlayerOf(vm).play(vm.memory.getString(argv[0]), toSint16(argv[1]), positioned ? toSint16(argv[2]) : 0, positioned ? toSint16(argv[3]) : 0);
  return vm.beginNative(SHOW_MOVIE, []);
}

/** Avance la cinématique d'une image du jeu ; rend la main tant qu'elle n'est pas finie. */
function showMovieStep(vm: Vm): boolean {
  if (seqPlayerOf(vm).advance(vm.ticks)) return true;
  vm.suspend(SUSPEND_SHOW_MOVIE);
  return false;
}

export function registerMovieKernel(kernel: Kernel): void {
  kernel.register(SHOW_MOVIE, showMovie).continuation(SHOW_MOVIE, showMovieStep);
}
