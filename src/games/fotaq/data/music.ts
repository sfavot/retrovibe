/**
 * Tables de morceaux de la musique : `AQ.RL` (Roland MT-32) et `AQBANK.MUS` (carte AdLib), deux fichiers du même
 * format ; en-têtes des fichiers MIDI standard (SMF) qu'ils contiennent. Pas de lecteur audio ici.
 *
 * Sources (engines/queen/music.cpp, ScummVM) : `MidiMusic::MidiMusic` (nombre de morceaux), `songOffset`,
 * `songLength`, `playMusic` (décompression d'un morceau) ; le pilote AdLib (`midiadlib.cpp`) n'est pas lu.
 *
 * Format (**vérifié**) : `u16` petit-boutiste nombre de morceaux `n` ; `n` fois deux `u16` (bas, haut) : le
 * décalage du morceau est `(haut << 4) | bas` (adresse segment:décalage) ; 2 octets d'information entre la table
 * et le premier morceau (`80 00` dans les deux fichiers : volume AdLib par défaut, commenté dans ScummVM) ;
 * puis les morceaux, contigus. La longueur d'un morceau est la différence avec le décalage suivant ; le dernier
 * va jusqu'à la fin du fichier (ScummVM lit pour lui une entrée au-delà de la table, qui n'a pas de sens).
 * Un morceau est un SMF direct (`MThd`), ou **compressé** s'il commence par `C` ou `c` : un dictionnaire de 256
 * mots de 16 bits (512 octets) puis un indice d'un octet par mot ; le SMF est la suite des mots `dico[indice]`,
 * privée de son premier octet pour `c`. (ScummVM compte un indice de plus que le morceau n'en a — il lit le
 * premier octet du morceau suivant —, ce qui ajoute deux octets de bruit à la fin du SMF : non reproduit.)
 * Numérotation : les morceaux de `songs` sont **à partir de 0** ; les tables de ScummVM (`_tune`) donnent
 * des numéros à partir de 1 (`numéro - 1`).
 *
 * **Morceaux 48 et 88 d'`AQ.RL`** (la question de la vague D) : ce sont des SMF directs défectueux dans le fichier.
 * - Le 48 commence par un en-tête résiduel de 22 octets (`MThd` + `MTrk` de longueur 8 640, souches d'un autre
 *   morceau) suivi d'un SMF complet et correct : `defect: "stubPrefix"`, les 22 octets sont retirés de `smf`.
 *   Le numéro 49 de la table `_tune` n'est référencé par aucune liste de ScummVM.
 * - Le 88 est coupé à 5 120 octets alors que sa piste en déclare 6 396 : la fin est perdue
 *   (`defect: "truncated"`, `smf` rendu tel quel). ScummVM le remplace (comme le 89) par le 62.
 * La version AdLib n'a aucun de ces défauts.
 *
 * Autres faits relevés (**vérifiés** par test) : dans `AQBANK.MUS`, la longueur déclarée de la piste omet la fin de
 * piste finale `00 FF 2F 00` (les quatre octets suivent la piste dans les 102 morceaux) ; un morceau décompressé peut
 * finir par un octet de remplissage (mot de 16 bits incomplet) ; un seul morceau d'`AQ.RL` a plusieurs pistes
 * (7 pistes, format 1) ; les divisions sont 96, 192, 288 ou 384 ticks par noire pour le Roland et 420 pour
 * l'AdLib ; chaque morceau AdLib commence par un méta `FF 7F` (instrument, voir `midiadlib.cpp`).
 */

import { BinaryReader } from "../../../data/reader";

const COUNT_SIZE = 2;
const ENTRY_SIZE = 4;
const DICTIONARY_SIZE = 0x200;
const SMF_HEADER = 14;
const CHUNK_HEADER = 8;
const STUB_SIZE = SMF_HEADER + CHUNK_HEADER;

export interface SmfChunk {
  /** Décalage de l'en-tête `MTrk` dans le SMF. */
  offset: number;
  /** Longueur déclarée de la piste. */
  declared: number;
  /** Octets réellement présents après l'en-tête de piste (au plus jusqu'à la fin du SMF). */
  available: number;
}

export interface SmfLayout {
  format: number;
  trackCount: number;
  /** Ticks par noire. */
  division: number;
  tracks: SmfChunk[];
  /** Vrai si toutes les pistes annoncées sont présentes en entier. */
  complete: boolean;
  /** Octets après la dernière piste. */
  trailing: number;
}

export type SongDefect = "stubPrefix" | "truncated";

