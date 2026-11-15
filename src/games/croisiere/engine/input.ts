/**
 * Entrées : événements (`manageEvents`), machine à états de l'interaction (`processInput`), hit-test (`findObject`), menus d'objet,
 * inventaire, « Parler de », relations à un et deux objets, curseur de survol, pause.
 *
 * Référence : `engines/cruise/cruise_main.cpp` de ScummVM (GPL v3+, release 2026.4.0), lu puis réécrit : `manageEvents` (arrêt au
 * premier événement autre qu'un mouvement : au plus un changement de bouton par tour), `processInput`, `findObject`, `buildInventory`,
 * `createDialog`, `findRelation`, `processInventory`, `callSubRelation`, `callRelation`, le survol de l'attente de `mainLoop`
 * (`updateHoverCursor`) ; `cruise.cpp::pauseEngine` (message de pause, puis `processAnimation` et `flipScreen` à la reprise).
 *
 * `processInput` est une séquence : seuls le menu joueur et la pause cèdent la main (un `yield` par tour modal du banc).
 * Écarts volontaires :
 * - `currentScriptPtr` vaut toujours `null` hors des scripts : les relations lancées d'ici ont le parent (0, 0), y compris dans
 *   `createDialog`, où ScummVM le déréférence sans test (plantage) ;
 * - un modèle polygonal dont le renvoi miroir ne mène pas à un modèle n'est pas touché (ScummVM teste des octets quelconques) ; une image
 *   sans masque ou hors de la base de fichiers non plus ;
 * - un objet introuvable garde les paramètres lus juste avant (variable locale non initialisée dans ScummVM) ;
 * - la synthèse vocale n'est pas portée.
 */
import type { Sequence } from "../../../engine/sequence";
import { LangId } from "../data/language";
import { polyRecord, polyResolver, renderText, showPauseMessage } from "../render/draw";
import { findActor, processAnimation, type Actor } from "./actors";
import { createTextObject } from "./functions/f3-graphics";
import type { CroisiereAction, CroisiereInput } from "./host";
import { Freeze, MouseButton, ObjClass, ObjType, ScriptType } from "./ids";
import {
  addSelectableMenuEntry,
  closeAllMenu,
  createMenu,
  getSelectedEntryInMenu,
  langString,
  playerMenu,
  updateMenuMouse,
  type MenuSub,
  type ModalHost,
} from "./menu";
import { getMultipleObjectParam, getObjectClass, getObjectData, getObjectName, getSingleObjectParam, objInit, type ObjectQuery } from "./objects";
import type { MsgRelHeader } from "../data/overlay";
import { direction } from "./perso";
import type { EngineState } from "./state";

/** Curseurs (`CursorType`, mouse.h). */
export const Cursor = { NORMAL: 0, DISK: 1, CROSS: 2, NOMOUSE: 3, WALK: 4, EXIT: 5, MAGNIFYING_GLASS: 6 } as const;

/** Type d'une relation (`RelationType`) : script REL ou message. */
const RT_REL = 30;
const RT_MSG = 50;

/** État des entrées propre à ScummVM (`action`, `endpause`, `_mouseButtonDown`, `bFastMode`). */
export class InputState {
  action: CroisiereAction | null = null;
  endPause = false;
  mouseButtonDown = false;
  fastMode = false;
  quit = false;
  /** Dernière position vue par le survol (`oldMouseX/Y`, statiques de `mainLoop`). */
  hoverX = -1;
  hoverY = -1;
  /** Événements reçus et pas encore lus par `manageEvents`. */
  readonly pending: CroisiereInput[] = [];
}

/**
 * `manageEvents` : dépile les événements jusqu'au premier qui n'est pas un mouvement. Renvoie vrai s'il s'est arrêté sur un tel
 * événement (le reste attend le tour suivant).
 */
