import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { benchInputFile, inventory, parseSteps, play, type Step } from "./driver";
import { textOf } from "./texts";
import { activeZones, center, formatZones, writeScreen } from "./zones";

/**
 * Outil d'exploration (ignoré sans `WEEN_EXPLORE`) : joue les étapes du fichier `WEEN_EXPLORE` (format de
 * `parseSteps`), puis écrit dans `WEEN_EXPLORE_OUT` l'écran final (`screen.png` avec les zones actives encadrées,
 * `plain.png`), la liste des zones (`zones.txt`), l'inventaire, les TOT chargés, les textes affichés, les points de
 * contrôle (`report.txt`), les entrées au format du banc (`inputs.txt`) et les boucles d'attente image par image
 * (`timeline.txt`). `WEEN_EXPLORE_SURVEY=1` : survole ensuite chaque zone visible et note le nom affiché
 * (`survey.txt`). `WEEN_EXPLORE_SHOTS=n` : une capture toutes les n images. `WEEN_EXPLORE_TAIL=n` : n images de plus.
 */
const file = process.env.WEEN_EXPLORE;

describe.skipIf(!file)("Ween : exploration", () => {
  it("joue et relève l'écran", async () => {
    const out = process.env.WEEN_EXPLORE_OUT ?? "/tmp/ween-explore";
    mkdirSync(out, { recursive: true });
    const steps = parseSteps(readFileSync(file!, "utf8"));
    const timeline: string[] = [];
    const ops: string[] = [];
    const every = Number(process.env.WEEN_EXPLORE_SHOTS ?? 0);
    const r = await play(steps, {
      textOf,
      tail: Number(process.env.WEEN_EXPLORE_TAIL ?? 0),
      probe: (n, game, _idle, stack) => {
        if (n === 1 && process.env.WEEN_EXPLORE_OPS) {
          const before = game.hooks.beforeOpcode;
          game.hooks.beforeOpcode = (g, ins) => {
            before?.(g, ins);
            ops.push(`${g.curTotFile}@${ins.pos} ${ins.name}`);
            if (ops.length > 400) ops.splice(0, 200);
          };
        }
        const cur = game.sys.cursor as unknown as { cursorIndex: number; cursorAnim: number };
        timeline.push(`${stack || "0"} ${game.vars.readVar32(63) | 0} c${cur.cursorIndex}/${cur.cursorAnim}`);
        if (every && n % every === 0) writeScreen(`${out}/s-${String(n).padStart(6, "0")}.png`, game);
      },
    });
    const zones = activeZones(r.game);
    writeScreen(`${out}/screen.png`, r.game, zones);
    writeScreen(`${out}/plain.png`, r.game);
    writeFileSync(`${out}/ops.txt`, `${ops.join("\n")}\n`);
    writeFileSync(`${out}/zones.txt`, `${formatZones(zones)}\n`);
    writeFileSync(`${out}/inputs.txt`, benchInputFile(r.inputs));
    {
      // chaînes des variables (≥ 4 caractères imprimables)
      const b = r.game.inter.variables!.bytes;
      const found: string[] = [];
      let start = -1;
      for (let i = 0; i <= b.length; i++) {
        const ok = i < b.length && b[i] >= 32 && b[i] < 127;
        if (ok && start < 0) start = i;
        if (!ok && start >= 0) {
          if (i - start >= 4) found.push(`${start} (var ${start >> 2}) ${String.fromCharCode(...b.subarray(start, i))}`);
          start = -1;
        }
      }
      writeFileSync(`${out}/strings.txt`, `${found.join("\n")}\n`);
    }
    writeFileSync(`${out}/vars.bin`, r.game.inter.variables!.bytes);
    const runs: string[] = [];
    let from = 0;
    for (let i = 1; i <= timeline.length; i++)
      if (i === timeline.length || timeline[i] !== timeline[from]) {
        runs.push(`${from + 1}-${i} ${timeline[from]}`);
        from = i;
      }
    writeFileSync(`${out}/timeline.txt`, `${runs.join("\n")}\n`);
    writeFileSync(
      `${out}/report.txt`,
      [
        `stuck: ${r.stuck}`,
        `images: ${r.host.images} tot: ${r.game.curTotFile}`,
        `inventaire: ${inventory(r.game).filter(Boolean).join(", ")}`,
        ...r.tots.map(([n, t]) => `TT ${n} ${t}`),
        ...r.texts
          .map((t) => [t, t.text ?? textOf(t.tot, t.id)] as const)
          .filter(([, s]) => s.trim())
          .map(([t, s]) => `TX ${t.image} ${t.tot}#${t.id}${t.hover ? "h" : ""} ${s}`),
        ...r.checkpoints.map((c) => `CP ${c.image} ${c.tot} ${c.vh.toString(16)} ${c.label}`),
      ].join("\n") + "\n",
    );
    if (process.env.WEEN_EXPLORE_SURVEY && !r.stuck) {
      // second passage : survol de chaque zone visible, nom affiché relevé
      const visible = zones.filter((z) => z.type === 1 && z.left < 320 && z.right - z.left < 300);
      const survey: Step[] = visible.map((z) => ({ label: `#${z.index}`, do: [{ move: center(z) }, { wait: 6 }] }));
      const r2 = await play([...steps, ...survey]);
      const lines: string[] = [];
      for (const z of visible) {
        const i = r2.checkpoints.findIndex((c) => c.label === `#${z.index}`);
        const from = r2.checkpoints[i - 1]?.image ?? 0;
        const to = r2.checkpoints[i]?.image ?? 0;
        const shown = r2.texts
          .filter((t) => t.image > from && t.image <= to)
          .map((t) => t.text ?? textOf(t.tot, t.id))
          .filter((t) => t.trim());
        const [cx, cy] = center(z);
        lines.push(`#${z.index} ${cx},${cy} [${z.left},${z.top}-${z.right},${z.bottom}] ${shown.join(" | ")}`);
      }
      writeFileSync(`${out}/survey.txt`, `${lines.join("\n")}\n`);
    }
  }, 600_000);
});
