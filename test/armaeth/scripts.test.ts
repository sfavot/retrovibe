import { describe, expect, it } from "vitest";
import { type CmRecord, findToken, parseCm } from "../../src/games/armaeth/data/commands";
import { type ScriptNumber, ScriptRunner, type ScriptSet } from "../../src/games/armaeth/engine/scripts";
import type { TokenHost } from "../../src/games/armaeth/engine/tokens";
import { hasOriginalFiles, readOriginal } from "./helpers";

type Call = [string, ...unknown[]];

/** Hôte enregistreur : `pages` = nombre de pages supplémentaires par texte affiché. */
function recordingHost(pages = 0) {
  const calls: Call[] = [];
  let left = 0;
  const host = new Proxy({} as Record<string, unknown>, {
    get: (_, name: string) => (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (name === "showText") left = pages;
      if (name === "advanceText") return left-- > 0;
      return undefined;
    },
  }) as unknown as TokenHost;
  return { host, calls };
}

/** Enregistrement synthétique `nom args` (texte et répétition facultatifs). */
function rec(name: string, args: number[] = [], repeat = 1, text = ""): CmRecord {
  const pos = findToken(name);
  if (!pos) throw new Error(name);
  return { ...pos, name, repeat, args, text };
}

function runnerOf(records: CmRecord[], pages = 0) {
  const { host, calls } = recordingHost(pages);
  const names: string[] = [];
  const scripts: ScriptSet = { 1: records, 2: [], 3: [], 4: [] };
  const runner = new ScriptRunner(host, scripts, { onToken: (r) => names.push(r.name) });
  return { runner, calls, names };
}

const ticks = (runner: ScriptRunner, n: number) => {
  for (let i = 0; i < n; i++) runner.tick();
};

