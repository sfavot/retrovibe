/**
 * Noyau, groupe « effets » : `SetShowStyle`, `ShakeScreen`, `SetScroll`, `SetVideoMode`.
 *
 * Référence : `engines/sci/engine/kgraphics32.cpp` (`kSetShowStyle`, `kShakeScreen32`, `kSetScroll`),
 * `engines/sci/graphics/frameout.cpp` (`GfxFrameout::shakeScreen`) et `transitions32.cpp` (`kernelSetScroll`) de ScummVM,
 * GPL v3 ou ultérieure, lus puis réécrits. Transitions et défilements sont dans `render/transitions.ts` ; les transitions se
 * jouent dans `FrameOut` (`planes.ts`).
 *
 * - `SetShowStyle(type, plan, secondes, fond, priorité, animer, image de référence[, étapes])` : prépare la transition du
 *   plan. `fond` −1 : vers l'image ; sinon vers cette couleur. `image de référence` non nul : compose une image tout de suite,
 *   avant qu'une dissolution ne la capture. `priorité` : celle du bitmap d'une dissolution.
 * - `ShakeScreen(nombre[, direction])` : secoue l'image `nombre` fois (bit 0 : verticalement, par défaut ; bit 1 :
 *   horizontalement). Une secousse décale l'image de 4 pixels pendant 3 ticks puis la remet 3 ticks. **La fonction ne revient
 *   qu'à la fin** : sa continuation rend la main (`SUSPEND_SHAKE_SCREEN`) à chaque tick.
 * - `SetScroll(plan, deltaX, deltaY, pic, animer, ?[, miroir])` : fait défiler le plan vers un autre pic. Animé, il avance
 *   à chaque `FrameOut` ; sinon la fonction ne revient qu'à la fin, une image composée tous les deux ticks.
 * - `SetVideoMode(mode)` : bascule de mode vidéo de l'original autour des cinématiques ; sans effet ici.
 *
 * Écarts volontaires : les appels refusés (type inconnu, plan introuvable, défilement invalide) donnent un avertissement, là
 * où ScummVM s'arrête ; le miroir de `SetScroll` n'est pas géré (le seul appel, `Styler::doit` pour les styles 15 à 18, n'en
 * donne pas et n'est jamais atteint : `render/transitions.ts`).
 *
 * **Loupe** : `AddMagnify` et `DeleteMagnify` ne sont appelés que par `Magnifier::init` et `Magnifier::dispose` (script
 * 64979), et un `Magnifier` n'est créé que par `View::setMagnifier` (script 64998), qu'aucun script n'envoie : c'est du code
 * mort du système, hérité tel quel. ScummVM les range parmi les fonctions inutilisées (`kDummy` dans `kernel_tables.h`, avec
 * la même remarque sur le script 64979). Elles restent donc sans implémentation : un appel ne fait rien, rend 0 et serait
 * journalisé comme souche (`KernelJournal.stubs`). Relevé figé par `test/gk1/render/script-usage.test.ts`.
 */
import { frameoutOf } from "../../render/frameout";
import { SCROLL_STEP_TICKS, SHAKE_HALF_TICKS, SHAKE_HORIZONTAL, SHAKE_OFFSET, SHAKE_VERTICAL } from "../../render/ids";
import { type Reg, toSint16 } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";
import { SUSPEND_FRAME_OUT } from "./planes";

/** Motif de suspension pendant une secousse (`RunResult.reason`). */
export const SUSPEND_SHAKE_SCREEN = "ShakeScreen";

const WORD_MASK = 0xffff;
const SHAKE = "ShakeScreen";
const SCROLL = "SetScroll";
/** `SetShowStyle` : indice du nombre d'étapes, donné seulement par les appels à huit arguments. */
const SHOW_STYLE_DIVISIONS_ARG = 7;
/** `SetScroll` : indice de l'argument « miroir ». */
const SCROLL_MIRROR_ARG = 6;