export interface BankSong {
  /** Rang dans la table, à partir de 0. */
  index: number;
  /** Décalage du morceau dans le fichier et longueur stockée. */
  offset: number;
  length: number;
  compression: "none" | "dictionary" | "dictionarySkipFirst";
  /** SMF décompressé (et débarrassé de sa souche pour `stubPrefix`) ; une vue du fichier si non compressé. */
  smf: Uint8Array;
  layout: SmfLayout;
  defect: SongDefect | null;
}

export interface SongBank {
  songs: BankSong[];
  /** Octets entre la table et le premier morceau. */
  info: Uint8Array;
}

/** En-tête et pistes d'un SMF, sans interpréter les événements (l'analyseur complet est `parseSong`). */
export function smfLayout(smf: Uint8Array): SmfLayout {
  const reader = new BinaryReader(smf);
  if (smf.length < SMF_HEADER || reader.tag() !== "MThd") throw new Error("SMF invalide : en-tête MThd absent");
  const headerSize = reader.u32be();
  const format = reader.u16be();
  const trackCount = reader.u16be();
  const division = reader.u16be();
  let position = 8 + headerSize;
  const tracks: SmfChunk[] = [];
  let complete = true;
  for (let i = 0; i < trackCount; i++) {
    if (position + CHUNK_HEADER > smf.length) {
      complete = false;
      break;
    }
    reader.offset = position;
    if (reader.tag() !== "MTrk") throw new Error("SMF invalide : piste MTrk absente");
    const declared = reader.u32be();
    const available = Math.min(declared, smf.length - position - CHUNK_HEADER);
    tracks.push({ offset: position, declared, available });
    if (available < declared) {
      complete = false;
      position = smf.length;
      break;
    }
    position += CHUNK_HEADER + declared;
  }
  return { format, trackCount, division, tracks, complete, trailing: complete ? smf.length - position : 0 };
}

function decompress(song: Uint8Array): Uint8Array {
  const skipFirst = song[0] === 0x63;
  const indexCount = song.length - 1 - DICTIONARY_SIZE;
  if (indexCount < 0) throw new Error("morceau compressé tronqué");
  const dictionary = song.subarray(1, 1 + DICTIONARY_SIZE);
  const out = new Uint8Array(indexCount * 2);
  for (let i = 0; i < indexCount; i++) {
    const word = song[1 + DICTIONARY_SIZE + i] * 2;
    out[i * 2] = dictionary[word];
    out[i * 2 + 1] = dictionary[word + 1];
  }
  return skipFirst ? out.subarray(1) : out;
}

/** Lit une table de morceaux (`AQ.RL` ou `AQBANK.MUS`). */
export function readSongBank(bytes: Uint8Array): SongBank {
  const reader = new BinaryReader(bytes);
  const count = reader.u16();
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const low = reader.u16();
    const high = reader.u16();
    offsets.push((high << 4) | low);
  }
  offsets.push(bytes.length);
  const tableEnd = COUNT_SIZE + count * ENTRY_SIZE;
  if (count === 0 || offsets[0] < tableEnd) throw new Error("table de morceaux invalide : premier morceau dans la table");
  const songs: BankSong[] = [];
  for (let i = 0; i < count; i++) {
    const offset = offsets[i];
    const length = offsets[i + 1] - offset;
    if (length <= 0 || offsets[i + 1] > bytes.length) throw new Error(`table de morceaux invalide : morceau ${i} hors du fichier`);
    const stored = bytes.subarray(offset, offset + length);
    const first = stored[0];
    const compression = first === 0x43 ? "dictionary" : first === 0x63 ? "dictionarySkipFirst" : "none";
    let smf = compression === "none" ? stored : decompress(stored);
    let layout = smfLayout(smf);
    let defect: SongDefect | null = null;
    if (!layout.complete) {
      const stub = smf.subarray(STUB_SIZE);
      if (smf.length > STUB_SIZE + SMF_HEADER && String.fromCharCode(...stub.subarray(0, 4)) === "MThd" && smfLayout(stub).complete) {
        smf = stub;
        layout = smfLayout(smf);
        defect = "stubPrefix";
      } else {
        defect = "truncated";
      }
    }
    songs.push({ index: i, offset, length, compression, smf, layout, defect });
  }
  return { songs, info: bytes.subarray(tableEnd, offsets[0]) };
}

/** Table de la musique Roland MT-32 (`AQ.RL`). */
export function readRolandBank(bytes: Uint8Array): SongBank {
  return readSongBank(bytes);
}

/** Table de la musique AdLib (`AQBANK.MUS`) : même format, les instruments sont dans les morceaux. */
export function readAdLibBank(bytes: Uint8Array): SongBank {
  return readSongBank(bytes);
}
