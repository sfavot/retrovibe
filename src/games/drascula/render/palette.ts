import { PALETTE_BYTES, PALETTE_ENTRIES } from "../../../ui/indexed-canvas";

/**
 * Palettes de *Drascula* : palette du jeu en 6 bits (`gamePalette`), niveaux de lumière d'une pièce, fondus, couleur du texte.
 * Réécriture de `setRGB`, `setPalette`, `black`, `color_abc`, `fadeToBlack`, `fadeFromBlack`, `assignPalette`,
 * `setDefaultPalette` et `setPaletteBase` (engines/drascula/palette.cpp, ScummVM) ; `loadPic` (graphics.cpp) pour `HALF_PAL`.
 *
 * Fonctionnement (lu dans ScummVM) : le jeu garde **une** palette de 256 couleurs en 6 bits (valeur du fichier divisée par 4).
 * Une image chargée en `COMPLETE_PAL` la remplace entièrement, une image chargée en `HALF_PAL` n'en remplace que les 128
 * premières : les 128 dernières (héros, interface) sont celles de `96.ALG`. Les couleurs 235 à 252 portent la lumière de la
 * pièce : `enterRoom` en fait deux versions, `bright` (niveau de la fiche) et `dark` (niveau + 2), que les pièces échangent
 * selon la position du héros. La couleur 254 est celle du texte (les glyphes de `95.ALG` sont en 254) ; `color_abc` la change.
 * L'écran reçoit la palette 6 bits multipliée par 4 (`setPalette`), les deux bits de poids faible sont donc perdus.
 *
 * Écart : ScummVM change la palette de l'écran dans les boucles de fondu (64 pas de `pause(vitesse)`) ; ici le fondu est une
 * séquence du moteur (`fadeToBlack` de `loop.ts`) qui appelle `fade()` à chaque pas.
 */

/** Nombre de couleurs que `loadPic` applique à la palette du jeu : `COMPLETE_PAL` 256, `HALF_PAL` 128 (défaut : 1). */
export const COMPLETE_PAL = 256;
export const HALF_PAL = 128;
/** Couleurs de la lumière de la pièce : 235 à 252 (`assignPalette`, `setDefaultPalette`, `setPaletteBase`). */
export const LIGHT_FIRST = 235;
export const LIGHT_END = 253;
/** Couleur du texte (`color_abc`) et couleur de l'écran noir (`black`). */
export const TEXT_COLOR = 254;

/** Couleurs du texte (`kColor*`, drascula.h) : l'indice de `TEXT_COLORS`. */
export const TextColor = {
  Black: 0,
  Brown: 1,
  DarkBlue: 2,
  LightGreen: 3,
  DarkGreen: 4,
  Yellow: 5,
  Orange: 6,
  Red: 7,
  Maroon: 8,
  Purple: 9,
  White: 10,
  Pink: 11,
} as const;

/**
 * `colorTable` de ScummVM, en 6 bits. Les entrées 0, 2 et 6 sont « inutilisées » (noir). La dernière (rose) a des valeurs
 * hors des 6 bits (98, 91, 100) : multipliées par 4 puis tronquées à un octet, elles donnent (136, 108, 144), comme à l'écran.
 */
const TEXT_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0x10, 0x3e, 0x28],
  [0, 0, 0],
  [0x16, 0x3f, 0x16],
  [0x09, 0x3f, 0x12],
  [0x3f, 0x3f, 0x15],
  [0, 0, 0],
  [0x38, 0, 0],
  [0x3f, 0x27, 0x0b],
  [0x2a, 0, 0x2a],
  [0x30, 0x30, 0x30],
  [98, 91, 100],
];

/** `adjustToVGA` : valeur 6 bits d'un niveau, 0 si elle est négative (le test `value > 0` de ScummVM). */
function adjustToVga(value: number): number {
  return value > 0 ? value & 0x3f : 0;
}

/** Palette 6 bits (`gamePalette`) -> RVB 8 bits envoyé à l'écran (`setPalette` : x 4, tronqué à un octet). */
function toScreen(palette6: Int8Array, out: Uint8Array): void {
  for (let i = 0; i < PALETTE_BYTES; i++) out[i] = (palette6[i] & 0xff) * 4;
}

export class GamePalette {
  /** `gamePalette` : 256 couleurs en 6 bits. */
  readonly game = new Int8Array(PALETTE_BYTES);
  /** `defaultPalette`, `brightPalette`, `darkPalette` : seules les couleurs 235 à 252 servent. */
  readonly defaults = new Int8Array(PALETTE_BYTES);
  readonly bright = new Int8Array(PALETTE_BYTES);
  readonly dark = new Int8Array(PALETTE_BYTES);
  /** Palette affichée (RVB 8 bits) : la dernière envoyée à l'écran (`setPalette`). */
  readonly shown = new Uint8Array(PALETTE_BYTES);
  /** Couleur courante du texte (`_color`). */
  textColor: number = TextColor.Black;

  /** Envoie la palette du jeu à l'écran (`setPalette(gamePalette)`). */
  show(): void {
    toScreen(this.game, this.shown);
  }

