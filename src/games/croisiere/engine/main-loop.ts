/**
 * Boucle principale sans tête : cadence, ordre des opérations d'un tour, partie logique de `mainDraw` (auto-animations).
 *
 * Références (ScummVM `engines/cruise/`, GPL v3+, release 2026.4.0, lu puis réécrit) :
 * - `cruise_main.cpp::mainLoop` : attente active par pas de 10 ms jusqu'à `lastTick + gameSpeed`, bascule 50 → 100 ms quand le menu
 *   joueur devient autorisé, `userDelay` qui efface le bouton, `processInput`, dégel des scripts après `userWait`, `manageScripts`
 *   des REL puis des PROC, purge, deux passes de plus quand le fond devient `S06B.PI1`, `processAnimation`, `mainDraw` et
 *   `flipScreen`, fin de la marche automatique du narrateur ;
 * - `mainDraw.cpp` : `mainDraw` (auto-animations des cellules et réveil des scripts, appliquées en fin de passe par `freeAutoCell`,
 *   `isMessage`), `flipScreen` (palette, fondu d'entrée).
 *
 * Le dessin est `render/draw.ts::drawScreen`, appelé avant la logique des auto-animations de la même passe : ScummVM dessine
 * chaque cellule avant d'en préparer le changement, appliqué seulement après le parcours, donc l'image est la même.
 * Rustines (plan.md D8) reprises : `userDelay` efface le bouton ; deux passes de scripts de plus sous `S06B.PI1`.
 *
 * Un tour est une séquence (`frame`) : il ne cède la main que dans les boucles modales de `processInput` (menu joueur, pause), un
 * `yield` par tour modal. `step()` reprend alors la séquence à chaque appel (10 ms), au lieu de l'attente de `mainLoop`. Le compteur
 * `frameNumber` compte, comme le `tick` du banc, les tours de `mainLoop` et les tours modaux.
 */
import { drawScreen } from "../render/draw";
import { ATP_MOUSE, isAnimFinished, processAnimation } from "./actors";
import type { Cell } from "./cells";
import { Freeze, GAME_FRAME_DELAY_2, LOOP_DELAY_MS, ObjType } from "./ids";
import type { Sequence } from "../../../engine/sequence";
import { Cursor, InputState, manageEvents, processInput, updateHoverCursor, type InputHost } from "./input";
import type { CroisiereAction, CroisiereHost } from "./host";
import { getMultipleObjectParam, objInit, setObjectPosition, type ObjectQuery } from "./objects";
import { EngineState, type EngineOptions } from "./state";

/** Nom du fond qui déclenche deux passes de scripts de plus (scène du livre, FIXME de ScummVM). */
export const EXTRA_PASSES_BACKGROUND = "S06B.PI1";

function queryValue(q: ObjectQuery, idx: number): number {
  switch (idx) {
    case 0:
      return q.X;
    case 1:
      return q.Y;
    case 2:
      return q.baseFileIdx;
    case 3:
      return q.fileIdx;
    case 4:
      return q.scale;
    case 5:
      return q.state;
    case 6:
      return q.state2;
    case 7:
      return q.nbState;
    default:
      throw new Error(`getValueFromObjectQuerry : champ ${idx}`);
  }
}

const EMPTY_QUERY: ObjectQuery = { X: 0, Y: 0, baseFileIdx: 0, fileIdx: 0, scale: 0, state: 0, state2: 0, nbState: 0 };

