/**
 * `BamScene` : l'animation de la course de voiture (pièce 74) et du combat final (pièce 69) : trois bobs (camion ou Frank, Rico ou le
 * robot, effet) dont la position et l'image viennent d'une table lue ligne par ligne, une ligne par image du jeu. Réécriture de
 * `BamScene::prepareAnimation`, `updateCarAnimation` et `updateFightAnimation` (engines/queen/graphics.cpp, ScummVM, GPL v3 ou
 * ultérieure). Le moteur (logique des états, des bobs, des effets, de la secousse) est ici ; **les tables** (`_carData`, `_fight1Data`
 * à `_fight3Data`) sont fournies par les groupes de pièces qui jouent l'animation (groupe 4 : voiture, groupe 5 : combat), qui
 * enregistrent `bam.updateCar(…)` ou `bam.updateFight(…)` comme `roomUpdates` de leur pièce (`GameScript.roomUpdates`).
 *
 * Écarts : seule la version DOS est portée (le combat tire sa table suivante au hasard parmi les trois ; la table `_fight4Data` de
 * l'Amiga est écartée) ; le hasard est celui du jeu (`g.rng`).
 */

import type { FotaqEngine } from "../loop";
import { requireGameStage } from "../stage";
import { shake } from "./kit";

/** Un objet d'une ligne de table : position et image (négative : retourné, combat seulement). */
export interface BamObject {
  x: number;
  y: number;
  frame: number;
}

/** Une ligne de table (`BamDataBlock`) : le camion ou Frank, Rico ou le robot, l'effet, et la commande `sfx`. */
export interface BamDataBlock {
  obj1: BamObject;
  obj2: BamObject;
  fx: BamObject;
  /** Voiture : négatif = morceau `-sfx`, 2 = effet sonore de la pièce, 99 = fin. Combat : 0 rien, 1 secousse, 2 effet, 3 effet et secousse, 99 fin. */
  sfx: number;
}

/** Raccourci d'écriture des tables : `bam([x, y, f], [x, y, f], [x, y, f], sfx)`. */
export const bam = (obj1: readonly [number, number, number], obj2: readonly [number, number, number], fx: readonly [number, number, number], sfx: number): BamDataBlock => ({
  obj1: { x: obj1[0], y: obj1[1], frame: obj1[2] },
  obj2: { x: obj2[0], y: obj2[1], frame: obj2[2] },
  fx: { x: fx[0], y: fx[1], frame: fx[2] },
  sfx,
});

/** État de l'animation (`BamScene::_flag`) : en marche, arrêt demandé (le cycle finit), arrêtée. */
export const BamFlag = { Stop: 0, Play: 1, RequestStop: 2 } as const;
export type BamFlag = (typeof BamFlag)[keyof typeof BamFlag];

/** Emplacements des trois bobs (`BOB_OBJ1`, `BOB_OBJ2`, `BOB_FX`). */
const BOB_OBJ1 = 5;
const BOB_OBJ2 = 6;
const BOB_FX = 7;

/** Ce que la sauvegarde garde de l'animation (`BamScene::saveState` n'écrit que `_flag` ; la ligne et la table du combat en plus). */
export interface SavedBam {
  flag: BamFlag;
  /** Ligne de la table en cours. */
  index: number;
  screenShaked: boolean;
  /** Rang, parmi les tables du combat, de la table en cours. */
  fightTable: number;
}

export class BamScene {
  /**
   * `_flag` : sauvegardé par ScummVM (`saveState`) ; au chargement, `restore` rappelle `prepare` s'il ne vaut pas `Stop`
   * (`Logic::setupRestoredGame`).
   */
  flag: BamFlag = BamFlag.Stop;
  private _index = 0;
  private screenShaked = false;
  /** Rang de la table du combat en cours (`tables[fightTable]`). */
  private fightTable = 0;

  /** `_index` : ligne de la table en cours (lue par le mouvement 31, `asmWaitForCarPosition`). */
  get index(): number {
    return this._index;
  }

