/**
 * Moteur de sprites d'un tour : `recreate`, `spriteEngine` (`doSprites`, `sortSprites`) et `flip`, sur l'état du moteur.
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::recreate`, `spriteEngine`, `doSprites`, `sortSprites`, `flip`), skydefs.h
 * (GPL v3 ou ultérieure), lu puis réécrit. Les primitives (`drawSprite`, `verticalMask`, `markBlocks`…) sont celles de `draw.ts` ; ce module
 * y ajoute le parcours des listes de dessin et la lecture des variables, des compacts et des fichiers chargés.
 *
 * Règles reprises :
 * - listes de dessin : variables `DRAW_LIST_NO`, `DRAW_LIST_NO + 1`… jusqu'à la première nulle ; chaque variable désigne un compact dont les
 *   mots sont des identifiants de compacts, terminés par 0 ; un mot `0xFFFF` renvoie à la liste dont l'identifiant suit (chaînage) ;
 * - couche `BACK` (bit 0 du `status`) puis sprites triables (bit 2, triés par liste de dessin) puis couche `FORE` (bit 1) ; seuls les compacts
 *   de l'écran courant (`screen == SCREEN`) sont dessinés ; le fichier de sprites est celui de `frame >> 6` (`fetchItem`), son image
 *   `frame & 0x3F` ; un fichier absent met le `status` du compact à 0 ;
 * - après chaque sprite : `markBlocks(0x81)` si `status & 8` (recomposition du décor au tour suivant), sinon `markBlocks(1)` ; le masque
 *   vertical suit chaque sprite de la couche `BACK` et chaque sprite trié dont `status & 0x200` est nul.
 *
 * Écarts volontaires : un fichier de sprites illisible ou une image hors du fichier est ignoré (ScummVM lirait au-delà du tampon) ; au-delà de
 * 30 sprites triés dans une liste, les suivants sont ignorés (ScummVM écrit hors du tableau) ; un fichier de décor absent lève une erreur
 * comme l'`error()` de `recreate`.
 */

import { CompactField as F } from "../data/compact-fields";
import { Var } from "../engine/ids";
import type { CompactView } from "../engine/compacts";
import { SpriteFile, frameIndexOf, spriteFileOf } from "../data/sprite";
import {
  GRID_FLIP,
  type MaskLayer,
  MAX_SORTED_SPRITES,
  type SpriteBlocks,
  drawSprite,
  markBlocks,
  recreateBackground,
  sortSprites,
  spriteSortKey,
  verticalMask,
} from "./draw";
import { GRID_X, GRID_Y, GRID_H, GRID_W, SCREEN_WIDTH } from "./frame-buffer";

/** Ce que le moteur de sprites lit de la partie (satisfait par `BassEngine`). */
export interface SpriteSource {
  readonly compacts: { require(id: number): CompactView };
  /** Variables de script (`Logic::_scriptVariables`). */
  readonly vars: ArrayLike<number>;
  /** Fichiers chargés (`SkyEngine::fetchItem`). */
  readonly items: { fetch(num: number): Uint8Array | null };
  log?(message: string): void;
}

/** Bit 0 (`BACK`) et bit 1 (`FORE`) du `status` d'un compact. */
export const LAYER_BACK = 0;
export const LAYER_FORE = 1;

const ST_SORT = 4;
const ST_RECREATE = 8;
const NO_VERTICAL_MASK = 0x200;

export class SpriteEngine {
  /** Grille de jeu (20 x 24) : bit `0x80` = bloc à recopier depuis le décor, bit 1 = bloc à envoyer à l'écran (`_gameGrid`). */
  readonly grid = new Uint8Array(GRID_X * GRID_Y).fill(0x80); // `Screen::Screen` appelle `forceRefresh`
  private readonly grids = new WeakMap<Uint8Array, Uint16Array>();

  /** `Screen::forceRefresh` : tout le décor sera recopié. */
  forceRefresh(): void {
    this.grid.fill(0x80);
  }

  /** `Screen::recreate` : recopie dans `screen` (lignes de 320) les blocs de décor marqués. */
  recreate(source: SpriteSource, screen: Uint8Array): void {
    const id = source.vars[Var.LAYER_0_ID]!;
    if (!id) return;
    const blocks = source.items.fetch(id);
    if (!blocks) throw new Error(`Screen::recreate : fichier de décor ${id} (LAYER_0_ID) absent`);
    recreateBackground(screen, blocks, this.grid);
  }

  /** `Screen::spriteEngine` : couche arrière, sprites triés, couche avant. */
  spriteEngine(source: SpriteSource, screen: Uint8Array): void {
    this.doSprites(source, screen, LAYER_BACK);
    this.sortSprites(source, screen);
    this.doSprites(source, screen, LAYER_FORE);
  }

  /**
   * `Screen::flip` : blocs marqués (bit 1), à recopier de `screen` vers `display` (bit retiré). Rend le nombre de blocs envoyés.
   * Les blocs d'une ligne contiguë sont recopiés d'un coup comme `renderRect`.
   */
  flip(screen: Uint8Array, display: Uint8Array): number {
    let sent = 0;
    for (let by = 0; by < GRID_Y; by++) {
      let runStart = -1;
      for (let bx = 0; bx <= GRID_X; bx++) {
        const marked = bx < GRID_X && (this.grid[by * GRID_X + bx]! & GRID_FLIP) !== 0;
        if (marked) {
          this.grid[by * GRID_X + bx]! &= ~GRID_FLIP;
          sent++;
          if (runStart < 0) runStart = bx;
        } else if (runStart >= 0) {
          copyBlocks(screen, display, runStart, by, bx - runStart);
          runStart = -1;
        }
      }
    }
    return sent;
  }

