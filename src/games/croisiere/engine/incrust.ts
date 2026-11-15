/**
 * Incrustations de fond (`backgroundIncrustHead`) : objets dessinés définitivement dans un fond, avec sauvegarde du rectangle.
 *
 * Référence : `engines/cruise/backgroundIncrust.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `addBackgroundIncrust`,
 * `backupBackground`, `restoreBackground`, `regenerateBackgroundIncrust`, `freeBackgroundIncrustList`, `removeBackgroundIncrust`,
 * `unmergeBackgroundIncrust`. Lu puis réécrit.
 *
 * La liste est un tableau (seul le chaînage avant sert). Le dessin (sprite, ou modèle polygonal sans renvoi miroir ni masque) est
 * `render/draw.ts::drawIncrust` ; la sauvegarde du rectangle est ici. Le TTS de ScummVM (« Fin », titre) n'est pas repris.
 */
import { drawIncrust, incrustPolyBounds } from "../render/draw";
import { NUM_FILE_ENTRIES, ObjType } from "./ids";
import { getMultipleObjectParam } from "./objects";
import type { EngineState } from "./state";

export interface Incrust {
  objectIdx: number;
  /** 1 : rectangle sauvegardé (`saveBuffer`) ; −1 : à retirer. */
  type: number;
  overlayIdx: number;
  X: number;
  Y: number;
  frame: number;
  scale: number;
  backgroundIdx: number;
  scriptNumber: number;
  scriptOverlayIdx: number;
  saved: Uint8Array | null;
  saveWidth: number;
  saveHeight: number;
  savedX: number;
  savedY: number;
  name: string;
  spriteId: number;
}

function backup(inc: Incrust, x: number, y: number, width: number, height: number, bg: Uint8Array): void {
  inc.saveWidth = width;
  inc.saveHeight = height;
  inc.savedX = x;
  inc.savedY = y;
  inc.saved = new Uint8Array(Math.max(width * height, 0));
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const xp = j + x;
      const yp = i + y;
      inc.saved[i * width + j] = xp < 0 || yp < 0 || xp >= 320 || yp >= 200 ? 0 : bg[yp * 320 + xp]!;
    }
  }
}

function restore(e: EngineState, inc: Incrust): void {
  if (inc.type !== 1 || !inc.saved) return;
  const bg = e.display.backgroundScreens[inc.backgroundIdx];
  if (!bg) return;
  e.display.backgroundChanged[inc.backgroundIdx] = true;
  for (let i = 0; i < inc.saveHeight; i++) {
    for (let j = 0; j < inc.saveWidth; j++) {
      const xp = j + inc.savedX;
      const yp = i + inc.savedY;
      if (xp >= 0 && yp >= 0 && xp < 320 && yp < 200) bg[yp * 320 + xp] = inc.saved[i * inc.saveWidth + j]!;
    }
  }
}

/** `addBackgroundIncrust`. */
export function addBackgroundIncrust(e: EngineState, ovl: number, obj: number, scriptNumber: number, scriptOvl: number, plane: number, saveBuffer: number): Incrust | null {
  const params = getMultipleObjectParam(e, ovl, obj);
  const fileIdx = params?.fileIdx ?? 0;
  const file = e.filesDb.get(fileIdx);
  if (!file) return null;
  if (file.resourceType !== ObjType.SPRITE && file.resourceType !== ObjType.POLY) return null;
  const bg = e.display.backgroundScreens[plane];
  if (!bg) throw new Error(`addBackgroundIncrust : fond ${plane} absent`);
  e.display.backgroundChanged[plane] = true;
  const inc: Incrust = {
    objectIdx: obj, type: saveBuffer, overlayIdx: ovl, X: params!.X, Y: params!.Y, frame: fileIdx, scale: params!.scale,
    backgroundIdx: plane, scriptNumber, scriptOverlayIdx: scriptOvl, saved: null, saveWidth: 0, saveHeight: 0, savedX: 0, savedY: 0,
    name: file.name, spriteId: file.index,
  };
  e.incrusts.push(inc);
  if (file.resourceType === ObjType.SPRITE) {
    if (saveBuffer === 1) backup(inc, inc.X, inc.Y, file.width, file.height, bg);
  } else if (saveBuffer === 1) {
    // `getPolySize` : sizeTable = [gauche, droite, haut, bas] ; rectangle élargi de 2 pixels à gauche et à droite.
    const box = incrustPolyBounds(e, fileIdx, file, inc.X, inc.Y, inc.scale);
    if (box) backup(inc, box.left - 2, box.top, box.right + 2 - (box.left - 2) + 1, box.bottom - box.top + 1, bg);
  }
  drawIncrust(e, file, inc.X, inc.Y, inc.scale, bg);
  return inc;
}

/** `regenerateBackgroundIncrust` : redessine toutes les incrustations (rechargement de l'entrée de fichier si besoin). */
export function regenerateBackgroundIncrust(e: EngineState): void {
  for (const inc of [...e.incrusts]) {
    let frame = inc.frame;
    if (frame < 0) throw new Error("regenerateBackgroundIncrust : frame négative");
    const current = e.filesDb.get(frame);
    if (!current || current.name !== inc.name) {
      frame = NUM_FILE_ENTRIES - 1;
      if (e.filesDb.loadFile(inc.name, frame, inc.spriteId) < 0) frame = -1;
    }
    if (frame >= 0) {
      const file = e.filesDb.get(frame);
      const bg = e.display.backgroundScreens[inc.backgroundIdx];
      if (file && bg) drawIncrust(e, file, inc.X, inc.Y, inc.scale, bg);
      e.display.backgroundChanged[inc.backgroundIdx] = true;
    }
  }
}

/** `freeBackgroundIncrustList`. */
export function freeBackgroundIncrustList(e: EngineState): void {
  e.incrusts.length = 0;
}

/** `removeBackgroundIncrust` : retire les incrustations de l'objet à sa position actuelle. */
export function removeBackgroundIncrust(e: EngineState, ovl: number, idx: number): void {
  const params = getMultipleObjectParam(e, ovl, idx);
  const x = params?.X ?? 0;
  const y = params?.Y ?? 0;
  for (const inc of e.incrusts) {
    if ((inc.overlayIdx === ovl || ovl === -1) && (inc.objectIdx === idx || idx === -1) && inc.X === x && inc.Y === y) inc.type = -1;
  }
  const kept = e.incrusts.filter((inc) => inc.type !== -1);
  e.incrusts.length = 0;
  e.incrusts.push(...kept);
}

/** `unmergeBackgroundIncrust` : restaure le fond sous les incrustations de l'objet à sa position actuelle. */
export function unmergeBackgroundIncrust(e: EngineState, ovl: number, idx: number): void {
  const params = getMultipleObjectParam(e, ovl, idx);
  const x = params?.X ?? 0;
  const y = params?.Y ?? 0;
  for (const inc of e.incrusts) {
    if ((inc.overlayIdx === ovl || ovl === -1) && (inc.objectIdx === idx || idx === -1) && inc.X === x && inc.Y === y) restore(e, inc);
  }
}
