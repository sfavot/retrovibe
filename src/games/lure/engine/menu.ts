/**
 * Menus du jeu sans dessin : la barre de menus du haut (Crédits ; Recommencer, Sauvegarder, Restituer ; Quitter, Texte lent / rapide,
 * Avec / Sans son) et les menus surgissants (verbes, inventaire, objets et pièces pour « Demande » et « Dis à », listes de textes), en
 * **mode cliquable** (D4 : celui de ScummVM sur écran tactile, `kFeatureTouchscreen`).
 *
 * Source (ScummVM, GPL v3+) : `Menu::Menu`, `Menu::execute`, `getMenuAt`, `getIndexAt`, `PopupMenu::ShowInventory`, `ShowItems`,
 * `Show(actionMask)`, `Show(numEntries, actions)` (engines/lure/menu.cpp), `Surface::getDialogBounds`, `textX`, `textY` (surface.cpp).
 *
 * Écarts volontaires : chaque menu est une **séquence** (`src/engine/sequence.ts`) pilotée par les événements de la boucle au lieu d'une
 * boucle bloquante ; le rendu lit `MenuView` (vague R). Le mode « souris » de ScummVM (pointeur ramené au centre) n'est pas porté (D4) ;
 * la molette et les touches `indexPrevious` / `indexNext` / `indexSelect` / `escape` le sont, comme dans ScummVM.
 */

import { Action, UiString } from "../data/ids";
import type { Sequence } from "../../../engine/sequence";
import type { LureContext } from "./context";
import { DIALOG_TEXT_X, DIALOG_TEXT_Y, FONT_HEIGHT, FONT_WIDTH, FULL_SCREEN_HEIGHT, HotspotFlag, HotspotId, MENUBAR_Y_SIZE, MenuItem } from "./ids";

/** Bornes d'un menu de la barre en français (`menuList`, `FR_FRA`) : zone de l'en-tête, colonne et largeur du contenu (en caractères). */
const FRENCH_MENU_BOUNDS: ReadonlyArray<{ left: number; right: number; contentsX: number; contentsWidth: number }> = [
  { left: 40, right: 90, contentsX: 3, contentsWidth: 7 },
  { left: 120, right: 195, contentsX: 13, contentsWidth: 11 },
  { left: 232, right: 273, contentsX: 23, contentsWidth: 13 },
];

export interface MenuRecord {
  /** Zone de l'en-tête dans la barre (`hsxstart`, `hsxend`, bornes comprises). */
  hsxStart: number;
  hsxEnd: number;
  /** Position et largeur du menu déroulé (`xstart`, `width`). */
  xStart: number;
  width: number;
  entries: string[];
}

/** Hauteur d'une boîte de `numLines` lignes (`getDialogBounds`, lignes non tassées). */
export function dialogHeight(numLines: number): number {
  return DIALOG_TEXT_Y * 2 + FONT_HEIGHT * numLines;
}

/** Barre de menus (`Menu`) : trois menus ; les textes viennent de `0x3F17`. */
export class MenuBar {
  readonly menus: MenuRecord[];
  fastText = false;
  soundOn = true;

  constructor(private readonly ui: readonly string[]) {
    const entries = [
      [ui[UiString.CREDITS]!],
      [ui[UiString.RESTART_GAME]!, ui[UiString.SAVE_GAME]!, ui[UiString.RESTORE_GAME]!],
      [ui[UiString.QUIT]!, ui[UiString.SLOW_TEXT]!, ui[UiString.SOUND_ON]!],
    ];
    this.menus = FRENCH_MENU_BOUNDS.map((b, i) => ({
      hsxStart: b.left,
      hsxEnd: b.right,
      xStart: b.contentsX << 3,
      width: (b.contentsWidth + 3) << 3,
      entries: entries[i]!,
    }));
  }

  /** `doTextSpeed` / chargement : texte de l'entrée « Texte rapide / lent ». */
  setFastText(fast: boolean): void {
    this.fastText = fast;
    this.menus[2]!.entries[1] = this.ui[fast ? UiString.FAST_TEXT : UiString.SLOW_TEXT]!;
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    this.menus[2]!.entries[2] = this.ui[on ? UiString.SOUND_ON : UiString.SOUND_OFF]!;
  }

  /** `getMenuAt(x)`. */
  menuAt(x: number): number | null {
    const index = this.menus.findIndex((m) => x >= m.hsxStart && x <= m.hsxEnd);
    return index < 0 ? null : index;
  }

  /** `getIndexAt(x, y)` : entrée (à partir de 1) sous le pointeur dans le menu déroulé `menu`, 0 : aucune. */
  indexAt(menu: number | null, y: number): number {
    if (menu === null) return 0;
    const record = this.menus[menu]!;
    const ys = MENUBAR_Y_SIZE + DIALOG_TEXT_Y;
    const ye = MENUBAR_Y_SIZE + (dialogHeight(record.entries.length) - DIALOG_TEXT_Y);
    if (y < ys || y > ye) return 0;
    let index = Math.trunc((y - ys) / 8) + 1;
    if (index > record.entries.length) index = record.entries.length;
    return index;
  }