export function manageEvents(e: EngineState, input: InputState): boolean {
  while (input.pending.length) {
    const ev = input.pending.shift()!;
    let abort = true;
    switch (ev.type) {
      case "down":
        e.currentMouseButton |= ev.button === 1 ? MouseButton.LEFT : MouseButton.RIGHT;
        input.mouseButtonDown = true;
        break;
      case "up":
        e.currentMouseButton &= ~(ev.button === 1 ? MouseButton.LEFT : MouseButton.RIGHT);
        input.endPause = true;
        break;
      case "move":
        e.currentMouseX = ev.x;
        e.currentMouseY = ev.y;
        abort = false;
        break;
      case "quit":
        input.quit = true;
        break;
      case "key":
        input.endPause = true;
        break;
      case "actionEnd":
        if (ev.action === "escape") e.currentMouseButton &= ~MouseButton.MIDDLE;
        break;
      case "actionStart":
        input.action = ev.action;
        if (ev.action === "fastMode") input.fastMode = !input.fastMode;
        else if (ev.action === "escape") e.currentMouseButton |= MouseButton.MIDDLE;
        input.endPause = true;
        break;
    }
    if (abort) return true;
  }
  return false;
}

/** Survol pendant l'attente de `mainLoop` : `findObject` à chaque déplacement (l'état du rastériseur en dépend), puis le curseur. */
export function updateHoverCursor(e: EngineState, input: InputState): void {
  if (e.userEnabled && !e.userWait && !e.autoTrack) {
    if (e.currentActiveMenu === -1) {
      const x = e.currentMouseX;
      const y = e.currentMouseY;
      if (x !== input.hoverX || y !== input.hoverY) {
        input.hoverX = x;
        input.hoverY = y;
        const type = findObject(e, x, y).type;
        e.cursor = type === ObjType.EXIT ? Cursor.EXIT : type !== -1 ? Cursor.MAGNIFYING_GLASS : Cursor.WALK;
      }
    } else {
      e.cursor = Cursor.NORMAL;
    }
  } else {
    e.cursor = Cursor.NORMAL;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hit-test
// ---------------------------------------------------------------------------------------------------------------------------------

const NO_PARAMS: ObjectQuery = { X: 0, Y: 0, baseFileIdx: 0, fileIdx: 0, scale: 0, state: 0, state2: 0, nbState: 0 };

function nameBlock(e: EngineState, ovl: number, kind: "objectNames" | "verbNames"): Uint8Array | null {
  const block = e.overlays.entries[ovl]?.data?.[kind];
  return block && block.length ? block : null;
}

/** Résultat de `findObject` : type de la cellule touchée (−1 : rien) et objet désigné (l'objet suivi par la cellule). */
export interface FoundObject {
  type: number;
  ovl: number;
  idx: number;
}

/**
 * `findObject` : cellules nommées et non gelées, de la fin de la liste vers le début (premier plan d'abord) ; SPRITE, MASK et EXIT par
 * polygone ou masque d'image, VIRTUAL par rectangle (bords compris).
 */
export function findObject(e: EngineState, mouseX: number, mouseY: number): FoundObject {
  let params = NO_PARAMS;
  for (let cell = e.cells.head.prev; cell; cell = cell.prev) {
    const entry = e.overlays.entries[cell.overlay];
    if (cell.overlay <= 0 || !entry?.alreadyLoaded) continue;
    if (cell.type !== ObjType.SPRITE && cell.type !== ObjType.MASK && cell.type !== ObjType.EXIT && cell.type !== ObjType.VIRTUAL) continue;
    const names = nameBlock(e, cell.overlay, "objectNames");
    if (!names || !getObjectName(names, cell.idx).length || cell.freeze !== 0) continue;

    const objOvl = cell.overlay;
    const objIdx = cell.idx;
    const linkedOvl = cell.followObjectOverlayIdx;
    const linkedIdx = cell.followObjectIdx;
    params = getMultipleObjectParam(e, objOvl, objIdx) ?? params;
    let x2 = 0;
    let y2 = 0;
    let j2 = 0;
    if (objOvl !== linkedOvl || objIdx !== linkedIdx) {
      const p2 = getMultipleObjectParam(e, linkedOvl, linkedIdx) ?? params;
      x2 = p2.X;
      y2 = p2.Y;
      j2 = p2.fileIdx;
    }
    if (params.state < 0 || params.fileIdx < 0) continue;
    const hit: FoundObject = { type: cell.type, ovl: linkedOvl, idx: linkedIdx };

    if (cell.type === ObjType.VIRTUAL) {
      const x = params.X + x2;
      const y = params.Y + y2;
      if (mouseX >= x && mouseX <= x + params.fileIdx && mouseY >= y && mouseY <= y + params.scale) return hit;
      continue;
    }

    const x = params.X + x2;
    const y = params.Y + y2;
    const j = params.fileIdx + j2;
    const file = e.filesDb.get(j);
    if (!file) continue;
    if (file.resourceType === ObjType.POLY) {
      if (e.display.poly.hitTestRecord(j, polyRecord(file), x, y, params.scale, mouseX, mouseY, polyResolver(e))) return hit;
      continue;
    }
    const set = file.set;
    if (!set || set.kind === "poly") continue;
    const ox = mouseX - x;
    const oy = mouseY - y;
    if (ox >= 0 && ox < file.width && oy >= 0 && oy <= file.height) {
      const stride = Math.trunc(file.width / 8);
      if (((set.mask[oy * stride + (ox >> 3)] ?? 0) & (0x80 >> (ox & 7))) !== 0) return hit;
    }
  }
  return { type: -1, ovl: 0, idx: 0 };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Menus d'objet, inventaire, dialogue
// ---------------------------------------------------------------------------------------------------------------------------------

/** Lance la relation `id` de l'overlay `ovl` (`attacheNewScriptToTail` avec `currentScriptPtr` nul). */
function attachRelation(e: EngineState, ovl: number, id: number): void {
  const parent = e.currentScript;
  e.attachScript(e.rels, ovl, id, ScriptType.REL, parent?.scriptNumber ?? 0, parent?.overlayNumber ?? 0, ScriptType.REL);
}

/** `buildInventory` : menu des objets (hors THEME) d'état < −1 de tous les overlays chargés ; pas de menu s'il n'y en a aucun. */
export function buildInventory(e: EngineState, x: number, y: number): void {
  const menu = createMenu(e, x, y, langString(e, LangId.inventory));
  e.menuTable[1] = menu;
  let count = 0;
  for (let i = 1; i < e.overlays.numOfLoadedOverlay; i++) {
    const entry = e.overlays.entries[i]!;
    if (!entry.alreadyLoaded || !entry.data?.objects.length) continue;
    for (let j = 0; j < entry.data.objects.length; j++) {
      if (getObjectClass(e, i, j) === ObjClass.THEME) continue;
      const state = getSingleObjectParam(e, i, j, 5);
      if (state !== null && state < -1) {
        addSelectableMenuEntry(e, i, j, menu, 1, -1, getObjectName(entry.data.objectNames, j));
        count++;
      }
    }
  }
  if (!count) e.menuTable[1] = null;
}

/** Overlay effectif d'un champ de relation (0 = l'overlay de la relation). */
const ovlOr = (value: number, own: number) => (value ? value : own);

/**
 * `createDialog` : menu « Parler de » des THEME connus (état < −1) reliés à l'interlocuteur `(objOvl, objIdx)` ; un verbe vide lance
 * la relation tout de suite. Les thèmes déjà évoqués (état −2) prennent `subColor`.
 */
export function createDialog(e: EngineState, objOvl: number, objIdx: number, x: number, y: number): boolean {
  let found = false;
  let testState1 = -1;
  let testState2 = -1;
  const objectState = getSingleObjectParam(e, objOvl, objIdx, 5) ?? 0;
  const menu = createMenu(e, x, y, langString(e, LangId.speakAbout));
  e.menuTable[0] = menu;
  for (let j = 1; j < e.overlays.numOfLoadedOverlay; j++) {
    const entry = e.overlays.entries[j]!;
    if (!entry.alreadyLoaded || !entry.data) continue;
    const headers = entry.data.msgRelHeaders;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i]!;
      let thisOvl = ovlOr(h.obj1Overlay, j);
      const obj = getObjectData(e, thisOvl, h.obj1Number);
      const objectState2 = getSingleObjectParam(e, thisOvl, h.obj1Number, 5) ?? 0;
      if (!obj || obj.class !== ObjClass.THEME || objectState2 >= -1) continue;
      thisOvl = ovlOr(h.obj2Overlay, j);
      if (thisOvl !== objOvl || h.obj2Number !== objIdx) continue;
      const verbOvl = ovlOr(h.verbOverlay, j);
      const obj1Ovl = ovlOr(h.obj1Overlay, j);
      const obj2Ovl = ovlOr(h.obj2Overlay, j);
      const ovl2 = verbOvl > 0 ? e.overlays.entries[verbOvl]?.data : null;
      const ovl3 = obj1Ovl > 0 ? e.overlays.entries[obj1Ovl]?.data : null;
      const ovl4 = obj2Ovl > 0 ? e.overlays.entries[obj2Ovl]?.data : null;
      if (ovl3 && h.obj1Number >= 0) testState1 = h.obj1OldState;
      if (ovl4 && h.obj2Number >= 0) testState2 = h.obj2OldState;
      if (!ovl4 || !ovl2 || h.verbNumber < 0) continue;
      if (testState1 !== -1 && testState1 !== objectState2) continue;
      if (testState2 !== -1 && testState2 !== objectState) continue;
      const verbs = nameBlock(e, verbOvl, "verbNames");
      if (!verbs) continue;
      if (!getObjectName(verbs, h.verbNumber).length) {
        attachRelation(e, j, h.id);
      } else {
        found = true;
        const color = objectState2 === -2 ? e.display.subColor : -1;
        if (!ovl3) throw new Error("createDialog : overlay de l'objet 1 absent");
        addSelectableMenuEntry(e, j, i, menu, 1, color, getObjectName(ovl3.objectNames, h.obj1Number));
      }
    }
  }
  return found;
}

/**
 * `findRelation` : menu des verbes de l'objet (titre = nom de l'objet, créé à la première relation dont l'état convient) ; un verbe
 * vide lance la relation tout de suite. Vrai si le menu a au moins un verbe.
 */
export function findRelation(e: EngineState, objOvl: number, objIdx: number, x: number, y: number): boolean {
  let found = false;
  let first = true;
  let testState = -1;
  const objectState = getSingleObjectParam(e, objOvl, objIdx, 5) ?? 0;
  for (let j = 1; j < e.overlays.numOfLoadedOverlay; j++) {
    const entry = e.overlays.entries[j]!;
    if (!entry.alreadyLoaded || !entry.data) continue;
    const headers = entry.data.msgRelHeaders;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i]!;
      const thisOvl = ovlOr(h.obj1Overlay, j);
      const obj = getObjectData(e, thisOvl, h.obj1Number);
      if (thisOvl !== objOvl || objIdx !== h.obj1Number || !obj || obj.class === ObjClass.THEME) continue;
      const verbOvl = ovlOr(h.verbOverlay, j);
      const obj1Ovl = ovlOr(h.obj1Overlay, j);
      const ovl2 = verbOvl > 0 ? e.overlays.entries[verbOvl]?.data : null;
      const ovl3 = obj1Ovl > 0 ? e.overlays.entries[obj1Ovl]?.data : null;
      if (ovl3 && h.obj1Number >= 0) {
        testState = h.obj1OldState;
        const names = nameBlock(e, obj1Ovl, "objectNames");
        if (first && names && (testState === -1 || testState === objectState)) {
          e.menuTable[0] = createMenu(e, x, y, getObjectName(names, h.obj1Number));
          first = false;
        }
      }
      if (!ovl2 || h.verbNumber < 0) continue;
      const verbs = nameBlock(e, verbOvl, "verbNames");
      if (!verbs || first || (testState !== -1 && testState !== objectState)) continue;
      const verb = getObjectName(verbs, h.verbNumber);
      if (!verb.length) {
        attachRelation(e, j, h.id);
      } else {
        found = true;
        addSelectableMenuEntry(e, j, i, e.menuTable[0]!, 1, -1, verb);
      }
    }
  }
  return found;
}