  /**
   * `setPalette(buffer)` de ScummVM appliqué à une palette qui n'est pas celle du jeu (blocs palette des `.BIN`, premier cadre
   * d'une animation) : `palette6` (768 octets, 6 bits) est envoyée à l'écran telle quelle, la palette du jeu n'est pas touchée.
   */
  showExternal(palette6: Uint8Array): void {
    for (let i = 0; i < PALETTE_BYTES; i++) this.shown[i] = (palette6[i] & 0xff) * 4;
  }

  /**
   * `loadPic(..., colorCount)` -> `setRGB` : les `count` premières couleurs de la palette 8 bits du fichier (divisées par 4)
   * deviennent celles du jeu. `loadPic` sans nombre de couleurs n'en applique qu'une (la couleur 0).
   */
  setRgb(palette8: Uint8Array, count: number): void {
    const bytes = Math.min(count, PALETTE_ENTRIES) * 3;
    for (let i = 0; i < bytes; i++) this.game[i] = palette8[i] >> 2;
    this.show();
  }

  /** `color_abc` : couleur du texte (indice de `TextColor`). */
  setTextColor(color: number): void {
    this.textColor = color;
    const [r, g, b] = TEXT_COLORS[color] ?? TEXT_COLORS[0];
    this.game[TEXT_COLOR * 3] = r;
    this.game[TEXT_COLOR * 3 + 1] = g;
    this.game[TEXT_COLOR * 3 + 2] = b;
    this.show();
  }

  /** `black` : écran noir, sauf la couleur 254 (jaune) ; la palette du jeu n'est pas touchée. */
  black(): void {
    this.shown.fill(0);
    this.shown[TEXT_COLOR * 3] = 0x3f * 4;
    this.shown[TEXT_COLOR * 3 + 1] = 0x3f * 4;
    this.shown[TEXT_COLOR * 3 + 2] = 0x15 * 4;
  }

  /**
   * Un pas de fondu (`fadeToBlack`, `fadeFromBlack`) : `level` va de 0 (noir) à 63 (palette du jeu). Chaque composante perd
   * `63 - level`. La palette du jeu n'est pas touchée.
   */
  fade(level: number): void {
    const faded = new Int8Array(PALETTE_BYTES);
    for (let i = 0; i < PALETTE_BYTES; i++) faded[i] = adjustToVga(this.game[i] - 63 + level);
    toScreen(faded, this.shown);
  }

  /** `assignPalette(pal)` : range les couleurs de lumière du jeu dans `target`. */
  assign(target: Int8Array): void {
    target.set(this.game.subarray(LIGHT_FIRST * 3, LIGHT_END * 3), LIGHT_FIRST * 3);
  }

  /** `setDefaultPalette(pal)` : les couleurs de lumière de `source` deviennent celles du jeu. */
  useLight(source: Int8Array): void {
    this.game.set(source.subarray(LIGHT_FIRST * 3, LIGHT_END * 3), LIGHT_FIRST * 3);
    this.show();
  }

  /**
   * `setPaletteBase(darkness)` : assombrit les couleurs de lumière du jeu. La boucle de ScummVM retire `8 - fade` à chaque
   * `fade` de `darkness` à 0 (avec `adjustToVGA` à chaque passe) : plus `darkness` est grand, plus c'est sombre.
   */
  setBase(darkness: number): void {
    for (let fade = darkness; fade >= 0; fade--) {
      for (let i = LIGHT_FIRST * 3; i < LIGHT_END * 3; i++) this.game[i] = adjustToVga(this.game[i] - 8 + fade);
    }
    this.show();
  }

  /** Mémorise la lumière actuelle du jeu comme lumière de base (`assignPalette(defaultPalette)`, début de chapitre). */
  saveDefault(): void {
    this.assign(this.defaults);
  }

  /**
   * Lumière d'une pièce (fin d'`enterRoom`) : `bright` = base assombrie du niveau de la fiche, `dark` = niveau + 2 ; la pièce
   * démarre en `bright`. L'ordre des appels est celui de ScummVM (`setPaletteBase` modifie la palette du jeu).
   */
  setRoomLevel(level: number): void {
    this.useLight(this.defaults);
    if (level !== 0) this.setBase(level);
    this.assign(this.bright);
    this.useLight(this.defaults);
    this.setBase(level + 2);
    this.assign(this.dark);
    this.useLight(this.bright);
  }
}

// --- Palettes des fichiers (utilisées aussi par la visionneuse) --------------------------------------------------------

/** Palette 8 bits (768 octets) -> RVB affiché par ScummVM : le jeu divise par 4 puis remultiplie par 4 (`setRGB`, `setPalette`). */
export function scummvmRgb8(palette: Uint8Array): Uint8Array {
  return palette.map((value) => value & 0xfc);
}

/** Palette 6 bits (`.BIN`) -> RVB affiché. */
export function scummvmRgb6(palette: Uint8Array): Uint8Array {
  return palette.map((value) => (value & 0x3f) << 2);
}

/** Nombre de couleurs propres à une image chargée en `HALF_PAL` ; les suivantes (héros, interface) restent celles du jeu. */
export const HALF_PAL_COLORS = HALF_PAL;

/** `HALF_PAL` : les 128 premières couleurs viennent de l'image, les 128 dernières de la palette réservée du jeu. */
export function halfPalette(image: Uint8Array, reserved: Uint8Array): Uint8Array {
  const out = image.slice();
  out.set(reserved.subarray(HALF_PAL_COLORS * 3), HALF_PAL_COLORS * 3);
  return out;
}
