/**
 * Noyau : valeurs provisoires des fonctions pas encore portées (`docs/gk1/plan.md`, « Vagues »).
 *
 * Une fonction absente d'ici **et** sans implémentation rend 0 ; dans les deux cas l'appel est journalisé comme souche
 * (`KernelJournal.stubs`). La vague qui porte une fonction l'enregistre dans le fichier de son groupe (`kernel.register`,
 * qui remplace la souche) et retire sa ligne d'ici.
 *
 * Plus aucune valeur provisoire depuis la vague S2 (`GameIsRestarting` est dans `save.ts`) : le point d'entrée reste pour la
 * prochaine fonction à faire répondre avant de la porter (`kernel.stub(nom, valeur)`).
 */
import type { Kernel } from "./kernel";

export function registerStubs(_kernel: Kernel): void {}