/** `processInventory` : objet choisi dans l'inventaire → menu de ses verbes à x + 80 ; ferme l'inventaire. Vrai si un objet est choisi. */
export function processInventory(e: EngineState): boolean {
  const inventory = e.menuTable[1];
  if (!inventory) return false;
  const subs = getSelectedEntryInMenu(e, inventory);
  e.menuTable[1] = null;
  if (!subs) return false;
  const sel = e.currentMenuElement!;
  findRelation(e, subs[0]!.ovlIdx, subs[0]!.header, sel.x + 80, sel.y);
  return true;
}

function header(e: EngineState, sub: MenuSub): MsgRelHeader {
  return e.overlays.entries[sub.ovlIdx]!.data!.msgRelHeaders[sub.header]!;
}

/**
 * Marche automatique du narrateur vers le point de la relation (`trackX/Y`, 9999 = sa position ; direction finale 9999 = calculée).
 * `msgDirection` : les relations MSG de `callSubRelation` calculent la direction vers le point de la relation, les autres vers la
 * destination (déjà égale à la position).
 */
function trackNarrator(e: EngineState, h: MsgRelHeader, msgDirection: boolean): Actor | null {
  if (e.narratorOvl <= 0 || h.trackX === -1 || h.trackY === -1) return null;
  const track = findActor(e, e.narratorOvl, e.narratorIdx, 0);
  if (!track) return null;
  e.animationStart = false;
  if (h.trackDirection === 9999) {
    const p = getMultipleObjectParam(e, e.narratorOvl, e.narratorIdx) ?? NO_PARAMS;
    track.x_dest = p.X;
    track.y_dest = p.Y;
    track.endDirection = msgDirection ? direction(e, p.X, p.Y, h.trackX, h.trackY, 0, 0) : direction(e, p.X, p.Y, track.x_dest, track.y_dest, 0, 0);
  } else if (h.trackX === 9999 && h.trackY === 9999) {
    const p = getMultipleObjectParam(e, e.narratorOvl, e.narratorIdx) ?? NO_PARAMS;
    track.x_dest = p.X;
    track.y_dest = p.Y;
    track.endDirection = h.trackDirection;
  } else {
    track.x_dest = h.trackX;
    track.y_dest = h.trackY;
    track.endDirection = h.trackDirection;
  }
  track.flag = 1;
  e.autoTrack = true;
  e.userEnabled = 0;
  return track;
}

