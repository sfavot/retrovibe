import { encodeCp437 } from "../../../data/cp437";
import type { GameFileEntry } from "../../../data/game-files";
import { PALETTE_BYTES, makeCanvas, paintIndexed, paletteToLut, vga6ToRgb8 } from "../../../ui/indexed-canvas";
import { h, hexDump, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import type { Panel, PanelContext } from "../../../ui/asset-viewer/viewer";
import { parseCm } from "../data/commands";
import { parseDictionary, wordClass, wordKind, wordRole } from "../data/dictionary";
import { parseGph } from "../data/font";
import { bankData, decodeMixKey, parseMix } from "../data/mix";
import { parseSongBank, trackSteps } from "../data/music";
import { readDefaultPalette, readRecolorTables } from "../data/palette";
import { readScene } from "../data/scene";
import { SPRITE_TRANSPARENT, readSprite, type SpriteAnimation, type SpriteFrame, type SpriteStep } from "../data/sprite";
import { SPRITE_FAMILIES, parseAni, parseDef, parseHelp, parseInstall } from "../data/tables";
import { MessageTable, parsePlainMessages } from "../data/text";
import { readCountedArchive, readSceneArchive } from "../data/vga-archive";
import { maxScore, parseWorld } from "../data/world";

type Cell = string | number | Node;
type Render = (ctx: PanelContext) => Promise<HTMLElement> | HTMLElement;

const SCENE_SCALE = 2;
const FRAME_SCALE = 2;
const ZOOM_SCALE = 4;
/** Nombre maximal de lignes affichées dans une liste filtrable. */
const ROW_LIMIT = 300;
/** Valeur maximale des masques de profondeur (multiples de 8 de 0 à 160) : sert à étaler les gris. */
const MASK_MAX = 160;

/** Nom du fichier en majuscules, sans dossier. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toUpperCase();
}

const SCENE_FILE = /^A1F\d\d[A-Z]\.VGA$/;
const SPRITE_FILE = /^A1F(OBJ|ANM|DEC|INT)\.VGA$/;

/** Famille d'un fichier : groupe de la barre latérale. */
export function family(path: string): string {
  const name = nameOf(path);
  if (SCENE_FILE.test(name)) return "Scènes";
  if (SPRITE_FILE.test(name)) return "Sprites";
  if (/^A1F(MSG|TMS|SOS|DIC|CM\d)\.SYS$/.test(name) || /^MSG(HRD|INT|UTL)$/.test(name)) return "Textes";
  if (/^(A1FCFG\.SYS|SVG001\.STD|A1FTMP\.(SVG|SCR))$/.test(name)) return "Monde";
  if (name === "A1FMIX.SYS") return "Son";
  return "Moteur";
}

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h("section", {}, h("h3", {}, title), ...children);
}

function info(...pairs: [string, Cell][]): HTMLElement {
  const list = h("dl", { class: "info" });
  for (const [key, value] of pairs) list.append(h("dt", {}, key), h("dd", {}, typeof value === "object" ? value : String(value)));
  return list;
}

function hex(bytes: ArrayLike<number>, separator = " "): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(separator);
}

function tableRow(cells: Cell[], classes: string[], tag: "td" | "th" = "td"): HTMLTableRowElement {
  const row = h("tr", {});
  cells.forEach((cell, i) => {
    const el = h(tag, classes[i] ? { class: classes[i] } : {});
    el.append(typeof cell === "object" ? cell : String(cell));
    row.append(el);
  });
  return row;
}

/** Tableau simple ; `classes` donne une classe CSS par colonne (`num`, `text`, `hex`). */
function table(headers: string[], rows: Cell[][], classes: string[] = []): HTMLTableElement {
  const thead = h("thead", {}, tableRow(headers, [], "th"));
  const tbody = h("tbody", {});
  for (const row of rows) tbody.append(tableRow(row, classes));
  return h("table", {}, thead, tbody);
}

/** Bouton qui déplie ou replie, sous sa ligne de tableau, un contenu construit à la demande. */
function expander(label: string, columns: number, build: () => Node): HTMLButtonElement {
  const button = h("button", { type: "button" }, label);
  let detail: HTMLTableRowElement | null = null;
  button.addEventListener("click", () => {
    const row = button.closest("tr")!;
    if (detail) {
      detail.remove();
      detail = null;
      return;
    }
    detail = h("tr", {}, h("td", { colspan: String(columns) }, build()));
    row.after(detail);
  });
  return button;
}

