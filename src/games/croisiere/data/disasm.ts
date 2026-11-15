/**
 * Désassembleur du bytecode des overlays de Croisière pour un cadavre : outil de test et de débogage (pas utilisé par la VM).
 *
 * Référence : `engines/cruise/script.cpp` (`executeScripts`, `opcodeType0`..`opcodeType11` : octet d'opcode = `type << 3 | sous-type`,
 * type de 1 à 12 ; `getByteFromScript` / `getShortFromScript`), `decompiler.cpp` (`decompOpcodeType*`, longueurs d'opérandes) et
 * `function.cpp::opcodeTablePtr` (noms des fonctions natives 0x01..0x7D) de ScummVM (GPL v3+, release 2026.4.0). On lit, puis on réécrit.
 *
 * Types d'opcode (numérotation de `opcodeTypeTable`, entre parenthèses le `opcodeTypeN` de ScummVM) :
 *  1 (0) charge : sous-type 0 = constante i16 ; 1 = variable ; 5 = variable indexée par `saveOpcodeVar` ; 2 = paramètre d'objet.
 *  2 (1) range : 0 = rien ; 1, 5 = variable ; 2 = paramètre d'objet ; 4 = mémorise l'index (`saveOpcodeVar`).
 *  3 (2) adresse : 1, 5 = empile un pointeur ; les autres sous-types ne font rien.
 *  4 (3) arithmétique : 0 + 1 / 2 - 3 * 4 % 5 | 6 & 7 |.   5 (4) comparaison : 0 != 1 == 2 < 3 <= 4 > 5 >=.
 *  6 (5) saut relatif i16 : 0 si non nul / 1 si nul / 2 > / 3 >= / 4 < / 5 <= / 6 jamais / 7 toujours (sur le résultat de l'opcode 7).
 *  7 (6) dépile et pose le registre de condition.   8 (7) échange les deux sommets de pile.
 *  9 (8) appel d'une fonction native (1 octet : numéro).   10 (9) arrête le script.   11 (10) ne fait rien.   12 (11) rend la main.
 * Les variables (types 1, 2, 3 sauf objets) portent 4 octets : octet « type » (bits 0-2 = espace mémoire : 1 BSS du processus,
 * 2 chaînes, 5 BSS de l'overlay, 6 données initiales ; bits 3-4 = taille : 1 = mot, 2 = octet), octet d'overlay (0 = courant),
 * décalage i16. Un paramètre d'objet porte aussi 4 octets : mode, overlay, index i16.
 *
 * Écart volontaire : ScummVM s'arrête avec `error()` sur un sous-type inconnu ; ici l'instruction est marquée `unknown`.
 */
import type { ScriptBlock } from "./overlay";

/**
 * Noms des fonctions natives, indexés par numéro (`opcodeTablePtr`). `unused0F`, `unused12`, `MergeMsg` (0x55) et
 * `DeletePreload` (0x69) sont des entrées vides dans ScummVM : l'appel avertit puis empile 0, sans interrompre le script.
 * L'entrée 0 n'a pas de nom : le moteur renvoie une erreur (-21).
 */
export const NATIVE_NAMES: ReadonlyArray<string | null> = [
  null, "FadeIn", "FadeOut", "LoadBackground", "LoadAbs", "AddCell", "AddProc", "InitializeState",
  "RemoveCell", "FreeCell", "RemoveProc", "RemoveFrame", "LoadOverlay", "SetColor", "PlayFX", "unused0F",
  "FreeOverlay", "FindOverlay", "unused12", "AddMessage", "RemoveMessage", "UserWait", "FreezeCell", "LoadCt",
  "AddAnimation", "RemoveAnimation", "SetZoom", "SetObjectAtNode", "SetNodeState", "SetNodeColor", "TrackAnim", "GetNodeX",
  "GetNodeY", "EndAnim", "GetZoom", "GetStep", "SetStringColors", "XClick", "YClick", "GetPixel",
  "UserOn", "FreeCT", "FindObject", "FindProc", "WriteObject", "ReadObject", "RemoveOverlay", "AddBackgroundIncrust",
  "RemoveBackgroundIncrust", "UnmergeBackgroundIncrust", "freeBackgroundInscrustList", "DialogOn", "DialogOff", "UserDelay", "ThemeReset", "Narrator",
  "RemoveBackground", "SetActiveBackground", "CTOn", "CTOff", "Random", "LoadSong", "FadeSong", "PlaySong",
  "FreeSong", "FrameExist", "SetVolume", "SongExist", "TrackPos", "StopSong", "RestoreSong", "SongSize",
  "SetPattern", "SongLoop", "SongPlayed", "LinkObjects", "UserClick", "XMenuItem", "YMenuItem", "Menu",
  "AutoControl", "MouseMove", "MouseEnd", "MsgExist", "SetFont", "MergeMsg", "Display", "GetMouseX",
  "GetMouseY", "GetMouseButton", "FindSet", "regenerateBackgroundIncrust", "BgName", "LoopFX", "StopFX", "FreqFX",
  "FreezeAni", "FindMsg", "FreezeParent", "UnfreezeParent", "Exec", "AutoCell", "Sizeof", "Preload",
  "FreePreload", "DeletePreload", "VBL", "LoadFrame", "FreezeOverlay", "Strcpy", "Strcat", "Itoa",
  "comment", "ComputeLine", "FindSymbol", "SetXDial", "GetlowMemory", "AniDir", "Protect", "ClearScreen",
  "Inventory", "UserMenu", "GetRingWord", "Sec", "ProtectionFlag", "KillMenu",
];

