/**
 * Liste des cellules (`cellHead`) : objets affichés, masques, zones, messages ; son ordre décide du dessin, du hit-test et des réveils.
 *
 * Référence : `engines/cruise/cell.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `addCell` (insertion triée par Z, refus des
 * doublons), `createTextObject` (messages en queue), `removeCell`, `linkCell`, `freezeCell`, `sortCells`, et `function.cpp::freeObjectList`.
 * Lu puis réécrit.
 *
 * La liste est un vrai double chaînage, réécrit pas à pas comme dans ScummVM : les pointeurs `prev` (parcourus à l'envers par
 * `findObject`) ont les mêmes valeurs, y compris quand ScummVM les laisse incohérents. La tête n'est pas une cellule du jeu ;
 * `head.prev` est la dernière cellule, et la première a `prev = null`.
 */
import { ObjType } from "./ids";
import { getSingleObjectParam } from "./objects";
import type { EngineState } from "./state";

export interface Cell {
  next: Cell | null;
  prev: Cell | null;
  idx: number;
  type: number;
  overlay: number;
  x: number;
  /** Y d'un message (`field_C`). */
  fieldC: number;
  /** Largeur d'un message (`spriteIdx`). */
  spriteIdx: number;
  color: number;
  backgroundPlane: number;
  freeze: number;
  parent: number;
  parentOverlay: number;
  parentType: number;
  followObjectOverlayIdx: number;
  followObjectIdx: number;
  animStart: number;
  animEnd: number;
  animWait: number;
  animStep: number;
  animChange: number;
  animType: number;
  animSignal: number;
  animCounter: number;
  animLoop: number;
  /** Texte rendu d'un message (`gfxPtr`), fourni par le rendu (vague R2) ; `null` sans rendu. */
  gfx: unknown;
}

function blankCell(): Cell {
  return {
    next: null, prev: null, idx: 0, type: 0, overlay: 0, x: 0, fieldC: 0, spriteIdx: 0, color: 0, backgroundPlane: 0, freeze: 0,
    parent: 0, parentOverlay: 0, parentType: 0, followObjectOverlayIdx: 0, followObjectIdx: 0, animStart: 0, animEnd: 0, animWait: 0,
    animStep: 0, animChange: 0, animType: 0, animSignal: 0, animCounter: 0, animLoop: 0, gfx: null,
  };
}

export class CellList {
  /** Tête (`cellHead`), jamais une cellule du jeu. */
  readonly head: Cell = blankCell();

  /** Cellules dans l'ordre de la liste. */
  *[Symbol.iterator](): IterableIterator<Cell> {
    for (let c = this.head.next; c; c = c.next) yield c;
  }

  toArray(): Cell[] {
    return [...this];
  }

  /** `resetPtr`. */
  reset(): void {
    this.head.next = null;
    this.head.prev = null;
  }

  /**
   * `addCell` : insère avant la première cellule (hors messages, arrêt sur une cellule VIRTUAL) de Z supérieur ou égal ; refuse un
   * doublon placé là. Renvoie la cellule, ou `null`.
   */
  add(e: EngineState, ovl: number, obj: number, type: number, plane: number, scriptOvl: number, scriptNum: number, scriptType: number): Cell | null {
    const z = getSingleObjectParam(e, ovl, obj, 2);
    if (z === null) return null;
    let prev3: Cell = this.head;
    let cur2 = this.head.next;
    while (cur2 && cur2.type !== ObjType.VIRTUAL) {
      if (cur2.type !== ObjType.MESSAGE) {
        const z2 = getSingleObjectParam(e, cur2.overlay, cur2.idx, 2);
        if (z2 !== null && z2 >= z) break;
      }
      prev3 = cur2;
      cur2 = cur2.next;
    }
    if (cur2 && cur2.overlay === ovl && cur2.backgroundPlane === plane && cur2.idx === obj && cur2.type === type) return null;

    const cell = blankCell();
    cell.next = prev3.next;
    prev3.next = cell;
    cell.idx = obj;
    cell.type = type;
    cell.backgroundPlane = plane;
    cell.overlay = ovl;
    cell.parent = scriptNum;
    cell.parentOverlay = scriptOvl;
    cell.followObjectIdx = obj;
    cell.followObjectOverlayIdx = ovl;
    cell.parentType = scriptType;
    if (cur2) {
      cell.prev = cur2.prev;
      cur2.prev = cell;
    } else {
      cell.prev = this.head.prev;
      this.head.prev = cell;
    }
    return cell;
  }

