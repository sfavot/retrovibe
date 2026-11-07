/**
 * Numéros d'objets du chapitre 4 (`objectNum` des fiches `.ALD`, comme ils sont comparés dans les `room_N` de ScummVM), objets de
 * l'inventaire, drapeaux et répliques qu'il emploie. Les noms viennent du français du jeu (textes des objets de l'inventaire).
 *
 * Attention : `visible[n]`, `isDoor[n]` et `toggleDoor(_, n, _)` de ScummVM désignent l'**index** de l'objet dans la pièce ; ici
 * tout passe par le numéro d'objet (`roomObject`, `setVisible`), sauf `toggleDoor`, qui garde l'index de la porte (`DoorIndex`).
 */

/** Objets de l'inventaire du chapitre 4 (`pickedObject`, `pickObject`, `addObject`). */
export const Item = {
  /** Clé de la porte de la pièce 21 (prise au pied de l'arbre, pièce 22). */
  Key: 7,
  /** Frites en forme de crocs (pièce 23). */
  Fries: 8,
  /** Croix (départ). */
  Cross: 9,
  /** Perruque d'Igor (pièce 26). */
  Wig: 10,
  /** Hache (pièce 31). */
  Axe: 11,
  /** Farine (garde-manger, pièce 30). */
  Flour: 12,
  /** Déodorant (pièce 35) : dégrippe la charnière de l'armoire du garde-manger. */
  Deodorant: 13,
  /** Pieu (armoire de la pièce 34). */
  Stake: 14,
  /** Cerveau (pièce 35). */
  Brain: 15,
  /** Cape (pièce 35). */
  Cape: 16,
  /** Clé du salon (donnée par la mascarade de Drascula : `animation_7_4`). */
  LivingRoomKey: 17,
  /** Branche coupée (pièce 22). */
  Branch: 18,
  /** Corde (pièce 21). */
  Rope: 19,
  /** Gousse d'ail (départ). */
  Reefer: 20,
  /** Corde et branche réunies : le grappin de la dernière énigme. */
  Grapnel: 21,
  /** Pièce brillante (départ) : pour la pie. */
  Coin: 22,
  Phone: 28,
} as const;

/** Objet « le héros » (`checkAction(50)`). */
export const HERO = 50;

/** Pièce 21 : le pied du château. */
export const Outside = { Tree: 100, Door: 101, Rope: 141, Wall: 179, Gate: 173 } as const;
/** Pièce 22 : l'arbre. */
export const Tree = { Exit: 102, Branch: 140, Magpie: 52, Key: 180 } as const;
/** Pièce 23 : le hall d'entrée. */
export const Hall = { DoorToOutside: 103, DoorToLanding: 104, Fries: 142 } as const;
/** Pièce 24 : le palier. */
export const Landing = { DoorToHall: 105, DoorToBedroom: 106, Stairs: 108, Tapestry: 151 } as const;
/** Pièce 26 : la chambre d'Igor. */
export const Bedroom = { Door: 107, Wig: 143, Igor: 51 } as const;
/** Pièce 27 : le grand couloir. */
export const Corridor = { Stairs: 109, DoorToCellar: 110, DoorToKitchen: 112, DoorToLivingRoom: 116, DoorToStudy: 118, WestWing: 150 } as const;
/** Pièce 29 : la cuisine. */
export const Kitchen = { DoorToCorridor: 113, DoorToPantry: 114 } as const;
/** Pièce 30 : le garde-manger. */
export const Pantry = { DoorToKitchen: 115, Wardrobe: 144 } as const;
/** Pièce 31 : le salon. */
export const LivingRoom = { DoorToCorridor: 117, Axe: 145 } as const;
/** Pièce 34 : le bureau. */
export const Study = { DoorToCorridor: 119, Wardrobe: 120, Bookcase: 122, Torch: 146 } as const;
/** Pièce 35 : l'armoire du bureau. */
export const Cupboard = { Exit: 121, Brain: 147, Cape: 148, Deodorant: 149 } as const;
/** Pièce 44 : la sortie du labyrinthe de couloirs. */
export const Maze = { Exit: 139, Poster: 172 } as const;

