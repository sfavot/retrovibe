/**
 * Murs (briques, tuyaux, bois, sable, parpaings, gréco-romain, rondins, herbe, prudence, briques jaunes, bord de
 * billard) : un rectangle de la taille posée dans le LEV. Traduit de TIMWIN.EXE 43e8cc, 43e945.
 */
import { computeEdgeAngles } from "../../move";
import { type Part, Polygon } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";

function ensurePoly(p: Part): Polygon {
  p.poly ??= new Polygon(p.vertexCount);
  return p.poly;
}

function setRect(poly: Polygon, x0: number, y0: number, x1: number, y1: number): void {
  poly.x[0] = x0;
  poly.y[0] = y0;
  poly.x[1] = x1;
  poly.y[1] = y0;
  poly.x[2] = x1;
  poly.y[2] = y1;
  poly.x[3] = x0;
  poly.y[3] = y1;
}

/** 43e8cc : rectangle (0, 0) – (largeur − 1, hauteur − 1) de l'image (+0x6C / +0x70). */
function wallReset(_w: World, p: Part): void {
  const poly = ensurePoly(p);
  setRect(poly, 0, 0, (p.frameW - 1) | 0, (p.frameH - 1) | 0);
  computeEdgeAngles(poly, p.vertexCount);
}

/** 43e945 : bord de billard (118) : rectangle rentré de 3 px du côté du tapis, selon l'orientation et le retournement. */
function poolWallReset(_w: World, p: Part): void {
  const poly = ensurePoly(p);
  let x0 = 0;
  let y0 = 0;
  let dx: number;
  let dy: number;
  if (p.frameH > p.frameW) {
    dy = 1;
    if (p.flags10 & 0x20) {
      x0 = 3;
      dx = 1;
    } else dx = 4;
  } else {
    dx = 1;
    if (p.flags10 & 0x20) {
      y0 = 3;
      dy = 1;
    } else dy = 4;
  }
  setRect(poly, x0, y0, (p.frameW - dx) | 0, (p.frameH - dy) | 0);
  computeEdgeAngles(poly, p.vertexCount);
}

export function register(r: HandlerRegistry): void {
  r.register(0x43e8cc, "wall.reset", (w, p) => wallReset(w, p));
  r.register(0x43e945, "poolWall.reset", (w, p) => poolWallReset(w, p));
}
