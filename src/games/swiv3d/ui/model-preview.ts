/**
 * Aperçu 3D d'un maillage de triangles pour la visionneuse de ressources (outil de développement) : rasteriseur logiciel
 * en canvas 2D, projection orthographique, tri des faces du plus loin au plus proche (algorithme du peintre).
 * Rotation à la souris (glisser), zoom à la molette ; fil de fer, uni ombré ou texturé.
 *
 * Repère : y vers le haut ; l'écran reçoit `(x, -y)` et la profondeur est `z` (plus grand = plus loin), comme dans le jeu.
 */
import { h } from "../../../ui/asset-viewer/helpers";

/** Texture échantillonnable : renvoie la couleur `0xRRGGBB` du texel `(u, v)` (entiers, modulo la tuile), ou -1 si transparent. */
export interface PreviewTexture {
  sample(u: number, v: number): number;
}

export interface PreviewFace {
  indices: [number, number, number];
  /** Coordonnées de texture par sommet (en texels) ; absentes = face non texturable. */
  u?: [number, number, number];
  v?: [number, number, number];
  texture?: PreviewTexture | null;
  /** Dessinée des deux côtés (sinon la face arrière est éliminée, comme le jeu pour les types 0 et 0x28). */
  doubleSided?: boolean;
  /** Couleur de base `0xRRGGBB` des modes uni et de repli (gris par défaut). */
  color?: number;
}

export interface PreviewMesh {
  vertices: { x: number; y: number; z: number }[];
  faces: PreviewFace[];
}

export type PreviewMode = "wire" | "flat" | "textured";

export interface PreviewView {
  /** Rotation autour de l'axe vertical, en radians. */
  yaw: number;
  /** Inclinaison, en radians (-π/2 à π/2). */
  pitch: number;
  /** Facteur de zoom (1 = le modèle remplit environ 80 % de la zone). */
  zoom: number;
  mode: PreviewMode;
}

export interface MeshPreview {
  element: HTMLElement;
  /** Vue courante : à repasser à la création suivante pour la conserver (changement de palette). */
  view: PreviewView;
  dispose(): void;
}

