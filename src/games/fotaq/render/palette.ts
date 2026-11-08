/**
 * Palettes de *Flight of the Amazon Queen* : palette de la pièce, palette du panneau, palette envoyée à l'écran, lumière dynamique,
 * tenues de Joe, fondus, couleurs qui tournent. Réécriture de la partie « palette » de `Display` (engines/queen/display.cpp,
 * ScummVM, GPL v3 ou ultérieure) : `palFadeIn`, `palFadeOut`, `palSetPanel`, `palSetJoeDress`, `palSetJoeNormal`, `palGreyPanel`,
 * `palScroll`, `palCustomColors`, `palCustomScroll`, `palCustomFlash`, `palCustomLightsOff`, `palCustomLightsOn`,
 * `dynalumUpdate`, `getNumColorsForRoom`, `isPalFadingDisabled`, et le choix des couleurs gardées de `setupNewRoom`.
 *
 * Fonctionnement (lu dans ScummVM, version DOS) : le jeu garde trois palettes de 256 couleurs en RVB 8 bits. `room` est celle de la
 * pièce : les couleurs 0 à 143 viennent du décor (toutes les 256 pour les pièces 114 à 125), 144 à 255 du panneau (`PANEL.PCX`) ;
 * les couleurs 144 à 159 sont celles de Joe, changées par la tenue et par la lumière dynamique. `screen` est celle qui est montrée :
 * elle reprend `room` à chaque `palFadeIn`, la lumière et les couleurs qui tournent la modifient, un fondu de sortie la ramène à
 * zéro. Le fondu d'entrée affiche `screen` multipliée par `i / 16` sans la modifier.
 *
 * Écarts :
 * - ScummVM change la palette de l'écran dans des boucles de 17 pas de 20 ms ; ici un fondu est une séquence du moteur de 4
 *   images de logique (400 ms, pas de 4 / 16 : `FADE_TICKS`) ; la palette montrée est calculée à la demande (`shown`) ;
 * - `palGreyPanel` et `palCustomFlash` envoient une palette temporaire à l'écran : `shown` la reflète (le gris jusqu'à
 *   `clearGrey`, l'éclair pendant une image) ;
 * - les couleurs qui tournent avancent d'un pas à chaque image du moteur (`cycle`), comme `palCustomScroll` à chaque `update`.
 */

import { type RoomLight, lightDelta, lightRowAt } from "../data/dynalum";
import { Lcg, msvcRand } from "../../../engine/rng";
import { PALETTE_BYTES } from "../../../ui/indexed-canvas";

/** Pas d'un fondu (`FADE_SPEED`) et durée du fondu du moteur en images de logique (une image = un pas de 4). */
export const FADE_SPEED = 16;
export const FADE_TICKS = 4;
/** Première couleur du panneau et de Joe, nombre de couleurs de Joe. */
export const PANEL_FIRST = 144;
export const JOE_COLORS = 16;
const COLOR_COUNT = 256;
/** Couleurs 224 à 255 : texte du panneau (gelées pendant les fondus de la plupart des pièces). */
const PANEL_TEXT_FIRST = 224;

/** `_palJoeClothes` : les 16 couleurs de Joe en vêtements normaux (et en sous-vêtements). */
const JOE_CLOTHES = new Uint8Array([
  0x00, 0x00, 0x00, 0x60, 0x60, 0x60, 0x87, 0x87, 0x87, 0xb0, 0xb0, 0xb0,
  0xda, 0xda, 0xda, 0x43, 0x34, 0x20, 0x77, 0x33, 0x1f, 0xa3, 0x43, 0x27,
  0x80, 0x45, 0x45, 0x9e, 0x5d, 0x5b, 0xb9, 0x78, 0x75, 0xdf, 0x97, 0x91,
  0x17, 0x27, 0x63, 0x1f, 0x3f, 0x83, 0x27, 0x5b, 0xa7, 0x98, 0xd4, 0xff,
]);
/** `_palJoeDress` : les 16 couleurs de Joe en robe. */
const JOE_DRESS = new Uint8Array([
  0x00, 0x00, 0x00, 0x50, 0x50, 0x50, 0x70, 0x70, 0x70, 0x90, 0x90, 0x90,
  0xc6, 0xc6, 0xc6, 0xff, 0xff, 0xff, 0x30, 0x30, 0x90, 0x47, 0x49, 0xd0,
  0x40, 0x24, 0x00, 0x79, 0x34, 0x0b, 0xb2, 0x3d, 0x22, 0xed, 0x42, 0x42,
  0x80, 0x45, 0x45, 0xa3, 0x5f, 0x5f, 0xc8, 0x7c, 0x7c, 0xec, 0x9c, 0x9c,
]);

