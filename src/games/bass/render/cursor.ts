/**
 * Curseurs de la souris : fichiers 60300 (curseurs du jeu), 60301 (curseurs d'objets) et 60302 (curseurs d'objets de la section de Linc).
 *
 * Référence : ScummVM engines/sky/mouse.cpp (`Mouse::Mouse`, `spriteMouse`, `fnOpenCloseHand`, `findMouseCursor`, `replaceMouseCursors`,
 * `_mouseMainObjects`, `_mouseLincObjects`), logic.cpp (`fnNormalMouse`, `fnDiskMouse`, `fnBlankMouse`, `fnCrossMouse`, `fnRightMouse`,
 * `fnLeftMouse`, `fnDownMouse`, `fnUpMouse`, `fnEnterSection`, `fnLeaveSection`), skydefs.h (`MOUSE_*`) (GPL v3 ou ultérieure).
 *
 * Format : des fichiers de sprites ordinaires (`SpriteFile`) de 22 x 22 ; la couleur 0 est la transparence (`replaceCursor(..., keycolor 0)`).
 * Fichier 60300 : 9 images, numérotées par `MOUSE_*` (0 = main tenant un objet, remplacée à chaud par `fnOpenCloseHand`). Fichiers 60301 et
 * 60302 : deux images par objet (`2 * rang` main fermée, `2 * rang + 1` main ouverte).
 *
 * Écart volontaire : le curseur n'est pas confié à un système, il est dessiné par-dessus l'image de l'écran (`CursorOverlay`, ou
 * `drawCursor` / `cursorRgba` pour un hôte qui préfère le dessiner lui-même). Comme `CursorMan` dans ScummVM, il n'est jamais dans
 * `BassScreenRenderer.frame` : les images comparées au banc n'en portent pas.
 */

import { SpriteFile } from "../data/sprite";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./frame-buffer";

export const CURSOR_FILE = 60300;
export const OBJECT_CURSOR_FILE = 60301;
export const LINC_OBJECT_CURSOR_FILE = 60302;

/** Numéros d'image du fichier 60300 (`MOUSE_*`). */
export const MouseCursor = {
  heldObject: 0,
  normal: 1,
  disk: 2,
  down: 3,
  right: 4,
  left: 5,
  blank: 6,
  cross: 7,
  up: 8,
} as const;

export interface CursorHotspot {
  readonly x: number;
  readonly y: number;
}

/** Point chaud passé à `spriteMouse` par chaque mcode de curseur. */
export const MOUSE_HOTSPOTS: Readonly<Record<number, CursorHotspot>> = {
  [MouseCursor.normal]: { x: 0, y: 0 },
  [MouseCursor.disk]: { x: 11, y: 11 },
  [MouseCursor.blank]: { x: 0, y: 0 },
  [MouseCursor.cross]: { x: 4, y: 4 },
  [MouseCursor.right]: { x: 9, y: 4 },
  [MouseCursor.left]: { x: 0, y: 5 },
  [MouseCursor.down]: { x: 9, y: 4 },
  [MouseCursor.up]: { x: 9, y: 4 },
  /** Objet tenu (`fnOpenCloseHand`). */
  [MouseCursor.heldObject]: { x: 5, y: 5 },
};

/** `_mouseMainObjects` : identifiants de compacts d'objets, dans l'ordre des curseurs de 60301. */
export const MOUSE_MAIN_OBJECTS: readonly number[] = [
  65, 9, 66, 64, 8, 63, 10, 11, 71, 76, 37, 36, 42, 75, 79, 6, 74, 39, 49, 43, 34, 35, 77, 38,
];

/** `_mouseLincObjects` : idem pour 60302. */
export const MOUSE_LINC_OBJECTS: readonly number[] = [
  24625, 24649, 24827, 24651, 24583, 24581, 24582, 24628, 24650, 24629, 24732, 24631, 24584, 24630, 24626, 24627, 24632, 24643, 24828, 24830, 24829,
];

/**
 * `Mouse::findMouseCursor` : rang du curseur d'un objet. Comme dans ScummVM la recherche porte d'abord sur les objets principaux, puis sur
 * ceux de Linc, et un objet inconnu rend 0.
 */
