/**
 * Hub / Control Room (scène 0, `MAINSCRN.DAT`) : la salle d'où l'on lance les 8 activités, et Poly derrière son pupitre
 * (`docs/mathemagique/screens/common.md` §2, §4, §7 ; `1020:0000` / `1020:06f6` / `1020:11b0`).
 *
 * - **Décor cliquable** (groupe 0, 14 enregistrements `DS:0c70`) : chaque objet lance son activité (animation de départ, fondu, scène
 *   demandée par `ctx.scenes.request`) ; Poly (12–13) ouvre Math Trivia ; le sifflet (1) et le plein écran (14) ne servent que dans
 *   l'invite « quitter » et le mode aide. Sans joueur connecté, Poly demande de se connecter (clip 5000) et le moniteur s'ouvre.
 * - **Pupitre** (groupe 1) : Quit (invite à deux temps, sifflet), Help (mode aide : un clic sur un objet joue son explication), Sign-in
 *   (Ctrl + clic ou appui long : préférences). **Jouets** (groupe 3) : fenêtres, rampes, quatre leviers qui coupent des ambiances.
 * - **Ambiance** : MIDI 65000 (« Ambient Sounds »), neuf boucles d'animation, papillon du cadre, clips d'attente de Poly et phrases
 *   d'attente.
 * - **Séquences secrètes** : l'historique des touches (`KeyHistory`) n'est consulté qu'à l'ouverture de Math Trivia.
 *
 * Le moniteur (connexion, préférences, Math Trivia, `monitor/`) est un `MonitorOverlay` que le hub crée à l'entrée : il lui donne ses
 * ticks et ses touches tant qu'il est ouvert et appelle `monitorClosed()` à sa fermeture (finalisation `1020:1e35`). `opts.openMonitor`
 * le remplace (tests).
 *
 * Poly est un jeu de clips (`SCR` de `MAINSCRN.DAT`) : avant chaque clip, la zone sous Poly est remise à l'état « sans Poly » (rectangle
 * sauvegardé à l'entrée, `DS:0c50`) ; à la fin du clip, Poly au repos (SHAP 104) est redessinée.
 */
import { NoRepeatPool } from "../engine/rng";
import { rectContains, rectFromEdges, type GadgetGroup, type GadgetRecord } from "../engine/gadgets";
import { drawShape } from "../engine/graphics/blit";
import type { Rect, SavedRect } from "../engine/graphics/surface";
import type { Archive } from "../engine/resources";
import { SCR_FLAG, type AnimationHandle } from "../engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";
import type { Deadline } from "../engine/clock";
import type { KeyEvent } from "../engine/input";
import type { FonFont } from "../engine/graphics/fon";
import { MonitorOverlay, loadMonitorFont, type MonitorMode as OverlayMode, type TextInputPort } from "./monitor";
import {
  createHubHelpTable,
  HUB_CHATTER_COUNT,
  HUB_CHATTER_DELAY,
  HUB_CHATTER_FIRST,
  HUB_CHATTER_PICKED,
  HUB_CONSOLE,
  HUB_CONSOLE_EDGES,
  HUB_CONSOLE_SHAPES,
  HUB_GREETING_CLIPS,
  HUB_HELP_CHAINS,
  HUB_HELP_FIRST_CURSOR_ZONE,
  HUB_HELP_INTRO_CLIP,
  HUB_HELP_REPEAT_TICKS,
  HUB_HELP_SOUNDS,
  HUB_HELP_ZONE,
  HUB_IDLE_CLIP_DELAY,
  HUB_IDLE_CLIPS,
  HUB_INACTIVITY_TICKS,
  HUB_INTRO_CLIP,
  HUB_LAUNCH,
  HUB_OBJECT,
  HUB_OBJECT_EDGES,
  HUB_QUIT_REMINDER_DELAY,
  HUB_QUIT_REMINDERS,
  HUB_QUIT_SOUND,
  HUB_RETURN_CLIP,
  HUB_SIGNIN_SOUND,
  HUB_TOYS,
  HUB_TRIVIA_HMM_CLIP,
  HUB_WELCOME_CLIPS,
  HUB_WHISTLE,
  KeyHistory,
  QuitPrompt,
  type HubSwitch,
} from "./hub-logic";

const ARCHIVE = "MAINSCRN.DAT";
const MIDI_ARCHIVE = "MILKYWAY.DAT";
const MIDI_ID = 65000;

const FADE_TICKS = 30;

