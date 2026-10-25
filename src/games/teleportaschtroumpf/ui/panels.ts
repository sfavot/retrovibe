import { decodeCp437, encodeCp437 } from "../../../data/cp437";
import { extensionOf, baseName } from "../data/files";
import { LETTER_SPACING, advance, parsePfn } from "../data/font";
import { parseHy8, type Hy8 } from "../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH, parseMcg, parsePal } from "../data/mcg";
import { MuxDecoder } from "../data/mux";
import { MutFlag, parseMut, parsePrc } from "../data/mut";
import { parseDescription, parseKeyedTexts } from "../data/text";
import { parseVoc, vocToFloat32 } from "../data/voc";
import { boundsOf, placeFrame, placeSprite, type Bounds, type PlacedImage } from "../engine/sprites";
import { formatSize, h, hexDump, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import type { Panel, PanelContext } from "../../../ui/asset-viewer/viewer";
import { indexedCanvas, makeCanvas, paintIndexed, paintPlaced, paletteTable } from "./render";

/** Rendu d'un fichier : un panneau de la visionneuse est un `Render` associé à ses extensions (voir `PANELS`). */
type Render = (ctx: PanelContext) => Promise<HTMLElement> | HTMLElement;

const SCALE = 2;

function dir(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function info(...pairs: [string, string | number][]): HTMLElement {
  const list = h("dl", { class: "info" });
  for (const [key, value] of pairs) list.append(h("dt", {}, key), h("dd", {}, String(value)));
  return list;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = h("button", { type: "button" }, label);
  el.addEventListener("click", onClick);
  return el;
}

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h("section", {}, h("h3", {}, title), ...children);
}

/** Palette d'un MCG ou d'un PAL du jeu. */
async function loadPalette(ctx: PanelContext, path: string): Promise<Uint8Array> {
  const bytes = await ctx.fetchBytes(path);
  return extensionOf(path) === "MCG" ? parseMcg(bytes).palette : parsePal(bytes);
}

/** Les MCG/PAL de la scène (dossier `DATA/Snn`) du fichier, ceux de son dossier d'abord. */
function palettesNear(ctx: PanelContext): string[] {
  const scene = ctx.path.split("/").slice(0, 2).join("/") + "/";
  const folder = dir(ctx.path) + "/";
  const candidates = ctx.files.list((p) => p.startsWith(scene) && ["MCG", "PAL"].includes(extensionOf(p)));
  return [...candidates.filter((p) => p.startsWith(folder)), ...candidates.filter((p) => !p.startsWith(folder))];
}

const mcgPanel: Render = (ctx) => {
  const mcg = parseMcg(ctx.bytes);
  const canvas = indexedCanvas(mcg.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, paletteTable(mcg.palette, false), SCALE);
  return h(
    "div",
    {},
    info(["Taille", `${SCREEN_WIDTH}×${SCREEN_HEIGHT}`], ["En-tête", `0x${mcg.header.toString(16).padStart(4, "0")}`]),
    canvas,
    section("Palette", paletteSwatch(mcg.palette)),
  );
};

const palPanel: Render = (ctx) => {
  const palette = parsePal(ctx.bytes);
  return h("div", {}, section("Palette", paletteSwatch(palette, 18)));
};

const hy8Panel: Render = async (ctx) => {
  const hy8 = parseHy8(ctx.bytes);
  const root = h("div", {});
  const palettes = palettesNear(ctx);
  const select = h("select", {}, h("option", { value: "" }, "niveaux de gris"));
  for (const p of palettes) select.append(h("option", { value: p }, p.split("/").slice(2).join("/")));
  let table = paletteTable(null, true);
  let palette: Uint8Array | null = null;
  const body = h("div", {});
  let stopPlayer = () => {};
  ctx.onDispose(() => stopPlayer());

  const render = () => {
    stopPlayer();
    body.replaceChildren();
    body.append(info(["Images", hy8.images.length], ["Sprites", hy8.sprites.length], ["Animations", hy8.animations.length]));
    body.append(animationSection(hy8, table, (stop) => (stopPlayer = stop)));
    body.append(imagesSection(hy8, table), spritesSection(hy8, table));
  };

  const apply = async () => {
    try {
      palette = select.value ? await loadPalette(ctx, select.value) : null;
      table = paletteTable(palette, true);
    } catch (error) {
      palette = null;
      table = paletteTable(null, true);
      body.prepend(h("p", { class: "error" }, `Palette : ${(error as Error).message}`));
    }
    render();
  };
  select.addEventListener("change", apply);
  if (palettes.length > 0) select.value = palettes[0];
  root.append(h("label", {}, "Palette ", select), body);
  await apply();
  return root;
};

function imagesSection(hy8: Hy8, table: Uint32Array): HTMLElement {
  const grid = h("div", { class: "grid" });
  hy8.images.forEach((image, index) => {
    const canvas = indexedCanvas(image.pixels, image.width, image.height, table, SCALE);
    canvas.classList.add("alpha");
    grid.append(h("figure", {}, canvas, h("figcaption", {}, `#${index} ${image.width}×${image.height}`)));
  });
  return section(`Images (${hy8.images.length})`, hy8.images.length ? grid : h("p", { class: "empty" }, "aucune"));
}

function spritesSection(hy8: Hy8, table: Uint32Array): HTMLElement {
  const grid = h("div", { class: "grid" });
  hy8.sprites.forEach((_, index) => {
    try {
      const placed = placeSprite(hy8, index, false);
      const bounds = boundsOf(placed);
      if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY)) {
        grid.append(h("figure", {}, h("figcaption", { class: "empty" }, `sprite ${index} : vide`)));
        return;
      }
      const canvas = makeCanvas(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, SCALE);
      canvas.classList.add("alpha");
      paintPlaced(canvas, placed, bounds, table);
      grid.append(h("figure", {}, canvas, h("figcaption", {}, `sprite ${index}`)));
    } catch (error) {
      grid.append(h("figure", {}, h("figcaption", { class: "error" }, `sprite ${index} : ${(error as Error).message}`)));
    }
  });
  return section(`Sprites (${hy8.sprites.length})`, hy8.sprites.length ? grid : h("p", { class: "empty" }, "aucun"));
}

