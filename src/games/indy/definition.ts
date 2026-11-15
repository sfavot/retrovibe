import type { Assets } from "../../engine/desktop-adventures/assets";
import { ZoneType } from "../../engine/desktop-adventures/data/types";
import type { Point } from "../../engine/desktop-adventures/geometry";
import type { DesktopAdventure } from "../../ui/desktop-adventures/definition";
import { copy } from "./copy";
import { generateStory } from "./generation/generator";
import { MAX_VICTORIES, recordGoal } from "./history";
import { IndyIds, IndySounds, indySoundCatalog } from "./ids";
import { indyVariant } from "./variant";

/** Case de départ : devant le bureau de Marcus, en ville. */
const START = { zone: IndyIds.townZone, at: { x: 11, y: 5 } };

/** Progression d'Indy : historique des objectifs et victoires de DESKADV.INI (voir `history.ts`). */
export const indyProgressRules = { recordGoal, maxVictories: MAX_VICTORIES };

/** Identifiants ICON de DESKADV.EXE pour la boussole. */
export const INDY_COMPASS_ICONS = {
  down: { off: 3, on: 4 },
  left: { off: 5, on: 6 },
  right: { off: 7, on: 8 },
  up: { off: 9, on: 10 },
};

function freeCellNear(assets: Assets, zoneId: number, at: Point): Point {
  const zone = assets.zone(zoneId);
  for (let r = 0; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (x < 0 || y < 0 || x >= zone.width || y >= zone.height) continue;
        if (zone.tiles[3 * (y * zone.width + x) + 1] === -1) return { x, y };
      }
    }
  }
  return at;
}

/** « Indiana Jones and his Desktop Adventures » pour l'interface commune. `exe` : DESKADV.EXE (sons intégrés). */
export function indyAdventure(dawSounds: readonly string[], baseUrl: string, exe: ArrayBuffer): DesktopAdventure {
  return {
    key: "indy",
    variant: indyVariant,
    copy,
    sounds: indySoundCatalog(dawSounds, baseUrl, exe),
    theme: IndySounds.Theme,
    mapKey: "KeyM",
    locator: {
      unvisited: 1138,
      here: 639,
      empty: 377,
      town: 375,
      goal: [408, 376],
      travel: [365, 366],
      puzzle: [363, 364],
      teleporter: [1139, 1131],
      blockade: {
        [ZoneType.BlockadeEast]: [369, 370],
        [ZoneType.BlockadeWest]: [373, 374],
        [ZoneType.BlockadeNorth]: [367, 368],
        [ZoneType.BlockadeSouth]: [371, 372],
      },
      background: 0xff0f4f4f,
    },
    walkCursorFirstId: 11,
    compassIcons: INDY_COMPASS_ICONS,
    progress: indyProgressRules,
    newStory(assets, seed, size, { history, victories }, goal) {
      const story = generateStory(assets, seed, size, { history, victories, goal });
      return { story, start: { zone: START.zone, at: freeCellNear(assets, START.zone, START.at) } };
    },
  };
}
