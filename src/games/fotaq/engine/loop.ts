/**
 * Moteur de *Flight of the Amazon Queen* sans navigateur (`docs/fotaq/engine.md`) : boucle principale, entrées, pièces, Joe
 * (position et orientation), répliques de Joe, tenues, verbes et inventaire. Réécriture de `QueenEngine::run` et `update`
 * (engines/queen/queen.cpp), et des parties de `Logic` (logic.cpp) qui ne sont ni des données (`room.ts`, `inventory.ts`) ni
 * propres à une pièce (`script.ts`) : `start`, `changeRoom`, `displayRoom`, `eraseRoom`, `setupRoom`, `setupJoeInRoom`,
 * `makeJoeSpeak`, `makePersonSpeak`, `startDialogue`, `playCutaway`, `joeUseDress`, `joeUseClothes`, `joeUseUnderwear`,
 * `useJournal`, `handleSpecialArea`, `executeSpecialMove`, `gameState`.
 *
 * `tick()` avance d'une image de logique (100 ms, `cadence.ts`). Une séquence en cours (`src/engine/sequence.ts`) a la main :
 * c'est ce qui bloquait dans ScummVM (exécuter une commande, changer de pièce, marcher, parler). Sinon, le tick est un tour de la
 * boucle de `QueenEngine::run` : changement de pièce demandé, commande à exécuter, ou une image où le joueur survole et clique.
 * Comme dans ScummVM, le joueur peut aussi cliquer pendant que Joe marche (`update(true)`), ce qui arrête la marche et lance la
 * nouvelle commande.
 *
 * Ce que font les vagues suivantes passe par des services (`services.ts`) : la scène (`Stage` : marche, bobs, décor, vagues G2 et
 * R), les répliques et dialogues (`Talk`, vague T), les cinématiques (`Cutaways`, vague C) ; la logique codée en dur par
 * `GameScript` (vague L). Sans eux, des versions minimales sont utilisées.
 *
 * Écarts volontaires (détail dans `engine.md`) : on ne sauvegarde qu'entre deux séquences (ScummVM le permet pendant la marche) ;
 * le hasard est un `Lcg` à graine injectable ; le crédit de fin (`Logic::update`) et le débogueur ne sont pas portés.
 */

import { Lcg, msvcRand } from "../../../engine/rng";
import { type Sequence, SequenceRunner, wait } from "../../../engine/sequence";
import { joeVoicePrefix } from "../data/files";
import { CreditsRunner } from "./credits";
import { FAST_RATIO } from "./cadence";
import { Command } from "./command";
import { FotaqCutaways } from "./cutaway";
import { FotaqTalk } from "./dialogs";
import { parseCredits } from "../data/credits";
import { Grid, areaScale } from "./grid";
import type { FotaqHost } from "./host";
import { Input } from "./input";
import { Inventory } from "./inventory";
import { roomSpeechNames } from "./preload";
import { resetRoomImages, roomFiles, roomFurniture, roomName, walkOffPoint } from "./room";
import { type SaveData, matchesGame, restoreState, snapshotState } from "./save";
import type { GameScript } from "./script";
import { type Cutaways, Outfit, type Stage, type Talk } from "./services";
import { BamFlag } from "./specials/bam";
import { GameStage } from "./stage";
import {
  Direction,
  GAME_STATE_COUNT,
  type GameData,
  type GameState,
  GameVar,
  Item,
  JOE_RESPONSE_MAX,
  JoeWalk,
  Room,
  RoomDisplay,
  Verb,
  type World,
  createGameState,
  loadGameData,
  stateDirection,
  stateTalks,
  toInt16,
} from "./state";

export { RoomDisplay } from "./state";

/** Panneau de commande de la pièce (`comPanel` de `displayRoom`) : 1 pour un changement de pièce ordinaire. */
const ROOM_PANEL = 1;

