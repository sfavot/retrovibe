/**
 * File d'événements du monde, consommée par les vagues suivantes (H1 : armes, score ; G3 : sons ; H2 : HUD).
 * Les objets du pool étant recyclés, les événements portent des copies des valeurs utiles, jamais des références.
 */
export type WorldEvent =
  /** Demande de son (id de `SOUNDS.BD`, ex. 1001 = choc au sol, 1000 = explosion) à une position Q8. */
  | { kind: "sound"; id: number; x: number; y: number; z: number }
  /** Objet détruit par sa fonction de comportement (pv ≤ 0). `score` : points de la cible statique (73). */
  | {
      kind: "objectDestroyed";
      type: number;
      model: number;
      childModel: number;
      subtype: number;
      x: number;
      y: number;
      z: number;
      yaw: number;
      score: number;
    }
  /** Première blessure d'une cible statique : l'exe crée une bouffée de fumée (classe 0xe1, modèle 11004). */
  | { kind: "smoke"; x: number; y: number; z: number }
  /** Le joueur perd des pv. */
  | {
      kind: "playerDamaged";
      amount: number;
      source: "ground" | "contact" | "mud";
    }
  /** pv du joueur ≤ 0 : la séquence de mort (forme 0x2b, `00438744`) relève de H1/R3. */
  | { kind: "playerDied" }
  | { kind: "formChanged"; form: number }
  /** Sélection d'arme : -1 suivante, -2 précédente, 0..9 directe (`gm_weapon_select`). */
  | { kind: "weaponSelect"; command: number }
  /** Tir demandé ce tick : principal (maintenu) ou spécial (appui bref). */
  | { kind: "fire"; special: boolean }
  /** Bonus ramassé et appliqué (`gm_pickup_apply`) : `n` 0..19 = arme, 100..113 = vie, compagnon, bouclier, puissance. */
  | { kind: "pickup"; n: number }
  /** Le score réel du joueur a changé (`gm_score_add`). */
  | { kind: "scoreChanged"; score: number; delta: number }
  /** Une cible d'objectif détruite ; `group` : groupe 0..9, `groupDone` : plus aucune cible dans ce groupe. */
  | { kind: "objective"; group: number; groupDone: boolean; left: number }
  /** Message en jeu (`gm_message_spawn`) : chaîne `textId` de la table `textTable`. */
  | { kind: "message"; textTable: number; textId: number }
  /** Cratère d'explosion (`gm_terrain_explosion_crater`) : non appliqué à la carte de hauteur, à reproduire par le terrain. */
  | { kind: "crater"; x: number; z: number; size: 0 | 1 | 2 }
  /** Objectif final accompli : le niveau s'arrête (`DAT_00480a9c = 0x2a`, 55 ticks après la destruction du groupe 0). */
  | { kind: "levelComplete" }
  /** Le joueur est mort depuis 35 ticks (`DAT_00480a9c = 0x34`). */
  | { kind: "gameOver" };
