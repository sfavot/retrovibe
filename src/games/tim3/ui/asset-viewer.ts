/**
 * Visionneuse de ressources de The Incredible Machine 3 : outil de développement, hors du build du site.
 * Page : `/src/games/tim3/ui/asset-viewer.html` (serveur de dev Vite). Les ressources viennent des volumes Dynamix
 * (`RESOURCE.MAP/.001/.002` + `FRENCH.DAT` par-dessus) de `original/tim3/`, servi en `/tim3/`.
 * Neuf onglets : images, animations, palettes, polices, pièces, niveaux, textes, ITF, sons. La palette choisie en haut
 * s'applique à tous les rendus indexés (index 0 = transparent).
 */
import { fetchGameFiles } from "../../../data/game-files";
import { fetchBytes } from "../../../ui/files";
import { h } from "../../../ui/asset-viewer/helpers";
import { readAnm, type Anm, type AnmCommand } from "../data/anm";
import { readBitmap, type Bitmap, type BitmapFrame } from "../data/bitmap";
import { glyphFor, readFnt, readPft, type Font } from "../data/font";
import { readItf, ITF_KINDS } from "../data/itf";
import { binParts, levelParts, readLev, type LevPart } from "../data/lev";
import { readPalette } from "../data/palette";
import { readPartDef, type PartDef } from "../data/part-def";
import { readSoundEffect } from "../data/wave";
import { loadTexts, type GameTexts } from "../data/text";
import { ResourceIndex } from "../data/volume";
import { step } from "../engine/step";
import { TypeTable } from "../engine/types";
import { World } from "../engine/world";
import { PLAYFIELD, RenderAssets, SCREEN_HEIGHT, SCREEN_WIDTH, composeScreen } from "../render";

const BASE = "/tim3";
const DEFAULT_PALETTE = "TIM_NEW.PAL";
const SAMPLE_TEXT = "Le vieux zèbre jugeait: « Qu'exquis whisky! » 0123456789";

let index: ResourceIndex;
let texts: GameTexts;
let renderAssets: RenderAssets;
let typeTable: TypeTable | undefined;
/** Durée d'un pas de simulation (plan D10). */
const STEP_MS = 32;
let palette = DEFAULT_PALETTE;
let audioContext: AudioContext | undefined;

// ---------------------------------------------------------------- caches et dessin

const bitmaps = new Map<string, Bitmap | null>();
const luts = new Map<string, Uint32Array>();
const frameCanvases = new WeakMap<BitmapFrame, Map<string, HTMLCanvasElement>>();

function getBitmap(name: string): Bitmap | null {
  const key = name.toUpperCase();
  if (!bitmaps.has(key)) {
    let bmp: Bitmap | null = null;
    if (index.has(key)) bmp = readBitmap(index.get(key));
    bitmaps.set(key, bmp);
  }
  return bitmaps.get(key) ?? null;
}

function getLut(name: string): Uint32Array {
  let lut = luts.get(name);
  if (!lut) {
    const rgba = readPalette(index.get(name));
    lut = new Uint32Array(rgba.buffer, rgba.byteOffset, 256).slice();
    luts.set(name, lut);
  }
  return lut;
}

/** Canvas d'une image, index 0 transparent, dans la palette courante. */
function frameCanvas(frame: BitmapFrame): HTMLCanvasElement {
  let byPalette = frameCanvases.get(frame);
  if (!byPalette) frameCanvases.set(frame, (byPalette = new Map()));
  let canvas = byPalette.get(palette);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, frame.width);
    canvas.height = Math.max(1, frame.height);
    const ctx = canvas.getContext("2d")!;
    const data = ctx.createImageData(canvas.width, canvas.height);
    const out = new Uint32Array(data.data.buffer);
    const lut = getLut(palette);
    for (let i = 0; i < frame.pixels.length; i++) out[i] = lut[frame.pixels[i]!]!;
    ctx.putImageData(data, 0, 0);
    byPalette.set(palette, canvas);
  }
  return canvas;
}

/** `flip` : 0 aucun, 1 vertical, 2 horizontal, 3 les deux (convention des commandes ANM). */
function drawFrame(ctx: CanvasRenderingContext2D, frame: BitmapFrame, x: number, y: number, flip = 0): void {
  const src = frameCanvas(frame);
  if (flip === 0) {
    ctx.drawImage(src, x, y);
    return;
  }
  ctx.save();
  ctx.translate(x + (flip & 2 ? frame.width : 0), y + (flip & 1 ? frame.height : 0));
  ctx.scale(flip & 2 ? -1 : 1, flip & 1 ? -1 : 1);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

function rgbOf(color: number): string {
  const c = getLut(palette)[color & 255]!;
  return `rgb(${c & 255},${(c >> 8) & 255},${(c >> 16) & 255})`;
}

function canvasOf(width: number, height: number, scale = 1): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function toolbarRange(label: string, min: number, max: number, value: number, onInput: (v: number) => void): HTMLElement {
  const input = h("input", { type: "range", min: String(min), max: String(max), value: String(value) });
  const out = h("span", {}, String(value));
  input.addEventListener("input", () => {
    out.textContent = input.value;
    onInput(Number(input.value));
  });
  return h("label", {}, `${label} `, input, " ", out);
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox" });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", {}, input, ` ${label}`);
}

