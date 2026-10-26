/** Panneau de `GLOBAL.BD` : liste des blocs et, pour chacun, la vue adaptée (chaînes, police, sprites, écrans, missions…). */
import { encodeCp437 } from "../../../../data/cp437";
import { h, hexDump, paletteSwatch } from "../../../../ui/asset-viewer/helpers";
import type { Panel, PanelContext } from "../../../../ui/asset-viewer/viewer";
import { paletteToLut } from "../../../../ui/indexed-canvas";
import { parseBd, type BdArchive } from "../../data/bd";
import {
  BLEND_BLOCK,
  CRATERS_BLOCK,
  GAUGE_BLOCK,
  GAUGE_HEIGHT,
  GAUGE_WIDTH,
  GLOBAL_FLAGS,
  SCREEN_HEIGHT,
  SCREEN_IDS,
  SCREEN_WIDTH,
  SPRITES_21X35_BLOCK,
  SPRITES_29X40_BLOCK,
  TEXTURES_BLOCK,
  VECTOR_FONT_BLOCK,
  parseBlendTable,
  parseColorRamp,
  parseCraters,
  parseGauge,
  parseHeader,
  parseScreen,
  parseSprites21x35,
  parseSprites29x40,
  parseTextures,
  parseVectorFont,
} from "../../data/global";
import { FONT_GLYPHS_BLOCK, FONT_WIDTHS_BLOCK, parseFont, parseRleSprites, renderText, type Font, type RleSprite } from "../../data/font";
import { MISSIONS_BLOCK, parseMissions, type ScriptElement } from "../../data/missions";
import { STRINGS_BLOCK, parseStrings, type StringTables } from "../../data/strings";
import type { Level } from "../../data/level";
import { createMeshPreview } from "../model-preview";
import {
  containerView,
  errorBox,
  filterTable,
  frameCanvas,
  framesView,
  greyCanvas,
  guarded,
  hex,
  indexedCanvas,
  info,
  section,
  select,
  table,
  type Frame,
  type ResourceRow,
} from "./common";
import { loadReferenceLevel, nameOf } from "./shared";

const ROLES: Record<number, string> = {
  1: "texte d'en-tête",
  2: "drapeaux",
  100: "chaînes localisées",
  200: "police vectorielle 3D",
  450: "police des versions accélérées",
  451: "atlas HUD (accéléré)",
  452: "jauge (accéléré)",
  500: "formes floues (accéléré)",
  501: "icônes d'armes",
  502: "inconnu",
  503: "jauge d'énergie",
  504: "explosion 64×64",
  505: "impacts 21×35",
  506: "viseurs 29×40",
  507: "police 2D : glyphes",
  508: "police 2D : avances",
  509: "rampes de couleur",
  510: "radar : cadre",
  511: "radar : triangles",
  512: "radar : éclats",
  600: "script des missions",
  700: "profils de cratère",
  800: "table de mélange",
};
for (const id of SCREEN_IDS) ROLES[id] = "écran plein cadre 320×400";

// --- Couleur : palette et fond --------------------------------------------------------------------------------------------------

interface Look {
  lut: Uint32Array;
  /** Indice de palette du pixel sur lequel on « dessine » les sprites (les sprites teintent ce qu'il y a dessous). */
  bg: number;
}

interface PaletteSource {
  name: string;
  /** Palette RVB 8 bits (768 octets). */
  palette: Uint8Array;
}

