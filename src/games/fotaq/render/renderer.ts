/**
 * Composition de l'image de *Flight of the Amazon Queen* à partir de l'état du moteur : décor défilant, bobs triés (échelle,
 * miroir), images collées, panneau (inventaire), ligne de commande, textes, curseur. Réécriture de `Graphics::drawBobs`,
 * `Graphics::drawInventoryItem`, `Graphics::pasteBob` (partie dessin), `Graphics::unpackControlBank`, `Graphics::setupMouseCursor`
 * et de la composition de `Display::update` (engines/queen/graphics.cpp, display.cpp, ScummVM, GPL v3 ou ultérieure).
 *
 * Le moteur sans tête (`GameStage`, `docs/fotaq/engine.md` § 11) tient l'état ; ce module le lit sans le modifier :
 * `bobs.sorted`, `bobs.frames.frame(n)`, `g.horizontalScroll`, `rooms.pasteDowns`, `state.inventory`, `command.line`, la souris.
 *
 * Écarts :
 * - le panneau est redessiné à chaque image d'après `state.inventory` (ScummVM dessine les cases quand l'inventaire change :
 *   `inventoryRefresh`) ;
 * - la ligne de commande vient de `g.command.line` (le moteur sans tête ne passe pas par la liste de textes) et se dessine avant
 *   les textes, sans contour, à l'ordonnée `COMMAND_Y_POS` ;
 * - le curseur est dessiné dans l'image (ScummVM le confie au système : `CursorMan`, hotspot (1, 1), couleur 0 transparente) ;
 *   `cursor: false` le laisse à l'hôte.
 */

import { parseRoomLight } from "../data/dynalum";
import { roomLightFile, roomMaskFile } from "../data/files";
import { decodePcx } from "../data/pcx";
import type { Box } from "../data/jas";
import type { BobSlot, FrameTable } from "../engine/bobs";
import type { FotaqHost } from "../engine/host";
import type { FotaqEngine } from "../engine/loop";
import type { PasteDown } from "../engine/room-graphics";
import { Display, Ink, SCREEN_H, SCREEN_W, centerText, ROOM_ZONE_HEIGHT, COMMAND_Y_POS } from "./display";
import { drawText } from "./font";
import { fadingDisabled } from "./palette";
import { BankCache, type Image, type Surface, blitMasked, blitOpaque, drawBob, fillRect, overpackFrame } from "./sprites";
import type { FrameRef } from "../engine/bobs";
import { toInt16, toUint16 } from "../engine/state";

/** Boîtes de découpe des bobs sans boîte propre : l'écran de jeu et l'écran entier (`_gameScreenBox`, `_fullScreenBox`). */
const GAME_BOX: Box = { x1: 0, y1: 0, x2: SCREEN_W - 1, y2: ROOM_ZONE_HEIGHT - 1 };
const FULL_BOX: Box = { x1: 0, y1: 0, x2: SCREEN_W - 1, y2: SCREEN_H - 1 };

/** Banque des commandes (flèches des choix de dialogue, curseur) et emplacement où ScummVM la charge. */
const CONTROL_BANK = "CONTROL.BBK";
const CONTROL_SLOT = 17;
/** Banque des objets d'inventaire. */
const OBJECTS_BANK = "OBJECTS.BBK";
/** Images de `CONTROL.BBK` mises dans la table (`unpackControlBank`) : curseur 1, flèches 3 (haut) et 4 (bas). */
const CURSOR_FRAME = 1;
const ARROW_FRAMES = [3, 4] as const;
/** Les flèches ont un point d'ancrage décalé de 200 pour rester au-dessus de tout (`yhotspot += 200`). */
const ARROW_HOTSPOT_SHIFT = 200;
/** Position des cases d'inventaire dans le panneau (`inventoryRefresh`) : abscisse de la première, pas, ordonnée, taille d'une case vide. */
const SLOT_X = 182;
const SLOT_STEP = 35;
const SLOT_Y = 14;
const SLOT_SIZE = 32;
/** Images composées (torse et bouche) gardées avant de repartir de zéro. */
const COMPOSED_LIMIT = 400;
/** Hotspot du curseur (`replaceCursor(buf, w, h, 1, 1, 0)`). */
const CURSOR_HOTSPOT = 1;

export interface RendererOptions {
  /** Dessiner le curseur dans l'image (défaut : oui). */
  cursor?: boolean;
}

