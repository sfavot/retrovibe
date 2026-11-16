/**
 * Visionneuse de ressources de Gabriel Knight : outil de développement, hors du build du site.
 * Page : `/src/games/gk1/ui/asset-viewer.html` (serveur de dev Vite). Les ressources viennent de `original/gk1/`, servi en
 * `/gk1/` : `RESOURCE.MAP/000`, `ALT.MAP`/`RESOURCE.ALT` (vues haute résolution), `PATCHES/`, `SEQ/`, `audio/`, `voices/`.
 * Dix onglets : vues (boucles, cels, miroirs), décors (cel par cel), palettes, polices, messages (par module, nom et verbe,
 * avec leur voix), scripts (objets et désassemblage), sons (pistes et canaux), cinématiques `SEQ`, audio numérisé, autres
 * (vocabulaires, patchs sonores, maps audio, heaps). L'adresse `#onglet/nom` ouvre une ressource.
 *
 * Les textes sont dans `../copy.ts` ; la logique sans DOM est dans `viewer-data.ts`.
 */
import { decodeCp850 } from "../../../data/cp850";
import { fetchGameFiles, type GameFiles } from "../../../data/game-files";
import { h, hexDump, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import { fetchBytes } from "../../../ui/files";
import { IndexedPresenter, makeCanvas, paintIndexed, paletteToLut } from "../../../ui/indexed-canvas";
import { copy } from "../copy";
import { audioPath, readAudio36Map, readSfxMap, voicePath } from "../data/audio-index";
import { readFont } from "../data/font";
import { CEL_RAW, ResourceType, SEQ_HEIGHT, SEQ_WIDTH, SFX_MAP_NUMBER, VOCAB_CLASS_TABLE, VOCAB_OPCODE_NAMES, VOCAB_PROPERTY_OFFSETS, VOCAB_SELECTOR_NAMES, VIEW_RESOLUTION_320X200 } from "../data/ids";
import { messageKey, readMessages, TALKER_NARRATOR } from "../data/message";
import { type Palette, readPalette } from "../data/palette";
import { decodePicCel, readPic } from "../data/pic";
import { parsePatchFileName, ResourceIndex } from "../data/resource-map";
import { createSeqCanvas, decodeSeqFrame, readSeq } from "../data/seq";
import { readSound } from "../data/sound";
import { readView } from "../data/view";
import { readPropertyOffsets } from "../data/vocab";
import { className, disassembleScript, formatRoutine, loadProgram, propertySelectorsOf, routineName, type SciProgram, type ScriptDisassembly, selectorName } from "../engine/disasm";
import {
  celOffset,
  distinctValues,
  filterMessages,
  folderItems,
  formatLocation,
  GLYPH_SHEET_COLUMNS,
  glyphSheet,
  type IndexedImage,
  type ListItem,
  type Location,
  loopBounds,
  parseLocation,
  parseResourceName,
  picDrawOrder,
  renderText,
  resourceItems,
  SEQ_DEFAULT_FRAME_RATE,
  SEQ_FRAME_RATES,
  soundRows,
  TAB_IDS,
  type TabId,
  viewCelImage,
} from "./viewer-data";

const BASE = "/gk1";
const VOLUMES: readonly (readonly [map: string, volume: string])[] = [
  ["RESOURCE.MAP", "RESOURCE.000"],
  ["ALT.MAP", "RESOURCE.ALT"],
];
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;
const VIEW_ANIMATION_RATE = 8;
/** Encre et fond des rendus de polices. */
const INK_LUT = paletteToLut(Uint8Array.from([0x0b, 0x0b, 0x0d, 0xe6, 0xe8, 0xee, ...new Array<number>(762).fill(0)]));

const t = copy.viewer;

let index: ResourceIndex;
let files: GameFiles;
let program: SciProgram | undefined;
const disassemblies = new Map<number, ScriptDisassembly>();

function getProgram(): SciProgram {
  return (program ??= loadProgram(index));
}

function getDisassembly(number: number): ScriptDisassembly {
  let result = disassemblies.get(number);
  if (!result) {
    const script = getProgram().scripts.get(number);
    if (!script) throw new Error(`script ${number} absent`);
    result = disassembleScript(script);
    disassemblies.set(number, result);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Petits constructeurs
// ---------------------------------------------------------------------------------------------------------------------------------

const hex4 = (value: number): string => `0x${value.toString(16).padStart(4, "0")}`;

function dl(entries: readonly (readonly [string, string | number | Node])[]): HTMLElement {
  const list = h("dl", { class: "info" });
  for (const [key, value] of entries) list.append(h("dt", {}, key), h("dd", {}, typeof value === "number" ? String(value) : value));
  return list;
}

function table(head: readonly string[], rows: readonly (readonly (string | number | Node)[])[]): HTMLElement {
  const body = h("tbody");
  for (const row of rows) {
    body.append(h("tr", {}, ...row.map((cell) => h("td", typeof cell === "number" ? { class: "num" } : {}, typeof cell === "number" ? String(cell) : cell))));
  }
  return h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ...head.map((title) => h("th", { scope: "col" }, title)))), body));
}

