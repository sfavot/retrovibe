/**
 * Panneaux de la visionneuse de Croisière pour un cadavre : fonds (`.PI1`), ensembles (`.SET` / `.SEC`), zones de marche
 * (`.CTP`) et polices (`.FNT`). Les libellés sont ceux d'un outil de développement, pas du texte du produit.
 */
import { h, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import { makeCanvas, paintIndexed } from "../../../ui/indexed-canvas";
import { isPaletteOnly, parseBackground, parsePaletteOnly, SCREEN_HEIGHT, SCREEN_WIDTH, type Background } from "../data/background";
import { parseCtp } from "../data/ctp";
import { glyphPixels, parseFont } from "../data/font";
import { parsePolyRecord, type PolyModel, type PolyRecord } from "../data/poly-model";
import { SetFile, type BitmapEntry } from "../data/sets";
import { FONT_CHARACTER_TABLE, NO_GLYPH } from "../data/tables";
import type { CruiseVolumes } from "../data/volumes";
import { polyBounds, PolyRasterizer, resolvePoly } from "../render/poly";

export interface PanelEnv {
  volumes: CruiseVolumes;
  /** Contenu d'un fichier réel de `original/croisiere/` (hors volumes). */
  loadFile(name: string): Promise<Uint8Array>;
  /** Noms (sans doublon, triés) des fonds `.PI1` des volumes. */
  backgroundNames: string[];
}

function infoList(...rows: [string, string | number][]): HTMLElement {
  const dl = h("dl", { class: "info" });
  for (const [key, value] of rows) dl.append(h("dt", {}, key), h("dd", {}, String(value)));
  return dl;
}

function errorBox(error: unknown): HTMLElement {
  return h("p", { class: "error" }, `Erreur : ${error instanceof Error ? error.message : String(error)}`);
}

const backgroundCache = new Map<string, Background | Uint8Array>();
/** Fond d'un `.PI1` ; un fichier palette seule rend ses 768 octets. */
function loadBackground(env: PanelEnv, name: string): Background | Uint8Array {
  let value = backgroundCache.get(name);
  if (!value) {
    const bytes = env.volumes.readFile(name);
    value = isPaletteOnly(bytes) ? parsePaletteOnly(bytes) : parseBackground(bytes);
    backgroundCache.set(name, value);
  }
  return value;
}

function paletteOf(env: PanelEnv, name: string): Uint8Array {
  const value = loadBackground(env, name);
  return value instanceof Uint8Array ? value : value.palette;
}

/** Fond du même nom que `stem` (ou de son plus long préfixe), sinon le premier. */
function pairedBackground(env: PanelEnv, stem: string): string {
  for (let n = stem.length; n >= 3; n--) {
    const candidate = `${stem.slice(0, n)}.PI1`;
    if (env.backgroundNames.includes(candidate)) return candidate;
  }
  return env.backgroundNames[0]!;
}

function paletteSelect(env: PanelEnv, current: string, onChange: (name: string) => void): HTMLElement {
  const select = h("select", { "aria-label": "Palette" });
  for (const name of env.backgroundNames) {
    const option = h("option", { value: name }, name);
    if (name === current) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  return h("label", {}, "palette ", select);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fonds
// ---------------------------------------------------------------------------------------------------------------------------------

export function renderBackground(env: PanelEnv, name: string): HTMLElement {
  const value = loadBackground(env, name);
  if (value instanceof Uint8Array) return h("div", {}, infoList(["type", "palette seule (PAL)"]), paletteSwatch(value, 18));
  const canvas = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, 3);
  paintIndexed(canvas, value.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, value.palette);
  const used = new Set(value.pixels).size;
  return h(
    "div",
    {},
    infoList(["mode", `${value.mode} (${value.mode === 8 ? "8 bits" : "5 plans, 32 couleurs"})`], ["taille", `${SCREEN_WIDTH} × ${SCREEN_HEIGHT}`], ["couleurs utilisées", used]),
    canvas,
    h("h3", {}, "Palette"),
    paletteSwatch(value.palette, 18),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ensembles (SET / SEC)
// ---------------------------------------------------------------------------------------------------------------------------------

interface Rendered {
  width: number;
  height: number;
  /** Indices de palette ; `opaque[i]` dit si le pixel est dessiné. */
  pixels: Uint8Array;
  opaque: Uint8Array;
  clipped: boolean;
}

/**
 * Dessine un modèle à `scale` (négatif = miroir) avec le rastériseur du jeu, deux fois (fond 0 puis fond 1) pour retrouver les pixels
 * réellement écrits, puis recadre sur ceux-ci.
 */
function renderModel(model: PolyModel, x: number, y: number, scale: number): Rendered | null {
  const raster = new PolyRasterizer();
  const size = SCREEN_WIDTH * SCREEN_HEIGHT;
  const a = new Uint8Array(size).fill(0);
  const b = new Uint8Array(size).fill(1);
  raster.drawModel(model, x, y, scale, a, null);
  raster.drawModel(model, x, y, scale, b, null);
  let left = SCREEN_WIDTH;
  let right = -1;
  let top = SCREEN_HEIGHT;
  let bottom = -1;
  for (let i = 0; i < size; i++) {
    if (a[i] !== b[i]) continue;
    const px = i % SCREEN_WIDTH;
    const py = (i / SCREEN_WIDTH) | 0;
    left = Math.min(left, px);
    right = Math.max(right, px);
    top = Math.min(top, py);
    bottom = Math.max(bottom, py);
  }
  if (right < 0) return null;
  const width = right - left + 1;
  const height = bottom - top + 1;
  const pixels = new Uint8Array(width * height);
  const opaque = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (top + row) * SCREEN_WIDTH + left + col;
      if (a[i] === b[i]) {
        pixels[row * width + col] = a[i]!;
        opaque[row * width + col] = 1;
      }
    }
  }
  const clipped = left === 0 || top === 0 || right === SCREEN_WIDTH - 1 || bottom === SCREEN_HEIGHT - 1;
  return { width, height, pixels, opaque, clipped };
}

function paintRendered(r: Rendered, palette: Uint8Array, scale: number): HTMLCanvasElement {
  const canvas = makeCanvas(r.width, r.height, scale);
  canvas.className = "alpha";
  const marked = r.pixels;
  // Les pixels non écrits restent transparents : on peint par un ImageData plutôt que par `paintIndexed`.
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(r.width, r.height);
  for (let i = 0; i < marked.length; i++) {
    if (!r.opaque[i]) continue;
    const c = marked[i]! * 3;
    image.data[i * 4] = palette[c]!;
    image.data[i * 4 + 1] = palette[c + 1]!;
    image.data[i * 4 + 2] = palette[c + 2]!;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function figure(canvas: HTMLElement, caption: string): HTMLElement {
  return h("figure", {}, canvas, h("figcaption", {}, caption));
}

function bitmapFigures(entry: BitmapEntry, index: number, palette: Uint8Array): HTMLElement[] {
  const scale = entry.width > 200 || entry.height > 150 ? 1 : 2;
  const caption = `#${index} ${entry.kind === "mask" ? "masque" : "image"} ${entry.width}×${entry.height}, type ${entry.header.type}, hotspot (${entry.header.hotspotX}, ${entry.header.hotspotY})`;
  const canvas = makeCanvas(entry.width, entry.height, scale);
  canvas.className = "alpha";
  if (entry.kind === "mask") {
    paintIndexed(canvas, entry.pixels, entry.width, entry.height, MASK_PALETTE);
    return [figure(canvas, caption)];
  }
  paintIndexed(canvas, entry.pixels, entry.width, entry.height, palette, { transparent: entry.transparency });
  const maskCanvas = makeCanvas(entry.width, entry.height, scale);
  const maskPixels = new Uint8Array(entry.width * entry.height);
  for (let y = 0; y < entry.height; y++) {
    for (let x = 0; x < entry.width; x++) maskPixels[y * entry.width + x] = (entry.mask[y * entry.maskStride + (x >> 3)]! >> (7 - (x & 7))) & 1;
  }
  paintIndexed(maskCanvas, maskPixels, entry.width, entry.height, MASK_PALETTE);
  return [figure(canvas, `${caption}, transparence ${entry.transparency}`), figure(maskCanvas, `#${index} masque d'opacité`)];
}

const MASK_PALETTE = (() => {
  const palette = new Uint8Array(768);
  palette.fill(255, 3, 6); // index 1 = blanc
  return palette;
})();

const ZOOMS = [256, 512, 1024];

export function renderSet(env: PanelEnv, name: string): HTMLElement {
  const set = new SetFile(env.volumes.readFile(name));
  const records = new Map<number, PolyRecord | null>();
  const record = (index: number): PolyRecord | null => {
    if (!records.has(index)) {
      let parsed: PolyRecord | null = null;
      try {
        const entry = set.entry(index);
        parsed = entry.kind === "poly" ? parsePolyRecord(entry.data) : null;
      } catch {
        parsed = null;
      }
      records.set(index, parsed);
    }
    return records.get(index) ?? null;
  };

  let paletteName = pairedBackground(env, name.replace(/\.[^.]+$/, ""));
  let mirror = false;
  const stage = h("div", { class: "grid" });
  const root = h("div", {});

  const mirrorBox = h("input", { type: "checkbox" });
  mirrorBox.addEventListener("change", () => {
    mirror = mirrorBox.checked;
    draw();
  });
  const bar = h(
    "div",
    { class: "bar" },
    paletteSelect(env, paletteName, (n) => {
      paletteName = n;
      draw();
    }),
    h("label", {}, mirrorBox, " miroir (échelle négative)"),
    h("span", { class: "empty" }, "zooms 256 · 512 (100 %) · 1024"),
  );

  function draw(): void {
    const palette = paletteOf(env, paletteName);
    stage.replaceChildren();
    for (let index = 0; index < set.length; index++) {
      try {
        const entry = set.entry(index);
        if (entry.kind !== "poly") {
          stage.append(...bitmapFigures(entry, index, palette));
          continue;
        }
        const rec = record(index)!;
        const group = h("figure", {});
        const row = h("div", { class: "grid" });
        for (const zoom of ZOOMS) {
          const poly = resolvePoly(index, rec, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, mirror ? -zoom : zoom, record);
          // Cadrage : la boîte du modèle (`getPolySize`) est recentrée sur l'écran avant le dessin.
          const box = poly ? polyBounds(poly.model, poly.x, poly.y, poly.scale) : null;
          const dx = box ? Math.round(SCREEN_WIDTH / 2 - (box.left + box.right) / 2) : 0;
          const dy = box ? Math.round(SCREEN_HEIGHT / 2 - (box.top + box.bottom) / 2) : 0;
          const rendered = poly ? renderModel(poly.model, poly.x + dx, poly.y + dy, poly.scale) : null;
          row.append(
            rendered
              ? figure(paintRendered(rendered, palette, 1), `${zoom}${rendered.clipped ? " (coupé par l'écran)" : ""} · ${rendered.width}×${rendered.height}`)
              : h("figcaption", {}, `${zoom} : rien de dessiné`),
          );
        }
        const kind = rec.kind === "model" ? `modèle, ${rec.polygons.length} polygones, ${rec.points.length / 2} points` : `renvoi miroir vers #${index + rec.offset} (décalage ${rec.newX}, ${rec.newY})`;
        group.append(row, h("figcaption", {}, `#${index} ${kind}`));
        stage.append(group);
      } catch (error) {
        stage.append(errorBox(new Error(`entrée ${index} : ${(error as Error).message}`)));
      }
    }
  }
  draw();
  root.append(infoList(["type", set.kind], ["entrées", set.length]), bar, stage);
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Zones de marche
// ---------------------------------------------------------------------------------------------------------------------------------

const WALKBOX_COLORS = ["255,80,80", "80,220,110", "90,150,255"];

/** Fond associé à un `.CTP` : même nom sans suffixe `_n` (`S33_2.CTP` → `S33.PI1`). */
export function backgroundOfCtp(env: PanelEnv, name: string): string | undefined {
  const stem = name.replace(/\.CTP$/i, "").replace(/_\d+$/, "");
  const candidate = `${stem}.PI1`;
  return env.backgroundNames.includes(candidate) ? candidate : undefined;
}

export function renderCtp(env: PanelEnv, name: string): HTMLElement {
  const ctp = parseCtp(env.volumes.readFile(name));
  const bgName = backgroundOfCtp(env, name);
  const scale = 3;
  const room = h("div", { class: "room" });
  const base = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, scale);
  const overlay = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, scale);
  room.append(base, overlay);
  const bg = bgName ? loadBackground(env, bgName) : null;
  if (bg && !(bg instanceof Uint8Array)) paintIndexed(base, bg.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, bg.palette);
  else base.getContext("2d")!.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  const show = { fill: true, outline: true, nodes: true, blocked: true };
  const raster = new PolyRasterizer();
  function draw(): void {
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctp.walkboxes.forEach((box, i) => {
      if (box.points.length < 2 || (!show.blocked && box.state === 1)) return;
      const rgb = WALKBOX_COLORS[box.color] ?? "255,255,255";
      if (show.fill) {
        // Remplissage par les intervalles du rastériseur du jeu (`renderCTPWalkBox`), à l'échelle 0x200 (100 %).
        raster.rasterizeWalkbox(ctp.walkboxRows[i]!, 0, 0, 0, 0, 512);
        const { top, spans } = raster.spanTable();
        ctx.fillStyle = `rgba(${rgb},${box.state === 1 ? 0.12 : 0.3})`;
        spans.forEach(([x1, x2], row) => {
          if (x2 >= x1 && x2 < 5000) ctx.fillRect(x1, top + row, x2 - x1 + 1, 1);
        });
      }
      if (show.outline) {
        ctx.strokeStyle = `rgb(${rgb})`;
        ctx.lineWidth = 1;
        ctx.setLineDash(box.state === 1 ? [3, 2] : []);
        ctx.beginPath();
        box.points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x + 0.5, p.y + 0.5) : ctx.lineTo(p.x + 0.5, p.y + 0.5)));
        ctx.closePath();
        ctx.stroke();
      }
    });
    if (show.nodes) {
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctp.routes.forEach((neighbours, a) => {
        const from = ctp.nodes[a];
        if (!from || a >= ctp.numNodes) return;
        for (const b of neighbours) {
          const to = ctp.nodes[b];
          if (!to || b < a) continue;
          ctx.beginPath();
          ctx.moveTo(from.x + 0.5, from.y + 0.5);
          ctx.lineTo(to.x + 0.5, to.y + 0.5);
          ctx.stroke();
        }
      });
      ctx.fillStyle = "#fff";
      ctp.nodes.slice(0, ctp.numNodes).forEach((n) => ctx.fillRect(n.x - 1, n.y - 1, 3, 3));
    }
  }
  const toggle = (label: string, key: keyof typeof show): HTMLElement => {
    const box = h("input", { type: "checkbox" });
    box.checked = show[key];
    box.addEventListener("change", () => {
      show[key] = box.checked;
      draw();
    });
    return h("label", {}, box, ` ${label}`);
  };
  draw();

  const table = h("table", {}, h("tr", {}, ...["#", "type", "état", "zoom", "sommets"].map((t) => h("th", {}, t))));
  ctp.walkboxes.forEach((box, i) => {
    const type = ["non marchable (rouge)", "marchable (vert)", "sortie (bleu)"][box.color] ?? String(box.color);
    table.append(
      h("tr", {}, h("td", { class: "num" }, String(i)), h("td", {}, type), h("td", {}, box.state ? "bloquée" : "libre"), h("td", { class: "num" }, String(box.zoom)), h("td", {}, box.points.map((p) => `(${p.x},${p.y})`).join(" "))),
    );
  });
  return h(
    "div",
    {},
    infoList(["fond associé", bgName ?? "aucun"], ["zones", ctp.walkboxes.length], ["nœuds de routage", ctp.numNodes]),
    h("div", { class: "bar" }, toggle("remplissage", "fill"), toggle("contours", "outline"), toggle("routes", "nodes"), toggle("zones bloquées", "blocked")),
    room,
    h("h3", {}, "Zones"),
    table,
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Polices
// ---------------------------------------------------------------------------------------------------------------------------------

/** Glyphe -> caractère (Latin-1) d'après la table de police du jeu. */
function glyphLabels(): Map<number, string> {
  const labels = new Map<number, string>();
  FONT_CHARACTER_TABLE.forEach((glyph, byte) => {
    if (glyph !== NO_GLYPH && !labels.has(glyph)) labels.set(glyph, String.fromCharCode(byte));
  });
  return labels;
}

export function renderFont(bytes: Uint8Array): HTMLElement {
  const font = parseFont(bytes);
  const labels = glyphLabels();
  const palette = new Uint8Array(768);
  palette.set([235, 235, 235], 3); // index 1
  palette.set([140, 150, 175], 6); // index 2
  const grid = h("div", { class: "glyphs" });
  font.glyphs.forEach((glyph, i) => {
    const canvas = makeCanvas(Math.max(1, glyph.charWidth), Math.max(1, glyph.charHeight), 4);
    if (glyph.charWidth > 0 && glyph.charHeight > 0) paintIndexed(canvas, glyphPixels(glyph), glyph.charWidth, glyph.charHeight, palette, { transparent: 0 });
    const label = labels.get(i);
    grid.append(figure(canvas, `${i}${label ? ` « ${label} »` : ""} · ${glyph.charWidth}×${glyph.charHeight}`));
  });
  return h(
    "div",
    {},
    infoList(["glyphes", font.glyphs.length], ["hauteur de ligne", font.lineHeight], ["espacement horizontal", font.hSpacing], ["espacement vertical", font.vSpacing]),
    grid,
  );
}
