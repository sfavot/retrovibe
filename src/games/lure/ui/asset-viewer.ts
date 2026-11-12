/**
 * Visionneuse de ressources de Lure of the Temptress : outil de développement, hors du build du site.
 * Page : `/src/games/lure/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu viennent de `original/lure/`
 * (servi en `/lure/`), listés par `files.json`. La mécanique (barre latérale, sélection, chargement) est dans
 * `src/ui/asset-viewer/` ; ici : un panneau par disque (`DISKn.VGA` : écrans, animations, palettes, police...) et un
 * panneau pour `LURE-FR.DAT` (pièces, textes, dialogues, scripts, palettes, police).
 *
 * Les scripts et les dialogues sont montrés bruts (hexadécimal et structures décodées) : le désassemblage viendra
 * avec le moteur. Les libellés sont ceux d'un outil de développement, pas du texte du produit.
 */
import type { GameFileEntry } from "../../../data/game-files";
import { fetchGameFiles } from "../../../data/game-files";
import { formatSize, h, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import { mountAssetViewer, type Panel, type PanelContext } from "../../../ui/asset-viewer/viewer";
import { makeCanvas, paintIndexed, paletteToLut } from "../../../ui/indexed-canvas";
import { classifyResources, type CatalogEntry, type ResourceKind } from "../data/catalog";
import { gameTextToUnicode } from "../data/charset";
import { DAT_FILE_NAME, DISK_FILE_NAMES } from "../data/container";
import { FONT_HEIGHT, FONT_WIDTH } from "../data/font";
import { CURSOR_HEIGHT, CURSOR_SIZE, CURSOR_WIDTH, DiskResId, ResId } from "../data/ids";
import { loadLureData, type LureData } from "../data/lure-data";
import { animationFrame, AnimationSequence, decodeAnimation } from "../data/anim";
import { NONVISUAL_HOTSPOT_ID, ROOM_PATHS_HEIGHT, ROOM_PATHS_WIDTH, type HotspotRecord, type Rect, type RoomData, type Segment } from "../data/lure-dat";
import { parsePalette, parsePaletteCollection, type Palette } from "../data/palette";
import { decodeScreen, loadGameScreen, SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/picture";
import { composeText, type LureText } from "../data/strings";
import { rgb768, screenPalette } from "../render/palette";

const BASE = "/lure";

// ---------------------------------------------------------------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------------------------------------------------------------

const hex = (value: number, width = 4): string => `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;

function errorBox(error: unknown): HTMLElement {
  return h("p", { class: "error" }, `Erreur : ${error instanceof Error ? error.message : String(error)}`);
}

/** Hexadécimal avec décalages réels et colonne ASCII : `length` octets de `bytes` à partir de `start`. */
function hexRange(bytes: Uint8Array, start: number, length: number): string {
  const lines: string[] = [];
  const end = Math.min(bytes.length, start + length);
  for (let at = start; at < end; at += 16) {
    const row = [...bytes.subarray(at, Math.min(end, at + 16))];
    const cells = row.map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const ascii = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${at.toString(16).padStart(6, "0")}  ${cells}  ${ascii}`);
  }
  return lines.join("\n");
}

/** Texte d'un identifiant, en Unicode ; les fragments de noms sont insérés, `%1` et `%2` restent visibles. */
function textOf(data: LureData, stringId: number, roomNumber?: number): string {
  if ((stringId & 0x1fff) === 0) return "";
  try {
    const text = data.texts.decode(stringId, roomNumber);
    return text ? formatText(data, text) : "";
  } catch (error) {
    return `<erreur : ${(error as Error).message}>`;
  }
}

function formatText(data: LureData, text: LureText): string {
  const placeholders: ComposeNames = { hotspotName: "{objet}", characterName: "{personnage}" };
  return gameTextToUnicode(composeText(data.texts, text, placeholders));
}
type ComposeNames = { hotspotName: string; characterName: string };

function hotspotName(data: LureData, record: HotspotRecord): string {
  return textOf(data, record.nameId);
}