/** Canvas d'une image indexée ; `label` en fait une image nommée pour les lecteurs d'écran. */
function imageCanvas(image: IndexedImage, lut: Uint32Array, scale: number, label: string): HTMLCanvasElement {
  const canvas = makeCanvas(image.width, image.height, scale);
  if (image.transparent !== undefined) canvas.className = "alpha";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  if (image.width > 0 && image.height > 0) paintIndexed(canvas, image.pixels, image.width, image.height, lut, { transparent: image.transparent });
  return canvas;
}

function figure(canvas: HTMLCanvasElement, caption: string): HTMLElement {
  return h("figure", {}, canvas, h("figcaption", {}, caption));
}

function paletteInfo(palette: Palette | undefined): string {
  return palette ? t.paletteRange(palette.start, palette.count) : t.noPalette;
}

function select(label: string, options: readonly (readonly [value: string, text: string])[], value: string, onChange: (value: string) => void): HTMLElement {
  const input = h("select");
  for (const [optionValue, text] of options) {
    const option = h("option", { value: optionValue }, text);
    option.selected = optionValue === value;
    input.append(option);
  }
  input.addEventListener("change", () => onChange(input.value));
  return h("label", {}, `${label} `, input);
}

/** Bouton lecture / pause : `aria-pressed` suit l'état, le texte aussi. */
function playButton(onToggle: (playing: boolean) => void): { button: HTMLButtonElement; set(playing: boolean): void } {
  const button = h("button", { type: "button", "aria-pressed": "false" }, t.play);
  let playing = false;
  const set = (value: boolean): void => {
    playing = value;
    button.textContent = playing ? t.pause : t.play;
    button.setAttribute("aria-pressed", String(playing));
  };
  button.addEventListener("click", () => {
    set(!playing);
    onToggle(playing);
  });
  return { button, set };
}

interface RenderContext {
  readonly main: HTMLElement;
  /** Nettoyage à faire quand une autre ressource est ouverte (minuteries, sons). */
  onDispose(fn: () => void): void;
}

