/**
 * État du joueur exposé aux autres vagues (HUD, écrans, son) : `world.status`, mis à jour à chaque tick.
 * Valeurs d'origine (`docs/swiv3d/rules.md`) : énergie 496 = 100 %, 992 = 200 %.
 */

/** Message affiché en jeu (`gm_message_spawn`, `00422f8c`) : chaîne `textId` de la table `textTable` de `GLOBAL.BD`. */
export interface GameMessage {
  /** Table de chaînes : 100 (noms des armes et bonus), 20 (objectifs : id = indice, 0 = « Accompli », 10 = « Game over ! »). */
  textTable: number;
  textId: number;
  /** Ticks restants avant disparition. */
  ticksLeft: number;
}

export interface PlayerStatus {
  /** pv du joueur (`+0x08`) : 496 = 100 %, jusqu'à 992 avec la méga-vie. */
  energy: number;
  /** Énergie de référence de la jauge : 496 (100 %). */
  maxEnergy: number;
  /** pv restants du bouclier (bonus 107), 0 sans bouclier. */
  shield: number;
  /** Score affiché (`+0x10c`) : rattrape le score réel de 3 par tick. */
  score: number;
  /** Niveau de puissance du canon (`+0x9c`), 0 à 19. */
  cannonPower: number;
  /** Arme spéciale sélectionnée (0..19), -1 si aucune. */
  special: number;
  /** Munitions par arme spéciale (20 emplacements). */
  specialAmmo: number[];
  /** L'arme spéciale sélectionnée est armée (état 10) : le tir spécial part. */
  specialArmed: boolean;
  /** Cibles d'objectif encore debout (tous groupes confondus). */
  objectivesLeft: number;
  /** Niveau accompli (53 ticks après la destruction du groupe 0). */
  levelComplete: boolean;
  /** Le joueur est mort depuis 35 ticks : écran « Game over ». */
  gameOver: boolean;
  messages: GameMessage[];
}

export const MAX_ENERGY = 496;

export function newStatus(): PlayerStatus {
  return {
    energy: 0,
    maxEnergy: MAX_ENERGY,
    shield: 0,
    score: 0,
    cannonPower: 0,
    special: -1,
    specialAmmo: new Array<number>(20).fill(0),
    specialArmed: false,
    objectivesLeft: 0,
    levelComplete: false,
    gameOver: false,
    messages: [],
  };
}