function table(headers: string[], rows: (string | number | Node)[][], numeric: number[] = []): HTMLTableElement {
  return h(
    "table",
    {},
    h("thead", {}, h("tr", {}, ...headers.map((title) => h("th", {}, title)))),
    h("tbody", {}, ...rows.map((row) => h("tr", {}, ...row.map((cell, i) => h("td", numeric.includes(i) ? { class: "num" } : {}, typeof cell === "number" ? String(cell) : cell))))),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Données : chargées une fois, au premier fichier ouvert
// ---------------------------------------------------------------------------------------------------------------------------------

interface Loaded {
  data: LureData;
  catalog: CatalogEntry[];
}

let loading: Promise<Loaded> | null = null;

function loadAll(ctx: PanelContext): Promise<Loaded> {
  loading ??= (async () => {
    const [d1, d2, d3, d4, dat] = await Promise.all([...DISK_FILE_NAMES, DAT_FILE_NAME].map((name) => ctx.fetchBytes(name)));
    const data = loadLureData({ disks: [d1!, d2!, d3!, d4!], dat: dat! });
    return { data, catalog: classifyResources(data.resources, data.rooms, data.anims) };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------------------------------------------

function screenView(data: LureData, id: number): HTMLElement {
  const root = h("div", {});
  let pixels: Uint8Array;
  try {
    pixels = decodeScreen(data.resources.get(id));
  } catch (error) {
    return errorBox(error);
  }
  const rows = Math.min(SCREEN_HEIGHT, Math.max(1, Math.floor(pixels.length / SCREEN_WIDTH)));
  const { palette, source } = screenPalette(data, id);
  const canvas = makeCanvas(SCREEN_WIDTH, rows, 3);
  paintIndexed(canvas, pixels, SCREEN_WIDTH, rows, paletteToLut(rgb768(palette)));
  root.append(
    h("p", {}, `${pixels.length} octets décodés (${SCREEN_WIDTH} x ${(pixels.length / SCREEN_WIDTH).toFixed(1)}) ; ${source}`),
    h("div", { class: "preview" }, canvas),
    h("h3", {}, "Palette"),
    paletteSwatch(rgb768(palette)),
  );
  return root;
}

/** Hotspots qui utilisent l'animation `animId` (ressource de disque), avec leur taille. */
function hotspotsOfAnimation(data: LureData, animId: number): { record: HotspotRecord; flags: number }[] {
  const out: { record: HotspotRecord; flags: number }[] = [];
  for (const anim of data.anims) {
    if (anim.animId !== animId) continue;
    for (const record of data.hotspots) if (record.animRecordId === anim.animRecordId) out.push({ record, flags: anim.flags });
  }
  return out;
}

function animationView(data: LureData, id: number): HTMLElement {
  const root = h("div", {});
  let anim;
  try {
    anim = decodeAnimation(data.resources.get(id));
  } catch (error) {
    return errorBox(error);
  }
  const users = hotspotsOfAnimation(data, id);
  const record = data.anims.find((a) => a.animId === id);
  const flags = record?.flags ?? 0;
  const first = users[0];
  const width = h("input", { type: "number", value: String(first?.record.width ?? 32), min: "2", max: "320", step: "2", style: "width: 70px", "aria-label": "Largeur" });
  const height = h("input", { type: "number", value: String(first?.record.height ?? Math.max(1, Math.round((anim.frameSizes[0] ?? 0) / 32))), min: "1", max: "200", style: "width: 70px", "aria-label": "Hauteur" });
  const offset = h("input", { type: "number", value: String(first?.record.colorOffset ?? 0), min: "0", max: "255", style: "width: 70px", "aria-label": "Décalage de couleur" });
  const frames = h("div", { class: "frames" });
  const draw = (): void => {
    const w = Math.max(2, Math.floor(Number(width.value) / 2) * 2);
    const hh = Math.max(1, Number(height.value));
    const shift = Number(offset.value) || 0;
    const lut = paletteToLut(rgb768(data.gamePalette));
    frames.replaceChildren();
    for (let i = 0; i < anim.numFrames; i++) {
      const canvas = makeCanvas(w, hh, 3);
      canvas.className = "alpha";
      const shifted = animationFrame(anim, i, w, hh, flags).map((v) => (v === 0 ? 0 : (v + shift) & 0xff));
      paintIndexed(canvas, shifted, w, hh, lut, { transparent: 0 });
      frames.append(h("figure", {}, canvas, h("figcaption", {}, `image ${i} (${anim.frameSizes[i]} px)`)));
    }
  };
  const bar = h("div", { class: "bar" });
  if (users.length > 0) {
    const select = h("select", { "aria-label": "Hotspot qui l'utilise" });
    users.forEach((user, i) => select.append(h("option", { value: String(i) }, `${hex(user.record.hotspotId)} ${hotspotName(data, user.record)} (${user.record.width} x ${user.record.height}, pièce ${user.record.roomNumber})`)));
    select.addEventListener("change", () => {
      const user = users[Number(select.value)]!;
      width.value = String(user.record.width);
      height.value = String(user.record.height);
      offset.value = String(user.record.colorOffset);
      draw();
    });
    bar.append(select);
  }
  for (const input of [width, height, offset]) input.addEventListener("change", draw);
  bar.append(h("label", {}, "largeur", width), h("label", {}, "hauteur", height), h("label", {}, "décalage de couleur", offset));
  draw();
  root.append(
    h("p", {}, `${anim.numFrames} images ; tailles annoncées : ${anim.frameSizes.join(", ")} ; drapeaux d'animation ${record ? `${flags} (${flags & 4 ? "table de tailles" : "images contiguës"})` : "inconnus (aucun enregistrement 0x3F0B)"}`),
    users.length === 0 ? h("p", { class: "empty" }, "Aucun hotspot ne cite cette animation : taille saisie à la main (largeur 32 par défaut).") : "",
    bar,
    frames,
  );
  return root;
}

function sequenceView(data: LureData, id: number): HTMLElement {
  const root = h("div", {});
  let sequence: AnimationSequence;
  try {
    sequence = new AnimationSequence(data.resources.get(id), data.resources.get(id + 1));
  } catch (error) {
    return errorBox(error);
  }
  const screen = sequence.initialScreen.slice();
  const canvas = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, 3);
  const palette = paletteToLut(rgb768(data.gamePalette));
  let frame = 0;
  const counter = h("output", {}, "image 0 (écran de départ)");
  const paint = (): void => paintIndexed(canvas, screen, SCREEN_WIDTH, SCREEN_HEIGHT, palette);
  const next = h("button", { type: "button" }, "image suivante");
  const rewind = h("button", { type: "button" }, "début");
  next.addEventListener("click", () => {
    if (!sequence.hasFrame) return void (counter.textContent = `fin après ${frame} images`);
    sequence.applyNextFrame(screen);
    frame++;
    counter.textContent = `image ${frame}`;
    paint();
  });
  rewind.addEventListener("click", () => {
    sequence.rewind();
    screen.set(sequence.initialScreen);
    frame = 0;
    counter.textContent = "image 0 (écran de départ)";
    paint();
  });
  paint();
  root.append(
    h("p", {}, `${hex(id)} + lignes ${hex(id + 1)} ; ${sequence.pixelBytes} octets de pixels. La palette de la séquence n'est pas lue ici : palette du jeu (couleurs possiblement fausses).`),
    h("div", { class: "bar" }, next, rewind, counter),
    h("div", { class: "preview" }, canvas),
  );
  return root;
}

function glyphCanvas(bitmap: Uint8Array, scale: number): HTMLCanvasElement {
  const pixels = new Uint8Array(FONT_WIDTH * FONT_HEIGHT);
  for (let y = 0; y < FONT_HEIGHT; y++) for (let x = 0; x < FONT_WIDTH; x++) pixels[y * FONT_WIDTH + x] = bitmap[y]! & (0x80 >> x) ? 1 : 0;
  const lut = new Uint8Array(768);
  lut.set([255, 255, 255], 3);
  const canvas = makeCanvas(FONT_WIDTH, FONT_HEIGHT, scale);
  paintIndexed(canvas, pixels, FONT_WIDTH, FONT_HEIGHT, paletteToLut(lut));
  canvas.style.background = "#000";
  return canvas;
}

function fontView(data: LureData): HTMLElement {
  const grid = h("div", { class: "grid" });
  const { font } = data;
  for (let code = 32; code < 32 + font.numGlyphs; code++) {
    const glyph = font.glyph(code);
    if (!glyph) continue;
    grid.append(h("figure", {}, glyphCanvas(glyph, 4), h("figcaption", {}, `${code} ${hex(code, 2)} ${gameTextToUnicode(String.fromCharCode(code))}`)));
  }
  return h("div", {}, h("p", {}, `${font.numGlyphs} glyphes de ${FONT_WIDTH} x ${FONT_HEIGHT}, codes 32 à ${font.lastChar} (ressource ${DiskResId.font})`), grid);
}

function cursorsView(data: LureData): HTMLElement {
  const grid = h("div", { class: "grid" });
  const lut = paletteToLut(rgb768(data.gamePalette));
  const count = data.cursors.length / CURSOR_SIZE;
  const values = new Set<number>();
  for (let i = 0; i < count; i++) {
    const pixels = data.cursors.subarray(i * CURSOR_SIZE, (i + 1) * CURSOR_SIZE);
    pixels.forEach((v) => values.add(v));
    const canvas = makeCanvas(CURSOR_WIDTH, CURSOR_HEIGHT, 4);
    canvas.className = "alpha";
    paintIndexed(canvas, pixels, CURSOR_WIDTH, CURSOR_HEIGHT, lut, { transparent: 0 });
    grid.append(h("figure", {}, canvas, h("figcaption", {}, `curseur ${i}`)));
  }
  return h("div", {}, h("p", {}, `${count} curseurs ; valeurs de pixels présentes : ${[...values].sort((a, b) => a - b).join(", ")} (palette du jeu, 0 transparent)`), grid);
}

function paletteGrid(items: { label: string; palette: Palette }[]): HTMLElement {
  const grid = h("div", { class: "grid" });
  for (const { label, palette } of items) grid.append(h("figure", {}, paletteSwatch(rgb768(palette), 8), h("figcaption", {}, `${label} (${palette.numEntries})`)));
  return grid;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Panneau d'un disque
// ---------------------------------------------------------------------------------------------------------------------------------

const KIND_LABELS: Record<ResourceKind, string> = {
  "lure-dat": "lure.dat",
  palette: "palette",
  "palette-collection": "collection de palettes",
  screen: "écran",
  animation: "animation",
  "sequence-screen": "séquence : écran",
  "sequence-lines": "séquence : lignes",
  "sound-adlib": "son AdLib",
  "sound-roland": "son Roland",
  "driver-code": "code de pilote",
  protection: "protection",
  cursors: "curseurs",
  font: "police",
  "font-unused": "police inutilisée",
  "menu-bar": "barre de menus",
  names: "noms",
  strings: "textes",
  unused: "sans emploi",
  unknown: "inconnu",
};

function resourceView(data: LureData, entry: CatalogEntry): HTMLElement {
  try {
    const bytes = data.resources.get(entry.id);
    switch (entry.kind) {
      case "screen":
      case "menu-bar":
        return screenView(data, entry.id);
      case "animation":
        return animationView(data, entry.id);
      case "sequence-screen":
        return sequenceView(data, entry.id);
      case "palette":
        return h("div", {}, paletteSwatch(rgb768(parsePalette(bytes))));
      case "palette-collection":
        return paletteGrid(parsePaletteCollection(bytes, entry.id).map((palette, i) => ({ label: `sous-palette ${i}`, palette })));
      case "font":
      case "font-unused":
        return fontView(data);
      case "cursors":
        return cursorsView(data);
      default:
        return h("pre", {}, hexRange(bytes, 0, 512));
    }
  } catch (error) {
    return errorBox(error);
  }
}

function diskPanelFor(disk: number): Panel {
  return {
    matches: (entry: GameFileEntry) => entry.path.toUpperCase() === `DISK${disk}.VGA`,
    async render(ctx) {
      let loaded: Loaded;
      try {
        loaded = await loadAll(ctx);
      } catch (error) {
        return errorBox(error);
      }
      const { data, catalog } = loaded;
      const entries = catalog.filter((entry) => entry.disk === disk);
      const detail = h("div", { class: "stage" }, h("p", { class: "empty" }, "choisir une ressource"));
      const rows = new Map<number, HTMLTableRowElement>();
      const body = h("tbody", {});
      for (const entry of entries) {
        const row = h(
          "tr",
          { class: "row", tabindex: "0", "aria-selected": "false" },
          h("td", {}, hex(entry.id)),
          h("td", { class: "num" }, String(entry.size)),
          h("td", {}, KIND_LABELS[entry.kind] + (entry.ignored ? " (ignorée)" : "")),
        );
        const choose = (): void => {
          for (const [id, r] of rows) r.setAttribute("aria-selected", String(id === entry.id));
          detail.replaceChildren(h("h3", {}, `${hex(entry.id)} — ${KIND_LABELS[entry.kind]} — ${formatSize(entry.size)}`), resourceView(data, entry));
        };
        row.addEventListener("click", choose);
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose();
          }
        });
        rows.set(entry.id, row);
        body.append(row);
      }
      const filter = h("select", { "aria-label": "Filtrer par type" }, h("option", { value: "" }, "tous les types"));
      for (const kind of [...new Set(entries.map((e) => e.kind))]) filter.append(h("option", { value: kind }, KIND_LABELS[kind]));
      filter.addEventListener("change", () => {
        for (const entry of entries) rows.get(entry.id)!.hidden = filter.value !== "" && entry.kind !== filter.value;
      });
      const unknown = entries.filter((e) => e.kind === "unknown").length;
      return h(
        "div",
        {},
        h("p", {}, `${entries.length} ressources${unknown ? ` dont ${unknown} de type inconnu` : ""}.`),
        h("div", { class: "bar" }, filter),
        h("div", { style: "max-height: 32vh; overflow: auto; border: 1px solid #2a2c33; margin-bottom: 8px" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "id"), h("th", {}, "octets"), h("th", {}, "type"))), body)),
        detail,
      );
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pièces
// ---------------------------------------------------------------------------------------------------------------------------------

interface Overlay {
  label: string;
  color: string;
  draw(ctx: CanvasRenderingContext2D, room: RoomData): void;
  checked: boolean;
}

const strokeRect = (ctx: CanvasRenderingContext2D, rect: Rect): void => ctx.strokeRect(rect.xs + 0.5, rect.ys + 0.5, rect.xe - rect.xs - 1, rect.ye - rect.ys - 1);

function roomView(data: LureData, goScript: (offset: number, id?: number) => void): HTMLElement {
  const root = h("div", {});
  const rooms = [...data.rooms].sort((a, b) => a.roomNumber - b.roomNumber);
  const select = h("select", { "aria-label": "Pièce" });
  for (const room of rooms) select.append(h("option", { value: String(room.roomNumber) }, `${room.roomNumber} — ${textOf(data, room.descId).slice(0, 60)}`));
  const stage = h("div", {});
  root.append(h("div", { class: "bar" }, select), stage);

  const show = (): void => {
    const room = rooms.find((r) => r.roomNumber === Number(select.value))!;
    stage.replaceChildren();
    const hotspots = data.hotspots.filter((r) => r.roomNumber === room.roomNumber);
    const overrides = new Map(data.hotspotOverrides.map((o) => [o.hotspotId, o]));
    /** Rectangle d'un hotspot : celui de l'enregistrement, ou la surcharge 0x3F08 pour un hotspot non visuel (null s'il n'en a pas). */
    const rectOf = (r: HotspotRecord): Rect | null =>
      r.hotspotId >= NONVISUAL_HOTSPOT_ID ? (overrides.get(r.hotspotId) ?? null) : { xs: r.startX, xe: r.startX + r.width, ys: r.startY, ye: r.startY + r.height };
    const exitHotspots = data.roomExitHotspots.get(room.roomNumber) ?? [];

    const base = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, 2);
    const overlay = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, 2);
    const out = h("output", {}, "survol : —");
    const layerChecks = room.layers.slice(0, room.numLayers).map((id, i) => ({ id, i, box: h("input", { type: "checkbox", checked: "" }) }));
    const palette = screenPalette(data, room.layers[0] ?? 0);

    const overlays: Overlay[] = [
      { label: "hotspots", color: "#4cff6a", checked: true, draw: (ctx) => hotspots.forEach((r) => { const rect = rectOf(r); if (rect) strokeRect(ctx, rect); }) },
      {
        label: "zones surchargées",
        color: "#ffd24c",
        checked: false,
        draw: (ctx) => data.hotspotOverrides.filter((o) => hotspots.some((r) => r.hotspotId === o.hotspotId)).forEach((o) => strokeRect(ctx, o)),
      },
      { label: "sorties", color: "#ff5c5c", checked: true, draw: (ctx, r) => r.exits.forEach((e) => strokeRect(ctx, e)) },
      { label: "hotspots de sortie", color: "#ff9a4c", checked: false, draw: (ctx) => exitHotspots.forEach((e) => strokeRect(ctx, e)) },
      {
        label: "grille de cheminement",
        color: "#4cc9ff",
        checked: true,
        draw: (ctx, r) => {
          for (let y = 0; y < ROOM_PATHS_HEIGHT; y++) {
            for (let x = 0; x < ROOM_PATHS_WIDTH; x++) {
              if (r.paths[y * (ROOM_PATHS_WIDTH / 8) + (x >> 3)]! & (0x80 >> (x & 7))) ctx.fillRect(x * 8, 8 + y * 8, 8, 8);
            }
          }
        },
      },
      {
        label: "marche aléatoire",
        color: "#d86cff",
        checked: false,
        draw: (ctx, r) => strokeRect(ctx, { xs: r.walkBounds.left, xe: r.walkBounds.right, ys: r.walkBounds.top, ye: r.walkBounds.bottom }),
      },
    ];
    const overlayChecks = overlays.map((o) => ({ o, box: h("input", { type: "checkbox", ...(o.checked ? { checked: "" } : {}) }) }));

    const drawBase = (): void => {
      const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
      const lut = paletteToLut(rgb768(palette.palette));
      const ctx = base.getContext("2d")!;
      ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      paintIndexed(base, pixels, SCREEN_WIDTH, SCREEN_HEIGHT, lut);
      for (const { id, i, box } of layerChecks) {
        if (!box.checked) continue;
        try {
          const layer = loadGameScreen(data.resources.get(id));
          const tmp = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
          paintIndexed(tmp, layer, SCREEN_WIDTH, SCREEN_HEIGHT, lut, i === 0 ? {} : { transparent: 0 });
          ctx.drawImage(tmp, 0, 0);
        } catch (error) {
          out.textContent = `calque ${i} (${hex(id)}) : ${(error as Error).message}`;
        }
      }
    };
    const drawOverlay = (): void => {
      const ctx = overlay.getContext("2d")!;
      ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      ctx.lineWidth = 1;
      for (const { o, box } of overlayChecks) {
        if (!box.checked) continue;
        ctx.strokeStyle = o.color;
        ctx.fillStyle = `${o.color}55`;
        o.draw(ctx, room);
      }
    };
    for (const { box } of layerChecks) box.addEventListener("change", drawBase);
    for (const { box } of overlayChecks) box.addEventListener("change", drawOverlay);
    overlay.addEventListener("mousemove", (event) => {
      const rect = overlay.getBoundingClientRect();
      const x = Math.floor(((event.clientX - rect.left) / rect.width) * SCREEN_WIDTH);
      const y = Math.floor(((event.clientY - rect.top) / rect.height) * SCREEN_HEIGHT);
      const hit = hotspots.filter((r) => { const q = rectOf(r); return q !== null && x >= q.xs && x < q.xe && y >= q.ys && y < q.ye; });
      out.textContent = `survol : (${x}, ${y})${hit.length ? ` — ${hit.map((r) => `${hex(r.hotspotId)} ${hotspotName(data, r)}`).join(" ; ")}` : ""}`;
    });
    drawBase();
    drawOverlay();

    const controls = h("div", { class: "bar" });
    for (const { id, i, box } of layerChecks) controls.append(h("label", {}, box, `calque ${i} (${hex(id)})`));
    for (const { o, box } of overlayChecks) controls.append(h("label", { style: `color: ${o.color}` }, box, o.label));

    const exitRows = room.exits.map((e) => [
      `${e.xs}..${e.xe} x ${e.ys}..${e.ye}`,
      String(e.roomNumber),
      e.direction,
      `${e.x}, ${e.y}`,
      e.sequenceOffset === 0xffff ? "—" : scriptLink(e.sequenceOffset, goScript),
    ]);
    const hotspotRows = hotspots.map((r) => [hex(r.hotspotId), hotspotName(data, r), ...rectCells(rectOf(r), r), r.layer, hex(r.animRecordId), hex(r.actions, 7), r.hotspotScriptOffset ? scriptLink(r.hotspotScriptOffset, goScript, ResId.script2Data) : "—"]);
    stage.append(
      h(
        "p",
        {},
        `Pièce ${room.roomNumber} : ${room.numLayers} calques, drapeau de zone ${room.areaFlag}, découpe x ${room.clippingXStart}..${room.clippingXEnd}, temps de sortie ${room.exitTime}, séquence ${room.sequenceOffset ? hex(room.sequenceOffset) : "—"} ; ${palette.source}. Grille : 1 bit par bloc de 8 pixels, 40 x 24, supposée décalée de 8 lignes (barre de menus).`,
      ),
      controls,
      h("div", { class: "preview" }, h("div", { class: "room" }, base, overlay)),
      out,
      h("h3", {}, `Sorties (${room.exits.length})`),
      table(["zone", "pièce", "direction", "arrivée", "script"], exitRows),
      h("h3", {}, `Hotspots (${hotspots.length}) ; sorties-hotspots : ${exitHotspots.map((e) => `${hex(e.hotspotId)} -> pièce ${e.destRoomNumber}`).join(", ") || "aucune"}`),
      table(["id", "nom", "position", "taille", "calque", "anim.", "actions", "script"], hotspotRows),
    );
  };
  select.addEventListener("change", show);
  show();
  return root;
}

