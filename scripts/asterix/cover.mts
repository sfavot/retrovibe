// Génère original/asterix/COVER.webp : la jaquette d'Astérix : le défi de César (la pochette du CD, carrée), prise en
// couverture du manuel d'origine (`original/asterix/MANUEL.pdf`, page 1, image 900 × 883 à 201 ppp), réduite à
// 280 pixels de large comme les jaquettes des autres jeux, puis régénère files.json (COVER.webp est servi ;
// `scripts/asterix-extract.sh` le conserve). Outils : `pdfimages` (poppler), `magick` et `cwebp` (`brew install poppler
// imagemagick webp`).
// Usage : npx vite-node scripts/asterix/cover.mts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "original/asterix");
/** Largeur des jaquettes du site (Ween 280, Drascula 278, Lure 276). */
const WIDTH = 280;

const tmp = mkdtempSync(resolve(tmpdir(), "asterix-cover-"));
try {
  // L'image d'origine de la page, sans rééchantillonnage du rendu PDF.
  execFileSync("pdfimages", ["-f", "1", "-l", "1", "-png", resolve(dir, "MANUEL.pdf"), resolve(tmp, "page")]);
  const [image] = readdirSync(tmp).filter((name) => name.endsWith(".png"));
  if (!image) throw new Error("MANUEL.pdf : aucune image en page 1");
  const source = resolve(tmp, image);
  const resized = resolve(tmp, "cover.png");
  execFileSync("magick", [source, "-filter", "Lanczos", "-resize", `${WIDTH}x`, resized]);
  execFileSync("cwebp", ["-quiet", "-q", "85", "-m", "6", resized, "-o", resolve(dir, "COVER.webp")]);
  const size = execFileSync("magick", ["identify", "-format", "%wx%h", resolve(dir, "COVER.webp")]).toString();
  console.log(`original/asterix/COVER.webp (${size}, ${statSync(resolve(dir, "COVER.webp")).size} octets)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
