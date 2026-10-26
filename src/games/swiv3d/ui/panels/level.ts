/** Panneau des niveaux `*.SLV` : vue de dessus composite, cartes, objets, atlas, palettes et navigateur de modèles 3D. */
import { h, hexDump, paletteSwatch } from "../../../../ui/asset-viewer/helpers";
import type { Panel, PanelContext } from "../../../../ui/asset-viewer/viewer";
import { makeCanvas, paletteToLut } from "../../../../ui/indexed-canvas";
import { parseBd, type BdArchive } from "../../data/bd";
import {
  MAP_SIZE,
  OBJECT_PARAM_COUNT,
  UNITS_PER_CELL,
  WATER_THRESHOLD,
  parseLevel,
  type Level,
  type Tileset,
} from "../../data/level";
import { listModels, parseModel, type Model } from "../../data/model";
import { createMeshPreview, type PreviewFace, type PreviewTexture } from "../model-preview";
import {
  containerView,
  filterTable,
  greyCanvas,
  guarded,
  indexedCanvas,
  info,
  section,
  select,
  table,
  type Cell,
  type ResourceRow,
} from "./common";
import { nameOf } from "./shared";

/** Origine de la palette appliquée aux pixels d'un atlas (voir le verdict dans le rapport / `docs/swiv3d/slv.md`). */
type PaletteMode = "tail" | "line100" | "direct";

const PALETTE_MODES: [PaletteMode, string][] = [
  ["tail", "queue du bloc 12xxx (RVB 8 bits)"],
  ["line100", "11003 via la ligne 100 de la table de teintes"],
  ["direct", "11003 direct"],
];

/** Palette RVB 8 bits (768 octets) à appliquer aux pixels d'un atlas. */
function paletteFor(level: Level, tileset: Tileset, mode: PaletteMode): Uint8Array {
  if (mode === "tail") return tileset.palette;
  if (mode === "direct") return level.palette;
  const out = new Uint8Array(768);
  for (let p = 0; p < 256; p++) {
    const q = tileset.lightTable[100 * 256 + p]!;
    out.set(level.palette.subarray(q * 3, q * 3 + 3), p * 3);
  }
  return out;
}

const ROLES: Record<number, string> = {
  100: "hauteur 512×512",
  102: "sol (couleur de terrain) 512×512",
  103: "couleurs précalculées 512×512 (radar)",
  104: "rampes de couleur ? (non lu)",
  105: "objets placés",
  106: "motif 128×128",
  107: "points de passage",
  108: "table de fondu 256×256",
  109: "table de teintes 128 lignes",
  110: "silhouettes d'ombre 256×256",
  500: "table 3×64×64",
  11003: "palette du jeu + table d'attributs",
  11004: "table de débris",
};

/** Indication de classe pour la légende des types d'objets (docs/swiv3d/slv.md). */
function typeClass(type: number): string {
  if (type >= 1000 && type < 1100) return "départ joueur";
  if (type >= 2000 && type < 2100) return "ennemi";
  if (type >= 3000 && type < 3100) return "structure";
  if (type >= 4000 && type < 4100) return "4xxx";
  if (type >= 5000 && type < 5600) return "5xxx";
  if (type >= 6000 && type < 6400) return "6xxx";
  if (type >= 7000 && type < 7100) return "décor / bonus";
  return "";
}

function typeColor(index: number): string {
  return `hsl(${Math.round((index * 137.508) % 360)}, 90%, 58%)`;
}

interface Source {
  name: string;
  bd: BdArchive;
  level: Level;
}

/** Octets d'un tableau 8 bits → canvas gris étalé sur [min, max] réels. */
function stretched(bytes: Uint8Array, width: number, height: number, scale: number): { canvas: HTMLCanvasElement; min: number; max: number } {
  let min = 255;
  let max = 0;
  for (const b of bytes) {
    if (b < min) min = b;
    if (b > max) max = b;
  }
  const mapped = new Uint8Array(bytes.length);
  const span = Math.max(1, max - min);
  for (let i = 0; i < bytes.length; i++) mapped[i] = Math.round(((bytes[i]! - min) * 255) / span);
  return { canvas: greyCanvas(mapped, width, height, scale), min, max };
}

