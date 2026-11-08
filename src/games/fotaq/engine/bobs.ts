/**
 * Bobs (sprites animés) de *Flight of the Amazon Queen* : l'état, sans dessin (`docs/fotaq/engine.md`, § 11). Réécriture de
 * `BobSlot` et des parties « logiques » de `Graphics` (engines/queen/graphics.cpp, graphics.h, bankman.cpp, ScummVM) :
 * déplacement en ligne droite, animation en boucle ou par chaîne d'images, tri en profondeur, table d'images, numéro de bob et
 * d'image d'un objet (`Logic::findBob`, `Logic::findFrame`, logic.cpp).
 *
 * Ce qui change par rapport à ScummVM :
 * - une image (`BobFrame`) n'est pas copiée dans un tampon : la table d'images (`FrameTable`) garde la **référence** (fichier de
 *   banque, numéro d'image) que `bankman.unpack` copiait ; la vague R lit les pixels dans la banque. La numérotation des images
 *   et des emplacements de banque est celle de ScummVM (`FRAMES_JOE` = 38, 256 images, banques 7, 10, 11, 12, 13, 15) ;
 * - une chaîne d'animation est un tableau d'`AnimFrame` (la fin de chaîne de ScummVM, image 0, est la fin du tableau) ;
 * - le dessin (`drawBob`, `shrinkFrame`, `setBobText`) est pour la vague R : la boîte de découpe et l'échelle sont seulement
 *   gardées dans le bob ;
 * - la marche et les bobs n'ont pas de limite de taille de tampon (`MAX_WALK_DATA`, `BOB_SHRINK_BUF_SIZE`).
 */

import type { Box } from "../data/jas";
import { isPerson, PASTE_DOWN } from "./room";
import { toInt16, type World } from "./state";

/** Nombre d'emplacements de bobs (`MAX_BOBS_NUMBER`). */
export const MAX_BOBS = 64;
/** Nombre d'images de la table (`MAX_FRAMES_NUMBER`) et premières réservées à Joe (`FRAMES_JOE`). */
export const MAX_FRAMES = 256;
export const FRAMES_JOE = 38;
/** Image au-dessus de laquelle l'image porte aussi un effet sonore (`frameNum > 500`). */
export const SFX_FRAME = 500;

/** Une étape d'une animation par chaîne : numéro d'image (> 500 : effet sonore) et durée (en quarts d'image de ScummVM). */
export interface AnimFrame {
  frame: number;
  speed: number;
}

/**
 * Chaîne d'animation d'un acteur (`QUEEN2.JAS`) : couples « image, durée » sur 4 caractères chacun (`"%3hu,%3hu,"`), lus à
 * positions fixes comme `Graphics::fillAnimBuffer` (`atoi`), jusqu'à l'image 0. Une chaîne du jeu contient un point à la place
 * d'une virgule ; la lecture à positions fixes la tolère.
 */
export function parseAnimString(text: string): AnimFrame[] {
  const frames: AnimFrame[] = [];
  for (let i = 0; i + 4 <= text.length; i += 8) {
    const frame = Number.parseInt(text.slice(i, i + 4), 10) || 0;
    const speed = Number.parseInt(text.slice(i + 4, i + 8), 10) || 0;
    if (frame === 0) break;
    frames.push({ frame, speed });
  }
  return frames;
}

/** Nombre d'images distinctes d'une chaîne (`Graphics::countAnimFrames`). */
export function countAnimFrames(frames: readonly AnimFrame[]): number {
  return new Set(frames.map((f) => (f.frame > SFX_FRAME ? f.frame - SFX_FRAME : f.frame))).size;
}

/** Division entière tronquée vers zéro (les `/` entiers de C++). */
const div = (a: number, b: number): number => Math.trunc(a / b);

export class BobSlot {
  active = false;
  /** Position des pieds dans le décor (avant défilement). */
  x = 0;
  y = 0;
  /** Boîte de découpe ; `null` : celle de l'écran de jeu (`_defaultBox`). */
  box: Box | null = null;
  xflip = false;
  /** Échelle en pourcentage. */
  scale = 0;
  /** Numéro de l'image dans la table (`FrameTable`). */
  frameNum = 0;
  frameDir = 0;