function resourceHeader(type: number, number: number): readonly (readonly [string, string | number])[] {
  return [
    [t.source, index.info(type, number)?.source ?? ""],
    [t.size, t.bytes(index.get(type, number).length)],
  ];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------------------------------------------------------------

interface Tab {
  readonly id: TabId;
  items(): ListItem[];
  render(name: string, context: RenderContext): void | Promise<void>;
}

function renderView(name: string, { main, onDispose }: RenderContext): void {
  const number = Number(name);
  const view = readView(index.get(ResourceType.View, number));
  if (!view.palette) throw new Error("vue sans palette");
  const lut = paletteToLut(view.palette.rgb);
  const scale = view.resolution === VIEW_RESOLUTION_320X200 ? 2 : 1;
  main.append(
    dl([
      ...resourceHeader(ResourceType.View, number),
      [t.loops, view.loops.length],
      [t.cels, view.celCount],
      [t.resolution, t.resolutions[view.resolution] ?? String(view.resolution)],
      [t.palette, paletteInfo(view.palette)],
    ]),
  );

  // Animation d'une boucle, cels posés sur leur origine.
  const stage = h("div", { class: "preview" });
  let loop = 0;
  let cel = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const draw = (): void => {
    const bounds = loopBounds(view, loop);
    const canvas = makeCanvas(bounds.width, bounds.height, scale);
    canvas.className = "alpha";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t.celAlt(loop, cel));
    const header = view.loops[loop].cels[cel];
    if (header && header.width > 0 && header.height > 0) {
      const image = viewCelImage(view, loop, cel);
      const offset = celOffset(header, view.loops[loop].mirrored);
      paintIndexed(canvas, image.pixels, image.width, image.height, lut, { transparent: image.transparent, originX: offset.x - bounds.left, originY: offset.y - bounds.top });
    }
    stage.replaceChildren(canvas);
  };
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const player = playButton((playing) => {
    stop();
    if (playing) {
      timer = setInterval(() => {
        cel = (cel + 1) % Math.max(1, view.loops[loop].cels.length);
        draw();
      }, 1000 / VIEW_ANIMATION_RATE);
    }
  });
  onDispose(stop);
  const loopSelect = select(
    t.loop,
    view.loops.map((_, i) => [String(i), String(i)] as const),
    "0",
    (value) => {
      loop = Number(value);
      cel = 0;
      draw();
    },
  );
  if (view.loops.length > 0) {
    main.append(h("h3", {}, t.animation), h("div", { class: "bar" }, loopSelect, player.button), stage);
    draw();
  }

  view.loops.forEach((entry, l) => {
    const note = entry.source === undefined ? "" : ` (${entry.mirrored ? t.loopMirror(entry.source) : t.loopCopy(entry.source)})`;
    const grid = h("div", { class: "grid" });
    entry.cels.forEach((header, c) => {
      grid.append(figure(imageCanvas(viewCelImage(view, l, c), lut, scale, t.celAlt(l, c)), t.celCaption(c, header.width, header.height, header.originX, header.originY)));
    });
    main.append(h("h3", {}, `${t.loopTitle(l, entry.cels.length)}${note}`), grid);
  });
  main.append(h("h3", {}, t.palette), paletteSwatch(view.palette.rgb));
}

function renderPic(name: string, { main }: RenderContext): void {
  const number = Number(name);
  const pic = readPic(index.get(ResourceType.Pic, number));
  if (!pic.palette) throw new Error("décor sans palette");
  const lut = paletteToLut(pic.palette.rgb);
  const celCanvases = pic.cels.map((cel, i) =>
    imageCanvas({ width: cel.width, height: cel.height, pixels: decodePicCel(pic, i), transparent: cel.skipColor }, lut, 1, t.picCelAlt(i)),
  );
  const visible = pic.cels.map(() => true);
  const composite = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, 2);
  composite.className = "alpha";
  composite.setAttribute("role", "img");
  composite.setAttribute("aria-label", t.compositionAlt);
  const compose = (): void => {
    const context = composite.getContext("2d")!;
    context.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    for (const i of picDrawOrder(pic)) {
      if (visible[i] && pic.cels[i].width > 0 && pic.cels[i].height > 0) context.drawImage(celCanvases[i], pic.cels[i].x, pic.cels[i].y);
    }
  };
  compose();
  const rows = pic.cels.map((cel, i) => {
    const box = h("input", { type: "checkbox", "aria-label": `${t.shown} : ${t.picCel} ${i}` });
    box.checked = true;
    box.addEventListener("change", () => {
      visible[i] = box.checked;
      compose();
    });
    return [box, i, `${cel.width} × ${cel.height}`, `(${cel.x}, ${cel.y})`, cel.priority, cel.compression === CEL_RAW ? t.compressionRaw : t.compressionRle] as const;
  });
  main.append(
    dl([...resourceHeader(ResourceType.Pic, number), [t.picCels, pic.cels.length], [t.palette, paletteInfo(pic.palette)]]),
    h("h3", {}, t.composition),
    h("div", { class: "preview" }, composite),
    table([t.shown, t.picCel, t.size, t.position, t.priority, t.compression], rows),
    h("h3", {}, t.picCels),
  );
  const grid = h("div", { class: "grid" });
  pic.cels.forEach((cel, i) => {
    const canvas = imageCanvas({ width: cel.width, height: cel.height, pixels: decodePicCel(pic, i), transparent: cel.skipColor }, lut, 1, t.picCelAlt(i));
    grid.append(figure(canvas, `${i} : ${cel.width} × ${cel.height}, ${t.priority.toLowerCase()} ${cel.priority}`));
  });
  main.append(grid, h("h3", {}, t.palette), paletteSwatch(pic.palette.rgb));
}

