/**
 * Souris du jeu : pointeur, zones survolées, clics transmis aux scripts, curseur courant.
 *
 * Référence : ScummVM engines/sky/mouse.cpp (`Mouse::mouseEngine`, `pointerEngine`, `buttonEngine1`, `fnAddHuman`, `fnSaveCoods`,
 * `lockMouse`, `unlockMouse`, `spriteMouse`, `fnOpenCloseHand`, `findMouseCursor`, `wasClicked`, `buttonPressed`, `mouseMoved`) et
 * sky.cpp (`SkyEngine::delay` : clic gauche = bouton 2, droit = 1) (GPL v3 ou ultérieure).
 *
 * Coordonnées : `x` 0 à 319, `y` 0 à 199 (événements de ScummVM) ; la recherche des zones ajoute `TOP_LEFT_X` / `TOP_LEFT_Y`.
 *
 * Deux positions : `x` / `y` est celle que **le jeu** voit (`_mouseX`, `_mouseY` : figée tant que `SF_MOUSE_LOCKED` est posé) ; `pointerX` /
 * `pointerY` est celle du **pointeur de la machine**, que le rendu dessine (`CursorMan`) : elle suit toujours l'hôte, et `fnAddHuman` la
 * ramène sur la position du jeu (`warpMouse`). `held` garde les boutons enfoncés (`EventManager::getButtonState`, lu par
 * `waitMouseNotPressed`).
 *
 * Écarts volontaires : le curseur n'est qu'un numéro (`cursor`, `cursorHotspot`, objet tenu pour la main) que `render/cursor.ts` dessine ;
 * les parties iOS (`isIbass`, `mouseEngineIBASS`, `textChooser`, bascule de mode de choix au toucher) sont ignorées : sur PC le choix de
 * dialogue n'a pas de code de souris propre, ses lignes sont des compacts de texte survolés comme les autres zones (`fnChooser`).
 */

import type { Compacts } from "./compacts";
import { CompactField } from "../data/compact-fields";
import { Cursor, GAME_SCREEN_HEIGHT, GAME_SCREEN_WIDTH, SF, Script, TOP_LEFT_X, TOP_LEFT_Y, Var } from "./ids";
import type { ScriptVars } from "./vars";

/** Objets du jeu qui ont un curseur de main (`_mouseMainObjects`). */
const MAIN_OBJECTS = [65, 9, 66, 64, 8, 63, 10, 11, 71, 76, 37, 36, 42, 75, 79, 6, 74, 39, 49, 43, 34, 35, 77, 38];
/** Objets de LINC (`_mouseLincObjects`). */
const LINC_OBJECTS = [
  24625, 24649, 24827, 24651, 24583, 24581, 24582, 24628, 24650, 24629, 24732, 24631, 24584, 24630, 24626, 24627, 24632, 24643, 24828, 24830,
  24829,
];

/** Ce dont la souris a besoin dans le moteur. */
export interface MouseHost {
  readonly vars: ScriptVars;
  readonly compacts: Compacts;
  /** Drapeaux système (`SF_MOUSE_LOCKED`). */
  systemFlags: number;
  /** `Logic::mouseScript(scrNum, compact)` : script d'une zone, compact de la zone comme compact courant. */
  mouseScript(scrNum: number, itemId: number): number;
  /** `Logic::script(scriptNo, offset)` avec le compact courant de la logique. */
  script(scriptNo: number, offset: number): number;
}

/** Boutons suivis pour `held` (bits : 1 = droit, 2 = gauche, comme `_mouseB`). */
export type HeldButtons = number;

export class Mouse {
  /** Position vue par le jeu (`_mouseX`, `_mouseY`), au centre de l'écran de jeu au départ. */
  x = GAME_SCREEN_WIDTH / 2;
  y = GAME_SCREEN_HEIGHT / 2;
  /** Position du pointeur de la machine (celle que dessine le rendu) : suit l'hôte même quand le jeu ignore la souris (`SF_MOUSE_LOCKED`). */
  pointerX = GAME_SCREEN_WIDTH / 2;
  pointerY = GAME_SCREEN_HEIGHT / 2;
  /** Boutons actuellement enfoncés (bit 1 = droit, bit 2 = gauche). */
  held: HeldButtons = 0;
  /** Bouton reçu depuis le dernier tour (`_mouseB`). */
  button = 0;
  /** Clic disponible pour la logique pendant un tour (`_logicClick`). */
  logicClick = false;
  /** Curseur courant (`_currentCursor`) et son point chaud. */
  cursor: number = Cursor.BLANK;
  cursorHotspot: readonly [number, number] = [0, 0];
  /** Curseur d'objet tenu (`fnOpenCloseHand`) : rang dans la planche d'objets (`(objet << 1) + ouvert`), -1 sinon. */
  objectCursor = -1;
  /** Fichier des curseurs d'objets (`replaceMouseCursors` : 60301 dans LINC, sinon celui du constructeur). */
  objectCursorFile = 60301;
  /** Fichier d'où vient l'image de l'objet tenu (`fnOpenCloseHand` la copie au moment de l'appel : un changement de section ne la change pas). */
  heldCursorFile = 60301;

  constructor(private readonly host: MouseHost) {}

