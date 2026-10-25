import { Lcg, msvcRand } from "../../../engine/rng";
import { PALETTE_BYTES, vga6ToRgb8 } from "../../../ui/indexed-canvas";
import { Sequencer } from "../audio/sequencer";
import { type CmRecord, parseCm } from "../data/commands";
import { type DictionaryEntry, parseDictionary } from "../data/dictionary";
import { type GphFont, parseGph } from "../data/font";
import { type Mix, decodeMixKey, findBank, parseMix } from "../data/mix";
import { readDefaultPalette, readRecolorTables } from "../data/palette";
import { type Scene, type SceneHotspot, readScene } from "../data/scene";
import type { SpriteFrame } from "../data/sprite";
import { type AniTable, type SpriteFamily, parseAni, parseDef } from "../data/tables";
import { MessageTable, messageId, parseAccentTable, parsePlainMessages } from "../data/text";
import { type VgaArchive, readCountedArchive, readSceneArchive } from "../data/vga-archive";
import { type DeferredEvent, OPPOSITE_EXIT } from "../data/world";
import { Compositor } from "../render/compositor";
import { applyLight, isTooDark, lightLevel } from "../render/light";
import type { Rect } from "../render/surface";
import { drawText } from "../render/text";
import { encodeCp437 } from "../../../data/cp437";
import { SpriteLibrary, animStep, currentFrame, loadObjectSprite, setFig } from "./animation";
import { type BarrierSubject, type BarrierWorld, barrierResult, checkBarrier } from "./barriers";
import { applyCadenceKey, cadenceKeyFor } from "./clock";
import { EventOp, type EventOpCode, type EventTarget } from "./events";
import {
  FAMILY,
  type BehaviorContext,
  type HandlerContext,
  type HandlerReaction,
  type HandlerTarget,
  HandlerRegistry,
  NO_TARGET,
  type ObjectHandler,
  type VerbHandler,
  defaultVerb,
  registerCoreBehaviors,
} from "./handlers";
import type { ArmaethHost, HostInput, HostKey } from "./host";
import {
  type ClickTarget,
  HERO_KEY_VECTORS,
  type InterfaceAction,
  InterfaceController,
  type InterfaceWorld,
  type KeyEvent,
  type PointerModifiers,
  type ToolCommand,
} from "./interface";
import { ICON_PAGES } from "./icons";
import {
  type InputKey,
  type InputLineState,
  createInputLine,
  finishSubmit,
  handleInputKey,
  openInputLine,
  recallInputLine,
} from "./input-line";
import { MessageQueue, existingMessageId } from "./messages";
import { type MoverBody, type MoverEnv, moveObject } from "./mover";
import {
  FOLLOW_ARRIVED,
  FOLLOW_ARRIVED_FREE,
  FOLLOW_BLOCKED,
  FOLLOW_NO_PATH,
  FOLLOW_RECOMPUTE_FAILED,
  FOLLOW_WALKING,
  type PathState,
  computePath,
  followPath,
  planClick,
} from "./paths";
import {
  type ContactResult,
  type PlaceBody,
  type PlaceEnv,
  PLACE_OK,
  PLACE_TYPE_CHANGED,
  createPlacementMemory,
  placeObject,
} from "./placement";
import {
  type ParsedCommand,
  type ResolvedObject,
  type ResolverObject,
  type ResolverWorld,
  isExecutable,
  needsRetry,
  parseCommand,
  resolveNoun,
} from "./parser";
import { type ExitResult, type MusicKey, activePlanes, completeHeroTransit, enterRoom, exitRoom, loadRoom, onFirstDisplay, planRoomLoad } from "./room";
import { loadWorldState, serializeWorld } from "./save";
import { ScriptRunner, type ScriptSet } from "./scripts";
import { type GameObject, type GameRoom, WorldState, rawU8, setRawU8 } from "./state";
import { EngineTokenHost, type TokenHostEngine } from "./token-host";
import { type TextRequest, createScriptFlags } from "./tokens";
import { DGROUP_IMAGE_OFFSET } from "./icons";
import { gameOptions } from "../game/index";
import { type BehaviorResolver, type MoverHooks, type UpdateHooks, applyDrawCommands, clearBehaviors, drawList, runFrame } from "./update";
import { TextWindows, type WindowRequest } from "./windows";
import { createTerrain, MAX_P, MAX_PLANES, MAX_X, type Footprint, type Terrain } from "./ground";

/**
 * Moteur d'*Armaeth* sans navigateur (`docs/armaeth/plan.md`, tâche G-int) : assemble les modules purs en un jeu qui avance
 * image par image. `tick()` correspond à une image VGA (70,0866 Hz, `FRAME_RATE`) ; le séquenceur musical garde sa propre horloge de 50 Hz ; l'hôte fournit fichiers, entrées, écran, sauvegardes et puce OPL2.
 *
 * Déroulement (`engine.md` § 2, § 4) : `CM1` (amorçage silencieux), `CM2` (titre, distribution, récit ; `rsv -1` charge
 * `A1FCFG.SYS`), puis la boucle principale : chargement de salle, mise à jour des objets (interface à chaque image, monde
 * tous les `délai + 1` images), événements différés, composition, lumière. Les attentes de l'original (fenêtres, `wat`,
 * ligne de saisie) sont des états modaux : le monde ne bouge pas tant qu'une fenêtre ou la ligne de saisie est ouverte.
 */

/** Préfixe de langue des fichiers (`am1 * a1f`). */
const LANGUAGE = "A1F";
/** Emplacement de sauvegarde utilisé par F2 / F3 en attendant le sélecteur d'emplacements (décision en suspens, `plan.md`). */
export const DEFAULT_SAVE_SLOT = "svg001";
/**
 * Cadence de l'original (mesurée sous DOSBox-X, `docs/armaeth/dosbox.md` § 3) : la boucle de jeu suit le retour vertical du VGA
 * (mode 13h, 70,0866 Hz), pas l'IRQ0. `tick()` joue une image à cette cadence ; le monde avance toutes les `délai + 1` images.
 */
export const FRAME_RATE = 70.0866;
/** Le pilote musical reste sur l'IRQ0 (PIT, diviseur `0x5D37`) : 50 Hz, indépendamment des images. */
export const SEQUENCER_RATE = 50;
/** Rapport 50 / 70,0866 en entiers (dix-millièmes de Hz) : le séquenceur joue un tick chaque fois que le cumul atteint `FRAME_UNITS`. */
const SEQUENCER_UNITS_PER_FRAME = SEQUENCER_RATE * 1e4;
const FRAME_UNITS = Math.round(FRAME_RATE * 1e4);
/** Tics BIOS (18,2065 Hz) par image à 70,0866 Hz : 1299 centièmes de tic BIOS par `tick()` pour 5000 par tic BIOS (18,2065 / 70,0866 = 0,25977). */
const BIOS_PER_TICK = 1299;
const BIOS_UNIT = 5000;
/** Capacité ajoutée par la file d'événements quand elle est pleine (`23a2:0002` : `capacité += 5`). */
const EVENT_QUEUE_GROWTH = 5;
/** Fenêtre de jeu par défaut quand aucune salle n'est chargée. */
const DEFAULT_WINDOW = { x: 8, y: 20, width: 304, height: 160 };
/** Ligne de saisie (`1e22:0008`) : `(38,168)`, 244 x 11. */
const INPUT_BOX: Rect = { x: 38, y: 168, width: 244, height: 11 };
const INPUT_COLORS = { frame: 0xee, inner: 0xdd, background: 0xfa };
/** Pas du clignotement du curseur de saisie, en images : 35 images = 0,5 s à 70 Hz (le pas d'origine est une boucle d'attente de 3000 tours, non mesurée). */
const CARET_BLINK = 35;
/** Indicateur `+0x43` du héros : le trajet bloqué a déjà été recalculé une fois (`2363:01ea`, remis à 0 par un clic ou `2363:0154`). */
const HERO_RETRY = 0x43;
/** Garde-fou du chargement de salle (un échec de placement du héros recharge l'ancienne). */
const MAX_ROOM_LOAD_ATTEMPTS = 8;

export interface ArmaethEngineOptions {
  /** Graine de `rand()` (`srand(time())` par défaut). */
  seed?: number;
  /** Une procédure `Fct` absente arrête le moteur (`gm_abort`) au lieu d'être ignorée. */
  strictBehaviors?: boolean;
  /**
   * Enregistrements supplémentaires (gestionnaires de verbes, d'objets, de personnages, événements) faits **après** le noyau :
   * une clé déjà enregistrée par `registerCoreBehaviors` ou par les commandes système est remplacée.
   */
  register?: (registry: HandlerRegistry) => void;
  /**
   * Résurrection (`continuer`, F4, icône 204, `2594:043a`), appelée quand la partie n'est pas terminée (`4b67 == 0`) et que le
   * héros est absent. Défaut : message `S16`. Un module de héros la remplace (ou enregistre `FAMILY.system` clé 7).
   */
  onContinue?: (ctx: BehaviorContext) => void;
  /** Filtre de types de case (`13a8:000a(type, effet, objet) == 0`) utilisé par le placement, le déplacement et les trajets. Défaut : type >= 2. */
  acceptsGround?: (type: number, effect: number, body: GameObject, ctx: BehaviorContext) => boolean;
  /** Fin d'un trajet (`FOLLOW_*` dans `result`) : remplace « arrêt + `Err 0x11` » ; `replay` rejoue la commande en attente (`2363:01ea`). */
  onPathEnd?: (obj: GameObject, ctx: BehaviorContext, result: number, replay: () => boolean) => void;
  /** Services fournis par les modules de jeu : mort (`die`) et animation à deux (`playAnimation`), appelés avec le contexte. */
  services?: EngineServices;
  /**
   * Moteur nu : aucun module de jeu n'est enregistré (registre réduit au noyau et aux commandes système). Sans cette option,
   * `gameOptions()` (`game/index.ts`) fournit gestionnaires, résurrection, sols acceptés, services et fin de trajet ; les options
   * données ici passent avant les siennes et `register` s'exécute après `registerGame`.
   */
  bare?: boolean;
}

/** Services de `BehaviorContext.die` / `playAnimation`, reçus avec le contexte qui les appelle. */
export interface EngineServices {
  die?(ctx: BehaviorContext, obj: GameObject, cause: number, cls?: string | number, number?: number): void;
  playAnimation?(ctx: BehaviorContext, obj: GameObject, id: number, partner?: GameObject | null, cls?: string | number, number?: number, ego?: number): void;
}

/** Fenêtre plein écran des messages système (`S21`, score) : `x = 0`, `y = 0`, non centrée (`327a:0044`, `centré = 0`). */
const FULL_WINDOW = { x: 0, y: 0, width: 320, height: 200 };
/** Couleurs (fond, texte, ombre) de `2401:0002` (information) et de `14cf:000c` (score), lues dans les appels. */
const INFO_COLORS = [0xef, 0xf5, 0xe9] as const;
const SCORE_COLORS = [0xed, 0xf9, 0xec] as const;
/** Panneau de contenu (`1664:0057`) : cellules 18 x 14 espacées de 4, au plus 96, haut à `y = 26`. */
const PANEL = { cellWidth: 18, cellHeight: 14, gap: 4, top: 26, maxCells: 96, maxColumns: 12, maxRows: 8, presence: 0x0b, p: 0xb8 };
/** Entrées de la table des portes `DGROUP:0694` (`217d:0088`) : 3 lignes, colonnes porte, gardien, clé, mot, salle A, salle B. */
const DOOR_TABLE = 0x694;
interface DoorRow {
  door: number;
  guardian: number;
  key: number;
  word: number;
  roomA: number;
  roomB: number;
}

/** Données du jeu lues une fois au démarrage. */
interface GameData {
  palette: Uint8Array;
  recolorType1: Uint8Array;
  font: GphFont;
  dictionary: DictionaryEntry[];
  accents: Map<string, string>;
  messages: MessageTable;
  scripts: ScriptSet;
  world: Uint8Array;
}

