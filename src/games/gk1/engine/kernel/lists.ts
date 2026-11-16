/**
 * Noyau, groupe « listes » : les dix-neuf fonctions de listes de SCI2 (chacune a son indice ; SCI2.1 les regroupera en
 * sous-fonctions de `List`).
 *
 * Référence : `engines/sci/engine/klists.cpp` (`kNewList`, `kNewNode`, `kFirstNode`, `kLastNode`, `kEmptyList`, `kNextNode`,
 * `kPrevNode`, `kNodeValue`, `kAddAfter`, `kAddToFront`, `kAddToEnd`, `kFindKey`, `kDeleteKey`, `kListAt`, `kListIndexOf`,
 * `kListEachElementDo`, `kListFirstTrue`, `kListAllTrue`) de ScummVM, GPL v3 ou ultérieure, lu puis réécrit.
 *
 * Une liste est doublement chaînée ; un nœud porte une clé et une valeur (la même, sauf demande contraire). Comme ScummVM,
 * `DisposeList` et `DeleteKey` ne libèrent rien : le ramasse-miettes (`gc.ts`) reprend listes et nœuds devenus inaccessibles,
 * ce qui tolère les scripts qui relisent un nœud retiré.
 *
 * Écart volontaire : `ListEachElementDo`, `ListFirstTrue` et `ListAllTrue` n'appellent pas la machine virtuelle
 * récursivement ; ils passent par une continuation (`Vm.beginNative`) dont l'état est une liste de nombres, pour qu'un
 * `FrameOut` atteint depuis un élément suspende l'exécution. Si la liste disparaît pendant l'itération, celle-ci s'arrête.
 */
import { LIST_MAX_RECURSION } from "../ids";
import { formatReg, newList, NULL_REG, type Reg, SciError, type SciList, SIGNAL_REG } from "../memory";
import { lookupSelector, newLookup, SelectorKind } from "../object";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
const lookup = newLookup();

function newNode(vm: Vm, argv: Uint32Array): Reg {
  const value = argv[0];
  return vm.memory.nodes.allocate({ pred: NULL_REG, succ: NULL_REG, key: argv.length === 2 ? argv[1] : value, value });
}

function addToFront(vm: Vm, list: SciList, nodeReg: Reg): void {
  const node = vm.memory.node(nodeReg);
  if (!node) throw new SciError("ajout d'un nœud nul à une liste");
  node.pred = NULL_REG;
  node.succ = list.first;
  const first = vm.memory.node(list.first);
  if (first) first.pred = nodeReg;
  else list.last = nodeReg;
  list.first = nodeReg;
}

function addToEnd(vm: Vm, list: SciList, nodeReg: Reg): void {
  const node = vm.memory.node(nodeReg);
  if (!node) throw new SciError("ajout d'un nœud nul à une liste");
  node.succ = NULL_REG;
  node.pred = list.last;
  const last = vm.memory.node(list.last);
  if (last) last.succ = nodeReg;
  else list.first = nodeReg;
  list.last = nodeReg;
}

function addAfter(vm: Vm, argv: Uint32Array): Reg {
  const list = vm.memory.list(argv[0]);
  const after = vm.memory.node(argv[1]);
  const node = vm.memory.node(argv[2]);
  if (!node) throw new SciError("AddAfter d'un nœud nul");
  if (argv.length === 4) node.key = argv[3];
  if (!after) {
    addToFront(vm, list, argv[2]);
    return vm.acc;
  }
  const next = after.succ;
  node.pred = argv[1];
  node.succ = next;
  after.succ = argv[2];
  const nextNode = vm.memory.node(next);
  if (nextNode) nextNode.pred = argv[2];
  else list.last = argv[2];
  return vm.acc;
}

function findKey(vm: Vm, list: SciList, key: Reg): Reg {
  for (let at = list.first; at !== NULL_REG; ) {
    const node = vm.memory.node(at)!;
    if (node.key === key) return at;
    at = node.succ;
  }
  return NULL_REG;
}

function deleteKey(vm: Vm, argv: Uint32Array): Reg {
  const list = vm.memory.list(argv[0]);
  const at = findKey(vm, list, argv[1]);
  if (at === NULL_REG) return NULL_REG;
  const node = vm.memory.node(at)!;
  // Une itération en cours qui allait passer par ce nœud passera par le suivant.
  for (let level = 1; level <= list.recursions; level++) if (list.nextNodes[level] === at) list.nextNodes[level] = node.succ;
  if (list.first === at) list.first = node.succ;
  if (list.last === at) list.last = node.pred;
  const pred = vm.memory.node(node.pred);
  if (pred) pred.succ = node.succ;
  const succ = vm.memory.node(node.succ);
  if (succ) succ.pred = node.pred;
  // Le nœud reste lisible, mais ne mène plus nulle part.
  node.pred = node.succ = NULL_REG;
  return 1;
}

function listAt(vm: Vm, argv: Uint32Array): Reg {
  const list = vm.memory.list(argv[0]);
  let index = argv[1] & WORD_MASK;
  for (let at = list.first; at !== NULL_REG; index--) {
    const node = vm.memory.node(at)!;
    if (index === 0) return node.value;
    at = node.succ;
  }
  return NULL_REG;
}

function listIndexOf(vm: Vm, argv: Uint32Array): Reg {
  const list = vm.memory.list(argv[0]);
  let index = 0;
  for (let at = list.first; at !== NULL_REG; index++) {
    const node = vm.memory.node(at)!;
    if (node.value === argv[1]) return index;
    at = node.succ;
  }
  return SIGNAL_REG;
}