  animating = false;
  anim = {
    speed: 0,
    speedBak: 0,
    /** Animation par chaîne (`null` : animation en boucle). */
    string: null as AnimFrame[] | null,
    stringPos: 0,
    normal: { rebound: false, firstFrame: 0, lastFrame: 0 },
  };

  moving = false;
  /** Nombre de pas par image. */
  speed = 0;
  /** Le déplacement avance d'un pas en x (sinon en y) à chaque pas. */
  xmajor = false;
  xdir = 0;
  ydir = 0;
  endx = 0;
  endy = 0;
  dx = 0;
  dy = 0;
  total = 0;

  /** Pose le bob (`BobSlot::curPos`) : les coordonnées du fichier sont des `uint16` rangés dans des `int16` (65444 vaut -92, un objet qui entre par le haut). */
  curPos(x: number, y: number): void {
    this.active = true;
    this.x = toInt16(x);
    this.y = toInt16(y);
  }

  /** Déplacement en ligne droite (algorithme de Bresenham) vers (`dstx`, `dsty`) à `spd` pas par image (`BobSlot::move`). */
  move(dstx: number, dsty: number, spd: number): void {
    this.active = true;
    this.moving = true;
    this.endx = dstx;
    this.endy = dsty;
    this.speed = spd < 1 ? 1 : spd;
    const deltax = this.endx - this.x;
    this.dx = Math.abs(deltax);
    this.xdir = deltax < 0 ? -1 : 1;
    const deltay = this.endy - this.y;
    this.dy = Math.abs(deltay);
    this.ydir = deltay < 0 ? -1 : 1;
    if (this.dx > this.dy) {
      this.total = div(this.dy, 2);
      this.xmajor = true;
    } else {
      this.total = div(this.dx, 2);
      this.xmajor = false;
    }
    // Un pas tout de suite, pour éviter un à-coup.
    this.moveOneStep();
  }

  moveOneStep(): void {
    if (this.xmajor) {
      if (this.x === this.endx) {
        this.y = this.endy;
        this.moving = false;
      } else {
        this.x += this.xdir;
        this.total += this.dy;
        if (this.total > this.dx) {
          this.y += this.ydir;
          this.total -= this.dx;
        }
      }
    } else if (this.y === this.endy) {
      this.x = this.endx;
      this.moving = false;
    } else {
      this.y += this.ydir;
      this.total += this.dx;
      if (this.total > this.dy) {
        this.x += this.xdir;
        this.total -= this.dy;
      }
    }
  }

  /** Une image d'animation (`BobSlot::animOneStep`). */
  animOneStep(): void {
    const string = this.anim.string;
    if (string) {
      this.anim.speed--;
      if (this.anim.speed <= 0) {
        // Entrée suivante ; la fin de la chaîne revient au début.
        const next = string[this.anim.stringPos + 1];
        this.anim.stringPos = next && next.frame !== 0 ? this.anim.stringPos + 1 : 0;
        this.frameNum = string[this.anim.stringPos].frame;
        this.anim.speed = div(string[this.anim.stringPos].speed, 4);
      }
    } else {
      this.anim.speed--;
      if (this.anim.speed === 0) {
        this.anim.speed = this.anim.speedBak;
        const next = this.frameNum + this.frameDir;
        if (next > this.anim.normal.lastFrame || next < this.anim.normal.firstFrame) {
          if (this.anim.normal.rebound) this.frameDir *= -1;
          else this.frameNum = this.anim.normal.firstFrame - 1;
        }
        this.frameNum += this.frameDir;
      }
    }
  }

  /** Animation par chaîne (`BobSlot::animString`) ; une chaîne vide n'anime rien. */
  animString(frames: AnimFrame[]): void {
    this.active = true;
    this.animating = true;
    this.anim.string = frames;
    this.anim.stringPos = 0;
    this.frameNum = frames[0]?.frame ?? 0;
    this.anim.speed = div(frames[0]?.speed ?? 0, 4);
  }

  /** Animation en boucle (ou en aller-retour) de `firstFrame` à `lastFrame` (`BobSlot::animNormal`). */
  animNormal(firstFrame: number, lastFrame: number, spd: number, rebound: boolean, flip: boolean): void {
    this.active = true;
    this.animating = true;
    this.frameNum = firstFrame;
    this.anim.speed = spd;
    this.anim.speedBak = spd;
    this.anim.string = null;
    this.anim.normal = { rebound, firstFrame, lastFrame };
    this.frameDir = 1;
    this.xflip = flip;
  }

