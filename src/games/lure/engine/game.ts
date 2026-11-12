/**
 * Moteur de *Lure of the Temptress* sans navigateur : boucle principale, entrées, clics, menus surgissants et commande en construction
 * (ligne d'état), « Dis à », barre de menus, changement de pièce du joueur, redémarrage. C'est aussi le contexte partagé
 * (`LureContext`) que reçoivent les autres modules.
 *
 * Source (ScummVM, GPL v3+) : `Game::execute`, `tick`, `tickCheck`, `nextFrame`, `handleClick`, `handleRightClickMenu`, `handleLeftClick`,
 * `GetTellActions`, `doAction`, `handleMenuResponse`, `playerChangeRoom`, `displayChuteAnimation`, `displayBarrelAnimation`,
 * `doShowCredits`, `doQuit`, `doRestart`, `doTextSpeed`, `doSound`, `handleBootParam`, `getYN`, `isMenuAvailable` (engines/lure/game.cpp),
 * `Dialog::show` (surface.cpp), `Events::waitForPress` (events.cpp).
 *
 * `tick()` avance d'une image de logique (80 ms, `cadence.ts`). Ce qui bloquait ScummVM (menus surgissants, barre de menus, boîtes de
 * texte, « Vous êtes sûr (o/n) ? », générique, séquences plein écran) est une **séquence** (`src/engine/sequence.ts`) : tant qu'elle
 * tourne, le monde est figé, comme dans ScummVM. Un effet bloquant demandé pendant une exécution synchrone (script, verbe, gestionnaire)
 * passe par `block` et se joue juste après (`engine.md`, § 9).
 *
 * Ordre d'un tick (= un tour de la boucle de ScummVM entre deux images) : entrées (actions, clics), changements de pièce demandés,
 * image (`nextFrame` : combat, curseur, ticks des hotspots), séquences différées, musique, horloge de la boutique.
 *
 * Écarts volontaires (détail dans `engine.md`) : un redémarrage coupe aussi les sons ; les dialogues de sauvegarde et la fin de partie
 * sont ceux du site (D5, `LureHost.openSaveDialog`, `restartOrRestore`) ; les touches de débogage (pavé numérique) ne sont pas portées ;
 * l'introduction et les séquences plein écran (chute, tonneau, capture, fin) sont celles de `sequences/` (vague Q).
 */

import { ScummvmRandom } from "../../../engine/rng";
import { type Sequence, SequenceRunner, waitUntil } from "../../../engine/sequence";
import { Action, NOONE_ID, UiString } from "../data/ids";
import type { LureData } from "../data/lure-data";
import { composeText } from "../data/strings";
import { SHOP_TICK_MS, TICK_MS } from "./cadence";
import type { LureContext } from "./context";
import { DelayList } from "./delay-list";
import { HandlerTable, type HandlerGroupTable } from "./handlers/index";
import type { LureHost, LureInput } from "./host";
import { MouseButton } from "./host";
import {
  CursorState,
  Cursor,
  Field,
  GameState,
  HotspotId,
  MAX_TELL_COMMANDS,
  MENUBAR_Y_SIZE,
  MenuItem,
  RoomNum,
  STARTUP_SCRIPT,
} from "./ids";
import {
  type EventSource,
  type MenuEvent,
  type MenuView,
  MenuBar,
  actionEntries,
  executeMenuBar,
  inventoryEntries,
  itemEntries,
  showPopup,
} from "./menu";
import { FightsManager } from "./fights/index";
import { barrelSequence, captureSequence, chuteSequence, playIntroduction, SequenceScreen } from "./sequences/index";
import type { SequencePort } from "./sequences/port";
import { MethodTable, type MethodGroupTable } from "./methods/index";
import { Room } from "./room";
import { Script } from "./script";
import { BarManager } from "./bar";
import { type Bar, type Fights, Journal, type LureSound, type Movement, SilentSound } from "./services";
import { LureMovement } from "./movement";
import { exitCoordinate } from "./exits";
import { countdownPaused } from "./paused-list";
import { ScheduleBook } from "./state";
import { registerTalkClick } from "./talk";
import { TalkState, World } from "./world";

export interface LureEngineOptions {
  data: LureData;
  host: LureHost;
  /** Graine du hasard (`--random-seed` du banc ScummVM) ; 1 par défaut. */
  seed?: number;
  sound?: LureSound;
  movement?: (ctx: LureContext) => Movement;
  bar?: (ctx: LureContext) => Bar;
  fights?: Fights;
  /** Tables de méthodes natives et de gestionnaires (tests) ; par défaut celles des groupes portés. */
  methodGroups?: readonly MethodGroupTable[];
  /** Joue l'introduction avant la partie (`LureEngine::go`) ; l'hôte du navigateur le demande, les tests non. */
  intro?: boolean;
  handlerGroups?: readonly HandlerGroupTable[];
}

