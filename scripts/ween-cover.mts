// Génère original/ween/COVER.png : un écran du jeu (par défaut, la pièce EMAJ1000 après l'introduction), 320x200 pixels exacts,
// tel que le moteur le compose (palette du moment, sans curseur). La page l'agrandit sans lissage, puis régénère files.json
// (COVER.png est servi). L'écran est relevé comme le banc de test (`test/ween/render/capture.ts`) ; l'introduction se passe d'Échap
// ici : on la laisse jouer jusqu'à l'image voulue.
// Usage : npx vite-node scripts/ween-cover.mts [image] [--esc]   (défaut : image 7790, introduction regardée)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { captureFrames } from "../test/ween/render/capture";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "original/ween");
const args = process.argv.slice(2);
const image = Number(args.find((a) => !a.startsWith("--")) ?? 7790);
const inputs = args.includes("--esc") ? [{ image: 20, key: "ESC" as const }] : [];

const shot = (await captureFrames([image], inputs, image)).get(image);
if (!shot) throw new Error(`image ${image} non relevée`);
// Palette matérielle 6 bits -> 8 bits.
const rgb = new Uint8Array(768);
for (let i = 0; i < 768; i++) rgb[i] = (shot.palette6[i]! << 2) | (shot.palette6[i]! >> 4);
const png = encodePng(shot.width, shot.height, { indexed: shot.indices, palette: rgb });
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/ween/COVER.png (${shot.width}x${shot.height}, image ${image}, ${png.length} octets)`);

execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