  /** Vitesse de marche selon l'échelle (`BobSlot::scaleWalkSpeed`) : moitié moins en y. */
  scaleWalkSpeed(ms: number): void {
    if (!this.xmajor) ms = div(ms, 2);
    this.speed = div(this.scale * ms, 100);
    if (this.speed === 0) this.speed = 1;
  }

  /** Remise à zéro complète (`BobSlot::clear()`, au démarrage). */
  reset(): void {
    this.active = false;
    this.x = this.y = 0;
    this.box = null;
    this.xflip = false;
    this.scale = 0;
    this.frameNum = 0;
    this.frameDir = 0;
    this.animating = false;
    this.anim = { speed: 0, speedBak: 0, string: null, stringPos: 0, normal: { rebound: false, firstFrame: 0, lastFrame: 0 } };
    this.moving = false;
    this.speed = 0;
    this.xmajor = false;
    this.xdir = this.ydir = 0;
    this.endx = this.endy = 0;
    this.dx = this.dy = 0;
    this.total = 0;
  }

  /** Éteint le bob (`BobSlot::clear(defaultBox)`) : ni actif, ni animé, ni en mouvement ; échelle 100. */
  clear(): void {
    this.active = false;
    this.xflip = false;
    this.animating = false;
    this.anim.string = null;
    this.moving = false;
    this.scale = 100;
    this.box = null;
  }
}

/**
 * Origine d'une image de la table : fichier de banque (`JOE_A.BBK`) et numéro d'image dedans (à partir de 1).
 *
 * `overs` : images copiées l'une après l'autre **par-dessus** le début des pixels de celle-ci (`BankManager::overpack`, torse et bouche d'un
 * personnage qui parle) ; le rendu fait les copies, octet après octet, comme ScummVM (la taille et le point d'ancrage restent ceux de
 * l'image de base). Une même image n'y figure qu'une fois (la dernière copie l'emporte : le résultat est le même).
 */
export interface FrameRef {
  bank: string;
  image: number;
  overs?: { bank: string; image: number }[];
}

/** Nombre d'emplacements de banques (`MAX_BANKS_NUMBER`). */
const MAX_BANKS = 18;

/**
 * Banques chargées et table d'images (`BankManager`). `unpack(source, destination, emplacement)` pose dans l'image `destination`
 * la référence de l'image `source` de la banque chargée à cet emplacement. L'image 0 d'une banque est la première (l'index 0 de
 * ScummVM vaut l'index 1).
 */
export class FrameTable {
  private readonly slots: (string | null)[] = new Array<string | null>(MAX_BANKS).fill(null);
  private readonly frames: (FrameRef | null)[] = new Array<FrameRef | null>(MAX_FRAMES).fill(null);

  /** Charge la banque `bank` à l'emplacement (rien si elle y est déjà : `BankManager::load`). */
  load(bank: string, slot: number): void {
    this.checkSlot(slot);
    this.slots[slot] = bank;
  }

  close(slot: number): void {
    this.checkSlot(slot);
    this.slots[slot] = null;
  }

  /** Banque chargée à l'emplacement, ou `null`. */
  bank(slot: number): string | null {
    this.checkSlot(slot);
    return this.slots[slot];
  }

  unpack(source: number, destination: number, slot: number): void {
    this.checkSlot(slot);
    const bank = this.slots[slot];
    if (bank === null) throw new Error(`aucune banque à l'emplacement ${slot}`);
    if (destination < 0 || destination >= MAX_FRAMES) throw new Error(`image ${destination} hors de la table`);
    this.frames[destination] = { bank, image: Math.max(1, source) };
  }

  /**
   * `BankManager::overpack` : l'image `source` de la banque de l'emplacement est copiée sur le début de l'image `destination` (sans
   * changer sa taille). Si la destination n'existe pas, c'est un `unpack` ; le rendu fait le même repli quand la source est plus
   * grande que la destination.
   */
  overpack(source: number, destination: number, slot: number): void {
    this.checkSlot(slot);
    const bank = this.slots[slot];
    if (bank === null) throw new Error(`aucune banque à l'emplacement ${slot}`);
    const base = this.frames[destination];
    if (!base) {
      this.unpack(source, destination, slot);
      return;
    }
    const image = Math.max(1, source);
    const overs = (base.overs ?? []).filter((over) => over.bank !== bank || over.image !== image);
    overs.push({ bank, image });
    this.frames[destination] = { bank: base.bank, image: base.image, overs };
  }