/** Relation REL : script lancé, gelé (9998) le temps de la marche automatique du narrateur. */
function runRel(e: EngineState, ovlIdx: number, h: MsgRelHeader): void {
  attachRelation(e, ovlIdx, h.id);
  if (trackNarrator(e, h, false)) e.changeScriptParamInList(ovlIdx, h.id, e.rels, 0, Freeze.autoTrack);
}

/** Relation MSG : message affiché (`userWait`), ou gelé (9998) jusqu'à la fin de la marche automatique du narrateur. */
function showMsg(e: EngineState, ovlIdx: number, h: MsgRelHeader, x: number, y: number, msgDirection: boolean): void {
  const parent = e.currentScript;
  createTextObject(e, ovlIdx, h.id, x, y, 200, e.display.findHighColor(), e.display.masterScreen, parent?.overlayNumber ?? 0, parent?.scriptNumber ?? 0);
  e.userWait = true;
  e.autoOvl = ovlIdx;
  e.autoMsg = h.id;
  if (trackNarrator(e, h, msgDirection)) {
    e.userWait = false;
    e.cells.freeze(ovlIdx, h.id, ObjType.MESSAGE, -1, 0, Freeze.autoTrack);
  }
}

/** `callSubRelation` : second objet d'une relation liée, choisi à l'écran ou dans l'inventaire. */
export function callSubRelation(e: EngineState, subs: MenuSub[] | null, nOvl: number, nObj: number): void {
  if (!subs) return;
  for (const sub of subs) {
    const h = header(e, sub);
    const obj2Ovl = ovlOr(h.obj2Overlay, sub.ovlIdx);
    if (obj2Ovl !== nOvl || h.obj2Number === -1 || h.obj2Number !== nObj) continue;
    let params = NO_PARAMS;
    if (h.obj2Number >= 0) params = getMultipleObjectParam(e, obj2Ovl, h.obj2Number) ?? NO_PARAMS;
    if (h.obj2OldState !== -1 && params.state !== h.obj2OldState) continue;
    if (h.type === RT_REL) {
      runRel(e, sub.ovlIdx, h);
    } else if (h.type === RT_MSG) {
      let x = 60;
      let y = 60;
      if (h.obj2Number >= 0) {
        if (h.trackX !== -1 && h.trackY !== -1 && h.trackX !== 9999 && h.trackY !== 9999) {
          x = h.trackX - 100;
          y = h.trackY - 150;
        } else if (params.scale >= 0) {
          x = params.X - 100;
          y = params.Y - 40;
        }
        if (h.obj2NewState !== -1) objInit(e, obj2Ovl, h.obj2Number, h.obj2NewState);
      }
      if (h.obj1Number >= 0 && h.obj1NewState !== -1) objInit(e, ovlOr(h.obj1Overlay, sub.ovlIdx), h.obj1Number, h.obj1NewState);
      showMsg(e, sub.ovlIdx, h, x, y, true);
    }
  }
}

