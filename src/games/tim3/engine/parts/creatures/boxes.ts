/**
 * Pièces à boîte de la famille « creatures » : diable en boîte (13, `jack.ts`), alligator (61, `gator.ts`), grille-pain (81,
 * `toaster.ts`) et leprechaun (65, ci-dessous). Traduit de TIMWIN.EXE ; la zone de frappe commune est dans `strike.ts`.
 */
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { register as registerGator } from "./gator";
import { register as registerJack } from "./jack";
import { stateAt } from "./kernel";
import { register as registerToaster } from "./toaster";

const LEPRECHAUN = 65;

/** 445698 (slot 0) : une pièce touche le leprechaun : il se déclenche pour quatre cycles d'animation. Accepte toujours. */
function leprechaunAccept(p: Part, toucher: Part): number {
  const l = toucher.contact ?? p;
  l.f24 = 1;
  l.f104 = 4;
  return 1;
}

/** 4456bc (slot 1) : déclenché, avance d'une image ; à la fin de l'ANM revient à 0 ; après quatre cycles s'arrête. */
function leprechaunRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.frame = (p.frame + 1) | 0;
  if (stateAt(world.types, LEPRECHAUN, p.frame) === -1) {
    p.frame = 0;
    p.f104 = (p.f104 - 1) | 0;
    if (p.f104 === 0) p.f24 = 0;
  }
  updateGeometry(world, p); // 439b58
}

export function register(r: HandlerRegistry): void {
  registerJack(r);
  registerGator(r);
  registerToaster(r);
  r.register(0x445698, "leprechaun.accept", (_w, p, a) => (a && typeof a === "object" ? leprechaunAccept(p, a) : 1));
  r.register(0x4456bc, "leprechaun.run", (w, p) => leprechaunRun(w, p));
}
