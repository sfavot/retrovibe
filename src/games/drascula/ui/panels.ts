/**
 * Panneaux de la visionneuse de ressources de Drascula : images `.ALG` (avec leur palette), animations `.BIN`
 * image par image, fiches `.ALD` et dialogues `.CAL` en tableau, textes et police de `drascula.dat`, lecture d'un
 * `.ALS`. Outil de développement : les libellés ne sont pas du texte du produit.
 */
import { createMonoBuffer, u8ToFloat32 } from "../../../audio/pcm";
import { decodeCp850 } from "../../../data/cp850";
import type { GameFileEntry } from "../../../data/game-files";
import { formatSize, h, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import type { Panel, PanelContext } from "../../../ui/asset-viewer/viewer";
import { makeCanvas, paintIndexed } from "../../../ui/indexed-canvas";
import { parseAld, type AldRoom } from "../data/ald";
import { parseAlg } from "../data/alg";
import { ALS_SAMPLE_RATE, alsSamples } from "../data/als";
import { parseCal } from "../data/cal";
import { DAT_LANGUAGES, DAT_TEXT_NAMES, parseDat, type DatLanguage, type DatTextName, type DrasculaDat } from "../data/dat";
import { baseName, extensionOf, voiceFile } from "../data/files";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/rle";
import { decodeBin, sampleIndices, type BinFrame, type BinFrames } from "./bin-frames";
import { DIALOG_FONT_SHEET, DIALOG_GLYPH, DIALOG_STATES, FONT_SHEET, GLYPH, GameFont, type DialogState } from "../render/font";
import { HALF_PAL_COLORS, halfPalette, scummvmRgb6, scummvmRgb8 } from "../render/palette";
import { Plane } from "../render/plane";
import {
  PLAY_SPEEDS,
  VOICE_TEXT,
  defaultSpeed,
  playDuration,
  reservedPixels,
  stem,
  usedColors,
  waveformPeaks,
} from "./viewer-data";

type Cell = string | number | Node;

/** Palette complète du jeu pendant une pièce : celle de `96.ALG`, chargée en `COMPLETE_PAL` au démarrage (`drascula.cpp`). */
const RESERVED_SOURCE = "96.ALG";
/** Nombre maximal de lignes affichées dans une liste filtrable. */
const ROW_LIMIT = 300;
const IMAGE_SCALE = 3;
const THUMBNAILS = 24;

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h("section", {}, h("h3", {}, title), ...children);
}

function info(...pairs: [string, Cell][]): HTMLElement {
  const list = h("dl", { class: "info" });
  for (const [key, value] of pairs) list.append(h("dt", {}, key), h("dd", {}, typeof value === "object" ? value : String(value)));
  return list;
}

