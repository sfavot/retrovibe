/**
 * Dessin du parcours d'entrée (`docs/tim3/ui.md` § Parcours d'entrée), lu dans TIMWIN.EXE :
 *
 * - **Logo** (42a3c2) : `SIERRA.BMP` plein écran à la palette `SIERRA.PAL`, puis les images de `SIERRA.ANM` posées par-dessus.
 *   Les palettes `SIERRA00…17.PAL` ne servent pas : l'exe écrit « 13 » dans le nom `SIERRA##.PAL` (42a3c8) sans jamais le charger.
 * - **Titre** (42a590) : `TITLE.BMP` à la palette `TTLDARK.PAL`, l'image 0 de `TITLE2.ANM` en y = 377 (bande du bas), puis les
 *   images de `TITLE.ANM` ; la palette passe à `TTLLITE.PAL` quand l'image qui ouvre l'état 5 est dessinée (`TTLMED.PAL` est
 *   chargée mais jamais posée).
 * - Les images d'animation se dessinent l'une sur l'autre sans effacer : chacune ne repeint que sa partie de l'écran.
 * - **Crédits** (41a121) : lignes de `CREDITS.RES` qui montent dans la fenêtre `CR_WINDOW` de `CREDITS.ITF`, police `goalfont.PFT`.
 */
import type { Anm } from "../data/anm";
import { readPalette } from "../data/palette";
import type { ResourceIndex } from "../data/volume";
import { imageFrame } from "./anm-draw";
import type { RenderAssets } from "./assets";
import type { Rect } from "./editor-overlay";
import { mapColor, paletteLut } from "./palette";
import type { Surface } from "./surface";
import { drawText, measureText } from "./text";
import type { Font } from "../data/font";

/** Cadence des animations du logo et du titre : 43b6aa(3) avance l'échéance de 3 × 16 ms à chaque image (410fa4). */
export const INTRO_FRAME_MS = 48;

export const LOGO = {
  bitmap: "SIERRA.BMP",
  anm: "SIERRA.ANM",
  palette: "SIERRA.PAL",
  /** Air de Sierra (`SX_3400.WAV`, 41126d(0xD48)) : l'animation n'avance qu'une fois l'air fini (4116f5 : « en cours »). */
  jingle: 0xd48,
} as const;

export const TITLE = {
  bitmap: "TITLE.BMP",
  strip: "TITLE2.ANM",
  /** 44b094(TITLE2, 0, 0, 0x179) : bande du bas sous l'image du titre (377 lignes). */
  stripY: 377,
  anm: "TITLE.ANM",
  dark: "TTLDARK.PAL",
  lite: "TTLLITE.PAL",
  /** État de `TITLE.ANM` dont la première image fait passer à `TTLLITE.PAL` (42a682). */
  liteState: 5,
  /** Images gardées sur la dernière avant la fin (42a6d0 : 0x3C). */
  hold: 60,
  /** Musique lancée avant l'animation (42a60a : 0x3E8), qui continue dans les crédits et le menu principal. */
  music: 1000,
} as const;

/** Table de couleurs d'un écran plein : palette du fichier, index 0 noir opaque (il n'y a rien dessous). */
export function screenLut(index: ResourceIndex, palette: string): Uint32Array {
  const rgba = readPalette(index.get(palette));
  rgba[0] = 0;
  rgba[1] = 0;
  rgba[2] = 0;
  rgba[3] = 255;
  return paletteLut(rgba);
}

/** Copie d'une table de couleurs dont l'index 0 est noir opaque. */
export function opaqueLut(lut: Uint32Array): Uint32Array {
  const out = lut.slice();
  out[0] = paletteLut(Uint8Array.of(0, 0, 0, 255))[0]!;
  return out;
}

/** Image plein écran (première image du `.BMP`) en (0, 0). Faux si elle manque. */
export function drawFullBitmap(surface: Surface, assets: RenderAssets, name: string): boolean {
  const frame = assets.bitmap(name)?.frames[0];
  if (!frame) return false;
  surface.blit(frame, 0, 0);
  return true;
}

/** Son demandé par une image d'animation : `sound` (priorité 1) ou `soundEx` (priorité et drapeaux de la commande), comme la session. */
export interface FrameSound {
  id: number;
  priority: number;
  flags: number;
}

