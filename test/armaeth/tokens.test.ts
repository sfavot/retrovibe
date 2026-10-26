import { describe, expect, it, vi } from "vitest";
import { TOKEN_GROUPS } from "../../src/games/armaeth/data/commands";
import { type ScriptControl, type TokenHost, TOKENS, TokenInterpreter, tokenizeLine } from "../../src/games/armaeth/engine/tokens";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { EngineTokenHost, type TokenHostEngine } from "../../src/games/armaeth/engine/token-host";

type Call = [string, ...unknown[]];

/** Hôte enregistreur : chaque méthode note son appel ; quelques retours sont configurables. */
function recordingHost(options: { pages?: number; object?: GameObject; message?: string } = {}) {
  const calls: Call[] = [];
  let pagesLeft = options.pages ?? 0;
  const host = new Proxy({} as Record<string, unknown>, {
    get: (_, name: string) => (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (name === "advanceText") return pagesLeft-- > 0;
      if (name === "resolveObject") return options.object;
      if (name === "getMessage") return options.message;
      return undefined;
    },
  }) as unknown as TokenHost;
  return { host, calls };
}

const noControl: ScriptControl = { step: () => undefined };

function interpreter(options?: Parameters<typeof recordingHost>[0]) {
  const { host, calls } = recordingHost(options);
  const interp = new TokenInterpreter(host, noControl);
  return { interp, calls };
}

describe("table des jetons", () => {
  it("contient les 119 jetons de TOKEN_GROUPS, dans l'ordre", () => {
    expect(TOKENS).toHaveLength(119);
    expect(TOKENS.map((t) => [t.group, t.name])).toEqual(TOKEN_GROUPS.flatMap((names, g) => names.map((n) => [g, n])));
    expect(TOKENS.every((t, i) => typeof t.handler === "function" && t.index === TOKEN_GROUPS[t.group].indexOf(t.name) && i >= 0)).toBe(true);
  });

  it("compte les jetons dont l'effet n'est pas établi", () => {
    expect(TOKENS.filter((t) => !t.established).map((t) => t.name)).toEqual(
      ["rlf", "rel", "scn", "sol", "aes", "pds", "aev", "por", "inv", "sor", "att", "sem", "skp"],
    );
  });

  it("chaque gestionnaire s'exécute sans arguments, niveau 99, sans exception", () => {
    for (const t of TOKENS) {
      const { interp } = interpreter();
      interp.flags.dgs = 99;
      expect(() => interp.dispatch(t.group, t.index, [], ""), t.name).not.toThrow();
    }
  });
});

describe("tokenizeLine (109a:0002)", () => {
  it("découpe jeton et arguments, complète à 16 avec -1", () => {
    const call = tokenizeLine("/niv 1 3");
    expect(call).toMatchObject({ group: 6, token: 1 });
    expect(call?.args).toHaveLength(16);
    expect(call?.args.slice(0, 3)).toEqual([1, 3, -1]);
  });

  it("garde -1 utilisable et lit atoi (0 si non numérique)", () => {
    expect(tokenizeLine("/ral -1 x")?.args.slice(0, 3)).toEqual([-1, 0, -1]);
  });

  it("`*` en 6e position dépose le reste de la ligne comme texte", () => {
    const call = tokenizeLine("/tta * bonjour le monde");
    expect(call).toMatchObject({ group: 4, token: 11, text: "bonjour le monde" });
    expect(call?.args.every((a) => a === -1)).toBe(true);
  });

  it("refuse une ligne trop courte ou un jeton inconnu", () => {
    expect(tokenizeLine("/xi")).toBeNull();
    expect(tokenizeLine("/zzz 1")).toBeNull();
  });

  it("accepte le faux positif à cheval sur deux jetons comme le strstr du jeu", () => {
    // « fin rem » contient « n r » ; trois lettres consécutives à cheval : « in ».
    expect(tokenizeLine("/in  ")).not.toBeNull();
  });
});

