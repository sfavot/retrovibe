import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";
import { HotspotId } from "../../ids";
import { GRUB_LEFT_X, GRUB_RATPOUCH_Y, GRUB_RIGHT_X } from "./ids";

/** 23 `grubAnimHandler` : Grub (pièce 12) tourne la tête vers le joueur (ou Ratpouch si le joueur est derrière lui) : image 0, 1 ou 2 selon x. */
export function grubAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  h.handleTalkDialog();

  let character = world.requireActiveHotspot(HotspotId.PLAYER);
  if (character.y < GRUB_RATPOUCH_Y) {
    const ratpouch = world.getActiveHotspot(HotspotId.RATPOUCH);
    if (ratpouch && ratpouch.roomNumber === h.roomNumber) character = ratpouch;
  }

  const frameNumber = character.x < GRUB_LEFT_X ? 0 : character.x < GRUB_RIGHT_X ? 1 : 2;
  h.actionCtr = frameNumber;
  h.setFrameNumber(frameNumber);
}