/** `getNumColorsForRoom` : les pièces 114 à 125 ont 256 couleurs, les autres 224 (les 32 dernières sont celles du texte du panneau). */
export function colorsForRoom(room: number): number {
  return room >= 114 && room <= 125 ? 256 : 224;
}

/** `isPalFadingDisabled` : les pièces d'introduction (90 à 94, 115 à 125) n'ont ni fondu ni lumière dynamique. */
export function fadingDisabled(room: number): boolean {
  return (room >= 90 && room <= 94) || (room >= 115 && room <= 125);
}

/** Couleurs de la pièce lues dans le décor : 144 sauf pour les pièces à 256 couleurs (`setupNewRoom`). */
export function backdropColors(room: number): number {
  return colorsForRoom(room) === 256 ? 256 : PANEL_FIRST;
}

/** Rotation de couleurs d'une pièce : `mask` 0 à chaque image, sinon quand `(compteur & mask) != 0` ; `[début, fin]` inclus. */
interface Rotation {
  mask: number;
  ranges: readonly (readonly [number, number])[];
}

/** `palCustomScroll` (version DOS) : les couleurs qui tournent (eau, feu, néons…) de chaque pièce. */
const ROTATIONS: Readonly<Record<number, readonly Rotation[]>> = {
  2: [{ mask: 1, ranges: [[120, 127]] }],
  3: [{ mask: 1, ranges: [[128, 135], [136, 143]] }],
  4: [{ mask: 1, ranges: [[32, 47]] }, { mask: 0, ranges: [[64, 70], [71, 79]] }],
  5: [{ mask: 1, ranges: [[128, 135], [136, 143]] }],
  7: [{ mask: 1, ranges: [[119, 127]] }],
  8: [{ mask: 1, ranges: [[120, 127]] }],
  12: [{ mask: 1, ranges: [[112, 119], [120, 127]] }],
  25: [{ mask: 0, ranges: [[116, 123]] }],
  39: [{ mask: 0, ranges: [[112, 143]] }],
  40: [{ mask: 1, ranges: [[96, 103]] }, { mask: 3, ranges: [[104, 107]] }],
  42: [{ mask: 1, ranges: [[118, 127], [136, 143]] }],
  49: [{ mask: 0, ranges: [[101, 127]] }],
  55: [{ mask: 0, ranges: [[128, 143]] }],
  57: [{ mask: 0, ranges: [[128, 143]] }, { mask: 1, ranges: [[96, 103]] }],
  59: [{ mask: 1, ranges: [[56, 63]] }],
  62: [{ mask: 1, ranges: [[108, 119]] }],
  64: [{ mask: 1, ranges: [[112, 119], [120, 127]] }],
  74: [{ mask: 0, ranges: [[28, 31], [88, 91], [92, 95], [128, 135]] }, { mask: 1, ranges: [[136, 143]] }],
  76: [{ mask: 0, ranges: [[88, 95]] }],
  97: [{ mask: 1, ranges: [[96, 107], [108, 122]] }],
  100: [{ mask: 1, ranges: [[128, 132], [133, 137], [138, 143]] }],
  102: [{ mask: 1, ranges: [[112, 127]] }],
  125: [{ mask: 0, ranges: [[32, 63], [64, 95]] }],
};

