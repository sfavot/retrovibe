import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasOriginalFiles, parseBenchInputs, readFixture, replay, withoutMusic } from "./helpers";

function inputs(name: string) {
  return parseBenchInputs(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));
}

/** Première ligne différente (sans le champ `mus`), ou `null`. */
function firstDivergence(reference: string[], port: string[]): string | null {
  for (let i = 0; i < Math.max(reference.length, port.length); i++) {
    const a = reference[i] && withoutMusic(reference[i]!);
    const b = port[i] && withoutMusic(port[i]!);
    if (a !== b) return `ligne ${i}\nbanc  : ${a}\nportage : ${b}`;
  }
  return null;
}

describe.skipIf(!hasOriginalFiles)("comparaison au banc ScummVM, tick par tick", () => {
  it("intro (445 ticks, 5 messages) puis première scène avec une marche : traces identiques jusqu'au tick 600", () => {
    const reference = readFixture("intro-first-scene.trace");
    const { lines } = replay(inputs("intro-first-scene.inputs"), 600);
    expect(lines.filter((l) => l.startsWith("TK"))).toHaveLength(600);
    expect(firstDivergence(reference, lines)).toBeNull();
  });

  it("verbes au clavier, relations, messages d'échec (hasard) et attentes de clic : traces identiques des ticks 530 à 700", () => {
    const reference = readFixture("verbs.trace");
    const { lines } = replay(inputs("verbs.inputs"), 700);
    const port = lines.filter((line) => Number(line.split(" ")[1]) >= 530);
    expect(firstDivergence(reference, port)).toBeNull();
  });
});
