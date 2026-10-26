/** Briques communes aux panneaux de la visionneuse de SWIV 3D : tableaux, images indexées, séries d'images, vue « conteneur ». */
import { h } from "../../../../ui/asset-viewer/helpers";
import { makeCanvas, paintIndexed } from "../../../../ui/indexed-canvas";

export type Cell = string | number | Node;

export function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h("section", {}, h("h3", {}, title), ...children);
}

export function info(...pairs: [string, Cell][]): HTMLElement {
  const list = h("dl", { class: "info" });
  for (const [key, value] of pairs) list.append(h("dt", {}, key), h("dd", {}, typeof value === "object" ? value : String(value)));
  return list;
}

export function hex(value: number, digits = 2): string {
  return value.toString(16).padStart(digits, "0");
}

function tableRow(cells: Cell[], classes: string[], tag: "td" | "th" = "td"): HTMLTableRowElement {
  const row = h("tr", {});
  cells.forEach((cell, i) => {
    const el = h(tag, classes[i] ? { class: classes[i]! } : {});
    el.append(typeof cell === "object" ? cell : String(cell));
    row.append(el);
  });
  return row;
}

/** Tableau simple ; `classes` donne une classe CSS par colonne (`num`, `text`, `hex`). */
export function table(headers: string[], rows: Cell[][], classes: string[] = []): HTMLTableElement {
  const tbody = h("tbody", {});
  for (const row of rows) tbody.append(tableRow(row, classes));
  return h("table", {}, h("thead", {}, tableRow(headers, [], "th")), tbody);
}

/** Tableau filtrable (une zone de saisie, le nombre de lignes affichées) ; `key` est le texte en minuscules sur lequel porte le filtre. */
export function filterTable(headers: string[], rows: { key: string; cells: Cell[] }[], classes: string[] = [], limit = 400): HTMLElement {
  const input = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer la liste" });
  const count = h("span", { class: "empty" });
  const tbody = h("tbody", {});
  const refresh = (): void => {
    const query = input.value.trim().toLowerCase();
    const matches = rows.filter((row) => !query || row.key.includes(query));
    tbody.replaceChildren(...matches.slice(0, limit).map((row) => tableRow(row.cells, classes)));
    count.textContent = matches.length > limit ? `${limit} sur ${matches.length}` : `${matches.length}`;
  };
  input.addEventListener("input", refresh);
  refresh();
  return h("div", {}, h("div", { class: "bar" }, input, count), h("table", {}, h("thead", {}, tableRow(headers, [], "th")), tbody));
}

export function errorBox(error: unknown): HTMLElement {
  return h("p", { class: "error" }, `Erreur : ${error instanceof Error ? error.message : String(error)}`);
}

/** Exécute une construction de panneau et en montre l'erreur dans le panneau plutôt que de tout casser. */
export async function guarded(build: () => Promise<Node> | Node): Promise<HTMLElement> {
  try {
    const node = await build();
    return node instanceof HTMLElement ? node : h("div", {}, node);
  } catch (error) {
    console.error(error);
    return h("div", {}, errorBox(error));
  }
}

/** Liste déroulante : `options` = [valeur, libellé] ; appelle `onChange` avec la valeur choisie. */
export function select<T extends string | number>(
  label: string,
  options: [T, string][],
  value: T,
  onChange: (value: T) => void,
): HTMLElement {
  const el = h("select", { "aria-label": label });
  for (const [v, text] of options) {
    const option = h("option", { value: String(v) }, text);
    if (v === value) option.selected = true;
    el.append(option);
  }
  el.addEventListener("change", () => {
    const chosen = options.find(([v]) => String(v) === el.value);
    if (chosen) onChange(chosen[0]);
  });
  return h("label", { class: "field" }, `${label} `, el);
}

// --- Images -----------------------------------------------------------------------------------------------------------------------

/** Image RGBA (octets dans l'ordre mémoire d'un `Uint32Array` d'`ImageData`, comme `paletteToLut`) ; 0 = transparent. */
export interface Frame {
  width: number;
  height: number;
  rgba: Uint32Array;
  /** Texte d'info (position, taille…). */
  label?: string;
}

export function frameCanvas(frame: Frame, scale = 1): HTMLCanvasElement {
  const canvas = makeCanvas(Math.max(1, frame.width), Math.max(1, frame.height), scale);
  canvas.classList.add("alpha");
  if (frame.width > 0 && frame.height > 0) {
    const image = new ImageData(new Uint8ClampedArray(frame.rgba.buffer as ArrayBuffer, frame.rgba.byteOffset, frame.width * frame.height * 4), frame.width, frame.height);
    canvas.getContext("2d")!.putImageData(image, 0, 0);
  }
  return canvas;
}

