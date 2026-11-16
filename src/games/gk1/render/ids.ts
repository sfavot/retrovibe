/**
 * Constantes du compositeur graphique SCI2 (`docs/gk1/plan.md`, vague G1).
 * Valeurs relues dans `engines/sci/graphics/plane32.h`, `screen_item32.h`, `celobj32.h`, `remap32.cpp` et `palette32.cpp` de
 * ScummVM (GPL v3 ou ultérieure).
 */

/** Écran du jeu et repère des scripts : 320×200 (`plan.md`, D4). */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/**
 * Propriété `picture` d'un plan : un numéro de pic jusqu'à 65 531, sinon le genre de fond. −1 (plan coloré) est la valeur
 * de presque tous les plans du jeu avant leur premier `drawPic`.
 */
export const PLANE_PIC_MAX = 65531;
export const PLANE_PIC_OPAQUE = 65533;
export const PLANE_PIC_TRANSPARENT = 65534;
export const PLANE_PIC_COLORED = 65535;

export const PlaneType = { Colored: 0, Picture: 1, Transparent: 2, Opaque: 3 } as const;
export type PlaneType = (typeof PlaneType)[keyof typeof PlaneType];

/** Plan de fond créé par l'interpréteur : tout l'écran, priorité 0, couleur 0. Un plan de priorité négative est dessous, donc caché. */
export const DEFAULT_PLANE_PRIORITY = 0;
export const DEFAULT_PLANE_COLOR = 0;
/** `GetHighPlanePri` ignore les plans de l'interpréteur, de priorité 10 000 et plus. */
export const PLANE_PRIORITY_SYSTEM = 10000;

/** Propriété `scaleSignal` (deux bits de poids faible) : pas d'échelle, échelle donnée par `scaleX` / `scaleY`, échelle tirée de la profondeur. */
export const ScaleSignal = { None: 0, Manual: 1, VanishingPoint: 2 } as const;
export const SCALE_SIGNAL_MASK = 3;
/** Dénominateur des échelles : 128 = taille réelle. */
export const SCALE_ONE = 128;

/**
 * Couleurs de remplacement (`RemapColors`) : 19 couleurs à partir de 236 en SCI2. Un cel de vue qui en contient ne dessine
 * aucune couleur à partir de 236 tant qu'aucun remplacement n'est actif.
 */
export const REMAP_START_COLOR = 236;
export const REMAP_END_COLOR = 254;

/** Palette chargée au démarrage de l'interpréteur. */
export const DEFAULT_PALETTE = 999;
/** Dernière couleur que la palette du jeu peut fixer ; la suivante (255) est toujours blanche. */
export const PALETTE_LAST_COLOR = 254;
export const PALETTE_WHITE = 255;
/** Pourcentage de `Palette SetFade` sans effet. */
export const FADE_NONE = 100;

/** `Graph` : sous-fonction « nombre de couleurs de l'écran » et sa réponse. */
export const GRAPH_GET_COLORS = 1;
export const SCREEN_COLORS = 256;

/** `Palette` : sous-fonctions. */
export const PaletteOp = { SetFromResource: 1, SetFade: 2, FindColor: 3 } as const;

/** `PalVary` : sous-fonctions (le jeu appelle 0 à 3 et 8). */
export const PalVaryOp = { SetVary: 0, SetPercent: 1, GetPercent: 2, Off: 3, MergeTarget: 4, SetTime: 5, PauseResume: 6, SetTarget: 7, SetStart: 8, MergeStart: 9 } as const;
/** Pourcentage d'une variation complète, et plage de couleurs qu'elle touche par défaut. */
export const VARY_FULL = 100;

/** `PalCycle` : sous-fonctions. */
export const PalCycleOp = { SetCycle: 0, DoCycle: 1, Pause: 2, On: 3, Off: 4 } as const;
/** Nombre de cycles de couleurs simultanés. */
export const PAL_CYCLERS = 10;

/** `RemapColors` : sous-fonctions de SCI2 portées. */
export const RemapOp = { Off: 0, ByRange: 1, ByPercent: 2 } as const;
export const RemapType = { None: 0, ByRange: 1, ByPercent: 2 } as const;
export type RemapType = (typeof RemapType)[keyof typeof RemapType];

/** `SetShowStyle` : transitions de SCI2 (14 types, plus « aucune »). */
export const ShowStyle = {
  None: 0,
  HShutterOut: 1,
  HShutterIn: 2,
  VShutterOut: 3,
  VShutterIn: 4,
  WipeLeft: 5,
  WipeRight: 6,
  WipeUp: 7,
  WipeDown: 8,
  IrisOut: 9,
  IrisIn: 10,
  DissolveNoMorph: 11,
  Dissolve: 12,
  FadeOut: 13,
  FadeIn: 14,
} as const;
/** Nombre d'étapes d'une transition quand l'appel n'en donne pas, par type. */
export const SHOW_STYLE_DIVISIONS = [1, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 40, 40, 101, 101] as const;
/** Couleur transparente du bitmap d'une dissolution (`kDefaultSkipColor` de ScummVM). */
export const DISSOLVE_SKIP_COLOR = 250;
/** Couleur de fond « aucune » de `SetShowStyle` : la transition part de l'image (ou du noir) au lieu d'y aller. */
export const SHOW_STYLE_NO_BACK = -1;

/** `ShakeScreen` : directions (bits), décalage de l'image en pixels et durée d'une demi-secousse en ticks. */
export const SHAKE_VERTICAL = 1;
export const SHAKE_HORIZONTAL = 2;
export const SHAKE_OFFSET = 4;
export const SHAKE_HALF_TICKS = 3;
/** Ticks entre deux pas d'un défilement (`SetScroll`) : 33 ms. */
export const SCROLL_STEP_TICKS = 2;

/** Alignement d'un texte (propriété `mode`, code `|a…|`). */
export const TextAlign = { Left: 0, Center: 1, Right: 2 } as const;
/** `CreateTextBitmap` : bitmap aux dimensions données, ou aux dimensions d'un cel de vue dessiné dessous. */
export const TextBitmapOp = { Sized: 0, FromView: 1 } as const;
/** `TextSize` sans largeur maximale : trois cinquièmes de l'écran. */
export const TEXT_DEFAULT_WIDTH = (SCREEN_WIDTH * 3) / 5;
/** Police de repli quand une police demandée manque. */
export const FALLBACK_FONT = 0;
/** Couleur de bord « aucune » d'un bitmap de texte. */
export const TEXT_NO_BORDER = -1;

/** `SetCursor(−2)` : lève la zone de déplacement. Couleur transparente de l'image du curseur. */
export const CURSOR_CLEAR_AREA = -2;
export const CURSOR_SKIP_COLOR = 255;