/** Liste filtrable (id, texte…) : une zone de saisie, le nombre de résultats et au plus `ROW_LIMIT` lignes. */
function filterList(headers: string[], rows: { key: string; cells: Cell[] }[], classes: string[] = []): HTMLElement {
  const input = h("input", { type: "search", placeholder: "filtrer", "aria-label": "Filtrer la liste" });
  const count = h("span", { class: "empty" });
  const tbody = h("tbody", {});
  const refresh = () => {
    const query = input.value.trim().toLowerCase();
    const matches = rows.filter((row) => !query || row.key.includes(query));
    tbody.replaceChildren(...matches.slice(0, ROW_LIMIT).map((row) => tableRow(row.cells, classes)));
    count.textContent = matches.length > ROW_LIMIT ? `${ROW_LIMIT} sur ${matches.length}` : `${matches.length}`;
  };
  input.addEventListener("input", refresh);
  refresh();
  return h("div", {}, h("div", { class: "bar" }, input, count), h("table", {}, h("thead", {}, tableRow(headers, [], "th")), tbody));
}

/** Texte de message : ■ = saut de ligne dans le jeu. */
function showLines(text: string): string {
  return text.replaceAll("■", "↵\n");
}

// --- Palette et images -------------------------------------------------------------------------

interface EngineColors {
  /** Palette RGB 8 bits. */
  rgb: Uint8Array;
  /** Table de couleurs RGBA correspondante. */
  lut: Uint32Array;
  /** Table de recoloration des couches de type 1. */
  recolor: Uint8Array;
}

let colors: Promise<EngineColors> | null = null;

/** Palette et recoloration d'`AM1.EXE`, chargées une seule fois. */
function engineColors(ctx: PanelContext): Promise<EngineColors> {
  colors ??= ctx
    .fetchBytes(ctx.files.resolve("AM1.EXE") ?? "AM1.EXE")
    .then((exe) => {
      const rgb = vga6ToRgb8(readDefaultPalette(exe));
      return { rgb, lut: paletteToLut(rgb), recolor: readRecolorTables(exe).type1 };
    })
    .catch((error: unknown) => {
      colors = null;
      throw error;
    });
  return colors;
}

/** Niveaux de gris d'un masque : 0 noir, `MASK_MAX` blanc. */
const MASK_LUT = (() => {
  const rgb = new Uint8Array(PALETTE_BYTES);
  for (let i = 0; i < 256; i++) rgb.fill(Math.min(255, Math.round((i * 255) / MASK_MAX)), i * 3, i * 3 + 3);
  return paletteToLut(rgb);
})();

function indexedCanvas(pixels: Uint8Array, width: number, height: number, lut: Uint32Array, scale: number, transparent?: number): HTMLCanvasElement {
  const canvas = makeCanvas(width, height, scale);
  paintIndexed(canvas, pixels, width, height, lut, transparent === undefined ? {} : { transparent });
  if (transparent !== undefined) canvas.classList.add("alpha");
  return canvas;
}

// --- Scènes ------------------------------------------------------------------------------------

const scenesPanel: Render = async (ctx) => {
  const archive = readSceneArchive(ctx.bytes);
  const { lut, recolor } = await engineColors(ctx);
  const root = h("div", {});
  for (const entry of archive.entries) {
    const block = section(`Scène ${entry.id}`);
    try {
      const scene = readScene(archive.bytes(entry.id), { recolorType1: recolor });
      const { header } = scene;
      block.append(
        info(
          ["identifiant", header.id],
          ["rectangle", `${header.x},${header.y} ${header.width}×${header.height}`],
          ["décors", header.decorCount],
          ["points sensibles", header.hotspotCount],
          ["plans", header.planeCount],
          ["grille", header.gridCount],
          ["zones", header.zoneCount],
          ["limites X", `${header.limits.xMin} à ${header.limits.xMax}`],
          ["limites Y", `${header.limits.yMin} à ${header.limits.yMax}`],
          ["limites P", `${header.limits.pMin} à ${header.limits.pMax}`],
          ["permutation", header.permutation.join(" ")],
          ["taille des couches", header.layerSizes.join(" / ")],
        ),
      );
      const layers = h("div", { class: "layers" });
      for (const layer of scene.layers) {
        const mask = layer.type === 0;
        const canvas = indexedCanvas(layer.pixels, layer.width, layer.height, mask ? MASK_LUT : lut, SCENE_SCALE);
        const label = mask ? "masque" : "décor";
        layers.append(h("figure", {}, canvas, h("figcaption", {}, `${label} · type ${layer.type} · ${layer.width}×${layer.height} · ${layer.size} o`)));
      }
      block.append(layers);
      if (scene.zones.length > 0) {
        block.append(
          table(
            ["zone", "type", "rangée", "colonnes", "Y"],
            scene.zones.map((zone, i) => [i, zone.type, zone.row, `${zone.colStart} à ${zone.colEnd}`, `${zone.low} à ${zone.high}`]),
            ["num", "num", "num", "", ""],
          ),
        );
      }
    } catch (error) {
      block.append(h("p", { class: "error" }, `Erreur : ${(error as Error).message}`));
    }
    root.append(block);
  }
  return root;
};

