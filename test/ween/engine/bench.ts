import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { SoundBackend } from "../../../src/engine/coktel/audio/backend";
import { HeadlessHost } from "../../../src/engine/coktel/host";
import type { Instr } from "../../../src/engine/coktel/opcodes";
import { MemoryStorage } from "../../../src/engine/storage";
import { WeenGame, createWeenSystem } from "../../../src/games/ween/engine/ween";

/**
 * Comparaison au banc ScummVM (`bench/README.md`, section Ween) : mêmes « images » (points où le script rend la main,
 * `Host.markImage`), même temps virtuel (`exactTime`), même graine (`scummvmRandom(1)`, `--random-seed=1`).
 *
 * VH : FNV-1a 32 bits des octets des variables courantes, **variables 5 à 11 mises à zéro** (date réelle du banc,
 * `renewTimeInVars`) ; les références sont recalculées des vidages `DV` du banc (`GOB_DUMP`).
 */

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

/**
 * Entrée par image, au format de `GOB_INPUT` : `k` touche (appui en n), `m` déplacement, `c` clic gauche (déplacement et
 * appui en n, relâche en n+1).
 */
export type BenchInput =
  | { image: number; key: "ESC" }
  | { image: number; move: [number, number] }
  | { image: number; click: [number, number] };

/** Lit un fichier d'entrées du banc (`n k ESC`, `n m x y`, `n c x y`). */
export function parseInputs(text: string): BenchInput[] {
  const out: BenchInput[] = [];
  for (const line of text.split("\n")) {
    const [n, op, a, b] = line.trim().split(/\s+/);
    if (!n || n.startsWith("#")) continue;
    if (op === "k" && a === "ESC") out.push({ image: Number(n), key: "ESC" });
    else if (op === "m") out.push({ image: Number(n), move: [Number(a), Number(b)] });
    else if (op === "c") out.push({ image: Number(n), click: [Number(a), Number(b)] });
    else throw new Error(`entrée non gérée : ${line}`);
  }
  return out;
}

export interface BenchTrace {
  /** `TT n nom` : TOT chargé par playTot, avec le numéro de la dernière image. */
  tots: [number, string][];
  /** `PS n tot offset` : protection sautée. */
  skipped: [number, string, number][];
  /** VH masqué de l'image n à l'indice n - 1. */
  vh: number[];
}

/** Horloge virtuelle du banc à Game::start (première ligne `DL` de `GOB_TRACE=3`). */
export const BENCH_START_MS = 600;

const DATE_VARS = { from: 5 * 4, to: 12 * 4 };

/** FNV-1a 32 bits des variables, date (variables 5 à 11) à zéro. */
export function maskedVarHash(bytes: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    const b = i >= DATE_VARS.from && i < DATE_VARS.to ? 0 : bytes[i];
    h = Math.imul(h ^ b, 16777619) >>> 0;
  }
  return h >>> 0;
}

const silent: SoundBackend = {
  playSample() {},
  stopSample() {},
  queuePcm() {},
  clearQueue() {},
};

class StopBench extends Error {}

/** Joue Ween jusqu'à l'image `stopImage` (comprise) avec les entrées données ; retourne la trace. */
export async function runBench(
  stopImage: number,
  inputs: BenchInput[] = [],
  /** Débogage : appelé à chaque image après le hachage, et à chaque attente de l'horloge exacte. */
  debug: {
    probe?: (n: number, game: WeenGame) => void;
    onDelay?: (ms: number, game: WeenGame) => void;
    onOpcode?: (ins: Instr, game: WeenGame) => void;
  } = {},
): Promise<BenchTrace & { game: WeenGame }> {
  const host = new HeadlessHost({
    readFile: (name) => (name.toUpperCase() === "INTRO.STK" ? readOriginalStk() : undefined),
    exactTime: true,
  });
  // Banc : horloge virtuelle à 600 ms au démarrage du jeu (initialisation de ScummVM), souris en (0, 0) que
  // warpMouse ne déplace pas (SDL sans fenêtre).
  host.time = BENCH_START_MS;
  host.input.mouseX = 0;
  host.input.mouseY = 0;
  host.input.setMousePos = () => {};
  const system = createWeenSystem({ host, soundBackend: silent, store: new MemoryStorage() });
  const game = new WeenGame(host, system.sys, { maxSteps: 50_000_000 });
  const trace: BenchTrace = { tots: [], skipped: [], vh: [] };
  const { onDelay } = debug;
  if (onDelay) {
    const delay = host.delay!;
    (host as { delay?: (ms: number) => Promise<void> }).delay = (ms) => {
      onDelay(ms, game);
      return delay(ms);
    };
  }

  const hooks = game.hooks;
  const onLoadTot = hooks.onLoadTot;
  hooks.onLoadTot = (g, tot) => {
    onLoadTot?.(g, tot);
    trace.tots.push([host.images, tot.toUpperCase()]);
  };
  if (debug.onOpcode) {
    const onOpcode = debug.onOpcode;
    hooks.beforeOpcode = (g, ins) => void onOpcode(ins, g as WeenGame);
  }
  const beforeCallSub = hooks.beforeCallSub!;
  hooks.beforeCallSub = (g, offset) => {
    const skipped = beforeCallSub(g, offset);
    if (skipped) trace.skipped.push([host.images, g.curTotFile.toUpperCase(), offset]);
    return skipped;
  };

  const pending: { image: number; apply: () => void }[] = [];
  for (const input of inputs) {
    if ("key" in input) pending.push({ image: input.image, apply: () => host.input.pushKey(0x011b) });
    else if ("move" in input) {
      const [x, y] = input.move;
      pending.push({ image: input.image, apply: () => Object.assign(host.input, { mouseX: x, mouseY: y }) });
    } else {
      const [x, y] = input.click;
      pending.push({
        image: input.image,
        apply: () => Object.assign(host.input, { mouseX: x, mouseY: y, mouseButtons: 1 }),
      });
      pending.push({ image: input.image + 1, apply: () => (host.input.mouseButtons = 0) });
    }
  }
  pending.sort((a, b) => a.image - b.image);

  host.onImage = (n) => {
    const vars = game.inter.variables;
    if (vars) trace.vh[n - 1] = maskedVarHash(vars.bytes);
    debug.probe?.(n, game);
    while (pending.length && pending[0].image <= n) pending.shift()!.apply();
    if (n >= stopImage) throw new StopBench();
  };

  try {
    await game.start();
  } catch (e) {
    if (!(e instanceof StopBench)) throw e;
  }
  return { ...trace, game };
}

let stkBytes: Uint8Array | null = null;
/** `original/ween/INTRO.STK` (lu une fois). */
export function readOriginalStk(): Uint8Array {
  stkBytes ??= new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../original/ween/INTRO.STK")));
  return stkBytes;
}

/** Trace de référence du banc (`test/ween/fixtures/<name>.tt.json` et `<name>.vh.gz`). */
export function loadReference(name: string): BenchTrace {
  const tt = JSON.parse(readFileSync(resolve(FIXTURES, `${name}.tt.json`), "utf8")) as Omit<BenchTrace, "vh">;
  const raw = gunzipSync(readFileSync(resolve(FIXTURES, `${name}.vh.gz`)));
  const vh: number[] = [];
  for (let i = 0; i + 4 <= raw.length; i += 4) vh.push(raw.readUInt32LE(i));
  return { ...tt, vh };
}

/** Première image où les hachages diffèrent (-1 si aucune sur la longueur commune). */
export function firstDivergence(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i + 1;
  return -1;
}
