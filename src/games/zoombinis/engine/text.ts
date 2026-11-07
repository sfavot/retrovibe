/**
 * Texte de Zoombinis (vague G3) : `DrawText` de l'original dans la police TrueType CornerStone, et chaînes `STRL` de `TEXTSTR.MHK`.
 *
 * Original (`docs/zoombinis/engine-ts.md`, section « Texte ») :
 *  - `1018:04a0` crée deux polices par `11b8:1158` -> `CreateFontIndirect` (`11e8:0ee9`) : en français (`DS:5cfc` = 1) hauteurs `LOGFONT` 13 (`DS:9638`) et 16
 *    (`DS:963c`). `11e8:0ee9` passe `lfHeight = -hauteur` (hauteur de caractère), graisse 400, ni italique ni souligné, charset par défaut, qualité par défaut ;
 *  - `11e8:5d70` dessine : `DrawText` avec `DT_WORDBREAK | DT_NOCLIP | DT_EXTERNALLEADING | DT_NOPREFIX` (0xb10) plus `DT_CENTER` ou `DT_RIGHT`. Le centrage
 *    vertical et le bas sont faits à la main sur la hauteur mesurée (`DT_CALCRECT`) ; le dessin est découpé par un rectangle de clip distinct (`param_5`).
 *
 * `installText(engine)` est à appeler après `installServices` (voir `services.ts`) : il ouvre `TEXTSTR.MHK` et enregistre `ZOOMBINIS_TEXT`.
 */
import type { HostFontSpec, HostText } from "../../../engine/mohawk/host";
import type { Archive } from "../../../engine/mohawk/resources";
import { intersectRect, type Rect, type Surface } from "../../../engine/mohawk/graphics/surface";
import { TAG_STRL } from "../../../data/mohawk/mohawk";
import { TEXT_ARCHIVE } from "../data/archives";
import type { ZoombinisEngine } from "./engine";
import { defineService } from "./scene";

export const FONT_FAMILY = "CornerStone";
/** Nom du fichier de la police dans `original/zoombinis/`. */
export const FONT_FILE = "CORNER.TTF";

/** Polices du jeu : `lfHeight` -13 et -16 (hauteur de caractère, `11e8:0ee9` nie la hauteur reçue). */
export const FONTS = {
  small: { family: FONT_FAMILY, height: -13 },
  large: { family: FONT_FAMILY, height: -16 },
} as const satisfies Record<string, HostFontSpec>;

export type FontName = keyof typeof FONTS;

/**
 * Drapeaux de `11e8:5d70` (`param_4`), à combiner par OU. Sans drapeau : aligné à gauche, en haut. Les trois premiers valent
 * respectivement `DT_CENTER` (bit 1), `DT_RIGHT` (bit 2) ; le centrage vertical (0x20) et le bas (0x40) sont calculés à la main par le jeu.
 */
export const TextFlags = {
  center: 0x02,
  right: 0x04,
  vcenter: 0x20,
  bottom: 0x40,
} as const;

/** Chaîne rastérisée gardée en cache (clé : police + texte), pour ne pas repasser par le canvas à chaque image. */
const CACHE_LIMIT = 256;

export interface TextLayout {
  /** Lignes après retour à la ligne (espaces de fin retirés). */
  lines: string[];
  /** Largeur de la plus large ligne. */
  width: number;
  /** `lignes × hauteur de ligne`. */
  height: number;
  lineHeight: number;
}

/** Chaînes `STRL` de `TEXTSTR.MHK` (Mac Roman décodé par l'archive), index 1-based comme `FUN_1010:0000`. */
export class TextStrings {
  constructor(private readonly archive: Archive) {}

  /** Identifiants des `STRL` de l'archive. */
  get ids(): number[] {
    return this.archive.ids(TAG_STRL);
  }

  /** Toute la liste `id` (index 0-based) ; lève si elle n'existe pas. */
  list(id: number): readonly string[] {
    return this.archive.strl(id);
  }

  /** Chaîne `index` (1-based) de la liste `id` ; `null` si l'index est 0 ou dépasse la liste (comportement de `FUN_1010:0000`). */
  get(id: number, index: number): string | null {
    const list = this.archive.strl(id);
    return index >= 1 && index <= list.length ? list[index - 1]! : null;
  }
}

/** `DrawText` dans une `Surface`, avec les deux polices du jeu. */
export class ZoombinisText {
  private readonly cache = new Map<string, ReturnType<HostText["rasterize"]>>();

  constructor(
    private readonly text: HostText,
    readonly strings: TextStrings,
  ) {}

