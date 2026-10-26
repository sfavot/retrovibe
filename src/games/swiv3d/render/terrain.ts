/**
 * Terrain (`render.md` §6) : grille de sommets projetés rangée par rangée, tracée en bandes verticales par colonne d'écran, du
 * proche au lointain, avec une ligne d'horizon par colonne pour l'occlusion des objets. Variante « MMX » de `004144fb`
 * (4 mots de 16 bits `[u, v, lumière, couleur]`), la seule du port.
 */
import type { RenderAssets } from "./assets";
import type { Columns } from "./columns";
import type { Projection } from "./camera";
import { COS, RECIP_16, RECIP_FFFF, SIN, WAVE, idiv, normalize256 } from "./tables";
import { SCREEN_WIDTH, VIEWPORT } from "./view";

interface Vertex {
  x: number;
  y: number;
  light: number;
  colour: number;
  depth: number;
  visible: boolean;
}

const newVertex = (): Vertex => ({ x: 0, y: 0, light: 0, colour: 0, depth: 0, visible: false });

/** Directions de rangée : `[pas le long d'une rangée x, z, pas de rangée à rangée x, z]` (`render.md` §6.4). */
const DIRECTIONS = [
  [1, 0, 0, 1],
  [1, -1, 0, 1],
  [0, -1, 1, 0],
  [-1, -1, 1, 0],
  [-1, 0, 0, -1],
  [-1, 1, 0, -1],
  [0, 1, -1, 0],
  [1, 1, -1, 0],
] as const;

const ROW_CAPACITY = 800;
const ROW_CENTER = 400;
/** Garde-fou des boucles de recherche de bornes d'une rangée (le jeu s'arrête sur l'écran). */
const MAX_ROW_STEPS = 600;
const MID_DEPTH = 0x4b0;

const s16 = (a: number): number => (a << 16) >> 16;
/** `PMULHW` puis `PSRLW 15` : produit haut signé 16 bits, +1 si le premier facteur est négatif. */
const mulhw = (a: number, r: number): number => ((a * r) >> 16) + (a < 0 ? 1 : 0);

export class TerrainRenderer {
  private pr!: Projection;
  private fb!: Uint8Array;
  private cols!: Columns;
  private time = 0;
  private waterMode = 3;
  private flash: Int32Array | null = null;
  private stepX = 0;
  private stepZ = 0;

  private readonly v = newVertex();
  private readonly v0 = newVertex();
  private readonly v1 = newVertex();
  private readonly rowSx = new Int32Array(ROW_CAPACITY);
  private readonly rowSz = new Int32Array(ROW_CAPACITY);
  private readonly rowEx = new Int32Array(ROW_CAPACITY);
  private readonly rowEz = new Int32Array(ROW_CAPACITY);
  private clipped = [0, 0, 0, 0];
  private readonly normal = new Int32Array(3);
  /** Pas de l'état de la dernière bande de plus d'une ligne (« obsolète » du jeu, réutilisé pour les bandes d'une ligne). */
  private readonly lastStep = new Int32Array(4);
  private readonly state = new Int32Array(4);
  private readonly step = new Int32Array(4);

  constructor(private readonly assets: RenderAssets) {}

