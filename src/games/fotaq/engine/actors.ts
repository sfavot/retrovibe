/**
 * Personnages de la pièce (`docs/fotaq/engine.md`, § 11) : les acteurs de `QUEEN.JAS` (`ActorData`), leur bob, leur animation et
 * la table des pas de marche. Réécriture de `Logic::findActor`, `initPerson`, de `Graphics::setupPerson`, `allocPerson`,
 * `setupPersonAnim`, `resetPersonAnim`, `erasePersonAnim`, `eraseAllAnims` (engines/queen/logic.cpp, graphics.cpp) et de la table
 * `Walk::_moveData` (walk.cpp, ScummVM).
 *
 * Un acteur est valide dans une pièce quand son état du jeu (`stateSlot`) vaut `stateValue` ; il est lié à la personne de la pièce
 * dont le rang est son numéro de bob (1 à 3), ou trouvé par son nom (cinématiques). Les images d'un acteur sont rangées après
 * celles des objets de la pièce (`personFrames` : première image libre de chaque personne).
 */

import type { JasActor } from "../data/jas";
import { type AnimFrame, type Bobs, countAnimFrames, parseAnimString, personRank, SFX_FRAME } from "./bobs";
import { areaScale } from "./grid";
import type { FotaqEngine } from "./loop";
import { isPerson, PERSON_LEFT } from "./room";
import { toInt16 } from "./state";

/** Une personne de la pièce courante avec les données de son acteur (`Person`). */
export interface Person {
  actor: JasActor;
  name: string;
  /** Chaîne d'animation de l'acteur (`QUEEN2.JAS`), `null` s'il n'en a pas. */
  anim: string | null;
  /** Image où ranger l'image debout (`31 + bob`). */
  bobFrame: number;
}

/** Pas de marche d'un personnage (`MovePersonData`) : images des marches (négatif : à retourner), image debout, vitesses. */
export interface MovePersonData {
  name: string;
  walkLeft1: number;
  walkLeft2: number;
  walkRight1: number;
  walkRight2: number;
  walkBack1: number;
  walkBack2: number;
  walkFront1: number;
  walkFront2: number;
  frontStandingFrame: number;
  backStandingFrame: number;
  animSpeed: number;
  moveSpeed: number;
}

const move = (
  name: string,
  walkLeft1: number, walkLeft2: number, walkRight1: number, walkRight2: number,
  walkBack1: number, walkBack2: number, walkFront1: number, walkFront2: number,
  frontStandingFrame: number, backStandingFrame: number, animSpeed: number, moveSpeed: number,
): MovePersonData => ({
  name, walkLeft1, walkLeft2, walkRight1, walkRight2, walkBack1, walkBack2, walkFront1, walkFront2,
  frontStandingFrame, backStandingFrame, animSpeed, moveSpeed,
});

