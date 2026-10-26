/**
 * Radar et boussole (`gm_draw_overlay_sw`, `004362b8`, `docs/swiv3d/rules.md` § 7.4) : carte 103 échantillonnée tournée autour du joueur
 * dans un ovale de 64 colonnes, points d'objets, croix d'objectifs, puis cadres RLE 512 (pointeur), 510 (ovale) et 511 (nord).
 *
 * Échelle d'après l'arithmétique de l'exécutable : un point d'objet vaut `Δ >> 13` (24.8) = 1 / 32 unité, tourné par `sin/cos × 256 >> 10`,
 * soit **128 unités monde par pixel** en largeur et ≈ 77 en hauteur (`× 0x1ab >> 8`) ; le fond avance de 2 cellules (128 unités) par colonne.
 */
import type { RleSprite } from "../../data/font";
import { COS, SIN } from "../tables";
import { SCREEN_HEIGHT, SCREEN_WIDTH, wrapDelta } from "../view";
import { blitSprite, putPixel } from "./blit";
import type { HudState, RadarObjective } from "./state";

/** Centre des points d'objets (`0x22`, `0x37`) et des croix d'objectifs (`0x20`, `0x34`). */
const BLIP_ORIGIN = { x: 0x22, y: 0x37 } as const;
const CROSS_ORIGIN = { x: 0x20, y: 0x34 } as const;
/** `dx² + dy² < 600` : rayon de visibilité (≈ 24,5 pixels). */
const RADIUS_SQUARED = 600;

/**
 * Profil ovale du fond (`0048121c`, 3 dwords par colonne dont le premier est recalculé à chaque image) : par colonne,
 * (lignes sautées, lignes tracées). Lu dans `SWIV_WIN.EXE`.
 */