  /** En-tête relu à chaque fois : le moteur de texte peut remplacer ou modifier le sprite d'un compact de texte d'un tour à l'autre. */
  private spriteFile(data: Uint8Array): SpriteFile | null {
    try {
      return new SpriteFile(data);
    } catch {
      return null;
    }
  }

  /** Sprite d'un compact : `null` (et `status = 0` si le fichier manque) quand il n'y a rien à dessiner. */
  private spriteOf(source: SpriteSource, cpt: CompactView): SpriteFile | null {
    const data = source.items.fetch(spriteFileOf(cpt[F.frame]!));
    if (!data) {
      cpt[F.status] = 0;
      return null;
    }
    const file = this.spriteFile(data);
    return file && frameIndexOf(cpt[F.frame]!) < file.frameCount ? file : null;
  }

  private maskLayers(source: SpriteSource): ReadonlyArray<MaskLayer | undefined> {
    const layers: (MaskLayer | undefined)[] = [];
    for (let n = 0; n < 3; n++) {
      const pixels = source.vars[Var.LAYER_1_ID + n] ? source.items.fetch(source.vars[Var.LAYER_1_ID + n]!) : null;
      const gridBytes = source.vars[Var.GRID_1_ID + n] ? source.items.fetch(source.vars[Var.GRID_1_ID + n]!) : null;
      layers.push(pixels && gridBytes ? { pixels, grid: this.gridWords(gridBytes) } : undefined);
    }
    return layers;
  }

  /** Grille d'une couche (`GRID_n_ID`) : mots de 16 bits, petit-boutiste, comme `FROM_LE_16`. */
  private gridWords(bytes: Uint8Array): Uint16Array {
    let words = this.grids.get(bytes);
    if (!words) {
      words = new Uint16Array(GRID_X * GRID_Y);
      for (let i = 0; i < words.length && 2 * i + 1 < bytes.length; i++) words[i] = bytes[2 * i]! | (bytes[2 * i + 1]! << 8);
      this.grids.set(bytes, words);
    }
    return words;
  }

  /** Dessine un sprite puis marque les blocs ; le masque vertical est facultatif (`mask`). */
  private draw(source: SpriteSource, screen: Uint8Array, cpt: CompactView, file: SpriteFile, mask: boolean): void {
    const blocks: SpriteBlocks | null = drawSprite(screen, file, frameIndexOf(cpt[F.frame]!), cpt[F.xcood]!, cpt[F.ycood]!);
    if (!blocks) return;
    // `doSprites` masque avant de marquer, `sortSprites` après : sans effet sur le résultat (le masque ne lit pas la grille de jeu).
    if (mask) verticalMask(screen, blocks, this.maskLayers(source));
    markBlocks(this.grid, blocks, cpt[F.status]! & ST_RECREATE ? 0x81 : 1);
  }

  /** Parcourt les listes de dessin ; `visit` reçoit chaque compact (chaînage `0xFFFF` suivi). */
  private forEachDrawList(source: SpriteSource, visit: (cpt: CompactView) => void): void {
    for (let n = Var.DRAW_LIST_NO; source.vars[n]; n++) {
      let list = source.compacts.require(source.vars[n]!);
      let p = 0;
      while (list[p]) {
        while (list[p] !== 0 && list[p] !== 0xffff) {
          visit(source.compacts.require(list[p]!));
          p++;
        }
        while (list[p] === 0xffff) {
          list = source.compacts.require(list[p + 1]!);
          p = 0;
        }
      }
    }
  }

  /** `Screen::doSprites(layer)`. */
  private doSprites(source: SpriteSource, screen: Uint8Array, layer: number): void {
    const bit = 1 << layer;
    this.forEachDrawList(source, (cpt) => {
      if (!(cpt[F.status]! & bit) || cpt[F.screen] !== source.vars[Var.SCREEN]) return;
      const file = this.spriteOf(source, cpt);
      if (file) this.draw(source, screen, cpt, file, layer === LAYER_BACK);
    });
  }

  /** `Screen::sortSprites` : une liste triée par variable de liste de dessin (les sprites d'une chaîne forment une seule liste). */
  private sortSprites(source: SpriteSource, screen: Uint8Array): void {
    for (let n = Var.DRAW_LIST_NO; source.vars[n]; n++) {
      const sorted: { key: number; cpt: CompactView; file: SpriteFile }[] = [];
      let list = source.compacts.require(source.vars[n]!);
      let p = 0;
      while (list[p]) {
        if (list[p] === 0xffff) {
          list = source.compacts.require(list[p + 1]!);
          p = 0;
          continue;
        }
        const cpt = source.compacts.require(list[p]!);
        p++;
        if (!(cpt[F.status]! & ST_SORT) || cpt[F.screen] !== source.vars[Var.SCREEN]) continue;
        const file = this.spriteOf(source, cpt);
        if (file && sorted.length < MAX_SORTED_SPRITES) sorted.push({ key: spriteSortKey(cpt[F.ycood]!, file), cpt, file });
      }
      sortSprites(sorted, (s) => s.key);
      for (const s of sorted) this.draw(source, screen, s.cpt, s.file, !(s.cpt[F.status]! & NO_VERTICAL_MASK));
    }
  }
}

/** Copie `count` blocs de 16 x 8 d'une rangée de blocs (`renderRect`). */
function copyBlocks(screen: Uint8Array, display: Uint8Array, bx: number, by: number, count: number): void {
  let pos = by * GRID_H * SCREEN_WIDTH + bx * GRID_W;
  const width = count * GRID_W;
  for (let line = 0; line < GRID_H; line++) {
    display.set(screen.subarray(pos, pos + width), pos);
    pos += SCREEN_WIDTH;
  }
}