// --- Vue de dessus ------------------------------------------------------------------------------------------------------------

type Base = "ground" | "radar" | "height";

function compositeView(src: Source): HTMLElement {
  const { level } = src;
  const ground = level.tilesets.find((t) => t.id === 12000);
  const settings = { base: (ground ? "ground" : "radar") as Base, shade: true, objects: true, waypoints: false, links: false, mode: "tail" as PaletteMode };
  const hidden = new Set<number>();
  const SCALE = 2;
  const canvas = makeCanvas(MAP_SIZE * SCALE, MAP_SIZE * SCALE);
  const ctx = canvas.getContext("2d")!;
  const baseCanvas = makeCanvas(MAP_SIZE, MAP_SIZE);
  const hover = h("div", { class: "empty" }, "survoler la carte : cellule, hauteur, sol, objets proches");

  const types = [...new Set(level.objects.map((o) => o.type))].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const o of level.objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  const colorOfType = new Map(types.map((t, i) => [t, typeColor(i)]));

  const h8 = (x: number, z: number): number => level.heightmap[(z & (MAP_SIZE - 1)) * MAP_SIZE + (x & (MAP_SIZE - 1))]!;

  function paintBase(): void {
    const image = new ImageData(MAP_SIZE, MAP_SIZE);
    const out = new Uint32Array(image.data.buffer);
    const lutRadar = paletteToLut(level.palette);
    const rgbOf = settings.base === "ground" && ground ? paletteFor(level, ground, settings.mode) : level.palette;
    const lutGround = paletteToLut(rgbOf);
    const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    for (let z = 0; z < MAP_SIZE; z++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const i = z * MAP_SIZE + x;
        let color: number;
        if (settings.base === "height") {
          const g = level.heightmap[i]!;
          color = little ? (0xff000000 | (g << 16) | (g << 8) | g) >>> 0 : ((g << 24) | (g << 16) | (g << 8) | 0xff) >>> 0;
        } else if (settings.base === "radar" || !ground) {
          color = lutRadar[level.colorMap[i]!]!;
        } else {
          const row = Math.min(ground.height - 1, level.groundMap[i]! * 2);
          color = lutGround[ground.pixels[row * ground.width + ((3 * x + 5 * z) & 255)]!]!;
        }
        if (settings.shade) {
          const d = h8(x - 1, z) - h8(x + 1, z) + (h8(x, z - 1) - h8(x, z + 1));
          const k = Math.max(0.55, Math.min(1.6, 1 + d * 0.06));
          const bytes = [color & 255, (color >> 8) & 255, (color >> 16) & 255].map((c) => Math.min(255, Math.round(c * k)));
          color = little ? (0xff000000 | (bytes[2]! << 16) | (bytes[1]! << 8) | bytes[0]!) >>> 0 : ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | 0xff) >>> 0;
        }
        out[i] = color;
      }
    }
    baseCanvas.getContext("2d")!.putImageData(image, 0, 0);
  }

  const wrap = (units: number): number => ((Math.floor(units / UNITS_PER_CELL) % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;

  function redraw(): void {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baseCanvas, 0, 0, MAP_SIZE * SCALE, MAP_SIZE * SCALE);
    if (settings.waypoints) {
      ctx.strokeStyle = "rgba(80,255,120,0.55)";
      ctx.fillStyle = "#50ff78";
      if (settings.links) {
        ctx.beginPath();
        level.waypoints.forEach((w, i) => {
          const next = level.waypoints[w.links[1]];
          if (!next || w.links[1] === i) return;
          const ax = wrap(w.x) * SCALE;
          const az = wrap(w.z) * SCALE;
          const bx = wrap(next.x) * SCALE;
          const bz = wrap(next.z) * SCALE;
          if (Math.abs(ax - bx) > MAP_SIZE || Math.abs(az - bz) > MAP_SIZE) return;
          ctx.moveTo(ax, az);
          ctx.lineTo(bx, bz);
        });
        ctx.stroke();
      }
      for (const w of level.waypoints) ctx.fillRect(wrap(w.x) * SCALE - 1, wrap(w.z) * SCALE - 1, 3, 3);
    }
    if (settings.objects) {
      for (const o of level.objects) {
        if (hidden.has(o.type)) continue;
        ctx.fillStyle = colorOfType.get(o.type)!;
        ctx.fillRect(wrap(o.x) * SCALE - 1, wrap(o.z) * SCALE - 1, 4, 4);
      }
    }
  }

  function update(): void {
    paintBase();
    redraw();
  }

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor(((event.clientX - rect.left) / rect.width) * MAP_SIZE);
    const cz = Math.floor(((event.clientY - rect.top) / rect.height) * MAP_SIZE);
    const i = cz * MAP_SIZE + cx;
    const near = level.objects.filter((o) => Math.abs(wrap(o.x) - cx) <= 1 && Math.abs(wrap(o.z) - cz) <= 1).map((o) => o.type);
    const g = level.groundMap[i]!;
    hover.textContent = `cellule (${cx}, ${cz}) · hauteur ${level.heightmap[i]} · sol ${g}${g < WATER_THRESHOLD ? " (eau)" : ""} · couleur ${level.colorMap[i]}${near.length ? ` · objets ${near.join(", ")}` : ""}`;
  });

  const toggle = (label: string, key: "shade" | "objects" | "waypoints" | "links"): HTMLElement => {
    const input = h("input", { type: "checkbox" });
    input.checked = settings[key];
    input.addEventListener("change", () => {
      settings[key] = input.checked;
      update();
    });
    return h("label", { class: "field" }, input, ` ${label}`);
  };

  const baseOptions: [Base, string][] = [
    ["ground", "sol texturé (102 + atlas 12000)"],
    ["radar", "carte radar (103, palette 11003)"],
    ["height", "hauteur (100)"],
  ];
  const bar = h(
    "div",
    { class: "bar" },
    select("fond", ground ? baseOptions : baseOptions.slice(1), settings.base, (value) => {
      settings.base = value;
      update();
    }),
    select("palette du sol", PALETTE_MODES, settings.mode, (value) => {
      settings.mode = value;
      update();
    }),
    toggle("ombrage (pente)", "shade"),
    toggle("objets", "objects"),
    toggle("points de passage", "waypoints"),
    toggle("liens", "links"),
  );

  const legendRows = types.map((type) => {
    const box = h("input", { type: "checkbox", "aria-label": `Type ${type}` });
    box.checked = true;
    box.addEventListener("change", () => {
      if (box.checked) hidden.delete(type);
      else hidden.add(type);
      redraw();
    });
    return [box, h("span", { class: "chip", style: `background:${colorOfType.get(type)!}` }), type, counts.get(type)!, typeClass(type)] as Cell[];
  });
  update();
  return h(
    "div",
    {},
    info(["Objets", level.objects.length], ["Points de passage", level.waypoints.length], ["Échelle", `${UNITS_PER_CELL} unités d'objet par cellule ; carte torique`]),
    bar,
    hover,
    h("div", { class: "layers" }, h("div", { class: "scroll" }, canvas), h("div", {}, h("h3", {}, "Types d'objets"), table(["", "", "type", "nombre", "classe"], legendRows, ["", "", "num", "num", ""]))),
  );
}

