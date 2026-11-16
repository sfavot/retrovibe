/**
 * Noyau, groupe « évènements » : `GetEvent`, `MapKeyToDir`, `GlobalToLocal`, `LocalToGlobal`, `HaveMouse`.
 *
 * Référence : `engines/sci/engine/kevent.cpp` (`kGetEvent`, `kMapKeyToDir`, `kGlobalToLocal32`, `kLocalToGlobal32`,
 * `kHaveMouse`) de ScummVM, GPL v3 ou ultérieure, lu puis réécrit. La file est dans `engine/events.ts`.
 *
 * - `GetEvent(masque, évènement)` : écrit toujours `x` et `y` (position du pointeur à l'écran), puis `type`, `message` et
 *   `modifiers` ; rend 1 s'il y avait un évènement, 0 pour l'évènement nul.
 * - **Boucles d'attente** : les scripts ont des boucles qui relisent la file sans jamais appeler `FrameOut` (aide « ? » de la
 *   barre d'icônes, glisser d'un curseur de réglage, attente du relâchement d'un bouton). ScummVM compte les `GetEvent`
 *   depuis le dernier `FrameOut` (`_eventCounter`) et, à partir du troisième, rafraîchit l'écran et attend 10 ms : le temps
 *   passe et les entrées arrivent. Ici, à partir de la troisième lecture depuis le dernier `FrameOut`, `GetEvent` sert la
 *   file puis **rend la main** (`SUSPEND_GET_EVENT`) : la page présente l'image (le curseur suit le pointeur), l'horloge
 *   avance d'un tick et les entrées reçues entre-temps sont dans la file à la lecture suivante.
 * - `MapKeyToDir(évènement)` : une touche de direction devient un évènement `Direction` (0x10 en SCI32) dont le message est
 *   la direction ; rend 1, 0 pour une autre touche, et l'accumulateur tel quel si ce n'est pas un appui de touche.
 * - `GlobalToLocal(évènement, plan)` et `LocalToGlobal` : retirent ou ajoutent le coin haut gauche du plan ; rendent 1.
 *
 * Écarts volontaires : une lecture de trop coûte un tick de 1/60 s (une image de la page), pas 10 ms ; `GlobalToLocal` et `LocalToGlobal` à un seul argument (suivi de la souris de `Cat`, éditeur de polygones)
 * prennent le plan de la propriété `plane` de l'objet, et ne font rien s'il n'y en a pas : ScummVM lit alors un argument
 * absent (comportement **supposé**) ; un plan inconnu est un avertissement, pas une erreur.
 */
import { frameoutOf } from "../../render/frameout";
import { EventType, eventsOf, KEY_DIRECTIONS } from "../events";
import { fromInt, NULL_REG, type Reg, SIGNAL_REG, toSint16 } from "../memory";
import { readSelector, writeSelector } from "../object";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

/** Motif de suspension d'une boucle d'attente sur `GetEvent` (`RunResult.reason`). */
export const SUSPEND_GET_EVENT = "GetEvent";

const WORD_MASK = 0xffff;
/** Lectures de la file permises entre deux `FrameOut` avant de rendre la main (`kGetEvent` : `_eventCounter > 2`). */
const FREE_POLLS = 2;

function getEvent(vm: Vm, argv: Uint32Array): Reg {
  const events = eventsOf(vm);
  const event = events.next(argv[0] & WORD_MASK);
  if (events.countPoll() > FREE_POLLS) vm.suspend(SUSPEND_GET_EVENT);
  const target = argv[1];
  const write = (name: string, value: number): void => writeSelector(vm.memory, target, vm.selectors.id(name), fromInt(value));
  write("x", event.x);
  write("y", event.y);
  write("type", event.type);
  write("message", event.message);
  write("modifiers", event.modifiers);
  return event.type === EventType.None ? NULL_REG : 1;
}

function mapKeyToDir(vm: Vm, argv: Uint32Array): Reg {
  const typeSelector = vm.selectors.id("type");
  const messageSelector = vm.selectors.id("message");
  if ((readSelector(vm.memory, argv[0], typeSelector) & WORD_MASK) !== EventType.KeyDown) return vm.acc;
  const direction = KEY_DIRECTIONS.get(readSelector(vm.memory, argv[0], messageSelector) & WORD_MASK);
  if (direction === undefined) return NULL_REG;
  writeSelector(vm.memory, argv[0], typeSelector, EventType.Direction);
  writeSelector(vm.memory, argv[0], messageSelector, direction);
  return 1;
}

/** Déplace le point d'un objet du repère de l'écran à celui d'un plan (`sign` −1) ou l'inverse (`sign` 1). */
function shiftByPlane(sign: 1 | -1, name: string) {
  return (vm: Vm, argv: Uint32Array): Reg => {
    const planeObject = argv.length > 1 ? argv[1] : readSelector(vm.memory, argv[0], vm.selectors.id("plane"));
    if (planeObject === NULL_REG) return vm.acc;
    const plane = frameoutOf(vm).findPlane(planeObject);
    if (!plane) {
      vm.warn(`${name} : ${vm.nameOf(planeObject)} n'est pas un plan connu`);
      return NULL_REG;
    }
    const xSelector = vm.selectors.id("x");
    const ySelector = vm.selectors.id("y");
    writeSelector(vm.memory, argv[0], xSelector, fromInt(toSint16(readSelector(vm.memory, argv[0], xSelector)) + sign * plane.gameRect.left));
    writeSelector(vm.memory, argv[0], ySelector, fromInt(toSint16(readSelector(vm.memory, argv[0], ySelector)) + sign * plane.gameRect.top));
    return 1;
  };
}

export function registerEventKernel(kernel: Kernel): void {
  kernel
    .register("GetEvent", getEvent)
    .register("MapKeyToDir", mapKeyToDir)
    .register("GlobalToLocal", shiftByPlane(-1, "GlobalToLocal"))
    .register("LocalToGlobal", shiftByPlane(1, "LocalToGlobal"))
    .register("HaveMouse", () => SIGNAL_REG);
}
