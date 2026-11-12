import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";
import { CharacterMode, Field, HotspotId } from "../../ids";
import { GOEWIN_BUSY_TALK_INDEXES, GOEWIN_SHOP_ROOM, GOEWIN_SHOP_WAIT, NORMAL_GOEWIN_METHOD } from "./ids";

/**
 * 27 `goewinShopAnimHandler` : Goewin à la boutique (pièce 34) : attend le joueur, joue son script, puis retrouve son état normal
 * (`normalGoewin`, groupe L4 ; méthode 60) sauf pendant les sujets 12 à 14 ou quand le joueur est dans la boutique.
 */
export function goewinShopAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  h.res.actionHotspotId = 0;
  h.characterMode = CharacterMode.WAIT_FOR_INTERACT;

  h.handleTalkDialog();
  if (h.frameCtr > 0) {
    h.decrFrameCtr();
    h.decrFrameCtr();
    return;
  }

  h.executeScript();

  if (h.delayCtr > 0) {
    h.delayCtr = h.delayCtr - 1;
    if (h.delayCtr === 0) {
      const player = world.requireActiveHotspot(HotspotId.PLAYER);
      const talkIndex = world.fields.get(Field.TALK_INDEX);
      if (GOEWIN_BUSY_TALK_INDEXES.includes(talkIndex as 12 | 13 | 14) || player.roomNumber === GOEWIN_SHOP_ROOM) h.delayCtr = GOEWIN_SHOP_WAIT;
      else ctx.methods.call(NORMAL_GOEWIN_METHOD, 0, 0, 0);
    }
  }
}
