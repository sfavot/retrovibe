/**
 * Frontière du certificat avec le navigateur : le téléchargement (`CertificatePort`, à brancher par l'hôte) et l'environnement de dessin
 * (canevas et polices). `createBrowserCertificateEnvironment()` est l'implémentation par défaut (`FontFace`, canevas du document).
 */
import type { WmfContext } from "./wmf";

/** Remet l'image du certificat au joueur (navigateur : lien `download` sur une URL d'objet). */
export interface CertificatePort {
  download(blob: Blob, filename: string): void;
}

/** Sous-ensemble de `CanvasRenderingContext2D` utilisé pour la composition (WMF et texte). */
export interface CertificateContext extends WmfContext {
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface CertificateCanvas {
  getContext(type: "2d"): CertificateContext | null;
  /** Encode le canevas en PNG. */
  toPng(): Promise<Blob>;
}

export interface CertificateEnvironment {
  createCanvas(width: number, height: number): CertificateCanvas;
  /** Rend une police TrueType utilisable par le canevas sous le nom de famille `family` (`FontFace`). */
  loadFont(family: string, data: Uint8Array): Promise<void>;
}

/** Environnement du navigateur : canevas du document (ou `OffscreenCanvas` hors page), polices par `FontFace` ajoutées à `document.fonts`. */
export function createBrowserCertificateEnvironment(): CertificateEnvironment {
  return {
    createCanvas(width, height) {
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return {
          getContext: (type) => canvas.getContext(type),
          toPng: () =>
            new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("certificat : encodage PNG impossible"))), "image/png");
            }),
        };
      }
      const canvas = new OffscreenCanvas(width, height);
      return {
        getContext: (type) => canvas.getContext(type) as OffscreenCanvasRenderingContext2D | null,
        toPng: () => canvas.convertToBlob({ type: "image/png" }),
      };
    },
    async loadFont(family, data) {
      const face = new FontFace(family, data.slice().buffer);
      await face.load();
      const fonts = typeof document !== "undefined" ? document.fonts : (self as unknown as { fonts: FontFaceSet }).fonts;
      fonts.add(face);
    },
  };
}
