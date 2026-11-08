/**
 * Marche de Joe et des personnages (`docs/fotaq/engine.md`, § 11). Réécriture de `Walk` (engines/queen/walk.cpp, walk.h, ScummVM) :
 * chemin entre les zones de marche de la pièce (parcours en profondeur du graphe des voisines, `mapNeighbors`), points de
 * passage d'une zone à l'autre, choix de l'animation selon la direction, marche à vitesse proportionnelle à l'échelle.
 *
 * Principe (lu en entier) :
 * - Joe et le point visé sont rangés dans une zone de marche (`findAreaForPos`) ; hors de toute zone, le point est ramené dans la
 *   zone la plus proche (`findAreaPosition`, avec la distance diagonale ajoutée par ScummVM) ;
 * - même zone : un seul segment droit ; sinon `calcPath` cherche le chemin de zones voisines et `calc` en fait des segments, dont le
 *   point de passage est le milieu du recouvrement des boîtes de deux zones voisines (`calcC`), ou la position courante si elle y est
 *   déjà ;
 * - un segment dans une zone éteinte (`mapNeighbors` < 0) arrête Joe et appelle `handleSpecialArea` (résultat -2) ; les zones éteintes
 *   restent traversables par `calcPath` (valeur absolue des voisines) ;
 * - chemin introuvable : Joe dit la réponse 4 (résultat -1).
 *
 * Écarts : pas de limite de 16 segments ni de 16 zones sur le chemin ; la marche est une séquence qui appelle `g.update(true)` à
 * chaque image (le joueur peut cliquer) ; `movePerson` d'une marche d'un point à lui-même (aucun segment) garde l'orientation
 * précédente au lieu de lire un segment vide ; une pièce sans zone de marche utilise une zone vide comme ScummVM (qui lit une zone
 * mise à zéro) : Joe y va en (0, 0).
 */

import type { Sequence } from "../../../engine/sequence";
import type { Box, JasArea } from "../data/jas";
import { type Person, movePersonData, type MovePersonData } from "./actors";
import type { Bobs } from "./bobs";
import { areaScale } from "./grid";
import type { Joe } from "./joe";
import type { FotaqEngine } from "./loop";
import { objectForPerson, PERSON_LEFT, PERSON_RIGHT } from "./room";
import { MoveResult } from "./services";
import { Direction, JoeWalk, toInt16 } from "./state";

/** Réponse de Joe quand le chemin est bloqué (« je ne peux pas aller là »). */
const BLOCKED_RESPONSE = 4;
/** Vitesse de marche de Joe (pas par image à l'échelle 100 en x). */
const JOE_MOVE_SPEED = 6;
/** Images de marche de Joe (`animateJoePrepare`) : profil, de face, de dos. */
const JOE_SIDE = [11, 18] as const;
const JOE_FRONT = [19, 24] as const;
const JOE_BACK = [25, 30] as const;

const NO_BOX: Box = { x1: 0, y1: 0, x2: 0, y2: 0 };
const NO_AREA: JasArea = { mapNeighbors: 0, box: NO_BOX, bottomScaleFactor: 0, topScaleFactor: 0, object: 0 };

/** Animation d'un segment de marche (`MovePersonAnim`) : images (négatif : à retourner) et orientation. */
interface WalkAnim {
  firstFrame: number;
  lastFrame: number;
  facing: Direction;
}

/** Un segment du chemin (`WalkData`) : déplacement, zone dans laquelle il se fait, animation. */
export interface WalkSegment {
  dx: number;
  dy: number;
  area: JasArea;
  areaNum: number;
  anim: WalkAnim;
}

const div = (a: number, b: number): number => Math.trunc(a / b);

/** Milieu du recouvrement de deux intervalles voisins, ou `lastc` s'il y est déjà (`Walk::calcC`). */
function calcC(c1: number, c2: number, c3: number, c4: number, lastc: number): number {
  const s1 = Math.max(c1, c3);
  const s2 = Math.min(c2, c4);
  if ((lastc >= s1 && lastc <= s2) || (lastc >= s2 && lastc <= s1)) return lastc;
  return div(s1 + s2, 2);
}

/** Écart de l'échelle entre le haut et le bas d'une zone (`Area::scaleDiff`). */
const scaleDiff = (area: JasArea): number => toInt16(area.topScaleFactor - area.bottomScaleFactor);

