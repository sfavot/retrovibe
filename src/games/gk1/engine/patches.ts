/**
 * Correctifs appliqués aux scripts d'origine et contournements de leurs maladresses (`docs/gk1/plan.md`, D12 ;
 * `docs/gk1/engine.md` § 8). Ce module ne porte que le mécanisme ; la liste propre au jeu est dans `game/fixes.ts`.
 *
 * Références : `engines/sci/engine/script_patches.cpp` (`ScriptPatcher::findSignature`, `applyPatch`) et `workarounds.cpp`
 * (`trackOriginAndFindWorkaround`, `findMessageWorkaround`, `remapAudio36ResourceId`) de ScummVM, GPL v3 ou ultérieure, lus
 * puis réécrits.
 *
 * - **Correctif de script** : une **signature** (suite d'octets du script d'origine) et un **remplacement** de même
 *   emplacement. La signature est cherchée dans la ressource script suivie de la ressource heap ; le correctif est posé à
 *   chacune des `count` premières occurrences. Une signature absente, ou un sélecteur que le jeu n'a pas, ne pose rien :
 *   le script n'est pas celui attendu (autre version du jeu, script de test), et `ScriptPatcher.applied` ne le compte pas.
 * - **Notation** (signature et remplacement, jetons séparés par des espaces) :
 *   - `3c` : un octet en hexadécimal ; `w:00dc` : un mot de 16 bits (petit-boutiste dans le script) ;
 *   - `s:nom` : numéro du sélecteur `nom` sur 16 bits ; `b:nom` : sur un octet (opérandes courts) ;
 *   - `+12` : douze octets quelconques dans une signature, laissés tels quels dans un remplacement ;
 *   - remplacement seulement, d'après les octets d'origine comptés depuis le début de la signature : `o:5` (l'octet 5),
 *     `o:5+2` ou `o:5-2` (cet octet ajusté), `ow:4-10` (le mot en 4 ajusté), `c:0*7` (les 7 octets à partir de 0).
 * - **Lecture non initialisée** : une variable temporaire ou un paramètre que le script lit sans l'avoir écrit vaut la
 *   valeur donnée, sans avertissement.
 * - **Renvoi de message ou de voix** : une clé demandée est remplacée par une autre avant la recherche.
 *
 * Écarts volontaires : pas de « mot magique » pour accélérer la recherche (213 scripts, cherchés une fois chacun) ; les
 * correctifs ne sont pas activés selon la plate-forme ou la langue au moment de l'exécution : la table ne contient que ceux
 * du CD français pour PC.
 */
import type { MessageTuple } from "../data/message";

export interface ScriptPatch {
  /** Numéro du script. */
  readonly script: number;
  /** Nom court, unique dans le script : ce que le correctif répare. */
  readonly name: string;
  /** Nombre d'occurrences corrigées (les premières dans l'ordre du fichier). */
  readonly count: number;
  readonly signature: string;
  readonly patch: string;
}

export const VariableKind = { Temp: "temp", Param: "param" } as const;
export type VariableKind = (typeof VariableKind)[keyof typeof VariableKind];

/** Variable lue sans avoir été écrite : `value` est ce que la lecture rend. */
export interface UninitializedRead {
  readonly script: number;
  readonly object: string;
  readonly method: string;
  readonly kind: VariableKind;
  readonly index: number;
  readonly value: number;
}

/**
 * Paramètre qu'un appelant ne passe pas. La méthode lirait la case de pile qui suit ses arguments : la première case
 * libre, que ses propres empilements ont déjà recouverte au moment de la lecture. `value` est rendu à la place.
 */
export interface MissingParam {
  readonly script: number;
  readonly object: string;
  readonly method: string;
  readonly index: number;
  readonly value: number;
}

export interface MessageKey {
  readonly module: number;
  readonly tuple: MessageTuple;
}

export interface MessageRemap {
  readonly from: MessageKey;
  readonly to: MessageKey;
}

