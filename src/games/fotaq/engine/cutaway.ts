/**
 * Cinématiques scriptées, « cutaways » (`*.CUT`, `docs/fotaq/cutaway.md`, vague C) : l'interpréteur de leurs enregistrements (objets
 * qui changent de pièce, animent leurs images, marchent, parlent, affichent un texte), les états finaux (« extra » quand le joueur
 * saute la cinématique), les états du jeu mis à jour, le dialogue de fin et le retour à la pièce de départ. Réécriture de
 * `Cutaway::run`, `load`, `loadStrings`, `changeRooms`, `getObjectType`, `getCutawayAnim`, `handleAnimation`, `handlePersonRecord`,
 * `handleText`, `makeComplexAnimation`, `stop`, `updateGameState`, `talk`, `countSpaces` et `scale` (engines/queen/cutaway.cpp,
 * cutaway.h, ScummVM, GPL v3 ou ultérieure), lus en entier, et de `Logic::sceneStart`, `sceneStop`, `playCutaway`.
 *
 * La lecture du fichier est dans `data/cut.ts` (enregistrements, états, section « extra », phrases, noms de banques). Ce qui bloquait
 * dans ScummVM (`_vm->update()` en boucle) est une séquence ; les demandes de passage (`cutawayQuit`) sont testées aux mêmes endroits
 * que ScummVM, à la main, sans les parties `skippable` de `src/engine/sequence.ts` (le saut n'abandonne pas la séquence : la
 * cinématique finit son travail, états et retour à la pièce compris, comme `Cutaway::run`).
 *
 * Écarts :
 * - la nature de chaque enregistrement (`getObjectType`) est déterminée à la lecture du fichier d'après l'état des objets au début de
 *   la cinématique (ScummVM la calcule à l'arrivée à l'enregistrement) ; les copies d'objets (`fromObject`) sont faites à l'arrivée ;
 * - l'état final « extra » d'une image 1000 (l'objet finit sur l'image 0) éteint le bob : ScummVM compare le numéro d'image de la
 *   table à 1000 (jamais vrai) et chercherait l'image 1000 de la banque ;
 * - le générique (`#credit1.crd`) est le `CreditsRunner` du moteur ; les mouvements spéciaux sont ceux de `GameScript` (vague L) ;
 * - les cinématiques de la version démo, de l'Amiga et de l'interview ne sont pas portées ;
 * - une animation de personne (`_cutAnim`) est une chaîne propre à la cinématique (`Bobs.setCutawayAnim`) ;
 * - la voix est celle de l'hôte (`playSpeech`) : sans voix, un texte dit dure `countSpaces` tours d'une image (voir `talk.ts`).
 */

import type { Sequence } from "../../../engine/sequence";
import { cutawayVoicePrefix } from "../data/files";
import { type CutAnimation, type CutObject, type Cutaway, parseCutaway } from "../data/cut";
import { DEFAULT_TALK_SPEED } from "./cadence";
import { areaScale } from "./grid";
import type { FotaqEngine } from "./loop";
import { isPerson, objectCopy, PERSON_LEFT, PERSON_RIGHT } from "./room";
import type { Cutaways } from "./services";
import { type GameStage, requireGameStage } from "./stage";
import { Direction, Room, RoomDisplay, Verb, toInt16 } from "./state";
import { personSpeaker } from "./talk";

/** Emplacement de la banque propre à la cinématique (`CUTAWAY_BANK`) et ceux de Joe (7) et des objets de la pièce (15). */
const CUTAWAY_BANK = 8;
const JOE_BANK = 7;
const ROOM_BANK = 15;
/** Numéro de banque d'une animation pour la banque de Joe (13 dans le fichier). */
const FILE_JOE_BANK = 13;
/** Joe parmi les personnes à allumer (`PERSON_JOE`). */
const PERSON_JOE = -1;
/** Image finale 1000 de la section « extra » : l'objet finit sur l'image 0. */
const NO_FRAME = 1000;
/** Pas de marche d'un bob de cinématique quand le fichier n'en donne pas (`bob->move(..., 4)`). */
const DEFAULT_MOVE_SPEED = 4;
/** Le bateau du temple (pièce 43) emporte Joe de 346 pixels (`handleAnimation`). */
const BOAT_SHIFT = 346;
/** Cinématiques dont la pièce est montrée avec le panneau (contournement de ScummVM : leurs personnes sont sous la ligne 150). */
const PANEL_FIXES = [
  { name: "c41f", from: 106, to: 41 },
  { name: "c62c", from: 105, to: 41 },
];

