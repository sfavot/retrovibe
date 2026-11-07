import { Lcg, msvcRand } from "../../../engine/rng";
import {
  ANY_ROOM,
  DEFAULT_ROOM,
  INVENTORY_ROOM,
  addObject,
  chooseObject,
  findRoomAction,
  hasObject,
  inventorySlotAt,
  nextExcuse,
  removeObject,
  selectVerb,
  verbAtBar,
} from "./actions";
import { DrasculaRenderer, type ChoiceMenu, type Roll, type TalkView } from "../render/renderer";
import { heroHead } from "../render/heads";
import { TextColor } from "../render/palette";
import { FRAME_TICKS, TICK_MS, pauseTicks } from "./cadence";
import { Dialogs } from "./dialogs";
import type { DrasculaHost } from "./host";
import { DrasculaData } from "./resources";
import { applyChapter2Hero, createRoomState, objectIndex, placeHero, rectContains } from "./room";
import { type SaveData, restoreObjects, restoreState, savedFields, snapshotState } from "./save";
import type { GameScript } from "./script";
import { type Sequence, SequenceRunner, delay, pause, wait } from "./sequence";
import { type GameState, HERO_OBJECT, LAST_CHAPTER, type RoomObject, type RoomState, STEP_X, STEP_Y, Track, Verb, createGameState } from "./state";
import { type Speaker, type Subtitle, speak, voiceFile } from "./talk";
import { Talkers } from "./talkers";
import { moveCharacters, startWalking } from "./walk";

/**
 * Moteur de *Drascula* sans navigateur (`docs/drascula/engine.md`) : boucle principale, entrées, verbes, pièces, héros,
 * inventaire, chapitres. Réécriture de `run`, `runCurrentChapter`, `verify1`, `verify2`, `updateEvents` (drascula.cpp),
 * `enterRoom`, `exitRoom`, `checkAction`, `room`, `roomParse`, `updateRoom` (rooms.cpp), `walkToPoint`, `checkObjects`,
 * `pickupObject`, `removeObject` (objects.cpp), `talk` (talk.cpp), `endChapter` et `MusicFadeout` (drascula.cpp, sound.cpp),
 * `fadeToBlack` et `fadeFromBlack` (palette.cpp) d'engines/drascula (ScummVM), sans le son réel (vague A). Les personnages qui
 * parlent sont dans `talkers.ts`, les dialogues dans `dialogs.ts`, les cinématiques dans `cinematics/` (vagues T et C). Le dessin est dans `render/` (vague R) : `render()` compose l'image depuis
 * l'état et la confie à `host.present`.
 *
 * `tick()` avance de 10 ms (`TICK_MS`). Une séquence en cours (`sequence.ts`) a la main : la boucle principale est suspendue,
 * comme pendant les attentes bloquantes de ScummVM. Sinon, une image de la boucle principale est jouée tous les `FRAME_TICKS`.
 * Ce qui bloquait dans ScummVM (marcher jusqu'à un objet, parler, franchir une porte, le début d'un chapitre) est une séquence.
 *
 * La logique propre aux pièces, aux chapitres et aux cinématiques passe par `GameScript` (`script.ts`, vague P).
 *
 * Écarts volontaires (détail dans `engine.md`) : un appui du bouton gauche entre deux images n'est pas perdu (ScummVM lit l'état
 * du bouton) ; les appuis pendant une séquence sont ignorés ; Échap saute la partie sautable en cours dès l'attente en cours ;
 * l'image est recomposée à la demande de l'hôte (`render`), et non au fil des boucles d'attente de ScummVM (`graphics.md`).
 */

export interface DrasculaEngineOptions {
  /** Chapitre de départ (1 à 6 ; 1 par défaut). */
  chapter?: number;
  /** Graine du hasard (par défaut : l'horloge de l'hôte). */
  seed?: number;
  /** Logique propre au jeu (pièces, cinématiques). */
  script?: GameScript;
  /** Partie à reprendre au lieu de commencer le chapitre (`chapter` est alors ignoré) : voir `loadGame`. Une sauvegarde inutilisable lève. */
  restore?: SaveData;
}

export { LAST_CHAPTER };
/** Tampon de touches de ScummVM (`KEYBUFSIZE` 16, une case toujours libre). */
const KEY_BUFFER = 15;
/** Ordonnée sous laquelle la souris est sur la barre des verbes (`_mouseY < 24`). */
const VERB_BAR_HEIGHT = 24;
/** Pièces où le nom des objets s'affiche au survol même sans verbe (`showMap`) : les cartes 10 et 45, et le carrefour 2 (`update_2`). */
const MAP_ROOMS = new Set([2, 10, 45]);
/** Touches des verbes (`game-shortcuts` de engines/drascula/metaengine.cpp) ; F8 vide le curseur. */
const VERB_KEYS: Record<string, number> = { F1: Verb.Look, F2: Verb.Pick, F3: Verb.Open, F4: Verb.Close, F5: Verb.Talk, F6: Verb.Move, F8: Verb.None };
/** Fondu de la musique (`MusicFadeout`) : volume du mixeur de ScummVM, pas de volume et durées en millisecondes réelles. */
const MIXER_VOLUME = 192;
const FADE_STEP = 10;
const FADE_STEP_MS = 50;
const FADE_END_MS = 100;
/** Saut des cinématiques (`kActionSkip`, carte `animation`). */
const SKIP_KEY = "Escape";