export class Palette {
  /** `_pal.room`, `_pal.screen` : 256 couleurs RVB 8 bits. */
  readonly room = new Uint8Array(PALETTE_BYTES);
  readonly screen = new Uint8Array(PALETTE_BYTES);
  /** `_pal.panel` : couleurs 144 à 255 de `PANEL.PCX`. */
  readonly panel = new Uint8Array((COLOR_COUNT - PANEL_FIRST) * 3);
  /** Les couleurs qui tournent et les fondus de sortie sont suspendus (`_pal.scrollable`). */
  scrollable = true;
  /** La pièce est sans lumière (`lightsOff` joué, ni `lightsOn` ni nouvelle pièce depuis) : la sauvegarde le garde. */
  dark = false;

  private readonly shownBuffer = new Uint8Array(PALETTE_BYTES);
  /** Fondu d'entrée en cours : nombre de couleurs concernées et niveau (0 à 16). */
  private fade: { colors: number; level: number } | null = null;
  private greyed = false;
  private flashing = false;
  private light: RoomLight | null = null;
  private lightWidth = 0;
  private prevColMask = 0xff;
  private scrollCount = 0;
  /** État des pulsations des pièces 123 et 124 (variables `static` de `palCustomScroll`). */
  private pulse = { 123: { j: 0, dir: 2 }, 124: { j: 0, dir: 2 } };
  private readonly rnd = new Lcg(1, msvcRand);

  // --- Panneau, tenue, pièce ------------------------------------------------------------------------------------------------

  /** `setupPanel` : les couleurs 144 à 255 de la palette de `PANEL.PCX` (768 octets) deviennent celles du panneau. */
  setPanelColors(pcxPalette: Uint8Array): void {
    this.panel.set(pcxPalette.subarray(PANEL_FIRST * 3, COLOR_COUNT * 3));
    this.useBasePanel();
  }

  /** `palSetPanel` : le panneau (et donc Joe, en vêtements du panneau) redevient la palette de la pièce et de l'écran. */
  useBasePanel(): void {
    this.room.set(this.panel, PANEL_FIRST * 3);
    this.screen.set(this.panel, PANEL_FIRST * 3);
  }

  /** `palSetJoeNormal` : couleurs de Joe en vêtements ordinaires (et en sous-vêtements). */
  setJoeNormal(): void {
    this.setJoe(JOE_CLOTHES);
  }

  /** `palSetJoeDress` : couleurs de Joe en robe. */
  setJoeDress(): void {
    this.setJoe(JOE_DRESS);
  }

  private setJoe(colors: Uint8Array): void {
    this.room.set(colors, PANEL_FIRST * 3);
    this.screen.set(colors, PANEL_FIRST * 3);
  }

  /**
   * Partie palette de `setupNewRoom` : les `backdropColors(room)` premières couleurs du décor, puis `palCustomColors`. `light` : le
   * masque et la table de la pièce (`dynalumInit`), `null` sans lumière dynamique.
   */
  setupRoom(backdropPalette: Uint8Array, room: number, light: RoomLight | null, backdropWidth: number): void {
    this.room.set(backdropPalette.subarray(0, backdropColors(room) * 3));
    this.customColors(room);
    this.light = light;
    this.lightWidth = backdropWidth;
    this.prevColMask = 0xff;
    this.fade = null;
  }

  /** `palCustomColors` (DOS) : pièces 28 à 31, les 12 couleurs 72 à 83 (le fond d'écran de la porte) changent de teinte. */
  private customColors(room: number): void {
    const p = this.room;
    const scale = (index: number, percent: number): void => {
      p[index] = Math.trunc((p[index] * percent) / 100);
    };
    for (let i = 72; i < 84; i++) {
      switch (room) {
        case 31:
          scale(i * 3 + 1, 90);
          scale(i * 3 + 2, 70);
          break;
        case 29:
          scale(i * 3 + 1, 60);
          scale(i * 3 + 2, 60);
          break;
        case 30:
          scale(i * 3, 60);
          scale(i * 3 + 1, 80);
          break;
        case 28:
          scale(i * 3, 80);
          // ScummVM lit la composante verte pour calculer le bleu (`room[i * 3 + 1] * 60 / 100`) : reproduit.
          p[i * 3 + 2] = Math.trunc((p[i * 3 + 1] * 60) / 100);
          break;
      }
    }
  }