export class ArmaethEngine implements TokenHostEngine {
  readonly registry = new HandlerRegistry();
  readonly rng: Lcg;
  readonly compositor = new Compositor();
  readonly sequencer: Sequencer;
  readonly windows: TextWindows;
  readonly runner: ScriptRunner;
  readonly controller: InterfaceController;
  readonly sprites: SpriteLibrary;
  /** Monde courant ; `null` avant `rsv -1` (titre, distribution, récit). */
  state: WorldState | null = null;
  /** Procédures `Fct` et événements demandés mais non enregistrés (`table:Num`), pour les tâches suivantes. */
  readonly missing = new Set<string>();
  /** Nombre de bips (`3574:0072`). */
  bells = 0;
  /** Images calculées (un `tick()` = une image). */
  frames = 0;
  quitRequested = false;

  readonly messages = new MessageQueue();
  inputLine: InputLineState = createInputLine();

  private readonly data: GameData;
  private readonly sceneArchives = new Map<string, VgaArchive>();
  private readonly sceneCache = new Map<number, Scene>();
  private readonly frameScene: Scene;
  private readonly tokenHost: EngineTokenHost;
  private readonly placementMemory = createPlacementMemory();
  /** Nombre de fois où le placement libre du héros a échoué et où le tirage au hasard de repli a servi (absent de l'original : arrêt `0x101`). */
  heroPlacementFallbacks = 0;
  private readonly strict: boolean;
  private readonly mix: Mix;
  private readonly doors: DoorRow[];
  /** Couleurs du panneau de contenu (`DGROUP:0e30`, mode 13h) : cadre, filet, case, filet de case, fond. */
  private readonly panelColors: Uint8Array;
  private readonly continueHook: ((ctx: BehaviorContext) => void) | undefined;
  private readonly groundRule: ArmaethEngineOptions["acceptsGround"];
  private readonly pathEndHook: ArmaethEngineOptions["onPathEnd"];
  private readonly extraServices: EngineServices | undefined;
  private readonly ani: AniTable;
  /** Phrase mémorisée par la réaction armée (`47f92..47fa4`) et drapeau `4cc8`. */
  private pendingReaction: {
    verb: number;
    preposition: number;
    talk: boolean;
    direct: { code: number; serial: number };
    indirect: { code: number; serial: number };
    target: number;
  } | null = null;
  private reactionArmed = false;
  /** Panneau de contenu affiché cette image et le conteneur dont les objets sont posés dans la grille. */
  private panel: { rect: Rect; columns: number; rows: number } | null = null;
  private panelOwner: GameObject | null = null;
  /** Atténuation du volume maître (`DGROUP:529e`, 0 à 63) ; 0 au départ (audio.md, hypothèse 1). */
  volume = 0;

  // salle chargée
  private scene: Scene | null = null;
  private terrain: Terrain | null = null;
  private origin = { x: DEFAULT_WINDOW.x, y: DEFAULT_WINDOW.y };
  private music: MusicKey | null = null;
  private firstDisplay = false;
  private staticSignature: string | null = null;
  /** Dernière scène dessinée en plein écran par `lir` (titre, distribution). */
  private shown: number | null = null;

  // modal
  private readonly pendingWindows: WindowRequest[] = [];
  /** Actions à lancer quand toutes les fenêtres de message sont fermées (suite de `quitter` : score puis `CM4`). */
  private readonly afterWindows: (() => void)[] = [];
  private windowGate = false;
  private bios = 0;
  /** Cumul de la conversion images (70,0866 Hz) vers ticks du séquenceur (50 Hz), en `FRAME_UNITS`. */
  private sequencerPhase = 0;

  // entrées
  private readonly keys: HostKey[] = [];
  private samples: { x: number; y: number; buttons: number; ctrl: boolean }[] = [];
  private pointer = { x: 160, y: 12, buttons: 0, ctrl: false };
  private lastButtons = 0;
  private keyForcesTick = false;
  private caret = 0;

  // lumière et palette
  private lightOverride = 0;
  private lightCap: number | undefined;
  private paletteShift: readonly [number, number, number] | null = null;
  private lastLevel = Number.NaN;
  private litPalette: Uint8Array;
  private snapshotBytes: Uint8Array | null = null;
  private clickSuccesses = 0;

  constructor(
    readonly host: ArmaethHost,
    options: ArmaethEngineOptions = {},
  ) {
    const game: ArmaethEngineOptions = options.bare ? {} : gameOptions();
    this.strict = options.strictBehaviors === true;
    this.rng = new Lcg(options.seed ?? host.now() & 0xffff, msvcRand);
    const read = (name: string) => host.readFile(name);
    const exe = read("AM1.EXE");
    const archive = (family: SpriteFamily) => readCountedArchive(read(`${LANGUAGE}${family}.VGA`));
    this.sprites = new SpriteLibrary(
      { INT: archive("INT"), DEC: archive("DEC"), OBJ: archive("OBJ"), ANM: archive("ANM") },
      parseDef(read(`${LANGUAGE}DEF.SYS`)),
    );
    const script = (n: number): CmRecord[] => parseCm(read(`${LANGUAGE}CM${n}.SYS`));
    this.data = {
      palette: readDefaultPalette(exe),
      recolorType1: readRecolorTables(exe).type1,
      font: parseGph(read(`${LANGUAGE}GPH.SYS`)),
      dictionary: parseDictionary(read(`${LANGUAGE}DIC.SYS`)),
      accents: parseAccentTable(parsePlainMessages(read("MSGINT"))),
      messages: new MessageTable(read(`${LANGUAGE}TMS.SYS`), read(`${LANGUAGE}MSG.SYS`)),
      scripts: { 1: script(1), 2: script(2), 3: script(3), 4: script(4) },
      world: read(`${LANGUAGE}CFG.SYS`),
    };
    this.litPalette = vga6ToRgb8(this.data.palette);
    this.frameScene = this.scene0();
    this.mix = parseMix(read(`${LANGUAGE}MIX.SYS`));
    this.sequencer = new Sequencer(this.mix, host.opl);
    this.doors = readDoorTable(exe);
    this.panelColors = exe.slice(DGROUP_IMAGE_OFFSET + 0xe30, DGROUP_IMAGE_OFFSET + 0xe35);
    this.continueHook = options.onContinue ?? game.onContinue;
    this.groundRule = options.acceptsGround ?? game.acceptsGround;
    this.pathEndHook = options.onPathEnd ?? game.onPathEnd;
    this.extraServices = options.services ?? game.services;
    this.ani = parseAni(read(`${LANGUAGE}ANI.SYS`));
    this.windows = new TextWindows(this.compositor, this.data.font);
    registerCoreBehaviors(this.registry);
    this.registerSystemCommands();
    game.register?.(this.registry);
    options.register?.(this.registry);

    this.hooks = { sprites: this.sprites, mover: this.mover, behaviors: this.behaviors, fire: (entry) => this.fire(entry) };
    this.tokenHost = new EngineTokenHost(this);
    this.runner = new ScriptRunner(this.tokenHost, this.data.scripts, { flags: createScriptFlags() });
    this.controller = new InterfaceController(this.interfaceWorld);

    // `main` : `CM1` (étape 0), puis le récit d'introduction `CM2` (`1005:01e0`) ; la suite avance à chaque `tick()`.
    this.runner.runInit();
    this.runner.runIntro();
  }

  // --- API ----------------------------------------------------------------------------------------------------------------

  /** Une image à 70,0866 Hz : entrées, minuteries BIOS, monde, composition, séquenceur, présentation. */
  tick(): void {
    if (this.quitRequested) return;
    this.readInput();
    this.advanceBios();
    this.processKeys();
    this.fillWindows();
    this.frame();
    this.advanceSequencer();
    this.frames++;
    this.host.present({ pixels: this.compositor.screen.pixels, palette: this.litPalette });
  }

  /** Une fenêtre de message, la ligne de saisie ou une attente de script bloque le monde. */
  get modal(): boolean {
    return this.windows.active || this.pendingWindows.length > 0 || this.inputLine.open || this.runner.status === "waiting-text";
  }

  private placed(result: number): boolean {
    return result === PLACE_OK || result === PLACE_TYPE_CHANGED;
  }

  /** Salle chargée et héros : le jeu est en cours (hors titre, distribution et récit). */
  get inGame(): boolean {
    return this.state !== null && !this.runner.running;
  }

  /**
   * Phrase tapée : `gm_parse_command` puis `gm_execute_command`. Rend vrai si la phrase est prise en compte (la boîte de saisie
   * se ferme), faux si elle est vide ou invalide (la boîte reste ouverte avec la phrase). Les lignes `/jeton` vont à l'interpréteur.
   */
  submitLine(text: string): boolean {
    const parsed = parseCommand(text, this.data.dictionary, this.data.accents, this.state?.dictionaryLetters);
    if (parsed.status === "script") {
      this.runner.runCommand(parsed.normalized);
      return true;
    }
    if (needsRetry(parsed)) {
      if (parsed.status !== "empty") this.say("S", 15);
      return false;
    }
    if (!isExecutable(parsed)) {
      this.say("S", 15);
      return true;
    }
    this.execute(parsed);
    return true;
  }

  /** `gm_execute_command` (`22fc:0002`, `parser.md` § 6) : rend 7. */
  execute(parsed: ParsedCommand): number {
    const state = this.state;
    this.messages.reset();
    if (!state) return 0;
    const verbClass = Math.floor(parsed.verb / 1000);
    const verbKey = parsed.verb % 1000;
    const ctx = new PhraseContext(this.services, this);
    ctx.verb = verbKey;
    ctx.preposition = parsed.preposition;
    ctx.talk = true;

    if (verbClass === 24) {
      // commandes système : famille 4, hors héros ; le premier nombre tapé est lu dans `direct` (`dictionnaire 6`, `volume 10`)
      ctx.direct = { code: parsed.direct[0] ?? 0, object: null, held: false, inReach: false };
      this.registry.get(FAMILY.system, verbKey)?.(ctx);
      return 7;
    }
    const hero = state.hero;
    if (!hero) {
      this.say("S", state.gameOver ? 49 : 16);
      return 7;
    }
    const nameVerb = verbClass === 13;
    const verb: VerbHandler = nameVerb
      ? { policy: 0, run: this.registry.get(FAMILY.name, verbKey) ?? (() => 0) }
      : (this.registry.get(FAMILY.verb, verbKey) ?? defaultVerb);

    const world = this.resolverWorld();
    let successes = 0;
    outer: for (const indirectCode of parsed.indirect.length > 0 ? parsed.indirect : [0]) {
      const indirectObjects: ResolvedObject[] = Math.floor(indirectCode / 1000) === 15 ? resolveNoun(indirectCode, world).objects : [];
      const indirectHandler = indirectObjects.length > 0 && !nameVerb ? this.objectHandler(FAMILY.indirect, indirectCode % 1000) : undefined;
      next: for (const indirectObject of indirectObjects.length > 0 ? indirectObjects : [null]) {
        for (const directCode of parsed.direct.length > 0 ? parsed.direct : [0]) {
          const within = indirectObject?.object;
          const directObjects: ResolvedObject[] =
            Math.floor(directCode / 1000) === 15 ? resolveNoun(directCode, world, within).objects : [];
          const directHandler = directObjects.length > 0 && !nameVerb ? this.objectHandler(FAMILY.direct, directCode % 1000) : undefined;
          for (const directObject of directObjects.length > 0 ? directObjects : [null]) {
            ctx.direct = targetOf(directCode, directObject);
            ctx.indirect = targetOf(indirectCode, indirectObject);
            if (this.callHandlers(ctx, indirectHandler, directHandler, verb)) {
              successes++;
              if (verb.policy === 0) break outer;
              if (verb.policy === 2) continue next;
            }
          }
        }
      }
    }
    if (successes === 0 && this.reactionArmed) {
      // `2363:0154` : la marche vers la cible commence AVANT l'affichage de la file, et compte comme un succès
      this.startReactionWalk();
      successes++;
    }
    if (successes === 0) for (const id of this.messages.flush(0)) this.sayId(id);
    return 7;
  }

