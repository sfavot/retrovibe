/**
 * Panneaux de la visionneuse de ressources de Flight of the Amazon Queen : décors `.PCX` (palette, défilement,
 * zones et objets d'une pièce, masque de lumière), banques d'images `.BBK` / `.ACT` / `.SAM` avec ancrages,
 * `.MSK` / `.LUM`, `QUEEN.JAS` (pièces, zones, objets, acteurs), `QUEEN2.JAS` (textes), dialogues `.DOG` en arbre,
 * cinématiques `.CUT` en liste d'enregistrements, génériques, voix `.mp3` (lecture) et tables de morceaux.
 * Outil de développement : les libellés ne sont pas du texte du produit.
 */
import type { GameFileEntry } from "../../../data/game-files";
import { formatSize, h, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import type { Panel, PanelContext } from "../../../ui/asset-viewer/viewer";
import { makeCanvas, paintIndexed } from "../../../ui/indexed-canvas";
import { parseBank } from "../data/bank";
import { parseCredits } from "../data/credits";
import { parseCutaway, type Cutaway } from "../data/cut";
import { parseDog, type DogDialog } from "../data/dog";
import { LIGHT_FIRST_COLOR, LIGHT_COLOR_COUNT, lightDelta, parseRoomLight, MASK_COLUMNS, MASK_SIZE } from "../data/dynalum";
import { baseName, extensionOf, parseVoiceName, voiceFile } from "../data/files";
import { parseQueenJas, type QueenJas } from "../data/jas";
import { readSongBank } from "../data/music";
import { decodePcx, type PcxImage } from "../data/pcx";
import { decodeGameText, gameTextEncoding, parseGameTexts, type GameTexts } from "../data/text";
import {
  FULL_PALETTE_ROOMS,
  MASK_ROWS,
  ROOM_COLORS,
  boxContains,
  boxText,
  composePalette,
  cutExtraEntry,
  cutObjectVoices,
  decorHeightClass,
  describeVoice,
  dialogsByKey,
  dogLevels,
  isGameRoom,
  lastObjectImage,
  lastObjectPositions,
  maskHistogram,
  maskRowColor,
  neighborAreas,
  objectName,
  roomObjects,
  roomsByImage,
  sentenceVoices,
  songRow,
  stem,
  type DogLevelView,
  type SentenceVoice,
} from "./viewer-data";
import { dialogVoicePrefix, dialogOpeningVoicePrefix } from "../data/files";

type Cell = string | number | Node;

const SCALE = 3;
const ROW_LIMIT = 400;
const PANEL_FILE = "PANEL.PCX";
const GAME_ZONE_HEIGHT = 150;

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
    h("tr", {}, ...row.map((cell, i) => h("td", numeric.includes(i) ? { class: "num" } : {}, typeof cell === "object" ? cell : String(cell)))),
  );
  return h("table", {}, h("thead", {}, head), h("tbody", {}, ...body));
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = h("button", { type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

function note(text: string): HTMLElement {
  return h("p", { class: "empty" }, text);
}

function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox" });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", {}, input, ` ${label}`);
}

/** Lien vers un autre fichier du jeu (le hachage de l'URL ouvre le fichier). */
function fileLink(ctx: PanelContext, name: string, label?: string): Node {
  const path = ctx.files.resolve(name);
  if (!path) return h("span", { class: "error" }, `${label ?? name} (absent)`);
  return h("a", { href: `#${encodeURI(path)}` }, label ?? path);
}

/** URL d'un autre fichier du jeu, bâtie sur celle du fichier ouvert. */
function urlOf(ctx: PanelContext, path: string): string {
  const own = ctx.path.split("/").map(encodeURIComponent).join("/");
  return ctx.url.slice(0, ctx.url.length - own.length) + path.split("/").map(encodeURIComponent).join("/");
}

const hasExtension =
  (...extensions: string[]) =>
  (entry: GameFileEntry): boolean =>
    extensions.includes(extensionOf(entry.path));

const hasName =
  (...names: string[]) =>
  (entry: GameFileEntry): boolean =>
    names.includes(baseName(entry.path).toUpperCase());

// --- Données partagées ---------------------------------------------------------------------------------------

interface GameData {
  jas: QueenJas;
  texts: GameTexts;
  rooms: Map<string, number[]>;
}

let gameDataPromise: Promise<GameData> | null = null;

/** `QUEEN.JAS` et `QUEEN2.JAS`, chargés une fois. */
function gameData(ctx: PanelContext): Promise<GameData> {
  gameDataPromise ??= (async () => {
    const need = (name: string): string => {
      const path = ctx.files.resolve(name);
      if (!path) throw new Error(`${name} absent`);
      return path;
    };
    const jas = parseQueenJas(await ctx.fetchBytes(need("QUEEN.JAS")));
    const texts = parseGameTexts(await ctx.fetchBytes(need("QUEEN2.JAS")), {
      descriptions: jas.descriptionCount,
      names: jas.nameCount,
      rooms: jas.roomCount,
      actorAnimations: jas.actorAnimationCount,
      actorNames: jas.actorNameCount,
      actorFiles: jas.actorFileCount,
    });
    return { jas, texts, rooms: roomsByImage(texts) };
  })();
  gameDataPromise.catch(() => (gameDataPromise = null));
  return gameDataPromise;
}

let dialogsPromise: Promise<{ name: string; dog: DogDialog }[]> | null = null;

/** Les 73 dialogues (240 Ko), pour retrouver le texte d'une voix par sa clé. */
function allDialogs(ctx: PanelContext): Promise<{ name: string; dog: DogDialog }[]> {
  dialogsPromise ??= Promise.all(
    ctx.files.list((path) => extensionOf(path) === "DOG").map(async (path) => ({ name: baseName(path), dog: parseDog(await ctx.fetchBytes(path)) })),
  );
  dialogsPromise.catch(() => (dialogsPromise = null));
  return dialogsPromise;
}

const pcxCache = new Map<string, Promise<PcxImage>>();

function loadPcx(ctx: PanelContext, name: string): Promise<PcxImage> {
  const path = ctx.files.resolve(name);
  if (!path) return Promise.reject(new Error(`${name} absent`));
  let promise = pcxCache.get(path);
  if (!promise) {
    promise = ctx.fetchBytes(path).then(decodePcx);
    promise.catch(() => pcxCache.delete(path));
    pcxCache.set(path, promise);
  }
  return promise;
}

/** Palette d'une pièce : décor (0 à 143) + panneau (144 à 255) ; les pièces 114 à 125 gardent le décor entier. */
async function roomPalette(ctx: PanelContext, decorName: string, decor: PcxImage | null, room?: number): Promise<Uint8Array> {
  const image = decor ?? (await loadPcx(ctx, decorName));
  const full = room !== undefined && room >= FULL_PALETTE_ROOMS[0] && room <= FULL_PALETTE_ROOMS[1];
  if (full) return image.palette;
  const panel = await loadPcx(ctx, PANEL_FILE);
  return composePalette(image.palette, panel.palette, ROOM_COLORS);
}

