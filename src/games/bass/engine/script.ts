/**
 * Interpréteur des scripts de *Beneath a Steel Sky* : machine à pile de `u32`, 21 codes.
 *
 * Référence : ScummVM engines/sky/logic.cpp (`Logic::script`, `push`, `pop`, `checkModuleLoaded`) et disk.cpp (`loadScriptFile`)
 * (GPL v3 ou ultérieure).
 *
 * Un script est désigné par `module << 12 | rang` ; un module (`F_MODULE_0 + n`) commence par la table des positions (en mots) de ses
 * scripts. `run` interprète jusqu'à la fin du script (rend 0) ou jusqu'à un mcode qui rend faux : il rend alors la position (en mots, depuis
 * le début du module) de l'instruction suivante, que l'appelant range dans `xxxSub_off` pour reprendre au tour suivant. Les scripts sont
 * ainsi des coroutines par compact, sans générateur.
 *
 * Fidélité :
 * - `less_than` empile `a > b` et `more_than` `a < b`, `a` étant le sommet de la pile : pour `push x, push y`, `less_than` vaut `x < y`.
 *   Lus dans l'ordre où ils sont dépilés (`a` puis `b`), les noms sont inversés (le piège d'`engine.md` § 3) : on garde le calcul de
 *   ScummVM tel quel ;
 * - `a`, `b`, `c` sont des variables locales de l'appel, remises à 0 au début du script et à chaque `restart_script` : un mcode à moins de
 *   trois arguments reçoit les valeurs laissées par les instructions précédentes (`a` vaut alors le nombre d'arguments, 0) ;
 * - la pile (20 mots) est **partagée** par les appels imbriqués (un mcode qui lance un script : `fnAddHuman`, `runGetOff`…) ;
 * - `skip_zero` et `skip_always` avancent d'un décalage non signé, `skip_nz` d'un décalage signé ; `switch` compte ses cas sur 16 bits ;
 * - rustine 5567 de ScummVM (lunettes noires données à Trevor) reprise.
 *
 * Écart volontaire : un opcode inconnu, un débordement ou un manque de pile lèvent une erreur (`error()` de ScummVM).
 */

import type { Compacts, CompactView } from "./compacts";
import { IDO_GLASS, IDO_SHADES, MODULE_COUNT, Script, Var } from "./ids";
import type { ScriptVars } from "./vars";

/** Taille de la pile (`_stack[20]`). */
export const STACK_SIZE = 20;

/** Codes (`Logic::script`). */
export const Op = {
  PUSH_VARIABLE: 0,
  LESS_THAN: 1,
  PUSH_NUMBER: 2,
  NOT_EQUAL: 3,
  IF_AND: 4,
  SKIP_ZERO: 5,
  POP_VAR: 6,
  MINUS: 7,
  PLUS: 8,
  SKIP_ALWAYS: 9,
  IF_OR: 10,
  CALL_MCODE: 11,
  MORE_THAN: 12,
  SCRIPT_EXIT_13: 13,
  SWITCH: 14,
  PUSH_OFFSET: 15,
  POP_OFFSET: 16,
  IS_EQUAL: 17,
  SKIP_NZ: 18,
  SCRIPT_EXIT: 19,
  RESTART_SCRIPT: 20,
} as const;

/** Ce que l'interpréteur lit et appelle dans le moteur. */
export interface ScriptHost {
  readonly vars: ScriptVars;
  /** Accès aux champs par décalage DOS (`push_offset`, `pop_offset`). */
  readonly compacts: Pick<Compacts, "getElem" | "setElem">;
  /** Compact courant (`Logic::_compact`) : `push_offset` / `pop_offset` l'adressent ; un mcode peut le changer, il est rétabli après. */
  compact: CompactView;
  /** Module de scripts `n` (0 à 15), chargé à la demande. */
  module(n: number): Uint16Array;
  /** Appelle le mcode `num` ; faux = suspendre le script. */
  mcode(num: number, a: number, b: number, c: number): boolean;
  /** Trace des opcodes (niveau 2 du banc) : code, module, position des opérandes. */
  traceOpcode?(command: number, module: Uint16Array, pos: number): void;
}

export class ScriptError extends Error {}

/** Interpréteur : pile partagée par les appels imbriqués. */
export class Interpreter {
  readonly stack = new Uint32Array(STACK_SIZE);
  sp = 0;

  constructor(private readonly host: ScriptHost) {}

  push(value: number): void {
    if (this.sp > STACK_SIZE - 2) throw new ScriptError("Stack overflow");
    this.stack[this.sp++] = value;
  }

  pop(): number {
    if (this.sp < 1 || this.sp > STACK_SIZE - 1) throw new ScriptError("No items on Stack to pop");
    return this.stack[--this.sp]!;
  }