  /** Message `classe` / `numéro` dans une fenêtre qui attend un clic ou Entrée (`gm_show_message_id`). */
  say(messageClass: string | number, number: number): void {
    this.sayId(messageId(messageClass, number));
  }

  /** Sauvegarde le monde (`gm_save_world`) dans l'emplacement de l'hôte. */
  saveGame(slot = DEFAULT_SAVE_SLOT): void {
    if (this.state) this.host.storage.write(slot, serializeWorld(this.state));
  }

  /** Restaure un monde sauvegardé (`gm_load_world`) : faux si l'emplacement est vide. La salle est rechargée à l'image suivante. */
  loadGame(slot = DEFAULT_SAVE_SLOT): boolean {
    const bytes = this.host.storage.read(slot);
    if (!bytes) return false;
    this.installState(loadWorldState(bytes));
    return true;
  }

  /** `rsv -1`, F5 : recharge `A1FCFG.SYS`. */
  restartGame(): void {
    this.installState(loadWorldState(this.data.world));
  }

  /**
   * Score (F6 `S42`, découverte `S41`, abandon `S43`, couronnement `S50` ; `14cf:000c`) : UNE fenêtre plein écran (les appels de
   * `14cf:0188` s'enchaînent dans la même mise en page, les nombres sont collés au message), paginée si elle déborde. Contenu :
   * en-tête, `S25` / `S26` (secret du niveau, partie en cours seulement), score et maximum (`S27`..`S29`), fortune et menus objets
   * (`S30`..`S33`), trésors restants (`S34` / `S35`), verdict (`S36`..`S39`, ou `S51`..`S54` si la partie est terminée).
   */
  showScore(header = 42): void {
    const state = this.state;
    if (!state) return;
    this.openFullScreen(this.scoreText(state, header), SCORE_COLORS);
  }

  private scoreText(state: WorldState, header: number): string {
    const t = (n: number) => this.messageTextById(messageId("S", n)) ?? "";
    const treasure = this.treasure(state);
    const secret = state.levelFlag(state.level) !== 0;
    const complete = treasure.world === treasure.carried; // `4cb4 == 4cb8`
    let text = t(header);
    if (!state.gameOver) text += t(secret ? 25 : 26);
    text += `${t(27)}${state.score}${t(28)}${state.maxScore}${t(29)}`;
    text += `${t(30)}${treasure.carried}${t(31)}${treasure.world}${t(32)}${treasure.small}${t(33)}`;
    text += t(complete ? 35 : 34);
    const verdict = state.gameOver ? (secret ? 53 : 51) : secret ? 38 : 36;
    return text + t(verdict + (complete ? 1 : 0));
  }

  /**
   * `14ee:006c` : valeur (`Val` >= 10) et menus objets (1..9) portés par le héros, récursivement (à défaut l'acteur `Num 333`), plus le
   * gros coffre de chêne (`Num 21`) si le héros porte sa clef (`Num 22`) ; valeur de tous les objets de type 2 du monde.
   */
  private treasure(state: WorldState): { carried: number; small: number; world: number } {
    let carried = 0;
    let small = 0;
    const add = (holder: GameObject): void => {
      for (const o of holder.contents) {
        if (o.value >= 10) carried += o.value;
        else if (o.value > 0) small += o.value;
        add(o);
      }
    };
    const hero = state.hero ?? state.findByNum(333);
    if (hero) {
      add(hero);
      if (hero.contents.some((o) => o.num === 22)) {
        const chest = state.findByNum(21);
        if (chest) add(chest);
      }
    }
    const world = state.objects.reduce((sum, o) => (o.value >= 10 ? sum + o.value : sum), 0);
    return { carried, small, world };
  }

  /** `information` (24004), F1 : message `S21` plein écran (`2401:0002`). */
  showInformation(): void {
    this.openFullScreen(this.messageTextById(messageId("S", 21)) ?? "", INFO_COLORS);
  }

  /**
   * `dictionnaire n` (`23f1:000c`) : lettres significatives, -1 -> N-2, 1 -> N+2, impair -> n+1, bornes [4, 20]. Hors bornes la
   * valeur est ignorée (l'original affiche `MSGINT` 9 puis quitte pour la commande ; écart assumé). Rend vrai si elle est prise.
   */
  setDictionaryLetters(n: number): boolean {
    const state = this.state;
    if (!state) return false;
    let value = n;
    if (n === -1) value = state.dictionaryLetters - 2;
    else if (n === 1) value = state.dictionaryLetters + 2;
    else if ((n & 1) !== 0) value = n + 1;
    if (value < 4 || value > 20) return false;
    state.dictionaryLetters = value;
    return true;
  }

  /**
   * Volume maître (`2fec:0000` : réactive la musique puis ajoute `delta` à `529e`, bornes 0..63 ; `absolute` >= 0 le remplace d'abord).
   * Le sens du pas n'est pas établi (interface.md question 4) : c'est l'atténuation, comme `Sequencer.setMasterVolume`.
   */
  adjustVolume(delta: number, absolute = -1): void {
    this.sequencer.setMuted(false);
    if (absolute >= 0) this.volume = absolute;
    this.volume = Math.max(0, Math.min(63, this.volume + delta));
    this.sequencer.setMasterVolume(this.volume);
  }

  /** `continuer` (`23ee:000a`) : `S49` si la partie est terminée, sinon la résurrection (famille 4, clé 7). */
  continueGame(): void {
    if (!this.state) return;
    this.runSystem(7);
  }

  private runSystem(key: number): void {
    const ctx = new PhraseContext(this.services, this);
    ctx.verb = key;
    ctx.talk = false;
    this.registry.get(FAMILY.system, key)?.(ctx);
  }

  /** Défaut de `continuer` sans module de héros (`2594:043a`) : hors partie terminée, héros présent -> `S46` / `S47`, absent -> hook ou `S16`. */
  private defaultContinue(): number {
    const state = this.state;
    if (!state) return 0;
    if (state.gameOver) {
      this.say("S", 49);
      return 7;
    }
    const hero = state.hero ?? state.findByNum(1);
    if (hero && state.hero) {
      if (hero.room === state.loadedRoom) this.say("S", 46);
      else {
        if (hero.room) state.wantedRoom = hero.room;
        this.say("S", 47);
      }
    } else if (this.continueHook) this.continueHook(this.services);
    else this.say("S", 16);
    return 7;
  }

  /** `abandon` (`terminer`, `2404:0002`) : score `S43`, puis `CM4` quand les fenêtres sont lues. */
  private quitGame(): void {
    this.showScore(43);
    this.afterWindows.push(() => this.runner.runQuitTips());
  }

  // --- TokenHostEngine ------------------------------------------------------------------------------------------------------

  messageText(messageClass: number, id: number): string | undefined {
    return this.messageTextById(messageId(messageClass, id));
  }

  bell(): void {
    this.bells++;
  }

  openWindow(request: TextRequest): void {
    this.windowGate = this.lastButtons !== 0;
    this.windows.open(request);
  }

  advanceWindow(): boolean {
    return this.windows.advance();
  }

  closeWindow(): void {
    this.windows.close();
  }

  /** `cmd` : la phrase apparaît dans la boîte de saisie (`y = 0xA0` dans l'original, ici la boîte du jeu). */
  echoCommand(text: string): void {
    this.drawInputBox(text, false);
  }

  submitCommand(text: string): void {
    this.restoreInputBox();
    this.submitLine(text);
  }

  setTextColors(a: number, b: number, c: number): void {
    this.windows.defaultColors = [a, b, c];
  }

  /** `lir` : image de la scène en plein écran, sans changer de salle (`vga_undo_all` puis présentation). */
  drawScene(sceneId: number): void {
    this.shown = sceneId;
    this.compositor.drawScene(this.sceneOf(sceneId));
    this.compositor.undoAll();
    this.compositor.present();
    this.staticSignature = null;
  }

  saveSlot(mode: number): void {
    if (mode < 0) this.restartGame();
    else if (mode === 0) this.loadGame();
    else this.saveGame();
  }

  snapshot(op: "save" | "load"): void {
    if (op === "save") {
      if (this.state) this.snapshotBytes = serializeWorld(this.state);
    } else if (this.snapshotBytes) this.installState(loadWorldState(this.snapshotBytes));
  }

  setGate(family: number, value: number): void {
    if (family >= 0 && family < this.registry.gates.length) this.registry.gates[family] = value;
    if (this.state) clearBehaviors(this.state, family);
  }

  setLight(level: number, cap: number | undefined): void {
    this.lightOverride = level;
    this.lightCap = cap;
    this.paletteShift = null;
  }

  shiftPalette(r: number, g: number, b: number): void {
    this.paletteShift = [r, g, b];
    this.lastLevel = Number.NaN;
  }

  refreshObject(obj: GameObject): void {
    setFig(obj, this.sprites, obj.fig);
  }

  resetMotion(obj: GameObject): void {
    obj.path.defined = false;
    obj.path.remaining = -1;
    obj.path.target = null;
    obj.path.nodes = [];
    obj.speedX = 0;
    obj.speedP = 0;
  }

  /** `placer(o, mode)` (`1aba:000e`). */
  place(obj: GameObject, mode: number): number {
    if (!this.terrain) return 0;
    return placeObject(obj, mode, this.placeEnv(obj, false));
  }

  pathTo(obj: GameObject, x: number, y: number, p: number, plane: number): boolean {
    if (!this.terrain) return false;
    return computePath(this.terrain, obj, { x, y, p, plane }, obj.path, this.pathOptions(obj));
  }

  private pathOptions(obj: GameObject): { acceptsGround?: (type: number) => boolean } {
    const rule = this.groundRule;
    return rule ? { acceptsGround: (type) => rule(type, 0, obj, this.services) } : {};
  }

  /**
   * Jetons `ad*` : objet neuf du modèle `DEF` (octet 4 -> `Mob`, 5 -> `Dep`, 6 -> `Txt`, 0x18 signé -> `Lum`, `formats.md`), rangé dans
   * la salle chargée (ou voulue) pour un décor ou un objet ; les objets d'interface restent rattachés à la salle 0.
   */
  createFromDef(family: 0 | 1 | 2, id: number): GameObject | undefined {
    const state = this.state;
    const key = (["INT", "DEC", "OBJ"] as const)[family];
    const record = this.sprites.defRecord({ family: key, id });
    if (!state || !record) return undefined;
    const b = record.bytes; // octets 2 à 27 de l'enregistrement
    const obj = state.createObject({ typ: family, num: id, mob: b[2], dep: b[3], txt: b[4], light: (b[0x18 - 2] << 24) >> 24 });
    const room = state.loadedRoom ?? state.wantedRoom;
    if (family !== 0 && room) state.moveToRoom(obj, room);
    return obj;
  }

  /** `trf`, `mov` : salle voulue ; le héros est envoyé avec `Inf = 6` (placement libre). */
  sendToRoom(roomId: number, sendHero: boolean): void {
    const state = this.state;
    const room = state?.roomById(roomId);
    if (!state || !room) return;
    state.wantedRoom = room;
    if (sendHero && state.hero) state.hero.info = 6;
  }

  quit(): void {
    this.quitRequested = true;
    this.host.quit();
  }

  // --- entrées ----------------------------------------------------------------------------------------------------------------

  private readInput(): void {
    for (const input of this.host.pollInput()) {
      if (input.type === "key") this.keys.push(input.key);
      else this.onPointer(input);
    }
  }

  private onPointer(input: Extract<HostInput, { type: "pointer" }>): void {
    const sample = { x: input.x, y: input.y, buttons: input.buttons, ctrl: input.ctrl === true };
    this.pointer = sample;
    this.samples.push(sample);
    const pressed = input.buttons !== 0 && this.lastButtons === 0;
    this.lastButtons = input.buttons;
    if (input.buttons === 0) this.windowGate = false;
    if (pressed && !this.windowGate) {
      const closes = this.windows.active || this.runner.status === "waiting-text";
      this.confirmWindow({ type: "click" });
      // l'appui qui ferme une fenêtre n'est pas aussi un clic dans la salle (sinon refus du curseur, message « plus de héros »...)
      if (closes) sample.buttons = 0;
    }
  }

