import { decodeCp437 } from "../../../data/cp437";
import { BinaryReader } from "../../../data/reader";
import { NOT_KEY, xorBytes } from "./text";

/** Petites tables de données d'*Armaeth* : `A1FDEF.SYS`, `A1FANI.SYS`, `A1FINS.SYS`, `A1FTMP.SCR`, `A1FSOS.SYS`. */

/** Familles de ressources sprite, dans l'ordre des fichiers `INT`, `DEC`, `OBJ`, `ANM` (`gm_def_lookup` `10b3:0006`). */
export const SPRITE_FAMILIES = ["INT", "DEC", "OBJ", "ANM"] as const;
export type SpriteFamily = (typeof SPRITE_FAMILIES)[number];

export const DEF_RECORD_BYTES = 28;

/** Descripteur d'un modèle d'objet. */
export interface DefRecord {
  /** Identifiant de la ressource (premier mot, clé de recherche de `gm_def_lookup`). */
  id: number;
  /**
   * Les 26 octets suivants (offsets 2 à 27 de l'enregistrement). Ils servent de modèle à
   * `gm_create_object` pour le jeton `add*` (`117d:0002`) : octet 3 -> champ +0x24 de l'objet, octet 4 ->
   * `Mob` (+6) et +0x25, octet 5 -> `Dep` (+7) et +0x27, octet 6 -> `Txt` (+8) et +0x26, octet 0x18 (signé)
   * -> +0x0A. Sens des autres : inconnu.
   */
  bytes: Uint8Array;
}

export interface DefTable {
  /** Nombre de ressources par famille (30, 20, 92, 47). */
  counts: Record<SpriteFamily, number>;
  /** Enregistrements de toutes les familles, dans l'ordre INT, DEC, OBJ, ANM. */
  records: Record<SpriteFamily, DefRecord[]>;
}

/** `A1FDEF.SYS` : quatre compteurs `u16` puis un enregistrement de 28 octets par ressource (8 + 28 × 189 = 5 300). */
export function parseDef(bytes: Uint8Array): DefTable {
  const r = new BinaryReader(bytes);
  const counts = { INT: r.u16(), DEC: r.u16(), OBJ: r.u16(), ANM: r.u16() };
  const total = counts.INT + counts.DEC + counts.OBJ + counts.ANM;
  if (8 + DEF_RECORD_BYTES * total !== bytes.length) throw new Error(`DEF invalide : ${total} enregistrements pour ${bytes.length} octets`);
  const records = { INT: [], DEC: [], OBJ: [], ANM: [] } as Record<SpriteFamily, DefRecord[]>;
  for (const family of SPRITE_FAMILIES) {
    for (let i = 0; i < counts[family]; i++) {
      const id = r.u16();
      records[family].push({ id, bytes: r.bytesView(DEF_RECORD_BYTES - 2) });
    }
  }
  return { counts, records };
}

/**
 * Enregistrement d'animation de `A1FANI.SYS` (12 octets). Lecture : `gm_load_ani` `16f5:000e` ; usage :
 * `FUN_16f5_0132` et `FUN_16f5_038c`.
 */
export interface AniRecord {
  /** Mot 0 : numéro d'animation (1 à 47, égal à l'id de la ressource `ANM`). */
  id: number;
  /** Mot 1 : 32 ou 65 (sens inconnu ; 32 -> mots 2 et 3 nuls). */
  kind: number;
  /** Mot 2 et mot 3 : croissent de 1 en 1 d'un enregistrement à l'autre (rôle inconnu). */
  unknown2: number;
  unknown3: number;
  /** Mot 4 : nombre de pas ; copié dans `Nbr` (+0x36) de l'objet. */
  steps: number;
  /** Mot 5 : indice du premier pas dans la table de mots. */
  start: number;
}

export interface AniTable {
  records: AniRecord[];
  /** Table de mots (147) : pas des animations (l'octet bas est écrit dans `Tim` +0x32 de l'objet). */
  words: Uint16Array;
  /** Mots des pas de l'animation `id` (`steps` mots à partir de `start`). */
  sequence(id: number): Uint16Array;
}

