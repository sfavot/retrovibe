/**
 * Bobs d'une pièce (`docs/fotaq/engine.md`, § 11) : meubles fixes et animés, objets, personnes, images collées dans le décor, et
 * rafraîchissement d'un objet dont l'image change. Réécriture de `Graphics::setupNewRoom`, `setupRoomFurniture`,
 * `setupRoomObjects`, `refreshObject`, `setupObjectAnim`, `pasteBob` (engines/queen/graphics.cpp, ScummVM).
 *
 * Numérotation des bobs (comme ScummVM) : 0 Joe, 1 à 3 les personnes, 5 et suivants les bobs animés (meubles d'abord, puis objets),
 * 20 et suivants les bobs fixes (meubles d'abord, puis objets). Les images des objets de la pièce sont rangées dans la table
 * d'images après celles de Joe (`FRAMES_JOE`), meubles d'abord. La banque des objets de la pièce (`<pièce>.BBK`) est à
 * l'emplacement 15.
 *
 * Écart : une image collée dans le décor (`pasteBob`) n'est pas dessinée ; elle est notée dans `pasteDowns`, dans l'ordre, pour la
 * vague R qui la dessinera sur le décor.
 */

import type { JasGraphic } from "../data/jas";
import { type AnimFrame, type Bobs, FRAMES_JOE, type FrameRef, personRank, roomBankFile, SFX_FRAME } from "./bobs";
import type { Actors } from "./actors";
import type { FotaqEngine } from "./loop";
import { isPerson, PASTE_DOWN } from "./room";

/** Emplacement de la banque des objets de la pièce. */
export const ROOM_BANK_SLOT = 15;

/** Une image collée dans le décor (`Display::drawBobPasteDown`) : sa position et la banque dont elle vient. */
export interface PasteDown {
  x: number;
  y: number;
  frame: FrameRef;
}

export class RoomGraphics {
  /** Images à coller dans le décor de la pièce courante, dans l'ordre. */
  pasteDowns: PasteDown[] = [];

  constructor(
    private readonly bobs: Bobs,
    private readonly actors: Actors,
  ) {}

  /** `Graphics::setupNewRoom` : bobs remis à zéro, banque de la pièce, meubles puis objets. */
  setupNewRoom(g: FotaqEngine, roomName: string, roomNum: number, furniture: readonly number[]): void {
    const bobs = this.bobs;
    bobs.clearBobs();
    this.pasteDowns = [];
    bobs.frames.load(roomBankFile(roomName), ROOM_BANK_SLOT);
    bobs.numFrames = FRAMES_JOE + 1;
    this.setupRoomFurniture(g, furniture);
    this.setupRoomObjects(g);
    if (roomNum >= 90) bobs.cameraBob = 0;
  }

  /** Image de l'objet `objNum` collée dans le décor en `image` (`Graphics::pasteBob`). */
  private pasteBob(g: FotaqEngine, objNum: number, image: number): void {
    const graphic = g.data.jas.graphics[objNum];
    const frames = this.bobs.frames;
    frames.unpack(graphic.firstFrame, image, ROOM_BANK_SLOT);
    const frame = frames.frame(image) as FrameRef;
    frames.erase(image);
    this.pasteDowns.push({ x: graphic.x, y: graphic.y, frame });
  }

  /** Meubles de la pièce (`Graphics::setupRoomFurniture`) : d'abord les fixes, puis les animés, puis les images collées. */
  private setupRoomFurniture(g: FotaqEngine, furniture: readonly number[]): void {
    const { graphics } = g.data.jas;
    const bobs = this.bobs;
    let curImage = FRAMES_JOE;

    bobs.numFurnitureStatic = 0;
    for (const obj of furniture) {
      if (obj > 0 && obj <= PASTE_DOWN) {
        const graphic = graphics[obj];
        if (graphic.lastFrame === 0) {
          bobs.numFurnitureStatic++;
          curImage++;
          bobs.frames.unpack(graphic.firstFrame, curImage, ROOM_BANK_SLOT);
          bobs.numFrames++;
          const bob = bobs.bob(19 + bobs.numFurnitureStatic);
          bob.curPos(graphic.x, graphic.y);
          bob.frameNum = curImage;
        }
      }
    }

    bobs.numFurnitureAnimated = 0;
    bobs.numFurnitureAnimatedLen = 0;
    let curBob = 0;
    for (const obj of furniture) {
      if (obj > 0 && obj <= PASTE_DOWN) {
        const graphic = graphics[obj];
        let lastFrame = graphic.lastFrame;
        let rebound = false;
        if (lastFrame < 0) {
          rebound = true;
          lastFrame = -lastFrame;
        }
        if (lastFrame > 0) {
          bobs.numFurnitureAnimatedLen += lastFrame - graphic.firstFrame + 1;
          bobs.numFurnitureAnimated++;
          const image = curImage + 1;
          for (let k = graphic.firstFrame; k <= lastFrame; k++) {
            curImage++;
            bobs.frames.unpack(k, curImage, ROOM_BANK_SLOT);
            bobs.numFrames++;
          }
          const bob = bobs.bob(5 + curBob);
          bob.animNormal(image, curImage, Math.trunc(graphic.speed / 4), rebound, false);
          bob.curPos(graphic.x, graphic.y);
          curBob++;
        }
      }
    }

    for (const obj of furniture) if (obj > PASTE_DOWN) this.pasteBob(g, obj - PASTE_DOWN, curImage + 1);
  }

