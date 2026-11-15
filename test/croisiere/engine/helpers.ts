import { TestHost } from "../../../src/games/croisiere/engine/host";
import { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { buildOverlay, memoryFiles, type OverlaySpec } from "./ovl-builder";

/** Moteur sur des overlays synthétiques ; `AUTO00` est l'overlay de démarrage (procédure 0). */
export function makeEngine(overlays: Record<string, OverlaySpec>, extra: Record<string, Uint8Array> = {}) {
  const files: Record<string, Uint8Array> = { ...extra };
  for (const [name, spec] of Object.entries(overlays)) files[`${name}.OVL`] = buildOverlay(spec);
  const host = new TestHost();
  const engine = new CroisiereEngine(host, { files: memoryFiles(files), seed: 1 });
  return { engine, host, e: engine.state };
}

/** Mot BE signé du BSS de l'overlay `ovl`. */
export function bssWord(e: CroisiereEngine["state"], ovl: number, offset: number): number {
  const bss = e.overlays.entries[ovl]!.data!.bss;
  return (((bss[offset]! << 8) | bss[offset + 1]!) << 16) >> 16;
}

/** Concatène des fragments d'assembleur. */
export const code = (...parts: number[][]) => parts.flat();
