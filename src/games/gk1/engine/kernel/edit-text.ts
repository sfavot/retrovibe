/**
 * Noyau : `EditText`, la saisie d'un texte au clavier dans un champ d'une fenêtre du jeu (le nom d'une sauvegarde). L'édition
 * est dans `engine/text-entry.ts` ; ici le dessin du champ, la boucle et le lien avec la page (`docs/gk1/plan.md`, D10).
 *
 * Référence : `engines/sci/graphics/controls32.cpp` (`GfxControls32::kernelEditText`, `drawCursor`, `eraseCursor`,
 * `flashCursor`) et `engines/sci/engine/kgraphics32.cpp` (`kEditText`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * `EditText(contrôle)` est **modale** : elle ne revient qu'à la fin de la saisie, avec 1 si le texte a changé (il est alors
 * écrit, sans ses blancs de bord, dans le tableau de la propriété `text`), sinon 0. `DEdit::hilite` (script 64914) retire
 * d'abord l'élément d'écran du contrôle et met sa propriété `bitmap` à zéro, puis redessine le contrôle selon la réponse.
 *
 * - **Fin de la saisie** : Entrée, Échap, Haut, Bas, Tab, Maj+Tab, ou un appui de souris hors du champ. Cet évènement
 *   **reste dans la file** : la fenêtre du jeu le traite (Entrée valide la sauvegarde). Les autres évènements sont consommés.
 * - **Curseur** : un trait d'un pixel sous le caractère (un bloc en mode refrappe), dessiné en inversant les couleurs
 *   d'encre et de fond, qui clignote toutes les 30 images et se rallume à chaque frappe.
 * - **Longueur** : la propriété `width` du contrôle est le nombre maximal de caractères ; le texte doit aussi tenir dans le
 *   rectangle de texte.
 * - Chaque tour compose une image et rend la main (`FrameOut`) : le reste de l'écran continue d'être affiché, pas animé.
 *
 * Écarts volontaires :
 * - ScummVM crée un plan à part au-dessus de tout, avec son propre bitmap (largeur : `width` fois celle d'un « M »). Ici le
 *   champ est **l'élément d'écran du contrôle lui-même**, dans son plan, avec un bitmap fait comme `DText::draw` le fait
 *   (mêmes dimensions et même mise en forme que le contrôle au repos) : la propriété `bitmap` le désigne le temps de la saisie
 *   et retrouve sa valeur à la fin. Rien ne vit hors de la mémoire des scripts : **l'état de la saisie est dans la trame**
 *   de la fonction (objet, bitmap, curseur, drapeaux, texte), donc dans les sauvegardes ;
 * - le bitmap est redessiné en entier à chaque changement, au lieu d'effacer et de retracer le curseur ;
 * - pas de titre de champ (aucun contrôle du jeu n'en a), ni de `FrameOut` final commandé par la propriété `frameOut`.
 */
import { frameoutOf } from "../../render/frameout";
import { TEXT_NO_BORDER } from "../../render/ids";
import { clipRect, makeRect, type Rect, rectContainsPoint } from "../../render/rect";
import { readProperty, readSigned, readUnsigned } from "../../render/selectors";
import { EventType, eventsOf } from "../events";
import { NULL_REG, type Reg, type SciBitmap, SciError } from "../memory";
import type { SciObject } from "../object";
import { applyKey, EditResult, type EditState, endsEntry, replaceEditText, textEntryOf } from "../text-entry";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";
import { SUSPEND_FRAME_OUT } from "./planes";
import { textStyleOf } from "./text";

const EDIT_TEXT = "EditText";
/** Images entre deux clignotements du curseur. */
const FLASH_TICKS = 30;
const WORD_MASK = 0xffff;
const HALF_WORD = 0x8000;
const NO_VIEW = -1;
const SPACE = " ";
/** Masque de `GetEvent` : tous les types d'évènements. */
const ALL_EVENTS = 0x7fff;

/** Cases de l'état de la trame ; le texte (un code par case) suit. */
const Slot = { Object: 0, Bitmap: 1, SavedBitmap: 2, Cursor: 3, Flags: 4, NextFlash: 5, MaxLength: 6, Text: 7 } as const;
const Flag = { Overwrite: 1, ClearOnInput: 2, Changed: 4, CursorDrawn: 8 } as const;

function controlOf(vm: Vm, reg: Reg): SciObject {
  const control = vm.memory.getObject(reg);
  if (!control) throw new SciError("EditText : l'argument n'est pas un objet");
  return control;
}

