// Génère original/bass/COVER.png : le premier décor du jeu (la passerelle de l'usine, écran 0), 320x200 pixels exacts, tel que le moteur le
// compose (palette de la pièce, personnages à leur place, sans curseur). La page l'agrandit sans lissage, puis régénère files.json
// (COVER.png est servi). Usage : npx vite-node scripts/bass-cover.mts [tours]   (défaut : 60 tours de jeu après le départ)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBassEngine } from "../src/games/bass/create";
import { SkyCpt } from "../src/games/bass/data/cpt";
import { SkyDisk } from "../src/games/bass/data/disk";
import { TestHost } from "../src/games/bass/engine/host";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "original/bass");
const cycles = Number(process.argv[2] ?? 60);

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(dir, name)));
const data = { disk: new SkyDisk(read("sky.dnr"), read("sky.dsk")), cpt: new SkyCpt(read("sky.cpt")) };

// Le jeu commence tout de suite dans la première pièce, sans l'introduction (`startAfterIntro`, comme un saut de l'introduction) ;
// le curseur est laissé à l'hôte (jamais dans `renderer.frame`).
const { engine, renderer } = createBassEngine(data, new TestHost(), { render: true, seed: 1 });
engine.startAfterIntro();
engine.runCycles(cycles);

const { frame } = renderer!;
const png = encodePng(320, 200, { indexed: frame.pixels, palette: frame.palette });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/bass/COVER.png (320x200, ${cycles} tours, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister (puis `scripts/bass-extract.sh` régénère aussi `docs/bass/files.md`).
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