// Décor (`SHPL 100`, `1020:0000`).
const BACKGROUND_SHAPE = 100;
const DESK_SHAPE = 101;
const DESK_POSITION = { x: 28, y: 341 } as const;
const TV_OFF_SHAPE = 102;
const TV_POSITION = { x: 460, y: 205 } as const;
const STOP_SHAPE = 103;
const STOP_POSITION = { x: 98, y: 363 } as const;
const POLY_SHAPE = 104;
const POLY_POSITION = { x: 51, y: 241 } as const;
/** Rectangle sauvegardé pour restaurer le fond sous Poly (`DS:0c50` : (0, 225)–(272, 432)). */
const POLY_BACKGROUND: Rect = { x: 0, y: 225, w: 272, h: 207 };
/** Écran de la télévision (`DS:0c54`) et zone du sifflet (union des zones de 10100, 10200 et 10300). */
const TV_RECT: Rect = { x: 460, y: 205, w: 53, h: 111 };
const WHISTLE_RECT: Rect = { x: 172, y: 311, w: 97, h: 102 };

// Papillon du cadre (`SHPL 1600`, 4 formes, ping-pong 1-2-3-4-3-2, une image toutes les 6 ticks).
const BUTTERFLY_FIRST_SHAPE = 1600;
const BUTTERFLY_POSITION = { x: 169, y: 232 } as const;
const BUTTERFLY_SEQUENCE: readonly number[] = [0, 1, 2, 3, 2, 1];
const BUTTERFLY_PERIOD = 6;

/** Boucles d'ambiance (`1020:1ac7`), dans l'ordre de l'original ; l'interrupteur qui les gèle est la clé. */
type LoopKey = "curtain" | "gear" | "television" | "skylight" | "shelf" | "easel";
const LOOPS: readonly { key: LoopKey; script: number }[] = [
  { key: "curtain", script: 1400 },
  { key: "gear", script: 1700 },
  { key: "television", script: 2000 },
  { key: "skylight", script: 1800 },
  { key: "shelf", script: 1500 },
];
/** Cinq variantes de la toile du chevalet, une tirée à chaque entrée. */
const EASEL_SCRIPTS: readonly number[] = [1825, 1850, 1875, 1900, 1925];
const LOOP_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.keepMidi;

export type MonitorMode = "signin" | "preferences" | "trivia";

/** Précisions passées avec le mode : séquence secrète tapée avant le clic sur Poly (`SHPL` 301 à 320 de `MAINSCRN.DAT`). */
export interface MonitorDetail {
  secret?: number;
}

export interface HubOptions {
  /**
   * Remplace le moniteur du hub (tests) : il doit appeler `monitorClosed()` à sa fermeture. Absent : le hub pose son propre
   * `MonitorOverlay` (`MAINSCRN.DAT`, `NCSCLB10.FON`), lui donne ses touches et ses ticks et appelle `monitorClosed()` à la fermeture.
   */
  openMonitor?: (mode: MonitorMode, detail?: MonitorDetail) => void;
  /** Pont vers le clavier virtuel pour la saisie du nom (hôte navigateur) ; sans lui, la saisie ne passe que par les touches. */
  textInput?: TextInputPort;
}

/** Ce que le hub expose en plus de `Scene` (hôte, moniteur et tests). */
export interface HubScene extends Scene {
  /** Le moniteur est ouvert (le décor est inactif, les touches vont au moniteur). */
  readonly monitorOpen: boolean;
  /** Vue du moniteur du hub quand il est ouvert (`null` sinon, ou si `opts.openMonitor` le remplace). */
  readonly monitorMode: OverlayMode | null;
  /** À appeler quand le moniteur se ferme : réactive le décor et fait la finalisation (`1020:1e35`). */
  monitorClosed(): void;
  /** Appui long de l'hôte tactile = Ctrl + clic : sur le bouton Sign-in, ouvre les préférences. */
  longPress(x: number, y: number): void;
  readonly history: KeyHistory;
  readonly helpMode: boolean;
  readonly quitPhase: QuitPrompt["phase"];
}

/** État qui survit d'une entrée du hub à l'autre (variables globales de l'original). */
interface HubSession {
  /** `DS:0c48` : l'écran de connexion a déjà été proposé. */
  connected: boolean;
  /** `DS:0c4e` : la salutation de bienvenue a déjà été jouée. */
  welcomed: boolean;
  /** `DS:874a` : mode sans animations (Ctrl à l'entrée du hub), persistant. */
  noAnimations: boolean;
  /** `DS:0f1c` : dernière activité lancée (animation de retour). */
  lastScene: SceneId | null;
  /** `DS:4fa4` quand aucun joueur n'est connecté. */
  anonymousIntroSeen: boolean;
  /** Historique des touches (`DS:4f1c`, `DS:0b73`) : survit aux entrées. */
  history: KeyHistory;
}

const sessions = new WeakMap<MathServices, HubSession>();

function sessionOf(services: MathServices): HubSession {
  let session = sessions.get(services);
  if (!session) {
    session = { connected: false, welcomed: false, noAnimations: false, lastScene: null, anonymousIntroSeen: false, history: new KeyHistory() };
    sessions.set(services, session);
  }
  return session;
}

interface LoopState {
  key: LoopKey;
  handle: AnimationHandle;
}

