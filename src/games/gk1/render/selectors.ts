/**
 * Sélecteurs des propriétés que le compositeur lit et écrit sur les objets des scripts (plans, vues), résolus une fois par
 * leur nom dans le vocabulaire 997.
 *
 * Référence : `engines/sci/engine/selector.cpp` de ScummVM (`Kernel::mapSelectors`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * La classe `View` de ce CD a deux propriétés d'échelle : `scaleType` (indice 32, qu'aucun script ne lit) et `scaleSignal`
 * (indice 54), celle que les scripts écrivent (`Prop::setScaler`) et que l'interpréteur lit.
 *
 * Un nom absent du vocabulaire donne −1 : aucune propriété ne lui répond, la lecture rend 0 (programmes de test sans classes
 * graphiques).
 */
import { type Reg, toSint16 } from "../engine/memory";
import type { SciObject, SelectorTable } from "../engine/object";

const NAMES = [
  "plane",
  "x",
  "y",
  "z",
  "view",
  "loop",
  "cel",
  "bitmap",
  "priority",
  "fixPriority",
  "scaleX",
  "scaleY",
  "maxScale",
  "scaleSignal",
  "useInsetRect",
  "inLeft",
  "inTop",
  "inRight",
  "inBottom",
  "nsLeft",
  "nsTop",
  "nsRight",
  "nsBottom",
  "back",
  "picture",
  "vanishingX",
  "vanishingY",
  "mirrored",
  "text",
  "fore",
  "skip",
  "font",
  "borderColor",
  "dimmed",
  "mode",
  "textLeft",
  "textTop",
  "textRight",
  "textBottom",
] as const;

export type GraphicsSelectors = Readonly<Record<(typeof NAMES)[number], number>>;

export function graphicsSelectors(table: SelectorTable): GraphicsSelectors {
  return Object.fromEntries(NAMES.map((name) => [name, table.find(name)])) as GraphicsSelectors;
}

/** Valeur brute d'une propriété ; 0 si l'objet ne l'a pas. */
export function readProperty(object: SciObject, selector: number): Reg {
  const index = object.propertyIndex(selector);
  return index < 0 ? 0 : object.vars[index];
}

/** Propriété lue comme un entier signé de 16 bits. */
export function readSigned(object: SciObject, selector: number): number {
  return toSint16(readProperty(object, selector));
}

/** Propriété lue comme un entier non signé de 16 bits (numéros de vues et de pics). */
export function readUnsigned(object: SciObject, selector: number): number {
  return readProperty(object, selector) & 0xffff;
}

/** Écrit une propriété sans marquer l'objet « à redessiner » (écriture de l'interpréteur, pas d'un script). */
export function writeProperty(object: SciObject, selector: number, value: number): void {
  const index = object.propertyIndex(selector);
  if (index >= 0) object.vars[index] = value & 0xffff;
}
