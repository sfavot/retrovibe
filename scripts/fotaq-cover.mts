// Génère original/fotaq/COVER.png : une pièce du jeu, 320x200 pixels exacts, telle que le moteur la compose (palette de la pièce, Joe à
// sa place, panneau de commande, sans curseur). La page l'agrandit sans lissage, puis régénère files.json (COVER.png est servi).
// Usage : npx vite-node scripts/fotaq-cover.mts [pièce]   (défaut : pièce 1, la jungle où commence l'aventure)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryStorage } from "../src/engine/storage";
import { GameFiles } from "../src/games/fotaq/data/files";
import type { FotaqHost, FotaqInput } from "../src/games/fotaq/engine/host";
import { FotaqEngine } from "../src/games/fotaq/engine/loop";
import { fotaqScript } from "../src/games/fotaq/engine/specials";
import { GameStage } from "../src/games/fotaq/engine/stage";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "original/fotaq");
const room = Number(process.argv[2] ?? 1);

const files = new GameFiles(JSON.parse(readFileSync(resolve(dir, "files.json"), "utf8")));

class CoverHost implements FotaqHost {
  readonly storage = new MemoryStorage();
  clock = 0;
  pixels = new Uint8Array(320 * 200);
  palette = new Uint8Array(768);
  readFile(name: string): Uint8Array {
    const path = files.resolve(name);
    if (path === undefined) throw new Error(`fichier absent : ${name}`);
    return new Uint8Array(readFileSync(resolve(dir, path)));
  }
  fileExists = (name: string): boolean => files.has(name);
  now = (): number => this.clock;
  exit(): void {}
  pollInput(): readonly FotaqInput[] {
    return [];
  }
  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.pixels.set(pixels);
    this.palette.set(palette);
  }
  playSong(): void {}
}

const host = new CoverHost();
// Curseur laissé à l'hôte (`cursor: false`) : l'image n'en porte pas. Le jeu commence tout de suite dans la pièce, sans l'introduction.
const stage = new GameStage({ render: { cursor: false } });
const engine = new FotaqEngine(host, { room, stage, seed: 1, script: fotaqScript });
const tick = (count: number): void => {
  for (let i = 0; i < count; i++) {
    host.clock += 100;
    engine.tick();
  }
};
for (let i = 0; i < 2_000 && (engine.busy || engine.state.newRoom !== 0 || i < 5); i++) tick(1);
tick(20);
engine.render();

const png = encodePng(320, 200, { indexed: host.pixels, palette: host.palette });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/fotaq/COVER.png (320x200, pièce ${room}, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister.
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
