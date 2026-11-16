/**
 * Saisie de texte dans une fenêtre du jeu (`EditText` : le nom d'une sauvegarde) : l'édition elle-même, sans dessin, et le
 * point d'accroche de la page pour la saisie au toucher (`docs/gk1/plan.md`, D10 et vague S2). Le dessin et la boucle sont dans
 * `kernel/edit-text.ts`.
 *
 * Référence : `engines/sci/graphics/controls32.cpp` de ScummVM (`GfxControls32::kernelEditText`, `processEditTextEvent`), GPL v3
 * ou ultérieure, lu puis réécrit.
 *
 * **Touches** (`applyKey`) : Gauche et Droite déplacent le curseur, Début et Fin le portent aux extrémités, Inser bascule le
 * mode refrappe, Suppr efface sous le curseur, Retour arrière efface à gauche, Ctrl+C vide le champ, un caractère (codes 32 à
 * 255, CP850) s'insère s'il reste de la place : `maxLength` caractères au plus, et la largeur du champ (`fits`). **La première
 * frappe d'un caractère remplace le texte proposé** ; toute touche de déplacement ou d'effacement le garde. Comme dans
 * l'original, Inser, Ctrl+C et un Retour arrière en début de champ comptent comme une modification même si le texte ne change
 * pas.
 *
 * **Au toucher** il n'y a pas de clavier tant qu'aucun champ de saisie du navigateur n'a le focus. `TextEntry` (un par machine
 * virtuelle, `textEntryOf`) prévient la page à l'ouverture et à la fermeture d'une saisie (`host`), avec le texte, la longueur
 * maximale et le rectangle du champ à l'écran (320 × 200) ; la page pose un `<input>` sur le canvas et renvoie son contenu par
 * `replaceText` à chaque modification, puis valide ou annule par les touches Entrée et Échap du jeu (`eventsOf(vm).keyDown`).
 * Le clavier physique continue d'arriver par la file d'évènements : les deux chemins coexistent.
 *
 * Écart volontaire : l'état de la saisie vit dans la trame de la fonction du noyau (des nombres), donc dans les sauvegardes ;
 * le texte venu de la page est appliqué au début de l'image suivante.
 */
import { decodeCp850, encodeCp850 } from "../../../data/cp850";
import { SciKey } from "./events";
import type { Vm } from "./vm";

/** Ctrl+C (`kSciKeyEtx` de ScummVM) : vide le champ. */
export const KEY_CLEAR = 3;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0xff;
/** Octet par lequel `encodeCp850` remplace un caractère absent de la page de code. */
const UNKNOWN_CHARACTER = 0x3f;

/** Texte en cours de saisie : un caractère par octet (CP850), comme les chaînes des scripts. */
export interface EditState {
  text: string;
  /** Position du curseur, de 0 à `text.length`. */
  cursor: number;
  /** Mode refrappe (touche Inser). */
  overwrite: boolean;
  /** Vrai tant qu'aucune touche d'édition n'a été frappée : le premier caractère remplace alors tout le texte. */
  clearOnInput: boolean;
  /** Le texte a été modifié (valeur rendue par `EditText`). */
  changed: boolean;
}

export const EditResult = { None: 0, CursorMoved: 1, TextChanged: 2 } as const;
export type EditResult = (typeof EditResult)[keyof typeof EditResult];

export function newEditState(text: string): EditState {
  return { text, cursor: 0, overwrite: false, clearOnInput: true, changed: false };
}

/** Touches qui ferment la saisie ; l'évènement reste dans la file, la fenêtre du jeu le traite ensuite. */
export function endsEntry(key: number): boolean {
  return key === SciKey.Escape || key === SciKey.Enter || key === SciKey.Up || key === SciKey.Down || key === SciKey.Tab || key === SciKey.ShiftTab;
}

/**
 * Applique une touche (`message` d'un évènement clavier) et dit ce qu'il faut redessiner. `fits(text)` : le texte tient dans
 * la largeur du champ.
 */