/** `A1FANI.SYS` : `u16 n1`, `u16 n2`, `n1` enregistrements de 12 octets, `n2` mots (4 + 12 × 47 + 2 × 147 = 862). */
export function parseAni(bytes: Uint8Array): AniTable {
  const r = new BinaryReader(bytes);
  const recordCount = r.u16();
  const wordCount = r.u16();
  if (4 + 12 * recordCount + 2 * wordCount !== bytes.length) throw new Error(`ANI invalide : ${bytes.length} octets`);
  const records: AniRecord[] = [];
  for (let i = 0; i < recordCount; i++) {
    records.push({ id: r.u16(), kind: r.u16(), unknown2: r.u16(), unknown3: r.u16(), steps: r.u16(), start: r.u16() });
  }
  const words = new Uint16Array(wordCount);
  for (let i = 0; i < wordCount; i++) words[i] = r.u16();
  for (const record of records) {
    if (record.start + record.steps > wordCount) throw new Error(`ANI invalide : animation ${record.id} hors table`);
  }
  return {
    records,
    words,
    sequence(id) {
      const record = records.find((entry) => entry.id === id);
      if (!record) throw new Error(`Animation ${id} inconnue`);
      return words.subarray(record.start, record.start + record.steps);
    },
  };
}

export const INS_BYTES = 236;

/** `A1FINS.SYS` : enregistrement d'installation lu par `gm_init_paths` `1e68:0008` (236 octets en `DGROUP:4f9a`). */
export interface InstallRecord {
  /** Octet 0 : type d'installation (0 = lecteur courant ; sinon invites « DISK-n »). */
  type: number;
  /** Octet 1 : lettre du lecteur (« C »). */
  drive: string;
  /** Chaîne à l'offset 0x10 : répertoire d'installation (`\ARMAETH`). */
  directory: string;
  raw: Uint8Array;
}

export function parseInstall(bytes: Uint8Array): InstallRecord {
  if (bytes.length !== INS_BYTES) throw new Error(`INS invalide : ${bytes.length} octets`);
  const end = bytes.indexOf(0, 0x10);
  return {
    type: bytes[0],
    drive: String.fromCharCode(bytes[1]),
    directory: decodeCp437(bytes.subarray(0x10, end)),
    raw: bytes,
  };
}

export const TMP_SCR_BYTES = 10;

/** `A1FTMP.SCR` : 10 octets lus/écrits par `gm_read_tmp_scr` (`1664:06b6`) ; 10 octets nuls dans le jeu (état de salle temporaire : hypothèse). */
export function parseTmpScr(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== TMP_SCR_BYTES) throw new Error(`TMP.SCR invalide : ${bytes.length} octets`);
  return bytes;
}

/** Nœud de l'arbre d'aide de `SOS.EXE` (pas lu par `AM1.EXE`). */
export interface HelpNode {
  /** Option sœur suivante (0 = fin) ; hypothèse. */
  link: number;
  /** Sous-menu (0 = texte terminal) ; hypothèse. */
  child: number;
  text: string;
}

/** `A1FSOS.SYS` : `u16 n`, `n` enregistrements `{u16 lien, u16 enfant, u16 longueur, u16 0}`, puis les textes NOT 0xFF sans terminateur ; la somme des longueurs est celle du texte. */
export function parseHelp(bytes: Uint8Array): HelpNode[] {
  const r = new BinaryReader(bytes);
  const count = r.u16();
  const heads: { link: number; child: number; length: number }[] = [];
  for (let i = 0; i < count; i++) {
    const link = r.u16();
    const child = r.u16();
    const length = r.u16();
    if (r.u16() !== 0) throw new Error("SOS invalide : mot de fin d'enregistrement non nul");
    heads.push({ link, child, length });
  }
  const total = heads.reduce((sum, h) => sum + h.length, 0);
  if (r.length - r.offset !== total) throw new Error("SOS invalide : longueurs incohérentes");
  return heads.map(({ link, child, length }) => ({ link, child, text: decodeCp437(xorBytes(r.bytesView(length), NOT_KEY)) }));
}
