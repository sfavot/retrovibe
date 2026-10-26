/**
 * Objets 3D (`render.md` §7-8) : transformation des modèles en entiers, éclairage de Gouraud, mise en file des faces et
 * rastériseurs de triangles. Tous les tracés remplissent colonne par colonne en interpolant en espace écran (sans perspective),
 * découpés par le rectangle et par les lignes d'horizon du terrain.
 */
import type { PreparedModel, RenderAssets } from "./assets";
import type { Projection } from "./camera";
import type { Columns } from "./columns";
import { applyDeformers, type DeformedVertex } from "./deformers";
import {
  KIND_KEYED,
  KIND_ROTOR,
  KIND_SHADED,
  KIND_SHADED_DOUBLE,
  KIND_SHADOW,
  KIND_SKIN,
  RenderQueue,
} from "./queue";
import { COS, COS320, SIN, SIN320, WAVE, idiv } from "./tables";
import {
  OBJECT_BILLBOARD,
  OBJECT_FAST_ANIM,
  OBJECT_FULL_BRIGHT,
  OBJECT_NO_TEXTURE_ANIM,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  VIEWPORT,
  wrapDelta,
  type RenderDeformer,
  type RenderObject,
} from "./view";

/** Types de face que le jeu dessine. */
const DRAWN_KINDS: ReadonlySet<number> = new Set([KIND_SHADED, KIND_ROTOR, KIND_SHADED_DOUBLE, KIND_KEYED, KIND_SKIN, KIND_SHADOW]);

/** Ligne maximale de la table de lumière, plein feu et plafond d'éclairage d'un modèle. */
const FULL_BRIGHT = 0x7f;
const LIGHT_CAP = 0x6e;

export class ObjectRenderer {
  readonly queue = new RenderQueue();
  private time = 0;
  private waterMode = 3;
  private pr!: Projection;
  private deformers: readonly RenderDeformer[] = [];
  private readonly dv: DeformedVertex = { x: 0, y: 0, z: 0, light: 0, colour: 0 };
  private readonly sx: Int32Array;
  private readonly sy: Int32Array;
  private readonly depth: Int32Array;
  private readonly intensity: Int32Array;

  // Sommets du triangle en cours de tracé.
  private readonly X = new Int32Array(3);
  private readonly Y = new Int32Array(3);
  private readonly U = new Int32Array(3);
  private readonly V = new Int32Array(3);
  private readonly L = new Int32Array(3);

  constructor(private readonly assets: RenderAssets) {
    let maxVertices = 1;
    let maxNormals = 1;
    for (const m of assets.models.values()) {
      maxVertices = Math.max(maxVertices, m.vertexCount);
      maxNormals = Math.max(maxNormals, m.normalCount);
    }
    this.sx = new Int32Array(maxVertices);
    this.sy = new Int32Array(maxVertices);
    this.depth = new Int32Array(maxVertices);
    this.intensity = new Int32Array(maxNormals);
  }

  begin(pr: Projection, time: number, waterMode: number, deformers: readonly RenderDeformer[] = []): void {
    this.pr = pr;
    this.deformers = deformers;
    this.time = time;
    this.waterMode = waterMode;
    this.queue.reset();
  }

  /** Hauteur du sol en unités monde, bilinéaire ; avec `waterMode & 2` les sommets d'eau sont majorés de leur vague (`00425c94`). */
  private groundHeight(x: number, z: number): number {
    const { heightmap, groundMap } = this.assets;
    const wavy = (this.waterMode & 2) !== 0;
    const corner = (cx: number, cz: number): number => {
      const i = ((cz & 511) << 9) + (cx & 511);
      let h = heightmap[i]! << 2;
      if (wavy && (groundMap[i]! & 0xe0) === 0) h += WAVE[(cz * 4 + this.time + SIN[(cx & 31) * 16]!) & 31]!;
      return h;
    };
    const cx = x >> 6;
    const cz = z >> 6;
    const fx = x & 63;
    const fz = z & 63;
    const h00 = corner(cx, cz);
    const h10 = corner(cx + 1, cz);
    const h01 = corner(cx, cz + 1);
    const h11 = corner(cx + 1, cz + 1);
    const a = h00 + (((h10 - h00) * fx) >> 6);
    const b = h01 + (((h11 - h01) * fx) >> 6);
    return a + (((b - a) * fz) >> 6);
  }