  /** Largeur d'une ligne (sans retour à la ligne). */
  measure(font: FontName, text: string): number {
    return this.text.measure(FONTS[font], text);
  }

  /** Hauteur d'une ligne de la police. */
  lineHeight(font: FontName): number {
    return this.text.metrics(FONTS[font]).lineHeight;
  }

  /**
   * Mise en page de `DT_WORDBREAK` dans une largeur `width` : retours à la ligne explicites (`\n`, `\r\n`), puis coupure aux espaces
   * quand la ligne dépasse ; un mot plus large que la largeur est coupé entre deux caractères, comme GDI. Équivaut à `DT_CALCRECT`.
   */
  layout(font: FontName, text: string, width: number): TextLayout {
    const spec = FONTS[font];
    const lineHeight = this.text.metrics(spec).lineHeight;
    const lines: string[] = [];
    for (const paragraph of text.split(/\r\n|\r|\n/)) this.wrap(spec, paragraph, width, lines);
    const widest = Math.max(0, ...lines.map((line) => this.text.measure(spec, line)));
    return { lines, width: widest, height: lines.length * lineHeight, lineHeight };
  }

  /**
   * Dessine `text` dans `rect` avec l'index de palette `color` (fond transparent). `flags` : `TextFlags`. Le texte n'est pas coupé par `rect`
   * (`DT_NOCLIP`) mais par `clip` s'il est donné, puis par la découpe de la surface. Renvoie la mise en page utilisée.
   */
  drawText(surface: Surface, font: FontName, text: string, rect: Rect, flags: number, color: number, clip?: Rect): TextLayout {
    const spec = FONTS[font];
    const layout = this.layout(font, text, rect.w);
    // Position verticale de `11e8:5d70` : centre = milieu du rectangle moins la moitié de la hauteur (décalages entiers), bas = bord bas moins la hauteur.
    let top = rect.y;
    if (flags & TextFlags.bottom) top = rect.y + rect.h - layout.height;
    else if (flags & TextFlags.vcenter) top = (rect.h >> 1) + rect.y - (layout.height >> 1);
    if (clip) surface.pushClip(clip);
    try {
      layout.lines.forEach((line, row) => {
        const width = this.text.measure(spec, line);
        let left = rect.x;
        if (flags & TextFlags.right) left = rect.x + rect.w - width;
        else if (flags & TextFlags.center) left = rect.x + Math.floor((rect.w - width) / 2);
        this.blit(surface, spec, line, left, top + row * layout.lineHeight, color);
      });
    } finally {
      if (clip) surface.popClip();
    }
    return layout;
  }

  private wrap(spec: HostFontSpec, paragraph: string, width: number, out: string[]): void {
    const fits = (line: string) => this.text.measure(spec, line) <= width;
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (fits(candidate) || (line === "" && word === "")) {
        line = candidate;
        continue;
      }
      if (line !== "") out.push(line);
      line = word;
      // Mot seul trop large : coupure entre deux caractères.
      while (!fits(line) && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && !fits(line.slice(0, cut))) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }

  private blit(surface: Surface, spec: HostFontSpec, line: string, x: number, y: number, color: number): void {
    if (line === "") return;
    const key = `${spec.height}\0${line}`;
    let mask = this.cache.get(key);
    if (!mask) {
      mask = this.text.rasterize(spec, line);
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, mask);
    }
    const area = intersectRect({ x, y, w: mask.width, h: mask.height }, surface.clip);
    for (let py = area.y; py < area.y + area.h; py++) {
      for (let px = area.x; px < area.x + area.w; px++) {
        if (mask.bits[(py - y) * mask.width + (px - x)] === 1 && surface.visible(px, py)) surface.pixels[py * surface.width + px] = color;
      }
    }
  }
}

export const ZOOMBINIS_TEXT = defineService<ZoombinisText>("zoombinis.text");

/**
 * Ouvre `TEXTSTR.MHK` (portée `persistent`, `STRL` décodées une fois) et enregistre `ZOOMBINIS_TEXT`.
 * Lève si l'hôte n'a pas de texte (`host.text`) : la police se charge avant le démarrage (`ui/browser-host.ts`).
 */
export async function installText(engine: ZoombinisEngine): Promise<ZoombinisText> {
  const { ctx } = engine;
  const hostText = ctx.host.text;
  if (!hostText) throw new Error("L'hôte n'a pas de texte (host.text) : charger CORNER.TTF avant le démarrage");
  const archive = await ctx.resources.open(TEXT_ARCHIVE, "persistent");
  const text = new ZoombinisText(hostText, new TextStrings(archive));
  engine.services.provide(ZOOMBINIS_TEXT, text);
  return text;
}
