import { HotspotType, Layer, type Zone } from "../../data/types";
import type { Assets } from "../assets";
import { Instr } from "../script";

/**
 * Certaines zones placent leur PNJ ou leur objet là où le héros ne peut pas aller (ex. Puzzle50 :
 * PNJ au fond d'un canyon fermé, sans script). Ce module écarte ces zones de la génération.
 *
 * Analyse statique : déplacements à 8 directions sur la couche objets (objets déplaçables
 * franchissables). Une zone dont les scripts modifient la couche objets (labyrinthes, grilles)
 * est présumée praticable.
 */

const caches = new WeakMap<Assets, Map<string, boolean>>();

function scriptsChangeObstacles(zone: Zone): boolean {
  return zone.actions.some((a) =>
    a.instructions.some(
      (i) =>
        (i.opcode === Instr.PlaceTile || i.opcode === Instr.RemoveTile || i.opcode === Instr.MoveTile) &&
        i.args[2] === Layer.Object,
    ),
  );
}

function walkable(assets: Assets, zone: Zone, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= zone.width || y >= zone.height) return false;
  const tile = zone.tiles[3 * (y * zone.width + x) + Layer.Object];
  return tile === -1 || assets.isDraggable(tile);
}

/** Cases atteignables depuis les bords (zone extérieure) ou depuis la sortie (pièce). */
function reachableCells(assets: Assets, zone: Zone, fromEdges: boolean): Set<number> {
  const starts: Array<[number, number]> = [];
  if (fromEdges) {
    for (let k = 0; k < zone.width; k++) starts.push([0, k], [zone.width - 1, k], [k, 0], [k, zone.height - 1]);
  } else {
    for (const h of zone.hotspots) if (h.type === HotspotType.DoorOut) starts.push([h.x, h.y]);
  }
  const key = (x: number, y: number) => x + y * zone.width;
  const queue = starts.filter(([x, y]) => walkable(assets, zone, x, y));
  const seen = new Set(queue.map(([x, y]) => key(x, y)));
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (seen.has(key(nx, ny)) || !walkable(assets, zone, nx, ny)) continue;
        seen.add(key(nx, ny));
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

/**
 * Vrai si, dans la zone `rootId` ou l'une de ses pièces, au moins un hotspot d'un des types donnés
 * peut être approché (case voisine, diagonales comprises).
 */
export function canReachHotspot(assets: Assets, rootId: number, types: HotspotType[]): boolean {
  let cache = caches.get(assets);
  if (!cache) caches.set(assets, (cache = new Map()));
  const cacheKey = `${rootId}:${types.join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let result = false;
  for (const zone of assets.roomsOf(rootId)) {
    const targets = zone.hotspots.filter((h) => types.includes(h.type));
    if (!targets.length) continue;
    if (scriptsChangeObstacles(zone)) {
      result = true;
      break;
    }
    const cells = reachableCells(assets, zone, zone.id === rootId);
    const near = targets.some((h) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (cells.has(h.x + dx + (h.y + dy) * zone.width)) return true;
      return false;
    });
    if (near) {
      result = true;
      break;
    }
  }
  cache.set(cacheKey, result);
  return result;
}