class Hub implements HubScene {
  readonly history: KeyHistory;
  private readonly session: HubSession;
  private readonly quit = new QuitPrompt();
  private readonly helpTable = createHubHelpTable();
  private ctx!: SceneContext;
  private archive!: Archive;
  private objects!: GadgetGroup;
  private console!: GadgetGroup;
  private toys!: GadgetGroup;
  /** Moniteur du hub (absent si `opts.openMonitor` le remplace) et sa police, chargée par `load`. */
  private overlay: MonitorOverlay | null = null;
  private monitorFont: FonFont | null = null;

  // Dessin.
  private polyBackground!: SavedRect;
  private tvBackground!: SavedRect;
  private whistleBackground: SavedRect | null = null;
  private stopBackground: SavedRect | null = null;
  private loops: LoopState[] = [];
  private readonly off = new Set<string>();
  private frozenByMonitor: LoopKey[] = [];
  private butterflyTick = 0;
  private tvBlackPending = false;

  // Poly.
  private polyClip: AnimationHandle | null = null;
  private polyIdleDirty = false;
  private readonly idlePool = new NoRepeatPool(HUB_IDLE_CLIPS.length);
  private chatter: number[] = [];

  // États.
  monitorOpen = false;
  helpMode = false;
  private helpMoved = false;
  private helpSince = 0;
  private busy = false;
  private ready = false;
  private lastAction = 0;
  private idleDeadline: Deadline | null = null;
  private chatterDeadline: Deadline | null = null;
  private quitReminder: Deadline | null = null;
  private quitReminderClip = HUB_QUIT_REMINDERS[0]!;
  private sceneWait: { until: Deadline; scene: SceneId } | null = null;
  private playerAtOpen = 0;
  private ambientAtOpen = true;
  private greeting = HUB_GREETING_CLIPS[0]!;
  private whistleAppear: AnimationHandle | null = null;

  constructor(
    private readonly services: MathServices,
    private readonly opts: HubOptions,
  ) {
    this.session = sessionOf(services);
    this.history = this.session.history;
  }

  get monitorMode(): OverlayMode | null {
    return this.overlay?.isOpen ? this.overlay.currentMode : null;
  }

  get quitPhase(): QuitPrompt["phase"] {
    return this.quit.phase;
  }

  // --- Cycle de vie ---

  async load(ctx: SceneContext): Promise<void> {
    const [, , font] = await Promise.all([ctx.resources.open(ARCHIVE), ctx.resources.open(MIDI_ARCHIVE, "persistent"), this.opts.openMonitor ? null : loadMonitorFont(ctx.host)]);
    this.monitorFont = font;
  }

  enter(ctx: SceneContext): void {
    this.ctx = ctx;
    this.archive = ctx.resources.require(ARCHIVE);
    const { screen, palette } = this.services.graphics;
    const { gadgets, scr } = this.services;
    this.services.useArchive(this.archive);
    ctx.setCursor("arrow");

    // Ctrl seul à l'entrée : mode sans animations ; Ctrl + Maj : le rétablit (`874a`).
    if (ctx.input.ctrl) this.session.noAnimations = !ctx.input.shift;

    palette.loadShpl(this.archive.shpl(BACKGROUND_SHAPE));
    drawShape(screen, this.archive.shap(BACKGROUND_SHAPE), 0, 0, 0);
    drawShape(screen, this.archive.shap(DESK_SHAPE), DESK_POSITION.x, DESK_POSITION.y, 8);
    this.polyBackground = screen.saveRect(POLY_BACKGROUND);
    this.tvBackground = screen.saveRect(TV_RECT);
    this.drawPolyIdle();

    this.objects = gadgets.addGroup({
      id: "hub-objects",
      records: HUB_OBJECT_EDGES.map((edges, i) => ({
        rect: rectFromEdges(...edges),
        focusable: i + 1 !== HUB_OBJECT.fullScreen && i + 1 !== HUB_OBJECT.whistle,
        // Le sifflet n'existe que dans l'invite « quitter », le plein écran que dans l'invite et le mode aide.
        disabled: i + 1 === HUB_OBJECT.whistle || i + 1 === HUB_OBJECT.fullScreen,
      })),
      onActivate: (index) => this.onObject(index),
    });
    this.console = gadgets.addGroup({
      id: "hub-console",
      records: HUB_CONSOLE_EDGES.map((edges, i) => ({
        rect: rectFromEdges(...edges),
        shapes: { normal: HUB_CONSOLE_SHAPES[i]!.normal, pressed: HUB_CONSOLE_SHAPES[i]!.pressed },
        shapeX: HUB_CONSOLE_SHAPES[i]!.x,
        shapeY: HUB_CONSOLE_SHAPES[i]!.y,
        pressSound: this.consoleSound(i + 1),
      })),
      onActivate: (index) => this.onConsole(index),
    });
    this.toys = gadgets.addGroup({
      id: "hub-toys",
      records: HUB_TOYS.map((toy) => ({ rect: rectFromEdges(...toy.edges), focusable: false })),
      onActivate: (index) => this.onToy(index),
    });
    gadgets.captureBackground(screen);
    this.overlay = this.monitorFont
      ? new MonitorOverlay({
          ctx,
          services: this.services,
          archive: this.archive,
          font: this.monitorFont,
          textInput: this.opts.textInput,
          sceneGroups: () => [this.objects, this.console, this.toys],
          hub: true,
        })
      : null;

    // Chaque entrée tire 4 phrases d'attente parmi 24 (`1018:04e1`).
    const phrases = new NoRepeatPool(HUB_CHATTER_COUNT);
    this.chatter = Array.from({ length: HUB_CHATTER_PICKED }, () => HUB_CHATTER_FIRST + phrases.pick(ctx.rng));

    if (!this.session.noAnimations) this.startLoops();
    this.drawButterfly();
    palette.fadeFromBlack(FADE_TICKS);
    this.startMusic();

    // Retour d'une activité : le rideau (Bowling) ou l'engrenage (Rhythm Shop) se referme pendant le fondu d'entrée.
    const from = this.session.lastScene;
    this.session.lastScene = null;
    const closing = from === null ? undefined : HUB_RETURN_CLIP[from];
    if (closing !== undefined && !this.session.noAnimations) {
      scr.start(this.archive, closing, { flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground | SCR_FLAG.keepMidi });
    }

    this.lastAction = ctx.clock.ticks;
    this.playerAtOpen = ctx.roster.currentPlayerId;
    if (!this.session.connected) {
      // Première entrée de la partie : accueil de Poly, puis écran de connexion.
      this.session.connected = true;
      const welcome = HUB_WELCOME_CLIPS[ctx.rng.below(HUB_WELCOME_CLIPS.length)]!;
      this.startPolyClip(welcome, { blocking: true, interruptible: true, then: () => this.signInOrIdle() });
    } else {
      this.armAmbient();
    }
    this.syncRecords();
    ctx.requestPresent();
  }

