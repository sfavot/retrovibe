/**
 * Familles de pièces portées. La vague Φ2 ajoute ici une ligne par famille (`parts/<famille>/index.ts` exporte
 * `register`), sans toucher au noyau.
 */
import * as balls from "./balls";
import * as core from "./core";
import * as creatures from "./creatures";
import * as electric from "./electric";
import * as mechanics from "./mechanics";
import * as misc from "./misc";
import * as pyro from "./pyro";
import { HandlerRegistry } from "./registry";
import * as slopes from "./slopes";
import * as walls from "./walls";

const FAMILIES = [core, balls, walls, slopes, mechanics, electric, creatures, pyro, misc];

export function defaultRegistry(): HandlerRegistry {
  const r = new HandlerRegistry();
  for (const f of FAMILIES) f.register(r);
  return r;
}
