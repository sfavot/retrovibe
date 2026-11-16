/**
 * Messages du jeu vus par le noyau : lecture d'un message, suite, renvois, pile de curseurs, mise en forme du texte, et mode
 * « texte / voix » tenu par les scripts (`docs/gk1/formats.md` § 9, `docs/gk1/plan.md` D2).
 *
 * Référence : `engines/sci/engine/message.cpp` de ScummVM (`MessageState::getMessage`, `nextMessage`, `messageSize`,
 * `messageRef`, `lastQuery`, `pushCursorStack`, `popCursorStack`, `getRecord`, `processString`, `stringHex`, `stringLit`,
 * `stringStage`), GPL v3 ou ultérieure, lu puis réécrit. Les ressources sont décodées par `data/message.ts`.
 *
 * **Curseur.** `get` pose le curseur sur un message `(module, noun, verb, cond, seq)` et le lit ; `next` lit le suivant. Le
 * curseur est une pile de clés du même module :
 * - le message trouvé a un **renvoi** : la séquence de la clé courante avance, la clé visée (séquence 1) est empilée, et la
 *   recherche reprend. Le texte de l'entrée à renvoi (copie de travail préfixée « R ») n'est donc jamais rendu ;
 * - rien à cette clé et la pile a plus d'un niveau : la clé est dépilée et la recherche reprend (fin d'une suite visée par un
 *   renvoi, retour à la suite d'origine) ;
 * - après une lecture réussie, la séquence de la clé du dessus avance : un dialogue se lit par `get` puis `next` jusqu'à 0.
 * Une lecture sans tampon (`advance` faux) travaille sur une copie du curseur : elle répond « ce message existe-t-il, et qui
 * parle ? » sans rien déplacer.
 *
 * **Texte rendu** (un caractère par octet, CP850 non décodé, comme tout le noyau) :
 * - `\xx`, deux chiffres hexadécimaux : un octet. **Les lettres A à F valent 11 à 16**, et non 10 à 15 : faute de
 *   l'interpréteur d'origine, que les données attendent (`\1d` et `\1e` du module 64990 donnent 30 et 31, les deux flèches
 *   des listes de sauvegardes) ;
 * - `\c` : le caractère `c` tel quel ;
 * - **didascalie** : une parenthèse sans aucune minuscule ASCII, jusqu'à sa parenthèse fermante, est retirée avec les
 *   espaces et retours à la ligne qui la suivent (SCI2 : les chiffres n'empêchent pas le retrait).
 *
 * **Mode texte / voix (D2).** Le jeu le tient lui-même dans la variable globale 90 (`MessageMode` : bit 0 texte, bit 1
 * voix) ; la globale 166 dit si la narratrice est doublée. `gKInitCode::doit` (script 10) les fixe au démarrage d'après
 * `DoSound(GetAudioCapability)` : 3 et 1 s'il y a une sortie numérique, 1 et 0 sinon ; le panneau de réglages (script 14 :
 * `iconText`, `iconVoice`, `iconNar`) les change ensuite, sans jamais laisser 0. `Messager` (script 64924) refuse de parler
 * si la globale 90 vaut 0, et `Narrator::say` (script 64928) affiche le texte si le bit 0 est levé, lance la voix si le
 * bit 1 l'est. **Le temps d'un message, `Messager::nextMsg` passe la globale 90 à 1 (texte seul)** quand le talker est 64
 * ou 97, ou la narratrice (99) si elle n'est pas doublée ; `Messager::cue` remet ensuite le réglage du joueur.
 * `messageModeOf` et `narratorVoiceOf` lisent ces variables, `setMessageMode` les écrit (reprise d'un réglage).
 *
 * **Voix (vague A2).** Ce module ne joue rien. Le talker reçoit de `Messager` la clé rendue par `LastMessage` (renvois
 * suivis : la clé des clips de `data/audio-index.ts`) et appelle `DoAudio`, encore une souche qui rend 0 : `Play` (2) doit
 * rendre la durée du clip en ticks (elle borne l'affichage), `Position` (6) rendre −1 quand le clip est fini (le talker se
 * ferme alors seul), `Stop` (3) l'arrêter. Tant que `Position` rend 0, un texte reste à l'écran jusqu'au clic ou à Entrée,
 * dans tous les modes ; en voix seule, un personnage (classe `Talker`) n'affiche rien : c'est le comportement du script.
 *
 * Écarts volontaires : ScummVM cherche l'entrée dans les octets de la ressource à chaque appel ; ici la ressource décodée
 * est gardée par module. Ses « workarounds » de messages (aucun pour GK1) et la synthèse vocale ne sont pas portés.
 */
import { ResourceType } from "../data/ids";
import { findMessage, type MessageEntry, type MessageResource, type MessageTuple, readMessages } from "../data/message";
import { type MessageRemap, remapKey } from "./patches";
import { GAME_SCRIPT, GLOBAL_MESSAGE_MODE, GLOBAL_NARRATOR_VOICE, MessageMode } from "./ids";
import { fromInt, SciError, toSint16 } from "./memory";
import type { ResourceManager } from "./resources";
import type { Vm } from "./vm";
import { declareState } from "./save-codec";

