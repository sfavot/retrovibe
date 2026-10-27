/**
 * Pointeur : prise et dépose de pièces (cliquer-poser ou glisser), tests de prise, curseurs.
 *
 * Original (engine.md §5.1, hidden.md §1.4, patterns.md §1.4, sticklers.md §1.6) :
 *  - deux modes selon la préférence `DS:02b8` du roster (`roster.clickAndStick`, défaut **cliquer-poser**) ;
 *  - **cliquer-poser** : un clic sur une pièce la prend, elle suit la souris sans que le bouton soit tenu, et le clic suivant **n'importe où**
 *    la dépose ; tant qu'elle est portée, elle capte tous les clics (on ne peut pas cliquer un bouton) ;
 *  - **glisser** : l'appui sur la pièce la prend, elle suit tant que **ce bouton** est tenu, le relâchement la dépose ;
 *  - les trois boutons (gauche, droit, milieu) prennent et déposent ; en glisser, c'est le bouton qui a pris qui doit rester enfoncé ;
 *  - la pièce suit la souris à chaque **tick** (pas sur `mousemove`) : position vivante `Input.mouseX / mouseY`, ramenée dans la zone
 *    autorisée (centre rétréci de la demi-taille de la pièce : la pièce reste entièrement dans la zone) ;
 *  - une pièce portée suit le curseur avec le décalage de prise (`grab`) ou son centre (`"center"`, Puzzle Patterns).
 *
 * Écarts assumés : pendant le port, **tous** les événements bouton (même un autre bouton en mode glisser) sont pris par le pointeur et
 * n'atteignent pas les gadgets ; un appui et un relâchement dans le même tick donnent donc une prise suivie d'une dépose sur place.
 *
 * Les pièces appartiennent à la scène : elle fournit `source.pick(x, y, event)` (rectangle englobant, cellule, pixel : voir `hitShapeAt`),
 * l'ordre « pièce du dessus d'abord » est le sien. Le pointeur ne dessine rien : la scène réagit à `onPick`, `onMove` et `onDrop`.
 *
 * Curseurs : `CursorController` choisit le curseur (flèche, « ? » du mode aide, caché pendant le port) et appelle `host.setCursor`
 * via le moteur ; le sablier est imposé par le moteur pendant un chargement. Les bitmaps `CURS` de `MILKYWAY.DAT` se décodent par
 * `decodeCursor` (format : formats.md « CURS ») et s'exposent à l'hôte navigateur en PNG (`loadCursorImages`).
 */
import type { Shape } from "../../../data/mohawk/shap";
import { hitTestShape } from "./graphics/blit";
import { PLAY_HEIGHT, PLAY_WIDTH } from "./graphics/frame";
import type { Rect } from "./graphics/surface";
import type { CursorKind } from "./host";
import type { ButtonEvent, MouseButton } from "./input";
import { defineService } from "./scene";

export type PointerMode = "clickAndStick" | "drag";

// --- Géométrie et tests de prise ---

export const PLAY_AREA: Rect = { x: 0, y: 0, w: PLAY_WIDTH, h: PLAY_HEIGHT };

/**
 * Coin haut-gauche d'une pièce `w × h` ramené dans `bounds` pour qu'elle y reste entièrement (équivalent de « zone rétrécie de la
 * demi-taille, centre ramené dedans », `10b0:075e` / `10b0:068c`). Pièce plus grande que la zone : collée au bord haut-gauche.
 */
export function clampToBounds(x: number, y: number, w: number, h: number, bounds: Rect): { x: number; y: number } {
  const maxX = Math.max(bounds.x, bounds.x + bounds.w - w);
  const maxY = Math.max(bounds.y, bounds.y + bounds.h - h);
  return { x: Math.min(Math.max(x, bounds.x), maxX), y: Math.min(Math.max(y, bounds.y), maxY) };
}

/** Le point `(x, y)` (écran) touche-t-il un pixel opaque de la forme posée à `(originX, originY)` ? (Sticklers : au pixel, sur le masque.) */
export function hitShapeAt(shape: Shape, originX: number, originY: number, x: number, y: number): boolean {
  return hitTestShape(shape, x - originX, y - originY);
}

/** Premier élément touché dans `items` (le tableau va du dessus vers le dessous, comme `DS:8364` des puzzles) ; `undefined` si aucun. */
export function pickTopmost<T>(items: readonly T[], hit: (item: T) => boolean): T | undefined {
  for (const item of items) if (hit(item)) return item;
  return undefined;
}