  leave(): void {
    this.overlay?.dispose();
    this.overlay = null;
    this.services.endScene();
  }

  // --- Tick ---

  tick(ctx: SceneContext): void {
    this.tickHub(ctx);
    // Le moniteur se redessine par-dessus la scène ; sa fermeture rappelle `monitorClosed`.
    this.overlay?.tick();
  }

  private tickHub(ctx: SceneContext): void {
    const ticks = ctx.clock.ticks;
    if (ctx.input.buttonEvents.some((e) => e.down) || ctx.input.keyEvents.length > 0) this.lastAction = ticks;

    if (this.tvBlackPending) {
      this.tvBlackPending = false;
      drawShape(this.services.graphics.screen, this.archive.shap(TV_OFF_SHAPE), TV_POSITION.x, TV_POSITION.y, 8);
      ctx.requestPresent();
    }
    if (this.polyIdleDirty && !this.polyClip) {
      this.polyIdleDirty = false;
      this.drawPolyIdle();
      ctx.requestPresent();
    }
    this.tickButterfly();

    if (this.sceneWait?.until.expired) {
      const { scene } = this.sceneWait;
      this.sceneWait = null;
      ctx.scenes.request(scene);
    }
    if (this.busy || this.monitorOpen) return;

    // Mode aide : le « ? » au-dessus des objets expliqués ; l'introduction est rejouée si le joueur ne fait rien.
    this.services.pointer.cursor.setHelpHover(
      this.helpMode && this.helpTable.hit(ctx.input.mouseX, ctx.input.mouseY) >= HUB_HELP_FIRST_CURSOR_ZONE,
    );
    if (this.helpMode && !this.helpMoved && !this.polyClip && ticks - this.helpSince >= HUB_HELP_REPEAT_TICKS) {
      this.helpSince = ticks;
      this.playChain([HUB_INTRO_CLIP]);
    }

    if (this.quit.open && this.quitReminder?.expired && !this.polyClip) {
      this.quitReminder = null;
      this.startPolyClip(this.quitReminderClip, { blocking: false });
    }

    // Ambiance : clip d'attente (240–480 ticks) et phrase d'attente (180–360), seulement en mode normal.
    const normal = this.ready && !this.helpMode && !this.quit.open && !this.polyClip && !this.services.scr.blocking;
    if (normal && this.idleDeadline?.expired) {
      const clip = HUB_IDLE_CLIPS[this.idlePool.pick(ctx.rng)]!;
      this.startPolyClip(clip, {
        blocking: false,
        then: () => {
          this.idleDeadline = ctx.clock.deadline(ctx.rng.range(...HUB_IDLE_CLIP_DELAY));
        },
      });
      this.idleDeadline = null;
    } else if (normal && this.chatterDeadline?.expired && !this.services.sound.voicePlaying) {
      this.chatterDeadline = ctx.clock.deadline(ctx.rng.range(...HUB_CHATTER_DELAY));
      if (ticks - this.lastAction < HUB_INACTIVITY_TICKS) {
        const phrase = this.chatter[ctx.rng.below(this.chatter.length)]!;
        this.services.sound.playSound(this.archive, phrase, { channel: "voice", ambient: true });
      }
    }
  }