export class Renderer {
  readonly display = new Display();
  /** Image présentée : 320 x 200 indices, avec le curseur. */
  readonly output = new Uint8Array(SCREEN_W * SCREEN_H);
  private banks: BankCache | null = null;
  private panelLoaded = false;
  private pasteSource: readonly PasteDown[] | null = null;
  private pasteVersion = -1;
  private pasted = 0;
  private readonly composed = new Map<string, Image & { hotspotX: number; hotspotY: number }>();

  constructor(private readonly options: RendererOptions = {}) {}

  private bankCache(host: FotaqHost): BankCache {
    return (this.banks ??= new BankCache((name) => host.readFile(name)));
  }

  /** Image `image` (à partir de 1) de la banque `bank` ; `undefined` si elle n'existe pas. */
  bankFrame(host: FotaqHost, bank: string, image: number): Image | undefined {
    return this.bankCache(host).bank(bank).frames[image - 1];
  }

  /** Image d'une référence de la table, avec ses surimpressions (`overpack`) s'il y en a ; composée une fois par chaîne d'images. */
  private resolve(banks: BankCache, ref: FrameRef): (Image & { hotspotX: number; hotspotY: number }) | undefined {
    const base = banks.bank(ref.bank).frames[ref.image - 1];
    if (!base || !ref.overs?.length) return base;
    const key = `${ref.bank}:${ref.image}${ref.overs.map((over) => `+${over.bank}:${over.image}`).join("")}`;
    let composed = this.composed.get(key);
    if (!composed) {
      if (this.composed.size >= COMPOSED_LIMIT) this.composed.clear();
      composed = base;
      for (const over of ref.overs) {
        const frame = banks.bank(over.bank).frames[over.image - 1];
        if (frame) composed = overpackFrame(composed, frame);
      }
      this.composed.set(key, composed);
    }
    return composed;
  }

  /** Une image de `CONTROL.BBK`, la banque du curseur et des flèches. */
  controlFrame(host: FotaqHost, image: number): (Image & { hotspotX: number; hotspotY: number }) | undefined {
    return this.bankCache(host).bank(CONTROL_BANK).frames[image - 1];
  }

  // --- Mise en place ----------------------------------------------------------------------------------------------------------

  /** `Logic::start` : `setupPanel` (PANEL.PCX) et `unpackControlBank` (images 1, 3 et 4 de CONTROL.BBK dans la table d'images). */
  setupPanel(host: FotaqHost, frames: FrameTable): void {
    if (this.panelLoaded) return;
    this.panelLoaded = true;
    this.display.setupPanel(decodePcx(host.readFile("PANEL.PCX")));
    frames.load(CONTROL_BANK, CONTROL_SLOT);
    for (const frame of [CURSOR_FRAME, ...ARROW_FRAMES]) frames.unpack(frame, frame, CONTROL_SLOT);
    frames.close(CONTROL_SLOT);
  }

  /**
   * `Display::setupNewRoom` : décor `imageFile` (`B1.PCX`), puis lumière dynamique si la pièce en a une (`dynalumInit` : les deux
   * fichiers `.MSK` et `.LUM` doivent exister, et la pièce ne doit pas être une pièce d'introduction). Rend la largeur du décor.
   */
  setupRoom(host: FotaqHost, imageFile: string, roomName: string, room: number): number {
    const pcx = decodePcx(host.readFile(imageFile));
    let light = null;
    if (!fadingDisabled(room)) {
      const mask = roomMaskFile(roomName);
      const table = roomLightFile(roomName);
      if (host.fileExists(mask) && host.fileExists(table)) light = parseRoomLight(host.readFile(mask), host.readFile(table));
    }
    this.display.setupRoom(pcx, room, light);
    return pcx.width;
  }

  // --- Composition ------------------------------------------------------------------------------------------------------------

  /** Écrit les images collées pas encore dans le décor (`Display::drawBobPasteDown`), dans l'ordre. */
  private pasteDowns(host: FotaqHost, list: readonly PasteDown[]): void {
    const { display } = this;
    if (this.pasteSource !== list || this.pasteVersion !== display.backdropVersion || this.pasted > list.length) {
      this.pasteSource = list;
      this.pasteVersion = display.backdropVersion;
      this.pasted = 0;
    }
    for (; this.pasted < list.length; this.pasted++) {
      const paste = list[this.pasted];
      const frame = this.bankCache(host).bank(paste.frame.bank).frames[paste.frame.image - 1];
      if (frame) blitMasked(display.backdrop, paste.x, paste.y, frame.pixels, 0, frame.width, frame.width, frame.height, false);
    }
  }

