/**
 * Noyau, groupe « déplacement » : `InitBresen`, `DoBresen`, `SetJump`, `DirLoop`, `BaseSetter`, `CantBeHere`.
 *
 * Références : `engines/sci/engine/kmovement.cpp` (`kInitBresen`, `kDoBresen`, `kSetJump`), `kgraphics.cpp` (`kDirLoop`,
 * `kCantBeHere`), `kgraphics32.cpp` (`kBaseSetter32`) et `graphics/compare.cpp` (`kernelCantBeHere32`) de ScummVM, GPL v3 ou
 * ultérieure, lus puis réécrits. Les calculs sont dans `engine/motion.ts`.
 *
 * - `InitBresen(mouvement[, facteur])` : prépare la ligne du `client` du mouvement vers (`x`, `y`) du mouvement.
 * - `DoBresen(mouvement)` : avance le client d'un pas, lui demande `cantBeHere` et, s'il gêne, le remet tel qu'il était
 *   (toutes ses propriétés) avec le bit « obstacle » de `signal` ; arrivé à la cible, envoie `moveDone` au mouvement.
 *   Comme l'original, l'arrivée se juge sur la position **tentée** : `moveDone` part même si le dernier pas a été refusé.
 *   La cadence (`b-moveCnt`, `moveSpeed`) est tenue par `Motion::doit`, pas par le noyau.
 * - `SetJump(objet, dx, dy, gravité)` : écrit `xStep` et `yStep`.
 * - `DirLoop(objet, cap)` : écrit `loop`, sauf si `signal` l'interdit.
 * - `BaseSetter(objet)` : écrit `brLeft`, `brTop`, `brRight`, `brBottom`.
 * - `CantBeHere(objet, liste)` : 1 si la base de l'objet recouvre celle d'un autre objet de la liste, 0 sinon ; un objet
 *   caché ou qui ignore les acteurs ne gêne pas et n'est pas gêné.
 *
 * Écart volontaire : `DoBresen` n'appelle pas la machine virtuelle récursivement ; il envoie `cantBeHere` et `moveDone` par
 * une continuation (`Vm.beginNative`), comme les itérations de listes, et son état reste une liste de nombres.
 */
import { frameoutOf } from "../../render/frameout";
import { fromInt, NULL_REG, type Reg, SciError, toSint16 } from "../memory";
import {
  baseRect,
  type BaseRect,
  basesCollide,
  initBresenham,
  isValidBase,
  jumpSteps,
  loopForHeading,
  SIGNAL_DOESNT_TURN,
  SIGNAL_HIDDEN,
  SIGNAL_HIT_OBSTACLE,
  SIGNAL_IGNORE_ACTOR,
  stepBresenham,
} from "../motion";
import { readSelector, writeSelector } from "../object";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
const DO_BRESEN = "DoBresen";

function read(vm: Vm, object: Reg, name: string): number {
  return toSint16(readSelector(vm.memory, object, vm.selectors.id(name)));
}

function write(vm: Vm, object: Reg, name: string, value: number): void {
  writeSelector(vm.memory, object, vm.selectors.id(name), fromInt(value));
}

function initBresen(vm: Vm, argv: Uint32Array): Reg {
  const mover = argv[0];
  const client = readSelector(vm.memory, mover, vm.selectors.id("client"));
  const line = initBresenham(
    read(vm, client, "x"),
    read(vm, client, "y"),
    read(vm, mover, "x"),
    read(vm, mover, "y"),
    read(vm, client, "xStep"),
    read(vm, client, "yStep"),
    argv.length > 1 ? toSint16(argv[1]) : 1,
  );
  write(vm, mover, "dx", line.dx);
  write(vm, mover, "dy", line.dy);
  write(vm, mover, "b-i1", line.i1);
  write(vm, mover, "b-i2", line.i2);
  write(vm, mover, "b-di", line.di);
  write(vm, mover, "b-incr", line.incr);
  write(vm, mover, "b-xAxis", line.xAxis ? 1 : 0);
  return vm.acc;
}

/** État de la continuation de `DoBresen` ; les propriétés sauvées du client suivent. */
const STATE_PHASE = 0;
const STATE_MOVER = 1;
const STATE_CLIENT = 2;
const STATE_ARRIVED = 3;
const STATE_DI = 4;
const STATE_BACKUP = 5;
const PHASE_MOVE = 0;
const PHASE_CHECKED = 1;
const PHASE_DONE = 2;

function doBresen(vm: Vm, argv: Uint32Array): Reg {
  const mover = argv[0];
  const client = readSelector(vm.memory, mover, vm.selectors.id("client"));
  const source = vm.memory.getObject(client);
  if (!source) throw new SciError(`DoBresen : le client de ${vm.nameOf(mover)} n'est pas un objet`);
  write(vm, client, "signal", read(vm, client, "signal") & ~SIGNAL_HIT_OBSTACLE);
  return vm.beginNative(DO_BRESEN, [PHASE_MOVE, mover, client, 0, 0]);
}

