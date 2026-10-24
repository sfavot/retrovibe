// Produit la soundfont réduite de Math Workshop : `original/mathemagique/mathemagique-gm.sf2` (+ sa licence).
// Usage : npx vite-node scripts/mathemagique/soundfont.mts [GeneralUser-GS.sf2]
//   (défaut : archives/mathemagique/soundfont/GeneralUser-GS.sf2, non versionné, avec LICENSE.txt à côté)
// Étapes :
//  1. lit les 66 MIDI de tous les `original/mathemagique/*.DAT` (ressources `\0SND` de type MIDI) ;
//  2. dresse l'inventaire des timbres réellement joués (banque / programme, kits de batterie et touches : `audio/programs.ts`) ;
//  3. demande à spessasynth_core les presets et touches utilisés de chaque morceau (`BasicMIDI.getUsedProgramsAndKeys`),
//     les fusionne, puis retire de la soundfont tout le reste (`BasicSoundBank.trim`) : presets, instruments et échantillons ;
//  4. écrit le résultat en SF2 (spessasynth_core ne sait pas encoder en Vorbis/SF3 sans encodeur externe, qui n'est pas installé).
// Copie aussi `LICENSE.txt` en `mathemagique-gm-LICENSE.txt` (la licence de GeneralUser GS demande de la conserver)
// et régénère `original/mathemagique/files.json`. Le script d'extraction du CD conserve ces deux fichiers.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BasicMIDI, SoundBankLoader, type BasicPreset, type PresetsWithKeyCombinations } from "spessasynth_core";
import { extractMidi, isMidi } from "../../src/games/mathemagique/data/midi";
import { MohawkArchive, TAG_SND } from "../../src/games/mathemagique/data/mohawk";
import { collectPrograms } from "../../src/games/mathemagique/audio/programs";
import { parseSong } from "../../src/games/mathemagique/audio/smf";

const racine = resolve(import.meta.dirname, "../..");
const sortie = resolve(racine, "original/mathemagique");
const source = resolve(process.argv[2] ?? resolve(racine, "archives/mathemagique/soundfont/GeneralUser-GS.sf2"));
const licence = resolve(dirname(source), "LICENSE.txt");
const NOM = "mathemagique-gm";

if (!existsSync(source)) throw new Error(`Soundfont introuvable : ${source}`);
if (!existsSync(licence)) throw new Error(`Licence introuvable : ${licence}`);

// 1. Les MIDI du jeu.
const midis: { nom: string; smf: Uint8Array }[] = [];
for (const fichier of readdirSync(sortie).filter((f) => /\.DAT$/i.test(f)).sort()) {
  const archive = MohawkArchive.parse(readFileSync(resolve(sortie, fichier)));
  for (const id of archive.ids(TAG_SND)) {
    const octets = archive.get(TAG_SND, id);
    if (isMidi(octets)) midis.push({ nom: `${fichier}:${id}`, smf: extractMidi(octets) });
  }
}
console.log(`${midis.length} MIDI`);

// 2. Inventaire (indépendant de spessasynth) : sert de contrôle.
const usage = collectPrograms(midis.map(({ smf }) => parseSong(smf)));
const melodiques = [...usage.presets.values()].filter((p) => !p.drum);
const batteries = [...usage.presets.values()].filter((p) => p.drum);
const touches = new Set(batteries.flatMap((p) => [...p.keys]));
console.log(
  `${usage.noteOns} Note On, ${usage.pitchBends} pitch bends ; ${melodiques.length} timbres mélodiques, ` +
    `${batteries.length} kit(s) de batterie, ${touches.size} touches de batterie`,
);

// 3. Réduction.
const banque = SoundBankLoader.fromArrayBuffer(toArrayBuffer(readFileSync(source)));
console.log(`Source : ${banque.presets.length} presets, ${banque.instruments.length} instruments, ${banque.samples.length} échantillons`);
const utilises: PresetsWithKeyCombinations = new Map();
for (const { smf } of midis) {
  const morceau = BasicMIDI.fromArrayBuffer(toArrayBuffer(smf));
  for (const [preset, touchesParVelocite] of morceau.getUsedProgramsAndKeys(banque)) {
    const fusion = utilises.get(preset) ?? new Map<number, Set<number>>();
    for (const [touche, velocites] of touchesParVelocite) {
      const ensemble = fusion.get(touche) ?? new Set<number>();
      for (const v of velocites) ensemble.add(v);
      fusion.set(touche, ensemble);
    }
    utilises.set(preset, fusion);
  }
}
const presets: BasicPreset[] = [...utilises.keys()];
// Contrôle croisé : chaque timbre de l'inventaire doit avoir un preset retenu (par numéro de programme).
const programmesRetenus = new Set(presets.filter((p) => !p.isDrum && p.bankMSB === 0).map((p) => p.program));
const manquants = melodiques.filter((p) => p.bank === 0 && !programmesRetenus.has(p.program));
if (manquants.length > 0) console.warn(`Programmes sans preset retenu : ${manquants.map((p) => p.program).join(", ")}`);

banque.trim(utilises);
console.log(`Réduite : ${banque.presets.length} presets, ${banque.instruments.length} instruments, ${banque.samples.length} échantillons`);

const fichierSf2 = resolve(sortie, `${NOM}.sf2`);
const octets = new Uint8Array(banque.writeSF2({ software: "retrovibe (spessasynth_core)" }));
writeFileSync(fichierSf2, octets);
copyFileSync(licence, resolve(sortie, `${NOM}-LICENSE.txt`));
console.log(`${fichierSf2} : ${(octets.length / 1024 / 1024).toFixed(2)} Mo (SF2, échantillons 16 bits)`);

spawnSync("python3", ["-I", resolve(racine, "scripts/manifest.py"), sortie], { stdio: "inherit" });

function toArrayBuffer(octets: Uint8Array): ArrayBuffer {
  return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
}
