/**
 * Visionneuse de ressources de Math Workshop : outil de développement, hors du build du site.
 * Page : `/src/games/mathemagique/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu viennent de
 * `original/mathemagique/` (servi en `/mathemagique/`), listés par `files.json`.
 *
 * Navigation : archive (barre latérale) -> type de ressource -> id. L'état est dans le hash : `#ARCHIVE.DAT/SHAP/105`.
 * Les libellés sont ceux d'un outil de développement, pas du texte du produit.
 */
import { parseMidi as parseMidiNotes } from "../../indy/audio/midi";
import { baseName, fetchGameFiles, type GameFiles } from "../data/files";
import { extractMidi, isMidi } from "../data/midi";
import { MohawkArchive, TAG_SCR, TAG_SHAP, TAG_SHPL, TAG_SND, TAG_SNDL, TAG_STRL } from "../data/mohawk";
import { applyShpl, createPalette, type Palette } from "../data/palette";
import { parseScr, resolveScrResources, type ScrEvent, type ScrScript } from "../data/scr";
import { decodeShap, type Shape } from "../data/shap";
import { parseShpl, type ShapeList } from "../data/shpl";
import { parseSndl } from "../data/sndl";
import { parseStrl } from "../data/strl";
import { decodeTbmp } from "../data/tbmp";
import { parseTpal } from "../data/tpal";
import { isWave, parseWave, waveDuration, waveToFloat32 } from "../data/wave";

const BASE = "/mathemagique";
const TAG_TBMP = "tBMP";
const TAG_TPAL = "tPAL";
const TICK_MS = 17;
const SCREEN_W = 576;
const SCREEN_H = 432;
/** Couleur des masques 1 bit (bit allumé), choisie pour ne pas se confondre avec la palette du jeu. */
const MASK_COLOR = 0xffd84fff;

/** Fonds plein écran : archive -> `SHPL` / `SHAP` de l'écran (engine.md §2.4). Même table que `render-samples.mts`. */
const BACKGROUNDS: Record<string, number> = {
  "MAINSCRN.DAT": 100,
  "BOWLING.DAT": 101,
  "HIDDEN.DAT": 102,
  "PATTERNS.DAT": 103,
  "STICKLER.DAT": 104,
  "TITLE.DAT": 105,
  "CREDITS.DAT": 106,
  "TROPHY.DAT": 107,
};

const sidebar = document.getElementById("sidebar")!;
const main = document.getElementById("main")!;

let files: GameFiles;
let audioContext: AudioContext | null = null;
let disposers: (() => void)[] = [];
let loadToken = 0;
const archiveButtons = new Map<string, HTMLButtonElement>();

/** Constructeur DOM : `h("div", { class: "x" }, enfants…)`. Les chaînes deviennent des nœuds texte. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h("button", { type: "button", ...attrs }, label);
  b.addEventListener("click", onClick);
  return b;
}

function info(...rows: [string, string | number][]): HTMLDListElement {
  const dl = h("dl", { class: "info" });
  for (const [key, value] of rows) dl.append(h("dt", {}, key), h("dd", {}, String(value)));
  return dl;
}

const tagLabel = (tag: string): string => tag.replace(/\0/g, "\\0");
const hex = (n: number, width = 4): string => n.toString(16).padStart(width, "0");

function formatSize(bytes: number): string {
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} Mo` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} Ko` : `${bytes} o`;
}

function hexDump(bytes: Uint8Array, max = 4096): string {
  const lines: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, max); i += 16) {
    const row = bytes.subarray(i, Math.min(i + 16, bytes.length));
    const cells = Array.from(row, (b) => hex(b, 2)).join(" ").padEnd(47);
    const text = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${hex(i, 6)}  ${cells}  ${text}`);
  }
  if (bytes.length > max) lines.push(`… ${bytes.length - max} octets de plus`);
  return lines.join("\n");
}

function onDispose(fn: () => void): void {
  disposers.push(fn);
}

function audio(): AudioContext {
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

// Données ------------------------------------------------------------------------------------------------------------

function urlOf(path: string): string {
  return `${BASE}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Une `SHPL` de l'archive, avec l'intervalle de `SHAP` qu'elle couvre. */
interface ShplEntry {
  id: number;
  list: ShapeList;
}

/** Archive ouverte et index des `SHPL` (petites ressources, toutes analysées à l'ouverture). */
interface OpenArchive {
  path: string;
  name: string;
  archive: MohawkArchive;
  shpls: ShplEntry[];
  shapeCache: Map<number, Shape>;
}

