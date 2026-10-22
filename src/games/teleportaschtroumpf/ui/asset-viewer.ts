/**
 * Visionneuse de ressources du Téléportaschtroumpf : outil de développement, hors du build du site.
 * Page : `/src/games/teleportaschtroumpf/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu
 * viennent de `original/teleportaschtroumpf/` (servi en `/teleportaschtroumpf/`), listés par `files.json`.
 */
import { extensionOf, fetchGameFiles, type GameFiles } from "../data/files";
import { parseDescription } from "../data/text";
import { panelFor, type PanelContext } from "./panels";
import { formatSize, h } from "./render";

const BASE = "/teleportaschtroumpf";
const sidebar = document.getElementById("sidebar")!;
const main = document.getElementById("main")!;

let audioContext: AudioContext | null = null;
let disposers: (() => void)[] = [];
let loadToken = 0;
let files: GameFiles;
const buttons = new Map<string, HTMLButtonElement>();

function urlOf(path: string): string {
  return `${BASE}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(urlOf(path));
  if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function open(path: string): Promise<void> {
  const token = ++loadToken;
  for (const dispose of disposers) dispose();
  disposers = [];
  for (const [p, button] of buttons) button.setAttribute("aria-current", String(p === path));
  history.replaceState(null, "", `#${encodeURI(path)}`);
  main.replaceChildren(h("h2", {}, path), h("p", { class: "loading" }, "chargement…"));
  try {
    const bytes = await fetchBytes(path);
    if (token !== loadToken) return;
    const ctx: PanelContext = {
      files,
      path,
      bytes,
      url: urlOf(path),
      fetchBytes,
      audio: () => (audioContext ??= new AudioContext()),
      onDispose: (fn) => disposers.push(fn),
    };
    const content = await panelFor(path, bytes)(ctx);
    if (token !== loadToken) return;
    const size = files.size(path);
    main.replaceChildren(h("h2", {}, `${path}${size != null ? ` (${formatSize(size)})` : ""}`), content);
  } catch (error) {
    if (token !== loadToken) return;
    main.replaceChildren(h("h2", {}, path), h("p", { class: "error" }, `Erreur : ${(error as Error).message}`));
  }
}

function fileButton(path: string, label: string): HTMLLIElement {
  const button = h("button", { type: "button", class: "file", title: path }, label, h("span", { class: "ext" }, extensionOf(path)));
  button.addEventListener("click", () => void open(path));
  buttons.set(path, button);
  return h("li", {}, button);
}

function buildSidebar(sceneNames: Map<string, string>): void {
  const search = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer les fichiers" });
  const list = h("div", {});
  const groups: { details: HTMLDetailsElement; items: { li: HTMLLIElement; name: string }[] }[] = [];

  const addGroup = (title: string, paths: string[], strip: string) => {
    if (paths.length === 0) return;
    const ul = h("ul", {});
    const items = paths.map((path) => {
      const li = fileButton(path, path.slice(strip.length));
      ul.append(li);
      return { li, name: path.toLowerCase() };
    });
    const details = h("details", {}, h("summary", {}, `${title} (${paths.length})`), ul);
    list.append(details);
    groups.push({ details, items });
  };

  const sceneFolders = files.scenes();
  const rest = files.list((p) => !p.startsWith("DATA/S"));
  addGroup("Racine", rest, "");
  for (const scene of sceneFolders) {
    const name = sceneNames.get(scene.id);
    addGroup(`${scene.id}${name ? ` ${name}` : ""}`, files.list((p) => p.startsWith(`${scene.path}/`)), `${scene.path}/`);
  }

  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    for (const { details, items } of groups) {
      let visible = 0;
      for (const item of items) {
        const match = !query || item.name.includes(query);
        item.li.hidden = !match;
        if (match) visible++;
      }
      details.hidden = visible === 0;
      if (query) details.open = visible > 0;
    }
  });
  sidebar.replaceChildren(search, list);
}

async function start(): Promise<void> {
  main.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  try {
    files = await fetchGameFiles(BASE);
  } catch (error) {
    main.replaceChildren(
      h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`),
      h("p", { class: "empty" }, "Lancer scripts/teleportaschtroumpf-extract.sh puis python3 -I scripts/teleportaschtroumpf/manifest.py original/teleportaschtroumpf"),
    );
    return;
  }
  const sceneNames = new Map<string, string>();
  try {
    const description = files.resolve("descript.ion");
    if (description) for (const scene of parseDescription(await fetchBytes(description))) sceneNames.set(scene.id.toLowerCase(), scene.name);
  } catch {
    /* noms de scène facultatifs */
  }
  if (files.list().length === 0) {
    main.replaceChildren(h("p", { class: "empty" }, "aucun fichier"));
    return;
  }
  buildSidebar(sceneNames);
  const hash = decodeURI(location.hash.slice(1));
  if (hash && files.size(hash) != null) {
    const details = buttons.get(hash)?.closest("details");
    if (details) details.open = true;
    void open(hash);
  } else {
    main.replaceChildren(h("p", { class: "empty" }, "choisir un fichier"));
  }
}

void start();