function table(head: string[], rows: (string | number | Node)[][], numeric = false): HTMLTableElement {
  const t = h("table");
  t.append(h("thead", {}, h("tr", {}, ...head.map((c) => h("th", {}, c)))));
  const body = h("tbody");
  for (const row of rows) {
    body.append(
      h("tr", {}, ...row.map((c) => h("td", { class: numeric && typeof c === "number" ? "num" : typeof c === "string" && c.length > 40 ? "text" : "" }, typeof c === "number" ? String(c) : c))),
    );
  }
  t.append(body);
  return t;
}

function dl(entries: [string, string | number][]): HTMLElement {
  const d = h("dl", { class: "info" });
  for (const [k, v] of entries) d.append(h("dt", {}, k), h("dd", {}, String(v)));
  return d;
}

function hex(n: number): string {
  return `0x${n.toString(16)}`;
}

// ---------------------------------------------------------------- types de pièces

function partName(type: number): string {
  const info = texts.parts.find((p) => p.id === type);
  return info ? info.name : `type ${type}`;
}

// ---------------------------------------------------------------- onglets

interface Tab {
  id: string;
  label: string;
  /** Noms affichés dans la liste ; absent = pas de liste (page unique). */
  names?(): string[];
  /** Légende à côté d'un nom. */
  note?(name: string): string;
  render(name: string | undefined, main: HTMLElement): void | Promise<void>;
}

function resourcesWith(pattern: RegExp): string[] {
  return index.names().filter((n) => pattern.test(n));
}