function gray(): Uint8Array {
  return new Uint8Array(768).map((_, i) => Math.floor(i / 3));
}

// --- Table d'une pièce : zones et objets ----------------------------------------------------------------------

function roomTables(ctx: PanelContext, data: GameData, room: number): HTMLElement {
  const { jas, texts } = data;
  const grid = jas.rooms[room];
  const areas = grid.areas.slice(1).map((area, i) => [
    i + 1,
    boxText(area.box),
    `${area.mapNeighbors} (${neighborAreas(area.mapNeighbors).join(" ") || "aucune"})`,
    area.bottomScaleFactor,
    area.topScaleFactor,
    area.object ? `${area.object} ${objectName(jas, texts, area.object)}` : "",
  ]);
  const objects = roomObjects(jas, texts, room).map((o) => [
    o.number,
    o.name,
    boxText(o.box),
    `${o.x},${o.y}`,
    o.state,
    o.image,
    o.ownRoom === room ? "" : o.ownRoom,
    o.description,
  ]);
  const walkOffs = jas.walkOffs
    .slice(1)
    .map((w, i) => ({ w, number: i + 1 }))
    .filter(({ w }) => w.entryObject > 0 && jas.objects[w.entryObject]?.room === room);
  return h(
    "div",
    {},
    info(
      ["pièce", `${room} : ${texts.roomNames[room]}`],
      ["décor", fileLink(ctx, `${texts.roomNames[room]}.PCX`)],
      ["effet sonore de la pièce", jas.roomSfx[room]],
      ["autres pièces avec ce décor", (data.rooms.get(texts.roomNames[room].toUpperCase()) ?? []).filter((r) => r !== room).join(", ") || "aucune"],
    ),
    section(`Zones de marche (${areas.length})`, table(["zone", "boîte", "voisines", "échelle bas", "échelle haut", "objet"], areas, [0, 3, 4])),
    section(`Objets (${objects.length})`, table(["n°", "nom", "boîte", "x,y", "état", "image", "pièce propre", "description"], objects, [0, 4, 5])),
    walkOffs.length > 0
      ? section(
          "Destinations de marche",
          table(
            ["objet d'entrée", "x", "y"],
            walkOffs.map(({ w }) => [`${w.entryObject} ${objectName(jas, texts, w.entryObject)}`, w.x, w.y]),
            [1, 2],
          ),
        )
      : "",
  );
}

// --- Décors .PCX ----------------------------------------------------------------------------------------------

function renderPcx(ctx: PanelContext): Promise<HTMLElement> {
  return renderPcxWith(ctx, decodePcx(ctx.bytes));
}

