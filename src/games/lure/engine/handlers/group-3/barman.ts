/**
 * 24 `barmanAnimHandler` : Sid (pièce 29), Nellie (32), Ewan (35). Le barman sert les clients du comptoir (`BarEntry`), marche le long
 * du bar, polit le comptoir ou attend ; `frameCtr` porte l'action (bit 7 : il marche vers `supportValue`, bit 6 : l'action est
 * commencée), `supportValue` la destination ou la position dans la liste d'images (octet haut : liste, octet bas : rang), `actionCtr`
 * l'image de repos ou de marche.
 *
 * Écart : le client en cours de service est un rang de liste (`bar.ts`) ; la liste d'images absente (`null`) d'un barman qui n'en a pas
 * est une erreur, là où ScummVM lirait un pointeur nul (n'arrive qu'à Ewan sans ses listes extra).
 */

import { BarManager, NUM_SERVE_CUSTOMERS } from "../../bar";
import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";
import { AnimIndex, HotspotId } from "../../ids";
import { BARMAN_MOVING, BARMAN_STARTED, BarmanAction, SERVE_WAITING } from "./ids";

const EWAN_SHOP_ROOM = 35;
/** Où Ewan flâne (`rnd(51) + 94` pour lui, `rnd(85) + 117` pour Sid et Nellie ; `max` est l'argument de `getRandomNumber`). */
const EWAN_WALK = { min: 94, max: 51 };
const OTHER_WALK = { min: 117, max: 85 };

const int16 = (v: number): number => (v << 16) >> 16;

