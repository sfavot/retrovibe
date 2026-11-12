// Fabrique `scummvm-lure-intro.json` à partir des captures du banc ScummVM de l'introduction (indices `.idx` et palette `.pal`, une capture
// toutes les 500 ms) :
//   node make-intro-fixture.mjs DOSSIER_INTRO [T_MAX_MS] > scummvm-lure-intro.json
// DOSSIER_INTRO : sortie de `bench/run.sh lure-fr bench/scenarios/l-intro-full.txt` (ou `l-intro.txt`) ; T_MAX_MS : on ignore les captures après (la
// cellule, qui suit l'introduction, n'en fait pas partie ; 249000 pour `l-intro-full`). Hors dépôt : le banc, construit à partir
// de ScummVM (GPL v3+) ; seules les empreintes MD5 des images distinctes sont gardées : `idx` (320 x 200 indices), `pal` (entrées 0 à 219 de la
// palette, 660 octets : les entrées suivantes gardent au départ des valeurs d'initialisation de ScummVM), `steady` (la palette est la même sur
// la capture précédente et la suivante : pas en plein fondu).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const dir = process.argv[2];
const tMax = Number(process.argv[3] ?? Infinity);
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex").slice(0, 12);
const log = readFileSync(`${dir}/scummvm.log`, "utf8");
const shots = [...log.matchAll(/bench: t=(\d+) shot (\S+)$/gm)].map((m) => ({ t: Number(m[1]), name: m[2] }))
  .filter((s) => s.t > 100 && s.t <= tMax);
const rows = shots.map(({ t, name }) => {
  const idx = readFileSync(`${dir}/${name}.idx`);
  const pal = readFileSync(`${dir}/${name}.pal`);
  return { t, idx: md5(idx), pal: md5(pal.subarray(0, 660)) };
});
const out = [];
rows.forEach((r, i) => {
  const steady = i > 0 && i < rows.length - 1 && rows[i - 1].pal === r.pal && rows[i + 1].pal === r.pal;
  if (out.length && out[out.length - 1].idx === r.idx && out[out.length - 1].pal === r.pal) return;
  out.push({ t: r.t, idx: r.idx, pal: r.pal, steady });
});
console.log(JSON.stringify({ shots: out }));
