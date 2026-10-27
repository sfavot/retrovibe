// Produit la soundfont réduite de Math Workshop : `original/mathemagique/mathemagique-gm.sf2` (+ sa licence).
// Usage : npx vite-node scripts/mathemagique/soundfont.mts [GeneralUser-GS.sf2]
//   (défaut : archives/mathemagique/soundfont/GeneralUser-GS.sf2, non versionné, avec LICENSE.txt à côté)
// Lit les 66 MIDI de tous les `original/mathemagique/*.DAT` (ressources `\0SND` de type MIDI), puis confie la réduction
// à `scripts/lib/soundfont.mts` (inventaire des timbres, réduction par spessasynth_core, écriture du SF2 et de la licence
// en `mathemagique-gm-LICENSE.txt`). Régénère ensuite `original/mathemagique/files.json`. Le script d'extraction du CD
// conserve ces deux fichiers.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractMidi, isMidi } from "../../src/data/mohawk/midi";
import { MohawkArchive, TAG_SND } from "../../src/data/mohawk/mohawk";
import { reduireSoundfont } from "../lib/soundfont.mts";

const racine = resolve(import.meta.dirname, "../..");
const sortie = resolve(racine, "original/mathemagique");
const source = resolve(process.argv[2] ?? resolve(racine, "archives/mathemagique/soundfont/GeneralUser-GS.sf2"));

const midis: Uint8Array[] = [];
for (const fichier of readdirSync(sortie).filter((f) => /\.DAT$/i.test(f)).sort()) {
  const archive = MohawkArchive.parse(readFileSync(resolve(sortie, fichier)));
  for (const id of archive.ids(TAG_SND)) {
    const octets = archive.get(TAG_SND, id);
    if (isMidi(octets)) midis.push(extractMidi(octets));
  }
}
console.log(`${midis.length} MIDI`);

reduireSoundfont({ midis, source, sortie, nom: "mathemagique-gm" });

spawnSync("python3", ["-I", resolve(racine, "scripts/manifest.py"), sortie], { stdio: "inherit" });