  /** Transforme un modèle et met ses faces en file (`gm_render_objects`, `0042718c`). */
  addObject(obj: RenderObject): void {
    const model: PreparedModel | undefined = this.assets.models.get(((obj.modelId % 1000) + 1000) % 1000);
    if (!model) return;
    const pr = this.pr;
    const flags = obj.flags ?? 0;
    const ox = pr.camX + wrapDelta(Math.trunc(obj.x) - pr.camX);
    const oy = Math.trunc(obj.y);
    const oz = pr.camZ + wrapDelta(Math.trunc(obj.z) - pr.camZ);

    // Visibilité : profondeur dans ]-10, 2000[ et centre à moins d'une largeur d'écran (+ marge) du centre.
    const dx = ox - pr.camX;
    const dy = oy - pr.camY;
    const dz = oz - pr.camZ;
    const d8 = (dx * pr.fx + dy * pr.fy + dz * pr.fz) >> 8;
    if (!(d8 > -10 && d8 < 2000)) return;
    const sxc = idiv(dx * pr.rx + dy * pr.ry + dz * pr.rz, d8 + 0x19);
    const syc = idiv(dx * pr.ux + dy * pr.uy + dz * pr.uz, d8 + 0x19);
    const width = VIEWPORT.right - VIEWPORT.left;
    const height = VIEWPORT.bottom - VIEWPORT.clipTop;
    if (!(Math.abs(sxc) < width + 0x14 && Math.abs(syc) < height + 0x1e)) return;

    const s1 = SIN[-obj.pitch & 511]!;
    const c1 = COS[-obj.pitch & 511]!;
    const s2 = SIN[-obj.roll & 511]!;
    const c2 = COS[-obj.roll & 511]!;
    let s3 = SIN[-obj.yaw & 511]!;
    let c3 = COS[-obj.yaw & 511]!;
    if ((flags & OBJECT_BILLBOARD) !== 0) {
      s3 = -pr.headX;
      c3 = pr.headZ;
    }

    // Vecteur lumière (147, 147, 147) ramené dans le repère du modèle ; la 320 vient de l'étirement vertical ×1,25.
    const ay = obj.pitch & 511;
    const ap = obj.roll & 511;
    const ar = obj.yaw & 511;
    const i4 = (COS[ay]! * 147 - SIN[ay]! * 147) >> 8;
    const i5 = (147 * SIN[ay]! + COS[ay]! * 147) >> 8;
    const i6 = (COS320[ap]! * 147 - i4 * SIN320[ap]!) >> 8;
    const l1 = (SIN320[ap]! * 147 + i4 * COS320[ap]!) >> 8;
    const l0 = (COS[ar]! * i6 - i5 * SIN[ar]!) >> 8;
    const l2 = (SIN[ar]! * i6 + i5 * COS[ar]!) >> 8;

    const { sx, sy, depth } = this;
    const verts = model.vertices;
    let dmin = Infinity;
    let dmax = -Infinity;
    for (let i = 0; i < model.vertexCount; i++) {
      let x = verts[i * 4]!;
      let y = verts[i * 4 + 1]!;
      let z = verts[i * 4 + 2]!;
      const mode = verts[i * 4 + 3]!;
      if (mode !== 1) {
        // Tangage puis roulis (sauf sommet collé au sol).
        const t = (y * c1 - z * s1) >> 8;
        z = (y * s1 + z * c1) >> 8;
        const x0 = x;
        x = (x0 * c2 - t * s2) >> 8;
        y = (x0 * s2 + t * c2) >> 8;
      }
      const z2 = (x * s3 + z * c3) >> 8;
      x = (x * c3 - z * s3) >> 8;
      z = z2 + oz;
      x += ox;
      y += oy;
      if (mode !== 0) {
        const g = this.groundHeight(x, z);
        y = mode === 1 ? g : Math.max(y, g);
      }
      if (this.deformers.length > 0) {
        // Sommet déformé en coordonnées monde, après le placement au sol (seule la hauteur est reprise).
        const dv = this.dv;
        dv.x = x;
        dv.y = y;
        dv.z = z;
        applyDeformers(this.deformers, dv);
        y = dv.y;
      }
      const rx = x - pr.camX;
      const ry = y - pr.camY;
      const rz = z - pr.camZ;
      const d = ((rx * pr.fx + ry * pr.fy + rz * pr.fz) >> 8) + 0x19;
      if (d < 1) {
        sx[i] = VIEWPORT.right;
        sy[i] = VIEWPORT.bottom;
      } else {
        sx[i] = idiv(rx * pr.rx + ry * pr.ry + rz * pr.rz, d) + pr.cx;
        sy[i] = pr.cy - idiv(rx * pr.ux + ry * pr.uy + rz * pr.uz, d);
      }
      depth[i] = d;
      if (d > dmax) dmax = d;
      if (d < dmin) dmin = d;
    }

    // Éclairage par normale : produit scalaire avec la lumière, ambiant, plafond 110 ; plein feu = 0x7f.
    const { intensity } = this;
    const normals = model.normals;
    const fullBright = (flags & OBJECT_FULL_BRIGHT) !== 0;
    for (let i = 0; i < model.normalCount; i++) {
      if (fullBright) {
        intensity[i] = FULL_BRIGHT;
        continue;
      }
      let l = (normals[i * 3 + 2]! * l2 + normals[i * 3 + 1]! * l1 + normals[i * 3]! * l0) >> 8;
      if (l < 0) l = 0;
      l += model.ambient;
      intensity[i] = l > LIGHT_CAP ? LIGHT_CAP : l;
    }

    const phase = (flags & OBJECT_FAST_ANIM) !== 0 ? this.time : this.time >> 2;
    const textureShift = (flags & OBJECT_NO_TEXTURE_ANIM) !== 0 ? 0 : (phase & 3) << 4;
    const q = this.queue;
    for (let f = 0; f < model.faceCount; f++) {
      const kind = model.kind[f]!;
      if (!DRAWN_KINDS.has(kind)) continue; // le type 3 (et tout autre) ne dessine rien
      const i0 = model.indices[f * 3]!;
      const i1 = model.indices[f * 3 + 1]!;
      const i2 = model.indices[f * 3 + 2]!;
      const x0 = sx[i0]!;
      const y0 = sy[i0]!;
      const front = (sx[i2]! - x0) * (sy[i1]! - y0) < (sx[i1]! - x0) * (sy[i2]! - y0);
      const faceMax = Math.max(depth[i0]!, depth[i1]!, depth[i2]!);
      let key: number;
      if (kind === KIND_SHADED) {
        if (!front) continue;
        key = faceMax;
      } else if (kind === KIND_SHADED_DOUBLE || kind === KIND_KEYED) key = faceMax;
      else if (kind === KIND_SHADOW) {
        if (!front) continue;
        key = dmax;
      } else if (kind === KIND_ROTOR) key = front ? dmax : dmin;
      else key = dmin; // KIND_SKIN
      const qi = q.claim(kind, key);
      if (qi < 0) return;
      const o = qi * 3;
      q.x[o] = x0;
      q.x[o + 1] = sx[i1]!;
      q.x[o + 2] = sx[i2]!;
      q.y[o] = y0;
      q.y[o + 1] = sy[i1]!;
      q.y[o + 2] = sy[i2]!;
      q.texture[qi] = model.texture[f]!;
      q.aux[qi] = obj.skin ?? 0;
      const animated = (model.flags[f]! & 2) !== 0 ? textureShift : 0;
      for (let k = 0; k < 3; k++) {
        q.u[o + k] = model.u[f * 3 + k]!;
        q.v[o + k] = model.v[f * 3 + k]! + animated;
        q.l[o + k] = intensity[model.normalIndices[f * 3 + k]!] ?? 0;
      }
      if (kind === KIND_ROTOR) {
        // Disque de rotor : u, v remplacés par trois points d'un cercle de rayon 36 centré en (32, 32) qui tourne avec le temps.
        for (let k = 0; k < 3; k++) {
          const i = (this.time * 10 + k * 0x55) & 0xff;
          q.u[o + k] = ((SIN[2 * i]! * 0x24) >> 8) + 0x20;
          q.v[o + k] = ((COS[2 * i]! * 0x24) >> 8) + 0x20;
        }
      }
      if ((kind === KIND_SHADED || kind === KIND_ROTOR || kind === KIND_SHADED_DOUBLE || kind === KIND_KEYED) && q.isOffscreen(qi)) q.release();
    }
  }