/** `SHPL` dont l'intervalle contient la `SHAP` `shapeId` ; la plus proche (plus grand premier id) en cas de recouvrement. */
function coveringShpl(open: OpenArchive, shapeId: number): ShplEntry | undefined {
  let best: ShplEntry | undefined;
  for (const entry of open.shpls) {
    const { firstShapeId, shapeCount } = entry.list;
    if (shapeId >= firstShapeId && shapeId < firstShapeId + shapeCount && (!best || firstShapeId > best.list.firstShapeId)) best = entry;
  }
  return best;
}

/** `SHPL` de l'écran de fond de l'archive (index 0 à 255 de la palette de l'écran), s'il existe. */
function backgroundShpl(open: OpenArchive): ShplEntry | undefined {
  const id = BACKGROUNDS[open.name.toUpperCase()];
  return id === undefined ? undefined : open.shpls.find((entry) => entry.id === id);
}

function buildPalette(layers: (ShplEntry | ShapeList | undefined)[], adjust = true): Palette {
  const palette = createPalette();
  for (const layer of layers) if (layer) applyShpl(palette, "list" in layer ? layer.list : layer, adjust);
  return palette;
}

function shapeOf(open: OpenArchive, id: number): Shape | undefined {
  let shape = open.shapeCache.get(id);
  if (!shape) {
    const bytes = open.archive.find(TAG_SHAP, id);
    if (!bytes) return undefined;
    shape = decodeShap(bytes);
    open.shapeCache.set(id, shape);
  }
  return shape;
}

/** Pixels indexés -> RGBA (0xAABBGGRR). `transparentZero` : l'index 0 est transparent. Un masque 1 bit prend `MASK_COLOR`. */
function toRgba(shape: Shape, palette: Palette, transparentZero: boolean): Uint32Array {
  const out = new Uint32Array(shape.width * shape.height);
  for (let i = 0; i < out.length; i++) {
    const index = shape.pixels[i]!;
    if (shape.bitsPerPixel === 1) {
      out[i] = index ? MASK_COLOR : 0;
    } else if (index === 0 && transparentZero) {
      out[i] = 0;
    } else {
      out[i] = ((0xff << 24) | (palette[index * 3 + 2]! << 16) | (palette[index * 3 + 1]! << 8) | palette[index * 3]!) >>> 0;
    }
  }
  return out;
}

function paintRgba(canvas: HTMLCanvasElement, rgba: Uint32Array, width: number, height: number): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(width, height);
  new Uint32Array(data.data.buffer).set(rgba);
  ctx.putImageData(data, 0, 0);
}

function rgbaCanvas(rgba: Uint32Array, width: number, height: number, scale: number, alpha: boolean): HTMLCanvasElement {
  const canvas = h("canvas", alpha ? { class: "alpha" } : {});
  paintRgba(canvas, rgba, width, height);
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  return canvas;
}

// Panneaux -----------------------------------------------------------------------------------------------------------

interface PanelContext {
  open: OpenArchive;
  tag: string;
  id: number;
  bytes: Uint8Array;
  /** Ouvre une autre ressource de la même archive. */
  goto(tag: string, id: number): void;
}

type Panel = (ctx: PanelContext) => HTMLElement | Promise<HTMLElement>;

function idChips(ctx: PanelContext, tag: string, ids: number[]): HTMLElement {
  const chips = h("div", { class: "chips idlist" });
  for (const id of ids) {
    const present = ctx.open.archive.has(tag, id);
    chips.append(button(String(id), () => ctx.goto(tag, id), { class: present ? "chip" : "chip missing", title: present ? "" : "absent de l'archive" }));
  }
  return chips;
}

function paletteCanvas(palette: Palette, coveredFrom: number, coveredCount: number, readout: HTMLElement): HTMLCanvasElement {
  const cell = 20;
  const canvas = h("canvas", { class: "swatches" });
  canvas.width = canvas.height = cell * 16;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 256; i++) {
    const covered = coveredCount === 0 || (i >= coveredFrom && i < coveredFrom + coveredCount);
    ctx.globalAlpha = covered ? 1 : 0.3;
    ctx.fillStyle = `rgb(${palette[i * 3]},${palette[i * 3 + 1]},${palette[i * 3 + 2]})`;
    ctx.fillRect((i % 16) * cell, Math.floor(i / 16) * cell, cell, cell);
  }
  canvas.style.width = canvas.style.height = `${cell * 16}px`;
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * 16);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * 16);
    const i = y * 16 + x;
    if (i >= 0 && i < 256) readout.textContent = `index ${i} : rgb(${palette[i * 3]}, ${palette[i * 3 + 1]}, ${palette[i * 3 + 2]}) #${hex(palette[i * 3]!, 2)}${hex(palette[i * 3 + 1]!, 2)}${hex(palette[i * 3 + 2]!, 2)}`;
  });
  return canvas;
}