/** Pas d'animation : `#image×durée`, `↔` si l'image est en miroir. */
function stepLabel(step: SpriteStep): string {
  return `#${step.frame}×${step.duration}${step.mirror ? "↔" : ""}`;
}

/** Une ligne par `Fig` : miroir à gauche, pas `dpX`/`dpY` et séquence de chacune des quatre directions. */
function animationTable(animation: SpriteAnimation): HTMLElement {
  const rows = animation.figs.map((fig) => [
    fig.index,
    fig.mirrorLeft ? "oui" : "non",
    fig.dpX,
    fig.dpY,
    ...fig.directions.map((sequence) => sequence.steps.map(stepLabel).join(" ")),
  ]);
  return h(
    "div",
    {},
    info(["pas", "#image×durée en tics, ↔ = miroir"]),
    table(["Fig", "miroir gauche", "dpX", "dpY", "droite", "gauche", "avant", "fond"], rows, ["num", "", "num", "num", "", "", "", ""]),
  );
}

// --- Sprites -----------------------------------------------------------------------------------

function frameCanvas(frame: SpriteFrame, lut: Uint32Array, scale: number): HTMLCanvasElement {
  return indexedCanvas(frame.pixels, frame.width, frame.height, lut, scale, SPRITE_TRANSPARENT);
}

const spritesPanel: Render = async (ctx) => {
  const archive = readCountedArchive(ctx.bytes);
  const { lut } = await engineColors(ctx);
  const zoom = h("div", { class: "zoom" });
  const root = h("div", {}, info(["ressources", archive.entries.length]), zoom);
  archive.entries.forEach((entry, index) => {
    const details = h("details", { class: "resource" }, h("summary", {}, `ressource ${entry.id}`));
    const fill = () => {
      try {
        const sprite = readSprite(archive.bytes(entry.id));
        details.querySelector("summary")!.textContent = `ressource ${entry.id} · ${sprite.frames.length} images`;
        const sheet = h("div", { class: "grid sheet" });
        sprite.frames.forEach((frame, i) => {
          const figure = h("figure", { title: "agrandir" });
          figure.append(
            frame.width * frame.height > 0 ? frameCanvas(frame, lut, FRAME_SCALE) : h("span", { class: "empty" }, "vide"),
            h("figcaption", {}, `#${i} ${frame.width}×${frame.height}`),
          );
          figure.addEventListener("click", () => {
            for (const other of root.querySelectorAll("figure[aria-current]")) other.removeAttribute("aria-current");
            figure.setAttribute("aria-current", "true");
            zoom.replaceChildren(
              frame.width * frame.height > 0 ? frameCanvas(frame, lut, ZOOM_SCALE) : h("span", { class: "empty" }, "vide"),
              h("figcaption", {}, `ressource ${entry.id} · image ${i} · ${frame.width}×${frame.height}`),
            );
          });
          sheet.append(figure);
        });
        const anim = sprite.animation;
        details.append(info(["animation", `${anim.records} enregistrements, ${anim.words} mots`]), animationTable(anim), sheet);
      } catch (error) {
        details.append(h("p", { class: "error" }, `Erreur : ${(error as Error).message}`));
      }
    };
    details.addEventListener("toggle", () => details.open && !details.querySelector(".sheet, .error") && fill());
    if (index === 0) details.open = true;
    root.append(details);
  });
  return root;
};