// --- Palettes et atlas --------------------------------------------------------------------------------------------------------------

/** Écart moyen (par canal, 0-255) entre deux palettes pour les indices réellement utilisés par un atlas. */
function paletteGap(pixels: Uint8Array, a: Uint8Array, b: Uint8Array, skipZero: boolean): number {
  const used = new Float64Array(256);
  for (const p of pixels) used[p]++;
  let total = 0;
  let weight = 0;
  for (let p = skipZero ? 1 : 0; p < 256; p++) {
    if (!used[p]) continue;
    for (let c = 0; c < 3; c++) total += Math.abs(a[p * 3 + c]! - b[p * 3 + c]!) * used[p]!;
    weight += used[p]! * 3;
  }
  return weight ? total / weight : 0;
}

function palettesView(src: Source): HTMLElement {
  const { level } = src;
  const cells = [
    h("figure", {}, paletteSwatch(level.palette), h("figcaption", {}, "11003 (VGA 6 bits → 8 bits)")),
    ...level.tilesets.map((t) => h("figure", {}, paletteSwatch(t.palette), h("figcaption", {}, `queue ${t.id}`))),
    ...level.tilesets.slice(0, 2).map((t) => h("figure", {}, paletteSwatch(paletteFor(level, t, "line100")), h("figcaption", {}, `11003 via ligne 100 de ${t.id}`))),
  ];
  const gaps = level.tilesets.map((t) => {
    const tail = t.palette;
    const via = paletteFor(level, t, "line100");
    const skip = t.id !== 12000;
    return [
      t.id,
      paletteGap(t.pixels, tail, via, skip).toFixed(1),
      paletteGap(t.pixels, tail, level.palette, skip).toFixed(1),
    ];
  });
  return h(
    "div",
    {},
    info(["Lecture", "chaque atlas est rendu avec sa palette de queue (exacte) ; la palette du jeu 11003 y accède par la ligne 100 de la table de teintes"]),
    h("div", { class: "grid" }, ...cells),
    section(
      "Écart moyen à la palette de queue, par canal (pixels utilisés)",
      table(["atlas", "11003 via ligne 100", "11003 direct"], gaps, ["num", "num", "num"]),
    ),
  );
}