/** Table de `walk.cpp` (même ordre) ; un nom absent de la table n'a aucun pas (`*` : tout à zéro). */
export const MOVE_DATA: readonly MovePersonData[] = [
  move("COMPY", -1, -6, 1, 6, 0, 0, 0, 0, 12, 12, 1, 14),
  move("DEINO", -1, -8, 1, 8, 0, 0, 0, 0, 11, 11, 1, 10),
  move("FAYE", -1, -6, 1, 6, 13, 18, 7, 12, 19, 22, 2, 5),
  move("GUARDS", -1, -6, 1, 6, 0, 0, 0, 0, 7, 7, 2, 5),
  move("PRINCESS1", -1, -6, 1, 6, 13, 18, 7, 12, 19, 21, 2, 5),
  move("PRINCESS2", -1, -6, 1, 6, 13, 18, 7, 12, 19, 21, 2, 5),
  move("AMGUARD", -1, -6, 1, 6, 13, 18, 7, 12, 19, 21, 2, 5),
  move("SPARKY", -1, -6, 1, 6, 13, 18, 7, 12, 21, 20, 2, 5),
  move("LOLA_SHOWER", -1, -6, 55, 60, 0, 0, 0, 0, 7, 7, 2, 5),
  move("LOLA", -24, -29, 24, 29, 0, 0, 0, 0, 30, 30, 2, 5),
  move("BOB", -15, -20, 15, 20, 21, 26, 0, 0, 27, 29, 2, 5),
  move("CHEF", -1, -4, 1, 4, 0, 0, 0, 0, 1, 5, 2, 4),
  move("HENRY", -1, -6, 1, 6, 0, 0, 0, 0, 7, 7, 2, 6),
  move("ANDERSON", -1, -6, 1, 6, 0, 0, 0, 0, 7, 7, 2, 5),
  move("JASPAR", -4, -9, 4, 9, 16, 21, 10, 15, 1, 3, 1, 10),
  move("PYGMY", -7, -12, 7, 12, 0, 0, 0, 0, 27, 27, 2, 5),
  move("FRANK", 7, 12, 1, 6, 0, 0, 0, 0, 13, 13, 2, 4),
  move("WEDGEWOOD", -20, -25, 20, 25, 0, 0, 0, 0, 1, 1, 1, 5),
  move("TMPD", -1, -6, 1, 6, 13, 18, 7, 12, 19, 21, 2, 5),
  move("IAN", -1, -6, 1, 6, 0, 0, 0, 0, 7, 7, 2, 6),
];