// --- Textes ------------------------------------------------------------------------------------

const msgPanel: Render = async (ctx) => {
  const tms = ctx.files.resolve("A1FTMS.SYS");
  const msg = ctx.files.resolve("A1FMSG.SYS");
  if (!tms || !msg) throw new Error("A1FTMS.SYS et A1FMSG.SYS requis");
  const table = new MessageTable(await ctx.fetchBytes(tms), await ctx.fetchBytes(msg));
  const rows = table.ids.map((id) => {
    const text = table.messages(id);
    return { key: `${id} ${text}`.toLowerCase(), cells: [id, showLines(text)] };
  });
  return h("div", {}, info(["messages", table.count]), filterList(["id", "texte"], rows, ["num", "text"]));
};

const plainMessagesPanel: Render = (ctx) => {
  const plain = parsePlainMessages(ctx.bytes);
  const rows = [...plain.messages].map(([id, text]) => ({ key: `${id} ${text}`.toLowerCase(), cells: [id, showLines(text)] }));
  return h("div", {}, info(["messages", plain.declaredCount]), filterList(["n°", "texte"], rows, ["num", "text"]));
};

const helpPanel: Render = (ctx) => {
  const nodes = parseHelp(ctx.bytes);
  const rows = nodes.map((node, i) => ({ key: `${i} ${node.text}`.toLowerCase(), cells: [i, node.link, node.child, showLines(node.text)] }));
  return h("div", {}, info(["nœuds", nodes.length]), filterList(["#", "lien", "enfant", "texte"], rows, ["num", "num", "num", "text"]));
};

const dictionaryPanel: Render = (ctx) => {
  const words = parseDictionary(ctx.bytes);
  const rows = words.map((entry) => {
    const cls = wordClass(entry.code);
    return { key: `${entry.word} ${entry.code} ${cls}`.toLowerCase(), cells: [entry.word, entry.code, cls, wordKind(entry.code) ?? "?", wordRole(entry.code)] };
  });
  return h("div", {}, info(["mots", words.length]), filterList(["mot", "code", "classe", "sens", "rôle"], rows, ["", "num", "num"]));
};

const cmPanel: Render = (ctx) => {
  const records = parseCm(ctx.bytes);
  const rows = records.map((r, i) => [i, `${r.name} (${r.group}/${r.token})`, r.repeat, r.args.join(" "), showLines(r.text)]);
  return h("div", {}, info(["enregistrements", records.length]), table(["#", "jeton", "rép.", "arguments", "texte"], rows, ["num", "", "num", "", "text"]));
};

// --- Police ------------------------------------------------------------------------------------

const SAMPLE = "Armaeth : l'épée de la forêt, à ça !";
const SAMPLE_SPACING = 1;
const FONT_SCALE = 4;

/** Palette de deux couleurs : l'encre (index 1) en blanc sur le fond sombre de la page (index 0). */
const INK_LUT = (() => {
  const rgb = new Uint8Array(PALETTE_BYTES);
  rgb.set([11, 11, 13]);
  rgb.fill(255, 3, 6);
  return paletteToLut(rgb);
})();

function inkCanvas(pixels: Uint8Array, width: number, height: number): HTMLCanvasElement {
  return indexedCanvas(pixels, width, height, INK_LUT, FONT_SCALE);
}