/**
 * Choix de l'image de marche selon la direction : l'animation est de face ou de dos quand le déplacement est plus vertical
 * qu'horizontal, compte tenu de l'échelle (plus le haut de la zone est petit, moins un pas en y est long). Rend `true` si le
 * segment est « vertical ».
 */
function isVertical(segment: WalkSegment): boolean {
  let k = Math.abs(segment.dy);
  const ds = scaleDiff(segment.area);
  const height = segment.area.box.y2 - segment.area.box.y1;
  if (ds > 0 && height !== 0) k *= div(div(k * ds, height), 2);
  return Math.abs(segment.dx) < k;
}

export class Walk {
  /** Segments du chemin calculé par `calc`. */
  walkData: WalkSegment[] = [];
  /** Zones de la pièce, numérotées à partir de 1 (`_roomArea`). */
  private roomArea: JasArea[] = [];
  private roomAreaCount = 0;
  private areaStrike: number[] = [];
  private areaList: number[] = [];
  /** `stopJoe` a été appelé pendant la marche. */
  private joeInterrupted = false;
  /** `handleSpecialArea` a été appelée : la marche s'est arrêtée sur une zone éteinte. */
  private joeMoveBlock = false;

  constructor(
    private readonly bobs: Bobs,
    private readonly joe: Joe,
  ) {}

  // --- Joe --------------------------------------------------------------------------------------------------------------

  /**
   * Joe marche jusqu'à (`endx`, `endy`) puis se tourne vers `direction` (> 0) (`Walk::moveJoe`). Rend 0 (arrivé), -1 (interrompu
   * par une nouvelle commande ou chemin bloqué) ou -2 (arrêté par une zone éteinte).
   */
  *moveJoe(g: FotaqEngine, direction: Direction, endx: number, endy: number, inCutaway: boolean): Sequence<number> {
    this.joeInterrupted = false;
    this.joeMoveBlock = false;
    let can: number = MoveResult.Arrived;
    this.initWalkData(g);

    const bob = this.bobs.bob(0);
    const oldx = bob.x;
    const oldy = bob.y;
    g.setJoeWalk(JoeWalk.Move);

    const oldPos = g.grid.findAreaForPos(oldx, oldy);
    const newPos = g.grid.findAreaForPos(endx, endy);

    if (newPos === 0 && inCutaway) {
      // Dans une cinématique, Joe peut aller partout : le segment est noté, la cinématique déplace Joe elle-même.
      this.incWalkData(oldx, oldy, endx, endy, oldPos);
    } else if (this.calc(oldPos, newPos, oldx, oldy, endx, endy)) {
      if (this.walkData.length > 0) {
        this.animateJoePrepare();
        yield* this.animateJoe(g);
        if (this.joeInterrupted) can = MoveResult.Interrupted;
      }
    } else {
      // Chemin bloqué : Joe le dit.
      yield* g.makeJoeSpeak(BLOCKED_RESPONSE);
      can = MoveResult.Interrupted;
    }

    bob.animating = false;
    const joe = g.state.joe;
    if (this.joeMoveBlock) {
      can = MoveResult.SpecialArea;
      this.joeMoveBlock = false;
    } else if (direction > 0) {
      joe.facing = direction;
    }
    joe.prevFacing = joe.facing;
    yield* this.joe.face(g);
    return can;
  }

  stopJoe(): void {
    this.bobs.bob(0).moving = false;
    this.joeInterrupted = true;
  }

  /** Images de marche de chaque segment (`Walk::animateJoePrepare`). */
  private animateJoePrepare(): void {
    for (const segment of this.walkData) {
      const side = JOE_SIDE;
      segment.anim = { firstFrame: side[0], lastFrame: side[1], facing: segment.dx < 0 ? Direction.Left : Direction.Right };
      if (isVertical(segment)) {
        // Vers le haut de l'écran (dy < 0) : de face si l'échelle diminue vers le haut (ds < 0), sinon de dos ; l'inverse vers le bas.
        const towardsFront = segment.dy < 0 === scaleDiff(segment.area) < 0;
        const frames = towardsFront ? JOE_FRONT : JOE_BACK;
        segment.anim = { firstFrame: frames[0], lastFrame: frames[1], facing: towardsFront ? Direction.Front : Direction.Back };
      }
    }
  }