/** Tri naturel : PART2 avant PART10. */
function natural(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

const LEVEL_GROUPS: [string, number][] = [
  ["TLEV", 0],
  ["ELEV", 40],
  ["MLEV", 66],
  ["HLEV", 96],
  ["RLEV", 127],
  ["HH", 156],
];

/** Rang d'un puzzle dans LEVELS.INF d'après son nom (`ELEV3.LEV` → 42). */
function levelRank(name: string): number {
  const m = /^([A-Z]+?)(\d+)\.LEV$/i.exec(name);
  if (!m) return -1;
  const group = LEVEL_GROUPS.find(([prefix]) => prefix === m[1]!.toUpperCase());
  return group ? group[1] + Number(m[2]) - 1 : -1;
}

// --- Images

const imagesTab: Tab = {
  id: "images",
  label: "Images",
  names: () => resourcesWith(/\.BMP$/i).sort(natural),
  render(name, main) {
    if (!name) return;
    const bmp = getBitmap(name)!;
    let scale = 1;
    let checker = true;
    const stage = h("div", { class: "cols" });
    const draw = () => {
      stage.replaceChildren();
      bmp.frames.forEach((frame, i) => {
        const c = frameCanvas(frame);
        const copy = canvasOf(c.width, c.height, scale);
        copy.ctx.drawImage(c, 0, 0);
        if (checker) copy.canvas.className = "checker";
        stage.append(h("figure", { style: "margin:0" }, copy.canvas, h("figcaption", {}, `#${i} ${frame.width}×${frame.height}`)));
      });
    };
    main.append(
      h("h2", {}, name),
      dl([
        ["Images", bmp.frames.length],
        ["Volume", index.entry(name)?.volume ?? ""],
        ["Palette", palette],
      ]),
      h("div", { class: "bar" }, toolbarRange("échelle", 1, 6, 1, (v) => ((scale = v), draw())), checkbox("damier (index 0 transparent)", true, (v) => ((checker = v), draw()))),
      stage,
    );
    draw();
  },
};

// --- Animations

function runCommands(ctx: CanvasRenderingContext2D, anm: Anm, commands: AnmCommand[], ox: number, oy: number): void {
  for (const c of commands) {
    if (c.op === "bitmap") {
      const name = anm.images.find((i) => i.id === c.image)?.name;
      const bmp = name ? getBitmap(name) : null;
      const frame = bmp?.frames[c.frame];
      if (frame) drawFrame(ctx, frame, ox + c.x, oy + c.y, c.flip);
    } else if (c.op === "rect") {
      ctx.fillStyle = rgbOf(c.color);
      if (c.fill & 0x8000) ctx.fillRect(ox + c.x, oy + c.y, c.width, c.height);
      else {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.strokeRect(ox + c.x + 0.5, oy + c.y + 0.5, c.width - 1, c.height - 1);
      }
    } else if (c.op === "line") {
      ctx.strokeStyle = rgbOf(c.color);
      ctx.beginPath();
      ctx.moveTo(ox + c.x1 + 0.5, oy + c.y1 + 0.5);
      ctx.lineTo(ox + c.x2 + 0.5, oy + c.y2 + 0.5);
      ctx.stroke();
    }
  }
}

function describeCommand(c: AnmCommand): string {
  switch (c.op) {
    case "bitmap":
      return `bitmap image ${c.image} #${c.frame} (${c.x},${c.y}) flip ${c.flip}`;
    case "rect":
      return `rect (${c.x},${c.y}) ${c.width}×${c.height} couleur ${c.color} fill ${hex(c.fill)}`;
    case "line":
      return `line (${c.x1},${c.y1})→(${c.x2},${c.y2}) couleur ${c.color}`;
    case "sound":
      return `son ${c.sound}`;
    case "soundEx":
      return `son ${c.sound} (${c.unknown04}, ${c.unknown06})`;
    default:
      return c.op;
  }
}

const anmTab: Tab = {
  id: "anim",
  label: "Animations",
  names: () => resourcesWith(/\.ANM$/i).sort(natural),
  render(name, main, ) {
    if (!name) return;
    const anm = readAnm(index.get(name));
    const steps = anm.sequence.length > 0 ? anm.sequence : anm.frames.map((_, i) => i);
    const PAD = 80;
    const W = Math.max(anm.width, 1) + PAD * 2;
    const H = Math.max(anm.height, 1) + PAD * 2;
    const { canvas, ctx } = canvasOf(W, H, 1);
    canvas.className = "checker";
    const state = { step: 0, playing: false, scale: 2, useOffset: true, timer: 0 };
    const info = h("div", { class: "info" });
    const cmds = h("pre", {});
    const slider = h("input", { type: "range", min: "0", max: String(Math.max(steps.length - 1, 0)), value: "0" });
    const draw = () => {
      canvas.style.width = `${W * state.scale}px`;
      canvas.style.height = `${H * state.scale}px`;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#444";
      ctx.strokeRect(PAD - 0.5, PAD - 0.5, anm.width + 1, anm.height + 1);
      const frame = anm.frames[steps[state.step] ?? 0];
      if (!frame) return;
      runCommands(ctx, anm, frame.commands, PAD + (state.useOffset ? frame.x : 0), PAD + (state.useOffset ? frame.y : 0));
      slider.value = String(state.step);
      info.textContent = `étape ${state.step + 1}/${steps.length} → image ${steps[state.step]} · décalage (${frame.x},${frame.y}) · ${frame.width}×${frame.height}`;
      cmds.textContent = frame.commands.map(describeCommand).join("\n");
    };
    const stop = () => {
      state.playing = false;
      clearInterval(state.timer);
    };
    const play = h("button", {}, "Lecture");
    play.addEventListener("click", () => {
      if (state.playing) {
        stop();
        play.textContent = "Lecture";
        return;
      }
      state.playing = true;
      play.textContent = "Pause";
      state.timer = window.setInterval(() => {
        state.step = (state.step + 1) % steps.length;
        draw();
      }, 100);
    });
    slider.addEventListener("input", () => {
      state.step = Number(slider.value);
      draw();
    });
    disposers.push(stop);
    const stateButtons = anm.states.map((s) => {
      const b = h("button", {}, `état ${s.state}`);
      b.addEventListener("click", () => {
        state.step = Math.min(s.first, steps.length - 1);
        draw();
      });
      return b;
    });
    main.append(
      h("h2", {}, name),
      dl([
        ["Version", anm.version],
        ["Taille", `${anm.width}×${anm.height}`],
        ["Images", anm.frames.length],
        ["Séquence", anm.sequence.length ? anm.sequence.join(" ") : "(vide : images dans l'ordre)"],
        ["BMP", anm.images.map((i) => `${i.id}=${i.name}`).join(", ")],
        ["Étiquettes", anm.labels.map((l) => `${l.id}=${l.text}`).join(", ") || "—"],
        ["États", anm.states.map((s) => `${s.state}→${s.first}`).join(" ") || "—"],
      ]),
      h("div", { class: "bar" }, play, slider, toolbarRange("échelle", 1, 6, 2, (v) => ((state.scale = v), draw())), checkbox("décalage de l'image (x,y)", true, (v) => ((state.useOffset = v), draw()))),
      h("div", { class: "bar" }, ...stateButtons),
      info,
      h("div", { class: "stage" }, canvas),
      h("h3", {}, "Commandes de l'image"),
      cmds,
    );
    draw();
  },
};

// --- Palettes

const palettesTab: Tab = {
  id: "palettes",
  label: "Palettes",
  names: () => resourcesWith(/\.PAL$/i).sort(natural),
  render(name, main) {
    if (!name) return;
    const rgba = readPalette(index.get(name));
    const { canvas, ctx } = canvasOf(16 * 24, 16 * 24);
    for (let i = 0; i < 256; i++) {
      ctx.fillStyle = `rgb(${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]})`;
      ctx.fillRect((i % 16) * 24, Math.floor(i / 16) * 24, 24, 24);
    }
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      const i = Math.floor(((e.clientY - r.top) / r.height) * 16) * 16 + Math.floor(((e.clientX - r.left) / r.width) * 16);
      canvas.title = `#${i} rgb(${rgba[i * 4]}, ${rgba[i * 4 + 1]}, ${rgba[i * 4 + 2]})`;
    });
    const distinct = new Set<number>();
    for (let i = 0; i < 256; i++) distinct.add((rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!);
    const use = h("button", {}, "Utiliser cette palette");
    use.addEventListener("click", () => setPalette(name));
    main.append(h("h2", {}, name), dl([["Couleurs distinctes", distinct.size], ["Index 0", `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]}) alpha ${rgba[3]}`]]), use, h("div", { class: "stage", style: "margin-top:8px" }, canvas));
  },
};

