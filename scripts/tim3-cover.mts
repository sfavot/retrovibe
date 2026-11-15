// Génère original/tim3/COVER.png : un puzzle des Travaux Pratiques (par défaut TLEV1) tel que le jeu le dessine au pas 0, écran
// complet de 640x480 pixels exacts (barre d'outils, aire de jeu, bac de pièces et but en français), sans curseur. La page l'affiche
// sans lissage, puis régénère files.json (COVER.png est servi). Usage : npx vite-node scripts/tim3-cover.mts [puzzle]   (défaut : TLEV1)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readAnm } from "../src/games/tim3/data/anm";
import { readLev } from "../src/games/tim3/data/lev";
import { readPartDef } from "../src/games/tim3/data/part-def";
import { loadTexts } from "../src/games/tim3/data/text";
import { ResourceIndex } from "../src/games/tim3/data/volume";
import { TypeTable } from "../src/games/tim3/engine/types";
import { World } from "../src/games/tim3/engine/world";
import { GAME_PALETTE, RenderAssets, SCREEN_HEIGHT, SCREEN_WIDTH, composeScreen } from "../src/games/tim3/render";
import { readPalette } from "../src/games/tim3/data/palette";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "original/tim3");
const name = (process.argv[2] ?? "TLEV1").toUpperCase();

const read = (file: string): Uint8Array => new Uint8Array(readFileSync(resolve(dir, file)));

// Ressources anglaises, textes français superposés (FRENCH.DAT) : ce que charge le jeu.
const index = new ResourceIndex().add(read("RESOURCE.MAP"), read).overlay(read("FRENCH.DAT"), "FRENCH.DAT");
const base = new ResourceIndex().add(read("RESOURCE.MAP"), read);
const assets = new RenderAssets(index);

// Le monde se charge sur les ressources de base (comme les tests), le rendu et les textes sur l'index français.
const types = new TypeTable({
  anm: (t) => (base.has(`PART${t}.ANM`) ? readAnm(base.get(`PART${t}.ANM`)) : null),
  par: (t) => (base.has(`PART${t}.PAR`) ? readPartDef(base.get(`PART${t}.PAR`)) : null),
});
const level = readLev(base.get(`${name}.LEV`));
const world = new World(types);
world.loadLevel(level);
world.start();

const texts = loadTexts(index);
const match = /^TLEV(\d+)$/.exec(name);
const goal = match ? texts.levels[Number(match[1]) - 1]?.goal : undefined;

const screen = composeScreen(assets, world, { backgroundColor: level.prefix?.backgroundColor, goal });
const rgba = readPalette(index.get(GAME_PALETTE));
const palette = new Uint8Array(768);
for (let i = 0; i < 256; i++) palette.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
const png = encodePng(SCREEN_WIDTH, SCREEN_HEIGHT, { indexed: screen.pixels, palette });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/tim3/COVER.png (${SCREEN_WIDTH}x${SCREEN_HEIGHT}, ${name}, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister (`scripts/tim3-extract.sh` régénère aussi `docs/tim3/files.md`).
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
