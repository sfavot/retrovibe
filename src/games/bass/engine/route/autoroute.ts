/**
 * Cheminement : `AutoRoute::autoRoute`, la route d'un compact vers `arTargetX`, `arTargetY` sur la grille de son écran.
 *
 * Référence : ScummVM engines/sky/autoroute.cpp et autoroute.h (`initWalkGrid`, `calcWalkGrid`, `makeRouteData`, `checkInitMove`,
 * `clipCoordX`, `clipCoordY`, `checkBlock`, `autoRoute`), skydefs.h (`RIGHTY`, `LEFTY`, `DOWNY`, `UPY`, `ROUTE_SPACE`) (GPL v3 ou ultérieure).
 *
 * Algorithme (sans coût ni diagonale) : la grille de l'écran (40 × 24 blocs de 8 pixels) est copiée dans une grille de 42 × 26 mots bordée de
 * zéros ; chaque bloc infranchissable vaut `0xFFFF` et bloque aussi les `largeur` blocs suivants de sa ligne (la largeur du personnage,
 * `gridWidth`). Le départ vaut 1, puis des vagues donnent à chaque bloc libre 1 + le plus petit de ses voisins déjà numérotés, dans un
 * rectangle d'intérêt qui s'agrandit d'un bloc par côté tant que l'arrivée n'est pas atteinte. La route est relue de l'arrivée vers le
 * départ (ordre des voisins : gauche, droite, haut, bas) et écrite de la fin du tampon vers le début en segments `[distance, direction]`
 * (8 pixels par bloc) ; le tampon fait 64 octets. Un départ ou une arrivée hors de l'écran est ramené au bloc du bord ; un départ à
 * gauche ou à droite ajoute un premier segment horizontal. Codes de retour : 0 route écrite, 1 inaccessible, 2 déjà sur place.
 *
 * Rustine du bogue 1804 de ScummVM : sur l'écran 12 (l'usine à tuyaux), Foster qui vise le bloc (2, 14) bloqué par Joey le libère (sinon
 * la scène où Lamb jette Foster dehors boucle sans fin).
 *
 * Écarts volontaires : le tampon de 64 octets de ScummVM déborde (écriture avant son début, comportement indéfini) si la route compte plus de
 * 15 segments (16 avec le segment de départ hors écran) ; ici la route est alors refusée (code 1, `overflowed` vrai), de même pour une écriture
 * hors de la grille de travail (jamais vue). Un bloc de la bordure du haut ou du bas lit ses voisins hors de la grille de travail (départ sur
 * la première ou la dernière ligne : la plage d'intérêt déborde d'une ligne) : ScummVM lit alors la mémoire voisine du tampon (indéfini, nulle
 * en pratique) ; ici ces lectures valent 0, comme le tampon bordé de zéros du banc. L'écran d'un compact sans grille lève une erreur (ScummVM
 * déréférence un pointeur nul).
 */

import { CompactField as F, MegaSetField } from "../../data/compact-fields";
import { GRID_SIZE } from "../../data/grid-file";
import type { Compacts, CompactView } from "../compacts";
import { Cpt } from "../ids";
import type { RouteResult, Router } from "../services";
import { GAME_SCREEN_HEIGHT, GAME_SCREEN_WIDTH, TOP_LEFT_X, TOP_LEFT_Y } from "./grid";

const ROUTE_GRID_WIDTH = GAME_SCREEN_WIDTH / 8 + 2;
const ROUTE_GRID_HEIGHT = GAME_SCREEN_HEIGHT / 8 + 2;
const ROUTE_GRID_CELLS = ROUTE_GRID_WIDTH * ROUTE_GRID_HEIGHT;
/** Tampon de route : 64 octets (`ROUTE_SPACE`), soit 32 mots ou 16 segments de deux mots. */
export const ROUTE_WORDS = 32;
/** Pixels parcourus par bloc de route. */
const WALK_JUMP = 8;

