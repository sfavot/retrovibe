import type { Row } from "./tables";

/**
 * État d'un joueur : les 20 octets de `DS:6EB4 + 0x14 × i` (`engine.md` §6.1, précisés par `rules.md`).
 */
export interface Player {
  /** `+0` : personnage 0..5 (`CHARACTER_NAMES`). */
  character: number;
  /** `+2` : niveau de difficulté 0..2, transmis à chaque mini-jeu. */
  level: number;
  /** `+4` : abscisse du pion (0..0x13F). */
  x: number;
  /** `+6` : rangée (`y = 0x38` haute, `0x84` basse). */
  row: Row;
  /** `+8` : écran 1..9. */
  screen: number;
  /** `+A` : masque des ingrédients possédés (bit `i` = ingrédient `i`). */
  ingredients: number;
  /** `+C` : nombre d'ingrédients possédés (toujours égal au nombre de bits de `ingredients`). */
  ingredientCount: number;
  /** `+E` : points (« gouttes de rosée »), 0..60. */
  points: number;
  /** `+10` : état du pion (0 libre ; 2 puis 1 puis 3 = prisonnier ; 4 puis 6 puis 5 = pris au Turlusiphon). */
  status: number;
  /** `+12` / `+13` : le pion regarde vers la droite (`true`) ou vers la gauche. */
  facingRight: boolean;
}

/** Ce qu'un mini-jeu reçoit : copie des données du joueur courant au moment du lancement. */
export interface MinigameRequest {
  /** Numéro de scène (22..36, 38..41, 51) ou 14 pour le puits aux vœux. */
  scene: number;
  /** Indice du joueur courant. */
  player: number;
  character: number;
  /** Niveau de difficulté 0..2 du joueur (`DS:6EB6`). */
  level: number;
  /** Vrai si l'indice de l'oiseau (S39) vise cette scène : la difficulté est abaissée (voir rules.md). */
  bonus: boolean;
  /** Seulement S32 (Chez Gargamel) : probabilité de réussite, tirée par `rollChezGargamel()`. */
  successChance?: number;
  /** Seulement S13 : `ingredient` (choisir un ingrédient manquant) ou `travel` (choisir un lieu sur la carte). */
  wellMode?: "ingredient" | "travel";
}

/** Données restituées par un mini-jeu à `Game.resolveMinigame`. */
export type MinigameOutcome =
  /** S22, 27, 28, 31, 32, 33, 34, 36 : réussite ou échec. */
  | { kind: "ingredient"; success: boolean }
  /** S23, 24, 25, 26, 29, 30, 35, 40, 51 : points gagnés (0 en cas d'échec). */
  | { kind: "points"; points: number }
  /** S13 : ingrédient choisi (mode `ingredient`) ou lieu `k` de la carte (mode `travel`), `null` si rien. */
  | { kind: "well"; ingredient?: number | null; destination?: number | null }
  /** S41 : ingrédient demandé (0..7), 8 (chapeau), ou `null` si refus / abandon. */
  | { kind: "magician"; choice: number | null }
  /** S38 et S39 : aucun résultat, le jeu applique l'effet lui-même. */
  | { kind: "none" };

export type GameResult =
  /** Le joueur `winner` a réuni l'objectif (S11). */
  | { kind: "victory"; winner: number }
  /** Temps écoulé (S42). `video` est le numéro de la vidéo `s42a0NN` à jouer. */
  | { kind: "timeout"; video: number }
  /** Plus aucun joueur (S46). */
  | { kind: "abandoned" };

/** Compteurs et drapeaux d'un tour (réinitialisés à chaque tour, `291e:0401`). */
export interface TurnState {
  /** Secondes depuis le début du tour (chrono 1). */
  elapsed: number;
  /** Puits ouvert ce tour (`DS:79D0`, `2daf:0adc`). */
  wellOpen: boolean;
  /** Le joueur a bougé depuis le début du tour (annule les indices vocaux). */
  acted: boolean;
  hint1Done: boolean;
  hint2Done: boolean;
  /** Plages « comptées » (lac, pont) où le pion se trouve actuellement. */
  inside: string[];
}

export interface GameState {
  /** Durée de la partie en secondes (`DS:6EA4`, `(index + 1) × 1800`). */
  durationSeconds: number;
  /** Index du message de fin de temps (`DS:6EA2`, 0..8). */
  messageIndex: number;
  players: Player[];
  /** Joueur courant (`DS:6E2A`). */
  current: number;
  /** Tour de plateau (`DS:8C74`, démarre à 1). */
  round: number;
  /** Secondes écoulées depuis le début de la partie (chrono 0). */
  elapsed: number;
  /** Ingrédients requis (`DS:19B8`, masque) et points requis (`DS:19B9`). */
  goal: { ingredients: number; points: number };
  phase: "turn" | "minigame" | "over";
  turn: TurnState;
  /** Mini-jeu lancé en attente de son résultat. */
  pending: MinigameRequest | null;
  /** Indice de l'oiseau (`DS:6F37`) : valeur à retrouver dans la scène visée, 0 si aucun. */
  bonusTag: number;
  /** Nombre d'entrées sur le lac glacé (`DS:8D06`) et sur le pont (`DS:8D08`), tous joueurs confondus. */
  iceCrossings: number;
  bridgeCrossings: number;
  /** Avertissements du Grand Schtroumpf déjà donnés (10 min, 5 min). */
  warned10: boolean;
  warned5: boolean;
  paused: boolean;
  result: GameResult | null;
}

/** Nombre d'ingrédients dans un masque. */
export function popcount(mask: number): number {
  let n = 0;
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) n++;
  return n;
}

/** Vrai si le joueur possède l'ingrédient `i` (`1e52:0034`). */
export function hasIngredient(player: Pick<Player, "ingredients">, i: number): boolean {
  return (player.ingredients & (1 << i)) !== 0;
}
