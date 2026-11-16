/**
 * Noyau, groupe « plans et écran » : `AddPlane`, `UpdatePlane`, `DeletePlane`, `GetHighPlanePri`, `AddScreenItem`,
 * `UpdateScreenItem`, `DeleteScreenItem`, `FrameOut`, `IsHiRes`, `Graph`.
 *
 * Référence : `engines/sci/engine/kgraphics32.cpp` de ScummVM (`kAddPlane`, `kUpdatePlane`, `kDeletePlane`,
 * `kGetHighPlanePri`, `kAddScreenItem`, `kUpdateScreenItem`, `kDeleteScreenItem`, `kFrameOut`, `kIsHiRes`), GPL v3 ou
 * ultérieure, lu puis réécrit. Le travail est fait par `render/frameout.ts`.
 *
 * - Les fonctions de plans et d'éléments reçoivent l'objet des scripts et laissent l'accumulateur tel quel.
 * - `FrameOut` compose l'image puis **rend la main** (`SUSPEND_FRAME_OUT`). `FrameOut(0)` compose sans présenter, donc sans
 *   suspendre. Les défilements animés (`SetScroll`) avancent juste avant.
 * - **Pendant une transition** (`SetShowStyle`, `GfxFrameout::kernelFrameOut` et `GfxTransitions32::processShowStyles` de
 *   ScummVM) : `FrameOut` avance les transitions au lieu de composer simplement ; si l'une d'elles n'est pas animée, il ne
 *   revient qu'à sa fin, en rendant la main à chaque image (continuation `ShowStyles`).
 * - `IsHiRes` répond non (`plan.md`, D4). `Graph(1)` rend le nombre de couleurs de l'écran, 256 : le script 10 le compare
 *   à 2 et à 16 ; `kgraphics32.cpp` ne définit pas cette fonction, la réponse reste **supposée** (`engine.md` § 5).
 *
 * Écarts volontaires : `Graph` n'a que cette sous-fonction, les autres sont signalées et rendent 0 ; pas de cadence
 * imposée par `FrameOut` (ScummVM y attend la fin de la période de 1/60 s : ici c'est la boucle du jeu qui cadence) ; avec
 * des transitions toutes animées, l'image est quand même composée (ScummVM ne la compose pas) ; rythme des étapes d'une
 * transition : `render/transitions.ts`.
 */
import { frameoutOf } from "../../render/frameout";
import { GRAPH_GET_COLORS, SCREEN_COLORS } from "../../render/ids";
import { eventsOf } from "../events";
import { fromInt, NULL_REG, type Reg } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

/** Motif de suspension de `FrameOut` (`RunResult.reason`). */
export const SUSPEND_FRAME_OUT = "FrameOut";

const SHOW_STYLES = "ShowStyles";

function frameOut(vm: Vm, argv: Uint32Array): Reg {
  const frameout = frameoutOf(vm);
  const show = argv.length === 0 || argv[0] !== 0;
  if (show && frameout.transitions.showStyles.length > 0) return vm.beginNative(SHOW_STYLES, [0]);
  frameout.transitions.processScrolls();
  frameout.frameOut();
  eventsOf(vm).frameShown();
  if (show) vm.suspend(SUSPEND_FRAME_OUT);
  return vm.acc;
}

/**
 * `FrameOut` pendant une transition. État : ticks à attendre avant l'étape suivante. Chaque passage avance les
 * transitions d'une étape, compose l'image et rend la main ; tant qu'une transition sans animation n'a pas fini, les
 * scripts ne reprennent pas.
 */
function showStylesStep(vm: Vm, state: number[]): boolean {
  if (state[0] > 0) {
    state[0]--;
    vm.suspend(SUSPEND_FRAME_OUT);
    return false;
  }
  const frameout = frameoutOf(vm);
  const pass = frameout.transitions.processShowStyles();
  frameout.frameOut();
  eventsOf(vm).frameShown();
  vm.suspend(SUSPEND_FRAME_OUT);
  if (!pass.unfinished || !pass.blocking) return true;
  state[0] = pass.delay - 1;
  return false;
}

function graph(vm: Vm, argv: Uint32Array): Reg {
  if (argv[0] === GRAPH_GET_COLORS) return SCREEN_COLORS;
  vm.warn(`Graph : sous-fonction ${argv[0]} non portée`);
  return NULL_REG;
}

export function registerPlaneKernel(kernel: Kernel): void {
  const onObject = (action: (vm: Vm, object: Reg) => void) => (vm: Vm, argv: Uint32Array) => {
    action(vm, argv[0]);
    return vm.acc;
  };
  kernel
    .register("AddPlane", onObject((vm, object) => frameoutOf(vm).addPlane(object)))
    .register("UpdatePlane", onObject((vm, object) => frameoutOf(vm).updatePlane(object)))
    .register("DeletePlane", onObject((vm, object) => frameoutOf(vm).deletePlane(object)))
    .register("GetHighPlanePri", (vm) => fromInt(frameoutOf(vm).topPlanePriority()))
    .register("AddScreenItem", onObject((vm, object) => frameoutOf(vm).addScreenItem(object)))
    .register("UpdateScreenItem", onObject((vm, object) => frameoutOf(vm).updateScreenItem(object)))
    .register("DeleteScreenItem", onObject((vm, object) => frameoutOf(vm).deleteScreenItem(object)))
    .register("FrameOut", frameOut)
    .register("IsHiRes", () => NULL_REG)
    .register("Graph", graph)
    .continuation(SHOW_STYLES, showStylesStep);
}