const shapPanel: Panel = (ctx) => {
  const { open } = ctx;
  const shape = decodeShap(ctx.bytes);
  const covering = coveringShpl(open, ctx.id);
  const bg = backgroundShpl(open);
  let zoom = 1;
  let shplChoice = covering ? String(covering.id) : "none";
  let useBackground = true;
  let adjust = true;

  const preview = h("div", { class: "preview" });
  const note = h("p", { class: "note" });
  const render = () => {
    const chosen = open.shpls.find((entry) => String(entry.id) === shplChoice);
    const palette = buildPalette([useBackground ? bg : undefined, chosen], adjust);
    preview.replaceChildren(rgbaCanvas(toRgba(shape, palette, true), shape.width, shape.height, zoom, true));
    note.textContent = shape.bitsPerPixel === 1 ? "masque 1 bit : bit allumé en rose, éteint transparent" : "index 0 transparent (damier)";
  };

  const zoomButtons = [1, 2].map((z) =>
    button(`×${z}`, () => {
      zoom = z;
      zoomButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i + 1 === z)));
      render();
    }, { class: "chip", "aria-pressed": String(z === 1) }),
  );
  const select = h("select", { "aria-label": "SHPL de palette" }, h("option", { value: "none" }, "aucune SHPL"));
  for (const entry of open.shpls) {
    const { firstShapeId, shapeCount } = entry.list;
    select.append(h("option", { value: String(entry.id) }, `SHPL ${entry.id} (SHAP ${firstShapeId}–${firstShapeId + shapeCount - 1})`));
  }
  select.value = shplChoice;
  select.addEventListener("change", () => {
    shplChoice = select.value;
    render();
  });
  const check = (label: string, checked: boolean, change: (value: boolean) => void) => {
    const input = h("input", { type: "checkbox" });
    input.checked = checked;
    input.addEventListener("change", () => {
      change(input.checked);
      render();
    });
    return h("label", {}, input, ` ${label}`);
  };

  render();
  return h(
    "div",
    {},
    info(
      ["Taille", `${shape.width} × ${shape.height}`],
      ["Profondeur", `${shape.bitsPerPixel} bit(s) par pixel`],
      ["Pas (pitch)", shape.pitch],
      ["Drapeaux", `0x${hex(shape.flags, 4)}`],
      ["Octets lus", `${shape.consumed} / ${ctx.bytes.length}`],
      ["Fin déclarée", shape.declaredEnd],
      ["SHPL couvrante", covering ? `${covering.id}` : "aucune"],
    ),
    h(
      "div",
      { class: "bar" },
      ...zoomButtons,
      select,
      check(`palette du fond${bg ? ` (SHPL ${bg.id})` : " (aucune)"}`, true, (v) => (useBackground = v)),
      check("éclaircir", true, (v) => (adjust = v)),
    ),
    note,
    preview,
  );
};

const shplPanel: Panel = (ctx) => {
  const { open } = ctx;
  const list = parseShpl(ctx.bytes);
  const readout = h("p", { class: "note" }, "survoler un carré");
  const raw = h("input", { type: "checkbox" });
  const swatches = h("div", { class: "preview" });
  const draw = () => {
    const palette = buildPalette([list], !raw.checked);
    swatches.replaceChildren(paletteCanvas(palette, list.paletteFirst, list.rgb.length / 3, readout));
  };
  raw.addEventListener("change", draw);
  draw();
  const covered = Array.from({ length: list.shapeCount }, (_, i) => list.firstShapeId + i);
  return h(
    "div",
    {},
    info(
      ["SHAP de départ", list.firstShapeId],
      ["Nombre de SHAP", list.shapeCount],
      ["Palette", `index ${list.paletteFirst} à ${list.paletteFirst + list.rgb.length / 3 - 1} (${list.rgb.length / 3})`],
    ),
    h("div", { class: "bar" }, h("label", {}, raw, " valeurs brutes (sans éclaircissement)")),
    readout,
    swatches,
    h("p", { class: "note" }, "carrés estompés : index hors de la plage de cette SHPL (noir, 255 blanc)"),
    h("h3", {}, `SHAP couvertes (${open.archive.ids(TAG_SHAP).filter((id) => id >= list.firstShapeId && id < list.firstShapeId + list.shapeCount).length} présentes)`),
    idChips(ctx, TAG_SHAP, covered),
  );
};

// Sons : WAVE décodés à la demande, partagés entre le panneau SND et le lecteur SCR.
async function loadAudioBuffer(open: OpenArchive, id: number): Promise<AudioBuffer | undefined> {
  const bytes = open.archive.find(TAG_SND, id);
  if (!bytes || !isWave(bytes)) return undefined;
  const wave = parseWave(bytes);
  const buffer = audio().createBuffer(1, wave.samples.length, wave.sampleRate);
  buffer.getChannelData(0).set(waveToFloat32(wave));
  return buffer;
}