export class DrasculaEngine implements Speaker {
  readonly data: DrasculaData;
  readonly script: GameScript;
  /** Hasard du jeu (visages pendant les répliques, vague R / T). */
  readonly rng: Lcg;
  /** Rendu : surfaces, palette, composition (`render/renderer.ts`). */
  readonly gfx: DrasculaRenderer;
  state: GameState;
  /** Réplique affichée. */
  subtitle: Subtitle | null = null;
  /**
   * Sous-titres affichés (`_subtitlesDisabled` de ScummVM, touche `t`) : s'ils sont masqués, la réplique se joue (voix, durée,
   * tête qui parle) sans que son texte soit dessiné. Réglage de l'hôte, pas de l'état du jeu : il n'est pas sauvegardé.
   */
  subtitlesEnabled = true;
  /** Tête qui parle pendant une réplique (`Speaker.talk`) : la vue de `render/heads.ts` et le tirage du tour. */
  head: { view: TalkView; roll: Roll } | null = null;
  /** Choix de dialogue affichés (`converse`). */
  choices: ChoiceMenu | null = null;
  /** Les personnages qui parlent (`talkers.ts`) et les dialogues (`dialogs.ts`). */
  readonly talkers: Talkers;
  readonly dialogs: Dialogs;
  /** `converse` attend un clic gauche (`takeClick`) : la boucle de séquences ne les ignore plus. */
  listenForClicks = false;
  /** Ticks écoulés depuis la création (`getTime()`). */
  ticks = 0;
  /** Le curseur est dessiné (`showCursor` / `hideCursor`) : caché pendant la marche d'un déplacement scénarisé. */
  cursorVisible = true;
  /** Vrai après la fin du jeu (`host.exit()` appelé). */
  ended = false;
  /** Position de la souris (écran 320 x 200). */
  mouseX = 0;
  mouseY = 0;
  /**
   * Le clic en cours est traité (`doBreak`) : `verify1` ne cherche plus d'autre objet ni ne fait marcher le héros. Les
   * gestionnaires de porte qui refusent la sortie avec une réplique le lèvent (porte 105 du chapitre 1).
   */
  doBreak = false;

  /** Partie en cours de chargement : `enterRoom` en remet l'état une fois la pièce chargée (voir `loadGame`). */
  private loading: SaveData | null = null;
  private readonly runner: SequenceRunner;
  private nextFrame = 0;
  private pendingChapter: number | null = null;
  private leftDown = false;
  private rightDown = false;
  /** Appui gauche reçu depuis la dernière image : un clic bref n'est pas perdu. */
  private leftLatch = false;
  /** `_leftMouseButtonHeld` : le bouton n'a pas été relâché depuis le dernier clic traité. */
  private leftHeld = false;
  /** `_rightMouseButton` : bouton droit relâché, en attente de la boucle principale. */
  private rightClick = false;
  private readonly keys: string[] = [];
  /** Appui gauche reçu pendant `listenForClicks` et pas encore pris par `takeClick`. */
  private clickEdge = false;

  constructor(
    readonly host: DrasculaHost,
    options: DrasculaEngineOptions = {},
  ) {
    this.data = new DrasculaData((name) => host.readFile(name));
    this.script = options.script ?? {};
    const verbs = Array.from({ length: 6 }, (_, i) => this.data.text("textverbs", i));
    this.gfx = new DrasculaRenderer((name) => host.readFile(name), this.data.dat, this.data.text("textmisc", 3), verbs);
    Object.assign(this.gfx.painters, this.script.painters);
    this.rng = new Lcg(options.seed ?? Math.trunc(host.now()), msvcRand);
    this.runner = new SequenceRunner({
      now: () => this.ticks,
      takeSkip: () => this.takeKey(SKIP_KEY) !== null,
      interrupted: () => this.pendingChapter !== null,
    });
    const chapter = options.chapter ?? 1;
    this.state = createGameState(chapter);
    this.talkers = new Talkers(this);
    this.dialogs = new Dialogs(this);
    if (options.restore) {
      if (!this.loadGame(options.restore)) throw new Error("sauvegarde inutilisable : la pièce n'existe pas dans ce chapitre");
    } else {
      this.beginChapter(chapter);
    }
  }

  // --- Boucle -----------------------------------------------------------------------------------------------------------

  /** Un tick de 10 ms : entrées, séquence en cours ou image de la boucle principale, changement de chapitre. */
  tick(): void {
    if (this.ended) return;
    this.ticks++;
    this.script.tick?.(this);
    this.readInput();
    if (this.pendingChapter !== null) this.switchChapter();
    if (this.runner.active) {
      this.leftLatch = false;
      this.runner.step();
      if (!this.listenForClicks) this.clickEdge = false;
    } else if (this.ticks >= this.nextFrame) {
      this.nextFrame = this.ticks + FRAME_TICKS;
      this.mainFrame();
    }
    if (this.pendingChapter !== null && !this.runner.active) this.switchChapter();
  }