const OVAL: readonly (readonly [number, number])[] = [
  [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [52, 8], [44, 25], [39, 34], [36, 41], [33, 47], [30, 52], [28, 56],
  [26, 60], [25, 63], [23, 67], [22, 69], [20, 72], [19, 74], [18, 77], [17, 79], [16, 80], [16, 81], [15, 83], [14, 84], [14, 85],
  [13, 87], [13, 87], [12, 88], [12, 89], [12, 89], [12, 89], [12, 89], [12, 89], [12, 89], [12, 89], [12, 89], [12, 89], [13, 88],
  [13, 87], [13, 87], [14, 85], [14, 85], [15, 83], [16, 81], [16, 81], [17, 79], [18, 77], [19, 75], [21, 71], [22, 69], [23, 67],
  [25, 63], [26, 61], [28, 57], [31, 52], [33, 47], [36, 41], [39, 35], [44, 25], [52, 9], [0, 0], [0, 0],
];

/** Indice dans la table des couleurs du radar (`005bc158`) d'une classe d'objet, ou -1 : non tracé. */
export function blipColorIndex(kind: number, phase: number): number {
  const cls = kind & 0x787f;
  switch (cls) {
    case 0x001:
      return 0x147f;
    case 0x007:
    case 0x017:
      return 0x047f;
    case 0x041:
      // `004811c0` : {0x17f, 0x17f, 0, 0} selon `+0x18 & 3` (bleu clignotant).
      return (phase & 3) < 2 ? 0x017f : 0;
    case 0x1001:
    case 0x1003:
    case 0x1013:
    case 0x1023:
    case 0x1033:
      return 0x107f;
    default:
      return -1;
  }
}

export interface RadarAssets {
  /** Bloc 103 : 512 × 512 indices de palette. */
  colorMap: Uint8Array;
  /** Table de 8 Ko du bloc 11003 (`005bc158`, octets 0x300 à 0x2300). */
  colors: Uint8Array;
  frames510: RleSprite[];
  frames511: RleSprite[];
  frames512: RleSprite[];
  /** Table de mélange (SLV 108) des cadres RLE. */
  blend: Uint8Array;
}

/** Position d'un point à l'écran par rapport au joueur : décalage tourné (largeur, hauteur déjà étirée), avant tout test de rayon. */
export function radarOffset(
  playerX: number,
  playerZ: number,
  yaw: number,
  x: number,
  z: number,
): { dx: number; dy: number; dyScaled: number; inRange: boolean } {
  const a = yaw & 0x1fc;
  const px = Math.floor(wrapDelta(x - playerX) / 32);
  const pz = Math.floor(wrapDelta(z - playerZ) / 32);
  const dx = (px * COS[a]! - SIN[a]! * pz) >> 10;
  const dy = (COS[a]! * pz + px * SIN[a]!) >> 10;
  return { dx, dy, dyScaled: (dy * 0x1ab) >> 8, inRange: dx * dx + dy * dy < RADIUS_SQUARED };
}

/** Fond : 64 colonnes de la carte 103 tournée autour du joueur (replique l'arithmétique 16/16 bits de l'exécutable). */
function drawBackground(fb: Uint8Array, colorMap: Uint8Array, playerX: number, playerZ: number, yaw: number): void {
  const a = yaw & 0x1fc;
  const sin = SIN[a]!;
  const cos = COS[a]!;
  const stepU = (sin * -0x9a) >> 8;
  const stepV = (cos * -0x9a) >> 8;
  const startU = stepU * -0x37 + Math.floor(playerX * 2);
  const startV = stepV * -0x37 + Math.floor(playerZ * 2);
  const step = (Math.imul(stepV, 0x10000) + (stepU & 0xffff)) | 0;
  for (let column = 0; column < 64; column++) {
    const [skip, count] = OVAL[column]!;
    if (count === 0) continue;
    const u = startU + -cos * (0x22 - column);
    const v = startV + sin * (0x22 - column);
    let walk = ((u & 0xffff) + Math.imul(v, 0x10000)) | 0;
    for (let row = 0; row < skip; row++) walk = (walk + step) | 0;
    for (let row = 0; row < count; row++) {
      walk = (walk + step) | 0;
      const w = walk >>> 0;
      const mapRow = (w >>> 23) & 0x1ff;
      const mapColumn = (w & 0xff80) >> 7;
      const y = skip + row;
      if (y < SCREEN_HEIGHT) fb[y * SCREEN_WIDTH + column] = colorMap[(mapRow << 9) | mapColumn]!;
    }
  }
}

/** Direction du pointeur d'objectif : 5 essais autour de l'angle courant, on garde celui qui maximise le produit scalaire (`004362b8`). */
export function stepPointer(pointer: number, radar: HudState["radar"]): number {
  const head = radar.objectives?.[0];
  if (!head) return (pointer + 8) & 0x1ff;
  const dx = Math.floor(wrapDelta(head.x - radar.playerX));
  const dz = Math.floor(wrapDelta(head.z - radar.playerZ));
  const trials = [0, -4, 4, -0xaa, 0xaa];
  let best = -99999999;
  let next = pointer;
  trials.forEach((delta, i) => {
    const angle = pointer + delta;
    const score = dx * SIN[angle & 0x1ff]! + COS[angle & 0x1ff]! * dz;
    if (best < score) {
      next = i === 3 ? angle + 0xa2 : i === 4 ? angle - 0xa2 : angle;
      best = score;
    }
  });
  return next & 0x1ff;
}

function drawObjectives(fb: Uint8Array, a: RadarAssets, radar: HudState["radar"], objectives: readonly RadarObjective[]): void {
  for (const o of objectives) {
    const p = radarOffset(radar.playerX, radar.playerZ, radar.playerYaw, o.x, o.z);
    if (!p.inRange) continue;
    const color = a.colors[o.current ? 0x107f : 0x017f]!;
    const cx = CROSS_ORIGIN.x + p.dx;
    const cy = CROSS_ORIGIN.y - p.dyScaled;
    for (const [px, py] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
      putPixel(fb, px, py, color);
      putPixel(fb, px, py - 1, color);
    }
  }
}

/** Dessine le radar ; `pointer` est l'angle du pointeur d'objectif (état conservé par le HUD, 512 pas par tour). */
export function drawRadar(fb: Uint8Array, a: RadarAssets, radar: HudState["radar"], pointer: number, tick: number): void {
  drawBackground(fb, a.colorMap, radar.playerX, radar.playerZ, radar.playerYaw);

  for (const blip of radar.blips) {
    const index = blipColorIndex(blip.kind, tick >> 2);
    if (index < 0) continue;
    const p = radarOffset(radar.playerX, radar.playerZ, radar.playerYaw, blip.x, blip.z);
    if (!p.inRange) continue;
    const color = a.colors[index]!;
    putPixel(fb, BLIP_ORIGIN.x + p.dx, BLIP_ORIGIN.y - p.dyScaled, color);
    putPixel(fb, BLIP_ORIGIN.x + p.dx, BLIP_ORIGIN.y - p.dyScaled - 1, color);
  }
  if (radar.objectives) drawObjectives(fb, a, radar, radar.objectives);

  const yaw = radar.playerYaw & 0x1fc;
  const north = (-yaw >> 2) & 0x7f;
  const pointerFrame = (-(yaw - pointer) >> 2) & 0x7f;
  blitSprite(fb, a.blend, a.frames512[pointerFrame]!, 0, 0);
  blitSprite(fb, a.blend, a.frames510[north & 0x1f]!, 0, 0);
  blitSprite(fb, a.blend, a.frames511[north]!, 0, 0);
}