async function renderPcxWith(ctx: PanelContext, image: PcxImage): Promise<HTMLElement> {
  const { width, height } = image;
  const name = stem(ctx.path);
  let data: GameData | null = null;
  let dataError = "";
  try {
    data = await gameData(ctx);
  } catch (error) {
    dataError = (error as Error).message;
  }
  const rooms = data?.rooms.get(name) ?? [];
  let room = rooms[0];

  const base = makeCanvas(width, height, SCALE);
  base.setAttribute("role", "img");
  base.setAttribute("aria-label", `${ctx.path} : image ${width} x ${height}`);
  const overlay = h("canvas", { width: String(width * SCALE), height: String(height * SCALE), style: `position:absolute;left:0;top:0;pointer-events:none;image-rendering:auto;width:${width * SCALE}px;height:${height * SCALE}px` });
  const stage = h("div", { style: "position:relative;line-height:0" }, base, overlay);
  const viewport = h("div", { style: `max-width:${320 * SCALE}px;overflow-x:auto;border:1px solid #2a2c33`, tabindex: "0", "aria-label": "Fenêtre de défilement du décor" }, stage);
  const status = h("p", { class: "empty" });
  const pixel = h("output", {}, "survoler l'image : position, indice, couleur, zone, objet");
  const swatchBox = h("div", {});
  const roomBox = h("div", {});
  let palette = image.palette;

  const show = { zones: false, objects: false, mask: false, panel: true };
  const maskCache: { mask: Uint8Array | null } = { mask: null };

  const paintBase = (): void => paintIndexed(base, image.pixels, width, height, palette);
  const paletteSelect = h(
    "select",
    { "aria-label": "Palette" },
    h("option", { value: "file" }, "palette du fichier (256 couleurs)"),
    h("option", { value: "room" }, `décor 0 à ${ROOM_COLORS - 1} + ${PANEL_FILE} ${ROOM_COLORS} à 255 (palette d'une pièce)`),
  );
  const applyPalette = async (): Promise<void> => {
    status.textContent = "";
    palette = image.palette;
    if (paletteSelect.value === "room") {
      try {
        palette = await roomPalette(ctx, `${name}.PCX`, image, room);
      } catch (error) {
        status.textContent = `palette de pièce indisponible : ${(error as Error).message}`;
      }
    }
    paintBase();
    swatchBox.replaceChildren(paletteSwatch(palette, 14));
  };
  paletteSelect.addEventListener("change", () => void applyPalette());

  const drawOverlay = (): void => {
    const g = overlay.getContext("2d")!;
    g.clearRect(0, 0, overlay.width, overlay.height);
    g.lineWidth = 1;
    g.font = "11px ui-monospace, Menlo, monospace";
    if (show.panel && height > GAME_ZONE_HEIGHT) {
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(0, GAME_ZONE_HEIGHT * SCALE, overlay.width, overlay.height - GAME_ZONE_HEIGHT * SCALE);
      g.strokeStyle = "#ffd24a";
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(0, GAME_ZONE_HEIGHT * SCALE + 0.5);
      g.lineTo(overlay.width, GAME_ZONE_HEIGHT * SCALE + 0.5);
      g.stroke();
      g.setLineDash([]);
    }
    if (show.mask && maskCache.mask) {
      const cell = 4 * SCALE;
      const mask = maskCache.mask;
      for (let cy = 0; cy < MASK_ROWS; cy++) {
        for (let cx = 0; cx < MASK_COLUMNS; cx++) {
          if (cx * 4 >= width) break;
          g.fillStyle = maskRowColor(mask[cy * MASK_COLUMNS + cx]);
          g.fillRect(cx * cell, cy * cell, cell, cell);
        }
      }
    }
    if (data && room !== undefined) {
      if (show.zones) {
        g.strokeStyle = "#4ad0ff";
        g.fillStyle = "#4ad0ff";
        data.jas.rooms[room].areas.forEach((area, i) => {
          if (i === 0) return;
          g.strokeRect(area.box.x1 * SCALE + 0.5, area.box.y1 * SCALE + 0.5, (area.box.x2 - area.box.x1) * SCALE, (area.box.y2 - area.box.y1) * SCALE);
          g.fillText(String(i), area.box.x1 * SCALE + 3, area.box.y1 * SCALE + 12);
        });
      }
      if (show.objects) {
        g.strokeStyle = "#ff6ad0";
        g.fillStyle = "#ff6ad0";
        for (const o of roomObjects(data.jas, data.texts, room)) {
          g.strokeRect(o.box.x1 * SCALE + 0.5, o.box.y1 * SCALE + 0.5, (o.box.x2 - o.box.x1) * SCALE, (o.box.y2 - o.box.y1) * SCALE);
          g.fillText(`${o.number}`, o.box.x1 * SCALE + 3, o.box.y1 * SCALE + 12);
        }
      }
    }
  };

  const loadMask = async (): Promise<void> => {
    if (maskCache.mask) return;
    try {
      const path = ctx.files.resolve(`${name}.MSK`);
      if (!path) throw new Error(`${name}.MSK absent`);
      maskCache.mask = await ctx.fetchBytes(path);
      if (maskCache.mask.length !== MASK_SIZE) throw new Error(`MSK de ${maskCache.mask.length} octets`);
    } catch (error) {
      status.textContent = `masque indisponible : ${(error as Error).message}`;
      show.mask = false;
    }
  };

  const refreshRoom = (): void => {
    if (data && room !== undefined) roomBox.replaceChildren(roomTables(ctx, data, room));
    else roomBox.replaceChildren(note(dataError ? `données de pièce indisponibles : ${dataError}` : "ce décor n'est celui d'aucune pièce de QUEEN2.JAS"));
    drawOverlay();
  };

  const controls = h("div", { class: "bar" }, h("label", {}, "palette ", paletteSelect));
  if (height > GAME_ZONE_HEIGHT) controls.append(checkbox("zone du panneau (y ≥ 150)", true, (v) => ((show.panel = v), drawOverlay())));
  if (rooms.length > 0) {
    controls.append(checkbox("zones de marche", false, (v) => ((show.zones = v), drawOverlay())));
    controls.append(checkbox("boîtes des objets", false, (v) => ((show.objects = v), drawOverlay())));
    controls.append(
      checkbox("masque de lumière (.MSK)", false, (v) => {
        show.mask = v;
        void (async () => {
          if (v) await loadMask();
          drawOverlay();
        })();
      }),
    );
  }
  if (rooms.length > 1) {
    const select = h("select", { "aria-label": "Pièce" }, ...rooms.map((r) => h("option", { value: String(r) }, `pièce ${r}`)));
    select.addEventListener("change", () => {
      room = Number(select.value);
      refreshRoom();
    });
    controls.append(h("label", {}, "pièces partageant ce décor ", select));
  }
  if (width > 320) {
    const camera = h("input", { type: "range", min: "0", max: String(width - 320), value: "0", "aria-label": "Position de la caméra (x)" });
    const output = h("output", {}, "caméra x = 0");
    camera.addEventListener("input", () => {
      viewport.scrollLeft = Number(camera.value) * SCALE;
    });
    viewport.addEventListener("scroll", () => {
      const x = Math.round(viewport.scrollLeft / SCALE);
      camera.value = String(x);
      output.textContent = `caméra x = ${x}`;
    });
    controls.append(h("label", {}, "défilement ", camera), output);
  }

  stage.addEventListener("mousemove", (event) => {
    const box = base.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * height);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = image.pixels[y * width + x];
    let text = `(${x}, ${y}) indice ${index}, rgb(${palette[index * 3]}, ${palette[index * 3 + 1]}, ${palette[index * 3 + 2]})`;
    if (data && room !== undefined) {
      const zones = data.jas.rooms[room].areas.map((a, i) => ({ a, i })).filter(({ a, i }) => i > 0 && boxContains(a.box, x, y)).map(({ i }) => i);
      const objects = roomObjects(data.jas, data.texts, room).filter((o) => boxContains(o.box, x, y)).map((o) => `${o.number} ${o.name}`);
      if (zones.length > 0) text += ` ; zone ${zones.join(", ")}`;
      if (objects.length > 0) text += ` ; objet ${objects.join(", ")}`;
      const mask = maskCache.mask;
      if (mask) text += ` ; masque ${mask[Math.trunc(Math.min(y, GAME_ZONE_HEIGHT - 1) / 4) * MASK_COLUMNS + Math.trunc(x / 4)]}`;
    }
    pixel.textContent = text;
  });

  const used = new Set(image.pixels).size;
  const heightText = decorHeightClass(height) === "150" ? "150 lignes : panneau toujours visible dessous" : decorHeightClass(height) === "200" ? "200 lignes : les 50 dernières sont sous le panneau ou en plein écran" : "";
  void applyPalette();
  refreshRoom();
  return h(
    "div",
    {},
    info(
      ["image", `${width} x ${height}, ${used} indices utilisés`],
      ["hauteur", heightText || "hauteur inhabituelle"],
      ["pièces", rooms.length > 0 ? rooms.map((r) => `${r}${data && !isGameRoom(r) ? " (écran)" : ""}`).join(", ") : "aucune"],
      ["masque et lumière", rooms.length > 0 ? h("span", {}, fileLink(ctx, `${name}.MSK`), " ", fileLink(ctx, `${name}.LUM`)) : "aucun"],
    ),
    controls,
    status,
    viewport,
    h("p", {}, pixel),
    section("Palette", note(`Indices 0 à ${ROOM_COLORS - 1} : décor ; ${ROOM_COLORS} à 255 : panneau, dont 144 à 159 couleurs de Joe (lu, display.cpp).`), swatchBox),
    section("Pièce", roomBox),
  );
}

// --- Banques .BBK / .ACT / .SAM ------------------------------------------------------------------------------