/** Une animation d'un enregistrement, prête à jouer (`CutawayAnim`). */
interface Anim {
  /** Numéro de bob. */
  object: number;
  unpackFrame: number;
  flip: boolean;
  /** Images de jeu par étape (`speed / 3 + 1`). */
  speed: number;
  /** Emplacement de banque : 7 Joe, 8 la banque de la cinématique, 15 les objets de la pièce. */
  bank: number;
  mx: number;
  my: number;
  cx: number;
  cy: number;
  song: number;
  /** Image de la table qui porte l'animation. */
  originalFrame: number;
}

/** Personne dont le nom et l'image sont rétablis en changeant de pièce (`_personData`). */
interface PersonData {
  index: number;
  name: number;
  image: number;
}

/** Personne vue dans la cinématique, dont l'image est rétablie si on la saute (`_personFace`). */
interface PersonFace {
  index: number;
  image: number;
}

/** `Logic::sceneStart` : le curseur disparaît, le panneau devient gris à la première scène. */
function* sceneStart(g: FotaqEngine, stage: GameStage): Sequence {
  g.scene++;
  stage.display.cursorVisible = false;
  if (g.scene === 1) stage.display.palette.greyPanel();
  yield* g.update();
}

/** `Logic::sceneStop` : à la dernière scène, le curseur et le panneau reviennent. */
function sceneStop(g: FotaqEngine, stage: GameStage): void {
  g.scene--;
  if (g.scene > 0) return;
  stage.display.cursorVisible = true;
  stage.display.palette.clearGrey();
  g.grid.setupPanel();
}

/** Une cinématique qui joue (`Cutaway`). */
class CutawayRun {
  private readonly stage: GameStage;
  private readonly cut: Cutaway;
  private readonly basename: string;
  private comPanel: number;
  private finalRoom: number;
  private currentImage = 0;
  private initialRoom = 0;
  private temporaryRoom = 0;
  private roomFade = false;
  private lastSong = 0;
  private songBeforeComic = 0;
  private readonly personData: PersonData[] = [];
  private readonly personFaces: PersonFace[] = [];

  constructor(
    private readonly g: FotaqEngine,
    private readonly file: string,
  ) {
    this.stage = requireGameStage(g);
    this.cut = parseCutaway(g.host.readFile(file), (n) => isPerson(g.state.objects[n]?.image ?? 0));
    this.basename = file.replace(/\.[^.]*$/, "");
    this.comPanel = this.cut.panel;
    this.finalRoom = this.cut.finalRoom;
  }

  private get bobs() {
    return this.stage.bobs;
  }

  private get display() {
    return this.stage.display;
  }

  private get state() {
    return this.g.state;
  }

  /** `Cutaway::load` : drapeaux, banque de la cinématique, Joe se tourne comme la cinématique le demande. */
  private *load(): Sequence {
    const { g, cut, state } = this;
    g.input.cutawayQuit = false;
    if (this.file.toUpperCase() === "COMIC.CUT") this.songBeforeComic = g.host.lastSong?.() ?? 0;
    g.input.canQuit = cut.skippable;
    if (cut.flags < 0) state.entryObject = 0;
    if (cut.bankNames[0]) this.bobs.frames.load(cut.bankNames[0], CUTAWAY_BANK);
    state.joe.cutFacing = state.joe.facing;
    yield* this.stage.joeFace(g);
    const entry = /^\*F([LRFB])$/.exec(cut.entrySentence);
    if (entry) state.joe.cutFacing = { L: Direction.Left, R: Direction.Right, F: Direction.Front, B: Direction.Back }[entry[1] as "L"];
  }