/** Directions de la route (`skydefs.h`). */
const UPY = 0;
const DOWNY = 1;
const LEFTY = 2;
const RIGHTY = 3;

/** Voisins examinés dans l'ordre de ScummVM : décalage dans la grille de travail, et ordre de marche qu'il donne. */
const ROUTE_DIRECTIONS = [-1, 1, -ROUTE_GRID_WIDTH, ROUTE_GRID_WIDTH] as const;
const LOGIC_COMMANDS = [RIGHTY, LEFTY, DOWNY, UPY] as const;

/** Source des grilles de l'écran (`Grid::giveGrid`). */
export interface GridSource {
  giveGrid(screen: number): Uint8Array | null;
}

/** Valeur `int16` d'un entier de 16 bits ou plus. */
const int16 = (v: number): number => (v << 16) >> 16;

export class AutoRoute implements Router {
  /** Grille de travail (`_routeGrid`) : 0 libre à numéroter, `0xFFFF` bloc inaccessible, sinon distance + 1. */
  private readonly routeGrid = new Uint16Array(ROUTE_GRID_CELLS);
  /** Route compactée (`_routeBuf`), remplie de la fin vers le début. */
  private readonly routeBuf = new Uint16Array(ROUTE_WORDS);
  /** Dernier appel : route trop longue pour le tampon (voir l'en-tête). */
  overflowed = false;

  constructor(
    private readonly grid: GridSource,
    private readonly compacts: Compacts,
  ) {}

  /** Lecture de la grille de travail ; hors limites (voisin d'un bloc de la bordure), 0 : voir l'en-tête. */
  private at(index: number): number {
    return this.routeGrid[index] ?? 0;
  }

  /** Écriture dans la grille de travail ; hors limites, elle est perdue et la route sera refusée (voir l'en-tête). */
  private put(index: number, value: number): void {
    if (index < 0 || index >= ROUTE_GRID_CELLS) this.overflowed = true;
    else this.routeGrid[index] = value;
  }

  /** `checkBlock` : le plus petit voisin numéroté (non nul) du bloc, `0xFFFF` s'il n'y en a pas. */
  private checkBlock(pos: number): number {
    let result = 0xffff;
    for (let n = 0; n < 4; n++) {
      const value = this.at(pos + ROUTE_DIRECTIONS[n]!);
      if (value && value < result) result = value;
    }
    return result;
  }

  /** `clipCoordX` : bloc de la colonne (0 à 39) et dépassement (en pixels, signé) de `x` hors de l'écran. */
  private clipCoordX(x: number): { blk: number; init: number } {
    if (x < TOP_LEFT_X) return { blk: 0, init: int16(x - TOP_LEFT_X) };
    if (x >= TOP_LEFT_X + GAME_SCREEN_WIDTH) return { blk: (GAME_SCREEN_WIDTH - 1) >> 3, init: int16(x - (TOP_LEFT_X + GAME_SCREEN_WIDTH - 1)) };
    return { blk: (x - TOP_LEFT_X) >> 3, init: 0 };
  }

  /** `clipCoordY` (le dépassement vertical n'est pas utilisé par `autoRoute`). */
  private clipCoordY(y: number): { blk: number; init: number } {
    if (y < TOP_LEFT_Y) return { blk: 0, init: int16(y - TOP_LEFT_Y) };
    if (y >= TOP_LEFT_Y + GAME_SCREEN_HEIGHT) return { blk: (GAME_SCREEN_HEIGHT - 1) >> 3, init: int16(y - (TOP_LEFT_Y + GAME_SCREEN_HEIGHT)) };
    return { blk: (y - TOP_LEFT_Y) >> 3, init: 0 };
  }

