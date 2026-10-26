import { beforeAll, describe, expect, it, vi } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import type { BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import { passageSteps, type PassageStep } from "../../src/games/armaeth/game/helpers";
import { portcullis, slab, stele } from "../../src/games/armaeth/game/npc-things";
import { NpcKit } from "../../src/games/armaeth/game/npc-kit";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/**
 * Passages secrets (`2500:0008` stèle, `27ed:000a` dalle, `29fd:0000` herse ; `docs/armaeth/screens.md` E14, `characters.md` § 10.2) :
 * messages d'état, découverte `S71`..`S76` + `S70`, script `CM3` et verdict `S41`, selon la salle, le niveau `4b4e` et le drapeau `4b68 + n`.
 * Relu dans le désassemblage ; `S56` (« Bientôt ARMAETH II ») n'a aucun appelant (voir le dernier test).
 */

const say = (cls: "V" | "G" | "S", number: number): PassageStep => ({ kind: "say", cls, number });
const END: PassageStep = { kind: "episodeEnd" };
const VERDICT: PassageStep = { kind: "verdict", header: 41 };
const steps = (kind: "stele" | "slab" | "portcullis", roomId: number, chapterLevel: number, opened: boolean, discovered = false) =>
  passageSteps(kind, { roomId, chapterLevel, opened, discovered });

describe("passageSteps : conditions documentées", () => {
  it("monde de CFG (4b4e = 3) : seulement les messages d'état, ni verdict ni fin d'épisode", () => {
    expect(steps("stele", 101, 3, true)).toEqual([say("V", 72)]);
    expect(steps("stele", 101, 3, false)).toEqual([say("V", 73)]);
    expect(steps("stele", 5, 3, true)).toEqual([]);
    expect(steps("slab", 108, 3, true)).toEqual([say("G", 113)]);
    expect(steps("slab", 108, 3, false)).toEqual([say("G", 114)]);
    expect(steps("slab", 202, 3, true)).toEqual([say("G", 115)]);
    expect(steps("slab", 202, 3, false)).toEqual([say("G", 116)]);
    expect(steps("portcullis", 202, 3, true)).toEqual([say("G", 224)]);
    expect(steps("portcullis", 202, 3, false)).toEqual([say("G", 225)]);
    expect(steps("portcullis", 305, 3, true)).toEqual([say("G", 226)]);
    expect(steps("portcullis", 305, 3, false)).toEqual([say("G", 227)]);
    expect(steps("slab", 110, 3, true)).toEqual([]);
  });

  it("stèle : `niv 0 0` hors de la salle 101 annonce S71, S70 puis CM3 ; refermée : verdict S41 une seule fois", () => {
    expect(steps("stele", 5, 0, true)).toEqual([say("S", 71), say("S", 70), END]);
    expect(steps("stele", 5, 0, false)).toEqual([VERDICT]);
    expect(steps("stele", 5, 0, false, true)).toEqual([]);
    expect(steps("stele", 101, 0, true)).toEqual([say("V", 72)]); // salle 101 et chapitre 0 : rien de plus
  });

  it("stèle : chapitre >= 1 dans la salle 101, l'ouverture annonce S72, S70 puis CM3 (la fermeture, rien)", () => {
    expect(steps("stele", 101, 100, true)).toEqual([say("V", 72), say("S", 72), say("S", 70), END]);
    expect(steps("stele", 101, 103, false)).toEqual([say("V", 73)]);
    expect(steps("stele", 5, 100, true)).toEqual([]);
  });

  it("dalle : niveau < 2 hors de la salle 202 : S73 ; chapitre 2 dans la salle 202 : S74 ; fermée : verdict", () => {
    expect(steps("slab", 108, 1, true)).toEqual([say("G", 113), say("S", 73), say("S", 70), END]);
    expect(steps("slab", 108, 1, false)).toEqual([say("G", 114), VERDICT]);
    expect(steps("slab", 108, 1, false, true)).toEqual([say("G", 114)]);
    expect(steps("slab", 202, 200, true)).toEqual([say("G", 115), say("S", 74), say("S", 70), END]);
    expect(steps("slab", 202, 200, false)).toEqual([say("G", 116)]);
    expect(steps("slab", 202, 1, true)).toEqual([say("G", 115)]); // niveau < 2 mais du côté 202 : chapitre 0
    expect(steps("slab", 108, 202, true)).toEqual([say("G", 113)]);
  });

  it("herse : niveau < 3 hors de la salle 305 : S75 ; chapitre 3 dans la salle 305 : S76", () => {
    expect(steps("portcullis", 202, 2, true)).toEqual([say("G", 224), say("S", 75), say("S", 70), END]);
    expect(steps("portcullis", 202, 2, false)).toEqual([say("G", 225), VERDICT]);
    expect(steps("portcullis", 305, 300, true)).toEqual([say("G", 226), say("S", 76), say("S", 70), END]);
    expect(steps("portcullis", 305, 300, false)).toEqual([say("G", 227)]);
    expect(steps("portcullis", 305, 2, true)).toEqual([say("G", 226)]);
  });
});

describe.skipIf(!hasOriginalFiles)("procédures des passages sur le monde réel", () => {
  const table = new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));
  const host = new TestHost();
  const engine = new ArmaethEngine(host, { seed: 1, bare: true });
  const kit = new NpcKit();
  let services: BehaviorContext;
  let state: NonNullable<ArmaethEngine["state"]>;
  beforeAll(() => {
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) engine.tick();
    };
    tick(2000);
    for (let clicks = 0; engine.windows.active && clicks < 40; clicks++) {
      host.pointer(100, 100, 1);
      engine.tick();
      host.pointer(100, 100, 0);
      engine.tick();
    }
    tick(320);
    services = (engine as unknown as { services: BehaviorContext }).services;
    state = engine.state!;
  });

  /** Contexte espion : salle simulée, messages, verdict et CM3 notés ; le reste est celui du moteur. */
  function spy(roomId: number) {
    const log: string[] = [];
    const ctx = new Proxy(services, {
      get(target, prop) {
        if (prop === "room") return { id: roomId, listA: [] };
        if (prop === "messages") return { ...target.messages, say: (cls: string | number, n: number) => log.push(`${cls}${n}`) };
        if (prop === "score") return { ...target.score, verdict: (h: number) => log.push(`verdict${h}`) };
        if (prop === "runEpisodeEnd") return () => log.push("CM3");
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as BehaviorContext;
    return { ctx, log };
  }
  const flagAt = (address: number) => (state.headerWords[(address - 0x4b46) >> 1]! >> (((address - 0x4b46) & 1) * 8)) & 0xff;

  it("la stèle ouverte (niv 0 0, salle 5) : S71, S70, CM3, drapeau 4b68, points (0, 3)", () => {
    const stone = state.findByNum(16)!;
    stone.ego = 2;
    stone.x = 0x61;
    state.chapterLevel = 0;
    const { ctx, log } = spy(5);
    const before = state.score;
    stele(kit)(stone, ctx);
    expect(log).toEqual(["S71", "S70", "CM3"]);
    expect(stone.ego).toBe(4);
    expect(flagAt(0x4b68)).toBe(7);
    expect(state.score).toBe(before + 30);
    // refermée : le drapeau est posé, pas de verdict
    stone.ego = 3;
    stone.x = 0x37;
    const again = spy(5);
    stele(kit)(stone, again.ctx);
    expect(again.log).toEqual([]);
    expect(stone.ego).toBe(0);
  });

  it("moteur : la stèle ouverte (niv 0 0, salle 5) lance CM3 une fois les fenêtres lues, pas avant", () => {
    const stone = state.findByNum(16)!;
    stone.ego = 2;
    stone.x = 0x61;
    state.chapterLevel = 0;
    const runEnd = vi.spyOn(engine.runner, "runEpisodeEnd");
    // seule la salle est simulée (la salle chargée du robot n'est pas la 5) : messages, file des fenêtres et CM3 sont ceux du moteur
    const ctx = new Proxy(services, {
      get(target, prop) {
        if (prop === "room") return { id: 5, listA: [] };
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as BehaviorContext;
    stele(kit)(stone, ctx);
    expect(runEnd).not.toHaveBeenCalled(); // S71 et S70 attendent d'être lus
    let clicks = 0;
    for (; clicks < 40; clicks++) {
      if (runEnd.mock.calls.length > 0) break;
      for (let i = 0; i < 4; i++) engine.tick();
      host.pointer(100, 100, 1);
      engine.tick();
      host.pointer(100, 100, 0);
      engine.tick();
    }
    expect(runEnd).toHaveBeenCalledTimes(1); // `ScriptRunner.runEpisodeEnd` (état 6), seulement après la lecture des fenêtres
    expect(clicks).toBeGreaterThan(0);
  });

  it("la dalle en mouvement dans la salle 108 impose 2 plans actifs (`27ed:002e`)", () => {
    const door = state.findByNum(104)!;
    door.ego = 1;
    door.tim = 5;
    let planes = 3;
    const ctx = new Proxy(services, {
      get(target, prop) {
        if (prop === "room") return { id: 108, listA: [] };
        if (prop === "rooms") return { ...target.rooms, setPlanes: (n: number) => (planes = n) };
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as BehaviorContext;
    slab(kit)(door, ctx);
    expect(planes).toBe(2);
  });

  it("la dalle refermée au niveau 1 hors de 202 affiche G114 puis le verdict S41 (drapeau 4b69 absent)", () => {
    const door = state.findByNum(104)!;
    state.chapterLevel = 1;
    door.ego = 2;
    door.tim = 1;
    const { ctx, log } = spy(108);
    slab(kit)(door, ctx);
    expect(log).toEqual(["G114", "verdict41"]);
    expect(flagAt(0x4b69)).toBe(7);
  });

  it("monde de CFG : la herse levée en salle 202 n'affiche que G224", () => {
    const gate = state.findByNum(207)!;
    state.chapterLevel = 3;
    gate.ego = 1;
    gate.tim = 1;
    const { ctx, log } = spy(202);
    portcullis(kit)(gate, ctx);
    expect(log).toEqual(["G224"]);
    expect(gate.ego).toBe(3);
  });

  it("les textes cités existent (S70..S76, V72, V73, G113..G116, G224..G227)", () => {
    for (const [cls, n] of [["S", 70], ["S", 71], ["S", 72], ["S", 73], ["S", 74], ["S", 75], ["S", 76], ["V", 72], ["V", 73], ["G", 113], ["G", 116], ["G", 224], ["G", 227]] as const) {
      expect(table.messages(messageId(cls, n)).length).toBeGreaterThan(5);
    }
  });
});

describe.skipIf(!hasOriginalFiles)("S56 (« Bientôt ARMAETH II ») : aucun appelant dans les exécutables", () => {
  it("le message existe mais ni `AM1.EXE` ni les autres programmes ne contiennent l'identifiant 19056, ni la paire (`S`, 56) en données", () => {
    const table = new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));
    expect(table.messages(messageId("S", 56))).toContain("Bientôt ARMAETH II");
    const find = (bytes: Uint8Array, pattern: number[]) => {
      for (let i = 0; i + pattern.length <= bytes.length; i++) if (pattern.every((b, k) => bytes[i + k] === b)) return i;
      return -1;
    };
    const exe = readOriginal("AM1.EXE");
    expect(find(exe, [0x70, 0x4a])).toBe(-1); // 19056 = 0x4A70 en mot
    expect(find(exe, [0x53, 0x00, 0x38, 0x00])).toBe(-1);
    expect(find(exe, [0x38, 0x00, 0x53, 0x00])).toBe(-1);
    // `S55` (0x4A6F) n'est lui non plus pas un mot en données : il est chargé par `MOV AX,0x53 ; MOV DX,0x37` (`2caf:023a`)
    expect(find(exe, [0x6f, 0x4a])).toBe(-1);
  });
});