  /** `Cutaway::run`. Rend la cinématique à enchaîner (`""` : aucune). */
  *run(): Sequence<string> {
    const { g, cut, state, stage } = this;
    yield* this.load();
    this.currentImage = this.bobs.numFrames;
    const joeBob = this.bobs.bob(0);
    const initialJoe = { x: joeBob.x, y: joeBob.y };
    g.input.cutawayRunning = true;
    this.initialRoom = this.temporaryRoom = state.room;
    this.display.screenMode(this.comPanel, true);
    stage.screenMode = { comPanel: this.comPanel, inCutaway: true };
    if (this.comPanel === 0 || this.comPanel === 2) yield* sceneStart(g, stage);

    for (let i = 0; i < cut.objects.length; i++) {
      const object = { ...cut.objects[i], limit: { ...cut.objects[i].limit } };
      if (!object.moveToX && !object.moveToY && object.specialMove > 0 && object.objectNumber >= 0 && !object.roomFade) {
        yield* g.executeSpecialMove(object.specialMove);
        object.specialMove = 0;
      }
      if (object.room === 0) object.room = state.room;
      else state.room = object.room;
      this.limitBob(object);
      this.roomFade = object.roomFade;
      if (object.room !== this.temporaryRoom) yield* this.changeRooms(object);

      const kind = this.objectKind(object);
      if (object.song) g.host.playSong(object.song);
      switch (kind) {
        case "animation":
          yield* this.handleAnimation(object);
          break;
        case "person":
          yield* this.handlePersonRecord(i + 1, object);
          break;
        case "textSpeak":
        case "textDisplayAndSpeak":
        case "textDisplay":
          yield* this.handleText(i + 1, kind, object);
          break;
        default:
          break;
      }
      if (g.input.cutawayQuit) break;
      if (this.roomFade) {
        yield* g.update();
        yield* stage.fadeIn(g);
        this.roomFade = false;
      }
    }
    this.display.clearTexts(0, 198);
    yield* this.stop();
    this.updateGameState();
    this.bobs.frames.close(CUTAWAY_BANK);
    const next = yield* this.talk();
    if (this.comPanel === 0 || (this.comPanel === 2 && !cut.anotherCutaway)) {
      sceneStop(g, stage);
      this.comPanel = 0;
    }
    if (next === "" && !cut.anotherCutaway && state.room !== Room.EndingCredits) yield* this.returnToRoom(initialJoe);

    joeBob.animating = false;
    joeBob.moving = false;
    // Une cinématique sautée coupe aussi la voix et l'effet en cours.
    if (g.input.cutawayQuit) {
      if (g.host.speechActive?.()) g.stopSpeech();
      g.host.stopSfx?.();
    }
    g.input.cutawayRunning = false;
    g.input.cutawayQuit = false;
    if (this.songBeforeComic > 0) g.host.playSong(this.songBeforeComic);
    else if (this.lastSong > 0) g.host.playSong(this.lastSong);
    return next;
  }

  /** Fin de la cinématique : retour à la pièce de départ (ou rien si la cinématique se termine dans la sienne). */
  private *returnToRoom(initialJoe: { x: number; y: number }): Sequence {
    const { g, state, stage } = this;
    this.display.fullscreen = false;
    if (this.finalRoom) {
      state.newRoom = 0;
      state.entryObject = 0;
    } else {
      // Pas de pièce finale : retour à la pièce de départ si on en est sorti, Joe où il était à son arrivée.
      this.restorePersonData();
      if (state.entryObject > 0) {
        this.initialRoom = state.objects[state.entryObject].room;
      } else {
        state.joe.startX = initialJoe.x;
        state.joe.startY = initialJoe.y;
      }
      if (state.room !== this.initialRoom) {
        state.room = this.initialRoom;
        yield* g.showCurrentRoom();
        if (state.room === state.newRoom) state.newRoom = 0;
      }
      state.joe.startX = state.joe.startY = 0;
    }
    state.joe.cutFacing = 0;
    this.comPanel = 0;
    // Les personnes de la pièce reprennent leur animation.
    let k = 0;
    const first = g.data.jas.roomFirstObject[state.room];
    const last = g.data.jas.roomFirstObject[state.room + 1];
    for (let i = first; i <= last; i++) {
      const object = state.objects[i];
      if (isPerson(object.image)) {
        k++;
        if (object.name > 0) stage.actors.resetPersonAnim(k);
      }
    }
    g.inventory.removeHotelItems();
  }

