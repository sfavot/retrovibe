import type { GraphicsSystems } from "../graphics";
import type { Subsystems } from "../host";
import { MultImpl } from "./mult";

export { MultImpl } from "./mult";
export { Scenery } from "./scenery";

/** Remplace `mult` de `sys` par le vrai système d'animations, dessinant par les sous-systèmes graphiques. */
export function installMult(sys: Subsystems, gfx: GraphicsSystems): MultImpl {
  const mult = new MultImpl(sys, gfx);
  sys.mult = mult;
  const previous = sys.attach?.bind(sys);
  sys.attach = (vm) => {
    previous?.(vm);
    mult.attach(vm);
  };
  return mult;
}
