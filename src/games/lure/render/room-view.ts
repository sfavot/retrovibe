/**
 * Image de la pièce : `Room::update` (engines/lure/room.cpp, ScummVM, GPL v3+). Dans l'ordre : le fond, les hotspots du calque 3 (chacun
 * suivi des cellules de recouvrement), ceux du calque 1 triés par ordonnée du pied (chacun suivi de ses cellules), ceux du calque 2, la bulle
 * de conversation, la ligne d'état (nom du hotspot sous le pointeur, ou commande en construction en blanc, découpée à la largeur de
 * l'écran).
 *
 * Seuls les hotspots de la pièce affichée, avec une animation et un calque non nul, sont dessinés (`isActiveAnimation`) ; le drapeau « à
 * sauter » ne compte que pour le calque 1.
 *
 * Écarts volontaires : le mode d'information de débogage (`_showInfo`) et l'affichage de la surface de la bouteille (calque 0xFE) ne sont pas
 * portés.
 */

import type { LureData } from "../data/lure-data";
import type { LureEngine } from "../engine/game";
import type { Hotspot } from "../engine/hotspot";
import { FONT_HEIGHT, FULL_SCREEN_WIDTH } from "../engine/ids";
import { RoomLayers } from "./layers";
import { drawHotspot, SpriteCache, sortLayer1 } from "./sprites";
import { Surface } from "./surface";
import { DIALOG_WHITE_COLOR, drawString, wordWrap } from "./text";
import { bubbleText, TalkBubble } from "./talk-bubble";

export class RoomView {
  private readonly sprites: SpriteCache;
  private layers: RoomLayers | null = null;
  private layerIds: readonly number[] | null = null;
  private bubble: TalkBubble | null = null;
  private bubbleKey: unknown = null;

  constructor(private readonly data: LureData) {
    this.sprites = new SpriteCache((id) => data.resources.get(id));
  }

  /** Ne garde de la pièce précédente que ce qui sert encore : appelé quand `room.layers` change. */
  private load(ids: readonly number[]): RoomLayers {
    if (!this.layers || this.layerIds !== ids) {
      this.layers = new RoomLayers(this.data, ids);
      this.layerIds = ids;
    }
    return this.layers;
  }

  /** Écran de fond de la pièce affichée (pour la palette), ou `undefined` si aucune pièce n'est affichée. */
  backgroundScreenId(engine: LureEngine): number | undefined {
    return engine.room.layers[0];
  }

  /** `Room::update` : dessine la pièce dans `screen` (320 x 200). */
  draw(engine: LureEngine, screen: Surface): void {
    const room = engine.room;
    const layers = this.load(room.layers);
    layers.drawBackground(screen);

    const active = engine.world.activeHotspots.filter((h) => h.roomNumber === room.roomNumber && h.isActiveAnimation());
    const addAnimation = (h: Hotspot, withLayers: boolean): void => {
      const sheet = this.sprites.sheetOf(h);
      if (!sheet) return;
      drawHotspot(screen, sheet, h);
      if (withLayers) layers.addLayers(screen, h.x, h.y, h.width, h.heightCopy);
    };

    for (const h of active) if (h.layer === 3) addAnimation(h, true);
    for (const h of sortLayer1(active.filter((x) => x.layer === 1 && !x.skipFlag))) addAnimation(h, true);
    for (const h of active) if (h.layer === 2) addAnimation(h, false);

    this.drawBubble(engine, screen);
    this.drawStatusLine(engine, screen);
  }

  /** Bulle de parole : créée avec l'enregistrement du moteur, une étape de texte par image dessinée. */
  private drawBubble(engine: LureEngine, screen: Surface): void {
    const room = engine.room;
    const dialog = room.talkDialog;
    if (!dialog) {
      this.bubble = null;
      this.bubbleKey = null;
      room.talkDialogHeight = 0;
      return;
    }
    if (this.bubbleKey !== dialog || !this.bubble) {
      const speaker = engine.world.requireHotspot(dialog.srcCharacterId);
      const name = engine.text(speaker.nameId & 0x1fff);
      this.bubble = new TalkBubble(this.data, dialog, name, bubbleText(engine, dialog));
      this.bubbleKey = dialog;
    }
    room.talkDialogHeight = this.bubble.height;
    const talker = engine.world.getActiveHotspot(engine.world.state.talkingCharacter);
    if (talker && talker.roomNumber === room.roomNumber) {
      this.bubble.advance(engine.fastTextFlag);
      this.bubble.surface.copyTo(screen, dialog.x, dialog.y);
    }
  }

  /** Ligne d'état : commande en construction (blanc, découpée), sinon nom du hotspot sous le pointeur. */
  private drawStatusLine(engine: LureEngine, screen: Surface): void {
    const room = engine.room;
    if (room.statusLine === "") {
      if (room.hotspotId !== 0) drawString(this.data.font, screen, 0, 0, room.hotspotName, false);
      return;
    }
    let y = 0;
    for (const line of wordWrap(this.data.font, room.statusLine, FULL_SCREEN_WIDTH)) {
      drawString(this.data.font, screen, 0, y, line, false, DIALOG_WHITE_COLOR);
      y += FONT_HEIGHT;
    }
  }
}
