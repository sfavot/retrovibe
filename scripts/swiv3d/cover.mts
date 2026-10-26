// Génère original/swiv3d/COVER.png : l'écran 1003 de GLOBAL.BD (titre SWIV 3D avec les logos SCi et Interplay), 320x400 pixels non
// carrés dans le jeu (affichés en 4:3), ici agrandi au plus proche voisin en 640x480.
// Usage : npx vite-node scripts/swiv3d/cover.mts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import { parseGlobal, SCREEN_HEIGHT, SCREEN_WIDTH } from "../../src/games/swiv3d/data/global";
import { encodePng } from "../lib/png.mts";

const dir = resolve(import.meta.dirname, "../../original/swiv3d");
const WIDTH = 640;
const HEIGHT = 480;

const screen = parseGlobal(parseBd(readFileSync(resolve(dir, "GLOBAL.BD")), "GLOBAL.BD")).screen(1003);
const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y++) {
  const sy = Math.floor((y * SCREEN_HEIGHT) / HEIGHT);
  for (let x = 0; x < WIDTH; x++) {
    const index = screen.pixels[sy * SCREEN_WIDTH + Math.floor((x * SCREEN_WIDTH) / WIDTH)]! * 3;
    rgb.set(screen.palette.subarray(index, index + 3), (y * WIDTH + x) * 3);
  }
}
const png = encodePng(WIDTH, HEIGHT, { rgb });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/swiv3d/COVER.png (${WIDTH}x${HEIGHT}, ${png.length} octets)`);