/** Bitmap du contrôle portant `text`, fait comme `DText::draw` : sur le cel de sa vue s'il en a une, sinon aux dimensions de son rectangle. */
function fieldBitmap(vm: Vm, control: SciObject, text: string): SciBitmap | undefined {
  const frameout = frameoutOf(vm);
  const selectors = frameout.selectors;
  const style = { ...textStyleOf(vm, control), text };
  if (readSigned(control, selectors.view) !== NO_VIEW) {
    const cel = frameout.cels.viewCel(readUnsigned(control, selectors.view), readUnsigned(control, selectors.loop), readUnsigned(control, selectors.cel));
    return cel && frameout.text.createBitmapOnCel(cel, style);
  }
  const width = readSigned(control, selectors.nsRight) - readSigned(control, selectors.nsLeft) + 1;
  const height = readSigned(control, selectors.nsBottom) - readSigned(control, selectors.nsTop) + 1;
  return width > 0 && height > 0 ? frameout.text.createBitmap(width, height, readSigned(control, selectors.mode), style) : undefined;
}

/** Rectangle du champ à l'écran. */
function fieldRect(vm: Vm, control: SciObject, bitmap: SciBitmap): Rect {
  const frameout = frameoutOf(vm);
  const selectors = frameout.selectors;
  const plane = frameout.findPlane(readProperty(control, selectors.plane));
  const left = readSigned(control, selectors.x) + (plane?.gameRect.left ?? 0);
  const top = readSigned(control, selectors.y) + (plane?.gameRect.top ?? 0);
  return makeRect(left, top, left + bitmap.width, top + bitmap.height);
}

function setBitmapProperty(vm: Vm, control: SciObject, bitmap: Reg): void {
  const index = control.propertyIndex(frameoutOf(vm).selectors.bitmap);
  if (index < 0) throw new SciError("EditText : le contrôle n'a pas de propriété bitmap");
  control.setProperty(index, bitmap);
}

function unpack(state: readonly number[]): EditState {
  const flags = state[Slot.Flags];
  return {
    text: String.fromCharCode(...state.slice(Slot.Text)),
    cursor: state[Slot.Cursor],
    overwrite: (flags & Flag.Overwrite) !== 0,
    clearOnInput: (flags & Flag.ClearOnInput) !== 0,
    changed: (flags & Flag.Changed) !== 0,
  };
}

function pack(state: number[], edit: EditState, cursorDrawn: boolean): void {
  state[Slot.Cursor] = edit.cursor;
  state[Slot.Flags] = (edit.overwrite ? Flag.Overwrite : 0) | (edit.clearOnInput ? Flag.ClearOnInput : 0) | (edit.changed ? Flag.Changed : 0) | (cursorDrawn ? Flag.CursorDrawn : 0);
  state.length = Slot.Text;
  for (let i = 0; i < edit.text.length; i++) state.push(edit.text.charCodeAt(i));
}

/** Redessine le champ dans son bitmap (même taille : les pixels sont remplacés sur place), curseur compris s'il est allumé. */
function drawField(vm: Vm, control: SciObject, bitmap: SciBitmap, edit: EditState, cursorDrawn: boolean): void {
  const fresh = fieldBitmap(vm, control, edit.text);
  if (!fresh || fresh.pixels.length !== bitmap.pixels.length) return;
  bitmap.pixels.set(fresh.pixels);
  if (!cursorDrawn) return;
  const frameout = frameoutOf(vm);
  const style = textStyleOf(vm, control);
  const lineHeight = frameout.text.lineHeight(style.font);
  const border = style.borderColor === TEXT_NO_BORDER ? 0 : 1;
  const textRect = clipRect(style.textRect, makeRect(border, border, bitmap.width - border, bitmap.height - border));
  const left = textRect.left + frameout.text.stringWidth(edit.text.slice(0, edit.cursor), style.font);
  const width = Math.max(1, frameout.text.stringWidth(edit.cursor < edit.text.length ? edit.text[edit.cursor] : SPACE, style.font));
  const top = edit.overwrite ? textRect.top : textRect.top + lineHeight - 1;
  const cursor = clipRect(makeRect(left, top, left + width, textRect.top + lineHeight), textRect);
  for (let y = cursor.top; y < cursor.bottom; y++) {
    for (let x = cursor.left; x < cursor.right; x++) {
      const at = y * bitmap.width + x;
      if (bitmap.pixels[at] === style.foreColor) bitmap.pixels[at] = style.backColor;
      else if (bitmap.pixels[at] === style.backColor || bitmap.pixels[at] === style.skipColor) bitmap.pixels[at] = style.foreColor;
    }
  }
}