async function renderBank(ctx: PanelContext): Promise<HTMLElement> {
  const bank = parseBank(ctx.bytes);
  const decors = ctx.files.list((path) => extensionOf(path) === "PCX" && stem(path) !== "PANEL").map((path) => stem(path));
  const defaultDecor = decors.includes("B1") ? "B1" : (decors[0] ?? "");
  const select = h("select", { "aria-label": "Décor dont on prend la palette" }, ...decors.map((n) => h("option", { value: n }, n)));
  select.value = defaultDecor;
  const scaleSelect = h("select", { "aria-label": "Échelle" }, ...[1, 2, 3, 4].map((n) => h("option", { value: String(n) }, `x${n}`)));
  scaleSelect.value = "2";
  const status = h("p", { class: "empty" });
  const grid = h("div", { class: "frames" });
  let transparent = true;
  let anchors = true;
  let palette = gray();

  const sizes = bank.frames.map((f) => `${f.width}x${f.height}`);
  const empty = bank.frames.filter((f) => f.width === 0 || f.height === 0).length;
  const zeros = bank.frames.reduce((sum, f) => sum + f.pixels.filter((p) => p === 0).length, 0);
  const totalPixels = bank.frames.reduce((sum, f) => sum + f.pixels.length, 0);

  const draw = (): void => {
    const scale = Number(scaleSelect.value);
    const nodes = bank.frames.map((frame, i) => {
      const caption = h("figcaption", {}, `${i + 1} : ${frame.width}x${frame.height} (${frame.hotspotX}, ${frame.hotspotY})`);
      if (frame.width === 0 || frame.height === 0) return h("figure", { class: "empty-frame" }, h("span", { class: "empty" }, "vide"), caption);
      const canvas = makeCanvas(frame.width, frame.height, scale);
      paintIndexed(canvas, frame.pixels, frame.width, frame.height, palette, transparent ? { transparent: 0 } : {});
      if (transparent) canvas.className = "alpha";
      const box = h("div", { style: "position:relative;line-height:0" }, canvas);
      if (anchors) {
        const dot = h("span", { style: `position:absolute;left:${frame.hotspotX * scale - 4}px;top:${frame.hotspotY * scale - 4}px;width:9px;height:9px;border:1px solid #ff3b3b;border-radius:50%;pointer-events:none;box-sizing:border-box`, title: `ancrage ${frame.hotspotX}, ${frame.hotspotY}` });
        box.append(dot);
      }
      return h("figure", { title: `image ${i + 1}` }, box, caption);
    });
    grid.replaceChildren(...nodes);
  };
  const applyPalette = async (): Promise<void> => {
    status.textContent = "";
    palette = gray();
    try {
      palette = await roomPalette(ctx, `${select.value}.PCX`, null);
    } catch (error) {
      status.textContent = `palette indisponible (niveaux de gris) : ${(error as Error).message}`;
    }
    draw();
  };
  select.addEventListener("change", () => void applyPalette());
  scaleSelect.addEventListener("change", draw);
  void applyPalette();

  const extension = extensionOf(ctx.path);
  return h(
    "div",
    {},
    info(
      ["format", `banque de sprites (${extension}) : ${bank.frameCount} images numérotées à partir de 1`],
      ["images vides", empty],
      ["indice 0", `${totalPixels > 0 ? ((zeros * 100) / totalPixels).toFixed(1) : "0"} % des pixels (transparent dans les sprites)`],
      ["tailles distinctes", new Set(sizes).size],
    ),
    h(
      "div",
      { class: "bar" },
      h("label", {}, "palette du décor ", select),
      h("label", {}, "échelle ", scaleSelect),
      checkbox("indice 0 transparent", true, (v) => ((transparent = v), draw())),
      checkbox("ancrages (cercle rouge)", true, (v) => ((anchors = v), draw())),
    ),
    status,
    note("Légende : numéro : largeur x hauteur (ancrage x, y). Palette : 0 à 143 du décor choisi, 144 à 255 de PANEL.PCX (les banques n'ont pas de palette)."),
    grid,
  );
}

// --- Masque et lumière dynamique (.MSK, .LUM) ------------------------------------------------------------------

async function renderLight(ctx: PanelContext): Promise<HTMLElement> {
  const name = stem(ctx.path);
  const get = async (extension: string): Promise<Uint8Array | null> => {
    const path = ctx.files.resolve(`${name}.${extension}`);
    return path ? await ctx.fetchBytes(path) : null;
  };
  const [mask, table8] = await Promise.all([get("MSK"), get("LUM")]);
  const light = mask && table8 ? parseRoomLight(mask, table8) : null;
  const histogram = mask && mask.length === MASK_SIZE ? maskHistogram(mask) : null;

  const rows: Cell[][] = [];
  if (light && histogram) {
    for (let row = 0; row < 8; row++) {
      const delta = lightDelta(light, row)!;
      rows.push([h("span", { style: `background:${maskRowColor(row, 0.8)};color:#000;padding:0 6px` }, String(row)), histogram.rows[row], `${light.table[row * 3]}, ${light.table[row * 3 + 1]}, ${light.table[row * 3 + 2]}`, delta.join(", ")]);
    }
    if (histogram.other > 0) rows.push(["hors table", histogram.other, "", "aucune variation (le moteur laisse la palette)"]);
  }

  const maskCanvas = makeCanvas(MASK_COLUMNS, MASK_ROWS, 4);
  if (mask && mask.length === MASK_SIZE) {
    const g = maskCanvas.getContext("2d")!;
    for (let y = 0; y < MASK_ROWS; y++) for (let x = 0; x < MASK_COLUMNS; x++) {
      g.fillStyle = maskRowColor(mask[y * MASK_COLUMNS + x], 1);
      g.fillRect(x, y, 1, 1);
    }
  }

  const decorBox = h("div", {});
  void (async () => {
    try {
      const decor = await loadPcx(ctx, `${name}.PCX`);
      const data = await gameData(ctx).catch(() => null);
      const room = data?.rooms.get(name)?.[0];
      const palette = await roomPalette(ctx, `${name}.PCX`, decor, room);
      const canvas = makeCanvas(decor.width, decor.height, 2);
      paintIndexed(canvas, decor.pixels, decor.width, decor.height, palette);
      const over = h("canvas", { width: String(decor.width * 2), height: String(decor.height * 2), style: `position:absolute;left:0;top:0;pointer-events:none;image-rendering:auto;width:${decor.width * 2}px;height:${decor.height * 2}px` });
      if (mask && mask.length === MASK_SIZE) {
        const g = over.getContext("2d")!;
        for (let cy = 0; cy < MASK_ROWS; cy++) for (let cx = 0; cx < MASK_COLUMNS; cx++) {
          if (cx * 4 >= decor.width) break;
          g.fillStyle = maskRowColor(mask[cy * MASK_COLUMNS + cx], 0.5);
          g.fillRect(cx * 8, cy * 8, 8, 8);
        }
      }
      decorBox.replaceChildren(
        note(`Décor ${name}.PCX (${decor.width} x ${decor.height}) avec le masque : une cellule de 4 x 4 pixels par octet, colorée par sa ligne de la table.`),
        h("div", { style: "position:relative;line-height:0;overflow-x:auto;max-width:100%" }, canvas, over),
      );
    } catch (error) {
      decorBox.replaceChildren(note(`décor indisponible : ${(error as Error).message}`));
    }
  })();

  return h(
    "div",
    {},
    info(
      ["pièce (nom de l'image)", name],
      ["masque", mask ? h("span", {}, fileLink(ctx, `${name}.MSK`), ` (${mask.length} octets : ${MASK_COLUMNS} x ${MASK_ROWS} cellules de 4 x 4 pixels)`) : "absent"],
      ["table de lumière", table8 ? h("span", {}, fileLink(ctx, `${name}.LUM`), ` (${table8.length} octets : 8 triplets signés)`) : "absente"],
      ["lumière dynamique", light ? `oui : ajoute triplet x 4 aux couleurs ${LIGHT_FIRST_COLOR} à ${LIGHT_FIRST_COLOR + LIGHT_COLOR_COUNT - 1}` : "non (il faut les deux fichiers)"],
    ),
    rows.length > 0 ? section("Table de lumière", table(["ligne", "cellules", "triplet", "variation (x 4)"], rows, [1])) : "",
    mask && mask.length === MASK_SIZE ? section("Masque seul", maskCanvas) : "",
    section("Sur le décor", decorBox),
  );
}

