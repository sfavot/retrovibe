import type { Picture } from "../../../engine/infogrames/data/mcg";
import type { Runtime, Script } from "./runtime";

/**
 * Logos et introduction M06 (`15d7:0a80`, `docs/asterix/engine.md` §1.2). Chaque vidéo se saute séparément (bouton ou
 * Échap), sauf `M32AB` qui est sautée avec `M06AAA`.
 */

/**
 * `15d7:0006(préfixe)` : un logo. Image `<préfixe>0.mcc` en fondu d'entrée, vidéo `<préfixe>.mux` (options `0x20D08`),
 * image finale `<préfixe>1.mcc` sans changer la palette ; si la vidéo a été interrompue, 3 s d'attente au plus.
 */
function* logo(rt: Runtime, prefix: string): Script {
  yield* rt.picture(`${prefix}0.mcc`, 1);
  const interrupted = yield* rt.video(`${prefix}.mux`);
  if (interrupted) while (rt.buttonHeld) yield;
  yield* rt.picture(`${prefix}1.mcc`, 4);
  if (interrupted) yield* rt.waitAny(3);
  yield* rt.fadeOut(8);
}

/** Décor et palette de `M06AC` par marqueur `08` (`15d7:093b`) : numéro du décor, et palette entière ou moitié haute. */
const PLANS: Readonly<Record<number, readonly [number, boolean]>> = {
  1: [2, false],
  4: [2, false],
  6: [2, false],
  2: [4, false],
  5: [4, false],
  3: [5, true],
  7: [3, false],
  9: [3, false],
  8: [1, false],
  10: [6, true],
};

/**
 * `M06AC.MUX` (options `0x2C84`, rappel `15d7:093b`) : un personnage animé posé sur six décors `M06DC00n.MCG`, choisis par
 * les marqueurs `08` du fichier. À chaque image le décor du plan courant est recopié et l'image se décode par-dessus.
 */
function* finalSequence(rt: Runtime): Script {
  const { palette, surface, resources } = rt.ctx;
  const decors: Picture[] = [];
  for (let n = 1; n <= 6; n++) decors.push(yield* rt.load(resources.mcg(`M06DC00${n}.MCG`)));
  // Couleurs 133 et 137 de P1 et P2 retouchées.
  const palettes = decors.map((decor) => decor.palette.slice());
  for (const retouched of [palettes[0], palettes[1]]) {
    retouched.set([0x63, 0x38, 0x4c], 133 * 3);
    retouched.set([0x75, 0x4c, 0xb7], 137 * 3);
  }
  let plan = 0;
  yield* rt.video("M06AC.MUX", {
    keepPalette: true,
    target: surface.work,
    draw: (video) => {
      const selected = PLANS[video.marker];
      if (selected) {
        plan = selected[0];
        if (selected[1]) palette.load(palettes[plan - 1], 128, 128);
        else palette.load(palettes[plan - 1]);
      }
      video.marker = -1;
      if (plan > 0) {
        surface.work.set(decors[plan - 1].pixels);
        video.compose(surface.work);
      }
    },
  });
}

/** `15d7:0a80` : trois logos, puis l'introduction. */
export function* intro(rt: Runtime): Script {
  // Langue française : `m52b` (les autres langues ont `m52f`).
  for (const prefix of ["m52a", "m52b", "m52c"]) yield* logo(rt, prefix);
  if (!(yield* rt.video("M06AAA.MUX"))) yield* rt.video("M32AB.MUX", { keepPalette: true });
  yield* rt.fadeOut();
  yield* rt.video("M06AB.MUX");
  yield* rt.fadeOut();
  yield* finalSequence(rt);
  yield* rt.fadeOut();
}