function continueBresen(vm: Vm, state: number[]): boolean {
  const mover = state[STATE_MOVER];
  const client = state[STATE_CLIENT];
  if (state[STATE_PHASE] === PHASE_MOVE) {
    const x = read(vm, client, "x");
    const y = read(vm, client, "y");
    const targetX = read(vm, mover, "x");
    const targetY = read(vm, mover, "y");
    const line = {
      dx: read(vm, mover, "dx"),
      dy: read(vm, mover, "dy"),
      i1: read(vm, mover, "b-i1"),
      i2: read(vm, mover, "b-i2"),
      di: read(vm, mover, "b-di"),
      incr: read(vm, mover, "b-incr"),
      xAxis: read(vm, mover, "b-xAxis") !== 0,
    };
    write(vm, mover, "xLast", x);
    write(vm, mover, "yLast", y);
    state.push(...vm.memory.getObject(client)!.vars);
    const step = stepBresenham(line, x, y, targetX, targetY);
    write(vm, client, "x", step.x);
    write(vm, client, "y", step.y);
    state[STATE_PHASE] = PHASE_CHECKED;
    state[STATE_ARRIVED] = step.x === targetX && step.y === targetY ? 1 : 0;
    state[STATE_DI] = fromInt(step.di);
    vm.acc = NULL_REG;
    vm.invoke(client, vm.selectors.id("cantBeHere"), []);
    return false;
  }
  if (state[STATE_PHASE] === PHASE_CHECKED) {
    if (vm.acc !== NULL_REG) {
      // Le pas est refusé : le client redevient ce qu'il était, la ligne n'avance pas.
      const target = vm.memory.getObject(client);
      if (target) target.vars.set(state.slice(STATE_BACKUP, STATE_BACKUP + target.vars.length));
      write(vm, client, "signal", read(vm, client, "signal") | SIGNAL_HIT_OBSTACLE);
    } else write(vm, mover, "b-di", toSint16(state[STATE_DI]));
    state.length = STATE_BACKUP;
    state[STATE_PHASE] = PHASE_DONE;
    if (state[STATE_ARRIVED] !== 0) {
      vm.invoke(mover, vm.selectors.id("moveDone"), []);
      return false;
    }
  }
  return true;
}

function setJump(vm: Vm, argv: Uint32Array): Reg {
  const steps = jumpSteps(toSint16(argv[1]), toSint16(argv[2]), toSint16(argv[3]));
  write(vm, argv[0], "xStep", steps.xStep);
  write(vm, argv[0], "yStep", steps.yStep);
  return vm.acc;
}

function dirLoop(vm: Vm, argv: Uint32Array): Reg {
  const object = argv[0];
  if ((read(vm, object, "signal") & SIGNAL_DOESNT_TURN) !== 0) return vm.acc;
  const view = frameoutOf(vm).cels.view(readSelector(vm.memory, object, vm.selectors.id("view")) & WORD_MASK);
  const loop = loopForHeading(argv[1] & WORD_MASK, view ? view.loops.length : 0);
  if (loop !== undefined) write(vm, object, "loop", loop);
  return vm.acc;
}

function baseSetter(vm: Vm, argv: Uint32Array): Reg {
  const object = argv[0];
  const unsigned = (name: string): number => readSelector(vm.memory, object, vm.selectors.id(name)) & WORD_MASK;
  const cel = frameoutOf(vm).cels.viewCel(unsigned("view"), unsigned("loop"), unsigned("cel"));
  if (!cel) {
    vm.warn(`BaseSetter : vue ${unsigned("view")} absente ou vide (objet ${vm.nameOf(object)})`);
    return vm.acc;
  }
  const rect = baseRect(read(vm, object, "x"), read(vm, object, "y"), read(vm, object, "yStep"), cel.width, cel.originX, cel.mirrored);
  write(vm, object, "brLeft", rect.left);
  write(vm, object, "brRight", rect.right);
  write(vm, object, "brBottom", rect.bottom);
  write(vm, object, "brTop", rect.top);
  return vm.acc;
}

function baseOf(vm: Vm, object: Reg): BaseRect {
  return { left: read(vm, object, "brLeft"), top: read(vm, object, "brTop"), right: read(vm, object, "brRight"), bottom: read(vm, object, "brBottom") };
}

function cantBeHere(vm: Vm, argv: Uint32Array): Reg {
  const object = argv[0];
  const ignored = SIGNAL_IGNORE_ACTOR | SIGNAL_HIDDEN;
  const base = baseOf(vm, object);
  if (!isValidBase(base) || (read(vm, object, "signal") & ignored) !== 0) return NULL_REG;
  const list = vm.memory.list(argv[1]);
  for (let at = list.first; at !== NULL_REG; ) {
    const node = vm.memory.node(at);
    if (!node) break;
    at = node.succ;
    const other = node.value;
    if (other === object || !vm.memory.getObject(other)) continue;
    if ((read(vm, other, "signal") & ignored) !== 0) continue;
    if (basesCollide(base, baseOf(vm, other))) return 1;
  }
  return NULL_REG;
}

export function registerMotionKernel(kernel: Kernel): void {
  kernel
    .register("InitBresen", initBresen)
    .register("DoBresen", doBresen)
    .continuation(DO_BRESEN, continueBresen)
    .register("SetJump", setJump)
    .register("DirLoop", dirLoop)
    .register("BaseSetter", baseSetter)
    .register("CantBeHere", cantBeHere);
}
