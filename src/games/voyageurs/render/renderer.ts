/**
 * Rendu des *Voyageurs du temps* (`FWRenderer`) : fond et incrustations, calques dans l'ordre de la liste, bulles, ligne de commande,
 * menus, palettes et fondus, dans une page 320 × 200 d'indices de couleur (`backBuffer`) et une palette 16 couleurs 9 bits (`screenPalette`).
 * Pur : aucun accès au DOM ; l'interface lit la page et la palette après chaque image ou pas de fondu.
 *
 * Référence : ScummVM engines/cine/gfx.cpp (`FWRenderer::loadBg16`, `incrustSprite`, `incrustMask`, `drawFrame`, `drawOverlays`,
 * `renderOverlay`, `remaskSprite`, `fillSprite`, `drawMaskedSprite`, `clear`, `clearBackBuffer`, `fadeToBlack`, `fadeFromBlack`),
 * bg_list.cpp (`addToBGList`, `addSpriteFilledToBGList`, `loadBgIncrustFromSave`), script_fw.cpp (`o1_blitAndFade`), main_loop.cpp
 * (`setBlackPalette(true)` au début de `mainLoop`) (GPL v3 ou ultérieure). docs/voyageurs/engine.md § 3.
 *
 * Règles reprises :
 * - `drawFrame` : fond recopié, calques dans l'ordre de la liste, ligne de commande si non vide, palette si `_changePal`, menus empilés ;
 * - calque 0 : sprite de la frame **actuelle** de l'objet (frame < 0 : rien), masque de transparence recopié puis complété par chaque calque
 *   5 placé **après** lui dans la liste ; sprite sans masque : tout visible (rustine #10643) ; 1 et 5 : non dessinés ; 2 : message du MSG
 *   courant (absent : rien) ; 3 : message d'échec centré en y = 80, largeur `6 × longueur + 20` (≤ 300), fond 4 ; 4 : masque rempli de
 *   couleur 0 ;
 * - incrustation : dessinée **dans le fond** à la position et la frame actuelles de l'objet ; sprite sans masque ignoré (rustine #3868) ;
 * - fondu au noir : le dernier pas efface la page (`clearBackBuffer`).
 *
 * Écarts volontaires : le bandeau de pause (`drawString`, dessiné par ScummVM juste après le menu) est dessiné à la fin de `drawFrame` ;
 * le choix du message d'échec (hasard) est fait par le moteur avant le dessin (`Overlay.failure`) ; l'aspect « boîtes transparentes »
 * (Amiga) et la page de collision de débogage ne sont pas portés.
 */

import { encodeCp437 } from "../../../data/cp437";
import type { Font } from "../data/font";
import type { Pi1Image } from "../data/pi1";
import type { StPalette } from "../data/palette";
import type { FrameView, PaletteSnapshot, VoyageursRenderer } from "../engine/services";
import { type AnimSlot, type BgIncrust, type EngineState, type GameObject, type Overlay, OverlayType } from "../engine/state";
import { FAILURE_MESSAGES } from "../engine/texts";
import { drawSpriteRaw, fillSprite, SCREEN_SIZE, updateSpriteMask } from "./draw";
import { drawMenu } from "./menus";
import { PALETTE_COLORS, PaletteState, paletteToRgb } from "./palette";
import { drawCommand, drawMessage, drawString } from "./text";

const FAILURE_BYTES = FAILURE_MESSAGES.map((text) => encodeCp437(text));

export class FwRenderer implements VoyageursRenderer {
  /** `_backBuffer` : l'image affichée. */
  readonly backBuffer = new Uint8Array(SCREEN_SIZE);
  /** `_background` (incrustations comprises), `null` avant le premier fond. */
  background: Uint8Array | null = null;
  backgroundName = "";
  readonly palettes = new PaletteState();

  constructor(private readonly font: Font) {
    this.palettes.reset();
  }

  /** Palette de l'écran (9 bits). */
  get screenPalette(): StPalette {
    return this.palettes.screen;
  }