/** Dernier numéro de fonction native défini (0x7D). */
export const LAST_NATIVE = NATIVE_NAMES.length - 1;

export type OperandKind = "imm" | "var" | "obj" | "target" | "native";

export interface Operand {
  kind: OperandKind;
  /** `imm` : constante ; `var` : décalage ; `obj` : index d'objet ; `target` : adresse absolue ; `native` : numéro de fonction. */
  value: number;
  /** `var` : octet « type » brut (espace mémoire dans les bits 0-2, taille dans les bits 3-4) ; `obj` : mode. */
  flags?: number;
  /** `var` et `obj` : numéro d'overlay (0 = overlay courant). */
  overlay?: number;
}

export interface Instruction {
  /** Position dans le bloc. */
  offset: number;
  /** Octets occupés (opcode compris). */
  length: number;
  /** Octet d'opcode. */
  byte: number;
  /** Type d'opcode (`byte >> 3`). */
  type: number;
  /** Sous-type (`byte & 7`). */
  sub: number;
  mnemonic: string;
  operand?: Operand;
  /** Vrai si le type ou le sous-type n'est pas géré par le moteur. */
  unknown: boolean;
  /** Ligne lisible. */
  text: string;
}

const SPACE_NAMES: Record<number, string> = { 1: "bss", 2: "str", 5: "ovlbss", 6: "init" };
const TEST_NAMES = ["ne", "eq", "lt", "le", "gt", "ge"];
const MATH_NAMES = ["add", "div", "sub", "mul", "mod", "or", "and", "or"];
const BRANCH_NAMES = ["jnz", "jz", "jgt", "jge", "jlt", "jle", "jnever", "jmp"];

function hex(v: number, width: number): string {
  return v.toString(16).padStart(width, "0");
}

function varText(op: Operand, indexed: boolean): string {
  const space = op.flags! & 7;
  const size = (op.flags! >> 3) & 3;
  const sizeName = size === 1 ? "w" : size === 2 ? "b" : `s${size}`;
  const where = `${SPACE_NAMES[space] ?? `space${space}`}${op.overlay ? `@ovl${op.overlay}` : ""}`;
  const off = op.value >= 0 ? `+${op.value}` : `${op.value}`;
  return `${sizeName} ${where}[${off}${indexed ? "+idx" : ""}]`;
}

/**
 * Décode l'instruction à `offset` ; ne lit pas au-delà de `end`. Si l'instruction dépasse `end`, elle est marquée `unknown`
 * avec les octets restants (`length` = jusqu'à `end`).
 */