/** Barre « palette + fond » au-dessus d'un contenu reconstruit à chaque changement. */
function lookView(sources: PaletteSource[], defaults: { source: number; bg: number }, build: (look: Look) => Node): HTMLElement {
  const body = h("div", {});
  let source = Math.min(defaults.source, sources.length - 1);
  let bg = defaults.bg;
  const swatch = h("span", { class: "chip", "aria-hidden": "true" });
  const bar = h("div", { class: "bar" });
  const redraw = (): void => {
    const palette = sources[source]!.palette;
    swatch.style.background = `rgb(${palette[bg * 3]},${palette[bg * 3 + 1]},${palette[bg * 3 + 2]})`;
    try {
      body.replaceChildren(build({ lut: paletteToLut(palette), bg }));
    } catch (error) {
      console.error(error);
      body.replaceChildren(errorBox(error));
    }
  };
  const bgInput = h("input", { type: "number", min: "0", max: "255", value: String(bg), "aria-label": "Indice de fond", class: "narrow" });
  bgInput.addEventListener("input", () => {
    bg = Math.max(0, Math.min(255, Number(bgInput.value) || 0));
    redraw();
  });
  bar.append(
    select(
      "palette",
      sources.map((s, i) => [i, s.name] as [number, string]),
      source,
      (value) => {
        source = value;
        redraw();
      },
    ),
    h("label", { class: "field" }, "fond ", bgInput, swatch),
  );
  redraw();
  return h("div", {}, bar, body);
}

function toFrame(width: number, height: number, values: ArrayLike<number>, colorOf: (value: number) => number, label?: string): Frame {
  const rgba = new Uint32Array(width * height);
  for (let i = 0; i < rgba.length; i++) rgba[i] = colorOf(values[i]!);
  return { width, height, rgba, label };
}

/** Sprite RLE : chaque valeur est une ligne de la table de mélange 800 ; couleur = `table[ligne << 8 | fond]`. */
function spriteFrames(sprites: RleSprite[], blend: Uint8Array, look: Look): Frame[] {
  return sprites.map((s) => toFrame(s.width, s.height, s.rows, (row) => (row < 0 ? 0 : look.lut[blend[(row << 8) | look.bg]!]!), `origine (${s.x}, ${s.y})`));
}

// --- Vues par bloc ----------------------------------------------------------------------------------------------------------------

interface View {
  bd: BdArchive;
  level: Level | null;
  sources: PaletteSource[];
  blend: Uint8Array;
  /** Palette par défaut des sprites : celle du niveau (la table de mélange est faite pour elle), sinon le dernier écran. */
  preferred: number;
}

function headerView(v: View): HTMLElement {
  const header = parseHeader(v.bd);
  const names = Object.entries(GLOBAL_FLAGS).filter(([, bit]) => (header.flags & bit) !== 0);
  return h(
    "div",
    {},
    info(
      ["Texte du bloc 1", header.text],
      ["Options de génération", header.options.join(" ") || "—"],
      ["Drapeaux (bloc 2)", `0x${hex(header.flags)}`],
      ["Drapeaux connus", names.map(([name, bit]) => `${name} (0x${hex(bit)})`).join(", ") || "aucun"],
    ),
  );
}

function stringsView(v: View): HTMLElement {
  const strings: StringTables = parseStrings(v.bd);
  const languageOf = (i: number): string => strings.languages[i] ?? `langue ${i}`;
  const body = h("div", {});
  let language = strings.languages.findIndex((name) => name.toLowerCase().startsWith("fran"));
  if (language < 0) language = 0;
  let tableId = 1;
  const render = (): void => {
    const ids = strings.tableIds(language);
    if (!ids.includes(tableId)) tableId = ids[0] ?? 0;
    const entries = [...(strings.table(language, tableId)?.entries() ?? [])];
    const page = strings.glyphPages[language] ?? 0;
    body.replaceChildren(
      h(
        "div",
        { class: "bar" },
        select(
          "langue",
          strings.languages.map((_, i) => [i, languageOf(i)] as [number, string]),
          language,
          (value) => {
            language = value;
            render();
          },
        ),
        select(
          "table",
          ids.map((id) => [id, `table ${id}`] as [number, string]),
          tableId,
          (value) => {
            tableId = value;
            render();
          },
        ),
        h("span", { class: "empty" }, `page de glyphes ${page}${page === 0 ? " (CP437)" : " : octets 0x80-0xff affichés en Latin-1, décodage non établi"}`),
      ),
      filterTable(
        ["id", "texte"],
        entries.map(([id, text]) => ({ key: `${id} ${text}`.toLowerCase(), cells: [id, text.replaceAll("|", "↵\n")] })),
        ["num", "text"],
      ),
    );
  };
  render();
  return h("div", {}, info(["Langues", strings.languages.join(", ")], ["Pages de glyphes", strings.glyphPages.join(" ")], ["Bloc", STRINGS_BLOCK]), body);
}

