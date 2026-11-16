/**
 * Noyau, groupe « messages » : `Message` et ses sous-fonctions (`docs/gk1/engine.md` § 5). Le travail est fait par
 * `engine/message.ts`.
 *
 * Référence : `engines/sci/engine/kstring.cpp` (`kMessage`) et `engines/sci/engine/message.cpp` (`MessageState::getMessage`,
 * `nextMessage`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Sous-fonctions de SCI2 (le premier argument ; **SCI2 décale de 1 les sous-fonctions 3 à 8 de SCI1.1**, la 3 n'existe pas) :
 * - 0 `Get(module, noun, verb, cond, seq[, tampon])` : pose le curseur sur ce message. Avec un tampon (la propriété `data`
 *   d'un `Str`), y écrit le texte et avance le curseur ; sans tampon, **ou avec un tampon nul** (`MessageState::nextMessage`
 *   teste `buf.isNull()` : `Interrogation::sayMessage`, script 51, passe 0 pour savoir qui parle), rien ne bouge. Rend le
 *   talker, 0 s'il n'y a pas de message (le tampon reçoit alors « Msg … not found », comme dans l'original) ;
 * - 1 `Next([tampon])` : message suivant de la suite, mêmes règles ;
 * - 2 `Size(module, noun, verb, cond, seq)` : place à prévoir pour le texte, 0 final compris ; 0 s'il n'existe pas ;
 * - 4 `RefNoun`, 5 `RefVerb`, 6 `RefCond(module, noun, verb, cond, seq)` : une partie du renvoi porté par ce message (0 s'il
 *   n'en a pas), −1 si le message n'existe pas ;
 * - 7 `Push`, 8 `Pop` : met le curseur de côté, le reprend (jamais appelées par GK1) ;
 * - 9 `LastMessage(tableau)` : écrit `module, noun, verb, cond, seq` du dernier message lu dans un tableau d'entiers.
 *   C'est la clé du texte rendu, renvois suivis : celle que `Messager::nextMsg` passe au talker pour lancer la voix.
 *
 * Écarts volontaires : un tampon qui n'est ni un tableau ni une adresse de variables lève une erreur (ScummVM avertit).
 */
import type { MessageTuple } from "../../data/message";
import { messagesOf, NO_TALKER, type MessageReply } from "../message";
import { fromInt, formatReg, NULL_REG, type Reg, SciError, SIGNAL_REG } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

export const MessageOp = { Get: 0, Next: 1, Size: 2, RefNoun: 4, RefVerb: 5, RefCond: 6, Push: 7, Pop: 8, LastMessage: 9 } as const;

const BYTE_MASK = 0xff;
const WORD_MASK = 0xffff;
/** Nombre d'arguments d'un `Get` avec tampon, d'un `Next` avec tampon, et d'un appel qui donne une clé. */
const ARGC_GET_WITH_BUFFER = 7;
const ARGC_NEXT_WITH_BUFFER = 2;
const ARGC_WITH_TUPLE = 6;

function tupleOf(argv: Uint32Array): MessageTuple {
  if (argv.length < ARGC_WITH_TUPLE) return { noun: 0, verb: 0, cond: 0, seq: 0 };
  return { noun: argv[2] & BYTE_MASK, verb: argv[3] & BYTE_MASK, cond: argv[4] & BYTE_MASK, seq: argv[5] & BYTE_MASK };
}

/** Écrit le texte lu dans le tampon, ou le message d'erreur de l'original ; rend le talker. */
function deliver(vm: Vm, reply: MessageReply | undefined, buffer: Reg): Reg {
  if (reply) {
    vm.memory.setString(buffer, reply.text);
    return reply.talker;
  }
  const pending = messagesOf(vm).pending();
  const key = pending ? `${pending.module}: ${pending.tuple.noun}, ${pending.tuple.verb}, ${pending.tuple.cond}, ${pending.tuple.seq}` : "?";
  vm.memory.setString(buffer, `Msg ${key} not found`);
  return NO_TALKER;
}

function lastMessage(vm: Vm, target: Reg): Reg {
  const { module, tuple } = messagesOf(vm).lastQuery();
  const values = [module, tuple.noun, tuple.verb, tuple.cond, tuple.seq];
  if (vm.memory.isArray(target)) {
    const array = vm.memory.array(target);
    array.resize(values.length);
    values.forEach((value, index) => array.set(index, fromInt(value)));
  } else values.forEach((value, index) => vm.memory.writeCell(target, index, fromInt(value)));
  return NULL_REG;
}

function message(vm: Vm, argv: Uint32Array): Reg {
  const messages = messagesOf(vm);
  const module = argv.length > 1 ? argv[1] & WORD_MASK : 0;
  switch (argv[0]) {
    case MessageOp.Get: {
      const withBuffer = argv.length === ARGC_GET_WITH_BUFFER && argv[6] !== NULL_REG;
      const reply = messages.get(module, tupleOf(argv), withBuffer);
      return withBuffer ? deliver(vm, reply, argv[6]) : (reply?.talker ?? NO_TALKER);
    }
    case MessageOp.Next: {
      const withBuffer = argv.length === ARGC_NEXT_WITH_BUFFER && argv[1] !== NULL_REG;
      const reply = messages.next(withBuffer);
      return withBuffer ? deliver(vm, reply, argv[1]) : (reply?.talker ?? NO_TALKER);
    }
    case MessageOp.Size:
      return messages.size(module, tupleOf(argv));
    case MessageOp.RefNoun:
    case MessageOp.RefVerb:
    case MessageOp.RefCond: {
      const ref = messages.ref(module, tupleOf(argv));
      if (!ref) return SIGNAL_REG;
      return argv[0] === MessageOp.RefNoun ? ref.noun : argv[0] === MessageOp.RefVerb ? ref.verb : ref.cond;
    }
    case MessageOp.Push:
      messages.push();
      return NULL_REG;
    case MessageOp.Pop:
      messages.pop();
      return NULL_REG;
    case MessageOp.LastMessage:
      return lastMessage(vm, argv[1]);
    default:
      throw new SciError(`Message : sous-fonction ${formatReg(argv[0])} inconnue`);
  }
}

export function registerMessageKernel(kernel: Kernel): void {
  kernel.register("Message", message);
}