  /**
   * `Logic::script` : interprète le script `scriptNo` à partir de `offset` (0 : début). Rend 0 si le script est fini, sinon la position de
   * reprise (mots depuis le début du module, sur 16 bits).
   */
  run(scriptNo: number, offset: number): number {
    const host = this.host;
    const vars = host.vars;
    for (;;) {
      const moduleNo = (scriptNo >> 12) & 0xf;
      if (moduleNo >= MODULE_COUNT) throw new ScriptError(`module ${moduleNo} invalide`);
      const code = host.module(moduleNo);

      // WORKAROUND du bogue 5567 (ScummVM) : lunettes noires données plusieurs fois à Trevor, réponse générique.
      if (scriptNo === Script.TREVOR_SPEECH && vars[Var.OBJECT_HELD] === IDO_SHADES) vars[Var.OBJECT_HELD] = IDO_GLASS;

      let pc = offset ? offset : code[scriptNo & 0x0fff]!;
      let a = 0;
      let b = 0;
      let c = 0;
      let restart = false;

      while (!restart) {
        if (pc >= code.length) throw new ScriptError(`script ${scriptNo} : sortie du module ${moduleNo} (${pc})`);
        const command = code[pc++]!;
        host.traceOpcode?.(command, code, pc);
        switch (command) {
          case Op.PUSH_VARIABLE:
            this.push(vars[code[pc++]! >> 2]!);
            break;
          case Op.LESS_THAN:
            a = this.pop();
            b = this.pop();
            this.push(a > b ? 1 : 0);
            break;
          case Op.PUSH_NUMBER:
            this.push(code[pc++]!);
            break;
          case Op.NOT_EQUAL:
            a = this.pop();
            b = this.pop();
            this.push(a !== b ? 1 : 0);
            break;
          case Op.IF_AND:
            a = this.pop();
            b = this.pop();
            this.push(a && b ? 1 : 0);
            break;
          case Op.SKIP_ZERO: {
            const s = code[pc++]!;
            a = this.pop();
            if (!a) pc += s >> 1;
            break;
          }
          case Op.POP_VAR:
            b = this.pop();
            vars[code[pc++]! >> 2] = b;
            break;
          case Op.MINUS:
            a = this.pop();
            b = this.pop();
            this.push((b - a) >>> 0);
            break;
          case Op.PLUS:
            a = this.pop();
            b = this.pop();
            this.push((b + a) >>> 0);
            break;
          case Op.SKIP_ALWAYS: {
            const s = code[pc++]!;
            pc += s >> 1;
            break;
          }
          case Op.IF_OR:
            a = this.pop();
            b = this.pop();
            this.push(a || b ? 1 : 0);
            break;
          case Op.CALL_MCODE: {
            a = code[pc++]!;
            if (a > 3) throw new ScriptError(`call_mcode : ${a} arguments`);
            // Pas de `break` dans l'original : 3 dépile c, b, a ; 2 dépile b, a ; 1 dépile a ; 0 garde a = 0.
            if (a === 3) c = this.pop();
            if (a >= 2) b = this.pop();
            if (a >= 1) a = this.pop();
            const mcode = code[pc++]! >> 2;
            const saved = host.compact;
            const ok = host.mcode(mcode, a, b, c);
            host.compact = saved;
            if (!ok) return pc & 0xffff;
            break;
          }
          case Op.MORE_THAN:
            a = this.pop();
            b = this.pop();
            this.push(a < b ? 1 : 0);
            break;
          case Op.SWITCH: {
            let s = code[pc++]!;
            c = s;
            a = this.pop();
            do {
              if (a === code[pc]) {
                pc += code[pc + 1]! >> 1;
                pc++;
                break;
              }
              pc += 2;
              s = (s - 1) & 0xffff;
            } while (s);
            if (s === 0) pc += code[pc]! >> 1;
            break;
          }
          case Op.PUSH_OFFSET:
            this.push(host.compacts.getElem(host.compact, code[pc++]!));
            break;
          case Op.POP_OFFSET:
            host.compacts.setElem(host.compact, code[pc++]!, this.pop() & 0xffff);
            break;
          case Op.IS_EQUAL:
            a = this.pop();
            b = this.pop();
            this.push(a === b ? 1 : 0);
            break;
          case Op.SKIP_NZ: {
            const t = (code[pc++]! << 16) >> 16;
            a = this.pop();
            if (a) pc += Math.trunc(t / 2);
            break;
          }
          case Op.SCRIPT_EXIT_13:
          case Op.SCRIPT_EXIT:
            return 0;
          case Op.RESTART_SCRIPT:
            offset = 0;
            restart = true;
            break;
          default:
            throw new ScriptError(`Unknown script command: ${command}`);
        }
      }
    }
  }
}