// --- Polices

function readFont(name: string): Font {
  const bytes = index.get(name);
  return /\.PFT$/i.test(name) ? readPft(bytes) : readFnt(bytes);
}

const fontsTab: Tab = {
  id: "polices",
  label: "Polices",
  names: () => resourcesWith(/\.(FNT|PFT)$/i).sort(natural),
  render(name, main) {
    if (!name) return;
    const font = readFont(name);
    const lut = getLut(palette);
    const ink = font.kind === "fnt" ? 1 : 0xff;
    const drawText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) => {
      let cx = x;
      for (const ch of text) {
        const code = ch.charCodeAt(0) > 255 ? 63 : toLatin1(ch);
        const g = glyphFor(font, code);
        if (!g) {
          cx += Math.floor(font.height / 2);
          continue;
        }
        ctx.fillStyle = color;
        for (let py = 0; py < g.height; py++) for (let px = 0; px < g.width; px++) if (g.pixels[py * g.width + px] === ink || (font.kind === "pft" && g.pixels[py * g.width + px]! > 0)) ctx.fillRect(cx + px, y + py, 1, 1);
        cx += g.width + 1;
      }
      return cx;
    };
    void lut;
    const { canvas, ctx } = canvasOf(640, font.height * 3 + 16, 2);
    ctx.fillStyle = "#101014";
    ctx.fillRect(0, 0, 640, canvas.height);
    drawText(ctx, SAMPLE_TEXT, 4, 4, "#fff");
    drawText(ctx, SAMPLE_TEXT.toUpperCase(), 4, 4 + font.height + 2, "#9fd49f");
    const rows = Math.ceil(font.glyphs.length / 32);
    const cellW = Math.max(...font.glyphs.map((g) => g.width), 4) + 2;
    const grid = canvasOf(cellW * 32, (font.height + 2) * rows, 2);
    grid.ctx.fillStyle = "#101014";
    grid.ctx.fillRect(0, 0, grid.canvas.width, grid.canvas.height);
    font.glyphs.forEach((g, i) => {
      const gx = (i % 32) * cellW;
      const gy = Math.floor(i / 32) * (font.height + 2);
      grid.ctx.fillStyle = "#d8dae0";
      for (let py = 0; py < g.height; py++) for (let px = 0; px < g.width; px++) if (g.pixels[py * g.width + px]) grid.ctx.fillRect(gx + px, gy + py, 1, 1);
    });
    main.append(
      h("h2", {}, name),
      dl([["Genre", font.kind], ["Hauteur", font.height], ["Ligne de base", font.baseline], ["Premier code", font.firstChar], ["Glyphes", font.glyphs.length]]),
      h("div", { class: "stage" }, canvas),
      h("h3", {}, "Tous les glyphes (32 par ligne, à partir du premier code)"),
      h("div", { class: "stage" }, grid.canvas),
    );
  },
};

/** Caractère Unicode → octet Windows-1252 pour les accents courants. */
function toLatin1(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 256) return code;
  return 63;
}

// --- Pièces

function drawPartPolygons(ctx: CanvasRenderingContext2D, def: PartDef, ox: number, oy: number): void {
  def.polygons.forEach((poly, i) => {
    ctx.strokeStyle = i % 2 ? "#ffd24a" : "#4aff7a";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    poly.vertices.forEach((v, k) => (k === 0 ? ctx.moveTo(ox + v.x + 0.5, oy + v.y + 0.5) : ctx.lineTo(ox + v.x + 0.5, oy + v.y + 0.5)));
    ctx.closePath();
    ctx.stroke();
    for (const v of poly.vertices) ctx.fillRect(ox + v.x - 1, oy + v.y - 1, 3, 3);
  });
}