  /** Clic, Entrée ou Échap sur une fenêtre ouverte (`1db5:003e`). */
  private confirmWindow(event: { type: "click" } | { type: "key"; key: "enter" | "escape" | "other" }): void {
    if (this.runner.status === "waiting-text") {
      this.runner.input(event);
      return;
    }
    if (!this.windows.active) return;
    if (event.type === "key" && event.key === "other") {
      this.bell();
      return;
    }
    if (!this.windows.advance()) this.fillWindows();
  }

  private processKeys(): void {
    this.keyForcesTick = false;
    for (const key of this.keys.splice(0)) this.dispatchKey(key);
  }

  private dispatchKey(key: HostKey): void {
    if (this.windows.active || this.runner.status === "waiting-text") {
      const char = key.type === "char" ? key.char : "";
      this.confirmWindow({ type: "key", key: char === "\r" ? "enter" : char === "\x1b" ? "escape" : "other" });
      return;
    }
    if (this.inputLine.open) {
      this.onInputKey(key);
      return;
    }
    if (key.type === "delete") return;
    const actions = this.controller.key(key as KeyEvent);
    if (actions.length > 0) this.keyForcesTick = true;
    this.applyActions(actions);
  }

  private onInputKey(key: HostKey): void {
    let input: InputKey | null = null;
    if (key.type === "char") {
      if (key.char === "\r") input = { type: "enter" };
      else if (key.char === "\x1b") input = { type: "escape" };
      else if (key.char === "\b") input = { type: "backspace" };
      else if (key.char >= " ") input = { type: "char", char: key.char };
    } else if (key.type === "nav" && key.key === "insert") input = { type: "insert" };
    else if (key.type === "delete") input = { type: "delete" };
    if (!input) return;
    const step = handleInputKey(this.inputLine, input);
    this.inputLine = step.state;
    switch (step.effect.type) {
      case "bell":
        this.bell();
        break;
      case "cancel":
        this.restoreInputBox();
        break;
      case "submit": {
        this.restoreInputBox();
        const done = this.submitLine(step.effect.text);
        this.inputLine = finishSubmit(this.inputLine, done);
        break;
      }
      default:
        break;
    }
    this.keyForcesTick = true;
  }

  /** Séquenceur à 50 Hz sur des images à 70,0866 Hz : accumulateur entier, donc déterministe (au plus un tick par image). */
  private advanceSequencer(): void {
    this.sequencerPhase += SEQUENCER_UNITS_PER_FRAME;
    if (this.sequencerPhase < FRAME_UNITS) return;
    this.sequencerPhase -= FRAME_UNITS;
    this.sequencer.tick();
  }

  private advanceBios(): void {
    this.bios += BIOS_PER_TICK;
    while (this.bios >= BIOS_UNIT) {
      this.bios -= BIOS_UNIT;
      this.runner.tick();
    }
  }

  /** Ouvre la fenêtre suivante de la file quand aucune n'est ouverte. */
  private fillWindows(): void {
    if (this.windows.active || this.runner.status === "waiting-text") return;
    const request = this.pendingWindows.shift();
    if (request === undefined) {
      const next = this.afterWindows.shift();
      next?.();
      return;
    }
    this.windowGate = this.lastButtons !== 0;
    this.windows.open(request);
  }

  // --- interface --------------------------------------------------------------------------------------------------------------

  private applyActions(actions: readonly InterfaceAction[]): void {
    const state = this.state;
    for (const action of actions) {
      switch (action.type) {
        case "changePage":
          if (state) {
            state.iconPage = action.page;
            this.applyIconPage();
          }
          break;
        case "hotspotMessage":
          this.messages.push(8, "I", action.id);
          break;
        case "message":
          this.sayId(action.id);
          break;
        case "darkRoom":
          this.say("V", 41);
          break;
        case "roomButton":
          this.execute({ ...action.command, status: "ok", normalized: "" });
          break;
        case "heroKey":
          this.heroKey(action.dir);
          break;
        case "openInputLine":
          this.inputLine = action.recall ? recallInputLine(this.inputLine) : openInputLine(this.inputLine, action.char ?? "");
          break;
        case "functionKey":
          this.functionKey(action.command);
          break;
        case "scriptStep":
          // `1023:0256` : F8 ne saute que les scripts non bloquants (`cnt` nul) ; `CM1`..`CM4` tournent en `cnt 7` dans l'original,
          // où le clavier n'est pas lu (screens.md E6) : pas de « saut d'introduction » involontaire.
          if (this.runner.flags.cnt === 0) this.runner.input({ type: "skip" });
          break;
        case "system":
          this.systemCommand(action);
          break;
        case "bell":
          this.bell();
          break;
        default:
          break;
      }
    }
  }

  private heroKey(dir: string): void {
    const hero = this.state?.hero;
    if (!hero) return;
    const vector = HERO_KEY_VECTORS[dir as keyof typeof HERO_KEY_VECTORS];
    const wasX = hero.speedX;
    const wasP = hero.speedP;
    const wasY = hero.speedY;
    this.resetMotion(hero);
    this.state!.selected = null;
    if (vector) {
      // rappuyer sur la direction courante arrête le héros
      if (wasX !== vector[0] || wasP !== vector[1]) {
        hero.speedX = vector[0];
        hero.speedP = vector[1];
      }
    } else {
      const v = dir === "climb" ? -1 : 1;
      hero.speedY = wasY === v ? 0 : v;
    }
  }

  private functionKey(command: string): void {
    switch (command) {
      case "help":
        this.showInformation();
        break;
      case "save":
        this.saveGame();
        break;
      case "restore":
        this.loadGame();
        break;
      case "restart":
        this.restartGame();
        break;
      case "score":
        this.showScore();
        break;
      case "inventory":
        this.execute({ status: "ok", normalized: "", verb: 22017, preposition: 0, direct: [], indirect: [] });
        break;
      case "continue":
        this.continueGame();
        break;
      default: // touches de débogage F7 / F8 hors script : écrivent le registre CRTC (sans objet)
        break;
    }
  }

  private systemCommand(action: Extract<InterfaceAction, { type: "system" }>): void {
    const state = this.state;
    switch (action.command) {
      case "save":
        this.saveGame();
        break;
      case "restore":
        this.loadGame();
        break;
      case "restart":
        this.restartGame();
        break;
      case "score":
        this.showScore();
        break;
      case "quit":
        this.quitGame();
        break;
      case "music":
        this.sequencer.setMuted(!this.sequencer.isMuted);
        break;
      case "volume":
        this.adjustVolume(action.delta ?? 0);
        break;
      case "speed":
        if (state) applyCadenceKey(state.cadence, (action.delta ?? 0) > 0 ? "slower" : "faster");
        break;
      case "pause":
        if (state) {
          const toggle = action.mode === "toggle" ? (state.cadence.pause === 0 ? "pause" : "resume") : action.mode === "step" ? "pause" : "resume";
          applyCadenceKey(state.cadence, cadenceKeyFor(toggle === "pause" ? "p" : "n")!);
        }
        break;
      case "continue":
        this.continueGame();
        break;
    }
  }

  /** Cibles de clic des listes 1 (objets), 2 (inventaire), 3 (panneau, à brancher) et 4 (décors) de `1564:0004`. */
  private clickTargets(list: 1 | 2 | 3 | 4): ClickTarget[] {
    const state = this.state;
    const room = state?.loadedRoom;
    if (!state || !room) return [];
    const make = (obj: GameObject, kind: "object" | "decor", relative: boolean): ClickTarget => ({
      kind,
      num: obj.num,
      serial: obj.serial,
      x: obj.x + (relative ? this.origin.x : 0),
      y: obj.y + (relative ? this.origin.y : 0),
      width: obj.width,
      height: obj.height,
    });
    switch (list) {
      case 1:
        return room.listA.filter((o) => o !== state.hero && o.presence !== 0 && this.isVisible(o)).map((o) => make(o, "object", true));
      case 2:
        return (state.hero?.contents ?? []).filter((o) => o.presence === 8).map((o) => make(o, "object", false));
      case 3:
        return this.panelObjects().map((o) => make(o, "object", false));
      case 4:
        return room.listB.filter((o) => o.presence !== 0 && this.isVisible(o)).map((o) => make(o, "decor", true));
    }
  }

  private readonly interfaceWorld: InterfaceWorld = (() => {
    const engine = this;
    return {
      get scriptRunning() {
        return engine.runner.running;
      },
      get heroPresent() {
        return engine.state?.hero != null;
      },
      get heroDead() {
        return engine.state?.gameOver ?? false;
      },
      get moveEnabled() {
        return engine.runner.flags.heroControl && (engine.state?.moveEnabled ?? false);
      },
      get debugEnabled() {
        return engine.runner.flags.dgs > 10;
      },
      get inputLineOpen() {
        return engine.inputLine.open;
      },
      get dark() {
        return engine.state?.darkRoom ?? false;
      },
      get scene() {
        const s = engine.scene?.header;
        return s ? { x0: s.x, y0: s.y, width: s.width, height: s.height } : { x0: DEFAULT_WINDOW.x, y0: DEFAULT_WINDOW.y, width: DEFAULT_WINDOW.width, height: DEFAULT_WINDOW.height };
      },
      get hotspots(): readonly SceneHotspot[] {
        return engine.scene?.hotspots ?? [];
      },
      get selected() {
        const obj = engine.state?.selected;
        return obj ? engine.targetOf(obj) : null;
      },
      targets: (list) => engine.clickTargets(list),
      pendingMessages: () => engine.messages.length,
      execute: (command) => engine.runClick(command),
      walk: (x, y) => engine.walkHero(x, y),
      exit: (sector) => engine.exitBySector(sector),
    } satisfies InterfaceWorld;
  })();

  /** Cible de clic d'un objet de la salle ou de l'inventaire (coordonnées d'écran). */
  private targetOf(obj: GameObject): ClickTarget {
    const relative = obj.holder === null;
    return {
      kind: "object",
      num: obj.num,
      serial: obj.serial,
      x: obj.x + (relative ? this.origin.x : 0),
      y: obj.y + (relative ? this.origin.y : 0),
      width: obj.width,
      height: obj.height,
    };
  }

  /** Contenu affiché du conteneur sélectionné (`4c12`) : les 96 premiers objets, en grille (`1664:0057`). */
  private panelObjects(): GameObject[] {
    const selected = this.state?.selected;
    if (!selected || selected === this.state?.hero) return [];
    return selected.contents.slice(0, PANEL.maxCells).filter((o) => o.presence === PANEL.presence);
  }

  /**
   * `1664:0057` : grille de cellules 18 x 14 (+ 4) du contenu de l'objet sélectionné : `lignes = ceil(n / 12)` (au plus 8),
   * `colonnes = ceil(n / lignes)` (au plus 12), centrée, haut à `y = 26` ; objet au centre de sa cellule, pied 3 pixels au-dessus
   * du bas, `P = 0xB8`, `Xyp = 11` ; au-delà des cellules `Xyp = 0`. Un conteneur vide est désélectionné (`1664:0004(0, 0)`).
   * Rend la géométrie du panneau, ou `null`.
   */
  private layoutPanel(): { rect: Rect; columns: number; rows: number } | null {
    const state = this.state;
    const selected = state?.selected ?? null;
    if (this.panelOwner && this.panelOwner !== selected) {
      for (const o of this.panelOwner.contents) o.presence = 0;
      this.panelOwner = null;
    }
    if (!state || !selected || selected === state.hero) return null;
    this.panelOwner = selected;
    const count = Math.min(selected.contents.length, PANEL.maxCells);
    if (count === 0) {
      state.selected = null;
      return null;
    }
    const rows = Math.min(PANEL.maxRows, Math.floor((count + 11) / 12));
    const columns = Math.min(PANEL.maxColumns, Math.floor((count + rows - 1) / rows));
    const pitchX = PANEL.cellWidth + PANEL.gap;
    const pitchY = PANEL.cellHeight + PANEL.gap;
    const width = pitchX * columns + 4;
    const rect = { x: (320 - width) >> 1, y: PANEL.top, width, height: pitchY * rows + 4 };
    selected.contents.forEach((obj, k) => {
      if (k >= rows * columns) {
        obj.presence = 0;
        return;
      }
      const x0 = pitchX * (k % columns) + rect.x + 2;
      const y0 = pitchY * Math.floor(k / columns) + rect.y + 2;
      obj.presence = PANEL.presence;
      obj.x = (2 * x0 + pitchX - 1) >> 1;
      obj.y = y0 + pitchY - 1 - 3;
      obj.p = PANEL.p;
      if (obj.anim.frame < 0) loadObjectSprite(obj, this.sprites);
    });
    return { rect, columns, rows };
  }

