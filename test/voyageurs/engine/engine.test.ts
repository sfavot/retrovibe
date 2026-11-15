import { describe, expect, it } from "vitest";
import { VoyageursEngine } from "../../../src/games/voyageurs/engine/game";
import { TestHost } from "../../../src/games/voyageurs/engine/host";
import { addObjectScript } from "../../../src/games/voyageurs/engine/part";
import { NullRenderer } from "../../../src/games/voyageurs/engine/services";
import { bytecode, gameFiles, mark, msg, obj, type Op, prc, rel, s, w } from "./synthetic";

const empty: number[] = [];

function engineWith(boot: Op[][], bundles: Parameters<typeof gameFiles>[1] = {}, renderer?: NullRenderer) {
  const host = new TestHost(gameFiles([empty, ...boot.map((ops) => bytecode(...ops))], bundles));
  const lines: string[] = [];
  const engine = new VoyageursEngine({ host, renderer, trace: (line) => lines.push(line) });
  return { engine, host, lines };
}

describe("ordre d'exécution des scripts", () => {
  it("démarre sur le script 1 de AUTO00.PRC (déchiffré) ; un script ajouté pendant le tick s'exécute dans ce tick", () => {
    const { engine } = engineWith([
      [...mark(1), ["startGlobalScript", 2], ["break"], ...mark(3), ["break"], ["endScript"]],
      [...mark(2), ["break"], ["endScript"]],
    ]);
    expect(engine.state.names.prc).toBe("AUTO00.PRC");
    engine.runTick();
    expect(engine.state.globals[50]).toBe(12);
    engine.runTick();
    // Le script 2 finit sur endScript sans marquer ; il est retiré de la liste.
    expect(engine.state.globals[50]).toBe(123);
    engine.runTick();
    expect(engine.state.globalScripts).toHaveLength(0);
  });

  it("plusieurs instances du même script ; endGlobalScript marque, la suppression a lieu au prochain passage", () => {
    const { engine, lines } = engineWith([
      [["startGlobalScript", 2], ["startGlobalScript", 3], ["startGlobalScript", 3], ["break"], ["break"], ["endScript"]],
      [["label", 0], ...mark(2), ["break"], ["goto", 0]],
      [["label", 0], ...mark(3), ["endGlobalScript", 2], ["break"], ["goto", 0]],
    ]);
    engine.runTick();
    // Le script 2 a déjà tourné quand le script 3 le marque : il reste listé (index -1) jusqu'au tick suivant.
    expect(engine.state.globals[50]).toBe(233);
    expect(lines.at(-1)).toMatch(/ g=1:\d+,-1:\d+,3:\d+,3:\d+ /);
    engine.runTick();
    expect(engine.state.globals[50]).toBe(23333);
    expect(engine.state.globalScripts.map((sc) => sc.index)).toEqual([1, 3, 3]);
  });

  it("les scripts objets passent avant les scripts globaux ; la locale 0 compte les exécutions de l'entrée REL", () => {
    const relData = rel([{ verb: 0, obj: 1, script: bytecode(...mark(7), ["loadGlobalVar", 60, 1, 0], ["endScript"]) }]);
    const { engine } = engineWith(
      [[["loadPart", s("PART01")], ["loadNewPrcName", 1, s("A.REL")], ["requestCheckPendingDataLoad"], ["break"], ...mark(1), ["break"], ...mark(1), ["break"], ["endScript"]]],
      { PART01: { "A.REL": relData } },
    );
    engine.runTick();
    expect(engine.state.names.rel).toBe("A.REL");
    addObjectScript(engine.state, 0);
    engine.runTick();
    expect(engine.state.globals[50]).toBe(71);
    expect(engine.state.globals[60]).toBe(0);
    addObjectScript(engine.state, 0);
    engine.runTick();
    expect(engine.state.globals[60]).toBe(1);
  });
});