  // --- Clavier (séquences secrètes) ---

  key(event: KeyEvent): boolean {
    // Moniteur ouvert : les touches vont au moniteur, l'historique n'est pas alimenté (`1020:11b0`).
    if (this.monitorOpen) return this.overlay?.key(event) ?? false;
    this.history.pushKey(event);
    return false;
  }

  // --- Moniteur ---

  /** Fin de l'accueil : le moniteur de connexion s'ouvre ; sans moniteur, la scène reprend son cours normal. */
  private signInOrIdle(): void {
    if (this.canOpenMonitor) this.openMonitorFlow("signin");
    else if (!this.ready) this.armAmbient();
  }

  private get canOpenMonitor(): boolean {
    return this.opts.openMonitor !== undefined || this.overlay !== null;
  }

  /** Ouvre le moniteur : `1020:10e2(1, mode)`. */
  private openMonitorFlow(mode: MonitorMode, detail?: MonitorDetail): void {
    const open = this.opts.openMonitor;
    if ((!open && !this.overlay) || this.monitorOpen || this.busy) return;
    // Garde posée avant de couper la voix : le `then` d'un clip interrompu peut rappeler `openMonitorFlow` (accueil → connexion).
    this.monitorOpen = true;
    if (this.quit.open) this.dismissQuit();
    this.exitHelp();
    this.cutVoice();
    this.playerAtOpen = this.ctx.roster.currentPlayerId;
    this.ambientAtOpen = this.ctx.roster.roster.ambient;
    this.ready = false;
    // Le moniteur recouvre le bas à droite : la boucle du rideau et celle de la télé sont gelées pendant qu'il est ouvert.
    for (const key of ["curtain", "television"] as const) {
      if (!this.off.has(key) && this.loops.some((l) => l.key === key)) {
        this.freezeLoop(key);
        this.frozenByMonitor.push(key);
      }
    }
    this.services.pointer.cursor.setHelpHover(false);
    this.syncRecords();
    if (open) open(mode, detail);
    else this.overlay!.open(mode, () => this.monitorClosed(), { secretPhoto: detail?.secret });
  }

  monitorClosed(): void {
    if (!this.monitorOpen) return;
    const { ctx } = this;
    this.monitorOpen = false;
    for (const key of this.frozenByMonitor) this.resumeLoop(key);
    this.frozenByMonitor = [];
    this.syncRecords();
    this.services.gadgets.invalidate();

    // « Ambient Sounds » vient de changer : la musique se coupe ou repart (`1e35`).
    const ambient = ctx.roster.roster.ambient;
    if (this.ambientAtOpen && !ambient) this.services.sound.stopAmbient();
    else if (!this.ambientAtOpen && ambient) this.startMusic();

    const id = ctx.roster.currentPlayerId;
    if (id !== 0 && id !== this.playerAtOpen) this.greeting = HUB_GREETING_CLIPS[ctx.rng.below(HUB_GREETING_CLIPS.length)]!;
    const clips: number[] = [];
    // Nouveau joueur : Poly se présente (introduction longue de 18 s), une seule fois par joueur.
    if (id !== 0 && ctx.roster.roster.getVar(id, "hubPolyIntroSeen") === 0) {
      ctx.roster.roster.setVar(id, "hubPolyIntroSeen", 1);
      ctx.roster.save();
      clips.push(HUB_INTRO_CLIP);
    }
    if (!this.session.welcomed) {
      this.session.welcomed = true;
      clips.push(this.greeting);
    }
    this.lastAction = ctx.clock.ticks;
    this.playSequence(clips, () => this.armAmbient());
  }

  longPress(x: number, y: number): void {
    // Clip bloquant de Poly en cours : comme les clics, l'appui long est ignoré (sinon il coupe la voix et rouvre la connexion).
    if (this.busy || this.monitorOpen || this.helpMode || this.services.scr.blocking) return;
    if (rectContains(rectFromEdges(...HUB_CONSOLE_EDGES[HUB_CONSOLE.signIn - 1]!), x, y)) this.openMonitorFlow("preferences");
  }

  // --- Décor cliquable ---

  private onObject(index: number): void {
    if (this.busy) return;
    if (index === HUB_OBJECT.fullScreen) {
      if (this.helpMode) this.helpClick();
      else if (this.quit.open) this.cancelQuit();
      return;
    }
    if (index === HUB_OBJECT.whistle) {
      this.confirmQuit();
      return;
    }
    this.cutVoice();
    if (this.quit.open) this.dismissQuit();
    if (index === HUB_OBJECT.polyHead || index === HUB_OBJECT.polyBody) {
      this.openTrivia();
      return;
    }
    const launch = HUB_LAUNCH[index];
    if (!launch) return;
    // Sans joueur connecté : Poly demande de se connecter (clip 5000), puis le moniteur s'ouvre.
    if (this.ctx.roster.currentPlayerId === 0) {
      this.startPolyClip(HUB_WELCOME_CLIPS[0]!, { blocking: true, interruptible: true, then: () => this.signInOrIdle() });
      return;
    }
    this.launch(launch.scene, launch.departure);
  }

