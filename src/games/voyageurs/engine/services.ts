/**
 * Services du moteur des *Voyageurs du temps* : son (port audio, vague A) et rendu (port de dessin, vague R). Le moteur (vague C) ne fait
 * que les appeler ; `SilentAudio` et `NullRenderer` servent aux tests et au moteur sans écran.
 *
 * Référence : ScummVM engines/cine/sound.h (`Sound` : `loadMusic`, `playMusic`, `fadeOutMusic`, `stopMusic`, `setBgMusic`, `playSound`,
 * `stopSound`) et gfx.h (`FWRenderer`) (GPL v3 ou ultérieure).
 */

import type { Pi1Image } from "../data/pi1";
import type { AnimSlot, BgIncrust, EngineState, GameObject } from "./state";

/** Port audio (musique CD, D3 ; effets OPL, D4). Implémenté en vague A. */
export interface VoyageursAudio {
  /** `loadMusic` : nom de module (`DUGGER.DAT`…) → piste CD, sans jouer. */
  loadMusic(name: string): void;
  /** `playMusic` : joue en boucle la piste chargée. */
  playMusic(): void;
  /** `fadeOutMusic` : fondu, puis retour à la musique du décor (règles CD, D8). */
  fadeOut(): void;
  /** `stopMusic` (opcode `stopSample` : nom trompeur de ScummVM). */
  stopMusic(): void;
  /** `setBgMusic(atoi(nom + 1))` à chaque `loadBg` (musique d'ambiance par décor). */
  setBgMusic(slot: number): void;
  /** Effet sonore : instrument OPL d'un `.SPL` (`data` = fichier entier) sur `channel`. */
  playSample(channel: number, data: Uint8Array, volume: number): void;
  /** Arrêt d'un canal d'effets. */
  stopSample(channel: number): void;
}

export class SilentAudio implements VoyageursAudio {
  loadMusic(_name: string): void {}
  playMusic(): void {}
  fadeOut(): void {}
  stopMusic(): void {}
  setBgMusic(_slot: number): void {}
  playSample(_channel: number, _data: Uint8Array, _volume: number): void {}
  stopSample(_channel: number): void {}
}

/** Menu ouvert, à dessiner (`SelectionMenu`) : verbes, inventaire, sous-objet, système, confirmation. */
export interface MenuView {
  readonly kind: "verbs" | "inventory" | "object" | "system" | "confirm";
  readonly items: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** Ligne surlignée, -1 si aucune. */
  readonly selection: number;
}

/** Ce que le rendu lit pour dessiner une image (`drawFrame`). */
export interface FrameView {
  readonly state: EngineState;
  readonly menus: readonly MenuView[];
  /** Texte d'une attente modale (`drawString` : pause). */
  readonly banner: string | null;
}

/** Palettes du rendu en 9 bits (16 couleurs × 3 composantes de 0 à 7) : sauvegardées comme dans `makeSaveFW`. */
export interface PaletteSnapshot {
  active: number[];
  backup: number[];
}

/**
 * Port de dessin (vague R). Les palettes (`_activePal`, `_backupPal`), le fond et ses incrustations y vivent ; le moteur lui transmet les
 * opérations des scripts dans l'ordre de ScummVM.
 */
export interface VoyageursRenderer {
  /** `resetEngine` (`clear`) puis `setBlackPalette(true)` du début de `mainLoop` : plus de fond, palettes noires. */
  reset(): void;
  /** `loadBg16` : nouveau fond et palette du décor. */
  loadBackground(name: string, image: Pi1Image): void;
  /** `incrustSprite` / `incrustMask` : dessine dans le fond le sprite courant de l'objet (état actuel de l'objet, pas celui mémorisé). */
  incrust(incrust: BgIncrust, object: GameObject, anim: AnimSlot | null): void;
  /** Rustine anti-flash de `blitAndFade` (palette affichée au noir). */
  setBlackPalette(): void;
  transformPalette(first: number, last: number, r: number, g: number, b: number): void;
  rotatePalette(a: number, b: number, c: number): void;
  /** Un pas de fondu au noir (0 à 7 ; un fondu raccourci par la rustine anti double fondu ne joue que le pas 7). */
  fadeOutStep(step: number): void;
  /** Fin du fondu au noir (`clearBackBuffer`). */
  fadeOutDone(): void;
  /** Un pas de fondu depuis le noir (7 à 0). */
  fadeInStep(step: number): void;
  /** Dessin d'une image complète. */
  drawFrame(view: FrameView): void;
  /** Palettes active et de secours (sauvegarde). */
  getPalettes(): PaletteSnapshot;
  /** Restauration (après le rechargement du fond) ; la palette active est affichée au prochain dessin. */
  setPalettes(palettes: PaletteSnapshot): void;
}

export class NullRenderer implements VoyageursRenderer {
  private palettes: PaletteSnapshot = { active: new Array<number>(48).fill(0), backup: new Array<number>(48).fill(0) };
  reset(): void {}
  loadBackground(_name: string, _image: Pi1Image): void {}
  incrust(_incrust: BgIncrust, _object: GameObject, _anim: AnimSlot | null): void {}
  setBlackPalette(): void {}
  transformPalette(_first: number, _last: number, _r: number, _g: number, _b: number): void {}
  rotatePalette(_a: number, _b: number, _c: number): void {}
  fadeOutStep(_step: number): void {}
  fadeOutDone(): void {}
  fadeInStep(_step: number): void {}
  drawFrame(_view: FrameView): void {}
  getPalettes(): PaletteSnapshot {
    return { active: [...this.palettes.active], backup: [...this.palettes.backup] };
  }
  setPalettes(palettes: PaletteSnapshot): void {
    this.palettes = { active: [...palettes.active], backup: [...palettes.backup] };
  }
}
