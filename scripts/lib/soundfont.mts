// Réduction d'une soundfont General MIDI aux timbres réellement joués par les MIDI d'un jeu (Mathémagique, Zoombinis).
// Étapes :
//  1. dresse l'inventaire des timbres joués (banque / programme, kits de batterie et touches : `src/engine/mohawk/audio/programs.ts`) ;
//  2. demande à spessasynth_core les presets et touches utilisés de chaque morceau (`BasicMIDI.getUsedProgramsAndKeys`),
//     les fusionne, puis retire de la soundfont tout le reste (`BasicSoundBank.trim`) : presets, instruments et échantillons ;
//  3. écrit le résultat en SF2 (spessasynth_core ne sait pas encoder en Vorbis/SF3 sans encodeur externe, qui n'est pas installé).
// Copie aussi `LICENSE.txt` (à côté de la source) en `<nom>-LICENSE.txt` : la licence de GeneralUser GS demande de la conserver.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BasicMIDI, SoundBankLoader, type BasicPreset, type PresetsWithKeyCombinations } from "spessasynth_core";
import { collectPrograms } from "../../src/engine/mohawk/audio/programs";
import { parseSong } from "../../src/engine/mohawk/audio/smf";

export interface ReductionSoundfont {
  /** Fichiers MIDI standard (SMF) du jeu. */
  midis: Uint8Array[];
  /** Soundfont complète (`LICENSE.txt` doit se trouver dans le même dossier). */
  source: string;
  /** Dossier de sortie. */
  sortie: string;
  /** Nom de base des fichiers produits : `<nom>.sf2` et `<nom>-LICENSE.txt`. */
  nom: string;
}

/** Écrit `<sortie>/<nom>.sf2` et `<sortie>/<nom>-LICENSE.txt` ; renvoie le chemin du SF2. */
export function reduireSoundfont({ midis, source, sortie, nom }: ReductionSoundfont): string {
  const licence = resolve(dirname(source), "LICENSE.txt");
  if (!existsSync(source)) throw new Error(`Soundfont introuvable : ${source}`);
  if (!existsSync(licence)) throw new Error(`Licence introuvable : ${licence}`);

  // 1. Inventaire (indépendant de spessasynth) : sert de contrôle.
  const usage = collectPrograms(midis.map((smf) => parseSong(smf)));
  const melodiques = [...usage.presets.values()].filter((p) => !p.drum);
  const batteries = [...usage.presets.values()].filter((p) => p.drum);
  const touches = new Set(batteries.flatMap((p) => [...p.keys]));
  console.log(
    `${usage.noteOns} Note On, ${usage.pitchBends} pitch bends ; ${melodiques.length} timbres mélodiques, ` +
      `${batteries.length} kit(s) de batterie, ${touches.size} touches de batterie`,
  );

  // 2. Réduction.
  const banque = SoundBankLoader.fromArrayBuffer(toArrayBuffer(readFileSync(source)));
  console.log(`Source : ${banque.presets.length} presets, ${banque.instruments.length} instruments, ${banque.samples.length} échantillons`);
  const utilises: PresetsWithKeyCombinations = new Map();
  for (const smf of midis) {
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

  // 3. Écriture.
  const fichierSf2 = resolve(sortie, `${nom}.sf2`);
  const octets = new Uint8Array(banque.writeSF2({ software: "retrovibe (spessasynth_core)" }));
  writeFileSync(fichierSf2, octets);
  copyFileSync(licence, resolve(sortie, `${nom}-LICENSE.txt`));
  console.log(`${fichierSf2} : ${(octets.length / 1024 / 1024).toFixed(2)} Mo (SF2, échantillons 16 bits)`);
  return fichierSf2;
}

function toArrayBuffer(octets: Uint8Array): ArrayBuffer {
  return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
}