  /** Lance une activité : animation de départ, fondu vers le noir, scène demandée (`1020:098a`). */
  private launch(scene: SceneId, departure: number): void {
    this.busy = true;
    this.ready = false;
    this.syncRecords();
    this.services.pointer.cursor.setBase("busy");
    for (const loop of this.loops) loop.handle.interrupt();
    this.session.lastScene = scene;
    const fade = (): void => {
      this.services.graphics.palette.fadeToBlack(FADE_TICKS);
      this.sceneWait = { until: this.ctx.clock.deadline(FADE_TICKS), scene };
    };
    if (this.session.noAnimations) fade();
    else this.services.scr.playBlocking(this.archive, departure, { flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi }, fade);
  }

  /** Clic sur Poly : Math Trivia (« hmm » de Poly, puis moniteur en mode 4) ; la séquence secrète éventuelle est transmise. */
  private openTrivia(): void {
    if (!this.canOpenMonitor) return;
    this.startPolyClip(HUB_TRIVIA_HMM_CLIP, {
      blocking: true,
      interruptible: true,
      then: () => {
        const secret = this.history.match();
        this.history.reset();
        this.openMonitorFlow("trivia", secret === undefined ? undefined : { secret });
      },
    });
  }

  // --- Pupitre ---

  private consoleSound(index: number): number | (() => number) {
    if (index === HUB_CONSOLE.quit) return HUB_QUIT_SOUND;
    if (index === HUB_CONSOLE.signIn) return HUB_SIGNIN_SOUND;
    return () => HUB_HELP_SOUNDS[this.ctx.rng.below(HUB_HELP_SOUNDS.length)]!;
  }

  private onConsole(index: number): void {
    if (this.busy) return;
    this.cutVoice();
    if (index === HUB_CONSOLE.quit) this.askQuit();
    else if (index === HUB_CONSOLE.help) this.startHelp();
    else this.openMonitorFlow(this.ctx.input.ctrl && !this.ctx.input.shift ? "preferences" : "signin");
  }

  // --- Quitter : l'invite du sifflet (§7) ---

  private askQuit(): void {
    if (!this.quit.ask()) return;
    const { scr } = this.services;
    this.whistleBackground = this.services.graphics.screen.saveRect(WHISTLE_RECT);
    this.whistleAppear = scr.start(this.archive, HUB_WHISTLE.appear, { flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi });
    this.quitReminder = this.ctx.clock.deadline(HUB_QUIT_REMINDER_DELAY);
    this.quitReminderClip = HUB_QUIT_REMINDERS[this.ctx.rng.below(HUB_QUIT_REMINDERS.length)]!;
    this.syncRecords();
  }

  /** Deuxième clic, sur le sifflet : il retentit, se range, puis le jeu se ferme. */
  private confirmQuit(): void {
    if (!this.quit.confirm()) return;
    this.busy = true;
    this.quitReminder = null;
    this.cutVoice();
    this.syncRecords();
    const { scr } = this.services;
    this.eraseWhistle();
    scr.playBlocking(this.archive, HUB_WHISTLE.confirm, { flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground | SCR_FLAG.keepMidi }, () => {
      this.eraseWhistle();
      scr.playBlocking(this.archive, HUB_WHISTLE.rewind, { flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground | SCR_FLAG.keepMidi }, () =>
        this.ctx.host.exit(),
      );
    });
  }

  /** Clic ailleurs : le sifflet se range (clip 10200) et l'invite est annulée. */
  private cancelQuit(): void {
    if (!this.quit.cancel()) return;
    this.quitReminder = null;
    this.syncRecords();
    this.eraseWhistle();
    this.services.scr.playBlocking(
      this.archive,
      HUB_WHISTLE.rewind,
      { flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground | SCR_FLAG.keepMidi },
      () => {},
    );
  }

  /** Ferme l'invite sans animation (un autre bouton a été cliqué). */
  private dismissQuit(): void {
    if (!this.quit.cancel()) return;
    this.quitReminder = null;
    this.eraseWhistle();
    this.syncRecords();
  }

  private eraseWhistle(): void {
    this.whistleAppear?.interrupt();
    this.whistleAppear = null;
    if (this.whistleBackground) {
      this.services.graphics.screen.restoreRect(this.whistleBackground);
      this.services.gadgets.invalidate();
      this.ctx.requestPresent();
    }
  }

  // --- Aide ---

