/**
 * Entrées du joueur : clics, verbes, ligne de commande, inventaire, UTILISER à deux objets, recherche de la relation (REL), message
 * d'échec, cible de marche (globales 249 / 250), clavier, menu système. Logique seulement : le dessin des menus (vague R/I) lit `menus`.
 *
 * Référence : ScummVM engines/cine/various.cpp (`executePlayerInput`, `makeActionMenu`, `makeFWCommandLine`, `makeMenuChoice`,
 * `selectSubObject`, `processInventory`, `makeSystemMenu`, `playerCommandMouseLeft`, `playerCommandMouseLeftRightUp`,
 * `noPlayerCommandMouseLeft`, `getRelEntryForObject`, `getObjectUnderCursor`), main_loop.cpp (`processEvent`), gfx.cpp (`gfxGetBit`)
 * (GPL v3 ou ultérieure). docs/voyageurs/engine.md § 4.
 *
 * Les attentes bloquantes de ScummVM (`manageEvents`) sont des sous-séquences (`Sequence`) : un menu ouvert suspend le tick en cours,
 * qui reprend quand le joueur a choisi, comme dans ScummVM.
 *
 * Écarts volontaires : le menu système n'a pas l'entrée « Lecteur de Svg. A: » (sans effet, D9) ; Charger et Sauver ouvrent les dialogues
 * du site (`requestLoad`, `requestSave`) au lieu de l'interface de ScummVM ; la lecture du masque hors du sprite (C : hors tampon) rend
 * « pas d'objet » ; un sprite sans masque dans un calque 0 (plantage de ScummVM) n'est pas cliquable.
 */

import type { Sequence } from "../../../engine/sequence";
import type { VoyageursAction } from "./host";
import { addObjectScript } from "./part";
import type { MenuView } from "./services";
import {
  addPlayerCommandMessage,
  type EngineState,
  objectsWithCostume,
  OverlayType,
  toI16,
  VAR_MOUSE_X_MODE,
  VAR_MOUSE_X_POS,
  VAR_MOUSE_Y_MODE,
  VAR_MOUSE_Y_POS,
} from "./state";
import { CHOICE_RESULT, CONFIRM_MENU, DEFAULT_PREPOSITION, PAUSE_MESSAGE, PREPOSITIONS, VERBS } from "./texts";

/** Origine d'une attente (`CallSource`, numéros de ScummVM) : seules celles hors `ExecutePlayerInput` sont modales (trace `MW` du banc). */
export const EventSource = {
  ExecutePlayerInput: 0,
  MainLoopWaitForPlayerClick: 1,
  MakeMenuChoice: 2,
  MakeSystemMenu: 3,
  MakeTextEntryMenu: 4,
  ProcessInventory: 5,
  WaitPlayerInput: 6,
} as const;

/** Condition de fin d'une attente (`EventTarget`, numéros de ScummVM). */
export const EventTarget = {
  UntilMouseButtonUpDownUp: 0,
  UntilMouseButtonDownUp: 1,
  UntilMouseButtonUp: 2,
  UntilMouseButtonUpAndWaitEnded: 3,
  UntilMouseButtonUpDown: 4,
  UntilMouseButtonDown: 5,
  UntilMouseButtonDownOrKeyUpOrDownOrInRects: 6,
  UntilMouseButtonDownOrKeyInput: 7,
  UntilWaitEnded: 8,
  EmptyEventQueue: 9,
} as const;

/** `Common::Rect` (bornes droite et basse exclues). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/** Menu ouvert, modifiable par le moteur. */
export interface MenuState extends MenuView {
  selection: number;
}

/** Ce dont la logique des entrées a besoin du moteur. */
export interface InputEngine {
  readonly state: EngineState;
  /** Position et boutons en cours (`getMousePos`, `mouseLeft`, `mouseRight`). */
  readonly mouse: { x: number; y: number; left: number; right: number };
  /** Boutons lus à la fin de la dernière attente (`mouseData`, maximum de l'attente si demandé). */
  readonly mouseData: { left: number; right: number };
  menus: MenuState[];
  inMenu: boolean;
  /** Texte affiché par `drawString` (pause), ou `null`. */
  banner: string | null;
  /** Actions reçues (`_actionList`), dépilées par les menus. */
  actionList: VoyageursAction[];
  manageEvents(source: number, target: number, useMax?: boolean, rects?: Rect[]): Sequence;
  /** `drawFrame` (dessin, messages, hasard des messages d'échec). */
  render(): void;
  requestQuit(): void;
  requestRestart(): void;
  requestSave(): void;
  requestLoad(): void;
}

