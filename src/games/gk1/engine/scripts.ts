/**
 * Chargement des scripts dans la mémoire de la machine virtuelle : segments, variables locales, objets, relocation, table des
 * classes, déchargement (`docs/gk1/formats.md` § 8).
 *
 * Références : `engines/sci/engine/script.cpp` (`Script::load`, `initializeClasses`, `initializeObjectsSci11`,
 * `initializeLocals`, `validateExportFunc`), `seg_manager.cpp` (`instantiateScript`, `uninstantiateScript`,
 * `getClassAddress`, `createClassTable`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Au chargement d'un script `n` :
 * 1. ses variables locales sont créées, les offsets de heap relocalisés en références vers le segment du script ;
 * 2. chaque objet du heap devient un `SciObject` ; une classe est inscrite dans la table des classes ;
 * 3. `-super-` reçoit l'adresse de la classe mère (ce qui peut charger son script), `-propDict-` l'identité de la classe
 *    (recopiée dans les instances) et `-classScript-` le numéro du script. `-script-` garde le numéro d'espèce du fichier.
 *
 * **Correctifs** : le code et le heap passent par `ScriptPatcher` (`patches.ts`, `docs/gk1/plan.md` D12) à chaque lecture,
 * comme `Script::load` de ScummVM appelle `ScriptPatcher::processScript`. Les ressources ne sont pas modifiées.
 *
 * Écarts volontaires :
 * - **une classe n'est inscrite que si le vocabulaire 996 l'attribue à ce script** : la classe 133 (`ForRepeat`), définie dans
 *   les scripts 22 et 808, est toujours celle du 808, quel que soit l'ordre de chargement (ScummVM inscrit la dernière chargée) ;
 * - la relocation se fait valeur par valeur, grâce aux indicateurs de `data/script.ts`, pas en repassant sur un tampon ;
 * - un script rechargé après `DisposeScript` garde son segment **et** celui de ses variables locales ;
 * - les exports d'objets et de procédures sont distingués par la table de relocation du script, pas par l'usage.
 */
import { NO_SUPERCLASS, ResourceType, VOCAB_CLASS_TABLE } from "../data/ids";
import { OBJECT_PROPERTY, readScript, type Script } from "../data/script";
import { readClassTable } from "../data/vocab";
import { makeReg, NULL_REG, type Reg, regSegment, SciError, type ScriptSegment, SegmentKind, type SegManager } from "./memory";
import { makeShape, SciObject } from "./object";
import type { ScriptPatcher } from "./patches";
import type { ResourceManager } from "./resources";

interface ClassEntry {
  /** Script qui définit la classe (vocabulaire 996). */
  readonly script: number;
  /** Adresse de la classe, nulle tant que son script n'est pas chargé. */
  reg: Reg;
}

/** Segment de script tel qu'une sauvegarde le garde (`save.ts`) : ce que les ressources ne redonnent pas. */
export interface SavedScriptSegment {
  readonly kind: typeof SegmentKind.Script;
  readonly number: number;
  /** Faux pour un segment créé mais jamais chargé. */
  readonly loaded: boolean;
  readonly lockers: number;
  readonly deleted: boolean;
  readonly localsSegment: number;
  /** Heap modifié par les scripts (chaînes), en OU exclusif avec celui de la ressource ; `undefined` s'il est intact. */
  readonly heapDelta: Uint8Array | undefined;
  /**
   * Propriétés de tous les objets, bout à bout, dans l'ordre des objets de la ressource, **en OU exclusif avec les valeurs de
   * la ressource** (`ScriptObject.values`, avant relocation) : un objet resté tel qu'au chargement ne coûte presque rien.
   */
  readonly vars: Uint32Array;
}

export interface SavedLocalsSegment {
  readonly kind: typeof SegmentKind.Locals;
  readonly scriptNumber: number;
  readonly values: Uint32Array;
}

export type SavedSegment = SavedScriptSegment | SavedLocalsSegment;

export class ScriptManager {
  private readonly classTable: ClassEntry[];
  private readonly byNumber = new Map<number, ScriptSegment>();

  constructor(
    private readonly memory: SegManager,
    private readonly resources: ResourceManager,
    /** Correctifs du jeu, posés sur chaque script à sa lecture (`patches.ts`). */
    private readonly patcher?: ScriptPatcher,
  ) {
    this.classTable = readClassTable(resources.get(ResourceType.Vocab, VOCAB_CLASS_TABLE)).map((script) => ({ script, reg: NULL_REG }));
  }

  get classCount(): number {
    return this.classTable.length;
  }

