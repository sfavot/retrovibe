// Filtre la sortie du banc : DV -> VH masqué (variables 5 à 11 à zéro), TT/PS/TX/WK recopiés.
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
const out = process.argv[2];
const vh = createWriteStream(`${out}/vh.txt`);
const tt = createWriteStream(`${out}/tt.txt`);
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (line.startsWith("DV ")) {
    const p = line.split(" ");
    const n = p[1];
    let h = 2166136261;
    for (let i = 2; i < p.length; i++) {
      let v = i - 2 >= 5 && i - 2 < 12 ? 0 : Number(p[i]) >>> 0;
      for (let k = 0; k < 4; k++) {
        h = Math.imul(h ^ (v & 255), 16777619) >>> 0;
        v >>>= 8;
      }
    }
    vh.write(`${n} ${h.toString(16).padStart(8, "0")}\n`);
  } else if (/^(TT|PS|TX|WK) /.test(line)) tt.write(`${line}\n`);
}
vh.end();
tt.end();
