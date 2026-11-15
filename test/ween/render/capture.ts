import { readFileSync } from "node:fs";
import type { HeadlessHost } from "../../../src/engine/coktel/host";
import { composeIndexed } from "../../../src/engine/coktel/render/canvas";
import type { DrawImpl } from "../../../src/engine/coktel/graphics";
import type { VideoPlayer } from "../../../src/engine/coktel/video";
import { type BenchInput, runBench } from "../engine/bench";
import { benchPalette6, frameHash } from "./hash";

/** Écran affiché à une image : indices (sans curseur) et palette matérielle (6 bits, 768 octets). */
export interface Shot {
  width: number;
  height: number;
  indices: Uint8Array;
  palette6: Uint8Array;
}

/**
 * Joue Ween comme le banc (voir `test/ween/engine/bench.ts`) et relève l'écran aux images demandées, au point
 * d'image du banc (`GOB_SHOT_FRAMES`).
 *
 * Le banc relève l'écran de ScummVM (`OSystem::lockScreen`), mis à jour par `Video::retrace` : à chaque attente du
 * balayage (`waitRetrace`, repérée dans la pile d'appels), à la fin de `waitEndFrame` et après l'image voulue d'un film.
 * L'écran relevé ici l'est aux mêmes points (`GraphicsCore.retrace`), la palette est celle du moment (ScummVM la
 * pose aussitôt).
 */
export async function captureFrames(
  frames: number[],
  inputs: BenchInput[] = [],
  stopImage = Math.max(...frames),
): Promise<Map<number, Shot>> {
  const wanted = new Set(frames);
  const shots = new Map<number, Shot>();
  let displayed: Uint8Array | null = null;
  await runBench(stopImage, inputs, {
    probe: (n, game) => {
      const core = (game.sys.draw as DrawImpl).core;
      if (n === 1) {
        // Palette des films : ScummVM recopie toute la plage (voir `VideoPlayerOptions.restrictPalette`).
        (game.sys.video as VideoPlayer).restrictPalette = false;
        // Accents des polices-sprites : ScummVM lit un `char` signé et ne les dessine pas.
        (game.sys.draw as DrawImpl).signedSpriteChars = true;
        core.onRetrace = () => (displayed = composeIndexed(core));
        const host = game.host as HeadlessHost;
        const delay = host.delay!.bind(host);
        (host as { delay: (ms: number) => Promise<void> }).delay = (ms) => {
          // `waitRetrace` seule retrace : les autres attentes (`Util::delay`) ne montrent rien de nouveau.
          const stack = new Error().stack ?? "";
          if (stack.includes("waitRetrace") || (ms === 10 && stack.includes("advanceClock"))) core.retrace();
          return delay(ms);
        };
        const timer = game.timer;
        const waitEndFrame = timer.waitEndFrame.bind(timer);
        timer.waitEndFrame = async () => {
          await waitEndFrame();
          core.retrace();
        };
      }
      if (!wanted.has(n)) return;
      shots.set(n, {
        width: core.screenWidth,
        height: core.screenHeight,
        indices: (displayed ?? composeIndexed(core)).slice(),
        palette6: core.shown.slice(),
      });
    },
  });
  return shots;
}

/** Capture du banc : `fr-NNNNN.idx` (écran, indices) et `.pal`. */
export function readBenchShot(dir: string, n: number, width: number): Shot | null {
  const name = `${dir}/fr-${String(n).padStart(5, "0")}`;
  try {
    const indices = new Uint8Array(readFileSync(`${name}.idx`));
    const palette6 = benchPalette6(new Uint8Array(readFileSync(`${name}.pal`)));
    return { width, height: indices.length / width, indices, palette6 };
  } catch {
    return null;
  }
}

/** Empreinte compacte d'une image (voir `frameHash`). */
export const shotHash = (shot: Shot): string => frameHash(shot.width, shot.indices, shot.palette6);

/** Nombre de pixels d'indice différent, et premier pixel différent. */
export function diffShots(a: Shot, b: Shot): { size: boolean; pixels: number; palette: number; first: [number, number] | null } {
  if (a.width !== b.width || a.indices.length !== b.indices.length)
    return { size: true, pixels: -1, palette: -1, first: null };
  let pixels = 0;
  let first: [number, number] | null = null;
  for (let i = 0; i < a.indices.length; i++)
    if (a.indices[i] !== b.indices[i]) {
      pixels++;
      first ??= [i % a.width, Math.floor(i / a.width)];
    }
  let palette = 0;
  for (let i = 0; i < 768; i++) if (a.palette6[i] !== b.palette6[i]) palette++;
  return { size: false, pixels, palette, first };
}