  /** Objets et personnes de la pièce (`Graphics::setupRoomObjects`), après les meubles. */
  private setupRoomObjects(g: FotaqEngine): void {
    const { graphics } = g.data.jas;
    const { objects } = g.state;
    const bobs = this.bobs;
    let curImage = FRAMES_JOE + bobs.numFurnitureStatic + bobs.numFurnitureAnimatedLen;
    const first = g.currentRoomData + 1;
    const last = g.data.jas.roomFirstObject[g.state.room + 1];
    let numStatic = 0;
    let numAnimated = 0;

    // Les bobs des personnes (sauf Joe) sont invalidés.
    for (let i = 1; i <= 3; i++) bobs.bob(i).active = false;

    for (let i = first; i <= last; i++) {
      const object = objects[i];
      if (object.image === -1) {
        // Bob fixe éteint : image vide pour le rallumer plus tard.
        numStatic++;
        bobs.numFrames++;
        curImage++;
      } else if (object.image === -2) {
        // Bob animé éteint.
        numAnimated++;
      } else if (object.image > 0 && object.image < PASTE_DOWN) {
        const graphic = graphics[object.image];
        let lastFrame = graphic.lastFrame;
        let rebound = false;
        if (lastFrame < 0) {
          lastFrame = -lastFrame;
          rebound = true;
        }
        if (graphic.firstFrame < 0) {
          const bobNum = 5 + bobs.numFurnitureAnimated + numAnimated;
          this.setupObjectAnim(g, graphic, curImage + 1, bobNum, object.name > 0);
          curImage += graphic.lastFrame;
          numAnimated++;
        } else if (lastFrame !== 0) {
          const firstFrame = curImage + 1;
          for (let j = graphic.firstFrame; j <= lastFrame; j++) {
            curImage++;
            bobs.frames.unpack(j, curImage, ROOM_BANK_SLOT);
            bobs.numFrames++;
          }
          if (object.name > 0) {
            const bob = bobs.bob(5 + bobs.numFurnitureAnimated + numAnimated);
            bob.curPos(graphic.x, graphic.y);
            bob.frameNum = firstFrame;
            if (graphic.speed > 0) bob.animNormal(firstFrame, curImage, Math.trunc(graphic.speed / 4), rebound, false);
          }
          numAnimated++;
        } else {
          const bob = bobs.bob(20 + bobs.numFurnitureStatic + numStatic);
          curImage++;
          bob.clear();
          bobs.frames.unpack(graphic.firstFrame, curImage, ROOM_BANK_SLOT);
          bobs.numFrames++;
          if (object.name > 0) {
            bob.curPos(graphic.x, graphic.y);
            bob.frameNum = curImage;
          }
          numStatic++;
        }
      }
    }

    // Les personnes.
    for (let i = first; i <= last; i++) {
      if (isPerson(objects[i].image)) {
        const noun = i - g.currentRoomData;
        curImage = objects[i].name > 0 ? this.actors.setupPerson(g, noun, curImage) : this.actors.allocPerson(g, noun, curImage);
      }
    }

    // Les images collées dans le décor.
    curImage++;
    bobs.numFrames = curImage;
    for (let i = first; i <= last; i++) {
      if (objects[i].name > 0 && objects[i].image > PASTE_DOWN) this.pasteBob(g, objects[i].image - PASTE_DOWN, curImage);
    }
  }

