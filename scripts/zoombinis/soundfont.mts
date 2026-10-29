// Produit la soundfont réduite de Zoombinis : `original/zoombinis/zoombinis-gm.sf2` (+ sa licence).
// Usage : npx vite-node scripts/zoombinis/soundfont.mts [GeneralUser-GS.sf2]
//   (défaut : archives/mathemagique/soundfont/GeneralUser-GS.sf2, non versionné, avec LICENSE.txt à côté : même source que Mathémagique)
// Lit les 18 `tMID` de `original/zoombinis/MIDIMPC.MHK`, puis confie la réduction à `scripts/lib/soundfont.mts` (inventaire des
// timbres, réduction par spessasynth_core, écriture du SF2 et de la licence en `zoombinis-gm-LICENSE.txt`). Régénère ensuite
// `original/zoombinis/files.json`. Le script d'extraction du CD conserve ces deux fichiers.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMidi } from "../../src/data/mohawk/midi";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import { TAG_TMID } from "../../src/games/zoombinis/data/archives";
import { reduireSoundfont } from "../lib/soundfont.mts";

const racine = resolve(import.meta.dirname, "../..");
const sortie = resolve(racine, "original/zoombinis");
const source = resolve(process.argv[2] ?? resolve(racine, "archives/mathemagique/soundfont/GeneralUser-GS.sf2"));

const archive = MohawkArchive.parse(readFileSync(resolve(sortie, "MIDIMPC.MHK")));
const midis = archive.ids(TAG_TMID).map((id) => parseMidi(archive.get(TAG_TMID, id)).smf);
console.log(`${midis.length} MIDI`);

reduireSoundfont({ midis, source, sortie, nom: "zoombinis-gm" });

spawnSync("python3", ["-I", resolve(racine, "scripts/manifest.py"), sortie], { stdio: "inherit" });
