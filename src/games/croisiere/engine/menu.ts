/**
 * Menus du jeu : données (`menuStruct`, `menuElementStruct`, `menuElementSubStruct`), survol, sélection, boucle modale `processMenu`
 * et menu joueur, plus les chaînes système de `DELPHINE.LNG`.
 *
 * Références (ScummVM `engines/cruise/`, GPL v3+, release 2026.4.0, lu puis réécrit) :
 * - `menu.cpp` : `createMenu`, `addSelectableMenuEntry` (une entrée de même texte reçoit une sous-entrée de plus, 49 entrées au plus),
 *   `updateMenuMouse`, `processMenu`, `playerMenu`, `freeMenu` ;
 * - `cruise_main.cpp` : `getSelectedEntryInMenu`, `closeAllMenu` ;
 * - `cruise.cpp` : `langString`, `loadLanguageStrings` (fichier `DELPHINE.LNG`, sinon chaînes de `staticres.cpp`).
 *
 * Le dessin et le placement des entrées sont ceux de `render/draw.ts::drawMenu` (appelé par `mainDraw`), qui pose `x` et `y` de chaque
 * entrée ; `updateMenuMouse` les teste ensuite. Les boucles modales (`processMenu`, menu joueur) sont des générateurs (séquences) : chaque
 * `yield` est un tour modal du banc (ligne `MF`), repris par `CroisiereEngine.step()`.
 * Écarts : la synthèse vocale de ScummVM (`sayText`) n'est pas portée ; « Sauvegarder » et « Charger » appellent les crochets de l'hôte
 * (`onSaveRequest`, `onLoadRequest`) au lieu des dialogues de ScummVM.
 */
import type { Sequence } from "../../../engine/sequence";
import { LangId, parseLanguageFile } from "../data/language";
import { FALLBACK_LANGUAGE_STRINGS } from "../data/static-tables";
import { renderText, type MenuElementView, type MenuView, type TextGfx } from "../render/draw";
import type { EngineState } from "./state";

/** Fichier des chaînes système (hors des volumes, lu par `loadLanguageStrings`). */
export const LANGUAGE_FILE = "DELPHINE.LNG";

/** Relation (ou objet d'inventaire) attachée à une entrée (`menuElementSubStruct`). */
export interface MenuSub {
  ovlIdx: number;
  header: number;
}

/** Entrée (`menuElementStruct`) : `x`, `y`, `selected` et `gfx` sont ceux que lit le rendu. */
export interface MenuElement extends MenuElementView {
  string: string;
  /** Liste des sous-entrées (`ptrSub`), jamais vide. */
  subs: MenuSub[];
}

/** Menu (`menuStruct`). */
export interface Menu extends MenuView {
  stringPtr: string;
  gfx: TextGfx | null;
  elements: MenuElement[];
}

/** Retour de `processMenu` / `playerMenu` vers `processInput`. */
export const PlayerMenuEntry = { save: 4, load: 5, restart: 6, quit: 7 } as const;

const languageCache = new WeakMap<EngineState, readonly (string | null)[]>();

/** `langString` : chaîne système, de `DELPHINE.LNG` s'il est présent, sinon la chaîne de repli française (vide si absente). */
export function langString(e: EngineState, id: number): string {
  let strings = languageCache.get(e);
  if (!strings) {
    const file = e.readFile(LANGUAGE_FILE);
    strings = file ? parseLanguageFile(file) : FALLBACK_LANGUAGE_STRINGS.french;
    languageCache.set(e, strings);
  }
  return strings[id] ?? "";
}

/** `createMenu` : menu vide placé en `(X − 80, Y)`, titre rendu sur 160 pixels. */
export function createMenu(e: EngineState, x: number, y: number, name: string): Menu {
  return { x: x - 80, y, stringPtr: name, gfx: renderText(e, 160, name), elements: [] };
}

/**
 * `addSelectableMenuEntry` : avec `param2`, une entrée de même texte reçoit une sous-entrée en queue ; sinon (ou si aucune ne
 * correspond) une nouvelle entrée est ajoutée, tant que le menu en a 48 ou moins.
 */
export function addSelectableMenuEntry(e: EngineState, ovlIdx: number, headerIdx: number, menu: Menu, param2: number, color: number, text: string): void {
  if (menu.elements.length > 48) return;
  if (param2) {
    const same = menu.elements.find((el) => el.string === text);
    if (same) {
      same.subs.push({ ovlIdx, header: headerIdx });
      return;
    }
  }
  menu.elements.push({ x: 0, y: 0, selected: false, color, gfx: renderText(e, 160, text), string: text, subs: [{ ovlIdx, header: headerIdx }] });
}