  // --- Enregistrements ---------------------------------------------------------------------------------------------------

  /** `Cutaway::limitBob` : boîte de découpe du bob de l'objet. */
  private limitBob(object: CutObject): void {
    if (!object.limit.x1 || object.roomFade || object.objectNumber < 0) return;
    const bob = this.bobs.bob(this.bobs.findBob(this.g, object.objectNumber));
    bob.box = { ...object.limit };
  }

  /** `Cutaway::restorePersonData`. */
  private restorePersonData(): void {
    for (const person of this.personData) {
      const data = this.state.objects[person.index];
      data.name = person.name;
      data.image = person.image;
    }
  }

  /**
   * `Cutaway::changeRooms` : les personnes de la nouvelle pièce que l'enregistrement n'allume pas sont éteintes, Joe est posé s'il
   * est à l'écran, la pièce s'affiche (fondu ou non).
   */
  private *changeRooms(object: CutObject): Sequence {
    const { g, state } = this;
    this.restorePersonData();
    this.personData.length = 0;
    if (this.finalRoom !== object.room) {
      const first = g.data.jas.roomFirstObject[object.room] + 1;
      const last = g.data.jas.roomFirstObject[object.room] + g.grid.objMax(object.room);
      for (let i = first; i <= last; i++) {
        const data = state.objects[i];
        if (!isPerson(data.image)) continue;
        this.personData.push({ index: i, name: data.name, image: data.image });
        data.name = object.people.includes(i) ? Math.abs(data.name) : -Math.abs(data.name);
      }
    }
    // Joe est posé s'il fait partie des personnes de l'enregistrement.
    state.joe.startX = state.joe.startY = 0;
    if (object.people.includes(PERSON_JOE)) {
      state.joe.startX = object.bobStartX;
      state.joe.startY = object.bobStartY;
    }
    state.oldRoom = this.initialRoom;

    // Contournements de ScummVM : les personnes de ces cinématiques sont sous la ligne 150 de la pièce 41 ; les têtes parlantes cachent le panneau.
    let comPanel = this.comPanel;
    if (PANEL_FIXES.some((fix) => fix.name === this.basename.toLowerCase() && fix.from === this.temporaryRoom && fix.to === object.room)) comPanel = 1;
    if (object.room === Room.FayeHead || object.room === Room.AzuraHead || object.room === Room.FrankHead) comPanel = 2;

    let mode: number;
    if (!state.joe.startX && !state.joe.startY) mode = RoomDisplay.FadeNoJoe;
    else mode = this.roomFade ? RoomDisplay.NoFadeJoe : RoomDisplay.FadeJoeXY;
    yield* g.displayRoom(state.room, mode, object.scale, comPanel, true);
    this.currentImage = this.bobs.numFrames;
    this.temporaryRoom = state.room;
    this.restorePersonData();
  }

  /**
   * Nature de l'enregistrement (`getObjectType`, déjà lue dans `kind`) et effet d'une copie d'objet (`fromObject`) : l'objet est copié
   * depuis le modèle, ou allumé s'il est son propre modèle, et son bob est refait.
   */
  private objectKind(object: CutObject): CutObject["kind"] {
    const { g } = this;
    if (object.fromObject > 0) {
      if (object.objectNumber !== object.fromObject) {
        objectCopy(g, object.fromObject, object.objectNumber);
      } else {
        const data = this.state.objects[object.objectNumber];
        data.name = Math.abs(data.name);
      }
      this.stage.refreshObject(g, object.objectNumber);
    }
    return object.kind;
  }

