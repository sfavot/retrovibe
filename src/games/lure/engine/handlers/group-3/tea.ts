import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";
import { TEA_DONE_FIELD, TEA_DONE_SCRIPT } from "./ids";

/** 18 `teaAnimHandler` : la tasse de thé (pièce 30) joue son script ; à la fin elle passe au script « fini » et le champ 27 vaut 1. */
export function teaAnimHandler(ctx: LureContext, h: Hotspot): void {
  if (h.frameCtr > 0) {
    h.frameCtr--;
    return;
  }
  if (h.executeScript()) {
    h.setHotspotScript(TEA_DONE_SCRIPT);
    ctx.world.fields.set(TEA_DONE_FIELD, 1);
  }
}
