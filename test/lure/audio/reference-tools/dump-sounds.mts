// Écrit les 78 sons du jeu (SMF normalisés par `data/sound.ts`) dans un dossier, `<section>-<rang>.mid`, pour le harnais de référence.
// Usage : node test/lure/audio/reference-tools/dump-sounds.mts <dossier de sortie>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const racine = resolve(import.meta.dirname, "../../../..");
const sortie = resolve(process.argv[2] ?? "lure-sons");
const server = await createServer({ root: racine, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
  const { LureResources, DAT_FILE_NAME, DISK_FILE_NAMES } = await server.ssrLoadModule("/src/games/lure/data/container.ts");
  const { readSoundSections } = await server.ssrLoadModule("/src/games/lure/data/sound.ts");
  const lire = (nom: string) => new Uint8Array(readFileSync(resolve(racine, "original/lure", nom)));
  const sections = readSoundSections(new LureResources({ disks: DISK_FILE_NAMES.map(lire), dat: lire(DAT_FILE_NAME) }));
  mkdirSync(sortie, { recursive: true });
  for (const [nom, section] of Object.entries(sections) as [string, { sounds: { index: number; smf: Uint8Array }[] }][]) {
    for (const son of section.sounds) writeFileSync(resolve(sortie, `${nom}-${son.index}.mid`), son.smf);
  }
} finally {
  await server.close();
}