  /** Fait marcher Joe sur les segments (`Walk::animateJoe`), une image à la fois. */
  private *animateJoe(g: FotaqEngine): Sequence {
    const bob = this.bobs.bob(0);
    const joe = g.state.joe;
    let lastDirection = 0;
    joe.facing = this.walkData[0].anim.facing;
    joe.scale = areaScale(this.walkData[0].area, bob.y);
    yield* this.joe.face(g);
    for (let i = 0; i < this.walkData.length && !this.joeInterrupted; i++) {
      const segment = this.walkData[i];
      // Zone éteinte : Joe s'arrête, la pièce réagit (cinématique, réplique).
      if (segment.area.mapNeighbors < 0) {
        yield* g.handleSpecialArea(segment.anim.facing, segment.areaNum, i + 1);
        this.joeMoveBlock = true;
        return;
      }
      if (lastDirection !== segment.anim.facing) bob.animNormal(segment.anim.firstFrame, segment.anim.lastFrame, 1, false, false);

      const moveSpeed = div(g.grid.findScale(bob.x, bob.y) * JOE_MOVE_SPEED, 100);
      bob.move(bob.x + segment.dx, bob.y + segment.dy, moveSpeed);
      bob.xflip = bob.xdir < 0;
      while (bob.moving) {
        // La vitesse de Joe suit son échelle.
        bob.scale = areaScale(segment.area, bob.y);
        joe.scale = bob.scale;
        bob.scaleWalkSpeed(JOE_MOVE_SPEED);
        yield* g.update(true);
        if (g.input.cutawayQuit || g.joeWalk === JoeWalk.Execute || g.ended) {
          this.stopJoe();
          break;
        }
      }
      lastDirection = segment.anim.facing;
    }
    joe.facing = lastDirection;
  }

  // --- Personnages -----------------------------------------------------------------------------------------------------

  /**
   * Un personnage marche jusqu'à (`endx`, `endy`) (`Walk::movePerson`) : images numérotées à partir de `curImage` dans la table.
   * `direction` : image de l'objet de la personne (-3 : tournée à gauche, -4 : à droite). Rend 0, ou -1 si le chemin est bloqué.
   */
  *movePerson(g: FotaqEngine, person: Person, endx: number, endy: number, curImage: number, direction: number): Sequence<number> {
    if (endx === 0 && endy === 0) return 0;
    let can = 0;
    this.initWalkData(g);
    const { bobNumber: bobNum, bank: bankNum } = person.actor;
    const bob = this.bobs.bob(bobNum);
    const oldPos = g.grid.findAreaForPos(bob.x, bob.y);
    const newPos = g.grid.findAreaForPos(endx, endy);
    const data = movePersonData(person.name);

    if (this.calc(oldPos, newPos, bob.x, bob.y, endx, endy)) {
      if (this.walkData.length > 0) {
        this.animatePersonPrepare(data, direction);
        yield* this.animatePerson(g, data, curImage, bobNum, bankNum, direction);
      }
    } else {
      can = MoveResult.Interrupted;
    }

    // La personne s'arrête face à la caméra ou de dos, tournée du côté où elle allait.
    const standingFrame = 31 + bobNum;
    const last = this.walkData[this.walkData.length - 1];
    bob.endx = endx;
    bob.endy = endy;
    bob.animating = false;
    bob.scale = last ? areaScale(last.area, endy) : g.grid.findScale(endx, endy);
    const facingBack = last?.anim.facing === Direction.Back;
    this.bobs.frames.unpack(facingBack ? data.backStandingFrame : data.frontStandingFrame, standingFrame, bankNum);
    const object = objectForPerson(g, bobNum);
    const left = (last?.dx ?? 0) < 0;
    if (object > 0) g.state.objects[object].image = left ? PERSON_LEFT : PERSON_RIGHT;
    bob.xflip = left;
    bob.frameNum = standingFrame;
    return can;
  }

  stopPerson(bobNum: number): void {
    const bob = this.bobs.bob(bobNum);
    bob.x = bob.endx;
    bob.y = bob.endy;
    bob.moving = false;
  }