/** Boutons au format de `getMouseData` : 1 = gauche, 2 = droit. */
function buttons(engine: InputEngine): number {
  return (engine.mouseData.left ? 1 : 0) | (engine.mouseData.right ? 2 : 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fonctions pures

/** `gfxGetBit` : 1 si l'octet (x, y) d'une page de largeur `width` est nul ; hors de la page : 0. */
function getBit(x: number, y: number, data: Uint8Array, width: number): number {
  if (x > width) return 0;
  const value = data[y * width + x];
  return value === 0 ? 1 : 0;
}

/**
 * `getObjectUnderCursor` : calques du dessus vers le dessous, types 0 (masque de transparence) et 1 (masque MSK), objets nommés ; la ligne
 * du haut du sprite n'est pas cliquable (`ydif <= 0`). Rend l'objet ou -1.
 */
export function objectUnderCursor(state: EngineState, x: number, y: number): number {
  for (let i = state.overlays.length - 1; i >= 0; i--) {
    const overlay = state.overlays[i]!;
    if (overlay.type >= OverlayType.Message) continue;
    const obj = state.objects[overlay.objIdx]!;
    if (!obj.name) continue;
    const anim = state.anims[Math.abs(obj.frame)] ?? null;
    if (!anim) continue;
    const threshold = overlay.type === OverlayType.Sprite ? anim.var1 : Math.trunc(anim.width / 2);
    const xdif = toI16(x - obj.x);
    const ydif = toI16(y - obj.y);
    if (xdif < 0 || toI16(threshold << 4) <= xdif || ydif <= 0 || ydif >= anim.height) continue;
    if (overlay.type === OverlayType.Sprite) {
      if (anim.mask && getBit(xdif, ydif, anim.mask, anim.width)) return overlay.objIdx;
    } else if (getBit(xdif, ydif, anim.data, anim.width * 4)) {
      return overlay.objIdx;
    }
  }
  return -1;
}

/**
 * `getRelEntryForObject` : première entrée REL du verbe `verb` pour l'objet `idx` (et l'objet `param` si `count` = 2), ou -1.
 * `verb` 6 : action directe au clic gauche sans verbe.
 */
export function relEntryForObject(state: EngineState, verb: number, count: number, idx: number, param: number): number {
  for (let i = 0; i < state.relTable.length; i++) {
    const rel = state.relTable[i]!;
    if (rel.p1 !== verb || rel.p2 !== idx) continue;
    if (count === 1) return i;
    if (count === 2 && rel.p3 === param) return i;
  }
  return -1;
}

/** Cible de marche du clic gauche (`VAR_MOUSE_X_POS` vaut au moins 1). */
function setWalkTarget(state: EngineState, x: number, y: number): void {
  state.globals[VAR_MOUSE_X_POS] = x || 1;
  state.globals[VAR_MOUSE_Y_POS] = y;
}

/** Texte de base de la ligne de commande pour `playerCommand` (`makeFWCommandLine`). */
function commandBase(command: number): string {
  if (command < 0) return "";
  const prep = PREPOSITIONS[command] ?? "";
  return CHOICE_RESULT[command] !== 2 && prep ? `${VERBS[command]} ${prep}` : VERBS[command]!;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Menus

/**
 * `makeMenuChoice` (FW : pas d'entrée vide, clic droit = -1) : ouvre le menu, attend le relâchement, suit la souris, valide au clic.
 * Le menu reste affiché jusqu'à `clearMenuStack` (fin de `executePlayerInput`).
 */
export function* makeMenuChoice(engine: InputEngine, kind: MenuView["kind"], items: readonly string[], X0: number, Y0: number, width: number): Sequence<number> {
  const height = items.length;
  const paramY = height * 9 + 10;
  let X = X0 & 0xffff;
  let Y = Y0 & 0xffff;
  if (X + width > 319) X = 319 - width;
  if (Y + paramY > 199) Y = 199 - paramY;
  const menu: MenuState = { kind, items, x: X, y: Y, width, selection: -1 };
  engine.menus.push(menu);
  engine.render();

  yield* engine.manageEvents(EventSource.MakeMenuChoice, EventTarget.UntilMouseButtonUp);
  let current = 0;
  menu.selection = current;
  engine.render();
  yield* engine.manageEvents(EventSource.MakeMenuChoice, EventTarget.EmptyEventQueue);

  let chosen = false;
  let button = 0;
  while (!chosen) {
    const rects: Rect[] = [];
    if (current > 0) rects.push({ left: X + 1, top: Y + 1, right: X + width, bottom: current * 9 + Y + 4 });
    if (current !== -1 && current < height - 1) rects.push({ left: X + 1, top: current * 9 + 13 + Y, right: X + width, bottom: Y + paramY + 1 });
    yield* engine.manageEvents(EventSource.MakeMenuChoice, EventTarget.UntilMouseButtonDownOrKeyUpOrDownOrInRects, false, rects);
    button = buttons(engine);
    if (button) chosen = true;
    const old = current;
    let diff = 0;
    while (engine.actionList.length) {
      const action = engine.actionList.pop();
      if (action === "menuUp") diff--;
      else if (action === "menuDown") diff++;
    }
    const { x: mouseX, y: mouseY } = engine.mouse;
    if (diff !== 0) {
      current = Math.min(Math.max(current + diff, 0), height - 1);
    } else if (mouseX > X && mouseX < X + width && mouseY > Y && mouseY < Y + paramY + 1) {
      current = Math.trunc((mouseY - (Y + 4)) / 9);
      if (current < 0) current = 0;
      if (current >= height) current = height - 1;
    }
    if (current !== old) {
      menu.selection = current;
      engine.render();
    }
  }
  yield* engine.manageEvents(EventSource.MakeMenuChoice, EventTarget.UntilMouseButtonUp);
  return button === 2 ? -1 : current;
}

/** `makeActionMenu` : menu des six verbes, largeur 70 (sans effet si les menus sont bloqués). */
export function* makeActionMenu(engine: InputEngine): Sequence {
  engine.inMenu = true;
  const { x, y } = engine.mouse;
  if (engine.state.disableSystemMenu === 0) engine.state.playerCommand = yield* makeMenuChoice(engine, "verbs", VERBS, x, y, 70);
  engine.inMenu = false;
}

/** `selectSubObject` : choix d'un objet porté (largeur 140). -2 si l'inventaire est vide, -1 si annulé. */
export function* selectSubObject(engine: InputEngine, x: number, y: number, costume: number): Sequence<number> {
  const list = objectsWithCostume(engine.state, costume).slice(0, 20);
  if (!list.length) return -2;
  let selected = -1;
  if (engine.state.disableSystemMenu === 0) {
    engine.inMenu = true;
    const names = list.map((i) => engine.state.objects[i]!.name);
    selected = yield* makeMenuChoice(engine, "object", names, x, y, 140);
    engine.inMenu = false;
  }
  return selected === -1 ? -1 : list[selected]!;
}

/** `processInventory` : liste des objets portés jusqu'au prochain clic, sans action. */
export function* processInventory(engine: InputEngine, x: number, y: number): Sequence {
  const list = objectsWithCostume(engine.state, -2).slice(0, 20);
  if (!list.length) return;
  const items = list.map((i) => engine.state.objects[i]!.name);
  const menu: MenuState = { kind: "inventory", items, x: x & 0xffff, y: y & 0xffff, width: 140, selection: -1 };
  engine.inMenu = true;
  engine.menus.push(menu);
  engine.render();
  yield* engine.manageEvents(EventSource.ProcessInventory, EventTarget.UntilMouseButtonDownUp);
  engine.menus.splice(engine.menus.indexOf(menu), 1);
  engine.inMenu = false;
}

/** `makeFWCommandLine` : texte du verbe ; UTILISER demande d'abord un objet porté ; INVENTAIRE ouvre la liste. */
export function* makeCommandLine(engine: InputEngine): Sequence {
  const { state } = engine;
  state.commandVar1 = 0;
  state.commandVar2 = -10;
  state.commandBuffer = commandBase(state.playerCommand);
  const needsObject = state.playerCommand !== -1 && CHOICE_RESULT[state.playerCommand] === 2;
  if (needsObject) {
    const { x, y } = engine.mouse;
    const si = yield* selectSubObject(engine, x, y + 8, -2);
    if (si < 0) {
      state.playerCommand = -1;
      state.commandBuffer = "";
    } else {
      state.commandVar3[0] = si;
      state.commandVar1 = 1;
      state.commandBuffer += ` ${state.objects[si]!.name} ${DEFAULT_PREPOSITION}`;
    }
  }
  if (!needsObject && state.playerCommand === 2) {
    const { x, y } = engine.mouse;
    yield* processInventory(engine, x, y + 8);
    state.playerCommand = -1;
    state.commandVar1 = 0;
    state.commandBuffer = "";
  }
  if (!state.disableSystemMenu) {
    state.isDrawCommandEnabled = 1;
    state.commandLine = state.commandBuffer;
  }
}

/** `playerCommandMouseLeftRightUp` : survol avec un verbe, « VERBE objet » sur la ligne de commande. */
export function playerCommandHover(engine: InputEngine, x: number, y: number): void {
  const { state } = engine;
  const obj = objectUnderCursor(state, x, y);
  if (obj !== -1) state.commandLine = `${state.commandBuffer} ${state.objects[obj]!.name}`;
  else state.isDrawCommandEnabled = 1;
  state.commandVar2 = obj;
}

/** `playerCommandMouseLeft` : clic gauche avec un verbe : objet ajouté, relation lancée ou message d'échec ; dans le vide, cible de marche. */
export function* playerCommandMouseLeft(engine: InputEngine, x: number, y: number): Sequence {
  const { state } = engine;
  yield* engine.manageEvents(EventSource.ExecutePlayerInput, EventTarget.UntilMouseButtonUp);
  const si = objectUnderCursor(state, x, y);
  if (si === -1) {
    setWalkTarget(state, x, y);
    return;
  }
  state.commandVar3[state.commandVar1] = si;
  state.commandVar1++;
  state.commandBuffer += ` ${state.objects[si]!.name}`;
  state.isDrawCommandEnabled = 1;
  const command = state.playerCommand;
  if (CHOICE_RESULT[command] === state.commandVar1) {
    const rel = relEntryForObject(state, command, state.commandVar1, state.commandVar3[0]!, state.commandVar3[1]!);
    if (rel !== -1) addObjectScript(state, rel);
    else addPlayerCommandMessage(state, command);
    state.playerCommand = -1;
    state.commandVar1 = 0;
    state.commandBuffer = "";
  }
  state.commandLine = state.commandBuffer;
}

/** `noPlayerCommandMouseLeft` : clic gauche sans verbe : cible de marche, et relation directe (verbe 6) de l'objet cliqué. */
export function noPlayerCommandMouseLeft(engine: InputEngine, x: number, y: number): void {
  const { state } = engine;
  setWalkTarget(state, x, y);
  const obj = objectUnderCursor(state, x, y);
  if (obj === -1) return;
  const rel = relEntryForObject(state, 6, 1, obj, -1);
  if (rel !== -1) addObjectScript(state, rel);
}

/** Entrées du menu système du port (D9) et commande de ScummVM correspondante. */
const SYSTEM_ENTRIES: readonly { label: string; command: number }[] = [
  { label: "Pause", command: 0 },
  { label: "Nouvelle partie", command: 1 },
  { label: "Quitter", command: 2 },
  { label: "Charger une partie", command: 4 },
  { label: "Sauver la partie", command: 5 },
];

/** `makeSystemMenu` : Pause, Nouvelle partie, Quitter (avec confirmation), Charger, Sauver (absent quand les entrées sont bloquées). */
export function* makeSystemMenu(engine: InputEngine): Sequence {
  const { state } = engine;
  if (state.disableSystemMenu === 1) return;
  engine.inMenu = true;
  yield* engine.manageEvents(EventSource.MakeSystemMenu, EventTarget.UntilMouseButtonUp);
  const { x, y } = engine.mouse;
  const entries = state.allowPlayerInput ? SYSTEM_ENTRIES : SYSTEM_ENTRIES.slice(0, -1);
  const choice = yield* makeMenuChoice(engine, "system", entries.map((e) => e.label), x, y, 140);
  switch (entries[choice]?.command) {
    case 0:
      engine.banner = PAUSE_MESSAGE;
      engine.render();
      yield* engine.manageEvents(EventSource.WaitPlayerInput, EventTarget.UntilMouseButtonDownUp);
      engine.banner = null;
      break;
    case 1:
    case 2: {
      const command = entries[choice]!.command;
      const { x: cx, y: cy } = engine.mouse;
      if ((yield* makeMenuChoice(engine, "confirm", CONFIRM_MENU, cx, cy + 8, 100)) === 0) {
        if (command === 1) engine.requestRestart();
        else engine.requestQuit();
      }
      break;
    }
    case 4:
      engine.requestLoad();
      break;
    case 5:
      engine.requestSave();
      break;
    default:
      break;
  }
  engine.inMenu = false;
}

/** Action du clavier traitée à sa réception (`processEvent`, `EVENT_CUSTOM_ENGINE_ACTION_START`). */
export function* processAction(engine: InputEngine, action: VoyageursAction): Sequence {
  const { state } = engine;
  engine.actionList.push(action);
  if (engine.actionList.length > 32) engine.actionList.shift();
  const verb = ["examine", "take", "inventory", "use", "activate", "speak"].indexOf(action);
  if (verb >= 0) {
    // INVENTAIRE et UTILISER sont ignorés dans un menu.
    if (state.allowPlayerInput && (verb === 0 || verb === 1 || verb >= 4 || !engine.inMenu)) {
      state.playerCommand = verb;
      yield* makeCommandLine(engine);
    }
  } else if (action === "actionMenu") {
    if (state.allowPlayerInput && !engine.inMenu) {
      yield* makeActionMenu(engine);
      yield* makeCommandLine(engine);
    }
  } else if (action === "systemMenu") {
    if (!engine.inMenu) yield* makeSystemMenu(engine);
  }
}

/** Déplacement au clavier (`moveUsingKeyboard`, `executePlayerInput`). */
export interface KeyboardWalk {
  xMove: number;
  yMove: number;
  moved: boolean;
}

/** `moveUsingKeyboard` : x > 0 droite, x < 0 gauche ; y > 0 haut, y < 0 bas ; (0, 0) arrête. */
export function setKeyboardWalk(walk: KeyboardWalk, dx: number, dy: number): void {
  walk.xMove = dx > 0 ? 1 : dx < 0 ? 2 : 0;
  walk.yMove = dy > 0 ? 2 : dy < 0 ? 1 : 0;
  walk.moved = dx !== 0 || dy !== 0;
}

/** `executePlayerInput` (FW) : attente du tick en lisant la souris, puis clics, puis marche au clavier. */
export function* executePlayerInput(engine: InputEngine, walk: KeyboardWalk): Sequence {
  const { state } = engine;
  if (state.allowPlayerInput) {
    if (state.isDrawCommandEnabled) state.commandLine = state.commandBuffer;
    state.isDrawCommandEnabled = 0;
    yield* engine.manageEvents(EventSource.ExecutePlayerInput, EventTarget.UntilWaitEnded, true);
  } else {
    yield* engine.manageEvents(EventSource.ExecutePlayerInput, EventTarget.UntilMouseButtonUpAndWaitEnded, true);
  }
  const { x, y } = engine.mouse;
  const left = engine.mouseData.left !== 0;
  const right = engine.mouseData.right !== 0;
  if (left && right) {
    yield* makeSystemMenu(engine);
  } else if (state.allowPlayerInput) {
    if (!left && right) {
      yield* makeActionMenu(engine);
      yield* makeCommandLine(engine);
    } else if (state.playerCommand !== -1) {
      if (left) yield* playerCommandMouseLeft(engine, x, y);
      else playerCommandHover(engine, x, y);
    } else if (left) {
      noPlayerCommandMouseLeft(engine, x, y);
    }
  }
  if (walk.moved && state.allowPlayerInput) {
    walk.moved = false;
    const hero = state.objects[1]!;
    const modeX = state.globals[VAR_MOUSE_X_MODE];
    const modeY = state.globals[VAR_MOUSE_Y_MODE];
    const mouseX = modeX === 1 ? hero.x + 12 : modeX === 2 ? hero.x + 7 : state.globals[VAR_MOUSE_X_POS]!;
    const mouseY = modeY === 1 ? hero.y + 34 : modeY === 2 ? hero.y + 28 : state.globals[VAR_MOUSE_Y_POS]!;
    // `menuVar` n'est jamais alimenté : `var_5E` vaut 0.
    if (state.bgVar0 === 0) {
      state.globals[VAR_MOUSE_X_POS] = mouseX;
      state.globals[VAR_MOUSE_Y_POS] = mouseY;
    } else {
      state.globals[VAR_MOUSE_X_POS] = walk.xMove ? (walk.xMove === 2 ? 1 : 320) : mouseX;
      state.globals[VAR_MOUSE_Y_POS] = walk.yMove ? (walk.yMove === 2 ? 1 : 200) : mouseY;
    }
    state.bgVar0 = 0;
  }
  engine.menus = [];
}