/** Partie logique de `mainDraw` : fond changé, dessin (rendu), auto-animations, `isMessage`. */
export function mainDraw(e: EngineState, waitFl: boolean): void {
  const d = e.display;
  if (d.backgroundScreens[d.masterScreen] && d.backgroundChanged[d.masterScreen]) d.backgroundChanged[d.masterScreen] = false;
  drawScreen(e);

  // `addAutoCell` insère en tête : `freeAutoCell` applique les changements dans l'ordre inverse du parcours.
  const autoCells: { ovl: number; obj: number; type: number; value: number; cell: Cell }[] = [];
  let params = EMPTY_QUERY; // ScummVM : variable locale non réinitialisée si l'objet n'existe pas
  for (const cell of e.cells) {
    if (d.masterScreen !== cell.backgroundPlane || cell.freeze !== 0 || cell.type !== ObjType.SPRITE) continue;
    params = getMultipleObjectParam(e, cell.overlay, cell.idx) ?? params;
    if (!cell.animStep || waitFl) continue;
    if (cell.animCounter > 0) {
      cell.animCounter--;
      continue;
    }
    let change = true;
    let newVal = queryValue(params, cell.animChange) + cell.animStep;
    const resume = () => {
      if (cell.parentType === 20) e.changeScriptParamInList(cell.parentOverlay, cell.parent, e.procs, -1, 0);
      else if (cell.parentType === 30) e.changeScriptParamInList(cell.parentOverlay, cell.parent, e.rels, -1, 0);
    };
    const past = cell.animStep > 0 ? newVal > cell.animEnd : newVal < cell.animEnd;
    if (past) {
      if (cell.animLoop) {
        newVal = cell.animStart;
        if (cell.animLoop > 0) cell.animLoop--;
      } else {
        change = false;
        cell.animStep = 0;
        if (cell.animType) resume();
      }
    }
    if (cell.animWait >= 0) cell.animCounter = cell.animWait;
    if (cell.animSignal >= 0 && cell.animSignal === newVal && cell.animType !== 0) {
      resume();
      cell.animType = 0;
    }
    if (change) autoCells.unshift({ ovl: cell.overlay, obj: cell.idx, type: cell.animChange, value: newVal, cell });
  }

  // freeAutoCell
  for (const a of autoCells) {
    if (a.type === 5) objInit(e, a.ovl, a.obj, a.value);
    else setObjectPosition(e, a.ovl, a.obj, a.type, a.value);
    if (a.cell.animWait < 0) a.cell.animCounter = (getMultipleObjectParam(e, a.ovl, a.obj)?.state2 ?? 0) - 1;
  }

  e.isMessage = 0;
  for (const cell of e.cells) if (cell.type === ObjType.MESSAGE && cell.freeze === 0) e.isMessage = 1;
}

export interface CroisiereEngineOptions extends Omit<EngineOptions, "log"> {}

export class CroisiereEngine implements InputHost {
  readonly state: EngineState;
  readonly input = new InputState();
  /** Numéro du tour (compteur `tick` du banc, 1 au premier tour), tours modaux compris. */
  frameNumber = 0;
  /**
   * Appelé au début de chaque tour, modal ou non, après l'incrément de `frameNumber` (`Bench::applyInputs` : entrées rejouées par tour).
   */
  onTickStart: ((tick: number) => void) | null = null;
  private lastTick = 0;
  private skipEvents = false;
  /** Tour en cours, suspendu dans une boucle modale. */
  private current: Sequence<void> | null = null;
  /** Vrai une fois que le jeu a demandé à quitter. */
  stopped = false;

  constructor(
    private readonly host: CroisiereHost,
    options: CroisiereEngineOptions,
  ) {
    this.state = new EngineState({ ...options, log: (m) => host.log?.(m) });
    const e = this.state;
    e.currentActiveMenu = -1;
    e.autoMsg = -1;
    e.linkedRelation = null;
    e.userWait = false;
    e.autoTrack = false;
    e.initAllData();
  }

  /**
   * Une itération de 10 ms de l'attente active : événements, temps virtuel, puis un tour si `gameSpeed` ms se sont écoulées depuis
   * le précédent. Renvoie vrai si un tour a été joué.
   */
  step(): boolean {
    if (this.stopped) return false;
    const e = this.state;
    this.input.pending.push(...this.host.pollInput());
    if (this.current) return this.resume();
    updateHoverCursor(e, this.input);
    if (!this.skipEvents || this.input.fastMode) this.skipEvents = manageEvents(e, this.input);
    if (!this.input.fastMode) e.delay(LOOP_DELAY_MS);
    if (this.input.quit) {
      this.stop();
      return false;
    }
    if (!this.input.fastMode && e.virtualTime < this.lastTick + e.gameSpeed) return false;
    this.lastTick = e.virtualTime;
    this.skipEvents = false;
    this.current = this.frame();
    return this.resume();
  }

