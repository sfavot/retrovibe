/**
 * Dessin des messages 3D (`gm_message_draw` `00424454`, `gm_text3d_emit_glyph` `00423974`, file triée `gm_queue_insert` `00423620`,
 * triangles `gm_draw_flat_tri` `004359c8`) : mise en page des lignes, projection et éclairage de chaque lettre extrudée du bloc 200,
 * puis tracé des faces avant du plus loin au plus proche. Le texte est dans le repère de l'écran (la caméra n'intervient pas) :
 * centre (160, 200), perspective `1 / (profondeur + 0xd61)`, pixels non carrés (×0x1aa / 1024 en hauteur).
 */
import type { VectorFont } from "../../data/global";
import { COS, idiv, SIN } from "../tables";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../view";
import type { Message3D, MessagePool } from "./message";
import { DepthList } from "./depth-list";
import { fillFlatTriangle } from "./raster";

/** Capacité de la file de primitives (`0xbb3`). */
const QUEUE_CAPACITY = 0xbb3;
/** Centre de projection (`DAT_00480c6c`, `DAT_00480c70`). */
const CENTER_X = 160;
const CENTER_Y = 200;
/** Recul de la perspective (`0xd61`) et facteur vertical (`0x1aa`) de la projection logicielle. */
const DEPTH_BIAS = 0xd61;
const ASPECT = 0x1aa;
/** Avance d'un glyphe vide (largeur 45 des emplacements non renseignés) : `(45 >> 2) + 5`. */
const EMPTY_WIDTH = 45;
/** Interligne et demi-interligne (`300`, `0x96`). */
const LINE_STEP = 300;
const HALF_LINE = 0x96;
/** Rejet à l'insertion : zone de l'écran du jeu (`005876cc..005876f4`). */
const CLIP = { left: 0, right: 0x13e, top: 0, bottom: 0x18f } as const;
const PIPE = 0x7c;

export interface Text3dAssets {
  font: VectorFont;
  /** Index du glyphe d'un octet de texte (`DAT_005bba28`, dépend de la page de langue) : même numérotation que la police 2D. */
  glyphIndex(code: number): number;
  /** Table de couleurs du bloc 11003 du niveau (`005bc158`, 8 Ko) : `table[teinte + lumière]` est l'indice de palette de la face. */
  colors: Uint8Array;
}

export interface Text3d {
  /** Trace tous les messages du pool dans `fb` (`320 × 400`), par-dessus l'image. */
  draw(fb: Uint8Array, pool: MessagePool, colors?: Uint8Array): void;
}