function fontView(v: View): HTMLElement {
  const font: Font = parseFont(v.bd);
  const strings = parseStrings(v.bd);
  const COLS = 32;
  const maxTop = Math.min(0, ...font.glyphs.filter((g) => g.width > 0).map((g) => g.y));
  const maxBottom = Math.max(0, ...font.glyphs.filter((g) => g.width > 0).map((g) => g.y + g.height));
  const cellW = 20;
  const cellH = maxBottom - maxTop + 2;
  const sheetBuild = (look: Look): Node => {
    const w = COLS * cellW;
    const rowsCount = Math.ceil(font.glyphs.length / COLS);
    const rgba = new Uint32Array(w * rowsCount * cellH);
    font.glyphs.forEach((g, index) => {
      const ox = (index % COLS) * cellW + 1;
      const oy = Math.floor(index / COLS) * cellH + 1;
      for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
          const row = g.rows[y * g.width + x]!;
          const px = ox + g.x + x;
          const py = oy + g.y - maxTop + y;
          if (row >= 0 && g.x + x >= 0 && g.x + x < cellW - 1) rgba[py * w + px] = look.lut[v.blend[(row << 8) | look.bg]!]!;
        }
      }
    });
    const canvas = frameCanvas({ width: w, height: rowsCount * cellH, rgba }, 2);
    canvas.addEventListener("mousemove", (event) => {
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor(((event.clientX - rect.left) / rect.width) * COLS);
      const row = Math.floor(((event.clientY - rect.top) / rect.height) * rowsCount);
      const i = row * COLS + col;
      const g = font.glyphs[i];
      if (!g) return;
      const shown = i < 128 ? String.fromCharCode(i) : i < 256 ? "CP437 0x" + hex(i) : `page 1 0x${hex(i - 128)}`;
      canvas.title = `glyphe ${i} · ${shown} · avance ${g.advance} · ${g.width}×${g.height} en (${g.x}, ${g.y})`;
    });
    // Texte d'essai : mis en forme par `renderText` (avances de la police).
    const input = h("input", { type: "text", value: "Commencer le jeu - Crédits éàçôûê ¿¡", "aria-label": "Texte d'essai", class: "wide" });
    const sample = h("div", { class: "sample" });
    let page = 0;
    const drawSample = (): void => {
      try {
        const bytes = page === 0 ? encodeCp437(input.value) : Uint8Array.from(input.value, (c) => c.charCodeAt(0) & 0xff);
        const text = renderText(font, bytes, page);
        sample.replaceChildren(frameCanvas(toFrame(text.width, text.height, text.rows, (row) => (row < 0 ? 0 : look.lut[v.blend[(row << 8) | look.bg]!]!)), 3));
      } catch (error) {
        sample.replaceChildren(errorBox(error));
      }
    };
    input.addEventListener("input", drawSample);
    drawSample();
    return h(
      "div",
      {},
      info(
        ["Glyphes", `${font.glyphs.length} (0-127 communs, 128-255 page 0, 256-383 page 1)`],
        ["Langue → page", strings.languages.map((name, i) => `${name}:${strings.glyphPages[i]}`).join(" ")],
      ),
      section(
        "Texte d'essai (renderText)",
        h(
          "div",
          { class: "bar" },
          input,
          select(
            "page",
            [
              [0, "page 0"],
              [1, "page 1"],
            ],
            0,
            (value) => {
              page = value;
              drawSample();
            },
          ),
        ),
        sample,
      ),
      section("Planche des glyphes", canvas),
    );
  };
  return h(
    "div",
    {},
    info(["Blocs", `${FONT_GLYPHS_BLOCK} (glyphes), ${FONT_WIDTHS_BLOCK} (avances)`]),
    lookView(v.sources, { source: v.preferred, bg: 0 }, sheetBuild),
  );
}

function spritesView(v: View, id: number, zoom: number, thumb: number): HTMLElement {
  const sprites = parseRleSprites(v.bd.get(id));
  return h("div", {}, info(["Sprites RLE", sprites.length]), lookView(v.sources, { source: v.preferred, bg: 0 }, (look) => framesView(spriteFrames(sprites, v.blend, look), { zoom, thumb })));
}