function setShowStyle(vm: Vm, argv: Uint32Array): Reg {
  frameoutOf(vm).transitions.setShowStyle({
    type: argv[0] & WORD_MASK,
    plane: argv[1],
    seconds: toSint16(argv[2]),
    back: toSint16(argv[3]),
    priority: toSint16(argv[4]),
    animate: toSint16(argv[5]) !== 0,
    referenceFrame: toSint16(argv[6]) !== 0,
    divisions: argv.length > SHOW_STYLE_DIVISIONS_ARG ? toSint16(argv[SHOW_STYLE_DIVISIONS_ARG]) : -1,
  });
  return vm.acc;
}

function shakeScreen(vm: Vm, argv: Uint32Array): Reg {
  const count = toSint16(argv[0]);
  const direction = argv.length > 1 ? toSint16(argv[1]) : SHAKE_VERTICAL;
  return count > 0 ? vm.beginNative(SHAKE, [count, direction, 0]) : vm.acc;
}

/** État : secousses restantes, direction, tick dans la secousse en cours. */
function shakeStep(vm: Vm, state: number[]): boolean {
  const frameout = frameoutOf(vm);
  const [remaining, direction, tick] = state;
  const shifted = remaining > 0 && tick < SHAKE_HALF_TICKS;
  frameout.shakeX = shifted && (direction & SHAKE_HORIZONTAL) !== 0 ? SHAKE_OFFSET : 0;
  frameout.shakeY = shifted && (direction & SHAKE_VERTICAL) !== 0 ? SHAKE_OFFSET : 0;
  if (remaining <= 0) return true;
  if (tick + 1 < 2 * SHAKE_HALF_TICKS) state[2] = tick + 1;
  else {
    state[2] = 0;
    state[0] = remaining - 1;
  }
  vm.suspend(SUSPEND_SHAKE_SCREEN);
  return false;
}

function setScroll(vm: Vm, argv: Uint32Array): Reg {
  if (argv.length > SCROLL_MIRROR_ARG && argv[SCROLL_MIRROR_ARG] !== 0) vm.warn("SetScroll : pic retourné non géré");
  const animate = (argv[4] & WORD_MASK) !== 0;
  const scroll = frameoutOf(vm).transitions.setScroll(argv[0], toSint16(argv[1]), toSint16(argv[2]), argv[3] & WORD_MASK, animate);
  return scroll && !animate ? vm.beginNative(SCROLL, [0, scroll.x, scroll.y, scroll.deltaX, scroll.deltaY, scroll.newPictureId, scroll.oldPictureId, scroll.plane, scroll.startTick]) : vm.acc;
}

/** État : ticks d'attente, puis le défilement (`x`, `y`, `deltaX`, `deltaY`, nouveau pic, ancien pic, plan, tick de départ). */
function scrollStep(vm: Vm, state: number[]): boolean {
  if (state[0] > 0) {
    state[0]--;
    vm.suspend(SUSPEND_FRAME_OUT);
    return false;
  }
  const frameout = frameoutOf(vm);
  const [, x, y, deltaX, deltaY, newPictureId, oldPictureId, plane, startTick] = state;
  const scroll = { plane, x, y, deltaX, deltaY, newPictureId, oldPictureId, animate: false, startTick };
  const finished = frameout.transitions.processScroll(scroll);
  state[1] = scroll.x;
  state[2] = scroll.y;
  frameout.frameOut();
  vm.suspend(SUSPEND_FRAME_OUT);
  state[0] = SCROLL_STEP_TICKS - 1;
  return finished;
}

export function registerEffectKernel(kernel: Kernel): void {
  kernel
    .register("SetShowStyle", setShowStyle)
    .register("ShakeScreen", shakeScreen)
    .register("SetScroll", setScroll)
    .register("SetVideoMode", (vm) => vm.acc)
    .continuation(SHAKE, shakeStep)
    .continuation(SCROLL, scrollStep);
}
