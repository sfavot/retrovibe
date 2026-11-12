// Génère original/lure/COVER.png : une rue du village, 320x200 pixels exacts, telle que le moteur la compose (palette de la pièce,
// villageois à leur place, sans curseur ni barre de menus). La page l'agrandit sans lissage, puis régénère files.json (COVER.png est servi).
// Usage : npx vite-node scripts/lure-cover.mts [pièce]   (défaut : pièce 10, une rue du village de Turnvale)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryStorage } from "../src/engine/storage";
import { DAT_FILE_NAME, DISK_FILE_NAMES } from "../src/games/lure/data/container";
import { loadLureData } from "../src/games/lure/data/lure-data";
import { TICK_MS } from "../src/games/lure/engine/cadence";
import { LureEngine } from "../src/games/lure/engine/game";
import type { LureHost, LureInput } from "../src/games/lure/engine/host";
import { Field, HotspotId } from "../src/games/lure/engine/ids";
import { LureRenderer } from "../src/games/lure/render/renderer";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "original/lure");
const room = Number(process.argv[2] ?? 10);

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(dir, name)));
const data = loadLureData({ disks: DISK_FILE_NAMES.map(read) as unknown as [Uint8Array, Uint8Array, Uint8Array, Uint8Array], dat: read(DAT_FILE_NAME) });

class CoverHost implements LureHost {
  readonly storage = new MemoryStorage();
  clock = 0;
  now = (): number => this.clock;
  exit(): void {}
  pollInput(): readonly LureInput[] {
    return [];
  }
}

const host = new CoverHost();
// Le jeu commence tout de suite dans la pièce, sans l'introduction ; le curseur est laissé à l'hôte (`cursor: false`).
const engine = new LureEngine({ data, host, seed: 1 });
const renderer = new LureRenderer(data, { cursor: false });
engine.tick();
engine.world.fields.set(Field.NEW_ROOM_NUMBER, room);
engine.world.requireActiveHotspot(HotspotId.PLAYER).roomNumber = room;

// Le fondu de la pièce suspend le moteur (comme l'hôte du navigateur) ; on le laisse finir, puis la pièce vit quelques secondes.
const frame = (): void => {
  host.clock += TICK_MS;
  if (!renderer.fading) engine.tick();
  renderer.render(engine, TICK_MS);
};
for (let i = 0; i < 400 && (i < 5 || renderer.fading); i++) frame();
for (let i = 0; i < 60; i++) frame();

const png = encodePng(320, 200, { indexed: renderer.output, palette: renderer.palette });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/lure/COVER.png (320x200, pièce ${room}, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister (puis `scripts/lure-extract.sh` régénère aussi `docs/lure/files.md`).
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