/** Image indexée (palette `lut` ou 768 octets) dans un canvas à l'échelle `scale`. */
export function indexedCanvas(
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array | Uint32Array,
  scale = 1,
  transparent?: number,
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height, scale);
  paintIndexed(canvas, pixels, width, height, palette, transparent === undefined ? {} : { transparent });
  return canvas;
}

/** Octets affichés en niveaux de gris (`stretch` = valeur maximale pour étaler les gris). */
export function greyCanvas(bytes: Uint8Array, width: number, height: number, scale = 1, stretch = 255): HTMLCanvasElement {
  const grey = new Uint8Array(768);
  for (let i = 0; i < 256; i++) grey.fill(Math.min(255, Math.round((i * 255) / stretch)), i * 3, i * 3 + 3);
  return indexedCanvas(bytes, width, height, grey, scale);
}

/** Série d'images : un pas-à-pas avec zoom en haut, une planche de vignettes cliquables dessous. */
export function framesView(frames: Frame[], options: { zoom?: number; thumb?: number } = {}): HTMLElement {
  const zoom = options.zoom ?? 4;
  const thumb = options.thumb ?? 1;
  if (frames.length === 0) return h("p", { class: "empty" }, "aucune image");
  const stage = h("div", { class: "zoom" });
  const caption = h("span", { class: "empty" });
  const range = h("input", { type: "range", min: "0", max: String(frames.length - 1), value: "0", "aria-label": "Image" });
  const prev = h("button", { type: "button", "aria-label": "Image précédente" }, "◀");
  const next = h("button", { type: "button", "aria-label": "Image suivante" }, "▶");
  const sheet = h("div", { class: "grid sheet" });
  const figures: HTMLElement[] = [];
  let current = -1;
  const show = (index: number): void => {
    index = (index + frames.length) % frames.length;
    current = index;
    range.value = String(index);
    const frame = frames[index]!;
    stage.replaceChildren(frameCanvas(frame, zoom));
    caption.textContent = `${index + 1}/${frames.length} · ${frame.width}×${frame.height}${frame.label ? ` · ${frame.label}` : ""}`;
    figures.forEach((figure, i) => figure.setAttribute("aria-current", String(i === index)));
  };
  frames.forEach((frame, index) => {
    const figure = h("figure", { title: `${index}` }, frameCanvas(frame, thumb), h("figcaption", {}, String(index)));
    figure.addEventListener("click", () => show(index));
    figures.push(figure);
    sheet.append(figure);
  });
  range.addEventListener("input", () => show(Number(range.value)));
  prev.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => show(current + 1));
  show(0);
  return h("div", {}, h("div", { class: "bar" }, prev, range, next, caption), stage, sheet);
}

// --- Vue conteneur ------------------------------------------------------------------------------------------------------------------

export interface ResourceRow {
  key: string;
  /** Identifiant affiché (id de bloc ou nom de vue). */
  label: string;
  size?: string;
  role: string;
}

/** Liste filtrable des ressources d'un conteneur (à gauche) et détail de la ressource choisie (à droite). */
export function containerView(rows: ResourceRow[], render: (key: string) => Promise<Node> | Node, initial?: string): HTMLElement {
  const detail = h("div", { class: "detail" });
  const list = h("div", { class: "reslist-items" });
  const search = h("input", { type: "search", placeholder: "filtrer (id, rôle)", "aria-label": "Filtrer les ressources" });
  const buttons = new Map<string, HTMLButtonElement>();
  let token = 0;

  async function select(key: string): Promise<void> {
    const mine = ++token;
    for (const [k, button] of buttons) button.setAttribute("aria-current", String(k === key));
    detail.replaceChildren(h("p", { class: "loading" }, "chargement…"));
    let content: Node;
    try {
      content = await render(key);
    } catch (error) {
      console.error(error);
      content = errorBox(error);
    }
    if (mine !== token) return;
    const row = rows.find((r) => r.key === key);
    detail.replaceChildren(h("h3", { class: "detail-title" }, `${row?.label ?? key} — ${row?.role ?? ""}`), content);
  }

  for (const row of rows) {
    const button = h(
      "button",
      { type: "button", class: "res", "data-key": `${row.label} ${row.role}`.toLowerCase() },
      h("span", { class: "res-id" }, row.label),
      h("span", { class: "res-role" }, row.role),
      h("span", { class: "ext" }, row.size ?? ""),
    );
    button.addEventListener("click", () => void select(row.key));
    buttons.set(row.key, button);
    list.append(button);
  }
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    for (const button of buttons.values()) button.hidden = query !== "" && !button.dataset.key!.includes(query);
  });
  const first = initial ?? rows[0]?.key;
  if (first !== undefined) void select(first);
  return h("div", { class: "split" }, h("div", { class: "reslist" }, search, list), detail);
}