/** Lecture des animations à 11 images/s ; `register` reçoit la fonction d'arrêt. */
function animationSection(hy8: Hy8, table: Uint32Array, register: (stop: () => void) => void): HTMLElement {
  const wrap = section(`Animations (${hy8.animations.length})`);
  if (hy8.animations.length === 0) {
    wrap.append(h("p", { class: "empty" }, "aucune"));
    return wrap;
  }
  const select = h("select", {});
  hy8.animations.forEach((animation, index) => select.append(h("option", { value: String(index) }, `#${index} (${animation.frames.length} images)`)));
  const anchor = h("input", { type: "checkbox" });
  const counter = h("span", { class: "counter" });
  const stage = h("div", { class: "stage" });
  let timer = 0;
  let paused = false;
  let frameNo = 0;
  let canvas: HTMLCanvasElement | null = null;
  let frames: PlacedImage[][] = [];
  let bounds: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  const draw = () => {
    if (!canvas || frames.length === 0) return;
    paintPlaced(canvas, frames[frameNo], bounds, table);
    if (anchor.checked) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f0f";
      ctx.fillRect(-bounds.minX - 1, -bounds.minY - 1, 2, 2);
    }
    counter.textContent = `image ${frameNo + 1}/${frames.length}`;
  };
  const stop = () => window.clearInterval(timer);
  const load = () => {
    stop();
    stage.replaceChildren();
    canvas = null;
    frameNo = 0;
    try {
      const animation = hy8.animations[Number(select.value)];
      frames = animation.frames.map((frame) => placeFrame(hy8, frame));
      if (frames.length === 0) {
        stage.append(h("p", { class: "empty" }, "animation vide"));
        counter.textContent = "";
        return;
      }
      bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const placed of frames) boundsOf(placed, bounds);
      if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY)) bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
      canvas = makeCanvas(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 3);
      canvas.classList.add("alpha");
      stage.append(canvas);
      draw();
      timer = window.setInterval(() => {
        if (paused) return;
        frameNo = (frameNo + 1) % frames.length;
        draw();
      }, 1000 / 11);
    } catch (error) {
      stage.append(h("p", { class: "error" }, (error as Error).message));
    }
  };
  select.addEventListener("change", load);
  anchor.addEventListener("change", draw);
  const toggle = button("pause", () => {
    paused = !paused;
    toggle.textContent = paused ? "lecture" : "pause";
  });
  const next = button("image +1", () => {
    paused = true;
    toggle.textContent = "lecture";
    if (frames.length) frameNo = (frameNo + 1) % frames.length;
    draw();
  });
  wrap.append(h("div", { class: "bar" }, select, toggle, next, h("label", {}, anchor, " ancre"), counter), stage);
  register(stop);
  load();
  return wrap;
}