function atlasView(src: Source, tileset: Tileset): HTMLElement {
  const body = h("div", {});
  let mode: PaletteMode = "tail";
  const render = (): void => {
    const palette = paletteFor(src.level, tileset, mode);
    body.replaceChildren(
      h(
        "div",
        { class: "layers" },
        indexedCanvas(tileset.pixels, tileset.width, tileset.height, palette, 2, tileset.id === 12000 ? undefined : 0),
        h("figure", {}, paletteSwatch(palette), h("figcaption", {}, "palette utilisée")),
      ),
    );
  };
  render();
  return h(
    "div",
    {},
    info(
      ["Taille", `${tileset.width}×${tileset.height}${tileset.id === 12000 ? " (sol)" : " (4×4 tuiles de 64×64 : textures des modèles)"}`],
      ["Table de teintes", `${tileset.lightTable.length} octets`],
      ["Reste après la palette", `${tileset.trailer.length} octets`],
    ),
    h("div", { class: "bar" }, select("palette", PALETTE_MODES, mode, (value) => {
      mode = value;
      render();
    })),
    body,
  );
}

// --- Modèles -----------------------------------------------------------------------------------------------------------------------

const DOUBLE_SIDED_KINDS = new Set([1, 2, 4, 5]);

function modelView(src: Source, model: Model): HTMLElement {
  const body = h("div", {});
  let mode: PaletteMode = "tail";
  let current: ReturnType<typeof createMeshPreview> | null = null;
  const kinds = new Map<number, number>();
  const textures = new Map<number, number>();
  for (const f of model.faces) {
    kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    textures.set(f.texture, (textures.get(f.texture) ?? 0) + 1);
  }

  function textureOf(t: number, kind: number): PreviewTexture | null {
    if (kind === 1 || kind === 5 || kind === 0x28 || t < 0 || t >= 80) return null;
    const tileset = src.level.tilesets.find((ts) => ts.id === 12000 + (t >> 4));
    if (!tileset) return null;
    const palette = paletteFor(src.level, tileset, mode);
    const k = t & 15;
    const base = (k >> 2) * 64 * tileset.width + (k & 3) * 64;
    return {
      sample(u, v) {
        const p = tileset.pixels[base + (v & 63) * tileset.width + (u & 63)]!;
        if (p === 0 && tileset.id !== 12000) return -1;
        return (palette[p * 3]! << 16) | (palette[p * 3 + 1]! << 8) | palette[p * 3 + 2]!;
      },
    };
  }

  function show(): void {
    const faces: PreviewFace[] = model.faces.map((f) => ({
      indices: f.indices,
      u: f.u,
      v: f.v,
      texture: textureOf(f.texture, f.kind),
      doubleSided: DOUBLE_SIDED_KINDS.has(f.kind),
      color: f.kind === 1 ? 0x6aa2ff : f.kind === 0x28 ? 0xc8a050 : 0x9aa1b2,
    }));
    current?.dispose();
    current = createMeshPreview({ vertices: model.vertices, faces }, current ? { view: current.view } : {});
    body.replaceChildren(current.element);
  }
  show();

  return h(
    "div",
    {},
    info(
      ["Emplacement", model.slot],
      ["Sommets / triangles / normales", `${model.vertexCount} / ${model.faceCount} / ${model.normalCount}`],
      ["Rayon² de collision", model.radiusSquared],
      ["Décalage de pose (y)", model.groundOffset],
      ["Lumière ambiante", model.ambient],
      ["Types de rendu", [...kinds].map(([k, n]) => `${k === 0x28 ? "0x28" : k} ×${n}`).join(", ")],
      ["Textures", [...textures.keys()].sort((a, b) => a - b).join(" ")],
    ),
    h("div", { class: "bar" }, select("palette", PALETTE_MODES, mode, (value) => {
      mode = value;
      show();
    })),
    body,
  );
}