function table(headers: string[], rows: Cell[][], numeric: number[] = []): HTMLElement {
  const head = h("tr", {}, ...headers.map((title) => h("th", {}, title)));
  const body = rows.map((row) =>
    h(
      "tr",
      {},
      ...row.map((cell, i) => {
        const td = h("td", numeric.includes(i) ? { class: "num" } : {}, typeof cell === "object" ? cell : String(cell));
        return td;
      }),
    ),
  );
  return h("table", {}, h("thead", {}, head), h("tbody", {}, ...body));
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = h("button", { type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

/** Lien vers un autre fichier du jeu (le hachage de l'URL ouvre le fichier). */
function fileLink(ctx: PanelContext, name: string): Node {
  const path = ctx.files.resolve(name);
  if (!path) return h("span", { class: "error" }, `${name} (absent)`);
  return h("a", { href: `#${encodeURI(path)}` }, path);
}

function rect(r: { x1: number; y1: number; x2: number; y2: number }): string {
  return `${r.x1},${r.y1} - ${r.x2},${r.y2}`;
}

async function resumed(ctx: PanelContext): Promise<AudioContext> {
  const audio = ctx.audio();
  if (audio.state === "suspended") await audio.resume();
  return audio;
}

const hasExtension =
  (...extensions: string[]) =>
  (entry: GameFileEntry): boolean =>
    extensions.includes(extensionOf(entry.path));

// --- Images .ALG ---------------------------------------------------------------------------------------------

/** Palette de réserve (moitié haute) d'une image chargée en `HALF_PAL`, lue une fois dans `96.ALG`. */
let reservedPalette: Promise<Uint8Array> | null = null;
function loadReserved(ctx: PanelContext): Promise<Uint8Array> {
  reservedPalette ??= (async () => {
    const path = ctx.files.resolve(RESERVED_SOURCE);
    if (!path) throw new Error(`${RESERVED_SOURCE} absent`);
    return parseAlg(await ctx.fetchBytes(path)).palette;
  })();
  reservedPalette.catch(() => (reservedPalette = null));
  return reservedPalette;
}

function renderAlg(ctx: PanelContext): HTMLElement {
  const image = parseAlg(ctx.bytes);
  const reserved = reservedPixels(image.pixels);
  const canvas = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, IMAGE_SCALE);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${ctx.path} : image ${SCREEN_WIDTH} x ${SCREEN_HEIGHT}`);
  const swatchBox = h("div", {});
  const pixel = h("output", {}, "survoler l'image : position, indice, couleur");
  const status = h("p", { class: "empty" });

  const mode = h("select", { "aria-label": "Palette" }, h("option", { value: "complete" }, "COMPLETE_PAL : les 256 couleurs de l'image"));
  mode.append(h("option", { value: "half" }, `HALF_PAL : 128 premières couleurs de l'image + 128 dernières de ${RESERVED_SOURCE}`));
  const scummvm = h("input", { type: "checkbox", id: "scummvm-rgb", checked: "" });
  scummvm.checked = true;

  let shown = image.palette;
  const draw = async (): Promise<void> => {
    status.textContent = "";
    let palette = image.palette;
    if (mode.value === "half") {
      try {
        palette = halfPalette(image.palette, await loadReserved(ctx));
      } catch (error) {
        status.textContent = `palette de réserve indisponible : ${(error as Error).message}`;
      }
    }
    shown = scummvm.checked ? scummvmRgb8(palette) : palette;
    paintIndexed(canvas, image.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, shown);
    swatchBox.replaceChildren(paletteSwatch(shown, 14));
  };
  mode.addEventListener("change", () => void draw());
  scummvm.addEventListener("change", () => void draw());
  canvas.addEventListener("mousemove", (event) => {
    const box = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * SCREEN_WIDTH);
    const y = Math.floor(((event.clientY - box.top) / box.height) * SCREEN_HEIGHT);
    if (x < 0 || y < 0 || x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT) return;
    const index = image.pixels[y * SCREEN_WIDTH + x];
    pixel.textContent = `(${x}, ${y}) indice ${index}, rgb(${shown[index * 3]}, ${shown[index * 3 + 1]}, ${shown[index * 3 + 2]})`;
  });
  void draw();

  return h(
    "div",
    {},
    info(
      ["image", `${SCREEN_WIDTH} x ${SCREEN_HEIGHT}, ${usedColors(image.pixels)} indices utilisés`],
      ["indices 128 à 255", `${reserved} pixels (${((reserved * 100) / image.pixels.length).toFixed(1)} %)`],
      ["en-tête de 128 octets", image.hasPcxHeader ? "en-tête PCX" : "remplissage"],
      ["octets entre RLE et palette", image.slack],
    ),
    h(
      "div",
      { class: "bar" },
      h("label", {}, "palette ", mode),
      h("label", {}, scummvm, " valeurs de ScummVM (deux bits de poids faible perdus)"),
    ),
    status,
    canvas,
    h("p", {}, pixel),
    section(
      "Palette",
      h("p", { class: "empty" }, `Lignes 1 à 8 : indices 0 à ${HALF_PAL_COLORS - 1} (propres à l'image) ; lignes 9 à 16 : indices ${HALF_PAL_COLORS} à 255 (héros, interface).`),
      swatchBox,
    ),
  );
}

// --- Animations .BIN -----------------------------------------------------------------------------------------

function paintFrame(canvas: HTMLCanvasElement, frame: BinFrame): void {
  const palette = frame.palette ? scummvmRgb6(frame.palette) : null;
  const gray = new Uint8Array(768).map((_, i) => Math.floor(i / 3));
  paintIndexed(canvas, frame.screen, SCREEN_WIDTH, SCREEN_HEIGHT, palette ?? gray);
}

function renderBin(ctx: PanelContext): HTMLElement {
  const bin: BinFrames = decodeBin(ctx.bytes, ctx.path);
  const total = bin.frames.length;
  const speeds = PLAY_SPEEDS[stem(ctx.path)];
  const emptyCount = bin.frames.filter((frame) => frame.kind === "empty").length;
  const canvas = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, IMAGE_SCALE);
  canvas.setAttribute("role", "img");
  const slider = h("input", { type: "range", min: "0", max: String(Math.max(0, total - 1)), value: "0", "aria-label": "Image" });
  const fps = h("input", { type: "number", min: "1", max: "60", value: String(defaultSpeed(ctx.path)), "aria-label": "Images par seconde" });
  const loop = h("input", { type: "checkbox" });
  loop.checked = true;
  const output = h("output", { "aria-live": "off" });
  const thumbs = h("div", { class: "frames" });
  const thumbOf = new Map<number, HTMLElement>();
  let current = 0;
  let timer: number | null = null;

  const show = (index: number): void => {
    current = Math.min(Math.max(index, 0), total - 1);
    const frame = bin.frames[current];
    paintFrame(canvas, frame);
    slider.value = String(current);
    const note = frame.kind === "unplayed" ? " (lue mais jamais jouée)" : frame.kind === "empty" ? " (image vide : attente)" : "";
    output.textContent = `image ${current + 1} / ${total}${note}, ${frame.kind}`;
    for (const [i, node] of thumbOf) node.setAttribute("aria-current", String(i === current));
  };
  const stop = (): void => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    play.textContent = "lire";
  };
  const start = (): void => {
    stop();
    play.textContent = "pause";
    const delay = 1000 / Math.max(1, Number(fps.value) || 12);
    timer = window.setInterval(() => {
      if (current + 1 >= bin.played) {
        if (loop.checked) show(0);
        else stop();
      } else show(current + 1);
    }, delay);
  };
  const play = button("lire", () => (timer === null ? start() : stop()));
  fps.addEventListener("change", () => {
    if (timer !== null) start();
    duration.textContent = durationText();
  });
  const durationText = (): string => `${playDuration(bin.played, Number(fps.value) || 12).toFixed(1)} s pour ${bin.played} ${bin.format === "SSN" ? "tours" : "images"} à ${fps.value} images/s`;
  const duration = h("output", {}, durationText());
  slider.addEventListener("input", () => {
    stop();
    show(Number(slider.value));
  });
  ctx.onDispose(stop);

  for (const index of sampleIndices(total, THUMBNAILS)) {
    const small = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, 0.5);
    paintFrame(small, bin.frames[index]);
    const figure = h("figure", { title: `image ${index + 1}` }, small, h("figcaption", {}, String(index + 1)));
    figure.addEventListener("click", () => {
      stop();
      show(index);
    });
    thumbOf.set(index, figure);
    thumbs.append(figure);
  }
  show(0);

  const speedText = speeds
    ? `${speeds.join(" ou ")} (${bin.format === "SSN" ? "playFLI : un tour de 1000 / vitesse ms par image ou bloc vide" : "animate : 1000 / ips ms d'attente après chaque image"})`
    : "jamais jouée par ScummVM";
  return h(
    "div",
    {},
    info(
      ["format", bin.format],
      ["images", bin.format === "SSN" ? `${total} tours : ${total - emptyCount} images + ${emptyCount} blocs vides (minuterie)` : `${total} lues, ${bin.played} jouées`],
      ["octets lus", `${bin.bytesRead} sur ${ctx.bytes.length}`],
      ["palettes différentes de la première", bin.paletteChanges],
      ["cadence de ScummVM", speedText],
    ),
    h(
      "div",
      { class: "bar" },
      play,
      button("◀", () => (stop(), show(current - 1))),
      button("▶", () => (stop(), show(current + 1))),
      slider,
      h("label", {}, "images/s ", fps),
      h("label", {}, loop, " boucle"),
    ),
    h("p", {}, output),
    h("p", { class: "empty" }, duration),
    canvas,
    section("Planche-contact", thumbs),
  );
}