/** Verbes proposés par « Dis à » (`PopupMenu::Show(0x6A07FD)`). */
const TELL_ACTIONS_MASK = 0x6a07fd;
/** Verbes sans hotspot sous le pointeur : Bois, Examine, Regarde, Statut. */
const STANDARD_ACTIONS_MASK = 0x1184000;

export class LureEngine implements LureContext {
  readonly data: LureData;
  readonly host: LureHost;
  readonly journal: Journal;
  readonly rng: ScummvmRandom;
  readonly sound: LureSound;
  readonly movement: Movement;
  readonly bar: Bar;
  readonly fights: Fights;
  readonly schedules: ScheduleBook;
  readonly world: World;
  readonly room: Room;
  readonly script: Script;
  readonly delays: DelayList;
  readonly methods: MethodTable;
  readonly handlers: HandlerTable;
  readonly menuBar: MenuBar;

  gameState = 0;
  preloadFlag = false;
  fastTextFlag = false;
  soundFlag = true;

  /** Ce que le rendu montre par-dessus la pièce : menu ouvert, boîte de texte (codes du jeu), demande de confirmation, générique. */
  menuView: MenuView | null = null;
  dialogText: string | null = null;
  /** La boîte affichée est centrée en hauteur (« Statut », `doStatus`) au lieu d'être en `INFO_DIALOG_Y`. */
  dialogCentered = false;
  confirmText: string | null = null;
  showingCredits = false;
  /** Écran des séquences plein écran (introduction, chute, tonneau, capture, fin) tant qu'une est en cours, sinon `null` (vague Q). */
  sequenceScreen: SequenceScreen | null = null;
  readonly sequences: SequencePort;

  /** Pointeur (`Mouse`). */
  readonly mouse = { x: 0, y: 0, buttons: 0 };
  /** Images de logique écoulées. */
  ticks = 0;

  private readonly runner: SequenceRunner;
  private readonly queue: Sequence<unknown>[] = [];
  private inbox: MenuEvent[] = [];
  /** Millisecondes comptées vers le prochain tic-tac de la boutique (sauvegardé par `save.ts`). */
  shopMs = 0;
  private initialRestart = true;
  private leftLoop = false;
  /** Commande « Dis à » construite (`_tellCommands`) : personnage, puis triplets action, paramètre, paramètre. */
  private tellCommands: number[] = [];
  private numTellCommands = 0;
  private readonly events: EventSource = { takeEvents: () => this.takeEvents() };