  /**
   * Animation par chaîne d'un objet (`Graphics::setupObjectAnim`) : les images utilisées par la chaîne (celles des
   * `graphicAnimations` dont l'image clé est la première image de l'objet, triées, un numéro négatif retourne le bob) sont
   * rangées à partir de `firstImage` ; si l'objet est visible, le bob est posé et l'animation démarre.
   */
  private setupObjectAnim(g: FotaqEngine, graphic: JasGraphic, firstImage: number, bobNum: number, visible: boolean): void {
    const anims = g.data.jas.graphicAnimations;
    const used: number[] = [];
    for (let i = 1; i < anims.length; i++) {
      if (anims[i].keyFrame !== graphic.firstFrame) continue;
      const frame = anims[i].frame > SFX_FRAME ? anims[i].frame - SFX_FRAME : anims[i].frame;
      if (!used.includes(frame)) used.push(frame);
    }
    used.sort((a, b) => a - b);
    // Les emplacements au-delà des images trouvées valent 0 (tableau de 20 entrées de ScummVM).
    const temp = (n: number): number => used[n] ?? 0;

    for (let i = 0; i < graphic.lastFrame; i++) this.bobs.frames.unpack(Math.abs(temp(i)), firstImage + i, ROOM_BANK_SLOT);
    const bob = this.bobs.bob(bobNum);
    bob.animating = false;
    if (!visible) return;
    bob.curPos(graphic.x, graphic.y);
    if (temp(0) < 0) bob.xflip = true;
    const list: AnimFrame[] = [];
    for (let i = 1; i < anims.length; i++) {
      const anim = anims[i];
      if (anim.keyFrame !== graphic.firstFrame) continue;
      let frameNr = 0;
      for (let j = 1; j <= graphic.lastFrame; j++) {
        if (anim.frame > SFX_FRAME) {
          if (anim.frame - SFX_FRAME === temp(j - 1)) frameNr = j + firstImage - 1 + SFX_FRAME;
        } else if (anim.frame === temp(j - 1)) {
          frameNr = j + firstImage - 1;
        }
      }
      list.push({ frame: frameNr, speed: anim.speed });
    }
    this.bobs.newAnim[bobNum] = list;
    bob.animString(list);
  }

  /**
   * L'état de l'objet `obj` a changé : son bob est refait (`Graphics::refreshObject`) — éteint s'il est caché ou supprimé, sinon
   * image fixe ou animation à sa position. Sans effet pour un objet d'une autre pièce ou sans image.
   */
  refreshObject(g: FotaqEngine, obj: number): number {
    const bobs = this.bobs;
    let curImage = bobs.numFrames;
    const object = g.state.objects[obj];
    if (object.image === 0 || object.room !== g.state.room) return curImage;

    const curBob = bobs.findBob(g, obj);
    const bob = bobs.bob(curBob);

    if (isPerson(object.image)) {
      if (object.name <= 0) {
        bob.clear();
      } else {
        const rank = personRank(g, obj, g.state.room);
        const frames = this.actors.personFrames;
        curImage = frames[rank] - 1;
        if (frames[rank] === 0) frames[rank] = curImage = bobs.numFrames;
        curImage = this.actors.setupPerson(g, obj - g.currentRoomData, curImage);
      }
      return curImage;
    }

    curImage = bobs.findFrame(g, obj);
    if (object.name < 0 || object.image < 0) {
      bob.clear();
      return curImage;
    }

    const image = object.image > PASTE_DOWN ? object.image - PASTE_DOWN : object.image;
    const graphic = g.data.jas.graphics[image];
    let lastFrame = graphic.lastFrame;
    let rebound = false;
    if (lastFrame < 0) {
      lastFrame = -lastFrame;
      rebound = true;
    }
    if (graphic.firstFrame < 0) {
      this.setupObjectAnim(g, graphic, curImage, curBob, object.name !== 0);
      curImage += graphic.lastFrame - 1;
    } else if (lastFrame !== 0) {
      bob.animating = false;
      const firstImage = curImage;
      curImage--;
      for (let j = graphic.firstFrame; j <= lastFrame; j++) {
        curImage++;
        bobs.frames.unpack(j, curImage, ROOM_BANK_SLOT);
      }
      bob.curPos(graphic.x, graphic.y);
      bob.frameNum = firstImage;
      if (graphic.speed > 0) bob.animNormal(firstImage, curImage, Math.trunc(graphic.speed / 4), rebound, false);
    } else {
      bobs.frames.unpack(graphic.firstFrame, curImage, ROOM_BANK_SLOT);
      bob.curPos(graphic.x, graphic.y);
      bob.frameNum = curImage;
    }
    return curImage;
  }
}
