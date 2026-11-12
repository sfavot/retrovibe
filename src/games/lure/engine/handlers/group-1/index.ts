/**
 * Groupe L1 : gestionnaires de tick génériques (rien, animation par script, bulle de parole, point d'interrogation, porte, feu,
 * étincelles de la transformation), portés en G1 (`docs/lure/engine.md`, § 8).
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::defaultHandler`, `standardAnimHandler`, `standardAnimHandler2`,
 * `voiceBubbleAnimHandler`, `puzzledAnimHandler`, `roomExitAnimHandler`, `fireAnimHandler`, `sparkleAnimHandler`
 * (engines/lure/hotspots.cpp).
 *
 * Écarts : aucun.
 */

import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";
import { AnimIndex, CurrentAction, Field, HotspotId } from "../../ids";
import type { HandlerGroupTable } from "../index";

/** `standardAnimHandler` : attend `frameCtr` images, puis avance le script ; à sa fin, le hotspot quitte le jeu (pièce `| 0x8000`). */
export function standardAnimHandler(ctx: LureContext, h: Hotspot): void {
  if (h.frameCtr > 0) {
    h.frameCtr--;
    return;
  }
  if (h.executeScript()) {
    const data = h.res;
    ctx.world.deactivateHotspotObject(h);
    data.roomNumber |= 0x8000;
  }
}

function voiceBubbleAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  if (h.voiceCtr !== 0) h.voiceCtr--;
  if (h.voiceCtr !== 0) {
    const character = world.requireHotspot(world.state.talkingCharacter);
    if (character.roomNumber === h.roomNumber && character.talkCountdown !== 0) {
      if (!world.checkHotspotExtent(character)) h.setPosition(h.x, -100);
      else h.setPosition(character.startX + character.talkX + 12, character.startY + character.talkY - 18);
      return;
    }
  }
  world.deactivateHotspotObject(h);
}

function puzzledAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const character = world.requireHotspot(h.destHotspotId);
  h.voiceCtr = (h.voiceCtr - 1) & 0xff;
  if (character.roomNumber !== h.roomNumber || h.voiceCtr === 0 || !world.checkHotspotExtent(character)) {
    world.deactivateHotspotObject(h);
    return;
  }
  h.setPosition(character.startX + character.talkX + 12, character.startY + character.talkY - 20);
}

/** `roomExitAnimHandler` : la porte s'ouvre ou se ferme d'une image par tick vers l'état de sa jonction, avec son bruit. */
function roomExitAnimHandler(ctx: LureContext, h: Hotspot): void {
  const join = ctx.world.getExitJoin(h.hotspotId);
  if (!join) return;
  const side = join.hotspots[0].hotspotId === h.hotspotId ? join.hotspots[0] : join.hotspots[1];
  const inRoom = h.roomNumber === ctx.room.roomNumber;
  if (join.blocked !== 0 && side.currentFrame !== side.destFrame) {
    h.setOccupied(true);
    side.currentFrame++;
    if (side.currentFrame === side.destFrame && inRoom && side.closeSound !== 0) ctx.sound.addSound(side.closeSound);
  } else if (join.blocked === 0 && side.currentFrame !== 0) {
    h.setOccupied(false);
    if (side.currentFrame === side.destFrame && inRoom && side.openSound !== 0) {
      ctx.sound.addSound(side.openSound);
      if (ctx.world.fields.get(Field.AREA_FLAG) === 1) ctx.sound.trashReverb();
    }
    side.currentFrame--;
  }
  h.setFrameNumber(side.currentFrame);
}

/** `sparkleAnimHandler` : les étincelles suivent le joueur ; à la 6e image il prend l'apparence de Selena (ou la sienne). */
function sparkleAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const fields = world.fields;
  const player = world.requireActiveHotspot(HotspotId.PLAYER);
  h.roomNumber = player.roomNumber;
  h.setPosition(player.x - 14, player.y - 10);
  h.actionCtr = h.actionCtr + 1;
  if (h.actionCtr === 6) {
    let animIndex: number;
    if (fields.get(11) === 2 || fields.get(28) !== 0) {
      fields.set(28, 0);
      animIndex = AnimIndex.PLAYER;
    } else {
      fields.set(28, fields.get(28) + 1);
      animIndex = AnimIndex.SELENA;
    }
    player.setAnimationIndex(animIndex);
  }
  if (h.executeScript()) {
    const data = h.res;
    world.deactivateHotspotObject(h);
    data.roomNumber = 0x1a8;
    if (fields.get(28) !== 0) {
      const ratpouch = world.requireActiveHotspot(HotspotId.RATPOUCH);
      ratpouch.converse(HotspotId.NOONE, 0x854, false);
      const entry = ctx.schedules.resolve(world.getCharOffset(4));
      ratpouch.currentActions.addFront(CurrentAction.DISPATCH_ACTION, ratpouch.roomNumber, entry === null ? null : { kind: "schedule", id: entry });
      ratpouch.actionCtr = 0;
    }
  }
}

export const GROUP_1_HANDLERS: HandlerGroupTable = {
  defaultHandler: () => {},
  standardAnimHandler,
  standardAnimHandler2: (ctx, h) => {
    h.handleTalkDialog();
    standardAnimHandler(ctx, h);
  },
  voiceBubbleAnimHandler,
  puzzledAnimHandler,
  roomExitAnimHandler,
  fireAnimHandler: (ctx, h) => {
    standardAnimHandler(ctx, h);
    h.setOccupied(true);
  },
  sparkleAnimHandler,
};