// --- Fiches .ALD ---------------------------------------------------------------------------------------------

/** La disposition d'une fiche dépend du chapitre : le chapitre 2 d'un côté, les autres de l'autre ; une seule des deux se lit. */
export function readAld(bytes: Uint8Array): { room: AldRoom; chapter: number } {
  try {
    return { room: parseAld(bytes, 2), chapter: 2 };
  } catch (first) {
    try {
      return { room: parseAld(bytes, 3), chapter: 3 };
    } catch {
      throw first;
    }
  }
}

function renderAld(ctx: PanelContext): HTMLElement {
  const { room, chapter } = readAld(ctx.bytes);
  const objects = room.objects.map((object) => [
    object.id,
    object.name,
    rect(object.rect),
    `${object.approach.x},${object.approach.y}`,
    object.track,
    object.visible ? "oui" : "non",
    object.door ? `pièce ${room.number === object.door.room ? "(même)" : object.door.room}, sortie ${object.door.exit}, ${object.door.x},${object.door.y}, orientation ${object.door.direction}` : "",
  ]);
  const imageNames = [room.disk, ...(room.hero ? room.hero.surfaces : [])].filter((name) => name !== "" && name !== "0");
  return h(
    "div",
    {},
    info(
      ["pièce", room.number],
      ["disposition", chapter === 2 ? "chapitre 2" : "autres chapitres"],
      ["musique", room.music > 0 ? `piste ${room.music}` : "aucune"],
      ["image annexe", imageNames.length > 0 ? h("span", {}, ...imageNames.flatMap((name, i) => (i ? [", ", fileLink(ctx, name)] : [fileLink(ctx, name)]))) : "aucune"],
      ["fond de la pièce", fileLink(ctx, `${room.number}.alg`)],
      ["niveau de palette", room.paletteLevel],
      ["zone de marche", rect(room.walk)],
      ["limites de perspective", room.limits ? `haute ${room.limits.upper}, basse ${room.limits.lower}` : "aucune (chapitre 2)"],
      [
        "héros (chapitre 2)",
        room.hero
          ? `${room.hero.width} x ${room.hero.height}, pieds ${room.hero.feetHeight}, pas ${room.hero.stepX} x ${room.hero.stepY}`
          : "valeurs par défaut",
      ],
      ["lignes non lues par ScummVM", room.unread.length > 0 ? room.unread.join(" | ") : "aucune"],
    ),
    section(
      `Objets (${room.objects.length})`,
      table(["n°", "nom", "rectangle", "approche", "orient.", "visible", "porte"], objects, [0, 4]),
    ),
  );
}