  /** Palette de l'écran en RVB 8 bits (16 × 3 octets). */
  screenRgb(): Uint8Array {
    return paletteToRgb(this.palettes.screen);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // VoyageursRenderer

  reset(): void {
    this.background = null;
    this.backgroundName = "";
    this.backBuffer.fill(0);
    this.palettes.reset();
  }

  loadBackground(name: string, image: Pi1Image): void {
    this.background ??= new Uint8Array(SCREEN_SIZE);
    this.background.set(image.pixels.subarray(0, SCREEN_SIZE));
    this.backgroundName = name;
    this.palettes.loadBackup(image.palette);
  }

  incrust(incrust: BgIncrust, object: GameObject, anim: AnimSlot | null): void {
    if (!this.background || !anim) return;
    if (incrust.param === 0) {
      if (anim.mask) drawSpriteRaw(this.background, anim.data, anim.mask, anim.realWidth, anim.height, object.x, object.y);
    } else {
      fillSprite(this.background, anim.data, anim.realWidth, anim.height, object.x, object.y, 0);
    }
  }

  setBlackPalette(): void {
    this.palettes.blackNow();
  }

  transformPalette(first: number, last: number, r: number, g: number, b: number): void {
    this.palettes.transform(first, last, r, g, b);
  }

  rotatePalette(a: number, b: number, c: number): void {
    this.palettes.rotate(a, b, c);
  }

  fadeOutStep(_step: number): void {
    this.palettes.fadeOutStep();
  }

  fadeOutDone(): void {
    this.backBuffer.fill(0);
  }

  fadeInStep(step: number): void {
    this.palettes.fadeInStep(step);
  }

  getPalettes(): PaletteSnapshot {
    return { active: Array.from(this.palettes.active), backup: Array.from(this.palettes.backup) };
  }

  setPalettes(palettes: PaletteSnapshot): void {
    const size = PALETTE_COLORS * 3;
    if (palettes.active.length !== size || palettes.backup.length !== size) throw new RangeError(`palettes de ${size} composantes attendues`);
    this.palettes.active.set(palettes.active.map((c) => c & 7));
    this.palettes.backup.set(palettes.backup.map((c) => c & 7));
    this.palettes.changePal = 1;
  }

  drawFrame(view: FrameView): void {
    const { state } = view;
    const page = this.backBuffer;
    if (this.background) page.set(this.background);
    const overlays = state.overlays;
    for (let i = 0; i < overlays.length; i++) this.renderOverlay(state, overlays, i);
    if (state.commandLine) drawCommand(page, this.font, encodeCp437(state.commandLine), state.cmdY, state.disableSystemMenu);
    this.palettes.flip();
    for (const menu of view.menus) drawMenu(page, this.font, menu, state.messageBg);
    if (view.banner) drawString(page, this.font, encodeCp437(view.banner));
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Calques

  private renderOverlay(state: EngineState, overlays: readonly Overlay[], index: number): void {
    const overlay = overlays[index]!;
    const page = this.backBuffer;
    switch (overlay.type) {
      case OverlayType.Sprite: {
        const obj = state.objects[overlay.objIdx];
        if (!obj || obj.frame < 0) return;
        const sprite = state.anims[obj.frame];
        if (!sprite) return;
        const len = sprite.realWidth * sprite.height;
        const mask = sprite.mask ? sprite.mask.slice(0, len) : new Uint8Array(len);
        this.remaskSprite(state, overlays, index, obj, sprite, mask);
        drawSpriteRaw(page, sprite.data, mask, sprite.realWidth, sprite.height, obj.x, obj.y);
        break;
      }
      case OverlayType.Message: {
        const message = state.messages[overlay.objIdx];
        if (!message) return;
        drawMessage(page, this.font, message, overlay.x, overlay.y, overlay.width, overlay.color);
        break;
      }
      case OverlayType.Failure: {
        const text = FAILURE_BYTES[overlay.failure ?? overlay.objIdx * 4];
        if (!text) return;
        const width = Math.min(6 * text.length + 20, 300);
        drawMessage(page, this.font, text, Math.trunc((320 - width) / 2), 80, width, 4);
        break;
      }
      case OverlayType.FilledMask: {
        const obj = state.objects[overlay.objIdx];
        if (!obj || obj.frame < 0) return;
        const sprite = state.anims[obj.frame];
        if (!sprite) return;
        fillSprite(page, sprite.data, sprite.realWidth, sprite.height, obj.x, obj.y, 0);
        break;
      }
      default:
        break;
    }
  }

  /** `remaskSprite` : les occulteurs (type 5) placés après le calque masquent le sprite. */
  private remaskSprite(state: EngineState, overlays: readonly Overlay[], index: number, obj: GameObject, sprite: AnimSlot, mask: Uint8Array): void {
    for (let i = index + 1; i < overlays.length; i++) {
      const overlay = overlays[i]!;
      if (overlay.type !== OverlayType.Occluder) continue;
      const occluder = state.objects[overlay.objIdx];
      if (!occluder) continue;
      const source = state.anims[Math.abs(occluder.frame)];
      if (!source) continue;
      updateSpriteMask(mask, obj.x, obj.y, sprite.realWidth, sprite.height, source.data, occluder.x, occluder.y, source.realWidth, source.height);
    }
  }
}