function editText(vm: Vm, argv: Uint32Array): Reg {
  const frameout = frameoutOf(vm);
  const control = controlOf(vm, argv[0]);
  const text = textStyleOf(vm, control).text;
  const drawn = fieldBitmap(vm, control, text);
  if (!drawn) {
    vm.warn(`EditText : champ de ${vm.nameOf(argv[0])} sans dimensions`);
    return NULL_REG;
  }
  const bitmap = vm.memory.bitmaps.allocate(drawn);
  const saved = readProperty(control, frameout.selectors.bitmap);
  setBitmapProperty(vm, control, bitmap);
  frameout.addScreenItem(argv[0]);
  const state: number[] = [argv[0], bitmap, saved, 0, Flag.ClearOnInput | Flag.CursorDrawn, (vm.ticks + FLASH_TICKS) & WORD_MASK, Math.max(0, readSigned(control, vm.selectors.find("width")))];
  for (let i = 0; i < text.length; i++) state.push(text.charCodeAt(i));
  drawField(vm, control, drawn, unpack(state), true);
  return vm.beginNative(EDIT_TEXT, state);
}

function finish(vm: Vm, state: number[], control: SciObject, edit: EditState): boolean {
  frameoutOf(vm).deleteScreenItem(state[Slot.Object]);
  vm.memory.bitmaps.release(state[Slot.Bitmap]);
  setBitmapProperty(vm, control, state[Slot.SavedBitmap]);
  if (edit.changed) vm.memory.setString(readProperty(control, frameoutOf(vm).selectors.text), edit.text.trim());
  textEntryOf(vm).close();
  vm.acc = edit.changed ? 1 : 0;
  return true;
}

/** Un tour de la boucle de saisie : évènements en attente, dessin, puis une image. État : voir `Slot`. */
function editTextStep(vm: Vm, state: number[]): boolean {
  const frameout = frameoutOf(vm);
  const events = eventsOf(vm);
  const entry = textEntryOf(vm);
  const control = controlOf(vm, state[Slot.Object]);
  const bitmap = vm.memory.bitmaps.get(state[Slot.Bitmap]);
  if (!bitmap) throw new SciError("EditText : le bitmap du champ a disparu");
  const edit = unpack(state);
  const maxLength = state[Slot.MaxLength];
  const style = textStyleOf(vm, control);
  const room = style.textRect.right - style.textRect.left;
  const fits = (text: string): boolean => frameout.text.stringWidth(text, style.font) < room;
  const rect = fieldRect(vm, control, bitmap);
  // Aussi après la reprise d'une sauvegarde prise pendant la saisie : la page est prévenue de nouveau.
  if (!entry.current) entry.open(edit.text, maxLength, rect);

  let result: EditResult = EditResult.None;
  const replacement = entry.takeReplacement();
  if (replacement !== undefined) result = Math.max(result, replaceEditText(edit, replacement, maxLength, fits)) as EditResult;
  for (;;) {
    const event = events.next(ALL_EVENTS | EventType.Peek);
    if (event.type === EventType.None) break;
    if (event.type === EventType.KeyDown && endsEntry(event.message)) return finish(vm, state, control, edit);
    if (event.type === EventType.MousePress && !rectContainsPoint(rect, event.x, event.y)) return finish(vm, state, control, edit);
    events.next(ALL_EVENTS);
    if (event.type === EventType.KeyDown) result = Math.max(result, applyKey(edit, event.message, maxLength, fits)) as EditResult;
  }

  let cursorDrawn = (state[Slot.Flags] & Flag.CursorDrawn) !== 0;
  const flashDue = ((vm.ticks - state[Slot.NextFlash]) & WORD_MASK) < HALF_WORD && ((vm.ticks - state[Slot.NextFlash]) & WORD_MASK) > 0;
  if (result !== EditResult.None || flashDue) {
    cursorDrawn = result !== EditResult.None || !cursorDrawn;
    state[Slot.NextFlash] = (vm.ticks + FLASH_TICKS) & WORD_MASK;
    drawField(vm, control, bitmap, edit, cursorDrawn);
  }
  pack(state, edit, cursorDrawn);
  frameout.transitions.processScrolls();
  frameout.frameOut();
  vm.suspend(SUSPEND_FRAME_OUT);
  return false;
}

export function registerEditTextKernel(kernel: Kernel): void {
  kernel.register(EDIT_TEXT, editText).continuation(EDIT_TEXT, editTextStep);
}
