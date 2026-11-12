/**
 * Groupe L3 : méthodes natives du village et du barman.
 *
 * Source (ScummVM, GPL v3+) : `Script::cutSack` (33), `townHallClose` (39), `checkWakeBrenda` (46), `setVillageSkorlTickProc` (54),
 * `barmanServe` (56) (engines/lure/scripts.cpp) ; le bar lui-même est `bar.ts`.
 *
 * Écarts : aucun.
 */

import type { LureContext } from "../../context";
import { BarManager, NUM_SERVE_CUSTOMERS } from "../../bar";
import { Field, HotspotId, RoomNum, TickProc } from "../../ids";
import type { MethodGroupTable } from "../index";
import { DINING_HALL_ALARM_SEQUENCE, TOWN_HALL_DOOR, VILLAGE_SACK_Y, WAKE_BRENDA_FIELD } from "./ids";

/** 33 `cutSack` : le sac coupé au couteau tombe (position basse). */
function cutSack(ctx: LureContext): void {
  const data = ctx.world.requireHotspot(HotspotId.SACK);
  data.startY = VILLAGE_SACK_Y;
  ctx.world.getActiveHotspot(HotspotId.SACK)?.setPosition(data.startX, data.startY);
}

/** 39 `townHallClose` : la porte de la mairie (pièce 14) est marquée à fermer. */
function townHallClose(ctx: LureContext): void {
  const join = ctx.world.getExitJoin(TOWN_HALL_DOOR);
  if (!join) throw new Error("townHallClose : la porte de la mairie n'a pas de jonction");
  join.blocked = 1;
}

/** 46 `checkWakeBrenda` : en parlant à Minnow dans la salle à manger, avant le troisième sujet, réveille le Skorl « Brenda » (séquence 0x1E15). */
function checkWakeBrenda(ctx: LureContext): void {
  const fields = ctx.world.fields;
  if (fields.get(Field.TALK_INDEX) < 3 && ctx.room.roomNumber === RoomNum.DINING_HALL && fields.get(WAKE_BRENDA_FIELD) === 0) {
    ctx.script.execute(DINING_HALL_ALARM_SEQUENCE);
  }
}

/** 54 `setVillageSkorlTickProc` : le Skorl du village (`WAYNE`) prend le gestionnaire du geôlier. */
function setVillageSkorlTickProc(ctx: LureContext): void {
  ctx.world.requireActiveHotspot(HotspotId.WAYNE).setTickProc(TickProc.JAILOR);
}

/** 56 `barmanServe` : le joueur au comptoir demande le service (drapeaux 1 et 4 : le barman fait quelque chose). */
function barmanServe(ctx: LureContext): void {
  if (!(ctx.bar instanceof BarManager)) {
    ctx.journal.log("barmanServe : le service de bar n'est pas un BarManager");
    return;
  }
  const player = ctx.world.requireActiveHotspot(HotspotId.PLAYER);
  const entry = ctx.bar.getDetails(player.roomNumber);
  for (let index = 0; index < NUM_SERVE_CUSTOMERS; index++) {
    const customer = entry.customers[index]!;
    if (customer.hotspotId === HotspotId.PLAYER) {
      customer.serveFlags |= 5;
      break;
    }
  }
}

export const GROUP_3_METHODS: MethodGroupTable = {
  33: cutSack,
  39: townHallClose,
  46: checkWakeBrenda,
  54: setVillageSkorlTickProc,
  56: barmanServe,
};