export function applyKey(state: EditState, key: number, maxLength: number, fits: (text: string) => boolean): EditResult {
  const { text, cursor } = state;
  const changed = (next: string, at: number): EditResult => {
    state.text = next;
    state.cursor = at;
    state.changed = true;
    return EditResult.TextChanged;
  };
  const moved = (at: number): EditResult => {
    state.clearOnInput = false;
    if (at === cursor) return EditResult.None;
    state.cursor = at;
    return EditResult.CursorMoved;
  };
  switch (key) {
    case SciKey.Left:
      return moved(Math.max(0, cursor - 1));
    case SciKey.Right:
      return moved(Math.min(text.length, cursor + 1));
    case SciKey.Home:
      return moved(0);
    case SciKey.End:
      return moved(text.length);
    case SciKey.Insert:
      state.clearOnInput = false;
      state.overwrite = !state.overwrite;
      return changed(text, cursor);
    case SciKey.Delete:
      state.clearOnInput = false;
      return cursor < text.length ? changed(text.slice(0, cursor) + text.slice(cursor + 1), cursor) : EditResult.None;
    case SciKey.Backspace:
      state.clearOnInput = false;
      return cursor > 0 ? changed(text.slice(0, cursor - 1) + text.slice(cursor), cursor - 1) : changed(text, 0);
    case KEY_CLEAR:
      return changed("", 0);
    default:
      break;
  }
  if (key < FIRST_PRINTABLE || key > LAST_PRINTABLE) return EditResult.None;
  const base = state.clearOnInput ? "" : text;
  const at = state.clearOnInput ? 0 : cursor;
  state.clearOnInput = false;
  const character = String.fromCharCode(key);
  if (state.overwrite && at < base.length) return changed(base.slice(0, at) + character + base.slice(at + 1), at + 1);
  const next = base.slice(0, at) + character + base.slice(at);
  if (next.length > maxLength || !fits(next)) {
    // Le texte proposé a été effacé par cette frappe même si elle ne tient pas : c'est une modification.
    return base === text ? EditResult.None : changed(base, at);
  }
  return changed(next, at + 1);
}

/** Remplace tout le texte (saisie venue de la page) : coupé à ce qui tient, curseur à la fin. */
export function replaceEditText(state: EditState, text: string, maxLength: number, fits: (text: string) => boolean): EditResult {
  let next = "";
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < FIRST_PRINTABLE || code > LAST_PRINTABLE) continue;
    if (next.length >= maxLength || !fits(next + character)) break;
    next += character;
  }
  state.clearOnInput = false;
  if (next === state.text && state.cursor === next.length) return EditResult.None;
  state.text = next;
  state.cursor = next.length;
  state.changed = true;
  return EditResult.TextChanged;
}

/** Ce que la page reçoit à l'ouverture d'une saisie. */
export interface TextEntryRequest {
  /** Texte proposé, en Unicode. */
  readonly text: string;
  /** Nombre maximal de caractères. */
  readonly maxLength: number;
  /** Rectangle du champ sur l'écran du jeu (320 × 200), bords droit et bas exclus. */
  readonly rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
}

/** La page, prévenue de l'ouverture et de la fermeture d'une saisie (champ `<input>` posé sur le canvas au toucher). */
export interface TextEntryHost {
  opened(request: TextEntryRequest): void;
  closed(): void;
}

/** Lien entre la saisie du jeu et la page. */
export class TextEntry {
  /** Fixé par la page ; sans lui la saisie ne passe que par le clavier. */
  host: TextEntryHost | undefined;
  private request: TextEntryRequest | undefined;
  private replacement: string | undefined;

  /** Saisie en cours, ou `undefined`. */
  get current(): TextEntryRequest | undefined {
    return this.request;
  }

  /** La page remplace le texte du champ (contenu de son `<input>`, en Unicode) ; pris en compte à l'image suivante. */
  replaceText(text: string): void {
    if (!this.request) return;
    const bytes = encodeCp850(text);
    // Un caractère que le jeu ne sait pas écrire est retiré, pas remplacé par « ? ».
    this.replacement = Array.from(text, (character, index) => (bytes[index] === UNKNOWN_CHARACTER && character !== "?" ? "" : String.fromCharCode(bytes[index]))).join("");
  }

  /** @internal Le noyau ouvre une saisie (`text` en CP850). */
  open(text: string, maxLength: number, rect: TextEntryRequest["rect"]): void {
    this.request = { text: decodeCp850(Uint8Array.from(text, (character) => character.charCodeAt(0))), maxLength, rect: { ...rect } };
    this.replacement = undefined;
    this.host?.opened(this.request);
  }

  /** @internal Texte envoyé par la page depuis la dernière image (CP850), ou `undefined`. */
  takeReplacement(): string | undefined {
    const text = this.replacement;
    this.replacement = undefined;
    return text;
  }

  /** @internal Fin de la saisie (validée, annulée, ou partie remplacée par une sauvegarde). */
  close(): void {
    if (!this.request) return;
    this.request = undefined;
    this.replacement = undefined;
    this.host?.closed();
  }
}

const instances = new WeakMap<Vm, TextEntry>();

/** Le lien de saisie de cette machine virtuelle (créé à la première demande). */
export function textEntryOf(vm: Vm): TextEntry {
  let entry = instances.get(vm);
  if (!entry) instances.set(vm, (entry = new TextEntry()));
  return entry;
}
