/**
 * Identifiants propres à Yoda Stories (YODESK.DTA), repris du portage WebFun (MIT, `variant/yoda`).
 * Tous les identifiants sont des indices dans les tables du fichier de données.
 */

/** Planètes (champ `Zone.planet`) : la génération n'utilise que les trois premières, Dagobah est le point de départ. */
export const Planet = {
  Tatooine: 1,
  Hoth: 2,
  Endor: 3,
  Dagobah: 5,
} as const;

/** Planètes où se déroule une mission. */
export const MISSION_PLANETS: readonly number[] = [Planet.Endor, Planet.Hoth, Planet.Tatooine];

/** Puzzles de mission (type « GO », briefing de Yoda) que la génération traite à part. */
export const GoalIds = {
  Falcon: 85,
  GeneralMarutz: 103,
  HiddenFactory: 108,
  Han: 115,
  FindLeia: 131,
  /** Le code de bataille impérial : Yoda attend alors dans la cabane, au sud-ouest de Dagobah. */
  ImperialBattleCode: 132,
  RelayStation: 133,
  ImperialBattleStation: 134,
  WarnTheRebels: 135,
  Amulet: 185,
  /** Mission « Sauver Yoda » : débloquée après une victoire, Yoda n'est alors pas sur Dagobah (son siège est vide). */
  RescueYoda: 189,
  /** Mission de la voiture (« Car ») : débloquée après dix victoires. */
  Car: 197,
  LanternOfSacredLight: 198,
  AdeganCrystal: 199,
  ThreepiosParts: 201,
} as const;

/** Victoires nécessaires pour que ces missions soient tirables. */
export const GOAL_UNLOCK_WINS = { [GoalIds.RescueYoda]: 1, [GoalIds.Car]: 10 } as const;

export const ZoneIds = {
  Load: 0,
  Win: 76,
  Lose: 77,
  /** Les quatre secteurs de Dagobah (grille 2×2 en (4,4) (5,4) (4,5) (5,5)). */
  DagobahSouthWest: 93,
  DagobahNorthWest: 94,
  DagobahNorthEast: 95,
  DagobahSouthEast: 96,
  /** Intérieur de la cabane de Yoda (pièce du secteur nord-est). */
  YodasHut: 535,
} as const;

export const TileIds = {
  /** Yoda en personne. */
  Yoda: 780,
  YodasBack: 1993,
  /** Siège vide de Yoda (mission « Sauver Yoda »). */
  YodasSeat: 2034,
  R2D2: 794,
  /** Le localisateur (carte de la planète) : objet de la quête « carte ». */
  Locator: 421,
  /** La Force : l'arme de la quête « arme unique ». */
  TheForce: 511,
  Blaster: 512,
  BlasterRifle: 513,
  LightsaberGreen: 510,
  LightsaberBlue: 18,
  ThermalDetonator: 514,
  TeleporterInactive: 536,
  TeleporterActive: 537,
  MedicalDroid: 797,
  SpiritHeart: 1432,
} as const;

export const CharacterIds = {
  TheForce: 13,
  Blaster: 9,
  BlasterRifle: 10,
  Blank: 1,
  Jawa: 2,
  MadJawa: 43,
  Ewok: 53,
  R2Unit: 61,
  Vader: 68,
} as const;

/** Cases de Dagobah dans la grille de 100 cases (x + 10·y). */
export const DAGOBAH_CELLS = { northWest: 44, northEast: 45, southWest: 54, southEast: 55 } as const;

/**
 * Départ de la partie : la zone de chargement, hors écran en (10, 10) (état initial de l'original). Son script joue
 * l'arrivée du X-Wing puis enchaîne vers le secteur sud-ouest de Dagobah en (6, 12), par véhicule : c'est ce
 * atterrissage qui remet le compteur de la zone à 0 et rend le X-Wing utilisable.
 */
export const START = { zone: ZoneIds.Load, position: { x: 10, y: 10 } } as const;
