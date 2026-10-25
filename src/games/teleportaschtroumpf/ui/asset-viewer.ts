/**
 * Visionneuse de ressources du Téléportaschtroumpf : outil de développement, hors du build du site.
 * Page : `/src/games/teleportaschtroumpf/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu
 * viennent de `original/teleportaschtroumpf/` (servi en `/teleportaschtroumpf/`), listés par `files.json`.
 * La mécanique (barre latérale, sélection, chargement) est dans `src/ui/asset-viewer/` ; ici : les groupes par scène et les panneaux.
 */
import { fetchBytes } from "../../../ui/files";
import { h } from "../../../ui/asset-viewer/helpers";
import { mountAssetViewer } from "../../../ui/asset-viewer/viewer";
import { fetchGameFiles, type GameFiles } from "../data/files";
import { parseDescription } from "../data/text";
import { PANELS } from "./panels";

const BASE = "/teleportaschtroumpf";
const root = document.getElementById("app")!;

/** Nom de chaque scène (`descript.ion`), clé en minuscules ; facultatif. */
async function loadSceneNames(files: GameFiles): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const description = files.resolve("descript.ion");
    if (description) for (const scene of parseDescription(await fetchBytes(BASE, description))) names.set(scene.id.toLowerCase(), scene.name);
  } catch {
    /* noms de scène facultatifs */
  }
  return names;
}

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  let files: GameFiles;
  try {
    files = await fetchGameFiles(BASE);
  } catch (error) {
    root.replaceChildren(
      h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`),
      h("p", { class: "empty" }, "Lancer scripts/teleportaschtroumpf-extract.sh puis python3 -I scripts/teleportaschtroumpf/manifest.py original/teleportaschtroumpf"),
    );
    return;
  }
  const sceneNames = await loadSceneNames(files);
  const labelOf = new Map(files.scenes().map((scene) => [`${scene.path}/`, `${scene.id}${sceneNames.has(scene.id) ? ` ${sceneNames.get(scene.id)}` : ""}`]));
  mountAssetViewer({
    root,
    title: "Téléportaschtroumpf — ressources",
    files,
    base: BASE,
    groups: (entry) => {
      for (const [prefix, label] of labelOf) if (entry.path.startsWith(prefix)) return label;
      return "Racine";
    },
    panels: PANELS,
  });
}

void start();