  /**
   * Triangle texturé de colonne en colonne (`gm_tri_gouraud` `00430380`, `gm_tri_flat` `00430f40`, `gm_tri_keyed` `004329b4`,
   * ombre `00433f64`, rotor `00433414`, type 5 `004349ac`). Les coordonnées de texture et la lumière sont en 8.8.
   */
  drawTriangle(fb: Uint8Array, cols: Columns, qi: number): void {
    const { queue: q, assets, X, Y, U, V, L } = this;
    const kind = q.kind[qi]!;
    const key = q.key[qi]!;
    const o = qi * 3;
    for (let k = 0; k < 3; k++) {
      X[k] = q.x[o + k]!;
      Y[k] = q.y[o + k]!;
      U[k] = q.u[o + k]!;
      V[k] = q.v[o + k]!;
      L[k] = q.l[o + k]!;
    }
    const lit = (kind === KIND_SHADED || kind === KIND_SHADED_DOUBLE) && !(L[0] === L[1] && L[1] === L[2]);

    // Textures et tables selon le type.
    let pixels: Uint8Array = assets.groundTiles;
    let offset = 0;
    let lightTable: Uint8Array = assets.groundLight;
    if (kind === KIND_SHADED || kind === KIND_SHADED_DOUBLE || kind === KIND_KEYED) {
      const slot = assets.slots[q.texture[qi]!] ?? assets.slots[0]!;
      pixels = slot.pixels;
      offset = slot.offset;
      lightTable = slot.light;
    } else if (kind === KIND_SKIN) {
      const image = assets.images504[q.aux[qi]!];
      if (!image) return;
      pixels = image;
    }
    const flatRow = (L[0]! & 127) << 8;
    const t500 = assets.table500;
    const t109 = assets.table109;
    const s110 = assets.shadowSprites;

    // Mise en place des arêtes (`00430380`) : départ au x minimal, deux arêtes qui se referment sur la troisième.
    let v0 = 0;
    let xmin = X[0]!;
    if (X[1]! <= xmin) {
      xmin = X[1]!;
      v0 = 1;
    }
    if (X[2]! <= xmin) {
      xmin = X[2]!;
      v0 = 2;
    }
    let xmax = Math.max(X[0]!, X[1]!, X[2]!);
    let fc = (v0 + 1) % 3;
    let f8 = (v0 + 2) % 3;
    let dxA = Math.abs(X[fc]! - X[v0]!) + 1;
    let dxB = Math.abs(X[v0]! - X[f8]!) + 1;
    let sA = idiv((Y[fc]! - Y[v0]!) * 256, dxA);
    let sB = idiv((Y[v0]! - Y[f8]!) * 256, dxB);
    if (-sA !== sB && sA <= -sB) {
      f8 = (v0 + 1) % 3;
      fc = (v0 + 2) % 3;
      dxA = Math.abs(X[fc]! - X[v0]!) + 1;
      dxB = Math.abs(X[v0]! - X[f8]!) + 1;
      sA = idiv((Y[fc]! - Y[v0]!) * 256, dxA);
      sB = idiv((Y[v0]! - Y[f8]!) * 256, dxB);
    }
    const dxC = Math.abs(X[f8]! - X[fc]!) + 1;
    const sC = idiv((Y[f8]! - Y[fc]!) * 256, dxC);
    const slope = (A: Int32Array, ia: number, ib: number, dx: number): number => idiv((A[ia]! - A[ib]!) * 256, dx);
    const uA = slope(U, fc, v0, dxA);
    const uC = slope(U, f8, fc, dxC);
    const uB = slope(U, v0, f8, dxB);
    const vA = slope(V, fc, v0, dxA);
    const vC = slope(V, f8, fc, dxC);
    const vB = slope(V, v0, f8, dxB);
    const lA = slope(L, fc, v0, dxA);
    const lC = slope(L, f8, fc, dxC);
    const lB = slope(L, v0, f8, dxB);

    let yTop = Y[v0]! << 8;
    let yBot = yTop;
    let uTop = U[v0]! << 8;
    let uBot = uTop;
    let vTop = V[v0]! << 8;
    let vBot = vTop;
    let lTop = L[v0]! << 8;
    let lBot = lTop;
    let sTop = sB;
    let sBot = sA;
    let uTopStep = uB;
    let uBotStep = uA;
    let vTopStep = vB;
    let vBotStep = vA;
    let lTopStep = lB;
    let lBotStep = lA;
    if (xmax > VIEWPORT.right) xmax = VIEWPORT.right;
    const xFc = X[fc]!;
    const xF8 = X[f8]!;
    const bottom = VIEWPORT.bottom;

    for (let x = xmin; x <= xmax; x++) {
      yTop -= sTop;
      yBot += sBot;
      uTop -= uTopStep;
      vTop -= vTopStep;
      lTop -= lTopStep;
      uBot += uBotStep;
      vBot += vBotStep;
      lBot += lBotStep;
      if (x === xFc) {
        sBot = sC;
        uBotStep = uC;
        vBotStep = vC;
        lBotStep = lC;
      }
      if (x === xF8) {
        sTop = sC;
        uTopStep = uC;
        vTopStep = vC;
        lTopStep = lC;
      }
      if (x < VIEWPORT.left) continue;
      let y0 = yTop >> 8;
      let y1 = yBot >> 8;
      if (!((y0 >= 0 || y1 >= 0) && (y0 <= bottom || y1 < bottom) && y0 < y1)) continue;
      let count = y1 - y0 + 2;
      const us = idiv(uBot - uTop, count);
      const vs = idiv(vBot - vTop, count);
      const ls = lit ? idiv(lBot - lTop, count) : 0;
      let u = uTop;
      let v = vTop;
      let l = lTop;
      if (y0 < 0) {
        // Découpe du haut : les états avancent des lignes perdues.
        count += y0;
        u -= us * y0;
        v -= vs * y0;
        l -= ls * y0;
        y0 = 0;
      }
      if (y1 > bottom) {
        count -= y1 - bottom;
        y1 = bottom;
      }
      count = cols.clipByHorizon(x, key, y0, y1, count);
      if (y0 + count > SCREEN_HEIGHT) count = SCREEN_HEIGHT - y0;
      if (count <= 0) continue;

      let p = y0 * SCREEN_WIDTH + x;
      switch (kind) {
        case KIND_SHADED:
        case KIND_SHADED_DOUBLE:
          if (lit) {
            for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
              const texel = pixels[offset + (((v >> 8) & 0x3f) << 8) + ((u >> 8) & 0x3f)]!;
              fb[p] = lightTable[(((l >> 8) & 127) << 8) | texel]!;
              u += us;
              v += vs;
              l += ls;
            }
          } else {
            for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
              const texel = pixels[offset + (((v >> 8) & 0x3f) << 8) + ((u >> 8) & 0x3f)]!;
              fb[p] = lightTable[flatRow | texel]!;
              u += us;
              v += vs;
            }
          }
          break;
        case KIND_KEYED:
          // Texel 0 transparent ; sinon ligne 100 de la table de lumière (non éclairé).
          for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
            const texel = pixels[offset + (((v >> 8) & 0x3f) << 8) + ((u >> 8) & 0x3f)]!;
            if (texel !== 0) fb[p] = lightTable[(100 << 8) | texel]!;
            u += us;
            v += vs;
          }
          break;
        case KIND_SHADOW:
          // Silhouette 110 (0..31) : assombrit le pixel par la table 500.
          for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
            const s = s110[(((v >> 8) & 0xff) << 8) | ((u >> 8) & 0xff)]!;
            fb[p] = t500[(s << 8) | fb[p]!]!;
            u += us;
            v += vs;
          }
          break;
        case KIND_ROTOR:
          // Masque de flou 64×64 (lignes 32..47 de la table 500) : assombrit selon le masque.
          for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
            const b = t500[0x2000 + (((v >> 8) & 0x3f) << 6) + ((u >> 8) & 0x3f)]!;
            fb[p] = t500[(b << 8) | fb[p]!]!;
            u += us;
            v += vs;
          }
          break;
        case KIND_SKIN:
          // Image 64×64 de GLOBAL 504 : le texel est un numéro de ligne de la table 109 (0 = identité).
          for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
            const texel = pixels[(((v >> 8) & 0x3f) << 6) + ((u >> 8) & 0x3f)]!;
            fb[p] = t109[(texel << 8) | fb[p]!]!;
            u += us;
            v += vs;
          }
          break;
      }
    }
  }
}