/** `callRelation` : verbe choisi ; relation sans second objet (ou avec `nObj2`) exécutée, sinon relation liée en attente. */
export function callRelation(e: EngineState, subs: MenuSub[] | null, nObj2: number): void {
  if (!subs) return;
  for (const sub of subs) {
    const h = header(e, sub);
    if (h.obj2Number !== nObj2) {
      e.linkedRelation = subs;
      continue;
    }
    if (h.type === RT_REL) {
      runRel(e, sub.ovlIdx, h);
    } else if (h.type === RT_MSG) {
      const obj1Ovl = ovlOr(h.obj1Overlay, sub.ovlIdx);
      let x = 60;
      let y = 40;
      if (h.obj1Number >= 0) {
        let params = getMultipleObjectParam(e, obj1Ovl, h.obj1Number) ?? NO_PARAMS;
        if (e.narratorOvl > 0) {
          if (h.trackX !== -1 && h.trackY !== -1 && h.trackX !== 9999 && h.trackY !== 9999) {
            x = h.trackX - 100;
            y = h.trackY - 150;
          } else {
            params = getMultipleObjectParam(e, e.narratorOvl, e.narratorIdx) ?? params;
            x = params.X - 100;
            y = params.Y - 150;
          }
        } else if (params.scale >= 0) {
          x = params.X - 100;
          y = params.Y - 40;
        }
        if (h.obj1NewState !== -1) objInit(e, obj1Ovl, h.obj1Number, h.obj1NewState);
      }
      showMsg(e, sub.ovlIdx, h, x, y, false);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// processInput
// ---------------------------------------------------------------------------------------------------------------------------------

/** Ce que `processInput` demande à la boucle principale (en plus des boucles modales). */
export interface InputHost extends ModalHost {
  readonly input: InputState;
}

/** Pause du jeu (`P`) : boucle modale jusqu'à un bouton relâché ou une touche ; 1 si l'on quitte pendant la pause. */
function* pause(e: EngineState, host: InputHost): Sequence<number> {
  const input = host.input;
  input.action = null;
  input.endPause = false;
  showPauseMessage(e, langString(e, LangId.pause));
  const saved = e.cursor;
  e.cursor = Cursor.NOMOUSE;
  for (;;) {
    yield { kind: "ticks", count: 1 };
    host.modalTick("pause");
    if (input.endPause) break;
    e.delay(10);
  }
  if (input.action === "exit") return 1;
  input.action = null;
  // pauseEngine(false)
  processAnimation(e);
  e.display.flipScreen((ms) => e.delay(ms), () => e.renderer.present?.(e));
  e.cursor = saved;
  return 0;
}

/** `processInput` : 1 pour quitter, sinon 0. */
export function* processInput(e: EngineState, host: InputHost): Sequence<number> {
  const input = host.input;
  let mouseX = 0;
  let mouseY = 0;
  let button = 0;
  if (e.sysKey !== -1) {
    button = e.sysKey;
    mouseX = e.sysX;
    mouseY = e.sysY;
    e.sysKey = -1;
  } else if (e.automaticMode === 0) {
    mouseX = e.currentMouseX;
    mouseY = e.currentMouseY;
    button = e.currentMouseButton;
  }
  if (!button) e.buttonDown = 0;

  if (input.action === "exit") return 1;
  if (input.action === "pause") return yield* pause(e, host);

  if ((button & MouseButton.BOTH) === MouseButton.BOTH || input.action === "playerMenu") {
    e.cursor = Cursor.NORMAL;
    input.action = null;
    return yield* playerMenu(e, host, mouseX, mouseY);
  }

  if (e.userWait) {
    if (input.action === "endUserWaiting" || button === MouseButton.LEFT) e.userWait = false;
    input.action = null;
    return 0;
  }

  if (e.speedFlag) {
    if (input.action === "increaseGameSpeed" && e.gameSpeed >= 30) {
      e.gameSpeed -= 10;
      input.action = null;
    }
    if (input.action === "decreaseGameSpeed" && e.gameSpeed <= 200) {
      e.gameSpeed += 10;
      input.action = null;
    }
  }

  if (!e.userEnabled) return 0;

  if (e.currentActiveMenu !== -1) updateMenuMouse(mouseX, mouseY, e.menuTable[e.currentActiveMenu] ?? null);

  if (e.dialogueEnabled) {
    if (e.menuDown || e.selectDown || e.linkedRelation) {
      closeAllMenu(e);
      e.menuDown = 0;
      e.selectDown = 0;
      e.currentActiveMenu = -1;
      e.cursor = Cursor.NORMAL;
    }
    if (!e.menuTable[0] && !e.buttonDown) {
      const found = createDialog(e, e.dialogueOvl, e.dialogueObj, e.xdial, 0);
      if (e.menuTable[0]) {
        if (found) {
          e.currentActiveMenu = 0;
        } else {
          e.menuTable[0] = null;
          e.currentActiveMenu = -1;
        }
      } else {
        e.menuDown = 0;
      }
    } else if (button & MouseButton.LEFT && e.buttonDown === 0) {
      if (e.menuTable[0]) {
        callRelation(e, getSelectedEntryInMenu(e, e.menuTable[0]), e.dialogueObj);
        e.menuTable[0] = null;
        e.linkedMsgList = null;
        e.linkedRelation = null;
        e.cursor = Cursor.NORMAL;
        e.currentActiveMenu = -1;
      }
      e.buttonDown = 1;
    }
  } else if (button & MouseButton.LEFT && e.buttonDown === 0) {
    e.buttonDown = 1;
    if (e.linkedRelation) {
      if (e.menuDown === 0) {
        // second objet choisi à l'écran
        if (e.menuTable[0]) {
          const obj = findObject(e, mouseX, mouseY);
          if (obj.type !== -1) callSubRelation(e, e.linkedRelation, obj.ovl, obj.idx);
          e.menuTable[0] = null;
        }
        e.linkedMsgList = null;
        e.linkedRelation = null;
        e.cursor = Cursor.NORMAL;
      } else if (e.menuTable[0] && e.menuTable[1]) {
        // second objet choisi dans l'inventaire
        const subs = getSelectedEntryInMenu(e, e.menuTable[1]);
        if (subs) callSubRelation(e, e.linkedRelation, subs[0]!.ovlIdx, subs[0]!.header);
        closeAllMenu(e);
        e.cursor = Cursor.NORMAL;
      }
      e.selectDown = 0;
      e.menuDown = 0;
    } else if (e.menuDown === 0) {
      if (!e.menuTable[0]) {
        // clic sur un objet ou au sol
        const obj = findObject(e, mouseX, mouseY);
        let walk = true;
        if (obj.type !== -1) {
          const relation = findRelation(e, obj.ovl, obj.idx, mouseX, mouseY);
          if (e.menuTable[0]) {
            if (relation) {
              e.currentActiveMenu = 0;
              e.selectDown = 1;
              walk = false;
            } else {
              e.menuTable[0] = null;
            }
          }
        }
        if (walk) {
          e.aniX = mouseX;
          e.aniY = mouseY;
          e.animationStart = true;
        }
      } else {
        // clic dans le menu d'objet
        const menu = e.menuTable[0];
        callRelation(e, getSelectedEntryInMenu(e, menu), -1);
        if (!e.linkedRelation) {
          e.menuTable[0] = null;
          e.cursor = Cursor.NORMAL;
        } else {
          const text = `${menu.stringPtr}:${e.currentMenuElement!.element.string}`;
          e.linkedMsgList = renderText(e, 320, text);
          e.cursor = Cursor.CROSS;
        }
        e.currentActiveMenu = -1;
        e.selectDown = 0;
      }
    } else if (processInventory(e)) {
      e.currentActiveMenu = 0;
      e.selectDown = 1;
      e.menuDown = 0;
    } else {
      e.currentActiveMenu = -1;
      e.menuDown = 0;
    }
  } else if (button & MouseButton.RIGHT || input.action === "inventory") {
    if (e.buttonDown === 0) {
      input.action = null;
      if (!e.linkedRelation && e.menuTable[0]) {
        e.menuTable[0] = null;
        e.selectDown = 0;
        e.menuDown = 0;
        e.currentActiveMenu = -1;
      }
      if (!e.selectDown && !e.menuDown && !e.menuTable[1]) {
        buildInventory(e, mouseX, mouseY);
        if (e.menuTable[1]) e.currentActiveMenu = 1;
        e.menuDown = 1;
      }
      e.buttonDown = 1;
    }
  }
  return 0;
}
