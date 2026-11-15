/**
 * Famille « mechanics » (vague Φ2, `docs/tim3/plan.md`, groupes de Φ2) : cordes, câbles, poulies, courroies, seaux,
 * bascules, engrenages, moteurs, convoyeur, et fonctions de noyau qui leur sont propres (tension des cordes 43a31d,
 * extrémités 438db6 / 438c70, seaux, liste auxiliaire).
 */
import { RopeData, BeltData } from "../../part";
import type { HandlerRegistry } from "../registry";
import { updateBeltEnds } from "./belt";
import * as air from "./air";
import * as bucket from "./bucket";
import * as cleat from "./cleat";
import * as coffee from "./coffee";
import * as conveyor from "./conveyor";
import * as electricMotors from "./electric-motors";
import * as gears from "./gears";
import * as laser from "./laser";
import * as generator from "./generator";
import * as motors from "./motors";
import * as seesaw from "./seesaw";
import * as trm from "./trm";
import { resetRope, ropeTension, updateRopeEnds } from "./rope";

export function register(r: HandlerRegistry): void {
  conveyor.register(r);
  bucket.register(r);
  air.register(r);
  coffee.register(r);
  cleat.register(r);
  motors.register(r);
  gears.register(r);
  electricMotors.register(r);
  generator.register(r);
  seesaw.register(r);
  trm.register(r);
  laser.register(r);
  r.registerSpecial(0x43a31d, "rope.tension", (w, p) => ropeTension(w, p));
  r.registerSpecial(0x438db6, "rope.ends", (w, p, rope) => updateRopeEnds(w, (rope as RopeData | undefined) ?? p.ropes[0]));
  r.registerSpecial(0x43af6d, "rope.reset", (w, p) => resetRope(w, p));
  r.registerSpecial(0x438c70, "belt.ends", (_w, p) => updateBeltEnds(p.belt));

  // Slot 7 (création dans l'éditeur ; avec `null` : initialisation du type, rend 1).
  // 43e6a4 : corde et câble (10, 76) : structure de corde neuve.
  r.register(0x43e6a4, "rope.create", (_w, p) => {
    if (!p) return 1;
    p.ropes[0] = new RopeData(p);
    return 1;
  });
  // 43e6df : poulie (7) : points d'attache (0, 8) et (15, 8), puis 43e6a4.
  r.register(0x43e6df, "pulley.create", (_w, p) => {
    if (!p) return 1;
    p.ropeAnchor.set([0, 8, 15, 8]);
    p.ropes[0] = new RopeData(p);
    return 1;
  });
  // 43e715 : bout de corde (49) : point d'attache (0, 0).
  r.register(0x43e715, "ropeEnd.create", (_w, p) => {
    if (p) {
      p.ropeAnchor[0] = 0;
      p.ropeAnchor[1] = 0;
    }
    return 1;
  });
  // 43f460 : courroie (8) : structure de courroie neuve.
  r.register(0x43f460, "belt.create", (_w, p) => {
    if (!p) return 1;
    p.belt = new BeltData(p);
    return 1;
  });
}
