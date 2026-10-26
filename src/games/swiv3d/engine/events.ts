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
  | { kind: "fire"; special: boolean };