  /**
   * Compose l'image de l'état courant et la présente à l'hôte (`host.present`). L'hôte l'appelle une fois par image d'écran, après
   * les ticks de l'image (et non à chaque tick : le moteur avance à 100 Hz, l'écran à 60 Hz) ; les tests la demandent quand ils
   * veulent voir l'écran.
   */
  render(): void {
    this.gfx.compose({
      state: this.state,
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      subtitle: this.subtitlesEnabled ? this.subtitle : null,
      main: !this.runner.active,
      cursorVisible: this.cursorVisible,
      talk: this.head,
      choices: this.choices,
    });
    this.host.present(this.gfx.screen.pixels, this.gfx.palette.shown);
  }

  /**
   * Lance une séquence quand la boucle principale a la main (outils de développement, tests, écrans) ; lève si une séquence est
   * déjà en cours.
   */
  run(sequence: Sequence<unknown>): void {
    this.startSequence(sequence);
  }

  /** Une séquence a la main (la boucle principale attend). */
  get busy(): boolean {
    return this.runner.active;
  }

  /** On peut sauvegarder : pas pendant une séquence, comme `_canSaveLoad` de ScummVM (vague S). */
  get canSave(): boolean {
    return !this.runner.active && !this.ended && this.pendingChapter === null;
  }

  /**
   * Instantané de la partie (`ui/saves.ts` l'écrit dans un emplacement), ou `null` si l'on ne peut pas sauvegarder maintenant
   * (`canSave` : séquence en cours, ce qui comprend les choix de dialogue).
   */
  saveGame(): SaveData | null {
    return this.canSave ? snapshotState(this.state, this.ticks) : null;
  }

  /**
   * Reprend la partie `data` (`loadGame` de ScummVM) : ce qui était en cours est abandonné, le chapitre sauvegardé est ouvert (ses
   * images de départ, `startChapter`) puis la pièce est rechargée comme le fait le jeu (`enterRoom` : musique, `roomLoaded`, séquences d'entrée
   * de la pièce), l'état sauvegardé étant remis juste après `roomLoaded`. Le temps du moteur reprend à celui de la sauvegarde.
   * Rend faux, sans rien changer, si la fiche de la pièce n'existe pas dans ce chapitre (sauvegarde abîmée) ou si le jeu est fini.
   * À appeler entre deux ticks.
   */
  loadGame(data: SaveData): boolean {
    if (this.ended) return false;
    try {
      this.data.room(data.room.number, data.chapter);
    } catch {
      return false;
    }
    this.runner.abort();
    this.pendingChapter = null;
    this.subtitle = null;
    this.head = null;
    this.choices = null;
    this.listenForClicks = false;
    this.cursorVisible = true;
    this.doBreak = false;
    this.rightClick = false;
    this.leftLatch = false;
    this.leftHeld = this.leftDown;
    this.clickEdge = false;
    this.host.stopSound();
    this.gfx.shake = null;
    this.ticks = data.ticks;
    this.nextFrame = this.ticks + 1;
    this.state = restoreState(data, this.state.roomMusic);
    this.loading = data;
    this.gfx.startChapter(data.chapter);
    this.chapterSheets(data.chapter);
    this.startSequence(this.reenter(data));
    return true;
  }

  /** La pièce sauvegardée, rechargée par `enterRoom` ; puis le point `restored` du chapitre (le pendule du chapitre 6). */
  private *reenter(data: SaveData): Sequence {
    yield* this.enterRoom(data.room.number);
    this.script.restored?.(this);
  }

  get room(): RoomState {
    const room = this.state.room;
    if (!room) throw new Error("aucune pièce chargée");
    return room;
  }

  get chapter(): number {
    return this.state.chapter;
  }

  get flags(): number[] {
    return this.state.flags;
  }

  /** Verbe ou objet du curseur (`pickedObject`). */
  get picked(): number {
    return this.state.pickedObject;
  }

  /** Fin du chapitre en cours : le suivant commence au prochain `yield` (ou à la fin de la séquence). */
  endChapter(): void {
    this.requestChapter(this.state.chapter + 1);
  }

  /** Abandonne ce qui est en cours et commence le chapitre `chapter` (`_loadedDifferentChapter`, fin de chapitre). */
  requestChapter(chapter: number): void {
    this.pendingChapter = chapter;
  }

  private readInput(): void {
    for (const input of this.host.pollInput()) {
      if (input.type === "pointer") {
        this.mouseX = input.x;
        this.mouseY = input.y;
        const left = (input.buttons & 1) !== 0;
        const right = (input.buttons & 2) !== 0;
        if (left && !this.leftDown) {
          this.leftLatch = true;
          if (this.listenForClicks) this.clickEdge = true;
        }
        // ScummVM ne réagit qu'au relâchement du bouton droit (`EVENT_RBUTTONUP`).
        if (!right && this.rightDown) this.rightClick = true;
        this.leftDown = left;
        this.rightDown = right;
      } else if (this.keys.length < KEY_BUFFER) {
        this.keys.push(input.key);
      }
    }
  }

