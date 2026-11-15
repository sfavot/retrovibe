// Génère original/croisiere/COVER.png : l'écran titre du jeu (« Croisière pour un cadavre », fond CFAC2.PI1), 320x200 pixels exacts,
// tel que le moteur le compose pendant l'introduction (sans curseur). On garde l'image la plus lumineuse tant que ce fond est affiché :
// le titre s'y dessine par étapes, puis le jeu passe au fond suivant. La page l'agrandit sans lissage, puis régénère files.json
// (COVER.png est servi). Usage : npx vite-node scripts/croisiere/cover.mts
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CruiseVolumes } from "../../src/games/croisiere/data/volumes";
import { TestHost } from "../../src/games/croisiere/engine/host";
import { CroisiereEngine } from "../../src/games/croisiere/engine/main-loop";
import { encodePng } from "../lib/png.mts";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "original/croisiere");
const TITLE_BACKGROUND = "CFAC2.PI1";
/** Garde-fou : l'écran titre arrive vers le tour 2 000 (graine 1). */
const MAX_FRAMES = 4000;

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(dir, name)));
const volumes = CruiseVolumes.open(read);
// Fichiers libres lus hors des volumes : police système et chaînes de langue.
const loose = new Map(["SYSTEM.FNT", "DELPHINE.LNG"].map((name) => [name, read(name)]));
const files = { has: (name: string) => loose.has(name) || volumes.has(name), readFile: (name: string) => loose.get(name) ?? volumes.readFile(name) };

const engine = new CroisiereEngine(new TestHost(), { files, seed: 1 });
const { display } = engine.state;

const brightness = (pixels: Uint8Array, palette: Uint8Array): number => {
  let sum = 0;
  for (const index of pixels) sum += palette[index * 3]! + palette[index * 3 + 1]! + palette[index * 3 + 2]!;
  return sum;
};

let best: { pixels: Uint8Array; palette: Uint8Array; light: number; frame: number } | null = null;
for (let frame = 1; frame <= MAX_FRAMES; frame++) {
  engine.runFrame();
  const onTitle = display.backgroundNames[0] === TITLE_BACKGROUND;
  if (!onTitle && best) break;
  if (!onTitle) continue;
  const light = brightness(display.globalScreen, display.hardwarePalette);
  if (!best || light >= best.light) best = { pixels: display.globalScreen.slice(), palette: display.hardwarePalette.slice(), light, frame };
}
if (!best) throw new Error(`Écran titre (${TITLE_BACKGROUND}) introuvable en ${MAX_FRAMES} tours`);

const png = encodePng(320, 200, { indexed: best.pixels, palette: best.palette });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/croisiere/COVER.png (320x200, tour ${best.frame}, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister (`scripts/croisiere-extract.sh` le conserve et le régénère aussi).
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
