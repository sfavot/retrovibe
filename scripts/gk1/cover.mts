// Génère original/gk1/COVER.webp : l'écran titre de Gabriel Knight (pièce 375, décor 100 et ses quatre boutons), 320x200 pixels
// exacts, tel que notre moteur le compose une fois le fondu d'arrivée fini, sans curseur. La page l'agrandit sans lissage.
// L'image passe par un PNG temporaire que `cwebp` (à installer : `brew install webp`) recompresse sans perte, puis files.json est
// régénéré (COVER.webp est servi ; `scripts/gk1-extract.sh` le conserve).
// Usage : npx vite-node scripts/gk1/cover.mts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ResourceIndex } from "../../src/games/gk1/data/resource-map";
import { currentRoom, runFrame, useGameClock } from "../../src/games/gk1/engine/loop";
import { Vm } from "../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../src/games/gk1/render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../src/games/gk1/render/ids";
import { encodePng } from "../lib/png.mts";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "original/gk1");
const TITLE_ROOM = 375;
/** Images laissées au fondu d'arrivée du titre (vingt étapes de trois ticks) et à ses boutons. */
const SETTLE_FRAMES = 240;
/** Garde-fou : le titre arrive vers la 1 000e image. */
const MAX_FRAMES = 5000;

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(dir, name)));
const index = new ResourceIndex();
index.addVolume(read("RESOURCE.MAP"), read("RESOURCE.000"), "RESOURCE.000");
const vm = new Vm(index);
useGameClock(vm);
vm.boot();

let frame = 0;
while (currentRoom(vm) !== TITLE_ROOM) {
  if (++frame > MAX_FRAMES) throw new Error(`Écran titre (pièce ${TITLE_ROOM}) introuvable en ${MAX_FRAMES} images`);
  runFrame(vm);
}
for (let i = 0; i < SETTLE_FRAMES; i++, frame++) runFrame(vm);

// `screen` : l'image composée, sans le curseur ni la secousse que `present` ajoute.
const frameout = frameoutOf(vm);
const png = encodePng(SCREEN_WIDTH, SCREEN_HEIGHT, { indexed: frameout.screen, palette: frameout.palette.screen });
const tmp = mkdtempSync(resolve(tmpdir(), "gk1-cover-"));
try {
  const source = resolve(tmp, "cover.png");
  writeFileSync(source, png);
  execFileSync("cwebp", ["-quiet", "-lossless", "-z", "9", source, "-o", resolve(dir, "COVER.webp")]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`original/gk1/COVER.webp (${SCREEN_WIDTH}x${SCREEN_HEIGHT}, image ${frame}, ${statSync(resolve(dir, "COVER.webp")).size} octets)`);

execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