  /** `Graphics::drawBobs` : les bobs actifs dans l'ordre de dessin. */
  private drawBobs(host: FotaqHost, bobs: readonly BobSlot[], frames: FrameTable, scroll: number): void {
    const { display } = this;
    const defaultBox = display.fullscreen ? FULL_BOX : GAME_BOX;
    const banks = this.bankCache(host);
    for (const bob of bobs) {
      if (!bob.active) continue;
      const ref = frames.frame(bob.frameNum);
      const frame = ref ? this.resolve(banks, ref) : undefined;
      if (!ref || !frame) continue;
      // Calcul en `uint16` comme ScummVM, position finale lue en `int16` (`drawBob`) : un ancrage de 32 768 ou plus (images de
      // x4b.SAM, x7b.SAM) vaut un ancrage négatif à l'échelle 100.
      let xh = frame.hotspotX;
      let yh = frame.hotspotY;
      if (ref.bank === CONTROL_BANK && (ARROW_FRAMES as readonly number[]).includes(bob.frameNum)) yh = toUint16(yh + ARROW_HOTSPOT_SHIFT);
      if (bob.xflip) xh = toUint16(frame.width - xh);
      if (bob.scale !== 100) {
        xh = Math.trunc((xh * bob.scale) / 100);
        yh = Math.trunc((yh * bob.scale) / 100);
      }
      drawBob(display.screen, frame, bob.xflip, bob.scale, bob.box ?? defaultBox, toInt16(bob.x - xh - scroll), toInt16(bob.y - yh));
    }
  }

  /** `Logic::inventoryRefresh` : les quatre cases du panneau ; une case vide est remplie de la couleur du fond. */
  private drawInventory(host: FotaqHost, g: FotaqEngine): void {
    const panel = this.display.panel;
    const objects = this.bankCache(host).bank(OBJECTS_BANK);
    g.state.inventory.forEach((item, slot) => {
      const x = SLOT_X + slot * SLOT_STEP;
      const frame = item !== 0 ? objects.frames[g.state.items[item].frame - 1] : undefined;
      if (frame) blitOpaque(panel, x, SLOT_Y, frame);
      else fillRect(panel, x, SLOT_Y, SLOT_SIZE, SLOT_SIZE, Ink.BgPanel);
    });
  }

  /** Une image : décor, bobs, panneau, textes, puis curseur ; figée entre `eraseRoom` et la pièce suivante (fondu de sortie). */
  render(g: FotaqEngine, bobs: readonly BobSlot[], frames: FrameTable, pasteDowns: readonly PasteDown[]): void {
    const { display } = this;
    const host = g.host;
    if (!display.frozen) {
      this.pasteDowns(host, pasteDowns);
      this.drawInventory(host, g);
      display.prepareScreen(g.horizontalScroll);
      this.drawBobs(host, bobs, frames, g.horizontalScroll);
      const line = g.command.line;
      if (line && !display.textAt(COMMAND_Y_POS).text) {
        const centered = centerText(line.text);
        drawText(display.screen.pixels, centered.x, COMMAND_Y_POS, line.ink === "select" ? Ink.CmdSelect : Ink.CmdNormal, centered.text, false, Ink.OutlinedText);
      }
      display.drawTexts();
    }
    this.output.set(display.screen.pixels);
    if (display.shakeY > 0) {
      // `setShakePos(0, y)` : l'image est remontée de `y` lignes, le bas de l'écran est noir.
      this.output.copyWithin(0, display.shakeY * SCREEN_W);
      this.output.fill(0, (SCREEN_H - display.shakeY) * SCREEN_W);
    }
    if (this.options.cursor !== false && display.cursorVisible) this.drawCursor(host, g.input.mouseX, g.input.mouseY);
  }

  private drawCursor(host: FotaqHost, x: number, y: number): void {
    const frame = this.controlFrame(host, CURSOR_FRAME);
    if (!frame) return;
    const surface: Surface = { pixels: this.output, width: SCREEN_W, height: SCREEN_H };
    blitMasked(surface, x - CURSOR_HOTSPOT, y - CURSOR_HOTSPOT, frame.pixels, 0, frame.width, frame.width, frame.height, false);
  }
}
