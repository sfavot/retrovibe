// Écrit les empreintes de référence d'un scénario du banc ScummVM dans test/ween/fixtures/frames.json.
// Usage : npx vite-node test/ween/render/make-frames.mts <scénario> <dossier des captures GOB_SHOT_*>
// (`fr-NNNNN.idx` écran 320x200 en indices, `fr-NNNNN.pal` palette 768 octets 0-255 ; voir docs/ween/graphics.md).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { benchPalette6, frameHash } from "./hash";

const [name, dir] = process.argv.slice(2);
if (!name || !dir) throw new Error("usage : make-frames.mts <scénario> <dossier>");
const file = resolve(import.meta.dirname, "../fixtures/frames.json");
let all: Record<string, Record<string, string>> = {};
try {
  all = JSON.parse(readFileSync(file, "utf8"));
} catch {}
const frames: Record<string, string> = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".idx")).sort()) {
  const n = Number(f.slice(3, 8));
  const indices = new Uint8Array(readFileSync(resolve(dir, f)));
  const palette6 = benchPalette6(new Uint8Array(readFileSync(resolve(dir, f.replace(".idx", ".pal")))));
  frames[n] = frameHash(320, indices, palette6);
}
all[name] = frames;
writeFileSync(file, `${JSON.stringify(all, null, 1)}\n`);
console.log(`${name} : ${Object.keys(frames).length} images`);
