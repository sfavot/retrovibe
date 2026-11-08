/**
 * Visionneuse de ressources de Flight of the Amazon Queen : outil de développement, hors du build du site.
 * Page : `/src/games/fotaq/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu viennent de
 * `original/fotaq/` (servi en `/fotaq/`), listés par `files.json`. La mécanique (barre latérale, sélection,
 * chargement) est dans `src/ui/asset-viewer/` ; ici : les groupes par famille de fichiers et les panneaux.
 *
 * Les libellés sont ceux d'un outil de développement, pas du texte du produit.
 */
import { h } from "../../../ui/asset-viewer/helpers";
import { mountAssetViewer } from "../../../ui/asset-viewer/viewer";
import { fetchGameFiles, type GameFiles } from "../data/files";
import { PANELS } from "./panels";
import { familyOf } from "./viewer-data";

const BASE = "/fotaq";
const root = document.getElementById("app")!;

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  let files: GameFiles;
  try {
    files = await fetchGameFiles(BASE);
  } catch (error) {
    root.replaceChildren(
      h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`),
      h("p", { class: "empty" }, "Lancer scripts/fotaq-extract.sh"),
    );
    return;
  }
  mountAssetViewer({
    root,
    title: "Flight of the Amazon Queen — ressources",
    files,
    base: BASE,
    groups: familyOf(files),
    panels: PANELS,
  });
}

void start();
