import { describe, expect, it } from "vitest";
import { analyzeCalls, disassembleScript, kernelName, loadProgram, propertySelectorsOf, routineName, type SciProgram, type SendPart } from "../../../src/games/gk1/engine/disasm";
import { toSint16 } from "../../../src/games/gk1/engine/memory";
import { Op } from "../../../src/games/gk1/engine/opcodes";
import { ShowStyle } from "../../../src/games/gk1/render/ids";
import { mainIndex, original, tally } from "../data/real";
import { Scene } from "./scene";

/**
 * Ce que les scripts demandent vraiment au compositeur, relevé sur les 213 scripts : c'est ce qui justifie de ne pas porter
 * les transitions 1 à 11, la loupe, `SetCursor` à cinq arguments et les plans retournés (`render/transitions.ts`,
 * `engine/kernel/effects.ts`, `cursor.ts`, `render/frameout.ts`).
 */
interface Usage {
  /** Messages envoyés, par sélecteur, avec le script et la routine d'où ils partent. */
  sends: Map<string, { part: SendPart; script: number; routine: string }[]>;
  /** Appels du noyau, par fonction : routine appelante et nombre d'arguments. */
  kernelCalls: Map<string, { routine: string; argc: number }[]>;
  /** Valeurs initiales d'une propriété, tous objets confondus. */
  property(name: string): number[];
}

function survey(program: SciProgram): Usage {
  const sends: Usage["sends"] = new Map();
  const kernelCalls: Usage["kernelCalls"] = new Map();
  for (const [number, script] of program.scripts) {
    const disassembly = disassembleScript(script);
    if (disassembly.legacyEncoding) continue;
    for (const routine of disassembly.routines) {
      const name = routineName(routine, program.names);
      for (const site of analyzeCalls(routine).values()) {
        const { opcode, operands } = site.instruction;
        if (opcode === Op.Callk) {
          const kernel = kernelName(program.names, operands[0]);
          kernelCalls.set(kernel, [...(kernelCalls.get(kernel) ?? []), { routine: name, argc: operands[1] >> 1 }]);
        }
        for (const part of site.sends ?? []) {
          const selector = program.names.selectors[part.selector];
          sends.set(selector, [...(sends.get(selector) ?? []), { part, script: number, routine: name }]);
        }
      }
    }
  }
  const property = (name: string): number[] => {
    const values: number[] = [];
    for (const script of program.scripts.values()) {
      for (const object of script.objects) {
        const index = [...(propertySelectorsOf(program.names, object) ?? [])].findIndex((selector) => program.names.selectors[selector] === name);
        if (index >= 0) values.push(toSint16(object.values[index]));
      }
    }
    return values;
  };
  return { sends, kernelCalls, property };
}

/** Bit 256 d'un style : lu par `Game::newRoom` sur `exitStyle` (fond noir), ignoré ailleurs. */
const STYLE_BLACKOUT = 256;

const sorted = (counts: Map<number | undefined, number>) => [...counts].sort((a, b) => (a[0] ?? -99) - (b[0] ?? -99));

