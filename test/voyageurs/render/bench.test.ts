import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readFont } from "../../../src/games/voyageurs/data/font";
import type { VoyageursEngine } from "../../../src/games/voyageurs/engine/game";
import { FwRenderer } from "../../../src/games/voyageurs/render/renderer";
import { readOriginal } from "../data/helpers";
import { type BenchInput, hasOriginalFiles, makeEngine, parseBenchInputs } from "../engine/helpers";

/** Image de fin de tick : page 320 × 200 et palette RVB 8 bits (16 × 3), comme les captures `tk-NNNN.idx` / `.pal` du banc. */
interface Shot {
  idx: Uint8Array;
  pal: Uint8Array;
}

function inputs(name: string): BenchInput[] {
  return parseBenchInputs(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));
}

/** Empreinte d'une image : sha256 (16 premiers chiffres) de la page suivie de la palette. */
function shotHash(shot: Shot): string {
  return createHash("sha256").update(shot.idx).update(shot.pal).digest("hex").slice(0, 16);
}

/** Rejoue les entrées du banc avec le vrai rendu ; `onTick` reçoit l'image de chaque fin de tick (ligne `TK`, comme `Trace::endTick`). */
function replayShots(queue: BenchInput[], stopTick: number, onTick: (tick: number, shot: Shot) => void): VoyageursEngine {
  const renderer = new FwRenderer(readFont(readOriginal("TEXTE.DAT")));
  let engine: VoyageursEngine | null = null;
  const trace = (line: string) => {
    if (!line.startsWith("TK ")) return;
    onTick(Number(line.split(" ")[1]), { idx: renderer.backBuffer.slice(), pal: renderer.screenRgb() });
  };
  const onModalPoll = () => {
    while (engine && queue.length && queue[0]!.tick <= engine.ticks + 1) {
      const next = queue.shift()!;
      engine.input(...next.inputs);
      if (next.op !== "m") break;
    }
  };
  engine = makeEngine({ renderer, trace, onModalPoll }).engine;
  const e = engine;
  let guard = 0;
  while (e.ticks < stopTick) {
    if (e.betweenTicks) while (queue.length && queue[0]!.tick <= e.ticks + 1) e.input(...queue.shift()!.inputs);
    e.step();
    if (++guard > stopTick * 400) throw new Error(`rejeu bloqué au tick ${e.ticks}`);
  }
  return e;
}

/** Premier tick dont la palette vient du jeu (premier `drawFrame`, fond `LOGO.PI1`). */
const FIRST_PALETTE_TICK = 4;

/** `tick hash # commentaire` (lignes `#` ignorées). */
function readHashes(name: string): Map<number, string> {
  const text = readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [tick, hash] = line.trim().split(/\s+/);
    out.set(Number(tick), hash!);
  }
  return out;
}

describe.skipIf(!hasOriginalFiles)("rendu comparé aux captures du banc ScummVM", () => {
  it("logo, cinéma, intro, bulles de L1, première scène, marche, verbes : images et palettes identiques au pixel", () => {
    const expected = readHashes("render-verbs.hashes");
    const got = new Map<number, string>();
    replayShots(inputs("verbs.inputs"), Math.max(...expected.keys()), (tick, shot) => {
      if (expected.has(tick)) got.set(tick, shotHash(shot));
    });
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries(expected));
  });

  // Comparaison complète avec un dossier de captures du banc (`CINE_SHOT_DIR`), si on le donne : VOYAGEURS_SHOTS=/abs/dossier.
  const shots = process.env.VOYAGEURS_SHOTS;
  it.skipIf(!shots)("toutes les captures du dossier VOYAGEURS_SHOTS", () => {
    const stop = Number(process.env.VOYAGEURS_SHOTS_STOP ?? 660);
    const diffs: string[] = [];
    let compared = 0;
    replayShots(inputs(process.env.VOYAGEURS_SHOTS_INPUTS ?? "verbs.inputs"), stop, (tick, shot) => {
      const base = `${shots}/tk-${String(tick).padStart(4, "0")}`;
      if (!existsSync(`${base}.idx`)) return;
      compared++;
      const idx = readFileSync(`${base}.idx`);
      const pal = readFileSync(`${base}.pal`);
      let pixels = 0;
      for (let i = 0; i < idx.length; i++) if (idx[i] !== shot.idx[i]) pixels++;
      // Avant le premier fond (ticks 1 à 3), ScummVM n'a jamais appelé `setPalette` : la palette du système est un reste de l'écran
      // précédent, sans objet ici (l'image est toute à 0, noire des deux côtés).
      const palOk = tick < FIRST_PALETTE_TICK || Buffer.compare(pal, Buffer.from(shot.pal)) === 0;
      if (pixels || !palOk) diffs.push(`${tick}: ${pixels} px${palOk ? "" : " palette"}`);
    });
    expect(diffs).toEqual([]);
    expect(compared).toBeGreaterThan(0);
  });
});