  /** Échelle de l'enregistrement (`Cutaway::scale`) : celle du fichier, sinon celle de la zone de marche sous Joe. */
  private scale(object: CutObject): number {
    const { g } = this;
    if (object.scale > 0) return object.scale;
    if (object.objectNumber !== 0) return 100;
    let x: number;
    let y: number;
    if (object.bobStartX > 0 || object.bobStartY > 0) {
      x = object.bobStartX;
      y = object.bobStartY;
    } else {
      const bob = this.bobs.bob(0);
      x = bob.x;
      y = bob.y;
    }
    const zone = g.grid.findAreaForPos(x, y);
    return zone > 0 ? areaScale(g.grid.area(this.state.room, zone), y) : 100;
  }

  // --- Animations --------------------------------------------------------------------------------------------------------

  /** `Cutaway::getCutawayAnim` : le bob et l'image de l'objet, la banque (chargée dans l'emplacement de la cinématique). */
  private anim(source: CutAnimation): Anim {
    const { g } = this;
    let object = 0;
    let originalFrame = 31;
    if (source.object !== 0) {
      object = this.bobs.findBob(g, source.object);
      originalFrame = this.bobs.findFrame(g, source.object);
    }
    let bank: number;
    if (source.bank === 0) {
      bank = ROOM_BANK;
    } else if (source.bank !== FILE_JOE_BANK) {
      const name = this.cut.bankNames[source.bank - 1];
      if (name) this.bobs.frames.load(name, CUTAWAY_BANK);
      bank = CUTAWAY_BANK;
    } else {
      bank = JOE_BANK;
    }
    return {
      object,
      unpackFrame: source.unpackFrame,
      flip: source.flip,
      speed: Math.trunc(source.speed / 3) + 1,
      bank,
      mx: source.mx,
      my: source.my,
      cx: source.cx,
      cy: source.cy,
      song: source.song,
      originalFrame,
    };
  }

  /** `Cutaway::handleAnimation` : animations d'objets, de personnes et de Joe, déplacements, attente de la fin des déplacements. */
  private *handleAnimation(object: CutObject): Sequence {
    const { g, state } = this;
    const bobs = this.bobs;
    const anims = object.animations.map((source) => this.anim(source));
    if (g.input.cutawayQuit) return;

    if (object.animType === 1) {
      // Animation complexe : une chaîne d'images pour un seul bob.
      if (anims.length > 0) {
        if ((state.room === 47 || state.room === 63) && anims[0].object === 1) {
          this.makeComplexAnimation(this.stage.actors.personFrames[1] - 1, anims);
        } else {
          this.currentImage = this.makeComplexAnimation(this.currentImage, anims);
        }
        if (object.bobStartX || object.bobStartY) {
          const bob = bobs.bob(anims[0].object);
          bob.x = object.bobStartX;
          bob.y = object.bobStartY;
        }
      }
    }

    // Les déplacements démarrent tous ensemble (les canaux « synchro »).
    for (const anim of anims) {
      if (!anim.mx && !anim.my) continue;
      const bob = bobs.bob(anim.object);
      bob.frameNum = anim.originalFrame;
      bob.move(anim.mx, anim.my, object.specialMove > 0 ? object.specialMove : DEFAULT_MOVE_SPEED);
      // Le bateau du temple (pièce 43) emporte Joe.
      if (state.room === Room.TempleOutside) {
        const joe = bobs.bob(0);
        if (joe.x < 320) joe.move(joe.x + BOAT_SHIFT, joe.y, DEFAULT_MOVE_SPEED);
      }
    }

    if (object.animType !== 1) {
      for (const anim of anims) {
        const bob = bobs.bob(anim.object);
        bob.active = true;
        if (bob.animating) {
          bob.animating = false;
          bob.frameNum = anim.originalFrame;
        }
        if (anim.object < 4) bob.frameNum = 31 + anim.object;
        if (anim.unpackFrame === 0) {
          // Le bob est éteint.
          bob.active = false;
        } else {
          if (object.animType === 2 || object.animType === 0) {
            // Les personnes qui marchent gardent leurs images de marche.
            const movingPerson = (anim.mx > 0 || anim.my > 0) && anim.object >= 1 && anim.object <= 3;
            if (!movingPerson) bobs.frames.unpack(anim.unpackFrame, anim.originalFrame, anim.bank);
            if (anim.object === 0) bob.scale = this.scale(object);
          }
          if (anim.cx || anim.cy) {
            bob.x = anim.cx;
            bob.y = anim.cy;
          }
          const person = anim.object > 0 && anim.object < 4;
          if (!person || !(anim.mx || anim.my)) bob.xflip = anim.flip;
          if (!person) bob.frameNum = anim.originalFrame;
          for (let j = 0; j < anim.speed; j++) yield* g.update();
        }
        if (g.input.cutawayQuit) return;
        if (anim.song > 0) g.host.playSong(anim.song);
      }
    }

    // Attente de la fin des déplacements.
    let moving = true;
    while (moving) {
      moving = false;
      yield* g.update();
      for (const anim of anims) {
        if (bobs.bob(anim.object).moving) {
          moving = true;
          break;
        }
      }
      if (g.input.cutawayQuit) return;
    }
  }

