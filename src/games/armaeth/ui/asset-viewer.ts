/**
 * Visionneuse de ressources d'Armaeth : outil de développement, hors du build du site.
 * Page : `/src/games/armaeth/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu viennent de
 * `original/armaeth/` (servi en `/armaeth/`), listés par `files.json`. La mécanique (barre latérale, sélection,
 * chargement) est dans `src/ui/asset-viewer/` ; ici : les groupes par famille de fichiers et les panneaux.
 */
import { fetchGameFiles, type GameFiles } from "../../../data/game-files";
import { h } from "../../../ui/asset-viewer/helpers";
import { mountAssetViewer } from "../../../ui/asset-viewer/viewer";
import { PANELS, family } from "./panels";

const BASE = "/armaeth";
const root = document.getElementById("app")!;

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  let files: GameFiles;
  try {
    files = await fetchGameFiles(BASE);
  } catch (error) {
    root.replaceChildren(
      h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`),
      h("p", { class: "empty" }, "Lancer scripts/armaeth-extract.sh"),
    );
    return;
  }
  mountAssetViewer({
    root,
    title: "Armaeth — ressources",
    files,
    base: BASE,
    groups: (entry) => family(entry.path),
    panels: PANELS,
  });
}

void start();