function renderPalette(name: string, { main }: RenderContext): void {
  const number = Number(name);
  const palette = readPalette(index.get(ResourceType.Palette, number));
  main.append(
    dl([
      ...resourceHeader(ResourceType.Palette, number),
      [t.colors, paletteInfo(palette)],
      [t.format, palette.sharedUsed ? t.paletteFormatShared : t.paletteFormatOwn],
      [t.version, palette.version],
    ]),
    paletteSwatch(palette.rgb, 20),
  );
}

function renderFont(name: string, { main }: RenderContext): void {
  const number = Number(name);
  const font = readFont(index.get(ResourceType.Font, number));
  const sampleStage = h("div", { class: "preview" });
  const input = h("input", { type: "text", value: t.sampleText, class: "wide" });
  const drawSample = (): void => {
    sampleStage.replaceChildren(imageCanvas(renderText(font, input.value), INK_LUT, 2, t.sampleAlt));
  };
  input.addEventListener("input", drawSample);
  drawSample();
  const sheet = glyphSheet(font);
  const sheetCanvas = imageCanvas(sheet, INK_LUT, 2, t.glyphSheetAlt);
  sheetCanvas.classList.add("swatch");
  sheetCanvas.addEventListener("mousemove", (event) => {
    const rect = sheetCanvas.getBoundingClientRect();
    const column = Math.floor(((event.clientX - rect.left) / rect.width) * GLYPH_SHEET_COLUMNS);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * (sheet.height / sheet.cellHeight));
    const code = row * GLYPH_SHEET_COLUMNS + column;
    if (code >= 0 && code < font.glyphs.length) sheetCanvas.title = t.glyphCode(code, decodeCp850(Uint8Array.of(code)));
  });
  main.append(
    dl([...resourceHeader(ResourceType.Font, number), [t.glyphs, font.glyphs.length], [t.lineHeight, font.lineHeight]]),
    h("div", { class: "bar" }, h("label", { class: "grow" }, `${t.sample} `, input)),
    sampleStage,
    h("h3", {}, t.glyphSheet),
    h("div", { class: "preview" }, sheetCanvas),
  );
}

