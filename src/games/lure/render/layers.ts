/**
 * Calques d'une pièce et cellules de recouvrement : `RoomLayer`, `Room::blockMerge`, `layersPostProcess`, `addLayers`, `addCell`
 * (engines/lure/room.cpp, ScummVM, GPL v3+).
 *
 * Une pièce a jusqu'à quatre écrans : le fond (calque 0) et des calques d'avant-plan. Chaque calque est découpé en cellules de 32 x 32 dans
 * une grille de 18 x 14 (4 cellules de marge de chaque côté) ; une cellule d'avant-plan est « occupée » si elle contient un pixel non nul.
 * Quand un sprite passe derrière un calque, les cellules du calque qu'il touche sont recopiées par-dessus (pixels non nuls seulement) : c'est
 * ce qui fait passer Diermot derrière une colonne.
 *
 * Valeurs d'une cellule : `0xFF` inutilisée, `0xFE` voisine d'une cellule occupée (ajoutée par `layersPostProcess`, jamais copiée),
 * sinon son numéro.
 *
 * Écarts volontaires : une cellule hors de la grille (sprite qui déborde de l'écran) est ignorée ; ScummVM lirait ou écrirait la mémoire
 * voisine. `layersPostProcess` et `blockMerge` sont appelés dans `new RoomLayers`, comme `Room::setRoomNumber`.
 */

import type { LureData } from "../data/lure-data";
import { loadGameScreen } from "../data/picture";
import { FULL_SCREEN_WIDTH, MENUBAR_Y_SIZE } from "../engine/ids";
import type { Surface } from "./surface";

export const RECT_SIZE = 32;
export const NUM_HORIZ_RECTS = 10;
export const NUM_VERT_RECTS = 6;
export const FULL_HORIZ_RECTS = 18;
export const FULL_VERT_RECTS = 14;
export const NUM_EDGE_RECTS = 4;
export const MAX_NUM_LAYERS = 4;
const UNUSED = 0xff;
const NEAR = 0xfe;

/** `RoomLayer` : un écran décodé de 320 x 200 et sa grille de cellules. */
export class RoomLayer {
  readonly pixels: Uint8Array;
  private readonly cells = new Uint8Array(FULL_VERT_RECTS * FULL_HORIZ_RECTS).fill(UNUSED);

  constructor(data: LureData, screenId: number, backgroundLayer: boolean) {
    this.pixels = loadGameScreen(data.resources.get(screenId));
    let cellIndex = 0;
    for (let cellY = 0; cellY < NUM_VERT_RECTS; cellY++) {
      for (let cellX = 0; cellX < NUM_HORIZ_RECTS; cellX++) {
        let hasPixels = backgroundLayer;
        for (let yP = 0; yP < RECT_SIZE && !hasPixels; yP++) {
          const line = (cellY * RECT_SIZE + yP + MENUBAR_Y_SIZE) * FULL_SCREEN_WIDTH + cellX * RECT_SIZE;
          for (let xP = 0; xP < RECT_SIZE; xP++) {
            if (this.pixels[line + xP] !== 0) {
              hasPixels = true;
              break;
            }
          }
        }
        this.setCell(cellX + NUM_EDGE_RECTS, cellY + NUM_EDGE_RECTS, hasPixels ? cellIndex++ : UNUSED);
      }
    }
  }

  /** `getCell`, `0xFF` hors de la grille. */
  getCell(cellX: number, cellY: number): number {
    if (cellX < 0 || cellY < 0 || cellX >= FULL_HORIZ_RECTS || cellY >= FULL_VERT_RECTS) return UNUSED;
    return this.cells[cellY * FULL_HORIZ_RECTS + cellX]!;
  }

  setCell(cellX: number, cellY: number, value: number): void {
    if (cellX < 0 || cellY < 0 || cellX >= FULL_HORIZ_RECTS || cellY >= FULL_VERT_RECTS) return;
    this.cells[cellY * FULL_HORIZ_RECTS + cellX] = value;
  }

  isOccupied(cellX: number, cellY: number): boolean {
    return this.getCell(cellX, cellY) < NEAR;
  }
}

/** Les calques d'une pièce, prêts à recouvrir les sprites. */
export class RoomLayers {
  readonly layers: RoomLayer[] = [];

  /** `screenIds` : les écrans de la pièce (fond en premier) ; `Room::setRoomNumber` crée les calques, fusionne, puis étend. */
  constructor(data: LureData, screenIds: readonly number[]) {
    for (let i = 0; i < Math.min(screenIds.length, MAX_NUM_LAYERS); i++) this.layers.push(new RoomLayer(data, screenIds[i]!, i === 0));
    this.blockMerge();
    this.layersPostProcess();
  }

  get background(): RoomLayer {
    return this.layers[0]!;
  }

