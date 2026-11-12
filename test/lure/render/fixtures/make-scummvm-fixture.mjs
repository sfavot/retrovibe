// Fabrique `scummvm-lure.json` à partir des captures du banc ScummVM (indices `.idx` et palette `.pal`, 320 x 200) :
//   node make-scummvm-fixture.mjs DOSSIER_CELLULE DOSSIER_UI > scummvm-lure.json
// DOSSIER_CELLULE : sortie de `bench/run.sh lure-fr bench/scenarios/l-cell.txt` (cell1) ; DOSSIER_UI : celle de `l-ui.txt`
// (popup, info, bar0005 : la barre ouverte). Hors dépôt : le banc, construit à partir de ScummVM (GPL v3+) ; seuls ces échantillons sont gardés.
import { readFileSync } from "node:fs";

const [cell, ui] = process.argv.slice(2);
const idx = (dir, name) => readFileSync(`${dir}/${name}.idx`);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const region = (pixels, x, y, w, h) => {
  const out = [];
  for (let r = 0; r < h; r++) out.push(...pixels.subarray((y + r) * 320 + x, (y + r) * 320 + x + w));
  return Buffer.from(out);
};

const cell1 = idx(cell, "cell1");
// Échantillons tous les 8 pixels ; les zones animées (flamme, point clignotant, Diermot, porte du Skorl) sont écartées par le test.
const samples = [];
for (let y = 0; y < 200; y += 8) for (let x = 0; x < 320; x += 8) samples.push(cell1[y * 320 + x]);
const popup = idx(ui, "popup");
const info = idx(ui, "info");
const bar = idx(ui, "bar0005");
const regions = {
  // Menu surgissant « Regarde / Statut » de ScummVM (mode souris : trois lignes), 80 x 48 en (0, 76).
  popup: { x: 0, y: 76, w: 80, h: 48, data: b64(region(popup, 0, 76, 80, 48)) },
  // Boîte d'information de la cellule, 191 x 110 en (69, 61) (la boîte est un peu plus basse : le test ne compare que ses lignes).
  info: { x: 69, y: 61, w: 191, h: 110, data: b64(region(info, 69, 61, 191, 110)) },
  // Barre de menus : les 8 premières lignes.
  bar: { x: 0, y: 0, w: 320, h: 8, data: b64(region(bar, 0, 0, 320, 8)) },
};
console.log(JSON.stringify({ samplesStep: 8, samples: b64(samples), palette: b64(readFileSync(`${cell}/cell1.pal`)), regions }));
