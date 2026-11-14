import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BassEngine, type BassEngineOptions } from "../../../src/games/bass/engine/game";
import { TestHost } from "../../../src/games/bass/engine/host";
import { hasOriginalFiles, skyCpt, skyDisk } from "../data/helpers";

export { hasOriginalFiles };

/** Moteur sur les vrais fichiers (le `SkyCpt` partagé n'est pas modifié : `Compacts` en copie les données). */
export function makeEngine(options: Partial<BassEngineOptions> = {}): { engine: BassEngine; host: TestHost } {
  const host = (options.host as TestHost | undefined) ?? new TestHost();
  const engine = new BassEngine({ data: { disk: skyDisk(), cpt: skyCpt() }, ...options, host });
  return { engine, host };
}

/** Lignes d'une trace de référence de `fixtures/` (commentaires `#` retirés). */
export function readFixture(name: string): string[] {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
}

/** Numéro de tour d'une ligne `CY n …` ou `MC n …`. */
export function lineCycle(line: string): number {
  return Number(line.split(" ")[1]);
}