  /** Reprend le tour en cours jusqu'à la fin d'un tour (modal ou complet). */
  private resume(): boolean {
    if (this.current!.next("ok").done) this.current = null;
    // Fermeture pendant une boucle modale (`shouldQuit` de `processMenu` et de la pause).
    if (this.current && this.input.quit) {
      this.current = null;
      this.stop();
    }
    return true;
  }

  // InputHost : services des boucles modales

  redraw(waitFl: boolean): void {
    const e = this.state;
    mainDraw(e, waitFl);
    e.display.flipScreen((ms) => e.delay(ms), () => e.renderer.present?.(e));
  }

  modalTick(where: "menu" | "pause"): void {
    const e = this.state;
    manageEvents(e, this.input);
    const n = ++this.frameNumber;
    this.onTickStart?.(n);
    e.trace?.modal?.(n, where, e);
  }

  /** « Recommencer » du menu joueur : fondu, écran noir, `initVars`, `initAllData`, utilisateur désactivé. */
  restart(): void {
    const e = this.state;
    e.sound.fadeSong();
    e.display.fadeOut(() => e.renderer.present?.(e));
    e.display.globalScreen.fill(0);
    e.initVars();
    e.initAllData();
    e.cursor = Cursor.NORMAL;
    e.userEnabled = 0;
  }

  onSaveRequest(): void {
    this.host.onSaveRequest?.();
  }

  onLoadRequest(): void {
    this.host.onLoadRequest?.();
  }

  /** Avance jusqu'à la fin du tour suivant, modal ou non (tests, rejeu du banc). */
  runFrame(): void {
    while (!this.stopped && !this.step()) {
      // attente active
    }
  }

  private stop(): void {
    this.stopped = true;
    this.host.exit();
  }

  /**
   * Entrée « niveau » du banc (`CRUISE_INPUT`, `Bench::applyInputs`) : position, puis seuls les bits de bouton qui changent depuis le
   * niveau précédent sont posés ou effacés. À appeler avant `runFrame` pour le tour concerné.
   */
  private prevLevel = { x: 0, y: 0, b: 0 };
  applyInputLevel(x: number, y: number, buttons: number): void {
    const e = this.state;
    const prev = this.prevLevel;
    if (x !== prev.x || y !== prev.y) {
      e.currentMouseX = x;
      e.currentMouseY = y;
    }
    const diff = buttons ^ prev.b;
    for (const bit of [1, 2, 4]) {
      if (!(diff & bit)) continue;
      if (buttons & bit) {
        e.currentMouseButton |= bit;
        if (bit !== 4) this.input.mouseButtonDown = true;
      } else {
        e.currentMouseButton &= ~bit;
        if (bit !== 4) this.input.endPause = true;
      }
    }
    this.prevLevel = { x, y, b: buttons };
  }

  /** Échap du banc : bouton du milieu relâché au tour qui suit l'appui. */
  private escReleaseTick = -1;

  /**
   * Touche du banc (`CRUISE_KEYS`, `Bench::applyInputs`) : `ESC` (bouton du milieu pendant ce seul tour), `SPACE`, `F10`, `P`, `X`, `I`,
   * `PLUS`, `MINUS`. À appeler depuis `onTickStart`, après `applyInputLevel`.
   */
  applyKey(key: string): void {
    const actions: Record<string, CroisiereAction> = {
      ESC: "escape",
      SPACE: "endUserWaiting",
      F10: "playerMenu",
      P: "pause",
      X: "exit",
      I: "inventory",
      PLUS: "increaseGameSpeed",
      MINUS: "decreaseGameSpeed",
    };
    const action = actions[key.toUpperCase()];
    if (!action) throw new Error(`Touche du banc inconnue : ${key}`);
    this.input.action = action;
    if (action === "escape") {
      this.state.currentMouseButton |= 4;
      this.escReleaseTick = this.frameNumber;
    }
    this.input.endPause = true;
  }