// --- Dialogues .CAL ------------------------------------------------------------------------------------------

function renderCal(ctx: PanelContext): HTMLElement {
  const dialog = parseCal(ctx.bytes);
  const rows = dialog.choices.map((choice, i) => [i + 1, choice.text, fileLink(ctx, choice.voice), i < 3 ? dialog.answers[i] : "sortie"]);
  return h(
    "div",
    {},
    table(["choix", "réplique", "voix", "réponse"], rows, [0]),
    info(["lignes non lues par ScummVM", dialog.unread.length > 0 ? dialog.unread.join(" | ") : "aucune"]),
  );
}

// --- drascula.dat : textes, police, tables ------------------------------------------------------------------

/** Écrit `text` avec la police du jeu (`print_abc`) ou celle des choix de dialogue (`print_abc_opc`) : les mêmes fonctions que le rendu du jeu. */
function drawGameText(canvas: HTMLCanvasElement, sheet: Uint8Array, palette: Uint8Array, dat: DrasculaDat, text: string, dialog: DialogState | null): void {
  const font = new GameFont(dat.charMaps);
  const target = new Plane();
  if (dialog) font.printChoice(target, new Plane(sheet), text, 0, dialog);
  else font.print(target, new Plane(sheet), text, 0, 0);
  paintIndexed(canvas, target.pixels.subarray(0, canvas.width * canvas.height), canvas.width, canvas.height, palette);
}

