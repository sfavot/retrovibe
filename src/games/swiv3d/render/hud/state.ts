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
  ticksLeft: number;
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
  /** Viseur (bloc 506) ; absent : non tracé. `x`, `y` : centre à l'écran ; images 0 à 15 (série jaune) et 0 à 15 (série rouge, `null` : pas de cible). */
  crosshair?: { x: number; y: number; yellowFrame: number; redFrame: number | null };
}