function gaugeView(v: View): HTMLElement {
  const frames = parseGauge(v.bd.get(GAUGE_BLOCK));
  return h(
    "div",
    {},
    info(["Images", `${frames.length} de ${GAUGE_WIDTH}×${GAUGE_HEIGHT}`]),
    lookView(v.sources, { source: v.preferred, bg: 0 }, (look) =>
      framesView(
        frames.map((f) => toFrame(GAUGE_WIDTH, GAUGE_HEIGHT, f, (row) => (row === 0xf0 ? 0 : look.lut[v.blend[(row << 8) | look.bg]!]!))),
        { zoom: 4, thumb: 1 },
      ),
    ),
  );
}

/** Blocs 504 à 506 : octets = lignes de la table de teintes 109 du niveau, 0 = transparent. */
function tintedView(v: View, id: number): HTMLElement {
  if (!v.level) return h("div", {}, h("p", { class: "error" }, "TERRAN00.SLV indisponible : table 109 et palette du niveau nécessaires."));
  const level = v.level;
  const parse = id === TEXTURES_BLOCK ? parseTextures : id === SPRITES_21X35_BLOCK ? parseSprites21x35 : parseSprites29x40;
  const size = id === TEXTURES_BLOCK ? [64, 64] : id === SPRITES_21X35_BLOCK ? [21, 35] : [29, 40];
  const images = parse(v.bd.get(id));
  const sources: PaletteSource[] = [{ name: "niveau (11003)", palette: level.palette }, ...v.sources];
  return h(
    "div",
    {},
    info(["Images", `${images.length} de ${size[0]}×${size[1]}`], ["Couleur", "palette[table109[ligne × 256 + fond]] ; ligne 0 = transparent"]),
    lookView(sources, { source: 0, bg: 0 }, (look) =>
      framesView(
        images.map((px) => toFrame(size[0]!, size[1]!, px, (row) => (row === 0 ? 0 : look.lut[level.lightTable109[row * 256 + look.bg]!]!))),
        { zoom: id === TEXTURES_BLOCK ? 3 : 5, thumb: id === TEXTURES_BLOCK ? 1 : 2 },
      ),
    ),
  );
}

function screenView(v: View, id: number): HTMLElement {
  const screen = parseScreen(v.bd.get(id));
  return h(
    "div",
    {},
    info(["Taille", `${SCREEN_WIDTH}×${SCREEN_HEIGHT} pixels, affichés ici en pixels carrés ×2`], ["Table du bloc", "8192 octets, usage inconnu (hexadécimal ci-dessous)"]),
    h("div", { class: "layers" }, h("figure", {}, indexedCanvas(screen.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, screen.palette, 2), h("figcaption", {}, "image")), h("figure", {}, paletteSwatch(screen.palette), h("figcaption", {}, "palette"))),
    section("Table de 8192 octets (32 lignes de 256)", greyCanvas(screen.table, 256, 32, 2)),
    h("details", { class: "resource" }, h("summary", {}, "Hexadécimal de la table"), h("pre", {}, hexDump(screen.table, 512))),
  );
}