// --- Objets et points de passage ------------------------------------------------------------------------------------------------

function objectsView(level: Level): HTMLElement {
  const counts = new Map<number, number>();
  for (const o of level.objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  const headers = ["#", "type", "x", "z", "cap", ...Array.from({ length: OBJECT_PARAM_COUNT }, (_, i) => `c${i + 4}`)];
  return h(
    "div",
    {},
    info(["Objets", level.objects.length]),
    section("Comptes par type", table(["type", "nombre", "classe"], [...counts].sort((a, b) => a[0] - b[0]).map(([t, n]) => [t, n, typeClass(t)]), ["num", "num"])),
    section(
      "Enregistrements",
      filterTable(
        headers,
        level.objects.map((o, i) => ({ key: `${i} ${o.type}`, cells: [i, o.type, o.x, o.z, o.angle, ...o.params] })),
        headers.map(() => "num"),
      ),
    ),
  );
}

function waypointsView(level: Level): HTMLElement {
  return h(
    "div",
    {},
    info(["Nœuds", level.waypoints.length]),
    filterTable(
      ["#", "liens", "x", "z", "indicateurs"],
      level.waypoints.map((w, i) => ({ key: String(i), cells: [i, w.links.join(" "), w.x, w.z, w.flags.join(" ")] })),
      ["num", "", "num", "num"],
    ),
  );
}

// --- Ressource par ressource -----------------------------------------------------------------------------------------------

function viewOf(src: Source, key: string): HTMLElement {
  const { level, bd } = src;
  if (key === "composite") return compositeView(src);
  if (key === "palettes") return palettesView(src);
  const id = Number(key);
  if (id === 100) {
    const { canvas, min, max } = stretched(level.heightmap, MAP_SIZE, MAP_SIZE, 1);
    return h("div", {}, info(["Plage", `${min} à ${max} (gris étalé)`]), canvas);
  }
  if (id === 102) {
    const grey = new Uint8Array(768);
    for (let i = 0; i < 256; i++) grey.fill(i, i * 3, i * 3 + 3);
    for (let i = 0; i < WATER_THRESHOLD; i++) grey.set([30, 70, 220], i * 3);
    return h("div", {}, info(["Lecture", "gris = valeur du sol, bleu = eau (< 0x20)"]), indexedCanvas(level.groundMap, MAP_SIZE, MAP_SIZE, grey, 1));
  }
  if (id === 103) {
    const body = h("div", {});
    const sources: [number, string][] = [[0, "palette 11003"], ...level.tilesets.map((t, i) => [i + 1, `queue ${t.id}`] as [number, string])];
    const draw = (i: number): void => {
      const palette = i === 0 ? level.palette : level.tilesets[i - 1]!.palette;
      body.replaceChildren(indexedCanvas(level.colorMap, MAP_SIZE, MAP_SIZE, palette, 1));
    };
    draw(0);
    return h("div", {}, h("div", { class: "bar" }, select("palette", sources, 0, draw)), body);
  }
  if (id === 105) return objectsView(level);
  if (id === 107) return waypointsView(level);
  if (id === 106) return greyCanvas(level.pattern106, 128, 128, 4);
  if (id === 108) return greyCanvas(level.fadeTable, 256, 256, 2);
  if (id === 109) return greyCanvas(level.lightTable109, 256, 128, 3);
  if (id === 110) return h("div", {}, info(["Lecture", "valeurs 0-31, gris étalé"]), greyCanvas(level.shadowSprites, 256, 256, 2, 31));
  if (id === 500) return greyCanvas(level.table500, 64, 192, 3);
  if (id === 11003) {
    const bytes = bd.get(id);
    return h(
      "div",
      {},
      info(["Taille", `${bytes.length} octets : palette VGA 6 bits (768) puis table de ${bytes.length - 768}`]),
      h("figure", {}, paletteSwatch(level.palette), h("figcaption", {}, "palette")),
      section("Table d'attributs (32 lignes de 256)", greyCanvas(bytes.subarray(768, 768 + 8192), 256, 32, 2)),
    );
  }
  const tileset = level.tilesets.find((t) => t.id === id);
  if (tileset) return atlasView(src, tileset);
  if (id >= 10000 && id <= 10999) return modelView(src, parseModel(bd.get(id), id));
  return h("pre", {}, hexDump(bd.get(id), 512));
}

export const levelPanel: Panel = {
  matches: (entry) => nameOf(entry.path).endsWith(".SLV"),
  render(ctx: PanelContext) {
    const bd = parseBd(ctx.bytes, ctx.path);
    const level = parseLevel(ctx.bytes, ctx.path);
    const src: Source = { name: ctx.path, bd, level };
    const modelIds = new Set(listModels(bd));
    const rows: ResourceRow[] = [
      { key: "composite", label: "Vue de dessus", role: "composite : sol, objets, points de passage" },
      { key: "palettes", label: "Palettes", role: "11003 et queues des atlas" },
      ...bd.entries.map((e): ResourceRow => {
        let role = ROLES[e.id] ?? (Math.floor(e.id / 1000) === 12 ? (e.id === 12000 ? "atlas du sol 256×512" : "atlas de textures de modèles") : "");
        if (modelIds.has(e.id)) {
          try {
            const m = parseModel(bd.get(e.id), e.id);
            role = `modèle · ${m.vertexCount} sommets · ${m.faceCount} faces`;
          } catch {
            role = "modèle illisible";
          }
        }
        return { key: String(e.id), label: String(e.id), size: `${e.size} o`, role: role || "inconnu" };
      }),
    ];
    return h(
      "div",
      {},
      info(["Ressources", bd.entries.length], ["Modèles", modelIds.size], ["Atlas", level.tilesets.map((t) => t.id).join(" ")]),
      containerView(rows, (key) => guarded(() => viewOf(src, key)), "composite"),
    );
  },
};