function renderMessages(name: string, { main, onDispose }: RenderContext): void {
  const module = Number(name);
  const resource = readMessages(index.get(ResourceType.Message, module));
  let noun: number | undefined;
  let verb: number | undefined;
  let text = "";
  const count = h("p", { class: "empty", "aria-live": "polite" });
  const result = h("div");
  let playing: HTMLAudioElement | undefined;
  onDispose(() => playing?.pause());
  const listen = (path: string): void => {
    playing?.pause();
    playing = new Audio(`${BASE}/${path}`);
    void playing.play().catch(() => undefined);
  };
  const fill = (): void => {
    const entries = filterMessages(resource, { noun, verb, text });
    count.textContent = t.messageCount(entries.length, resource.entries.length);
    const rows = entries.map((entry) => {
      const key = messageKey(entry);
      const path = voicePath({ module, ...entry });
      let voice: Node | string = "";
      if (files.size(path) !== undefined) {
        const button = h("button", { type: "button", "aria-label": t.listenLabel(key) }, t.listen);
        button.addEventListener("click", () => listen(path));
        voice = button;
      }
      const talker = entry.talker === TALKER_NARRATOR ? `${entry.talker} (${t.narrator})` : String(entry.talker);
      const cell = h("span", { class: "text" }, entry.text);
      if (entry.comment) cell.title = `${t.comment} : ${entry.comment}`;
      return [entry.noun, entry.verb, entry.cond, entry.seq, talker, cell, entry.ref ? `${entry.ref.noun}-${entry.ref.verb}-${entry.ref.cond}` : "", voice] as const;
    });
    result.replaceChildren(rows.length > 0 ? table([t.noun, t.verb, t.cond, t.seq, t.talker, t.text, t.ref, t.voice], rows) : h("p", { class: "empty" }, t.noMatch));
  };
  const options = (field: "noun" | "verb"): (readonly [string, string])[] => [["", t.all], ...distinctValues(resource, field).map((v) => [String(v), String(v)] as const)];
  const search = h("input", { type: "search" });
  search.addEventListener("input", () => {
    text = search.value;
    fill();
  });
  main.append(
    dl([...resourceHeader(ResourceType.Message, module), [t.version, resource.version]]),
    h(
      "div",
      { class: "bar" },
      select(t.noun, options("noun"), "", (value) => {
        noun = value === "" ? undefined : Number(value);
        fill();
      }),
      select(t.verb, options("verb"), "", (value) => {
        verb = value === "" ? undefined : Number(value);
        fill();
      }),
      h("label", {}, `${t.search} `, search),
    ),
    count,
    result,
  );
  fill();
}

function renderScript(name: string, { main }: RenderContext): void {
  const number = Number(name);
  const { names } = getProgram();
  const disassembly = getDisassembly(number);
  const { script } = disassembly;
  const instructions = disassembly.routines.reduce((sum, routine) => sum + routine.instructions.length, 0);
  const dead = disassembly.deadCode.reduce((sum, instruction) => sum + instruction.size, 0);
  const exportsList = h("ul", { class: "plain" });
  script.exports.forEach((entry, i) => {
    let text: string;
    if (entry.isObject) text = t.exportObject(i, script.objects.find((o) => o.offset === entry.offset)?.name ?? hex4(entry.offset));
    else if (entry.offset === 0) text = t.exportEmpty(i);
    else if (disassembly.strayExports.includes(i)) text = t.exportStray(i, hex4(entry.offset));
    else text = t.exportProcedure(i, hex4(entry.offset));
    exportsList.append(h("li", {}, text));
  });
  main.append(
    dl([
      ...resourceHeader(ResourceType.Script, number),
      [t.locals, script.locals.length],
      [t.objects, script.objects.length],
      [t.strings, script.strings.length],
      [t.code, t.codeSummary(instructions, dead)],
    ]),
  );
  if (disassembly.legacyEncoding) main.append(h("p", { class: "note" }, t.legacy));
  const unattributed = disassembly.unattributed.reduce((sum, range) => sum + range.end - range.start, 0);
  if (unattributed > 0) main.append(h("p", { class: "error" }, t.unattributed(unattributed)));
  for (const problem of disassembly.problems) main.append(h("p", { class: "error" }, problem));

  if (script.exports.length > 0) main.append(h("h3", {}, t.exports), exportsList);
  if (script.objects.length > 0) {
    const rows = script.objects.map((object) => {
      const selectors = propertySelectorsOf(names, object);
      return [
        object.name,
        object.isClass ? t.classKind(object.species) : t.instanceKind,
        object.superClass === 0xffff ? "" : className(names, object.superClass),
        selectors ? h("span", { class: "text", title: [...selectors].map((s) => selectorName(names, s)).join(", ") }, String(object.values.length)) : String(object.values.length),
        h("span", { class: "text" }, object.methods.map((method) => selectorName(names, method.selector)).join(", ")),
      ] as const;
    });
    main.append(h("h3", {}, t.objects), table([t.object, t.kind, t.superClass, t.properties, t.methods], rows));
  }

  if (disassembly.routines.length > 0) {
    const output = h("pre", { class: "code", tabindex: "0", "aria-label": t.disassembly });
    const show = (value: string): void => {
      const chosen = value === "" ? disassembly.routines : disassembly.routines.filter((routine) => String(routine.offset) === value);
      output.textContent = chosen.map((routine) => formatRoutine(routine, disassembly, names)).join("\n\n");
    };
    const routineOptions: (readonly [string, string])[] = [
      ["", t.allRoutines(disassembly.routines.length)],
      ...disassembly.routines.map((routine) => [String(routine.offset), routineName(routine, names)] as const),
    ];
    main.append(h("h3", {}, t.disassembly), h("div", { class: "bar" }, select(t.routine, routineOptions, "", show)), output);
    show("");
  }
  if (script.strings.length > 0) {
    main.append(h("h3", {}, t.strings), table([t.offset, t.text], script.strings.map((s) => [hex4(s.offset), h("span", { class: "text" }, s.text)] as const)));
  }
}