/** Talker rendu quand il n'y a pas de message. */
export const NO_TALKER = 0;
/** Séquence du premier message d'une suite, et d'une clé visée par un renvoi. */
const FIRST_SEQ = 1;

const BACKSLASH = 0x5c;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const SPACE = 0x20;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const HEX_ESCAPE_LENGTH = 3;
/** Valeur de « a » pour l'interpréteur d'origine (11, et non 10). */
const HEX_LETTER_BASE = 11;

export interface MessageQuery {
  readonly module: number;
  readonly tuple: MessageTuple;
}

export interface MessageReply {
  readonly talker: number;
  /** Texte mis en forme, un caractère par octet. */
  readonly text: string;
}

interface Cursor {
  module: number;
  stack: MessageTuple[];
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isLowercase(code: number): boolean {
  return code >= 0x61 && code <= 0x7a;
}

/** Valeur d'un chiffre hexadécimal selon l'interpréteur d'origine, ou −1. */
function hexDigit(code: number): number {
  if (isDigit(code)) return code - 0x30;
  const lower = code | 0x20;
  return lower >= 0x61 && lower <= 0x66 ? lower - 0x61 + HEX_LETTER_BASE : -1;
}

/** Position après la didascalie ouverte en `start` et les blancs qui la suivent, ou −1 si ce n'en est pas une. */
function stageDirectionEnd(raw: Uint8Array, start: number): number {
  for (let i = start + 1; i < raw.length; i++) {
    if (isLowercase(raw[i])) return -1;
    if (raw[i] !== CLOSE_PAREN) continue;
    let end = i + 1;
    while (end < raw.length && (raw[end] === SPACE || raw[end] === LINE_FEED || raw[end] === CARRIAGE_RETURN)) end++;
    return end;
  }
  return -1;
}

/** Texte d'un message tel que le noyau le rend : échappements résolus, didascalies retirées. */
export function formatMessageText(raw: Uint8Array): string {
  let out = "";
  for (let i = 0; i < raw.length; ) {
    const code = raw[i];
    if (code === BACKSLASH && i + 1 < raw.length) {
      const high = hexDigit(raw[i + 1]);
      const low = i + 2 < raw.length ? hexDigit(raw[i + 2]) : -1;
      if (high >= 0 && low >= 0) {
        out += String.fromCharCode(((high << 4) + low) & 0xff);
        i += HEX_ESCAPE_LENGTH;
      } else {
        out += String.fromCharCode(raw[i + 1]);
        i += 2;
      }
      continue;
    }
    if (code === OPEN_PAREN) {
      const end = stageDirectionEnd(raw, i);
      if (end >= 0) {
        i = end;
        continue;
      }
    }
    out += String.fromCharCode(code);
    i++;
  }
  return out;
}

export class MessageState {
  private cursor: Cursor = { module: 0, stack: [] };
  private readonly saved: Cursor[] = [];
  private readonly modules = new Map<number, MessageResource | undefined>();
  private last: MessageQuery = { module: 0, tuple: { noun: 0, verb: 0, cond: 0, seq: 0 } };

  constructor(
    private readonly resources: ResourceManager,
    private readonly warn: (message: string) => void,
    /** Clés demandées par les scripts et lues sous une autre (`patches.ts`). */
    private readonly remaps: readonly MessageRemap[] = [],
  ) {}

  /** Messages d'un module, ou `undefined` s'il n'a pas de ressource. */
  module(number: number): MessageResource | undefined {
    if (!this.modules.has(number)) {
      const data = this.resources.find(ResourceType.Message, number);
      if (!data) this.warn(`Message : pas de ressource pour le module ${number}`);
      this.modules.set(number, data && readMessages(data));
    }
    return this.modules.get(number);
  }

  /** Pose le curseur sur ce message et le lit (voir `next`). */
  get(module: number, tuple: MessageTuple, advance: boolean): MessageReply | undefined {
    this.cursor = { module, stack: [{ ...tuple }] };
    return this.next(advance);
  }

  /**
   * Message sous le curseur, renvois suivis. `advance` : le curseur passe au message suivant et la clé lue devient celle de
   * `lastQuery` ; sinon le curseur ne bouge pas. `undefined` : il n'y a pas, ou plus, de message.
   */
  next(advance: boolean): MessageReply | undefined {
    const cursor = advance ? this.cursor : { module: this.cursor.module, stack: this.cursor.stack.map((tuple) => ({ ...tuple })) };
    const entry = this.record(cursor, true);
    if (!entry) return undefined;
    if (advance) {
      const top = cursor.stack[cursor.stack.length - 1];
      this.last = { module: cursor.module, tuple: { ...top } };
      cursor.stack[cursor.stack.length - 1] = { ...top, seq: top.seq + 1 };
    }
    return { talker: entry.talker, text: formatMessageText(entry.raw) };
  }

