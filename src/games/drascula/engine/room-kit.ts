import type { DrasculaEngine } from "./loop";
import { type Sequence, wait } from "../../../engine/sequence";
import { pause } from "./cadence";
import type { Plane } from "../render/plane";
import { type RoomObject, Verb } from "./state";

/**
 * Aides communes aux gestionnaires de pièces (`engine/rooms/chapter-N/`), pour que les six chapitres ne les réécrivent pas :
 * `toggleDoor` et `hiccup` (actors.cpp, rooms.cpp, ScummVM), et l'accès aux objets de la pièce par leur numéro. Tout ce qui est
 * propre à un chapitre reste dans son dossier ; ce module n'est modifié que pour une aide qui sert à plusieurs chapitres
 * (`docs/drascula/rooms.md`).
 *
 * Écart : `hiccup` ne redessine pas à la main (`updateScreen` d'une zone décalée) ; il demande au rendu de décaler l'image
 * (`DrasculaRenderer.shake`) pendant la durée voulue.
 */

/** L'objet de numéro `id` de la pièce chargée (`objectNum[l] == id`), `undefined` s'il n'y est pas. */
export function roomObject(g: DrasculaEngine, id: number): RoomObject | undefined {
  return g.room.objects.find((object) => object.id === id);
}

/** Affiche ou masque l'objet `id` de la pièce (`visible[l] = 0 / 1`). Sans effet si la pièce n'a pas cet objet. */
export function setVisible(g: DrasculaEngine, id: number, visible: boolean): void {
  const object = roomObject(g, id);
  if (object) object.visible = visible;
}

/** Ouvre ou ferme le passage de l'objet `id` (`isDoor[l] = 0 / 1`). Sans effet si la pièce n'a pas cet objet. */
export function setDoor(g: DrasculaEngine, id: number, open: boolean): void {
  const object = roomObject(g, id);
  if (object) object.isDoor = open && object.door !== null;
}

/**
 * `toggleDoor(nflag, doorNum, action)` : ouvre (`"open"`) ou ferme (`"close"`) une porte dont l'état est le drapeau `flag`. Rien ne
 * se passe si la porte est déjà dans l'état demandé. Joue le son 3 ou 4, remet à jour la porte (`updateDoor`, chapitres 2 et 4),
 * redessine, attend la fin du son et vide le curseur. `doorIndex` : index de l'objet porte dans la pièce (`doorNum` de ScummVM ; `NO_DOOR` : `null`). Chapitre 1, drapeau 7 :
 * la porte ne s'ouvre jamais (comme l'original).
 */
export function* toggleDoor(g: DrasculaEngine, flag: number, doorIndex: number | null, action: "open" | "close"): Sequence {
  const flags = g.flags;
  if (!((flags[flag] === 0 && action === "open") || (flags[flag] === 1 && action === "close"))) return;
  if (g.chapter === 1 && flag === 7 && action === "open") return;
  if (action === "open") {
    g.playEffect(3);
    flags[flag] = 1;
  } else {
    g.playEffect(4);
    flags[flag] = 0;
  }
  if (doorIndex !== null) g.updateDoor(doorIndex);
  g.updateRoom();
  yield* wait(1); // `updateScreen()` : l'état se montre
  yield* g.finishSound();
  g.selectVerb(Verb.None);
}

/**
 * `hiccup(counter)` : l'écran sursaute `counter` fois (une secousse de 3 pas, `pause(3)` chacun). Au chapitre 3 l'image monte et
 * descend d'une ligne autour de sa place, ailleurs elle descend de zéro à deux lignes. L'écran est remis en place à la fin.
 */
export function* hiccup(g: DrasculaEngine, counter: number): Sequence {
  const gfx = g.gfx;
  const chapter3 = g.chapter === 3;
  let y = chapter3 ? -1 : 0;
  let down = false;
  try {
    do {
      counter--;
      g.updateRoom();
      gfx.shake = chapter3 ? { y, fromRow: 0, rows: 200 } : { y, fromRow: 1, rows: 198 };
      y += down ? -1 : 1;
      if (chapter3) {
        if (y === 1) down = true;
        if (y === -1) down = false;
      } else {
        if (y === 2) down = true;
        if (y === 0) down = false;
      }
      yield* pause(3);
    } while (counter > 0);
  } finally {
    gfx.shake = null;
  }
  g.updateRoom();
}

/** Les parties d'une image de pièce (`updateRoom`) que l'on compose à la main : par défaut toutes, comme `updateRoom`. */
export interface FrameParts {
  /** `updateRoom()` d'abord : le héros avance d'un pas avant que l'image soit composée (non par défaut). */
  advance?: boolean;
  /** `updateRefresh_pre` (par défaut oui). */
  pre?: boolean;
  /** `moveCharacters` (oui), rien (`false`), ou un dessin à la place du héros (une pose de `draw2` ou `draw3`). */
  hero?: boolean | ((screen: Plane) => void);
  /** Dessin entre le héros et `updateRefresh` (Von Braun, la machine). */
  between?: (screen: Plane) => void;
  /** `updateRefresh` (par défaut oui). */
  post?: boolean;
}

/**
 * Compose l'image de la pièce à la main (ordre de `updateRoom`) et la fige dans le canvas : `copyBackground(); … updateScreen();`.
 * Les cinématiques de ScummVM écrivent des sprites dans `screenSurface` ; ici l'écran est recomposé depuis l'état à chaque image, une
 * séquence qui dessine à la main prend donc l'image libre `gfx.canvas` (`graphics.md` § 11). `g.updateRoom()` rend la main à la pièce.
 */
export function freezeRoom(g: DrasculaEngine, parts: FrameParts = {}): void {
  if (parts.advance) g.updateRoom();
  const { gfx } = g;
  const scene = gfx.scene(g.state);
  scene.background();
  if (parts.pre !== false) scene.pre();
  const hero = parts.hero ?? true;
  if (typeof hero === "function") hero(gfx.screen);
  else if (hero) scene.hero();
  parts.between?.(gfx.screen);
  if (parts.post !== false) scene.post();
  gfx.canvas.load(gfx.screen.pixels);
  gfx.owner = "canvas";
}

/** Le héros dans une pose de `sheet` (`copyRect(sx, sy, curX + dx, curY + dy, w, h, sheet, screenSurface)`), à la place de son image. */
export function pose(g: DrasculaEngine, sheet: Plane, sx: number, sy: number, dx: number, dy: number, width: number, height: number): (screen: Plane) => void {
  const hero = g.state.hero;
  return (screen) => screen.copyRect(sheet, sx, sy, hero.x + dx, hero.y + dy, width, height);
}