/**
 * Index de l'objet porte dans sa pièce (`doorNum` de `toggleDoor`) : les gestionnaires de ScummVM passent l'index, pas le numéro
 * d'objet. `Study.Bookcase` (2) est l'index que `room_34` passe pour l'armoire (drapeau 8) : l'armoire est à l'index 1, c'est une
 * coquille de ScummVM, sans effet visible (l'état de l'armoire est relu à chaque clic, `updateDoor`), reprise telle quelle.
 */
export const DoorIndex = {
  OutsideDoor: 1,
  HallToOutside: 0,
  HallToLanding: 1,
  LandingToHall: 0,
  LandingToBedroom: 1,
  BedroomDoor: 0,
  CorridorCellar: 1,
  CorridorLivingRoom: 3,
  KitchenToPantry: 1,
  PantryToKitchen: 0,
  /** Index de l'armoire du garde-manger (qui n'est pas une porte). */
  PantryWardrobe: 1,
  LivingRoomToCorridor: 0,
  StudyWardrobe: 2,
  StudyBookcase: 2,
} as const;

/** Drapeaux du chapitre 4 (`flags[n]`). Les drapeaux d'une porte sont à 1 quand la porte est ouverte. */
export const Flag = {
  /** Porte 101 / 103 (pièces 21 et 23). */
  DoorOutside: 0,
  /** Porte 104 / 105 (pièces 23 et 24). */
  DoorLanding: 1,
  /** Porte 106 / 107 (pièces 24 et 26). */
  DoorBedroom: 2,
  /** Porte 114 / 115 (cuisine et garde-manger). */
  DoorPantry: 4,
  /** Porte 116 / 117 (couloir et salon). */
  DoorLivingRoom: 5,
  /** Porte 110 (couloir et pièce 28). */
  DoorCellar: 6,
  /** Étagère 122 (bureau et couloirs). */
  Bookcase: 7,
  /** Armoire 120 (bureau). */
  StudyWardrobe: 8,
  /** La corde a été prise. */
  RopeTaken: 10,
  /** Les frites ont été prises. */
  FriesTaken: 11,
  /** La perruque a été prise. */
  WigTaken: 12,
  /** La hache a été prise. */
  AxeTaken: 13,
  /** La cape a été prise. */
  CapeTaken: 14,
  /** Le cerveau a été pris. */
  BrainTaken: 15,
  /** L'armoire du garde-manger est ouverte (pour `toggleDoor`). */
  PantryWardrobeOpen: 16,
  /** Le déodorant est visible (le cerveau est pris, le déodorant pas encore). */
  DeodorantVisible: 17,
  /** Frites, farine et cape réunies : Igor est parti (ou, le temps d'une conversation, Igor se lève). */
  Ready: 18,
  /** Les gonds de l'armoire du garde-manger sont dégrippés (déodorant). */
  HingesOiled: 19,
  /** Igor est debout (pose pendant la conversation). */
  IgorStanding: 20,
  /** Igor a déjà parlé au héros. */
  IgorMet: 21,
  /** La farine a été prise. */
  FlourTaken: 22,
  /** La clé du salon a ouvert la porte 116. */
  LivingRoomUnlocked: 23,
  /** La branche a été coupée. */
  BranchCut: 24,
  /** Le pieu a été pris. */
  StakeTaken: 25,
  /** La pie fait la morte. */
  MagpieDown: 26,
  /** La clé de l'arbre a été prise. */
  KeyTaken: 27,
  /** La porte 101 est déverrouillée. */
  OutsideUnlocked: 28,
  /** Le héros est déguisé en Drascula (le temps de `animation_5_4` à `animation_7_4`). */
  Disguised: 29,
  /** Igor a fermé sa porte à clé. */
  BedroomLocked: 30,
} as const;

/** Images courantes dans `GameState.anim` (clés propres au chapitre 4). */
export const Anim = {
  /** Clignement d'Igor : 5 = les yeux fermés (`blinking`). */
  Blinking: "blinking",
  /** Pose d'Igor entre assis et debout (1 : première image). */
  IgorPose: "igorPose",
  /** Igor garde sa perruque (`room_26`, une image). */
  WigGuard: "wigGuard",
  /** Image de l'étagère qui pivote (`animation_8_4`), 0 : aucune, sinon 1 à 14. */
  Bookcase: "bookcase",
} as const;
