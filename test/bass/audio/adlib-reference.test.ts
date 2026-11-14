import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { musicFile } from "../../../src/games/bass/data/ids";
import { hasOriginalFiles, skyDisk } from "../data/helpers";
import { WINDOW, digest, runScript, scenarios } from "./reference";

interface FixtureScenario {
  name: string;
  script: string;
  ticks: number;
  lines: number;
  windows: string[];
  log?: string;
  logLines?: number;
}

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/adlib-reference.json"), "utf8")) as { window: number; scenarios: FixtureScenario[] };

/**
 * Preuve : le pilote TypeScript écrit exactement les mêmes registres OPL, tick par tick, que les vrais `adlibmusic.o`, `adlibchannel.o` et
 * `musicbase.o` de ScummVM (harnais du banc, `docs/bass/audio.md`). Les 31 morceaux sont joués 4 minutes (12 000 ticks) et comparés par
 * empreinte cumulée toutes les 200 ticks ; des scénarios (volume, changement de morceau, arrêt, rechargement de section) complètent.
 */
describe.skipIf(!hasOriginalFiles)("pilote AdLib de BASS : mêmes écritures que ScummVM", () => {
  it("les scénarios des fixtures sont ceux du test", () => {
    expect(fixture.window).toBe(WINDOW);
    expect(fixture.scenarios.map((s) => [s.name, s.script])).toEqual(scenarios().map((s) => [s.name, s.script]));
    expect(fixture.scenarios.filter((s) => /^s\dm\d+$/.test(s.name))).toHaveLength(31);
  });

  const files = new Map<number, Uint8Array>();
  const load = (section: number): Uint8Array => {
    let data = files.get(section);
    if (!data) files.set(section, (data = skyDisk().load(musicFile(section))));
    return data.slice();
  };

  for (const expected of fixture.scenarios) {
    it(`${expected.name}`, () => {
      const { lines, ticks } = runScript(expected.script, load);
      expect(ticks).toBe(expected.ticks);
      const got = digest(lines, ticks);
      const wrong = got.windows.findIndex((w, i) => w !== expected.windows[i]);
      expect(wrong === -1 ? "identique" : `fenêtre ${wrong} (ticks ${wrong * WINDOW} à ${(wrong + 1) * WINDOW})`).toBe("identique");
      expect(got.windows).toHaveLength(expected.windows.length);
      expect(got.lines).toBe(expected.lines);
      if (expected.log !== undefined) {
        const reference = gunzipSync(Buffer.from(expected.log, "base64")).toString().split("\n");
        const mine = lines.filter((l) => Number(l.slice(0, l.indexOf(" "))) < 1500);
        expect(mine).toHaveLength(expected.logLines!);
        expect(mine).toEqual(reference);
      }
    });
  }
});