// --- Pièce portée ---

/** Ce que la scène répond à une demande de prise. */
export interface PickResult<T> {
  item: T;
  /** Coin haut-gauche de la pièce au moment de la prise, et sa taille (pour la découpe dans la zone). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Décalage pointeur → coin de la pièce : `{x, y}` fixe, `"center"` (le centre suit le curseur) ou absent (garde l'écart de la prise). */
  grab?: { x: number; y: number } | "center";
}

export interface PickSource<T> {
  /** Pièce prise par un appui en `(x, y)`, ou `null`. Appelé seulement quand rien n'est porté. */
  pick(x: number, y: number, event: ButtonEvent): PickResult<T> | null;
}

export interface Carried<T> {
  readonly item: T;
  /** Bouton qui a pris (en glisser, celui qui doit rester enfoncé). */
  readonly button: MouseButton;
  /** Mode en vigueur à la prise. */
  readonly mode: PointerMode;
  /** Coin haut-gauche actuel. */
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  readonly grabX: number;
  readonly grabY: number;
  /** Position de la prise. */
  readonly startX: number;
  readonly startY: number;
  /** Le relâchement du bouton est surveillé à chaque tick (prise par événement en mode glisser). */
  readonly tracksButton: boolean;
}

export interface PointerListener<T> {
  /** La pièce vient d'être prise (son de prise, remontée au rang 0…). */
  onPick?(carried: Carried<T>, event: ButtonEvent | null): void;
  /** La pièce a changé de position (suivi de la souris), après découpe dans la zone. */
  onMove?(carried: Carried<T>): void;
  /** La pièce est déposée à `carried.x / y` ; `event` est le clic ou le relâchement (absent : perte du bouton, annulation douce). */
  onDrop?(carried: Carried<T>, event: ButtonEvent | null): void;
}

// --- Curseurs ---

/**
 * Choisit le curseur affiché : caché pendant un port (si demandé), « ? » en mode aide au survol d'une zone d'aide, sinon le curseur de base.
 * N'appelle `apply` que sur changement.
 */
export class CursorController {
  private base: CursorKind = "arrow";
  private helpHover = false;
  private carrying = false;
  private shown: CursorKind | null = null;
  /** Cache le curseur système pendant qu'une pièce est portée. Défaut faux. */
  hideWhileCarrying = false;

  constructor(private readonly apply: (cursor: CursorKind) => void) {}

  /** Curseur de la scène (flèche par défaut ; `hidden` pour les scènes qui dessinent leur pointeur). */
  setBase(cursor: CursorKind): void {
    this.base = cursor;
    this.refresh();
  }

  /** Mode aide : survol d'une zone qui montre le « ? » (voir `helpCursorAt`). */
  setHelpHover(hover: boolean): void {
    this.helpHover = hover;
    this.refresh();
  }

  setCarrying(carrying: boolean): void {
    this.carrying = carrying;
    this.refresh();
  }

  get current(): CursorKind {
    if (this.carrying && this.hideWhileCarrying) return "hidden";
    if (this.helpHover) return "help";
    return this.base;
  }

  /** Remet tout à zéro (sortie de scène). */
  reset(): void {
    this.base = "arrow";
    this.helpHover = false;
    this.carrying = false;
    this.hideWhileCarrying = false;
    this.refresh();
  }

  private refresh(): void {
    const cursor = this.current;
    if (cursor !== this.shown) {
      this.shown = cursor;
      this.apply(cursor);
    }
  }
}

export interface PointerDeps {
  /** Mode courant (`roster.clickAndStick ? "clickAndStick" : "drag"`), relu à chaque prise. */
  mode: () => PointerMode;
  /** Envoie le curseur au moteur (`ctx.setCursor`). */
  setCursor?: (cursor: CursorKind) => void;
}

/** Le strict nécessaire de `Input` pour suivre la souris (facilite les tests). */
export interface PointerInput {
  readonly mouseX: number;
  readonly mouseY: number;
  isButtonDown(button: MouseButton): boolean;
}

export class PointerService<T = unknown> {
  readonly cursor: CursorController;
  /** Zone où la pièce reste entièrement (toute la zone de jeu par défaut). */
  bounds: Rect = PLAY_AREA;
  /** Fournisseur de prises de la scène ; `null` : rien à prendre. */
  source: PickSource<T> | null = null;
  listener: PointerListener<T> = {};
  private carriedPiece: Carried<T> | null = null;