// --- QUEEN.JAS : données logiques -------------------------------------------------------------------------------

async function renderJas(ctx: PanelContext): Promise<HTMLElement> {
  const data = await gameData(ctx);
  const { jas, texts } = data;
  const roomsRows: Cell[][] = [];
  const decorCells = new Map<number, HTMLElement>();
  for (let room = 1; room <= jas.roomCount; room++) {
    const decorName = texts.roomNames[room];
    const cell = h("span", {}, "");
    decorCells.set(room, cell);
    const select = button(String(room), () => showRoom(room));
    roomsRows.push([
      select,
      decorName,
      cell,
      jas.rooms[room].areas.length - 1,
      jas.roomFirstObject[room + 1] - jas.roomFirstObject[room],
      jas.roomSfx[room],
      ctx.files.has(`${decorName}.MSK`) && ctx.files.has(`${decorName}.LUM`) ? "oui" : ctx.files.has(`${decorName}.MSK`) ? "masque seul" : "",
      isGameRoom(room) ? "jeu" : "écran",
    ]);
  }
  const detail = h("div", {});
  const showRoom = (room: number): void => detail.replaceChildren(h("h3", {}, `Pièce ${room}`), roomTables(ctx, data, room));

  const measureStatus = h("output", {}, "");
  const measure = button("mesurer les décors (une image par nom)", () => {
    void (async () => {
      measure.disabled = true;
      const counts = { "150": [] as number[], "200": [] as number[], autre: [] as number[] };
      const cls = { jeu: { "150": 0, "200": 0, autre: 0 }, écran: { "150": 0, "200": 0, autre: 0 } };
      let done = 0;
      const rooms = Array.from({ length: jas.roomCount }, (_, i) => i + 1);
      for (const room of rooms) {
        try {
          const pcx = await loadPcx(ctx, `${texts.roomNames[room]}.PCX`);
          const k = decorHeightClass(pcx.height);
          counts[k].push(room);
          cls[isGameRoom(room) ? "jeu" : "écran"][k]++;
          decorCells.get(room)!.textContent = `${pcx.width} x ${pcx.height}`;
        } catch (error) {
          decorCells.get(room)!.textContent = (error as Error).message;
        }
        measureStatus.textContent = `${++done} / ${rooms.length}`;
      }
      measureStatus.textContent = `pièces de jeu (1 à 75, 97 à 104) : ${cls.jeu["150"]} de 150 lignes, ${cls.jeu["200"]} de 200 ; pièces d'écran : ${cls.écran["150"]} de 150, ${cls.écran["200"]} de 200`;
      measure.disabled = false;
    })();
  });

  const actors = jas.actors.slice(1).map((a, i) => [
    i + 1,
    texts.actorNames[a.name] ?? "",
    a.room,
    a.bobNumber,
    `${a.x},${a.y}`,
    a.stateSlot ? `état ${a.stateSlot} = ${a.stateValue}` : "",
    a.animation ? texts.actorAnimations[a.animation] ?? "" : "",
    a.file ? texts.actorFiles[a.file] ?? "" : "",
  ]);
  const items = jas.items.slice(1).map((it, i) => [i + 1, texts.objectNames[Math.abs(it.name)] ?? "", it.description, it.state, it.frame, it.sfxDescription]);

  return h(
    "div",
    {},
    info(
      ["version", jas.version],
      ["pièces / noms / objets / descriptions", `${jas.roomCount} / ${jas.nameCount} / ${jas.objectCount} / ${jas.descriptionCount}`],
      ["objets d'inventaire", jas.items.length - 1],
      ["listes de commandes", jas.commands.lists.length - 1],
      ["acteurs", jas.actors.length - 1],
      ["objet d'entrée", `${jas.entryObject} (pièce ${jas.objects[jas.entryObject]?.room})`],
      ["correctifs appliqués", jas.appliedFixes.length > 0 ? jas.appliedFixes.join(" ; ") : "aucun"],
    ),
    section(
      "Pièces",
      h("div", { class: "bar" }, measure, measureStatus),
      table(["n°", "image", "décor", "zones", "objets", "effet", "lumière", "type"], roomsRows, [3, 4, 5]),
    ),
    detail,
    section(`Acteurs (${actors.length})`, table(["n°", "nom", "pièce", "bob", "x,y", "condition", "animation", "fichier"], actors, [0, 2, 3])),
    section(`Objets d'inventaire (${items.length})`, table(["n°", "nom", "description", "état", "image", "effet"], items, [0, 2, 3, 4, 5])),
  );
}

// --- QUEEN2.JAS : textes -------------------------------------------------------------------------------------------

type TextSection = "objectDescriptions" | "objectNames" | "roomNames" | "verbs" | "joeResponses" | "actorAnimations" | "actorNames" | "actorFiles";

const TEXT_SECTIONS: [TextSection, string][] = [
  ["objectDescriptions", "descriptions d'objets"],
  ["objectNames", "noms d'objets"],
  ["roomNames", "noms de pièces (= images)"],
  ["verbs", "verbes"],
  ["joeResponses", "réponses de Joe"],
  ["actorAnimations", "animations d'acteurs"],
  ["actorNames", "noms d'acteurs"],
  ["actorFiles", "fichiers d'acteurs"],
];

