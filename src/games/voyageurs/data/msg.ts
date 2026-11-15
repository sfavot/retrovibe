/**
 * Fichiers `.MSG` : messages du jeu (dialogues, descriptions).
 *
 * Référence : ScummVM engines/cine/msg.cpp (`loadMsg`) et gfx.cpp (rendu des textes ; `|` = retour à la ligne dans une bulle) (GPL v3 ou
 * ultérieure). Format : nombre de messages (u16), une longueur par message (u16), puis les chaînes concaténées. docs/voyageurs/formats.md § 2.9 et § 4.
 *
 * Comme ScummVM, la longueur ne sert qu'à avancer : le texte d'un message va de son début jusqu'au premier octet nul (ou la fin du fichier) ;
 * un message dont le début est hors du fichier vaut la chaîne vide. Le dépaqueteur complète d'un zéro les fichiers de taille impaire.
 *
 * Écarts volontaires : en plus de `raw` (octets d'origine, à donner à la police : codes CP437 de `texte.cpp`), `text` est du Unicode ;
 * le patch français emploie 0x97 (ù en CP437) pour « ê » (la police affiche le même glyphe pour 0x88 et 0x97 ; aucun « ù » dans les textes),
 * `text` le restitue donc en « ê » (docs/voyageurs/formats.md § 4.1).
 */
import { decodeCp437 } from "../../../data/cp437";
import { BinaryReader } from "../../../data/reader";

/** Octet que le patch français emploie pour « ê ». */
export const MSG_E_CIRCUMFLEX_BYTE = 0x97;
const CP437_E_CIRCUMFLEX = 0x88;

export interface Message {
  /** Octets du message, sans l'octet nul de fin. */
  readonly raw: Uint8Array;
  /** Texte Unicode (CP437, 0x97 -> ê). `|` est conservé. */
  readonly text: string;
}

/** CP437 avec 0x97 lu comme « ê ». */
export function decodeMessageText(raw: Uint8Array): string {
  const fixed = raw.slice();
  for (let i = 0; i < fixed.length; i++) if (fixed[i] === MSG_E_CIRCUMFLEX_BYTE) fixed[i] = CP437_E_CIRCUMFLEX;
  return decodeCp437(fixed);
}

export function readMsg(data: Uint8Array): Message[] {
  const reader = new BinaryReader(data);
  const count = reader.u16be();
  if (2 + count * 2 > data.length) throw new RangeError("MSG tronqué : table des longueurs hors du fichier");
  const lengths: number[] = [];
  for (let i = 0; i < count; i++) lengths.push(reader.u16be());
  const messages: Message[] = [];
  let position = reader.offset;
  for (const length of lengths) {
    let raw = new Uint8Array(0);
    if (position < data.length) {
      const end = data.indexOf(0, position);
      raw = data.slice(position, end === -1 ? data.length : end);
    }
    messages.push({ raw, text: decodeMessageText(raw) });
    position += length;
  }
  return messages;
}