async function fontSection(ctx: PanelContext, dat: DrasculaDat, sample: () => string): Promise<HTMLElement> {
  const load = async (name: string) => {
    const path = ctx.files.resolve(name);
    if (!path) throw new Error(`${name} absent`);
    return parseAlg(await ctx.fetchBytes(path));
  };
  const [game, dialog] = await Promise.all([load(FONT_SHEET), load(DIALOG_FONT_SHEET)]);
  const gamePalette = scummvmRgb8(game.palette);
  const dialogPalette = scummvmRgb8(dialog.palette);

  const strip = (image: { pixels: Uint8Array }, palette: Uint8Array, rows: [number, number]): HTMLCanvasElement => {
    const canvas = makeCanvas(SCREEN_WIDTH, rows[1] - rows[0], 3);
    paintIndexed(canvas, image.pixels.subarray(rows[0] * SCREEN_WIDTH, rows[1] * SCREEN_WIDTH), SCREEN_WIDTH, rows[1] - rows[0], palette);
    return canvas;
  };
  const gameText = makeCanvas(SCREEN_WIDTH, GLYPH.height, 3);
  const dialogTexts = DIALOG_STATES.map((state) => ({ state, canvas: makeCanvas(SCREEN_WIDTH, DIALOG_GLYPH.height, 3) }));
  const redraw = (): void => {
    drawGameText(gameText, game.pixels, gamePalette, dat, sample(), null);
    for (const { state, canvas } of dialogTexts) drawGameText(canvas, dialog.pixels, dialogPalette, dat, sample(), state);
  };
  redraw();
  const counts = Object.entries(dat.charMaps).map(([name, entries]) => `${name} ${entries.length}`);
  return section(
    "Police",
    info(
      ["feuille du texte du jeu", h("span", {}, fileLink(ctx, FONT_SHEET), `, rangées y = 158 (lettres), 169 (signes), 180 (accentués), glyphes de ${GLYPH.width} x ${GLYPH.height} tous les ${GLYPH.pitch} pixels`)],
      ["feuille des choix de dialogue", h("span", {}, fileLink(ctx, DIALOG_FONT_SHEET), `, glyphes de ${DIALOG_GLYPH.width} x ${DIALOG_GLYPH.height}, x = (position - 6) / 9 x 7 + 10, rangées y = 6 / 15, 31 / 40, 56 / 65 (non choisi, survolé, cliqué)`)],
      ["tables de caractères", counts.join(", ")],
    ),
    h("p", { class: "empty" }, "Rangées de glyphes de 95.ALG (y 158 à 185), au pas de la table :"),
    strip(game, gamePalette, [158, 186]),
    h("p", { class: "empty" }, "Rendu de la première ligne longue de la section : police du jeu, puis police des choix de dialogue (non choisi, survolé, cliqué) :"),
    gameText,
    ...dialogTexts.map(({ canvas }) => canvas),
    h("p", { class: "empty" }, "Table (caractère CP850 -> position x, type) :"),
    table(
      ["type", "caractères : position"],
      [dat.charMaps.letters, dat.charMaps.signs, dat.charMaps.accented].map((entries, type) => [
        type === 0 ? "0 lettres" : type === 1 ? "1 signes" : "2 accentués",
        entries.map((entry) => `${decodeCp850(Uint8Array.of(entry.inChar))}${entry.inChar > 127 ? `(${entry.inChar})` : ""}:${entry.mappedChar}`).join(" "),
      ]),
    ),
    (() => {
      const refresh = h("button", { type: "button" }, "redessiner");
      refresh.addEventListener("click", redraw);
      return refresh;
    })(),
  );
}