function renderSound(name: string, { main }: RenderContext): void {
  const number = Number(name);
  const sound = readSound(index.get(ResourceType.Sound, number));
  const rows = soundRows(sound);
  main.append(dl([...resourceHeader(ResourceType.Sound, number), [t.soundPriority, sound.priority ?? ""], [t.tracks, sound.tracks.length]]));
  if (rows.length === 0) {
    main.append(h("p", { class: "empty" }, t.noTracks));
    return;
  }
  main.append(
    table(
      [t.device, t.channel, t.midiChannel, t.flags, t.voices, t.priority, t.offset, t.size],
      rows.map((row) => [`${row.device} : ${row.deviceName}`, row.index, row.isControl ? t.controlChannel(row.midiChannel) : String(row.midiChannel), row.flags, row.voices, row.priority, hex4(row.offset), row.size] as const),
    ),
  );
}

async function renderSeq(name: string, { main, onDispose }: RenderContext): Promise<void> {
  const path = `SEQ/${name}.SEQ`;
  const seq = readSeq(await fetchBytes(BASE, path));
  const lut = paletteToLut(seq.palette.rgb);
  const canvas = makeCanvas(SEQ_WIDTH, SEQ_HEIGHT, 2);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t.seqAlt);
  const presenter = IndexedPresenter.forCanvas(canvas, SEQ_WIDTH, SEQ_HEIGHT);
  let pixels = createSeqCanvas();
  let decoded = -1;
  let rate: number = SEQ_DEFAULT_FRAME_RATE;
  let timer: ReturnType<typeof setInterval> | undefined;
  const slider = h("input", { type: "range", min: "0", max: String(seq.frames.length - 1), value: "0", "aria-label": t.frame });
  const position = h("output", {});
  /** Montre l'image `target` : les images sont des différences, il faut les rejouer depuis la première si l'on recule. */
  const showFrame = (target: number): void => {
    if (target < decoded) {
      pixels = createSeqCanvas();
      decoded = -1;
    }
    while (decoded < target) decodeSeqFrame(seq, ++decoded, pixels);
    presenter.present(pixels, lut);
    slider.value = String(target);
    position.textContent = t.frameOf(target, seq.frames.length);
  };
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const start = (): void => {
    stop();
    timer = setInterval(() => {
      if (decoded + 1 >= seq.frames.length) {
        stop();
        player.set(false);
        return;
      }
      showFrame(decoded + 1);
    }, 1000 / rate);
  };
  const player = playButton((playing) => {
    if (!playing) return stop();
    if (decoded + 1 >= seq.frames.length) showFrame(0);
    start();
  });
  onDispose(stop);
  slider.addEventListener("input", () => showFrame(Number(slider.value)));
  const rateSelect = select(
    t.speed,
    SEQ_FRAME_RATES.map((value) => [String(value), t.framesPerSecond(value)] as const),
    String(rate),
    (value) => {
      rate = Number(value);
      if (timer !== undefined) start();
    },
  );
  main.append(
    dl([
      [t.source, path],
      [t.size, t.bytes(seq.data.length)],
      [t.frames, seq.frames.length],
      [t.palette, paletteInfo(seq.palette)],
    ]),
    h("div", { class: "bar" }, player.button, slider, position, rateSelect),
    h("div", { class: "preview" }, canvas),
  );
  showFrame(0);
}