  private startHelp(): void {
    if (this.helpMode) return;
    const { screen } = this.services.graphics;
    this.helpMode = true;
    this.helpMoved = false;
    this.helpSince = this.ctx.clock.ticks;
    this.syncRecords();
    this.stopBackground = screen.saveRect({ x: STOP_POSITION.x, y: STOP_POSITION.y, w: 25, h: 25 });
    this.drawStopHand();
    // Première fois : l'introduction longue ; ensuite l'explication du bouton Help, suivie de la suite si on l'a interrompue.
    if (!this.introSeen()) {
      this.markIntroSeen();
      this.playChain([HUB_INTRO_CLIP]);
    } else {
      this.playChain([HUB_HELP_INTRO_CLIP, 4900]);
    }
    this.ctx.requestPresent();
  }

  private exitHelp(): void {
    if (!this.helpMode) return;
    this.helpMode = false;
    this.services.pointer.cursor.setHelpHover(false);
    if (this.stopBackground) this.services.graphics.screen.restoreRect(this.stopBackground);
    this.stopBackground = null;
    this.syncRecords();
    this.ctx.requestPresent();
  }

  /** Clic en mode aide : le clip (ou la chaîne) de l'objet sous le curseur ; Poly elle-même met fin à l'aide. */
  private helpClick(): void {
    this.helpMoved = true;
    const zone = this.helpTable.hit(this.ctx.input.mouseX, this.ctx.input.mouseY);
    if (zone === 0) return;
    this.cutVoice();
    if (zone === HUB_HELP_ZONE.polyHead || zone === HUB_HELP_ZONE.polyBody) {
      const clip = this.ctx.roster.currentPlayerId === 0 ? HUB_WELCOME_CLIPS[3]! : HUB_GREETING_CLIPS[0]!;
      this.playChain([clip], () => this.exitHelp());
      return;
    }
    this.playChain(HUB_HELP_CHAINS[zone - 1]!);
  }

  private introSeen(): boolean {
    const id = this.ctx.roster.currentPlayerId;
    return id === 0 ? this.session.anonymousIntroSeen : this.ctx.roster.roster.getVar(id, "hubPolyIntroSeen") !== 0;
  }

  private markIntroSeen(): void {
    const id = this.ctx.roster.currentPlayerId;
    if (id === 0) {
      this.session.anonymousIntroSeen = true;
      return;
    }
    this.ctx.roster.roster.setVar(id, "hubPolyIntroSeen", 1);
    this.ctx.roster.save();
  }

  // --- Jouets ---

  private onToy(index: number): void {
    if (this.busy) return;
    this.cutVoice();
    const toy = HUB_TOYS[index - 1]!;
    // Une animation déjà en cours pour ce jouet : on la laisse finir.
    if (this.toyRunning.has(toy.clip)) return;
    const handle = this.services.scr.start(this.archive, toy.clip, {
      flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground | SCR_FLAG.keepMidi,
      onEnd: () => {
        this.toyRunning.delete(toy.clip);
        if (toy.lever && !this.session.noAnimations && !this.busy) this.toggleSwitch(toy.lever);
      },
    });
    if (!handle.done) this.toyRunning.add(toy.clip);
  }

  private readonly toyRunning = new Set<number>();

  private toggleSwitch(name: HubSwitch): void {
    const key: LoopKey | "butterfly" = name;
    if (this.off.has(key)) {
      this.off.delete(key);
      if (key !== "butterfly") this.resumeLoop(key);
    } else {
      this.off.add(key);
      if (key !== "butterfly") this.freezeLoop(key, true);
    }
  }

  // --- Boucles d'ambiance ---

  private startLoops(): void {
    const { scr } = this.services;
    const easel = EASEL_SCRIPTS[this.ctx.rng.below(EASEL_SCRIPTS.length)]!;
    const list = [...LOOPS, { key: "easel" as const, script: easel }];
    this.loops = list.map(({ key, script }) => ({ key, handle: scr.start(this.archive, script, { flags: LOOP_FLAGS, loop: true }) }));
  }

  /** Gèle une boucle sur sa dernière image. `blackScreen` : la télé coupée par son levier montre un écran noir (SHAP 102). */
  private freezeLoop(key: LoopKey, blackScreen = false): void {
    const loop = this.loops.find((l) => l.key === key);
    if (!loop) return;
    loop.handle.interrupt();
    // L'écran noir est posé par `tick`, une fois le lecteur d'animations recomposé (sinon la restauration du fond l'efface).
    if (key === "television" && blackScreen) this.tvBlackPending = true;
  }

  private resumeLoop(key: LoopKey): void {
    const loop = this.loops.find((l) => l.key === key);
    if (!loop) return;
    this.tvBlackPending = false;
    if (key === "television") this.services.graphics.screen.restoreRect(this.tvBackground);
    loop.handle.rewind(true);
    this.ctx.requestPresent();
  }

  private drawButterfly(): void {
    const index = BUTTERFLY_SEQUENCE[this.butterflyTick % BUTTERFLY_SEQUENCE.length]!;
    drawShape(this.services.graphics.screen, this.archive.shap(BUTTERFLY_FIRST_SHAPE + index), BUTTERFLY_POSITION.x, BUTTERFLY_POSITION.y, 0);
  }