/** Tout ce qu'un jeu corrige dans ses scripts et ses données. */
export interface GameFixes {
  readonly scriptPatches: readonly ScriptPatch[];
  readonly uninitializedReads: readonly UninitializedRead[];
  /** Paramètres lus au-delà de ceux que l'appelant a passés. */
  readonly missingParams: readonly MissingParam[];
  /** Messages demandés sous une clé et lus sous une autre (`Message`). */
  readonly messageRemaps: readonly MessageRemap[];
  /** Voix demandées sous une clé et jouées depuis une autre (`DoAudio`). */
  readonly voiceRemaps: readonly MessageRemap[];
}

export const NO_FIXES: GameFixes = { scriptPatches: [], uninitializedReads: [], missingParams: [], messageRemaps: [], voiceRemaps: [] };

const WORD_MASK = 0xffff;
const BYTE_MASK = 0xff;
/** Dans une signature compilée : octet quelconque. */
const ANY = -1;

type SelectorId = (name: string) => number;

/** Un correctif nomme un sélecteur que le jeu n'a pas : il n'est pas fait pour ces scripts. */
export class UnknownSelectorError extends Error {}

function selector(resolve: SelectorId, name: string, max: number): number {
  const id = resolve(name);
  if (id < 0) throw new UnknownSelectorError(`GK1 : correctif : sélecteur « ${name} » inconnu`);
  if (id > max) throw new Error(`GK1 : correctif : sélecteur « ${name} » trop grand pour un octet`);
  return id;
}

/** Octets d'un jeton commun aux signatures et aux remplacements, ou `undefined` si ce n'en est pas un. */
function literalBytes(token: string, resolve: SelectorId): number[] | undefined {
  if (/^[0-9a-f]{2}$/.test(token)) return [Number.parseInt(token, 16)];
  const [kind, value] = token.split(":");
  if (kind === "w" && /^[0-9a-f]{4}$/.test(value ?? "")) {
    const word = Number.parseInt(value, 16);
    return [word & BYTE_MASK, word >> 8];
  }
  if (kind === "s" && value) {
    const id = selector(resolve, value, WORD_MASK);
    return [id & BYTE_MASK, id >> 8];
  }
  if (kind === "b" && value) return [selector(resolve, value, BYTE_MASK)];
  return undefined;
}

/** Signature compilée : un octet attendu par position, ou `ANY`. */
export function compileSignature(signature: string, resolve: SelectorId): number[] {
  const out: number[] = [];
  for (const token of signature.split(/\s+/).filter(Boolean)) {
    const skip = /^\+(\d+)$/.exec(token);
    if (skip) {
      for (let i = 0; i < Number(skip[1]); i++) out.push(ANY);
      continue;
    }
    const bytes = literalBytes(token, resolve);
    if (!bytes) throw new Error(`GK1 : correctif : jeton de signature « ${token} » illisible`);
    out.push(...bytes);
  }
  return out;
}

/** Positions de toutes les occurrences de la signature. */
export function findSignature(data: Uint8Array, signature: readonly number[]): number[] {
  const found: number[] = [];
  const first = signature[0];
  for (let at = 0; at + signature.length <= data.length; at++) {
    if (first !== ANY && data[at] !== first) continue;
    let matches = true;
    for (let i = 1; i < signature.length; i++) {
      if (signature[i] !== ANY && signature[i] !== data[at + i]) {
        matches = false;
        break;
      }
    }
    if (matches) found.push(at);
  }
  return found;
}