  draw(
    fb: Uint8Array,
    pr: Projection,
    cols: Columns,
    time: number,
    waterMode: number,
    targetX: number,
    targetZ: number,
    flash: Int32Array | null = null,
  ): void {
    this.fb = fb;
    this.flash = flash;
    this.pr = pr;
    this.cols = cols;
    this.time = time;
    this.waterMode = waterMode;
    if (waterMode !== 0) this.animateWater(time);
    this.lastStep.fill(0);
    cols.reset();

    const { first, last } = this.buildRows(targetX, targetZ);
    const rsx = this.stepX;
    const rsz = this.stepZ;
    const { v0, v1 } = this;
    for (let r = first; r < last; r++) {
      let cx = this.rowSx[r]!;
      let cz = this.rowSz[r]!;
      const ex = this.rowEx[r]!;
      const ez = this.rowEz[r]!;
      let excess = 0;
      this.projectLit(cx, cz, v1);
      if (v1.x < VIEWPORT.left) {
        excess = VIEWPORT.left - v1.x;
        v1.x = VIEWPORT.left;
      }
      for (let guard = 0; (cx !== ex || cz !== ez) && guard < MAX_ROW_STEPS; guard++) {
        Object.assign(v0, v1);
        const px = cx;
        const pz = cz;
        cx += rsx;
        cz += rsz;
        this.projectLit(cx, cz, v1);
        if (v1.x < v0.x) v1.x = v0.x;
        const n = Math.abs(v1.x - v0.x) + excess;
        const { state, step } = this;
        state[0] = (px << 12) & 0xffff;
        state[1] = (pz << 12) & 0xffff;
        state[2] = (v0.light << 8) & 0xffff;
        state[3] = (v0.colour << 6) & 0xffff;
        step.fill(0);
        let yAcc = v0.y << 8;
        let yStep = 0;
        if (n > 1) {
          const recip = RECIP_FFFF[n]!;
          yStep = ((v1.y - v0.y) * recip) >> 8;
          step[0] = (((cx - px) * recip) >> 4) & 0xffff;
          step[1] = (((cz - pz) * recip) >> 4) & 0xffff;
          step[2] = (((v1.light - v0.light) * recip) >> 8) & 0xffff;
          step[3] = (((v1.colour - v0.colour) * recip) >> 10) & 0xffff;
          if (excess > 0) {
            yAcc += yStep * excess;
            for (let k = 0; k < 4; k++) state[k] = (state[k]! + step[k]! * excess) & 0xffff;
            excess = 0;
          }
        }
        if (v1.x > VIEWPORT.right) v1.x = VIEWPORT.right + 1;
        this.strip(v0.x, v1.x, Math.max(v0.depth, v1.depth), yAcc, yStep);
      }
    }
  }

  /** Animation de la tuile d'eau (`gm_water_animate`, `00437b64`) : la tuile 0 est recalculée à partir de la tuile 1. */
  private animateWater(frame: number): void {
    const tiles = this.assets.groundTiles;
    const a = new Int32Array(64);
    const b = new Int32Array(64);
    for (let i = 0; i < 64; i++) {
      a[i] = SIN[(9 * frame + 8 * i) & 511]! >> 6;
      b[i] = SIN[(7 * frame + 8 * i) & 511]! >> 6;
    }
    for (let r = 0; r < 64; r++) {
      const ar = a[r]!;
      for (let c = 0; c < 64; c++) tiles[r * 64 + c] = tiles[0x1000 + ((((r + b[c]!) & 63) << 6) | ((ar + c) & 63))]!;
    }
  }

  private waveAt(cx: number, cz: number): number {
    return WAVE[(cz * 4 + this.time + SIN[(cx & 31) * 16]!) & 31]!;
  }

  /** Projection sans éclairage (`gm_terrain_project_flat`, `004268fc`). */
  private projectFlat(cx: number, cz: number, out: Vertex): void {
    const { heightmap, groundMap } = this.assets;
    const index = ((cz & 511) << 9) + (cx & 511);
    let hy = heightmap[index]! << 2;
    if ((this.waterMode & 1) !== 0 && (groundMap[index]! & 0xe0) === 0) hy += this.waveAt(cx, cz);
    this.project((cx << 6), hy, (cz << 6), out);
    out.visible = !(out.x < VIEWPORT.left || out.x > VIEWPORT.right || out.depth > 1999 || out.depth < 0x65);
  }

  private project(wx: number, wy: number, wz: number, out: Vertex): void {
    const pr = this.pr;
    const dx = wx - pr.camX;
    const dy = wy - pr.camY;
    const dz = wz - pr.camZ;
    const depth = ((dx * pr.fx + dy * pr.fy + dz * pr.fz) >> 8) + 0x19;
    if (depth > 0) {
      out.x = idiv(dx * pr.rx + dy * pr.ry + dz * pr.rz, depth) + pr.cx;
      out.y = pr.cy - idiv(dx * pr.ux + dy * pr.uy + dz * pr.uz, depth);
    }
    out.depth = depth;
  }