const partsTab: Tab = {
  id: "pieces",
  label: "Pièces",
  names: () => resourcesWith(/^PART\d+\.PAR$/i).sort(natural),
  note: (name) => {
    const type = Number(/\d+/.exec(name)![0]);
    return partName(type);
  },
  render(name, main) {
    if (!name) return;
    const type = Number(/\d+/.exec(name)![0]);
    const def = readPartDef(index.get(name));
    const bmp = getBitmap(`PART${type}.BMP`);
    const anm = index.has(`PART${type}.ANM`) ? readAnm(index.get(`PART${type}.ANM`)) : null;
    const info = texts.parts.find((p) => p.id === type);
    const state = { frame: 0, scale: 4, polygons: true, origin: 0 };
    const stage = h("div", { class: "stage" });
    const draw = () => {
      stage.replaceChildren();
      const frame = bmp?.frames[state.frame];
      const w = Math.max(frame?.width ?? 0, def.width, 8);
      const hh = Math.max(frame?.height ?? 0, def.height, 8);
      const PAD = 16;
      const { canvas, ctx } = canvasOf(w + PAD * 2, hh + PAD * 2, state.scale);
      canvas.className = "checker";
      ctx.strokeStyle = "#555";
      ctx.strokeRect(PAD - 0.5, PAD - 0.5, def.width + 1, def.height + 1);
      if (frame) drawFrame(ctx, frame, PAD, PAD);
      const ox = state.origin === 0 ? PAD : PAD + Math.floor(def.width / 2);
      const oy = state.origin === 0 ? PAD : PAD + Math.floor(def.height / 2);
      if (state.polygons) drawPartPolygons(ctx, def, ox, oy);
      stage.append(canvas);
    };
    const origin = h("select", {}, h("option", { value: "0" }, "polygones : origine = coin haut-gauche"), h("option", { value: "1" }, "polygones : origine = centre de la boîte"));
    origin.addEventListener("change", () => ((state.origin = Number(origin.value)), draw()));
    const nFrames = bmp?.frames.length ?? 1;
    main.append(
      h("h2", {}, `${name} — ${partName(type)}`),
      h("p", { class: "hint-fr" }, info?.description ?? ""),
      h("div", { class: "bar" }, toolbarRange("image", 0, Math.max(nFrames - 1, 0), 0, (v) => ((state.frame = v), draw())), toolbarRange("échelle", 1, 8, 4, (v) => ((state.scale = v), draw())), checkbox("polygones", true, (v) => ((state.polygons = v), draw())), origin),
      stage,
      h("h3", {}, "Valeurs du PAR"),
      dl([
        ["Image", bmp ? `PART${type}.BMP (${nFrames} images)` : "aucun PART" + type + ".BMP"],
        ["Boîte", `${def.width}×${def.height}`],
        ["Densité / masse / élasticité", `${def.density} / ${def.mass} / ${def.elasticity} (${hex(def.elasticity)})`],
        ["Drapeaux", `${hex(def.flags)} (miroir : ${hex(def.shapeFlags)})`],
        ["Mots 4–8", [def.unknown04, def.unknown05, def.unknown06, def.unknown07, def.unknown08].join(", ")],
        ["Polygones", def.polygons.map((p, i) => `#${i} ${p.vertices.length} sommets (${p.unknownA}, ${p.unknownB})`).join(" · ") || "aucun"],
      ]),
      h("p", {}, anm ? `PART${type}.ANM : ${anm.frames.length} images, séquence [${anm.sequence.join(" ")}], états ${anm.states.map((s) => `${s.state}→${s.first}`).join(" ")}` : "pas d'ANM"),
      h("details", {}, h("summary", {}, "Sommets"), h("pre", {}, def.polygons.map((p, i) => `polygone ${i}: ${p.vertices.map((v) => `(${v.x},${v.y}${v.flag ? "*" : ""})`).join(" ")}`).join("\n"))),
    );
    draw();
  },
};

// --- Niveaux