/** Pose le remplacement dans `data` à partir de `at` ; les jetons `o:`, `ow:` et `c:` lisent `original`. */
export function applyPatch(data: Uint8Array, original: Uint8Array, at: number, patch: string, resolve: SelectorId): void {
  let to = at;
  const put = (byte: number): void => {
    if (to >= data.length) throw new Error("GK1 : correctif : remplacement plus long que le script");
    data[to++] = byte & BYTE_MASK;
  };
  for (const token of patch.split(/\s+/).filter(Boolean)) {
    const skip = /^\+(\d+)$/.exec(token);
    if (skip) {
      to += Number(skip[1]);
      continue;
    }
    const copied = /^c:(\d+)\*(\d+)$/.exec(token);
    if (copied) {
      for (let i = 0; i < Number(copied[2]); i++) put(original[at + Number(copied[1]) + i]);
      continue;
    }
    const adjusted = /^(o|ow):(\d+)(?:([+-])(\d+))?$/.exec(token);
    if (adjusted) {
      const from = at + Number(adjusted[2]);
      const delta = adjusted[3] ? (adjusted[3] === "-" ? -1 : 1) * Number(adjusted[4]) : 0;
      if (adjusted[1] === "o") put(original[from] + delta);
      else {
        const word = ((original[from] | (original[from + 1] << 8)) + delta) & WORD_MASK;
        put(word);
        put(word >> 8);
      }
      continue;
    }
    const bytes = literalBytes(token, resolve);
    if (!bytes) throw new Error(`GK1 : correctif : jeton de remplacement « ${token} » illisible`);
    for (const byte of bytes) put(byte);
  }
}

export interface PatchedScript {
  readonly code: Uint8Array;
  readonly heap: Uint8Array;
}

/** Applique les correctifs d'un jeu aux scripts, à leur chargement (`ScriptManager`). */
export class ScriptPatcher {
  /** Correctifs posés, « script:nom », dans l'ordre de leur première application. */
  readonly applied: string[] = [];
  private readonly byScript = new Map<number, ScriptPatch[]>();
  private readonly done = new Map<number, PatchedScript>();

  constructor(
    patches: readonly ScriptPatch[],
    private readonly resolve: SelectorId,
  ) {
    for (const patch of patches) {
      const list = this.byScript.get(patch.script);
      if (list) list.push(patch);
      else this.byScript.set(patch.script, [patch]);
    }
  }

  /**
   * Script et heap corrigés du script `number`. Les ressources ne sont jamais modifiées : un script corrigé est une copie,
   * gardée pour les chargements suivants ; un script sans correctif est rendu tel quel.
   */
  patch(number: number, code: Uint8Array, heap: Uint8Array): PatchedScript {
    const patches = this.byScript.get(number);
    if (!patches) return { code, heap };
    const cached = this.done.get(number);
    if (cached) return cached;
    const original = new Uint8Array(code.length + heap.length);
    original.set(code);
    original.set(heap, code.length);
    const data = original.slice();
    for (const patch of patches) {
      try {
        const found = findSignature(original, compileSignature(patch.signature, this.resolve));
        if (found.length < patch.count) continue;
        const patched = data.slice();
        for (const at of found.slice(0, patch.count)) applyPatch(patched, original, at, patch.patch, this.resolve);
        data.set(patched);
        this.applied.push(`${number}:${patch.name}`);
      } catch (error) {
        // Scripts d'un autre jeu (tests sur des scripts inventés) : le correctif ne se pose pas.
        if (!(error instanceof UnknownSelectorError)) throw error;
      }
    }
    const result = { code: data.slice(0, code.length), heap: data.slice(code.length) };
    this.done.set(number, result);
    return result;
  }
}

/** Valeur d'une lecture non initialisée que le jeu sait corriger, ou `undefined`. */
export function uninitializedValue(fixes: GameFixes, script: number, object: string, method: string, kind: VariableKind, index: number): number | undefined {
  return fixes.uninitializedReads.find((read) => read.script === script && read.kind === kind && read.index === index && read.object === object && read.method === method)?.value;
}

/** Valeur d'un paramètre non passé que le jeu sait corriger, ou `undefined`. */
export function missingParamValue(fixes: GameFixes, script: number, object: string, method: string, index: number): number | undefined {
  return fixes.missingParams.find((param) => param.script === script && param.index === index && param.object === object && param.method === method)?.value;
}

/** Clé à lire à la place de celle demandée, ou la même. */
export function remapKey(remaps: readonly MessageRemap[], module: number, tuple: MessageTuple): MessageKey {
  for (const { from, to } of remaps) {
    if (from.module === module && from.tuple.noun === tuple.noun && from.tuple.verb === tuple.verb && from.tuple.cond === tuple.cond && from.tuple.seq === tuple.seq) return to;
  }
  return { module, tuple };
}