  /** `initWalkGrid` : copie de la grille de l'écran, les blocs pleins élargis de `width` blocs vers la gauche de l'écran (ordre de lecture inversé). */
  private initWalkGrid(screen: number, width: number): void {
    const screenGrid = this.grid.giveGrid(screen);
    if (!screenGrid) throw new Error(`pas de grille pour l'écran ${screen}`);
    if (screenGrid.length < GRID_SIZE) throw new Error("grille trop courte");
    const view = new DataView(screenGrid.buffer, screenGrid.byteOffset, screenGrid.byteLength);
    this.routeGrid.fill(0);
    let pos = ROUTE_GRID_CELLS - ROUTE_GRID_WIDTH - 2;
    let offset = GRID_SIZE;
    let stretch = 0;
    let bitsLeft = 0;
    let data = 0;
    for (let y = 0; y < ROUTE_GRID_HEIGHT - 2; y++) {
      for (let x = 0; x < ROUTE_GRID_WIDTH - 2; x++) {
        if (!bitsLeft) {
          offset -= 4;
          data = view.getUint32(offset, true);
          bitsLeft = 32;
        }
        if (data & 1) {
          this.routeGrid[pos] = 0xffff; // bloc inaccessible
          stretch = width;
        } else if (stretch) {
          this.routeGrid[pos] = 0xffff;
          stretch--;
        }
        pos--;
        bitsLeft--;
        data >>>= 1;
      }
      pos -= 2;
      stretch = 0;
    }
  }

  /** `calcWalkGrid` : les vagues, dans un rectangle d'intérêt qui grandit. Vrai si l'arrivée est numérotée. */
  private calcWalkGrid(startX: number, startY: number, destX: number, destY: number): boolean {
    let directionX: number;
    let directionY: number;
    let roiX: number;
    let roiY: number;
    if (startY > destY) {
      directionY = -ROUTE_GRID_WIDTH;
      roiY = startY;
    } else {
      directionY = ROUTE_GRID_WIDTH;
      roiY = ROUTE_GRID_HEIGHT - 1 - startY;
    }
    if (startX > destX) {
      directionX = -1;
      roiX = startX + 2;
    } else {
      directionX = 1;
      roiX = ROUTE_GRID_WIDTH - 1 - startX;
    }

    const walkDest = (destY + 1) * ROUTE_GRID_WIDTH + destX + 1;
    let walkStart = (startY + 1) * ROUTE_GRID_WIDTH + startX + 1;
    this.put(walkStart, 1);

    // au bord, on part en diagonale
    if (roiY < ROUTE_GRID_HEIGHT - 3) walkStart -= directionY;
    if (roiX < ROUTE_GRID_WIDTH - 2) walkStart -= directionX;

    let gridChanged = true;
    let foundRoute = false;
    while (!foundRoute && gridChanged) {
      gridChanged = false;
      let yPos = walkStart;
      for (let cy = 0; cy < roiY; cy++) {
        let xPos = yPos;
        for (let cx = 0; cx < roiX; cx++) {
          if (!this.at(xPos)) {
            // bloc pas encore numéroté
            const value = this.checkBlock(xPos);
            if (value < 0xffff) {
              this.put(xPos, value + 1);
              gridChanged = true;
            }
          }
          xPos += directionX;
        }
        yPos += directionY;
      }
      if (this.at(walkDest)) {
        foundRoute = true;
      } else {
        // route introuvable : on agrandit le rectangle d'intérêt
        if (roiY < ROUTE_GRID_HEIGHT - 4) {
          walkStart -= directionY;
          roiY++;
        }
        if (roiX < ROUTE_GRID_WIDTH - 4) {
          walkStart -= directionX;
          roiX++;
        }
      }
    }
    return foundRoute;
  }