function renderAudio(name: string, { main, onDispose }: RenderContext): void {
  const path = audioPath(Number(name));
  const audio = h("audio", { controls: "", preload: "none", src: `${BASE}/${path}`, "aria-label": t.audioLabel(name) });
  onDispose(() => audio.pause());
  main.append(dl([[t.source, path], [t.size, t.bytes(files.size(path) ?? 0)]]), audio);
}

function renderOther(name: string, { main }: RenderContext): void {
  const id = parseResourceName("other", name);
  if (!id) throw new Error(`ressource inconnue : ${name}`);
  const { type, number } = id;
  const bytes = index.get(type, number);
  main.append(dl(resourceHeader(type, number)));
  const { names } = getProgram();
  if (type === ResourceType.Vocab && number === VOCAB_SELECTOR_NAMES) {
    main.append(h("h3", {}, t.selectors), table([t.number, t.name], names.selectors.map((selector, i) => [i, selector] as const)));
  } else if (type === ResourceType.Vocab && number === VOCAB_CLASS_TABLE) {
    main.append(h("h3", {}, t.classes), table([t.number, t.name, t.superClass, t.script], names.classes.map((c, i) => [i, c?.name ?? "", c && c.superClass !== 0xffff ? className(names, c.superClass) : "", c?.script ?? ""] as const)));
  } else if (type === ResourceType.Vocab && number === VOCAB_OPCODE_NAMES) {
    main.append(h("h3", {}, t.opcodes), table([t.number, t.name], names.opcodes.map((opcode, i) => [`0x${i.toString(16).padStart(2, "0")}`, opcode] as const)));
  } else if (type === ResourceType.Vocab && number === VOCAB_PROPERTY_OFFSETS) {
    main.append(h("h3", {}, t.selectors), table([t.number, t.name], readPropertyOffsets(bytes).map((selector) => [selector, selectorName(names, selector)] as const)));
  } else if (type === ResourceType.Map && number === SFX_MAP_NUMBER) {
    main.append(h("h3", {}, t.entries), table([t.number], readSfxMap(bytes).map((n) => [n] as const)));
  } else if (type === ResourceType.Map) {
    const rows = readAudio36Map(bytes).map((entry) => [messageKey(entry), entry.hasSync ? t.yes : t.no] as const);
    main.append(h("h3", {}, t.entries), table([t.clip, t.sync], rows));
  } else if (type === ResourceType.Heap) {
    const script = getProgram().scripts.get(number);
    if (script) {
      main.append(
        h("h3", {}, t.heapOf(number)),
        dl([[t.locals, [...script.locals].join(", ")], [t.objects, script.objects.map((o) => o.name).join(", ")]]),
        table([t.offset, t.text], script.strings.map((s) => [hex4(s.offset), h("span", { class: "text" }, s.text)] as const)),
      );
    }
  }
  main.append(h("h3", {}, t.hex), h("pre", {}, hexDump(bytes, 512)));
}

const resourceTab = (id: TabId, render: Tab["render"]): Tab => ({ id, items: () => resourceItems(index, id), render });

