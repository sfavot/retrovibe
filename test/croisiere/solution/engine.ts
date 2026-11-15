/**
 * Moteur de la partie complète (vague K) : vrais fichiers (volumes, `SYSTEM.FNT`, `DELPHINE.LNG`), graine 1, contournement de la
 * protection, service son branché sur un pilote OPL muet (la musique compte dans la logique : fondus, `songPlayed`), comme le rejeu du banc
 * (`engine/replay.ts`). Et la reprise d'une sauvegarde dans un moteur neuf, comme `engine/save.test.ts`.
 */

import { TestHost } from "../../../src/games/croisiere/engine/host";
import { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { captureSave, parseSave, restoreSave } from "../../../src/games/croisiere/engine/save";
import { SoundService } from "../../../src/games/croisiere/engine/sound-service";
import type { EngineTrace } from "../../../src/games/croisiere/engine/trace";
import { gameFilesWithLooseFiles } from "../engine/support";

export function makeEngine(trace: EngineTrace | null = null): CroisiereEngine {
  const files = gameFilesWithLooseFiles();
  const sound = new SoundService({ write() {} }, (name) => (files.has(name) ? files.readFile(name) : undefined));
  return new CroisiereEngine(new TestHost(), { files, seed: 1, trace, sound });
}

/** Ce que le banc garde d'un tour à l'autre hors de la partie (champs privés du moteur). */
interface BenchInputState {
  prevLevel: { x: number; y: number; b: number };
  escReleaseTick: number;
}

/**
 * Sauvegarde `old`, la fait passer par `JSON.stringify` / `JSON.parse`, puis la reprend dans un moteur neuf. Hors de la sauvegarde, comme
 * `engine/save.test.ts` : numéro de tour, état du RNG (non sauvegardé, D5), souris et état des entrées rejouées.
 */
export function resumeInFreshEngine(old: CroisiereEngine, trace: EngineTrace | null = null): { engine: CroisiereEngine; size: number } {
  const text = JSON.stringify(captureSave(old.state));
  const save = parseSave(JSON.parse(text));
  if (!save) throw new Error("sauvegarde refusée par parseSave");
  const fresh = makeEngine(trace);
  restoreSave(fresh.state, save);
  fresh.frameNumber = old.frameNumber;
  fresh.state.rnd.seed(old.state.rnd.state);
  const o = old.state;
  const f = fresh.state;
  f.currentMouseX = o.currentMouseX;
  f.currentMouseY = o.currentMouseY;
  f.currentMouseButton = o.currentMouseButton;
  Object.assign(fresh.input, { hoverX: old.input.hoverX, hoverY: old.input.hoverY, mouseButtonDown: old.input.mouseButtonDown, endPause: old.input.endPause });
  const from = old as unknown as BenchInputState;
  const to = fresh as unknown as BenchInputState;
  to.prevLevel = { ...from.prevLevel };
  to.escReleaseTick = from.escReleaseTick;
  return { engine: fresh, size: text.length };
}
