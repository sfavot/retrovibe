import { CINEMATICS } from "../../cinematics";
import type { GameScript } from "../script";
import { assembleScript } from "./assemble";
import { chapter1 } from "./chapter-1";
import { chapter2 } from "./chapter-2";
import { chapter3 } from "./chapter-3";
import { chapter4 } from "./chapter-4";
import { chapter5 } from "./chapter-5";
import { chapter6 } from "./chapter-6";

/**
 * Logique propre au jeu, assemblée pour le moteur (`DrasculaEngineOptions.script`) : les six chapitres (`chapter-N/index.ts`,
 * gestionnaires `room_N`, `update_N` / `update_N_pre`, cinématiques de pièces et points d'extension de `engine/script.ts`) et les
 * cinématiques communes de `cinematics/`. Ce fichier ne contient que l'assemblage : ajouter ou compléter un chapitre ne le modifie
 * pas (`docs/drascula/rooms.md`).
 */
export const CHAPTERS = { 1: chapter1, 2: chapter2, 3: chapter3, 4: chapter4, 5: chapter5, 6: chapter6 } as const;

export const drasculaScript: GameScript = assembleScript(CHAPTERS, { animations: CINEMATICS });