  private tickButterfly(): void {
    if (this.session.noAnimations || this.busy || this.monitorOpen || this.off.has("butterfly")) return;
    // Pas de papillon pendant un clip de Poly : leurs zones se recouvrent.
    if (this.polyClip) return;
    this.butterflyTick++;
    if (this.butterflyTick % BUTTERFLY_PERIOD !== 0) return;
    this.drawButterfly();
    this.ctx.requestPresent();
  }

  // --- Poly ---

  /** Zone sous Poly remise « sans Poly » (la main « stop » du mode aide reste en place). */
  private erasePoly(): void {
    this.services.graphics.screen.restoreRect(this.polyBackground);
    if (this.helpMode) this.drawStopHand();
    this.services.gadgets.invalidate();
  }

  private drawPolyIdle(): void {
    this.erasePoly();
    drawShape(this.services.graphics.screen, this.archive.shap(POLY_SHAPE), POLY_POSITION.x, POLY_POSITION.y, 8);
    if (this.helpMode) this.drawStopHand();
  }

  private drawStopHand(): void {
    drawShape(this.services.graphics.screen, this.archive.shap(STOP_SHAPE), STOP_POSITION.x, STOP_POSITION.y, 8);
  }

  /**
   * Joue un clip de Poly : la zone sous elle est d'abord remise « sans Poly », puis le clip (fond sauvegardé et restauré à chaque image)
   * dessine tout ; à sa fin, Poly au repos est redessinée par `tick`. `then` reçoit vrai si le clip a été interrompu par un clic.
   */
  private startPolyClip(id: number, options: { blocking: boolean; interruptible?: boolean; then?: (interrupted: boolean) => void }): void {
    const { scr } = this.services;
    this.erasePoly();
    const base = {
      flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | (options.blocking && options.interruptible ? SCR_FLAG.interruptible : 0),
      soundChannel: "voice" as const,
    };
    const done = (animation: AnimationHandle): void => {
      if (this.polyClip === animation) this.polyClip = null;
      this.polyIdleDirty = true;
      options.then?.(animation.state === "interrupted");
    };
    const handle = options.blocking ? scr.playBlocking(this.archive, id, base, done) : scr.start(this.archive, id, { ...base, onEnd: done });
    if (!handle.done) this.polyClip = handle;
  }

  /** Clips à la suite : le suivant ne part que si le précédent a été interrompu par un clic (`098a`). */
  private playChain(ids: readonly number[], then?: () => void): void {
    const [first, ...rest] = ids;
    if (first === undefined) {
      then?.();
      return;
    }
    this.startPolyClip(first, {
      blocking: true,
      interruptible: true,
      then: (interrupted) => {
        this.helpSince = this.ctx.clock.ticks;
        if (interrupted && rest.length > 0) this.playChain(rest, then);
        else then?.();
      },
    });
  }

  /** Clips joués tous jusqu'au bout, l'un après l'autre (introduction puis salutation). */
  private playSequence(ids: readonly number[], then: () => void): void {
    const [first, ...rest] = ids;
    if (first === undefined) {
      then();
      return;
    }
    this.startPolyClip(first, { blocking: true, interruptible: true, then: () => this.playSequence(rest, then) });
  }

  /** Coupe la voix de Poly en cours (`1020:1990(1)`). */
  private cutVoice(): void {
    this.polyClip?.interrupt();
    this.services.sound.stopVoice();
  }

  // --- Divers ---

  private startMusic(): void {
    const midi = this.ctx.resources.get(MIDI_ARCHIVE);
    if (midi) this.services.sound.playSound(midi, MIDI_ID, { ambient: true, loop: true });
  }

  /** Arme les minuteries d'ambiance une fois l'accueil terminé (`1346(0)`, `1380(0)`). */
  private armAmbient(): void {
    const { clock, rng } = this.ctx;
    this.ready = true;
    this.idleDeadline = clock.deadline(rng.range(...HUB_IDLE_CLIP_DELAY));
    this.chatterDeadline = clock.deadline(rng.range(...HUB_CHATTER_DELAY));
  }

  /** Aligne l'activité des groupes et des enregistrements sur l'état (mode normal, aide, invite, moniteur). */
  private syncRecords(): void {
    const objects = this.objects.records;
    const set = (record: GadgetRecord, disabled: boolean): void => {
      record.disabled = disabled;
    };
    for (let i = HUB_OBJECT.skylight1 - 1; i <= HUB_OBJECT.polyBody - 1; i++) set(objects[i]!, this.helpMode);
    set(objects[HUB_OBJECT.whistle - 1]!, !this.quit.open);
    set(objects[HUB_OBJECT.fullScreen - 1]!, !(this.quit.open || this.helpMode));
    this.objects.active = !this.monitorOpen && !this.busy;
    this.console.active = !this.helpMode && !this.monitorOpen && !this.busy;
    this.toys.active = !this.monitorOpen && !this.busy;
  }
}

export function createHubScene(services: MathServices, opts: HubOptions = {}): HubScene {
  return new Hub(services, opts);
}