  private drawPanel(panel: { rect: Rect; columns: number; rows: number }): void {
    const [outer, inner, cellOuter, cellInner, fill] = this.panelColors;
    const c = this.compositor;
    const { rect } = panel;
    c.drawFrameRect({ x: rect.x + 2, y: rect.y + 2, width: rect.width - 3, height: rect.height - 3 }, fill, fill);
    c.drawFrameRect(rect, outer, null);
    c.drawFrameRect({ x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 }, inner, null);
    const pitchX = PANEL.cellWidth + PANEL.gap;
    const pitchY = PANEL.cellHeight + PANEL.gap;
    for (let r = 0; r < panel.rows; r++) {
      for (let col = 0; col < panel.columns; col++) {
        const cell = { x: rect.x + 2 + pitchX * col, y: rect.y + 2 + pitchY * r, width: pitchX, height: pitchY };
        c.drawFrameRect(cell, cellOuter, null);
        c.drawFrameRect({ x: cell.x + 1, y: cell.y + 1, width: cell.width - 2, height: cell.height - 2 }, cellInner, null);
      }
    }
  }

  /**
   * `1504:0274` puis `228e:0000` (bouton droit des bottes) : le secteur donne l'emplacement de sortie (`4b94` = identité), la salle
   * voisine son identifiant ; le héros marche vers une sortie menant à cette salle. Vrai si la salle a une sortie à cet emplacement.
   */
  private exitBySector(sector: number): boolean {
    const state = this.state;
    const hero = state?.hero;
    const room = state?.loadedRoom;
    if (!state || !hero || !room) return false;
    const target = state.neighbour(room, sector);
    if (!target) return false;
    state.selected = null;
    this.walkToExit(hero, target.id, false);
    return true;
  }

  /**
   * `228e:0000(obj, salle, barrages)` : choisit au hasard (`rand() % n`) une sortie de la salle de l'objet parmi les emplacements
   * 5 à 0 qui existent, mènent à la salle d'identifiant `roomId` (-1 = toutes ; un multiple de 100 = même centaine) et, si
   * `respectBarriers`, ne sont pas barrés (`1414:0006` mode 0). Salle chargée : trajet vers un point à ±1000 au-delà du bord
   * correspondant (côté permuté par `4b88`) ; sinon sortie immédiate (`Inf` puis `186d:000c`). Vrai (7) si une sortie convient.
   */
  walkToExit(obj: GameObject, roomId: number, respectBarriers: boolean): boolean {
    const state = this.state;
    const room = obj.room;
    if (!state || obj.location !== 1 || !room) return false;
    const loaded = room === state.loadedRoom && this.terrain !== null;
    const candidates: number[] = [];
    for (let slot = 5; slot >= 0; slot--) {
      const dest = state.neighbour(room, slot);
      if (!dest) continue;
      const wanted =
        roomId === -1 || dest.id === roomId || (roomId % 100 === 0 && Math.trunc(dest.id / 100) === Math.trunc(roomId / 100));
      if (!wanted) continue;
      const code = room.barriers[slot] ?? 0;
      if (respectBarriers && code !== 0 && this.barrier(code, 0, obj) !== 0) continue;
      candidates.push(slot);
    }
    obj.path.defined = false;
    const limits = this.terrain?.limits;
    while (candidates.length > 0) {
      const pick = this.rng.mod(candidates.length);
      const slot = candidates[pick]!;
      const side = loaded ? this.terrain!.permutation[slot]! : slot;
      let x = 1000;
      let p = 1000;
      const halfX = loaded && limits ? (limits.xMax - limits.xMin) >> 1 : 160;
      const halfP = loaded && limits ? (limits.pMax - limits.pMin) >> 1 : 128;
      const halfY = loaded && limits ? (limits.yMax - limits.yMin) >> 1 : 100;
      let metric: 1 | 2 = 2;
      let ok = true;
      switch (side) {
        case 0:
          p = -1000;
          x = halfX;
          break;
        case 2:
          x = halfX;
          break;
        case 1:
          p = halfP;
          metric = 1;
          break;
        case 3:
          x = -1000;
          p = halfP;
          metric = 1;
          break;
        default:
          ok = false;
          if (!loaded) {
            obj.info = slot;
            this.exitObject(obj);
            return true;
          }
      }
      if (ok) {
        const target = { x, y: halfY, p, plane: 0 };
        if (!loaded) {
          obj.path.target = target;
          obj.path.defined = true;
          return true;
        }
        if (computePath(this.terrain!, obj, target, obj.path, { metric, ...this.pathOptions(obj) })) {
          obj.path.defined = true;
          return true;
        }
      }
      candidates[pick] = candidates[candidates.length - 1]!;
      candidates.pop();
    }
    obj.path.defined = false;
    return false;
  }

  /** `2210:0008` : une commande de clic, sans analyse ni boucle sur les candidats. */
  private runClick(command: ToolCommand): { success: boolean; continueList: boolean } {
    const state = this.state;
    if (!state) return { success: false, continueList: false };
    const ctx = new PhraseContext(this.services, this);
    ctx.verb = command.verb % 1000;
    ctx.preposition = command.preposition;
    ctx.talk = false;
    const clicked = (t: ClickTarget | null, code: number | undefined): HandlerTarget => {
      if (!t) return NO_TARGET;
      const object = t.kind === "object" ? (state.findBySerial(t.serial) ?? null) : null;
      return { code: code ?? 0, object, held: object?.holder === state.hero, inReach: object ? this.inReach(object) : false };
    };
    ctx.direct = clicked(command.directTarget, command.direct[0]);
    ctx.indirect = clicked(command.indirectTarget, command.indirect[0]);
    const verb = this.registry.get(FAMILY.verb, ctx.verb) ?? defaultVerb;
    const indirectHandler = ctx.indirect.object ? this.objectHandler(FAMILY.indirect, ctx.indirect.object.num) : undefined;
    const directHandler = ctx.direct.object ? this.objectHandler(FAMILY.direct, ctx.direct.object.num) : undefined;
    let success = this.callHandlers(ctx, indirectHandler, directHandler, verb);
    if (!success && this.reactionArmed) {
      this.startReactionWalk();
      success = true;
    }
    if (success) this.clickSuccesses++;
    return { success, continueList: (verb.policy & 1) === 1 };
  }

  /** Clic gauche des bottes (`1504:0002`) : le héros s'arrête, une destination valide et un trajet sont calculés. */
  private walkHero(x: number, y: number): boolean {
    const state = this.state;
    const hero = state?.hero;
    if (!state || !hero || !this.terrain) return false;
    this.resetMotion(hero);
    state.selected = null;
    if (hero.num === 1) setRawU8(hero, HERO_RETRY, 0);
    // le héros n'est pas déplacé : `clickDestination` cherche la position sur une copie (`1504:0002` le replace provisoirement)
    const ok = planClick(hero, x, y, this.placeEnv(hero, false), hero.path);
    hero.err = 0;
    return ok;
  }

  // --- gestionnaires ------------------------------------------------------------------------------------------------------------

  /** Gestionnaire d'objet de la famille 1 ou 5 : porte fermée = succès silencieux (défaut `MOV AX,7`). */
  private objectHandler(family: 1 | 5, key: number): ObjectHandler | undefined {
    if (!this.registry.isOpen(family, key)) return () => 7;
    return this.registry.get(family, key);
  }

  /** Indirect, direct puis verbe (`22fc:04f2..05e0`) ; le verbe peut être désactivé par un refus d'objet (`22fc:065b`). */
  private callHandlers(ctx: PhraseContext, indirect: ObjectHandler | undefined, direct: ObjectHandler | undefined, verb: VerbHandler): boolean {
    ctx.verbDisabled = false;
    if (indirect && indirect(ctx) !== 0) return true;
    if (direct && direct(ctx) !== 0) return true;
    return !ctx.verbDisabled && verb.run(ctx) !== 0;
  }

  private registerSystemCommands(): void {
    const r = this.registry;
    r.register(FAMILY.system, 1, () => (this.saveGame(), 7));
    r.register(FAMILY.system, 2, () => (this.loadGame(), 7));
    r.register(FAMILY.system, 3, () => (this.quitGame(), 7));
    r.register(FAMILY.system, 4, () => (this.showInformation(), 7));
    r.register(FAMILY.system, 6, (ctx) => (this.setDictionaryLetters(ctx.direct.code), 7));
    r.register(FAMILY.system, 7, () => this.defaultContinue());
    r.register(FAMILY.system, 8, () => (this.restartGame(), 7));
    r.register(FAMILY.system, 9, () => (this.showScore(), 7));
    r.register(FAMILY.system, 11, () => (this.sequencer.setMuted(!this.sequencer.isMuted), 7));
    // `volume n` (`23eb:0008`, hypothèse) : le nombre tapé est le nouveau réglage
    r.register(FAMILY.system, 12, (ctx) => (this.adjustVolume(0, ctx.direct.code > 0 && ctx.direct.code < 64 ? ctx.direct.code : -1), 7));
  }

  /** Services communs aux gestionnaires de phrase, procédures d'objet et événements. */
  private readonly services: BehaviorContext = (() => {
    const engine = this;
    return {
      get state(): WorldState {
        if (!engine.state) throw new Error("Aucun monde chargé");
        return engine.state;
      },
      get hero() {
        return engine.state?.hero ?? null;
      },
      get room() {
        return engine.state?.loadedRoom ?? null;
      },
      messages: {
        enqueue: (priority, cls, number) => engine.messages.push(priority, cls, number),
        say: (cls, number) => engine.say(cls, number),
        listObjects: (objects, empty, header, lines) => engine.listObjects(objects, empty, header, lines),
      },
      refreshObject: (obj) => engine.refreshObject(obj),
      get die() {
        const service = engine.extraServices?.die;
        const self = this as unknown as BehaviorContext;
        return service ? (...args: Parameters<NonNullable<BehaviorContext["die"]>>) => service(self, ...args) : undefined;
      },
      get playAnimation() {
        const service = engine.extraServices?.playAnimation;
        const self = this as unknown as BehaviorContext;
        return service ? (...args: Parameters<NonNullable<BehaviorContext["playAnimation"]>>) => service(self, ...args) : undefined;
      },
      scene: {
        decorIndex: (code) => engine.scene?.hotspots.findIndex((h) => h.messageId === code) ?? -1,
        hasMessage: (cls, number) => engine.data.messages.has(messageId(cls, number)),
      },
      get sprites() {
        return engine.sprites;
      },
      get ani() {
        return engine.ani;
      },
      sound: {
        play: (id, cls, number, loop = false) => engine.sequencer.play(id, cls, number, { loop }),
        effect: (cls, number, priority, loop = false) => engine.sequencer.selectTrack(cls, number, priority, loop),
        stop: () => engine.sequencer.stop(),
        stopEffect: (cls, num) => engine.sequencer.stopEffect(cls, num),
        selectTrack: (cls, number, priority, loop = false) => engine.sequencer.selectTrack(cls, number, priority, loop),
      },
      events: { operate: (target, event, op, value, procedure) => engine.operateEvent(target, event, op, value, procedure) },
      score: {
        award: (chapter, index) => {
          const award = engine.state?.addScore(chapter * 100 + index) ?? null;
          if (award && award.sound > 0) engine.playJingle(award.sound);
          return award;
        },
      },
      rooms: {
        want: (room: GameRoom) => void (engine.state!.wantedRoom = room),
        exit: (obj: GameObject) => engine.exitObject(obj),
        limits: () => (engine.terrain ? { xMax: engine.terrain.limits.xMax, pMax: engine.terrain.limits.pMax } : null),
        planes: () => engine.terrain?.planes ?? 1,
        refreshPlanes: () => engine.refreshPlanes(),
      },
      motion: {
        reset: (obj) => engine.resetMotion(obj),
        place: (obj, mode) => engine.place(obj, mode),
        followPath: (obj) => engine.followHeroPath(obj),
        pathTo: (obj, x, y, p, plane) => engine.pathTo(obj, x, y, p, plane),
        pathEnd: (obj, result) => engine.pathEnd(obj, result),
      },
      get rng() {
        return engine.rng;
      },
      set rng(_ignored: Lcg) {
        // lecture seule : l'ancien contournement `services.rng = ...` reste sans effet
      },
    } satisfies BehaviorContext;
  })();