  /** Projection, éclairage et brouillard d'un sommet (`gm_terrain_project_lit`, `00426c14`). */
  private projectLit(cx: number, cz: number, out: Vertex): void {
    const { heightmap, groundMap } = this.assets;
    const at = (x: number, z: number): number => heightmap[((z & 511) << 9) + (x & 511)]!;
    const normal = this.normal;
    normal[0] = at(cx, cz - 1) - at(cx, cz + 1);
    normal[1] = 0x40;
    normal[2] = at(cx - 1, cz) - at(cx + 1, cz);
    normalize256(normal);
    let light = (Math.imul(normal[1]!, 0x93) - Math.imul(normal[0]!, 0x93) + Math.imul(normal[2]!, 0x93)) >> 9;
    if (light < 0) light = 0;
    light += 0x1e;
    // Éclairs au sol (`005624c8`) : sans plafond ici, la borne [15, 110] du brouillard s'applique après ; l'eau les écrase.
    if (this.flash) light += this.flash[((cz & 63) << 6) + (cx & 63)]!;
    let colour = groundMap[((cz & 511) << 9) + (cx & 511)]!;
    let hy = at(cx, cz) << 2;
    if ((this.waterMode & 1) !== 0 && (colour & 0xe0) === 0) {
      const wave = this.waveAt(cx, cz);
      hy += wave;
      light = wave * 2 + 0x50;
      colour = 0;
    }
    this.project(cx << 6, hy, cz << 6, out);
    // Brouillard : plafond de lumière `(2000 - D) >> 2`, puis bornes [15, 110].
    const fog = (2000 - out.depth) >> 2;
    if (fog < light) light = fog;
    out.light = Math.min(0x6e, Math.max(0x0f, light));
    out.colour = colour;
    out.visible = !(out.x < VIEWPORT.left || out.x > VIEWPORT.right || out.depth > 1999 || out.depth < 0x65);
  }

  /** Borne la rangée `[s, e]` à ses sommets visibles, avec un sommet de marge (`gm_terrain_clip_row`, `00429c30`). */
  private clipRow(sx0: number, sz0: number, ex0: number, ez0: number): void {
    const rx = this.stepX;
    const rz = this.stepZ;
    const v = this.v;
    let sx = sx0;
    let sz = sz0;
    let ex = ex0;
    let ez = ez0;
    let cx = sx;
    let cz = sz;
    let guard = 0;
    this.projectFlat(cx, cz, v);
    if (!v.visible) {
      while (!v.visible && (sx !== ex || sz !== ez) && guard++ < MAX_ROW_STEPS) {
        sx = cx;
        sz = cz;
        cx += rx;
        cz += rz;
        this.projectFlat(cx, cz, v);
      }
    } else {
      while (v.visible && guard++ < MAX_ROW_STEPS) {
        cx -= rx;
        cz -= rz;
        sx = cx;
        sz = cz;
        this.projectFlat(cx, cz, v);
      }
    }
    cx = ex;
    cz = ez;
    guard = 0;
    this.projectFlat(cx, cz, v);
    if (!v.visible) {
      while (!v.visible && (sx !== ex || sz !== ez) && guard++ < MAX_ROW_STEPS) {
        ex = cx;
        ez = cz;
        cx -= rx;
        cz -= rz;
        this.projectFlat(cx, cz, v);
      }
    } else {
      while (v.visible && guard++ < MAX_ROW_STEPS) {
        cx += rx;
        cz += rz;
        ex = cx;
        ez = cz;
        this.projectFlat(cx, cz, v);
      }
    }
    const out = this.clipped;
    out[0] = sx;
    out[1] = sz;
    out[2] = ex;
    out[3] = ez;
  }