  /** Réponse de `Menu::execute` pour le menu et l'entrée choisis. */
  response(menu: number | null, index: number): number {
    if (menu === null || index === 0) return MenuItem.NONE;
    if (menu === 0) return MenuItem.CREDITS;
    if (menu === 1) return [MenuItem.NONE, MenuItem.RESTART_GAME, MenuItem.SAVE_GAME, MenuItem.RESTORE_GAME][index] ?? MenuItem.NONE;
    return [MenuItem.NONE, MenuItem.QUIT, MenuItem.TEXT_SPEED, MenuItem.SOUND][index] ?? MenuItem.NONE;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Événements et vue des menus
// ---------------------------------------------------------------------------------------------------------------------------------

/** Événements de la boucle tels que les menus les lisent (`Events::pollEvent`). */
export type MenuEvent =
  | { type: "move"; x: number; y: number }
  | { type: "lbuttondown"; x: number; y: number }
  | { type: "rbuttondown"; x: number; y: number }
  | { type: "lbuttonup"; x: number; y: number }
  | { type: "rbuttonup"; x: number; y: number }
  | { type: "wheel"; delta: -1 | 1 }
  | { type: "action"; action: string }
  | { type: "actionEnd"; action: string };

/** Source d'événements des séquences : rend et retire les événements reçus depuis la dernière lecture. */
export interface EventSource {
  takeEvents(): MenuEvent[];
}

/** Ce que le rendu montre d'un menu ouvert. */
export type MenuView =
  | { kind: "bar"; menu: number | null; index: number }
  | { kind: "popup"; entries: readonly string[]; selected: number; x: number; y: number; width: number; height: number };

/** Géométrie d'un menu surgissant cliquable (`PopupMenu::Show`) : à gauche de l'écran, centré en hauteur. */
export function popupGeometry(entries: readonly string[]): { x: number; y: number; width: number; height: number } {
  const numCols = entries.reduce((max, e) => Math.max(max, e.length), 0);
  const width = DIALOG_TEXT_X * 2 + FONT_WIDTH * numCols;
  const height = DIALOG_TEXT_Y * 2 + FONT_HEIGHT * entries.length;
  return { x: 0, y: (FULL_SCREEN_HEIGHT >> 1) - (height >> 1), width, height };
}

/**
 * `PopupMenu::Show(numEntries, actions)` en mode cliquable : rend le rang choisi, ou `0xFFFF` (clic droit, Échap, liste vide). `view`
 * reçoit l'état à montrer à chaque changement (`null` à la fermeture).
 */
export function* showPopup(events: EventSource, entries: readonly string[], view: (v: MenuView | null) => void): Sequence<number> {
  if (entries.length === 0) return 0xffff;
  const geometry = popupGeometry(entries);
  const yMiddle = FULL_SCREEN_HEIGHT >> 1;
  const left = DIALOG_TEXT_X;
  const right = geometry.width - DIALOG_TEXT_X + 1;
  const top = DIALOG_TEXT_Y;
  const bottom = geometry.height - DIALOG_TEXT_Y + 1;
  let selected = 0;
  const show = (): void => view({ kind: "popup", entries, selected, ...geometry });
  show();
  try {
    for (;;) {
      let pending: MenuEvent[] = [];
      yield { kind: "until", done: () => (pending = events.takeEvents()).length > 0 };
      for (const e of pending) {
        if (e.type === "wheel") {
          if (e.delta < 0 && selected > 0) selected--;
          else if (e.delta > 0 && selected < entries.length - 1) selected++;
        } else if (e.type === "action") {
          if (e.action === "indexPrevious" && selected > 0) selected--;
          else if (e.action === "indexNext" && selected < entries.length - 1) selected++;
          else if (e.action === "indexSelect") return selected;
          else if (e.action === "escape") return 0xffff;
        } else if (e.type === "lbuttondown" || e.type === "move") {
          const x = e.x;
          const y = e.y - yMiddle + (geometry.height >> 1);
          if (x >= left && x < right && y >= top && y < bottom) {
            selected = Math.trunc((y - top) / FONT_HEIGHT);
            if (e.type === "lbuttondown") return selected;
          }
        } else if (e.type === "rbuttondown") {
          return 0xffff;
        }
      }
      show();
    }
  } finally {
    view(null);
  }
}

/**
 * Comparaison de `strcmp` sur des chaînes en codes du jeu (octets non signés), utilisée pour trier les verbes (`qsort` de
 * `PopupMenu::Show(actionMask)`).
 */
export function compareGameStrings(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Verbes d'un masque d'actions (`Show(actionMask)`), triés par texte : `[action, texte]`. */
export function actionEntries(ui: readonly string[], actionMask: number): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (let current = 0; current < Action.EXAMINE; current++) {
    if ((actionMask & (1 << current)) !== 0) out.push([current + 1, ui[current]!]);
  }
  // `qsort` n'est pas stable, mais aucun verbe n'a le même texte qu'un autre.
  return out.sort((a, b) => compareGameStrings(a[1], b[1]));
}

/** `ShowInventory` : objets portés par le joueur, dans l'ordre de `0x3F07` : `[hotspot, nom]`. */
export function inventoryEntries(ctx: LureContext): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (const h of ctx.world.state.hotspots) if (h.roomNumber === HotspotId.PLAYER) out.push([h.hotspotId, ctx.text(h.nameId)]);
  return out;
}

/** Nombre d'entrées au plus de `ShowItems` (`MAX_NUM_DISPLAY_ITEMS`). */
const MAX_NUM_DISPLAY_ITEMS = 20;

/**
 * `ShowItems(contextAction, roomNumber)` : pièces puis hotspots connus du joueur qui acceptent le verbe (« Demande » : objets ; « Dis à
 * … Va à » : pièces), un seul par nom : `[numéro, nom]`.
 */
export function itemEntries(ctx: LureContext, contextAction: number, roomNumber: number): Array<[number, string]> {
  const world = ctx.world;
  const fields = world.fields;
  const bit = 1 << (contextAction - 1);
  const out: Array<[number, string]> = [];
  const nameIds: number[] = [];
  for (const room of world.state.rooms) {
    if (room.data.hdrFlags !== 15 && (room.data.hdrFlags & fields.hdrFlagMask) === 0) continue;
    if ((room.flags & HotspotFlag.MENU_EXCLUSION) !== 0 || (room.flags & HotspotFlag.FOUND) === 0) continue;
    if ((room.data.actions & bit) === 0) continue;
    if (out.length === MAX_NUM_DISPLAY_ITEMS) throw new Error("trop d'entrées dans le menu");
    out.push([room.roomNumber, ctx.text(room.roomNumber)]);
    nameIds.push(room.roomNumber);
  }
  for (const h of world.state.hotspots) {
    if (h.headerFlags !== 15 && (h.headerFlags & fields.hdrFlagMask) === 0) continue;
    if ((h.flags & HotspotFlag.MENU_EXCLUSION) !== 0 || (h.flags & HotspotFlag.FOUND) === 0) continue;
    if ((h.flags & HotspotFlag.ROOM_SPECIFIC) !== 0 && h.roomNumber !== roomNumber) continue;
    if ((h.actions & bit) === 0) continue;
    if (h.nameId === 0x17a || h.nameId === 0x147) continue;
    if (nameIds.includes(h.nameId)) continue;
    if (out.length === MAX_NUM_DISPLAY_ITEMS) throw new Error("trop d'entrées dans le menu");
    out.push([h.hotspotId, ctx.text(h.nameId)]);
    nameIds.push(h.nameId);
  }
  return out;
}

/**
 * `Menu::execute` en mode cliquable : le menu de l'en-tête sous le pointeur se déroule ; un appui alors qu'un menu est déroulé ferme la
 * barre, sur une entrée il la choisit. Rend une réponse `MenuItem`. Écart : ScummVM teste le bouton encore enfoncé après chaque lot
 * d'événements, ce qui referme parfois aussitôt un menu ouvert d'un toucher selon le moment où arrive le relâchement ; ici l'appui
 * qui déroule un menu ne le referme jamais.
 */
export function* executeMenuBar(
  bar: MenuBar,
  events: EventSource,
  pointer: { x: number; y: number },
  view: (v: MenuView | null) => void,
): Sequence<number> {
  let menu: number | null = null;
  let index = 0;
  const update = (x: number, y: number): void => {
    if (y < MENUBAR_Y_SIZE) {
      const at = bar.menuAt(x);
      if (at !== menu) {
        menu = at;
        index = 0;
      }
    }
    index = bar.indexAt(menu, y);
  };
  update(pointer.x, pointer.y);
  view({ kind: "bar", menu, index });
  try {
    for (;;) {
      let pending: MenuEvent[] = [];
      yield { kind: "until", done: () => (pending = events.takeEvents()).length > 0 };
      for (const e of pending) {
        if (e.type === "action") {
          if (e.action === "escape") return MenuItem.NONE;
          continue;
        }
        if (e.type === "wheel" || e.type === "actionEnd") continue;
        // Un appui alors qu'un menu est déroulé ferme la barre (sur une entrée : la choisit) ; sinon il déroule le menu touché.
        const wasOpen = menu !== null;
        update(e.x, e.y);
        if (e.type === "lbuttondown" && wasOpen) return bar.response(menu, index);
      }
      view({ kind: "bar", menu, index });
    }
  } finally {
    view(null);
  }
}
