import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

// Application web installable (écran d'accueil de l'iPhone / Android) : le manifeste et ses icônes vivent dans `src/ui/pwa/`.
// Vite hache les ressources référencées par le HTML mais ne lit pas le contenu d'un manifeste : les `icons[].src` relatifs du
// manifeste doivent donc retrouver les icônes à côté de lui, sous des noms stables. Ce plugin les sert en développement et les
// émet à la racine de `dist/` (`manifest.webmanifest`, `icons/*.png`) ; `index.html` les référence en relatif (sous-dossier OK).
// `publicDir` (`original/`) est réservé aux données des jeux : on n'y mélange pas les ressources du site.
const PWA_DIR = join(import.meta.dirname, "src/ui/pwa");
const PWA_FILES: Record<string, string> = {
  "manifest.webmanifest": "manifest.webmanifest",
  "icons/apple-touch-icon.png": "apple-touch-icon.png",
  "icons/icon-192.png": "icon-192.png",
  "icons/icon-512.png": "icon-512.png",
  "icons/icon-maskable-512.png": "icon-maskable-512.png",
};
const MIME: Record<string, string> = { ".webmanifest": "application/manifest+json", ".png": "image/png" };

function sitePwa(): Plugin {
  return {
    name: "retrovibe-pwa",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = decodeURIComponent((req.url ?? "").split("?")[0]!).replace(/^\/+/, "");
        const file = PWA_FILES[name];
        if (!file) return next();
        res.setHeader("Content-Type", MIME[extname(file)]!);
        res.end(readFileSync(join(PWA_DIR, file)));
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(PWA_FILES)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(join(PWA_DIR, file)) });
      }
    },
  };
}

// Les fichiers du jeu original (DESKTOP.DAW, DESKADV.EXE, sons) ne font pas partie du code :
// ils sont servis tels quels depuis `original/<jeu>/` et décodés dans le navigateur.
// Chemins relatifs : le site fonctionne sous n'importe quel sous-dossier (GitHub Pages, `user.github.io/<repo>/`).
// Le routage par hash évite toute dépendance au chemin d'URL.
export default defineConfig({
  base: "./",
  publicDir: "original",
  plugins: [sitePwa()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
