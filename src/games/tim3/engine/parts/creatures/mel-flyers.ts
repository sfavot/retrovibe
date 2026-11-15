/**
 * Mel (54) et sa maison (58), mandrill (31), chauve-souris (32), Cupidon (33), Père Noël (34) : un fichier par groupe de
 * types (`mel.ts`, `mandrill.ts`, `flyers.ts`).
 */
import type { HandlerRegistry } from "../registry";
import { register as registerFlyers } from "./flyers";
import { register as registerMandrill } from "./mandrill";
import { register as registerMel } from "./mel";

export function register(r: HandlerRegistry): void {
  registerMel(r);
  registerMandrill(r);
  registerFlyers(r);
}