/** `updateMenuMouse` : sélectionne la première entrée sous la souris (rectangle de 160 × hauteur du titre, bords gauche et haut exclus). */
export function updateMenuMouse(mouseX: number, mouseY: number, menu: Menu | null): void {
  if (!menu || !menu.gfx) return;
  const height = menu.gfx.height;
  let found = false;
  for (const el of menu.elements) {
    el.selected = false;
    if (!found && mouseX > el.x && el.x + 160 >= mouseX && mouseY > el.y && el.y + height >= mouseY) {
      found = true;
      el.selected = true;
    }
  }
}

/** Entrée retenue par `getSelectedEntryInMenu` (`currentMenuElement`, `currentMenuElementX/Y`). */
export interface SelectedEntry {
  element: MenuElement;
  x: number;
  y: number;
}

/** `getSelectedEntryInMenu` : sous-entrées de l'entrée sélectionnée (`null` sinon) ; retient l'entrée et sa position. */
export function getSelectedEntryInMenu(e: EngineState, menu: Menu | null): MenuSub[] | null {
  if (!menu || !menu.elements.length) return null;
  for (const el of menu.elements) {
    if (el.selected) {
      e.currentMenuElement = { element: el, x: el.x, y: el.y };
      return el.subs;
    }
  }
  return null;
}

/** `closeAllMenu` : ferme le menu d'objet et l'inventaire, oublie la relation liée et son bandeau. */
export function closeAllMenu(e: EngineState): void {
  e.menuTable[0] = null;
  e.menuTable[1] = null;
  e.linkedMsgList = null;
  e.linkedRelation = null;
}

/** Ce dont les boucles modales ont besoin de la boucle principale. */
export interface ModalHost {
  /** `mainDraw(waitFl)` puis `flipScreen()`. */
  redraw(waitFl: boolean): void;
  /** Fin d'un tour modal (après le `yield`) : `manageEvents`, compteur de tours, ligne `MF`. */
  modalTick(where: "menu" | "pause"): void;
  /** Recommencer (`initVars`, `initAllData`). */
  restart(): void;
  /** « Sauvegarder » / « Charger » du menu joueur. */
  onSaveRequest(): void;
  onLoadRequest(): void;
}

/** Un tour modal : rendu à l'hôte, puis `modalTick` à la reprise. */
const MODAL_TICK = { kind: "ticks", count: 1 } as const;

/**
 * `processMenu` : boucle modale (animations figées) jusqu'à un appui précédé d'un relâchement ; renvoie l'en-tête de l'entrée choisie
 * au bouton gauche, sinon −1.
 */
export function* processMenu(e: EngineState, host: ModalHost, menu: Menu): Sequence<number> {
  e.currentActiveMenu = 0;
  host.redraw(true);
  let released = false;
  let done = false;
  let button = 0;
  do {
    button = e.currentMouseButton;
    updateMenuMouse(e.currentMouseX, e.currentMouseY, menu);
    if (button) {
      if (released) done = true;
    } else {
      released = true;
    }
    host.redraw(true);
    yield MODAL_TICK;
    host.modalTick("menu");
    e.delay(10);
  } while (!done);
  e.currentActiveMenu = -1;
  host.redraw(true);
  if (button & 1) {
    const subs = getSelectedEntryInMenu(e, menu);
    return subs ? subs[0]!.header : -1;
  }
  return -1;
}

/** `playerMenu` : 1 pour quitter le jeu, sinon 0. Sans effet si le menu joueur est interdit ou l'affichage coupé. */
export function* playerMenu(e: EngineState, host: ModalHost, menuX: number, menuY: number): Sequence<number> {
  if (!e.playerMenuEnabled || !e.displayOn) return 0;
  const menu = createMenu(e, menuX, menuY, langString(e, LangId.playerMenu));
  e.menuTable[0] = menu;
  if (e.userEnabled) addSelectableMenuEntry(e, 0, PlayerMenuEntry.save, menu, 1, -1, langString(e, LangId.save));
  addSelectableMenuEntry(e, 0, PlayerMenuEntry.load, menu, 1, -1, langString(e, LangId.load));
  addSelectableMenuEntry(e, 0, PlayerMenuEntry.restart, menu, 1, -1, langString(e, LangId.restart));
  addSelectableMenuEntry(e, 0, PlayerMenuEntry.quit, menu, 1, -1, langString(e, LangId.quit));

  const choice = yield* processMenu(e, host, menu);
  e.menuTable[0] = null;
  e.currentMouseButton = 0;

  switch (choice) {
    case PlayerMenuEntry.save:
      host.onSaveRequest();
      break;
    case PlayerMenuEntry.load:
      host.onLoadRequest();
      break;
    case PlayerMenuEntry.restart:
      host.restart();
      break;
    case PlayerMenuEntry.quit:
      return 1;
  }
  return 0;
}
