import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { decodeBlock2, decodeInstr, opcodeTable } from "../../../src/engine/coktel/opcodes";
import { loadResources } from "../../../src/engine/coktel/resources";
import { Script } from "../../../src/engine/coktel/script";
import { loadIntro } from "../helpers";
import { textOf } from "./texts";

/**
 * Outil de lecture (ignoré sans `WEEN_SCRIPT`) : désassemble le TOT `WEEN_SCRIPT` (ex. `EMAJ1024`) avec la table v2,
 * expressions écrites en clair (infixe, `V<n>` = VAR(n) sur 32 bits, `B<octet>` / `W<octet>` = 8 / 16 bits), blocs
 * indentés, zones des blocs de type 2. Écrit dans `WEEN_SCRIPT_OUT` (par défaut `/tmp/<TOT>.dis`).
 */
const name = process.env.WEEN_SCRIPT;

const OPS: Record<number, string> = {
  1: "-", 2: "+", 3: "-", 4: "|", 5: "*", 6: "/", 7: "%", 8: "&", 9: "(", 10: ")", 11: "!", 12: "]",
  30: "||", 31: "&&", 32: "<", 33: "<=", 34: ">", 35: ">=", 36: "==", 37: "!=",
};

/** Expression à `at` écrite en infixe, jusqu'au jeton `stop` ; `one` : un seul terme (indice de destination). */
function expr(s: Script, at: number, stop = 99, one = false): { text: string; next: number } {
  const d = s.data;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let p = at;
  const out: string[] = [];
  let depth = 0;
  for (let guard = 0; guard < 400; guard++) {
    const op = d[p++];
    if (op === stop && (stop !== 10 || depth === 0)) break;
    if (op === 99) break;
    switch (op) {
      case 14: out.push(`@{${v.getInt16(p, true)}}`); p += 4; if (d[p] === 97) p++; break;
      case 17: out.push(`W${v.getUint16(p, true) * 2}`); p += 2; break;
      case 18: out.push(`B${v.getUint16(p, true)}`); p += 2; break;
      case 19: out.push(String(v.getInt32(p, true))); p += 4; break;
      case 20: out.push(String(v.getInt16(p, true))); p += 2; break;
      case 21: out.push(String(v.getInt8(p))); p += 1; break;
      case 22: {
        let e = p;
        while (d[e]) e++;
        out.push(JSON.stringify(String.fromCharCode(...d.subarray(p, e))));
        p = e + 1;
        break;
      }
      case 23: case 24: out.push(`V${v.getUint16(p, true)}`); p += 2; break;
      case 25: {
        out.push(`S${v.getUint16(p, true)}`); p += 2;
        if (d[p] === 13) { const r = expr(s, p + 1, 12); out.push(`[+${r.text}]`); p = r.next; }
        break;
      }
      case 15: case 16: case 26: case 27: case 28: {
        if (op === 15) p += 2;
        const base = v.getInt16(p, true);
        const dims = d[p + 2];
        p += 3 + dims;
        const idx: string[] = [];
        for (let i = 0; i < dims; i++) { const r = expr(s, p, 12); idx.push(r.text); p = r.next; }
        const k = { 15: "X", 16: "AB", 26: "AV", 27: "AW", 28: "AS" }[op];
        out.push(`${k}${base}[${idx.join(",")}]`);
        if (op === 28 && d[p] === 13) { const r = expr(s, p + 1, 12); out.push(`[+${r.text}]`); p = r.next; }
        break;
      }
      case 29: {
        const f = d[p++];
        const r = expr(s, p, 10);
        out.push(`${({ 0: "sqrt", 1: "sqrt", 6: "sqrt", 5: "sqr", 7: "abs", 10: "rand" } as Record<number, string>)[f] ?? `f${f}`}(${r.text})`);
        p = r.next;
        break;
      }
      default:
        if (op === 9) depth++;
        if (op === 10) depth--;
        out.push(OPS[op] ?? `?${op}`);
    }
    if (one && op !== 14) break;
  }
  return { text: out.join(" "), next: p };
}

