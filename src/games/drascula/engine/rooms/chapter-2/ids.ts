/**
 * Numéros d'objets du chapitre 2 (`objectNum` des fiches `.ALD`, comme `room_N`, `exitRoom`, `updateDoor` et `updateVisible` de
 * ScummVM les comparent), objets de l'inventaire et drapeaux. Les noms viennent du français des fiches et de l'usage dans le jeu.
 */

/** Objets de l'inventaire (`kItem*` de drascula.h) : tels que `pickObject`, `addObject` et `pickedObject` les nomment. */
export const Item = {
  Money: 7,
  Leaves: 8,
  Cross: 9,
  Spike: 10,
  Earplugs: 11,
  Book: 12,
  BubbleGum: 13,
  Sickle: 14,
  Tissues: 15,
  Cigarettes: 16,
  Candle: 17,
  TwoCoins: 18,
  OneCoin: 19,
  Reefer: 20,
  Handbag: 22,
  EarWithEarplug: 23,
  Phone: 28,
} as const;

/** Les cinq ingrédients de la potion (`flags[7] && flags[26] && flags[34] && flags[35] && flags[37]`). */
export const INGREDIENT_ITEMS: readonly number[] = [Item.Leaves, Item.BubbleGum, Item.Tissues, Item.Cigarettes, Item.Candle];

/** Le héros, cliqué avec un objet en main (`checkAction(50)`). */
export const HERO = 50;

/** Pièce 1 : l'église. */
export const Church = { Door: 118, WindowLeft: 119, WindowRight: 120, ToCrossroads: 121, ToCemeteryPath: 122 } as const;
/** Pièce 2 : le carrefour. */
export const Crossroads = { Church: 123, Village: 125, Cemetery: 127, Hut: 175 } as const;
/** Pièce 3 : le cimetière. */
export const Cemetery = { ToChurch: 124, Path: 128, Tomb: 129, Pantheon: 133, ToChapel: 134, Bars: 165, Plant: 166, Critters: 211 } as const;
/** Pièce 4 : le village. */
export const Village = { ToCrossroads: 126, ToMap: 145, Barrel: 189 } as const;
/** Pièce 5 : le mur de la chapelle. */
export const ChapelWall = { ToCemetery: 135, Window: 136 } as const;
/** Pièce 6 : la chambre. */
export const Bedroom = { Window: 137, Door: 138, Drawer: 139, Wardrobe: 143, Crucifix: 140, Candelabra: 144 } as const;
/** Pièce 7 : la chapelle. */
export const Chapel = { ToBedroom: 142, ToWell: 164, Candle: 190 } as const;
/** Pièce 8 : l'impasse aux poubelles. */
export const Alley = { ToArch: 160, Bin: 147, ToMap: 161 } as const;
/** Pièce 9 : l'impasse de l'aveugle. */
export const BlindAlley = { ToMap: 152, Door: 150, Blind: 51 } as const;
/** Pièce 10 : la carte du village. */
export const WorldMap = { ToVillage: 146, ToInn: 148, ToBlindAlley: 149 } as const;
/** Pièce 12 : la rue devant l'auberge. */
export const Street = { ToMap: 151, Balcony: 154, Door: 156, Arch: 158 } as const;
/** Pièce 14 : l'auberge. */
export const Inn = { Stairs: 159, Rooms: 162, Hallway: 171, Barman: 52, Drunk: 53, Pianist: 54 } as const;
/** Pièce 15 : le couloir. */
export const Hallway = { Stairs: 172, Machine: 188 } as const;
/** Pièce 16 : la chambre d'hôtel. */
export const Hotel = { Door: 163, Chest: 183, Mirror: 187 } as const;
/** Pièce 17 : la cabane de Von Braun. */
export const Hut = { Exit: 176, Door: 177 } as const;
/** Pièce 18 : le laboratoire de Von Braun. */
export const Lab = { Door: 178, Book: 182, VonBraun: 55 } as const;
/** Pièce 19 : le puits. */
export const Well = { ToChapel: 170, Well: 173 } as const;

