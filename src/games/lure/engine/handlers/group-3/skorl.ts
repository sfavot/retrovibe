import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";

/** 25 `skorlAnimHandler` : les Skorls de la taverne et du village ne font que parler ; l'image est `actionCtr`. */
export function skorlAnimHandler(_ctx: LureContext, h: Hotspot): void {
  h.handleTalkDialog();
  h.setFrameNumber(h.actionCtr);
}