describe("niveau de groupe dgs (124c:0002)", () => {
  it("n'accepte que le groupe 0 au départ, ouvre tout avec /dgs 99", () => {
    const { interp, calls } = interpreter();
    expect(interp.runLine("/lum 0")).toEqual({ ok: false });
    expect(calls).toEqual([["bell"]]);
    expect(interp.runLine("/nop").ok).toBe(true);
    expect(interp.runLine("/dgs 99").ok).toBe(true);
    expect(interp.flags.dgs).toBe(99);
    expect(interp.runLine("/lum 3 4").ok).toBe(true);
    expect(calls.at(-1)).toEqual(["setLight", 3, 4]);
    expect(interp.runLine("/dgs 0").ok).toBe(true);
    expect(interp.runLine("/lum 0").ok).toBe(false);
  });

  it("refuse un groupe hors de 0..10 ou un jeton inconnu", () => {
    const { interp } = interpreter();
    interp.flags.dgs = 99;
    expect(interp.dispatch(11, 0, []).ok).toBe(false);
    expect(interp.dispatch(-1, 0, []).ok).toBe(false);
    expect(interp.dispatch(0, 9, []).ok).toBe(false);
  });

  it("dgs 9 laisse passer les groupes 0 à 9 mais pas le groupe 10", () => {
    const { interp } = interpreter();
    interp.flags.dgs = 9;
    expect(interp.dispatch(9, 3, [0]).ok).toBe(true); // raz
    expect(interp.dispatch(10, 3, [1, 1]).ok).toBe(false);
  });
});