  /** Un clic gauche a eu lieu depuis le dernier appel (seulement pendant `listenForClicks` : choix de dialogue) ; le consomme. */
  takeClick(): boolean {
    const clicked = this.clickEdge;
    this.clickEdge = false;
    return clicked;
  }

  /** Consomme la première touche du tampon (`key` : la première touche de ce nom) ; `null` s'il n'y en a pas. */
  takeKey(key?: string): string | null {
    const index = key === undefined ? 0 : this.keys.indexOf(key);
    if (index < 0 || index >= this.keys.length) return null;
    return this.keys.splice(index, 1)[0];
  }

  private switchChapter(): void {
    const chapter = this.pendingChapter!;
    this.pendingChapter = null;
    this.runner.abort();
    // `endChapter` de ScummVM : son coupé, écran vidé et noir, fondu de la musique (une séquence), musique arrêtée.
    this.subtitle = null;
    this.head = null;
    this.choices = null;
    this.listenForClicks = false;
    this.host.stopSound();
    this.gfx.endChapter();
    this.startSequence(this.musicFadeout(), () => this.openChapter(chapter));
  }

  /** Après le fondu de la musique : le chapitre suivant commence, ou le jeu se termine. */
  private openChapter(chapter: number): void {
    if (chapter > LAST_CHAPTER) {
      this.ended = true;
      this.host.exit();
      return;
    }
    this.state = createGameState(chapter);
    this.beginChapter(chapter);
  }

  private startSequence(sequence: Sequence<unknown>, then?: () => void): void {
    this.runner.start(sequence, () => {
      this.nextFrame = this.ticks + 1;
      then?.();
    });
  }

  /** Une image de `runCurrentChapter`. */
  private mainFrame(): void {
    const s = this.state;
    const hero = s.hero;
    if (!hero.moving) {
      hero.stepX = STEP_X;
      hero.stepY = STEP_Y;
    }
    if (!hero.moving && hero.walkToObject) {
      hero.track = hero.trackFinal;
      hero.walkToObject = false;
    }
    const hook = this.script.frame?.(this);
    if (hook) {
      this.startSequence(hook);
      return;
    }
    this.updateRoom();
    this.updateMusic();

    if (!s.menuScreen && s.takeObject) this.checkObjects();

    if (this.rightClick && s.menuScreen) {
      this.rightClick = false;
      s.menuScreen = false;
    }
    // Pas d'inventaire au chapitre 5 quand on tient la prise (objet 16) : correctif n° 3885 de ScummVM.
    if (this.rightClick && !s.menuScreen && !(s.chapter === 5 && s.pickedObject === 16)) {
      this.rightClick = false;
      hero.moving = false;
      if (hero.track === Track.Up) hero.track = Track.Right;
      s.menuScreen = true;
      selectVerb(s, Verb.None);
    }

    const left = this.leftDown || this.leftLatch;
    this.leftLatch = false;
    if (!left) this.leftHeld = false;
    if (left && s.menuBar) {
      selectVerb(s, verbAtBar(this.data.dat.verbBarX, this.mouseX));
    } else if (left && !this.leftHeld) {
      this.leftHeld = true;
      const click = s.takeObject ? this.verify2() : this.verify1();
      this.startSequence(this.thenWait(click), () => this.frameEnd());
      return;
    }
    this.frameEnd();
  }

  /** Fin d'une image : barre des verbes, touches. */
  private frameEnd(): void {
    const s = this.state;
    s.menuBar = this.mouseY < VERB_BAR_HEIGHT && !s.menuScreen;
    const key = this.takeKey();
    if (key !== null && key in VERB_KEYS && (!s.menuScreen || VERB_KEYS[key] === Verb.None)) selectVerb(s, VERB_KEYS[key]);
  }

  /** `delay(50)` après le traitement d'un clic. */
  private *thenWait(click: Sequence): Sequence {
    yield* click;
    yield* delay(50);
  }

  /** Relance la piste de la pièce quand elle est finie (pas de piste 0 au chapitre 2). */
  private updateMusic(): void {
    const s = this.state;
    if (this.host.musicPlaying()) return;
    if (s.chapter === 2 && s.roomMusic === 0) return;
    this.host.playMusic(s.roomMusic);
  }

  // --- Clics ------------------------------------------------------------------------------------------------------------

