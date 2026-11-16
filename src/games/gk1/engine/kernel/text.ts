/**
 * Noyau, groupe « texte » : `CreateTextBitmap`, `DisposeTextBitmap`, `TextSize`, `TextWidth`.
 *
 * Référence : `engines/sci/engine/kgraphics32.cpp` de ScummVM (`kCreateTextBitmap`, `kDisposeTextBitmap`, `kTextSize32`,
 * `kTextWidth`), GPL v3 ou ultérieure, lu puis réécrit. Le travail est fait par `render/text.ts`.
 *
 * - `CreateTextBitmap(0, largeur, hauteur, objet)` : bitmap de cette taille, avec le texte de l'objet (`text`, `fore`,
 *   `back`, `skip`, `font`, `borderColor`, `dimmed`, `mode`, rectangle `textLeft` … `textBottom`, bords compris). Rend le
 *   bitmap, que le script range dans la propriété `bitmap` de l'objet avant `AddScreenItem`.
 * - `CreateTextBitmap(1, objet)` : bitmap de la taille du cel `view` / `loop` / `cel` de l'objet, ce cel dessous.
 * - `DisposeTextBitmap(bitmap)` : libère le bitmap.
 * - `TextSize(tableau, texte, police[, largeur maximale[, échelle]])` : écrit dans le tableau `0, 0, largeur − 1,
 *   hauteur − 1` ; l'accumulateur ne change pas.
 * - `TextWidth(texte, police)` : largeur du texte sur une ligne.
 *
 * Écarts volontaires : une sous-fonction inconnue, une vue absente ou un texte demandé dans la couleur transparente rendent 0
 * avec un avertissement (ScummVM s'arrête pour les deux derniers).
 */
import { frameoutOf } from "../../render/frameout";
import { TextBitmapOp } from "../../render/ids";
import { makeRect } from "../../render/rect";
import { readProperty, readSigned, readUnsigned } from "../../render/selectors";
import type { TextBitmapStyle } from "../../render/text";
import { fromInt, NULL_REG, type Reg, SciError, toSint16 } from "../memory";
import type { SciObject } from "../object";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
const BYTE_MASK = 0xff;
/** Cases du tableau que `TextSize` remplit. */
const RECT_CELLS = 4;

/** Texte et mise en forme d'un contrôle des scripts (`DText`, `DEdit`…), tels que `CreateTextBitmap` les lit dans l'objet. */
export function textStyleOf(vm: Vm, object: SciObject): TextBitmapStyle {
  const selectors = frameoutOf(vm).selectors;
  return {
    text: vm.memory.getString(readProperty(object, selectors.text)),
    foreColor: readProperty(object, selectors.fore) & BYTE_MASK,
    backColor: readProperty(object, selectors.back) & BYTE_MASK,
    skipColor: readProperty(object, selectors.skip) & BYTE_MASK,
    font: readUnsigned(object, selectors.font),
    borderColor: readSigned(object, selectors.borderColor),
    dimmed: readProperty(object, selectors.dimmed) !== 0,
    textRect: makeRect(
      readSigned(object, selectors.textLeft),
      readSigned(object, selectors.textTop),
      readSigned(object, selectors.textRight) + 1,
      readSigned(object, selectors.textBottom) + 1,
    ),
  };
}

function createTextBitmap(vm: Vm, argv: Uint32Array): Reg {
  const subop = argv[0];
  if (subop !== TextBitmapOp.Sized && subop !== TextBitmapOp.FromView) {
    vm.warn(`CreateTextBitmap : sous-fonction ${subop} inconnue`);
    return NULL_REG;
  }
  const frameout = frameoutOf(vm);
  const selectors = frameout.selectors;
  const reg = subop === TextBitmapOp.Sized ? argv[3] : argv[1];
  const object = vm.memory.getObject(reg);
  if (!object) throw new SciError("CreateTextBitmap : l'argument n'est pas un objet");
  const style = textStyleOf(vm, object);
  if (subop === TextBitmapOp.Sized) {
    return vm.memory.bitmaps.allocate(frameout.text.createBitmap(argv[1] & WORD_MASK, argv[2] & WORD_MASK, readSigned(object, selectors.mode), style));
  }
  const view = readUnsigned(object, selectors.view);
  const cel = frameout.cels.viewCel(view, readUnsigned(object, selectors.loop), readUnsigned(object, selectors.cel));
  if (!cel) {
    vm.warn(`CreateTextBitmap : vue ${view} absente ou vide`);
    return NULL_REG;
  }
  const bitmap = frameout.text.createBitmapOnCel(cel, style);
  if (!bitmap) vm.warn("CreateTextBitmap : texte dans la couleur transparente non géré");
  return bitmap ? vm.memory.bitmaps.allocate(bitmap) : NULL_REG;
}

function disposeTextBitmap(vm: Vm, argv: Uint32Array): Reg {
  vm.memory.bitmaps.release(argv[0]);
  return vm.acc;
}

function textSize(vm: Vm, argv: Uint32Array): Reg {
  const array = vm.memory.array(argv[0]);
  const maxWidth = argv.length > 3 ? toSint16(argv[3]) : 0;
  const doScaling = argv.length > 4 ? argv[4] !== 0 : true;
  const rect = frameoutOf(vm).text.textSize(vm.memory.getString(argv[1]), argv[2] & WORD_MASK, maxWidth, doScaling);
  array.resize(RECT_CELLS);
  [rect.left, rect.top, rect.right - 1, rect.bottom - 1].forEach((value, index) => array.set(index, fromInt(value)));
  return vm.acc;
}

function textWidth(vm: Vm, argv: Uint32Array): Reg {
  return fromInt(frameoutOf(vm).text.stringWidth(vm.memory.getString(argv[0]), argv[1] & WORD_MASK));
}

export function registerTextKernel(kernel: Kernel): void {
  kernel.register("CreateTextBitmap", createTextBitmap).register("DisposeTextBitmap", disposeTextBitmap).register("TextSize", textSize).register("TextWidth", textWidth);
}
