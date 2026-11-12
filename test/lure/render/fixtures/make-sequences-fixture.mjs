// Fabrique `scummvm-lure-sequences.json` à partir des captures du banc ScummVM de la chute et du tonneau (indices `.idx`, une capture toutes
// les 250 ms ; scénarios `l-chute.txt` et `l-barrel.txt` : `console enter 11`, `setfield 76 1` ou `2`, clic sur la sortie du bas) :
//   node make-sequences-fixture.mjs DOSSIER_CHUTE DOSSIER_TONNEAU > scummvm-lure-sequences.json
// Hors dépôt : le banc, construit à partir de ScummVM (GPL v3+) ; seules les empreintes MD5 des images distinctes sont gardées, à partir de la
// 10e capture (après l'extinction de la pièce, dont l'image dépend de la marche de Diermot), sans la première image distincte (la pièce
// encore à l'écran) ni la dernière (la pièce suivante).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [chute, barrel] = process.argv.slice(2);
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex").slice(0, 12);
const distinct = (dir) => {
  const log = readFileSync(`${dir}/scummvm.log`, "utf8");
  const names = [...log.matchAll(/bench: t=\d+ shot (\S+)$/gm)].map((m) => m[1]).slice(9);
  const out = [];
  for (const name of names) {
    const hash = md5(readFileSync(`${dir}/${name}.idx`));
    if (out.length === 0 || out[out.length - 1] !== hash) out.push(hash);
  }
  return out.slice(1, -1);
};
console.log(JSON.stringify({ chute: distinct(chute), barrel: distinct(barrel) }));
