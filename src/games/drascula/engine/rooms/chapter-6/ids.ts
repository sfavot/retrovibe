/**
 * Numéros d'objets du chapitre 6 (`objectNum` des fiches `58.ALD` à `61.ALD` et `102.ALD`, comme ils sont comparés dans `room_58`,
 * `room_59`, `room_60`, `room_102` et `checkAction` de ScummVM), objets de l'inventaire et drapeaux qu'il emploie. Les noms viennent du
 * français des fiches.
 */

/** Pièce 58, le couloir devant la porte dérobée. */
export const Corridor = {
  /** La torche : la pousser ouvre la porte dérobée (`room_58`, drapeau 8). */
  Torch: 103,
  /** La porte dérobée, vers la chambre de B.J. (pièce 59, sortie 105) : fermée tant que le drapeau 8 est bas. */
  SecretDoor: 104,
} as const;

/** Pièce 59, la chambre de B.J. */
export const Bedroom = {
  BJ: 51,
  /** L'armoire : la porte vers le couloir (pièce 58, sortie 104). Condamnée (`isDoor[1] = 0`) : on ne la franchit que par la porte dérobée. */
  Wardrobe: 105,
  Chest: 106,
  Mirror: 107,
  /** La porte vers la taverne (pièce 60, sortie 109). */
  Door: 108,
} as const;

/** Pièce 60, la taverne. */
export const Tavern = {
  Barman: 52,
  Drascula: 56,
  /** La porte vers la chambre de B.J. (pièce 59, sortie 108). */
  BedroomDoor: 109,
  /** La porte vers l'arrière-salle (pièce 61, sortie 111). */
  BackroomDoor: 110,
  Piano: 112,
  Skull: 113,
  Poster: 114,
  Fans: 115,
} as const;

/** Pièce 61, l'arrière-salle. */
export const Backroom = {
  Papers: 116,
  Curtain: 117,
  VendingMachine: 118,
  /** La porte vers la taverne (pièce 60, sortie 110). */
  Door: 111,
} as const;

/** Pièce 102, le cachot (le héros ligoté sous le pendule). Le héros lui-même est l'objet 50. */
export const Dungeon = {
  Pendulum: 100,
  /** Ce qu'on peut atteindre de la main : l'objet 20, qui coupe les liens. */
  Reach: 101,
  Shackles: 102,
} as const;

/** Objets de l'inventaire du chapitre. */
export const Item = {
  /** Le téléphone, dans l'inventaire dès le début du chapitre (28). */
  Phone: 28,
  /** L'objet qui tue les vampires (9), dans l'inventaire dès le début ; sur Drascula après qu'il a bu, il finit le jeu. */
  Stake: 9,
  /** Pris dans le cachot (`room_102`, objet 101) ; sur le pendule, il coupe les liens (`animation_6_6`). */
  Blade: 20,
  /** Donné par le barman (`playTalkSequence(14)`) ; sur Drascula, il le fait boire (`room_60`). */
  Drink: 21,
} as const;

/** Drapeaux du chapitre 6 (`flags[n]`). */
export const Flag = {
  /** 1 : le héros est libre ; 0 : il est ligoté sous le pendule (le début du chapitre, jusqu'à `animation_6_6`). */
  Free: 0,
  /** 2 : le héros est ligoté sous le pendule et ne parle pas ; 1 : il parle (`talk_pen`) ; 0 : libéré ou après sa première réplique. */
  Pendulum: 1,
  /** Igor et Drascula ne sont plus dans le couloir (après `animation_6_6`). */
  CorridorEmpty: 2,
  /** La manivelle a été tournée : la chaîne du pendule est descendue (`animation_5_6`). */
  ChainLowered: 3,
  /** Drascula a quitté la taverne (`animation_9_6`). */
  DrasculaGone: 5,
  /** Drascula a bu (l'objet 21 lui a été donné). */
  DrasculaDrank: 6,
  /** Le piano a été poussé : le troisième choix du barman change (`converse`, `OP_12`). */
  PianoMoved: 7,
  /** La torche a été poussée : la porte dérobée est ouverte. */
  TorchMoved: 8,
  /** B.J. parle : sa tête se lève dans la chambre (`update_59_pre`). */
  BJTalking: 9,
  /** Le barman a donné l'objet 21 (le troisième choix de `OP_12` change encore). */
  DrinkGiven: 10,
  /** La conversation téléphonique de la chambre a eu lieu. */
  PhoneCalled: 11,
} as const;

/** Sortie par laquelle on entre dans la chambre depuis le couloir : `animation_19_6` joue alors (`exitRoom`, `objExit == 105`). */
export const ENTERING_BEDROOM_EXIT = 105;
