/**
 * Visionneuse de ressources de L'Odyssée des Zoombinis : outil de développement, hors du build du site.
 * Page : `/src/games/zoombinis/ui/asset-viewer.html` (serveur de dev Vite). Les fichiers du jeu viennent de
 * `original/zoombinis/` (servi en `/zoombinis/`), listés par `files.json`. La mécanique (barre latérale, sélection,
 * chargement) est dans `src/ui/asset-viewer/` ; ici : un panneau d'archive Mohawk (types -> ressources -> détail).
 *
 * Les libellés sont ceux d'un outil de développement, pas du texte du produit.
 */
import { createMonoBuffer } from "../../../audio/pcm";
import { extractMidi, isMidi } from "../../../data/mohawk/midi";
import { MohawkArchive, TAG_SHPL, TAG_SND, TAG_STRL } from "../../../data/mohawk/mohawk";
import type { Shape } from "../../../data/mohawk/shap";
import { parseShpl } from "../../../data/mohawk/shpl";
import { parseStrl } from "../../../data/mohawk/strl";
import { decodeTbmpImages, isTbmpSheet } from "../../../data/mohawk/tbmp";
import { isWave, parseWave, waveDuration, waveToFloat32 } from "../../../data/mohawk/wave";
import { fetchGameFiles, type GameFileEntry, type GameFiles } from "../../../data/game-files";
import { paintIndexed } from "../../../ui/indexed-canvas";
import { formatSize, h, hexDump, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import { mountAssetViewer, type Panel, type PanelContext } from "../../../ui/asset-viewer/viewer";
import { applyShpl, createPalette } from "../../mathemagique/data/palette";
import {
  ARCHIVE_NAMES,
  BACKGROUND_ID,
  TAG_CURS,
  TAG_NODE,
  TAG_PATH,
  TAG_REGS,
  TAG_SCRB,
  TAG_SCRS,
  TAG_SYSX,
  TAG_TBMP,
  TAG_TMID,
} from "../data/archives";
import { cursorToRgba, CURSOR_SIZE, parseCurs } from "../data/curs";
import { parseNode, parsePath } from "../data/node-path";
import { anchorPosition, parseAnchors, parseRegs, type Anchors } from "../data/regs";
import { parseScrb, parseScrs, snoidVoiceCode, visibleCells, type Script } from "../data/script";
import { parseSysx } from "../data/sysx";

const BASE = "/zoombinis";
const SCREEN_W = 640;
const SCREEN_H = 480;
const DEFAULT_DELAY_MS = 100;

const tagLabel = (tag: string): string => tag.replace(/\0/g, "\\0");
const hex = (n: number, width = 4): string => n.toString(16).padStart(width, "0");

function info(...rows: [string, string | number][]): HTMLDListElement {
  const dl = h("dl", { class: "info" });
  for (const [key, value] of rows) dl.append(h("dt", {}, key), h("dd", {}, String(value)));
  return dl;
}

function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h("button", { type: "button", ...attrs }, label);
  b.addEventListener("click", onClick);
  return b;
}

function table(head: string[], rows: (string | number)[][], numeric = true): HTMLTableElement {
  const t = h("table", {}, h("thead", {}, h("tr", {}, ...head.map((label) => h("th", {}, label)))));
  const body = h("tbody", {});
  for (const row of rows) body.append(h("tr", {}, ...row.map((cell) => h("td", numeric && typeof cell === "number" ? { class: "num" } : {}, String(cell)))));
  t.append(body);
  return t;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  return h("label", { class: "field" }, label, control);
}

function select(options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const s = h("select", {});
  for (const option of options) s.append(h("option", { value: option.value }, option.label));
  s.value = value;
  return s;
}

/** Palette en niveaux de gris, quand aucune `SHPL` n'est disponible. */
function grayPalette(): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) palette.fill(i, i * 3, i * 3 + 3);
  return palette;
}