function playBuffer(buffer: AudioBuffer, sources: Set<AudioBufferSourceNode>, loop?: { start: number; end: number }): AudioBufferSourceNode {
  const ctx = audio();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (loop) {
    source.loop = true;
    source.loopStart = loop.start / buffer.sampleRate;
    source.loopEnd = loop.end / buffer.sampleRate;
  }
  source.connect(ctx.destination);
  source.addEventListener("ended", () => sources.delete(source));
  sources.add(source);
  source.start();
  return source;
}

function stopAll(sources: Set<AudioBufferSourceNode>): void {
  for (const source of sources) {
    try {
      source.stop();
    } catch {
      /* déjà arrêtée */
    }
  }
  sources.clear();
}

const sndPanel: Panel = async (ctx) => {
  const { open } = ctx;
  if (isWave(ctx.bytes)) {
    const wave = parseWave(ctx.bytes);
    const sources = new Set<AudioBufferSourceNode>();
    onDispose(() => stopAll(sources));
    const buffer = await loadAudioBuffer(open, ctx.id);
    const loops = wave.loopCount === 0xffff ? "infinie" : String(wave.loopCount);
    return h(
      "div",
      {},
      info(
        ["Type", "WAVE"],
        ["Fréquence", `${wave.sampleRate} Hz`],
        ["Échantillons", `${wave.samples.length} (${waveDuration(wave).toFixed(2)} s), ${wave.bitsPerSample} bits, ${wave.channels} canal`],
        ["Boucle", `${loops} (échantillons ${wave.loopStart} à ${wave.loopEnd})`],
        ["Repères", wave.cues.length ? wave.cues.map((c) => `${c.name || "?"}@${c.sampleFrame}`).join(", ") : "aucun"],
      ),
      h(
        "div",
        { class: "bar" },
        button("Jouer", () => buffer && playBuffer(buffer, sources)),
        button("Jouer en boucle", () => buffer && playBuffer(buffer, sources, { start: wave.loopStart, end: wave.loopEnd || wave.samples.length })),
        button("Arrêter", () => stopAll(sources)),
      ),
    );
  }
  if (isMidi(ctx.bytes)) {
    const smf = extractMidi(ctx.bytes);
    const view = new DataView(smf.buffer, smf.byteOffset, smf.byteLength);
    const notes = parseMidiNotes(smf.buffer.slice(smf.byteOffset, smf.byteOffset + smf.byteLength) as ArrayBuffer);
    const length = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
    const download = () => {
      const url = URL.createObjectURL(new Blob([smf as BlobPart], { type: "audio/midi" }));
      const a = h("a", { href: url, download: `${baseName(open.path).replace(/\.[^.]+$/, "")}-${ctx.id}.mid` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return h(
      "div",
      {},
      info(
        ["Type", "MIDI"],
        ["Format", `SMF ${view.getUint16(8)}, ${view.getUint16(10)} piste(s), division ${view.getUint16(12)}`],
        ["Notes", notes.length],
        ["Durée", `${length.toFixed(1)} s`],
        ["Taille SMF", `${smf.length} octets`],
      ),
      h("div", { class: "bar" }, button("Télécharger .mid", download)),
      h("p", { class: "note" }, "pas de lecture ici : le synthétiseur d'Indy (audio.ts) n'est pas exporté, et on ne modifie pas les fichiers d'un autre jeu"),
    );
  }
  return rawPanel(ctx);
};

const rawPanel: Panel = (ctx) => h("div", {}, info(["Taille", formatSize(ctx.bytes.length)]), h("pre", {}, hexDump(ctx.bytes)));

const strlPanel: Panel = (ctx) => {
  const strings = parseStrl(ctx.bytes);
  return h("div", {}, info(["Chaînes", strings.length]), h("pre", {}, strings.map((s, i) => `${i}: ${JSON.stringify(s)}`).join("\n")), h("h3", {}, "Octets"), h("pre", {}, hexDump(ctx.bytes, 512)));
};

const sndlPanel: Panel = (ctx) => {
  const ids = parseSndl(ctx.bytes);
  return h("div", {}, info(["Sons", ids.length]), idChips(ctx, TAG_SND, ids));
};

const tbmpPanel: Panel = (ctx) => {
  const { open } = ctx;
  const shape = decodeTbmp(ctx.bytes);
  const palettes = open.archive.ids(TAG_TPAL);
  let paletteId = palettes.includes(1) ? 1 : palettes[0];
  let adjust = false;
  const preview = h("div", { class: "preview" });
  const render = () => {
    const palette = paletteId === undefined ? createPalette() : buildPalette([parseTpal(open.archive.get(TAG_TPAL, paletteId))], adjust);
    preview.replaceChildren(rgbaCanvas(toRgba(shape, palette, false), shape.width, shape.height, 1, false));
  };
  const select = h("select", { "aria-label": "tPAL" });
  for (const id of palettes) select.append(h("option", { value: String(id) }, `tPAL ${id}`));
  if (paletteId !== undefined) select.value = String(paletteId);
  select.addEventListener("change", () => {
    paletteId = Number(select.value);
    render();
  });
  const input = h("input", { type: "checkbox" });
  input.addEventListener("change", () => {
    adjust = input.checked;
    render();
  });
  render();
  return h(
    "div",
    {},
    info(["Taille", `${shape.width} × ${shape.height}`], ["Profondeur", `${shape.bitsPerPixel} bit(s)`], ["Drapeaux", `0x${hex(shape.flags, 4)}`]),
    h("div", { class: "bar" }, select, h("label", {}, input, " éclaircir (non établi)")),
    preview,
  );
};

const tpalPanel: Panel = (ctx) => {
  const list = parseTpal(ctx.bytes);
  const readout = h("p", { class: "note" }, "survoler un carré");
  const raw = h("input", { type: "checkbox" });
  raw.checked = true;
  const swatches = h("div", { class: "preview" });
  const draw = () => swatches.replaceChildren(paletteCanvas(buildPalette([list], !raw.checked), list.paletteFirst, list.rgb.length / 3, readout));
  raw.addEventListener("change", draw);
  draw();
  return h(
    "div",
    {},
    info(["Palette", `index ${list.paletteFirst} à ${list.paletteFirst + list.rgb.length / 3 - 1}`]),
    h("div", { class: "bar" }, h("label", {}, raw, " valeurs brutes")),
    readout,
    swatches,
  );
};

// Lecteur d'animation \0SCR ------------------------------------------------------------------------------------------

const scrPanel: Panel = async (ctx) => {
  const { open } = ctx;
  const script: ScrScript = parseScr(ctx.bytes);
  const resolved = resolveScrResources(ctx.id, { shpl: new Set(open.shpls.map((e) => e.id)), sndl: new Set(open.archive.ids(TAG_SNDL)) });
  const shplEntry = open.shpls.find((e) => e.id === resolved.shplId);
  const sndIds = resolved.sndlId === undefined ? [] : parseSndl(open.archive.get(TAG_SNDL, resolved.sndlId));
  const header = info(
    ["Zone", `gauche ${script.clip.left}, haut ${script.clip.top}, droite ${script.clip.right}, bas ${script.clip.bottom}`],
    ["Images", script.frames.length],
    ["Durée", `${script.duration} ticks (${((script.duration * TICK_MS) / 1000).toFixed(2)} s)`],
    ["Opcodes", script.ops.length],
    ["SHPL", shplEntry ? `${shplEntry.id} (décalage ${resolved.offset})` : "introuvable"],
    ["SNDL", resolved.sndlId ?? "aucune"],
  );
  if (!shplEntry || script.frames.length === 0) return h("div", {}, header, h("p", { class: "error" }, shplEntry ? "script sans image" : "SHPL introuvable : lecture impossible"));

  // Fond : SHAP d'id saisi ; par défaut la première SHAP de l'archive si elle fait 576 × 432.
  const firstShapeId = open.archive.ids(TAG_SHAP)[0];
  const firstShape = firstShapeId === undefined ? undefined : shapeOf(open, firstShapeId);
  let backgroundId: number | undefined = firstShape && firstShape.width === SCREEN_W && firstShape.height === SCREEN_H ? firstShapeId : undefined;
  let background: Uint32Array = new Uint32Array(SCREEN_W * SCREEN_H).fill(0xff000000);
  let sprites = new Map<number, { rgba: Uint32Array; width: number; height: number }>();
  let palette: Palette = buildPalette([shplEntry]);

  const prepare = () => {
    const bgShape = backgroundId === undefined ? undefined : shapeOf(open, backgroundId);
    const bgLayer = bgShape && backgroundId !== undefined ? (coveringShpl(open, backgroundId) ?? backgroundShpl(open)) : undefined;
    palette = buildPalette([bgLayer, shplEntry]);
    background = new Uint32Array(SCREEN_W * SCREEN_H).fill(0xff000000);
    if (bgShape && bgShape.bitsPerPixel === 8) {
      const rgba = toRgba(bgShape, palette, false);
      for (let y = 0; y < Math.min(bgShape.height, SCREEN_H); y++)
        for (let x = 0; x < Math.min(bgShape.width, SCREEN_W); x++) background[y * SCREEN_W + x] = rgba[y * bgShape.width + x]!;
    }
    sprites = new Map();
  };
  const sprite = (index: number) => {
    let entry = sprites.get(index);
    if (!entry && index <= shplEntry.list.shapeCount) {
      const shape = shapeOf(open, shplEntry.list.firstShapeId + index - 1);
      if (shape && shape.bitsPerPixel === 8) {
        entry = { rgba: toRgba(shape, palette, true), width: shape.width, height: shape.height };
        sprites.set(index, entry);
      }
    }
    return entry;
  };

  const canvas = h("canvas", { width: String(SCREEN_W), height: String(SCREEN_H) });
  const screen = new Uint32Array(SCREEN_W * SCREEN_H);
  const cx = canvas.getContext("2d")!;
  const image = cx.createImageData(SCREEN_W, SCREEN_H);
  const image32 = new Uint32Array(image.data.buffer);

  const drawFrame = (index: number) => {
    screen.set(background);
    const { clip } = script;
    const x0 = Math.max(0, clip.left);
    const y0 = Math.max(0, clip.top);
    const x1 = Math.min(SCREEN_W, clip.right);
    const y1 = Math.min(SCREEN_H, clip.bottom);
    for (const cell of script.frames[index]!.cells) {
      const s = sprite(cell.shape);
      if (!s || cell.x <= -30000) continue;
      const ox = clip.left + cell.x;
      const oy = clip.top + cell.y;
      for (let y = Math.max(0, y0 - oy); y < s.height && oy + y < y1; y++)
        for (let x = Math.max(0, x0 - ox); x < s.width && ox + x < x1; x++) {
          const px = s.rgba[y * s.width + x]!;
          if (px !== 0) screen[(oy + y) * SCREEN_W + ox + x] = px;
        }
    }
    image32.set(screen);
    cx.putImageData(image, 0, 0);
  };

  // Évènements à jouer, triés par instant.
  const events: ScrEvent[] = [...script.frames.flatMap((f) => f.events), ...script.trailingEvents].sort((a, b) => a.tick - b.tick);
  const sources = new Set<AudioBufferSourceNode>();
  const buffers = new Map<number, Promise<AudioBuffer | undefined>>();
  const log = h("pre", { class: "log" });
  const soundOn = h("input", { type: "checkbox" });
  soundOn.checked = true;
  const loopOn = h("input", { type: "checkbox" });
  const addLog = (text: string) => {
    log.append(`${text}\n`);
    log.scrollTop = log.scrollHeight;
  };
  const fire = (event: ScrEvent) => {
    const t = `t=${event.tick} `;
    if (event.kind === "hook") addLog(`${t}hook ${event.hook} arg ${event.arg}`);
    else if (event.kind === "sound") {
      const inList = sndIds.includes(event.id);
      addLog(`${t}son ${event.id}${inList ? "" : " (hors SNDL)"}${open.archive.has(TAG_SND, event.id) ? "" : " (absent)"}`);
      if (soundOn.checked) {
        let buffer = buffers.get(event.id);
        if (!buffer) buffers.set(event.id, (buffer = loadAudioBuffer(open, event.id).catch(() => undefined)));
        void buffer.then((b) => b && playBuffer(b, sources));
      }
    } else addLog(`${t}${event.kind} ${"id" in event ? event.id : event.level}`);
  };

  // Position de lecture, en ticks (fractionnaire).
  let tick = 0;
  let playing = false;
  let lastTime = 0;
  let raf = 0;
  let shown = -1;
  let evPtr = 0;
  const slider = h("input", { type: "range", min: "0", max: String(script.frames.length - 1), value: "0", "aria-label": "Image" });
  const status = h("span", { class: "note" });

  const frameAt = (t: number): number => {
    let lo = 0;
    for (let i = 0; i < script.frames.length; i++) if (script.frames[i]!.start <= t) lo = i;
    return lo;
  };
  const show = (t: number, fireEvents: boolean) => {
    tick = t;
    const index = frameAt(t);
    if (index !== shown) {
      shown = index;
      drawFrame(index);
      slider.value = String(index);
    }
    while (evPtr < events.length && events[evPtr]!.tick <= t) {
      if (fireEvents) fire(events[evPtr]!);
      evPtr++;
    }
    const f = script.frames[index]!;
    status.textContent = `image ${index + 1}/${script.frames.length} · tick ${Math.floor(t)} · début ${f.start}, durée ${f.duration} (${f.count} × ${f.delay}) · ${f.cells.length} cellule(s)`;
  };
  /** Place la lecture sur `t` en repositionnant le pointeur d'évènements ; `silent` : les évènements déjà passés ne sont pas rejoués. */
  const seek = (t: number, silent: boolean) => {
    evPtr = 0;
    if (silent) while (evPtr < events.length && events[evPtr]!.tick <= t) evPtr++;
    shown = -1;
    show(t, !silent);
  };
  const loop = (now: number) => {
    if (!playing) return;
    tick += (now - lastTime) / TICK_MS;
    lastTime = now;
    if (tick >= script.duration) {
      show(script.duration - 1e-6, true);
      if (loopOn.checked) {
        log.textContent = "";
        seek(0, false);
        raf = requestAnimationFrame(loop);
      } else setPlaying(false);
      return;
    }
    show(tick, true);
    raf = requestAnimationFrame(loop);
  };
  const playButton = button("Lecture", () => {
    if (playing) setPlaying(false);
    else {
      audio();
      if (tick >= script.duration - 1e-6) {
        log.textContent = "";
        seek(0, false);
      }
      setPlaying(true);
    }
  });
  function setPlaying(value: boolean): void {
    playing = value;
    playButton.textContent = value ? "Pause" : "Lecture";
    cancelAnimationFrame(raf);
    if (value) {
      lastTime = performance.now();
      raf = requestAnimationFrame(loop);
    } else stopAll(sources);
  }
  const step = (delta: number) => {
    setPlaying(false);
    const index = Math.min(script.frames.length - 1, Math.max(0, frameAt(tick) + delta));
    const frame = script.frames[index]!;
    if (delta < 0) seek(frame.start, true);
    else show(frame.start, true);
  };
  slider.addEventListener("input", () => {
    setPlaying(false);
    seek(script.frames[Number(slider.value)]!.start, true);
  });

  const bgInput = h("input", { type: "number", min: "0", "aria-label": "SHAP de fond", value: backgroundId === undefined ? "" : String(backgroundId) });
  bgInput.addEventListener("change", () => {
    const value = bgInput.value.trim();
    const id = value === "" ? undefined : Number(value);
    if (id !== undefined && !open.archive.has(TAG_SHAP, id)) {
      bgInput.value = backgroundId === undefined ? "" : String(backgroundId);
      return;
    }
    backgroundId = id;
    prepare();
    shown = -1;
    show(tick, false);
  });

  onDispose(() => {
    playing = false;
    cancelAnimationFrame(raf);
    stopAll(sources);
  });
  prepare();
  seek(0, false);
  return h(
    "div",
    {},
    header,
    h(
      "div",
      { class: "bar" },
      playButton,
      button("◀ Image", () => step(-1)),
      button("Image ▶", () => step(1)),
      button("Début", () => {
        setPlaying(false);
        log.textContent = "";
        seek(0, false);
      }),
      h("label", {}, loopOn, " boucle"),
      h("label", {}, soundOn, " sons"),
      h("label", {}, "fond SHAP ", bgInput),
    ),
    h("div", { class: "bar" }, slider),
    status,
    h("div", { class: "preview" }, canvas),
    h("h3", {}, "Évènements (sons, hooks)"),
    log,
    h("h3", {}, `Sons de la SNDL ${resolved.sndlId ?? ""} (${sndIds.length})`),
    idChips(ctx, TAG_SND, sndIds),
  );
};

const PANELS: Record<string, Panel> = {
  [TAG_SHAP]: shapPanel,
  [TAG_SHPL]: shplPanel,
  [TAG_SCR]: scrPanel,
  [TAG_SND]: sndPanel,
  [TAG_STRL]: strlPanel,
  [TAG_SNDL]: sndlPanel,
  [TAG_TBMP]: tbmpPanel,
  [TAG_TPAL]: tpalPanel,
};

// Navigation ---------------------------------------------------------------------------------------------------------

let current: OpenArchive | undefined;
let currentTag: string | undefined;
let currentId: number | undefined;

const typeBar = h("div", { class: "chips" });
const idBar = h("div", {});
const detail = h("div", {});

function setHash(): void {
  if (!current) return;
  const parts = [current.path];
  if (currentTag !== undefined) parts.push(encodeURIComponent(currentTag));
  if (currentTag !== undefined && currentId !== undefined) parts.push(String(currentId));
  history.replaceState(null, "", `#${parts.map((p, i) => (i === 0 ? encodeURI(p) : p)).join("/")}`);
}

async function openArchive(path: string): Promise<OpenArchive> {
  if (current?.path === path) return current;
  const response = await fetch(urlOf(path));
  if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
  const archive = MohawkArchive.parse(new Uint8Array(await response.arrayBuffer()));
  const shpls = archive.ids(TAG_SHPL).map((id) => ({ id, list: parseShpl(archive.get(TAG_SHPL, id)) }));
  return { path, name: baseName(path), archive, shpls, shapeCache: new Map() };
}

function disposeAll(): void {
  for (const dispose of disposers) dispose();
  disposers = [];
}

async function selectArchive(path: string): Promise<void> {
  const token = ++loadToken;
  disposeAll();
  for (const [p, b] of archiveButtons) b.setAttribute("aria-current", String(p === path));
  main.replaceChildren(h("h2", {}, path), h("p", { class: "loading" }, "chargement…"));
  try {
    const next = await openArchive(path);
    if (token !== loadToken) return;
    current = next;
    currentTag = undefined;
    currentId = undefined;
    setHash();
    renderArchive();
  } catch (error) {
    if (token === loadToken) main.replaceChildren(h("h2", {}, path), h("p", { class: "error" }, (error as Error).message));
  }
}

function renderArchive(): void {
  const open = current!;
  const { archive } = open;
  typeBar.replaceChildren(
    ...archive.types().map((tag) =>
      button(`${tagLabel(tag)} (${archive.count(tag)})`, () => void selectType(tag), { class: "chip", "aria-pressed": String(tag === currentTag) }),
    ),
  );
  idBar.replaceChildren();
  detail.replaceChildren();
  main.replaceChildren(
    h("h2", {}, `${open.path} · ${formatSize(files.size(open.path) ?? 0)}`),
    info(["Types", archive.types().length], ["SHPL", open.shpls.length]),
    typeBar,
    idBar,
    detail,
  );
}

function selectType(tag: string): void {
  const open = current!;
  disposeAll();
  currentTag = tag;
  currentId = undefined;
  setHash();
  for (const b of typeBar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.textContent?.startsWith(`${tagLabel(tag)} (`)));
  const chips = h("div", { class: "chips idlist" });
  for (const id of open.archive.ids(tag)) chips.append(button(String(id), () => void selectResource(tag, id), { class: "chip", "data-id": String(id) }));
  idBar.replaceChildren(h("h3", {}, `${tagLabel(tag)} : ${open.archive.count(tag)} ressource(s)`), chips);
  detail.replaceChildren();
}

async function selectResource(tag: string, id: number): Promise<void> {
  const open = current!;
  const token = ++loadToken;
  disposeAll();
  if (currentTag !== tag) selectType(tag);
  currentId = id;
  setHash();
  for (const b of idBar.querySelectorAll<HTMLButtonElement>("button[data-id]")) b.setAttribute("aria-current", String(b.dataset.id === String(id)));
  const bytes = open.archive.find(tag, id);
  if (!bytes) {
    detail.replaceChildren(h("p", { class: "error" }, `${tagLabel(tag)} ${id} absente de l'archive`));
    return;
  }
  detail.replaceChildren(h("h3", {}, `${tagLabel(tag)} ${id} · ${formatSize(bytes.length)}`), h("p", { class: "loading" }, "chargement…"));
  try {
    const panel = PANELS[tag] ?? rawPanel;
    const body = await panel({ open, tag, id, bytes, goto: (t, i) => void selectResource(t, i) });
    if (token !== loadToken) return;
    detail.replaceChildren(h("h3", {}, `${tagLabel(tag)} ${id} · ${formatSize(bytes.length)}`), body);
  } catch (error) {
    if (token === loadToken) detail.replaceChildren(h("h3", {}, `${tagLabel(tag)} ${id}`), h("p", { class: "error" }, (error as Error).message), h("pre", {}, hexDump(bytes, 512)));
  }
}

function buildSidebar(archives: string[]): void {
  const search = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer les archives" });
  const ul = h("ul", {});
  const items = archives.map((path) => {
    const b = h("button", { type: "button", class: "file", title: path }, baseName(path), h("span", { class: "ext" }, formatSize(files.size(path) ?? 0)));
    b.addEventListener("click", () => void selectArchive(path));
    archiveButtons.set(path, b);
    const li = h("li", {}, b);
    ul.append(li);
    return { li, name: path.toLowerCase() };
  });
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    for (const item of items) item.li.hidden = query !== "" && !item.name.includes(query);
  });
  sidebar.replaceChildren(search, ul);
}