describe.skipIf(!original.has)("ce que les scripts demandent au compositeur", () => {
  const usage = original.has ? survey(loadProgram(mainIndex())) : undefined!;

  it("SetShowStyle : seuls les types 0, 12, 13 et 14 sont demandés, sans bit de plan retourné", () => {
    // Un seul appelant ; il tient son style de `Plane::drawPic` et de `Game::newRoom`.
    expect(usage.kernelCalls.get("SetShowStyle")).toEqual([
      { routine: "Styler::doit", argc: 8 },
      { routine: "Styler::doit", argc: 7 },
    ]);
    expect(usage.sends.get("doit")!.filter((send) => send.routine === "Plane::drawPic" || send.routine === "Game::newRoom").length).toBeGreaterThanOrEqual(2);

    // Second argument de `drawPic` : une constante, ou la variable que relaient `Room::drawPic` et les encarts.
    const drawPic = usage.sends.get("drawPic")!.filter((send) => send.part.argc === 2);
    // 270 = 256 + 14 (pièces 710 et 750) : `Styler::doit` ne garde que l'octet bas, et le bit 256 n'est lu que sur `exitStyle`.
    expect(sorted(tally(drawPic.map((send) => send.part.args[1])))).toEqual([
      [undefined, 1],
      [ShowStyle.None, 54],
      [ShowStyle.FadeIn, 140],
      [STYLE_BLACKOUT | ShowStyle.FadeIn, 2],
    ]);
    expect(drawPic.filter((send) => send.part.args[1] === undefined).map((send) => send.routine)).toEqual(["Room::drawPic"]);
    expect(drawPic.filter((send) => send.part.args[1] === (STYLE_BLACKOUT | ShowStyle.FadeIn)).map((send) => send.script)).toEqual([710, 750]);
    // Un seul `drawPic` à trois arguments : la dissolution (12) du gros plan de la pièce 471.
    expect(usage.sends.get("drawPic")!.filter((send) => send.part.argc > 2).map((send) => [send.script, send.routine, send.part.args])).toEqual([
      [471, "doTheCloseUp::changeState", [600, ShowStyle.Dissolve, 1]],
    ]);

    // Propriétés `style` et `exitStyle` des pièces et des encarts, et leurs trois écritures par message.
    expect(sorted(tally(usage.property("style")))).toEqual([
      [-1, 1],
      [ShowStyle.None, 10],
      [ShowStyle.FadeIn, 79],
    ]);
    expect(sorted(tally(usage.property("exitStyle")))).toEqual([
      [-1, 5],
      [ShowStyle.None, 3],
      [ShowStyle.FadeOut, 56],
    ]);
    const written = (selector: string) => usage.sends.get(selector)!.filter((send) => send.part.argc === 1 && send.routine !== "Game::newRoom").map((send) => send.part.args[0]);
    expect(written("style")).toEqual([ShowStyle.FadeIn, ShowStyle.FadeIn, ShowStyle.FadeIn]);
    expect(sorted(tally(written("exitStyle")))).toEqual([
      [ShowStyle.None, 5],
      [ShowStyle.FadeOut, 1],
    ]);
  });

  it("plan retourné : `mirrored` n'est écrit que par Plane::drawPic, à partir d'un bit qu'aucun style ne porte", () => {
    expect(usage.property("mirrored").every((value) => value === 0)).toBe(true);
    expect((usage.sends.get("mirrored") ?? []).filter((send) => send.part.argc > 0)).toEqual([]);
  });

  it("loupe : personne n'envoie setMagnifier, seul à créer un Magnifier ; AddMagnify ne fait rien et reste une souche", () => {
    expect(usage.kernelCalls.get("AddMagnify")).toEqual([{ routine: "Magnifier::init", argc: 1 }]);
    expect(usage.kernelCalls.get("DeleteMagnify")).toEqual([{ routine: "Magnifier::dispose", argc: 1 }]);
    expect(usage.sends.get("setMagnifier")).toBeUndefined();
    expect(usage.property("magnifier").every((value) => value === 0)).toBe(true);

    const scene = new Scene();
    const plane = scene.plane(0, 0, 319, 199);
    const view = scene.view(plane, { view: 375, loop: 1, cel: 0, x: 100, y: 100 });
    scene.frameout.frameOut();
    const before = scene.frameout.screen.slice();
    expect(scene.kernelOn("AddMagnify", view)).toBe(0);
    expect(scene.kernelOn("DeleteMagnify", view)).toBe(0);
    scene.frameout.frameOut();
    expect(scene.frameout.screen).toEqual(before);
    expect(scene.frameout.planes.map((candidate) => candidate.items.length)).toEqual([1]);
    expect([...scene.vm.kernel.journal.stubs.keys()]).toEqual(["AddMagnify", "DeleteMagnify"]);
    expect([...scene.vm.warnings.keys()]).toEqual([]);
  });

  it("SetCursor à cinq arguments : il faudrait un setCursor à plus de quatre arguments, il n'y en a pas", () => {
    const five = usage.kernelCalls.get("SetCursor")!.filter((call) => call.argc === 5);
    expect(five.map((call) => call.routine).sort()).toEqual(["GK::setCursor", "Game::setCursor"]);
    expect(usage.kernelCalls.get("SetCursor")!.every((call) => call.argc <= 5)).toBe(true);
    expect(sorted(tally(usage.sends.get("setCursor")!.map((send) => send.part.argc)))).toEqual([
      [0, 5],
      [1, 98],
      [2, 81],
      [3, 82],
      [4, 14],
    ]);
  });
});
