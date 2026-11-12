/**
 * Contexte partagé du moteur : ce que ScummVM atteint par ses singletons (`Resources::getReference()`, `Room::getReference()`,
 * `Game::getReference()`, `Sound`, `LureEngine::rnd()`). Chaque module reçoit ce contexte au lieu d'appeler des singletons ; il est
 * implémenté par `LureEngine` (`game.ts`).
 *
 * Écrit pour ce projet (`docs/lure/engine.md`, § 9).
 */

import type { ScummvmRandom } from "../../../engine/rng";
import type { Sequence } from "../../../engine/sequence";
import type { LureData } from "../data/lure-data";
import type { DelayList } from "./delay-list";
import type { HandlerTable } from "./handlers/index";
import type { MethodTable } from "./methods/index";
import type { Room } from "./room";
import type { Script } from "./script";
import type { Bar, Fights, Journal, LureSound, Movement } from "./services";
import type { SequencePort } from "./sequences/port";
import type { ScheduleBook } from "./state";
import type { World } from "./world";

export interface LureContext {
  readonly data: LureData;
  readonly journal: Journal;
  /** Générateur de hasard unique du jeu (`LureEngine::rnd`, D8). */
  readonly rng: ScummvmRandom;
  readonly sound: LureSound;
  readonly movement: Movement;
  readonly bar: Bar;
  readonly fights: Fights;
  readonly schedules: ScheduleBook;
  readonly world: World;
  /** Écran, événements et horloge des séquences plein écran (vague Q). */
  readonly sequences: SequencePort;
  readonly room: Room;
  readonly script: Script;
  readonly delays: DelayList;
  readonly methods: MethodTable;
  readonly handlers: HandlerTable;
  /** État du jeu (`Game::_state`, drapeaux `GameState`). */
  gameState: number;
  /** `Game::preloadFlag` : avance rapide des ticks au retour dans une pièce. */
  preloadFlag: boolean;
  /** `Game::fastTextFlag`. */
  fastTextFlag: boolean;
  /**
   * `StringData::getString(stringId, hotspotName, characterName)` : texte composé en codes du jeu, remappé selon la pièce affichée ;
   * chaîne vide pour l'identifiant 0.
   */
  text(stringId: number, hotspotName?: string, characterName?: string): string;
  /**
   * Effet bloquant (boîte de texte, statut, oui / non, séquence plein écran) demandé pendant une exécution synchrone (script, verbe,
   * gestionnaire de tick) : exécuté dans l'ordre des demandes, avant que le jeu reprenne (§ 9 d'`engine.md`).
   */
  block(sequence: Sequence): void;
  /** `Dialog::show(stringId, hotspotName, characterName)`. */
  showDialog(stringId: number, hotspotName?: string, characterName?: string): void;
  /** `Dialog::show(text)` (texte déjà composé, en codes du jeu) ; `centered` : boîte centrée en hauteur (`doStatus`). */
  showDialogText(text: string, centered?: boolean): void;
  /** `Game::tick` : tick de chaque hotspot actif (aussi appelé par `Room::setRoomNumber`). */
  tickHotspots(): void;
}
