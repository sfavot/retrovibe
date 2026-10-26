/**
 * Types d'entrée du rendu logiciel : la vue décrite par la simulation (caméra, objets, sprites, temps) et le rectangle
 * d'affichage. Le rendu ne connaît pas la simulation : il lit seulement ces structures (`docs/swiv3d/render.md`).
 *
 * Unités : positions en unités monde (64 par cellule de carte, 4 unités par pas de hauteur), angles en pas de 1/512 de tour,
 * le monde est torique (512 cellules, soit 32768 unités) : les positions sont repliées autour de la caméra.
 */

/** Image indexée 8 bits : 320 colonnes × 400 lignes (mode X du jeu, pixels non carrés : à afficher en 4:3). */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 400;

/** Rectangle 3D plein écran (`Screen Size` = 255, `viewport()` de `render.md` §1). */
export const VIEWPORT = {
  left: 0,
  right: SCREEN_WIDTH - 1,
  top: 0,
  bottom: SCREEN_HEIGHT - 1,
  /** `top - 1` : ligne de découpe du haut (le jeu écrit sur `top - 1`, en dehors de l'image visible). */
  clipTop: -1,
} as const;

/** Côté du monde torique en unités monde (512 cellules de 64). */
export const WORLD_SIZE = 512 * 64;

/** Replie une différence de coordonnées dans `[-WORLD_SIZE / 2, WORLD_SIZE / 2[` (monde torique). */
export const wrapDelta = (d: number): number => ((d + WORLD_SIZE / 2) & (WORLD_SIZE - 1)) - WORLD_SIZE / 2;

export interface RenderCamera {
  /** Position de l'œil, en unités monde (`y` : altitude, 4 unités par pas de la carte de hauteur). */
  x: number;
  y: number;
  z: number;
  /** Cap (pas de 1/512 de tour) : 0 regarde vers +z, 128 vers +x. */
  yaw: number;
  /** Élévation de la caméra, comme `view[4]` du jeu (15..100 en poursuite) : **positif = regarde vers le bas**. */
  pitch: number;
  /** Gîte (`view[13]`) : flottant borné à ±0,5, composante verticale du vecteur « droite » de la caméra. 0 par défaut. */
  roll?: number;
}

/** Bits de `RenderObject.flags`. */
export const OBJECT_BILLBOARD = 1; // `obj+4` bit 0x80 : toujours de face à la caméra (cap = cap de la caméra)
export const OBJECT_FULL_BRIGHT = 2; // `obj+6` bit 1 : toutes les lumières à 0x7f (plein feu)
export const OBJECT_NO_TEXTURE_ANIM = 4; // `obj+6` bit 0 : pas d'animation de texture
export const OBJECT_FAST_ANIM = 8; // `obj+6` bit 4 : animation de texture à la cadence de l'image (sinon image / 4)

export interface RenderObject {
  /** Emplacement du modèle (`id % 1000` : 990 pour le joueur, 10990 est accepté). Un modèle inconnu est ignoré. */
  modelId: number;
  /** Position monde ; `y` est le point d'origine du modèle (pour un objet posé : hauteur du sol moins `groundOffset`). */
  x: number;
  y: number;
  z: number;
  /** Orientation (pas de 1/512 de tour). */
  yaw: number;
  pitch: number;
  roll: number;
  /** Combinaison de `OBJECT_*`. */
  flags?: number;
  /** Image de `GLOBAL 504` qui habille les faces de type 5 (`obj[0x14]`). */
  skin?: number;
}

/** Jeux de sprites : `GLOBAL 504` (explosion 64×64 mise à l'échelle) et `GLOBAL 505` (sprite 21×35 à taille fixe). */
export type SpriteSet = 504 | 505;

export interface RenderSprite {
  /** 504 : `frame` = image 0..55, mise à l'échelle selon la distance et `size`. 505 : `frame` = série 0..5 (taille choisie par la distance). */
  setId: SpriteSet;
  frame: number;
  x: number;
  y: number;
  z: number;
  /** 504 seulement : demi-taille monde (`W[slot - 11000]` du jeu : 15, 10, 35, 40, 23…). 23 par défaut. */
  size?: number;
}

export interface RenderView {
  camera: RenderCamera;
  objects: readonly RenderObject[];
  sprites: readonly RenderSprite[];
  /** Pas de simulation (40 Hz) : anime l'eau, les textures animées et le rotor. */
  time: number;
  /** `waterMode` du jeu : bit 0 = vagues sur le terrain, bit 1 = hauteur « avec vagues » pour les objets ; 3 par défaut. */
  waterMode?: number;
  /**
   * Carte d'éclairs au sol `005624c8` (64×64 entiers, case `(cz & 63) · 64 + (cx & 63)` pour le sommet `(cx, cz)`) : sa valeur
   * s'ajoute à la lumière des sommets du terrain. Absente : aucun éclair.
   */
  groundFlash?: Int32Array;
}