  // --- Lumière dynamique ----------------------------------------------------------------------------------------------------

  /** `dynalumUpdate` : la ligne de la table de lumière pour la position de Joe change les couleurs 144 à 159 de l'écran. */
  dynalumUpdate(x: number, y: number): void {
    const light = this.light;
    if (!light) return;
    const mask = lightRowAt(light, x, y, this.lightWidth);
    if (mask === this.prevColMask) return;
    // Une ligne hors de la table (masque de la pièce T6) : ScummVM lit au-delà de son tampon ; ici la palette reste telle quelle.
    const delta = lightDelta(light, mask);
    if (delta) {
      for (let i = PANEL_FIRST; i < PANEL_FIRST + JOE_COLORS; i++) {
        for (let j = 0; j < 3; j++) this.screen[i * 3 + j] = clamp(this.room[i * 3 + j] + delta[j]);
      }
    }
    this.prevColMask = mask;
  }

  /** Vrai si la pièce a une lumière dynamique. */
  get hasLight(): boolean {
    return this.light !== null;
  }

  // --- Fondus ---------------------------------------------------------------------------------------------------------------

  /**
   * Début de `palFadeIn` : l'écran reprend la palette de la pièce (`colorsForRoom` premières couleurs), la lumière est appliquée
   * pour la position de Joe s'il est visible. Rend le nombre de couleurs, et `false` si la pièce n'a pas de fondu.
   */
  beginFadeIn(room: number, joe: { active: boolean; x: number; y: number }): { colors: number; fades: boolean } {
    const colors = colorsForRoom(room);
    this.screen.set(this.room.subarray(0, colors * 3));
    const fades = !fadingDisabled(room);
    if (fades) {
      if (joe.active) this.dynalumUpdate(joe.x, joe.y);
      this.fade = { colors, level: 0 };
    }
    if (colors === COLOR_COUNT) this.greyed = false;
    this.scrollable = true;
    this.dark = false;
    return { colors, fades };
  }

  /** Un pas du fondu d'entrée : `level` de 0 (noir) à 16 (palette de l'écran). */
  setFadeIn(level: number): void {
    if (this.fade) this.fade.level = level;
  }

  endFadeIn(): void {
    this.fade = null;
  }

  /** Début de `palFadeOut` : les couleurs qui tournent s'arrêtent ; sans fondu (pièces d'introduction) l'écran est noir tout de suite. */
  beginFadeOut(room: number): { colors: number; from: Uint8Array | null } {
    this.scrollable = false;
    this.fade = null;
    const colors = colorsForRoom(room);
    if (fadingDisabled(room)) {
      this.screen.fill(0, 0, colors * 3);
      return { colors, from: null };
    }
    return { colors, from: this.screen.slice(0, colors * 3) };
  }

  /** Un pas du fondu de sortie : `screen[j] = départ[j] * i / 16`, `i` de 16 à 0. */
  setFadeOut(colors: number, from: Uint8Array, level: number): void {
    for (let j = 0; j < colors * 3; j++) this.screen[j] = Math.trunc((from[j] * level) / FADE_SPEED);
  }

  // --- Effets de pièce (appelés par la logique propre aux pièces, vague L) ---------------------------------------------------

  /** `palGreyPanel` : les couleurs 224 à 255 du panneau passent au gris (composante verte x 2 / 3), pendant une scène. */
  greyPanel(): void {
    this.greyed = true;
  }

  /** `palSetAllDirty` : tout est renvoyé à l'écran, donc le gris du panneau disparaît (fin de scène). */
  clearGrey(): void {
    this.greyed = false;
  }

  /**
   * `palCustomFlash` : palette d'éclair montrée tant que `on` (couleurs 0 à 16 blanches, 17 à 66 noires, 67 à 238 blanches ; ScummVM
   * n'initialise pas les couleurs 239 à 255 de cette palette : blanches ici).
   */
  flash(on: boolean): void {
    this.flashing = on;
  }