  /** Segment du script s'il est chargé (et pas déchargé depuis), sinon `undefined`. */
  loaded(number: number): ScriptSegment | undefined {
    const segment = this.byNumber.get(number);
    return segment && !segment.deleted ? segment : undefined;
  }

  /**
   * Lit le script `number` dans les ressources, correctifs du jeu posés : c'est le seul endroit où le code et le heap d'un
   * script entrent dans la machine virtuelle (chargement, rechargement, reprise d'une sauvegarde).
   */
  private read(number: number): { code: Uint8Array; source: Script } {
    const raw = this.resources.get(ResourceType.Script, number);
    const rawHeap = this.resources.get(ResourceType.Heap, number);
    const { code, heap } = this.patcher ? this.patcher.patch(number, raw, rawHeap) : { code: raw, heap: rawHeap };
    return { code, source: readScript(code, heap) };
  }

  /** Charge le script s'il ne l'est pas ; sinon compte une demande de plus. */
  instantiate(number: number): ScriptSegment {
    let segment = this.byNumber.get(number);
    if (segment && !segment.deleted) {
      segment.lockers++;
      return segment;
    }
    if (!this.resources.has(ResourceType.Script, number) || !this.resources.has(ResourceType.Heap, number)) {
      throw new SciError(`script ${number} introuvable`);
    }
    const { code, source } = this.read(number);
    if (!segment) {
      segment = this.memory.addScriptSegment(number);
      this.byNumber.set(number, segment);
    }
    segment.source = source;
    segment.code = code;
    segment.heap = source.heap.slice();
    segment.objects = new Map();
    segment.deleted = false;
    segment.lockers = 1;
    const id = segment.id;
    const relocate = (value: number, isPointer: boolean): Reg => (isPointer ? makeReg(id, value) : value);

    if (source.locals.length > 0) {
      const locals = this.memory.localsSegment(segment.localsSegment) ?? this.memory.addLocalsSegment(number);
      segment.localsSegment = locals.id;
      // Rechargement : le même tableau est réinitialisé, les trames d'exécution en cours le voient toujours.
      if (locals.values.length !== source.locals.length) locals.values = new Uint32Array(source.locals.length);
      for (let i = 0; i < source.locals.length; i++) locals.values[i] = relocate(source.locals[i], source.localIsPointer[i]);
    }

    // Première passe : tous les objets existent et les classes sont inscrites avant de résoudre les classes mères.
    for (const data of source.objects) {
      const reg = makeReg(id, data.offset);
      const vars = Uint32Array.from(data.values, (value, i) => relocate(value, data.isPointer[i]));
      const object = new SciObject(reg, vars, new Map(data.methods.map((m) => [m.selector, m.codeOffset])), id);
      vars[OBJECT_PROPERTY.ClassScript] = number;
      if (data.isClass) {
        object.shape = makeShape(data.propertySelectors!);
        vars[OBJECT_PROPERTY.PropertyDict] = makeReg(id, data.propertyDictOffset);
        const entry = this.classTable[data.species];
        if (!entry) throw new SciError(`script ${number} : classe ${data.species} hors de la table des classes`);
        if (entry.script === number) entry.reg = reg;
      }
      segment.objects.set(data.offset, object);
    }

    // Seconde passe : classe mère, puis forme et `-propDict-` des instances.
    for (const data of source.objects) {
      const object = segment.objects.get(data.offset)!;
      const superClass = this.classAddress(data.superClass, 0);
      object.vars[OBJECT_PROPERTY.SuperClass] = superClass;
      if (data.isClass) continue;
      const classObject = this.memory.getObject(superClass);
      if (!classObject) throw new SciError(`script ${number} : l'instance « ${data.name} » n'a pas de classe`);
      object.shape = classObject.shape;
      object.vars[OBJECT_PROPERTY.PropertyDict] = classObject.vars[OBJECT_PROPERTY.PropertyDict];
    }
    return segment;
  }

  /**
   * Rend une demande de chargement ; à zéro, le script est déchargé : ses classes quittent la table, ses objets restent
   * lisibles jusqu'à ce qu'il soit rechargé (au même segment).
   */
  uninstantiate(number: number): void {
    const segment = this.loaded(number);
    if (!segment) return;
    segment.lockers--;
    if (segment.lockers > 0) return;
    for (const entry of this.classTable) if (regSegment(entry.reg) === segment.id) entry.reg = NULL_REG;
    segment.lockers = 0;
    segment.deleted = true;
  }

