import { describe, expect, it } from "vitest";
import { Flag as Chapter6Flag } from "../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { hasOriginalFiles } from "../helpers";
import { solveChapter1, solveChapter2, solveChapter3, solveChapter4, solveChapter5, solveChapter6 } from "../solutions";
import type { Walkthrough } from "../walkthrough";
import { type CheckpointWalkthrough, type ResumeMode, startCheckpoint } from "./checkpoint";

const CHAPTERS: { chapter: number; solve: (w: Walkthrough) => void }[] = [
  { chapter: 1, solve: solveChapter1 },
  { chapter: 2, solve: solveChapter2 },
  { chapter: 3, solve: solveChapter3 },
  { chapter: 4, solve: solveChapter4 },
  { chapter: 5, solve: solveChapter5 },
  { chapter: 6, solve: solveChapter6 },
];

/**
 * Après le pendule, le chapitre 6 garde dans `front` la feuille de profil (`97.ALG`, chargée par `animation_6_6` comme dans ScummVM) : le héros
 * « de face » est dessiné de profil. Une partie chargée recharge `96.ALG` (comme `loadGame` de ScummVM) et le dessine de face : seule différence
 * d'image tolérée, sur le héros.
 */
function allowedPixelDiff(w: CheckpointWalkthrough): number {
  return w.before?.chapter === 6 && w.before.flags[Chapter6Flag.Free] === 1 ? 2000 : 0;
}

/**
 * Aller-retour de sauvegarde à chaque repos de la solution de chaque chapitre (là où l'on peut sauvegarder : pas pendant une séquence) :
 * la partie est sauvegardée dans un emplacement (JSON), reprise dans un autre moteur, puis la solution continue sur ce moteur jusqu'à la fin
 * du chapitre. L'état repris est le même, la pièce se redessine à l'identique.
 */
function roundTrips(mode: ResumeMode, maxRuns: number): void {
  for (const { chapter, solve } of CHAPTERS) {
    it(`chapitre ${chapter}, ${mode === "fresh" ? "dans un moteur neuf" : "pendant une partie d'un autre chapitre"}`, () => {
      const dry = startCheckpoint(chapter, 0, mode);
      solve(dry);
      const rests = dry.savable;
      expect(rests.length, "la solution a des repos où sauvegarder").toBeGreaterThan(2);
      let swaps = 0;
      const every = Math.max(1, Math.ceil(rests.length / maxRuns));
      for (const at of rests.filter((_, i) => i % every === 0)) {
        const w = startCheckpoint(chapter, at, mode);
        solve(w);
        expect(w.roomAtSwap, `repos ${at} : la partie a été reprise`).not.toBeNull();
        expect(w.differences, `repos ${at} (pièce ${w.roomAtSwap})`).toEqual([]);
        expect(w.pixelDiff, `repos ${at} (pièce ${w.roomAtSwap}) : image`).toBeLessThanOrEqual(allowedPixelDiff(w));
        swaps++;
      }
      expect(swaps).toBeGreaterThan(0);
    }, 300_000);
  }
}

describe.skipIf(!hasOriginalFiles)("sauvegarde : aller-retour dans la solution de chaque chapitre", () => {
  roundTrips("fresh", Infinity);
});

describe.skipIf(!hasOriginalFiles)("chargement en cours de partie, avec changement de chapitre", () => {
  roundTrips("other-chapter", 12);
});