  /** `makeRouteData` : segments `[distance, direction]` de la fin du tampon vers le début ; rend l'indice du premier, négatif en cas de débordement. */
  private makeRouteData(destX: number, destY: number): number {
    const buf = this.routeBuf;
    buf.fill(0);
    let routePos = (destY + 1) * ROUTE_GRID_WIDTH + destX + 1;
    let target = ROUTE_WORDS - 2;
    let lastVal = (this.at(routePos) - 1) & 0xffff;
    while (lastVal) {
      // lastVal = 0 : la route est finie
      target -= 2;
      let walkDirection = 0;
      let command = 0;
      for (let n = 0; n < 4; n++) {
        if (lastVal === this.at(routePos + ROUTE_DIRECTIONS[n]!)) {
          command = LOGIC_COMMANDS[n]!;
          walkDirection = ROUTE_DIRECTIONS[n]!;
          break;
        }
      }
      if (!walkDirection) throw new Error(`makeRouteData : pas de chemin dans la grille (position ${lastVal})`);
      if (target < 0) return target; // le tampon de ScummVM déborde ici
      buf[target + 1] = command;
      while (lastVal && lastVal === this.at(routePos + walkDirection)) {
        buf[target] = (buf[target]! + WALK_JUMP) & 0xffff;
        lastVal--;
        routePos += walkDirection;
      }
    }
    return target;
  }

  /** `checkInitMove` : segment horizontal qui ramène un départ hors de l'écran sur le bord (distance arrondie au bloc supérieur). */
  private checkInitMove(target: number, initStaX: number): number {
    if (initStaX === 0) return target;
    target -= 2;
    if (target < 0) return target;
    if (initStaX < 0) {
      this.routeBuf[target + 1] = RIGHTY;
      this.routeBuf[target] = (-initStaX + 7) & 0xfff8;
    } else {
      this.routeBuf[target + 1] = LEFTY;
      this.routeBuf[target] = (initStaX + 7) & 0xfff8;
    }
    return target;
  }

  /** `autoRoute` : écrit la route dans le compact `animScratchId` du compact et rend le code (0 route, 1 inaccessible, 2 déjà sur place). */
  autoRoute(cpt: CompactView): RouteResult {
    this.overflowed = false;
    const screen = cpt[F.screen]! & 0xff;
    const width = this.compacts.megaSetWord(cpt, MegaSetField.gridWidth) & 0xff;
    this.initWalkGrid(screen, width);

    const sx = this.clipCoordX(cpt[F.xcood]!);
    const sy = this.clipCoordY(cpt[F.ycood]!);
    const dx = this.clipCoordX(cpt[F.arTargetX]!);
    const dy = this.clipCoordY(cpt[F.arTargetY]!);
    const startX = sx.blk;
    const startY = sy.blk;
    const destX = dx.blk;
    const destY = dy.blk;

    const routeDest = this.compacts.require(cpt[F.animScratchId]!);
    routeDest.fill(0, 0, ROUTE_WORDS);
    if (startX === destX && startY === destY) return 2;

    const destCell = (destY + 1) * ROUTE_GRID_WIDTH + destX + 1;
    if (this.at(destCell)) {
      if (this.compacts.isId(cpt, Cpt.FOSTER) && screen === 12 && destX === 2 && destY === 14) {
        // Rustine du bogue 1804 : Joey bloque l'arrivée de Foster ; on libère le bloc.
        this.routeGrid[destCell] = 0;
      } else {
        return 1; // l'arrivée est un bloc inaccessible
      }
    }

    if (!this.calcWalkGrid(startX, startY, destX, destY)) return 1; // aucune route jusqu'au bloc

    let first = this.makeRouteData(destX, destY);
    if (first >= 0) first = this.checkInitMove(first, sx.init);
    if (first < 0 || this.overflowed) {
      this.overflowed = true;
      routeDest.fill(0, 0, ROUTE_WORDS);
      return 1;
    }
    let n = 0;
    do {
      routeDest[n] = this.routeBuf[first + n]!;
      routeDest[n + 1] = this.routeBuf[first + n + 1]!;
      n += 2;
    } while (this.routeBuf[first + n - 2]);
    return 0;
  }
}
