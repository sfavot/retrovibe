import { parseLevel, type Level } from "../../../src/games/swiv3d/data/level";
import { loadModels } from "../../../src/games/swiv3d/engine/world";
import type { Model } from "../../../src/games/swiv3d/data/model";
import { hasOriginalFiles, readOriginal } from "../helpers";

export { hasOriginalFiles };

const cache = new Map<string, { level: Level; models: Map<number, Model> }>();

/** Niveau et modèles d'un `.SLV` du jeu (mis en cache : le parsing prend ~1 s). */
export function loadLevel(name: string): {
  level: Level;
  models: Map<number, Model>;
} {
  let e = cache.get(name);
  if (!e) {
    const bytes = readOriginal(`${name}.SLV`);
    e = { level: parseLevel(bytes, name), models: loadModels(bytes, name) };
    cache.set(name, e);
  }
  return e;
}
