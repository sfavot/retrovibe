/**
 * Logique pure de la visionneuse de ressources de Gabriel Knight (sans DOM, testée) : onglets et listes de ressources,
 * adresse dans l'URL, images des cels (miroir compris), ordre de dessin d'un pic, texte rendu par une police du jeu,
 * filtre des messages, description des sons. Le dessin lui-même est dans `asset-viewer.ts`.
 */
import { encodeCp850 } from "../../../data/cp850";
import type { FontGlyph, Font } from "../data/font";
import { ResourceType, resourceTypeName, SoundDevice, SOUND_CONTROL_CHANNEL } from "../data/ids";
import type { MessageEntry, MessageResource } from "../data/message";
import type { Pic } from "../data/pic";
import type { ResourceIndex } from "../data/resource-map";
import type { Sound } from "../data/sound";
import { decodeViewCel, type View } from "../data/view";
import { viewCelAnchor } from "../render/cel";

// ---------------------------------------------------------------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------------------------------------------------------------

export const TAB_IDS = ["views", "pics", "palettes", "fonts", "messages", "scripts", "sounds", "seq", "audio", "other"] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Types de ressources de `RESOURCE.MAP` que liste chaque onglet (les onglets `seq` et `audio` listent des fichiers). */
export const TAB_RESOURCE_TYPES: Readonly<Record<TabId, readonly number[]>> = {
  views: [ResourceType.View],
  pics: [ResourceType.Pic],
  palettes: [ResourceType.Palette],
  fonts: [ResourceType.Font],
  messages: [ResourceType.Message],
  scripts: [ResourceType.Script],
  sounds: [ResourceType.Sound],
  seq: [],
  audio: [],
  other: [ResourceType.Vocab, ResourceType.Patch, ResourceType.Map, ResourceType.Heap],
};

/** Élément de la liste d'un onglet : `name` va dans l'URL, `note` est la légende grise. */
export interface ListItem {
  readonly name: string;
  readonly note: string;
}

/** Ressources d'un onglet, par numéro ; le nom porte le type quand l'onglet en mêle plusieurs (`vocab.997`). */
export function resourceItems(index: ResourceIndex, tab: TabId): ListItem[] {
  const types = TAB_RESOURCE_TYPES[tab];
  const items: ListItem[] = [];
  for (const type of types) {
    for (const number of index.numbers(type)) {
      const source = index.info(type, number)?.source ?? "";
      const note = source === "RESOURCE.000" ? "" : source;
      items.push({ name: types.length > 1 ? `${resourceTypeName(type)}.${number}` : String(number), note });
    }
  }
  return items;
}

/** Type et numéro que désigne un nom de liste (`12` dans un onglet à un seul type, `vocab.997` sinon). */
export function parseResourceName(tab: TabId, name: string): { type: number; number: number } | undefined {
  const types = TAB_RESOURCE_TYPES[tab];
  const match = /^(?:([a-z0-9]+)\.)?(\d+)$/.exec(name);
  if (!match) return undefined;
  const type = match[1] === undefined ? (types.length === 1 ? types[0] : undefined) : types.find((t) => resourceTypeName(t) === match[1]);
  return type === undefined ? undefined : { type, number: Number(match[2]) };
}

/** Fichiers du manifeste d'un dossier (`SEQ/`, `audio/`), dans l'ordre naturel de leurs noms, sans dossier ni extension. */
export function folderItems(paths: readonly string[], folder: string, extension: string): ListItem[] {
  const prefix = `${folder}/`;
  const suffix = `.${extension}`;
  return paths
    .filter((path) => path.startsWith(prefix) && path.toLowerCase().endsWith(suffix.toLowerCase()) && !path.slice(prefix.length).includes("/"))
    .map((path) => path.slice(prefix.length, path.length - suffix.length))
    .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }))
    .map((name) => ({ name, note: "" }));
}

export interface Location {
  readonly tab: TabId;
  readonly name: string | undefined;
}