  /**
   * Adresse de la classe `species` ; charge son script au besoin. `callerSegment` : segment du code demandeur (0 pour le
   * chargeur), qui compte une demande de plus sur le script de la classe s'il est différent.
   */
  classAddress(species: number, callerSegment: number): Reg {
    if (species === NO_SUPERCLASS) return NULL_REG;
    const entry = this.classTable[species];
    if (!entry) throw new SciError(`classe ${species} inconnue (${this.classTable.length} classes)`);
    if (entry.reg === NULL_REG) {
      this.instantiate(entry.script);
      if (entry.reg === NULL_REG) throw new SciError(`le script ${entry.script} ne définit pas la classe ${species}`);
    } else if (callerSegment !== regSegment(entry.reg)) {
      this.memory.scriptSegment(regSegment(entry.reg))!.lockers++;
    }
    return entry.reg;
  }

  /** Adresse de chaque classe (nulle si son script n'est pas chargé), pour la sauvegarde. */
  classAddresses(): Reg[] {
    return this.classTable.map((entry) => entry.reg);
  }

  /**
   * Reprise d'une sauvegarde, dans une mémoire vidée (`SegManager.reset`) : recrée les segments **dans l'ordre**, donc sous les
   * mêmes numéros, relit le code, les méthodes et les formes dans les ressources, et reprend les propriétés, les variables
   * locales, les heaps modifiés et la table des classes de la sauvegarde. Aucun script n'est « chargé » au sens de
   * `instantiate` : les compteurs de demandes sont ceux de la sauvegarde.
   */
  restore(segments: readonly SavedSegment[], classes: readonly Reg[]): void {
    if (classes.length !== this.classTable.length) throw new SciError("sauvegarde : table des classes d'une autre version du jeu");
    this.byNumber.clear();
    const scripts: [ScriptSegment, SavedScriptSegment][] = [];
    for (const saved of segments) {
      if (saved.kind === SegmentKind.Locals) {
        this.memory.addLocalsSegment(saved.scriptNumber).values = saved.values;
        continue;
      }
      const segment = this.memory.addScriptSegment(saved.number);
      this.byNumber.set(saved.number, segment);
      segment.lockers = saved.lockers;
      segment.deleted = saved.deleted;
      segment.localsSegment = saved.localsSegment;
      if (!saved.loaded) continue;
      const { code, source } = this.read(saved.number);
      const delta = saved.heapDelta;
      if (delta && delta.length !== source.heap.length) throw new SciError(`sauvegarde : heap du script ${saved.number} d'une autre taille`);
      segment.source = source;
      segment.code = code;
      segment.heap = delta ? source.heap.map((byte, at) => byte ^ delta[at]) : source.heap.slice();
      let at = 0;
      for (const data of source.objects) {
        const vars = saved.vars.slice(at, at + data.values.length);
        at += data.values.length;
        if (vars.length !== data.values.length) throw new SciError(`sauvegarde : objet « ${data.name} » du script ${saved.number} tronqué`);
        for (let i = 0; i < vars.length; i++) vars[i] ^= data.values[i];
        const object = new SciObject(makeReg(segment.id, data.offset), vars, new Map(data.methods.map((m) => [m.selector, m.codeOffset])), segment.id);
        if (data.isClass) object.shape = makeShape(data.propertySelectors!);
        segment.objects.set(data.offset, object);
      }
      if (at !== saved.vars.length) throw new SciError(`sauvegarde : objets du script ${saved.number} d'une autre taille`);
      scripts.push([segment, saved]);
    }
    // Les instances prennent la forme de leur classe, une fois toutes les classes recréées.
    for (const [segment] of scripts) {
      for (const data of segment.source!.objects) {
        if (data.isClass) continue;
        const object = segment.objects.get(data.offset)!;
        const classObject = this.memory.getObject(object.superClass);
        if (!classObject) throw new SciError(`sauvegarde : l'instance « ${data.name} » du script ${segment.number} n'a pas de classe`);
        object.shape = classObject.shape;
      }
    }
    this.classTable.forEach((entry, species) => (entry.reg = classes[species]));
  }

  /** Script qui définit la classe `species` selon le vocabulaire 996. */
  classScript(species: number): number | undefined {
    return this.classTable[species]?.script;
  }

  /** Objet exporté par un script chargé ; nul si l'export est une procédure, vide ou absent. */
  exportedObject(segment: ScriptSegment, index: number): Reg {
    const entry = segment.source!.exports[index];
    return entry?.isObject ? makeReg(segment.id, entry.offset) : NULL_REG;
  }

  /** Offset du code de la procédure exportée `index`. */
  exportedProcedure(segment: ScriptSegment, index: number): number {
    const entry = segment.source!.exports[index];
    if (!entry || entry.isObject || entry.offset === 0) throw new SciError(`script ${segment.number} : l'export ${index} n'est pas une procédure`);
    return entry.offset;
  }
}
