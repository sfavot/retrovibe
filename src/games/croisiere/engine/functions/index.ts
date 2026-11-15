/**
 * Table des fonctions natives (`function.cpp::opcodeTablePtr` de ScummVM, GPL v3+, release 2026.4.0) : 126 numéros (0x00..0x7D),
 * dont 5 vides (0x00, 0x0F, 0x12, 0x55 `MergeMsg`, 0x69 `DeletePreload`) : l'appel avertit et empile 0.
 *
 * Les fonctions sont rangées par groupe de la vague F, un fichier par groupe pour travailler en parallèle :
 * - `core.ts` (vague C) : overlays, processus, chaînes, aléatoire ;
 * - `f1-objects.ts` : objets, états, cellules, base de fichiers ;
 * - `f2-actors.ts` : acteurs, marche, zones de marche (CT), zoom ;
 * - `f3-graphics.ts` : fonds, palettes, incrustations, messages, menus et dialogue ;
 * - `f4-system.ts` : son, souris et utilisateur, protection, divers.
 * Une fonction pas encore portée lève `NotImplemented(nom)`.
 */
import { NATIVE_NAMES } from "../../data/disasm";
import { CORE } from "./core";
import { F1_OBJECTS } from "./f1-objects";
import { F2_ACTORS } from "./f2-actors";
import { F3_GRAPHICS } from "./f3-graphics";
import { F4_SYSTEM } from "./f4-system";
import type { Native } from "./types";

/** Fonctions natives par numéro ; `undefined` pour les entrées vides de ScummVM. */
export const NATIVES: ReadonlyArray<Native | undefined> = (() => {
  const table: (Native | undefined)[] = new Array(NATIVE_NAMES.length).fill(undefined);
  for (const group of [CORE, F1_OBJECTS, F2_ACTORS, F3_GRAPHICS, F4_SYSTEM]) {
    for (const [key, native] of Object.entries(group)) {
      const n = Number(key);
      if (table[n]) throw new Error(`Fonction native 0x${n.toString(16)} définie deux fois`);
      if (NATIVE_NAMES[n] !== native.name) throw new Error(`Fonction native 0x${n.toString(16)} : ${native.name} au lieu de ${NATIVE_NAMES[n]}`);
      table[n] = native;
    }
  }
  return table;
})();

/** Numéros vides dans ScummVM. */
export const EMPTY_NATIVES: readonly number[] = [0x00, 0x0f, 0x12, 0x55, 0x69];