describe("automate de scripts : synthétique", () => {
  it("ouvre un script : le héros ne répond plus, puis le rend à la fermeture avec cnt = 7", () => {
    const { runner } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("wat", [3]), rec("sys", [3])]);
    runner.runInit();
    expect(runner.status).toBe("waiting-ticks");
    expect(runner.flags).toMatchObject({ running: true, heroControl: false, cnt: 7 });
    ticks(runner, 3);
    expect(runner.status).toBe("idle");
    expect(runner.flags).toMatchObject({ running: false, heroControl: true, cnt: 7, skip: false, paused: false });
  });

  it("wat : attend exactement n tics sans bloquer", () => {
    const { runner, calls } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("wat", [5]), rec("dsk", [9])]);
    runner.runInit();
    ticks(runner, 4);
    expect(calls).toEqual([]);
    runner.tick();
    expect(calls).toEqual([["setDiskFlag", 9]]);
    expect(runner.status).toBe("idle"); // EOF : état 3
  });

  it("fenêtre de texte : Entrée, Échap ou clic confirment, une autre touche sonne", () => {
    const { runner, calls } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("tta", [], 1, "a"), rec("dsk", [1])]);
    runner.runInit();
    expect(runner.status).toBe("waiting-text");
    runner.input({ type: "key", key: "other" });
    expect(calls.at(-1)).toEqual(["bell"]);
    runner.input({ type: "click" });
    expect(runner.status).toBe("idle");
    expect(calls.map((c) => c[0])).toEqual(["showText", "bell", "advanceText", "setDiskFlag"]);
  });

  it("souris coupée (mse 0) : le clic ne confirme plus", () => {
    const { runner } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("mse", [0]), rec("tta", [], 1, "a")]);
    runner.runInit();
    runner.input({ type: "click" });
    expect(runner.status).toBe("waiting-text");
    runner.input({ type: "key", key: "enter" });
    expect(runner.status).toBe("idle");
  });

  it("texte paginé : chaque page attend sa confirmation", () => {
    const { runner, calls } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("tta", [], 1, "long"), rec("dsk", [1])], 2);
    runner.runInit();
    runner.input({ type: "key", key: "enter" });
    runner.input({ type: "key", key: "enter" });
    expect(runner.status).toBe("waiting-text");
    expect(calls.some((c) => c[0] === "setDiskFlag")).toBe(false);
    runner.input({ type: "key", key: "enter" });
    expect(calls.at(-1)).toEqual(["setDiskFlag", 1]);
  });

  it("aut n : lecture automatique, une page toutes les n tics", () => {
    const { runner, calls } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("aut", [10]), rec("tta", [], 1, "x"), rec("dsk", [1])], 1);
    runner.runInit();
    ticks(runner, 9);
    expect(runner.status).toBe("waiting-text");
    runner.tick(); // page 1 -> 2
    expect(runner.status).toBe("waiting-text");
    ticks(runner, 10);
    expect(calls.at(-1)).toEqual(["setDiskFlag", 1]);
  });

  it("niveau dgs : un groupe refusé sonne et n'est pas exécuté", () => {
    const { runner, calls } = runnerOf([rec("cnt", [7]), rec("dsk", [1]), rec("dgs", [99]), rec("dsk", [2]), rec("dgs", [0]), rec("dsk", [3])]);
    runner.runInit();
    expect(calls).toEqual([["bell"], ["setDiskFlag", 2], ["bell"]]);
  });

  it("dgs retombe à 0 à la fermeture, même sans dgs 0", () => {
    const { runner } = runnerOf([rec("cnt", [7]), rec("dgs", [99])]);
    runner.runInit();
    expect(runner.flags.dgs).toBe(0);
  });

  describe("cnt et répétition (§ 12.3)", () => {
    it("cnt non nul : tout s'enchaîne sans rendre la main, quel que soit rep", () => {
      const { runner, names } = runnerOf([rec("cnt", [7], 5), rec("nop", [], 5), rec("rem", [], 9)]);
      runner.runInit();
      expect(names).toEqual(["cnt", "nop", "rem"]);
      expect(runner.status).toBe("idle");
    });

    it("cnt nul et rep 0 : on enchaîne", () => {
      const { runner, names } = runnerOf([rec("nop", [], 0), rec("rem", [], 0)]);
      runner.runInit();
      expect(names).toEqual(["nop", "rem"]);
    });

    it("cnt nul et rep n : rend la main et reprend après n rappels", () => {
      const { runner, names } = runnerOf([rec("nop", [], 2), rec("rem", [], 0)]);
      runner.runInit();
      expect(names).toEqual(["nop"]);
      expect(runner.status).toBe("yielded");
      runner.tick();
      expect(names).toEqual(["nop"]);
      runner.tick();
      expect(names).toEqual(["nop", "rem"]);
      expect(runner.status).toBe("idle");
    });

    it("nil : la pause suspend les rappels jusqu'à ce qu'elle soit levée", () => {
      const { runner, names } = runnerOf([rec("dgs", [99], 0), rec("nil", [1], 1), rec("nop", [], 0)]);
      runner.runInit();
      ticks(runner, 5);
      expect(names).toEqual(["dgs", "nil"]);
      runner.interpreter.flags.paused = false;
      ticks(runner, 2);
      expect(names).toEqual(["dgs", "nil", "nop"]);
    });
  });

  describe("saut F8 (§ 12.4)", () => {
    const script = () => [
      rec("cnt", [7]),
      rec("dgs", [99]),
      rec("wat", [50]),
      rec("dsk", [1]),
      rec("tta", [], 1, "texte"),
      rec("fin"),
      rec("dsk", [2]),
      rec("sys", [3]),
    ];

    it("pendant une attente : annule l'attente et saute jusqu'au prochain fin", () => {
      const { runner, calls, names } = runnerOf(script());
      runner.runInit();
      runner.input({ type: "skip" });
      expect(calls).toEqual([["setDiskFlag", 2]]);
      expect(names).toEqual(["cnt", "dgs", "wat", "fin", "dsk", "sys"]);
      expect(runner.status).toBe("idle");
      expect(runner.flags.skip).toBe(false);
    });

    it("pendant un texte : ferme la fenêtre", () => {
      const { runner, calls } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("tta", [], 1, "x"), rec("dsk", [1]), rec("fin"), rec("dsk", [2])]);
      runner.runInit();
      runner.input({ type: "skip" });
      expect(calls.map((c) => c[0])).toEqual(["showText", "closeText", "setDiskFlag"]);
      expect(calls.at(-1)).toEqual(["setDiskFlag", 2]);
    });

    it("sans script en cours : ignoré", () => {
      const { runner, calls } = runnerOf([]);
      runner.input({ type: "skip" });
      expect(runner.flags.skip).toBe(false);
      expect(calls).toEqual([]);
    });
  });

  describe("ligne /jeton", () => {
    it("exécute un jeton du groupe 0 seulement, ignorée pendant un script", () => {
      const { runner, calls } = runnerOf([rec("cnt", [7]), rec("wat", [9])]);
      expect(runner.runCommand("/lum 0")).toBe(false);
      expect(runner.runCommand("/dgs 99")).toBe(true);
      expect(runner.runCommand("/lum 5 6")).toBe(true);
      expect(calls).toEqual([["bell"], ["setLight", 5, 6]]);
      runner.runInit();
      expect(runner.runCommand("/lum 1 1")).toBe(false);
      expect(calls).toHaveLength(2);
    });

    it("/wat tapé attend sans bloquer, /sys 0 lance CM1, /xit quitte", () => {
      const { runner, calls } = runnerOf([rec("cnt", [7]), rec("dgs", [99]), rec("dsk", [4])]);
      runner.runCommand("/dgs 99");
      runner.runCommand("/wat 2");
      expect(runner.status).toBe("waiting-ticks");
      ticks(runner, 2);
      expect(runner.status).toBe("idle");
      runner.runCommand("/sys 0");
      expect(calls).toEqual([["setDiskFlag", 4]]);
      runner.runCommand("/xit");
      expect(calls.at(-1)).toEqual(["quit"]);
      expect(runner.status).toBe("ended");
    });
  });

  it("sys 8 ferme CM3, ou enchaîne sur CM4 si l'état 7 a servi", () => {
    const scripts: ScriptSet = { 1: [], 2: [], 3: [rec("cnt", [7]), rec("dgs", [99]), rec("sys", [8])], 4: [rec("cnt", [7]), rec("dgs", [99]), rec("dsk", [4])] };
    const a = recordingHost();
    new ScriptRunner(a.host, scripts).runEpisodeEnd();
    expect(a.calls).toEqual([]);
    const b = recordingHost();
    const runner = new ScriptRunner(b.host, scripts);
    runner.runEpisodeEnd(true);
    expect(b.calls).toEqual([["setDiskFlag", 4]]);
    expect(runner.status).toBe("idle");
  });
});