export function findMouseCursor(itemId: number): number {
  const main = MOUSE_MAIN_OBJECTS.indexOf(itemId);
  if (main >= 0) return main;
  const linc = MOUSE_LINC_OBJECTS.indexOf(itemId);
  return linc >= 0 ? linc : 0;
}

/** Un curseur prêt à dessiner : pixels `width x height` (0 transparent) et point chaud. */
export interface CursorImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly hotspot: CursorHotspot;
}

/**
 * Ce que `engine/mouse.ts` (`Mouse`) donne du curseur : numéro d'image (`MOUSE_*`), point chaud, image d'objet tenu (`-1` sans objet) et le
 * fichier d'où elle vient, position du pointeur de la machine.
 */
export interface CursorState {
  readonly cursor: number;
  readonly cursorHotspot: readonly [number, number];
  readonly objectCursor: number;
  readonly heldCursorFile: number;
  readonly pointerX: number;
  readonly pointerY: number;
}

/** État des curseurs de `Mouse` : images du jeu (modifiables : l'image 0 reçoit l'objet tenu) et fichier des objets. */
export class CursorSet {
  private readonly mice: Uint8Array[];
  private objects: SpriteFile;
  /** `_currentCursor`. */
  current: number = MouseCursor.blank;

  constructor(
    private readonly miceFile: SpriteFile,
    objectsFile: SpriteFile,
  ) {
    this.objects = objectsFile;
    // Copies : `fnOpenCloseHand` écrase l'image 0 sur place.
    this.mice = Array.from({ length: miceFile.frameCount }, (_, i) => new Uint8Array(miceFile.frame(i)));
  }

  /** `replaceMouseCursors` (60301 hors de la section 5, 60302 dans la section 5). */
  replaceObjectCursors(file: SpriteFile): void {
    this.objects = file;
  }

  /** Image à dessiner pour l'état de `Mouse` du moteur : `spriteMouse`, après `fnOpenCloseHand` si un objet est tenu. `null` : curseur masqué. */
  fromMouse(state: CursorState): CursorImage | null {
    if (state.cursor === MouseCursor.heldObject && state.objectCursor >= 0) {
      this.mice[MouseCursor.heldObject]!.set(this.objects.frame(state.objectCursor).subarray(0, this.mice[MouseCursor.heldObject]!.length));
    }
    return this.spriteMouse(state.cursor, { x: state.cursorHotspot[0], y: state.cursorHotspot[1] });
  }

  /** `spriteMouse` : choisit l'image `frame` ; `null` si le curseur est masqué (`MOUSE_BLANK`). */
  spriteMouse(frame: number, hotspot: CursorHotspot = MOUSE_HOTSPOTS[frame] ?? { x: 0, y: 0 }): CursorImage | null {
    this.current = frame;
    if (frame === MouseCursor.blank) return null;
    const pixels = this.mice[frame];
    if (!pixels) throw new RangeError(`curseur ${frame} hors de 0 à ${this.mice.length - 1}`);
    return { width: this.miceFile.width, height: this.miceFile.height, pixels, hotspot };
  }

  /**
   * `fnOpenCloseHand` : sans objet tenu et main fermée, retombe sur le curseur normal ; sinon copie l'image d'objet (`2 * rang`, `+ 1` main
   * ouverte) dans l'image 0 et l'affiche avec le point chaud (5, 5).
   */
  openCloseHand(open: boolean, heldObject: number): CursorImage | null {
    if (!open && !heldObject) return this.spriteMouse(MouseCursor.normal, MOUSE_HOTSPOTS[MouseCursor.normal]);
    const frame = (findMouseCursor(heldObject) << 1) + (open ? 1 : 0);
    this.mice[MouseCursor.heldObject]!.set(this.objects.frame(frame).subarray(0, this.mice[MouseCursor.heldObject]!.length));
    return this.spriteMouse(MouseCursor.heldObject, MOUSE_HOTSPOTS[MouseCursor.heldObject]);
  }
}