  /**
   * `Cutaway::makeComplexAnimation` : les images distinctes de la chaîne sont rangées dans la table à la suite de `currentImage` (dans
   * l'ordre de leur numéro), la chaîne est posée sur le bob du premier enregistrement. Rend la dernière image utilisée.
   */
  private makeComplexAnimation(currentImage: number, anims: Anim[]): number {
    const frames = [...new Set(anims.map((anim) => anim.unpackFrame))].sort((a, b) => a - b);
    const rank = new Map(frames.map((frame, i) => [frame, i + 1]));
    const chain = anims.map((anim) => ({ frame: currentImage + (rank.get(anim.unpackFrame) as number), speed: anim.speed }));
    for (const frame of frames) {
      currentImage++;
      this.bobs.frames.unpack(frame, currentImage, anims[0].bank);
    }
    this.bobs.setCutawayAnim(anims[0].object, anims[0].flip, chain);
    return currentImage;
  }

  // --- Personnes et textes -----------------------------------------------------------------------------------------------

  /** `Cutaway::handlePersonRecord` : Joe ou une personne marche, puis dit sa phrase (ou lance le générique `#fichier.crd`). */
  private *handlePersonRecord(index: number, object: CutObject): Sequence {
    const { g, stage, state } = this;
    const isJoe = object.objectNumber === 0;
    const noun = object.objectNumber - g.currentRoomData;
    if (isJoe) {
      if (object.moveToX || object.moveToY) yield* stage.moveJoe(g, Direction.None, object.moveToX, object.moveToY, true);
    } else if (object.bobStartX || object.bobStartY || object.moveToX || object.moveToY) {
      // ScummVM cherche l'acteur à chaque enregistrement mais ne s'en sert que pour placer ou déplacer la personne.
      const person = personSpeaker(g, stage, noun, true);
      if (!person.person) {
        g.warn(`${this.file}: objet ${object.objectNumber} sans acteur valide`);
      } else {
        if (object.bobStartX || object.bobStartY) {
          const bob = this.bobs.bob(person.bobNum);
          bob.scale = this.scale(object);
          bob.x = object.bobStartX;
          bob.y = object.bobStartY;
        }
        if (object.moveToX || object.moveToY) {
          yield* stage.walk.movePerson(g, person.person, object.moveToX, object.moveToY, this.currentImage + 1, state.objects[object.objectNumber].image);
        }
      }
    }
    if (g.input.cutawayQuit) return;
    const sentence = object.sentence;
    if (sentence !== "*") {
      if (sentence[0] === "#") {
        g.startCredits(sentence.slice(1));
      } else {
        if (object.objectNumber > 0 && !this.personFaces.some((face) => face.index === object.objectNumber)) {
          this.personFaces.push({ index: object.objectNumber, image: state.objects[object.objectNumber].image });
        }
        yield* g.makePersonSpeak(sentence, isJoe ? null : noun, cutawayVoicePrefix(this.file, index));
      }
    }
  }