export function createText3d(assets: Text3dAssets): Text3d {
  const { font } = assets;
  /** Table de couleurs de l'image en cours : celle du niveau, ou celle que l'appelant impose (écrans devant un autre niveau). */
  let colors = assets.colors;
  let maxVertices = 1;
  for (const glyph of font.glyphs.values()) maxVertices = Math.max(maxVertices, glyph.vertices.length / 3);
  const sx = new Int32Array(maxVertices);
  const sy = new Int32Array(maxVertices);
  const depth = new Int32Array(maxVertices);
  const light = new Int32Array(font.normals.length / 3);

  // File des faces à tracer.
  let count = 0;
  const colour = new Uint8Array(QUEUE_CAPACITY);
  const qx = new Int32Array(QUEUE_CAPACITY * 3);
  const qy = new Int32Array(QUEUE_CAPACITY * 3);
  const list = new DepthList(QUEUE_CAPACITY);
  const triX = new Int32Array(3);
  const triY = new Int32Array(3);

  const glyphWidth = (code: number): number => font.glyphs.get(assets.glyphIndex(code))?.width ?? EMPTY_WIDTH;
  /** Avance d'une lettre dans la ligne : `(largeur >> 2) + 5`. */
  const advance = (code: number): number => (glyphWidth(code) >> 2) + 5;

  /**
   * `gm_text3d_emit_glyph` : `negX`, `negY`, `negZ` = position du message négative ; `offsetX` (déjà × 4), `offsetY` : place de la lettre
   * dans le texte ; `screenY` : décalage en pixels ; `a1..a3` : angles du message (0..511) ; `tint` : teinte.
   */
  function emitGlyph(code: number, negX: number, negY: number, negZ: number, offsetX: number, offsetY: number, screenY: number, a1: number, a2: number, a3: number, tint: number): void {
    const glyph = font.glyphs.get(assets.glyphIndex(code));
    if (!glyph || glyph.triangles.length === 0) return;
    const { vertices, triangles } = glyph;
    const { normals } = font;
    const s1 = SIN[a1]!;
    const c1 = COS[a1]!;
    const s2 = SIN[a2]!;
    const c2 = COS[a2]!;
    const s3 = SIN[a3]!;
    const c3 = COS[a3]!;

    // Lumière par normale : la direction de la lumière tourne avec la position de la lettre dans la ligne (`offsetX >> 6`).
    const u = ((offsetX >> 6) + a2) & 0x1ff;
    const su = SIN[u]!;
    const cu = COS[u]!;
    for (let n = 0; n < light.length; n++) {
      const inner = (s1 * normals[n * 3 + 1]! + c1 * normals[n * 3 + 2]!) >> 8;
      const l = ((((normals[n * 3]! * su + cu * inner) >> 8) * -0x100) >> 9);
      light[n] = l < 0 ? 0 : l > 0x7f ? 0x7f : l;
    }

    const vertexCount = vertices.length / 3;
    for (let v = 0; v < vertexCount; v++) {
      const px = (vertices[v * 3]! + offsetX) * 4;
      const py = (vertices[v * 3 + 1]! + offsetY) * 4;
      const pz = vertices[v * 3 + 2]! * 4;
      const y1 = (c1 * py - s1 * pz) >> 8;
      const z1 = (c1 * pz + s1 * py) >> 8;
      const x2 = (px * c2 - s2 * z1) >> 8;
      const d = ((px * s2 + c2 * z1 + negZ * 4) >> 9) + DEPTH_BIAS;
      // Un sommet derrière l'œil abandonne toute la lettre.
      if (d < 1) return;
      depth[v] = d;
      sx[v] = idiv(((x2 * c3 - s3 * y1) >> 2) + negX * 4, d) + CENTER_X;
      sy[v] = CENTER_Y - idiv((((x2 * s3 + c3 * y1) * ASPECT) >> 10) + negY * 4, d) + screenY;
    }
    for (let t = 0; t < triangles.length; t += 4) {
      const a = triangles[t]!;
      const b = triangles[t + 1]!;
      const c = triangles[t + 2]!;
      // Face avant seulement.
      if ((sx[c]! - sx[a]!) * (sy[b]! - sy[a]!) >= (sx[b]! - sx[a]!) * (sy[c]! - sy[a]!)) continue;
      if (count >= QUEUE_CAPACITY) return;
      if ((sx[a]! < CLIP.left && sx[b]! < CLIP.left && sx[c]! < CLIP.left) || (sx[a]! > CLIP.right && sx[b]! > CLIP.right && sx[c]! > CLIP.right)) continue;
      if ((sy[a]! < CLIP.top && sy[b]! < CLIP.top && sy[c]! < CLIP.top) || (sy[a]! > CLIP.bottom && sy[b]! > CLIP.bottom && sy[c]! > CLIP.bottom)) continue;
      const i = count++;
      list.insert(i, depth[a]! + depth[b]! + depth[c]!);
      qx[i * 3] = sx[a]!;
      qx[i * 3 + 1] = sx[b]!;
      qx[i * 3 + 2] = sx[c]!;
      qy[i * 3] = sy[a]!;
      qy[i * 3 + 1] = sy[b]!;
      qy[i * 3 + 2] = sy[c]!;
      colour[i] = colors[tint + light[triangles[t + 3]!]!] ?? 0;
    }
  }

  /** `gm_message_draw` pour un message : lignes centrées, la première en haut. */
  function layout(m: Message3D): void {
    const a1 = (m.rot[0] >> 4) & 0x1ff;
    const a2 = (m.rot[1] >> 4) & 0x1ff;
    const a3 = (m.rot[2] >> 4) & 0x1ff;
    const text = m.text;
    let lineY = 0;
    for (const code of text) if (code === PIPE) lineY += HALF_LINE;
    let i = 0;
    while (i < text.length) {
      const start = i;
      let width = 0;
      for (; i < text.length && text[i] !== PIPE; i++) width += advance(text[i]!);
      let pen = -width;
      for (let k = start; k < i; k++) {
        const step = advance(text[k]!);
        pen += step;
        emitGlyph(text[k]!, -m.pos[0], -m.pos[1], -m.pos[2], pen * 4, lineY, m.yOffset, a1, a2, a3, m.tint);
        pen += step;
      }
      if (text[i] === PIPE) i++;
      lineY -= LINE_STEP;
    }
  }

  return {
    draw(fb, pool, table = assets.colors) {
      if (fb.length < SCREEN_WIDTH * SCREEN_HEIGHT) throw new Error("texte 3D : image trop petite");
      colors = table;
      count = 0;
      list.reset();
      for (const m of pool.active) layout(m);
      // Du plus loin au plus proche, en suivant la liste depuis la sentinelle de tête.
      for (let i = list.first(); i >= 0; i = list.next(i)) {
        for (let k = 0; k < 3; k++) {
          triX[k] = qx[i * 3 + k]!;
          triY[k] = qy[i * 3 + k]!;
        }
        fillFlatTriangle(fb, triX, triY, colour[i]!);
      }
    },
  };
}
