/**
 * Contrat entre le monde et le HUD (`docs/swiv3d/rules.md` § 7 et 8) : tout ce que `createHud().draw` lit. Le HUD ne connaît pas
 * la simulation ; il ne garde que l'état d'animation du jeu d'origine (image de la jauge, pointeur d'objectif du radar).
 */

/** Nombre d'emplacements d'armes spéciales (`+0x128`, 20 entiers). */
export const SPECIAL_SLOTS = 20;

export interface HudMessage {
  /** Table de chaînes (`gm_get_string(table, id)`) : 100 pour les armes ramassées, 20 pour les objectifs et la mort… */
  textTable: number;
  textId: number;
  /** Numéro d'ordre du message : un numéro jamais vu crée un texte 3D (la durée affichée est celle de `render/text3d/message.ts`). */
  serial: number;
  /** Teinte (ligne × 256 de la table de couleurs du bloc 11003) et type de trajectoire (0 ou 10, `rules.md` § 8.1). */
  tint: number;
  type: 0 | 10;
}

export interface RadarBlip {
  /** Position monde, en unités (le monde est torique). */
  x: number;
  z: number;
  /** Classe de l'objet : champ `+0x04` du jeu (le HUD applique le masque `0x787f` : `0x001`, `0x007`, `0x017`, `0x041`, `0x1001`…). */
  kind: number;
}

/** Cible d'objectif (liste `DAT_005af3a8`) : croix du radar et pointeur du cadre 512. */
export interface RadarObjective {
  x: number;
  z: number;
  /** `true` pour les cibles de l'objectif courant (croix rouge) ; la première de la liste fixe la direction du pointeur. */
  current: boolean;
}

export interface HudState {
  /** Énergie du joueur (`+0x08`) : 496 = 100 %, jusqu'à 992 avec le bonus (barre blanche). */
  energy: number;
  /** 496 = 100 % ; sert de repère, la jauge est lue en unités du jeu d'origine. */
  maxEnergy: number;
  /** Non tracé par le HUD d'origine (la barre blanche de la jauge au-dessus de 511 en tient lieu). */
  shield: number;
  /** Score affiché (`+0x10c`). */
  score: number;
  /** Non tracé par le HUD d'origine. */
  cannonPower: number;
  /** Arme spéciale sélectionnée : -1 aucune, 0 à 19. */
  special: number;
  /** Munitions des 20 emplacements ; une arme est « possédée » si > 0. */
  specialAmmo: number[];
  /** Non tracé par le HUD d'origine. */
  specialArmed: boolean;
  /** Nom de la mission, tracé tant qu'il n'est pas vide (le jeu l'affiche 80 ticks puis le retire : le monde vide la chaîne). */
  missionName: string;
  language: "fr" | "en";
  messages: HudMessage[];
  /** Compteur de ticks logiques (40 Hz) : clignotement, animation de la jauge et du radar. */
  tick: number;
  paused: boolean;
  radar: {
    playerX: number;
    playerZ: number;
    /** 512 pas par tour. */
    playerYaw: number;
    blips: RadarBlip[];
    /** Cibles d'objectifs : croix et pointeur. Absent : le pointeur tourne de 8 pas par tick. */
    objectives?: RadarObjective[];
  };
  /**
   * Viseurs du bloc 506 (`gm_render_view` `0042b31c`, `gm_draw_crosshair` `00437c38`) ; absent : aucun. Deux séries de 16 images,
   * tracées dans cet ordre : jaune (images 0 à 15), sur la cible du joueur (`+0x58`) ; rouge (images 16 à 31), sur la tête de la liste
   * des objectifs tant que le joueur a une cible. Chacun est `null` quand son objet n'est pas à l'écran.
   */
  crosshair?: { yellow: Reticle | null; red: Reticle | null };
}

/** Un viseur : centre à l'écran (déjà lissé) et image 0..15 de sa série. */
export interface Reticle {
  x: number;
  y: number;
  frame: number;
}
