/**
 * Fin de catégorie : `BINSOLVE.ITF` (419c9c, procédure 419ce9), ouverte pendant l'initialisation de PUZZSOLV (4261c3), donc par-dessus.
 *
 * - Les huit images 32018 à 32025 sont cachées, puis : tout est résolu (42ccae rend 4) → coupe d'or (32018) et tous les bacs (32025),
 *   texte 5 ; une catégorie k est finie → coupe d'argent (32019) et le bac 32020 + k, texte k (`BINSOLVE.RES`, textes 14001…).
 * - BS_TEXT (32007) : le jeu lui pose le drapeau 8 juste avant d'y copier le texte (45064c) ; le port l'affiche (hypothèse la plus
 *   défendable : sinon la fenêtre n'aurait pas de texte).
 * - BS_ANIM (32106, style 17) : le professeur animé, sans voix (419e2a → 423e50(32106, 0), `ui/professor.ts`) : quatre passes au
 *   repos de la parole, puis l'attente (`PROFAMBT.ANM`) ; dessiné retourné en (x + `unknown12` − 396, y + `unknown14`) par 424089.
 * - OK (32008) est la seule sortie : Entrée et Échap. Le jeu arrête la voix et relance la musique courante à la fermeture (423f9d).
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost } from "./itf-window";
import { Professor, type ProfessorAudio, type Random } from "./professor";

export const BINSOLVE = { anim: 32106, gold: 32018, silver: 32019, firstBin: 32020, allBins: 32025, text: 32007, done: 32008 } as const;

/** Images montrées : `category` 0 à 4, ou `"all"` (tous les puzzles résolus). */
export function binsolveShown(category: number | "all"): number[] {
  return category === "all" ? [BINSOLVE.gold, BINSOLVE.allBins] : [BINSOLVE.silver, BINSOLVE.firstBin + category];
}

export function binsolveWindow(
  assets: RenderAssets,
  itf: Itf,
  category: number | "all",
  text: string,
  audio: ProfessorAudio,
  random?: Random,
): { itf: Itf; options: ItfWindowOptions; professor: Professor } {
  const shown = new Set(binsolveShown(category));
  const hidden: number[] = [];
  for (let id = BINSOLVE.gold; id <= BINSOLVE.allBins; id++) if (!shown.has(id)) hidden.push(id);
  const professor = new Professor(assets, audio, null, random);
  const anim = itf.controls.find((c) => c.id === BINSOLVE.anim);
  return {
    itf,
    professor,
    options: {
      title: copy.binsolveTitle,
      state: { hidden, texts: { [BINSOLVE.text]: text }, ...(anim ? { draw: { [BINSOLVE.anim]: (surface, rect) => professor.draw(surface, assets, anim, rect) } } : {}) },
      defaultId: BINSOLVE.done,
      cancelId: BINSOLVE.done,
      tick: () => professor.pass(),
      choose: () => false,
      onClose: () => professor.stop(),
    },
  };
}

export function openBinsolveWindow(host: ItfHost, audio: ProfessorAudio, category: number | "all", text: string, onClose?: () => void): ItfWindowHandle {
  const w = binsolveWindow(host.assets, readItf(host.assets.index.get("BINSOLVE.ITF")), category, text, audio);
  return openItfWindow(host, w.itf, {
    ...w.options,
    onClose: () => {
      w.professor.stop();
      onClose?.();
    },
  });
}
