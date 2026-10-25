import { BinaryReader } from "../../../data/reader";
import { CM_KEY, decodeXorText } from "./text";

/**
 * Langage de commandes à jetons de trois lettres de `AM1.EXE` : 11 groupes, table en `DGROUP:05ee`
 * (certain : lue dans l'exécutable à l'offset 224 624 + 0x402...). Le moteur l'utilise de deux façons :
 * une commande tapée `/jeton arguments` (`gm_script_tokenize` `109a:0002`) et les enregistrements des
 * fichiers `A1FCM1..4.SYS` (`gm_cm_script_step` `1346:0004`). Les deux appellent
 * `gm_script_dispatch(groupe, indice du jeton, arguments, texte)` (`124c:0002`), qui saute au
 * gestionnaire du groupe.
 */
export const TOKEN_GROUPS: readonly (readonly string[])[] = [
  ["fin", "rem", "nop", "sys", "cnt", "dgs", "xit", "sec", "mse"],
  ["heu", "lum", "trf", "ral", "lmr", "wat", "rvb"],
  ["rlf", "rel", "vue"],
  ["inf", "loc", "dec", "img", "pos", "dic", "exp"],
  ["aut", "aff", "dsp", "cmd", "exe", "sub", "sal", "ecr", "msg", "peo", "ttl", "tta"],
  ["cga", "pal", "mon", "buz", "adl", "rol", "mus", "brt", "fbt", "msl", "mst"],
  ["scn", "niv", "sol", "aes", "pds", "ref", "aev"],
  [
    "adi", "add", "ado", "dli", "dld", "dlo", "zpi", "zpd", "zpo", "cpi", "cpd", "cpo",
    "cti", "ctd", "cto", "nxi", "nxd", "nxo", "lbi", "lbd", "lbo", "rgi", "rgd", "rgo",
  ],
  ["ego", "fig", "txt", "dep", "tim", "fct", "dir", "dpx", "dpy", "por", "hor", "mob", "gst", "inv"],
  ["xpy", "trj", "sor", "att", "raz", "get", "let", "mov", "chr", "sl1", "sl2", "sl3"],
  ["cle", "dsk", "isr", "sem", "nil", "rsv", "svg", "skp", "sau", "res", "pil", "lir", "mod"],
];

/** Nom du jeton `(groupe, indice)`, ou `undefined` s'il n'existe pas. */
export function tokenName(group: number, token: number): string | undefined {
  return TOKEN_GROUPS[group]?.[token];
}

/** Position `(groupe, indice)` d'un jeton de trois lettres (insensible à la casse). */
export function findToken(name: string): { group: number; token: number } | undefined {
  const wanted = name.toLowerCase();
  for (let group = 0; group < TOKEN_GROUPS.length; group++) {
    const token = TOKEN_GROUPS[group].indexOf(wanted);
    if (token !== -1) return { group, token };
  }
  return undefined;
}

/** Nombre maximal d'arguments d'une commande (`gm_cm_script_step` refuse davantage ; le moteur complète à 16 avec 0xFFFF). */
export const MAX_COMMAND_ARGS = 16;
/** Longueur maximale du texte d'un enregistrement (0x7FF). */
export const MAX_COMMAND_TEXT = 0x7ff;

/** Enregistrement d'un fichier `CM` : une commande du langage à jetons, avec son texte éventuel. */
export interface CmRecord {
  /** Groupe du jeton (0 à 10). */
  group: number;
  /** Indice du jeton dans son groupe. */
  token: number;
  /** Nom du jeton, par ex. `tta`. */
  name: string;
  /**
   * Mot 3 de l'enregistrement : nombre de rappels (tics) à attendre quand le compteur `cnt` vaut 0
   * (`parser.md` § 12.3 et § 15) ; vaut 1 dans les quatre fichiers et reste inopérant tant que `cnt != 0`.
   * Ce n'est pas un nombre de répétitions de la commande.
   */
  repeat: number;
  /** Arguments entiers (0xFFFF = « absent » dans le jeu, par ex. 65535 dans le groupe 10). */
  args: number[];
  /** Texte (CP437, XOR 0xBB dans le fichier ; ■ = saut de ligne). Vide pour la plupart des commandes. */
  text: string;
}

/**
 * `A1FCM1..4.SYS` : suite d'enregistrements `{u16 groupe, u16 jeton, u16 répétition, u16 n, u16 L,
 * n × u16 arguments, L octets de texte XOR 0xBB}` jusqu'à la fin du fichier (`gm_cm_script_step`
 * `1346:0004`, certain). `CM2` est le récit d'introduction (33 enregistrements, texte par la commande
 * du groupe 4, jeton 11), `CM4` les conseils de jeu (8 enregistrements).
 */
export function parseCm(bytes: Uint8Array): CmRecord[] {
  const r = new BinaryReader(bytes);
  const records: CmRecord[] = [];
  while (!r.isAtEnd) {
    if (r.length - r.offset < 10) throw new Error("CM invalide : enregistrement tronqué");
    const group = r.u16();
    const token = r.u16();
    const repeat = r.u16();
    const argCount = r.u16();
    const textLength = r.u16();
    if (argCount > MAX_COMMAND_ARGS || textLength > MAX_COMMAND_TEXT) throw new Error("CM invalide : tailles hors bornes");
    const name = tokenName(group, token);
    if (name === undefined) throw new Error(`CM invalide : jeton ${group}/${token} inconnu`);
    if (r.length - r.offset < 2 * argCount + textLength) throw new Error("CM invalide : enregistrement tronqué");
    const args: number[] = [];
    for (let i = 0; i < argCount; i++) args.push(r.u16());
    const text = decodeXorText(r.bytesView(textLength), CM_KEY);
    records.push({ group, token, name, repeat, args, text });
  }
  return records;
}