export interface FotaqEngineOptions {
  /** Données du jeu déjà lues (tests : partagées entre moteurs) ; sinon lues par `host.readFile`. */
  data?: GameData;
  /** Logique codée en dur (vague L). */
  script?: GameScript;
  /** Services des vagues G2, R, T et C (versions minimales par défaut). */
  stage?: Stage;
  talk?: Talk;
  cutaways?: Cutaways;
  /** Graine du hasard (par défaut : l'horloge de l'hôte). */
  seed?: number;
  /**
   * Commence dans la pièce de cet objet d'entrée, Joe placé comme s'il entrait par lui (`entryObj`), au lieu du début du jeu
   * (pièce 95, introduction). Outils et tests.
   */
  entryObject?: number;
  /** Commence dans cette pièce, sans objet d'entrée (ignoré si `entryObject` est donné). */
  room?: number;
  /** Partie à reprendre au lieu de commencer (`entryObject` et `room` sont alors ignorés) : voir `loadGame`. Une sauvegarde inutilisable lève. */
  restore?: SaveData;
}

export class FotaqEngine implements World {
  readonly data: GameData;
  readonly script: GameScript;
  readonly stage: Stage;
  readonly talk: Talk;
  readonly cutaways: Cutaways;
  /** Hasard du jeu (réponses de Joe, descriptions aléatoires). */
  readonly rng: Lcg;
  readonly input = new Input();
  readonly grid: Grid;
  readonly inventory: Inventory;
  readonly command: Command;
  state: GameState;
  /** Mode de Joe (`_joe.walk`) : `Execute` demande l'exécution de la commande construite. */
  joeWalk: JoeWalk = JoeWalk.Normal;
  /** Défilement horizontal du décor (`Display::horizontalScroll`) : la caméra de la scène (`GameStage`) le règle. */
  horizontalScroll = 0;
  /** Ticks écoulés depuis la création. */
  ticks = 0;
  /** Vrai après la fin du jeu (`host.exit()` appelé). */
  ended = false;
  /** Nombre de scènes (cinématiques sans panneau) imbriquées en cours (`Logic::_scene`). */
  scene = 0;
  /** Le dernier `playSpeech` a trouvé sa voix, les voix étant actives (`speechOn() && speechSfxExists()`). */
  speechFound = false;
  /** Cas que ScummVM ne gère pas (acteur absent…) : diagnostic des tests et des outils. */
  readonly warnings: string[] = [];
  /** Générique à l'écran (`Logic::_credits`). */
  private credits: CreditsRunner | null = null;
  private fastFrames = 0;
  private readonly runner: SequenceRunner;

  constructor(
    readonly host: FotaqHost,
    options: FotaqEngineOptions = {},
  ) {
    this.data = options.data ?? loadGameData((name) => host.readFile(name));
    this.script = options.script ?? {};
    this.stage = options.stage ?? new GameStage({ onSfx: (sfx) => host.playSfx?.(sfx) });
    if (this.stage instanceof GameStage) {
      for (const [room, update] of Object.entries(this.script.roomUpdates ?? {})) if (update) this.stage.roomUpdates.set(Number(room), update);
    }
    this.talk = options.talk ?? new FotaqTalk();
    this.cutaways = options.cutaways ?? new FotaqCutaways();
    this.rng = new Lcg(options.seed ?? Math.trunc(host.now()), msvcRand);
    this.state = createGameState(this.data);
    this.grid = new Grid(this);
    this.inventory = new Inventory(this);
    this.command = new Command(this);
    this.runner = new SequenceRunner({
      now: () => this.ticks,
      takeSkip: () => this.input.skipRequested(),
      interrupted: () => this.ended,
    });
    if (options.entryObject !== undefined) {
      this.state.room = this.state.objects[options.entryObject].room;
      this.state.entryObject = options.entryObject;
    } else if (options.room !== undefined) {
      this.state.room = options.room;
    }
    this.start();
    if (options.restore && !this.loadGame(options.restore)) throw new Error("sauvegarde inutilisable : elle ne correspond pas aux données du jeu");
  }

  /** `Logic::start` : commande vide, panneau, inventaire de départ ; la première pièce s'ouvre au premier tick. */
  private start(): void {
    this.command.clear(false);
    this.grid.setupPanel();
    this.inventory.setup();
    this.state.oldRoom = 0;
    this.state.newRoom = this.state.room;
  }

  // --- Boucle -----------------------------------------------------------------------------------------------------------

  /** Un tick (une image de 100 ms) : entrées, puis la séquence en cours ou un tour de la boucle principale. */
  tick(): void {
    if (this.ended) return;
    this.ticks++;
    this.input.receive(this.host.pollInput());
    this.input.checkKeys();
    if (this.runner.active) {
      this.runner.step();
      // ScummVM enchaîne sans attendre : la fin d'une commande lance tout de suite le changement de pièce demandé.
      if (!this.runner.active) this.loopStep(false);
    } else {
      this.loopStep(true);
    }
  }

