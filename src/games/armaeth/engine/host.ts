import type { OplSink } from "../audio/opl-driver";
import type { KeyEvent } from "./interface";

/**
 * Frontière entre le moteur d'*Armaeth* et son environnement (navigateur ou test) : seul point d'entrée des fichiers, de
 * l'horloge, du son, de l'écran, des sauvegardes et des entrées. Le moteur n'attend jamais : `tick()` consomme ce que
 * l'hôte a accumulé depuis le tic précédent.
 */

/** Écran de 320 x 200 en couleurs indexées et sa palette (768 octets RGB sur 8 bits, éclairage compris). */
export interface ArmaethFrame {
  pixels: Uint8Array;
  palette: Uint8Array;
}

/** Touche transmise au moteur : les types 1 à 4 de `3588:0118` (caractère, F1 à F10, Alt+lettre, navigation) plus `Suppr`. */
export type HostKey = KeyEvent | { type: "delete" };

/**
 * Entrée de l'utilisateur. Une touche est un événement ; la souris est un **état** (position écran 320 x 200 et masque de
 * boutons : 1 gauche, 2 droit), relu à chaque tic comme `INT 33h`. Les caractères de commande sont ceux du DOS :
 * `\r` Entrée, `\x1b` Échap, `\b` Retour arrière.
 */
export type HostInput =
  | { type: "key"; key: HostKey }
  /** `touch` : appui d'un toucher du doigt (gestes de l'écran tactile), pour les aides au doigt du portage. */
  | { type: "pointer"; x: number; y: number; buttons: number; ctrl?: boolean; touch?: boolean };

/** Sauvegardes : un fichier de monde (`formats.md`, 21 868 octets) par nom d'emplacement. */
export interface ArmaethStorage {
  read(slot: string): Uint8Array | null;
  write(slot: string, bytes: Uint8Array): void;
}

export interface ArmaethHost {
  /**
   * Octets d'un fichier du jeu (`A1FCFG.SYS`, `A1F00A.VGA`, `AM1.EXE`, `MSGINT`…), nom exact de `original/armaeth/`. Synchrone :
   * l'hôte navigateur précharge les fichiers avant de construire le moteur. Lève si le fichier manque.
   */
  readFile(name: string): Uint8Array;
  /** Horloge monotone en millisecondes (graine du hasard, `srand(time())`). */
  now(): number;
  /** Puce OPL2 (pilote musical, 50 Hz sur sa propre horloge). */
  readonly opl: OplSink;
  /** Image prête à afficher, une fois par `tick()`. */
  present(frame: ArmaethFrame): void;
  readonly storage: ArmaethStorage;
  /** Événements d'entrée reçus depuis le dernier appel (la file est vidée). */
  pollInput(): readonly HostInput[];
  /** Fin du jeu (`gm_quit`, jeton `xit`). */
  quit(): void;
}
