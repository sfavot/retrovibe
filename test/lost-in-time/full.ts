import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CdBackend, SoundBackend } from "../../src/games/lost-in-time/engine/audio/backend";
import { Game } from "../../src/games/lost-in-time/engine/game";
import { HeadlessHost, WaitingForInput } from "../../src/games/lost-in-time/engine/host";
import { MemoryStore } from "../../src/games/lost-in-time/engine/saves";
import { createSystem } from "../../src/games/lost-in-time/engine/system";
import { composeFrame } from "../../src/games/lost-in-time/render/canvas";

const ORIGINAL = resolve(import.meta.dirname, "../../original/lost-in-time");

/** Jeu complet (sous-systèmes réels, entrées simulées, audio enregistré) pour les tests de bout en bout. */
export function makeFullGame(hide: string[] = []) {
  const host = new HeadlessHost({
    readFile: (name) => {
      if (hide.includes(name.toUpperCase())) return undefined;
      const path = resolve(ORIGINAL, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
  });
  const samples: { len: number; rate: number }[] = [];
  const soundBackend: SoundBackend = {
    playSample: (pcm, rate) => void samples.push({ len: pcm.length, rate }),
    stopSample() {},
    queuePcm() {},
    clearQueue() {},
  };
  const cdBackend: CdBackend = { play() {}, stop() {}, playing: false, currentTime: 0 };
  const system = createSystem({ host, soundBackend, cdBackend, store: new MemoryStore() });
  const game = new Game(host, system.sys, { maxSteps: 2_000_000 });
  game.inter.keyFuncLimit = 3000;
  const frame = () => composeFrame(system.gfx, host.input.mouseX, host.input.mouseY);
  return { host, system, game, samples, frame };
}

export { WaitingForInput };

export type Step =
  | { wait: number }
  | { move: [number, number] }
  | { click: [number, number]; right?: boolean }
  | { key: number }
  | { snap: string }
  | { run: () => void };

/** Lance le jeu et déroule `steps` image par image (clics : déplacement, appui 6 images, relâchement). */
export async function drive(
  ctx: ReturnType<typeof makeFullGame>,
  opts: { skipKeyEvery?: number; skipUntilFrame: number; steps: Step[]; maxFrames?: number; snap?: (name: string) => void },
): Promise<void> {
  const { host, game } = ctx;
  const steps = [...opts.steps];
  let waitLeft = 0;
  let phase: { frames: number; apply: () => void }[] = [];
  const stop = new Error("fin du scénario");
  const next = host.nextFrame.bind(host);
  host.nextFrame = () => {
    const f = host.frames;
    if (f < opts.skipUntilFrame) {
      if (f % (opts.skipKeyEvery ?? 5) === 0) host.input.pushKey(0x1c0d);
    } else if (phase.length) {
      const p = phase.shift()!;
      p.apply();
    } else if (waitLeft > 0) {
      waitLeft--;
    } else if (steps.length) {
      const s = steps.shift()!;
      if ("wait" in s) waitLeft = s.wait;
      else if ("move" in s) host.input.setMousePos(...s.move);
      else if ("key" in s) host.input.pushKey(s.key);
      else if ("snap" in s) opts.snap?.(s.snap);
      else if ("run" in s) s.run();
      else {
        const btn = s.right ? 2 : 1;
        phase = [
          { frames: 1, apply: () => host.input.setMousePos(...s.click) },
          { frames: 1, apply: () => void 0 },
          { frames: 1, apply: () => void 0 },
          { frames: 1, apply: () => (host.input.mouseButtons = btn) },
          ...Array.from({ length: 5 }, () => ({ frames: 1, apply: () => void 0 })),
          { frames: 1, apply: () => (host.input.mouseButtons = 0) },
          { frames: 1, apply: () => void 0 },
        ];
      }
    } else throw stop;
    if (f > (opts.maxFrames ?? 200000)) throw stop;
    return next();
  };
  try {
    await game.start();
  } catch (e) {
    if (e !== stop) throw e;
  }
}
