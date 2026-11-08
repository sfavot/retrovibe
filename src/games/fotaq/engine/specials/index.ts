import type { GameScript } from "../script";
import { assembleSpecials } from "./assemble";
import { group1 } from "./group-1";
import { group2 } from "./group-2";
import { group3 } from "./group-3";
import { group4 } from "./group-4";
import { group5 } from "./group-5";
import { group6 } from "./group-6";

/**
 * Logique codée en dur de *Flight of the Amazon Queen* (vague L), assemblée pour le moteur (`FotaqEngineOptions.script`) : un dossier
 * par groupe de pièces (`group-N/index.ts`). Ce fichier ne contient que l'assemblage ; ajouter ou compléter un groupe ne le modifie
 * pas (`docs/fotaq/specials.md`).
 */
export const GROUPS = { 1: group1, 2: group2, 3: group3, 4: group4, 5: group5, 6: group6 } as const;

export const fotaqScript: GameScript = assembleSpecials(GROUPS);
