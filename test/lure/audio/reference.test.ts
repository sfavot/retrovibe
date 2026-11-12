import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readSoundSections } from "../../../src/games/lure/data/sound";
import { hasOriginalFiles, lureResources } from "../data/helpers";
import reference from "./reference.json";
import { runScenario } from "./scenario";

interface Reference {
  scenario: string;
  count: number;
  /** Scénarios courts : toutes les écritures `tick registre valeur`. */
  lines?: string[];
  /** Scénarios sur les sons du jeu : empreinte des écritures. */
  sha1?: string;
  lastTick?: number;
}

const references = reference as Record<string, Reference>;
const synthetic = Object.entries(references).filter(([, r]) => r.lines);
const real = Object.entries(references).filter(([, r]) => r.sha1);

describe("registres OPL : mêmes écritures que le pilote de ScummVM (scénarios synthétiques)", () => {
  it.each(synthetic)("%s", (_name, ref) => {
    const sink = runScenario(ref.scenario, {});
    expect(sink.toLines()).toEqual(ref.lines);
  });
});

describe.skipIf(!hasOriginalFiles)("registres OPL : mêmes écritures que ScummVM sur les sons du jeu", () => {
  const sections = hasOriginalFiles ? readSoundSections(lureResources()) : undefined;
  const files: Record<string, Uint8Array> = {};
  if (sections) for (const [name, section] of Object.entries(sections)) for (const sound of section.sounds) files[`${name}-${sound.index}`] = sound.smf;

  it.each(real)("%s", (_name, ref) => {
    const sink = runScenario(ref.scenario, files);
    const lines = sink.toLines();
    expect(lines.length).toBe(ref.count);
    expect(lines.at(-1)?.split(" ")[0]).toBe(String(ref.lastTick));
    expect(createHash("sha1").update(`${lines.join("\n")}\n`).digest("hex")).toBe(ref.sha1);
  });
});
