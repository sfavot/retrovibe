// Génère original/drascula/COVER.png : une pièce du jeu, 320x200 pixels exacts, telle que le moteur la compose (palette de la pièce,
// héros à sa place, sans curseur ni barre des verbes). La page l'agrandit sans lissage, puis régénère files.json (COVER.png est servi).
// Usage : npx vite-node scripts/drascula-cover.mts [chapitre pièce]   (défaut : chapitre 1, pièce 62, l'auberge de Transylvanie)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameFiles } from "../src/games/drascula/data/files";
import type { DrasculaHost, DrasculaInput } from "../src/games/drascula/engine/host";
import { DrasculaEngine } from "../src/games/drascula/engine/loop";
import { drasculaScript } from "../src/games/drascula/engine/rooms";
import { MemoryStorage } from "../src/engine/storage";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "original/drascula");
const [chapterArg, roomArg] = process.argv.slice(2);
const chapter = Number(chapterArg ?? 1);
const room = Number(roomArg ?? 62);

const files = new GameFiles(JSON.parse(readFileSync(resolve(dir, "files.json"), "utf8")));

class CoverHost implements DrasculaHost {
  readonly storage = new MemoryStorage();
  clock = 0;
  pixels = new Uint8Array(320 * 200);
  palette = new Uint8Array(768);
  readFile(name: string): Uint8Array {
    const path = files.resolve(name);
    if (path === undefined) throw new Error(`fichier absent : ${name}`);
    return new Uint8Array(readFileSync(resolve(dir, path)));
  }
  now = () => this.clock;
  exit(): void {}
  pollInput(): readonly DrasculaInput[] {
    return [];
  }
  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.pixels.set(pixels);
    this.palette.set(palette);
  }
  playSound = () => false;
  stopSound(): void {}
  soundActive = () => false;
  playMusic(): void {}
  stopMusic(): void {}
  musicPlaying = () => true;
}

const host = new CoverHost();
// Sans les cinématiques communes (introduction, château) : le jeu commence tout de suite dans la pièce.
const engine = new DrasculaEngine(host, { chapter, seed: 1, script: { ...drasculaScript, animations: {} } });
const tick = (count: number): void => {
  for (let i = 0; i < count; i++) {
    host.clock += 10;
    engine.tick();
  }
};
tick(5);
for (let i = 0; i < 20_000 && engine.busy; i++) tick(1);
engine.run(engine.enterRoom(room));
for (let i = 0; i < 20_000 && engine.busy; i++) tick(1);
tick(200);
engine.cursorVisible = false;
engine.mouseY = 199;
engine.state.menuBar = false;
engine.render();

const png = encodePng(320, 200, { indexed: host.pixels, palette: host.palette });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/drascula/COVER.png (320x200, chapitre ${chapter}, pièce ${room}, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister.
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
