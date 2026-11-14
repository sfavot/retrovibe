/**
 * Grilles de collision de la marche : 70 grilles, deux plans (le décor, fixe, et l'empreinte des objets posés ou retirés par les compacts).
 *
 * Référence : ScummVM engines/sky/grid.cpp et grid.h (`Grid::loadGrids`, `getGridValues`, `objectToWalk`, `removeObjectFromWalk`, `plotGrid`,
 * `removeGrid`, `giveGrid`, `_gridConvertTable`), skydefs.h (GPL v3 ou ultérieure). Le format d'une grille est dans `data/grid-file.ts`.
 *
 * Les deux plans sont ceux de ScummVM : la grille d'un écran est un tableau unique de 120 octets (un bit par bloc de 8 × 8 pixels) que
 * `plotGrid` / `objectToWalk` mettent à 1 et que `removeGrid` / `removeObjectFromWalk` remettent à 0, sans compteur : retirer un objet
 * efface aussi un blocage du décor sous lui, comme dans le jeu d'origine. `loadGrids` recharge les 70 fichiers (changement de section).
 *
 * Écarts volontaires : aucune grille pour un écran sans grille (`giveGrid` rend 0 dans ScummVM, qui plante ensuite) : ici `giveGrid` rend
 * `null` et l'appelant lève une erreur ; l'assertion de `getGridValues` (écran sans grille) lève une erreur au lieu d'un arrêt ; un fichier de
 * grille absent laisse la grille à `null` (ScummVM rend un pointeur nul).
 */

import { CompactField as F, MegaSetField } from "../../data/compact-fields";
import { GRID_COLUMNS, GRID_CONVERT_TABLE, GRID_FILE_START, TOT_NO_GRIDS } from "../../data/grid-file";
import type { Compacts, CompactView } from "../compacts";
import { Cpt, Var } from "../ids";
import type { WalkGrid } from "../services";

/** Coin haut gauche de l'écran de jeu dans les coordonnées des compacts (`skydefs.h`). */
export const TOP_LEFT_X = 128;
export const TOP_LEFT_Y = 136;
export const GAME_SCREEN_WIDTH = 320;
export const GAME_SCREEN_HEIGHT = 192;

/** Ce que `Grid` demande au moteur : fichiers, variables de script, compacts. */
export interface GridDeps {
  /** `Disk::loadFile` (copie modifiable). */
  readonly disk: { has(id: number): boolean; load(id: number): Uint8Array };
  readonly vars: Uint32Array;
  readonly compacts: Compacts;
}

/** Position d'un objet dans une grille : numéro de grille, numéro de bit de la première case, nombre de cases. */
interface GridSpan {
  grid: number;
  bitNum: number;
  width: number;
}

export class Grid implements WalkGrid {
  private readonly grids: (Uint8Array | null)[] = new Array<Uint8Array | null>(TOT_NO_GRIDS).fill(null);

  constructor(private readonly deps: GridDeps) {}

  /** `loadGrids` : les 70 grilles sont relues, puis la porte du Reich est rouverte si elle l'est (bogue de ScummVM : sinon on ne peut plus y passer). */
  loadGrids(): void {
    const { disk, vars, compacts } = this.deps;
    for (let n = 0; n < TOT_NO_GRIDS; n++) {
      const id = GRID_FILE_START + n;
      this.grids[n] = disk.has(id) ? disk.load(id) : null;
    }
    if (vars[Var.REICH_DOOR_FLAG]) this.removeGrid(256, 280, 1, compacts.require(Cpt.REICH_DOOR_20));
  }

  /** `giveGrid` : la grille de l'écran (120 octets, modifiable), `null` s'il n'y en a pas. */
  giveGrid(screen: number): Uint8Array | null {
    const index = GRID_CONVERT_TABLE[screen];
    return index !== undefined && index >= 0 && index < TOT_NO_GRIDS ? (this.grids[index] ?? null) : null;
  }

  /**
   * `getGridValues` : position de l'objet dans la grille, `null` s'il est hors de l'écran. Arithmétique `uint32` comme en C (une largeur
   * nulle de `plotGrid` donne `0xFFFFFFFF`).
   */
  private values(x: number, y: number, widthIn: number, screen: number): GridSpan | null {
    let width = widthIn >>> 0;
    y = y >>> 0;
    x = x >>> 0;
    if (y < TOP_LEFT_Y) return null; // hors de l'écran
    y = (y - TOP_LEFT_Y) >>> 3; // en blocs
    if (y >= GAME_SCREEN_HEIGHT >> 3) return null;
    let bitPos = y * GRID_COLUMNS;
    width = (width + 1) >>> 0;
    x >>>= 3;
    if (x < TOP_LEFT_X >> 3) {
      // en partie hors de l'écran
      if (((x + width) >>> 0) < TOP_LEFT_X >> 3) return null;
      width = (width - ((TOP_LEFT_X >> 3) - x)) >>> 0;
      x = 0;
    } else {
      x -= TOP_LEFT_X >> 3;
    }
    if (GAME_SCREEN_WIDTH >> 3 <= x) return null;
    if (GAME_SCREEN_WIDTH >> 3 < ((x + width) >>> 0)) width = (GAME_SCREEN_WIDTH >> 3) - x;
    bitPos += x;
    const grid = GRID_CONVERT_TABLE[screen];
    if (grid === undefined || grid < 0 || grid >= TOT_NO_GRIDS) throw new Error(`pas de grille pour l'écran ${screen}`);
    const bitInWord = 0x1f - (bitPos & 0x1f);
    return { grid, bitNum: (bitPos & ~0x1f) + bitInWord, width };
  }

  private spanOf(cpt: CompactView): GridSpan | null {
    const width = this.deps.compacts.megaSetWord(cpt, MegaSetField.gridWidth);
    return this.values(cpt[F.xcood]!, cpt[F.ycood]!, width, cpt[F.screen]!);
  }

  /** Pose (`set`) ou retire les `width` cases : même parcours des mots de 32 bits dans les deux cas. */
  private paint(span: GridSpan, set: boolean): void {
    const data = this.grids[span.grid];
    if (!data) throw new Error(`grille ${span.grid} non chargée`);
    let bitNum = span.bitNum;
    for (let n = 0; n < span.width; n++) {
      if (set) data[bitNum >> 3]! |= 1 << (bitNum & 7);
      else data[bitNum >> 3]! &= ~(1 << (bitNum & 7));
      if ((bitNum & 0x1f) === 0) bitNum += 0x3f;
      else bitNum--;
    }
  }

  removeObjectFromWalk(cpt: CompactView): void {
    const span = this.spanOf(cpt);
    if (span) this.paint(span, false);
  }

  objectToWalk(cpt: CompactView): void {
    const span = this.spanOf(cpt);
    if (span) this.paint(span, true);
  }

  /** `plotGrid` : comme `objectToWalk` avec position et largeur données (la largeur compte une case de moins). */
  plotGrid(x: number, y: number, width: number, cpt: CompactView): void {
    const span = this.values(x, y, (width - 1) >>> 0, cpt[F.screen]!);
    if (span) this.paint(span, true);
  }

  /** `removeGrid` : comme `removeObjectFromWalk` avec position et largeur données. */
  removeGrid(x: number, y: number, width: number, cpt: CompactView): void {
    const span = this.values(x, y, width, cpt[F.screen]!);
    if (span) this.paint(span, false);
  }
}