async function renderTexts(ctx: PanelContext): Promise<HTMLElement> {
  const { texts } = await gameData(ctx);
  const sectionSelect = h("select", { "aria-label": "Section de textes" }, ...TEXT_SECTIONS.map(([key, label]) => h("option", { value: key }, `${label} (${texts[key].length - 1})`)));
  const filter = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer les lignes" });
  const listBox = h("div", {});
  const raw = ctx.bytes;
  const render = (): void => {
    const key = sectionSelect.value as TextSection;
    const lines = texts[key];
    const query = filter.value.trim().toLowerCase();
    const rows: Cell[][] = [];
    let matches = 0;
    for (let n = 1; n < lines.length; n++) {
      const line = lines[n];
      if (query && !line.toLowerCase().includes(query)) continue;
      matches++;
      if (rows.length >= ROW_LIMIT) continue;
      let voice: Cell = "";
      const number = key === "objectDescriptions" ? n + 40 : key === "joeResponses" ? n : 0;
      if (number > 0) {
        const voices = sentenceVoices(`JOE${String(number).padStart(4, "0")}`, line, (p) => ctx.files.has(p)).filter((v) => v.voice && v.exists);
        voice = h("span", {}, ...voices.flatMap((v, i) => (i ? [" ", fileLink(ctx, voiceFile(v.voice!), `${v.voice}`)] : [fileLink(ctx, voiceFile(v.voice!), `${v.voice}`)])));
      }
      rows.push([n, line === "" ? "" : h("span", { class: "text" }, line), voice]);
    }
    listBox.replaceChildren(note(`${matches} ligne(s)${matches > rows.length ? `, ${rows.length} affichées` : ""}`), table(["n°", "texte", "voix"], rows, [0]));
  };
  sectionSelect.addEventListener("change", render);
  filter.addEventListener("input", render);
  render();
  const accents = [...decodeGameText(raw)].filter((c) => c > "\u007f").length;
  return h(
    "div",
    {},
    info(
      ["encodage", `${gameTextEncoding(raw)} (${accents} caractères non ASCII)`],
      ["lignes", TEXT_SECTIONS.reduce((sum, [key]) => sum + texts[key].length - 1, 0)],
      ["police", "dans le code de ScummVM (Display::_fontRegular), pas dans queen.1c : rien à afficher ici"],
    ),
    section("Textes", h("div", { class: "bar" }, h("label", {}, "section ", sectionSelect), filter), listBox),
  );
}

// --- Lecture d'une voix ---------------------------------------------------------------------------------------------

/** Lecteur partagé d'un panneau : une seule voix à la fois. */
function voicePlayer(ctx: PanelContext): (name: string, label?: string) => HTMLElement {
  let audio: HTMLAudioElement | null = null;
  let current: HTMLButtonElement | null = null;
  const stop = (): void => {
    audio?.pause();
    audio = null;
    if (current) current.textContent = current.dataset.label ?? "▶";
    current = null;
  };
  ctx.onDispose(stop);
  return (name, label = "▶") => {
    const path = ctx.files.resolve(voiceFile(name));
    if (!path) return h("span", { class: "empty" }, `${name} (absent)`);
    const node = h("button", { type: "button", title: `écouter ${name}`, "data-label": label }, label);
    node.addEventListener("click", () => {
      const same = current === node;
      stop();
      if (same) return;
      const player = new Audio(urlOf(ctx, path));
      audio = player;
      current = node;
      node.textContent = "■";
      player.addEventListener("ended", () => {
        if (audio === player) stop();
      });
      player.addEventListener("error", () => {
        if (audio === player) {
          stop();
          node.textContent = "erreur";
        }
      });
      void player.play().catch(() => {
        if (audio === player) stop();
      });
    });
    return h("span", {}, node, " ", fileLink(ctx, voiceFile(name), name));
  };
}

function voiceCells(play: (name: string, label?: string) => HTMLElement, voices: SentenceVoice[]): Node {
  const span = h("span", {});
  voices.forEach((v, i) => {
    if (!v.voice) return;
    if (i > 0) span.append(" ");
    span.append(v.exists ? play(v.voice, `▶${v.segment}`) : h("span", { class: "empty" }, `${v.voice}?`));
  });
  return span;
}

// --- Dialogues .DOG ----------------------------------------------------------------------------------------------------

function sentenceText(sentence: { text: string; encoding?: string } | undefined): Node {
  if (!sentence) return h("span", { class: "empty" }, "(aucune phrase de cette tête)");
  return h("span", { class: "text" }, sentence.text === "" ? "(vide)" : sentence.text);
}

function renderDog(ctx: PanelContext): HTMLElement {
  const dog = parseDog(ctx.bytes);
  const play = voicePlayer(ctx);
  const has = (path: string): boolean => ctx.files.has(path);
  const levels = dogLevels(dog);
  const byHead = new Map(levels.map((level) => [level.head, level]));
  const expanded = new Set<number>();

  const levelNode = (level: DogLevelView): HTMLElement => {
    expanded.add(level.head);
    const children = h("ul", { class: "tree" });
    for (const entry of level.options) {
      const joeVoices = entry.joe ? sentenceVoices(dialogVoicePrefix(dog.talkKey, entry.option.head, "J"), entry.joe.text, has) : [];
      const personVoices = entry.person ? sentenceVoices(dialogVoicePrefix(dog.talkKey, entry.option.head, "P"), entry.person.text, has) : [];
      let target: Node;
      if (entry.next === null) target = h("em", {}, "fin du dialogue");
      else if (entry.next === undefined) target = h("em", { class: "error" }, `niveau de tête ${entry.option.node} introuvable`);
      else if (expanded.has(entry.next)) target = h("em", {}, `retour au niveau ${entry.next} (déjà montré)`);
      else target = levelNode(byHead.get(entry.next)!);
      const condition = entry.option.stateIndex < 0 ? ` [seulement si l'état ${-entry.option.stateIndex} = ${entry.option.stateValue}]` : entry.option.stateIndex > 0 ? ` [état ${entry.option.stateIndex} = ${entry.option.stateValue}]` : "";
      children.append(
        h(
          "li",
          {},
          h("div", {}, h("strong", {}, `option ${entry.index}, tête ${entry.option.head}`), condition),
          h("div", {}, "Joe : ", sentenceText(entry.joe), " ", voiceCells(play, joeVoices)),
          h("div", {}, "Réponse : ", sentenceText(entry.person), " ", voiceCells(play, personVoices)),
          h("div", {}, "→ ", target),
        ),
      );
    }
    const details = h("details", { open: "" }, h("summary", {}, `niveau de tête ${level.head} (${level.options.length} options)`), children);
    return details;
  };

  const root = byHead.get(1) ?? levels[0];
  const treeBox = h("div", {}, root ? levelNode(root) : note("aucun niveau"));
  // Niveaux jamais atteints depuis le niveau de départ.
  const orphans = levels.filter((level) => !expanded.has(level.head));
  for (const level of orphans) treeBox.append(h("p", { class: "empty" }, `niveau de tête ${level.head} non atteint depuis le niveau de départ :`), levelNode(level));

  const openingJoe = dog.joeSentences[0];
  const openingPerson = dog.personSentences[0];
  const openings = h(
    "div",
    {},
    table(
      ["échange", "qui", "texte", "voix"],
      [
        ["premier", "Joe", sentenceText(openingJoe), voiceCells(play, openingJoe ? sentenceVoices(dialogOpeningVoicePrefix(dog.talkKey, "SSSS", "J"), openingJoe.text, has) : [])],
        ["premier", "personnage", sentenceText(openingPerson), voiceCells(play, openingPerson ? sentenceVoices(dialogOpeningVoicePrefix(dog.talkKey, "SSSS", "P"), openingPerson.text, has) : [])],
        ["déjà rencontré", "personnage", h("span", { class: "text" }, dog.person2.greeting || "(vide)"), voiceCells(play, sentenceVoices(dialogOpeningVoicePrefix(dog.talkKey, "XXXX", "P"), dog.person2.greeting, has))],
        ["déjà rencontré", "Joe", h("span", { class: "text" }, dog.person2.joe || "(vide)"), voiceCells(play, sentenceVoices(dialogOpeningVoicePrefix(dog.talkKey, "XXXX", "J"), dog.person2.joe, has))],
      ],
    ),
  );

  const encodings = new Set([...dog.joeSentences, ...dog.personSentences].map((s) => s.encoding));
  return h(
    "div",
    {},
    info(
      ["clé du dialogue (voix TT…)", dog.talkKey],
      ["clé unique", dog.uniqueKey],
      ["niveaux", `${dog.levelCount}${dog.cannotQuit ? " (on ne peut pas quitter)" : ""}`],
      ["phrases", `Joe ${dog.jMax}, personnage ${dog.pMax}`],
      ["encodages des phrases", [...encodings].join(", ")],
      ["conditions de fin", dog.conditions.map((c, i) => `${i + 1} : état ${c.state} = ${c.value}, objet d'inventaire ${c.item}`).join(" ; ")],
      ["cinématique de fin", dog.cutaway.file && dog.cutaway.file !== "*" ? h("span", {}, fileLink(ctx, dog.cutaway.file), ` si l'état ${dog.cutaway.state} = ${dog.cutaway.value}`) : "aucune"],
      ["mots 28 et 30", `${dog.reservedHeader.join(", ")} (le second répète le nombre de niveaux)`],
      ["remplissage nul", `${dog.padding} octets`],
    ),
    section("Ouvertures", openings),
    section("Arbre", note("Un niveau est nommé par la tête de son option 0 ; la valeur de nœud d'une option est la tête du niveau suivant (-1 : fin)."), treeBox),
  );
}