const levelsTab: Tab = {
  id: "niveaux",
  label: "Niveaux",
  names: () => resourcesWith(/^[A-Z]+\d+\.LEV$/i).sort((a, b) => levelRank(a) - levelRank(b)),
  note: (name) => {
    const rank = levelRank(name);
    return texts.levels[rank]?.title ?? "";
  },
  render(name, main) {
    if (!name) return;
    const level = readLev(index.get(name));
    const rank = levelRank(name);
    const text = texts.levels[rank];
    const state = { scale: 1, hints: true, conditions: true, chrome: true };
    const stage = h("div", { class: "stage" });
    const status = h("span", { class: "hint-en" }, "arrêté");
    const types = (typeTable ??= new TypeTable({
      anm: (t) => (index.has(`PART${t}.ANM`) ? readAnm(index.get(`PART${t}.ANM`)) : null),
      par: (t) => (index.has(`PART${t}.PAR`) ? readPartDef(index.get(`PART${t}.PAR`)) : null),
    }));
    let world = World.load(types, level);
    let steps = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const { canvas, ctx } = canvasOf(SCREEN_WIDTH, SCREEN_HEIGHT);
    const lut = renderAssets.gameLut();
    const draw = () => {
      canvas.style.width = `${SCREEN_WIDTH * state.scale}px`;
      canvas.style.height = `${SCREEN_HEIGHT * state.scale}px`;
      const screen = composeScreen(renderAssets, world, { backgroundColor: level.prefix?.backgroundColor, goal: text?.goal ?? level.goal, running: timer !== undefined, chrome: state.chrome });
      const data = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      new Uint32Array(data.data.buffer).set(screen.toRgba(lut));
      ctx.putImageData(data, 0, 0);
      if (state.hints) {
        level.hints.forEach((hint, i) => {
          if (i >= level.hintCount) return;
          ctx.fillStyle = "#6f6";
          ctx.fillRect(PLAYFIELD.x + hint.x - 3, PLAYFIELD.y + hint.y - 3, 7, 7);
          ctx.fillStyle = "#fff";
          ctx.fillText(String(i + 1), PLAYFIELD.x + hint.x + 6, PLAYFIELD.y + hint.y + 4);
        });
      }
      if (state.conditions) {
        ctx.strokeStyle = "#f0f";
        for (const c of level.solution.conditions) {
          if (c.partIndex === -1 || c.rectWidth <= 0) continue;
          ctx.strokeRect(PLAYFIELD.x + c.rectX + 0.5, PLAYFIELD.y + c.rectY + 0.5, c.rectWidth, c.rectHeight);
        }
      }
      status.textContent = timer !== undefined ? `en marche : pas ${steps} (${STEP_MS} ms)` : `arrêté${steps ? ` après ${steps} pas` : ""}`;
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    disposers.push(stop);
    const startButton = h("button", { type: "button" }, "Démarrer");
    const resetButton = h("button", { type: "button" }, "Remettre à zéro");
    startButton.addEventListener("click", () => {
      if (timer !== undefined) {
        stop();
        startButton.textContent = "Reprendre";
        draw();
        return;
      }
      startButton.textContent = "Arrêter";
      timer = setInterval(() => {
        step(world);
        steps++;
        draw();
      }, STEP_MS);
      draw();
    });
    resetButton.addEventListener("click", () => {
      stop();
      startButton.textContent = "Démarrer";
      world = World.load(types, level);
      steps = 0;
      draw();
    });
    stage.append(canvas);
    const all = levelParts(level);
    const bin = binParts(level);
    const counts = new Map<number, number>();
    for (const p of bin) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    const conditionRows = level.solution.conditions.map((c, i) => {
      const part = all[c.partIndex];
      return [i + 1, c.partIndex, part ? `${partName(part.type)} (type ${part.type})` : "(libre)", `${c.state1}–${c.state2}`, c.count, `${c.rectX},${c.rectY} ${c.rectWidth}×${c.rectHeight}`];
    });
    main.append(
      h("h2", {}, `${name} — ${text?.title ?? level.title}`),
      dl([
        ["Version", hex(level.version)],
        ["Couleur de fond", level.prefix ? level.prefix.backgroundColor : "—"],
        ["Pression / gravité", `${level.info.pressure} / ${level.info.gravity}`],
        ["Musique", level.info.music ? `SX_${level.info.music}.HMI (${texts.music.find((m) => m.id === level.info.music)?.text ?? "?"})` : "aucune"],
        ["Pièces", `${level.fixedParts.length} fixes + ${level.movingParts.length} mobiles, dont ${bin.length} dans le bac`],
        ["Délai solution", level.solution.delay],
        ["Types non portés par le moteur", world.unportedTypes().join(", ") || "aucun (simulation exacte)"],
      ]),
      h("div", { class: "bar" }, startButton, resetButton, status, toolbarRange("échelle", 1, 3, 1, (v) => ((state.scale = v), draw())), checkbox("interface (barre, bac, but)", true, (v) => ((state.chrome = v), draw())), checkbox("indices", true, (v) => ((state.hints = v), draw())), checkbox("zones de conditions", true, (v) => ((state.conditions = v), draw()))),
      stage,
      h("h3", {}, "But"),
      h("p", { class: "hint-fr" }, text?.goal ?? ""),
      h("p", { class: "hint-en" }, level.goal),
      h("h3", {}, "Indices"),
      table(["#", "Position", "Français", "Anglais"], level.hints.slice(0, level.hintCount).map((hint, i) => [i + 1, `${hint.x},${hint.y} flip ${hint.flip ?? "—"}`, text?.hints[i] ?? "", hint.text])),
      h("h3", {}, "Bac"),
      table(["Type", "Pièce", "Nombre"], [...counts].map(([t, n]) => [t, partName(t), n])),
      h("h3", {}, "Conditions"),
      table(["#", "Pièce n°", "Pièce", "États", "Nombre", "Zone"], conditionRows.filter((r) => r[1] !== -1)),
      h("h3", {}, "Pièces"),
      table(["#", "Type", "Pièce", "Genre", "x,y", "l1×h1", "Image", "flags1/2/3"], all.map((p: LevPart, i) => [i, p.type, partName(p.type), p.kind, `${p.x},${p.y}`, `${p.width1}×${p.height1}`, p.appearance, `${hex(p.flags1)} ${hex(p.flags2)} ${hex(p.flags3)}`])),
    );
    draw();
  },
};

// --- Textes

const textsTab: Tab = {
  id: "textes",
  label: "Textes",
  names: () => ["LEVELS.INF", "INFO.RES", "MUSIC.RES", "SOUND.RES", "SYSTEM.RES"],
  render(name, main) {
    if (!name) return;
    const filter = h("input", { type: "search", placeholder: "filtrer…" });
    const body = h("div");
    let rows: (string | number)[][] = [];
    let head: string[] = [];
    switch (name) {
      case "LEVELS.INF":
        head = ["#", "Titre", "But", "Indices"];
        rows = texts.levels.map((l, i) => [i, l.title, l.goal, l.hints.filter(Boolean).join("\n— ")]);
        break;
      case "INFO.RES":
        head = ["Type", "Nom", "Description"];
        rows = texts.parts.map((p) => [p.id, p.name, p.description]);
        break;
      case "MUSIC.RES":
        head = ["Id", "Texte"];
        rows = texts.music.map((m) => [m.id, m.text]);
        break;
      case "SOUND.RES":
        head = ["Id", "Texte"];
        rows = texts.sounds.map((m) => [m.id, m.text]);
        break;
      default:
        head = ["#", "Ligne"];
        rows = texts.system.map((s, i) => [i, s]);
    }
    const show = () => {
      const q = filter.value.toLowerCase();
      body.replaceChildren(table(head, rows.filter((r) => !q || r.some((c) => String(c).toLowerCase().includes(q)))));
    };
    filter.addEventListener("input", show);
    main.append(h("h2", {}, `${name} (${rows.length})`), filter, body);
    show();
  },
};

// --- ITF

const itfTab: Tab = {
  id: "itf",
  label: "ITF",
  names: () => resourcesWith(/\.ITF$/i).sort(natural),
  render(name, main) {
    if (!name) return;
    const itf = readItf(index.get(name));
    const anm = itf.anm && index.has(itf.anm) ? readAnm(index.get(itf.anm)) : null;
    const state = { images: true, labels: true, scale: 1 };
    const stage = h("div", { class: "stage" });
    const colors: Record<number, string> = { 0: "#888", 1: "#4aff7a", 2: "#6aa2ff", 3: "#ffd24a", 4: "#ff7bd0", 5: "#ff9a4a" };
    const draw = () => {
      stage.replaceChildren();
      const { canvas, ctx } = canvasOf(640, 480, state.scale);
      ctx.fillStyle = "#101014";
      ctx.fillRect(0, 0, 640, 480);
      for (const c of itf.controls) {
        if (state.images && anm && c.image === 1) {
          const frame = anm.frames[c.value];
          if (frame) runCommands(ctx, anm, frame.commands, c.x + frame.x, c.y + frame.y);
        }
        ctx.strokeStyle = colors[c.kind] ?? "#fff";
        ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.width, c.height);
        if (c.text) {
          ctx.strokeStyle = "#f0f";
          ctx.strokeRect(c.text.x + 0.5, c.text.y + 0.5, c.text.width, c.text.height);
        }
        if (state.labels) {
          ctx.fillStyle = colors[c.kind] ?? "#fff";
          ctx.font = "9px monospace";
          ctx.fillText(c.name ?? String(c.id), c.x + 2, c.y + 10);
        }
      }
      stage.append(canvas);
    };
    main.append(
      h("h2", {}, name),
      dl([["Version", itf.version], ["ANM", itf.anm || "—"], ["Contrôles", itf.controls.length], ["Genres (couleur du cadre)", "0 image gris · 1 button vert · 2 choice bleu · 3 toggle jaune · 4 text rose · 5 arrow orange"]]),
      h("div", { class: "bar" }, checkbox("images de l'ANM", true, (v) => ((state.images = v), draw())), checkbox("noms", true, (v) => ((state.labels = v), draw())), toolbarRange("échelle", 1, 2, 1, (v) => ((state.scale = v), draw()))),
      stage,
      table(["#", "Genre", "Id", "Nom", "x,y", "l×h", "image", "valeur"], itf.controls.map((c, i) => [i, `${c.kind} ${ITF_KINDS[c.kind as keyof typeof ITF_KINDS] ?? "?"}`, c.id, c.name ?? "", `${c.x},${c.y}`, `${c.width}×${c.height}`, c.image, c.value])),
    );
    draw();
  },
};