const gphPanel: Render = (ctx) => {
  const font = parseGph(ctx.bytes);
  const cell = font.cellWidth + 2;
  const cellH = font.cellHeight + 2;
  const sheet = new Uint8Array(16 * cell * 16 * cellH);
  for (let code = 0; code < 256; code++) {
    const g = font.glyph(code);
    const bitmap = font.bitmap(code);
    const ox = (code % 16) * cell + 1;
    const oy = Math.floor(code / 16) * cellH + 1;
    for (let y = 0; y < font.cellHeight; y++) for (let x = 0; x < g.width; x++) sheet[(oy + y) * 16 * cell + ox + x] = bitmap[y * g.width + x];
  }

  const input = h("input", { type: "text", value: SAMPLE, "aria-label": "Texte d'essai", size: "40" });
  const sample = h("div", { class: "sample" });
  const widths = h("p", { class: "empty" });
  const draw = () => {
    const bytes = encodeCp437(input.value);
    const width = Math.max(1, font.measure(bytes, SAMPLE_SPACING));
    const pixels = new Uint8Array(width * font.cellHeight);
    let x = 0;
    for (const code of bytes) {
      const g = font.glyph(code);
      const bitmap = font.bitmap(code);
      for (let row = 0; row < font.cellHeight; row++) for (let col = 0; col < g.width; col++) if (x + col < width) pixels[row * width + x + col] = bitmap[row * g.width + col];
      x += g.width + SAMPLE_SPACING;
    }
    sample.replaceChildren(inkCanvas(pixels, width, font.cellHeight));
    widths.textContent = `largeur : ${font.measure(bytes)} px sans espacement, ${font.measure(bytes, SAMPLE_SPACING)} px avec ${SAMPLE_SPACING}`;
  };
  input.addEventListener("input", draw);
  draw();

  const sheetCanvas = inkCanvas(sheet, 16 * cell, 16 * cellH);
  return h(
    "div",
    {},
    info(["cellule", `${font.cellWidth}×${font.cellHeight}`]),
    section("Essai", input, sample, widths),
    section("Glyphes", h("div", { class: "sample" }, sheetCanvas)),
  );
};

// --- Monde -------------------------------------------------------------------------------------

const TYP_NAMES = SPRITE_FAMILIES.slice(0, 3);

const worldPanel: Render = (ctx) => {
  const world = parseWorld(ctx.bytes);
  const { header } = world;
  const rooms = world.rooms.map((room) => [
    room.id,
    room.lightOffset,
    room.outdoor,
    room.musicClass === 0 ? "-" : `${String.fromCharCode(room.musicClass)} ${room.musicId} ${room.musicNumber}`,
    room.exits.join(" "),
    room.barriers.join(" "),
  ]);
  const objects = world.objects.map((o, i) => [
    i,
    o.num,
    o.serial,
    `${o.typ} (${TYP_NAMES[o.typ] ?? "?"})`,
    o.gst,
    o.mob,
    o.dep,
    o.txt,
    o.value,
    o.weight,
    o.x,
    o.y,
    o.location,
    o.container,
    expander("hex", 13, () => h("pre", {}, hexDump(o.raw, o.raw.length))),
  ]);
  return h(
    "div",
    {},
    info(
      ["salle courante", header.currentRoom],
      ["salles", header.roomCount],
      ["objets", header.objectCount],
      ["héros (série)", header.heroSerial],
      ["dernier numéro de série", header.lastSerial],
      ["lettres significatives", header.dictionaryLetters],
      ["chapitre × 100 + niveau", header.chapterLevel],
      ["score", `${header.score} / ${maxScore(world)}`],
      ["événements différés", world.deferredEvents.events.length],
    ),
    section(
      `Table de score (${world.scoreTable.length})`,
      table(["id", "points", "son", "répétitions"], world.scoreTable.map((e) => [e.id, e.points, e.sound, e.repeats]), ["num", "num", "num", "num"]),
    ),
    section(`Salles (${rooms.length})`, table(["id", "lumière", "ext.", "musique", "sorties", "barrages"], rooms, ["num", "num", "num", "", "num", "num"])),
    section(
      `Objets (${objects.length})`,
      table(["#", "num", "série", "typ", "gst", "mob", "dep", "txt", "valeur", "poids", "x", "y", "cod", "conteneur", ""], objects, ["num", "num", "num", "", "num", "num", "num", "num", "num", "num", "num", "num", "num", "num"]),
    ),
  );
};

// --- Tables, son, moteur -----------------------------------------------------------------------

const defPanel: Render = (ctx) => {
  const def = parseDef(ctx.bytes);
  const root = h("div", {});
  for (const family of SPRITE_FAMILIES) {
    const rows = def.records[family].map((r) => [r.id, hex(r.bytes)]);
    root.append(section(`${family} (${def.counts[family]})`, table(["id", "octets 2 à 27"], rows, ["num", "hex"])));
  }
  return root;
};

const aniPanel: Render = (ctx) => {
  const ani = parseAni(ctx.bytes);
  const rows = ani.records.map((r) => [r.id, r.kind, r.unknown2, r.unknown3, r.steps, r.start, Array.from(ani.sequence(r.id)).join(" ")]);
  return h("div", {}, table(["id", "type", "mot 2", "mot 3", "pas", "début", "mots"], rows, ["num", "num", "num", "num", "num", "num", "hex"]));
};

