/**
 * Numéros d'objets du chapitre 1 (`objectNum` des fiches `62.ALD` et `63.ALD`, comme ils sont comparés dans `room_62` et
 * `exitRoom` de ScummVM) et drapeaux qu'il emploie. Les noms viennent du français des fiches.
 */

/** Auberge (pièce 62). */
export const Inn = {
  Barman: 52,
  Drunk: 53,
  Pianist: 54,
  Skull: 100,
  Bin: 101,
  Poster1: 102,
  Poster2: 103,
  /** Porte de la rue : condamnée (le moteur met `isDoor` à faux, `enterRoom`). */
  Street: 104,
  /** Porte du fond : la cinématique de B.J. (`animation_2_1`), refusée tant que le barman n'a pas parlé. */
  Back: 105,
  /** Porte vers les toilettes (pièce 63, sortie 107). */
  Toilets: 106,
} as const;

/** Arrière-salle (pièce 63). */
export const Toilets = {
  Door: 107,
  /** Sur la fiche française il porte le numéro 103, comme l'affiche de l'auberge ; `roomActions` répond à 108 (voir `rooms.md`). */
  VendingMachine: 103,
  Curtain: 109,
  Papers: 110,
} as const;

/** Drapeaux du chapitre 1 (`flags[n]`). */
export const Flag = {
  /** Le barman a parlé : la porte du fond s'ouvre (`playTalkSequence(3)` le lève). */
  BarmanSpoke: 0,
  /** Le pianiste est tourné vers le héros (le temps de sa conversation). */
  PianistTalking: 11,
  /** L'ivrogne fait son geste (animation de l'auberge). */
  DrunkGesture: 12,
  /** L'ivrogne parle (`talk_drunk`). */
  DrunkTalking: 13,
} as const;

/** Réplique du héros quand la porte du fond est refusée (`talk(442)`). */
export const REFUSED_DOOR_SPEECH = 442;
