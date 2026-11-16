/**
 * Ramasse-miettes de la mémoire des scripts : libère les clones, listes, nœuds, tableaux et bitmaps qu'aucune référence n'atteint plus.
 *
 * Référence : `engines/sci/engine/gc.cpp` (`find_all_used_references`, `run_gc`) et les `listAllOutgoingReferences` de
 * `segment.cpp` et `script.cpp` de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * SCI libère peu de choses explicitement : `DisposeClone` marque, `DisposeList` et `DeleteKey` ne libèrent rien ici (comme
 * dans ScummVM), et un clone de plus naît à chaque évènement. Les **racines** sont l'accumulateur, la valeur précédente, la
 * pile de valeurs jusqu'au plus haut sommet des trames, les objets des trames, l'état des continuations du noyau, les objets
 * et variables locales des scripts chargés, et les racines ajoutées par les autres modules (`Vm.gcRoots`). Une référence
 * étant distincte d'un entier, le marquage est exact.
 *
 * Écarts volontaires : toute la pile sous le plus haut sommet est une racine, ainsi que tous les nombres de l'état des
 * continuations (prudent, sans risque : un entier n'est pas une référence) ; les segments des scripts déchargés ne sont
 * jamais rendus (213 scripts au plus, et un script rechargé reprend le sien) ; le marquage d'un objet de script n'entraîne
 * que ses propriétés et les variables locales de son script, comme ScummVM.
 */
import { Segment } from "./ids";
import { type Reg, regOffset, regSegment } from "./memory";
import type { Vm } from "./vm";

export interface GarbageReport {
  clones: number;
  lists: number;
  nodes: number;
  arrays: number;
  bitmaps: number;
}

/** Libère ce qui n'est plus accessible et dit combien d'entrées de chaque table l'ont été. */
export function collectGarbage(vm: Vm): GarbageReport {
  const memory = vm.memory;
  const marked = new Set<Reg>();
  const markedLocals = new Set<number>();
  const work: Reg[] = [];
  const push = (reg: Reg): void => {
    if (reg >= 0x10000) work.push(reg);
  };
  const pushAll = (values: ArrayLike<Reg>): void => {
    for (let i = 0; i < values.length; i++) push(values[i]);
  };

  push(vm.acc);
  push(vm.prev);
  let top = 0;
  for (const frame of vm.frames) {
    push(frame.objp);
    push(frame.sendp);
    pushAll(frame.state);
    top = Math.max(top, frame.sp, frame.argp + frame.argc + 1);
  }
  pushAll(memory.stack.subarray(0, top));
  for (const script of memory.scriptSegments()) {
    if (script.deleted || script.lockers <= 0) continue;
    for (const object of script.objects.values()) pushAll(object.vars);
    if (script.localsSegment !== 0) pushAll(memory.localsSegment(script.localsSegment)!.values);
  }
  for (const roots of vm.gcRoots) for (const reg of roots()) push(reg);

  while (work.length > 0) {
    const reg = work.pop()!;
    const segment = regSegment(reg);
    if (segment === Segment.Stack || segment === Segment.Uninitialized) continue;
    if (segment < Segment.FirstDynamic) {
      if (marked.has(reg)) continue;
      marked.add(reg);
      if (segment === Segment.Clones) {
        const clone = memory.clones.get(reg);
        if (clone) {
          pushAll(clone.vars);
          push(clone.origin);
        }
      } else if (segment === Segment.Lists) {
        const list = memory.lists.get(reg);
        if (list) {
          push(list.first);
          push(list.last);
          pushAll(list.nextNodes);
        }
      } else if (segment === Segment.Nodes) {
        const node = memory.nodes.get(reg);
        if (node) {
          push(node.pred);
          push(node.succ);
          push(node.key);
          push(node.value);
        }
      } else if (segment === Segment.Arrays) {
        const array = memory.arrays.get(reg);
        if (array) pushAll(array.references());
      }
      continue;
    }
    const locals = memory.localsSegment(segment);
    if (locals) {
      if (!markedLocals.has(segment)) {
        markedLocals.add(segment);
        pushAll(locals.values);
      }
      continue;
    }
    const script = memory.scriptSegment(segment);
    const object = script?.objects.get(regOffset(reg));
    if (!script || !object || marked.has(reg)) continue;
    marked.add(reg);
    pushAll(object.vars);
    if (script.localsSegment !== 0) push(script.localsSegment * 0x10000);
  }

  const report: GarbageReport = { clones: 0, lists: 0, nodes: 0, arrays: 0, bitmaps: 0 };
  const sweep = (table: { release(reg: Reg): void; [Symbol.iterator](): IterableIterator<[Reg, unknown]> }, kind: keyof GarbageReport): void => {
    for (const [reg] of [...table]) {
      if (marked.has(reg)) continue;
      table.release(reg);
      report[kind]++;
    }
  };
  sweep(memory.clones, "clones");
  sweep(memory.lists, "lists");
  sweep(memory.nodes, "nodes");
  sweep(memory.arrays, "arrays");
  sweep(memory.bitmaps, "bitmaps");
  return report;
}
