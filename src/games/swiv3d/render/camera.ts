/**
 * Caméra et projection (`gm_render_view`, `0042b31c`, `docs/swiv3d/render.md` §4.2-4.3) : base orthonormée en flottants puis
 * vecteurs entiers (droite × `Sx`, haut × `Sy`, avant × 256) ; division perspective par `profondeur + 0x19`.
 */
import { idiv } from "./tables";
import { VIEWPORT, type RenderCamera } from "./view";

/** Projection d'une image : entiers du jeu, prêts pour les produits scalaires du §4.3. */
export interface Projection {
  /** Position de l'œil tronquée (`005774e8`). */
  camX: number;
  camY: number;
  camZ: number;
  /** Droite × `Sx`, haut × `Sy`, avant × 256 (`005775ec`, `005775f8`, `00577618`). */
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  fx: number;
  fy: number;
  fz: number;
  /** Centre de l'écran. */
  cx: number;
  cy: number;
  /** Échelles horizontale (319) et verticale (531 = 5/3 de 319, pixels non carrés). */
  scaleX: number;
  scaleY: number;
  /** Cap horizontal de la caméra × 256 (`00577624/28`) : objets « face caméra ». */
  headX: number;
  headZ: number;
}

type Vec = [number, number, number];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function createProjection(): Projection {
  return { camX: 0, camY: 0, camZ: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0, fx: 0, fy: 0, fz: 0, cx: 0, cy: 0, scaleX: 0, scaleY: 0, headX: 0, headZ: 0 };
}

/** Remplit `out` pour une caméra (rectangle plein écran, zoom 96 = facteur 1). */
export function setupProjection(out: Projection, camera: RenderCamera): Projection {
  const yaw = (2 * Math.PI * camera.yaw) / 512;
  const pitch = (2 * Math.PI * camera.pitch) / 512;
  const bank = Math.max(-0.5, Math.min(0.5, camera.roll ?? 0));

  let f = normalize([Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
  const worldUp: Vec = [0, 1, 0];
  const rightOf = (forward: Vec): Vec => {
    const r = normalize(cross(worldUp, forward));
    r[1] = bank;
    return normalize(r);
  };
  let r = rightOf(f);
  if (Math.abs(f[1]) > 0.9) {
    // Presque à la verticale : le jeu écarte l'avant vers la droite pour garder une base stable.
    f = normalize([f[0] + 0.4 * r[0], f[1] + 0.4 * r[1], f[2] + 0.4 * r[2]]);
    r = rightOf(f);
  }
  const up = normalize(cross(f, r));
  r = normalize(cross(up, f));

  const width = VIEWPORT.right - VIEWPORT.left;
  const zoom = 96;
  const scaleX = ((zoom + 0x20) * width) >> 7;
  const scaleY = ((zoom + 0x20) * idiv(width * 5, 3)) >> 7;
  const t = Math.trunc;

  out.camX = t(camera.x);
  out.camY = t(camera.y);
  out.camZ = t(camera.z);
  out.rx = t(scaleX * r[0]);
  out.ry = t(scaleX * r[1]);
  out.rz = t(scaleX * r[2]);
  out.ux = t(scaleY * up[0]);
  out.uy = t(scaleY * up[1]);
  out.uz = t(scaleY * up[2]);
  out.fx = t(256 * f[0]);
  out.fy = t(256 * f[1]);
  out.fz = t(256 * f[2]);
  out.cx = ((VIEWPORT.right - VIEWPORT.left) >> 1) + VIEWPORT.left;
  out.cy = ((VIEWPORT.bottom - VIEWPORT.clipTop) >> 1) + VIEWPORT.clipTop;
  out.scaleX = scaleX;
  out.scaleY = scaleY;
  const horizontal = Math.hypot(f[0], f[2]) || 1;
  out.headX = t((256 * f[0]) / horizontal);
  out.headZ = t((256 * f[2]) / horizontal);
  return out;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  /** Profondeur `D` (avec le recul de 0x19 unités). Si `D <= 0`, `x` et `y` restent à leurs valeurs précédentes. */
  depth: number;
}

/** Projette un point monde (§4.3) ; `out` est mis à jour sur place. */
export function projectPoint(pr: Projection, x: number, y: number, z: number, out: ProjectedPoint): ProjectedPoint {
  const dx = Math.trunc(x) - pr.camX;
  const dy = Math.trunc(y) - pr.camY;
  const dz = Math.trunc(z) - pr.camZ;
  const sx = dx * pr.rx + dy * pr.ry + dz * pr.rz;
  const sy = dx * pr.ux + dy * pr.uy + dz * pr.uz;
  const depth = ((dx * pr.fx + dy * pr.fy + dz * pr.fz) >> 8) + 0x19;
  if (depth > 0) {
    out.x = idiv(sx, depth) + pr.cx;
    out.y = pr.cy - idiv(sy, depth);
  }
  out.depth = depth;
  return out;
}