describe("gestionnaires", () => {
  it("niv / svg : a0 * 100 + a1 sous 0 <= a0 <= a1 < 10, a1 par défaut a0 pour niv", () => {
    const { interp, calls } = interpreter();
    interp.flags.dgs = 99;
    expect(interp.runLine("/niv 1 3").ok).toBe(true);
    expect(interp.runLine("/niv 2").ok).toBe(true);
    expect(interp.runLine("/niv 3 1").ok).toBe(false);
    expect(interp.runLine("/svg 0 10").ok).toBe(false);
    expect(interp.runLine("/svg 0 3").ok).toBe(true);
    expect(calls.filter((c) => c[0] === "setChapterLevel")).toEqual([["setChapterLevel", 103], ["setChapterLevel", 202], ["setChapterLevel", 3]]);
  });

  it("heu : valeurs par défaut 23, 59, 99", () => {
    const { interp, calls } = interpreter();
    interp.flags.dgs = 99;
    interp.runLine("/heu");
    interp.runLine("/heu 8 30 1");
    expect(calls).toEqual([["setClock", 23, 59, 99], ["setClock", 8, 30, 1]]);
  });

  it("wat attend des tics, cmd affiche puis exécute après 25 tics", () => {
    const { interp, calls } = interpreter();
    interp.flags.dgs = 99;
    expect(interp.runLine("/wat 40").wait).toEqual({ kind: "ticks", ticks: 40 });
    const cmd = interp.runLine("/cmd * prendre la clef");
    expect(calls.at(-1)).toEqual(["echoCommand", "prendre la clef"]);
    expect(cmd.wait).toMatchObject({ kind: "ticks", ticks: 25 });
    expect(calls.some((c) => c[0] === "executeCommand")).toBe(false);
    cmd.wait?.kind === "ticks" && cmd.wait.then?.();
    expect(calls.at(-1)).toEqual(["executeCommand", "prendre la clef"]);
  });

  it("aut, dsp et tta : délais de lecture, couleurs de ecr et fenêtre de ttl", () => {
    const { interp, calls } = interpreter();
    interp.flags.dgs = 99;
    expect(interp.runLine("/aff * abc").wait).toEqual({ kind: "text", delay: 0 });
    interp.runLine("/aut 12");
    expect(interp.runLine("/aff * abc").wait).toEqual({ kind: "text", delay: 12 });
    const text = "x".repeat(30);
    expect(interp.runLine(`/dsp * ${text}`).wait).toEqual({ kind: "text", delay: 40 });
    interp.runLine("/ecr 1 2 3");
    interp.runLine("/ttl 4 5 6 7");
    interp.runLine("/tta * ok");
    expect(calls.at(-1)).toEqual(["showText", { text: "ok", window: { x: 4, y: 5, width: 6, height: 7 }, centered: false, colors: [1, 2, 3] }]);
  });

  it("dsp plafonne le délai à 255", () => {
    const { interp } = interpreter();
    interp.flags.dgs = 99;
    expect(interp.runLine(`/dsp * ${"y".repeat(400)}`).wait).toEqual({ kind: "text", delay: 255 });
  });

  it("champs d'objet : écriture, rafraîchissement et résolution du héros par défaut", () => {
    const obj = {} as GameObject;
    const { interp, calls } = interpreter({ object: obj });
    interp.flags.dgs = 99;
    interp.runLine("/ego 4");
    interp.runLine("/fig 2 77");
    interp.runLine("/gst 1");
    interp.runLine("/dir 1 -1 0");
    expect(calls).toEqual([
      ["resolveObject", -1], ["writeObjectField", obj, 0x2d, 1, 4],
      ["resolveObject", 77], ["writeObjectField", obj, 0x2e, 1, 2], ["refreshObject", obj],
      ["resolveObject", -1], ["writeObjectField", obj, 0x05, 1, 7],
      ["resolveObject", -1], ["writeObjectField", obj, 0x60, 1, 1], ["writeObjectField", obj, 0x62, 1, -1], ["writeObjectField", obj, 0x61, 1, 0],
    ]);
  });

  it("listes d'objets du groupe 7 : préfixe et famille", () => {
    const { interp, calls } = interpreter();
    interp.flags.dgs = 99;
    interp.runLine("/ado 5 1 0");
    interp.runLine("/zpi");
    interp.runLine("/nxd");
    expect(calls.map((c) => c.slice(0, 3))).toEqual([["objectList", "create", "obj"], ["objectList", "clear", "int"], ["objectList", "next", "dec"]]);
  });

  it("nil met en pause, mse règle la souris, xit quitte, hor échoue avec un bip", () => {
    const { interp, calls } = interpreter();
    interp.flags.dgs = 99;
    interp.runLine("/nil 1");
    expect(interp.flags.paused).toBe(true);
    interp.runLine("/nil 0");
    expect(interp.flags.paused).toBe(false);
    interp.runLine("/mse 0");
    expect(interp.flags.mouse).toBe(false);
    expect(interp.runLine("/hor").ok).toBe(false);
    interp.runLine("/xit");
    expect(interp.flags.quit).toBe(true);
    expect(calls.filter((c) => c[0] === "bell" || c[0] === "quit")).toEqual([["bell"], ["quit"]]);
  });

  it("msg affiche le message de la classe et du numéro, sinon rien", () => {
    const some = interpreter({ message: "texte" });
    some.interp.flags.dgs = 99;
    expect(some.interp.runLine("/msg 1 5").wait).toEqual({ kind: "text", delay: 0 });
    expect(some.interp.runLine("/msg 1").wait).toBeUndefined();
    const none = interpreter();
    none.interp.flags.dgs = 99;
    expect(none.interp.runLine("/msg 1 5").wait).toBeUndefined();
  });

  it("les jetons non établis n'ont aucun effet et ne sonnent pas", () => {
    const { interp, calls } = interpreter();
    interp.flags.dgs = 99;
    for (const t of TOKENS.filter((x) => !x.established)) expect(interp.dispatch(t.group, t.index, [1, 2, 3]).ok, t.name).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("hôte des jetons : lumière", () => {
  it("`lum` transmet le plafond tel quel, -1 compris (comparaison signée `197e:0008`)", () => {
    // régression du robot : un plafond converti ou ignoré laissait la lumière dépasser la palette normale (surexposition blanche avec une
    // torche dans une salle éclairée)
    const setLight = vi.fn();
    const host = new EngineTokenHost({ setLight } as unknown as TokenHostEngine);
    host.setLight(5, -1);
    host.setLight(0, 7);
    expect(setLight.mock.calls).toEqual([
      [5, -1],
      [0, 7],
    ]);
  });
});