  /** `Cutaway::countSpaces` : images d'un texte sans voix (50 caractères au moins, trois fois plus s'il n'est pas dit). */
  private countSpaces(kind: CutObject["kind"], text: string): number {
    let length = Math.max(text.length, 50);
    if (kind === "textDisplay") length *= 3;
    return Math.trunc((length * 2) / Math.trunc(DEFAULT_TALK_SPEED / 3));
  }

  /** `Cutaway::handleText` : texte dit, dit et affiché, ou seulement affiché, jusqu'à la fin de la voix ou du délai. */
  private *handleText(index: number, kind: CutObject["kind"], object: CutObject): Sequence {
    const { g, stage } = this;
    const sentence = object.sentence;
    let spaces = this.countSpaces(kind, sentence);
    const display = kind === "textDisplay";
    const bobNum = Math.min(Math.max(this.bobs.findBob(g, Math.abs(object.objectNumber)), 0), 63);
    stage.setBobText(g, bobNum, sentence, object.specialMove, display ? 2 : 1, display ? 0 : object.bobStartX, object.bobStartY);
    const spoken = kind === "textSpeak" || kind === "textDisplayAndSpeak";
    if (spoken) g.playSpeech(`${cutawayVoicePrefix(this.file, index)}1`);
    for (;;) {
      yield* g.update();
      if (g.input.cutawayQuit) return;
      if (g.input.keyVerb === Verb.SkipText) {
        g.input.keyVerb = Verb.None;
        break;
      }
      if (spoken && g.speechFound) {
        if (!g.speechPending) break;
      } else if (--spaces <= 0) {
        break;
      }
    }
    this.display.clearTexts(0, 198);
    yield* g.update();
  }

  // --- Fin ---------------------------------------------------------------------------------------------------------------

  /**
   * `Cutaway::stop` : pièce finale et position de Joe ; si la cinématique est sautée, les états finaux de la section « extra »
   * (objets, positions, images), le mouvement spécial et le morceau de fin.
   */
  private *stop(): Sequence {
    const { g, state, cut, stage } = this;
    const bobs = this.bobs;
    const joeRoom = toInt16(cut.joeFinal.room);
    const joeX = toInt16(cut.joeFinal.x);
    const joeY = toInt16(cut.joeFinal.y);
    const quit = g.input.cutawayQuit;
    if ((!quit || (!cut.anotherCutaway && joeRoom === this.finalRoom)) && joeRoom !== this.temporaryRoom && joeRoom !== 0) {
      state.joe.startX = joeX;
      state.joe.startY = joeY;
      state.room = joeRoom;
      state.oldRoom = this.initialRoom;
      yield* g.displayRoom(state.room, RoomDisplay.FadeJoeXY, 0, this.comPanel, true);
    }

    if (quit) {
      g.stopCredits();
      bobs.stopBobs();
      for (const face of this.personFaces) {
        if (face.index <= 0) continue;
        state.objects[face.index].image = face.image;
        bobs.bob(bobs.findBob(g, face.index)).xflip = face.image !== PERSON_RIGHT;
      }
      for (const entry of cut.extra.entries) this.finalState(entry);
      const [specialMove, lastSong] = cut.extra.trailer;
      if (specialMove > 0) yield* g.executeSpecialMove(specialMove);
      this.lastSong = lastSong;
    }

    if (joeRoom === this.temporaryRoom && joeRoom !== Room.FayeHead && joeRoom !== 105 && joeRoom !== Room.AzuraHead && (joeX || joeY)) {
      const bob = bobs.bob(0);
      bob.x = joeX;
      bob.y = joeY;
      state.joe.scale = g.grid.findScale(joeX, joeY);
      yield* stage.joeFace(g);
    }
  }