  /** Relâche l'Échap du banc (à appeler au début de chaque tour, avant `applyKey`). */
  releaseBenchEscape(): void {
    if (this.escReleaseTick >= 0 && this.frameNumber > this.escReleaseTick) {
      this.state.currentMouseButton &= ~4;
      this.escReleaseTick = -1;
    }
  }

  /** Corps d'un tour de `mainLoop` ; les boucles modales de `processInput` y cèdent la main. */
  private *frame(): Sequence<void> {
    const e = this.state;
    const trace = e.trace;
    const tick = ++this.frameNumber;
    this.onTickStart?.(tick);
    trace?.frameBegin?.(tick);

    if (!e.speedFlag && e.playerMenuEnabled !== 0) {
      e.speedFlag = true;
      e.gameSpeed = GAME_FRAME_DELAY_2;
    }

    const isUserWait = e.userWait;
    if (e.userDelay) e.currentMouseButton = 0;

    const mx = e.currentMouseX;
    const my = e.currentMouseY;
    const mb = e.currentMouseButton;
    const quit = yield* processInput(e, this);
    // Après une boucle modale, le tour porte le numéro du dernier tour modal (comme `FR` du banc).
    const n = this.frameNumber;
    trace?.frameInputs?.(n, mx, my, mb, e);
    if (quit) {
      trace?.frameEnd?.(n, e);
      this.stop();
      return;
    }

    if (e.enableUser) {
      e.userEnabled = 1;
      e.enableUser = 0;
    }
    if (e.userDelay && !e.userWait) e.userDelay--;
    if (isUserWait && !e.userWait) {
      e.changeScriptParamInList(-1, -1, e.procs, Freeze.userWait, 0);
      e.changeScriptParamInList(-1, -1, e.rels, Freeze.userWait, 0);
      e.currentMouseButton = 0;
    }

    let iterations = 1;
    while (iterations-- > 0) {
      const d = e.display;
      let bgChanged = d.backgroundChanged[d.masterScreen]!;
      e.vm.manageScripts(e.rels, "R");
      e.vm.manageScripts(e.procs, "P");
      e.rels = e.removeFinishedScripts(e.rels);
      e.procs = e.removeFinishedScripts(e.procs);
      trace?.afterScripts?.(n, e);
      if (!bgChanged && d.backgroundChanged[d.masterScreen] && d.backgroundNames[0] === EXTRA_PASSES_BACKGROUND) {
        bgChanged = true;
        iterations += 2;
      }
    }

    processAnimation(e);
    trace?.afterAnimation?.(n, e);

    if (e.displayOn) {
      if (e.display.doFade) e.display.pcFadeFlag = false;
      mainDraw(e, e.userWait);
      e.display.flipScreen((ms) => e.delay(ms), () => e.renderer.present?.(e));
      if (!e.userWait) this.afterDraw();
    }
    trace?.frameEnd?.(n, e);
  }

  /** Fin de la marche automatique du narrateur (`autoTrack`), ou retrait du message automatique. */
  private afterDraw(): void {
    const e = this.state;
    if (e.autoTrack) {
      if (isAnimFinished(e, e.narratorOvl, e.narratorIdx, ATP_MOUSE)) {
        if (e.autoMsg !== -1) {
          e.cells.freeze(e.autoOvl, e.autoMsg, ObjType.MESSAGE, -1, Freeze.autoTrack, 0);
          const text = e.getText(e.autoMsg, e.autoOvl);
          if (text && text.length) e.userWait = true;
        }
        e.changeScriptParamInList(-1, -1, e.rels, Freeze.autoTrack, 0);
        e.autoTrack = false;
        e.enableUser = 1;
      } else {
        e.userEnabled = 0;
      }
    } else if (e.autoMsg !== -1) {
      e.cells.remove(e.autoOvl, e.autoMsg, ObjType.MESSAGE, e.display.masterScreen, e.freeCellGfx);
      e.autoMsg = -1;
    }
  }
}