  constructor(private readonly deps: PointerDeps) {
    this.cursor = new CursorController(deps.setCursor ?? (() => {}));
  }

  get mode(): PointerMode {
    return this.deps.mode();
  }

  /** La pièce portée, ou `null`. */
  get carried(): Carried<T> | null {
    return this.carriedPiece;
  }

  /** Une pièce est portée : elle capte les clics (les gadgets ne doivent pas les voir). */
  get capturesClicks(): boolean {
    return this.carriedPiece !== null;
  }

  /** Événement bouton de la file de `Input`, dans l'ordre. Renvoie vrai s'il est pris par le pointeur. */
  handleButton(event: ButtonEvent): boolean {
    const carried = this.carriedPiece;
    if (carried) {
      if (carried.mode === "drag") {
        if (!event.down && event.button === carried.button) this.dropAt(event.x, event.y, event);
      } else if (event.down) {
        this.dropAt(event.x, event.y, event);
      }
      return true;
    }
    if (!event.down || !this.source) return false;
    const result = this.source.pick(event.x, event.y, event);
    if (!result) return false;
    this.begin(result, event.button, event.x, event.y, event);
    return true;
  }

  /** Commence un port sans passer par `source` (la scène décide : vignette de Sticklers, pièce tirée à droite). `mode` : celui du pointeur. */
  carry(result: PickResult<T>, button: MouseButton, x: number, y: number): Carried<T> {
    this.cancel();
    return this.begin(result, button, x, y, null, false);
  }

  /** Un tick : la pièce suit la souris vivante ; en glisser, un bouton relâché sans événement (perte du focus) dépose sur place. */
  tick(input: PointerInput): void {
    const carried = this.carriedPiece;
    if (!carried) return;
    if (carried.mode === "drag" && carried.tracksButton && !input.isButtonDown(carried.button)) {
      this.dropAt(input.mouseX, input.mouseY, null);
      return;
    }
    this.moveTo(carried, input.mouseX, input.mouseY);
  }

  /** Dépose la pièce là où elle est (ou en `(x, y)` si fourni) : la scène reçoit `onDrop` sans événement. */
  drop(x?: number, y?: number): void {
    const carried = this.carriedPiece;
    if (!carried) return;
    if (x !== undefined && y !== undefined) this.moveTo(carried, x, y);
    this.finish(carried, null);
  }

  /** Abandonne le port sans `onDrop` (sortie de scène). */
  cancel(): void {
    if (!this.carriedPiece) return;
    this.carriedPiece = null;
    this.cursor.setCarrying(false);
  }

  /** Remet le pointeur à zéro (sortie de scène). */
  reset(): void {
    this.cancel();
    this.source = null;
    this.listener = {};
    this.bounds = PLAY_AREA;
    this.cursor.reset();
  }

  private begin(result: PickResult<T>, button: MouseButton, x: number, y: number, event: ButtonEvent | null, tracksButton = true): Carried<T> {
    const grab = result.grab;
    const grabX = grab === "center" ? Math.floor(result.width / 2) : grab ? grab.x : x - result.x;
    const grabY = grab === "center" ? Math.floor(result.height / 2) : grab ? grab.y : y - result.y;
    const mode = this.mode;
    const at = clampToBounds(x - grabX, y - grabY, result.width, result.height, this.bounds);
    const carried: Carried<T> = {
      item: result.item,
      button,
      mode,
      x: at.x,
      y: at.y,
      width: result.width,
      height: result.height,
      grabX,
      grabY,
      startX: result.x,
      startY: result.y,
      tracksButton: tracksButton && mode === "drag",
    };
    this.carriedPiece = carried;
    this.cursor.setCarrying(true);
    this.listener.onPick?.(carried, event);
    return carried;
  }

  private moveTo(carried: Carried<T>, px: number, py: number): void {
    const at = clampToBounds(px - carried.grabX, py - carried.grabY, carried.width, carried.height, this.bounds);
    if (at.x === carried.x && at.y === carried.y) return;
    carried.x = at.x;
    carried.y = at.y;
    this.listener.onMove?.(carried);
  }

  private dropAt(x: number, y: number, event: ButtonEvent | null): void {
    const carried = this.carriedPiece;
    if (!carried) return;
    this.moveTo(carried, x, y);
    this.finish(carried, event);
  }