  /**
   * Un tour de `QueenEngine::run` : changement de pièce, commande à exécuter (séquences), ou, si `idle`, une image où le joueur
   * a la main (`update(true)`). Une commande choisie pendant cette image s'exécute aussitôt.
   */
  private loopStep(idle: boolean): void {
    if (this.state.newRoom > 0) {
      this.runner.start(this.changeRoom());
    } else if (this.joeWalk === JoeWalk.Execute) {
      this.setJoeWalk(JoeWalk.Normal);
      this.runner.start(this.command.executeCurrentAction());
    } else if (idle) {
      this.setJoeWalk(JoeWalk.Normal);
      this.stage.frame(this);
      this.updateCredits();
      if (!this.input.cutawayRunning) this.command.updatePlayer();
      if (this.state.newRoom > 0 || this.joeWalk === JoeWalk.Execute) this.loopStep(false);
    }
  }

  /**
   * Une image de jeu dans une séquence (`QueenEngine::update`) : les bobs avancent, une image passe, puis, si `checkPlayerInput`,
   * le joueur peut survoler et cliquer (pendant la marche de Joe, par exemple).
   */
  *update(checkPlayerInput = false): Sequence {
    this.stage.frame(this);
    this.updateCredits();
    // Mode rapide (`Input::delay` avec `_fastMode`) : une image dure 10 ms au lieu de 100 ; un tick de 100 ms en porte `FAST_RATIO`.
    if (this.input.fastMode && ++this.fastFrames % FAST_RATIO !== 0) return;
    yield* wait(1);
    if (checkPlayerInput && !this.input.cutawayRunning) this.command.updatePlayer();
  }

  /** Compose l'image et la présente à l'hôte : à appeler une fois par image d'écran, après les ticks (vague R, `Stage.render`). */
  render(): void {
    this.stage.render(this);
  }

  /** Lance une séquence quand la boucle principale a la main (outils, tests) ; lève si une séquence est déjà en cours. */
  run(sequence: Sequence<unknown>): void {
    this.runner.start(sequence);
  }

  /** Une séquence a la main (la boucle principale attend). */
  get busy(): boolean {
    return this.runner.active;
  }

  /**
   * On peut sauvegarder : la boucle principale a la main et rien n'est en attente. Pas pendant une séquence (commande en cours de
   * marche, réplique, **dialogue et son menu de choix**, cinématique, changement de pièce : un générateur en cours ne se sérialise
   * pas) ni quand une commande choisie n'a pas encore été exécutée. ScummVM (`canLoadOrSave`) est plus large : il ne refuse que
   * pendant une cinématique, sa sauvegarde rapide passe aussi pendant la marche.
   */
  get canSave(): boolean {
    return !this.runner.active && !this.input.cutawayRunning && !this.ended && this.scene === 0 && this.state.newRoom === 0 && this.joeWalk !== JoeWalk.Execute;
  }

  /**
   * Instantané de la partie (`ui/saves.ts` l'écrit dans un emplacement), ou `null` si l'on ne peut pas sauvegarder maintenant
   * (`canSave`). Le dernier morceau vient de l'hôte (`lastSong`), la course ou le combat de la scène réelle.
   */
  saveGame(): SaveData | null {
    if (!this.canSave) return null;
    const stage = this.stage instanceof GameStage ? this.stage : null;
    return snapshotState(this.state, {
      lastSong: this.host.lastSong?.() ?? 0,
      bam: stage?.bam.snapshot() ?? { flag: BamFlag.Stop, index: 0, screenShaked: false, fightTable: 0 },
      lightsOff: stage?.display.palette.dark ?? false,
    });
  }