function vectorFontView(v: View): HTMLElement {
  const font = parseVectorFont(v.bd.get(VECTOR_FONT_BLOCK));
  const indices = [...font.glyphs.keys()];
  const charOf = (i: number): string => (i >= 33 && i < 127 ? String.fromCharCode(i) : "");
  const preview = h("div", {});
  const show = (index: number): void => {
    const glyph = font.glyphs.get(index)!;
    const vertices = Array.from({ length: glyph.vertices.length / 3 }, (_, i) => ({ x: glyph.vertices[i * 3]!, y: glyph.vertices[i * 3 + 1]!, z: glyph.vertices[i * 3 + 2]! }));
    const faces = Array.from({ length: glyph.triangles.length / 4 }, (_, i) => ({
      indices: [glyph.triangles[i * 4]!, glyph.triangles[i * 4 + 1]!, glyph.triangles[i * 4 + 2]!] as [number, number, number],
      doubleSided: true,
      color: 0xd8dae0,
    }));
    preview.replaceChildren(createMeshPreview({ vertices, faces }, { size: 360, view: { yaw: 0.35, pitch: 0.2 } }).element);
  };
  const choice = select(
    "glyphe",
    indices.map((i) => [i, `${i}${charOf(i) ? ` « ${charOf(i)} »` : ""}`] as [number, string]),
    indices.includes(65) ? 65 : indices[0]!,
    show,
  );
  if (indices.length > 0) show(indices.includes(65) ? 65 : indices[0]!);
  return h(
    "div",
    {},
    info(["Glyphes renseignés", indices.length], ["Normales partagées", font.normals.length / 3]),
    section("Aperçu", h("div", { class: "bar" }, choice), preview),
    section(
      "Table",
      table(
        ["index", "car.", "largeur", "sommets", "triangles"],
        indices.map((i) => {
          const g = font.glyphs.get(i)!;
          return [i, charOf(i), g.width, g.vertices.length / 3, g.triangles.length / 4];
        }),
        ["num", "", "num", "num", "num"],
      ),
    ),
  );
}

function describe(e: ScriptElement): string {
  switch (e.kind) {
    case "variable":
      return `variable ${e.variable} ${{ set: "=", max: "max=", min: "min=", add: "+=" }[e.operation]} ${e.value}`;
    case "mission":
      return `début de la mission ${e.index}`;
    case "level":
      return `niveau ${e.name}.SLV`;
    case "tracks":
      return `pistes CD ${e.tracks.join(" ")}`;
    case "video":
      return `vidéo ${e.name}`;
    case "color":
      return `couleur d'ambiance (${e.r}, ${e.g}, ${e.b})`;
    case "complete":
      return "fin de l'aventure livrée (-2)";
    case "end":
      return "fin du script (-1)";
    default:
      return `étiquette ${e.label} : ${e.values.join(" ")}`;
  }
}

function missionsView(v: View): HTMLElement {
  const script = parseMissions(v.bd);
  const strings = parseStrings(v.bd);
  const french = strings.languages.findIndex((name) => name.toLowerCase().startsWith("fran"));
  const nameOfMission = (i: number): string => strings.get(Math.max(0, french), 200, i) ?? "";
  return h(
    "div",
    {},
    info(["Éléments", script.elements.length], ["Missions", script.missions.length], ["Fin de la chaîne jouée (premier -1)", script.chainEnd]),
    section(
      "Missions",
      table(
        ["n°", "nom (table 200)", "niveau", "vidéos", "ambiance", "pistes CD"],
        script.missions.map((m) => [
          m.index,
          nameOfMission(m.index),
          m.level ?? "—",
          m.videos.join(", ") || "—",
          m.color ? h("span", {}, h("span", { class: "chip", style: `background:rgb(${m.color.join(",")})` }), ` ${m.color.join(", ")}`) : "—",
          m.tracks?.join(" ") ?? "—",
        ]),
        ["num"],
      ),
    ),
    section(
      "Éléments",
      table(
        ["#", "sens"],
        script.elements.map((e, i) => [i, describe(e)]),
        ["num"],
      ),
    ),
  );
}

function colorRampView(v: View): HTMLElement {
  const ramp = parseColorRamp(v.bd.get(509));
  const rampsCount = Math.floor(ramp.length / 32);
  const lines: HTMLElement[] = [];
  for (let r = 0; r < rampsCount; r++) {
    const row = h("div", { class: "ramp" });
    for (let i = 0; i < 32; i++) {
      const value = ramp[r * 32 + i]!;
      const a = (value >> 12) & 15;
      const red = ((value >> 8) & 15) * 17;
      const green = ((value >> 4) & 15) * 17;
      const blue = (value & 15) * 17;
      row.append(h("span", { class: "ramp-cell", title: `0x${hex(value, 4)}  a=${a} r=${red} v=${green} b=${blue}`, style: `background:rgba(${red},${green},${blue},${a / 15})` }));
    }
    lines.push(row);
  }
  return h("div", {}, info(["Lecture", "u16 ARGB 4-4-4-4 (hypothèse), rampes de 32 couleurs ; fond en damier = transparence"]), h("div", { class: "alpha-bg" }, ...lines));
}

