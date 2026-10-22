// Génère test/lost-in-time/fixtures/degob-ops.json à partir des sorties de degob
// (un fichier <TOT>.txt par script) : par TOT, la liste triée des `offset:nom` des
// commandes o1_ / o2_ / o3_.
// Usage : node scripts/lost-in-time-degob-fixture.mjs <dossier des .txt de degob>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage : node scripts/lost-in-time-degob-fixture.mjs <dossier degob>");
  process.exit(1);
}

const out = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()) {
  const ops = [];
  for (const line of readFileSync(join(dir, file), "latin1").split("\n")) {
    const m = /^(\d+):\s*(o[123]_\w+)\(/.exec(line);
    if (m) ops.push([Number(m[1]), m[2]]);
  }
  ops.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  out[file.replace(/\.txt$/, "")] = ops.map(([o, n]) => `${o}:${n}`);
}

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../test/lost-in-time/fixtures/degob-ops.json");
writeFileSync(target, JSON.stringify(out) + "\n");
console.log(`${Object.keys(out).length} TOT -> ${target}`);