// --- Sons

const soundsTab: Tab = {
  id: "sons",
  label: "Sons",
  names: () => resourcesWith(/\.WAV$/i).sort(natural),
  note: (name) => {
    const id = Number(/\d+/.exec(name)?.[0]);
    return texts.sounds.find((s) => s.id === id)?.text ?? "";
  },
  render(name, main) {
    if (!name) return;
    const wave = readSoundEffect(index.get(name));
    const { canvas, ctx } = canvasOf(640, 100);
    ctx.fillStyle = "#101014";
    ctx.fillRect(0, 0, 640, 100);
    ctx.strokeStyle = "#6aa2ff";
    const ch = wave.channels[0]!;
    ctx.beginPath();
    for (let x = 0; x < 640; x++) {
      const i0 = Math.floor((x / 640) * ch.length);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / 640) * ch.length));
      let min = 1;
      let max = -1;
      for (let i = i0; i < i1 && i < ch.length; i++) {
        min = Math.min(min, ch[i]!);
        max = Math.max(max, ch[i]!);
      }
      ctx.moveTo(x + 0.5, 50 - max * 48);
      ctx.lineTo(x + 0.5, 50 - min * 48 + 1);
    }
    ctx.stroke();
    const play = h("button", {}, "Écouter");
    play.addEventListener("click", () => {
      audioContext ??= new AudioContext();
      void audioContext.resume();
      const buffer = audioContext.createBuffer(wave.channels.length, ch.length, wave.sampleRate);
      wave.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();
    });
    const id = Number(/\d+/.exec(name)?.[0]);
    main.append(h("h2", {}, name), dl([["Texte (SOUND.RES)", texts.sounds.find((s) => s.id === id)?.text ?? "—"], ["Fréquence", `${wave.sampleRate} Hz`], ["Bits", wave.bitsPerSample], ["Durée", `${wave.duration.toFixed(2)} s`], ["Octets étrangers", wave.trailer.length]]), play, h("div", { class: "stage", style: "margin-top:8px" }, canvas));
  },
};