  /** `mouseMoved` (sauf pointeur verrouillé, testé par l'appelant comme `SkyEngine::delay`). */
  moved(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /** `buttonPressed`. */
  pressed(button: number): void {
    this.button = button;
  }

  /** `mouseEngine`, au début de chaque tour. */
  engine(): void {
    const vars = this.host.vars;
    this.logicClick = this.button > 0;
    if (!vars[Var.MOUSE_STOP]) {
      if (vars[Var.MOUSE_STATUS]! & (1 << 1)) {
        this.pointerEngine(this.x + TOP_LEFT_X, this.y + TOP_LEFT_Y);
        if (vars[Var.MOUSE_STATUS]! & (1 << 2)) this.buttonEngine1();
      }
    }
    this.button = 0;
  }

  /** `pointerEngine` : première zone active sous le pointeur dans la liste de souris ; scripts `mouseOn` / `mouseOff`. */
  private pointerEngine(xPos: number, yPos: number): void {
    const { vars, compacts } = this.host;
    let listNum = vars[Var.MOUSE_LIST_NO]!;
    let list: Uint16Array;
    let pos: number;
    do {
      list = compacts.require(listNum);
      pos = 0;
      while (list[pos] !== 0 && list[pos] !== 0xffff) {
        const itemNum = list[pos]!;
        const item = compacts.require(itemNum);
        pos++;
        if (item[CompactField.screen] === vars[Var.SCREEN] && item[CompactField.status]! & 16) {
          const relX = (item[CompactField.mouseRelX]! << 16) >> 16;
          const relY = (item[CompactField.mouseRelY]! << 16) >> 16;
          const left = item[CompactField.xcood]! + relX;
          const top = item[CompactField.ycood]! + relY;
          if (left > xPos || left + item[CompactField.mouseSizeX]! < xPos) continue;
          if (top > yPos || top + item[CompactField.mouseSizeY]! < yPos) continue;
          // Zone touchée.
          if (vars[Var.SPECIAL_ITEM] === itemNum) return;
          vars[Var.SPECIAL_ITEM] = itemNum;
          if (vars[Var.GET_OFF]) this.host.mouseScript(vars[Var.GET_OFF]!, itemNum);
          vars[Var.GET_OFF] = item[CompactField.mouseOff]!;
          if (item[CompactField.mouseOn]) this.host.mouseScript(item[CompactField.mouseOn]!, itemNum);
          return;
        }
      }
      if (list[pos] === 0xffff) listNum = list[pos + 1]!;
    } while (list[pos] !== 0);
    if (vars[Var.SPECIAL_ITEM] !== 0) {
      vars[Var.SPECIAL_ITEM] = 0;
      const getOff = vars[Var.GET_OFF]!;
      if (getOff) this.host.script(getOff & 0xffff, getOff >>> 16);
      vars[Var.GET_OFF] = 0;
    }
  }

  /** `buttonEngine1` : un clic lance le script `mouseClick` de la zone survolée. */
  private buttonEngine1(): void {
    const vars = this.host.vars;
    if (!this.button) return;
    vars[Var.BUTTON] = this.button;
    const special = vars[Var.SPECIAL_ITEM]!;
    if (special && special !== 0xffffffff) {
      const item = this.host.compacts.require(special);
      if (item[CompactField.mouseClick]) this.host.mouseScript(item[CompactField.mouseClick]!, special);
    }
  }

  /** `fnAddHuman` : rend la main au joueur ; force un « get off » au prochain tour. */
  addHuman(): boolean {
    const vars = this.host.vars;
    if (!vars[Var.MOUSE_STOP]) {
      vars[Var.MOUSE_STATUS] = vars[Var.MOUSE_STATUS]! | 6;
      if (this.y < 2) this.y = 2; // le pointeur n'active pas la ligne du haut
      this.pointerX = this.x; // `warpMouse(_mouseX, _mouseY)`
      this.pointerY = this.y;
      const getOff = vars[Var.GET_OFF]!;
      if (getOff) this.host.script(getOff & 0xffff, getOff >>> 16);
      vars[Var.SPECIAL_ITEM] = 0xffffffff;
      vars[Var.GET_OFF] = Script.RESET_MOUSE;
    }
    return true;
  }

  /** `fnSaveCoods`. */
  saveCoods(): void {
    this.host.vars[Var.SAFEX] = this.x + TOP_LEFT_X;
    this.host.vars[Var.SAFEY] = this.y + TOP_LEFT_Y;
  }

  lock(): void {
    this.host.systemFlags |= SF.MOUSE_LOCKED;
  }

  unlock(): void {
    this.host.systemFlags &= ~SF.MOUSE_LOCKED;
  }

  /** `spriteMouse(frame, hotX, hotY)`. */
  sprite(frame: number, hotX: number, hotY: number): void {
    this.cursor = frame;
    this.cursorHotspot = [hotX, hotY];
    if (frame !== Cursor.OBJECT) this.objectCursor = -1;
  }

  /** `fnOpenCloseHand`. */
  openCloseHand(open: boolean): void {
    const held = this.host.vars[Var.OBJECT_HELD]!;
    if (!open && !held) {
      this.sprite(Cursor.NORMAL, 0, 0);
      return;
    }
    let cursor = findMouseCursor(held) << 1;
    if (open) cursor++;
    this.sprite(Cursor.OBJECT, 5, 5);
    this.objectCursor = cursor;
    this.heldCursorFile = this.objectCursorFile;
  }

  /** `wasClicked` : consomme le clic du tour (logique `L_TALK`). */
  wasClicked(): boolean {
    if (this.logicClick) {
      this.logicClick = false;
      return true;
    }
    return false;
  }
}

/** `findMouseCursor`. */
export function findMouseCursor(itemNum: number): number {
  let i = MAIN_OBJECTS.indexOf(itemNum);
  if (i >= 0) return i;
  i = LINC_OBJECTS.indexOf(itemNum);
  return i >= 0 ? i : 0;
}