/** Drapeaux du chapitre 2 (`flags[n]`). */
export const Flag = {
  /** Porte 138 de la chambre (6) ouverte (`doors`). */
  BedroomDoorOpen: 0,
  /** Tiroir de la chambre ouvert (le crucifix apparaît). */
  DrawerOpen: 1,
  /** Armoire de la chambre ouverte. */
  WardrobeOpen: 2,
  /** Barreau pris au cimetière. */
  BarsTaken: 3,
  /** A parlé une fois à l'aveugle. */
  BlindSpoke: 4,
  /** Le pianiste est parti (le héros est ressorti après lui avoir donné le livre). */
  PianistGone: 5,
  /** Les mouchoirs (poubelle) sont pris : ingrédient. */
  TissuesTaken: 7,
  /** Fenêtre 136 de la pièce 5 ouverte au piton (`doors`). */
  ChapelWindowOpen: 8,
  /** L'aveugle se tient debout (cinématique). */
  BlindStanding: 9,
  /** Crucifix pris. */
  CrucifixTaken: 10,
  /** Le pianiste est tourné vers le héros. */
  PianistTalking: 11,
  /** L'ivrogne fait son geste. */
  DrunkGesture: 12,
  /** L'ivrogne parle. */
  DrunkTalking: 13,
  /** Von Braun peut ouvrir (après la scène de la porte). */
  VonBraunLetsIn: 14,
  /** Porte 177 de la cabane ouverte (`doors`). */
  HutDoorOpen: 15,
  /** Porte 156 de l'auberge ouverte (`doors`) : vraie dès le début du chapitre. */
  InnDoorOpen: 16,
  /** Porte 163 de la chambre d'hôtel ouverte (`doors`) : vraie dès le début. */
  HotelDoorOpen: 17,
  /** Von Braun a répondu derrière la porte. */
  VonBraunAnswered: 18,
  /** Coffre de la chambre d'hôtel ouvert. */
  ChestOpen: 19,
  /** Le sac de B.J. a été pris dans le coffre. */
  HandbagTaken: 20,
  /** Von Braun est éveillé dans son laboratoire. */
  VonBraunAwake: 21,
  /** La scène des bouchons d'oreilles a eu lieu. */
  EarplugsScene: 22,
  /** Le sac a été ouvert : billet et pièces. */
  HandbagOpened: 23,
  /** La machine descend du plafond (laboratoire). */
  Machine: 24,
  /** La première rencontre avec Von Braun a eu lieu. */
  MetVonBraun: 25,
  /** Cigarettes prises : ingrédient. */
  CigarettesTaken: 26,
  /** Le distributeur a rendu la monnaie (état de la machine). */
  MachineReady: 27,
  /** Livre pris dans le laboratoire. */
  BookTaken: 28,
  /** Le héros porte les bouchons d'oreilles. */
  WearingEarplugs: 29,
  /** Von Braun a pris le billet, les deux pièces, la pièce. */
  MoneyKept: 30,
  TwoCoinsKept: 31,
  OneCoinKept: 32,
  /** A parlé deux fois à l'aveugle. */
  BlindSpokeTwice: 33,
  /** Chewing-gum pris : ingrédient. */
  GumTaken: 34,
  /** Bougie prise : ingrédient. */
  CandleTaken: 35,
  /** Le puits est ouvert (`doors`). */
  WellOpen: 36,
  /** La faucille a coupé la plante : ingrédient. */
  LeavesTaken: 37,
  /** Les cinq ingrédients sont réunis. */
  AllIngredients: 38,
  /** Le livre a été donné au pianiste. */
  BookGiven: 39,
  /** La cabane de Von Braun est indiquée (`doors`). */
  HutKnown: 40,
  /** L'ivrogne a déjà raconté (menu de choix). */
  DrunkSpoke: 41,
} as const;

/** `doors` de rooms.cpp pour le chapitre 2 : numéro d'objet de la porte -> drapeau qui dit si elle est ouverte. */
export const DOOR_FLAGS: Readonly<Record<number, number>> = {
  138: Flag.BedroomDoorOpen,
  136: Flag.ChapelWindowOpen,
  156: Flag.InnDoorOpen,
  163: Flag.HotelDoorOpen,
  177: Flag.HutDoorOpen,
  175: Flag.HutKnown,
  173: Flag.WellOpen,
};

/** Clés de `GameState.anim` du chapitre 2 (`actorFrames[kFrame*]`, `blinking`). */
export const Anim = {
  Bat: "bat",
  Blind: "blind",
  Snore: "snore",
  Candles: "candles",
  Pianist: "pianist",
  Drunk: "drunk",
  Blinking: "blinking",
  /** Image du pianiste qui se retourne (`animation_12_2`, `animation_26_2`) : 0 aucune, 1 ou 2. */
  PianistTurn: "pianistTurn",
} as const;

/** `NO_DOOR` : `toggleDoor` sans porte à mettre à jour. */
export const NO_DOOR = null;