  /**
   * Reprend la partie `save` (`QueenEngine::loadGameState`, `Logic::setupRestoredGame`) : ce qui était en cours (séquence,
   * cinématique, dialogue, voix, générique) est abandonné, l'état est remplacé, puis la pièce est réaffichée comme à une entrée
   * (fondu, Joe à sa place et dans sa tenue, bobs refaits d'après les objets), la course ou le combat reprennent, la musique
   * est relancée. Rend faux, sans rien changer, si la sauvegarde ne correspond pas aux données du jeu ou si le jeu est fini.
   * À appeler **entre deux ticks** (l'hôte, pas une séquence).
   *
   * Écarts : seul ce qui est dans `save.ts` est repris, comme ScummVM ; les animations de la pièce repartent de leur première image
   * (la sauvegarde ne garde pas leur phase), le défilement est recalculé par la caméra.
   */
  loadGame(save: SaveData): boolean {
    if (this.ended || !matchesGame(save, this.data)) return false;
    this.runner.abort();
    this.resetForLoad();
    this.state = restoreState(save);
    this.runner.start(this.reenter(save));
    return true;
  }

  /** Ce qui est transitoire (voir `save.ts`) est remis à zéro, à l'image de `Logic::start` et de la fin d'une scène. */
  private resetForLoad(): void {
    this.input.reset();
    this.setJoeWalk(JoeWalk.Normal);
    this.scene = 0;
    this.fastFrames = 0;
    this.speechFound = false;
    this.stopCredits();
    this.stopSpeech();
    this.host.stopSfx?.();
    const display = this.gameDisplay();
    if (display) {
      display.clearTexts(0, 199);
      display.cursorVisible = true;
      display.shakeY = 0;
      display.palette.clearGrey();
    }
    if (this.stage instanceof GameStage) this.stage.bam.halt();
    this.stage.stopJoe(this);
    this.command.clear(true);
    this.grid.setupPanel();
  }

  /**
   * `Logic::setupRestoredGame` : la tenue (banques et palette de Joe), la pièce affichée avec Joe où il était, puis la lumière,
   * la course ou le combat, et le dernier morceau.
   */
  private *reenter(save: SaveData): Sequence {
    const joe = this.state.joe;
    this.stage.setOutfit(this, this.gameState(GameVar.JoeDressingMode) as Outfit);
    joe.startX = save.joe.x;
    joe.startY = save.joe.y;
    yield* this.displayRoom(this.state.room, RoomDisplay.FadeJoeXY, joe.scale, ROOM_PANEL, false);
    if (this.stage instanceof GameStage) {
      this.stage.bam.restore(this, save.bam);
      if (save.lightsOff) this.stage.display.palette.lightsOff(this.state.room);
    }
    this.host.playSong(save.lastSong);
  }

  /** Un appui sur Échap (`skipCutaway`) aurait un effet : cinématique ou dialogue en cours et passable. Lecture seule. */
  get canSkip(): boolean {
    return this.input.canSkip;
  }

  /** `Logic::joeWalk` : le mode de Joe ; `Speak` signale aussi un dialogue en cours aux entrées. */
  setJoeWalk(mode: JoeWalk): void {
    this.joeWalk = mode;
    this.input.dialogueRunning = mode === JoeWalk.Speak;
  }

  // --- Voix (`Sound`) et générique ----------------------------------------------------------------------------------------

  /** `Sound::playSpeech` : la voix `name` est lancée par l'hôte ; `speechFound` dit si la réplique dure autant qu'elle. */
  playSpeech(name: string): void {
    this.speechFound = this.host.playSpeech?.(name) ?? false;
  }

  stopSpeech(): void {
    this.host.stopSpeech?.();
  }