  /**
   * Jingle d'une entrée de score (`2f86:009e`) : la banque d'identifiant `id` donne sa clé, d'où classe et numéro, puis
   * `gm_sound_play(id, classe, numéro)`. Rend faux si la banque ou sa clé manque.
   */
  playJingle(id: number): boolean {
    const bank = findBank(this.mix, id);
    const key = bank ? decodeMixKey(bank.key) : undefined;
    return key ? this.sequencer.play(id, key.cls, key.num) : false;
  }

  /**
   * Fin de trajet du héros (`2363:01ea(héros, r)`) : 1, 2 et 4 rejouent la commande en attente ; 5 (bloqué) recalcule le trajet une
   * fois (`+0x43`, remis à 0 à chaque clic) puis, au deuxième blocage, affiche `G44` ; tous les autres codes abandonnent la commande.
   * Sauf recalcul réussi (rend vrai : la marche continue), l'objet s'arrête avec `Err 0x11`. Le hook du jeu (`onPathEnd`) remplace
   * tout cela.
   */
  private pathEnd(obj: GameObject, result: number): boolean {
    if (this.pathEndHook) {
      this.pathEndHook(obj, this.services, result, () => this.replayReaction());
      return false;
    }
    if (obj !== this.state?.hero) {
      this.resetMotion(obj);
      obj.err = 0x11;
      return false;
    }
    if (result === FOLLOW_WALKING) return false;
    if (result === FOLLOW_ARRIVED_FREE || result === FOLLOW_ARRIVED || result === FOLLOW_RECOMPUTE_FAILED) this.replayReaction();
    else if (result === FOLLOW_BLOCKED) {
      if (rawU8(obj, HERO_RETRY) === 0) {
        setRawU8(obj, HERO_RETRY, 7);
        if (obj.path.target && computePath(this.terrain!, obj, obj.path.target, obj.path, { resume: true, ...this.pathOptions(obj) })) {
          obj.err = 0;
          return true;
        }
      }
      this.say("G", 44);
    }
    this.pendingReaction = null; // `2363:03e4`
    this.reactionArmed = false;
    this.resetMotion(obj);
    obj.err = 0x11;
    return false;
  }

  /** `2363:000c` : arme la réaction si le gestionnaire de la famille 9 de clé `Num` du héros répond vrai. */
  armReaction(ctx: HandlerContext, target: GameObject | null): boolean {
    const hero = this.state?.hero;
    if (!hero) return false;
    const handler = this.registry.resolve(FAMILY.reaction, hero.num);
    if (!handler || !handler(hero, ctx)) return false;
    this.pendingReaction = {
      verb: ctx.verb,
      preposition: ctx.preposition,
      talk: ctx.talk,
      direct: { code: ctx.direct.code, serial: ctx.direct.object?.serial ?? 0 },
      indirect: { code: ctx.indirect.code, serial: ctx.indirect.object?.serial ?? 0 },
      target: target?.serial ?? 0,
    };
    this.reactionArmed = true;
    return true;
  }

  /** `2363:0154` : le héros marche vers la cible mémorisée ; en cas d'échec la phrase est oubliée. */
  private startReactionWalk(): void {
    this.reactionArmed = false;
    const plan = this.pendingReaction;
    const hero = this.state?.hero;
    const target = plan && plan.target !== 0 ? this.state?.findBySerial(plan.target) : undefined;
    if (!plan || !hero || !target || !this.pathTo(hero, target.x, target.y, target.p, target.plane)) this.pendingReaction = null;
    else setRawU8(hero, HERO_RETRY, 0);
  }

  /** `2363:01ea` : rejoue la phrase mémorisée. Vrai si une commande était en attente. */
  replayReaction(): boolean {
    const plan = this.pendingReaction;
    const state = this.state;
    if (!plan || !state) return false;
    this.pendingReaction = null;
    this.reactionArmed = false;
    this.messages.reset();
    const ctx = new PhraseContext(this.services, this);
    ctx.verb = plan.verb;
    ctx.preposition = plan.preposition;
    ctx.talk = plan.talk;
    const resolve = (r: { code: number; serial: number }): HandlerTarget => {
      const object = r.serial !== 0 ? (state.findBySerial(r.serial) ?? null) : null;
      return { code: r.code, object, held: object?.holder === state.hero, inReach: object ? this.inReach(object) : false };
    };
    ctx.direct = resolve(plan.direct);
    ctx.indirect = resolve(plan.indirect);
    const verb = this.registry.get(FAMILY.verb, plan.verb) ?? defaultVerb;
    const indirect = ctx.indirect.object ? this.objectHandler(FAMILY.indirect, ctx.indirect.object.num) : undefined;
    const direct = ctx.direct.object ? this.objectHandler(FAMILY.direct, ctx.direct.object.num) : undefined;
    if (!this.callHandlers(ctx, indirect, direct, verb)) for (const id of this.messages.flush(0)) this.sayId(id);
    return true;
  }

  get hasReactionArmed(): boolean {
    return this.reactionArmed;
  }

  /** `21ad:000a` : voir `HandlerMessages.listObjects`. */
  listObjects(objects: readonly GameObject[], empty: number, header: number, lines: boolean): void {
    const hero = this.state?.hero;
    const visible = objects.filter((o) => o.hidden === 0 && o !== hero);
    if (visible.length === 0) {
      this.say("V", empty);
      return;
    }
    const names = visible.map((o) => this.messageTextById(messageId("O", o.num)) ?? "");
    const head = this.messageTextById(messageId("V", header)) ?? "";
    this.openText(lines ? [head, ...names].join("■") : `${head}${names.join(", ")}`);
  }

  /** `23a2:0002` : la file grandit de 5 entrées quand elle est pleine (la capacité de `CFG` est 0). */
  private operateEvent(target: EventTarget, event: number, op: EventOpCode, value = 0, procedure = 0): number | undefined {
    const queue = this.state?.events;
    if (!queue) return undefined;
    this.growEvents(op !== EventOp.Remove && op !== EventOp.Subtract && op !== EventOp.Other && !queue.find(target, event));
    return queue.operate(target, event, op, value, procedure);
  }

  private growEvents(creating: boolean): void {
    const queue = this.state?.events;
    if (queue && creating && queue.capacity <= queue.size) queue.capacity += EVENT_QUEUE_GROWTH;
  }

  private exitObject(obj: GameObject): ExitResult {
    const state = this.state!;
    const slot = obj.info;
    const result = exitRoom(state, obj, (o, code) => this.barrier(code, 2, o) !== 0);
    if (result === "moved") this.arrive(obj, slot);
    return result;
  }

  private followHeroPath(obj: GameObject): number {
    if (!this.terrain) return FOLLOW_WALKING;
    const path = obj.path;
    // chargement d'une sauvegarde : les nœuds (`Chm`) ne sont pas dans le fichier, le trajet est recalculé
    if (path.defined && path.remaining > 0 && path.nodes.length < path.remaining && path.target) {
      if (!computePath(this.terrain, obj, path.target, path, this.pathOptions(obj))) return FOLLOW_NO_PATH;
    }
    return followPath(path, obj, {
      recompute: (state: PathState, resume: boolean) =>
        state.target ? computePath(this.terrain!, obj, state.target, state, { resume, ...this.pathOptions(obj) }) : false,
    });
  }

  // --- événements, comportements -----------------------------------------------------------------------------------------------

  private readonly behaviors: BehaviorResolver = {
    resolve: (obj, table) => {
      const handler = this.registry.resolve(table as 2 | 3 | 7, obj.num);
      if (handler) return (o) => handler(o, this.services);
      if (this.strict) return null;
      this.missing.add(`${table}:${obj.num}`);
      return () => 7;
    },
  };

  private readonly mover: MoverHooks = {
    move: (obj) => {
      if (this.terrain) moveObject(obj as MoverBody, this.moverEnv(obj));
    },
    reset: (obj) => this.resetMotion(obj),
  };

  private readonly hooks: UpdateHooks;

  private fire(entry: Readonly<DeferredEvent>): void {
    {
      const target = entry.serial !== 0 ? this.state?.findBySerial(entry.serial) : undefined;
      if (entry.num !== 0 && !target) return; // `1a7b:02b7` : l'objet n'existe plus
      const handler = this.registry.get(FAMILY.event, entry.procedure);
      if (handler) handler(this.services, entry, target);
      else this.missing.add(`8:${entry.procedure}`);
    }
  }

  // --- monde ----------------------------------------------------------------------------------------------------------------

  /** Remplace le monde (`rsv`, F3, F5) : sons coupés, salle rechargée à la prochaine image. */
  private installState(state: WorldState): void {
    this.state = state;
    this.windows.close();
    this.pendingWindows.length = 0;
    this.inputLine = createInputLine();
    this.messages.reset();
    this.sequencer.stopAll();
    this.music = null;
    this.scene = null;
    this.terrain = null;
    this.staticSignature = null;
    this.firstDisplay = false;
    this.lastLevel = Number.NaN;
    this.controller.reset(state.iconPage);
    this.applyIconPage();
  }

  /** `15f8:000e` : les icônes hors page prennent l'image cachée (`Fig 2`), les autres l'image de la variante gauche. */
  private applyIconPage(): void {
    const state = this.state;
    if (!state) return;
    const onPage = new Set(ICON_PAGES[state.iconPage] ?? ICON_PAGES[0]);
    const icons = new Set(ICON_PAGES.flat());
    for (const obj of state.interfaceObjects) {
      if (!icons.has(obj.num)) continue;
      obj.fig = onPage.has(obj.num) ? 0 : 2;
      loadObjectSprite(obj, this.sprites);
    }
  }