async function start(): Promise<void> {
  main.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  try {
    files = await fetchGameFiles(BASE);
  } catch (error) {
    main.replaceChildren(
      h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`),
      h("p", { class: "empty" }, "Lancer scripts/mathemagique-extract.sh"),
    );
    return;
  }
  const archives = files.list((p) => /\.(dat|mhk)$/i.test(p));
  if (archives.length === 0) {
    main.replaceChildren(h("p", { class: "empty" }, "aucune archive"));
    return;
  }
  buildSidebar(archives);
  // Hash : `ARCHIVE.DAT[/TAG[/id]]` ; le chemin de l'archive peut contenir `/` (MPC/PVG.MHK).
  const hash = decodeURI(location.hash.slice(1));
  const path = archives.find((a) => hash === a || hash.startsWith(`${a}/`));
  if (!path) {
    main.replaceChildren(h("p", { class: "empty" }, "choisir une archive"));
    return;
  }
  await selectArchive(path);
  const [tag, id] = hash.slice(path.length + 1).split("/");
  if (current && tag) {
    const decoded = decodeURIComponent(tag);
    if (current.archive.types().includes(decoded)) {
      selectType(decoded);
      if (id !== undefined && id !== "") await selectResource(decoded, Number(id));
    }
  }
}

void start();