/** Sons des commandes d'une image (44b548 les joue quand l'image est dessinée). */
export function frameSounds(anm: Anm, image: number): FrameSound[] {
  const f = imageFrame(anm, image);
  if (!f) return [];
  const out: FrameSound[] = [];
  for (const c of f.commands) {
    if (c.op === "sound") out.push({ id: c.sound, priority: 1, flags: 0 });
    else if (c.op === "soundEx") out.push({ id: c.sound, priority: c.unknown04, flags: c.unknown06 });
  }
  return out;
}

// ------------------------------------------------------------------ crédits

/**
 * Défilement des crédits (41a0a5, appelé à chaque tour de la fenêtre) : départ à 40 pixels, puis `(ms écoulées × 38) / 1000`
 * pixels par tour, entre 1 et 8 (le premier tour ne fait que noter l'heure, le suivant avance d'un pixel).
 */
export const CREDITS_SCROLL = { start: 40, perSecond: 38, min: 1, max: 8 } as const;

/** Mise en page des lignes (41a121) : hauteur 12, interligne 6 sous un titre « _ », 4 sinon ; soulignement 5 pixels sous la ligne. */
const CREDIT_LINE = 12;
const CREDIT_UNDERLINE = 5;
/** Couleurs logiques selon le fondu (0 : pleine, 3 : fond de la fenêtre), 0x472660, 0x472664, 0x472668. */
const HEADING_COLORS = [14, 10, 2, 9] as const;
const UNDERLINE_COLORS = [11, 3, 3, 9] as const;
const TEXT_COLORS = [15, 11, 3, 9] as const;
/** Fondu : 20 pixels sous le haut, 12 pixels au-dessus du bas, un cran tous les 4 pixels. */
const FADE_TOP = 20;
const FADE_BOTTOM = 12;

/** Pas de défilement d'un tour (41a0a5), `elapsed` en millisecondes depuis le tour précédent (`null` au premier). */
export function creditsStep(elapsed: number | null): number {
  if (elapsed === null) return 0;
  const v = Math.trunc((elapsed * CREDITS_SCROLL.perSecond) / 1000);
  return Math.min(CREDITS_SCROLL.max, Math.max(CREDITS_SCROLL.min, v));
}

/**
 * Lignes de `CREDITS.RES` dans `rect`, la première `scroll` pixels au-dessus du bas. Une ligne qui commence par « _ » est un
 * titre (couleurs de titre, soulignée, interligne 6) ; par « - », un début de titre (couleurs de titre, soulignée, interligne 4) ;
 * le caractère de tête n'est pas dessiné. Renvoie vrai si au moins une ligne est encore visible (sinon la fenêtre se ferme).
 */
export function drawCredits(surface: Surface, font: Font, lines: readonly string[], rect: Rect, scroll: number): boolean {
  const clip = surface.setClip(rect.x, rect.y, rect.width, rect.height);
  const cx = rect.x + Math.trunc(rect.width / 2);
  const bottom = rect.y + rect.height;
  let y = bottom - scroll;
  let drawn = false;
  for (let i = 0; i < lines.length && y < bottom; i++) {
    let text = lines[i]!;
    let fade = 0;
    if (rect.y + FADE_TOP - y >= 0) fade = (rect.y + FADE_TOP - y) >> 2;
    if (y - (bottom - FADE_BOTTOM) >= 0) fade = (y - (bottom - FADE_BOTTOM)) >> 2;
    fade = Math.min(3, fade);
    const kind = (text.startsWith("_") ? 1 : 0) - (text.startsWith("-") ? 1 : 0);
    if (CREDIT_LINE + y >= rect.y) {
      if (kind !== 0) text = text.slice(1);
      const half = Math.trunc((measureText(font, text) + 1) / 2);
      drawText(surface, font, text, cx - half, y, mapColor((kind !== 0 ? HEADING_COLORS : TEXT_COLORS)[fade]!));
      drawn = true;
      if (kind !== 0) {
        const uy = y + CREDIT_LINE + CREDIT_UNDERLINE;
        surface.line(cx - half, uy, cx + half, uy, mapColor(UNDERLINE_COLORS[fade]!));
      }
    }
    y += CREDIT_LINE + (kind > 0 ? 6 : 4);
  }
  surface.restoreClip(clip);
  return drawn;
}