  /** Direction de rangée (`gm_terrain_pick_row_dir`, `0042b05c`) puis rangées proches (pas 1) et lointaines (pas 2) (`00429e1c`). */
  private buildRows(targetX: number, targetZ: number): { first: number; last: number } {
    const pr = this.pr;
    const v = this.v;
    let best = 0;
    let bestDot = 0;
    for (let k = 0; k < 8; k++) {
      const a = (0x80 + k * 0x40) & 511;
      const dot = SIN[a]! * pr.rx + pr.rz * COS[a]!;
      if (bestDot < dot) {
        best = k;
        bestDot = dot;
      }
    }
    const [lx, lz, sx, sz] = DIRECTIONS[best]!;
    this.stepX = lx;
    this.stepZ = lz;

    // Rangée centrale : maille de la cible, déplacée de rangée en rangée jusqu'à la profondeur 1200 et recentrée sur l'écran.
    let gx = Math.trunc(targetX / 64);
    let gz = Math.trunc(targetZ / 64);
    this.projectFlat(gx, gz, v);
    for (let guard = 0; v.depth < MID_DEPTH && guard < 4000; guard++) {
      gx += sx;
      gz += sz;
      gx += v.x < pr.cx ? lx : -lx;
      gz += v.x < pr.cx ? lz : -lz;
      this.projectFlat(gx, gz, v);
    }
    for (let guard = 0; v.depth > MID_DEPTH && guard < 4000; guard++) {
      gx -= sx;
      gz -= sz;
      gx += v.x < pr.cx ? lx : -lx;
      gz += v.x < pr.cx ? lz : -lz;
      this.projectFlat(gx, gz, v);
    }
    gx &= ~1;
    gz &= ~1;

    // Vers la caméra : pas de 1 rangée.
    let a = ROW_CENTER;
    let startX = gx;
    let startZ = gz;
    let endX = gx;
    let endZ = gz;
    do {
      a--;
      this.clipRow(startX, startZ, endX, endZ);
      const [csx, csz, cex, cez] = this.clipped as [number, number, number, number];
      this.rowSx[a] = csx;
      this.rowSz[a] = csz;
      this.rowEx[a] = cex;
      this.rowEz[a] = cez;
      startX = csx - sx;
      startZ = csz - sz;
      endX = cex - sx;
      endZ = cez - sz;
    } while ((startX !== endX || startZ !== endZ) && a > 1);

    // Vers le fond : pas de 2 rangées.
    let b = ROW_CENTER;
    startX = endX = gx + 2 * sx;
    startZ = endZ = gz + 2 * sz;
    do {
      this.clipRow(startX, startZ, endX, endZ);
      const [csx, csz, cex, cez] = this.clipped as [number, number, number, number];
      this.rowSx[b] = csx;
      this.rowSz[b] = csz;
      this.rowEx[b] = cex;
      this.rowEz[b] = cez;
      b++;
      startX = csx + 2 * sx;
      startZ = csz + 2 * sz;
      endX = cex + 2 * sx;
      endZ = cez + 2 * sz;
    } while ((startX !== endX || startZ !== endZ) && b < ROW_CAPACITY - 1);
    return { first: a, last: b };
  }

