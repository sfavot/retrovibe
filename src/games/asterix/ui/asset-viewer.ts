/**
 * Visionneuse de ressources d'Astérix : outil de développement, hors du build du site.
 * Page : `/src/games/asterix/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu viennent de
 * `original/asterix/` (servi en `/asterix/`), listés par `files.json`.
 * La mécanique (barre latérale, sélection, chargement) est dans `src/ui/asset-viewer/` ; ici : les groupes par module et
 * les panneaux.
 */
import { GameFiles, fetchGameFileEntries } from "../../../data/game-files";
import { h } from "../../../ui/asset-viewer/helpers";
import { mountAssetViewer } from "../../../ui/asset-viewer/viewer";
import { PANELS } from "./panels";

const BASE = "/asterix";
const root = document.getElementById("app")!;

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  let files: GameFiles;
  try {
    files = new GameFiles(await fetchGameFileEntries(BASE));
  } catch (error) {
    root.replaceChildren(
      h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`),
      h("p", { class: "empty" }, "Lancer scripts/asterix-extract.sh"),
    );
    return;
  }
  mountAssetViewer({
    root,
    title: "Astérix : le défi de César — ressources",
    files,
    base: BASE,
    groups: (entry) => {
      const module = /^MDF\/(\d\d)\//.exec(entry.path);
      return module ? `Module ${module[1]}` : "Racine";
    },
    panels: PANELS,
  });
}

void start();
