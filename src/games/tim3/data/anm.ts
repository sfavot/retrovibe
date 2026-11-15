/**
 * Animations `.ANM` de TIM3 (`docs/tim3/formats.md` § 4), lues jusqu'au dernier octet.
 *
 * Fichier = chunks Dynamix `ANM:`, `TAG:`, et parfois `LAB:`.
 * ```
 * ANM: "TB" ; u16 version (1000, 1001, 1002, 1004) ; u16 nSéquence ; u16 nImages ; u16 nÉtats ; u16 octetsCommandes ;
 *      u16 largeur ; u16 hauteur ; [version ≥ 1002] 3 × u16 inconnus
 *      u16 séquence[nSéquence]                                   (index d'images)
 *      nImages × { i16 x, i16 y, u16 l, u16 h, u16 offset en mots dans les commandes [, u16 inconnu si ≥ 1002] }
 *      nÉtats × { u16 premier (index dans la séquence, ou dans les images si la séquence est vide), u16 état }
 *      commandes : flux de u16 ; 0 fin d'image, 1 fin du flux (dernier mot), 2 bitmap, 3 rectangle, 4 ligne,
 *      5 son, 8 son étendu
 * TAG: u16 n ; n × { u16 id, cstring nom du BMP }     LAB: u16 n ; n × { u16 id, cstring étiquette }
 * ```
 */
import { BinaryReader } from "../../../data/reader";
import { readChunks, readIdStrings } from "./dgds-chunk";

export type AnmCommand =
  | { op: "endFrame" }
  | { op: "end" }
  /** Dessine l'image `frame` du BMP `image` (id du `TAG:`) ; `flip` : 0 aucun, 1 vertical, 2 horizontal, 3 les deux. */
  | { op: "bitmap"; image: number; frame: number; x: number; y: number; flip: number }
  /** Rectangle ; `fill` : bit 15 = rempli, bas = couleur (supposé : `fill` = 0x8000 | `color` dans les données). */
  | { op: "rect"; x: number; y: number; width: number; height: number; color: number; fill: number }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: number }
  /** Son `SX_<sound>.WAV`. */
  | { op: "sound"; sound: number }
  /** Son avec deux paramètres non établis (36 occurrences, MAINMENU et SIERRA). */
  | { op: "soundEx"; sound: number; unknown04: number; unknown06: number };

export interface AnmFrame {
  /** Décalage de dessin. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Offset du début de l'image dans le flux, en mots de 16 bits. */
  commandOffset: number;
  /** Versions ≥ 1002 seulement. */
  unknown0A?: number;
  /** Commandes de l'image, jusqu'à la fin d'image (exclue). */
  commands: AnmCommand[];
}

export interface AnmState {
  /** Premier index dans `sequence` (ou dans `frames` si la séquence est vide). */
  first: number;
  /** Numéro d'état (de la pièce ou du contrôle). */
  state: number;
}

export interface Anm {
  version: number;
  width: number;
  height: number;
  /** Versions ≥ 1002 : trois mots d'en-tête (20, 0, 0 ou 20, 0, 23). */
  unknownHeader?: [number, number, number];
  /** Suite d'index d'images (vide : on parcourt `frames` dans l'ordre). */
  sequence: number[];
  frames: AnmFrame[];
  states: AnmState[];
  /** Flux complet, dans l'ordre. */
  commands: AnmCommand[];
  /** Bitmaps sources (`TAG:`) : id → nom de fichier. */
  images: { id: number; name: string }[];
  /** Étiquettes (`LAB:`), présentes dans 5 fichiers. */
  labels: { id: number; text: string }[];
}

const COMMAND_WORDS: Record<number, number> = { 0: 1, 1: 1, 2: 6, 3: 7, 4: 6, 5: 2, 8: 4 };

export function readAnm(bytes: Uint8Array): Anm {
  const chunks = readChunks(bytes);
  const tags = chunks.map((c) => c.tag).join("/");
  if (tags !== "ANM:/TAG:" && tags !== "ANM:/TAG:/LAB:") throw new Error(`TIM3 : ANM inattendu (${tags})`);
  const anm = readAnmChunk(chunks[0]!.data);
  anm.images = readIdStrings(chunks[1]!.data).map(([id, name]) => ({ id, name }));
  anm.labels = chunks[2] ? readIdStrings(chunks[2].data).map(([id, text]) => ({ id, text })) : [];
  return anm;
}

