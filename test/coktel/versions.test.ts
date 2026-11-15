import { describe, expect, it } from "vitest";
import type { CoktelGameDefinition, GameHooks, InterpreterVersion } from "../../src/engine/coktel/definition";
import { Game } from "../../src/engine/coktel/game";
import { HeadlessHost, NullSubsystems } from "../../src/engine/coktel/host";
import { decodeInstr, OPCODES_V2, OPCODES_V3, opcodeTable, type OpcodeTable } from "../../src/engine/coktel/opcodes";
import { Script } from "../../src/engine/coktel/script";
import { scummvmRandom } from "../../src/engine/rng";

/** Octets de commande : code i * 16 + j -> octet (splitCommand inversé). */
const SPEAKER_ON = 0xe2; // 0x22
const SPEAKER_OFF = 0xe3; // 0x23
const GOBLIN_FUNC = 0xe5; // 0x25
const CALL_SUB = 0x00; // 0x00
const KEY_FUNC = 0xf4; // 0x14
const CAPTURE_POP = 0xf6; // 0x16
const imm8 = (n: number) => [21, n, 99];
const i16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

function scriptOf(bytes: number[]): Script {
  const data = new Uint8Array(128 + bytes.length);
  data.set(bytes, 128);
  return new Script("TEST.TOT", data);
}

/** Bloc de commandes (type 1) : en-tête, puis les commandes. */
function block(count: number, cmds: number[]): number[] {
  const size = cmds.length + 2;
  return [1, count, size & 0xff, size >> 8, ...cmds];
}

function definition(version: InterpreterVersion, hooks?: GameHooks): CoktelGameDefinition {
  return {
    id: "test",
    version,
    startArchive: "INTRO.STK",
    startTot: "INTRO.TOT",
    createSaves: () => {
      throw new Error("sans sauvegardes");
    },
    hooks,
  };
}

/** Exécute un bloc de commandes avec la table de `version` ; retourne les appels aux sous-systèmes. */
async function run(version: InterpreterVersion, cmds: number[], count: number, hooks?: GameHooks) {
  const sys = new NullSubsystems();
  const game = new Game(new HeadlessHost({ readFile: () => undefined }), sys, definition(version, hooks));
  game.inter.allocateVars(64);
  const script = scriptOf(block(count, cmds));
  script.pos = 128;
  script.finished = false;
  game.script = script;
  await game.inter.funcBlock(0);
  return { game, sys, calls: sys.calls.filter((c) => c.system === "sound").map((c) => [c.method, ...c.args]) };
}

const names = (t: OpcodeTable) => [...Object.values(t.func), ...Object.values(t.draw), ...Object.values(t.gob)].map((d) => d.name);

describe("tables d'opcodes par version (Inter_v2 / Inter_v3)", () => {
  it("v2 n'a aucune fonction o3_ : haut-parleur et copie de sprite d'Inter_v1, table gob d'Inter_v2", () => {
    expect(names(OPCODES_V2).filter((n) => n.startsWith("o3_"))).toEqual([]);
    expect(OPCODES_V2.func[0x22].name).toBe("o1_speakerOn");
    expect(OPCODES_V2.func[0x23].name).toBe("o1_speakerOff");
    expect(OPCODES_V2.func[0x32].name).toBe("o1_copySprite");
    expect(Object.keys(OPCODES_V2.gob).map(Number)).toEqual([0, 1, 2, 10, 100, 500, 501]);
    expect(OPCODES_V2.gob[100].name).toBe("o2_handleGoblins");
  });

  it("v3 = v2 + o3_speakerOn/Off, o3_copySprite et une table gob où 100 = o3_wobble, sans Protracker", () => {
    expect(OPCODES_V3.func[0x22].name).toBe("o3_speakerOn");
    expect(OPCODES_V3.func[0x23].name).toBe("o3_speakerOff");
    expect(OPCODES_V3.func[0x32].name).toBe("o3_copySprite");
    expect(Object.keys(OPCODES_V3.gob).map(Number)).toEqual([0, 1, 2, 10, 100]);
    expect(OPCODES_V3.gob[100].name).toBe("o3_wobble");
    const differing = Object.keys(OPCODES_V3.func)
      .map(Number)
      .filter((code) => OPCODES_V3.func[code] !== OPCODES_V2.func[code]);
    expect(differing).toEqual([0x22, 0x23, 0x32]);
    expect(OPCODES_V3.draw).toBe(OPCODES_V2.draw);
    expect(opcodeTable(2)).toBe(OPCODES_V2);
    expect(opcodeTable(3)).toBe(OPCODES_V3);
  });

  it("o2_getTotTextItemPart est une fonction d'Inter_v2 (degob la nomme o3_)", () => {
    for (const t of [OPCODES_V2, OPCODES_V3]) {
      expect(t.func[0x1a].name).toBe("o2_getTotTextItemPart");
      expect(t.func[0x1a].degob).toBe("o3_getTotTextItemPart");
    }
  });
});