/** Pas de marche de `name` (insensible à la casse) ; tout à zéro s'il n'est pas dans la table (entrée `*`). */
export function movePersonData(name: string): MovePersonData {
  const upper = name.toUpperCase();
  return MOVE_DATA.find((data) => data.name === upper) ?? move("*", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

/**
 * Acteur de la personne `noun` (numéro dans la pièce) de la pièce courante (`Logic::findActor`) : valide dans la pièce et lié à
 * la personne par son numéro de bob, ou, si `name` est donné, par son nom.
 */
export function findActor(g: FotaqEngine, noun: number, name: string | null): JasActor | null {
  const { state, data } = g;
  const object = g.currentRoomData + noun;
  if (!isPerson(state.objects[object].image)) return null;
  const bobNum = personRank(g, object, state.room);
  if (bobNum <= 0) return null;
  const { actors } = data.jas;
  for (let i = 1; i < actors.length; i++) {
    const actor = actors[i];
    if (actor.room !== state.room || g.gameState(actor.stateSlot) !== toInt16(actor.stateValue)) continue;
    if (bobNum === actor.bobNumber || (name !== null && data.texts.actorNames[actor.name] === name)) return actor;
  }
  return null;
}

export class Actors {
  /** Première image libre de chaque personne (1 à 3), 0 : pas encore posée (`_personFrames`). */
  readonly personFrames: number[] = [0, 0, 0, 0];

  constructor(private readonly bobs: Bobs) {}

  /**
   * Personne `noun` de la pièce avec les données de son acteur (`Logic::initPerson`) ; `loadBank` charge la banque de l'acteur
   * (`<fichier>.ACT`) dans son emplacement (sans fichier, les images sont déjà dans une banque chargée).
   */
  initPerson(g: FotaqEngine, noun: number, name: string | null, loadBank: boolean): Person | null {
    const actor = findActor(g, noun, name);
    if (!actor) return null;
    const { texts } = g.data;
    if (loadBank && actor.file !== 0) this.bobs.frames.load(texts.actorFiles[actor.file], actor.bank);
    return {
      actor,
      name: texts.actorNames[actor.name],
      anim: actor.animation !== 0 ? texts.actorAnimations[actor.animation] : null,
      bobFrame: 31 + actor.bobNumber,
    };
  }

  clearPersonFrames(): void {
    this.personFrames.fill(0);
  }

  /**
   * Pose la personne `noun` (`Graphics::setupPerson`) : son bob à sa position, à l'échelle de sa zone de marche, tourné comme son
   * objet, avec son animation s'il en a une. Rend la dernière image utilisée.
   */
  setupPerson(g: FotaqEngine, noun: number, curImage: number): number {
    if (noun === 0) return curImage;
    const person = this.initPerson(g, noun, "", true);
    if (!person) return curImage;
    const actor = person.actor;
    const x = toInt16(actor.x);
    const y = toInt16(actor.y);
    let scale = 100;
    const area = g.grid.findAreaForPos(x, y);
    // Personne hors des zones de marche : échelle 100 ; dans une zone, celle de la zone.
    if (area !== 0) scale = areaScale(g.grid.area(g.state.room, area), y);

    this.bobs.frames.unpack(actor.standingFrame, person.bobFrame, actor.bank);
    const bob = this.bobs.bob(actor.bobNumber);
    bob.curPos(x, y);
    bob.scale = scale;
    bob.frameNum = person.bobFrame;
    bob.xflip = g.state.objects[g.currentRoomData + noun].image === PERSON_LEFT;
    if (person.anim !== null) return this.setupPersonAnim(actor, person.anim, curImage);
    this.erasePersonAnim(actor.bobNumber);
    return curImage;
  }

  /** Réserve les images d'une personne éteinte, pour que les suivantes gardent leur place (`Graphics::allocPerson`). */
  allocPerson(g: FotaqEngine, noun: number, curImage: number): number {
    const person = this.initPerson(g, noun, "", false);
    if (person?.anim) {
      curImage += countAnimFrames(parseAnimString(person.anim));
      this.personFrames[person.actor.bobNumber] = curImage + 1;
    }
    return curImage;
  }

  /**
   * Animation d'une personne (`Graphics::setupPersonAnim`) : les images de la chaîne sont renumérotées à la suite de `curImage`
   * (dans l'ordre des numéros de la banque de l'acteur), copiées dans la table, et l'animation démarre.
   */
  private setupPersonAnim(actor: JasActor, anim: string, curImage: number): number {
    this.personFrames[actor.bobNumber] = curImage + 1;
    const frames = parseAnimString(anim);
    // Rang (à partir de 1) de chaque image distincte, par ordre croissant de numéro de banque.
    const used = [...new Set(frames.map((f) => (f.frame > SFX_FRAME ? f.frame - SFX_FRAME : f.frame)))].sort((a, b) => a - b);
    const rank = new Map(used.map((image, i) => [image, i + 1]));
    const renumbered: AnimFrame[] = frames.map((f) =>
      f.frame > SFX_FRAME
        ? { frame: curImage + (rank.get(f.frame - SFX_FRAME) as number) + SFX_FRAME, speed: f.speed }
        : { frame: curImage + (rank.get(f.frame) as number), speed: f.speed },
    );
    this.bobs.newAnim[actor.bobNumber] = renumbered;
    for (const image of used) {
      curImage++;
      this.bobs.frames.unpack(image, curImage, actor.bank);
    }
    this.bobs.bob(actor.bobNumber).animString(renumbered);
    return curImage;
  }

  /** Relance l'animation de la personne `bobNum` si elle en a une (`Graphics::resetPersonAnim`). */
  resetPersonAnim(bobNum: number): void {
    const anim = this.bobs.newAnim[bobNum];
    if (anim.length > 0) this.bobs.bob(bobNum).animString(anim);
  }

  erasePersonAnim(bobNum: number): void {
    this.bobs.newAnim[bobNum] = [];
    const bob = this.bobs.bob(bobNum);
    bob.animating = false;
    bob.anim.string = null;
  }

  /** Efface les chaînes des bobs 1 à 16 (`Graphics::eraseAllAnims`). */
  eraseAllAnims(): void {
    for (let i = 1; i <= 16; i++) this.bobs.newAnim[i] = [];
  }
}