/** Lit `#onglet/nom` ; un onglet inconnu donne le premier. */
export function parseLocation(hash: string): Location {
  let text = hash.replace(/^#/, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    /* hash mal formé : lu tel quel */
  }
  const slash = text.indexOf("/");
  const tab = slash < 0 ? text : text.slice(0, slash);
  const name = slash < 0 ? "" : text.slice(slash + 1);
  if (!(TAB_IDS as readonly string[]).includes(tab)) return { tab: TAB_IDS[0], name: undefined };
  return { tab: tab as TabId, name: name || undefined };
}

export function formatLocation(location: Location): string {
  return `#${location.tab}${location.name ? `/${encodeURIComponent(location.name)}` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------------------------------------------

export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /** Indice transparent, ou `undefined`. */
  readonly transparent: number | undefined;
}

/** Retourne une image de gauche à droite. */
export function flipHorizontal(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = pixels[row + width - 1 - x];
  }
  return out;
}

/** Cel d'une vue tel qu'il se dessine : retourné si la boucle est un miroir. */
export function viewCelImage(view: View, loop: number, cel: number): IndexedImage {
  const header = view.loops[loop].cels[cel];
  const pixels = decodeViewCel(view, loop, cel);
  const { width, height } = header;
  return { width, height, pixels: view.loops[loop].mirrored ? flipHorizontal(pixels, width, height) : pixels, transparent: header.skipColor };
}

/** Ce qu'on affiche d'une boucle : ses cels, ou la boucle qu'elle reprend. */
export function describeLoop(view: View, loop: number): { cels: number; source: number | undefined; mirrored: boolean } {
  const { cels, source, mirrored } = view.loops[loop];
  return { cels: cels.length, source, mirrored };
}

/** Boîte qui contient tous les cels d'une boucle posés sur leur point d'ancrage (pour animer sans que l'image saute). */
export function loopBounds(view: View, loop: number): { left: number; top: number; width: number; height: number } {
  const { cels, mirrored } = view.loops[loop];
  let left = 0;
  let top = 0;
  let right = 1;
  let bottom = 1;
  cels.forEach((cel, i) => {
    const { x, y } = celOffset(cel, mirrored);
    left = i === 0 ? x : Math.min(left, x);
    top = i === 0 ? y : Math.min(top, y);
    right = i === 0 ? x + cel.width : Math.max(right, x + cel.width);
    bottom = i === 0 ? y + cel.height : Math.max(bottom, y + cel.height);
  });
  return { left, top, width: right - left, height: bottom - top };
}

/** Coin haut-gauche d'un cel par rapport à sa position : l'opposé de son point d'ancrage, celui du moteur (`render/cel.ts`). */
export function celOffset(header: { width: number; height: number; originX: number; originY: number }, mirrored: boolean): { x: number; y: number } {
  const anchor = viewCelAnchor(header, mirrored);
  return { x: -anchor.x, y: -anchor.y };
}

/** Indices des cels d'un pic dans l'ordre du dessin : priorité croissante, puis ordre du fichier. */
export function picDrawOrder(pic: Pic): number[] {
  return pic.cels.map((_, i) => i).sort((a, b) => pic.cels[a].priority - pic.cels[b].priority || a - b);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Polices
// ---------------------------------------------------------------------------------------------------------------------------------

/** Largeur d'un texte (octets CP850) dans une police ; un glyphe absent ne prend pas de place. */
export function textWidth(font: Font, bytes: Uint8Array): number {
  let width = 0;
  for (const code of bytes) width += font.glyphs[code]?.width ?? 0;
  return width;
}

function blitGlyph(out: Uint8Array, outWidth: number, glyph: FontGlyph, left: number, top: number): void {
  for (let y = 0; y < glyph.height; y++) {
    for (let x = 0; x < glyph.width; x++) {
      if (glyph.pixels[y * glyph.width + x]) out[(top + y) * outWidth + left + x] = 1;
    }
  }
}

/** Texte rendu sur une ligne par une police du jeu : image à deux indices (0 = fond, 1 = encre). */
export function renderText(font: Font, text: string): IndexedImage {
  const bytes = encodeCp850(text);
  const width = Math.max(1, textWidth(font, bytes));
  const height = Math.max(1, font.lineHeight, ...[...bytes].map((code) => font.glyphs[code]?.height ?? 0));
  const pixels = new Uint8Array(width * height);
  let x = 0;
  for (const code of bytes) {
    const glyph = font.glyphs[code];
    if (!glyph) continue;
    blitGlyph(pixels, width, glyph, x, 0);
    x += glyph.width;
  }
  return { width, height, pixels, transparent: undefined };
}

export const GLYPH_SHEET_COLUMNS = 16;

/** Planche de tous les glyphes, seize par ligne, dans des cases de la taille du plus grand ; `cell` donne le pas des cases. */
export function glyphSheet(font: Font): IndexedImage & { cellWidth: number; cellHeight: number } {
  const cellWidth = Math.max(1, ...font.glyphs.map((g) => g.width)) + 1;
  const cellHeight = Math.max(1, font.lineHeight, ...font.glyphs.map((g) => g.height)) + 1;
  const rows = Math.ceil(font.glyphs.length / GLYPH_SHEET_COLUMNS);
  const width = GLYPH_SHEET_COLUMNS * cellWidth;
  const height = Math.max(1, rows * cellHeight);
  const pixels = new Uint8Array(width * height);
  font.glyphs.forEach((glyph, code) => {
    blitGlyph(pixels, width, glyph, (code % GLYPH_SHEET_COLUMNS) * cellWidth, Math.floor(code / GLYPH_SHEET_COLUMNS) * cellHeight);
  });
  return { width, height, pixels, transparent: undefined, cellWidth, cellHeight };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------------------------------------------

export interface MessageFilter {
  /** `undefined` : tous. */
  readonly noun?: number;
  readonly verb?: number;
  /** Texte cherché dans la réplique, sans tenir compte de la casse. */
  readonly text?: string;
}

export function filterMessages(resource: MessageResource, filter: MessageFilter): MessageEntry[] {
  const needle = filter.text?.trim().toLowerCase() ?? "";
  return resource.entries.filter(
    (entry) =>
      (filter.noun === undefined || entry.noun === filter.noun) &&
      (filter.verb === undefined || entry.verb === filter.verb) &&
      (needle === "" || entry.text.toLowerCase().includes(needle)),
  );
}

/** Valeurs distinctes d'un champ, triées (pour les listes déroulantes). */
export function distinctValues(resource: MessageResource, field: "noun" | "verb"): number[] {
  return [...new Set(resource.entries.map((entry) => entry[field]))].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sons
// ---------------------------------------------------------------------------------------------------------------------------------

const DEVICE_NAMES: Readonly<Record<number, string>> = {
  [SoundDevice.AdLib]: "AdLib",
  [SoundDevice.GeneralMidi]: "General MIDI",
  [SoundDevice.Mt32]: "MT-32",
  [SoundDevice.PcSpeaker]: "haut-parleur",
  [SoundDevice.Tandy]: "Tandy",
};

/** Nom d'un périphérique de piste, ou son numéro s'il n'est pas identifié. */
export function deviceName(device: number): string {
  return DEVICE_NAMES[device] ?? `périphérique ${device}`;
}

export interface SoundChannelRow {
  readonly device: number;
  readonly deviceName: string;
  /** Rang du canal dans la piste. */
  readonly index: number;
  readonly midiChannel: number;
  readonly isControl: boolean;
  readonly flags: number;
  readonly voices: number;
  readonly priority: number;
  readonly offset: number;
  readonly size: number;
}

/** Une ligne par canal de chaque piste, dans l'ordre de la ressource. */
export function soundRows(sound: Sound): SoundChannelRow[] {
  return sound.tracks.flatMap((track) =>
    track.channels.map((channel, index) => ({
      device: track.device,
      deviceName: deviceName(track.device),
      index,
      midiChannel: channel.number,
      isControl: channel.number === SOUND_CONTROL_CHANNEL,
      flags: channel.flags,
      voices: channel.voices,
      priority: channel.priority,
      offset: channel.offset,
      size: channel.size,
    })),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Cinématiques
// ---------------------------------------------------------------------------------------------------------------------------------

/** Cadences proposées pour lire une SEQ (images par seconde) ; la cadence d'origine vient de l'appel `ShowMovie`. */
export const SEQ_FRAME_RATES = [5, 10, 15, 30] as const;
export const SEQ_DEFAULT_FRAME_RATE = 10;