  /** Un état final de la section « extra » (`stop`, cinématique sautée) : l'objet, sa position et son image comme à la fin de la cinématique. */
  private finalState(entry: readonly number[]): void {
    const { g, state, stage } = this;
    const bobs = this.bobs;
    const [objectIndex, fromIndex, x, y, room] = entry.map(toInt16);
    let [, , , , , frame, bank] = entry.map(toInt16);
    const bobIndex = bobs.findBob(g, objectIndex);
    const object = state.objects[objectIndex];
    if (fromIndex > 0) {
      if (fromIndex === objectIndex) {
        object.name = Math.abs(object.name);
      } else {
        objectCopy(g, fromIndex, objectIndex);
        const from = state.objects[fromIndex];
        if (object.image && !from.image && bobIndex && state.room === object.room) bobs.clearBob(bobIndex);
      }
      if (state.room === room) stage.refreshObject(g, objectIndex);
    }
    if (state.room !== object.room) return;
    const bob = bobs.bob(bobIndex);
    if (x || y) {
      bob.x = x;
      bob.y = y;
      if (object.image === PERSON_LEFT || object.image === PERSON_RIGHT) bob.scale = g.grid.findScale(x, y);
    }
    if (!frame) return;
    if (bank === 0) {
      bank = ROOM_BANK;
    } else if (bank !== FILE_JOE_BANK) {
      const name = this.cut.bankNames[bank - 1];
      if (name) bobs.frames.load(name, CUTAWAY_BANK);
      bank = CUTAWAY_BANK;
    } else {
      bank = JOE_BANK;
    }
    const objectFrame = bobs.findFrame(g, objectIndex);
    if (Math.abs(frame) === NO_FRAME || objectFrame === NO_FRAME) {
      bobs.clearBob(bobIndex);
    } else if (objectFrame) {
      bobs.frames.unpack(Math.abs(frame), objectFrame, bank);
      bob.frameNum = objectFrame;
      if (frame < 0) bob.xflip = true;
    }
  }

  /** `Cutaway::updateGameState` : les états du jeu posés ou testés, les objets montrés ou cachés, les zones allumées ou éteintes. */
  private updateGameState(): void {
    const { g, state, stage } = this;
    for (const entry of this.cut.states) {
      let update = false;
      if (entry.stateIndex > 0) {
        update = g.gameState(entry.stateIndex) === entry.stateValue;
      } else {
        g.setGameState(Math.abs(entry.stateIndex), entry.stateValue);
        update = true;
      }
      if (!update) continue;
      if (entry.object > 0) {
        const data = state.objects[entry.object];
        data.name = Math.abs(data.name);
        if (entry.fromObject > 0) objectCopy(g, entry.fromObject, entry.object);
        stage.refreshObject(g, entry.object);
      } else if (entry.object < 0) {
        const data = state.objects[-entry.object];
        data.name = -Math.abs(data.name);
        stage.refreshObject(g, -entry.object);
      }
      if (entry.area > 0) {
        // Une zone qui n'existe pas (données de C47A) est une zone vide pour ScummVM, dont le tableau est plus grand : sans effet.
        const area = state.areas[entry.area]?.[Math.abs(entry.areaSubIndex)];
        if (area) area.mapNeighbors = entry.areaSubIndex > 0 ? Math.abs(area.mapNeighbors) : -Math.abs(area.mapNeighbors);
      }
    }
  }

  /** `Cutaway::talk` : le dialogue de fin, avec la personne désignée (la cinématique qu'il enchaîne est rendue). */
  private *talk(): Sequence<string> {
    const { g, cut } = this;
    if (!/\.DOG$/i.test(cut.talkFile)) return "";
    if (cut.talkTo <= 0) throw new Error(`${this.file}: dialogue ${cut.talkFile} sans personne`);
    const personInRoom = cut.talkTo - g.currentRoomData;
    return yield* g.startDialogue(cut.talkFile, personInRoom);
  }
}

/** Les cinématiques du moteur réel (vague C). */
export class FotaqCutaways implements Cutaways {
  /** Fichiers joués, dans l'ordre (tests, diagnostic). */
  readonly played: string[] = [];

  *play(g: FotaqEngine, file: string): Sequence<string> {
    this.played.push(file);
    return yield* new CutawayRun(g, file).run();
  }
}
