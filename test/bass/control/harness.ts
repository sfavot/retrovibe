import type { GameControl } from "../../../src/games/bass/engine/control/control";
import type { BassEngine, BassEngineOptions } from "../../../src/games/bass/engine/game";
import type { BassInput, TestHost } from "../../../src/games/bass/engine/host";
import { Cpt, SF } from "../../../src/games/bass/engine/ids";
import { SilentSound } from "../../../src/games/bass/engine/services";
import { hasOriginalFiles, makeEngine } from "../engine/helpers";

export { hasOriginalFiles };

export interface Controlled {
  engine: BassEngine;
  host: TestHost;
  control: GameControl;
  /** Un tick de 20 ms comme le moteur le fera : le panneau d'abord, puis le jeu si rien ne le fige. */
  tick(): void;
  ticks(n: number): void;
  /** Avance jusqu'à ce que `n` tours soient terminés (le jeu figé n'avance pas). */
  cycles(n: number): void;
  push(...inputs: BassInput[]): void;
}

/**
 * Moteur + `GameControl` câblés comme `game.ts` le fera : le panneau reçoit les entrées avant le moteur, les mcodes `fnRestoreGame`,
 * `fnRestartGame` et `fnQuitToDos` passent par lui.
 */
export function makeControlled(options: Partial<BassEngineOptions> = {}): Controlled {
  const { engine, host } = makeEngine(options);
  const control = engine.control;
  const tick = (): void => {
    engine.tick();
  };
  return {
    engine,
    host,
    control,
    tick,
    ticks: (n) => {
      for (let i = 0; i < n; i++) tick();
    },
    cycles: (n) => {
      const target = engine.completedCycles + n;
      for (let t = 0; engine.completedCycles < target; t++) {
        if (t > n * 1000) throw new Error("cycles : jeu figé ?");
        tick();
      }
    },
    push: (...inputs) => host.push(...inputs),
  };
}

/** Texte formé à l'écran (compacts 23 à 33) : ScummVM les efface à la restitution. */
const TEXT_IDS = Array.from({ length: Cpt.TEXT_11 - Cpt.TEXT_1 + 1 }, (_, i) => Cpt.TEXT_1 + i);

/** Tout ce qui fait l'état d'une partie ; `withText` faux : sans les compacts de texte ; `pointer` faux : sans le hasard ni le curseur. */
export function fingerprint(engine: BassEngine, withText = true, pointer = true): string {
  const compactWords = engine.compacts.saveState();
  if (!withText) {
    // Les compacts de texte (23 à 33) sont effacés à la restitution : hors de la comparaison.
    let pos = 0;
    for (const id of engine.compacts.saveIds) {
      const size = engine.compacts.info(id).size;
      if (TEXT_IDS.includes(id)) compactWords.fill(0, pos, pos + size);
      pos += size;
    }
  }
  const out: unknown[] = [
    Array.from(engine.vars),
    Array.from(compactWords),
    ...(pointer ? [engine.mouse.x, engine.mouse.y, engine.mouse.cursor, engine.mouse.objectCursor, engine.rng.state] : []),
    engine.system.systemFlags & (SF.MOUSE_LOCKED | SF.CHOOSING),
    engine.system.currentMusic,
    engine.system.currentPalette,
    engine.items.loadedList(),
  ];
  return JSON.stringify(out);
}

/** Lignes de trace sans le numéro de tour (le moteur restitué recompte à partir de 1). */
export function normalizeTrace(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/^(CY|MC|SC|LG) \d+ /, "$1 "));
}

/** Son de test avec les réglages que le panneau modifie (comme `BassAudio`). */
export class FakeAudio extends SilentSound {
  musicVolume = 127;
  fxOff = false;
  speechOn = true;
  fxPaused = 0;
  override pauseFx(): void {
    this.fxPaused++;
  }
  override unPauseFx(): void {
    this.fxPaused--;
  }
}