/** Dessine `cursor` dans un écran 320 x 200 : son coin haut-gauche est (`x - hotspot.x`, `y - hotspot.y`) ; rogné, 0 transparent. */
export function drawCursor(dest: Uint8Array, cursor: CursorImage, x: number, y: number): void {
  const left = x - cursor.hotspot.x;
  const top = y - cursor.hotspot.y;
  for (let cy = 0; cy < cursor.height; cy++) {
    const py = top + cy;
    if (py < 0 || py >= SCREEN_HEIGHT) continue;
    for (let cx = 0; cx < cursor.width; cx++) {
      const px = left + cx;
      if (px < 0 || px >= SCREEN_WIDTH) continue;
      const pixel = cursor.pixels[cy * cursor.width + cx]!;
      if (pixel) dest[py * SCREEN_WIDTH + px] = pixel;
    }
  }
}

/** Curseur en RGBA (`width x height x 4`, alpha 0 pour la couleur 0) pour un curseur matériel ou un élément de page. */
export function cursorRgba(cursor: CursorImage, palette: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cursor.width * cursor.height * 4);
  for (let i = 0; i < cursor.pixels.length; i++) {
    const p = cursor.pixels[i]!;
    if (!p) continue;
    out[i * 4] = palette[p * 3]!;
    out[i * 4 + 1] = palette[p * 3 + 1]!;
    out[i * 4 + 2] = palette[p * 3 + 2]!;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Le curseur par-dessus l'écran : charge les fichiers 60300 (curseurs), 60301 et 60302 (objets) à la demande par `load`, choisit l'image
 * d'après `Mouse` et la dessine à la position du pointeur de la machine, avec la palette de l'écran (comme `CursorMan` sans palette
 * propre : un fondu ou la pause assombrit aussi le curseur). `load` rend `null` pour un fichier absent (curseur alors invisible).
 */
export class CursorOverlay {
  private set: CursorSet | null = null;
  private readonly files = new Map<number, SpriteFile | null>();

  constructor(private readonly load: (fileId: number) => Uint8Array | null) {}

  private file(id: number): SpriteFile | null {
    if (!this.files.has(id)) {
      const bytes = this.load(id);
      this.files.set(id, bytes ? new SpriteFile(bytes) : null);
    }
    return this.files.get(id)!;
  }

  /** Image du curseur pour cet état, `null` s'il est masqué ou si ses fichiers manquent. */
  image(state: CursorState): CursorImage | null {
    const mice = this.file(CURSOR_FILE);
    if (!mice) return null;
    if (!this.set) {
      const objects = this.file(OBJECT_CURSOR_FILE);
      if (!objects) return null;
      this.set = new CursorSet(mice, objects);
    }
    const held = state.cursor === MouseCursor.heldObject && state.objectCursor >= 0;
    if (held) {
      const objects = this.file(state.heldCursorFile);
      if (!objects) return null;
      this.set.replaceObjectCursors(objects);
    }
    return this.set.fromMouse(state);
  }

  /**
   * Dessine le curseur dans `rgba` (`SCREEN_WIDTH x SCREEN_HEIGHT x 4`, alpha 255 déjà posé par l'écran) avec `palette` (768 octets RVB) ;
   * rogné aux bords, couleur 0 transparente. Rend vrai s'il a dessiné quelque chose.
   */
  draw(rgba: Uint8Array | Uint8ClampedArray, palette: Uint8Array, state: CursorState): boolean {
    const cursor = this.image(state);
    if (!cursor) return false;
    const left = state.pointerX - cursor.hotspot.x;
    const top = state.pointerY - cursor.hotspot.y;
    let drawn = false;
    for (let cy = 0; cy < cursor.height; cy++) {
      const py = top + cy;
      if (py < 0 || py >= SCREEN_HEIGHT) continue;
      for (let cx = 0; cx < cursor.width; cx++) {
        const px = left + cx;
        if (px < 0 || px >= SCREEN_WIDTH) continue;
        const pixel = cursor.pixels[cy * cursor.width + cx]!;
        if (!pixel) continue;
        const o = (py * SCREEN_WIDTH + px) * 4;
        rgba[o] = palette[pixel * 3]!;
        rgba[o + 1] = palette[pixel * 3 + 1]!;
        rgba[o + 2] = palette[pixel * 3 + 2]!;
        rgba[o + 3] = 255;
        drawn = true;
      }
    }
    return drawn;
  }
}
