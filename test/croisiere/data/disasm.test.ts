import { describe, expect, it } from "vitest";
import { codeEnd, decodeInstruction, disassemble, disassembleScript, LAST_NATIVE, NATIVE_NAMES } from "../../../src/games/croisiere/data/disasm";
import { parseOverlay, scriptImports } from "../../../src/games/croisiere/data/overlay";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const REQUIRED = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"];
const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

describe("disasm (synthétique)", () => {
  it("décode les 12 types d'opcode avec leurs longueurs d'opérande", () => {
    // type 1 (0x08) = charge ; sous-type 0 : i16
    expect(decodeInstruction(Uint8Array.from([0x08, 0xff, 0xfe]), 0)).toMatchObject({ length: 3, mnemonic: "push", operand: { kind: "imm", value: -2 } });
    // charge variable : octet type 0x0d (mot dans l'espace 5), overlay 0, décalage 0x0124
    const load = decodeInstruction(Uint8Array.from([0x09, 0x0d, 0x00, 0x01, 0x24]), 0);
    expect(load).toMatchObject({ length: 5, mnemonic: "load", operand: { kind: "var", flags: 0x0d, overlay: 0, value: 0x124 } });
    expect(load.text).toBe("0000: load w ovlbss[+292]");
    expect(decodeInstruction(Uint8Array.from([0x0d, 0x0a, 0x00, 0x00, 0x02]), 0)).toMatchObject({ mnemonic: "load.idx", length: 5 });
    expect(decodeInstruction(Uint8Array.from([0x0a, 0, 1, 0, 4]), 0)).toMatchObject({ mnemonic: "loadobj", length: 5 });
    // type 2 (0x10) = range
    expect(decodeInstruction(Uint8Array.from([0x10]), 0)).toMatchObject({ mnemonic: "store.none", length: 1 });
    expect(decodeInstruction(Uint8Array.from([0x14]), 0)).toMatchObject({ mnemonic: "setidx", length: 1 });
    expect(decodeInstruction(Uint8Array.from([0x11, 0x0d, 0, 0, 8]), 0)).toMatchObject({ mnemonic: "store", length: 5 });
    // type 3 (0x18) = adresse ; sous-types sans effet : 1 octet
    expect(decodeInstruction(Uint8Array.from([0x19, 0x0a, 0, 0, 3]), 0)).toMatchObject({ mnemonic: "addr", length: 5 });
    expect(decodeInstruction(Uint8Array.from([0x1b]), 0)).toMatchObject({ mnemonic: "addr.nop", length: 1, unknown: false });
    // types 4, 5, 7, 8, 10, 11, 12 : un octet
    expect(decodeInstruction(Uint8Array.from([0x20]), 0).mnemonic).toBe("add");
    expect(decodeInstruction(Uint8Array.from([0x26]), 0).mnemonic).toBe("and");
    expect(decodeInstruction(Uint8Array.from([0x29]), 0).mnemonic).toBe("test.eq");
    expect(decodeInstruction(Uint8Array.from([0x38]), 0).mnemonic).toBe("ccr");
    expect(decodeInstruction(Uint8Array.from([0x40]), 0).mnemonic).toBe("swap");
    expect(decodeInstruction(Uint8Array.from([0x50]), 0).mnemonic).toBe("stop");
    expect(decodeInstruction(Uint8Array.from([0x58]), 0).mnemonic).toBe("nop");
    expect(decodeInstruction(Uint8Array.from([0x60]), 0).mnemonic).toBe("end");
  });

  it("calcule la cible d'un saut relatif à l'adresse de son opérande", () => {
    // jz +3 depuis l'offset 5 : cible = 5 + 1 + 3 = 9 (ScummVM : `scriptOffset` avant lecture du mot + déplacement)
    const code = Uint8Array.from([0x58, 0x58, 0x58, 0x58, 0x58, 0x31, 0x00, 0x03, 0x58, 0x58]);
    const jump = decodeInstruction(code, 5);
    expect(jump).toMatchObject({ mnemonic: "jz", length: 3, operand: { kind: "target", value: 9 } });
    expect(decodeInstruction(Uint8Array.from([0x37, 0xff, 0xfe]), 0)).toMatchObject({ mnemonic: "jmp", operand: { value: -1 } });
  });

  it("nomme les appels natifs ; 0 est inconnu, une entrée vide de ScummVM ne l'est pas", () => {
    expect(NATIVE_NAMES).toHaveLength(LAST_NATIVE + 1);
    expect(LAST_NATIVE).toBe(0x7d);
    expect(decodeInstruction(Uint8Array.from([0x48, 0x0c]), 0).text).toBe("0000: call LoadOverlay");
    expect(decodeInstruction(Uint8Array.from([0x48, 0x00]), 0).unknown).toBe(true);
    expect(decodeInstruction(Uint8Array.from([0x48, 0x69]), 0)).toMatchObject({ unknown: false, text: "0000: call DeletePreload" });
  });

  it("marque inconnus : type 0, types > 12, sous-types non gérés, opérande tronqué", () => {
    expect(decodeInstruction(Uint8Array.from([0x00]), 0).unknown).toBe(true);
    expect(decodeInstruction(Uint8Array.from([0x68]), 0).unknown).toBe(true);
    expect(decodeInstruction(Uint8Array.from([0x0b, 0, 0]), 0).unknown).toBe(true); // charge, sous-type 3
    expect(decodeInstruction(Uint8Array.from([0x08, 0x00]), 0).unknown).toBe(true); // i16 tronqué
    const list = disassemble(Uint8Array.from([0x08, 0, 1, 0x00, 0x50]));
    expect(list.map((i) => i.mnemonic)).toEqual(["push", "op0.0"]); // s'arrête à la première instruction inconnue
  });
});