  /** Clic sans verbe (`verify1`) : porte, objet, ou point de la zone de marche ; dans l'inventaire, prend l'objet. */
  private *verify1(): Sequence {
    const s = this.state;
    if (s.menuScreen) {
      this.takeFromInventory();
      return;
    }
    this.doBreak = false;
    for (let l = 0; l < this.room.objects.length; l++) {
      if (this.doBreak) break;
      if (rectContains(this.room.objects[l].rect, this.mouseX, this.mouseY)) yield* this.exitRoom(l);
    }
    const hero = s.hero;
    if (this.mouseX > hero.x && this.mouseY > hero.y && this.mouseX < hero.x + hero.width && this.mouseY < hero.y + hero.height) {
      this.doBreak = true;
    }
    for (const object of this.room.objects) {
      if (!this.doBreak && rectContains(object.rect, this.mouseX, this.mouseY)) {
        hero.targetX = object.approach.x;
        hero.targetY = object.approach.y;
        hero.trackFinal = object.track;
        this.doBreak = true;
        hero.walkToObject = true;
        startWalking(hero, s.chapter, this.ticks);
      }
    }
    if (!this.doBreak) {
      const walk = this.room.walk;
      hero.targetX = Math.min(Math.max(this.mouseX, walk.x1), walk.x2);
      hero.targetY = Math.min(Math.max(this.mouseY, walk.y1 + hero.feetHeight), walk.y2);
      startWalking(hero, s.chapter, this.ticks);
    }
    this.doBreak = false;
  }

  /** Clic avec un verbe ou un objet en main (`verify2`). */
  private *verify2(): Sequence {
    const s = this.state;
    if (s.menuScreen) {
      yield* this.pickupObject();
      return;
    }
    if (s.hasName && s.textName === this.heroName) {
      yield* this.checkAction(HERO_OBJECT);
      return;
    }
    // La pièce peut changer pendant l'action : comme ScummVM, on continue sur les objets de la pièce chargée.
    for (let l = 0; l < this.room.objects.length; l++) {
      const object = this.room.objects[l];
      if (!object.visible || !rectContains(object.rect, this.mouseX, this.mouseY)) continue;
      s.hero.trackFinal = object.track;
      s.hero.walkToObject = true;
      yield* this.walkToPoint(object.approach.x, object.approach.y);
      yield* this.checkAction(object.id);
      if (s.chapter === 4) break;
    }
  }

  /** Nom du héros sous le curseur (`_textmisc[3]`, « hacker »). */
  private get heroName(): string {
    return this.data.text("textmisc", 3);
  }

  /** Inventaire ouvert, rien en main : prend l'objet de la case cliquée (`removeObject()`). */
  private takeFromInventory(): void {
    const s = this.state;
    this.updateRoom();
    const slot = inventorySlotAt(this.data.dat.itemLocations, this.mouseX, this.mouseY);
    if (slot === 0) return;
    const object = s.inventory[slot];
    s.inventory[slot] = 0;
    if (object !== 0) chooseObject(s, object);
  }

  /** Inventaire ouvert, un objet en main : le pose dans une case vide, ou l'applique à l'objet de la case (`pickupObject`). */
  private *pickupObject(): Sequence {
    const s = this.state;
    const held = s.pickedObject;
    let check = true;
    this.updateRoom();
    // Les « objets » 1 à 6 sont les verbes : ils ne se posent pas.
    if (held >= 7) {
      const slot = inventorySlotAt(this.data.dat.itemLocations, this.mouseX, this.mouseY);
      if (slot !== 0 && s.inventory[slot] === 0) {
        s.inventory[slot] = held;
        s.takeObject = false;
        check = false;
      }
    }
    if (check) {
      const slot = inventorySlotAt(this.data.dat.itemLocations, this.mouseX, this.mouseY);
      if (slot !== 0 && s.inventory[slot] !== 0) yield* this.checkAction(s.inventory[slot]);
    }
    if (!this.state.takeObject) selectVerb(this.state, Verb.None);
  }

  /** Nom de l'objet survolé avec un verbe en main (`checkObjects`) ; le héros s'appelle « hacker ». */
  private checkObjects(): void {
    const s = this.state;
    s.hasName = false;
    for (const object of this.room.objects) {
      if (object.visible && !object.isDoor && rectContains(object.rect, this.mouseX, this.mouseY)) {
        s.textName = object.name;
        s.hasName = true;
      }
    }
    const hero = s.hero;
    if (this.mouseX > hero.x + 2 && this.mouseY > hero.y + 2 && this.mouseX < hero.x + hero.width - 2 && this.mouseY < hero.y + hero.height - 2) {
      if (s.chapter === 2 || !s.hasName) {
        s.textName = this.heroName;
        s.hasName = true;
      }
    }
  }

  // --- Verbes -----------------------------------------------------------------------------------------------------------

  /**
   * Le verbe ou l'objet en main appliqué à l'objet `objectId` (`checkAction`) : `roomActions` de l'inventaire (200) ou de toutes
   * les pièces (201), partie propre au chapitre, pièce (table puis gestionnaire), puis réponse par défaut (pièce 0).
   */
  *checkAction(objectId: number): Sequence {
    const s = this.state;
    s.hero.moving = false;
    this.updateRoom();
    let answered = true;
    if (s.menuScreen && (yield* this.roomParse(INVENTORY_ROOM, objectId))) {
      // répondu
    } else if (!s.menuScreen && (yield* this.roomParse(ANY_ROOM, objectId))) {
      // répondu
    } else {
      answered = this.script.checkAction ? yield* this.script.checkAction(this, objectId) : false;
    }
    if (!answered) answered = yield* this.roomVerb(this.room.number, objectId);
    if (!answered && (this.state.hasName || this.state.menuScreen)) yield* this.roomVerb(DEFAULT_ROOM, -1);
  }

