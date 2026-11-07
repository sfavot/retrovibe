import { listOriginal, byExtension } from "../helpers";
import type { Player } from "./test-host";
import type { Plane } from "../../../src/games/drascula/render/plane";

export interface HeadCopy {
  chapter: number;
  room: number;
  /** Nom de la surface source (`extra`, `front`, `back`, `draw3`, `bg`, autre). */
  surface: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dest: { x: number; y: number };
  /** Fichiers `.ALG` dont le rectangle source est identique à celui copié. */
  matches: string[];
}

const SURFACES = ["extra", "front", "back", "draw3", "bg", "table", "cursor"] as const;
let names: string[] | null = null;

/** Les fichiers `.ALG` de l'original, en minuscules (pour reconnaître la feuille qui est dans une surface). */
function sheetNames(): string[] {
  names ??= listOriginal(byExtension("ALG"));
  return names;
}

function rectEquals(a: Plane, b: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (a.pixels[(y + j) * 320 + x + i] !== b[(y + j) * 320 + x + i]) return false;
  return true;
}

/**
 * Enregistre les copies de rectangles faites dans l'écran pendant qu'une tête parle (`engine.head`) : surface source, rectangle, et
 * feuilles `.ALG` dont ce rectangle est identique. Rend la liste (remplie au fil des images) et un `stop`.
 */
export function recordHeadCopies(player: Player): { copies: HeadCopy[]; stop: () => void } {
  const engine = player.engine;
  const screen = engine.gfx.screen as Plane & Record<string, unknown>;
  const gfx = engine.gfx as unknown as Record<string, Plane>;
  const copies: HeadCopy[] = [];
  const decoded = new Map<string, Uint8Array>();
  const cache = new Map<string, string[]>();
  const original = { cb: screen.copyBackground, cr: screen.copyRect };
  const wrap = (kind: "cb" | "cr") =>
    function (this: Plane, src: Plane, x: number, y: number, dx: number, dy: number, w: number, h: number) {
      if (engine.head) {
        const surface = SURFACES.find((name) => gfx[name] === src) ?? "autre";
        let hash = 0;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) hash = (Math.imul(hash, 31) + src.pixels[(y + j) * 320 + x + i]) | 0;
        const key = `${x},${y},${w},${h},${hash}`;
        let matches = cache.get(key);
        if (!matches) {
          matches = [];
          for (const file of sheetNames()) {
            let pixels = decoded.get(file);
            if (!pixels) decoded.set(file, (pixels = engine.gfx.sheet(file).pixels));
            if (rectEquals(src, pixels, x, y, w, h)) matches.push(file.toLowerCase());
          }
          cache.set(key, matches);
        }
        copies.push({ chapter: engine.state.chapter, room: engine.state.room?.number ?? 0, surface, x, y, width: w, height: h, dest: { x: dx, y: dy }, matches });
      }
      return original[kind].call(this, src, x, y, dx, dy, w, h);
    };
  // Le moteur ne compose l'image que sur demande de l'hôte : à chaque tick d'une réplique, on la demande.
  const run = player.run.bind(player);
  player.run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      run(1);
      if (engine.head) engine.render();
    }
  };
  screen.copyBackground = wrap("cb") as never;
  screen.copyRect = wrap("cr") as never;
  return {
    copies,
    stop: () => {
      player.run = run;
      screen.copyBackground = original.cb;
      screen.copyRect = original.cr;
    },
  };
}