// --- Cinématiques .CUT -----------------------------------------------------------------------------------------------

async function renderCut(ctx: PanelContext): Promise<HTMLElement> {
  const data = await gameData(ctx);
  const isPerson = (n: number): boolean => data.jas.objects[n]?.image === -3 || data.jas.objects[n]?.image === -4;
  const cut: Cutaway = parseCutaway(ctx.bytes, isPerson);
  const name = stem(ctx.path);
  const play = voicePlayer(ctx);
  const has = (path: string): boolean => ctx.files.has(path);

  const objects = cut.objects.map((o, i) => {
    const voices = cutObjectVoices(name, i + 1, o, has);
    return [
      i + 1,
      o.objectNumber > 0 ? `${o.objectNumber} ${objectName(data.jas, data.texts, o.objectNumber)}` : o.roomFade ? "-1 (fondu)" : o.objectNumber,
      o.kind,
      o.room,
      `${o.bobStartX},${o.bobStartY}`,
      `${o.moveToX},${o.moveToY}`,
      o.bank,
      o.animList,
      o.execute,
      o.specialMove,
      o.animType,
      o.fromObject,
      o.scale,
      `${o.limit.x1},${o.limit.y1} - ${o.limit.x2},${o.limit.y2}${o.song ? ` morceau ${o.song}` : ""}`,
      o.people.join(" "),
      o.sentence === "*" || o.sentence === "" ? "" : h("span", { class: "text" }, o.sentence),
      voiceCells(play, voices),
    ];
  });
  const animations = cut.objects.flatMap((o, i) =>
    o.animations.map((a) => [i + 1, a.object, `${a.unpackFrame}${a.flip ? " (miroir)" : ""}`, a.speed, a.bank, `${a.mx},${a.my}`, `${a.cx},${a.cy}`, a.scale, a.song]),
  );
  const states = cut.states.map((s) => [s.stateIndex, s.stateValue, s.object, s.area, s.areaSubIndex, s.fromObject]);
  const extra = cut.extra.entries.map((words) => {
    const e = cutExtraEntry(words);
    const last = lastObjectPositions(cut, e.object);
    const samePosition = last.length > 0 ? (last.some((p) => p.x === e.x && p.y === e.y) ? "oui" : "non") : e.x === 0 && e.y === 0 ? "(aucune)" : "non";
    const image = lastObjectImage(cut, e.object);
    const sameImage = image === null ? "(pas d'animation)" : image === e.image ? "oui" : "non";
    const own = data.jas.objects[e.object];
    return [e.object, objectName(data.jas, data.texts, e.object), e.entryObject, `${e.x},${e.y}`, samePosition, e.room, own ? own.room : "", e.image, sameImage, e.state];
  });

  return h(
    "div",
    {},
    info(
      ["panneau (champ 0)", `${cut.panel} (sans rapport avec la hauteur du décor : constaté en vague V)`],
      ["objets", `${cut.objectCount}, ${cut.skippable ? "sautable" : "non sautable"}`],
      ["drapeaux", `${cut.flags}${cut.flags < 0 ? ` : pièce finale ${cut.finalRoom}` : cut.anotherCutaway ? " : enchaîne une autre cinématique" : ""}`],
      ["phrase d'entrée", cut.entrySentence || "(aucune)"],
      ["Joe à la fin", cut.joeFinal.room ? `pièce ${cut.joeFinal.room}, ${cut.joeFinal.x},${cut.joeFinal.y}` : "inchangé"],
      ["banques", `${cut.bankNames.length} non vides sur ${cut.bankNameCount} : ${cut.bankNames.map((b) => b).join(", ")}`],
      ["dialogue de fin", cut.talkFile && cut.talkFile !== "*" ? h("span", {}, fileLink(ctx, cut.talkFile), `, Joe parle à l'objet ${cut.talkTo}`) : "aucun"],
      ["mots de fin des objets (recordsTrailer)", cut.recordsTrailer.length > 0 ? cut.recordsTrailer.join(", ") : "aucun"],
      ["mots de fin de la section supplémentaire", cut.extra.trailer.join(", ")],
    ),
    section(
      `Enregistrements (${objects.length})`,
      table(["n°", "objet", "nature", "pièce", "départ", "marche", "banque", "anim.", "exéc.", "mouv.", "type", "depuis", "échelle", "bornes", "personnes", "phrase", "voix"], objects, [0, 3, 6, 7, 8, 9, 10, 11, 12]),
    ),
    animations.length > 0 ? section(`Animations (${animations.length})`, table(["enreg.", "objet", "image", "vitesse", "banque", "mx,my", "cx,cy", "échelle", "morceau"], animations, [0, 1, 3, 4, 7, 8])) : "",
    states.length > 0 ? section(`États (${states.length})`, table(["état", "valeur", "objet", "zone", "sous-zone", "depuis"], states, [0, 1, 2, 3, 4, 5])) : "",
    extra.length > 0
      ? section(
          `Section supplémentaire (${extra.length}, non lue par ScummVM)`,
          note("Nouvelles valeurs de l'objet à la fin de la cinématique (ordre de ObjectData : objet, objet associé, x, y, pièce, image, état). « = dernière position » : (x, y) est le départ ou la marche du dernier enregistrement de l'objet qui en a une ; « = dernière image » : image de la dernière animation de l'objet (négative en miroir, 1000 si elle finit sur l'image 0). L'état est supposé."),
          table(["objet", "nom", "associé", "x,y", "= dernière position", "pièce", "pièce JAS", "image", "= dernière image", "état"], extra, [0, 2, 5, 6, 7, 9]),
        )
      : "",
  );
}

