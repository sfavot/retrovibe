/**
 * État de jeu du joueur et du niveau : score, munitions, arme spéciale (machine à états `+0x178`), compagnons, bouclier,
 * objectifs, compteurs de fin de niveau, messages. Regroupe ce que l'exe garde dans la structure joueur de 0x228 octets et dans
 * les variables globales `005b03xx` (voir `docs/swiv3d/rules.md`).
 */
import type { GameObject } from "./objects";
import type { GameMessage } from "./status";

/** Ticks d'affichage d'un message en jeu (durée non décodée : choix d'implémentation, ≈ 2,5 s). */
export const MESSAGE_TICKS = 100;
/** Plafond de munitions par arme spéciale (`gm_pickup_can_take`, `00458f88`). */
export const AMMO_CAP: readonly number[] = [
  100, 60, 30, 40, 20, 20, 20, 10, 20, 10, 40, 30, 15, 40, 20, 5, 20, 10, 20, 500,
];
/** Munitions ajoutées par un bonus d'arme (`gm_pickup_apply`, `004585c4`). */
export const AMMO_PICKUP: readonly number[] = [
  6, 3, 2, 3, 2, 2, 2, 1, 2, 1, 2, 2, 2, 3, 2, 1, 2, 1, 2, 80,
];

/** Cible d'objectif enregistrée (`gm_objective_register`, `0043cda4`). */
export interface ObjectiveEntry {
  obj: GameObject;
  group: number;
}

export type EndState = "none" | "victory" | "dead";

export class GameState {
  /** Score réel (`+0x108`) et affiché (`+0x10c`, rattrape de 3 par tick). */
  score = 0;
  scoreShown = 0;
  /** Score gagné dans ce niveau (`+0x110`). */
  levelScore = 0;
  /** Munitions des 20 armes spéciales (`+0x128`). */
  readonly ammo: number[] = new Array<number>(20).fill(0);
  /** Niveau de puissance du canon (`+0x9c`). */
  power = 0;
  /** Compteur de tir principal (`+0x98`) : une salve quand `& 0xf == 0`. */
  fireCounter = 0;
  /** Tangage de visée (`+0x90`). */
  aimPitch = 0;
  /** Arme sélectionnée (`+0x120`) et arme chargée (`+0x11c`), -1 = aucune. */
  selected = -1;
  loaded = -1;
  /** État de l'arme spéciale (`+0x178`) : 0/1 charge, 2 armement, 10 armée, 0x0b tir, 0x14 retrait, 0x1e resélection. */
  weaponState = 0;
  /** Compteur de l'état d'arme (`+0x17c`). */
  weaponCounter = 0;
  /** Objets lanceurs accrochés au joueur (missiles en attente). */
  launchers: GameObject[] = [];
  /** Compagnons (`+0x1f8…+0x20c`, 6 emplacements) et bouclier (`+0x210`). */
  readonly buddies: (GameObject | null)[] = [null, null, null, null, null, null];
  shield: GameObject | null = null;
  /** Chasseurs de `6300` rattachés au joueur (`+0x1bc…+0x1c8`) : 4 emplacements, jamais libérés (voir objects.md §6.9). */
  readonly fighters: (GameObject | null)[] = [null, null, null, null];
  /** Joueur vivant (`+0x184`). */
  alive = true;

  /** Index dans la table pseudo-aléatoire (`005a84d8`). */
  randomIndex = 0;

  // Fin de niveau (`005b0414`, `005b03e8`)
  endState: EndState = "none";
  /** -1 = aucune séquence en cours ; sinon ticks écoulés depuis le début de la séquence. */
  endCounter = -1;
  levelComplete = false;
  gameOver = false;

  // Objectifs et compteurs de bonus
  readonly objectives: ObjectiveEntry[] = [];
  /** Cibles d'objectif inscrites / détruites (`005b03e0` / `005b0400`). */
  objectivesRegistered = 0;
  objectivesDestroyed = 0;
  /** Le groupe 9 est détruit (`005b03e4 == 9`) : révèle les bonus 7002. */
  group9Done = false;
  /** Seul le groupe 0 reste (`005af3a4 == 1`) : révèle les bonus 7001. */
  finalGroupOnly = false;
  /** Bonus posés / largués du niveau (`005b03d8`, `005b03f4`) et ramassés (`+0x198`, `+0x194`). */
  bonusPlaced = 0;
  bonusDropped = 0;
  pickedPlaced = 0;
  pickedDropped = 0;

  /** Jauge d'énergie (`+0x118`, image 0 à 43) et pv mémorisés. */
  gauge = 0;

  messages: GameMessage[] = [];

  addScore(points: number): void {
    this.score += points;
    this.levelScore += points;
  }

  message(textTable: number, textId: number, ticks = MESSAGE_TICKS): void {
    this.messages.push({ textTable, textId, ticksLeft: ticks });
  }

  /** Avance les durées des messages d'un tick. */
  tickMessages(): void {
    for (const m of this.messages) m.ticksLeft--;
    this.messages = this.messages.filter((m) => m.ticksLeft > 0);
  }
}
