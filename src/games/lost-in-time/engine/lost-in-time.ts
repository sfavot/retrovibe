import type { CoktelGameDefinition } from "../../../engine/coktel/definition";
import { Game, type GameOptions } from "../../../engine/coktel/game";
import type { Host, Subsystems } from "../../../engine/coktel/host";
import { createSystem, type System, type SystemOptions } from "../../../engine/coktel/system";
import { CdAudio } from "./audio/cd";
import { PartTracker } from "./parts";
import { GameSaves } from "./saves";

/**
 * Lost in Time sur le moteur Coktel : interpréteur v3 (Inter_v3, `gob.cpp:623-633`), sauvegardes
 * SaveLoad_v3, musique du CD, vidéos qui gardent le curseur (`videoplayer.cpp:214-219`) et suivi des
 * parties (`parts.ts`).
 */
export const LOST_IN_TIME: CoktelGameDefinition = {
  id: "lost-in-time",
  version: 3,
  startArchive: "INTRO.STK",
  startTot: "INTRO.TOT",
  restrictVideoPalette: true,
  videosWithCursor: ["PORTA03", "PORTA03A", "CALE1", "AMIL2", "AMIL3B", "DELB", "DELG"],
  createSaves: ({ gfx, store }) => new GameSaves(gfx, store),
  createCd: (env) => new CdAudio(env),
};

/** Une partie de Lost in Time : le moteur et le suivi de la partie en mémoire (CD 1 à 4). */
export class LostInTimeGame extends Game {
  readonly parts: PartTracker;

  constructor(host: Host, sys: Subsystems, options: Omit<GameOptions, "hooks"> = {}) {
    const parts = new PartTracker();
    super(host, sys, LOST_IN_TIME, { ...options, hooks: parts });
    this.parts = parts;
  }

  /** Partie dont l'état est en mémoire (voir `PartTracker`). */
  get sessionPart(): string | null {
    return this.parts.sessionPart;
  }
}

/** Sous-systèmes réels de Lost in Time (à passer à `new LostInTimeGame(host, system.sys)`). */
export function createLostInTimeSystem(options: Omit<SystemOptions, "definition">): System {
  return createSystem({ ...options, definition: LOST_IN_TIME });
}
