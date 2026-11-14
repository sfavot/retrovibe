import { describe, expect, it } from "vitest";
import { MouseButton } from "../../../src/games/bass/engine/host";
import { TraceRecorder } from "../../../src/games/bass/engine/trace";
import { hasOriginalFiles, lineCycle, makeEngine, readFixture } from "./helpers";

/** Première ligne différente (rang), ou -1 si `actual` reprend tout `expected`. */
function firstDivergence(expected: readonly string[], actual: readonly string[]): number {
  for (let i = 0; i < expected.length; i++) if (expected[i] !== actual[i]) return i;
  return -1;
}

describe.skipIf(!hasOriginalFiles)("trace comparée au banc ScummVM (CY : écran, Foster, Joey ; MC : mcodes appelés)", () => {
  it("départ après l'introduction, sans entrée : les 314 tours du banc à l'identique", () => {
    const expected = readFixture("idle.trace");
    const trace = new TraceRecorder(1);
    const { engine } = makeEngine({ trace });
    engine.startAfterIntro();
    engine.runCycles(314);
    expect(expected.filter((l) => l.startsWith("CY"))).toHaveLength(314);
    const at = firstDivergence(expected, trace.lines);
    expect(at === -1 ? "aucune" : `ligne ${at} (tour ${lineCycle(expected[at]!)}) : ${expected[at]} / ${trace.lines[at]}`).toBe("aucune");
    expect(trace.lines).toHaveLength(expected.length);
    expect(engine.journal).toEqual([]);
  });

  it("clic pour marcher (b-start) : les 278 tours du banc à l'identique, route, marche et fin de marche comprises", () => {
    const expected = readFixture("start.trace");
    const trace = new TraceRecorder(1);
    const { engine, host } = makeEngine({ trace });
    engine.startAfterIntro();
    host.push({ type: "move", x: 160, y: 100 });
    engine.runCycles(119);
    host.push({ type: "click", x: 200, y: 150, button: MouseButton.Left });
    engine.runCycles(278 - 119);
    expect(expected.filter((l) => l.startsWith("CY"))).toHaveLength(278);
    // Le clic (tour 120) lance fnSaveCoods, fnAssignBase, fnGetTo, fnAr ; `autoRoute` trouve la même route que ScummVM.
    expect(expected).toContain("MC 120 id=3 fn_ar 184 208 0");
    const at = firstDivergence(expected, trace.lines);
    expect(at === -1 ? "aucune" : `ligne ${at} (tour ${lineCycle(expected[at]!)}) : ${expected[at]} / ${trace.lines[at]}`).toBe("aucune");
    expect(trace.lines).toHaveLength(expected.length);
  });
});