  /** `prepareAnimation` : les trois bobs sont remis à zéro et allumés, la table repart de sa première ligne. */
  prepare(g: FotaqEngine): void {
    const { bobs } = requireGameStage(g);
    for (const n of [BOB_OBJ1, BOB_OBJ2, BOB_FX]) {
      bobs.clearBob(n);
      bobs.bob(n).active = true;
    }
    this._index = 0;
  }

  /** `updateCarAnimation` : une ligne de la table de la voiture par image. */
  updateCar(g: FotaqEngine, data: readonly BamDataBlock[]): void {
    if (this.flag === BamFlag.Stop) return;
    const { bobs } = requireGameStage(g);
    const row = data[this._index];
    bobs.bob(BOB_OBJ1).curPos(row.obj1.x, row.obj1.y);
    bobs.bob(BOB_OBJ1).frameNum = 40 + row.obj1.frame;
    bobs.bob(BOB_OBJ2).curPos(row.obj2.x, row.obj2.y);
    bobs.bob(BOB_OBJ2).frameNum = 30 + row.obj2.frame;
    bobs.bob(BOB_FX).curPos(row.fx.x, row.fx.y);
    bobs.bob(BOB_FX).frameNum = 41 + row.fx.frame;
    if (row.sfx < 0) g.host.playSong(-row.sfx);
    if (row.sfx === 99) this._index = 0;
    else this._index++;
    if (row.sfx === 2) requireGameStage(g).playRoomSfx();
  }

  /**
   * `updateFightAnimation` : une ligne de la table du combat par image ; en fin de table (99) le combat repart sur l'une des trois
   * tables au hasard. `tables[0]` est la table de départ.
   */
  updateFight(g: FotaqEngine, tables: readonly (readonly BamDataBlock[])[]): void {
    if (this.flag === BamFlag.Stop) return;
    const fight = tables[this.fightTable] ?? tables[0];
    const stage = requireGameStage(g);
    const { bobs } = stage;
    const row = fight[this._index];
    const place = (n: number, o: BamObject) => {
      const bob = bobs.bob(n);
      bob.curPos(o.x, o.y);
      bob.frameNum = 40 + Math.abs(o.frame);
      bob.xflip = o.frame < 0;
    };
    place(BOB_OBJ1, row.obj1);
    place(BOB_OBJ2, row.obj2);
    place(BOB_FX, row.fx);
    if (row.sfx < 0) g.host.playSong(-row.sfx);
    this._index++;
    switch (row.sfx) {
      case 0:
        if (this.screenShaked) {
          shake(g, false);
          this.screenShaked = false;
        }
        break;
      case 1:
        shake(g, true);
        this.screenShaked = true;
        break;
      case 2:
        stage.playRoomSfx();
        break;
      case 3:
        stage.playRoomSfx();
        shake(g, true);
        this.screenShaked = true;
        break;
      case 99:
        this._index = 0;
        this.fightTable = g.rng.inclusive(2);
        if (this.flag === BamFlag.RequestStop) this.flag = BamFlag.Stop;
        break;
    }
  }

  /** L'état à sauvegarder. */
  snapshot(): SavedBam {
    return { flag: this.flag, index: this._index, screenShaked: this.screenShaked, fightTable: this.fightTable };
  }

  /** Arrête l'animation sans toucher aux bobs (avant de réafficher la pièce d'une partie chargée : `restore` la relance ensuite). */
  halt(): void {
    this.flag = BamFlag.Stop;
    this._index = 0;
    this.screenShaked = false;
    this.fightTable = 0;
  }

  /**
   * Reprise d'une partie chargée, la pièce étant affichée (`Logic::setupRestoredGame` : `prepareAnimation` si `_flag` n'est pas
   * `Stop`). Écart : ScummVM repart de la première ligne de la table ; la ligne, la table du combat et la secousse sont reprises,
   * pour que la course et le combat continuent là où ils étaient (le mouvement 31 attend une ligne précise).
   */
  restore(g: FotaqEngine, saved: SavedBam): void {
    this.flag = saved.flag;
    this.fightTable = saved.fightTable;
    if (saved.flag !== BamFlag.Stop) this.prepare(g);
    this._index = saved.index;
    this.screenShaked = saved.screenShaked;
    if (saved.screenShaked) shake(g, true);
  }
}
