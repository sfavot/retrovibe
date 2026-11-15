// Génère original/voyageurs/COVER.png : un décor de la première scène (l'échafaudage, après les messages de l'introduction), 320x200
// pixels exacts, tel que le moteur le compose (palette du décor, sans curseur). La page l'agrandit sans lissage, puis régénère files.json
// (COVER.png est servi). Les clics qui passent les messages de l'introduction sont ceux de `test/voyageurs/fixtures/intro-first-scene.inputs`.
// Usage : npx vite-node scripts/voyageurs-cover.mts [tick]   (défaut : tick 446, juste après le dernier message de l'introduction)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readFont } from "../src/games/voyageurs/data/font";
import { VoyageursEngine } from "../src/games/voyageurs/engine/game";
import { TestHost } from "../src/games/voyageurs/engine/host";
import { FwRenderer } from "../src/games/voyageurs/render/renderer";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "original/voyageurs");
const stopTick = Number(process.argv[2] ?? 446);

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(dir, name)));
const readOptional = (name: string): Uint8Array | null => {
  try {
    return read(name);
  } catch {
    return null;
  }
};
const host = new TestHost({ read: readOptional });

// Clics (`tick c x y`) : un par message de l'introduction.
const clicks = readFileSync(resolve(root, "test/voyageurs/fixtures/intro-first-scene.inputs"), "utf8")
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter((p) => p[1] === "c")
  .map((p) => ({ tick: Number(p[0]), x: Number(p[2]), y: Number(p[3]) }));

const renderer = new FwRenderer(readFont(read("TEXTE.DAT")));
// Comme le banc : un clic arrive au début du tick, ou pendant l'attente d'un message (`onModalPoll`).
const deliver = (engine: VoyageursEngine): void => {
  const click = clicks[0];
  if (!click || click.tick > engine.ticks + 1 || click.tick > stopTick) return;
  clicks.shift();
  const { x, y } = click;
  engine.input({ type: "move", x, y }, { type: "down", button: "left", x, y }, { type: "up", button: "left", x, y });
};
const engine: VoyageursEngine = new VoyageursEngine({ host, renderer, onModalPoll: () => deliver(engine) });
for (let guard = 0; engine.ticks < stopTick && guard < stopTick * 400; guard++) {
  if (engine.betweenTicks) deliver(engine);
  engine.step();
}

const png = encodePng(320, 200, { indexed: renderer.backBuffer, palette: renderer.screenRgb() });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/voyageurs/COVER.png (320x200, tick ${engine.ticks}, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister.
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