  /** `NOUVELLE_SALLE` (`engine.md` § 4) : charge la salle voulue, y range le héros et prépare la première image. */
  private loadWantedRoom(): void {
    const state = this.state!;
    for (let attempt = 0; attempt < MAX_ROOM_LOAD_ATTEMPTS; attempt++) {
      let scene: Scene | null = null;
      const requests = planRoomLoad(state, this.music);
      for (const request of requests) {
        if (request.type === "stopMusic") {
          this.sequencer.stop();
          this.music = null;
        } else if (request.type === "loadScene") scene = this.sceneOf(request.sceneId);
      }
      if (!scene) throw new Error("Aucune scène à charger");
      const loaded = loadRoom(state, scene, { sprites: this.sprites, rand: () => this.rng.next(), resetMotion: (o) => this.resetMotion(o) });
      this.scene = scene;
      this.terrain = createTerrain(scene, activePlanes(state, state.loadedRoom!.id, scene.header.planeCount));
      this.origin = loaded.origin;
      this.compositor.setFrame(this.frameScene);
      this.compositor.drawScene(scene);
      this.staticSignature = null;
      for (const request of requests) {
        if (request.type !== "playMusic") continue;
        this.sequencer.play(request.id, request.soundClass, request.number, { loop: true });
        this.music = { soundClass: request.soundClass, id: request.id, number: request.number };
      }
      const hero = state.hero;
      const result = enterRoom(state, {
        place: (obj, mode) => this.place(obj, mode),
        placeHero: (s) => {
          if (hero && hero.info === 6 && s.wantedRoom && hero.room !== s.wantedRoom) {
            // `trf` / `mov` : le héros est envoyé directement dans la salle voulue (`186d:000c` avec `Inf = 6`)
            s.moveToRoom(hero, s.wantedRoom);
            hero.info = 0;
            if (this.placed(this.place(hero, 1))) return true;
            // hypothèse : la position de la salle d'origine peut être impossible ici (eau, mur) ; repli sur le tirage de `characters.md`
            // § 6.2 (animation 18, `placer(mode 9)` : position aléatoire) plutôt que l'arrêt `0x101`
            this.heroPlacementFallbacks++;
            for (let attempt = 0; attempt < 64; attempt++) if (this.placed(this.place(hero, 9))) return true;
            return false;
          }
          return completeHeroTransit(s, (h, slot) => this.arrive(h, slot));
        },
        resetMotions: (heroAbsent) => {
          for (const obj of [...(state.loadedRoom?.listA ?? [])]) {
            if (obj.mob !== 2 || (heroAbsent && obj === hero)) continue;
            this.place(obj, 5);
            this.resetMotion(obj);
          }
        },
      });
      if (result.status === "ready") {
        this.firstDisplay = true;
        this.lastLevel = Number.NaN;
        return;
      }
    }
    throw new Error("Chargement de salle impossible");
  }

  /** `147f:000a` après un changement d'état d'un mécanisme (stèle, dalle, passerelle) : recalcule les plans actifs de la salle chargée. */
  refreshPlanes(): void {
    const room = this.state?.loadedRoom;
    if (this.state && room && this.terrain && this.scene) this.terrain.planes = Math.min(activePlanes(this.state, room.id, this.scene.header.planeCount), MAX_PLANES);
  }

  /** Placement d'arrivée (`1aba:0310`) : vitesse dans le sens de la sortie, recherche contre le côté d'arrivée (mode 10). */
  private arrive(obj: GameObject, slot: number): boolean {
    const state = this.state!;
    if (slot > 5) return this.place(obj, 1) === PLACE_OK;
    const opposite: number = OPPOSITE_EXIT[slot];
    let side = opposite;
    if (obj.room === state.loadedRoom && this.terrain) {
      side = this.terrain.permutation[opposite]!;
      if (side !== opposite) {
        obj.x = MAX_X >> 1;
        obj.p = MAX_P >> 1;
      }
    }
    obj.speedX = side === 1 ? -1 : side === 3 ? 1 : 0;
    obj.speedP = side === 0 ? 1 : side === 2 ? -1 : 0;
    obj.info = side;
    const result = this.place(obj, 10);
    return result === PLACE_OK || result === PLACE_TYPE_CHANGED;
  }

  // --- image --------------------------------------------------------------------------------------------------------------------

  /** Une image de la boucle principale (`engine.md` § 4). */
  private frame(): void {
    const state = this.state;
    if (!state || this.runner.running) {
      this.compositor.present();
      this.lastLevel = Number.NaN;
      this.updatePalette(null);
      return;
    }
    if (this.modal) {
      this.updatePalette(state);
      if (this.inputLine.open) this.drawInputBox(this.inputLine.text, true);
      return;
    }
    // la souris est un état sondé à chaque image (`INT 33h`) : sans événement, l'état courant est relu
    const samples = this.samples.splice(0);
    if (samples.length === 0) samples.push(this.pointer);
    for (const sample of samples) this.pointerSample(sample);
    if (this.modal) return;

    this.controller.tick();
    for (let guard = 0; guard < MAX_ROOM_LOAD_ATTEMPTS; guard++) {
      if (state.loadedRoom !== state.wantedRoom || !state.loadedRoom) this.loadWantedRoom();
      const result = runFrame(state, this.hooks, { keyPressed: this.keyForcesTick });
      if (result.status === "ran") break;
    }
    if (state.events.size === 0) state.events.capacity = 0; // `23a2:0340` libère la table vide
    this.layoutInventory();
    this.panel = this.layoutPanel();
    this.compose(state);
    if (this.firstDisplay) {
      this.firstDisplay = false;
      this.growEvents(true);
      onFirstDisplay(state);
    }
  }

  /** Souris : `controller.pointer` (une fois par image, cible en coordonnées d'écran) puis messages empilés par le clic. */
  private pointerSample(sample: { x: number; y: number; buttons: number; ctrl: boolean }): void {
    if (this.runner.running) return;
    const modifiers: PointerModifiers = { ctrl: sample.ctrl };
    if (sample.buttons !== 0) {
      this.messages.reset();
      this.clickSuccesses = 0;
    }
    const actions = this.controller.pointer(sample.x, sample.y, sample.buttons, modifiers);
    this.applyActions(actions);
    if (this.messages.length > 0 && sample.buttons !== 0) {
      if (this.clickSuccesses === 0) for (const id of this.messages.display(0)) this.sayId(id);
      this.messages.reset();
    }
  }

  /** `1652:0006` : les 12 premiers objets du héros s'affichent dans l'inventaire, les suivants sont masqués. */
  private layoutInventory(): void {
    const contents = this.state?.hero?.contents ?? [];
    contents.forEach((obj, k) => {
      if (k < 12) {
        obj.presence = 8;
        obj.x = 28 + 24 * k;
        obj.y = 195;
        obj.p = 208;
      } else obj.presence = 0;
      if (obj.anim.frame < 0) loadObjectSprite(obj, this.sprites);
    });
  }

  private compose(state: WorldState): void {
    const c = this.compositor;
    const statics = drawList(state, "static").filter((d) => !this.isCursorObject(d.serial));
    const signature = JSON.stringify(statics);
    if (signature !== this.staticSignature) {
      c.undoAll();
      applyDrawCommands(c, statics, this.sprites, this.origin);
      this.staticSignature = signature;
    }
    if (this.panel) this.drawPanel(this.panel);
    applyDrawCommands(
      c,
      drawList(state, "dynamic").filter((d) => !this.isCursorObject(d.serial)),
      this.sprites,
      this.origin,
    );
    this.drawCursor();
    this.updatePalette(state);
    c.presentAndRestore();
  }

  /** `INT 1` (curseur) et `INT 4` (indicateur d'outil) sont dessinés d'après `InterfaceController`, pas d'après leur objet. */
  private isCursorObject(serial: number): boolean {
    const state = this.state;
    if (!state) return false;
    return state.interfaceObjects.some((o) => o.serial === serial && (o.num === 1 || o.num === 4));
  }

  private drawCursor(): void {
    const cursor = this.controller.cursor();
    const frame = this.cursorFrame(cursor.sprite);
    if (!frame) return;
    // indicateur d'outil : copie de l'image du curseur à l'emplacement de `INT 4`
    if (cursor.kind === "tool" || cursor.kind === "held") this.compositor.blitSprite(frame.frame, 160, 17, 204, { flip: frame.flip });
    this.compositor.blitSprite(frame.frame, cursor.x, cursor.y, cursor.priority, { flip: frame.flip });
  }

  private cursorFrame(sprite: ReturnType<InterfaceController["cursor"]>["sprite"]): { frame: SpriteFrame; flip: boolean } | null {
    if (sprite.resource === "object") {
      const obj = this.state?.findBySerial(sprite.serial);
      const frame = obj ? currentFrame(obj, this.sprites) : undefined;
      return frame ? { frame, flip: false } : null;
    }
    const resource = this.sprites.get({ family: "INT", id: sprite.num });
    const step = resource?.animation.figs[sprite.fig]?.directions[0]?.steps[0];
    const frame = step ? resource!.frames[step.frame] : undefined;
    return frame && step ? { frame, flip: step.mirror } : null;
  }

  /** Lumière (`197e:0008`) puis palette éclairée envoyée à l'hôte. */
  private updatePalette(state: WorldState | null): void {
    const room = state?.loadedRoom ?? null;
    let level = 0;
    if (state) {
      const lamps = [...(room?.listB ?? []), ...(room?.listA ?? []), ...(state.hero?.contents ?? [])].reduce((sum, o) => sum + o.light, 0);
      level = lightLevel({
        room: room ? { outdoor: room.outdoor !== 0, lightOffset: room.lightOffset } : null,
        hour: state.clock.hour,
        minute: state.clock.minute,
        lamps,
        override: this.lightOverride,
        cap: this.lightCap,
      });
      state.darkRoom = room !== null && isTooDark(level);
    } else level = this.lightOverride;
    if (level === this.lastLevel && this.paletteShift === null) return;
    this.lastLevel = level;
    const lit = this.paletteShift ? shifted(this.data.palette, this.paletteShift) : applyLight(this.data.palette, level);
    this.litPalette = vga6ToRgb8(lit);
    if (this.litPalette.length !== PALETTE_BYTES) throw new Error("Palette invalide");
  }

  // --- ligne de saisie -------------------------------------------------------------------------------------------------------------

  private drawInputBox(text: string, caret: boolean): void {
    const c = this.compositor;
    c.restoreScreen(INPUT_BOX);
    c.drawFrameRect(INPUT_BOX, INPUT_COLORS.frame, INPUT_COLORS.background);
    c.drawFrameRect({ x: INPUT_BOX.x + 1, y: INPUT_BOX.y + 1, width: INPUT_BOX.width - 2, height: INPUT_BOX.height - 2 }, INPUT_COLORS.inner, null);
    const blink = caret && Math.floor(this.caret++ / CARET_BLINK) % 2 === 0;
    drawText(c.screen, this.data.font, INPUT_BOX.x + 3, INPUT_BOX.y + 2, encodeCp437(text + (blink ? "_" : "")), {
      color: INPUT_COLORS.inner,
      shadow: INPUT_COLORS.frame,
    });
  }

  private restoreInputBox(): void {
    this.compositor.restoreScreen(INPUT_BOX);
  }

  // --- messages -----------------------------------------------------------------------------------------------------------------------

  private messageTextById(id: number): string | undefined {
    return this.data.messages.has(id) ? this.data.messages.messages(id) : undefined;
  }

  private sayId(id: number): void {
    const text = this.messageTextById(existingMessageId(this.data.messages, id));
    if (text !== undefined) this.openText(text);
  }

  private openText(text: string, extra: Partial<WindowRequest> = {}): void {
    this.pendingWindows.push({ text, window: null, centered: true, colors: null, ...extra });
  }

  /** Message système plein écran, non centré, aux couleurs de `colors` (`2401:0002`, `14cf:000c`). */
  private openFullScreen(text: string, colors: readonly [number, number, number]): void {
    this.openText(text, { window: { ...FULL_WINDOW }, centered: false, colors });
  }

  // --- données ------------------------------------------------------------------------------------------------------------------------

  /** Fichier de scènes d'un identifiant : `A1F` + centaine sur 2 chiffres + lettre `'A' + (id % 100) / 5` (`gm_load_scene`). */
  private sceneOf(id: number): Scene {
    let scene = this.sceneCache.get(id);
    if (!scene) {
      const file = `${LANGUAGE}${String(Math.floor(id / 100)).padStart(2, "0")}${String.fromCharCode(65 + Math.floor((id % 100) / 5))}.VGA`;
      let archive = this.sceneArchives.get(file);
      if (!archive) this.sceneArchives.set(file, (archive = readSceneArchive(this.host.readFile(file))));
      scene = readScene(archive.bytes(id), { recolorType1: this.data.recolorType1 });
      this.sceneCache.set(id, scene);
    }
    return scene;
  }

  private scene0(): Scene {
    return this.sceneOf(0);
  }

  // --- placement, déplacement, collisions ----------------------------------------------------------------------------------------------

  private isInLoadedRoom(obj: Pick<GameObject, "room" | "holder" | "location">): boolean {
    const room = this.state?.loadedRoom;
    return !!room && obj.room === room && obj.holder === null && obj.location === 1;
  }