  /** `room(rN, fl)` : table de la pièce, puis son gestionnaire ; rend vrai si quelque chose a répondu. */
  *roomVerb(room: number, objectId: number): Sequence<boolean> {
    if (yield* this.roomParse(room, objectId)) return true;
    if (room === DEFAULT_ROOM) {
      // `room_0` : excuses (chapitres 2, 4, 5, 6) ; ScummVM le considère toujours comme une réponse.
      const excuse = nextExcuse(this.state);
      if (excuse !== null) yield* this.talk(excuse);
      return true;
    }
    const parser = this.script.rooms?.[room];
    return parser ? yield* parser(this, objectId) : false;
  }

  /** Réponse de `roomActions` (`roomParse`) : dit la réplique et rend vrai si une ligne répond. */
  *roomParse(room: number, objectId: number): Sequence<boolean> {
    const s = this.state;
    const action = findRoomAction(this.data.dat.roomActions, room, s.chapter, s.pickedObject, objectId);
    if (!action) return false;
    yield* this.talk(action.speechId);
    return true;
  }

  // --- Pièces -----------------------------------------------------------------------------------------------------------

  /** Charge la pièce `number` et y place le héros (`enterRoom`). */
  *enterRoom(number: number): Sequence {
    const s = this.state;
    const hero = s.hero;
    s.hasName = false;
    this.cursorVisible = true;
    const room = createRoomState(this.data.room(number, s.chapter), s.chapter);
    s.room = room;
    s.roomMusic = room.music;
    if (s.chapter === 2) applyChapter2Hero(hero, room);
    this.gfx.enterRoom(room, s.chapter);
    for (let l = 0; l < room.objects.length; l++) if (room.objects[l].door) this.updateDoor(l);
    placeHero(hero, room, s.objExit, s.chapter);
    if (s.chapter === 5) hero.visible = true;
    // Chapitre 1 : la huitième porte de la pièce est condamnée (`isDoor[7] = 0`, la sortie 104 de l'auberge).
    if (s.chapter === 1 && room.objects[7]) room.objects[7].isDoor = false;
    this.script.roomLoaded?.(this);
    if (this.loading) {
      // Partie chargée : l'état sauvegardé reprend la place de ce que `enterRoom` et `roomLoaded` viennent de recalculer.
      Object.assign(s, savedFields(this.loading));
      restoreObjects(room, this.loading.room);
      this.loading = null;
    }
    if (s.previousMusic !== s.roomMusic && s.roomMusic !== 0) this.host.playMusic(s.roomMusic);
    if (s.chapter === 2 && s.roomMusic === 0) this.host.stopMusic();
    if (this.script.roomEntered) yield* this.script.roomEntered(this);
    this.updateRoom();
  }

  /** Clic sur l'objet d'index `index` : si c'est une porte ouverte, le héros y va et passe dans la pièce suivante (`exitRoom`). */
  *exitRoom(index: number): Sequence {
    const s = this.state;
    if (this.script.canExit && !(yield* this.script.canExit(this, index))) return;
    this.updateDoor(index);
    const object: RoomObject = this.room.objects[index];
    const door = object.door;
    if (!object.isDoor || !door) return;
    if ((s.chapter === 3 || s.chapter === 5) && !object.visible) return;
    yield* this.walkToPoint(object.approach.x, object.approach.y);
    const hero = s.hero;
    if (s.chapter !== 2) {
      hero.track = object.track;
      this.updateRoom();
    }
    hero.moving = false;
    hero.track = door.direction;
    s.objExit = door.exit;
    this.doBreak = true;
    s.previousMusic = s.roomMusic;
    if (this.script.leaving && !(yield* this.script.leaving(this, index))) return;
    if (s.chapter === 5) hero.visible = true;
    hero.x = -1;
    yield* this.enterRoom(door.room);
  }

  /** `updateDoor` : seuls les chapitres 2 et 4 ont des portes qui dépendent des drapeaux (`GameScript.updateDoor`). */
  updateDoor(index: number): void {
    if (this.state.chapter !== 2 && this.state.chapter !== 4) return;
    this.script.updateDoor?.(this, index);
  }

  /** Index de l'objet `id` dans la pièce, -1 s'il n'y est pas. */
  objectIndex(id: number): number {
    return objectIndex(this.room, id);
  }

  /** Redessin de la pièce (`updateRoom`) : fait avancer le héros ; le dessin viendra avec la vague R. */
  updateRoom(): void {
    const s = this.state;
    const room = s.room;
    if (!room) return;
    // `updateRoom(); updateScreen();` : la pièce reprend l'écran à une cinématique qui écrivait l'écran « matériel » (`gfx.canvas`).
    this.gfx.owner = "room";
    if (!(s.chapter === 3 && s.flags[0] !== 0)) {
      moveCharacters(s.hero, { chapter: s.chapter, room: room.number, factors: room.factors, now: this.ticks });
    }
    if (MAP_ROOMS.has(room.number)) this.showMap();
  }

