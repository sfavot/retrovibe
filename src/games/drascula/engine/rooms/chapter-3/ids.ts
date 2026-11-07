/**
 * Numéros d'objets du chapitre 3 (`objectNum` des fiches `13.ALD` et `20.ALD`, comme ils sont comparés dans `room_13` de ScummVM),
 * objets de l'inventaire et drapeaux qu'il emploie. Les noms viennent du français des fiches.
 */

/** Pièce 13 : le vampire qui garde le passage (« il ressemble à Yoda »). */
export const Gate = {
  /** Porte vers la pièce 20 (sortie 100). */
  Door: 101,
  Vampire: 51,
} as const;

/** Pièce 20, la pièce de départ du chapitre. */
export const Start = {
  /** Porte vers la pièce 13 (sortie 101). */
  Door: 100,
  /** Point d'arrivée du chapitre (`objExit = 99`), invisible. */
  Arrival: 99,
} as const;

/** Objets de l'inventaire du chapitre 3 (`kItemCross`, `kItemOneCoin`). */
export const Item = {
  Cross: 9,
  Coin: 19,
} as const;

/** Drapeaux du chapitre 3 (`flags[n]`, tous à 0 au départ sauf `AwakeHidden`). */
export const Flag = {
  /** Le héros est dessiné dans sa pose fixe d'attaque (`updateRoom` du chapitre 3), au lieu de marcher. */
  Attacking: 0,
  /** Levé : l'image du vampire réveillé n'est pas dessinée (levé au départ du chapitre, `run()`). */
  AwakeHidden: 1,
  /** Levé : l'image du vampire endormi n'est pas dessinée. */
  AsleepHidden: 2,
  /** Le vampire s'est réveillé (`animation_6_3` jouée). */
  VampireWoke: 3,
} as const;

/** Répliques du héros devant le vampire (`room_13`). */
export const Speech = {
  LookFirst: 411,
  LookSecond: 412,
  CoinOffer: 413,
  CoinRefused: 414,
} as const;

/** Dialogue (`converse`) avec le vampire. */
export const VAMPIRE_CONVERSATION = 7;