  /** Référence de l'image `n`, ou `undefined` si elle est vide (effacée ou jamais posée). */
  frame(n: number): FrameRef | undefined {
    return this.frames[n] ?? undefined;
  }

  erase(n: number): void {
    this.frames[n] = null;
  }

  /** Efface les images de la pièce (de `FRAMES_JOE` à la fin) ou toutes si `joe` (`BankManager::eraseFrames`). */
  eraseFrames(joe: boolean): void {
    for (let i = joe ? 0 : FRAMES_JOE; i < MAX_FRAMES; i++) this.frames[i] = null;
  }

  /** Plus grand numéro d'image posé (outils, tests). */
  get highestFrame(): number {
    for (let i = MAX_FRAMES - 1; i >= 0; i--) if (this.frames[i]) return i;
    return -1;
  }

  private checkSlot(slot: number): void {
    if (slot < 0 || slot >= MAX_BANKS) throw new Error(`emplacement de banque ${slot} hors limites`);
  }
}

/** Ordre de dessin (`compareBobDrawOrder`) : par ordonnée des pieds, puis par numéro d'emplacement. */
function drawOrder(a: { bob: BobSlot; index: number }, b: { bob: BobSlot; index: number }): number {
  return a.bob.y - b.bob.y || a.index - b.index;
}

/** Les bobs de la scène (`Graphics`, partie logique). */
export class Bobs {
  readonly slots: BobSlot[] = Array.from({ length: MAX_BOBS }, () => new BobSlot());
  readonly frames = new FrameTable();
  /** Chaînes d'animation en cours des objets et personnages, par numéro de bob (`_newAnim`, 17 emplacements). */
  readonly newAnim: AnimFrame[][] = Array.from({ length: 17 }, () => []);
  /** Bobs actifs dans l'ordre de dessin, recalculé à chaque image (`_sortedBobs`). */
  sorted: readonly BobSlot[] = [];
  /** Bob suivi par la caméra (`_cameraBob`) ; -1 : aucun. */
  cameraBob = 0;
  /** Compteurs de la pièce (`_numFurnitureStatic`, `_numFurnitureAnimated`, `_numFurnitureAnimatedLen`, `_numFrames`). */
  numFurnitureStatic = 0;
  numFurnitureAnimated = 0;
  numFurnitureAnimatedLen = 0;
  numFrames = 0;
  /** Appelée quand l'image d'un bob porte un effet sonore (`frameNum > 500`). */
  onSfx: (() => void) | null = null;

  constructor() {
    for (const bob of this.slots) bob.reset();
  }

  bob(index: number): BobSlot {
    const bob = this.slots[index];
    if (!bob) throw new Error(`bob ${index} hors limites`);
    return bob;
  }

  clearBob(index: number): void {
    this.bob(index).clear();
  }

  clearBobs(): void {
    for (const bob of this.slots) bob.clear();
  }

  stopBobs(): void {
    for (const bob of this.slots) bob.moving = false;
  }

  get numFurnitureFrames(): number {
    return this.numFurnitureStatic + this.numFurnitureAnimatedLen;
  }

  /**
   * `Graphics::setBobCutawayAnim` : animation par chaîne d'une cinématique sur le bob `bobNum` (0 à 20), retourné ou non. La chaîne
   * est propre à la cinématique : `newAnim` (celle des personnes de la pièce) n'est pas touchée.
   */
  setCutawayAnim(bobNum: number, xflip: boolean, frames: AnimFrame[]): void {
    if (bobNum < 0 || bobNum > 20) throw new Error(`animation de cinématique sur le bob ${bobNum}`);
    const bob = this.bob(bobNum);
    bob.xflip = xflip;
    bob.animString(frames);
  }

  /** Fait avancer les bobs actifs (animation, déplacement) puis les trie en profondeur (`Graphics::sortBobs`). */
  sortBobs(): void {
    const active: { bob: BobSlot; index: number }[] = [];
    this.slots.forEach((bob, index) => {
      if (!bob.active) return;
      active.push({ bob, index });
      if (bob.animating) {
        bob.animOneStep();
        if (bob.frameNum > SFX_FRAME) {
          this.onSfx?.();
          bob.frameNum -= SFX_FRAME;
        }
      }
      if (bob.moving) {
        for (let j = 0; bob.moving && j < bob.speed; j++) bob.moveOneStep();
      }
    });
    active.sort(drawOrder);
    this.sorted = active.map((entry) => entry.bob);
  }