  /** Pièces 2, 10 et 45 : nom de l'objet visible survolé, portes comprises (`showMap`). */
  private showMap(): void {
    const s = this.state;
    s.hasName = false;
    for (const object of this.room.objects) {
      if (object.visible && rectContains(object.rect, this.mouseX, this.mouseY)) {
        s.textName = object.name;
        s.hasName = true;
      }
    }
  }

  /** Le héros marche jusqu'au point (pieds) `x`, `y` (`walkToPoint`). */
  *walkToPoint(x: number, y: number): Sequence {
    const s = this.state;
    const hero = s.hero;
    const cursorWasVisible = this.cursorVisible;
    this.cursorVisible = false;
    if ((s.chapter === 5 || s.chapter === 6) && !hero.visible) {
      // ScummVM place le héros invisible au point visé **précédent** (`roomX`, `roomY`), sans prendre le nouveau : reproduit.
      hero.x = hero.targetX;
      hero.y = hero.targetY;
      this.updateRoom();
      this.cursorVisible = cursorWasVisible;
      return;
    }
    hero.targetX = x;
    hero.targetY = y;
    startWalking(hero, s.chapter, this.ticks);
    for (;;) {
      this.updateRoom();
      if (!hero.moving) break;
      yield* pause(3);
    }
    if (hero.walkToObject) {
      hero.walkToObject = false;
      hero.track = hero.trackFinal;
    }
    this.updateRoom();
    this.cursorVisible = cursorWasVisible;
  }

  // --- Objets -----------------------------------------------------------------------------------------------------------

  /** Met l'objet `object` en main (`pickObject`) : c'est ainsi que le héros prend un objet de la pièce. */
  pickObject(object: number): void {
    chooseObject(this.state, object);
  }

  addObject(object: number): void {
    addObject(this.state, object);
  }

  removeObject(object: number): boolean {
    return removeObject(this.state, object);
  }

  hasObject(object: number): boolean {
    return hasObject(this.state, object);
  }

  selectVerb(verb: number): void {
    selectVerb(this.state, verb);
  }

  // --- Paroles et sons --------------------------------------------------------------------------------------------------

  /** Le héros dit la réplique `index` de `text` avec sa voix (`talk(int)`). */
  *talk(index: number): Sequence {
    yield* this.say(this.data.text("text", index), voiceFile(index));
  }

  /**
   * Le héros dit `text` avec la voix `voice` (`talk(said, filename)`) : sa tête est remplacée par un visage tiré au sort (`heroHead`).
   * Au chapitre 6, tant que le drapeau 0 est bas, c'est le héros sous le pendule (pièces 102 et 58, `talk_pen`). Dans les tours du
   * château (chapitre 5, pièce 45) la tête n'est pas dessinée et le sous-titre est en haut de l'écran.
   */
  *say(text: string, voice: string): Sequence {
    const s = this.state;
    if (s.chapter === 6 && s.flags[0] === 0 && (s.room?.number === 102 || s.room?.number === 58)) {
      yield* this.talkers.pendulum(text, voice, s.room.number === 102 ? 0 : 1);
      return;
    }
    const towers = s.chapter === 5 && s.room?.number === 45;
    yield* speak(this, {
      text,
      voice,
      x: towers ? 160 : s.hero.x,
      y: towers ? 25 : s.hero.y,
      color: this.heroTextColor(),
      view: heroHead(),
      faces: 6,
    });
    this.updateRoom();
    // Chapitre 1 : la musique de la pièce reprend après une réplique si elle s'est arrêtée.
    if (s.chapter === 1 && !this.host.musicPlaying() && s.flags[11] === 0 && !s.musicStopped) this.host.playMusic(s.roomMusic);
  }

  /** Couleur des répliques du héros (`talk`) : jaune ; au chapitre 4, la couleur courante reste hors de la pièce 24 si le drapeau 29 est levé. */
  private heroTextColor(): number | undefined {
    const s = this.state;
    if (s.chapter === 4 && s.room?.number !== 24 && s.flags[29] !== 0) return undefined;
    return TextColor.Yellow;
  }

  // --- Musique ----------------------------------------------------------------------------------------------------------

  /**
   * `MusicFadeout` : le volume de la musique baisse de 10 sur 192 (le volume ordinaire du mixeur de ScummVM) toutes les 50 ms réelles
   * jusqu'à zéro, la musique s'arrête, 100 ms plus tard le volume est remis. Sans `setMusicVolume` dans l'hôte, la musique
   * s'arrête sans fondu, mais le temps est le même. Appelée à chaque fin de chapitre et par les cinématiques de la fin.
   */
  *musicFadeout(): Sequence {
    const host = this.host;
    for (let volume = MIXER_VOLUME - FADE_STEP; ; volume -= FADE_STEP) {
      const level = Math.max(volume, 0);
      host.setMusicVolume?.(level / MIXER_VOLUME);
      if (level === 0) break;
      yield* wait(FADE_STEP_MS / TICK_MS);
    }
    host.stopMusic();
    yield* wait(FADE_END_MS / TICK_MS);
    host.setMusicVolume?.(1);
  }