const insPanel: Render = (ctx) => {
  const ins = parseInstall(ctx.bytes);
  return h("div", {}, info(["type", ins.type], ["lecteur", ins.drive], ["répertoire", ins.directory]), h("pre", {}, hexDump(ins.raw, ins.raw.length)));
};

const mixPanel: Render = (ctx) => {
  const mix = parseMix(ctx.bytes);
  const tracks = mix.tracks.map((t) => {
    const decoded = decodeMixKey(t.key);
    return [t.key, decoded ? `${decoded.cls}${decoded.num}` : "", t.tempo, t.volume, t.voiceMask.toString(2).padStart(11, "0"), t.speakerTrack];
  });
  const banks = mix.banks.map((b) => [
    b.id,
    b.key,
    b.size,
    b.offset,
    b.effectKeys.filter((k) => k !== 0).length,
    expander("morceaux", 6, () => songsSummary(bankData(mix, b))),
  ]);
  return h(
    "div",
    {},
    info(["tampon des musiques", mix.musicBufferSize], ["tampon des autres sons", mix.effectBufferSize]),
    section(`Sons (${tracks.length})`, table(["clé", "classe+n°", "tempo", "volume", "voix", "haut-parleur"], tracks, ["num", "", "num", "num", "hex", "num"])),
    section(`Banques (${banks.length})`, table(["id", "clé", "taille", "offset", "effets", ""], banks, ["num", "num", "num", "num", "num"])),
  );
};

function songsSummary(data: Uint8Array): HTMLElement {
  try {
    const bank = parseSongBank(data);
    const rows = bank.songs.map((song, i) => [
      i,
      song.tempo,
      song.voiceCount,
      song.patterns.length,
      song.instruments.length,
      song.trackLists.slice(0, song.voiceCount).map((list) => list.length).join(" "),
      trackSteps(song, 0),
    ]);
    return table(["#", "tempo", "voix", "motifs", "instruments", "motifs par piste", "pas"], rows, ["num", "num", "num", "num", "num", "hex", "num"]);
  } catch (error) {
    return h("p", { class: "error" }, `Erreur : ${(error as Error).message}`);
  }
}

const exePanel: Render = (ctx) => {
  const rgb = vga6ToRgb8(readDefaultPalette(ctx.bytes));
  return h("div", {}, section("Palette", paletteSwatch(rgb, 18)), section("Début du fichier", h("pre", {}, hexDump(ctx.bytes))));
};

// --- Table des panneaux ------------------------------------------------------------------------

function byName(test: (name: string) => boolean): (entry: GameFileEntry) => boolean {
  return (entry) => test(nameOf(entry.path));
}

function panel(test: (entry: GameFileEntry) => boolean, render: Render): Panel {
  return { matches: (entry) => test(entry), render };
}

/** Premier qui convient gagne ; les fichiers sans panneau (ex. `A1FTMP.SCR`) tombent sur l'hexadécimal de la coquille. */
export const PANELS: Panel[] = [
  panel(byName((n) => SCENE_FILE.test(n)), scenesPanel),
  panel(byName((n) => SPRITE_FILE.test(n)), spritesPanel),
  panel(byName((n) => n === "A1FMSG.SYS" || n === "A1FTMS.SYS"), msgPanel),
  panel(byName((n) => /^MSG(HRD|INT|UTL)$/.test(n)), plainMessagesPanel),
  panel(byName((n) => n === "A1FSOS.SYS"), helpPanel),
  panel(byName((n) => n === "A1FDIC.SYS"), dictionaryPanel),
  panel(byName((n) => /^A1FCM\d\.SYS$/.test(n)), cmPanel),
  panel(byName((n) => n === "A1FGPH.SYS"), gphPanel),
  panel(byName((n) => /^(A1FCFG\.SYS|SVG001\.STD|A1FTMP\.SVG)$/.test(n)), worldPanel),
  panel(byName((n) => n === "A1FDEF.SYS"), defPanel),
  panel(byName((n) => n === "A1FANI.SYS"), aniPanel),
  panel(byName((n) => n === "A1FINS.SYS"), insPanel),
  panel(byName((n) => n === "A1FMIX.SYS"), mixPanel),
  panel(byName((n) => n === "AM1.EXE"), exePanel),
];