export function barmanAnimHandler(ctx: LureContext, h: Hotspot): void {
  if (!(ctx.bar instanceof BarManager)) {
    ctx.journal.log("barmanAnimHandler : le service de bar n'est pas un BarManager");
    return;
  }
  const bar = ctx.bar;
  const world = ctx.world;
  const entry = bar.getDetails(h.roomNumber);
  const rng = ctx.rng;

  h.handleTalkDialog();
  if (h.delayCtr > 0) {
    h.delayCtr = h.delayCtr - 1;
    return;
  }

  if (h.frameCtr === 0) {
    // Le barman ne fait rien pour le moment.
    if (entry.currentCustomer !== null) {
      // Un client est en train d'être servi.
      const current = entry.customers[entry.currentCustomer]!;
      const servee = world.getActiveHotspot(current.hotspotId);
      if (servee) {
        if (servee.y + servee.heightCopy >= (entry.gridLine << 3) + 24) {
          // Le client est parti : son entrée est vidée.
          current.hotspotId = 0;
          current.serveFlags = 0;
          entry.currentCustomer = null;
        } else if (servee.hotspotId !== HotspotId.PLAYER) {
          // Un PNJ : il est servi.
          current.serveFlags = 0;
        } else {
          // Le joueur : le barman s'arrête tant qu'il ne s'est pas éloigné.
          current.serveFlags &= 0x7f;
          if ((current.serveFlags & 7) !== 0) {
            // Le barman a quelque chose à faire.
            h.frameCtr = current.serveFlags;
            current.serveFlags &= 0xf8;
          } else if (h.res.talkerId === 0) {
            // On ne lui parle pas : il libère la place et polit le comptoir.
            current.hotspotId = 0;
            current.serveFlags = 0;
            entry.currentCustomer = null;
            h.frameCtr = BarmanAction.POLISH_BAR;
          }
        }
        return;
      }
    }

    // Un client attend-il d'être servi ?
    for (let index = 0; index < NUM_SERVE_CUSTOMERS; index++) {
      const customer = entry.customers[index]!;
      if ((customer.serveFlags & SERVE_WAITING) !== 0) {
        customer.serveFlags = 0;
        entry.currentCustomer = index;
        const hotspot = world.requireActiveHotspot(customer.hotspotId);
        h.supportValue = hotspot.x & 0xffff; // la position où aller
        h.frameCtr = BARMAN_MOVING;
        return;
      }
    }

    // Personne à servir : la table est vidée.
    entry.currentCustomer = null;
    for (const customer of entry.customers) {
      customer.hotspotId = 0;
      customer.serveFlags = 0;
    }

    // Action au hasard : flâner, polir le comptoir ou attendre.
    h.frameCtr = rng.number(2) + 1;
  }

  // Ici le barman fait quelque chose.

  if ((h.frameCtr & BARMAN_MOVING) !== 0) {
    // Bit 7 : il marche vers sa destination.
    const xDiff = int16(h.x - h.supportValue);
    if (Math.abs(xDiff) >= 2) {
      if (xDiff > 0) {
        // vers la gauche
        h.setPosition(h.x - 2, h.y);
        h.actionCtr = h.actionCtr + 1;
        if (h.actionCtr >= 12 || h.actionCtr < 6) h.actionCtr = 6;
      } else {
        // vers la droite
        h.setPosition(h.x + 2, h.y);
        h.actionCtr = h.actionCtr + 1;
        if (h.actionCtr >= 6) h.actionCtr = 0;
      }
    } else {
      // Il s'arrête.
      h.actionCtr = 12;
      h.frameCtr = h.frameCtr & 0x7f;
    }
    h.setFrameNumber(h.actionCtr);
    return;
  }

  // Les autres actions.
  const action = h.frameCtr & 0x3f;
  switch (action) {
    case BarmanAction.WALK_AROUND: {
      // Flâner entre les deux bouts du bar.
      const walk = h.hotspotId === HotspotId.EWAN ? EWAN_WALK : OTHER_WALK;
      h.supportValue = rng.number(walk.max) + walk.min;
      h.frameCtr = BARMAN_MOVING | 3;
      return;
    }

    case BarmanAction.POLISH_BAR:
    case BarmanAction.SERVE_BEER: {
      if (action === BarmanAction.SERVE_BEER) {
        // Servir une bière.
        if ((h.frameCtr & BARMAN_STARTED) === 0) h.supportValue = h.res.flags2;
      } else if ((h.frameCtr & BARMAN_STARTED) === 0) {
        // Un nouveau polissage commence.
        let id = 0; // BG_RANDOM << 8
        if (h.hotspotId === HotspotId.EWAN) {
          const player = world.requireHotspot(HotspotId.PLAYER);
          const gwen = world.requireHotspot(HotspotId.GWEN);
          const wayne = world.requireHotspot(HotspotId.WAYNE);
          if (player.roomNumber !== EWAN_SHOP_ROOM && gwen.roomNumber !== EWAN_SHOP_ROOM && wayne.roomNumber !== EWAN_SHOP_ROOM) {
            h.setAnimationIndex(AnimIndex.EWAN);
            if (rng.number(1) === 1) {
              id = 2 << 8; // BG_EXTRA1
            } else {
              // Animation alternative.
              h.width = 32;
              h.frameWidth = 32;
              h.setAnimationIndex(AnimIndex.EWAN_ALT);
              bar.ewanXOffset = true;
              h.setPosition(h.x - 8, h.y);
              id = 3 << 8; // BG_EXTRA2
            }
          }
        }
        h.supportValue = id;
      }

      // Un polissage ou un service est en cours : image suivante.
      h.frameCtr = h.frameCtr | BARMAN_STARTED;
      h.supportValue = (h.supportValue + 1) & 0xffff;
      const frameList = entry.graphics[h.supportValue >> 8];
      if (!frameList) throw new Error(`barman ${h.hotspotId.toString(16)} : pas de liste d'images ${h.supportValue >> 8}`);
      const frameNumber = frameList[h.supportValue & 0xff] ?? 0;

      if (frameNumber !== 0) {
        h.actionCtr = frameNumber;
        h.setFrameNumber(frameNumber);
        return;
      }

      if (h.hotspotId === HotspotId.EWAN) {
        // Ewan reprend son animation ordinaire.
        h.width = 16;
        h.frameWidth = 16;
        h.setAnimationIndex(AnimIndex.EWAN);
        if (bar.ewanXOffset) {
          h.setPosition(h.x + 8, h.y);
          bar.ewanXOffset = false;
        }
      }
      break;
    }

    case BarmanAction.WAIT_DIALOG:
      if (ctx.room.isDialogActive()) {
        h.setFrameNumber(h.actionCtr);
        return;
      }
      break;

    default:
      // WAIT : la sortie du `switch` arrête le barman.
      break;
  }

  // Le barman arrête ce qu'il faisait.
  if (action !== BarmanAction.WAIT_DIALOG) h.delayCtr = 10;
  h.frameCtr = 0;
  h.actionCtr = 12;
  h.setFrameNumber(h.actionCtr);
}