// --- Génériques (.CRD, DATA) -----------------------------------------------------------------------------------------------

function renderCredits(ctx: PanelContext): HTMLElement {
  const credits = parseCredits(ctx.bytes);
  const pages = credits.pages.map((page, index) => {
    const screen = h("div", { style: "position:relative;width:640px;height:400px;background:#000;color:#ddd;overflow:hidden;font:12px/1 ui-monospace,Menlo,monospace" });
    for (const line of page.lines) {
      const style =
        line.align === "left"
          ? `left:${line.zoneX * 2}px`
          : line.align === "center"
            ? `left:${line.zoneX * 2}px;width:${Math.trunc(320 / 3) * 2}px;text-align:center`
            : `left:${line.zoneX * 2}px;width:${Math.trunc(320 / 3) * 2}px;text-align:right`;
      screen.append(h("div", { style: `position:absolute;top:${line.y * 2}px;white-space:pre;${style};font-size:${line.fontSize ? 16 : 12}px` }, line.text));
    }
    return h(
      "figure",
      {},
      screen,
      h("figcaption", {}, `page ${index + 1} : ${page.lines.length} lignes, ${page.pause < 0 ? "attend le changement de pièce" : `attend ${page.pause} images`}`),
    );
  });
  return h(
    "div",
    {},
    info(["pages", credits.pages.length], ["ligne de fin (EN)", credits.hasEnd ? "oui" : "non"], ["lignes jamais affichées", credits.unshown.length]),
    note("Aperçu à l'échelle x2 : zone de la grille 3 x 3, alignement et rangée comme dans credits.cpp ; polices et couleurs non reproduites."),
    h("div", { class: "grid" }, ...pages),
  );
}

// --- Voix (.mp3) -------------------------------------------------------------------------------------------------------------

async function renderVoice(ctx: PanelContext): Promise<HTMLElement> {
  const name = stem(ctx.path);
  const audio = h("audio", { controls: "", preload: "none", src: ctx.url });
  ctx.onDispose(() => audio.pause());
  const textBox = h("div", {}, note("rattachement au texte…"));
  const cutaways = new Set(ctx.files.list((path) => extensionOf(path) === "CUT").map(stem));
  const voice = parseVoiceName(name, cutaways);
  void (async () => {
    try {
      const [data, dialogs] = await Promise.all([gameData(ctx), allDialogs(ctx)]);
      let cut: Cutaway | null = null;
      if (voice.kind === "cutaway") {
        const path = ctx.files.resolve(`${voice.cutaway}.CUT`);
        if (path) cut = parseCutaway(await ctx.fetchBytes(path), (n) => data.jas.objects[n]?.image === -3 || data.jas.objects[n]?.image === -4);
      }
      const source = describeVoice(voice, { jas: data.jas, texts: data.texts, dialogs: dialogsByKey(dialogs), cut });
      textBox.replaceChildren(info(["origine", source.origin], ["texte du segment", source.text === null ? "(aucun texte rattaché)" : source.text === "" ? "(vide)" : source.text]));
    } catch (error) {
      textBox.replaceChildren(h("p", { class: "error" }, `texte indisponible : ${(error as Error).message}`));
    }
  })();
  return h(
    "div",
    {},
    info(["famille", voice.kind], ["format", "MP3 mono 22 050 Hz (converti des .SB Ogg Vorbis 11 840 Hz d'origine)"], ["octets", formatSize(ctx.bytes.length)]),
    audio,
    textBox,
  );
}

// --- Tables de morceaux (AQ.RL, AQBANK.MUS) ----------------------------------------------------------------------------------

function renderSongs(ctx: PanelContext): HTMLElement {
  const bank = readSongBank(ctx.bytes);
  const rows = bank.songs.map(songRow).map((s) => [s.index, s.offset, s.length, s.compression, s.format, s.tracks, s.division, s.smfBytes, s.defect]);
  const compressed = bank.songs.filter((s) => s.compression !== "none").length;
  const defects = bank.songs.filter((s) => s.defect).length;
  return h(
    "div",
    {},
    info(
      ["morceaux", `${bank.songs.length} (numérotés à partir de 0)`],
      ["compressés (dictionnaire)", compressed],
      ["morceaux défectueux", defects],
      ["octets entre la table et le premier morceau", [...bank.info].map((b) => b.toString(16).padStart(2, "0")).join(" ")],
    ),
    note("Chaque morceau est un fichier MIDI standard (direct ou décompressé). Pas de lecture ici : la musique relève de l'audio du jeu."),
    table(["n°", "offset", "longueur", "stockage", "format", "pistes", "division", "SMF (octets)", "défaut"], rows, [0, 1, 2, 4, 5, 6, 7]),
  );
}

function renderText(ctx: PanelContext): HTMLElement {
  return h("pre", { class: "text" }, new TextDecoder("utf-8").decode(ctx.bytes));
}

export const PANELS: Panel[] = [
  { matches: hasExtension("PCX"), render: renderPcx },
  { matches: hasExtension("BBK", "ACT", "SAM"), render: renderBank },
  { matches: hasExtension("MSK", "LUM"), render: renderLight },
  { matches: hasName("QUEEN.JAS"), render: renderJas },
  { matches: hasName("QUEEN2.JAS"), render: renderTexts },
  { matches: hasExtension("DOG"), render: renderDog },
  { matches: hasExtension("CUT"), render: renderCut },
  { matches: (entry) => hasExtension("CRD")(entry) || hasName("DATA")(entry), render: renderCredits },
  { matches: hasExtension("MP3"), render: renderVoice },
  { matches: hasExtension("RL", "MUS"), render: renderSongs },
  { matches: hasExtension("TXT"), render: renderText },
];