// --- Itérations qui appellent des méthodes ---

const ITERATE = "ListIterate";
const IterationMode = { Each: 0, FirstTrue: 1, AllTrue: 2 } as const;
/** État de la continuation : mode, liste, sélecteur, niveau d'imbrication, « une méthode est en cours », objet courant, puis les arguments. */
const STATE_MODE = 0;
const STATE_LIST = 1;
const STATE_SELECTOR = 2;
const STATE_LEVEL = 3;
const STATE_CALLING = 4;
const STATE_CURRENT = 5;
const STATE_ARGS = 6;

function beginIteration(mode: number): (vm: Vm, argv: Uint32Array) => Reg {
  return (vm, argv) => {
    const list = vm.memory.list(argv[0]);
    if (list.recursions + 1 >= LIST_MAX_RECURSION) throw new SciError("trop d'itérations imbriquées sur une liste");
    list.recursions++;
    list.nextNodes[list.recursions] = list.first;
    if (mode === IterationMode.FirstTrue) vm.acc = NULL_REG;
    else if (mode === IterationMode.AllTrue) vm.acc = 1;
    return vm.beginNative(ITERATE, [mode, argv[0], argv[1] & WORD_MASK, list.recursions, 0, NULL_REG, ...argv.subarray(2)]);
  };
}

function iterate(vm: Vm, state: number[]): boolean {
  const mode = state[STATE_MODE];
  const level = state[STATE_LEVEL];
  const list = vm.memory.lists.get(state[STATE_LIST]);
  const finish = (): boolean => {
    if (list && list.recursions > 0) list.recursions--;
    return true;
  };
  if (state[STATE_CALLING] !== 0) {
    // La méthode de l'élément courant vient de rendre son résultat dans l'accumulateur.
    state[STATE_CALLING] = 0;
    if (mode === IterationMode.FirstTrue && vm.acc !== NULL_REG) {
      vm.acc = state[STATE_CURRENT];
      return finish();
    }
    if (mode === IterationMode.AllTrue && vm.acc === NULL_REG) return finish();
  }
  if (!list) return true;
  const selector = state[STATE_SELECTOR];
  const args = state.slice(STATE_ARGS);
  for (;;) {
    const at = list.nextNodes[level];
    const node = at === NULL_REG ? undefined : vm.memory.nodes.get(at);
    if (!node) break;
    // Le suivant est retenu avant l'appel : l'élément peut se retirer de la liste.
    list.nextNodes[level] = node.succ;
    const current = node.value;
    const object = vm.memory.getObject(current);
    if (!object) throw new SciError(`élément de liste ${formatReg(current)} : pas un objet`);
    if (lookupSelector(vm.memory, object, selector, lookup) === SelectorKind.Variable) {
      const value = object.vars[lookup.index];
      if (mode === IterationMode.Each) {
        if (args.length !== 1) throw new SciError(`ListEachElementDo : propriété « ${vm.selectors.name(selector)} » avec ${args.length} arguments`);
        object.setProperty(lookup.index, args[0]);
      } else if (mode === IterationMode.FirstTrue) {
        if (value !== NULL_REG) {
          vm.acc = current;
          return finish();
        }
      } else {
        vm.acc = value;
        if (value === NULL_REG) return finish();
      }
      continue;
    }
    state[STATE_CALLING] = 1;
    state[STATE_CURRENT] = current;
    vm.invoke(current, selector, args);
    return false;
  }
  if (mode === IterationMode.FirstTrue) vm.acc = NULL_REG;
  return finish();
}

export function registerListKernel(kernel: Kernel): void {
  kernel
    .register("NewList", (vm) => vm.memory.lists.allocate(newList()))
    .register("DisposeList", (vm) => vm.acc)
    .register("NewNode", newNode)
    .register("FirstNode", (vm, argv) => (argv[0] === NULL_REG ? NULL_REG : vm.memory.list(argv[0]).first))
    .register("LastNode", (vm, argv) => (argv[0] === NULL_REG ? NULL_REG : vm.memory.list(argv[0]).last))
    .register("EmptyList", (vm, argv) => (argv[0] !== NULL_REG && vm.memory.list(argv[0]).first === NULL_REG ? 1 : 0))
    .register("NextNode", (vm, argv) => vm.memory.node(argv[0])?.succ ?? NULL_REG)
    .register("PrevNode", (vm, argv) => vm.memory.node(argv[0])?.pred ?? NULL_REG)
    .register("NodeValue", (vm, argv) => vm.memory.node(argv[0])?.value ?? NULL_REG)
    .register("AddAfter", addAfter)
    .register("AddToFront", (vm, argv) => {
      addToFront(vm, vm.memory.list(argv[0]), argv[1]);
      if (argv.length === 3) vm.memory.node(argv[1])!.key = argv[2];
      return vm.acc;
    })
    .register("AddToEnd", (vm, argv) => {
      addToEnd(vm, vm.memory.list(argv[0]), argv[1]);
      if (argv.length === 3) vm.memory.node(argv[1])!.key = argv[2];
      return vm.acc;
    })
    .register("FindKey", (vm, argv) => findKey(vm, vm.memory.list(argv[0]), argv[1]))
    .register("DeleteKey", deleteKey)
    .register("ListAt", listAt)
    .register("ListIndexOf", listIndexOf)
    .register("ListEachElementDo", beginIteration(IterationMode.Each))
    .register("ListFirstTrue", beginIteration(IterationMode.FirstTrue))
    .register("ListAllTrue", beginIteration(IterationMode.AllTrue))
    .continuation(ITERATE, iterate);
}