export interface PreviewOptions {
  view?: Partial<PreviewView>;
  /** Côté de la zone de dessin, en pixels CSS. */
  size?: number;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const BACKGROUND = 0x0b0b0d;
const DEFAULT_COLOR = 0x9aa1b2;
/** Direction de la lumière (vers la caméra, en haut à gauche), normalisée plus bas. */
const LIGHT = normalize([-0.4, 0.6, -0.7]);

function normalize(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function pack(rgb: number): number {
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  return LITTLE_ENDIAN ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
}

function shade(rgb: number, k: number): number {
  const r = Math.min(255, Math.round(((rgb >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((rgb >> 8) & 255) * k));
  const b = Math.min(255, Math.round((rgb & 255) * k));
  return (r << 16) | (g << 8) | b;
}

interface Projected {
  /** Coordonnées d'écran `x, y` et profondeur `z` de chaque sommet. */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

export function createMeshPreview(mesh: PreviewMesh, options: PreviewOptions = {}): MeshPreview {
  const size = options.size ?? 480;
  const hasTextures = mesh.faces.some((f) => f.texture && f.u && f.v);
  const view: PreviewView = {
    yaw: 0.6,
    pitch: 0.45,
    zoom: 1,
    mode: hasTextures ? "textured" : "flat",
    ...options.view,
  };
  if (view.mode === "textured" && !hasTextures) view.mode = "flat";

  let radius = 1;
  for (const v of mesh.vertices) radius = Math.max(radius, Math.hypot(v.x, v.y, v.z));

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.className = "preview3d";
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.imageRendering = "auto";
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const pixels = new Uint32Array(image.data.buffer);
  const background = pack(BACKGROUND);

  function project(): Projected {
    const n = mesh.vertices.length;
    const out: Projected = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch);
    const sp = Math.sin(view.pitch);
    const scale = ((size * 0.4) / radius) * view.zoom;
    for (let i = 0; i < n; i++) {
      const { x, y, z } = mesh.vertices[i]!;
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      out.x[i] = size / 2 + x1 * scale;
      out.y[i] = size / 2 - y2 * scale;
      out.z[i] = z2;
    }
    return out;
  }

  /** Aire signée de l'écran : positive = face tournée vers la caméra (formule du jeu, y vers le bas). */
  function area(p: Projected, [a, b, c]: [number, number, number]): number {
    return (p.x[b]! - p.x[a]!) * (p.y[c]! - p.y[a]!) - (p.x[c]! - p.x[a]!) * (p.y[b]! - p.y[a]!);
  }

  /** Intensité de Lambert (0,3 à 1) d'une face, d'après sa normale en repère caméra (éclairée des deux côtés). */
  function light(p: Projected, [a, b, c]: [number, number, number]): number {
    const ux = p.x[b]! - p.x[a]!;
    const uy = -(p.y[b]! - p.y[a]!);
    const uz = p.z[b]! - p.z[a]!;
    const vx = p.x[c]! - p.x[a]!;
    const vy = -(p.y[c]! - p.y[a]!);
    const vz = p.z[c]! - p.z[a]!;
    const n = normalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
    return 0.3 + 0.7 * Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  }

  function visibleFaces(p: Projected): number[] {
    const order: { index: number; depth: number }[] = [];
    mesh.faces.forEach((face, index) => {
      const [a, b, c] = face.indices;
      if (!face.doubleSided && area(p, face.indices) <= 0) return;
      order.push({ index, depth: Math.max(p.z[a]!, p.z[b]!, p.z[c]!) });
    });
    order.sort((l, r) => r.depth - l.depth);
    return order.map((o) => o.index);
  }

  function fillTriangle(p: Projected, face: PreviewFace, brightness: number, textured: boolean): void {
    const [a, b, c] = face.indices;
    const x0 = p.x[a]!;
    const y0 = p.y[a]!;
    const x1 = p.x[b]!;
    const y1 = p.y[b]!;
    const x2 = p.x[c]!;
    const y2 = p.y[c]!;
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    const base = face.color ?? DEFAULT_COLOR;
    const flat = pack(shade(base, brightness));
    const tex = textured ? face.texture : null;
    const eps = -1e-3;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5;
        const sy = py + 0.5;
        const w1 = ((sx - x0) * (y2 - y0) - (x2 - x0) * (sy - y0)) / det;
        const w2 = ((x1 - x0) * (sy - y0) - (sx - x0) * (y1 - y0)) / det;
        const w0 = 1 - w1 - w2;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        if (tex && face.u && face.v) {
          const u = Math.floor(w0 * face.u[0] + w1 * face.u[1] + w2 * face.u[2]);
          const v = Math.floor(w0 * face.v[0] + w1 * face.v[1] + w2 * face.v[2]);
          const rgb = tex.sample(u, v);
          if (rgb < 0) continue;
          pixels[py * size + px] = pack(shade(rgb, 0.55 + 0.45 * brightness));
        } else {
          pixels[py * size + px] = flat;
        }
      }
    }
  }

  function draw(): void {
    const p = project();
    const faces = visibleFaces(p);
    if (view.mode === "wire") {
      ctx.fillStyle = `#${BACKGROUND.toString(16).padStart(6, "0")}`;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "#6aa2ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const index of faces) {
        const [a, b, c] = mesh.faces[index]!.indices;
        ctx.moveTo(p.x[a]!, p.y[a]!);
        ctx.lineTo(p.x[b]!, p.y[b]!);
        ctx.lineTo(p.x[c]!, p.y[c]!);
        ctx.closePath();
      }
      ctx.stroke();
      return;
    }
    pixels.fill(background);
    for (const index of faces) {
      const face = mesh.faces[index]!;
      fillTriangle(p, face, light(p, face.indices), view.mode === "textured");
    }
    ctx.putImageData(image, 0, 0);
  }

  let queued = false;
  function redraw(): void {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try {
        draw();
      } catch (error) {
        console.error(error);
      }
    });
  }

  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    view.yaw += (event.clientX - drag.x) * 0.01;
    view.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch + (event.clientY - drag.y) * 0.01));
    drag = { x: event.clientX, y: event.clientY };
    redraw();
  });
  const endDrag = (): void => {
    drag = null;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      view.zoom = Math.max(0.2, Math.min(8, view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      redraw();
    },
    { passive: false },
  );

  const modes: [PreviewMode, string][] = [
    ["wire", "fil de fer"],
    ["flat", "uni ombré"],
    ["textured", "texturé"],
  ];
  const buttons = new Map<PreviewMode, HTMLButtonElement>();
  const refreshButtons = (): void => {
    for (const [mode, button] of buttons) button.setAttribute("aria-pressed", String(mode === view.mode));
  };
  const bar = h("div", { class: "bar" });
  for (const [mode, label] of modes) {
    const button = h("button", { type: "button" }, label);
    if (mode === "textured" && !hasTextures) button.disabled = true;
    button.addEventListener("click", () => {
      view.mode = mode;
      refreshButtons();
      redraw();
    });
    buttons.set(mode, button);
    bar.append(button);
  }
  const reset = h("button", { type: "button" }, "vue initiale");
  reset.addEventListener("click", () => {
    view.yaw = 0.6;
    view.pitch = 0.45;
    view.zoom = 1;
    redraw();
  });
  bar.append(reset, h("span", { class: "empty" }, "glisser : tourner · molette : zoom"));
  refreshButtons();
  redraw();

  return { element: h("div", { class: "preview3d-box" }, bar, canvas), view, dispose: () => void (queued = true) };
}
