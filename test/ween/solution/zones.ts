import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import type { DrawImpl, GraphicsSystems } from "../../../src/engine/coktel/graphics";
import { composeFrame } from "../../../src/engine/coktel/render/canvas";
import type { WeenGame } from "../../../src/games/ween/engine/ween";

/**
 * Zones actives d'un écran (`Hotspots`, tableau des zones du moteur) : de quoi viser juste plutôt que deviner.
 * Une zone est cliquable si elle n'est ni la fin du tableau, ni désactivée, dans la fenêtre 0, de type ≥ 1 (clic).
 */
export interface Zone {
  index: number;
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  type: number;
  button: number;
  key: number;
  enter: number;
  leave: number;
}

interface RawSpot {
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  flags: number;
  key: number;
  funcEnter: number;
  funcLeave: number;
  isEnd: boolean;
  isDisabled: boolean;
  type: number;
  button: number;
  window: number;
}

const i16 = (v: number): number => (v << 16) >> 16;

/** Zones actives (ni désactivées, ni d'une autre fenêtre). */
export function activeZones(game: WeenGame): Zone[] {
  const spots = (game.sys.hotspots as unknown as { spots: RawSpot[] }).spots;
  const out: Zone[] = [];
  for (let i = 0; i < spots.length && !spots[i].isEnd; i++) {
    const s = spots[i];
    if (!process.env.WEEN_ALL_ZONES && (s.isDisabled || s.window !== 0)) continue;
    out.push({
      index: i,
      id: s.id,
      left: i16(s.left),
      top: i16(s.top),
      right: i16(s.right),
      bottom: i16(s.bottom),
      type: s.type,
      button: s.button,
      key: s.key,
      enter: s.funcEnter,
      leave: s.funcLeave,
    });
  }
  return out;
}

/** Centre d'une zone (point de clic). */
export const center = (z: Zone): [number, number] => [(z.left + z.right) >> 1, (z.top + z.bottom) >> 1];

/** Une ligne par zone : indice, identifiant, rectangle, centre, type, bouton, clé, fonctions. */
export function formatZones(zones: Zone[]): string {
  return zones
    .map((z) => {
      const [cx, cy] = center(z);
      return `#${z.index} id=${z.id.toString(16)} [${z.left},${z.top}-${z.right},${z.bottom}] c=(${cx},${cy}) t=${z.type} b=${z.button} key=${z.key.toString(16)} in=${z.enter} out=${z.leave}`;
    })
    .join("\n");
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Écran affiché (×2), zones actives encadrées (`zones` vide : sans cadres), écrit en PNG. */
export function writeScreen(path: string, game: WeenGame, zones: Zone[] = []): void {
  const frame = composeFrame({ core: (game.sys.draw as DrawImpl).core } as GraphicsSystems, game.host.input.mouseX, game.host.input.mouseY);
  const { width: w, height: h } = frame;
  const s = 2;
  const out = new Uint8ClampedArray(w * s * h * s * 4);
  for (let y = 0; y < h * s; y++)
    for (let x = 0; x < w * s; x++) {
      const o = (((y / s) | 0) * w + ((x / s) | 0)) * 4;
      out.set(frame.rgba.subarray(o, o + 4), (y * w * s + x) * 4);
    }
  const put = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= w * s || y >= h * s) return;
    out.set([...c, 255], (y * w * s + x) * 4);
  };
  const colors: [number, number, number][] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 128, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
  ];
  for (const z of zones) {
    const c = colors[z.index % colors.length];
    for (let x = z.left * s; x <= z.right * s + 1; x++) {
      put(x, z.top * s, c);
      put(x, z.bottom * s + 1, c);
    }
    for (let y = z.top * s; y <= z.bottom * s + 1; y++) {
      put(z.left * s, y, c);
      put(z.right * s + 1, y, c);
    }
  }
  writeFileSync(path, png(w * s, h * s, out));
}