  // --- Numéros de bob et d'image d'un objet (`Logic::findBob`, `Logic::findFrame`) ------------------------------------------

  /**
   * Numéro du bob de l'objet du jeu `obj` (0 : aucun). Les personnes ont les bobs 1 à 3 selon leur rang dans la pièce ; les bobs
   * animés suivent les meubles animés (à partir de 5), les fixes les meubles fixes (à partir de 20).
   */
  findBob(world: World, obj: number): number {
    const { objects } = world.state;
    const { graphics } = world.data.jas;
    const room = objects[obj].room;
    let img = objects[obj].image;
    if (img === 0) return 0;
    if (isPerson(img)) return personRank(world, obj, room);

    let animated = false;
    if (img <= -10) animated = graphics[-(img + 10)].lastFrame !== 0;
    else if (img === -2) animated = true;
    else if (img > 0) animated = graphics[img].lastFrame !== 0;

    let idxAnimated = 0;
    let idxStatic = 0;
    for (let i = world.data.jas.roomFirstObject[room] + 1; i <= obj; i++) {
      img = objects[i].image;
      if (img <= -10) {
        if (graphics[-(img + 10)].lastFrame !== 0) idxAnimated++;
        else idxStatic++;
      } else if (img > 0) {
        if (img > PASTE_DOWN) img -= PASTE_DOWN;
        if (graphics[img].lastFrame !== 0) idxAnimated++;
        else idxStatic++;
      } else if (img === -1) idxStatic++;
      else if (img === -2) idxAnimated++;
    }
    if (!animated) return idxStatic > 0 ? 19 + this.numFurnitureStatic + idxStatic : 0;
    return idxAnimated > 0 ? 4 + this.numFurnitureAnimated + idxAnimated : 0;
  }

  /**
   * Numéro de l'image de l'objet `obj` dans la table (0 : aucune) : les images des objets suivent celles de Joe et des meubles,
   * dans l'ordre des objets de la pièce ; une personne a l'image `31 + rang`.
   */
  findFrame(world: World, obj: number): number {
    const { objects } = world.state;
    const { graphics } = world.data.jas;
    const room = objects[obj].room;
    let img = objects[obj].image;
    if (isPerson(img)) {
      const rank = personRank(world, obj, room);
      return rank <= 3 ? 31 + rank : 0;
    }
    let idx = 0;
    for (let i = world.data.jas.roomFirstObject[room] + 1; i < obj; i++) {
      img = objects[i].image;
      if (img <= -10) {
        const graphic = graphics[-(img + 10)];
        // Animation : on saute toutes ses images ; bob fixe : une.
        idx += graphic.lastFrame !== 0 ? Math.abs(graphic.lastFrame) - graphic.firstFrame + 1 : 1;
      } else if (img === -1) {
        idx++;
      } else if (img > 0) {
        if (img > PASTE_DOWN) img -= PASTE_DOWN;
        const graphic = graphics[img];
        const last = Math.abs(graphic.lastFrame);
        if (graphic.firstFrame < 0) idx += last;
        else if (last !== 0) idx += last - graphic.firstFrame + 1;
        else idx++;
      }
    }
    img = objects[obj].image;
    if (img <= -10) {
      const graphic = graphics[-(img + 10)];
      idx += graphic.lastFrame !== 0 ? Math.abs(graphic.lastFrame) - graphic.firstFrame + 1 : 1;
    } else if (img === -1 || img > 0) {
      idx++;
    }
    return idx > 0 ? FRAMES_JOE + this.numFurnitureFrames + idx : 0;
  }
}

/** Rang (à partir de 1) de la personne `obj` parmi celles de la pièce `room` (`Logic::findPersonNumber`). */
export function personRank(world: World, obj: number, room: number): number {
  let n = 0;
  for (let i = world.data.jas.roomFirstObject[room] + 1; i <= obj; i++) if (isPerson(world.state.objects[i].image)) n++;
  return n;
}

/** Nom de la banque des objets d'une pièce (`<pièce>.BBK`, emplacement 15). */
export function roomBankFile(roomName: string): string {
  return `${roomName}.BBK`;
}