  /** Images de marche de chaque segment d'un personnage (`Walk::animatePersonPrepare`). */
  private animatePersonPrepare(data: MovePersonData, direction: number): void {
    const sameFrames = Math.abs(data.walkLeft1) === Math.abs(data.walkRight1);
    const left = (facing: Direction): WalkAnim => ({ firstFrame: data.walkLeft1, lastFrame: data.walkLeft2, facing });
    const right = (facing: Direction): WalkAnim => ({ firstFrame: data.walkRight1, lastFrame: data.walkRight2, facing });
    for (const segment of this.walkData) {
      if (segment.dx < 0) segment.anim = left(Direction.Left);
      else if (segment.dx > 0) segment.anim = right(Direction.Right);
      else if (sameFrames) segment.anim = right(Direction.Right);
      // Marches propres à gauche et à droite : on garde le côté vers lequel regardait le personnage (image -3 de son objet).
      else segment.anim = direction === PERSON_LEFT ? left(Direction.Left) : right(Direction.Right);

      if (!isVertical(segment)) continue;
      if (segment.dy < 0) {
        if (data.walkBack1 > 0) segment.anim = { firstFrame: data.walkBack1, lastFrame: data.walkBack2, facing: Direction.Back };
        else segment.anim = segment.dx < 0 ? left(Direction.Back) : right(Direction.Back);
      } else if (segment.dy > 0) {
        if (data.walkFront1 > 0) segment.anim = { firstFrame: data.walkFront1, lastFrame: data.walkFront2, facing: Direction.Front };
        else if (sameFrames) segment.anim = segment.dx < 0 ? left(Direction.Front) : right(Direction.Front);
        else segment.anim = direction === PERSON_LEFT ? left(Direction.Front) : right(Direction.Front);
      }
    }
  }

  /** Fait marcher le personnage sur les segments (`Walk::animatePerson`). */
  private *animatePerson(
    g: FotaqEngine,
    data: MovePersonData,
    image: number,
    bobNum: number,
    bankNum: number,
    direction: number,
  ): Sequence {
    const bob = this.bobs.bob(bobNum);
    const sameFrames = Math.abs(data.walkLeft1) === Math.abs(data.walkRight1);
    // Une seule série d'images pour les deux côtés : on la retourne selon le sens.
    bob.xflip = data.walkLeft1 === data.walkRight1 ? direction === PERSON_LEFT : false;
    for (const segment of this.walkData) {
      let dstFrame = image;
      for (let src = Math.abs(segment.anim.firstFrame); src <= Math.abs(segment.anim.lastFrame); src++) {
        this.bobs.frames.unpack(src, dstFrame, bankNum);
        dstFrame++;
      }
      bob.animNormal(image, dstFrame - 1, data.animSpeed, false, sameFrames ? bob.xflip : false);

      bob.move(bob.x + segment.dx, bob.y + segment.dy, div(g.grid.findScale(bob.x, bob.y) * data.moveSpeed, 100));
      if (data.walkLeft1 < 0 || sameFrames) bob.xflip = segment.dx < 0;

      while (bob.moving) {
        yield* g.update();
        bob.scale = areaScale(segment.area, bob.y);
        bob.scaleWalkSpeed(data.moveSpeed);
        if (g.input.cutawayQuit || g.ended) {
          this.stopPerson(bobNum);
          break;
        }
      }
    }
  }

  // --- Chemin -----------------------------------------------------------------------------------------------------------

  private initWalkData(g: FotaqEngine): void {
    const room = g.state.room;
    this.roomArea = g.state.areas[room] ?? [NO_AREA];
    this.roomAreaCount = g.grid.areaMax(room);
    this.walkData = [];
    this.areaStrike = [];
    this.areaList = [];
  }

  /** Zone `n` de la pièce (une zone vide si la pièce n'en a pas, comme la zone mise à zéro de ScummVM). */
  private area(n: number): JasArea {
    return this.roomArea[n] ?? NO_AREA;
  }

  private incWalkData(px: number, py: number, x: number, y: number, areaNum: number): void {
    if (px === x && py === y) return;
    this.walkData.push({
      dx: x - px,
      dy: y - py,
      area: this.area(areaNum),
      areaNum,
      anim: { firstFrame: 0, lastFrame: 0, facing: Direction.None },
    });
  }

