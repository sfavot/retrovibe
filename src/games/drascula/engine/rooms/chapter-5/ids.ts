/**
 * Numéros d'objets du chapitre 5 (`objectNum` des fiches `45.ALD`, `49.ALD` à `57.ALD`, comme ils sont comparés dans `room_49` à
 * `room_56` de ScummVM), objets de l'inventaire (feuille `icons3.alg`) et drapeaux qu'il emploie. Les noms viennent du français des
 * fiches et des répliques (`roomActions` des pièces 200 et 201).
 */

/** Pièces du château. */
export const Room = {
  Towers: 45,
  Office: 49,
  Tower1: 50,
  Tower2: 51,
  Tower3: 52,
  Laboratory: 53,
  Crypt: 54,
  Workshop: 55,
  Coffin: 56,
  Corridor: 57,
} as const;

/** Les quatre tours (pièce 45, la carte du château). La quatrième n'apparaît qu'une fois le loup-garou parti. */
export const Towers = { Tower1: 100, Tower2: 101, Tower3: 102, Tower4: 103 } as const;

/** Bureau du loup-garou (pièce 49). */
export const Office = {
  DoorLeft: 109,
  /** La porte du fond, ouverte par le départ du loup-garou. */
  DoorRight: 110,
  Werewolf: 51,
  Poster: 200,
  Desk: 201,
  Diploma: 202,
  Window: 203,
} as const;

/** Laboratoire (pièce 53). */
export const Laboratory = {
  Door: 116,
  Frankenstein: 52,
  /** La prise murale. */
  Socket: 121,
  /** La fiche, par terre (la prise qu'on ramasse, objet 16 de l'inventaire). */
  FloorPlug: 120,
  Switch: 123,
  Machine: 209,
} as const;

/** Crypte (pièce 54). */
export const Crypt = {
  Door: 115,
  /** La porte de la cellule de B.J. */
  Cell: 118,
  Padlock: 119,
  Bone: 9999,
  Skeleton: 53,
} as const;

/** Atelier (pièce 55). */
export const Workshop = { Door: 117, Screw: 122, Camera: 204, Alarm: 205, TrappedDoor: 206 } as const;

/** Chambre du cercueil (pièce 56). */
export const CoffinRoom = { Door: 105, Coffin: 124, Clock: 207, Table: 208 } as const;

/** Objets de l'inventaire du chapitre 5. */
export const Item = {
  Bone: 8,
  /** Épingle de B.J. (scénario 3 : `pickObject(10)`). */
  Pin: 10,
  /** Vis prise dans l'atelier. */
  Screw: 12,
  Brain: 15,
  /** La fiche du laboratoire : elle ne revient pas dans l'inventaire (`selectVerb`, `chooseObject`). */
  Plug: 16,
  /** L'objet dont `checkAction` regarde la réplique (482, 483). */
  Cross: 9,
} as const;

/** Drapeaux du chapitre 5 (`flags[n]`), selon la pièce où ils servent. */
export const Flag = {
  /** Crypte : B.J. a été vue, la scène d'introduction (`animation_1_5`) ne se rejoue pas. */
  BjMet: 0,
  /** Laboratoire : Frankenstein est réveillé (il n'est plus sur la table). */
  FrankensteinAwake: 1,
  /** Laboratoire : la fiche est dans la prise. */
  PlugConnected: 2,
  /** Laboratoire : la vis est en place. */
  ScrewFitted: 3,
  /** Laboratoire : le cerveau est en place. */
  BrainFitted: 4,
  /** Bureau : le loup-garou est parti (l'os est lancé), la quatrième tour s'ouvre. */
  WerewolfGone: 6,
  /** Bureau : la scène d'arrivée (scénario 4) a été jouée. */
  WerewolfMet: 7,
  /** Atelier : la vis est prise. */
  ScrewTaken: 8,
  /** Laboratoire : l'interrupteur est enclenché. */
  SwitchOn: 9,
  /** Chambre du cercueil : la porte de l'horloge est ouverte. */
  ClockOpen: 10,
  /** Chambre du cercueil : le cercueil est ouvert. */
  CoffinOpen: 11,
  /** Crypte : le squelette parle. */
  SkeletonTalking: 12,
  /** Crypte : l'os est pris. */
  BoneTaken: 13,
  /** Crypte : on a déjà parlé au squelette. */
  SkeletonSpoke: 14,
} as const;
