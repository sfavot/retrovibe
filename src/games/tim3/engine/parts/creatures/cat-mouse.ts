/** Chat Curie (12), souris de Newton (42), fromage (52, sans handler), trou de souris (66) : ils interagissent (le chat mange la souris, le trou l'avale). */
import type { HandlerRegistry } from "../registry";
import { registerCat } from "./cat";
import { registerMouse } from "./mouse";

export function register(r: HandlerRegistry): void {
  registerCat(r);
  registerMouse(r);
}