  /** La voix lancée n'est pas finie (`Sound::isSpeechActive`). */
  get speechPending(): boolean {
    return this.host.speechActive?.() ?? false;
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  /** `Logic::startCredits` : le générique `file` (`credit1.crd`) remplace celui en cours. */
  startCredits(file: string): void {
    this.stopCredits();
    this.credits = new CreditsRunner(parseCredits(this.host.readFile(file)));
  }

  /** `Logic::stopCredits` : le texte du générique est effacé. */
  stopCredits(): void {
    if (!this.credits) return;
    this.gameDisplay()?.clearTexts(0, 199);
    this.credits = null;
  }

  /** L'écran de la scène réelle, `null` avec une scène minimale. */
  private gameDisplay() {
    return this.stage instanceof GameStage ? this.stage.display : null;
  }

  private updateCredits(): void {
    const display = this.gameDisplay();
    if (display) this.credits?.update(display);
  }

  private creditsNextRoom(): void {
    const display = this.gameDisplay();
    if (display) this.credits?.nextRoom(display);
  }

  /** Fin du jeu (`asmEndGame`, vague L) : la séquence en cours s'arrête à son prochain `yield`, l'hôte quitte. */
  endGame(): void {
    if (this.ended) return;
    this.ended = true;
    this.host.exit();
  }

  // --- Données et textes -----------------------------------------------------------------------------------------------

  /** État du jeu `index` (`Logic::gameState`). */
  gameState(index: number): number {
    if (index < 0 || index >= GAME_STATE_COUNT) throw new Error(`état du jeu ${index} hors limites`);
    return this.state.gameStates[index];
  }

  setGameState(index: number, value: number): void {
    if (index < 0 || index >= GAME_STATE_COUNT) throw new Error(`état du jeu ${index} hors limites`);
    this.state.gameStates[index] = toInt16(value);
  }

  /** Premier objet de la pièce courante moins un (`currentRoomData`) : numéro dans la pièce + cette valeur = objet du jeu. */
  get currentRoomData(): number {
    return this.data.jas.roomFirstObject[this.state.room];
  }

  objectName(name: number): string {
    return this.textAt(this.data.texts.objectNames, name, "nom d'objet");
  }

  /** Description d'objet (`objectTextualDescription`) : une phrase de Joe, ou le nom d'une cinématique ou d'un dialogue. */
  objectDescriptionText(description: number): string {
    return this.textAt(this.data.texts.objectDescriptions, description, "description");
  }

  joeResponse(n: number): string {
    return this.textAt(this.data.texts.joeResponses, n, "réponse de Joe");
  }

  /** Nom d'un verbe (`verbName`) ; vide pour `Verb.None`. */
  verbName(verb: number): string {
    return verb === 0 ? "" : this.textAt(this.data.texts.verbs, verb, "verbe");
  }

  private textAt(texts: string[], n: number, what: string): string {
    if (n < 1 || n >= texts.length) throw new Error(`${what} ${n} hors limites`);
    return texts[n];
  }

  walkOffPoint(object: number): { x: number; y: number } | null {
    return walkOffPoint(this.state, object);
  }

  // --- Pièces ---------------------------------------------------------------------------------------------------------

  /** Changement de pièce de la boucle principale (`QueenEngine::run`, `Logic::changeRoom`). */
  private *changeRoom(): Sequence {
    const state = this.state;
    state.oldRoom = state.room;
    state.room = state.newRoom;
    yield* this.showCurrentRoom();
    if (state.room === state.newRoom) state.newRoom = 0;
  }

  /** `Logic::changeRoom` : affiche la pièce courante (une pièce spéciale peut s'en charger), Joe placé à son entrée. */
  *showCurrentRoom(): Sequence {
    const special = this.script.changeToSpecialRoom ? yield* this.script.changeToSpecialRoom(this) : false;
    if (!special) yield* this.displayRoom(this.state.room, RoomDisplay.FadeJoe, 100, ROOM_PANEL, false);
  }

  /**
   * Affiche la pièce `room`, qui est la pièce courante (`Logic::displayRoom`) : la pièce quittée est remise en ordre, la nouvelle est préparée (zones,
   * décor, bobs), Joe y est placé (selon `mode`), fondu, puis Joe marche jusqu'à son point d'arrivée s'il en a un.
   */
  *displayRoom(room: number, mode: number, scale: number, comPanel: number, inCutaway: boolean): Sequence {
    // Les fichiers du décor arrivent par le réseau dans le navigateur : on les attend avant d'effacer la pièce quittée.
    if (this.host.roomFilesReady) {
      const files = roomFiles(this.data, room, (name) => this.host.fileExists(name));
      while (!this.host.roomFilesReady(files)) yield* wait(1);
    }
    yield* this.eraseRoom();
    this.creditsNextRoom();
    this.setupRoom(room, comPanel, inCutaway);
    if (!inCutaway) this.host.preloadSpeech?.(roomSpeechNames(this, this.state.room));
    if (mode !== RoomDisplay.FadeNoJoe) yield* this.setupJoeInRoom(mode !== RoomDisplay.FadeJoeXY, scale);
    if (mode !== RoomDisplay.NoFadeJoe) {
      yield* this.update();
      yield* this.stage.fadeIn(this);
    }
    const joe = this.state.joe;
    if (mode !== RoomDisplay.FadeNoJoe && joe.startX !== 0 && joe.startY !== 0) {
      const { startX, startY } = joe;
      joe.startX = joe.startY = 0;
      yield* this.stage.moveJoe(this, Direction.None, startX, startY, inCutaway);
    }
  }

  /** `Logic::eraseRoom` : fondu de sortie, banques et animations (scène), images des objets de la pièce quittée. */
  private *eraseRoom(): Sequence {
    this.stage.eraseRoom(this);
    yield* this.stage.fadeOut(this);
    resetRoomImages(this, this.state.oldRoom);
  }

  /**
   * `Logic::setupRoom` : zones de la pièce courante, puis décor de `room` (en pratique la pièce courante) et bobs (scène) avec
   * les meubles de la pièce courante.
   */
  private setupRoom(room: number, comPanel: number, inCutaway: boolean): void {
    roomName(this.data, room);
    const current = this.state.room;
    this.grid.setupNewRoom(current);
    this.stage.setupRoom(this, room, comPanel, inCutaway, roomFurniture(this.data, current));
  }

  /**
   * Place Joe en entrant dans la pièce (`Logic::setupJoeInRoom`) : à la position demandée, ou au point de sortie de l'objet
   * d'entrée (il marchera ensuite jusqu'à l'objet), ou sur l'objet d'entrée ; échelle de la zone ; tourné à l'opposé de l'objet
   * d'entrée, sauf orientation imposée par une cinématique.
   */
  *setupJoeInRoom(autoPosition: boolean, scale: number): Sequence {
    const state = this.state;
    const joe = state.joe;
    let x: number;
    let y: number;
    if (!autoPosition || joe.startX !== 0 || joe.startY !== 0) {
      x = joe.startX;
      y = joe.startY;
      joe.startX = joe.startY = 0;
    } else {
      const entry = state.objects[state.entryObject];
      const walkOff = this.walkOffPoint(state.entryObject);
      if (walkOff) {
        x = toInt16(walkOff.x);
        y = toInt16(walkOff.y);
        joe.startX = toInt16(entry.x);
        joe.startY = toInt16(entry.y);
      } else {
        x = toInt16(entry.x);
        y = toInt16(entry.y);
        joe.startX = joe.startY = 0;
      }
    }

    if (scale > 0 && scale < 100) {
      joe.scale = scale;
    } else {
      const area = this.grid.findAreaForPos(x, y);
      joe.scale = area > 0 ? areaScale(this.grid.area(state.room, area), y) : 100;
    }

    if (joe.cutFacing > 0) {
      joe.facing = joe.cutFacing;
      joe.cutFacing = 0;
    } else {
      // Joe tourne le dos à l'objet par lequel il est entré.
      const opposite: Record<number, Direction> = {
        [Direction.Back]: Direction.Front,
        [Direction.Front]: Direction.Back,
        [Direction.Left]: Direction.Right,
        [Direction.Right]: Direction.Left,
      };
      joe.facing = opposite[stateDirection(state.objects[state.entryObject].state)] ?? joe.facing;
    }
    joe.prevFacing = joe.facing;
    if (state.room === Room.Room108) {
      // Joe vu de dos dans la pièce 108 (banque `JOE_E.ACT` et caméra : scène).
      joe.facing = joe.cutFacing = joe.prevFacing = Direction.Right;
    }
    joe.x = x;
    joe.y = y;
    yield* this.stage.joeFace(this);
    this.stage.placeJoe(this);
  }

  /**
   * `Logic::handleSpecialArea` : appelée par la marche (vague G2) quand Joe atteint une zone éteinte. Joe s'arrête et se tourne,
   * le changement de pièce est annulé, puis la pièce réagit (`script.handleSpecialArea`) et ses cinématiques s'enchaînent.
   */
  *handleSpecialArea(facing: Direction, areaNum: number, walkDataNum: number): Sequence {
    this.state.joe.facing = facing;
    yield* this.stage.joeFace(this);
    this.state.newRoom = 0;
    this.state.entryObject = 0;
    let next = this.script.handleSpecialArea ? yield* this.script.handleSpecialArea(this, facing, areaNum, walkDataNum) : "";
    while (next.length > 4 && next.slice(-4).toUpperCase() === ".CUT") next = yield* this.playCutaway(next);
  }

  /** Mouvement spécial `n` (`executeSpecialMove`), lancé par une cinématique (vague C) ; sans effet s'il n'est pas défini. */
  *executeSpecialMove(n: number): Sequence {
    const move = this.script.specialMoves?.[n];
    if (move) yield* move(this);
  }

  // --- Répliques, cinématiques, dialogues --------------------------------------------------------------------------------

  /**
   * Joe dit la réponse `n` (1 à 40) ou, si `objectType`, la description d'objet `n` (`makeJoeSpeak`). Voix : `JOE` suivi du
   * numéro sur quatre chiffres (descriptions décalées de 40).
   */
  *makeJoeSpeak(n: number, objectType = false): Sequence {
    const text = objectType ? this.objectDescriptionText(n) : this.joeResponse(n);
    yield* this.makePersonSpeak(text, null, joeVoicePrefix(objectType ? n + JOE_RESPONSE_MAX : n));
  }

  /** `makePersonSpeak` : la commande est effacée, puis la réplique est dite. */
  *makePersonSpeak(text: string, person: number | null, voicePrefix: string): Sequence {
    this.command.clear(false);
    yield* this.talk.speak(this, text, person, voicePrefix);
  }

  /** Joue une cinématique (`playCutaway`) ; rend la suivante à enchaîner (`""` : aucune). */
  *playCutaway(file: string): Sequence<string> {
    this.command.clearLine();
    return yield* this.cutaways.play(this, file);
  }

  /**
   * Dialogue avec la personne `personInRoom` (`startDialogue`) : seulement si elle est visible et n'est pas une sortie ; une
   * personne muette fait dire à Joe qu'il n'obtiendra pas de réponse. Rend la cinématique à enchaîner (`""` : aucune).
   */
  *startDialogue(file: string, personInRoom: number): Sequence<string> {
    const data = this.state.objects[this.currentRoomData + personInRoom];
    if (data.name <= 0 || data.entryObject > 0) return "";
    if (!stateTalks(data.state)) {
      yield* this.makeJoeSpeak(24 + this.rng.inclusive(2));
      return "";
    }
    return yield* this.talk.dialogue(this, file, personInRoom);
  }

  /**
   * Le journal (`LogicGame::useJournal`) : entrées et commande effacées, Joe arrêté ; l'hôte ouvre ses fenêtres (sauvegarde,
   * chargement, options : l'écran journal de ScummVM n'est pas porté, D7).
   */
  useJournal(): void {
    this.input.keyVerb = Verb.None;
    this.input.takeMouseButton();
    this.command.clear(false);
    this.host.openJournal?.();
    this.stage.stopJoe(this);
  }

  // --- Tenues de Joe (`logic.cpp`) ------------------------------------------------------------------------------------

  /** Joe met la robe (`joeUseDress`) ; `showCut` : avec la cinématique où il se change (la première fois, il garde ses vêtements). */
  *joeUseDress(showCut: boolean): Sequence {
    if (showCut) {
      this.state.joe.facing = Direction.Front;
      yield* this.stage.joeFace(this);
      if (this.gameState(GameVar.JoeDressingMode) === Outfit.Normal) {
        yield* this.playCutaway("CDRES.CUT");
        this.inventory.insert(Item.Clothes);
      } else {
        yield* this.playCutaway("CUDRS.CUT");
      }
    }
    this.stage.setOutfit(this, Outfit.Dress);
    this.inventory.remove(Item.Dress);
    this.setGameState(GameVar.JoeDressingMode, Outfit.Dress);
  }

  /** Joe remet ses vêtements (`joeUseClothes`) ; `showCut` : avec la cinématique, la robe revient dans l'inventaire. */
  *joeUseClothes(showCut: boolean): Sequence {
    if (showCut) {
      this.state.joe.facing = Direction.Front;
      yield* this.stage.joeFace(this);
      yield* this.playCutaway("CDCLO.CUT");
      this.inventory.insert(Item.Dress);
    }
    this.stage.setOutfit(this, Outfit.Normal);
    this.inventory.remove(Item.Clothes);
    this.setGameState(GameVar.JoeDressingMode, Outfit.Normal);
  }

  /** Joe en sous-vêtements (`joeUseUnderwear`). */
  joeUseUnderwear(): void {
    this.stage.setOutfit(this, Outfit.Underwear);
    this.setGameState(GameVar.JoeDressingMode, Outfit.Underwear);
  }
}