  // --- Palette ----------------------------------------------------------------------------------------------------------

  /** Écran noir (`black`) : la palette du jeu n'est pas touchée, elle revient au prochain affichage. */
  black(): void {
    this.gfx.palette.black();
  }

  /** Fondu au noir (`fadeToBlack(speed)`) : 64 pas de `pause(speed)`, au moins un tick. */
  *fadeToBlack(speed: number): Sequence {
    for (let level = 63; level >= 0; level--) {
      yield* wait(Math.max(1, pauseTicks(speed)));
      this.gfx.palette.fade(level);
    }
  }

  /** Fondu depuis le noir (`fadeFromBlack(speed)`) jusqu'à la palette du jeu. */
  *fadeFromBlack(speed: number): Sequence {
    for (let level = 0; level < 64; level++) {
      yield* wait(Math.max(1, pauseTicks(speed)));
      this.gfx.palette.fade(level);
    }
  }

  playSound(name: string): boolean {
    return this.host.playSound(name);
  }

  soundActive(): boolean {
    return this.host.soundActive();
  }

  stopSound(): void {
    this.host.stopSound();
  }

  /** Effet sonore `S<n>.ALS` (`playSound(int)`). */
  playEffect(number: number): void {
    this.host.playSound(`s${number}.als`);
  }

  /** Attend la fin du son en cours (`finishSound`). */
  *finishSound(): Sequence {
    yield* delay(1);
    while (this.host.soundActive()) yield* wait(1);
  }

  // --- Chapitres --------------------------------------------------------------------------------------------------------

  private beginChapter(chapter: number): void {
    this.gfx.startChapter(chapter);
    this.rightClick = false;
    this.leftHeld = false;
    this.startSequence(this.chapterStart(chapter));
  }

  /** Cinématique appelée par le moteur (`animation_*`), si la logique du jeu la fournit. */
  *animation(name: string): Sequence {
    const play = this.script.animations?.[name];
    if (play) yield* play(this);
  }

  /**
   * Feuille du chapitre qui reste chargée après son début, dans `draw2` : `2AUX62.ALG` de l'auberge au chapitre 1 (chargée après
   * l'introduction), `AUXDR.ALG` de Drascula au chapitre 6 (chargée par `animation_1_6`). Un chargement de partie la remet aussi,
   * sans passer par l'introduction.
   */
  private chapterSheets(chapter: number): void {
    if (chapter === 1) this.gfx.loadPic("2aux62.alg", this.gfx.draw2);
    else if (chapter === 6) this.gfx.loadPic("auxdr.alg", this.gfx.draw2);
  }

  /** Début de `runCurrentChapter` (sans chargement de partie, vague S) : inventaire, drapeaux, pièce de départ. */
  private *chapterStart(chapter: number): Sequence {
    const s = this.state;
    for (let n = 1; n <= 6; n++) s.inventory[n] = n;
    if (chapter === 2) s.flags[16] = s.flags[17] = s.flags[27] = 1;
    const hero = s.hero;
    switch (chapter) {
      case 1:
        // Le téléphone (28) est en main pendant l'introduction, puis rangé par `selectVerb`.
        this.pickObject(28);
        yield* this.animation("1_1");
        this.selectVerb(Verb.None);
        this.chapterSheets(chapter);
        hero.track = Track.Right;
        s.objExit = 104;
        yield* this.enterRoom(62);
        hero.x = -20;
        hero.y = 56;
        yield* this.walkToPoint(65, 145);
        break;
      case 2:
        this.addObject(28);
        hero.track = Track.Down;
        s.objExit = 162;
        yield* this.enterRoom(14);
        break;
      case 3:
        for (const object of [28, 11, 14, 22, 9, 20, 19]) this.addObject(object);
        s.flags[1] = 1;
        hero.track = Track.Right;
        s.objExit = 99;
        yield* this.enterRoom(20);
        break;
      case 4:
        yield* this.animation("castle");
        for (const object of [28, 9, 20, 22]) this.addObject(object);
        s.objExit = 100;
        yield* this.enterRoom(21);
        hero.track = Track.Left;
        hero.x = 235;
        hero.y = 164;
        break;
      case 5:
        for (const object of [28, 7, 9, 11, 13, 14, 15, 17, 20]) this.addObject(object);
        hero.track = Track.Right;
        s.objExit = 100;
        yield* this.enterRoom(45);
        break;
      case 6:
        this.addObject(28);
        this.addObject(9);
        hero.track = Track.Right;
        s.objExit = 104;
        yield* this.enterRoom(58);
        yield* this.animation("1_6");
        break;
      default:
        throw new Error(`chapitre ${chapter} inconnu`);
    }
  }
}