function renderDat(ctx: PanelContext): HTMLElement {
  let language: DatLanguage = "fr";
  let dat = parseDat(ctx.bytes, { languages: [language] });
  let name: DatTextName = "text";

  const languageSelect = h("select", { "aria-label": "Langue" }, ...DAT_LANGUAGES.filter((l) => l !== "ru").map((l) => h("option", { value: l }, l)));
  languageSelect.value = language;
  const sectionSelect = h("select", { "aria-label": "Section de textes" }, ...DAT_TEXT_NAMES.map((n) => h("option", { value: n }, `${n} (${dat.lineCounts[n]})`)));
  const filter = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer les lignes" });
  const listBox = h("div", {});
  const fontBox = h("div", {});
  let sampleLine = "";

  const prefixOf = (section: DatTextName): string | undefined => Object.entries(VOICE_TEXT).find(([, value]) => value === section)?.[0];

  const renderLines = (): void => {
    const lines = dat.texts[name][language] ?? [];
    const query = filter.value.trim().toLowerCase();
    const prefix = prefixOf(name);
    const rows: Cell[][] = [];
    let matches = 0;
    lines.forEach((line, index) => {
      if (query && !line.toLowerCase().includes(query)) return;
      matches++;
      if (rows.length >= ROW_LIMIT) return;
      const voice = prefix !== undefined && ctx.files.has(voiceFile(prefix, index)) ? fileLink(ctx, voiceFile(prefix, index)) : "";
      rows.push([index, line === "" ? "" : h("span", { class: "text" }, line), voice]);
    });
    if (lines.length > 0 && !sampleLine) sampleLine = lines.find((line) => line.length > 20) ?? lines[0];
    listBox.replaceChildren(
      h("p", { class: "empty" }, `${matches} ligne(s)${matches > rows.length ? `, ${rows.length} affichées` : ""}${prefix !== undefined ? ` ; voix supposée : ${prefix}<n>.ALS pour la ligne n` : ""}`),
      table(["n°", "texte", "voix"], rows, [0]),
    );
  };

  const reload = (): void => {
    dat = parseDat(ctx.bytes, { languages: [language] });
    renderLines();
    void drawFont();
  };
  const drawFont = async (): Promise<void> => {
    try {
      fontBox.replaceChildren(await fontSection(ctx, dat, () => sampleLine));
    } catch (error) {
      fontBox.replaceChildren(h("p", { class: "error" }, `Police : ${(error as Error).message}`));
    }
  };
  languageSelect.addEventListener("change", () => {
    language = languageSelect.value as DatLanguage;
    reload();
  });
  sectionSelect.addEventListener("change", () => {
    name = sectionSelect.value as DatTextName;
    sampleLine = "";
    renderLines();
  });
  filter.addEventListener("input", renderLines);
  renderLines();
  void drawFont();

  const tables: [string, number][] = [
    ["itemLocations", dat.itemLocations.length],
    ["inventoryCells", dat.inventoryCells.length],
    ["verbBarX", dat.verbBarX.length],
    ["menuPoints", dat.menuPoints.length],
    ["frameX", dat.frameX.length],
    ["candles", dat.candles.length],
    ["pianistX", dat.pianistX.length],
    ["drunkX", dat.drunkX.length],
    ["roomPreUpdates", dat.roomPreUpdates.length],
    ["roomUpdates", dat.roomUpdates.length],
    ["roomActions", dat.roomActions.length],
    ["talkSequences", dat.talkSequences.length],
  ];
  return h(
    "div",
    {},
    info(
      ["version", dat.version],
      ["octets lus", `${dat.bytesRead} sur ${ctx.bytes.length}`],
      ["langues", dat.languageCount],
      ["tables", tables.map(([key, count]) => `${key} ${count}`).join(", ")],
    ),
    section("Textes", h("div", { class: "bar" }, h("label", {}, "langue ", languageSelect), h("label", {}, "section ", sectionSelect), filter), listBox),
    fontBox,
  );
}

// --- Sons et voix .ALS ----------------------------------------------------------------------------------------

