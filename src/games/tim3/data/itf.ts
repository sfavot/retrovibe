/**
 * Écrans d'interface `.ITF` de TIM3 (`docs/tim3/formats.md` § 4) : la liste des contrôles d'une fenêtre (boutons,
 * flèches, cases, zones de texte), dessinés avec les images d'une ANM. Lus jusqu'au dernier octet.
 *
 * ```
 * ITF: "TBO" u8 version (= 4) ; cstring ANM utilisée ; u16 n ; u16 genre[n]
 *      n × contrôle { u16 genre (= genre[i]) ; u16 id ; i16 ? ; i16 x, y ; u16 l, h ; u16 image ; u16 valeur ;
 *                     i16 ?, i16 ? }                               (22 o)
 *      genre 4 (zone de texte) : 18 o de plus { u16 ?, u16 couleur, u16 ?, i16 x, y, l, h, u16 drapeaux, u16 ? }
 * TAG: u16 n ; n × { u16 id, cstring nom du contrôle (« BS_DONE ») } — tous les contrôles n'y figurent pas
 * ```
 * L'`id` d'un contrôle est la clé à 5 chiffres de `DESCRIPT.RES` (infobulle) et `HELP.RES` (aide du professeur).
 */
import { BinaryReader, decodeText } from "../../../data/reader";
import { readChunks, readIdStrings } from "./dgds-chunk";

/** Genre de contrôle, d'après les noms du `TAG:` et les textes associés (supposé). */
export const ITF_KINDS = {
  0: "image", // décor, fenêtre ou libellé
  1: "button",
  2: "choice", // choix exclusif (catégories de puzzles)
  3: "toggle", // interrupteur (musique, sons)
  4: "text", // zone de texte (saisie ou affichage)
  5: "arrow", // flèche à répétition (défilement, plus/moins)
} as const;

export interface ItfTextBox {
  unknown16: number;
  color: number;
  unknown1A: number;
  x: number;
  y: number;
  width: number;
  height: number;
  flags: number;
  unknown26: number;
}

export interface ItfControl {
  kind: number;
  id: number;
  /** −3 pour 435 contrôles sur 454 ; autre valeur dans CNTRLPNL et PARTSBIN (supposé : rattachement). */
  unknown04: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1 : `value` est une image de l'ANM ; 0 : un identifiant (texte ou dessin propre). */
  image: number;
  value: number;
  unknown12: number;
  unknown14: number;
  /** Genre 4 seulement. */
  text?: ItfTextBox;
  /** Nom tiré du `TAG:`, s'il y figure. */
  name?: string;
}

export interface Itf {
  version: number;
  /** ANM qui fournit les images des contrôles (vide pour GENERIC.ITF). */
  anm: string;
  controls: ItfControl[];
  /** Entrées du `TAG:`, dans l'ordre. */
  names: { id: number; name: string }[];
}

export function readItf(bytes: Uint8Array): Itf {
  const chunks = readChunks(bytes);
  if (chunks.map((c) => c.tag).join("/") !== "ITF:/TAG:") throw new Error("TIM3 : ITF inattendu");
  const data = chunks[0]!.data;
  const r = new BinaryReader(data);
  if (r.tag().slice(0, 3) !== "TBO") throw new Error("TIM3 : ITF sans « TBO »");
  r.offset = 3;
  const version = r.u8();
  const end = data.indexOf(0, r.offset);
  if (end === -1) throw new Error("TIM3 : nom d'ANM sans terminateur");
  const anm = decodeText(data.subarray(r.offset, end));
  r.offset = end + 1;
  const n = r.u16();
  const kinds = Array.from({ length: n }, () => r.u16());
  const names = readIdStrings(chunks[1]!.data).map(([id, name]) => ({ id, name }));
  const byId = new Map(names.map((e) => [e.id, e.name]));
  const controls: ItfControl[] = [];
  for (const expected of kinds) {
    if (r.offset + 22 > data.length) throw new Error("TIM3 : ITF tronqué");
    const c: ItfControl = {
      kind: r.u16(),
      id: r.u16(),
      unknown04: r.i16(),
      x: r.i16(),
      y: r.i16(),
      width: r.u16(),
      height: r.u16(),
      image: r.u16(),
      value: r.u16(),
      unknown12: r.i16(),
      unknown14: r.i16(),
    };
    if (c.kind !== expected) throw new Error(`TIM3 : genre de contrôle ${c.kind}, ${expected} annoncé`);
    if (!(c.kind in ITF_KINDS)) throw new Error(`TIM3 : genre de contrôle inconnu ${c.kind}`);
    if (c.kind === 4) {
      c.text = {
        unknown16: r.u16(),
        color: r.u16(),
        unknown1A: r.u16(),
        x: r.i16(),
        y: r.i16(),
        width: r.i16(),
        height: r.i16(),
        flags: r.u16(),
        unknown26: r.u16(),
      };
    }
    const name = byId.get(c.id);
    if (name !== undefined) c.name = name;
    controls.push(c);
  }
  if (!r.isAtEnd) throw new Error(`TIM3 : ${data.length - r.offset} octets en trop dans l'ITF`);
  return { version, anm, controls, names };
}
