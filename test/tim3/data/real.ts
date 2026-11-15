import { ResourceIndex } from "../../../src/games/tim3/data/volume";
import { originalFiles } from "../../support/original";

/** Fichiers réels de TIM3 ; les tests qui en dépendent sont ignorés si `original/tim3` est absent. */
export const original = originalFiles("tim3", "RESOURCE.MAP");

let base: ResourceIndex | undefined;
let french: ResourceIndex | undefined;
let frenchOnly: ResourceIndex | undefined;

/** Ressources anglaises (RESOURCE.001 et .002). */
export function baseIndex(): ResourceIndex {
  base ??= new ResourceIndex().add(original.read("RESOURCE.MAP"), (name) => original.read(name));
  return base;
}

/** Anglais avec `FRENCH.DAT` superposé. */
export function frenchIndex(): ResourceIndex {
  french ??= new ResourceIndex().add(original.read("RESOURCE.MAP"), (name) => original.read(name)).overlay(original.read("FRENCH.DAT"), "FRENCH.DAT");
  return french;
}

/** Les seules ressources de `FRENCH.DAT`. */
export function frenchPackIndex(): ResourceIndex {
  frenchOnly ??= new ResourceIndex().overlay(original.read("FRENCH.DAT"), "FRENCH.DAT");
  return frenchOnly;
}

/** Noms d'un index ayant l'extension donnée (sans le point, insensible à la casse). */
export function namesWithExtension(index: ResourceIndex, extension: string): string[] {
  const suffix = `.${extension.toUpperCase()}`;
  return index.names().filter((n) => n.toUpperCase().endsWith(suffix));
}