/** Sous-image -> canvas à sa taille (index 0 transparent) ; `null` si elle est vide. */
function shapeCanvas(shape: Shape, palette: Uint8Array): HTMLCanvasElement | null {
  if (shape.width === 0 || shape.height === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = shape.width;
  canvas.height = shape.height;
  paintIndexed(canvas, shape.pixels, shape.width, shape.height, palette, { transparent: 0 });
  return canvas;
}

async function resumed(ctx: PanelContext): Promise<AudioContext> {
  const audio = ctx.audio();
  if (audio.state === "suspended") await audio.resume();
  return audio;
}

/** Une `SHPL` choisie pour les images : archive source (`null` = l'archive ouverte) et id (`auto` = même id que la ressource, sinon 1000, sinon la première). */
interface PaletteChoice {
  archive: string | null;
  shpl: number | "auto";
}

/** Planche `tBMP` de l'archive ouverte. */
interface Sheet {
  id: number;
  count: number;
}

function renderArchive(ctx: PanelContext): HTMLElement {
  const archive = MohawkArchive.parse(ctx.bytes);
  const ownName = ctx.path.slice(ctx.path.lastIndexOf("/") + 1).toUpperCase();
  const archives = new Map<string, Promise<MohawkArchive>>();
  const palettes = new Map<string, Uint8Array>();
  const decoded = new Map<number, Shape[]>();
  const choice: PaletteChoice = { archive: null, shpl: "auto" };
  let sheetsPromise: Promise<{ sheets: Sheet[]; singles: number[] }> | null = null;
  let cleanup: (() => void)[] = [];
  let showToken = 0;
  let currentTag = "";
  let currentId: number | null = null;

  const runCleanup = (): void => {
    for (const fn of cleanup) fn();
    cleanup = [];
  };
  ctx.onDispose(runCleanup);

  // Données ------------------------------------------------------------------------------------------------------------

  /** Archive ouverte (`null`) ou une autre archive du jeu, chargée une fois. */
  function archiveOf(name: string | null): Promise<MohawkArchive> {
    if (name === null) return Promise.resolve(archive);
    let promise = archives.get(name);
    if (!promise) {
      const path = ctx.files.resolve(name);
      promise = path ? ctx.fetchBytes(path).then((bytes) => MohawkArchive.parse(bytes)) : Promise.reject(new Error(`${name} absent du manifeste`));
      archives.set(name, promise);
    }
    return promise;
  }

  /** Palette du jeu pour une ressource d'id `resourceId` (voir `PaletteChoice`) ; niveaux de gris sans `SHPL`. */
  async function paletteFor(resourceId: number): Promise<{ palette: Uint8Array; label: string }> {
    const source = await archiveOf(choice.archive);
    const ids = source.ids(TAG_SHPL);
    const id = choice.shpl === "auto" ? [resourceId, BACKGROUND_ID].find((candidate) => ids.includes(candidate)) ?? ids[0] : choice.shpl;
    if (id === undefined || !source.has(TAG_SHPL, id)) return { palette: grayPalette(), label: "aucune (niveaux de gris)" };
    const name = choice.archive ?? ownName;
    const key = `${name}:${id}`;
    let palette = palettes.get(key);
    if (!palette) {
      palette = createPalette();
      applyShpl(palette, parseShpl(source.get(TAG_SHPL, id)));
      palettes.set(key, palette);
    }
    return { palette, label: `SHPL ${id} de ${name}` };
  }

  function images(id: number): Shape[] {
    let shapes = decoded.get(id);
    if (!shapes) {
      shapes = decodeTbmpImages(archive.get(TAG_TBMP, id));
      decoded.set(id, shapes);
    }
    return shapes;
  }

  /** Planches et images isolées de l'archive (calculé une fois). */
  function sheetInfo(): Promise<{ sheets: Sheet[]; singles: number[] }> {
    sheetsPromise ??= Promise.resolve().then(() => {
      const sheets: Sheet[] = [];
      const singles: number[] = [];
      for (const id of archive.ids(TAG_TBMP)) {
        const bytes = archive.get(TAG_TBMP, id);
        if (isTbmpSheet(bytes)) sheets.push({ id, count: (bytes[0]! << 8) | bytes[1]! });
        else singles.push(id);
      }
      return { sheets, singles };
    });
    return sheetsPromise;
  }

  /** Fond de l'écran en canvas 640 x 480 (ou `null`) : `id` d'une `tBMP`, première sous-image si c'est une planche. */
  function backgroundCanvas(id: number | null, palette: Uint8Array): HTMLCanvasElement | null {
    if (id === null || !archive.has(TAG_TBMP, id)) return null;
    const first = images(id)[0];
    return first ? shapeCanvas(first, palette) : null;
  }

  // Panneau de palette -------------------------------------------------------------------------------------------------

  const archiveSelect = select(
    [
      { value: "", label: `cette archive (${ownName})` },
      ...ARCHIVE_NAMES.filter((name) => name !== ownName && ctx.files.has(name)).map((name) => ({ value: name, label: name })),
    ],
    "",
  );
  const shplSelect = select([{ value: "auto", label: "auto" }], "auto");
  const paletteBar = h("div", { class: "palette-bar" }, h("span", { class: "note" }, "palette"), field("archive", archiveSelect), field("SHPL", shplSelect));

  async function fillShplOptions(): Promise<void> {
    const source = await archiveOf(choice.archive);
    const ids = source.ids(TAG_SHPL);
    shplSelect.replaceChildren(h("option", { value: "auto" }, "auto"), ...ids.map((id) => h("option", { value: String(id) }, String(id))));
    shplSelect.value = choice.shpl === "auto" || !ids.includes(choice.shpl) ? "auto" : String(choice.shpl);
    if (shplSelect.value === "auto") choice.shpl = "auto";
  }

  archiveSelect.addEventListener("change", () => {
    choice.archive = archiveSelect.value || null;
    choice.shpl = "auto";
    void fillShplOptions().then(refresh, showError);
  });
  shplSelect.addEventListener("change", () => {
    choice.shpl = shplSelect.value === "auto" ? "auto" : Number(shplSelect.value);
    refresh();
  });
  if (archive.count(TAG_SHPL) === 0 && ownName !== "BASECAMP.MHK" && ctx.files.has("BASECAMP.MHK")) {
    choice.archive = "BASECAMP.MHK";
    archiveSelect.value = "BASECAMP.MHK";
  }
  void fillShplOptions().catch(showError);

  // Vues par type ------------------------------------------------------------------------------------------------------

  async function tbmpView(id: number): Promise<HTMLElement> {
    const bytes = archive.get(TAG_TBMP, id);
    const sheet = isTbmpSheet(bytes);
    const shapes = images(id);
    const { palette, label } = await paletteFor(id);
    const zoom = select([1, 2, 3, 4].map((n) => ({ value: String(n), label: `x${n}` })), "1");
    const grid = h("div", { class: "grid scroll" });
    grid.style.display = "flex";
    grid.style.flexWrap = "wrap";
    grid.style.gap = "10px";
    grid.style.alignItems = "flex-end";
    const paint = (): void => {
      const scale = Number(zoom.value);
      grid.replaceChildren(
        ...shapes.map((shape, i) => {
          const canvas = shapeCanvas(shape, palette);
          if (canvas) {
            canvas.style.width = `${shape.width * scale}px`;
            canvas.style.height = `${shape.height * scale}px`;
            canvas.className = "alpha";
          }
          return h("figure", {}, canvas ?? h("span", { class: "note" }, "vide"), h("figcaption", {}, `w ${i + 1} · ${shape.width}×${shape.height}`));
        }),
      );
    };
    zoom.addEventListener("change", paint);
    paint();
    return h(
      "div",
      {},
      info(["type", sheet ? "planche multi-images" : "image isolée"], ["images", shapes.length], ["palette", label]),
      h("div", { class: "bar" }, field("zoom", zoom)),
      grid,
    );
  }

  /** Planche par défaut d'un script : la dernière d'id <= celui du script qui contient assez d'images, sinon la plus petite qui suffit. */
  function defaultSheet(sheets: Sheet[], scriptId: number, maxW: number): number | null {
    const fitting = sheets.filter((sheet) => sheet.count >= maxW);
    const below = fitting.filter((sheet) => sheet.id <= scriptId);
    return (below.at(-1) ?? fitting[0] ?? sheets.at(-1))?.id ?? null;
  }

  async function scriptView(tag: typeof TAG_SCRB | typeof TAG_SCRS, id: number): Promise<HTMLElement> {
    const bytes = archive.get(tag, id);
    const script: Script = tag === TAG_SCRB ? parseScrb(bytes) : parseScrs(bytes);
    const { sheets, singles } = await sheetInfo();
    const maxW = Math.max(0, ...script.images.flatMap((image) => image.cells.map((cell) => cell.w)));
    const { palette, label } = await paletteFor(id);

    const sheetSelect = select(
      [{ value: "", label: "aucune" }, ...sheets.map((sheet) => ({ value: String(sheet.id), label: `${sheet.id} (${sheet.count} images)` }))],
      String(defaultSheet(sheets, id, maxW) ?? ""),
    );
    const bgSelect = select(
      [{ value: "", label: "aucun" }, ...singles.map((single) => ({ value: String(single), label: String(single) }))],
      singles.includes(BACKGROUND_ID) ? String(BACKGROUND_ID) : "",
    );
    const anchorsBox = h("input", { type: "checkbox" });
    const anchorsField = field("ancrages REGS", anchorsBox);
    const soundBox = h("input", { type: "checkbox" });
    const delayInput = h("input", { type: "number", min: "10", max: "2000", step: "10", value: String(DEFAULT_DELAY_MS), class: "narrow" });
    const playButton = h("button", { type: "button" }, "lecture");
    const slider = h("input", { type: "range", min: "0", max: String(Math.max(0, script.images.length - 1)), value: "0" });
    const status = h("p", { class: "note" });
    const canvas = h("canvas", { class: "alpha", width: String(SCREEN_W), height: String(SCREEN_H) });
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;

    let frame = 0;
    let timer: number | undefined;
    let sprites: (HTMLCanvasElement | null)[] = [];
    let anchors: Anchors | undefined;
    let background: HTMLCanvasElement | null = null;
    let source: AudioBufferSourceNode | null = null;
    const rows: HTMLTableRowElement[] = [];

    const loadSheet = (): void => {
      const sheetId = sheetSelect.value === "" ? null : Number(sheetSelect.value);
      sprites = sheetId === null ? [] : images(sheetId).map((shape) => shapeCanvas(shape, palette));
      anchors = undefined;
      anchorsBox.disabled = true;
      anchorsBox.checked = false;
      if (sheetId !== null && archive.has(TAG_REGS, sheetId) && archive.has(TAG_REGS, sheetId + 1)) {
        try {
          const found = parseAnchors(archive.get(TAG_REGS, sheetId), archive.get(TAG_REGS, sheetId + 1));
          anchors = found;
          anchorsBox.disabled = false;
          anchorsBox.checked = found.x.length === sprites.length + 1;
        } catch {
          /* REGS incohérentes avec la planche : ancrages indisponibles */
        }
      }
      anchorsField.title = anchors ? `REGS ${sheetId} et ${(sheetId ?? 0) + 1} : ${anchors.x.length} valeurs` : "pas de REGS pour cette planche";
    };

    const playSound = async (soundId: number): Promise<void> => {
      const raw = archive.find(TAG_SND, soundId);
      if (!raw || !isWave(raw)) return;
      const audio = await resumed(ctx);
      source?.stop();
      const node = audio.createBufferSource();
      node.buffer = createMonoBuffer(audio, waveToFloat32(parseWave(raw)), parseWave(raw).sampleRate);
      node.connect(audio.destination);
      node.start();
      source = node;
    };

    const draw = (): void => {
      g.clearRect(0, 0, SCREEN_W, SCREEN_H);
      if (background) g.drawImage(background, 0, 0);
      const image = script.images[frame];
      if (!image) return;
      let missing = 0;
      for (const cell of visibleCells(image)) {
        const sprite = sprites[cell.w - 1];
        if (!sprite) {
          missing++;
          continue;
        }
        const at = anchorPosition(anchorsBox.checked ? anchors : undefined, cell);
        g.drawImage(sprite, at.x, at.y);
      }
      slider.value = String(frame);
      rows.forEach((row, i) => row.setAttribute("aria-current", String(i === frame)));
      const voice = snoidVoiceCode(image.event);
      status.textContent =
        `image ${frame + 1}/${script.images.length} · ${visibleCells(image).length} parties` +
        (missing ? ` (${missing} sans sous-image)` : "") +
        ` · évènement ${image.event}` +
        (voice !== undefined ? ` (voix, code ${voice})` : "") +
        (image.soundId !== undefined ? ` · son ${image.soundId}` : "") +
        (image.terminated ? "" : " · image de 24 cases sans terminateur");
    };

    const goTo = (n: number, sound = false): void => {
      const count = script.images.length;
      if (count === 0) return;
      frame = ((n % count) + count) % count;
      draw();
      const soundId = script.images[frame]?.soundId;
      if (sound && soundBox.checked && soundId !== undefined) void playSound(soundId);
    };

    const stop = (): void => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      playButton.textContent = "lecture";
    };
    const start = (): void => {
      stop();
      const delay = Math.max(10, Number(delayInput.value) || DEFAULT_DELAY_MS);
      timer = window.setInterval(() => goTo(frame + 1, true), delay);
      playButton.textContent = "pause";
    };
    cleanup.push(() => {
      stop();
      source?.stop();
    });

    playButton.addEventListener("click", () => (timer === undefined ? start() : stop()));
    delayInput.addEventListener("change", () => timer !== undefined && start());
    slider.addEventListener("input", () => {
      stop();
      goTo(Number(slider.value));
    });
    sheetSelect.addEventListener("change", () => {
      loadSheet();
      draw();
    });
    bgSelect.addEventListener("change", () => {
      background = backgroundCanvas(bgSelect.value === "" ? null : Number(bgSelect.value), palette);
      draw();
    });
    anchorsBox.addEventListener("change", draw);

    const structure = table(
      ["image", "parties (w @ x,y)", "évènement", "son"],
      script.images.map((image, i) => [
        i + 1,
        image.cells.map((cell) => (cell.w === 0 ? "·" : `${cell.w} @ ${cell.x},${cell.y}`)).join("  "),
        image.terminated ? `${image.event} (${hex(image.terminator)})` : "aucun terminateur",
        image.soundId ?? "",
      ]),
    );
    structure.querySelectorAll("tbody tr").forEach((row, i) => {
      const tr = row as HTMLTableRowElement;
      rows.push(tr);
      tr.classList.add("pick");
      tr.addEventListener("click", () => {
        stop();
        goTo(i);
      });
    });

    background = backgroundCanvas(bgSelect.value === "" ? null : Number(bgSelect.value), palette);
    loadSheet();
    draw();

    return h(
      "div",
      {},
      info(
        ["images", script.imageCount],
        ...(script.pose !== undefined ? ([["pose", script.pose === 0xffff ? "0xffff" : script.pose]] as [string, string | number][]) : []),
        ["w max", maxW],
        ["palette", label],
        ["octets non lus", script.trailingWords * 2],
      ),
      tag === TAG_SCRS
        ? h("p", { class: "note" }, "SCRS : les w sont des variantes de pose, traduites en indice de planche par le moteur (non élucidé) : aperçu approximatif.")
        : null,
      h(
        "div",
        { class: "bar" },
        field("planche", sheetSelect),
        field("fond", bgSelect),
        anchorsField,
        field("sons", soundBox),
        field("délai (ms)", delayInput),
      ),
      h(
        "div",
        { class: "bar" },
        playButton,
        button("précédente", () => (stop(), goTo(frame - 1))),
        button("suivante", () => (stop(), goTo(frame + 1))),
        slider,
      ),
      status,
      h("div", { class: "stage-box" }, canvas),
      h("h3", {}, "Structure"),
      h("div", { class: "scroll" }, structure),
    );
  }

  function soundView(id: number): HTMLElement {
    const raw = archive.get(TAG_SND, id);
    if (isMidi(raw)) return midiView(raw, `${id}`);
    if (!isWave(raw)) return h("pre", {}, hexDump(raw, 1024));
    const wave = parseWave(raw);
    const loopBox = h("input", { type: "checkbox" });
    loopBox.checked = wave.loopCount === 0xffff;
    const playButton = h("button", { type: "button" }, "lecture");
    let source: AudioBufferSourceNode | null = null;
    const stop = (): void => {
      source?.stop();
      source = null;
      playButton.textContent = "lecture";
    };
    cleanup.push(stop);
    playButton.addEventListener("click", async () => {
      if (source) return stop();
      const audio = await resumed(ctx);
      const node = audio.createBufferSource();
      const rate = Math.max(3000, wave.sampleRate);
      node.buffer = createMonoBuffer(audio, waveToFloat32(wave), wave.sampleRate);
      node.loop = loopBox.checked;
      if (loopBox.checked && wave.loopEnd > wave.loopStart) {
        node.loopStart = wave.loopStart / rate;
        node.loopEnd = wave.loopEnd / rate;
      }
      node.connect(audio.destination);
      node.onended = () => source === node && stop();
      node.start();
      source = node;
      playButton.textContent = "arrêt";
    });
    return h(
      "div",
      {},
      info(
        ["fréquence", `${wave.sampleRate} Hz`],
        ["durée", `${waveDuration(wave).toFixed(3)} s (${wave.samples.length} échantillons)`],
        ["boucles", wave.loopCount === 0xffff ? "infinie" : wave.loopCount],
        ["boucle", `${wave.loopStart} → ${wave.loopEnd}`],
        ["repères", wave.cues.length ? wave.cues.map((cue) => `${cue.name}@${cue.sampleFrame}`).join(", ") : "aucun"],
      ),
      h("div", { class: "bar" }, playButton, field("boucle", loopBox)),
    );
  }

  function midiView(raw: Uint8Array, name: string): HTMLElement {
    const smf = isMidi(raw) ? extractMidi(raw) : raw;
    if (String.fromCharCode(...smf.subarray(0, 4)) !== "MThd") throw new Error("ressource MIDI non reconnue");
    const url = URL.createObjectURL(new Blob([smf as Uint8Array<ArrayBuffer>], { type: "audio/midi" }));
    cleanup.push(() => URL.revokeObjectURL(url));
    const link = h("a", { href: url, download: `${ownName.replace(/\.[^.]*$/, "")}-${name}.mid` }, "télécharger .mid");
    return h("div", {}, info(["taille du .mid", formatSize(smf.length)]), h("div", { class: "bar" }, link));
  }

  function strlView(id: number): HTMLElement {
    const strings = parseStrl(archive.get(TAG_STRL, id), "mac-roman");
    const t = table(["n°", "texte"], strings.map((text, i) => [i, text]));
    t.querySelectorAll("tbody tr td:last-child").forEach((cell) => cell.classList.add("text"));
    return h("div", {}, info(["chaînes", strings.length], ["codage", "Mac Roman"]), t);
  }

  /** Points / chemins / couples de REGS dessinés sur un fond. */
  interface Overlay {
    points: { x: number; y: number }[];
    paths: number[][];
    /** Les indices des points sont 1-based (NODE/PATH) ou 0-based (couples de REGS). */
    firstIndex: number;
  }

  async function overlayCanvas(resourceId: number, getOverlay: () => Overlay, getSelected: () => number | null): Promise<{ box: HTMLElement; redraw: () => void }> {
    const { singles } = await sheetInfo();
    const { palette } = await paletteFor(resourceId);
    const fallback = singles.includes(resourceId) ? resourceId : singles.includes(BACKGROUND_ID) ? BACKGROUND_ID : singles[0];
    const bgSelect = select(
      [{ value: "", label: "aucun" }, ...singles.map((single) => ({ value: String(single), label: String(single) }))],
      fallback === undefined ? "" : String(fallback),
    );
    const canvas = h("canvas", { width: String(SCREEN_W), height: String(SCREEN_H) });
    const g = canvas.getContext("2d")!;
    const redraw = (): void => {
      g.clearRect(0, 0, SCREEN_W, SCREEN_H);
      g.fillStyle = "#000";
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
      const bg = backgroundCanvas(bgSelect.value === "" ? null : Number(bgSelect.value), palette);
      if (bg) g.drawImage(bg, 0, 0);
      const { points, paths, firstIndex } = getOverlay();
      const selected = getSelected();
      const at = (index: number): { x: number; y: number } | undefined => points[index - firstIndex];
      paths.forEach((path, i) => {
        g.strokeStyle = i === selected ? "#ffd84f" : "rgba(106,162,255,0.6)";
        g.lineWidth = i === selected ? 3 : 1;
        g.beginPath();
        path.forEach((index, k) => {
          const p = at(index);
          if (!p) return;
          if (k === 0) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        });
        g.stroke();
      });
      g.font = "11px ui-monospace, Menlo, monospace";
      points.forEach((p, i) => {
        g.fillStyle = "#ff4d4d";
        g.beginPath();
        g.arc(p.x, p.y, 4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fff";
        g.fillText(String(i + firstIndex), p.x + 6, p.y - 4);
      });
    };
    bgSelect.addEventListener("change", redraw);
    redraw();
    return { box: h("div", {}, h("div", { class: "bar" }, field("fond", bgSelect)), h("div", { class: "stage-box" }, canvas)), redraw };
  }

  async function nodePathView(tag: typeof TAG_NODE | typeof TAG_PATH, id: number): Promise<HTMLElement> {
    const nodeBytes = archive.find(TAG_NODE, id);
    const pathBytes = archive.find(TAG_PATH, id);
    const points = nodeBytes ? parseNode(nodeBytes) : [];
    const paths = pathBytes ? parsePath(pathBytes) : [];
    let selected: number | null = null;
    const overlay = await overlayCanvas(id, () => ({ points, paths, firstIndex: 1 }), () => selected);
    const nodesTable = table(["n°", "x", "y"], points.map((p, i) => [i + 1, p.x, p.y]));
    const pathsTable = table(["n°", "nœuds"], paths.map((path, i) => [i + 1, path.join(" → ")]));
    pathsTable.querySelectorAll("tbody tr").forEach((row, i) => {
      row.classList.add("pick");
      row.addEventListener("click", () => {
        selected = selected === i ? null : i;
        pathsTable.querySelectorAll("tbody tr").forEach((other, k) => other.setAttribute("aria-current", String(k === selected)));
        overlay.redraw();
      });
    });
    return h(
      "div",
      {},
      info(
        ["points (NODE)", nodeBytes ? points.length : "absent"],
        ["chemins (PATH)", pathBytes ? paths.length : "absent"],
        ["ouvert", tag],
      ),
      overlay.box,
      h("h3", {}, "NODE"),
      nodesTable,
      h("h3", {}, "PATH (clic = surligner)"),
      pathsTable,
    );
  }

  async function regsView(id: number): Promise<HTMLElement> {
    const words = parseRegs(archive.get(TAG_REGS, id));
    const { sheets } = await sheetInfo();
    const own = sheets.find((sheet) => sheet.id === id && sheet.count + 1 === words.length);
    const previous = sheets.find((sheet) => sheet.id === id - 1 && sheet.count + 1 === words.length);
    const note = own ? `ancrages X de la planche tBMP ${id}` : previous ? `ancrages Y de la planche tBMP ${id - 1}` : "sans planche associée (table de données)";
    const pairsBox = h("input", { type: "checkbox" });
    const pairs = (): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < words.length; i += 2) out.push({ x: words[i]!, y: words[i + 1]! });
      return out;
    };
    const overlay = await overlayCanvas(id, () => ({ points: pairsBox.checked ? pairs() : [], paths: [], firstIndex: 0 }), () => null);
    pairsBox.addEventListener("change", overlay.redraw);
    return h(
      "div",
      {},
      info(["mots", words.length], ["usage probable", note]),
      h("div", { class: "bar" }, field("voir comme couples (x, y)", pairsBox)),
      overlay.box,
      table(["n°", "valeur"], [...words].map((value, i) => [i, value])),
    );
  }

  function cursView(selectedId: number): HTMLElement {
    const scale = 12;
    const row = h("div", { class: "cursors" });
    for (const id of archive.ids(TAG_CURS)) {
      const cursor = parseCurs(archive.get(TAG_CURS, id));
      const canvas = h("canvas", { width: String(CURSOR_SIZE), height: String(CURSOR_SIZE), class: "alpha" });
      canvas.style.width = `${CURSOR_SIZE * scale}px`;
      canvas.style.height = `${CURSOR_SIZE * scale}px`;
      const rgba = cursorToRgba(cursor);
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), CURSOR_SIZE, CURSOR_SIZE), 0, 0);
      const marker = h("div", { class: "hotspot" });
      marker.style.left = `${cursor.hotspot.x * scale}px`;
      marker.style.top = `${cursor.hotspot.y * scale}px`;
      marker.style.width = `${scale}px`;
      marker.style.height = `${scale}px`;
      row.append(
        h(
          "figure",
          { "aria-current": String(id === selectedId) },
          h("div", { class: "cursor-box" }, canvas, marker),
          h("figcaption", {}, `CURS ${id} · point chaud ${cursor.hotspot.x},${cursor.hotspot.y}`),
        ),
      );
    }
    return h("div", {}, h("p", { class: "note" }, "cadre rouge = point chaud (x = +0x40, y = +0x42, ordre non confirmé)"), row);
  }

  function sysxView(id: number): HTMLElement {
    const messages = parseSysx(archive.get(TAG_SYSX, id));
    const names: Record<number, string> = { 0x79: "réinitialise les contrôleurs", 0x07: "volume", 0x0b: "expression", 0x0a: "panoramique" };
    return h(
      "div",
      {},
      info(["messages", messages.length]),
      table(
        ["n°", "état", "canal", "donnée 1", "donnée 2", "contrôleur"],
        messages.map((m, i) => [i, hex(m.status, 2), (m.status & 0xf) + 1, hex(m.data1, 2), hex(m.data2, 2), (m.status & 0xf0) === 0xb0 ? (names[m.data1] ?? "") : ""]),
        false,
      ),
    );
  }

  function shplView(id: number): HTMLElement {
    const bytes = archive.get(TAG_SHPL, id);
    const list = parseShpl(bytes);
    const palette = createPalette();
    applyShpl(palette, list);
    return h(
      "div",
      {},
      info(["premier SHAP", list.firstShapeId], ["nombre de SHAP", list.shapeCount], ["premier index", list.paletteFirst], ["entrées", list.rgb.length / 3]),
      h("p", { class: "note" }, "palette éclaircie (c + 31 - c/8)"),
      paletteSwatch(palette),
    );
  }

  async function detailView(tag: string, id: number): Promise<HTMLElement> {
    switch (tag) {
      case TAG_TBMP:
        return tbmpView(id);
      case TAG_SCRB:
      case TAG_SCRS:
        return scriptView(tag, id);
      case TAG_SND:
        return soundView(id);
      case TAG_TMID:
        return midiView(archive.get(tag, id), String(id));
      case TAG_STRL:
        return strlView(id);
      case TAG_NODE:
      case TAG_PATH:
        return nodePathView(tag, id);
      case TAG_REGS:
        return regsView(id);
      case TAG_CURS:
        return cursView(id);
      case TAG_SYSX:
        return sysxView(id);
      case TAG_SHPL:
        return shplView(id);
      default:
        return h("pre", {}, hexDump(archive.get(tag, id), 1024));
    }
  }

  // Interface ----------------------------------------------------------------------------------------------------------

  const detail = h("div", { class: "detail" }, h("p", { class: "empty" }, "choisir une ressource"));
  const typeBar = h("div", { class: "chips" });
  const filter = h("input", { type: "search", placeholder: "filtrer par id", "aria-label": "Filtrer les ressources" });
  const list = h("div", { class: "reslist-items" });
  const itemButtons = new Map<number, HTMLButtonElement>();

  function showError(error: unknown): void {
    detail.replaceChildren(h("p", { class: "error" }, `Erreur : ${error instanceof Error ? error.message : String(error)}`));
  }

  async function show(tag: string, id: number): Promise<void> {
    const token = ++showToken;
    currentTag = tag;
    currentId = id;
    runCleanup();
    for (const [itemId, b] of itemButtons) b.setAttribute("aria-current", String(itemId === id));
    detail.replaceChildren(h("h3", { class: "detail-title" }, `${tagLabel(tag)} ${id} (${formatSize(archive.get(tag, id).length)})`), h("p", { class: "loading" }, "chargement…"));
    try {
      const view = await detailView(tag, id);
      if (token !== showToken) return;
      detail.replaceChildren(h("h3", { class: "detail-title" }, `${tagLabel(tag)} ${id} (${formatSize(archive.get(tag, id).length)})`), view);
    } catch (error) {
      if (token === showToken) showError(error);
    }
  }

  function refresh(): void {
    if (currentId !== null) void show(currentTag, currentId);
  }

  function selectType(tag: string): void {
    currentTag = tag;
    currentId = null;
    showToken++;
    runCleanup();
    for (const b of typeBar.children) b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.tag === tag));
    itemButtons.clear();
    filter.value = "";
    list.replaceChildren(
      ...archive.ids(tag).map((id) => {
        const b = h("button", { type: "button", class: "res" }, h("span", {}, String(id)), h("span", { class: "res-size" }, formatSize(archive.get(tag, id).length)));
        b.addEventListener("click", () => void show(tag, id));
        itemButtons.set(id, b);
        return b;
      }),
    );
    detail.replaceChildren(h("p", { class: "empty" }, "choisir une ressource"));
  }

  filter.addEventListener("input", () => {
    const query = filter.value.trim();
    for (const [id, b] of itemButtons) b.hidden = query !== "" && !String(id).includes(query);
  });

  for (const tag of archive.types()) {
    const b = h("button", { type: "button", class: "chip", "aria-pressed": "false", title: `${archive.count(tag)} ressources` }, `${tagLabel(tag)} ${archive.count(tag)}`);
    b.dataset.tag = tag;
    b.addEventListener("click", () => selectType(tag));
    typeBar.append(b);
  }
  const firstType = archive.types().find((tag) => tag === TAG_TBMP) ?? archive.types()[0];
  if (firstType) selectType(firstType);

  return h(
    "div",
    {},
    info(["types", archive.types().length], ["ressources", archive.types().reduce((n, tag) => n + archive.count(tag), 0)]),
    paletteBar,
    h("div", { class: "split" }, h("div", { class: "reslist" }, typeBar, filter, list), detail),
  );
}

const archivePanel: Panel = {
  matches: (entry: GameFileEntry) => /\.MHK$/i.test(entry.path) || /(^|\/)MIDIMAP\.DAT$/i.test(entry.path),
  render: renderArchive,
};

const root = document.getElementById("app")!;

/** Groupe (dossier de la barre latérale) d'un fichier. */
function family(entry: GameFileEntry): string {
  if (/\.MHK$/i.test(entry.path)) return "Archives";
  if (/\.DAT$/i.test(entry.path)) return "Données";
  return "Divers";
}

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "loading" }, "chargement du manifeste…"));
  let files: GameFiles;
  try {
    files = await fetchGameFiles(BASE);
  } catch (error) {
    root.replaceChildren(
      h("p", { class: "error" }, `Manifeste indisponible : ${(error as Error).message}`),
      h("p", { class: "empty" }, "Lancer scripts/zoombinis-extract.sh"),
    );
    return;
  }
  mountAssetViewer({ root, title: "Zoombinis — ressources", files, base: BASE, groups: family, panels: [archivePanel] });
}

void start();
