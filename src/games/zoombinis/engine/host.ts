import type { MohawkHost } from "../../../engine/mohawk/host";
import type { TextInputPort } from "../../../engine/mohawk/text-input";

/** Stockage clé/valeur persistant, réexporté pour les hôtes du jeu. */
export type { HostStorage } from "../../../engine/mohawk/host";

/**
 * Curseur demandé par le moteur (engine.md §4.4, §7.3). `system` = curseur système (flèche), `curs1` à `curs5` = les cinq `CURS`
 * 1 à 5 de `ZOOMBINI.MHK` (monochromes 16 × 16, voir `data/curs.ts`). `busy` n'est pas une ressource du jeu : c'est le curseur de
 * chargement qu'exige le `Engine` commun, rendu par le curseur d'attente du système (sablier).
 */
export type CursorKind = "system" | "busy" | "hidden" | "curs1" | "curs2" | "curs3" | "curs4" | "curs5";

/**
 * Lecture d'un film en cours (`Host.playVideo`). Le film est une vidéo posée sur la zone de jeu : le moteur continue de tourner et la
 * scène interroge `ended` à chaque tick.
 */
export interface VideoPlayback {
  /** Vrai quand le film est terminé, arrêté par `stop()` ou ne peut pas être lu (fichier absent, format refusé). */
  readonly ended: boolean;
  /** Arrête le film et retire la vidéo ; sans effet s'il est déjà fini. */
  stop(): void;
}

/**
 * Hôte de Zoombinis : fichiers relatifs à `original/zoombinis/` (`ZOOMBINI.MHK`, `TEXTSTR.MHK`, une archive par écran…).
 * `playVideo` est une capacité facultative (logo, `engine.md` §2.1) : absente, la scène du logo passe directement à la suite.
 */
export type Host = MohawkHost<CursorKind> & {
  /**
   * Joue le film `path` (relatif à `original/zoombinis/`, comme `loadFile`), sans contrôles, exactement sur la zone de jeu. Le son suit la
   * préférence « Son » du site. Ne rend jamais la main par une exception : un film illisible est un film déjà `ended`.
   */
  playVideo?(path: string): VideoPlayback;
  /**
   * Champ de saisie invisible (clavier virtuel, caractères composés) pour le nom de la partie (`dialog.ts`, mode 3). Capacité
   * facultative : absente, la saisie ne passe que par les touches du moteur.
   */
  readonly textInput?: TextInputPort;
};
