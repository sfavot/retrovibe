/**
 * Numéros des séquences plein écran : ressources des écrans, animations et palettes de l'introduction, numéros de sons
 * (`engines/lure/intro.cpp`, `luredefs.h`, `scripts.cpp`, `game.cpp` de ScummVM, GPL v3+). Les ressources du jeu et de la fin sont dans
 * `DiskResId` (`data/ids.ts`).
 */

import type { AnimSound } from "./animation";

/** Écrans fixes du début de l'introduction (`start_screens`) : l'identifiant de la palette est celui de l'écran + 1. Le dernier est le titre. */
export const INTRO_START_SCREENS = [0x18, 0x1a, 0x1e, 0x1c] as const;
/** Écran de la bataille finale de l'introduction et sa palette, montrés 33,3 s. */
export const INTRO_FINAL_SCREEN = 0x22;
export const INTRO_FINAL_PALETTE = 0x21;
/** Animation des images de bataille (images montrées une à une) et sa palette dans la collection. */
export const INTRO_BATTLE_ANIM = 0x48;
export const INTRO_BATTLE_PALETTE_INDEX = 4;
/** Durée d'affichage de chaque écran fixe (ms). */
export const INTRO_SCREEN_MS = 5000;
export const INTRO_FINAL_MS = 33300;
/** Images de bataille : durée de chaque image puis du noir entre deux images (ms). */
export const INTRO_BATTLE_SHOW_MS = 2000;
export const INTRO_BATTLE_BLACK_MS = 500;
/** Attente après le fondu de la musique, avant d'enchaîner (ms). */
export const INTRO_MUSIC_GAP_MS = 500;

/** Pas de la musique du fondu avant un changement de morceau (ms soustraites à la pause de transition). */
export const INTRO_FADE_LEAD_MS = 3500;
/** Sans son : pas de morceau à lancer. */
export const NO_SOUND = 0xff;

/** `AnimRecord` (intro.cpp). Les durées sont en 50e de seconde. */
export interface IntroAnim {
  /** Ressource de l'animation (celle des lignes est `+ 1`). */
  resourceId: number;
  /** Rang de la palette dans la collection `0x32`. */
  paletteIndex: number;
  /** Attente avant de jouer l'animation. */
  initialPause: number;
  /** Attente sur la dernière image. */
  endingPause: number;
  /** Morceau lancé avec l'animation (`0xFF` : aucun). */
  soundNumber: number;
  /** Le morceau est fondu avant la transition vers le suivant. */
  fadeOutSound: boolean;
  /** Attente sur la dernière image avant de lancer le morceau suivant. */
  soundTransitionPause: number;
  /** Morceau lancé sur la dernière image (`0xFF` : aucun). */
  soundNumber2: number;
}

/**
 * `anim_screens`. Écart de ScummVM (commentaire de son auteur) à garder : la pause de fin de la première est d'environ 14 s au lieu des
 * 8 s de l'original (trop court pour lire l'écran).
 */
export const INTRO_ANIMS: readonly IntroAnim[] = [
  { resourceId: 0x40, paletteIndex: 0, initialPause: 0x314, endingPause: 0x2be, soundNumber: 0x00, fadeOutSound: true, soundTransitionPause: 0x1f4, soundNumber2: 0x01 },
  { resourceId: 0x42, paletteIndex: 1, initialPause: 0, endingPause: 0x5fa, soundNumber: 0x01, fadeOutSound: false, soundTransitionPause: 0, soundNumber2: NO_SOUND },
  { resourceId: 0x44, paletteIndex: 2, initialPause: 0, endingPause: 0, soundNumber: 0x02, fadeOutSound: false, soundTransitionPause: 0, soundNumber2: NO_SOUND },
  { resourceId: 0x24, paletteIndex: 3, initialPause: 0, endingPause: 0x62c + 0x24, soundNumber: NO_SOUND, fadeOutSound: false, soundTransitionPause: 0x328, soundNumber2: 0x03 },
  { resourceId: 0x46, paletteIndex: 3, initialPause: 0, endingPause: 0, soundNumber: 0x03, fadeOutSound: false, soundTransitionPause: 0, soundNumber2: NO_SOUND },
];

/** Animation de l'écran « Cliff overhang » : images plus rapides (`frameDelay` 4 au lieu de 7). */
export const INTRO_FAST_ANIM = 0x44;
export const INTRO_FAST_FRAME_DELAY = 4;

/** Sons de la capture par le Skorl (`catchSound`) : 12 images sans son, puis le son 41 sur une image. */
export const CATCH_SOUNDS: readonly AnimSound[] = [
  { numFrames: 12, adlibSoundId: 0xff, rolandSoundId: 0xff, channelNum: 1, music: false },
  { numFrames: 1, adlibSoundId: 41, rolandSoundId: 41, channelNum: 1, music: false },
];
export const CATCH_FRAME_DELAY = 5;

/** Sons de l'animation de la fin (`soundList` de scripts.cpp), numéros AdLib. */
export const ENDGAME_SOUNDS: readonly AnimSound[] = [
  { numFrames: 9, adlibSoundId: 0xff, rolandSoundId: 0xff, channelNum: 0, music: false },
  { numFrames: 27, adlibSoundId: 0x45, rolandSoundId: 2, channelNum: 0, music: true },
  { numFrames: 24, adlibSoundId: 0x48, rolandSoundId: 5, channelNum: 0, music: false },
  { numFrames: 24, adlibSoundId: 0x46, rolandSoundId: 3, channelNum: 2, music: false },
  { numFrames: 3, adlibSoundId: 0x37, rolandSoundId: 1, channelNum: 0, music: true },
  { numFrames: 3, adlibSoundId: 0x37, rolandSoundId: 1, channelNum: 1, music: true },
  { numFrames: 3, adlibSoundId: 0x37, rolandSoundId: 1, channelNum: 2, music: true },
  { numFrames: 3, adlibSoundId: 0x37, rolandSoundId: 1, channelNum: 3, music: true },
  { numFrames: 4, adlibSoundId: 0x37, rolandSoundId: 1, channelNum: 4, music: true },
  { numFrames: 7, adlibSoundId: 0x37, rolandSoundId: 1, channelNum: 5, music: true },
  { numFrames: 31, adlibSoundId: 0x47, rolandSoundId: 4, channelNum: 6, music: false },
];
export const ENDGAME_FRAME_DELAY = 9;
/** Musique de la fin (AdLib) après la première animation, et pendant les deux dernières (section « fin »). */
export const ENDGAME_SOUND_AFTER = 0x28;
export const ENDGAME_SOUND_FINAL = 0;
export const ENDGAME_PAUSE_MS = 5500;
export const ENDGAME_CREDITS_MS = 30500;

/** Chute dans le trou (`Game::displayChuteAnimation`) : musique, images plus lentes de la deuxième animation (jouée 4 fois). */
export const CHUTE_SOUND = 0x40;
export const CHUTE2_FRAME_DELAY = 5;
export const CHUTE2_LOOPS = 4;
/** Tonneau (`Game::displayBarrelAnimation`) : musique. */
export const BARREL_SOUND = 0x3b;
