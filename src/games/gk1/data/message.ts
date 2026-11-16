/**
 * Messages SCI2 (`docs/gk1/formats.md` § 9) : les textes français du jeu, une ressource par module.
 *
 * Référence : `engines/sci/engine/message.cpp` de ScummVM (`MessageReaderV4`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * ```
 * u32 version (4321 ou 4330 : format 4) | u16 @4 fin des textes − 6 | u16 @6 | u16 @8 nombre d'entrées
 * Entrée (11 octets) : noun | verb | cond | seq | talker | u16 offset du texte | refNoun | refVerb | refCond | u8 @10 (0 ou 1, non lu)
 * Textes : CP850, terminés par 0, contigus, dans l'ordre des entrées, jusqu'à l'offset annoncé @4
 * Suite (outil d'origine, non lue par l'interpréteur) : par entrée, un commentaire terminé par 0, u32 date, u16
 * ```
 * Un renvoi non nul (`ref`) désigne un autre message du même module, à lire à la place de celui-ci : **toujours sa séquence 1**
 * (comme ScummVM ; l'octet @10 n'est pas une séquence : il vaut aussi 1 dans 4 700 entrées sans renvoi). Le texte d'une
 * entrée à renvoi est une copie de travail des traducteurs, préfixée « R » : il n'est jamais affiché.
 *
 * Écarts volontaires : ScummVM cherche une entrée à la demande dans les octets ; ici toute la ressource est décodée en une
 * fois (textes en chaînes JavaScript), et la suite propre à l'éditeur de Sierra est parcourue pour vérifier qu'il ne reste rien.
 */
import { decodeCp850 } from "../../../data/cp850";
import { BinaryReader } from "../../../data/reader";

/** Seule version de format gérée : `version / 1000`. */
export const MESSAGE_FORMAT = 4;
/** Talker du narrateur. */
export const TALKER_NARRATOR = 99;

const HEADER_SIZE = 10;
const RECORD_SIZE = 11;
/** Le champ @4 compte à partir de la fin du champ lui-même. */
const TEXT_END_BASE = 6;
const EDITOR_RECORD_TAIL = 6;
/** Un renvoi vise toujours la première séquence. */
const REF_SEQ = 1;

export interface MessageTuple {
  readonly noun: number;
  readonly verb: number;
  readonly cond: number;
  readonly seq: number;
}

export interface MessageEntry extends MessageTuple {
  readonly talker: number;
  /** Texte décodé (CP850 → Unicode), sans le 0 final. */
  readonly text: string;
  /** Octets du texte, pour un affichage par les polices du jeu (indices de glyphes). */
  readonly raw: Uint8Array;
  /** Renvoi vers un autre message du module, ou `undefined`. */
  readonly ref: MessageTuple | undefined;
  /** Note laissée par les auteurs dans l'éditeur de messages (souvent vide) ; jamais affichée. */
  readonly comment: string;
}

export interface MessageResource {
  readonly version: number;
  readonly entries: readonly MessageEntry[];
}

export function readMessages(data: Uint8Array): MessageResource {
  if (data.length < HEADER_SIZE) throw new Error("GK1 : ressource message tronquée");
  const r = new BinaryReader(data);
  const version = r.u32();
  if (Math.floor(version / 1000) !== MESSAGE_FORMAT) throw new Error(`GK1 : version de messages ${version} non gérée`);
  const textEnd = r.u16() + TEXT_END_BASE;
  r.u16();
  const count = r.u16();
  if (HEADER_SIZE + count * RECORD_SIZE > data.length || textEnd > data.length) throw new Error("GK1 : entrées de messages hors de la ressource");

  const records = [];
  for (let i = 0; i < count; i++) {
    const tuple = { noun: r.u8(), verb: r.u8(), cond: r.u8(), seq: r.u8() };
    const talker = r.u8();
    const textOffset = r.u16();
    const ref = { noun: r.u8(), verb: r.u8(), cond: r.u8(), seq: REF_SEQ };
    r.u8();
    records.push({ tuple, talker, textOffset, ref });
  }

  let comments = textEnd;
  const entries = records.map(({ tuple, talker, textOffset, ref }): MessageEntry => {
    const end = data.indexOf(0, textOffset);
    if (textOffset < r.offset || end === -1 || end >= textEnd) throw new Error("GK1 : texte de message hors de la zone des textes");
    const raw = data.subarray(textOffset, end);
    const commentEnd = data.indexOf(0, comments);
    if (commentEnd === -1 || commentEnd + 1 + EDITOR_RECORD_TAIL > data.length) throw new Error("GK1 : suite de la ressource message tronquée");
    const comment = decodeCp850(data.subarray(comments, commentEnd));
    comments = commentEnd + 1 + EDITOR_RECORD_TAIL;
    const hasRef = ref.noun !== 0 || ref.verb !== 0 || ref.cond !== 0;
    return { ...tuple, talker, text: decodeCp850(raw), raw, ref: hasRef ? ref : undefined, comment };
  });
  if (comments !== data.length) throw new Error("GK1 : octets inexpliqués à la fin de la ressource message");
  return { version, entries };
}

/** Clé d'un message dans son module (`noun-verb-cond-seq`, la même que celle des voix). */
export function messageKey(tuple: MessageTuple): string {
  return `${tuple.noun}-${tuple.verb}-${tuple.cond}-${tuple.seq}`;
}

/** Entrée d'un module par sa clé, sans suivre les renvois. */
export function findMessage(resource: MessageResource, tuple: MessageTuple): MessageEntry | undefined {
  return resource.entries.find((e) => e.noun === tuple.noun && e.verb === tuple.verb && e.cond === tuple.cond && e.seq === tuple.seq);
}
