/**
 * Fin de catégorie : `BINSOLVE.ITF` (419c9c, procédure 419ce9), ouverte pendant l'initialisation de PUZZSOLV (4261c3), donc par-dessus.
 *
 * - Les huit images 32018 à 32025 sont cachées, puis : tout est résolu (42ccae rend 4) → coupe d'or (32018) et tous les bacs (32025),
 *   texte 5 ; une catégorie k est finie → coupe d'argent (32019) et le bac 32020 + k, texte k (`BINSOLVE.RES`, textes 14001…).
 * - BS_TEXT (32007) : le jeu lui pose le drapeau 8 juste avant d'y copier le texte (45064c) ; le port l'affiche (hypothèse la plus
 *   défendable : sinon la fenêtre n'aurait pas de texte).
 * - BS_ANIM (32106, style 17) : le professeur, sans voix (423e50, voix 0) ; le port pose l'image de repos de `PROFAMBT.ANM` (état 32),
 *   centrée dans la zone (supposé : l'origine de 424089 n'est pas établie).
 * - OK (32008) est la seule sortie : Entrée et Échap. Le jeu arrête la voix et relance la musique courante à la fermeture (423f9d).
 */
import { readItf, type Itf } from "../data/itf";
import { drawAnmImage, imageFrame } from "../render/anm-draw";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { imageOfState } from "../render/itf-draw";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost } from "./itf-window";

export const BINSOLVE = { anim: 32106, gold: 32018, silver: 32019, firstBin: 32020, allBins: 32025, text: 32007, done: 32008 } as const;
/** Professeur au repos (`[0x472be4]` = 32 dans PROFAMBT.ANM). */
const PROFESSOR = { anm: "PROFAMBT.ANM", state: 32 } as const;

/** Images montrées : `category` 0 à 4, ou `"all"` (tous les puzzles résolus). */
export function binsolveShown(category: number | "all"): number[] {
  return category === "all" ? [BINSOLVE.gold, BINSOLVE.allBins] : [BINSOLVE.silver, BINSOLVE.firstBin + category];
}

export function binsolveWindow(assets: RenderAssets, itf: Itf, category: number | "all", text: string): { itf: Itf; options: ItfWindowOptions } {
  const shown = new Set(binsolveShown(category));
  const hidden: number[] = [];
  for (let id = BINSOLVE.gold; id <= BINSOLVE.allBins; id++) if (!shown.has(id)) hidden.push(id);
  const drawProfessor = (surface: Surface, r: Rect): void => {
    const anm = assets.anm(PROFESSOR.anm);
    const image = anm ? imageOfState(anm, PROFESSOR.state) : -1;
    const f = anm && image >= 0 ? imageFrame(anm, image) : null;
    if (!anm || !f) return;
    const clip = surface.setClip(r.x, r.y, r.width, r.height);
    drawAnmImage(surface, assets, anm, image, r.x + Math.trunc((r.width - f.width) / 2) - f.x, r.y + Math.trunc((r.height - f.height) / 2) - f.y);
    surface.restoreClip(clip);
  };
  return {
    itf,
    options: {
      title: copy.binsolveTitle,
      state: { hidden, texts: { [BINSOLVE.text]: text }, draw: { [BINSOLVE.anim]: drawProfessor } },
      defaultId: BINSOLVE.done,
      cancelId: BINSOLVE.done,
      choose: () => false,
    },
  };
}

export function openBinsolveWindow(host: ItfHost, category: number | "all", text: string, onClose?: () => void): ItfWindowHandle {
  const w = binsolveWindow(host.assets, readItf(host.assets.index.get("BINSOLVE.ITF")), category, text);
  return openItfWindow(host, w.itf, { ...w.options, ...(onClose ? { onClose } : {}) });
}