describe.skipIf(!name)("Ween : lecture d'un script", () => {
  it("désassemble", () => {
    const tot = name!.toUpperCase().replace(/\.TOT$/, "");
    const res = loadResources(loadIntro(), `${tot}.TOT`, "fr")!;
    const script = new Script(`${tot}.TOT`, res.tot.script, res.tot.header);
    const table = opcodeTable(2);
    const lines: string[] = [];
    const seen = new Set<number>();
    const queue: number[] = [];
    const enqueue = (o: number) => {
      if (o >= 128 && o !== 0xffff && !seen.has(o)) {
        seen.add(o);
        queue.push(o);
      }
    };
    script.header.functions.forEach((f, i) => {
      if (f >= 128 && f !== 0xffff) lines.push(`; fonction d'en-tête ${i} -> ${f}`);
      enqueue(f);
    });
    const ex = (p: number) => expr(script, p).text;
    const block = (start: number, ind: string): void => {
      let pos = start + 1;
      let cmdCount = script.data[pos++];
      pos += 2;
      let counter = 0;
      if (cmdCount === 0) return;
      do {
        const ins = decodeInstr(script, res, pos, table);
        counter++;
        const a = ins.args;
        const head = `${String(ins.at).padStart(6)} ${ind}`;
        switch (ins.name) {
          case "o2_assign": {
            const dst = expr(script, a.dest.pos, 0x100, true).text;
            lines.push(`${head}${dst} = ${a.srcs.map(ex).join(" ; ")}`);
            break;
          }
          case "o1_if":
            lines.push(`${head}if ${ex(a.cond)}`);
            block(a.thenPos, `${ind}  `);
            if (a.elsePos) {
              lines.push(`${" ".repeat(7)}${ind}else`);
              block(a.elsePos, `${ind}  `);
            }
            break;
          case "o1_whileDo":
            lines.push(`${head}while ${ex(a.condPos)}`);
            block(a.blockPos, `${ind}  `);
            break;
          case "o1_repeatUntil":
            lines.push(`${head}repeat`);
            block(a.blockPos, `${ind}  `);
            lines.push(`${" ".repeat(7)}${ind}until ${ex(a.condPos)}`);
            break;
          case "o1_switch": {
            lines.push(`${head}switch ${expr(script, a.value.pos, 0x100, true).text}`);
            for (const c of a.cases) {
              lines.push(`${" ".repeat(7)}${ind}case ${c.exprs.map((e: { kind: string; value: number; pos: number }) => (e.kind === "expr" ? ex(e.pos) : e.value)).join(", ")}:`);
              block(c.blockPos, `${ind}    `);
            }
            if (a.defaultPos) {
              lines.push(`${" ".repeat(7)}${ind}default:`);
              block(a.defaultPos, `${ind}    `);
            }
            break;
          }
          case "o1_callSub": {
            const t = a.offset;
            const type = script.data[t];
            lines.push(`${head}call ${t}${type === 2 ? " (zones)" : ""}`);
            if (type === 1) enqueue(t);
            else if (type === 2) {
              const b = decodeBlock2(script, res, t);
              for (const h of b.hotspots) {
                const coords =
                  "values" in h.coords ? h.coords.values.join(", ") : h.coords.exprs.map((e) => expr(script, e).text).join(", ");
                lines.push(
                  `${" ".repeat(7)}${ind}  zone id=0x${(h.id & 0xffff).toString(16)} type=${h.type} [${coords}] key=${h.key} enter=${h.funcEnter} leave=${h.funcLeave}${h.input ? " input" : ""}${h.enable ? ` enable=${h.enable}` : ""}`,
                );
                if (h.input || h.enable) continue;
                if (h.funcEnter) enqueue(h.funcEnter);
                if (h.funcLeave) enqueue(h.funcLeave);
              }
            }
            break;
          }
          case "o1_setcmdCount":
            cmdCount = a.count;
            counter = 0;
            lines.push(`${head}setcmdCount ${a.count}`);
            break;
          case "o1_printTotText":
            lines.push(`${head}printTotText ${a.id} « ${textOf(tot, a.id)} »`);
            break;
          default: {
            // opérandes : les arguments décodés n'indiquent pas leur nature ; un nombre de nom usuel qui tombe dans le
            // script est lu comme une expression (lecture approchée, à vérifier dans `opcodes.ts`)
            const parts: string[] = [];
            for (const [k, val] of Object.entries(a ?? {})) {
              if (typeof val === "number" && val >= 128 && val < script.data.length && /^(a|b|e|id|index|x|y|left|top|width|height|flags|value|expr|cond)/.test(k) && k !== "key") {
                parts.push(`${k}=${ex(val)}`);
              } else if (Array.isArray(val) && val.every((x) => typeof x === "number")) {
                parts.push(`${k}=[${val.map((x) => (x >= 128 && x < script.data.length ? ex(x) : x)).join(" | ")}]`);
              } else if (val && typeof val === "object" && "pos" in (val as object) && "type" in (val as object)) {
                parts.push(`${k}=${expr(script, (val as { pos: number }).pos, 0x100, true).text}`);
              } else parts.push(`${k}=${JSON.stringify(val)}`);
            }
            lines.push(`${head}${ins.degob ?? ins.name} ${parts.join(" ")}`);
          }
        }
        pos = ins.next;
      } while (counter !== cmdCount);
    };
    for (let i = 0; i < queue.length; i++) {
      lines.push("", `=== fonction ${queue[i]}`);
      block(queue[i], "");
    }
    writeFileSync(process.env.WEEN_SCRIPT_OUT ?? `/tmp/${tot}.dis`, `${lines.join("\n")}\n`);
  });
});