export function decodeInstruction(code: Uint8Array, offset: number, end = code.length): Instruction {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const byte = code[offset]!;
  const type = byte >> 3;
  const sub = byte & 7;
  let length = 1;
  let mnemonic = `op${type}.${sub}`;
  let operand: Operand | undefined;
  let unknown = false;
  let operandText = "";

  const memOperand = (): Operand => ({ kind: "var", flags: code[offset + 1]!, overlay: code[offset + 2]!, value: view.getInt16(offset + 3) });
  const objOperand = (): Operand => ({ kind: "obj", flags: code[offset + 1]!, overlay: code[offset + 2]!, value: view.getInt16(offset + 3) });
  const need = (n: number): boolean => {
    if (offset + 1 + n > end) {
      unknown = true;
      return false;
    }
    length = 1 + n;
    return true;
  };

  switch (type) {
    case 1: // charge
      if (sub === 0) {
        mnemonic = "push";
        if (need(2)) operand = { kind: "imm", value: view.getInt16(offset + 1) };
      } else if (sub === 1 || sub === 5) {
        mnemonic = sub === 5 ? "load.idx" : "load";
        if (need(4)) operand = memOperand();
      } else if (sub === 2) {
        mnemonic = "loadobj";
        if (need(4)) operand = objOperand();
      } else unknown = true;
      break;
    case 2: // range
      if (sub === 0) mnemonic = "store.none";
      else if (sub === 4) mnemonic = "setidx";
      else if (sub === 1 || sub === 5) {
        mnemonic = sub === 5 ? "store.idx" : "store";
        if (need(4)) operand = memOperand();
      } else if (sub === 2) {
        mnemonic = "storeobj";
        if (need(4)) operand = objOperand();
      } else unknown = true;
      break;
    case 3: // adresse
      if (sub === 1 || sub === 5) {
        mnemonic = sub === 5 ? "addr.idx" : "addr";
        if (need(4)) operand = memOperand();
      } else mnemonic = "addr.nop";
      break;
    case 4:
      mnemonic = MATH_NAMES[sub]!;
      break;
    case 5:
      if (sub < 6) mnemonic = `test.${TEST_NAMES[sub]}`;
      else {
        mnemonic = "test.nop";
      }
      break;
    case 6:
      mnemonic = BRANCH_NAMES[sub]!;
      if (need(2)) operand = { kind: "target", value: offset + 1 + view.getInt16(offset + 1) };
      break;
    case 7:
      mnemonic = "ccr";
      break;
    case 8:
      mnemonic = "swap";
      break;
    case 9: {
      mnemonic = "call";
      if (need(1)) {
        const n = code[offset + 1]!;
        operand = { kind: "native", value: n };
        // Seul 0 interrompt le script (erreur -21) ; un numéro hors table avertit et empile 0, comme les entrées vides.
        if (n === 0) unknown = true;
      }
      break;
    }
    case 10:
      mnemonic = "stop";
      break;
    case 11:
      mnemonic = "nop";
      break;
    case 12:
      mnemonic = "end";
      break;
    default:
      unknown = true;
  }

  if (operand) {
    switch (operand.kind) {
      case "imm":
        operandText = String(operand.value);
        break;
      case "var":
        operandText = varText(operand, sub === 5);
        break;
      case "obj":
        operandText = `mode${operand.flags}.ovl${operand.overlay}.obj${operand.value}`;
        break;
      case "target":
        operandText = `L${hex(operand.value, 4)}`;
        break;
      case "native":
        operandText = NATIVE_NAMES[operand.value] ?? `native${operand.value}`;
        break;
    }
  }
  const text = `${hex(offset, 4)}: ${mnemonic}${operandText ? ` ${operandText}` : ""}${unknown ? "  ; INCONNU" : ""}`;
  return { offset, length, byte, type, sub, mnemonic, operand, unknown, text };
}

/** Désassemble `code[0..end)` ; s'arrête à la première instruction inconnue (incluse). */
export function disassemble(code: Uint8Array, end = code.length): Instruction[] {
  const out: Instruction[] = [];
  let pos = 0;
  while (pos < end) {
    const instruction = decodeInstruction(code, pos, end);
    out.push(instruction);
    if (instruction.unknown) break;
    pos += instruction.length;
  }
  return out;
}

/**
 * Fin de la zone de bytecode d'un script : le plus petit décalage de section non nul (chaînes, imports, `subData2`,
 * noms d'import, `subData5`), sinon la taille du bloc. Cette borne est une déduction vérifiée sur les 82 overlays (le dernier
 * opcode finit exactement là), pas une donnée du fichier.
 */
export function codeEnd(block: ScriptBlock): number {
  const offsets = [block.offsetToSubData3, block.offsetToImportData, block.offsetToSubData2, block.offsetToImportName, block.offsetToSubData5]
    .filter((v) => v > 0 && v <= block.sizeOfData);
  return offsets.length > 0 ? Math.min(...offsets) : block.sizeOfData;
}

/**
 * Désassemble la zone de bytecode d'un script. Tous les scripts finissent par `stop` (ou `end`) ; la zone est parfois suivie d'un
 * octet de bourrage de valeur quelconque (alignement pair), qui peut se décoder comme n'importe quelle instruction : un dernier
 * octet isolé après un `stop`/`end` est écarté du résultat.
 */
export function disassembleScript(block: ScriptBlock): Instruction[] {
  const end = codeEnd(block);
  const out = disassemble(block.data, end);
  const last = out[out.length - 1];
  const prev = out[out.length - 2];
  if (last && last.offset === end - 1 && prev && (prev.mnemonic === "stop" || prev.mnemonic === "end")) out.pop();
  return out;
}

/** Texte du désassemblage, une instruction par ligne. */
export function formatScript(block: ScriptBlock): string {
  return disassembleScript(block).map((i) => i.text).join("\n");
}