function renderAls(ctx: PanelContext): HTMLElement {
  const name = baseName(ctx.path);
  const samples = alsSamples(ctx.bytes, name);
  const start = samples.byteOffset - ctx.bytes.byteOffset;
  const end = start + samples.length;
  const seconds = samples.length / ALS_SAMPLE_RATE;

  const canvas = h("canvas", { class: "wave", width: "960", height: "120", role: "img", "aria-label": `Forme d'onde de ${name}` });
  const g = canvas.getContext("2d")!;
  const peaks = waveformPeaks(ctx.bytes, canvas.width);
  g.fillStyle = "#0b0b0d";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#2a2c33";
  g.fillRect(0, 0, Math.floor((start / ctx.bytes.length) * canvas.width), canvas.height);
  g.fillRect(Math.ceil((end / ctx.bytes.length) * canvas.width), 0, canvas.width, canvas.height);
  g.fillStyle = "#6aa2ff";
  peaks.forEach(({ min, max }, x) => {
    const top = canvas.height - (max / 255) * canvas.height;
    const bottom = canvas.height - (min / 255) * canvas.height;
    g.fillRect(x, top, 1, Math.max(1, bottom - top));
  });

  let source: AudioBufferSourceNode | null = null;
  const status = h("output", {}, "");
  const stop = (): void => {
    source?.stop();
    source = null;
    status.textContent = "";
  };
  ctx.onDispose(stop);
  const play = button("écouter", () => {
    void (async () => {
      const audio = await resumed(ctx);
      stop();
      const node = audio.createBufferSource();
      node.buffer = createMonoBuffer(audio, u8ToFloat32(samples), ALS_SAMPLE_RATE);
      node.connect(audio.destination);
      node.addEventListener("ended", () => {
        if (source === node) stop();
      });
      node.start();
      source = node;
      status.textContent = "lecture…";
    })();
  });

  const voice = /^([A-Z]*)(\d+)\.ALS$/i.exec(name);
  const prefix = voice?.[1].toUpperCase();
  const number = voice ? Number.parseInt(voice[2], 10) : 0;
  const textName = prefix !== undefined ? VOICE_TEXT[prefix] : undefined;
  const textBox = h("div", {});
  if (textName) {
    void (async () => {
      const path = ctx.files.resolve("drascula.dat");
      if (!path) return;
      try {
        const dat = parseDat(await ctx.fetchBytes(path));
        const lines = dat.texts[textName].fr ?? [];
        textBox.replaceChildren(
          info([`ligne supposée ${number} de ${textName} (français)`, number < lines.length ? lines[number] || "(vide)" : `hors du tableau (${lines.length} lignes)`]),
        );
      } catch {
        /* texte absent : le panneau reste utilisable */
      }
    })();
  }

  return h(
    "div",
    {},
    info(
      ["format", `PCM 8 bits non signé, mono, ${ALS_SAMPLE_RATE} Hz`],
      ["octets", `${ctx.bytes.length} (${formatSize(ctx.bytes.length)})`],
      ["échantillons joués", `${samples.length} (de ${start} à ${end}), ${seconds.toFixed(2)} s`],
      ["silence ignoré", `${start} octets au début, ${ctx.bytes.length - end} à la fin`],
    ),
    h("div", { class: "bar" }, play, button("arrêter", stop), status),
    canvas,
    h("p", { class: "empty" }, "Zone claire : jouée par le jeu ; zones sombres : marges de 32 octets (et silence de 3.ALS) non jouées."),
    textBox,
  );
}

// --- Musique et textes ----------------------------------------------------------------------------------------

function renderMusic(ctx: PanelContext): HTMLElement {
  const audio = h("audio", { controls: "", preload: "none", src: ctx.url });
  ctx.onDispose(() => audio.pause());
  return h("div", {}, info(["format", "MP3 (conversion des pistes OGG d'origine)"]), audio);
}

function renderText(ctx: PanelContext): HTMLElement {
  return h("pre", { class: "text" }, new TextDecoder("utf-8").decode(ctx.bytes));
}

/** `COVER.png` : la jaquette de la page d'accueil, générée par `scripts/drascula-cover.mts` (pas une donnée du jeu). */
function renderCover(ctx: PanelContext): HTMLElement {
  return h("div", {}, h("img", { src: ctx.url, alt: "Jaquette", width: "320", height: "200", style: "image-rendering: pixelated; width: 640px; max-width: 100%" }));
}

export const PANELS: Panel[] = [
  { matches: hasExtension("ALG"), render: renderAlg },
  { matches: hasExtension("BIN"), render: renderBin },
  { matches: hasExtension("ALD"), render: renderAld },
  { matches: hasExtension("CAL"), render: renderCal },
  { matches: (entry) => baseName(entry.path).toLowerCase() === "drascula.dat", render: renderDat },
  { matches: hasExtension("ALS"), render: renderAls },
  { matches: hasExtension("MP3"), render: renderMusic },
  { matches: hasExtension("TXT"), render: renderText },
  { matches: hasExtension("PNG"), render: renderCover },
];
