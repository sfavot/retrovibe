/**
 * Dessin d'une image d'animation (`.ANM`) : 44b094 (image, origine, retournements) et 44b548 (commandes d'une image).
 *
 * Un ANM est une suite d'images ; chaque image est un petit programme de dessin (bitmap, rectangle, ligne) posé dans le
 * rectangle {x, y, l, h} de l'image, lui-même placé dans la zone `largeur × hauteur` de l'animation.
 * `flip` (retournement de la pièce) : bit 0 = miroir gauche-droite (X), bit 1 = miroir haut-bas (Y), comme l'argument de 44b094.
 * Un retournement symétrise les positions de l'image dans l'animation (44b094), puis celles de chaque commande dans l'image
 * (44b548). Les retournements propres à une commande bitmap ne changent que ses pixels, pas sa position (voir `CMD_FLIP_*`).
 */
import type { Anm, AnmFrame } from "../data/anm";
import type { RenderAssets } from "./assets";
import { mapColor } from "./palette";
import type { Surface } from "./surface";

export const FLIP_X = 1;
export const FLIP_Y = 2;

/**
 * Retournement d'une commande bitmap de l'ANM (champ `flip`, 0 à 3) : le bit 0 retourne verticalement, le bit 1
 * horizontalement. Établi sur les données : dans PART91.ANM (laser), l'image 1 retourne l'image 3 par ce bit seul et la
 * lentille (16×12) y est placée à y = 42 − 7 − 12 ; PROFESR2 et PROFSPCH retournent la moitié du visage par le bit 1.
 * L'exe XOR ce champ avec le retournement de la pièce (44b548) ; on suppose que son bit 0 est donc la verticale aussi : à
 * confirmer sur une pièce retournée à l'écran (`docs/tim3/graphics.md`).
 */
const CMD_FLIP_Y = 1;
const CMD_FLIP_X = 2;

/** Nombre d'images adressables (+0x0C de l'objet animation) : longueur de la séquence, ou nombre d'images. */
export function imageCount(anm: Anm): number {
  return anm.sequence.length || anm.frames.length;
}

/** Image numéro `i` de l'animation (en passant par la séquence), `null` hors limites. */
export function imageFrame(anm: Anm, i: number): AnmFrame | null {
  if (i < 0 || i >= imageCount(anm)) return null;
  return anm.frames[anm.sequence.length ? anm.sequence[i]! : i] ?? null;
}

/** 44b19c : état qui commence à l'image `i` (0 s'il n'y en a pas, −1 hors limites ou sans états). */
export function stateStart(anm: Anm, i: number): number {
  if (i < 0 || i >= imageCount(anm) || anm.states.length === 0) return -1;
  for (const s of anm.states) {
    if (s.state === 0) return 0;
    if (s.first === i) return s.state;
  }
  return 0;
}

/** 44b094 : dessine l'image `image` de `anm` avec son origine en (x, y). Renvoie faux si l'image n'existe pas. */
export function drawAnmImage(surface: Surface, assets: RenderAssets, anm: Anm, image: number, x: number, y: number, flip = 0): boolean {
  const f = imageFrame(anm, image);
  if (!f) return false;
  const ox = x + (flip & FLIP_X ? anm.width - f.x - f.width : f.x);
  const oy = y + (flip & FLIP_Y ? anm.height - f.y - f.height : f.y);
  drawCommands(surface, assets, anm, f, ox, oy, flip);
  return true;
}

/** 44b548 : commandes d'une image, origine (ox, oy). */
function drawCommands(surface: Surface, assets: RenderAssets, anm: Anm, f: AnmFrame, ox: number, oy: number, flip: number): void {
  const fx = (flip & FLIP_X) !== 0;
  const fy = (flip & FLIP_Y) !== 0;
  for (const c of f.commands) {
    switch (c.op) {
      case "bitmap": {
        const name = anm.images.find((i) => i.id === c.image)?.name;
        const frame = name ? assets.bitmap(name)?.frames[c.frame] : undefined;
        if (!frame) break;
        const x = fx ? f.width - c.x - frame.width : c.x;
        const y = fy ? f.height - c.y - frame.height : c.y;
        surface.blit(frame, ox + x, oy + y, ((c.flip & CMD_FLIP_X) !== 0) !== fx, ((c.flip & CMD_FLIP_Y) !== 0) !== fy);
        break;
      }
      case "rect": {
        const x = fx ? f.width - c.x - c.width : c.x;
        const y = fy ? f.height - c.y - c.height : c.y;
        const fill = mapColor(c.fill & 0xff);
        const edge = mapColor(toSigned(c.color));
        if (c.fill & 0x8000 && fill >= 0) surface.fillRect(ox + x, oy + y, c.width, c.height, fill);
        if (edge >= 0) surface.strokeRect(ox + x, oy + y, c.width, c.height, edge);
        break;
      }
      case "line": {
        const x1 = fx ? f.width - c.x1 : c.x1;
        const x2 = fx ? f.width - c.x2 : c.x2;
        const y1 = fy ? f.height - c.y1 : c.y1;
        const y2 = fy ? f.height - c.y2 : c.y2;
        const color = mapColor(toSigned(c.color));
        if (color >= 0) surface.line(ox + x1, oy + y1, ox + x2, oy + y2, color);
        break;
      }
      default:
        break;
    }
  }
}

function toSigned(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}