  /** `createTextObject` sans le rendu : cellule MESSAGE ajoutée en queue. */
  addText(ovl: number, messageIdx: number, x: number, y: number, width: number, color: number, plane: number, parentOvl: number, parentIdx: number): Cell {
    let last: Cell = this.head;
    while (last.next) last = last.next;
    const cell = blankCell();
    cell.next = last.next;
    last.next = cell;
    cell.idx = messageIdx;
    cell.type = ObjType.MESSAGE;
    cell.backgroundPlane = plane;
    cell.overlay = ovl;
    cell.x = x;
    cell.fieldC = y;
    cell.spriteIdx = width;
    cell.color = color;
    cell.parent = parentIdx;
    cell.parentOverlay = parentOvl;
    cell.prev = this.head.prev;
    this.head.prev = cell;
    return cell;
  }

  /** `removeCell` : −1 = joker pour chaque critère. Les cellules retirées passent par `onFree` (libération du texte rendu). */
  remove(ovl: number, idx: number, type: number, plane: number, onFree?: (cell: Cell) => void): void {
    for (let c = this.head.next; c; c = c.next) {
      if ((c.overlay === ovl || ovl === -1) && (c.idx === idx || idx === -1) && (c.type === type || type === -1) && (c.backgroundPlane === plane || plane === -1)) {
        c.type = -1;
      }
    }
    let previous: Cell = this.head;
    let cur = this.head.next;
    while (cur) {
      if (cur.type === -1) {
        previous.next = cur.next;
        const dx = cur.next ?? this.head;
        dx.prev = cur.prev;
        onFree?.(cur);
        // ScummVM continue à `dx`, qui est la tête si la cellule était la dernière : la boucle s'arrête alors (tête sans suivante
        // après la coupure) ou repart de la tête, dont `next` a été mis à jour.
        cur = dx === this.head ? null : dx;
      } else {
        previous = cur;
        cur = cur.next;
      }
    }
  }

  /** `linkCell` : position et frame relatives à un autre objet. La tête est parcourue aussi (comme ScummVM). */
  link(ovl: number, obj: number, type: number, ovl2: number, obj2: number): void {
    for (let c: Cell | null = this.head; c; c = c.next) {
      if ((c.overlay === ovl || ovl === -1) && (c.idx === obj || obj === -1) && (c.type === type || type === -1)) {
        c.followObjectIdx = obj2;
        c.followObjectOverlayIdx = ovl2;
      }
    }
  }

  /** `freezeCell` (tête comprise, comme ScummVM). */
  freeze(ovl: number, idx: number, type: number, plane: number, oldFreeze: number, newFreeze: number): void {
    for (let c: Cell | null = this.head; c; c = c.next) {
      if ((c.overlay === ovl || ovl === -1) && (c.idx === idx || idx === -1) && (c.type === type || type === -1) && (c.backgroundPlane === plane || plane === -1) && (c.freeze === oldFreeze || oldFreeze === -1)) {
        c.freeze = newFreeze;
      }
    }
  }

  /**
   * `freeObjectList` (`Op_FreeCell`) : libère les cellules non gelées, puis vide la tête dès qu'il y avait une cellule (les cellules
   * gelées sont donc perdues aussi, comme dans ScummVM).
   */
  freeAll(onFree?: (cell: Cell) => void): void {
    let any = false;
    for (let c = this.head.next; c; c = c.next) {
      if (c.freeze === 0) onFree?.(c);
      any = true;
    }
    if (any) this.reset();
  }

  /** `sortCells` : déplace toutes les cellules de l'objet après la dernière de Z inférieur (messages comptés Z = 32000). */
  sortCells(e: EngineState, ovl: number, obj: number): void {
    // Objet introuvable : ScummVM garde une variable non initialisée (ici 0) ; `objz` garde la valeur de la cellule précédente.
    const sobjz = getSingleObjectParam(e, ovl, obj, 2) ?? 0;
    let objz = 0;
    const provHead: { next: Cell | null; prev: Cell | null } = { next: null, prev: null };
    let pl: Cell = this.head;
    let pl2 = pl.next;
    let pllast: Cell | null = null;
    let plz: Cell = this.head;
    while (pl2) {
      const pl3 = pl2.next;
      if (pl2.overlay === ovl && pl2.idx === obj) {
        pl.next = pl3;
        if (pl3) pl3.prev = pl2.prev;
        else this.head.prev = pl2.prev;
        const pl4 = provHead.next;
        if (pl4) pl4.prev = pl2;
        else provHead.prev = pl2;
        pl2.prev = null;
        pl2.next = provHead.next;
        provHead.next = pl2;
        if (pllast === null) pllast = pl2;
      } else {
        let newz: number;
        if (pl2.type === ObjType.MESSAGE) newz = 32000;
        else {
          objz = getSingleObjectParam(e, pl2.overlay, pl2.idx, 2) ?? objz;
          newz = objz;
        }
        if (newz < sobjz) plz = pl2;
        pl = pl.next!;
      }
      pl2 = pl3;
    }
    if (pllast) {
      const first = provHead.next!;
      const pl4 = plz.next;
      plz.next = first;
      pllast.next = pl4;
      if (plz !== this.head) first.prev = plz;
      if (!pl4) this.head.prev = pllast;
      else pl4.prev = pllast;
    }
  }
}
