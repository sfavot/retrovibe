/**
 * Table des méthodes natives (numéro vers fonction), assemblée à partir des tables de groupe (`group-N/index.ts`). Un numéro fourni par
 * deux groupes est refusé ; un numéro du catalogue que personne ne fournit devient une **souche** qui journalise chacun de ses appels ;
 * un numéro hors catalogue est l'avertissement « Undefined script method » de ScummVM.
 *
 * Source (ScummVM, GPL v3+) : `scriptMethods[]`, `Script::executeMethod` (engines/lure/scripts.cpp).
 *
 * Convention de la vague L : un groupe ne modifie que son dossier ; il exporte une table `Partial<Record<number, NativeMethod>>` que ce
 * fichier assemble (`METHOD_GROUPS`). L'ajout d'un groupe à `METHOD_GROUPS` est fait par le coordinateur.
 */

import type { LureContext } from "../context";
import { METHOD_CATALOG, methodInfo } from "./catalog";
import { GROUP_1_METHODS } from "./group-1/index";
import { GROUP_3_METHODS } from "./group-3/index";
import { GROUP_4_METHODS } from "./group-4/index";
import { GROUP_2_METHODS } from "./group-2/index";
import { FIGHT_METHODS } from "../fights/index";
import { SEQUENCE_METHODS } from "../sequences/index";

/** Méthode native : trois valeurs dépilées (0 si la pile est vide), dans l'ordre de ScummVM (`param1` = sommet de pile). */
export type NativeMethod = (ctx: LureContext, p1: number, p2: number, p3: number) => void;

export type MethodGroupTable = Readonly<Partial<Record<number, NativeMethod>>>;

/** Tables des groupes portés. */
export const METHOD_GROUPS: readonly MethodGroupTable[] = [GROUP_1_METHODS, GROUP_3_METHODS, GROUP_4_METHODS, GROUP_2_METHODS, FIGHT_METHODS, SEQUENCE_METHODS];

export class MethodTable {
  private readonly table = new Map<number, NativeMethod>();
  private readonly stubbed = new Set<number>();

  constructor(
    private readonly ctx: LureContext,
    groups: readonly MethodGroupTable[] = METHOD_GROUPS,
  ) {
    for (const group of groups) {
      for (const [key, fn] of Object.entries(group)) {
        const index = Number(key);
        if (!fn) continue;
        if (!methodInfo(index)) throw new Error(`méthode native ${index} hors du catalogue`);
        if (this.table.has(index)) throw new Error(`méthode native ${index} fournie deux fois`);
        this.table.set(index, fn);
      }
    }
    for (const info of METHOD_CATALOG) {
      if (this.table.has(info.index)) continue;
      this.stubbed.add(info.index);
      this.table.set(info.index, (_c, p1, p2, p3) => this.stub(info.index, p1, p2, p3));
    }
  }

  /** Méthodes encore en souche. */
  get stubs(): number[] {
    return [...this.stubbed].sort((a, b) => a - b);
  }

  isStub(index: number): boolean {
    return this.stubbed.has(index);
  }

  /** `executeMethod(index, v1, v2, v3)`. */
  call(index: number, p1: number, p2: number, p3: number): void {
    const fn = this.table.get(index);
    if (!fn) {
      this.ctx.journal.log(`méthode de script ${index} non définie`);
      return;
    }
    fn(this.ctx, p1, p2, p3);
  }

  private stub(index: number, p1: number, p2: number, p3: number): void {
    const info = methodInfo(index)!;
    this.ctx.journal.log(`méthode ${index} ${info.name} (${info.group}) non portée : (${p1}, ${p2}, ${p3})`);
  }
}