  /** Place à prévoir pour le texte de ce message, 0 final compris ; 0 s'il n'existe pas. Le curseur ne bouge pas. */
  size(module: number, tuple: MessageTuple): number {
    const entry = this.record({ module, stack: [{ ...tuple }] }, true);
    return entry ? formatMessageText(entry.raw).length + 1 : 0;
  }

  /** Renvoi porté par ce message, sans le suivre ; `undefined` si le message n'existe pas ; nul s'il n'a pas de renvoi. */
  ref(module: number, tuple: MessageTuple): MessageTuple | undefined {
    const entry = this.record({ module, stack: [{ ...tuple }] }, false);
    return entry && (entry.ref ?? { noun: 0, verb: 0, cond: 0, seq: FIRST_SEQ });
  }

  /** Clé du dernier message lu avec `advance` (après renvois : celle du texte rendu, qui est aussi celle de sa voix). */
  lastQuery(): MessageQuery {
    return this.last;
  }

  /** Clé que le prochain `next` cherchera d'abord : dans un message d'erreur. */
  pending(): MessageQuery | undefined {
    const top = this.cursor.stack[this.cursor.stack.length - 1];
    return top && { module: this.cursor.module, tuple: top };
  }

  /** Met le curseur de côté. */
  push(): void {
    this.saved.push({ module: this.cursor.module, stack: this.cursor.stack.map((tuple) => ({ ...tuple })) });
  }

  /** Reprend le dernier curseur mis de côté. */
  pop(): void {
    const cursor = this.saved.pop();
    if (!cursor) throw new SciError("Message : aucun curseur à reprendre");
    this.cursor = cursor;
  }

  /** Entrée désignée par le curseur ; `follow` suit les renvois et dépile les suites finies (le curseur est modifié). */
  private record(cursor: Cursor, follow: boolean): MessageEntry | undefined {
    if (cursor.stack.length === 0) {
      this.warn("Message : lecture sans curseur");
      return undefined;
    }
    // Un renvoi fait avancer la séquence de la clé qui le porte : une chaîne de renvois ne peut pas boucler sans fin.
    for (;;) {
      // Clé corrigée par le jeu : elle remplace la clé demandée dans le curseur, et c'est elle que `lastQuery` rendra
      // (celle de la voix). Une clé n'est remplacée qu'une fois : le résultat n'est pas cherché à son tour dans la table.
      const asked = cursor.stack[cursor.stack.length - 1];
      const mapped = remapKey(this.remaps, cursor.module, asked);
      if (mapped.tuple !== asked) {
        cursor.module = mapped.module;
        cursor.stack[cursor.stack.length - 1] = { ...mapped.tuple };
      }
      const resource = this.module(cursor.module);
      if (!resource) return undefined;
      const top = cursor.stack[cursor.stack.length - 1];
      const entry = findMessage(resource, top);
      if (!entry) {
        if (!follow || cursor.stack.length === 1) return undefined;
        cursor.stack.pop();
        continue;
      }
      if (!follow || !entry.ref) return entry;
      cursor.stack[cursor.stack.length - 1] = { ...top, seq: top.seq + 1 };
      cursor.stack.push({ ...entry.ref, seq: FIRST_SEQ });
    }
  }
}

const instances = new WeakMap<Vm, MessageState>();

/** État des messages d'une machine virtuelle. */
export function messagesOf(vm: Vm): MessageState {
  let state = instances.get(vm);
  if (!state) instances.set(vm, (state = new MessageState(vm.resources, (message) => vm.warn(message), vm.fixes.messageRemaps)));
  return state;
}

function globalsOf(vm: Vm): Uint32Array {
  const script = vm.scripts.loaded(GAME_SCRIPT);
  const globals = script && vm.memory.localsSegment(script.localsSegment);
  if (!globals) throw new SciError("variables globales absentes (script 0 non chargé)");
  return globals.values;
}

/** Mode courant du jeu : `MessageMode.Text`, `Speech` ou `Both` (0 avant l'initialisation du jeu). */
export function messageModeOf(vm: Vm): number {
  return toSint16(globalsOf(vm)[GLOBAL_MESSAGE_MODE]);
}

/** La narratrice est-elle doublée (sinon ses messages restent en texte, même en mode voix) ? */
export function narratorVoiceOf(vm: Vm): boolean {
  return globalsOf(vm)[GLOBAL_NARRATOR_VOICE] !== 0;
}

/** Fixe le mode et le doublage de la narratrice, comme le panneau de réglages du jeu. Le mode 0 n'existe pas. */
export function setMessageMode(vm: Vm, mode: MessageMode, narratorVoice: boolean): void {
  const globals = globalsOf(vm);
  globals[GLOBAL_MESSAGE_MODE] = fromInt(mode);
  globals[GLOBAL_NARRATOR_VOICE] = narratorVoice ? 1 : 0;
}

// État sauvegardé (`save.ts`) : le curseur de lecture, sa pile et le dernier message lu.
declareState(MessageState, { name: "MessageState", skip: ["modules", "resources"] });