  private finish(carried: Carried<T>, event: ButtonEvent | null): void {
    this.carriedPiece = null;
    this.cursor.setCarrying(false);
    this.listener.onDrop?.(carried, event);
  }
}

// --- Curseurs CURS ---

/** Ids des curseurs dans `MILKYWAY.DAT` : `watch cursor` et `question mark cursor` (`1008:0000`). */
export const CURS_BUSY_ID = 1;
export const CURS_HELP_ID = 2;
export const CURS_SIZE = 16;
export const CURS_BYTES = 68;

export interface CursorBitmap {
  readonly width: number;
  readonly height: number;
  readonly hotspotX: number;
  readonly hotspotY: number;
  /** `width × height × 4` octets RGBA (noir, blanc ou transparent). */
  readonly rgba: Uint8Array;
}

/**
 * Décode une ressource `CURS` (68 octets, big-endian, voir formats.md) : 16 mots d'**image** (bit à 1 = pixel noir), 16 mots de **masque**
 * (bit à 1 = pixel opaque), puis le point chaud `x`, `y` (u16). Pixel opaque : noir si le bit d'image est à 1, blanc sinon ; hors masque :
 * transparent. Le bit de poids fort est le pixel de gauche.
 */
export function decodeCursor(bytes: Uint8Array): CursorBitmap {
  if (bytes.length < CURS_BYTES) throw new Error(`CURS : ${bytes.length} octets, ${CURS_BYTES} attendus`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rgba = new Uint8Array(CURS_SIZE * CURS_SIZE * 4);
  for (let y = 0; y < CURS_SIZE; y++) {
    const image = view.getUint16(y * 2, false);
    const mask = view.getUint16(32 + y * 2, false);
    for (let x = 0; x < CURS_SIZE; x++) {
      const bit = 15 - x;
      if (((mask >> bit) & 1) === 0) continue;
      const value = ((image >> bit) & 1) === 1 ? 0 : 255;
      rgba.set([value, value, value, 255], (y * CURS_SIZE + x) * 4);
    }
  }
  return { width: CURS_SIZE, height: CURS_SIZE, hotspotX: view.getUint16(64, false), hotspotY: view.getUint16(66, false), rgba };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const v of bytes) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** PNG RGBA 8 bits sans compression (blocs `deflate` « stockés ») : suffisant pour un curseur de 16 × 16 et sans dépendance. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    z[at++] = i === blocks - 1 ? 1 : 0;
    z[at++] = part.length & 0xff;
    z[at++] = part.length >> 8;
    z[at++] = ~part.length & 0xff;
    z[at++] = (~part.length >> 8) & 0xff;
    z.set(part, at);
    at += part.length;
  }
  new DataView(z.buffer).setUint32(at, adler32(raw));
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, filtre standard, sans entrelacement
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", header), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Curseur prêt pour l'hôte navigateur. */
export interface CursorImage {
  /** `data:image/png;base64,…` */
  readonly dataUrl: string;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly width: number;
  readonly height: number;
}

export function cursorImage(bitmap: CursorBitmap): CursorImage {
  return {
    dataUrl: `data:image/png;base64,${toBase64(encodePng(bitmap.width, bitmap.height, bitmap.rgba))}`,
    hotspotX: bitmap.hotspotX,
    hotspotY: bitmap.hotspotY,
    width: bitmap.width,
    height: bitmap.height,
  };
}

/** Valeur de la propriété CSS `cursor` pour l'image (`fallback` : curseur système si l'image échoue). */
export function cssCursor(image: CursorImage, fallback: string): string {
  return `url("${image.dataUrl}") ${image.hotspotX} ${image.hotspotY}, ${fallback}`;
}

export interface CursorImages {
  /** `CURS` 1, la montre (`CursorKind` `busy`). */
  busy: CursorImage;
  /** `CURS` 2, le point d'interrogation (`CursorKind` `help`). */
  help: CursorImage;
}

/** Décode les deux curseurs de `MILKYWAY.DAT` (ouvert en `persistent` au démarrage). L'hôte navigateur applique `cssCursor`. */
export function loadCursorImages(archive: { raw(tag: string, id: number): Uint8Array }): CursorImages {
  return {
    busy: cursorImage(decodeCursor(archive.raw("CURS", CURS_BUSY_ID))),
    help: cursorImage(decodeCursor(archive.raw("CURS", CURS_HELP_ID))),
  };
}

export const POINTER = defineService<PointerService>("mathemagique.pointer");
