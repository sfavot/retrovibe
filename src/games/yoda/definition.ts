import type { SoundCatalog } from "../../engine/desktop-adventures/audio/audio";
import { ZoneType } from "../../engine/desktop-adventures/data/types";
import type { DesktopAdventure } from "../../ui/desktop-adventures/definition";
import { copy } from "./copy";
import { generateYodaStory, type YodaStory } from "./generation/world-generator";
import { YODA_MUSIC, YodaSounds } from "./sounds";
import { createYodaVariant } from "./variant";

/** Objectifs retenus dans la progression (« Rejouer la dernière mission » reprend le dernier). */
const HISTORY_LENGTH = 10;

/** Sons de Yoda : `SFX/<NOM>.WAV` (la table du DTA les nomme en minuscules) ; les musiques sont des WAV. */
export function yodaSoundCatalog(dtaSounds: readonly string[], baseUrl: string): SoundCatalog {
  return {
    baseUrl,
    file: (id) => (dtaSounds[id] ? `SFX/${dtaSounds[id].toUpperCase()}` : null),
    isMusic: (id) => YODA_MUSIC.has(id),
  };
}

/** « Star Wars: Yoda Stories » pour l'interface commune. `strings` : table de chaînes de YODESK.EXE. */
export function yodaAdventure(dtaSounds: readonly string[], baseUrl: string, strings: ReadonlyMap<number, string>): DesktopAdventure {
  return {
    key: "yoda",
    variant: createYodaVariant(strings),
    copy,
    sounds: yodaSoundCatalog(dtaSounds, baseUrl),
    theme: YodaSounds.Opening,
    // Touche du localisateur de l'original (`mapKey` de WebFun).
    mapKey: "KeyL",
    // Déduits des noms de fichiers (non vérifiés dans YODESK.EXE).
    mapSounds: { open: YodaSounds.Locator, close: YodaSounds.MapClose },
    // Tuiles du localisateur (`locator-tile.ts` de WebFun).
    locator: {
      unvisited: 835,
      here: 837,
      empty: 832,
      town: 829,
      goal: [831, 830],
      travel: [819, 820],
      puzzle: [817, 818],
      teleporter: [833, 834],
      blockade: {
        [ZoneType.BlockadeEast]: [823, 824],
        [ZoneType.BlockadeWest]: [827, 828],
        [ZoneType.BlockadeNorth]: [821, 822],
        [ZoneType.BlockadeSouth]: [825, 826],
      },
      background: 0xff000000,
    },
    // Identifiants ICON de YODESK.EXE (un de moins que ceux d'Indy : l'icône 1 est le logo LucasArts).
    walkCursorFirstId: 12,
    compassIcons: {
      down: { off: 2, on: 3 },
      left: { off: 4, on: 5 },
      right: { off: 6, on: 7 },
      up: { off: 8, on: 9 },
    },
    progress: {
      recordGoal: (history, goal) => [...history, goal].slice(-HISTORY_LENGTH),
      // Les scripts testent jusqu'à 17 victoires (« GamesWon ») : le compteur n'a pas besoin de plafond bas.
      maxVictories: 999,
    },
    newStory(assets, seed, size, { victories, lastWorld }, goal) {
      const story = generateYodaStory(assets, seed, size, { lastPlanet: lastWorld, gamesWon: victories, goal });
      return { story, start: { zone: story.startZone, at: story.startPosition } };
    },
    lastWorldOf: (story) => (story as YodaStory).planet,
  };
}