  /**
   * Chemin de la position (`oldx`, `oldy`) dans la zone `oldPos` au point (`x`, `y`) dans la zone `newPos` (`Walk::calc`) : rempli dans
   * `walkData` ; rend faux si les zones ne communiquent pas.
   */
  calc(oldPos: number, newPos: number, oldx: number, oldy: number, x: number, y: number): boolean {
    // Point visé hors des zones : on le ramène dans la zone la plus proche.
    if (newPos === 0) {
      const found = this.findAreaPosition(x, y, true);
      newPos = found.pos;
      x = found.x;
      y = found.y;
    }
    // Idem pour Joe, s'il est sur le bord d'une zone sans y être enregistré.
    if (oldPos === 0) oldPos = this.findAreaPosition(oldx, oldy, false).pos;

    if (oldPos === newPos) {
      this.incWalkData(oldx, oldy, x, y, newPos);
      return true;
    }
    if (!this.calcPath(oldPos, newPos)) return false;
    let px = oldx;
    let py = oldy;
    for (let i = 2; i < this.areaList.length; i++) {
      const a1 = this.areaList[i - 1];
      const a2 = this.areaList[i];
      const b1 = this.area(a1).box;
      const b2 = this.area(a2).box;
      const x1 = calcC(b1.x1, b1.x2, b2.x1, b2.x2, px);
      const y1 = calcC(b1.y1, b1.y2, b2.y1, b2.y2, py);
      this.incWalkData(px, py, x1, y1, a1);
      px = x1;
      py = y1;
    }
    this.incWalkData(px, py, x, y, newPos);
    return true;
  }

  /**
   * Zone la plus proche du point (`Walk::findAreaPosition`) : distance en x seule, en y seule, ou diagonale (ajoutée par ScummVM)
   * selon que le point est dans la bande de la zone ; `recalibrate` ramène le point dans la zone.
   */
  private findAreaPosition(x: number, y: number, recalibrate: boolean): { pos: number; x: number; y: number } {
    let pos = 1;
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= this.roomAreaCount; i++) {
      const b = this.area(i).box;
      const csx = Math.min(Math.abs(b.x1 - x), Math.abs(b.x2 - x));
      const csy = Math.min(Math.abs(b.y1 - y), Math.abs(b.y2 - y));
      const inX = x >= b.x1 && x <= b.x2;
      const inY = y >= b.y1 && y <= b.y2;
      let dist = minDist;
      if (!inX && !inY) dist = csx * csx + csy * csy;
      else if (inX) dist = csy * csy;
      else if (inY) dist = csx * csx;
      if (dist < minDist) {
        minDist = dist;
        pos = i;
      }
    }
    if (recalibrate) {
      const b = this.area(pos).box;
      if (x < b.x1) x = b.x1;
      if (x > b.x2) x = b.x2;
      if (y < b.y1) y = b.y1;
      if (y > b.y2) y = b.y2;
    }
    return { pos, x, y };
  }

  /** Première zone voisine de `area` qui n'est pas déjà barrée (`Walk::findFreeArea`) ; 0 s'il n'y en a pas. */
  private findFreeArea(area: number): number {
    const map = Math.abs(this.area(area).mapNeighbors);
    for (let test = 1; test <= this.roomAreaCount; test++) {
      const bit = this.roomAreaCount - test;
      if ((map & (1 << bit)) !== 0 && !this.areaStrike.includes(test)) return test;
    }
    return 0;
  }

  /**
   * Chemin de zones de `oldArea` à `newArea` (`Walk::calcPath`) : parcours en profondeur dans l'ordre des voisines, en revenant en
   * arrière dans les impasses. Rempli dans `areaList` (à partir de l'indice 1).
   */
  private calcPath(oldArea: number, newArea: number): boolean {
    this.areaList = [0, oldArea];
    this.areaStrike = [oldArea];
    let area = oldArea;
    while (this.areaList.length > 1 && area !== newArea) {
      area = this.findFreeArea(area);
      if (area === 0) {
        // Impasse : retour à la zone précédente.
        this.areaList.pop();
        area = this.areaList[this.areaList.length - 1];
      } else {
        this.areaList.push(area);
        if (!this.areaStrike.includes(area)) this.areaStrike.push(area);
      }
    }
    return this.areaList.length > 1;
  }
}
