/**
 * Composition du certificat en image (`1088:0a9f`) : papier blanc, textes (`1088:0b49`), fond `BKG.WMF`, puis un ruban par niveau réussi.
 * Le résultat est un PNG de `CERTIFICATE_IMAGE_WIDTH` × `CERTIFICATE_IMAGE_HEIGHT` px (la page de 10,13 × 7,73 pouces à ~197 ppp).
 *
 * `CertificateRenderer` garde en mémoire les WMF et les polices déjà chargés : un deuxième certificat ne relit rien.
 */
import {
  CERTIFICATE_BACKGROUND_FILE,
  CERTIFICATE_FONT_FILES,
  CERTIFICATE_IMAGE_HEIGHT,
  CERTIFICATE_IMAGE_WIDTH,
  CERTIFICATE_TEXTS,
  PAGE_WIDTH_INCHES,
  certificateText,
  type CertificateData,
  type CertificateFont,
  type CertificateTextSpec,
} from "./certificate-data";
import type { CertificateContext, CertificateEnvironment } from "./port";
import { drawWmf, parseWmf, wmfPhysicalTarget, type Wmf } from "./wmf";

/** Familles utilisées par le canevas (préfixées pour ne pas entrer en conflit avec une police du système). */
export const CERTIFICATE_FONT_FAMILIES: Record<CertificateFont, string> = { market: "MW Market", newZurica: "MW NewZurica" };

/** Lecture d'un fichier du jeu (`Host.loadFile` convient : chemin relatif à `original/mathemagique/`). */
export type LoadFile = (path: string) => Promise<Uint8Array>;

/** Plus petite taille de police (part de la taille nominale) quand un nom trop long est réduit pour tenir dans son rectangle. */
const MIN_FIT = 0.4;

export class CertificateRenderer {
  private readonly wmfs = new Map<string, Promise<Wmf>>();
  private fonts: Promise<void> | null = null;

  constructor(
    private readonly env: CertificateEnvironment,
    private readonly loadFile: LoadFile,
  ) {}

  /** Image PNG du certificat. Rejette si un fichier manque ou si le canevas est indisponible. */
  async render(data: CertificateData): Promise<Blob> {
    const [, background, ribbons] = await Promise.all([this.ensureFonts(), this.wmf(CERTIFICATE_BACKGROUND_FILE), Promise.all(data.ribbonFiles.map((file) => this.wmf(file)))]);
    const width = CERTIFICATE_IMAGE_WIDTH;
    const height = CERTIFICATE_IMAGE_HEIGHT;
    const canvas = this.env.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("certificat : contexte 2D indisponible");
    composeCertificate(ctx, data, background, ribbons, width, height);
    return canvas.toPng();
  }

  private wmf(file: string): Promise<Wmf> {
    let promise = this.wmfs.get(file);
    if (!promise) {
      promise = this.loadFile(file).then(parseWmf);
      promise.catch(() => this.wmfs.delete(file));
      this.wmfs.set(file, promise);
    }
    return promise;
  }

  private ensureFonts(): Promise<void> {
    if (!this.fonts) {
      this.fonts = Promise.all(
        (Object.keys(CERTIFICATE_FONT_FILES) as CertificateFont[]).map(async (font) => {
          const bytes = await this.loadFile(CERTIFICATE_FONT_FILES[font]);
          await this.env.loadFont(CERTIFICATE_FONT_FAMILIES[font], bytes);
        }),
      ).then(() => undefined);
      this.fonts.catch(() => {
        this.fonts = null;
      });
    }
    return this.fonts;
  }
}

/**
 * Dessine le certificat sur `ctx` (`width` × `height` px) : textes, fond, rubans, dans l'ordre de l'original. Chaque WMF occupe sa taille physique
 * (`wmfPhysicalTarget`) depuis le coin de la page ; les positions des textes (pouces) utilisent la même échelle (`width / 10,13 pouces`).
 */
export function composeCertificate(ctx: CertificateContext, data: CertificateData, background: Wmf, ribbons: readonly Wmf[], width: number, height: number): void {
  const pxPerInch = width / PAGE_WIDTH_INCHES;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const spec of CERTIFICATE_TEXTS) drawCertificateText(ctx, spec, certificateText(data, spec.role), pxPerInch);
  drawWmf(ctx, background, wmfPhysicalTarget(background, pxPerInch));
  for (const ribbon of ribbons) drawWmf(ctx, ribbon, wmfPhysicalTarget(ribbon, pxPerInch));
}

function drawCertificateText(ctx: CertificateContext, spec: CertificateTextSpec, text: string, pxPerInch: number): void {
  const family = CERTIFICATE_FONT_FAMILIES[spec.font];
  const maxWidth = (spec.right - spec.left) * pxPerInch;
  let size = Math.round(spec.size * pxPerInch);
  ctx.font = `${size}px "${family}"`;
  const measured = ctx.measureText(text).width;
  // Un nom plus large que son rectangle est réduit pour tenir (l'original ne le précise pas).
  if (measured > maxWidth) {
    size = Math.max(Math.floor(size * MIN_FIT), Math.floor((size * maxWidth) / measured));
    ctx.font = `${size}px "${family}"`;
  }
  ctx.fillText(text, ((spec.left + spec.right) / 2) * pxPerInch, ((spec.top + spec.bottom) / 2) * pxPerInch);
}