describe.skipIf(!hasOriginalFiles)("disasm (fichiers originaux)", () => {
  const volumes = CruiseVolumes.open((name) => original.read(name));
  const overlays = [...new Set(volumes.entries.filter((e) => e.name.endsWith(".OVL")).map((e) => e.name))].map((file) => ({
    file,
    ovl: parseOverlay(volumes.readFile(file)),
  }));

  it("décode les 2 571 scripts des 82 overlays jusqu'au bout, sans opcode inconnu", () => {
    let scripts = 0;
    let instructions = 0;
    for (const { file, ovl } of overlays) {
      for (const [kind, list] of [["proc", ovl.procs], ["rel", ovl.rels]] as const) {
        list.forEach((block, i) => {
          scripts++;
          const out = disassembleScript(block);
          instructions += out.length;
          const where = `${file} ${kind}${i}`;
          expect(out.some((x) => x.unknown), where).toBe(false);
          const last = out[out.length - 1]!;
          expect(["stop", "end"], where).toContain(last.mnemonic);
          // Le code finit pile sur la section suivante, à un octet de bourrage près (alignement pair).
          const end = codeEnd(block);
          expect(end - (last.offset + last.length), where).toBeGreaterThanOrEqual(0);
          expect(end - (last.offset + last.length), where).toBeLessThanOrEqual(1);
        });
      }
    }
    expect(scripts).toBe(2571);
    expect(instructions).toBe(130_258);
  });

  it("chaque saut tombe sur une instruction, chaque appel natif existe, chaque import pointe une instruction ou un opérande", () => {
    const natives = new Set<number>();
    for (const { file, ovl } of overlays) {
      for (const block of [...ovl.procs, ...ovl.rels]) {
        const out = disassembleScript(block);
        const starts = new Set(out.map((i) => i.offset));
        const end = out[out.length - 1]!.offset + out[out.length - 1]!.length;
        for (const ins of out) {
          if (ins.operand?.kind === "target") expect(starts.has(ins.operand.value) || ins.operand.value === end, `${file} ${ins.text}`).toBe(true);
          if (ins.operand?.kind === "native") {
            natives.add(ins.operand.value);
            expect(ins.operand.value, `${file} ${ins.text}`).toBeLessThanOrEqual(LAST_NATIVE);
          }
        }
        for (const entry of scriptImports(block)) {
          // L'éditeur de liens réécrit soit une instruction entière (double empilement), soit
          // l'octet « type » d'un opérande de variable, un octet après l'opcode.
          const onInstruction = starts.has(entry.offset);
          const onOperand = starts.has(entry.offset - 1);
          expect(onInstruction || onOperand, `${file} import à ${entry.offset} (type ${entry.type})`).toBe(true);
        }
      }
    }
    expect(natives.size).toBe(102); // fonctions natives réellement appelées par les scripts
    expect(natives.has(0x0c)).toBe(true); // LoadOverlay
  });

  it("le script de démarrage AUTO00 appelle LoadOverlay (désassemblage lisible)", () => {
    const auto = overlays.find((o) => o.file === "AUTO00.OVL")!.ovl;
    const text = auto.procs.flatMap((p) => disassembleScript(p).map((i) => i.text)).join("\n");
    expect(text).toContain("call LoadOverlay");
    expect(text).toMatch(/^[0-9a-f]{4}: /m);
  });
});
