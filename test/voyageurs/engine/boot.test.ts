import { describe, expect, it } from "vitest";
import type { VoyageursEngine } from "../../../src/games/voyageurs/engine/game";
import { EventSource } from "../../../src/games/voyageurs/engine/input";
import { hasOriginalFiles, makeEngine } from "./helpers";

/** Démarrage sans entrée, sinon un clic sur chaque message (comme `CINE_AUTOCLICK` du banc). */
function boot(ticks: number, seed = 1) {
  let engine: VoyageursEngine | null = null;
  const lines: string[] = [];
  const onModalPoll = (source: number) => {
    if (source === EventSource.MainLoopWaitForPlayerClick) {
      engine!.input({ type: "down", button: "left", x: 160, y: 100 }, { type: "up", button: "left", x: 160, y: 100 });
    }
  };
  engine = makeEngine({ seed, trace: (line) => lines.push(line), onModalPoll }).engine;
  const timeline: { tick: number; prc: string; bg: string; obj: string; input: number; scripts: string }[] = [];
  while (engine.ticks < ticks) {
    expect(engine.runTick()).toBe(true);
    const { names, allowPlayerInput, globalScripts } = engine.state;
    timeline.push({ tick: engine.ticks, prc: names.prc, bg: names.bg, obj: names.obj, input: allowPlayerInput, scripts: globalScripts.map((s) => `${s.index}:${s.pos}`).join(",") });
  }
  return { engine, lines, timeline };
}

describe.skipIf(!hasOriginalFiles)("démarrage depuis AUTO00.PRC (fichiers d'origine)", () => {
  it("AUTO00 → TOTO.OBJ / INTRO.OBJ → INTRO.PRC (logo, générique) → PART01.PRC → première scène jouable (L1) au tick 446", () => {
    const { timeline, engine } = boot(460);
    const at = (tick: number) => timeline[tick - 1]!;
    expect(at(1)).toMatchObject({ prc: "AUTO00.PRC", obj: "TOTO.OBJ" });
    expect(at(2).obj).toBe("INTRO.OBJ");
    expect(at(4).bg).toBe("LOGO.PI1");
    expect(at(5)).toMatchObject({ prc: "INTRO.PRC", bg: "CINEMA.PI1" });
    expect(at(6).bg).toBe("L0.PI1");
    expect(at(311).prc).toBe("PART01.PRC");
    expect(at(312).bg).toBe("L1.PI1");
    expect(at(445).input).toBe(0);
    expect(at(446)).toMatchObject({ input: 1, bg: "L1.PI1", scripts: "1:1089,24:79,21:181,10:3" });
    // D7 : la protection anti-copie n'apparaît jamais.
    expect(timeline.some((t) => /PROTEC|^FW\./.test(t.bg))).toBe(false);
    expect(engine.state.objects[1]!.name).toBe("heros");
    expect(engine.lastLines).toEqual([]);
  });

  it("est déterministe à graine égale", () => {
    expect(boot(500, 7).lines).toEqual(boot(500, 7).lines);
  });

  it("sans clic, s'arrête sur le premier message de l'intro (tick 323) sans faire passer de tick", () => {
    const { engine } = makeEngine();
    while (engine.ticks < 322) expect(engine.runTick()).toBe(true);
    // Le tick 323 s'achève (trace), puis le moteur attend le clic avant les chargements différés et le tick suivant.
    expect(engine.runTick(2000)).toBe(false);
    expect(engine.ticks).toBe(323);
    expect(engine.modal).toBe(EventSource.MainLoopWaitForPlayerClick);
  });
});
