/**
 * Ressources du rendu : images (`.BMP`), animations (`.ANM`) et polices lues à la demande dans l'index de ressources, avec cache.
 * Sans navigateur : les tests et la page de dev utilisent la même classe.
 */
import { type Anm, readAnm } from "../data/anm";
import { type Bitmap, type BitmapFrame, readBitmap } from "../data/bitmap";
import { type Font, readFnt, readPft } from "../data/font";
import { readPalette } from "../data/palette";
import { GAME_PALETTE, fadeTable, readGameLut } from "./palette";
import type { ResourceIndex } from "../data/volume";

export class RenderAssets {
  private readonly bitmaps = new Map<string, Bitmap | null>();
  private readonly anms = new Map<string, Anm | null>();
  private readonly fonts = new Map<string, Font | null>();
  private icons: BitmapFrame[] | undefined;
  private lut: Uint32Array | undefined;
  private fade: Uint8Array | undefined;

  constructor(readonly index: ResourceIndex) {}

  /** Image `.BMP` (nom avec ou sans extension, casse indifférente), `null` si elle n'existe pas. */
  bitmap(name: string): Bitmap | null {
    const key = name.toUpperCase();
    let b = this.bitmaps.get(key);
    if (b === undefined) {
      b = this.index.has(key) ? readBitmap(this.index.get(key)) : null;
      this.bitmaps.set(key, b);
    }
    return b;
  }

  /** Animation `.ANM` par nom de ressource (`WTOOLBAR.ANM`). */
  anm(name: string): Anm | null {
    const key = name.toUpperCase();
    let a = this.anms.get(key);
    if (a === undefined) {
      a = this.index.has(key) ? readAnm(this.index.get(key)) : null;
      this.anms.set(key, a);
    }
    return a;
  }

  /** Animation d'un type de pièce (`PART<n>.ANM`). */
  partAnm(type: number): Anm | null {
    return this.anm(`PART${type}.ANM`);
  }

  /**
   * 4171c9 : icône du bac d'un type de pièce. Les images de `ICONS1.BMP` … `ICONS10.BMP` se suivent (281 en tout, une par
   * type, dans l'ordre des types) ; un numéro au-delà donne la première. Ce n'est pas une image de `PART<n>.ANM` : la
   * courroie (8) n'en a aucune, la corde (49) et le type 127 n'ont pas d'ANM.
   */
  binIcon(type: number): BitmapFrame | null {
    if (!this.icons) {
      this.icons = [];
      for (let i = 1; i <= 10; i++) this.icons.push(...(this.bitmap(`ICONS${i}.BMP`)?.frames ?? []));
    }
    if (type < 0) return null;
    return this.icons[type] ?? this.icons[0] ?? null;
  }

  /** Police `.FNT` ou `.PFT` par nom de ressource. */
  font(name: string): Font | null {
    const key = name.toUpperCase();
    let f = this.fonts.get(key);
    if (f === undefined) {
      f = this.index.has(key) ? (key.endsWith(".PFT") ? readPft(this.index.get(key)) : readFnt(this.index.get(key))) : null;
      this.fonts.set(key, f);
    }
    return f;
  }

  /** Couleurs atténuées de la palette du jeu (boutons grisés), voir `fadeTable`. */
  fadeTable(): Uint8Array {
    return (this.fade ??= fadeTable(readPalette(this.index.get(GAME_PALETTE))));
  }

  /** Table de 256 couleurs RGBA de la palette du jeu. */
  gameLut(): Uint32Array {
    return (this.lut ??= readGameLut(this.index.get(GAME_PALETTE)));
  }
}
