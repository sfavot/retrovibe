/**
 * Visionneuse de ressources de Croisière pour un cadavre : outil de développement, hors du build du site.
 * Page : `/src/games/croisiere/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers viennent de `original/croisiere/`
 * (servi en `/croisiere/`) : les volumes `D1`..`D5` (catalogue `VOL.CNF`) et `SYSTEM.FNT`.
 *
 * Contrairement aux autres jeux, les ressources sont des fichiers *dans* les volumes, pas dans des fichiers séparés : la barre
 * latérale liste donc le contenu des volumes (premier fichier trouvé pour un nom présent sur plusieurs disques), par famille.
 * L'état est dans le hash : `#S33.PI1`. Les libellés sont ceux d'un outil de développement, pas du texte du produit.
 */
import { fetchBytes } from "../../../ui/files";
import { h } from "../../../ui/asset-viewer/helpers";
import { CruiseVolumes } from "../data/volumes";
import { renderBackground, renderCtp, renderFont, renderSet, type PanelEnv } from "./panels";

const BASE = "/croisiere";
const root = document.getElementById("app")!;

interface Item {
  name: string;
  group: string;
  render(env: PanelEnv): HTMLElement | Promise<HTMLElement>;
}

function buildItems(volumes: CruiseVolumes): Item[] {
  const names = [...new Set(volumes.entries.map((e) => e.name))].sort();
  const items: Item[] = [];
  for (const name of names) {
    const ext = name.slice(name.lastIndexOf(".") + 1);
    if (ext === "PI1") items.push({ name, group: "Fonds (PI1)", render: (env) => renderBackground(env, name) });
    else if (ext === "SET" || ext === "SEC") items.push({ name, group: "Ensembles (SET, SEC)", render: (env) => renderSet(env, name) });
    else if (ext === "CTP") items.push({ name, group: "Zones de marche (CTP)", render: (env) => renderCtp(env, name) });
    else if (ext === "FNT") items.push({ name, group: "Polices", render: (env) => renderFont(env.volumes.readFile(name)) });
  }
  items.push({ name: "SYSTEM.FNT", group: "Polices", render: async (env) => renderFont(await env.loadFile("SYSTEM.FNT")) });
  return items;
}

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, "chargement des volumes…"));
  let volumes: CruiseVolumes;
  try {
    const [cnf, ...disks] = await Promise.all(["VOL.CNF", "D1", "D2", "D3", "D4", "D5"].map((n) => fetchBytes(BASE, n)));
    volumes = new CruiseVolumes(cnf!, disks);
  } catch (error) {
    root.replaceChildren(h("p", { class: "error" }, `Volumes indisponibles : ${(error as Error).message}`), h("p", { class: "empty" }, "Lancer scripts/croisiere-extract.sh"));
    return;
  }
  const env: PanelEnv = {
    volumes,
    loadFile: (name) => fetchBytes(BASE, name),
    backgroundNames: [...new Set(volumes.entries.map((e) => e.name).filter((n) => n.endsWith(".PI1")))].sort(),
  };
  const items = buildItems(volumes);

  const sidebar = h("aside", { "aria-label": "Fichiers" });
  const main = h("main", { "aria-live": "polite" });
  root.classList.add("asset-viewer");
  root.setAttribute("aria-label", "Croisière pour un cadavre — ressources");
  root.replaceChildren(sidebar, main);

  const buttons = new Map<string, HTMLButtonElement>();
  let token = 0;
  async function open(name: string): Promise<void> {
    const item = items.find((i) => i.name === name);
    if (!item) return;
    const mine = ++token;
    for (const [n, button] of buttons) button.setAttribute("aria-current", String(n === name));
    history.replaceState(null, "", `#${encodeURI(name)}`);
    main.replaceChildren(h("h2", {}, name), h("p", { class: "loading" }, "chargement…"));
    try {
      const content = await item.render(env);
      if (mine === token) main.replaceChildren(h("h2", {}, name), content);
    } catch (error) {
      if (mine === token) main.replaceChildren(h("h2", {}, name), h("p", { class: "error" }, `Erreur : ${(error as Error).message}`));
    }
  }

  const search = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer les fichiers" });
  const list = h("div", {});
  const groups = new Map<string, { details: HTMLDetailsElement; entries: { li: HTMLLIElement; name: string }[] }>();
  for (const item of items) {
    let group = groups.get(item.group);
    if (!group) {
      group = { details: h("details", {}, h("summary", {}, item.group), h("ul", {})), entries: [] };
      groups.set(item.group, group);
      list.append(group.details);
    }
    const button = h("button", { type: "button", class: "file", title: item.name }, item.name);
    button.addEventListener("click", () => void open(item.name));
    buttons.set(item.name, button);
    const li = h("li", {}, button);
    group.details.querySelector("ul")!.append(li);
    group.entries.push({ li, name: item.name.toLowerCase() });
  }
  for (const [label, { details, entries }] of groups) details.querySelector("summary")!.textContent = `${label} (${entries.length})`;
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    for (const { details, entries } of groups.values()) {
      let visible = 0;
      for (const entry of entries) {
        const match = !query || entry.name.includes(query);
        entry.li.hidden = !match;
        if (match) visible++;
      }
      details.hidden = visible === 0;
      if (query) details.open = visible > 0;
    }
  });
  sidebar.replaceChildren(search, list);

  const openFromHash = (): void => {
    let name = "";
    try {
      name = decodeURI(location.hash.slice(1));
    } catch {
      /* hash mal formé : ignoré */
    }
    if (name && buttons.has(name)) {
      const details = buttons.get(name)!.closest("details");
      if (details) details.open = true;
      void open(name);
    }
  };
  main.replaceChildren(h("p", { class: "empty" }, "choisir un fichier"));
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
}

void start();
