import type { MohawkHost } from "../../../engine/mohawk/host";

/** Stockage clé/valeur persistant, réexporté pour les hôtes du jeu. */
export type { HostStorage } from "../../../engine/mohawk/host";

/**
 * Curseur demandé par le moteur (engine.md §1.3, §4.5). `arrow` = curseur système, `busy` = sablier (`CURS` 1 de `MILKYWAY.DAT`),
 * `help` = point d'interrogation (`CURS` 2), `hidden` = aucun (pièce portée, scènes qui dessinent leur propre pointeur).
 */
export type CursorKind = "arrow" | "busy" | "help" | "hidden";

/** Hôte de Mathémagique : fichiers relatifs à `original/mathemagique/` (`BOWLING.DAT`, `MPC/PVG.MHK`). */
export type Host = MohawkHost<CursorKind>;