  /**
   * Bande de terrain entre deux sommets voisins (`004144fb`) : pour chaque colonne `x`, remplit le tronçon vertical laissé libre
   * entre la crête précédente et la nouvelle, en interpolant `[u, v, lumière, couleur]` d'une ligne à l'autre.
   */
  private strip(x0: number, x1: number, depthMax: number, yStart: number, yStep: number): void {
    const { fb, cols, assets } = this;
    const tex = assets.groundTiles;
    const light = assets.groundLight;
    const { state, step, lastStep } = this;
    let yAcc = yStart;
    for (let x = x0; x < x1; x++) {
      const y = yAcc >> 8;
      yAcc += yStep;
      const o = x * 4;
      const cur0 = state[0]!;
      const cur1 = state[1]!;
      const cur2 = state[2]!;
      const cur3 = state[3]!;
      cols.state[o] = cur0;
      cols.state[o + 1] = cur1;
      cols.state[o + 2] = cur2;
      cols.state[o + 3] = cur3;
      state[0] = (cur0 + step[0]!) & 0xffff;
      state[1] = (cur1 + step[1]!) & 0xffff;
      state[2] = (cur2 + step[2]!) & 0xffff;
      state[3] = (cur3 + step[3]!) & 0xffff;
      cols.curY[x] = y;

      // Ligne d'horizon : détecte les crêtes (la colonne monte puis redescend).
      const top = cols.top[x]!;
      let flag = 1;
      if (y > top) {
        if (cols.flag[x] === 1) {
          cols.addHorizon(x, depthMax, top - 2);
          flag = 0;
        } else flag = cols.flag[x]!;
      }
      cols.flag[x] = flag;

      const yc = Math.max(y, VIEWPORT.clipTop);
      const n = top - yc;
      if (n > 0) {
        cols.top[x] = top - n;
        const prevY = cols.prevY[x]!;
        const d = prevY - y;
        const recip = d > 0 && d <= 4000 ? RECIP_16[d]! : 0;
        const p0 = cols.prevState[o]!;
        const p1 = cols.prevState[o + 1]!;
        const p2 = cols.prevState[o + 2]!;
        const p3 = cols.prevState[o + 3]!;
        let s0: number;
        let s1: number;
        let s2: number;
        let s3: number;
        let down = false;
        if (n !== 1) {
          if (top !== prevY) {
            // Bande partiellement cachée : de haut en bas depuis l'état courant.
            down = true;
            lastStep[0] = mulhw(s16(p0 - cur0), recip);
            lastStep[1] = mulhw(s16(p1 - cur1), recip);
            lastStep[2] = mulhw(s16(p2 - cur2), recip);
            lastStep[3] = mulhw(s16(p3 - cur3), recip);
            s0 = cur0;
            s1 = cur1;
            s2 = cur2;
            s3 = cur3;
          } else {
            // Cas normal : de bas en haut depuis l'état précédent.
            lastStep[0] = mulhw(s16(cur0 - p0), recip);
            lastStep[1] = mulhw(s16(cur1 - p1), recip);
            lastStep[2] = mulhw(s16(cur2 - p2), recip);
            lastStep[3] = mulhw(s16(cur3 - p3), recip);
            s0 = p0;
            s1 = p1;
            s2 = p2;
            s3 = p3;
          }
        } else {
          s0 = cur0;
          s1 = cur1;
          s2 = cur2;
          s3 = cur3;
        }
        const d0 = lastStep[0]!;
        const d1 = lastStep[1]!;
        const d2 = lastStep[2]!;
        const d3 = lastStep[3]!;
        const lightStep = s16(d2);
        let lacc = s2 & 0x7fff;
        let p = (down ? yc + 1 : top) * SCREEN_WIDTH + x;
        const pstep = down ? SCREEN_WIDTH : -SCREEN_WIDTH;
        for (let i = 0; i < n; i++) {
          lacc += lightStep;
          const texel = tex[(((s3 >> 9) & 31) << 12) | (((s1 >> 7) & 63) << 6) | ((s0 >> 7) & 63)]!;
          fb[p] = light[(((lacc >> 8) & 127) << 8) | texel]!;
          p += pstep;
          s0 = (s0 + d0) & 0xffff;
          s1 = (s1 + d1) & 0xffff;
          s2 = (s2 + d2) & 0xffff;
          s3 = (s3 + d3) & 0xffff;
        }
      }
      cols.prevY[x] = cols.curY[x]!;
      cols.prevState[o] = cols.state[o]!;
      cols.prevState[o + 1] = cols.state[o + 1]!;
      cols.prevState[o + 2] = cols.state[o + 2]!;
      cols.prevState[o + 3] = cols.state[o + 3]!;
    }
  }
}