const TABS: readonly Tab[] = [
  resourceTab("views", renderView),
  resourceTab("pics", renderPic),
  resourceTab("palettes", renderPalette),
  resourceTab("fonts", renderFont),
  resourceTab("messages", renderMessages),
  resourceTab("scripts", renderScript),
  resourceTab("sounds", renderSound),
  { id: "seq", items: () => folderItems(files.list(), "SEQ", "SEQ"), render: renderSeq },
  { id: "audio", items: () => folderItems(files.list(), "audio", "mp3"), render: renderAudio },
  resourceTab("other", renderOther),
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Coquille : onglets, liste filtrée, ressource ouverte
// ---------------------------------------------------------------------------------------------------------------------------------

const root = document.getElementById("app")!;
const disposers: (() => void)[] = [];
const itemCache = new Map<TabId, ListItem[]>();
let current: Location = { tab: TAB_IDS[0], name: undefined };
let filterText = "";
let renderToken = 0;

function itemsOf(tab: Tab): ListItem[] {
  let items = itemCache.get(tab.id);
  if (!items) {
    items = tab.items();
    itemCache.set(tab.id, items);
  }
  return items;
}

function show(): void {
  for (const dispose of disposers.splice(0)) dispose();
  const tab = TABS.find((entry) => entry.id === current.tab)!;
  const items = itemsOf(tab);
  const name = current.name ?? items[0]?.name;

  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": t.tabsLabel });
  for (const entry of TABS) {
    const button = h("button", { type: "button", role: "tab", "aria-selected": String(entry.id === tab.id) }, t.tabs[entry.id]);
    button.addEventListener("click", () => {
      filterText = "";
      window.location.hash = formatLocation({ tab: entry.id, name: undefined });
    });
    tabs.append(button);
  }

  const filter = h("input", { type: "search", placeholder: t.filterPlaceholder, value: filterText, "aria-label": t.filter });
  const list = h("ul");
  const fill = (): void => {
    const query = filterText.trim().toLowerCase();
    list.replaceChildren();
    for (const item of items) {
      if (query && !item.name.toLowerCase().includes(query) && !item.note.toLowerCase().includes(query)) continue;
      const button = h("button", { type: "button", class: "file", "aria-current": String(item.name === name) }, item.name, item.note ? h("small", {}, item.note) : null);
      button.addEventListener("click", () => {
        window.location.hash = formatLocation({ tab: tab.id, name: item.name });
      });
      list.append(h("li", {}, button));
    }
    if (list.childElementCount === 0) list.append(h("li", { class: "empty" }, items.length === 0 ? t.empty : t.noMatch));
  };
  filter.addEventListener("input", () => {
    filterText = filter.value;
    fill();
  });
  fill();

  const main = h("main", { "aria-live": "polite" });
  const aside = h("aside", { "aria-label": t.listLabel }, filter, list);
  root.replaceChildren(h("div", { class: "gk1-viewer" }, h("header", {}, h("h1", {}, t.title), tabs), h("div", { class: "gk1-body" }, aside, main)));
  list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });

  if (name === undefined) {
    main.append(h("p", { class: "empty" }, t.empty));
    return;
  }
  main.append(h("h2", {}, t.heading(t.kinds[tab.id], name)));
  const token = ++renderToken;
  const fail = (error: unknown): void => {
    if (token === renderToken) main.append(h("p", { class: "error" }, t.error(error instanceof Error ? error.message : String(error))));
  };
  try {
    const result = tab.render(name, { main, onDispose: (fn) => disposers.push(fn) });
    if (result) void result.catch(fail);
  } catch (error) {
    fail(error);
  }
}

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, t.loading));
  try {
    files = await fetchGameFiles(BASE);
    index = new ResourceIndex();
    for (const [mapName, volumeName] of VOLUMES) {
      const [map, volume] = await Promise.all([fetchBytes(BASE, mapName), fetchBytes(BASE, volumeName)]);
      index.addVolume(map, volume, volumeName);
    }
    for (const path of files.list((p) => p.startsWith("PATCHES/") && parsePatchFileName(p) !== undefined)) {
      index.addPatch(path, await fetchBytes(BASE, path));
    }
  } catch (error) {
    root.replaceChildren(h("p", { class: "error" }, t.unavailable((error as Error).message)), h("p", { class: "empty" }, t.extractHint));
    return;
  }
  current = parseLocation(location.hash);
  window.addEventListener("hashchange", () => {
    current = parseLocation(location.hash);
    show();
  });
  show();
}

void start();