  private placeEnv(body: PlaceBody, mutate: boolean): PlaceEnv {
    return {
      terrain: this.terrain!,
      inRoom: this.isInLoadedRoom(body as unknown as GameObject),
      memory: this.placementMemory,
      contact: (b) => this.contact(b, mutate),
      depthBlocked: (b) => this.depthBlocked(b),
      // `1b11:0cf2` (rognage de la fenêtre de Y par les murs de l'empreinte du sprite) : activé. Ce n'est pas une fonction mais le
      // label d'un bloc de `gm_object_behavior_main` (decomp `1b11_000c`, l. 474) gardé par « en salle » et `Txt != 2` seulement ;
      // `1504:0002` (destination d'un clic, héros `Txt 0`) l'appelle sans paramètre qui l'évite, et `movement.md` § 4.3 le décrit
      // sans condition. Sur les 60 salles, 3,8 % des clics en grille donnent une autre destination qu'avec `clipWalls` éteint
      // (surtout des refus de poser le sprite contre un mur).
      clipWalls: true,
      acceptsGround: this.groundRule ? (type, effect, b) => this.groundRule!(type, effect, b as unknown as GameObject, this.services) : undefined,
      random: () => this.rng.next(),
    };
  }

  private moverEnv(obj: GameObject): MoverEnv {
    return {
      ...this.placeEnv(obj, true),
      room: obj.room ?? this.state!.loadedRoom!,
      barrier: (code, mode, body) => this.barrier(code, mode, body as unknown as GameObject),
      animate: (body, mode) => void animStep(body as unknown as GameObject, this.sprites, mode),
    };
  }

  /**
   * Masque de profondeur (`vga_sprite_hit`, `1000:0e1a`) : un pixel opaque du sprite sur une valeur du plan de priorité égale à `P`.
   * Le test saute en `1000:0eea` (sans lire `+0x44`) et les deux branches de `Hor` lisent la même correspondance : colonne de données
   * = largeur - 1 - colonne d'écran. Le sprite est donc toujours testé en miroir, quel que soit son sens (défaut de l'original).
   */
  private depthBlocked(body: Footprint): boolean {
    const obj = body as unknown as GameObject;
    const frame = currentFrame(obj, this.sprites);
    if (!frame) return false;
    return this.compositor.spriteHit(frame, obj.x, obj.y, obj.p & 0xff, { flip: true, origin: this.origin }) > 0;
  }

  /**
   * `1a50:0006` (`engine.md` § 7.4, `movement.md` § 3.3) : même `P`, recouvrement horizontal puis vertical ; `Err 9` si l'un des
   * deux a `Txt != 0`, sinon 8. `mutate` : l'autre objet reçoit aussi son `Err` (déplacement), pas pendant une recherche.
   */
  private contact(body: PlaceBody, mutate: boolean): ContactResult {
    const room = this.state?.loadedRoom;
    const self = body as unknown as GameObject;
    if (!room) return { err: 0, col: 0 };
    const inRoom = this.isInLoadedRoom(self);
    let result: ContactResult = { err: 0, col: 0 };
    for (const other of room.listA) {
      if (other.serial === self.serial || other.p !== self.p) continue;
      const left = self.x - (self.width >> 1);
      const otherLeft = other.x - (other.width >> 1);
      if (left >= otherLeft + other.width || otherLeft >= left + self.width) continue;
      if ((inRoom || self.dep !== 0) && !(self.y - self.height < other.y && other.y - other.height < self.y)) continue;
      const err = self.txt !== 0 || other.txt !== 0 ? 9 : 8;
      result = { err, col: other.serial };
      if (mutate && (other.err === 0 || other.gst === 7)) {
        other.err = 8 + (self.txt !== 0 ? 1 : 0);
        other.col = self.serial;
      }
      if (!(self.txt === 0 && other.txt !== 0)) break;
    }
    return result;
  }

  /** `1414:0006` : 0 libre, autre bloqué ; message de classe `C` pour le héros, orientation imposée à la traversée. */
  private barrier(code: number, mode: number, obj: GameObject): number {
    const state = this.state!;
    const subject: BarrierSubject = {
      num: obj.num,
      txt: obj.txt,
      ground: obj.ground,
      dep: obj.dep,
      mob: obj.mob,
      p: obj.p,
      isHero: obj === state.hero,
      inRoom: this.isInLoadedRoom(obj),
      carries: (num) => obj.contents.some((o) => o.num === num),
    };
    const world: BarrierWorld = {
      ego: (num) => state.findByNum(num)?.ego ?? 0, // l'original lit un objet absent sans contrôle ; 0 ici
      objectP: (num) => state.findByNum(num)?.p ?? 0,
      get currentRoom() {
        return state.loadedRoom?.id ?? 0;
      },
      isNight: () => state.darkRoom,
      chance: () => this.rng.mod(4) === 0, // codes 5 et 6 : `gm_chance_one_in(4)` (`1414:00c4`, `1414:00de`)
      guard: (subject, key) => this.doorGuard(subject, key),
    };
    const verdict = checkBarrier(code, mode, subject, world);
    if (verdict.message !== null) this.sayId(verdict.message);
    if (verdict.orient) {
      obj.speedX = verdict.orient.speedX;
      obj.speedP = verdict.orient.speedP;
    }
    return barrierResult(verdict);
  }

  /**
   * `20b5:03bc` (`G(o, k)`), état de la porte `k` (309 ou 329) vu de l'objet `o` : vrai (7) si la porte est dans l'état `Ego` 1 ou 2
   * (fermée non verrouillée, ouverte) ou `Ego` 0 (verrouillée) quand elle n'exige pas de clef ou que `o` porte la clef de la table
   * `DGROUP:0694` ; faux sinon. Non porté : l'ouverture automatique par `20b5:0248` quand `o` traverse (`mode` 2) avec un tirage
   * `gm_chance_one_in(2)` ou `(mot)`, et le message `S48`, qui relèvent du module des portes.
   */
  private doorGuard(subject: BarrierSubject, key: 309 | 329): boolean {
    const row = this.doors.find((d) => d.door === key);
    const door = this.state?.findByNum(key);
    if (!row || !door) return false;
    switch (door.ego) {
      case 0:
        return row.key === 0 || subject.carries(row.key);
      case 1:
      case 2:
        return true;
      default:
        return false;
    }
  }

  // --- visibilité, portée --------------------------------------------------------------------------------------------------------------

  /** `219b:0000` : ni caché, ni dans une salle trop sombre ; hors de la salle chargée, lumière de l'objet et du héros (> 31). */
  private isVisible(obj: GameObject): boolean {
    const state = this.state;
    if (!state || obj.hidden !== 0) return false;
    let at: GameObject | null = obj;
    while (at?.holder) at = at.holder;
    if (at?.room === state.loadedRoom) return !state.darkRoom;
    return obj.light + (state.hero?.light ?? 0) > 31;
  }

  /** `2120:0075` (probable) : même salle, écart de profondeur < 9, recouvrement horizontal à 4 pixels près. */
  private inReach(obj: GameObject): boolean {
    const hero = this.state?.hero;
    if (!hero || obj === hero || obj.holder === hero) return true;
    if (!obj.room || obj.room !== hero.room || Math.abs(obj.p - hero.p) >= 9) return false;
    return Math.abs(obj.x - hero.x) <= ((obj.width + hero.width) >> 1) + 4;
  }

  /** Vue du monde pour la résolution des noms (`206a:0002`). */
  private resolverWorld(): ResolverWorld {
    const state = this.state!;
    const hero = state.hero!;
    const scene = this.scene;
    return {
      objects: state.objects,
      hero,
      room: state.loadedRoom?.id ?? 0,
      isVisible: (o: ResolverObject) => this.isVisible(o as GameObject),
      isInReach: (o: ResolverObject) => this.inReach(o as GameObject),
      distanceSquared: (o: ResolverObject) => {
        const obj = o as GameObject;
        return (obj.x - hero.x) ** 2 + (obj.p - hero.p) ** 2;
      },
      hasDecor: (code: number) => scene?.hotspots.some((h) => h.messageId === code) ?? false,
    };
  }

  /** Dernière image présentée (pour les tests et la vérification visuelle). */
  get screen(): Uint8Array {
    return this.compositor.screen.pixels;
  }

  get palette(): Uint8Array {
    return this.litPalette;
  }

  /** Rectangle de la page de la fenêtre ouverte, ou `null`. */
  get windowRect(): Rect | null {
    return this.windows.rect;
  }

  /** Nombre de fenêtres en attente d'affichage (hors celle qui est ouverte). */
  get pendingWindowCount(): number {
    return this.pendingWindows.length;
  }

  /** Identifiant de la dernière scène affichée par `lir`, ou `null`. */
  get shownScene(): number | null {
    return this.shown;
  }

  get currentScene(): Scene | null {
    return this.scene;
  }

  get currentTerrain(): Terrain | null {
    return this.terrain;
  }
}

/** Contexte d'une phrase : les variables `DGROUP:4cba..4dcc` changent à chaque itération des boucles. */
class PhraseContext implements HandlerContext {
  verb = 0;
  preposition = 0;
  talk = true;
  direct: HandlerTarget = NO_TARGET;
  indirect: HandlerTarget = NO_TARGET;
  verbDisabled = false;

  readonly reaction: HandlerReaction;

  constructor(
    private readonly base: BehaviorContext,
    engine: ArmaethEngine,
  ) {
    this.reaction = {
      arm: (target) => engine.armReaction(this, target),
      replay: () => engine.replayReaction(),
      get armed() {
        return engine.hasReactionArmed;
      },
    };
  }

  react(target: GameObject | null): boolean {
    return this.reaction.arm(target);
  }

  get sprites() {
    return this.base.sprites;
  }
  get ani() {
    return this.base.ani;
  }
  get refreshObject() {
    return this.base.refreshObject;
  }
  get die() {
    return this.base.die;
  }
  get playAnimation() {
    return this.base.playAnimation;
  }

  get scene() {
    return this.base.scene;
  }
  get state() {
    return this.base.state;
  }
  get hero() {
    return this.base.hero;
  }
  get room() {
    return this.base.room;
  }
  get messages() {
    return this.base.messages;
  }
  get sound() {
    return this.base.sound;
  }
  get events() {
    return this.base.events;
  }
  get score() {
    return this.base.score;
  }
  get rooms() {
    return this.base.rooms;
  }
  get motion() {
    return this.base.motion;
  }
  get rng() {
    return this.base.rng;
  }

  disableVerb(): void {
    this.verbDisabled = true;
  }
}

function targetOf(code: number, resolved: ResolvedObject | null): HandlerTarget {
  if (!resolved) return { code, object: null, held: false, inReach: false };
  return { code, object: resolved.object as GameObject, held: resolved.flagA !== 0, inReach: resolved.flagB !== 0 };
}

/** Palette 6 bits avec des décalages R, V, B imposés (`rvb`). */
function shifted(palette6: Uint8Array, [r, g, b]: readonly [number, number, number]): Uint8Array {
  const out = new Uint8Array(palette6.length);
  const offsets = [r, g, b];
  for (let i = 0; i < palette6.length; i++) out[i] = i < 216 * 3 ? Math.max(0, Math.min(63, palette6[i] + offsets[i % 3])) : palette6[i];
  return out;
}

/** Table des portes à serrure `DGROUP:0694` : un mot de nombre de lignes, puis six colonnes de ce nombre de mots. */
function readDoorTable(exe: Uint8Array): DoorRow[] {
  const at = DGROUP_IMAGE_OFFSET + DOOR_TABLE;
  const word = (i: number) => exe[at + 2 * i] | (exe[at + 2 * i + 1] << 8);
  const count = word(0);
  const column = (c: number, row: number) => word(1 + c * count + row);
  return Array.from({ length: count }, (_, row) => ({
    door: column(0, row),
    guardian: column(1, row),
    key: column(2, row),
    word: column(3, row),
    roomA: column(4, row),
    roomB: column(5, row),
  }));
}
