// Génère original/armaeth/COVER.png : la scène 20 d'Armaeth (A1F00E, distribution aux quatre portraits), 320x200 pixels
// exacts, telle que le moteur la compose (palette d'AM1.EXE). La page l'agrandit sans lissage.
// Usage : npx vite-node scripts/armaeth-cover.mts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDefaultPalette, readRecolorTables } from "../src/games/armaeth/data/palette";
import { readScene, SCENE_SCREEN_HEIGHT, SCENE_SCREEN_WIDTH } from "../src/games/armaeth/data/scene";
import { readSceneArchive } from "../src/games/armaeth/data/vga-archive";
import { Compositor } from "../src/games/armaeth/render/compositor";
import { vga6ToRgb8 } from "../src/ui/indexed-canvas";
import { encodePng } from "./lib/png.mts";

const dir = resolve(import.meta.dirname, "../original/armaeth");
const SCENE_ID = 20;

const exe = readFileSync(resolve(dir, "AM1.EXE"));
const archive = readSceneArchive(readFileSync(resolve(dir, "A1F00E.VGA")));
const scene = readScene(archive.bytes(SCENE_ID), { recolorType1: readRecolorTables(exe).type1 });

const compositor = new Compositor();
compositor.drawScene(scene);

const png = encodePng(SCENE_SCREEN_WIDTH, SCENE_SCREEN_HEIGHT, {
  indexed: compositor.page.pixels,
  palette: vga6ToRgb8(readDefaultPalette(exe)),
});
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/armaeth/COVER.png (${SCENE_SCREEN_WIDTH}x${SCENE_SCREEN_HEIGHT}, ${png.length} octets)`);