  /** `palCustomLightsOff` : les couleurs de `start`(16, ou 32 dans le hall de l'hôtel) à 223 passent au noir (pièce sans lumière). */
  lightsOff(room: number): void {
    const start = room === ROOM_FLODA_FRONTDESK ? 32 : 16;
    this.screen.fill(0, start * 3, PANEL_TEXT_FIRST * 3);
    this.scrollable = false;
    this.dark = true;
  }

  /** `palCustomLightsOn` : la palette de la pièce revient (couleurs 0 ou 32 à 223). */
  lightsOn(room: number): void {
    const start = room === ROOM_FLODA_FRONTDESK ? 32 : 0;
    this.screen.set(this.room.subarray(start * 3, PANEL_TEXT_FIRST * 3), start * 3);
    this.scrollable = true;
    this.dark = false;
  }

  // --- Couleurs qui tournent ------------------------------------------------------------------------------------------------

  /** `palScroll(début, fin)` : les couleurs de l'écran avancent d'un cran, la dernière revient au début. */
  scroll(start: number, end: number): void {
    const p = this.screen;
    const last = [p[end * 3], p[end * 3 + 1], p[end * 3 + 2]];
    for (let k = end * 3 + 2; k >= (start + 1) * 3; k--) p[k] = p[k - 3];
    p[start * 3] = last[0];
    p[start * 3 + 1] = last[1];
    p[start * 3 + 2] = last[2];
  }

  /** `palCustomScroll` : une image de couleurs qui tournent pour la pièce `room` (rien si les fondus ou la lumière l'interdisent). */
  cycle(room: number): void {
    if (!this.scrollable) return;
    this.scrollCount++;
    const count = this.scrollCount;
    if (room === 123 || room === 124) {
      this.pulseRoom(room);
      return;
    }
    for (const rotation of ROTATIONS[room] ?? []) {
      if (rotation.mask !== 0 && (count & rotation.mask) === 0) continue;
      for (const [start, end] of rotation.ranges) this.scroll(start, end);
    }
  }

  /** Pièces 123 (explosion) et 124 : les couleurs 96 à 110 (123) ou 80 à 143 (124) virent au rouge et reviennent. */
  private pulseRoom(room: 123 | 124): void {
    const state = this.pulse[room];
    const [first, end, limit] = room === 123 ? [96, 111, 18] : [80, 144, 14];
    for (let i = first; i < end; i++) {
      this.screen[i * 3] = Math.min(255, this.room[i * 3] + state.j * 8);
      this.screen[i * 3 + 1] = Math.min(255, this.room[i * 3 + 1] + state.j * 4);
    }
    state.j += state.dir;
    if (state.j <= 0 || state.j >= limit) {
      state.dir = -state.dir;
      if (room === 124 && this.rnd.mod(2) !== 0) state.dir = Math.abs(state.dir) === 1 ? state.dir * 2 : Math.trunc(state.dir / 2);
    }
  }

  // --- Palette montrée ------------------------------------------------------------------------------------------------------

  /** Palette envoyée à l'écran : `screen`, avec le fondu d'entrée, le gris du panneau ou l'éclair en cours. */
  get shown(): Uint8Array {
    const out = this.shownBuffer;
    if (this.flashing) {
      out.fill(255);
      out.fill(0, 17 * 3, 67 * 3);
      return out;
    }
    out.set(this.screen);
    if (this.fade) {
      const { colors, level } = this.fade;
      for (let j = 0; j < colors * 3; j++) out[j] = Math.trunc((this.screen[j] * level) / FADE_SPEED);
    }
    if (this.greyed) {
      for (let c = PANEL_TEXT_FIRST; c < COLOR_COUNT; c++) {
        const grey = Math.trunc((this.screen[c * 3 + 1] * 2) / 3);
        out[c * 3] = out[c * 3 + 1] = out[c * 3 + 2] = grey;
      }
    }
    return out;
  }
}

/** Pièce du hall de l'hôtel, dont la lumière n'éteint pas les 32 premières couleurs (`ROOM_FLODA_FRONTDESK`). */
const ROOM_FLODA_FRONTDESK = 103;

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
