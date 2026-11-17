import { decodeCp437, encodeCp437 } from "../../../data/cp437";
import { extensionOf, baseName } from "../data/files";
import { MutFlag, parseMut, parsePrc } from "../data/mut";
import { parseDescription, parseKeyedTexts } from "../data/text";
import { h, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import type { Panel } from "../../../ui/asset-viewer/viewer";
import {
  hy8Panel,
  info,
  loadPalette,
  palPanel,
  pfnPanel,
  picturePanel,
  rawPanel,
  section,
  soundPanel,
  videoPanel,
  type Render,
} from "../../../engine/infogrames/ui/panels";
import { indexedCanvas, paletteTable } from "../../../engine/infogrames/ui/render";
import { muxClip } from "../../../engine/infogrames/video";

/**
 * Panneaux de la visionneuse du Téléportaschtroumpf : ceux des formats du moteur commun
 * (`src/engine/infogrames/ui/panels.ts`), plus les formats propres au jeu (MUT, PRC, textes).
 */

function dir(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/** Vidéo MUX d'origine : le son est dans les blocs du fichier. */
const muxPanel = videoPanel((ctx) => ({ clip: () => muxClip(ctx.bytes) }));

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

const BY_EXTENSION: Record<string, Render> = {
  MCG: picturePanel,
  PAL: palPanel,
  HY8: hy8Panel,
  MUX: muxPanel,
  MP3: soundPanel,
  PFN: pfnPanel("Schtroumpf à la Une ! 0123456789", encodeCp437),
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