function rectCells(rect: Rect | null, r: HotspotRecord): [string, string] {
  if (r.hotspotId < NONVISUAL_HOTSPOT_ID) return [`${r.startX}, ${r.startY}`, `${r.width} x ${r.height}`];
  return rect ? [`non visuel : ${rect.xs}, ${rect.ys}`, `${rect.xe - rect.xs} x ${rect.ye - rect.ys} (surcharge 0x3F08)`] : ["non visuel", "sans surcharge : non dessiné"];
}

function scriptLink(offset: number, goScript: (offset: number, id?: number) => void, resource: number = ResId.scriptData): HTMLElement {
  const link = h("a", { href: "#" }, hex(offset));
  link.addEventListener("click", (event) => {
    event.preventDefault();
    goScript(offset, resource);
  });
  return link;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------------------------------------------------------------

function textsView(data: LureData): HTMLElement {
  const items: { id: string; text: string }[] = [];
  for (let n = 0; n < data.texts.nameCount; n++) items.push({ id: `nom ${n}`, text: gameTextToUnicode(String.fromCharCode(...data.texts.nameCodes(n))) });
  for (const set of [0, 1, 2] as const) {
    for (let index = 0; index < data.texts.count(set); index++) {
      let text: string;
      try {
        text = formatText(data, data.texts.decodeAt(set, index));
      } catch (error) {
        text = `<erreur : ${(error as Error).message}>`;
      }
      items.push({ id: `${hex(set * 0x7d0 + index)} (ressource ${set}, rang ${index})`, text });
    }
  }
  const search = h("input", { type: "search", placeholder: "rechercher (texte ou identifiant)", "aria-label": "Rechercher un texte", style: "width: 320px" });
  const count = h("output", {}, "");
  const body = h("tbody", {});
  const LIMIT = 400;
  const refresh = (): void => {
    const query = search.value.trim().toLowerCase();
    const found = items.filter((item) => !query || item.text.toLowerCase().includes(query) || item.id.toLowerCase().includes(query));
    count.textContent = `${found.length} sur ${items.length}${found.length > LIMIT ? ` (les ${LIMIT} premiers)` : ""}`;
    body.replaceChildren(...found.slice(0, LIMIT).map((item) => h("tr", {}, h("td", {}, item.id), h("td", { style: "white-space: pre-wrap" }, item.text))));
  };
  search.addEventListener("input", refresh);
  refresh();
  return h("div", {}, h("div", { class: "bar" }, search, count), h("p", { class: "empty" }, "{objet} et {personnage} : emplacements des noms insérés par le jeu."), h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "id"), h("th", {}, "texte"))), body));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dialogues
