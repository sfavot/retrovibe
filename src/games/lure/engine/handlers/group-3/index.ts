/**
 * Groupe L3 : gestionnaires de tick du village (thé, Grub, barmen, Skorls de la taverne, Goewin à la boutique).
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::teaAnimHandler`, `grubAnimHandler`, `barmanAnimHandler`, `skorlAnimHandler`,
 * `goewinShopAnimHandler` (engines/lure/hotspots.cpp).
 *
 * Écarts : voir `barman.ts`. Règle de la vague T : chaque gestionnaire d'un personnage qui parle appelle `handleTalkDialog()` en tête,
 * comme ScummVM (grub, barmen, Skorls, Goewin ; le thé n'est pas un personnage).
 */

import type { HandlerGroupTable } from "../index";
import { barmanAnimHandler } from "./barman";
import { goewinShopAnimHandler } from "./goewin-shop";
import { grubAnimHandler } from "./grub";
import { skorlAnimHandler } from "./skorl";
import { teaAnimHandler } from "./tea";

export const GROUP_3_HANDLERS: HandlerGroupTable = {
  teaAnimHandler,
  grubAnimHandler,
  barmanAnimHandler,
  skorlAnimHandler,
  goewinShopAnimHandler,
};