describe("o2_goblinFunc", () => {
  const gob = (cmd: number, paramCount: number, params: number[]) => [GOBLIN_FUNC, ...i16(cmd), ...i16(paramCount), ...params.flatMap(i16), CAPTURE_POP];

  it("une fonction inconnue (Ween : 3 et 13) est sautée de paramCount mots, comme inter.cpp:98-114", () => {
    for (const table of [OPCODES_V2, OPCODES_V3]) {
      for (const cmd of [3, 13]) {
        const s = scriptOf(gob(cmd, 1, [0x1234]));
        const ins = decodeInstr(s, null, 128, table);
        expect(ins.name).toBe("o2_goblinFunc");
        expect(ins.args).toMatchObject({ cmd, paramCount: 1, sub: null, unknown: true });
        expect(ins.next).toBe(128 + 1 + 4 + 2);
        expect(decodeInstr(s, null, ins.next, table).name).toBe("o1_capturePop");
      }
    }
  });

  it("100 lit six mots en v2 (o2_handleGoblins), aucun en v3 (o3_wobble)", () => {
    const words = [1, 2, 3, 4, 5, 6];
    const v2 = decodeInstr(scriptOf(gob(100, 6, words)), null, 128, OPCODES_V2);
    expect(v2.args.sub).toBe("o2_handleGoblins");
    expect(v2.args.subArgs.words).toEqual(words);
    expect(v2.next).toBe(128 + 5 + 12);
    const v3 = decodeInstr(scriptOf(gob(100, 0, [])), null, 128, OPCODES_V3);
    expect(v3.args.sub).toBe("o3_wobble");
    expect(v3.next).toBe(128 + 5);
  });

  it("une fonction inconnue s'exécute sans effet ; o2_handleGoblins lève une erreur claire", async () => {
    const skipped = await run(2, gob(13, 1, [7]), 2);
    expect(skipped.sys.count("draw", "capturePop")).toBe(0); // capturePop sans capture : rien à dépiler
    expect(skipped.game.inter.steps).toBe(2);
    expect(skipped.game.script.pos).toBe(128 + 4 + 8);
    await expect(run(2, gob(100, 6, [0, 0, 0, 0, 0, 0]).slice(0, -1), 1)).rejects.toThrow(/o2_handleGoblins/);
  });

  it("le cache de décodage suit la version de la table", () => {
    const s = scriptOf([SPEAKER_ON, ...imm8(50)]);
    expect(decodeInstr(s, null, 128, OPCODES_V3).name).toBe("o3_speakerOn");
    expect(decodeInstr(s, null, 128, OPCODES_V2).name).toBe("o1_speakerOn");
  });
});

describe("haut-parleur selon la version", () => {
  const beep = [SPEAKER_ON, ...imm8(50), SPEAKER_OFF];

  it("v2 (o1_speakerOn) : la fréquence 50 sonne jusqu'au speakerOff (pas de contournement « bruit de pas »)", async () => {
    const { calls } = await run(2, beep, 2);
    expect(calls).toEqual([["speakerOn", 50, -1], ["speakerOff"]]);
  });

  it("v3 (o3_speakerOn) : la fréquence 50 dure 5 ms et le speakerOff suivant est ignoré", async () => {
    const { calls } = await run(3, beep, 2);
    expect(calls).toEqual([["speakerOn", 50, 5]]);
  });

  it("v3 : une autre fréquence sonne jusqu'au speakerOff", async () => {
    const { calls } = await run(3, [SPEAKER_ON, ...imm8(100), SPEAKER_OFF], 2);
    expect(calls).toEqual([["speakerOn", 100, -1], ["speakerOff"]]);
  });

  it("o1_keyFunc avec un délai prévient le haut-parleur (speakerOnUpdate)", async () => {
    const { calls } = await run(2, [KEY_FUNC, ...i16(30)], 1); // attente de 30 ms
    expect(calls).toEqual([["speakerOnUpdate", 30]]);
  });
});

describe("crochets du jeu", () => {
  it("beforeCallSub peut sauter un appel (protection de copie)", async () => {
    const seen: number[] = [];
    // o1_callSub 200 : le crochet refuse, le bloc continue avec speakerOff
    const { calls } = await run(2, [CALL_SUB, ...i16(200), SPEAKER_OFF], 2, {
      beforeCallSub: (_g, offset) => (seen.push(offset), true),
    });
    expect(seen).toEqual([200]);
    expect(calls).toEqual([["speakerOff"]]);
  });

  it("beforeOpcode voit chaque commande et peut en sauter une", async () => {
    const seen: string[] = [];
    const { calls, game } = await run(2, [SPEAKER_ON, ...imm8(80), SPEAKER_OFF], 2, {
      beforeOpcode: (_g, ins) => (seen.push(ins.name), ins.name === "o1_speakerOn"),
    });
    expect(seen).toEqual(["o1_speakerOn", "o1_speakerOff"]);
    expect(calls).toEqual([["speakerOff"]]);
    expect(game.script.pos).toBe(128 + 4 + 5);
  });
});

describe("hasard injecté (Util::getRandom)", () => {
  it("par défaut, la suite de ScummVM à graine 1 : getRandomNumber(max - 1), 0 pour 0", () => {
    const game = new Game(new HeadlessHost({ readFile: () => undefined }), new NullSubsystems(), definition(2));
    const reference = scummvmRandom(1);
    const drawn = [10, 3, 1000, 2].map((max) => game.inter.random(max));
    expect(drawn).toEqual([10, 3, 1000, 2].map((max) => reference.number(max - 1)));
    expect(game.inter.random(0)).toBe(0);
  });

  it("la source passée au jeu est celle utilisée", () => {
    const game = new Game(new HeadlessHost({ readFile: () => undefined }), new NullSubsystems(), definition(3), {
      random: scummvmRandom(1234),
    });
    const reference = scummvmRandom(1234);
    expect([5, 5, 5].map(() => game.inter.random(6))).toEqual([5, 5, 5].map(() => reference.number(5)));
  });
});