function readAnmChunk(data: Uint8Array): Anm {
  const r = new BinaryReader(data);
  if (r.u8() !== 0x54 || r.u8() !== 0x42) throw new Error("TIM3 : ANM sans « TB »");
  const version = r.u16();
  if (![1000, 1001, 1002, 1004].includes(version)) throw new Error(`TIM3 : version d'ANM inconnue (${version})`);
  const nSequence = r.u16();
  const nFrames = r.u16();
  const nStates = r.u16();
  const commandBytes = r.u16();
  const width = r.u16();
  const height = r.u16();
  const long = version >= 1002;
  const unknownHeader: [number, number, number] | undefined = long ? [r.u16(), r.u16(), r.u16()] : undefined;
  const expected = r.offset + 2 * nSequence + (long ? 12 : 10) * nFrames + 4 * nStates + commandBytes;
  if (expected !== data.length) throw new Error(`TIM3 : ANM de ${data.length} octets, ${expected} annoncés`);
  const sequence = Array.from({ length: nSequence }, () => r.u16());
  const frames: AnmFrame[] = [];
  for (let i = 0; i < nFrames; i++) {
    const f: AnmFrame = { x: r.i16(), y: r.i16(), width: r.u16(), height: r.u16(), commandOffset: r.u16(), commands: [] };
    if (long) f.unknown0A = r.u16();
    frames.push(f);
  }
  const states = Array.from({ length: nStates }, () => ({ first: r.u16(), state: r.u16() }));
  const stream = new BinaryReader(r.bytesView(commandBytes));
  const commands: AnmCommand[] = [];
  const frameStarts = new Map<number, number>([[0, 0]]);
  while (!stream.isAtEnd) {
    const cmd = readCommand(stream);
    commands.push(cmd);
    if (cmd.op === "endFrame") frameStarts.set(stream.offset / 2, commands.length);
    if (cmd.op === "end") break;
  }
  if (!stream.isAtEnd || commands.at(-1)?.op !== "end") throw new Error("TIM3 : flux de commandes d'ANM mal terminé");
  for (const f of frames) {
    const start = frameStarts.get(f.commandOffset);
    if (start === undefined) throw new Error(`TIM3 : image d'ANM hors d'une frontière de commande (${f.commandOffset})`);
    let end = start;
    while (commands[end]!.op !== "endFrame" && commands[end]!.op !== "end") end++;
    f.commands = commands.slice(start, end);
  }
  for (const i of sequence) if (i >= nFrames) throw new Error(`TIM3 : séquence d'ANM hors des images (${i})`);
  const limit = nSequence > 0 ? nSequence : nFrames;
  for (const s of states) if (nFrames > 0 && s.first >= limit) throw new Error(`TIM3 : état d'ANM hors limites (${s.first})`);
  return { version, width, height, unknownHeader, sequence, frames, states, commands, images: [], labels: [] };
}

function readCommand(r: BinaryReader): AnmCommand {
  const at = r.offset;
  const op = r.u16();
  const words = COMMAND_WORDS[op];
  if (words === undefined) throw new Error(`TIM3 : commande d'ANM inconnue ${op} (octet ${at})`);
  if (at + 2 * words > r.length) throw new Error("TIM3 : commande d'ANM tronquée");
  switch (op) {
    case 0:
      return { op: "endFrame" };
    case 1:
      return { op: "end" };
    case 2:
      return { op: "bitmap", image: r.u16(), frame: r.u16(), x: r.i16(), y: r.i16(), flip: r.u16() };
    case 3:
      return { op: "rect", x: r.i16(), y: r.i16(), width: r.i16(), height: r.i16(), color: r.u16(), fill: r.u16() };
    case 4:
      return { op: "line", x1: r.i16(), y1: r.i16(), x2: r.i16(), y2: r.i16(), color: r.u16() };
    case 5:
      return { op: "sound", sound: r.u16() };
    default:
      return { op: "soundEx", sound: r.u16(), unknown04: r.u16(), unknown06: r.u16() };
  }
}
