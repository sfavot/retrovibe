/**
 * Coquille commune des visionneuses de ressources (outils de développement, hors du build du site) :
 * barre latérale (filtre + arbre de fichiers par groupe), fichier sélectionné dans l'URL (`#chemin`), chargement
 * et erreurs. Chaque jeu fournit ses panneaux ; la coquille ne sait rien des formats.
 */
import type { GameFileEntry, GameFiles } from "../../data/game-files";
import { fetchBytes } from "../files";
import { formatSize, h, hexDump } from "./helpers";

/** Ce que reçoit un panneau : le fichier ouvert et de quoi en charger d'autres. */
export interface PanelContext {
  files: GameFiles;
  entry: GameFileEntry;
  path: string;
  /** Octets du fichier. */
  bytes: Uint8Array;
  url: string;
  /** Charge un autre fichier du jeu (chemin réel, par exemple issu de `files.resolve`). */
  fetchBytes(path: string): Promise<Uint8Array>;
  /** Contexte audio partagé, à n'appeler qu'après un geste de l'utilisateur. */
  audio(): AudioContext;
  /** Enregistre un nettoyage appelé quand un autre fichier est ouvert. */
  onDispose(fn: () => void): void;
}

export interface Panel {
  /** Le panneau sait-il afficher ce fichier ? Le premier qui répond oui gagne ; `bytes` sert aux formats reconnus par signature. */
  matches(entry: GameFileEntry, bytes: Uint8Array): boolean;
  render(ctx: PanelContext): Promise<HTMLElement> | HTMLElement;
}

export interface AssetViewerOptions {
  root: HTMLElement;
  /** Nom de la visionneuse (étiquette accessible de la zone). */
  title: string;
  files: GameFiles;
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `/teleportaschtroumpf`). */
  base: string;
  /** Groupe (dossier de la barre latérale) d'un fichier ; absent = un seul groupe sans titre de dossier. Ordre = première apparition. */
  groups?(entry: GameFileEntry): string;
  /** Panneaux essayés dans l'ordre ; si aucun ne convient, hexadécimal des premiers octets (un jeu peut ajouter un panneau attrape-tout). */
  panels: Panel[];
}

export interface AssetViewer {
  open(path: string): Promise<void>;
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toUpperCase();
}

/** Dossier commun à tous les chemins (avec barre finale), pour ne montrer que la partie utile dans un groupe. */
function commonFolder(paths: string[]): string {
  const folders = paths.map((p) => p.split("/").slice(0, -1));
  const first = folders[0] ?? [];
  let n = first.length;
  for (const folder of folders) {
    let i = 0;
    while (i < n && folder[i] === first[i]) i++;
    n = i;
  }
  return n === 0 ? "" : `${first.slice(0, n).join("/")}/`;
}

export function mountAssetViewer(options: AssetViewerOptions): AssetViewer {
  const { root, title, files, base, panels } = options;
  const sidebar = h("aside", { "aria-label": "Fichiers" });
  const main = h("main", { "aria-live": "polite" });
  root.classList.add("asset-viewer");
  root.setAttribute("aria-label", title);
  root.replaceChildren(sidebar, main);

  let audioContext: AudioContext | null = null;
  let disposers: (() => void)[] = [];
  let loadToken = 0;
  const buttons = new Map<string, HTMLButtonElement>();

  const urlOf = (path: string): string => `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const load = (path: string): Promise<Uint8Array> => fetchBytes(base, path);

  async function open(path: string): Promise<void> {
    const entry = files.entries.find((e) => e.path === path);
    if (!entry) return;
    const token = ++loadToken;
    for (const dispose of disposers) dispose();
    disposers = [];
    for (const [p, button] of buttons) button.setAttribute("aria-current", String(p === path));
    history.replaceState(null, "", `#${encodeURI(path)}`);
    main.replaceChildren(h("h2", {}, path), h("p", { class: "loading" }, "chargement…"));
    try {
      const bytes = await load(path);
      if (token !== loadToken) return;
      const ctx: PanelContext = {
        files,
        entry,
        path,
        bytes,
        url: urlOf(path),
        fetchBytes: load,
        audio: () => (audioContext ??= new AudioContext()),
        onDispose: (fn) => disposers.push(fn),
      };
      const panel = panels.find((p) => p.matches(entry, bytes));
      const content = panel ? await panel.render(ctx) : h("pre", {}, hexDump(bytes));
      if (token !== loadToken) return;
      main.replaceChildren(h("h2", {}, `${path} (${formatSize(entry.size)})`), content);
    } catch (error) {
      if (token !== loadToken) return;
      main.replaceChildren(h("h2", {}, path), h("p", { class: "error" }, `Erreur : ${(error as Error).message}`));
    }
  }

  function buildSidebar(): void {
    const search = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer les fichiers" });
    const list = h("div", {});
    const byGroup = new Map<string, string[]>();
    for (const entry of files.entries) {
      const { path } = entry;
      const label = options.groups?.(entry) ?? "";
      const paths = byGroup.get(label);
      if (paths) paths.push(path);
      else byGroup.set(label, [path]);
    }
    const groups: { details: HTMLDetailsElement; items: { li: HTMLLIElement; name: string }[] }[] = [];
    for (const [label, paths] of byGroup) {
      const strip = options.groups ? commonFolder(paths) : "";
      const ul = h("ul", {});
      const items = paths.map((path) => {
        const button = h("button", { type: "button", class: "file", title: path }, path.slice(strip.length), h("span", { class: "ext" }, extensionOf(path)));
        button.addEventListener("click", () => void open(path));
        buttons.set(path, button);
        const li = h("li", {}, button);
        ul.append(li);
        return { li, name: path.toLowerCase() };
      });
      const details = h("details", {}, h("summary", {}, `${label ? `${label} ` : ""}(${paths.length})`.trim()), ul);
      list.append(details);
      groups.push({ details, items });
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

  function openFromHash(): void {
    let path = "";
    try {
      path = decodeURI(location.hash.slice(1));
    } catch {
      /* hash mal formé : ignoré */
    }
    if (path && files.size(path) != null) {
      const details = buttons.get(path)?.closest("details");
      if (details) details.open = true;
      void open(path);
    }
  }

  if (files.entries.length === 0) {
    main.replaceChildren(h("p", { class: "empty" }, "aucun fichier"));
  } else {
    buildSidebar();
    main.replaceChildren(h("p", { class: "empty" }, "choisir un fichier"));
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
  }
  return { open };
}
