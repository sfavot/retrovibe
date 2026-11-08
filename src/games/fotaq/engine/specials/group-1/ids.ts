/** Numéros de `defs.h` (ScummVM) et du jeu utilisés par le groupe 1 : pièces, répliques, cinématiques des zones éteintes. */

export const Room = {
  /** Le pont de lianes (`ROOM_JUNGLE_BRIDGE`) : la zone du pont éteinte. */
  JungleBridge: 4,
  /** Le premier gorille (`ROOM_JUNGLE_GORILLA_1`). */
  JungleGorilla1: 6,
  /** Le faux dinosaure, second gorille (`ROOM_JUNGLE_GORILLA_2`). */
  JungleGorilla2: 14,
  /** L'entrée de la forteresse des Amazones (`ROOM_AMAZON_ENTRANCE`). */
  AmazonEntrance: 16,
  /** La cachette des Amazones (`ROOM_AMAZON_HIDEOUT`). */
  AmazonHideout: 17,
} as const;

/** Réplique de Joe devant la zone éteinte du pont (`makeJoeSpeak(16)`). */
export const BRIDGE_REPLY = 16;

/** Pièce 16 : numéro de la zone de marche qui déclenche `C16A` (les autres zones éteintes de la pièce ne jouent rien). */
export const AMAZON_ENTRANCE_AREA = 3;

/** Pièce 17 : rang de l'étape de marche (et non numéro de zone) qui déclenche `C17A` ou `C17B`. */
export const HIDEOUT_WALK_STEP_A = 4;
export const HIDEOUT_WALK_STEP_B = 2;

/** Cinématiques jouées quand Joe entre dans une zone éteinte. */
export const Cutaway = {
  Gorilla1: "C6C.CUT",
  Gorilla2: "C14B.CUT",
  AmazonEntrance: "C16A.CUT",
  HideoutA: "C17A.CUT",
  HideoutB: "C17B.CUT",
} as const;