describe.skipIf(!hasOriginalFiles)("scripts CM d'Armaeth (fichiers du jeu)", () => {
  const files = [1, 2, 3, 4].map((n) => parseCm(readOriginal(`A1FCM${n}.SYS`)));
  const scripts: ScriptSet = { 1: files[0], 2: files[1], 3: files[2], 4: files[3] };
  const fresh = () => {
    const { host, calls } = recordingHost();
    const names: string[] = [];
    const bad: string[] = [];
    const runner = new ScriptRunner(host, scripts, {
      onToken: (r, res) => {
        names.push(r.name);
        if (!res.ok) bad.push(r.name);
      },
    });
    return { runner, calls, names, bad };
  };

  it("CM1 : silencieux, dsk 7 et lum 0, puis fermeture", () => {
    const { runner, calls, names, bad } = fresh();
    runner.runInit();
    expect(names).toEqual(["cnt", "dgs", "dsk", "lum", "dgs", "sys"]);
    expect(calls).toEqual([["setDiskFlag", 7], ["setLight", 0, -1]]);
    expect(bad).toEqual([]);
    expect(runner.status).toBe("idle");
    expect(runner.flags).toMatchObject({ dgs: 0, heroControl: true, running: false });
  });

  it("CM4 : fenêtre ecr 250 238 221 / ttl 0 0 0 0, conseils, fin puis xit", () => {
    const { runner, calls, names, bad } = fresh();
    runner.runQuitTips();
    expect(runner.status).toBe("waiting-text");
    expect(calls).toEqual([
      ["resetDriver"],
      ["showText", { text: files[3][5].text, window: { x: 0, y: 0, width: 0, height: 0 }, centered: false, colors: [250, 238, 221] }],
    ]);
    expect(files[3][5].name).toBe("tta");
    expect(files[3][5].text.length).toBeGreaterThan(0);
    runner.input({ type: "click" });
    expect(names).toEqual(["cnt", "dgs", "sec", "ecr", "ttl", "tta", "fin", "xit"]);
    expect(calls.map((c) => c[0])).toEqual(["resetDriver", "showText", "advanceText", "quit"]);
    expect(bad).toEqual([]);
    expect(runner.status).toBe("ended");
  });

  it("CM3 : sec, lum 0, fin, puis fermeture sans CM4", () => {
    const { runner, calls, names, bad } = fresh();
    runner.runEpisodeEnd();
    expect(names).toEqual(["cnt", "dgs", "sec", "lum", "fin", "dgs", "sys"]);
    expect(calls).toEqual([["resetDriver"], ["setLight", 0, -1]]);
    expect(bad).toEqual([]);
    expect(runner.status).toBe("idle");
  });

  it("CM3 avec l'état 7 enchaîne sur les conseils CM4", () => {
    const { runner, calls } = fresh();
    runner.runEpisodeEnd(true);
    expect(runner.status).toBe("waiting-text");
    expect(calls.filter((c) => c[0] === "showText")).toHaveLength(1);
  });

  it("CM2 de bout en bout : scènes 21 et 20, dix fenêtres, attentes de 80, 60 et 40 tics", () => {
    const { runner, calls, names, bad } = fresh();
    runner.runIntro();
    expect(calls.slice(0, 3).map((c) => c[0])).toEqual(["resetDriver", "snapshotStack", "loadScene"]);
    expect(calls[1]).toEqual(["snapshotStack", 2048]);
    expect(calls[2]).toEqual(["loadScene", 21]);
    expect(calls[3].slice(0, 2)).toEqual(["sound", "mus"]);
    expect((calls[3][2] as number[]).slice(0, 8)).toEqual([1, 77, 1, 7, 1, 7, 0, 0]);
    ticks(runner, 79);
    expect(calls.filter((c) => c[0] === "loadScene")).toHaveLength(1);
    runner.tick();
    expect(calls.at(-1)).toEqual(["loadScene", 20]);
    ticks(runner, 59);
    expect(calls.some((c) => c[0] === "showText")).toBe(false);
    runner.tick();
    expect(calls.at(-2)).toEqual(["snapshotStack", -1]);
    for (let i = 0; i < 10; i++) {
      expect(runner.status).toBe("waiting-text");
      runner.input({ type: "key", key: i % 2 ? "enter" : "escape" });
    }
    expect(runner.status).toBe("waiting-ticks");
    ticks(runner, 40);
    expect(runner.status).toBe("idle");
    const shown = calls.filter((c) => c[0] === "showText") as Call[];
    expect(shown).toHaveLength(10);
    expect((shown[0][1] as { window: unknown; colors: unknown }).window).toEqual({ x: 62, y: 66, width: 196, height: 120 });
    expect((shown[0][1] as { colors: unknown }).colors).toEqual([237, 238, 234]);
    expect(calls.slice(-6)).toEqual([
      ["saveSlot", -1], ["setHandlerGate", 0, 7], ["setHandlerGate", 1, 7], ["setHandlerGate", 2, 7], ["setHandlerGate", 3, 7],
      ["setLight", 0, -1],
    ]);
    expect(names.at(-1)).toBe("sys");
    expect(bad).toEqual([]);
    expect(runner.flags).toMatchObject({ dgs: 0, heroControl: true });
  });

  it("CM2 : F8 pendant la première attente saute jusqu'au fin et exécute la suite", () => {
    const { runner, calls, bad } = fresh();
    runner.runIntro();
    runner.input({ type: "skip" });
    expect(calls.some((c) => c[0] === "showText")).toBe(false);
    expect(calls.filter((c) => c[0] === "loadScene")).toEqual([["loadScene", 21]]);
    expect(calls.at(-1)).toEqual(["setLight", 0, -1]);
    expect(calls.find((c) => c[0] === "saveSlot")).toEqual(["saveSlot", -1]);
    expect(bad).toEqual([]);
    expect(runner.status).toBe("idle");
  });

  it("aucun enregistrement des quatre fichiers ne rend jamais la main", () => {
    // cnt 7 en tête : même avec rep = 1 partout, status ne passe jamais par « yielded ».
    for (const n of [1, 2, 3, 4] as ScriptNumber[]) {
      const { host } = recordingHost();
      const seen = new Set<string>();
      const runner = new ScriptRunner(host, scripts, { onToken: () => seen.add(runner.status) });
      runner.step(n === 1 ? 0 : n === 2 ? 4 : n === 3 ? 5 : 9);
      expect(seen.has("yielded")).toBe(false);
    }
  });
});
