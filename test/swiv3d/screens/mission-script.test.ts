import { describe, expect, it } from "vitest";
import type { MissionScript, ScriptElement } from "../../../src/games/swiv3d/data/missions";
import { DEFAULT_TRACKS, MissionScriptRunner, replayableMissions, type ScriptStep } from "../../../src/games/swiv3d/screens/mission-script";
import { hasOriginalFiles } from "../helpers";
import { loadGlobal } from "./support";

function script(elements: ScriptElement[]): MissionScript {
  return { elements, missions: [], chainEnd: elements.findIndex((e) => e.kind === "end") };
}

function drain(runner: MissionScriptRunner): ScriptStep[] {
  const steps: ScriptStep[] = [];
  for (let i = 0; i < 100; i++) {
    const step = runner.next();
    steps.push(step);
    if (step.kind === "finished") return steps;
  }
  throw new Error("le script ne finit pas");
}

describe("exécution du script (éléments synthétiques)", () => {
  it("absorbe variables, pistes et couleur, rend mission, vidéo, niveau puis la fin", () => {
    const runner = new MissionScriptRunner(
      script([
        { kind: "mission", index: 0 },
        { kind: "variable", operation: "set", variable: 1, value: 100 },
        { kind: "variable", operation: "add", variable: 1, value: 50 },
        { kind: "variable", operation: "max", variable: 2, value: 7 },
        { kind: "variable", operation: "min", variable: 2, value: 3 },
        { kind: "tracks", tracks: [1, 2, 3, 0, 0, 0] },
        { kind: "color", r: 1, g: 2, b: 3 },
        { kind: "video", name: "BR_X" },
        { kind: "level", name: "LVL" },
        { kind: "complete" },
        { kind: "end" },
      ]),
    );
    const steps = drain(runner);
    expect(steps.map((s) => s.kind)).toEqual(["mission", "video", "level", "finished"]);
    const level = steps[2]!;
    if (level.kind !== "level") throw new Error();
    expect(level.vars.get(1)).toBe(150);
    expect(level.vars.get(2)).toBe(3); // max(0, 7) = 7 puis min(7, 3) = 3
  });

  it("applique max et min sur la valeur courante, la variable absente valant 0", () => {
    const runner = new MissionScriptRunner(
      script([
        { kind: "mission", index: 0 },
        { kind: "variable", operation: "max", variable: 5, value: 7 },
        { kind: "variable", operation: "min", variable: 6, value: 4 },
        { kind: "level", name: "L" },
        { kind: "end" },
      ]),
    );
    runner.next();
    const level = runner.next();
    if (level.kind !== "level") throw new Error();
    expect(level.vars.get(5)).toBe(7);
    expect(level.vars.get(6)).toBe(0);
    expect(level.tracks).toEqual(DEFAULT_TRACKS);
  });

  it("ne marque l'aventure terminée qu'avec l'élément -2, et reste finie ensuite", () => {
    const withEnd = new MissionScriptRunner(script([{ kind: "end" }]));
    expect(withEnd.next()).toEqual({ kind: "finished", completed: false });
    expect(withEnd.next()).toEqual({ kind: "finished", completed: false });
    const done = new MissionScriptRunner(script([{ kind: "complete" }, { kind: "end" }]));
    expect(done.next()).toEqual({ kind: "finished", completed: true });
    expect(done.finished).toBe(true);
  });

  it("refuse une mission absente du script", () => {
    expect(() => new MissionScriptRunner(script([{ kind: "mission", index: 0 }]), 3)).toThrow(/introuvable/);
  });
});

describe.skipIf(!hasOriginalFiles)("script de missions du jeu (bloc 600)", () => {
  const { missions } = loadGlobal();

  it("enchaîne TERRAN00 → 03 avec leur briefing, puis termine l'aventure", () => {
    const steps = drain(new MissionScriptRunner(missions));
    const summary = steps.map((s) => (s.kind === "video" ? `video:${s.name}` : s.kind === "level" ? `level:${s.name}` : s.kind === "mission" ? `mission:${s.index}` : "finished"));
    expect(summary).toEqual([
      "mission:0", "video:BR_TER0", "level:TERRAN00",
      "mission:1", "video:BR_TER1", "level:TERRAN01",
      "mission:2", "video:BR_TER2", "level:TERRAN02",
      "mission:3", "video:BR_TER3", "level:TERRAN03",
      "mission:999", "finished",
    ]);
    expect(steps[steps.length - 1]).toEqual({ kind: "finished", completed: true });
  });

  it("donne à chaque niveau l'état de la mission et ses pistes (table 400)", () => {
    const levels = drain(new MissionScriptRunner(missions)).filter((s) => s.kind === "level");
    if (levels.some((s) => s.kind !== "level")) throw new Error();
    const get = (n: number) => levels[n] as Extract<ScriptStep, { kind: "level" }>;
    expect(get(0).tracks.slice(0, 3)).toEqual([3, 9, 2]);
    expect(get(1).tracks.slice(0, 3)).toEqual([4, 10, 10]);
    expect(get(3).tracks.slice(0, 3)).toEqual([6, 9, 3]);
    // variable 1 (énergie) : 496 à la mission 0, jamais moins de 248 ensuite ; variable 0 (véhicule) : 0 puis 1 aux missions 2 et 3.
    expect(get(0).vars.get(1)).toBe(496);
    expect(get(1).vars.get(1)).toBeGreaterThanOrEqual(248);
    expect(get(0).vars.get(0)).toBe(0);
    expect(get(2).vars.get(0)).toBe(1);
    expect(get(3).vars.get(0)).toBe(1);
  });

  it("démarre à l'élément 200 n (Continuer, Rejouer) et ne rejoue que la suite", () => {
    const steps = drain(new MissionScriptRunner(missions, 2));
    expect(steps.filter((s) => s.kind === "level").map((s) => (s as { name: string }).name)).toEqual(["TERRAN02", "TERRAN03"]);
    expect(steps[0]).toEqual({ kind: "mission", index: 2 });
    // à partir de la mission 2, l'état de départ n'a pas la variable 1 de la mission 0 : seul le plancher 248 s'applique
    const level = steps.find((s) => s.kind === "level") as Extract<ScriptStep, { kind: "level" }>;
    expect(level.vars.get(1)).toBe(248);
  });

  it("ne propose que les missions dont le fichier existe, jusqu'à la meilleure atteinte", () => {
    const has = (level: string) => /^TERRAN0[0-3]$/.test(level);
    expect(replayableMissions(missions, 2, false, has)).toEqual([0, 1, 2]);
    expect(replayableMissions(missions, 0, false, has)).toEqual([0]);
    expect(replayableMissions(missions, 0xb4c69, true, has)).toEqual([0, 1, 2, 3]);
  });
});