function cratersView(v: View): HTMLElement {
  const craters = parseCraters(v.bd.get(CRATERS_BLOCK));
  const rows: (string | number)[][] = [];
  craters.forEach((phases, size) =>
    phases.forEach((depths, phase) => {
      const grid = Array.from({ length: 4 }, (_, y) => Array.from(depths.subarray(y * 4, y * 4 + 4), (d) => String(d).padStart(3)).join(" ")).join("\n");
      rows.push([size, phase, grid]);
    }),
  );
  return h("div", {}, info(["Profils", "3 tailles (rayons 10000, 20000, 30000) × 16 phases × 4×4 profondeurs"]), table(["taille", "phase", "profondeurs"], rows, ["num", "num", "text"]));
}

function blendView(v: View): HTMLElement {
  const blend = parseBlendTable(v.bd.get(BLEND_BLOCK));
  return h(
    "div",
    {},
    info(["Lecture", "x = pixel déjà présent, y = numéro de ligne ; valeur = indice de palette obtenu"]),
    lookView(v.sources, { source: v.preferred, bg: 0 }, (look) => indexedCanvas(blend, 256, 256, look.lut, 2)),
  );
}

function rawView(v: View, id: number): HTMLElement {
  const bytes = v.bd.get(id);
  const nodes: Node[] = [h("p", { class: "empty" }, `${bytes.length} octets, structure non décodée`)];
  if (id === 451) nodes.push(greyCanvas(bytes, 256, 384, 2));
  if (id === 500) nodes.push(greyCanvas(bytes, 256, 112, 3));
  nodes.push(h("pre", {}, hexDump(bytes, 512)));
  return h("div", {}, ...nodes);
}

function viewOf(v: View, id: number): HTMLElement {
  if (id === 1 || id === 2) return headerView(v);
  if (id === STRINGS_BLOCK) return stringsView(v);
  if (id === FONT_GLYPHS_BLOCK || id === FONT_WIDTHS_BLOCK) return fontView(v);
  if (id === 501 || id === 510 || id === 511 || id === 512) return spritesView(v, id, id === 510 || id === 512 ? 2 : 4, id === 511 ? 3 : 1);
  if (id === GAUGE_BLOCK) return gaugeView(v);
  if (id === TEXTURES_BLOCK || id === SPRITES_21X35_BLOCK || id === SPRITES_29X40_BLOCK) return tintedView(v, id);
  if ((SCREEN_IDS as readonly number[]).includes(id)) return screenView(v, id);
  if (id === VECTOR_FONT_BLOCK) return vectorFontView(v);
  if (id === MISSIONS_BLOCK) return missionsView(v);
  if (id === 509) return colorRampView(v);
  if (id === CRATERS_BLOCK) return cratersView(v);
  if (id === BLEND_BLOCK) return blendView(v);
  return rawView(v, id);
}

export const globalPanel: Panel = {
  matches: (entry) => nameOf(entry.path) === "GLOBAL.BD",
  async render(ctx: PanelContext) {
    const bd = parseBd(ctx.bytes, "GLOBAL.BD");
    const level = await loadReferenceLevel(ctx);
    const blend = parseBlendTable(bd.get(BLEND_BLOCK));
    const sources: PaletteSource[] = [];
    for (const id of SCREEN_IDS) {
      if (bd.has(id)) sources.push({ name: `écran ${id}`, palette: parseScreen(bd.get(id)).palette });
    }
    if (level) sources.push({ name: "niveau (11003)", palette: level.palette });
    const v: View = { bd, level, sources, blend, preferred: sources.length - 1 };
    const rows: ResourceRow[] = bd.entries.map((e) => ({
      key: String(e.id),
      label: String(e.id),
      size: `${e.size} o`,
      role: ROLES[e.id] ?? "inconnu",
    }));
    return h(
      "div",
      {},
      info(["Ressources", bd.entries.length], ["Pied de répertoire", bd.footer]),
      containerView(rows, (key) => guarded(() => viewOf(v, Number(key))), "100"),
    );
  },
};