const muxPanel: Render = (ctx) => {
  const decoder = new MuxDecoder(ctx.bytes);
  const { header } = decoder;
  const fps = header.framesPerSecond;
  const freq = header.audioFrequency;
  const canvas = makeCanvas(header.width, header.height, SCALE);
  const counter = h("span", { class: "counter" });
  const status = h("p", { class: "error" });
  let shown = 0;
  let lastIndex = -1;
  let playing = false;
  let ended = false;
  let dirty = true;
  let raf = 0;
  let actx: AudioContext | null = null;
  let startTime = 0;
  let audioTime = 0;
  const sources = new Set<AudioBufferSourceNode>();

  const stopSources = () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* déjà arrêté */
      }
    }
    sources.clear();
  };
  const scheduleAudio = (chunks: Uint8Array[]) => {
    if (!actx || freq <= 0 || chunks.length === 0) return;
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    if (total === 0) return;
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i++) samples[offset + i] = (chunk[i] - 128) / 128;
      offset += chunk.length;
    }
    const buffer = actx.createBuffer(1, total, freq);
    buffer.copyToChannel(samples, 0);
    const source = actx.createBufferSource();
    source.buffer = buffer;
    source.connect(actx.destination);
    audioTime = Math.max(audioTime, actx.currentTime);
    source.start(audioTime);
    audioTime += total / freq;
    sources.add(source);
    source.onended = () => sources.delete(source);
  };
  const step = (withAudio: boolean): boolean => {
    try {
      const frame = decoder.nextFrame();
      if (!frame) {
        ended = true;
        counter.textContent = `fin (${shown} images)`;
        return false;
      }
      shown++;
      lastIndex = frame.index;
      paintIndexed(canvas, decoder.pixels, header.width, header.height, paletteTable(decoder.palette, false));
      counter.textContent = `image ${shown} (n° ${lastIndex})${frame.paletteChanged ? " · palette" : ""}${frame.markers.length ? ` · ${frame.markers.length} marqueur(s)` : ""}`;
      if (withAudio) scheduleAudio(frame.audio);
      return true;
    } catch (error) {
      status.textContent = (error as Error).message;
      ended = true;
      pause();
      return false;
    }
  };
  const tick = () => {
    if (!playing || !actx) return;
    while (playing && actx.currentTime >= startTime + shown / fps) {
      if (!step(true)) {
        pause();
        return;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  const play = () => {
    if (playing) return;
    status.textContent = "";
    actx = ctx.audio();
    if (ended) restart(false);
    if (dirty) {
      stopSources();
      startTime = actx.currentTime - shown / fps;
      audioTime = actx.currentTime;
      dirty = false;
    }
    void actx.resume();
    playing = true;
    playBtn.textContent = "pause";
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    playing = false;
    cancelAnimationFrame(raf);
    void actx?.suspend();
    playBtn.textContent = "lecture";
  };
  const restart = (show = true) => {
    if (playing) pause();
    decoder.reset();
    shown = 0;
    ended = false;
    dirty = true;
    status.textContent = "";
    if (show) step(false);
  };
  const playBtn = button("lecture", () => (playing ? pause() : play()));
  const stepBtn = button("image +1", () => {
    if (playing) pause();
    if (ended) return;
    dirty = true;
    step(false);
  });
  const restartBtn = button("début", () => restart());
  ctx.onDispose(() => {
    playing = false;
    cancelAnimationFrame(raf);
    stopSources();
    void actx?.suspend();
  });
  step(false);
  return h(
    "div",
    {},
    info(
      ["Taille", `${header.width}×${header.height}`],
      ["Cadence", `${fps.toFixed(2)} images/s`],
      ["Audio", freq ? `${freq} Hz, 8 bits non signé` : "aucun"],
    ),
    canvas,
    h("div", { class: "bar" }, playBtn, stepBtn, restartBtn, counter),
    status,
  );
};

const vocPanel: Render = (ctx) => {
  const voc = parseVoc(ctx.bytes);
  const data = vocToFloat32(voc);
  const wave = makeCanvas(640, 80);
  const g = wave.getContext("2d")!;
  g.fillStyle = "#8cf";
  const step = Math.max(1, Math.floor(data.length / 640));
  for (let x = 0; x < 640; x++) {
    let min = 1;
    let max = -1;
    for (let i = x * step; i < Math.min(data.length, (x + 1) * step); i++) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    if (max >= min) g.fillRect(x, 40 - max * 40, 1, Math.max(1, (max - min) * 40));
  }
  let source: AudioBufferSourceNode | null = null;
  const stop = () => {
    try {
      source?.stop();
    } catch {
      /* déjà arrêté */
    }
    source = null;
  };
  ctx.onDispose(stop);
  const play = button("lecture", () => {
    stop();
    const actx = ctx.audio();
    const buffer = actx.createBuffer(1, data.length, voc.sampleRate);
    buffer.copyToChannel(new Float32Array(data), 0);
    source = actx.createBufferSource();
    source.buffer = buffer;
    source.connect(actx.destination);
    source.start();
  });
  return h(
    "div",
    {},
    info(["Fréquence", `${voc.sampleRate} Hz`], ["Échantillons", voc.samples.length], ["Durée", `${(voc.samples.length / voc.sampleRate).toFixed(2)} s`]),
    wave,
    h("div", { class: "bar" }, play, button("stop", stop)),
  );
};

const pfnPanel: Render = (ctx) => {
  const font = parsePfn(ctx.bytes);
  const input = h("input", { type: "text", value: "Schtroumpf à la Une ! 0123456789", size: "40" });
  const preview = makeCanvas(1, 1);
  const render = () => {
    const codes = encodeCp437(input.value);
    const width = Math.max(1, codes.reduce((sum, c) => sum + advance(font, c), 0));
    preview.width = width;
    preview.height = font.height;
    preview.style.width = `${width * 3}px`;
    preview.style.height = `${font.height * 3}px`;
    const table = paletteTable(null, true);
    table[1] = 0xffffffff;
    const pixels = new Uint8Array(width * font.height);
    let x = 0;
    for (const code of codes) {
      const glyph = font.glyphs.get(code);
      if (glyph && glyph.width > 0) {
        for (let row = 0; row < font.height; row++) {
          for (let col = 0; col < glyph.width; col++) pixels[row * width + x + col] = glyph.bitmap[row * glyph.width + col];
        }
      }
      x += advance(font, code);
    }
    paintIndexed(preview, pixels, width, font.height, table);
  };
  input.addEventListener("input", render);
  render();
  const grid = h("div", { class: "grid glyphs" });
  const white = paletteTable(null, true);
  white[1] = 0xffffffff;
  for (const [code, glyph] of font.glyphs) {
    const cell = h("figure", {});
    if (glyph.width > 0) {
      const canvas = indexedCanvas(glyph.bitmap, glyph.width, font.height, white, 4);
      canvas.classList.add("alpha");
      cell.append(canvas);
    } else {
      cell.append(h("div", { class: "blank" }, "∅"));
    }
    cell.append(h("figcaption", {}, `0x${code.toString(16)} ${glyph.width}px`));
    grid.append(cell);
  }
  return h(
    "div",
    {},
    info(["Hauteur", font.height], ["Premier code", `0x${font.firstChar.toString(16)}`], ["Glyphes", font.glyphs.size], ["Espacement", LETTER_SPACING]),
    h("div", { class: "bar" }, h("label", {}, "Texte ", input)),
    h("div", { class: "preview" }, preview),
    section("Glyphes", grid),
  );
};

function flagNames(flags: number): string {
  const names = Object.entries(MutFlag).filter(([, bit]) => (flags & bit) !== 0).map(([name]) => name);
  return names.length ? names.join(", ") : "aucun";
}

const mutPanel: Render = async (ctx) => {
  const mut = parseMut(ctx.bytes);
  const palettePath = ctx.files.resolve(baseName(ctx.path).replace(/\.[^.]+$/, ".PAL"), dir(ctx.path).split("/").pop());
  const root = h("div", {});
  let palette: Uint8Array | null = null;
  if (palettePath) {
    try {
      palette = await loadPalette(ctx, palettePath);
    } catch (error) {
      root.append(h("p", { class: "error" }, `Palette : ${(error as Error).message}`));
    }
  } else {
    root.append(h("p", { class: "empty" }, "aucune palette correspondante, niveaux de gris"));
  }
  const table = paletteTable(palette, false);
  const col = h("div", { class: "tiles" });
  mut.tiles.forEach((tile, index) => {
    col.append(
      h(
        "figure",
        {},
        indexedCanvas(tile.pixels, tile.width, tile.height, table),
        h("figcaption", {}, `#${index} flags 0x${tile.flags.toString(16).padStart(2, "0")} : ${flagNames(tile.flags)}`),
      ),
    );
  });
  root.prepend(info(["Tronçons", mut.tiles.length], ["Palette", palettePath ?? "aucune"]));
  root.append(col, section("Palette", paletteSwatch(palette)));
  return root;
};

const prcPanel: Render = (ctx) => {
  const sequence = parsePrc(ctx.bytes);
  const mutPath = ctx.files.resolve(baseName(ctx.path).replace(/\.[^.]+$/, ".MUT"), dir(ctx.path).split("/").pop());
  return h(
    "div",
    {},
    info(["Entrées", sequence.length], ["MUT associé", mutPath ?? "aucun"]),
    h("ol", { class: "prc", start: "0" }, ...sequence.map((n) => h("li", {}, String(n)))),
  );
};

const textPanel: Render = (ctx) => {
  const text = decodeCp437(ctx.bytes);
  const ext = extensionOf(ctx.path);
  const extra: Node[] = [];
  if (ext === "ION") {
    const scenes = parseDescription(ctx.bytes);
    extra.push(info(...scenes.map((s): [string, string] => [s.id, s.name])));
  } else {
    extra.push(info(["Entrées à clé", parseKeyedTexts(ctx.bytes).length]));
  }
  return h("div", {}, ...extra, h("pre", {}, text));
};

const rawPanel: Render = (ctx) => h("div", {}, info(["Taille", formatSize(ctx.bytes.length)]), h("pre", {}, hexDump(ctx.bytes)));

const BY_EXTENSION: Record<string, Render> = {
  MCG: mcgPanel,
  PAL: palPanel,
  HY8: hy8Panel,
  MUX: muxPanel,
  VOC: vocPanel,
  PFN: pfnPanel,
  MUT: mutPanel,
  PRC: prcPanel,
  DAT: textPanel,
  ION: textPanel,
};

/** Fichier sans extension à signature MUX (0xaa07 en petit-boutiste). */
function isExtensionlessMux(path: string, bytes: Uint8Array): boolean {
  return extensionOf(path) === "" && bytes.length > 4 && bytes[0] === 0x07 && bytes[1] === 0xaa;
}

/** Panneaux du Téléportaschtroumpf, du plus précis au plus général (le dernier prend tout le reste). */
export const PANELS: Panel[] = [
  { matches: (entry) => Object.hasOwn(BY_EXTENSION, extensionOf(entry.path)), render: (ctx) => BY_EXTENSION[extensionOf(ctx.path)](ctx) },
  { matches: (entry, bytes) => isExtensionlessMux(entry.path, bytes), render: muxPanel },
  { matches: () => true, render: rawPanel },
];