  /** `Room::blockMerge` : où deux calques occupent la même cellule, le plus tardif est recopié sur le plus précoce. */
  private blockMerge(): void {
    for (let layerNum1 = 0; layerNum1 < 3; layerNum1++) {
      const first = this.layers[layerNum1];
      if (!first) break;
      for (let layerNum2 = layerNum1 + 1; layerNum2 < 4; layerNum2++) {
        const second = this.layers[layerNum2];
        if (!second) break;
        for (let yp = 0; yp < NUM_VERT_RECTS; yp++) {
          for (let xp = 0; xp < NUM_HORIZ_RECTS; xp++) {
            if (!first.isOccupied(xp + NUM_EDGE_RECTS, yp + NUM_EDGE_RECTS) || !second.isOccupied(xp + NUM_EDGE_RECTS, yp + NUM_EDGE_RECTS)) continue;
            const offset = (yp * RECT_SIZE + MENUBAR_Y_SIZE) * FULL_SCREEN_WIDTH + xp * RECT_SIZE;
            for (let y = 0; y < RECT_SIZE; y++) {
              for (let x = 0; x < RECT_SIZE; x++) {
                const at = offset + y * FULL_SCREEN_WIDTH + x;
                if (second.pixels[at] !== 0) first.pixels[at] = second.pixels[at]!;
              }
            }
          }
        }
      }
    }
  }

  /** `Room::layersPostProcess` : cellules voisines marquées, dernière rangée prolongée sous l'écran. */
  private layersPostProcess(): void {
    for (let layerNum = 1; layerNum < 4; layerNum++) {
      const layer = this.layers[layerNum];
      if (!layer) continue;
      for (let xp = NUM_EDGE_RECTS; xp < NUM_HORIZ_RECTS + NUM_EDGE_RECTS; xp++) {
        let priorFlag = false;
        let nextFlag = false;
        for (let yp = NUM_EDGE_RECTS; yp < NUM_VERT_RECTS + NUM_EDGE_RECTS; yp++) {
          if (layer.getCell(xp, yp) === UNUSED) {
            priorFlag = false;
            nextFlag = false;
            continue;
          }
          if (priorFlag && layer.getCell(xp - 1, yp) === UNUSED) layer.setCell(xp - 1, yp, NEAR);
          if (nextFlag && layer.getCell(xp + 1, yp) === UNUSED) layer.setCell(xp + 1, yp, NEAR);
          priorFlag = layer.getCell(xp - 1, yp) !== UNUSED;
          nextFlag = layer.getCell(xp + 1, yp) !== UNUSED;
        }
      }
      for (let xp = NUM_EDGE_RECTS + NUM_HORIZ_RECTS - 1; xp >= NUM_EDGE_RECTS; xp--) {
        if (layer.getCell(xp, NUM_EDGE_RECTS + NUM_VERT_RECTS - 1) !== UNUSED) {
          for (let yp = NUM_VERT_RECTS + NUM_EDGE_RECTS; yp < FULL_VERT_RECTS; yp++) layer.setCell(xp, yp, NEAR);
        }
      }
    }
  }

  /** `Layer::copyTo(screen)` : le fond (calque 0) recopié dans l'écran. */
  drawBackground(screen: Surface): void {
    screen.data.set(this.background.pixels.subarray(0, screen.data.length));
  }

  /**
   * `Room::addLayers(h)` : après le dessin d'un sprite de la zone `x`, `y`, `width`, `heightCopy` (coordonnées d'écran), recouvre les
   * cellules des calques d'avant-plan qu'il touche.
   */
  addLayers(screen: Surface, x: number, y: number, width: number, heightCopy: number): void {
    const hsX = x + NUM_EDGE_RECTS * RECT_SIZE;
    const hsY = y + NUM_EDGE_RECTS * RECT_SIZE - MENUBAR_Y_SIZE;
    let xStart = Math.trunc(hsX / RECT_SIZE);
    const xEnd = Math.trunc((hsX + width) / RECT_SIZE);
    const numX = xEnd - xStart + 1;
    const yStart = Math.trunc(hsY / RECT_SIZE);
    const yEnd = Math.trunc((hsY + heightCopy - 1) / RECT_SIZE);
    const numY = yEnd - yStart + 1;
    if (xStart < 0 || yEnd < 0) return;

    for (let xCtr = 0; xCtr < numX; xCtr++, xStart++) {
      const xs = xStart - NUM_EDGE_RECTS;
      if (xs < 0) continue;
      let layerNum = 1;
      while (layerNum < 4 && this.layers[layerNum] && this.layers[layerNum]!.getCell(xStart, yEnd) === UNUSED) layerNum++;
      if (layerNum === 4 || !this.layers[layerNum]) continue;
      let ye = yEnd - NUM_EDGE_RECTS;
      for (let yCtr = 0; yCtr < numY; yCtr++, ye--) {
        if (ye < 0) break;
        this.addCell(screen, xs, ye, layerNum);
      }
    }
  }

  /** `Room::addCell` : la cellule (`xp`, `yp`) du premier calque occupé à partir de `layerNum`, pixels non nuls seulement. */
  private addCell(screen: Surface, xp: number, yp: number, layerNum: number): void {
    while (layerNum < 4 && this.layers[layerNum] && this.layers[layerNum]!.getCell(xp + NUM_EDGE_RECTS, yp + NUM_EDGE_RECTS) >= NEAR) layerNum++;
    if (layerNum === 4 || !this.layers[layerNum]) return;
    if (xp >= NUM_HORIZ_RECTS || yp >= NUM_VERT_RECTS) return;
    const src = this.layers[layerNum]!.pixels;
    const index = (yp * RECT_SIZE + MENUBAR_Y_SIZE) * FULL_SCREEN_WIDTH + xp * RECT_SIZE;
    for (let y = 0; y < RECT_SIZE; y++) {
      for (let x = 0; x < RECT_SIZE; x++) {
        const at = index + y * FULL_SCREEN_WIDTH + x;
        const pixel = src[at]!;
        if (pixel !== 0) screen.data[at] = pixel;
      }
    }
  }
}