const TABS: Tab[] = [imagesTab, anmTab, palettesTab, fontsTab, partsTab, levelsTab, textsTab, itfTab, soundsTab];

// ---------------------------------------------------------------- coquille

const root = document.getElementById("app")!;
const disposers: (() => void)[] = [];
let current = { tab: TABS[0]!.id, name: undefined as string | undefined };
let filterText = "";

function setPalette(name: string): void {
  palette = name;
  show();
}

function readHash(): void {
  const [tab, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/");
  const found = TABS.find((t) => t.id === tab);
  if (found) current = { tab: found.id, name: rest.join("/") || undefined };
}

function go(tab: string, name?: string): void {
  location.hash = `${tab}${name ? `/${encodeURIComponent(name)}` : ""}`;
}

function show(): void {
  for (const d of disposers.splice(0)) d();
  const tab = TABS.find((t) => t.id === current.tab)!;
  const names = tab.names?.() ?? [];
  if (names.length > 0 && !current.name) current.name = names[0];

  const tabs = h("div", { class: "tabs", role: "tablist" });
  for (const t of TABS) {
    const b = h("button", { role: "tab", "aria-selected": String(t.id === tab.id) }, t.label);
    b.addEventListener("click", () => go(t.id));
    tabs.append(b);
  }
  const select = h("select", { "aria-label": "Palette" });
  for (const p of resourcesWith(/\.PAL$/i).sort(natural)) {
    const o = h("option", { value: p }, p);
    if (p === palette) o.selected = true;
    select.append(o);
  }
  select.addEventListener("change", () => setPalette(select.value));
  const header = h("header", {}, h("h1", {}, "TIM3 — ressources"), tabs, h("label", { class: "pal-pick" }, "Palette ", select));

  const aside = h("aside");
  const main = h("main");
  const filter = h("input", { type: "search", placeholder: "filtrer…", value: filterText, "aria-label": "Filtrer" });
  const list = h("ul", { style: "list-style:none;margin:0;padding:0" });
  const fill = () => {
    list.replaceChildren();
    const q = filterText.toLowerCase();
    for (const n of names) {
      const note = tab.note?.(n) ?? "";
      if (q && !n.toLowerCase().includes(q) && !note.toLowerCase().includes(q)) continue;
      const b = h("button", { class: "file", "aria-current": String(n === current.name) }, n, note ? h("small", {}, note) : null);
      b.addEventListener("click", () => go(tab.id, n));
      list.append(h("li", {}, b));
    }
  };
  filter.addEventListener("input", () => {
    filterText = filter.value;
    fill();
  });
  aside.append(filter, list);
  fill();

  const body = h("div", { class: `tim3-body${names.length === 0 ? " wide" : ""}` }, ...(names.length > 0 ? [aside] : []), main);
  root.replaceChildren(h("div", { class: "tim3-viewer" }, header, body));
  list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  try {
    const result = tab.render(current.name, main);
    if (result) void result.catch((e: Error) => main.append(h("p", { class: "error" }, e.message)));
  } catch (error) {
    main.replaceChildren(h("p", { class: "error" }, `${current.name ?? tab.label} : ${(error as Error).stack ?? error}`));
  }
}

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, "chargement des volumes…"));
  try {
    await fetchGameFiles(BASE);
    const [map, v1, v2, french] = await Promise.all(["RESOURCE.MAP", "RESOURCE.001", "RESOURCE.002", "FRENCH.DAT"].map((f) => fetchBytes(BASE, f)));
    const volumes: Record<string, Uint8Array> = { "RESOURCE.001": v1!, "RESOURCE.002": v2! };
    index = new ResourceIndex().add(map!, (n) => {
      const v = volumes[n.toUpperCase()];
      if (!v) throw new Error(`volume inconnu : ${n}`);
      return v;
    });
    index.overlay(french!, "FRENCH.DAT");
    texts = loadTexts(index);
    renderAssets = new RenderAssets(index);
  } catch (error) {
    root.replaceChildren(h("p", { class: "error" }, `Ressources indisponibles : ${(error as Error).message}`), h("p", { class: "empty" }, "Lancer scripts/tim3-extract.sh"));
    return;
  }
  readHash();
  window.addEventListener("hashchange", () => {
    readHash();
    show();
  });
  show();
}

void start();
