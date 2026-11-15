// compare.mjs DIR [FIXTURE] : compare port-vh/port-tt au banc (vh.txt, tt.txt) ; si identiques, écrit la fixture.
// (outil de test/ween/solution/bench/ref.sh)
import { readFileSync, writeFileSync } from "node:fs";
const [dir, fixture] = process.argv.slice(2);
const lines = (f) => readFileSync(`${dir}/${f}`, "utf8").trim().split("\n");
const port = new Map(lines("port-vh.txt").map((l) => l.split(" ")));
const bench = new Map(lines("vh.txt").map((l) => l.split(" ")));
let first = null, n = 0;
for (const [k, v] of bench) { if (!port.has(k)) continue; n++; if (port.get(k) !== v && first === null) first = k; }
const ptt = lines("port-tt.txt").map((l) => l.toUpperCase());
const btt = lines("tt.txt").filter((l) => l.startsWith("TT ")).map((l) => l.slice(3).toUpperCase());
const ttSame = JSON.stringify(ptt) === JSON.stringify(btt.slice(0, ptt.length));
console.log(`images comparées ${n}, première divergence VH : ${first}, TT identiques : ${ttSame} (${ptt.length}/${btt.length})`);
if (!ttSame) for (let i = 0; i < ptt.length; i++) if (ptt[i] !== btt[i]) { console.log(`TT ${i}: port ${ptt[i]} banc ${btt[i]}`); break; }
if (fixture && first === null && ttSame) {
  const cps = JSON.parse(readFileSync(`${dir}/checkpoints.json`, "utf8"));
  const bad = cps.filter(([img, h]) => bench.get(String(img)) !== h);
  if (bad.length) { console.log("points de contrôle différents", bad.slice(0, 3)); process.exit(1); }
  const ref = {
    source: `banc ScummVM (GOB_INPUT = inputs, VH recalculé des vidages GOB_DUMP, date masquée), identique image par image sur ${n} images`,
    inputs: readFileSync(`${dir}/inputs.txt`, "utf8"),
    tots: ptt.map((l) => { const [i, t] = l.split(" "); return [Number(i), t]; }),
    checkpoints: cps,
  };
  writeFileSync(fixture, `${JSON.stringify(ref, null, 0)}\n`);
  console.log(`fixture écrite (${cps.length} points)`);
}
