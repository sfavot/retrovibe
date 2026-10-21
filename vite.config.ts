import { defineConfig } from "vitest/config";

// Les fichiers du jeu original (DESKTOP.DAW, DESKADV.EXE, sons) ne font pas partie du code :
// ils sont servis tels quels depuis `original/` et décodés dans le navigateur.
// Chemins relatifs : le site fonctionne sous n'importe quel sous-dossier (GitHub Pages, `user.github.io/<repo>/`).
// Le routage par hash évite toute dépendance au chemin d'URL.
export default defineConfig({
  base: "./",
  publicDir: "original",
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