describe("chargements différés (fin de tick)", () => {
  it("PRC : le script en cours finit son tick, puis les scripts globaux sont remplacés par le script 1 du nouveau PRC", () => {
    const next = prc([empty, bytecode(...mark(9), ["break"], ["endScript"])]);
    const { engine } = engineWith(
      [[["loadPart", s("PART01")], ["loadNewPrcName", 0, s("B.PRC")], ["requestCheckPendingDataLoad"], ...mark(1), ["break"], ...mark(5), ["break"], ["endScript"]]],
      { PART01: { "B.PRC": next } },
    );
    engine.runTick();
    expect(engine.state.globals[50]).toBe(1);
    expect(engine.state.names.prc).toBe("B.PRC");
    expect(engine.state.globalScripts.map((sc) => sc.index)).toEqual([1]);
    engine.runTick();
    expect(engine.state.globals[50]).toBe(19);
  });

  it("sans requestCheckPendingDataLoad, rien n'est chargé", () => {
    const { engine } = engineWith([[["loadPart", s("PART01")], ["loadNewPrcName", 0, s("B.PRC")], ["break"], ["endScript"]]], { PART01: {} });
    engine.runTick();
    expect(engine.state.names.prc).toBe("AUTO00.PRC");
    expect(engine.state.pending.prc).toBe("B.PRC");
  });

  it("OBJ : vide les calques, garde les objets portés (costume -2) ; INTRO.OBJ remet à 0 le costume des objets 0 à 9 ; MSG lu", () => {
    const objects = obj([{ name: "a", costume: 3 }, { name: "b", costume: 4, x: 5 }, ...Array.from({ length: 10 }, (_, i) => ({ name: `o${i}`, costume: 7 }))]);
    const { engine } = engineWith(
      [
        [
          ["loadPart", s("PART01")],
          ["loadMask0", 1],
          ["loadNewPrcName", 2, s("INTRO.OBJ")],
          ["loadNewPrcName", 3, s("A.MSG")],
          ["requestCheckPendingDataLoad"],
          ["break"],
          ["endScript"],
        ],
      ],
      { PART01: { "INTRO.OBJ": objects, "A.MSG": msg(["Bonjour", "Au revoir"]) } },
    );
    engine.state.objects[11]!.costume = -2;
    engine.state.objects[11]!.name = "porté";
    engine.runTick();
    expect(engine.state.overlays).toEqual([]);
    expect(engine.state.objects[11]).toMatchObject({ name: "porté", costume: -2 });
    expect(engine.state.objects[1]).toMatchObject({ name: "b", x: 5, costume: 0 });
    expect(engine.state.objects[0]).toMatchObject({ name: "a", costume: 0 });
    expect(engine.state.objects[9]!.costume).toBe(0);
    expect(engine.state.objects[10]!.costume).toBe(7);
    expect(engine.state.messages.map((m) => Buffer.from(m).toString("latin1"))).toEqual(["Bonjour", "Au revoir"]);
  });

  it("REL : vide les scripts objets en cours", () => {
    const relData = rel([{ verb: 0, obj: 1, script: bytecode(["break"], ["endScript"]) }]);
    const { engine } = engineWith(
      [[["loadPart", s("PART01")], ["loadNewPrcName", 1, s("A.REL")], ["requestCheckPendingDataLoad"], ["break"], ["loadNewPrcName", 1, s("A.REL")], ["requestCheckPendingDataLoad"], ["break"], ["endScript"]]],
      { PART01: { "A.REL": relData } },
    );
    engine.runTick();
    addObjectScript(engine.state, 0);
    expect(engine.state.objectScripts).toHaveLength(1);
    engine.runTick();
    expect(engine.state.objectScripts).toHaveLength(0);
  });
});

describe("attentes bloquantes", () => {
  it("un message bloque le moteur après le tick jusqu'au clic (aucun tick ne passe)", () => {
    const { engine, lines } = engineWith(
      [[["loadPart", s("PART01")], ["loadNewPrcName", 3, s("A.MSG")], ["requestCheckPendingDataLoad"], ["break"], ["loadBg", s("L1.PI1")], ["message", 0, w(10), w(10), w(100), w(1)], ["break"], ...mark(4), ["break"], ["endScript"]]],
      { PART01: { "A.MSG": msg(["Salut"]), "L1.PI1": new Uint8Array(32034) } },
    );
    engine.runTick();
    expect(engine.runTick()).toBe(false);
    expect(engine.ticks).toBe(2);
    expect(lines.slice(-2)).toEqual([expect.stringMatching(/^TK 2 .* ov=0 bg=L1\.PI1 .* w=1 /), "MW 2 src=1 tgt=0"]);
    expect(engine.modal).toBe(1);
    engine.input({ type: "down", button: "left", x: 5, y: 5 }, { type: "up", button: "left", x: 5, y: 5 });
    expect(engine.runTick()).toBe(true);
    expect(engine.state.globals[50]).toBe(4);
    expect(engine.state.waitForPlayerClick).toBe(0);
  });

  it("un message hors de la table des messages ne bloque pas", () => {
    const { engine } = engineWith(
      [[["loadPart", s("PART01")], ["loadBg", s("L1.PI1")], ["message", 3, w(10), w(10), w(100), w(1)], ["break"], ["break"], ["endScript"]]],
      { PART01: { "L1.PI1": new Uint8Array(32034) } },
    );
    expect(engine.runTick()).toBe(true);
    expect(engine.runTick()).toBe(true);
  });

  it("fondu au noir au milieu d'un script : 8 pas de 42 ms, puis le même script reprend ; un second fondu < 1 s n'a qu'un pas", () => {
    const steps: number[] = [];
    const renderer = new (class extends NullRenderer {
      override fadeOutStep(step: number): void {
        steps.push(step);
      }
    })();
    const { engine } = engineWith([[["fadeToBlack"], ...mark(1), ["fadeToBlack"], ...mark(2), ["break"], ["endScript"]]], {}, renderer);
    const start = engine.ms;
    engine.runTick();
    expect(engine.state.globals[50]).toBe(12);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7]);
    expect(engine.ms - start).toBeGreaterThanOrEqual(9 * 42 + 109);
    expect(engine.state.fadeOutCompleted).toBe(1);
  });

  it("cadence : un tick dure 12 pas de 10 ms (attente de 109 ms de getTimerDelay)", () => {
    const { engine } = engineWith([[["break"], ["break"], ["break"], ["endScript"]]]);
    engine.runTick();
    const before = engine.ms;
    engine.runTick();
    expect(engine.ms - before).toBe(120);
  });
});
