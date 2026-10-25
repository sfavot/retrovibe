import { EventOp } from "../engine/events";
import type { EventHandler, HandlerRegistry } from "../engine/handlers";
import { FAMILY } from "../engine/handlers";
import { NUM } from "./helpers";
import { type NpcKit, RESTART } from "./npc-kit";

/**
 * Événements différés des personnages (famille 8, `objects.md` § 8, `characters.md` § 9.2) : ours (clé 4), nains (clé 201), crapaud (clé 327).
 * Ceux de Prytwen (101) et de Minas Thyl (303) sont dans `npc-prytwen.ts` et `npc-minas.ts`.
 */

const BEAR_HUNGER = 24000;
/** Faim de l'ours dans la salle chargée : il reste à surveiller (100 tics). */
const BEAR_WATCH = 100;

/** `26da:0800` : 9 = faim (`Ego 0 -> 1`, puis mort de faim hors de la salle chargée : fourrure `Num 5` et carcasse `Num 15`). */
export function bearEvent(kit: NpcKit): EventHandler {
  return (ctx, entry, bear) => {
    if (!bear || entry.event !== 9) return; // l'événement 12 n'a pas de procédure (drapeau « rassasié »)
    const target = { typ: bear.typ, num: bear.num, serial: bear.serial };
    if (bear.ego === 0) {
      ctx.events.operate(target, 9, EventOp.Set, BEAR_HUNGER, NUM.bear);
      bear.ego = 1;
    } else if (bear.ego === 1) {
      if (kit.inLoadedRoom(ctx, bear)) {
        ctx.events.operate(target, 9, EventOp.Set, BEAR_WATCH, NUM.bear);
        return;
      }
      const fur = kit.spawn(ctx, bear, 5, { gst: 0, mob: 0, ego: 0, fig: 0 });
      const carcass = kit.spawn(ctx, bear, NUM.carcass, { gst: 0, mob: 0, ego: 0, fig: 0 });
      if (carcass) carcass.p -= 1;
      void fur;
      kit.destroy(ctx, bear, true);
      void RESTART;
    }
  };
}

/** `2a44:12fc` : 3 et 4 = réveil d'un nain endormi (`Ego >= 7 -> 0`). */
export function dwarfEvent(kit: NpcKit): EventHandler {
  return (ctx, entry, dwarf) => {
    if (!dwarf || (entry.event !== 3 && entry.event !== 4)) return;
    if (dwarf.ego > 6) {
      kit.setState(ctx, dwarf, { ego: 0, fig: 0 });
      ctx.motion.reset(dwarf);
      kit.sayHere(ctx, dwarf, "G", 342);
    }
  };
}

/** `2d52:07fe` : 8 = le crapaud pensif repart (`Ego 1 -> 0`). */
export function toadEvent(): EventHandler {
  return (_ctx, entry, toad) => {
    if (toad && entry.event === 8 && toad.ego === 1) toad.ego = 0;
  };
}

export function registerNpcEvents(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.event, NUM.bear, bearEvent(kit));
  registry.register(FAMILY.event, NUM.dwarfMiner, dwarfEvent(kit));
  registry.register(FAMILY.event, NUM.toad, toadEvent());
}