// ---------------------------------------------------------------------------------------------------------------------------------

function dialogsView(data: LureData, goScript: (offset: number, id?: number) => void): HTMLElement {
  const byRecord = new Map(data.talk.records.map((record) => [record.recordId, record]));
  const hotspotById = new Map(data.hotspots.map((r) => [r.hotspotId, r]));
  const link = (offset: number): Node | string => (offset === 0 || offset === 0xffff ? "—" : scriptLink(offset, goScript));
  const entryList = (title: string, entries: LureData["talk"]["records"][number]["entries"]): HTMLElement =>
    h(
      "div",
      {},
      h("em", {}, title),
      table(
        ["avant", "texte", "après"],
        entries.map((e) => [link(e.preSequenceId), `${hex(e.descId)} ${textOf(data, e.descId)}`, link(e.postSequenceId)]),
      ),
    );
  const recordView = (recordId: number): HTMLElement => {
    const record = byRecord.get(recordId);
    if (recordId === 0) return h("p", { class: "empty" }, "(aucun dialogue pour cet indice)");
    return record
      ? h("details", {}, h("summary", {}, `dialogue ${recordId} : ${record.entries.length} options, ${record.responses.length} réponses`), entryList("options", record.entries), entryList("réponses", record.responses))
      : h("p", { class: "error" }, `dialogue ${recordId} absent de 0x3F12`);
  };
  const tree = h("ul", { class: "tree" });
  for (const header of data.talkHeaders.headers) {
    const record = hotspotById.get(header.hotspotId);
    const items = header.entries.map((recordId) => h("li", {}, recordView(recordId)));
    tree.append(h("li", {}, h("details", {}, h("summary", {}, `${hex(header.hotspotId)} ${record ? hotspotName(data, record) : "(hotspot inconnu)"} — ${header.entries.length} dialogues`), h("ul", { class: "tree" }, ...items))));
  }
  const used = new Set(data.talkHeaders.headers.flatMap((header) => header.entries));
  const orphans = data.talk.records.filter((record) => !used.has(record.recordId)).map((record) => record.recordId);
  return h(
    "div",
    {},
    h("p", {}, `${data.talk.records.length} dialogues (0x3F12), ${data.talkHeaders.headers.length} personnages (0x3F11). « Donne » : ${data.talk.giveTalkIds.join(", ")}. Dialogues sans personnage : ${orphans.join(", ") || "aucun"}.`),
    tree,
    h("details", {}, h("summary", {}, "octets bruts de 0x3F11 (en-tête)"), h("pre", { class: "hex" }, hexRange(data.resources.get(ResId.talkHeader), 0, 512))),
    h("details", {}, h("summary", {}, "octets bruts de 0x3F12 (début)"), h("pre", { class: "hex" }, hexRange(data.resources.get(ResId.talkData), 0, 1024))),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------------------------------------------------------------

function scriptsView(data: LureData, controller: { goto?: (offset: number, id?: number) => void }): HTMLElement {
  const segments: { id: number; label: string; segment: Segment }[] = [
    { id: ResId.scriptData, label: "0x3F0C : séquences", segment: data.scripts },
    { id: ResId.script2Data, label: "0x3F0D : animations des hotspots", segment: data.scripts2 },
    { id: ResId.fightData, label: "0x3F16 : combats", segment: data.fights },
  ];
  const select = h("select", { "aria-label": "Segment" });
  segments.forEach((s, i) => select.append(h("option", { value: String(i) }, `${s.label} (${s.segment.length} octets)`)));
  const offset = h("input", { type: "text", value: "0", size: "8", "aria-label": "Décalage (hexadécimal)" });
  const length = h("input", { type: "number", value: "256", min: "16", max: "8192", step: "16", style: "width: 80px", "aria-label": "Longueur" });
  const view = h("pre", { class: "hex" });
  const known = h("select", { "aria-label": "Point d'entrée connu" }, h("option", { value: "" }, "points d'entrée connus"));
  const entries = new Map<string, { id: number; offset: number }>();
  const addKnown = (id: number, at: number, label: string): void => {
    if (!at || at === 0xffff) return;
    const key = `${id}:${at}`;
    if (entries.has(key)) return;
    entries.set(key, { id, offset: at });
    known.append(h("option", { value: key }, `${label} ${hex(at)}`));
  };
  for (const room of data.rooms) {
    addKnown(ResId.scriptData, room.sequenceOffset, `pièce ${room.roomNumber}`);
    room.exits.forEach((exit, i) => addKnown(ResId.scriptData, exit.sequenceOffset, `pièce ${room.roomNumber} sortie ${i}`));
  }
  data.hotspotScriptOffsets.forEach((at, i) => addKnown(ResId.script2Data, at, `hotspot (liste 0x3F0E, rang ${i})`));
  for (const list of data.actionLists.lists) for (const action of list.actions) if (action.sequenceOffset < 0x8000) addKnown(ResId.scriptData, action.sequenceOffset, `actions ${list.recordId}, verbe ${action.action}`);

  const refresh = (): void => {
    const s = segments[Number(select.value)]!;
    const start = Number.parseInt(offset.value, 16);
    if (Number.isNaN(start) || start < 0 || start >= s.segment.length) {
      view.textContent = `décalage hors du segment (0 à ${s.segment.length - 1})`;
      return;
    }
    view.textContent = hexRange(s.segment.bytes, start, Number(length.value) || 256);
  };
  controller.goto = (at, id = ResId.scriptData) => {
    select.value = String(Math.max(0, segments.findIndex((s) => s.id === id)));
    offset.value = at.toString(16);
    refresh();
  };
  select.addEventListener("change", refresh);
  offset.addEventListener("change", refresh);
  length.addEventListener("change", refresh);
  known.addEventListener("change", () => {
    const entry = entries.get(known.value);
    if (entry) controller.goto!(entry.offset, entry.id);
  });
  refresh();
  return h(
    "div",
    {},
    h("p", {}, "Octets bruts : le désassemblage viendra avec le moteur. Décalage en hexadécimal, tel que cité par les pièces, sorties et actions."),
    h("div", { class: "bar" }, select, h("label", {}, "décalage 0x", offset), h("label", {}, "longueur", length), known),
    view,
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Panneau de LURE-FR.DAT
// ---------------------------------------------------------------------------------------------------------------------------------

const datPanel: Panel = {
  matches: (entry: GameFileEntry) => entry.path.toUpperCase() === DAT_FILE_NAME,
  async render(ctx) {
    let loaded: Loaded;
    try {
      loaded = await loadAll(ctx);
    } catch (error) {
      return errorBox(error);
    }
    const { data, catalog } = loaded;
    const content = h("div", {});
    const controller: { goto?: (offset: number, id?: number) => void } = {};
    let current = "rooms";
    const cache = new Map<string, HTMLElement>();
    const tabs: { key: string; label: string; build: () => HTMLElement }[] = [
      { key: "rooms", label: "Pièces", build: () => roomView(data, (offset, id) => switchTo("scripts", offset, id)) },
      { key: "texts", label: "Textes", build: () => textsView(data) },
      { key: "dialogs", label: "Dialogues", build: () => dialogsView(data, (offset, id) => switchTo("scripts", offset, id)) },
      { key: "scripts", label: "Scripts", build: () => scriptsView(data, controller) },
      {
        key: "palettes",
        label: "Palettes",
        build: () =>
          paletteGrid([
            { label: "jeu 0x3F01", palette: data.gamePalette },
            { label: "sous-palette 0x3F02", palette: data.altPalette },
            ...catalog.filter((e) => e.kind === "palette").map((e) => ({ label: hex(e.id), palette: parsePalette(data.resources.get(e.id)) })),
          ]),
      },
      { key: "font", label: "Police", build: () => fontView(data) },
      { key: "cursors", label: "Curseurs", build: () => cursorsView(data) },
      {
        key: "resources",
        label: "Ressources de lure.dat",
        build: () => table(["id", "octets"], data.resources.dat.entries.map((e) => [hex(e.id), e.size]), [1]),
      },
    ];
    const bar = h("div", { class: "tabs", role: "toolbar", "aria-label": "Sections" });
    const buttons = new Map<string, HTMLButtonElement>();
    function switchTo(key: string, offset?: number, id?: number): void {
      current = key;
      for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === key));
      let node = cache.get(key);
      if (!node) {
        const tab = tabs.find((t) => t.key === key)!;
        try {
          node = tab.build();
        } catch (error) {
          node = errorBox(error);
        }
        cache.set(key, node);
      }
      content.replaceChildren(node);
      if (key === "scripts" && offset !== undefined) controller.goto?.(offset, id);
    }
    for (const tab of tabs) {
      const button = h("button", { type: "button", "aria-pressed": String(tab.key === current) }, tab.label);
      button.addEventListener("click", () => switchTo(tab.key));
      buttons.set(tab.key, button);
      bar.append(button);
    }
    switchTo("rooms");
    return h("div", {}, bar, content);
  },
};

const textPanel: Panel = {
  matches: (entry: GameFileEntry) => /\.txt$/i.test(entry.path),
  async render(ctx) {
    return h("pre", {}, new TextDecoder("latin1").decode(ctx.bytes));
  },
};

const pdfPanel: Panel = {
  matches: (entry: GameFileEntry) => /\.pdf$/i.test(entry.path),
  render: (ctx) => h("p", {}, h("a", { href: ctx.url, target: "_blank", rel: "noopener" }, "ouvrir le PDF")),
};

const PANELS: Panel[] = [...[1, 2, 3, 4].map(diskPanelFor), datPanel, textPanel, pdfPanel];

async function start(): Promise<void> {
  const root = document.getElementById("app")!;
  root.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  let files;
  try {
    files = await fetchGameFiles(BASE);
  } catch (error) {
    root.replaceChildren(h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`), h("p", { class: "empty" }, "Lancer scripts/lure-extract.sh"));
    return;
  }
  mountAssetViewer({ root, title: "Lure of the Temptress — ressources", files, base: BASE, panels: PANELS });
}

void start();