  constructor(options: LureEngineOptions) {
    this.data = options.data;
    this.host = options.host;
    this.journal = new Journal(options.host.log?.bind(options.host));
    this.rng = new ScummvmRandom(options.seed ?? 1);
    this.sound = options.sound ?? new SilentSound();
    this.fights = options.fights ?? new FightsManager(this, () => this.takeEvents());
    this.schedules = new ScheduleBook(this.data.schedules);
    this.methods = new MethodTable(this, options.methodGroups);
    this.handlers = new HandlerTable(this, options.handlerGroups);
    this.world = new World(this);
    this.room = new Room(this);
    this.room.clockMs = () => this.ticks * TICK_MS;
    this.script = new Script(this);
    this.delays = new DelayList(this);
    this.movement = options.movement ? options.movement(this) : new LureMovement(this);
    this.bar = options.bar ? options.bar(this) : new BarManager(this);
    this.menuBar = new MenuBar(this.data.uiStrings);
    const screen = new SequenceScreen(this.data.gamePalette);
    this.sequences = {
      screen,
      takeEvents: () => this.takeEvents(),
      nowMs: () => this.ticks * TICK_MS,
      exit: () => this.host.exit(),
      setActive: (active) => {
        this.sequenceScreen = active ? screen : null;
      },
    };
    this.runner = new SequenceRunner({ now: () => this.ticks, takeSkip: () => false, interrupted: () => false });
    this.gameState = GameState.RESTART;
    if (options.intro) this.block(playIntroduction(this));
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Contexte
  // ---------------------------------------------------------------------------------------------------------------------------------

  text(stringId: number, hotspotName?: string, characterName?: string): string {
    const decoded = this.data.texts.decode(stringId, this.room.roomNumber);
    if (!decoded) return "";
    return composeText(this.data.texts, decoded, { hotspotName, characterName });
  }

  block(sequence: Sequence): void {
    this.queue.push(sequence);
  }

  showDialog(stringId: number, hotspotName?: string, characterName?: string): void {
    this.showDialogText(this.text(stringId, hotspotName, characterName));
  }

  showDialogText(text: string, centered = false): void {
    this.block(this.dialogSequence(text, centered));
  }

  /** `Game::tick` : tick de chaque hotspot actif, dans l'ordre de la liste au début de l'image (un hotspot retiré entre-temps est sauté). */
  tickHotspots(): void {
    const ids: number[] = [];
    for (const h of this.world.activeHotspots) {
      if (!this.preloadFlag || (h.layer !== 0xff && h.hotspotId < HotspotId.FIRST_NONCHARACTER)) ids.push(h.hotspotId);
    }
    for (const id of ids) {
      const h = this.world.getActiveHotspot(id);
      if (!h) continue;
      this.world.fields.set(Field.CHARACTER_HOTSPOT_ID, h.hotspotId);
      h.tick();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Boucle
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Une séquence bloquante est en cours ou en attente (le monde est figé). */
  get busy(): boolean {
    return this.runner.active || this.queue.length > 0;
  }

  /** `isMenuAvailable` : sauvegarder est possible (pas de vue à distance, pas de dialogue, pas de séquence bloquante). */
  get isMenuAvailable(): boolean {
    if (this.busy) return false;
    if (this.world.fields.get(Field.OLD_ROOM_NUMBER) !== 0) return false;
    return !(this.room.cursorState === CursorState.TALKING || this.world.talkState !== TalkState.NONE);
  }

  /** Avance d'une image de logique. */
  tick(): void {
    this.ticks++;
    this.readInput(this.host.pollInput());

    if ((this.gameState & GameState.RESTART) !== 0 && !this.busy) {
      if (!this.leftLoop) this.leaveLoop();
      if (!this.busy && (this.gameState & GameState.RESTART) !== 0) this.restart();
    }

    if (this.busy) {
      this.runModal();
      this.inbox = [];
      return;
    }

    this.handleEvents();
    if (!this.busy) this.checkRoomChanges();
    if (!this.busy) {
      if (this.nextFrame()) this.delays.tick();
      this.sound.continuePlaying();
      this.shopMs += TICK_MS;
      if (this.shopMs >= SHOP_TICK_MS) {
        this.shopMs -= SHOP_TICK_MS;
        this.tickCheck();
      }
    }
    if (this.busy) this.runModal();
    this.inbox = [];
  }

  /** Traduit l'état du pointeur en événements (`EVENT_MOUSEMOVE`, `EVENT_LBUTTONDOWN`…). */
  private readInput(inputs: readonly LureInput[]): void {
    for (const input of inputs) {
      if (input.type === "action") {
        this.inbox.push({ type: "action", action: input.action });
      } else if (input.type === "actionEnd") {
        this.inbox.push({ type: "actionEnd", action: input.action });
      } else if (input.type === "wheel") {
        this.inbox.push({ type: "wheel", delta: input.delta });
      } else {
        const m = this.mouse;
        if (input.x !== m.x || input.y !== m.y) {
          m.x = input.x;
          m.y = input.y;
          this.inbox.push({ type: "move", x: m.x, y: m.y });
        }
        const changed = input.buttons ^ m.buttons;
        const pos = { x: m.x, y: m.y };
        if (changed & MouseButton.Left) this.inbox.push({ type: input.buttons & MouseButton.Left ? "lbuttondown" : "lbuttonup", ...pos });
        if (changed & MouseButton.Right) this.inbox.push({ type: input.buttons & MouseButton.Right ? "rbuttondown" : "rbuttonup", ...pos });
        m.buttons = input.buttons;
      }
    }
    this.room.mouseX = this.mouse.x;
    this.room.mouseY = this.mouse.y;
  }

  private takeEvents(): MenuEvent[] {
    const events = this.inbox;
    this.inbox = [];
    return events;
  }

  /** Lance les séquences en attente et fait avancer celle en cours. */
  private runModal(): void {
    for (;;) {
      if (this.runner.active) {
        this.runner.step();
        if (this.runner.active) return;
      }
      const next = this.queue.shift();
      if (!next) return;
      this.runner.start(next);
    }
  }

  /** Événements de la boucle principale : actions du clavier, clics. Un clic qui ouvre un menu lui laisse les événements suivants. */
  private handleEvents(): void {
    if (this.fights.isFighting) {
      // Pendant un combat, les événements sont ceux du combat (`FightsManager.checkEvents`) ; seul Échap (quitter) reste au moteur.
      if (this.inbox.some((e) => e.type === "action" && e.action === "escape")) {
        this.inbox = this.inbox.filter((e) => !(e.type === "action" && e.action === "escape"));
        this.block(this.doQuit());
      }
      return;
    }
    while (this.inbox.length > 0 && !this.busy) {
      const e = this.inbox.shift()!;
      if (e.type === "action") {
        switch (e.action) {
          case "saveGame":
            if (this.isMenuAvailable) this.host.openSaveDialog?.(true);
            break;
          case "restoreGame":
            this.host.openSaveDialog?.(false);
            break;
          case "restartGame":
            this.block(this.doRestart());
            break;
          case "escape":
            this.block(this.doQuit());
            break;
          default:
            break;
        }
      } else if (e.type === "lbuttondown" || e.type === "rbuttondown") {
        this.handleClick(e.type === "lbuttondown");
      }
    }
  }

  /** Changement de pièce demandé (vue à distance `NEW_ROOM_NUMBER`, joueur `playerNewPos`). */
  private checkRoomChanges(): void {
    const fields = this.world.fields;
    const destRoom = fields.get(Field.NEW_ROOM_NUMBER);
    if (destRoom !== 0) {
      this.room.statusLine = "";
      const remote = fields.get(Field.OLD_ROOM_NUMBER) !== 0;
      this.room.setRoomNumber(destRoom, remote);
      fields.set(Field.NEW_ROOM_NUMBER, 0);
    }
    if (fields.playerNewPos.roomNumber !== 0) this.playerChangeRoom();
  }

  /** `nextFrame` : combat, attentes des personnages (`pausedList().countdown()`), curseur, ticks. */
  private nextFrame(): boolean {
    if (this.fights.isFighting) {
      this.fights.fightLoop();
      // Le combat bloque `nextFrame` (et fait lui-même le tick de la liste des séquences différées) tant qu'il dure.
      if (this.fights.isFighting) return false;
    }
    countdownPaused(this);
    this.room.checkCursor();
    this.tickHotspots();
    return true;
  }

  /** `tickCheck` : tic-tac de l'horloge dans la boutique du village. */
  private tickCheck(): void {
    const remote = this.world.fields.get(Field.OLD_ROOM_NUMBER) !== 0;
    this.gameState |= GameState.TICK;
    if (this.room.roomNumber === RoomNum.VILLAGE_SHOP && !remote && (this.gameState & GameState.TICK) !== 0) {
      const tock = (this.gameState & GameState.TOCK) !== 0;
      this.sound.addSound(tock ? 16 : 50);
      this.gameState ^= GameState.TICK | GameState.TOCK;
    }
  }

  /** Sortie de la boucle intérieure de `Game::execute` : hotspots non persistants retirés, capture, fin de partie. */
  private leaveLoop(): void {
    this.leftLoop = true;
    if (this.initialRestart) return;
    this.room.leaveRoom();
    if ((this.gameState & GameState.CAUGHT) !== 0) this.block(captureSequence(this));
    if ((this.gameState & GameState.RESTORE) !== 0) {
      const self = this;
      this.block(
        (function* restartRestore(): Sequence {
          let restart: boolean | undefined;
          if (self.host.chooseRestartRestore) {
            self.host.chooseRestartRestore((answer) => (restart = answer));
            yield* waitUntil(() => restart !== undefined);
          } else restart = self.host.restartOrRestore?.() ?? true;
          self.gameState = restart ? GameState.RESTART : 0;
        })(),
      );
    }
  }

  /** Redémarrage (`GS_RESTART`) : remise à zéro, script de démarrage, pièce 1. */
  private restart(): void {
    this.leftLoop = false;
    this.world.reset();
    this.fights.reset();
    this.bar.reset?.();
    if (!this.initialRestart) {
      this.room.reset();
      this.sound.killSounds();
    }
    this.gameState = 0;
    this.script.execute(STARTUP_SCRIPT);
    this.room.setRoomNumber(1);
    this.initialRestart = false;
    this.room.cursor = Cursor.ARROW;
  }

  /**
   * Reprise d'une partie sauvegardée (`save.ts`) : abandonne séquences, entrées en attente et fenêtres ouvertes ; la partie n'est plus
   * au premier démarrage (`leaveLoop` traitera une fin de partie).
   */
  beginResume(): void {
    this.runner.abort();
    this.queue.length = 0;
    this.inbox = [];
    this.menuView = null;
    this.dialogText = null;
    this.dialogCentered = false;
    this.confirmText = null;
    this.showingCredits = false;
    this.tellCommands = [];
    this.numTellCommands = 0;
    this.initialRestart = false;
    this.leftLoop = false;
    this.preloadFlag = false;
  }

  /** `setState` (`killPlayer`, combats, `jailorAnimHandler`). */
  setState(state: number): void {
    this.gameState = state;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Clics
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `handleClick`. */
  private handleClick(left: boolean): void {
    const world = this.world;
    const room = this.room;
    const fields = world.fields;
    const oldRoomNumber = fields.get(Field.OLD_ROOM_NUMBER);
    if (room.checkInTalkDialog()) {
      room.setTalkDialog(0, 0, 0, 0);
    } else if (oldRoomNumber !== 0) {
      if (room.roomNumber !== 35 || fields.get(87) === 0) {
        world.requireActiveHotspot(HotspotId.PLAYER).setTickProc(3);
        fields.set(Field.NEW_ROOM_NUMBER, oldRoomNumber);
        fields.set(Field.OLD_ROOM_NUMBER, 0);
      }
    } else if (room.cursorState === CursorState.TALKING || world.talkState !== TalkState.NONE) {
      // La conversation en cours (gestionnaire de dialogue) traite le clic.
      registerTalkClick(this, left);
    } else if (this.mouse.y < MENUBAR_Y_SIZE) {
      this.block(this.menuBarSequence());
    } else if (room.cursorState === CursorState.SEQUENCE || room.cursorState === CursorState.BUMPED) {
      // Rien.
    } else if (left) {
      this.handleLeftClick();
    } else {
      this.block(this.handleRightClickMenu());
    }
  }

  /** `handleLeftClick` : regarder le hotspot, marcher vers une sortie ou un point. */
  private handleLeftClick(): void {
    const world = this.world;
    const room = this.room;
    const player = world.requireActiveHotspot(HotspotId.PLAYER);
    room.cursorState = CursorState.NONE;
    player.stopWalking();
    player.destHotspotId = 0;
    player.actionCtr = 0;
    room.statusLine = "";

    if (room.destRoomNumber === 0 && room.hotspotId !== 0) {
      const hotspot = world.requireHotspot(room.hotspotId);
      room.statusLine = `${this.data.uiStrings[Action.LOOK_AT - 1]} ${this.text(hotspot.nameId)}`;
      this.doAction(Action.LOOK_AT, room.hotspotId, 0xffff);
    } else if (room.destRoomNumber !== 0) {
      const exit = exitCoordinate(this, room.roomNumber, room.destRoomNumber);
      player.walkTo((exit.x & 0xfff8) | 5, exit.y & 0xfff8, room.hotspotId === 0 ? 0xffff : room.hotspotId);
    } else {
      player.walkTo(this.mouse.x, this.mouse.y, 0);
    }
  }

  /** `Game::doAction` : la commande devient l'action en tête de la pile du joueur, exécutée par son gestionnaire de tick. */
  doAction(action: number, hotspotId: number, usedId: number): void {
    const world = this.world;
    const fields = world.fields;
    const player = world.requireActiveHotspot(HotspotId.PLAYER);
    fields.set(Field.CHARACTER_HOTSPOT_ID, HotspotId.PLAYER);
    fields.set(Field.ACTIVE_HOTSPOT_ID, hotspotId);
    world.currentAction = action;
    this.room.cursorState = CursorState.ACTION;
    if (action === Action.TELL) {
      player.currentActions.addFrontAction(Action.NONE, player.roomNumber, 0, 0);
      const support = player.currentActions.top().support!;
      if (support.kind === "dynamic") {
        support.action = Action.TELL;
        support.params = this.tellCommands.slice(0, this.numTellCommands * 3 + 1);
      }
    } else if (action === Action.USE) {
      player.currentActions.addFrontAction(action, player.roomNumber, usedId, hotspotId);
    } else {
      player.currentActions.addFrontAction(action, player.roomNumber, hotspotId, usedId);
    }
  }

  /** `handleRightClickMenu` : verbes du hotspot sous le pointeur, puis objet ou personnage selon le verbe ; la ligne d'état suit. */
  private *handleRightClickMenu(): Sequence {
    const world = this.world;
    const room = this.room;
    const ui = this.data.uiStrings;
    const player = world.requireActiveHotspot(HotspotId.PLAYER);
    let actions = room.hotspotId !== 0 ? room.hotspotActions() : STANDARD_ACTIONS_MASK;
    if (world.numInventoryItems() === 0) actions = (actions & 0xfef3f9fd) >>> 0;
    if (world.fields.numGroats === 0) actions = (actions & 0xff7fffff) >>> 0;

    let action: number = Action.NONE;
    let hotspotId: number | null = null;
    let itemId = 0xffff;
    for (let breakFlag = false; !breakFlag; ) {
      room.statusLine = "";
      action = yield* this.popupActions(actions);
      if (action !== Action.NONE) room.statusLine = `${ui[action - 1]} `;
      switch (action) {
        case Action.LOOK:
        case Action.STATUS:
          breakFlag = true;
          break;
        case Action.ASK: {
          hotspotId = room.hotspotId;
          room.statusLine += this.text(world.requireHotspot(hotspotId).nameId) + ui[UiString.FOR];
          itemId = yield* this.popupItems(Action.GET, player.roomNumber);
          breakFlag = itemId !== 0xffff && itemId !== 0xfffe;
          break;
        }
        case Action.TELL: {
          hotspotId = room.hotspotId;
          room.statusLine += this.text(world.requireHotspot(hotspotId).nameId) + ui[UiString.TO];
          breakFlag = yield* this.getTellActions();
          break;
        }
        case Action.GIVE:
        case Action.USE:
        case Action.EXAMINE:
        case Action.DRINK: {
          const hasItems = world.numInventoryItems() !== 0;
          if (!hasItems) room.statusLine += ui[UiString.ACTION_NOTHING];
          if (hasItems) {
            if (action !== Action.DRINK) hotspotId = room.hotspotId;
            itemId = yield* this.popupInventory();
            breakFlag = itemId !== 0xffff;
            if (breakFlag) {
              world.fields.set(Field.USE_HOTSPOT_ID, itemId);
              if (action === Action.GIVE || action === Action.USE) {
                room.statusLine += this.text(world.requireHotspot(itemId).nameId) + ui[action === Action.GIVE ? UiString.TO : UiString.ON];
              } else {
                hotspotId = itemId;
              }
            }
          }
          break;
        }
        default:
          hotspotId = room.hotspotId;
          breakFlag = true;
          break;
      }
    }

    if (action === Action.NONE) {
      room.statusLine = "";
      return;
    }
    player.stopWalking();
    const hotspot = hotspotId === null || hotspotId === 0 ? null : world.hotspot(hotspotId);
    if (!hotspot) {
      this.doAction(action, 0, itemId);
      return;
    }
    if (action !== Action.TELL) {
      if (itemId !== 0xffff && action !== Action.GIVE && action !== Action.USE) {
        const item = world.hotspot(itemId);
        if (item) room.statusLine += this.text(item.nameId);
      } else {
        room.statusLine += this.text(hotspot.nameId);
      }
    }
    this.doAction(action, hotspot.hotspotId, itemId);
  }

  /** `PopupMenu::Show(actionMask)`. */
  private *popupActions(mask: number): Sequence<number> {
    const entries = actionEntries(this.data.uiStrings, mask);
    const index = yield* showPopup(this.events, entries.map((e) => e[1]), (v) => (this.menuView = v));
    return index === 0xffff ? Action.NONE : entries[index]![0];
  }

  /** `PopupMenu::ShowInventory`. */
  private *popupInventory(): Sequence<number> {
    const entries = inventoryEntries(this);
    const index = yield* showPopup(this.events, entries.map((e) => e[1]), (v) => (this.menuView = v));
    return index === 0xffff ? 0xffff : entries[index]![0];
  }

  /** `PopupMenu::ShowItems` : `0xFFFE` et « (nothing) » quand il n'y a rien à proposer. */
  private *popupItems(contextAction: number, roomNumber: number): Sequence<number> {
    const entries = itemEntries(this, contextAction, roomNumber);
    if (entries.length === 0) {
      this.room.statusLine += "(nothing)";
      return 0xfffe;
    }
    const index = yield* showPopup(this.events, entries.map((e) => e[1]), (v) => (this.menuView = v));
    return index === 0xffff ? 0xffff : entries[index]![0];
  }

  /** `GetTellActions` : jusqu'à 8 ordres (verbe, un ou deux paramètres, « et puis » / « fin ») ; faux si le joueur abandonne. */
  private *getTellActions(): Sequence<boolean> {
    const world = this.world;
    const room = this.room;
    const ui = this.data.uiStrings;
    const commands = new Array<number>(MAX_TELL_COMMANDS * 3 + 1).fill(0);
    commands[0] = room.hotspotId;
    const cmd = (n: number, i: number) => 1 + n * 3 + i;
    const positions: number[][] = Array.from({ length: MAX_TELL_COMMANDS + 1 }, () => [0, 0, 0, 0, 0]);
    const truncate = (n: number, p: number): void => {
      room.statusLine = room.statusLine.slice(0, positions[n]![p]);
    };
    const continueStrs = [ui[UiString.AND_THEN]!, ui[UiString.FINISH]!];
    const roomList: number[] = [room.roomNumber];
    let num = 0;
    let paramIndex = 0;

    while (num >= 0 && num < MAX_TELL_COMMANDS) {
      while (paramIndex >= 0 && paramIndex <= 4) {
        positions[num]![paramIndex] = room.statusLine.length;
        switch (paramIndex) {
          case 0: {
            const action = yield* this.popupActions(TELL_ACTIONS_MASK);
            if (action === Action.NONE) {
              num--;
              if (num < 0) paramIndex = -1;
              else {
                paramIndex = 3;
                truncate(num, paramIndex);
              }
              break;
            }
            room.statusLine += `${ui[action - 1]} `;
            commands[cmd(num, 0)] = action;
            commands[cmd(num, 1)] = 0;
            commands[cmd(num, 2)] = 0;
            paramIndex++;
            break;
          }
          case 1: {
            const action = commands[cmd(num, 0)]!;
            if (action !== Action.RETURN) {
              const context = action !== Action.USE && action !== Action.DRINK && action !== Action.GIVE ? action : Action.GET;
              const selection = yield* this.popupItems(context, roomList[0]!);
              if (selection === 0xffff || selection === 0xfffe) {
                paramIndex--;
                truncate(num, paramIndex);
                break;
              }
              let name: string;
              if (selection < NOONE_ID) {
                name = this.text(selection);
                roomList.unshift(selection);
              } else {
                name = this.text(world.requireHotspot(selection).nameId);
              }
              commands[cmd(num, 1)] = selection;
              room.statusLine += name;
            }
            paramIndex++;
            break;
          }
          case 2: {
            const action = commands[cmd(num, 0)]!;
            if (action === Action.ASK) room.statusLine += ui[UiString.FOR];
            else if (action === Action.GIVE) room.statusLine += ui[UiString.TO];
            else if (action === Action.USE) room.statusLine += ui[UiString.ON];
            else {
              paramIndex++;
              break;
            }
            const selection = yield* this.popupItems(Action.GET, roomList[0]!);
            if (selection === 0xfffe || selection === 0xffff) {
              paramIndex--;
              truncate(num, paramIndex);
            } else {
              room.statusLine += this.text(world.requireHotspot(selection).nameId);
              commands[cmd(num, 2)] = selection;
              paramIndex++;
            }
            break;
          }
          case 3: {
            if (num === MAX_TELL_COMMANDS - 1) {
              num++;
              paramIndex = -1;
              break;
            }
            const selection = yield* showPopup(this.events, continueStrs, (v) => (this.menuView = v));
            if (selection === 0) {
              room.statusLine += ` ${continueStrs[0]} `;
              num++;
              paramIndex = 0;
            } else if (selection === 1) {
              num += 1 + 0x100;
              paramIndex = -1;
            } else {
              const action = commands[cmd(num, 0)]!;
              if (action === Action.RETURN) paramIndex = 0;
              else if (action === Action.ASK || action === Action.GIVE || action === Action.USE) paramIndex = 2;
              else {
                paramIndex = 1;
                if (action === Action.GO_TO) roomList.shift();
              }
              truncate(num, paramIndex);
            }
            break;
          }
          default:
            break;
        }
      }
    }

    const result = num !== -1;
    if (result) {
      this.numTellCommands = num & 0xff;
      this.tellCommands = commands;
      room.statusLine = room.statusLine.slice(0, positions[0]![0]) + "..";
    }
    return result;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Barre de menus et boîtes
  // ---------------------------------------------------------------------------------------------------------------------------------

  private *menuBarSequence(): Sequence {
    const response = yield* executeMenuBar(this.menuBar, this.events, this.mouse, (v) => (this.menuView = v));
    if (response !== MenuItem.NONE) yield* this.handleMenuResponse(response);
  }

  /** `handleMenuResponse`. */
  private *handleMenuResponse(selection: number): Sequence {
    switch (selection) {
      case MenuItem.CREDITS:
        yield* this.doShowCredits();
        break;
      case MenuItem.RESTART_GAME:
        yield* this.doRestart();
        break;
      case MenuItem.SAVE_GAME:
        this.host.openSaveDialog?.(true);
        break;
      case MenuItem.RESTORE_GAME:
        this.host.openSaveDialog?.(false);
        break;
      case MenuItem.QUIT:
        yield* this.doQuit();
        break;
      case MenuItem.TEXT_SPEED:
        this.fastTextFlag = !this.fastTextFlag;
        this.menuBar.setFastText(this.fastTextFlag);
        break;
      case MenuItem.SOUND:
        this.soundFlag = !this.soundFlag;
        this.menuBar.setSound(this.soundFlag);
        if (!this.soundFlag) this.sound.killSounds();
        break;
      default:
        break;
    }
  }

  private *doShowCredits(): Sequence {
    this.sound.pause();
    this.showingCredits = true;
    try {
      yield* this.waitForPress();
    } finally {
      this.showingCredits = false;
    }
    this.room.setRoomNumber(this.room.roomNumber);
    this.sound.resume();
  }

  private *doQuit(): Sequence {
    this.sound.pause();
    const yes = yield* this.getYN();
    this.sound.resume();
    if (yes) this.host.exit();
  }

  private *doRestart(): Sequence {
    this.sound.pause();
    if (yield* this.getYN()) this.gameState = GameState.RESTART;
    this.sound.resume();
  }

  /** `getYN` : « Vous êtes sûr (o/n) ? » ; oui : touche oui ou clic gauche relâché ; non : touche non, Échap ou clic droit relâché. */
  private *getYN(): Sequence<boolean> {
    this.confirmText = this.data.uiStrings[UiString.CONFIRM_YN]!;
    try {
      for (;;) {
        let events: MenuEvent[] = [];
        yield* waitUntil(() => (events = this.takeEvents()).length > 0);
        for (const e of events) {
          if (e.type === "action" && (e.action === "yes" || e.action === "no" || e.action === "escape")) return e.action === "yes";
          if (e.type === "lbuttonup") return true;
          if (e.type === "rbuttonup") return false;
        }
      }
    } finally {
      this.confirmText = null;
    }
  }

  /** `Events::waitForPress` : une touche (action) ou un bouton de la souris. */
  private *waitForPress(): Sequence {
    yield* waitUntil(() =>
      this.takeEvents().some((e) => e.type === "action" || e.type === "lbuttondown" || e.type === "rbuttondown"),
    );
  }

  /** `Dialog::show(text)`. */
  private *dialogSequence(text: string, centered: boolean): Sequence {
    this.dialogText = text;
    this.dialogCentered = centered;
    try {
      yield* this.waitForPress();
    } finally {
      this.dialogText = null;
      this.dialogCentered = false;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Changement de pièce du joueur
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `playerChangeRoom` : séquence de la chute ou du tonneau, puis le joueur arrive dans la pièce demandée. */
  private playerChangeRoom(): void {
    const world = this.world;
    const fields = world.fields;
    const roomNum = fields.playerNewPos.roomNumber;
    fields.playerNewPos.roomNumber = 0;
    const newPos = { x: fields.playerNewPos.x, y: fields.playerNewPos.y };
    this.delays.clear();

    const roomData = world.requireRoom(roomNum);
    roomData.flags |= 0x80;

    const enter = (): void => {
      roomData.exitTime = this.ticks * TICK_MS;

      const player = world.requireActiveHotspot(HotspotId.PLAYER);
      player.currentActions.clear();
      player.roomNumber = roomNum;
      player.setPosition((newPos.x & 0xfff8) | 5, newPos.y & 0xfff8);
      player.setOccupied(true);
      this.room.setRoomNumber(roomNum, false);

      if (roomNum !== 31 && roomNum !== 14 && fields.get(74) !== 0) {
        let v = fields.get(29);
        if (v !== 0) {
          v--;
          fields.set(29, v);
          if (v === 0) this.delays.add(2, 0xcb7, false);
        }
      }
    };

    // L'animation (chute, tonneau) se joue avant d'entrer dans la pièce, qui reste celle d'avant pendant ce temps, comme dans ScummVM.
    const animFlag = fields.get(Field.ROOM_EXIT_ANIMATION);
    fields.set(Field.ROOM_EXIT_ANIMATION, 0);
    if (animFlag === 0) {
      enter();
      return;
    }
    const self = this;
    this.block(
      (function* roomExitAnimation(): Sequence {
        if (animFlag === 1) yield* self.displayChuteAnimation();
        else yield* self.displayBarrelAnimation();
        enter();
      })(),
    );
  }

  /** `displayChuteAnimation` : l'animation (`sequences/fullscreen.ts`), puis la zone du village est marquée et ses sons ambiants relancés. */
  private *displayChuteAnimation(): Sequence {
    yield* chuteSequence(this);
    this.world.fields.set(Field.AREA_FLAG, 1);
    this.sound.removeSounds();
  }

  /** `displayBarrelAnimation` : l'animation, puis les PNJ du village devenus inutiles sont retirés. */
  private *displayBarrelAnimation(): Sequence {
    yield* barrelSequence(this);
    for (const id of [HotspotId.SKORL, HotspotId.BLACKSMITH, HotspotId.GWEN, HotspotId.MALLIN, HotspotId.MONK1, HotspotId.GOEWIN, HotspotId.MONK2, HotspotId.WAYNE]) {
      this.world.deactivateHotspot(id);
    }
  }
}
