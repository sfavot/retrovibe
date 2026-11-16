/**
 * Table des fonctions du noyau SCI2 : enregistrement par nom, appel par indice (`callk`), journal des appels.
 *
 * Référence : `engines/sci/engine/kernel.cpp` (`Kernel::mapFunctions`, `kStub`, `kEmpty`) et `vm.cpp` (`callKernelFunc`) de
 * ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Un groupe de fonctions vit dans un fichier de ce dossier, qui exporte `register…(kernel)` ; `index.ts` l'appelle par une
 * ligne. **Toute fonction sans implémentation est une souche** : elle rend une valeur par défaut (0, ou celle donnée par
 * `stub`) et son appel est journalisé avec ses arguments, jamais muet.
 *
 * Écarts volontaires : pas de signatures d'arguments (ScummVM vérifie le type de chaque argument et s'en sert pour ses
 * « workarounds ») ; une souche rend 0 là où `kStub` de ScummVM laisse l'accumulateur inchangé, pour que le résultat ne
 * dépende pas de ce qui précède ; les sous-fonctions sont aiguillées par chaque fonction, pas par une table commune.
 */
import { formatReg, NULL_REG, type Reg } from "../memory";
import type { Continuation, Vm } from "../vm";
import { KERNEL_DUMMY, KERNEL_NAMES } from "./names";

/** Fonction du noyau : `argv` est une vue sur la pile (ne pas la garder après le retour). Renvoie le nouvel accumulateur. */
export type KernelFunction = (vm: Vm, argv: Uint32Array) => Reg;

/** Exemples d'arguments gardés par souche dans le journal. */
const STUB_SAMPLES = 4;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export interface StubRecord {
  count: number;
  /** Premiers appels distincts, tels que journalisés. */
  samples: string[];
}

/** Journal des appels du noyau : compte par fonction, souches rencontrées, et trace complète si `capture`. */
export class KernelJournal {
  /** Nombre d'appels par indice de fonction. */
  readonly counts = new Uint32Array(KERNEL_NAMES.length);
  /** Souches appelées, par nom (indice entre crochets pour les « Dummy »). */
  readonly stubs = new Map<string, StubRecord>();
  /** Garde chaque appel (`entries`) et sa somme de contrôle : pour les tests et la comparaison de deux exécutions. */
  capture = false;
  readonly entries: string[] = [];
  private checksum = FNV_OFFSET;

  /** Somme de contrôle FNV-1a de la trace capturée. */
  get hash(): number {
    return this.checksum;
  }

  /** Nombre d'appels par nom, fonctions jamais appelées exclues. */
  countsByName(): Map<string, number> {
    const out = new Map<string, number>();
    this.counts.forEach((count, index) => {
      if (count > 0) out.set(kernelLabel(index), (out.get(kernelLabel(index)) ?? 0) + count);
    });
    return out;
  }

  /** @internal */
  record(index: number, argv: Uint32Array, result: Reg, isStub: boolean): void {
    this.counts[index]++;
    if (!isStub && !this.capture) return;
    const entry = `${kernelLabel(index)}(${Array.from(argv, formatReg).join(", ")}) = ${formatReg(result)}`;
    if (isStub) {
      let stub = this.stubs.get(kernelLabel(index));
      if (!stub) this.stubs.set(kernelLabel(index), (stub = { count: 0, samples: [] }));
      stub.count++;
      if (stub.samples.length < STUB_SAMPLES && !stub.samples.includes(entry)) stub.samples.push(entry);
    }
    if (this.capture) {
      this.entries.push(entry);
      for (let i = 0; i < entry.length; i++) this.checksum = Math.imul(this.checksum ^ entry.charCodeAt(i), FNV_PRIME) >>> 0;
      this.checksum = Math.imul(this.checksum ^ 0x0a, FNV_PRIME) >>> 0;
    }
  }
}

/** Nom d'une fonction du noyau ; les « Dummy » sont distingués par leur indice. */
export function kernelLabel(index: number): string {
  const name = KERNEL_NAMES[index];
  if (name === undefined) return `kernel_${index}`;
  return name === KERNEL_DUMMY ? `${KERNEL_DUMMY}[${index}]` : name;
}

export class Kernel {
  readonly journal = new KernelJournal();
  private readonly functions: (KernelFunction | undefined)[] = new Array(KERNEL_NAMES.length).fill(undefined);
  private readonly stubValues = new Map<number, Reg | KernelFunction>();
  private readonly indices = new Map<string, number>();
  /** Continuations des fonctions qui rappellent des scripts (`Vm.beginNative`), par nom. */
  readonly continuations = new Map<string, Continuation>();

  constructor() {
    KERNEL_NAMES.forEach((name, index) => {
      if (name !== KERNEL_DUMMY) this.indices.set(name, index);
    });
  }

  /** Indice de la fonction de ce nom ; lève une erreur s'il n'existe pas. */
  indexOf(name: string): number {
    const index = this.indices.get(name);
    if (index === undefined) throw new Error(`GK1 : fonction du noyau inconnue : ${name}`);
    return index;
  }

  /** Enregistre l'implémentation d'une fonction (remplace une souche ou une implémentation précédente). */
  register(name: string, fn: KernelFunction): this {
    const index = this.indexOf(name);
    this.functions[index] = fn;
    this.stubValues.delete(index);
    return this;
  }

  /** Fixe la valeur rendue par une fonction pas encore portée (ou la fonction provisoire qui la calcule) ; ses appels restent journalisés comme souche. */
  stub(name: string, value: Reg | KernelFunction): this {
    const index = this.indexOf(name);
    if (!this.functions[index]) this.stubValues.set(index, value);
    return this;
  }

  /** Déclare la continuation d'une fonction qui appelle des méthodes (voir `Vm.beginNative`). */
  continuation(name: string, continuation: Continuation): this {
    this.continuations.set(name, continuation);
    return this;
  }

  isImplemented(name: string): boolean {
    return this.functions[this.indexOf(name)] !== undefined;
  }

  /** Noms des fonctions sans implémentation (souches), « Dummy » exclus. */
  unimplemented(): string[] {
    return KERNEL_NAMES.filter((name, index) => name !== KERNEL_DUMMY && !this.functions[index]);
  }

  /** Appelle la fonction d'indice `index` et renvoie le nouvel accumulateur. */
  call(vm: Vm, index: number, argv: Uint32Array): Reg {
    if (index >= KERNEL_NAMES.length) throw new Error(`GK1 : fonction du noyau ${index} hors de la table`);
    const fn = this.functions[index];
    let result: Reg;
    if (fn) result = fn(vm, argv);
    else {
      const stub = this.stubValues.get(index) ?? NULL_REG;
      result = typeof stub === "function" ? stub(vm, argv) : stub;
    }
    this.journal.record(index, argv, result, fn === undefined);
    return result;
  }
}
