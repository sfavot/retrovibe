/**
 * Moniteur de Poly (segment `1080` de l'original, `docs/mathemagique/screens/common.md` §3 et §4) : écran dessiné par le code, qui monte du
 * bas et se pose sur la scène courante. Quatre vues : connexion (3 noms à la fois), édition du roster (Add / Delete), préférences (Ambient
 * Sounds, Click & Stick Mouse, timer du Bowling) et Math Trivia (dessin + histoire de Poly). Utilisable depuis n'importe quelle scène
 * (accueil, Bowling, Pattern Windows) : la scène crée un `MonitorOverlay`, appelle `tick` / `key` / `dispose` de ses propres méthodes.
 *
 * Contrat de la scène (voir `docs/mathemagique/screens/common.md`, « Implémentation (moniteur) ») :
 *  - `archive` est `MAINSCRN.DAT` (formes `SHPL 50000`, `SHPL 400–418` et `301–320`, `SCR` de Poly, sons 3044–3052) ;
 *  - `font` est `NCSCLB10.FON` (`loadMonitorFont`) ;
 *  - `sceneGroups()` rend les groupes de gadgets de la scène : désactivés pendant que le moniteur est ouvert, réactivés à la fermeture
 *    (le gestionnaire de gadgets teste les groupes dans l'ordre d'ajout : sans cela un groupe plein écran de la scène capterait les clics) ;
 *  - `tick()` à chaque `Scene.tick` (après le crochet des services : le moniteur se redessine par-dessus), `key(event)` dans `Scene.key`
 *    (vrai = touche consommée), `dispose()` dans `Scene.leave`.
 *
 * Dessin : à chaque tick, restauration du fond sauvegardé à l'ouverture puis dessin complet (cadre, écran, vue, boutons). Rien n'est donc
 * laissé par une vue précédente, mais la scène ne doit pas animer sous le moniteur (le hub n'anime rien tant qu'il est ouvert).
 *
 * Roster : le moniteur écrit dans `ctx.roster` (`RosterState`) et l'enregistre à chaque création, suppression et fermeture. Le joueur
 * courant est `ctx.roster.currentPlayerId`, mis à jour au fil des clics. Les préférences s'appliquent tout de suite : le son (`ambient`)
 * et le pointeur (`clickAndStick`) relisent le roster à chaque demande ; le timer est pris à la fermeture s'il vaut 1 à 999 s.
 */
import type { Archive } from "../../engine/resources";
import { GadgetGroup, rectFromEdges, type GadgetRecord, type GadgetSpec } from "../../engine/gadgets";
import { drawShape } from "../../engine/graphics/blit";
import type { FonFont } from "../../engine/graphics/fon";
import { parseFon } from "../../engine/graphics/fon";
import type { Rect, SavedRect } from "../../engine/graphics/surface";
import { drawText, measureText } from "../../engine/graphics/text";
import type { Host } from "../../engine/host";
import type { KeyEvent } from "../../engine/input";
import { NoRepeatPool } from "../../engine/rng";
import { MAX_PLAYERS, canAppendNameChar, formatPlayerName, type PlayerInfo } from "../../engine/roster";
import type { AnimationHandle } from "../../engine/scr-player";
import { SCR_FLAG } from "../../engine/scr-player";
import type { SceneContext } from "../../engine/scene";
import type { MathServices } from "../../engine/services";
import type { SoundHandle } from "../../engine/sound";
import { TAG_SCR, TAG_SND } from "../../data/mohawk";
import { MONITOR_NAME_RULES } from "./name-text";
import { NULL_TEXT_INPUT, type TextInputPort } from "./text-input";

export type MonitorMode = "signin" | "roster" | "preferences" | "trivia";

export interface MonitorOptions {
  ctx: SceneContext;
  services: MathServices;
  /** `MAINSCRN.DAT`. */
  archive: Archive;
  /** `NCSCLB10.FON` (`loadMonitorFont`). */
  font: FonFont;
  /** Pont vers le clavier virtuel ; sans lui, la saisie ne passe que par `key`. */
  textInput?: TextInputPort;
  /** Groupes de gadgets de la scène, à neutraliser pendant que le moniteur est ouvert. */
  sceneGroups?: () => readonly GadgetGroup[];
  /** Vrai dans le hub : les retours d'erreur sont les clips de Poly (`SCR`) plutôt que des sons (`common.md` §3.4). */
  hub?: boolean;
}

export interface MonitorOpenOptions {
  /** Séquence secrète reconnue (`SHPL` 301 à 320, sans 314) : la vue Trivia montre cette photo, sans histoire. */
  secretPhoto?: number;
}

/** Ce que la scène apprend à la fermeture. */
export interface MonitorResult {
  mode: MonitorMode;
  /** Joueur sélectionné à la fermeture (0 = personne). */
  playerId: number;
  /** Joueur sélectionné à l'ouverture. */
  previousPlayerId: number;
  /** Dernier joueur créé pendant cette ouverture (0 = aucun). */
  createdPlayerId: number;
  /** « Ambient Sounds » a changé : la scène coupe ou relance sa musique (`1020:1e35`). */
  ambientChanged: boolean;
}

/** Charge `NCSCLB10.FON` (police du moniteur). */
export async function loadMonitorFont(host: Pick<Host, "loadFile">): Promise<FonFont> {
  return parseFon(await host.loadFile("NCSCLB10.FON"))[0]!;
}

// --- Géométrie (common.md §3.1, §3.2) ---

const FRAME_X = 244;
const FRAME_REST_Y = 240;
const FRAME_START_Y = 432;
const SLIDE_STEP = 15;
/** Ticks par pas de glissement de 15 px (hypothèse : l'original ne s'en tient qu'aux sons de 1,1 s ; ≈ 0,4 s au total). */
const SLIDE_STEP_TICKS = 2;
const BACKGROUND: Rect = { x: FRAME_X, y: FRAME_REST_Y, w: 248, h: FRAME_START_Y - FRAME_REST_Y };
const SCREEN_X = 291;
const SCREEN_Y = 282;
const PANEL_X = 312;
const PANEL_Y = 298;
const TOGGLE_X = 315;
const TOGGLE_AMBIENT_Y = 312;
const TOGGLE_CLICK_Y = 329;
const TIMER_TEXT_X = 406;
const TIMER_TEXT_Y = 347;
const ROW_X = 334;
const ROW_W = 126;
const ROW_H = 22;
const ROW_Y0 = 296;
const ROW_TEXT_DX = 4;
const ROW_TEXT_DY = 5;
const VISIBLE_ROWS = 3;
/** Un nom doit rester plus étroit que 110 px dans la police `NCSclB10`. */
const NAME_MAX_WIDTH = 110;
/** Un second clic sur la même ligne dans ce délai vaut OK (`835d = maintenant + 15`). */
const DOUBLE_CLICK_TICKS = 15;
const CARET_TICKS = 15;
const TIMER_MAX_DIGITS = 3;

// Couleurs de la palette du hub : écran sombre, texte blanc, bleu clair des boutons.
const COLOR_SCREEN = 201;
const COLOR_TEXT = 10;
const COLOR_HOVER = 184;

// Formes `SHPL 50000`.
const SHAPE_FRAME = 50000;
const SHAPE_SCREEN = 50001;
const SHAPE_PANEL = 50018;
const SHAPE_ON = 50019;
const SHAPE_OFF = 50020;

// Sons de l'interface (`MAINSCRN.DAT`).
const SND_CLICK = 3044;
const SND_OK = [3045, 3046] as const;
const SND_ARROW = 3047;
const SND_TOGGLE = 3048;
const SND_CLOSED = 3049;
const SND_CLOSING = 3050;
const SND_OPENING = 3051;
const SND_OPENED = 3052;
const SND_DUPLICATE = 18677;
const SNDS_FULL = [19656, 19657, 19658] as const;
const SCR_DUPLICATE = [8500, 8600, 8700] as const;
const SCR_FULL = [2600] as const;
const SCR_TRIVIA_INTRO = 5900;
const TRIVIA_COUNT = 19;
const PALETTE_PHOTO_FIRST = 216;
const PALETTE_PHOTO_COUNT = 18;

/** Indices 1 à 17 des enregistrements du groupe du moniteur (`DS:2d66…2ea6`). */
const R = { ok: 1, up: 2, down: 3, newPlayer: 4, roster: 5, prefs: 6, ambient: 7, click: 8, row1: 9, row2: 10, row3: 11, del: 12, add: 13, timer: 14, screen: 15, polyHead: 16, polyBody: 17 } as const;

const RECORDS: readonly GadgetSpec[] = [
  { rect: rectFromEdges(259, 266, 297, 303) },
  { rect: rectFromEdges(309, 294, 331, 329) },
  { rect: rectFromEdges(309, 330, 331, 365) },
  { rect: rectFromEdges(354, 366, 427, 387) },
  { rect: rectFromEdges(346, 368, 424, 390) },
  { rect: rectFromEdges(309, 365, 379, 387) },
  { rect: rectFromEdges(315, 312, 345, 328), focusable: true },
  { rect: rectFromEdges(315, 329, 345, 345), focusable: true },
  ...[0, 1, 2].map((k): GadgetSpec => ({ rect: rectFromEdges(ROW_X, ROW_Y0 + ROW_H * k, ROW_X + ROW_W, ROW_Y0 + ROW_H * (k + 1)) })),
  { rect: rectFromEdges(385, 365, 425, 387) },
  { rect: rectFromEdges(435, 365, 463, 387) },
  { rect: rectFromEdges(403, 346, 431, 359), focusable: false },
  { rect: rectFromEdges(291, 282, 478, 399), focusable: false },
  { rect: rectFromEdges(73, 245, 131, 321), focusable: false },
  { rect: rectFromEdges(56, 321, 149, 398), focusable: false },
];

type View = "list" | "edit" | "prefs" | "trivia";

/** Enregistrements actifs par vue (`1080:1f20`). */
const VIEW_RECORDS: Record<View, readonly number[]> = {
  list: [R.ok, R.up, R.down, R.newPlayer, R.row1, R.row2, R.row3],
  edit: [R.ok, R.up, R.down, R.prefs, R.row1, R.row2, R.row3, R.del, R.add],
  prefs: [R.ok, R.roster, R.ambient, R.click, R.timer],
  trivia: [R.ok, R.screen, R.polyHead, R.polyBody],
};
/** Pendant la saisie d'un nom : plus de liste ni de flèches ; New Player / Add valident le nom et ramènent la liste. */
const EDITING_RECORDS: Record<"list" | "edit", readonly number[]> = {
  list: [R.ok, R.newPlayer],
  edit: [R.ok, R.prefs, R.add],
};

/** Boutons à formes : `[normal, enfoncé]` et position de la forme. */
const BUTTONS: Readonly<Record<number, { shapes: readonly [number, number]; x: number; y: number }>> = {
  [R.ok]: { shapes: [50002, 50003], x: 259, y: 266 },
  [R.up]: { shapes: [50004, 50005], x: 310, y: 294 },
  [R.down]: { shapes: [50006, 50007], x: 310, y: 330 },
  [R.newPlayer]: { shapes: [50008, 50009], x: 354, y: 366 },
  [R.roster]: { shapes: [50010, 50011], x: 346, y: 368 },
  [R.prefs]: { shapes: [50012, 50013], x: 309, y: 365 },
  [R.del]: { shapes: [50014, 50015], x: 385, y: 365 },
  [R.add]: { shapes: [50016, 50017], x: 435, y: 365 },
};

type Phase = "closed" | "intro" | "opening" | "open" | "closing";

export class MonitorOverlay {
  private readonly ctx: SceneContext;
  private readonly services: MathServices;
  private readonly archive: Archive;
  private readonly font: FonFont;
  private readonly textInput: TextInputPort;
  private readonly sceneGroups: () => readonly GadgetGroup[];
  private readonly hub: boolean;
  /** Tirage sans remise des 19 trivias (`DS:2ede`) : dure autant que le moniteur. */
  private readonly triviaPool = new NoRepeatPool(TRIVIA_COUNT);

  private phase: Phase = "closed";
  private mode: MonitorMode = "signin";
  private view: View = "list";
  private onClose: ((result: MonitorResult) => void) | null = null;
  private group: GadgetGroup | null = null;
  private suspended: { group: GadgetGroup; active: boolean }[] = [];
  private background: SavedRect | null = null;
  private unsubscribeText: (() => void) | null = null;
  private frameY = FRAME_START_Y;
  private slideTicks = 0;
  private ticks = 0;

  private editing = false;
  private buffer = "";
  private scroll = 0;
  private timerText = "";
  private lastRowClick: { id: number; tick: number } | null = null;
  private allowDoubleClick = true;
  private previousPlayerId = 0;
  private createdPlayerId = 0;
  private ambientAtOpen = true;

  private secretPhoto = 0;
  private triviaNumber = 0;
  private photoPalette: Uint8Array | null = null;
  private story: AnimationHandle | null = null;
  private intro: AnimationHandle | null = null;
  private feedbackAnimation: AnimationHandle | null = null;
  private feedbackSounds: { ids: number[]; current: SoundHandle | null } | null = null;

  constructor(options: MonitorOptions) {
    this.ctx = options.ctx;
    this.services = options.services;
    this.archive = options.archive;
    this.font = options.font;
    this.textInput = options.textInput ?? NULL_TEXT_INPUT;
    this.sceneGroups = options.sceneGroups ?? (() => []);
    this.hub = options.hub ?? false;
  }

  get isOpen(): boolean {
    return this.phase !== "closed";
  }

  /** Vue courante (pour les scènes et les tests). */
  get currentMode(): MonitorMode {
    return this.mode;
  }

  /** Nom en cours de saisie (tel que tapé, avant mise en forme), ou `null` hors saisie. */
  get typedName(): string | null {
    return this.editing ? this.buffer : null;
  }

  /** Le moniteur est ouvert et attend des clics (ni en train de glisser, ni dans l'introduction de Poly). */
  get ready(): boolean {
    return this.phase === "open";
  }

  // --- Ouverture / fermeture ---

  /**
   * Ouvre le moniteur sur la vue `mode`. Sans effet s'il est déjà ouvert. `onClose` est appelé une fois, quand le moniteur a fini de
   * descendre (le roster est alors enregistré).
   */
  open(mode: MonitorMode, onClose: (result: MonitorResult) => void, options: MonitorOpenOptions = {}): void {
    if (this.phase !== "closed") return;
    const { roster } = this.ctx.roster;
    this.mode = mode;
    this.view = mode === "signin" ? "list" : mode === "roster" ? "edit" : mode === "preferences" ? "prefs" : "trivia";
    this.onClose = onClose;
    this.editing = false;
    this.buffer = "";
    this.scroll = 0;
    this.lastRowClick = null;
    this.allowDoubleClick = mode !== "preferences";
    this.previousPlayerId = this.ctx.roster.currentPlayerId;
    this.createdPlayerId = 0;
    this.ambientAtOpen = roster.ambient;
    this.timerText = String(roster.bowlingSeconds);
    this.secretPhoto = options.secretPhoto ?? 0;
    this.triviaNumber = 0;

    this.suspended = this.sceneGroups().map((group) => ({ group, active: group.active }));
    for (const entry of this.suspended) entry.group.active = false;
    this.group = this.services.gadgets.addGroup({
      id: "monitor",
      records: RECORDS,
      active: false,
      onActivate: (index, _record, activation) => this.onActivate(index, activation.source === "pointer"),
    });
    this.background = this.services.graphics.screen.saveRect(BACKGROUND);
    this.unsubscribeText = this.textInput.onText((text) => this.typeText(text));
    this.ctx.setCursor("arrow");

    if (mode === "signin" && this.list().length === 1 && this.ctx.roster.currentPlayerId === 0) this.select(this.list()[0]!.id);
    if (this.ctx.roster.currentPlayerId !== 0 && this.view !== "prefs" && this.view !== "trivia") this.ensureVisible(this.ctx.roster.currentPlayerId);

    this.frameY = FRAME_START_Y;
    this.slideTicks = 0;
    if (mode === "trivia" && this.archive.has(TAG_SCR, SCR_TRIVIA_INTRO)) {
      // Poly annonce la trivia avant que le moniteur monte (`1020:10e2(1, 4)`).
      this.phase = "intro";
      this.intro = this.services.scr.playBlocking(
        this.archive,
        SCR_TRIVIA_INTRO,
        { flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.interruptible | SCR_FLAG.restoreBackground, soundChannel: "voice" },
        () => {},
      );
    } else {
      this.startOpening();
    }
  }

  /** Ferme le moniteur (OK) : valide un nom en cours, puis le moniteur descend. Sans effet hors de l'état « ouvert ». */
  close(): void {
    if (this.phase !== "open") return;
    if (this.editing && this.commitName() === "refused") return;
    this.editing = false;
    if (this.view === "prefs") this.commitTimer();
    this.stopStory();
    this.stopFeedback();
    this.services.sound.stopVoice();
    this.group!.active = false;
    this.play(SND_CLOSING);
    this.phase = "closing";
    this.slideTicks = 0;
  }

  /** Sortie de scène : ferme tout de suite, sans animation ni rappel (le roster est quand même enregistré). */
  dispose(): void {
    if (this.phase === "closed") return;
    if (this.editing) this.commitName();
    if (this.view === "prefs") this.commitTimer();
    this.finish(false);
  }

  private startOpening(): void {
    this.intro = null;
    this.phase = "opening";
    this.slideTicks = 0;
    this.play(SND_OPENING);
  }

  private finish(notify: boolean): void {
    const screen = this.services.graphics.screen;
    if (this.background) screen.restoreRect(this.background);
    this.background = null;
    this.stopStory();
    this.stopFeedback();
    this.intro?.interrupt();
    this.intro = null;
    this.restorePhotoPalette();
    this.textInput.blur();
    this.unsubscribeText?.();
    this.unsubscribeText = null;
    if (this.group) this.services.gadgets.removeGroup(this.group);
    this.group = null;
    for (const entry of this.suspended) entry.group.active = entry.active;
    this.suspended = [];
    this.ctx.roster.save();
    const result: MonitorResult = {
      mode: this.mode,
      playerId: this.ctx.roster.currentPlayerId,
      previousPlayerId: this.previousPlayerId,
      createdPlayerId: this.createdPlayerId,
      ambientChanged: this.ctx.roster.roster.ambient !== this.ambientAtOpen,
    };
    const callback = this.onClose;
    this.onClose = null;
    this.editing = false;
    this.phase = "closed";
    this.ctx.requestPresent();
    if (notify) {
      this.play(SND_CLOSED);
      callback?.(result);
    }
  }

  // --- Tick ---

  /** À appeler à chaque `Scene.tick`. */
  tick(): void {
    if (this.phase === "closed") return;
    this.ticks++;
    switch (this.phase) {
      case "intro":
        if (this.intro?.done) this.startOpening();
        return;
      case "opening":
        if (this.slide(-1)) this.arrive();
        this.draw();
        return;
      case "closing":
        if (this.slide(1)) {
          this.finish(true);
          return;
        }
        this.draw();
        return;
      case "open":
        this.tickFeedback();
        this.syncRecords();
        this.draw();
        return;
    }
  }

  /** Fait avancer le cadre ; vrai quand il est arrivé. */
  private slide(direction: 1 | -1): boolean {
    if (++this.slideTicks < SLIDE_STEP_TICKS) return false;
    this.slideTicks = 0;
    this.frameY = Math.min(FRAME_START_Y, Math.max(FRAME_REST_Y, this.frameY + direction * SLIDE_STEP));
    return direction < 0 ? this.frameY === FRAME_REST_Y : this.frameY === FRAME_START_Y;
  }

  private arrive(): void {
    this.phase = "open";
    this.play(SND_OPENED);
    this.group!.active = true;
    this.syncRecords();
    if (this.view === "trivia") this.startTrivia();
    else if (this.view === "prefs") this.textInput.focus();
    else if (this.view === "list" && this.list().length === 0) this.beginEditing();
  }

  // --- Liste des joueurs ---

  private list(): PlayerInfo[] {
    return this.ctx.roster.roster.players();
  }

  private select(id: number): void {
    this.ctx.roster.currentPlayerId = id;
  }

  private ensureVisible(id: number): void {
    const list = this.list();
    const index = list.findIndex((player) => player.id === id);
    if (index < 0) return;
    if (index < this.scroll) this.scroll = index;
    else if (index >= this.scroll + VISIBLE_ROWS) this.scroll = index - VISIBLE_ROWS + 1;
  }

  private clampScroll(): void {
    this.scroll = Math.max(0, Math.min(this.scroll, this.list().length - VISIBLE_ROWS));
  }

  // --- Activation des boutons ---

  /**
   * `fromPointer` faux : Entrée. Entrée vaut OK (`1080:0581`, `0xd` → bouton 1) quelle que soit la zone sous la souris : la souris reste
   * souvent sur New Player / une bascule après le clic, et l'Entrée du gestionnaire de gadgets l'activerait sinon. Seul un bouton qui a le
   * focus clavier (Tab) est activé par Entrée.
   */
  private onActivate(index: number, fromPointer: boolean): void {
    if (this.phase !== "open") return;
    if (!fromPointer && index !== R.ok && this.services.gadgets.focused?.index !== index) {
      this.pressOk();
      return;
    }
    switch (index) {
      case R.ok:
        this.pressOk();
        return;
      case R.up:
      case R.down: {
        const before = this.scroll;
        this.scroll += index === R.up ? -1 : 1;
        this.clampScroll();
        if (this.scroll !== before) this.play(SND_ARROW);
        return;
      }
      case R.newPlayer:
      case R.add:
        this.pressNew();
        return;
      case R.roster:
        this.setView("edit");
        return;
      case R.prefs:
        if (this.editing && this.commitName() === "refused") return;
        this.setView("prefs");
        return;
      case R.ambient:
        this.toggleAmbient();
        return;
      case R.click:
        this.ctx.roster.roster.clickAndStick = !this.ctx.roster.roster.clickAndStick;
        this.play(SND_TOGGLE);
        return;
      case R.row1:
      case R.row2:
      case R.row3:
        this.pressRow(index - R.row1);
        return;
      case R.del:
        this.pressDelete();
        return;
      case R.screen:
      case R.polyHead:
      case R.polyBody:
        if (fromPointer) this.pressTrivia();
        return;
      default:
        return;
    }
  }

  private pressOk(): void {
    if (this.editing && this.commitName() === "refused") return;
    this.play(SND_OK[this.ctx.rng.rand1(100) < 5 ? 0 : 1]);
    this.close();
  }

  private setView(view: View): void {
    if (this.view === "prefs") this.commitTimer();
    this.view = view;
    this.editing = false;
    this.play(SND_CLICK);
    if (view === "prefs") {
      this.timerText = String(this.ctx.roster.roster.bowlingSeconds);
      this.textInput.focus();
    } else {
      this.textInput.blur();
      this.clampScroll();
    }
  }

  private toggleAmbient(): void {
    const { roster } = this.ctx.roster;
    roster.ambient = !roster.ambient;
    if (!roster.ambient) this.services.sound.stopAmbient();
    this.play(SND_TOGGLE);
  }

  private pressRow(row: number): void {
    const player = this.list()[this.scroll + row];
    if (!player) return;
    const double = this.lastRowClick?.id === player.id && this.ticks - this.lastRowClick.tick <= DOUBLE_CLICK_TICKS;
    this.select(player.id);
    this.play(SND_CLICK);
    this.lastRowClick = { id: player.id, tick: this.ticks };
    if (double && this.allowDoubleClick) this.pressOk();
  }

  private pressDelete(): void {
    const id = this.ctx.roster.currentPlayerId;
    const { roster } = this.ctx.roster;
    if (id < 1 || roster.playerCount < 1 || !roster.removePlayer(id)) return;
    this.select(0);
    this.clampScroll();
    this.ctx.roster.save();
    this.play(SND_CLICK);
  }

  private pressTrivia(): void {
    if (this.ctx.input.ctrl) this.nextTrivia();
    else this.playStory();
  }

  // --- Saisie du nom ---

  private beginEditing(): void {
    if (this.editing) return;
    if (this.ctx.roster.roster.playerCount >= MAX_PLAYERS) {
      this.reportFull();
      return;
    }
    this.editing = true;
    this.buffer = "";
    this.textInput.focus();
  }

  /**
   * New Player / Add : commence la saisie d'un nom ; pendant une saisie, valide le nom et ramène la liste, le nouveau joueur sélectionné.
   * Enchaîner sur une saisie vide ferait disparaître le nom tapé sans montrer le joueur créé (la liste est masquée pendant la saisie).
   */
  private pressNew(): void {
    this.play(SND_CLICK);
    if (this.editing) {
      this.commitName();
      return;
    }
    this.beginEditing();
  }

  /**
   * Valide le nom saisi (`1c31`). `created` : joueur créé et sélectionné ; `none` : nom vide, la saisie s'arrête ; `refused` : doublon,
   * le joueur n'est pas créé ; ailleurs que dans le hub, le nom reste à corriger, dans le hub la liste revient (`showExisting`).
   */
  private commitName(): "created" | "none" | "refused" {
    const result = this.ctx.roster.roster.addPlayer(this.buffer, MONITOR_NAME_RULES);
    if (result.ok) {
      this.editing = false;
      this.buffer = "";
      this.select(result.id);
      this.createdPlayerId = result.id;
      this.ensureVisible(result.id);
      this.ctx.roster.save();
      this.textInput.blur();
      return "created";
    }
    if (result.reason === "duplicate") {
      this.reportDuplicate();
      // Dans le hub, Poly demande de cliquer sur son nom dans la liste : la saisie s'arrête pour la montrer, ce nom en vue.
      if (this.hub) this.showExisting(this.buffer);
      return "refused";
    }
    if (result.reason === "full") this.reportFull();
    this.editing = false;
    this.buffer = "";
    this.textInput.blur();
    return "none";
  }

  /** Arrête la saisie et fait défiler la liste jusqu'au joueur qui porte déjà ce nom (sans le sélectionner : c'est au joueur de cliquer). */
  private showExisting(raw: string): void {
    const name = formatPlayerName(raw, MONITOR_NAME_RULES);
    const existing = this.list().find((player) => player.name === name);
    this.editing = false;
    this.buffer = "";
    this.textInput.blur();
    if (existing) this.ensureVisible(existing.id);
  }

  private fitsWidth = (text: string): boolean => measureText(this.font, text) < NAME_MAX_WIDTH;

  // --- Clavier ---

  /** À appeler dans `Scene.key`. Vrai si la touche est consommée (tout l'est tant que le moniteur est ouvert, sauf Ctrl + touche). */
  key(event: KeyEvent): boolean {
    if (this.phase === "closed") return false;
    if (event.ctrl) return false;
    if (this.phase !== "open") return true;
    switch (event.key) {
      case "Enter":
        this.pressOk();
        return true;
      case "Backspace":
        this.backspace();
        return true;
      case "ArrowUp":
      case "ArrowDown":
        if (this.view === "list" || this.view === "edit") {
          if (!this.editing) this.onActivate(event.key === "ArrowUp" ? R.up : R.down, false);
        }
        return true;
    }
    if (event.key.length === 1) {
      if ((this.view === "list" || this.view === "edit") && !this.editing && event.key >= "1" && event.key <= "3") {
        this.pressRow(Number(event.key) - 1);
        return true;
      }
      this.typeChar(event.key);
    }
    return true;
  }

  /** Texte venu du clavier virtuel (`TextInputPort.onText`) : `\b` efface, `\n` valide. */
  typeText(text: string): void {
    if (this.phase !== "open") return;
    for (const c of text) {
      if (c === "\b") this.backspace();
      else if (c === "\n") this.pressOk();
      else this.typeChar(c);
    }
  }

  private typeChar(c: string): void {
    if (this.editing) {
      if (canAppendNameChar(this.buffer, c, this.fitsWidth, MONITOR_NAME_RULES)) this.buffer += c;
      return;
    }
    if (this.view === "prefs" && /^[0-9]$/.test(c)) {
      if (this.timerText === "0") this.timerText = c;
      else if (this.timerText.length < TIMER_MAX_DIGITS) this.timerText += c;
    }
  }

  private backspace(): void {
    if (this.editing) this.buffer = this.buffer.slice(0, -1);
    else if (this.view === "prefs") {
      this.timerText = this.timerText.slice(0, -1);
    }
  }

  /** Le timer est lu à la fermeture (et en quittant la vue) : pris s'il vaut 1 à 999 s, sinon l'ancienne valeur reste (`1080:08fe`). */
  private commitTimer(): void {
    const seconds = Number.parseInt(this.timerText || "0", 10);
    const { roster } = this.ctx.roster;
    if (seconds !== roster.bowlingSeconds) roster.setBowlingSeconds(seconds);
  }

  // --- Retours d'erreur ---

  private reportDuplicate(): void {
    if (this.hub) this.playScrChain([...SCR_DUPLICATE]);
    else this.play(SND_DUPLICATE);
  }

  private reportFull(): void {
    if (this.hub) this.playScrChain([...SCR_FULL]);
    else this.feedbackSounds = { ids: [...SNDS_FULL], current: null };
  }

  private playScrChain(ids: number[]): void {
    const available = ids.filter((id) => this.archive.has(TAG_SCR, id));
    const [id, ...rest] = available;
    if (id === undefined) return;
    this.feedbackAnimation?.interrupt();
    this.feedbackAnimation = this.services.scr.start(this.archive, id, {
      flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.restoreBackground,
      soundChannel: "voice",
      onEnd: (animation) => {
        if (this.phase === "closed" || animation.state !== "done") return;
        this.playScrChain(rest);
      },
    });
  }

  /** Enchaîne les sons d'un retour d'erreur (les trois voix de la liste pleine) à chaque fin de son. */
  private tickFeedback(): void {
    const feedback = this.feedbackSounds;
    if (!feedback) return;
    if (feedback.current && this.services.sound.isPlaying(feedback.current)) return;
    const next = feedback.ids.shift();
    if (next === undefined) {
      this.feedbackSounds = null;
      return;
    }
    feedback.current = this.archive.has(TAG_SND, next) ? this.services.sound.playSound(this.archive, next, { channel: "voice" }) : null;
  }

  private stopFeedback(): void {
    this.feedbackSounds = null;
    this.feedbackAnimation?.interrupt();
    this.feedbackAnimation = null;
  }

  private play(id: number): void {
    if (this.archive.has(TAG_SND, id)) this.services.sound.playSound(this.archive, id);
  }

  // --- Math Trivia ---

  private startTrivia(): void {
    if (this.secretPhoto !== 0) {
      this.showPhotoPalette();
      return;
    }
    this.triviaNumber = this.triviaPool.pick(this.ctx.rng) + 1;
    this.playStory();
  }

  /** Trivia suivante (Ctrl + clic) : image suivante du cycle 1…19 et nouvelle histoire. */
  private nextTrivia(): void {
    this.restorePhotoPalette();
    this.secretPhoto = 0;
    this.triviaNumber = this.triviaNumber === 0 ? this.triviaPool.pick(this.ctx.rng) + 1 : (this.triviaNumber % TRIVIA_COUNT) + 1;
    this.playStory();
  }

  /** Poly raconte l'histoire courante, `SCR 6100 + 100 × n` (rejouée depuis le début si elle est déjà en cours). */
  private playStory(): void {
    if (this.triviaNumber === 0) return;
    const id = 6100 + 100 * this.triviaNumber;
    this.stopStory();
    if (!this.archive.has(TAG_SCR, id)) return;
    this.story = this.services.scr.start(this.archive, id, {
      flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.restoreBackground,
      soundChannel: "voice",
    });
  }

  private stopStory(): void {
    this.story?.interrupt();
    this.story = null;
  }

  /** Les photos de l'équipe ont leur palette en entrées 216 à 233 (`10a8:0dc4(216, 18)`) ; rendue à la sortie. */
  private showPhotoPalette(): void {
    const { palette } = this.services.graphics;
    this.photoPalette = palette.snapshot(PALETTE_PHOTO_FIRST, PALETTE_PHOTO_COUNT);
    if (this.archive.has("SHPL", this.secretPhoto)) palette.loadShpl(this.archive.shpl(this.secretPhoto));
  }

  private restorePhotoPalette(): void {
    if (!this.photoPalette) return;
    this.services.graphics.palette.restore(this.photoPalette, PALETTE_PHOTO_FIRST);
    this.photoPalette = null;
  }

  // --- Dessin ---

  private syncRecords(): void {
    const group = this.group;
    if (!group) return;
    const visible = new Set(this.editing && (this.view === "list" || this.view === "edit") ? EDITING_RECORDS[this.view] : VIEW_RECORDS[this.view]);
    for (const record of group.records) record.hidden = !visible.has(record.index);
  }

  private shape(id: number): ReturnType<Archive["shap"]> | undefined {
    return this.archive.has("SHAP", id) ? this.archive.shap(id) : undefined;
  }

  private drawShapeId(id: number, x: number, y: number): void {
    const shape = this.shape(id);
    if (shape) drawShape(this.services.graphics.screen, shape, x, y, 8);
  }

  private text(text: string, x: number, y: number, color: number): number {
    return drawText(this.services.graphics.screen, this.font, text, x, y, color);
  }

  private draw(): void {
    const screen = this.services.graphics.screen;
    if (this.background) screen.restoreRect(this.background);
    this.drawShapeId(SHAPE_FRAME, FRAME_X, this.frameY);
    if (this.phase === "open") {
      this.drawShapeId(SHAPE_SCREEN, SCREEN_X, SCREEN_Y);
      if (this.view === "list" || this.view === "edit") this.drawRows();
      else if (this.view === "prefs") this.drawPreferences();
      else this.drawTrivia();
      this.drawButtons();
    }
    this.ctx.requestPresent();
  }

  private recordOf(index: number): GadgetRecord {
    return this.group!.record(index);
  }

  private drawButtons(): void {
    const gadgets = this.services.gadgets;
    for (const [key, button] of Object.entries(BUTTONS)) {
      const record = this.recordOf(Number(key));
      if (record.hidden) continue;
      const visual = gadgets.visualOf(record);
      const lit = visual === "pressed" || visual === "hover";
      this.drawShapeId(button.shapes[lit ? 1 : 0], button.x, button.y);
    }
  }

  private drawRows(): void {
    const screen = this.services.graphics.screen;
    const list = this.list();
    const current = this.ctx.roster.currentPlayerId;
    for (let k = 0; k < VISIBLE_ROWS; k++) {
      const y = ROW_Y0 + ROW_H * k;
      if (this.editing) {
        if (k === 1) {
          const width = this.text(this.buffer, ROW_X + ROW_TEXT_DX, y + ROW_TEXT_DY, COLOR_TEXT);
          if (Math.floor(this.ticks / CARET_TICKS) % 2 === 0) this.text("|", ROW_X + ROW_TEXT_DX + width, y + ROW_TEXT_DY, COLOR_TEXT);
        }
        continue;
      }
      const player = list[this.scroll + k];
      if (!player) continue;
      const row = this.recordOf(R.row1 + k);
      const visual = this.services.gadgets.visualOf(row);
      const selected = player.id === current;
      if (selected) screen.fill(COLOR_TEXT, { x: ROW_X, y: y + 1, w: ROW_W, h: ROW_H - 2 });
      else if (visual === "hover" || visual === "pressed") this.drawOutline({ x: ROW_X, y: y + 1, w: ROW_W, h: ROW_H - 2 });
      this.text(player.name, ROW_X + ROW_TEXT_DX, y + ROW_TEXT_DY, selected ? COLOR_SCREEN : COLOR_TEXT);
    }
  }

  private drawOutline(rect: Rect): void {
    const screen = this.services.graphics.screen;
    screen.fill(COLOR_HOVER, { x: rect.x, y: rect.y, w: rect.w, h: 1 });
    screen.fill(COLOR_HOVER, { x: rect.x, y: rect.y + rect.h - 1, w: rect.w, h: 1 });
    screen.fill(COLOR_HOVER, { x: rect.x, y: rect.y, w: 1, h: rect.h });
    screen.fill(COLOR_HOVER, { x: rect.x + rect.w - 1, y: rect.y, w: 1, h: rect.h });
  }

  private drawPreferences(): void {
    const { roster } = this.ctx.roster;
    this.drawShapeId(SHAPE_PANEL, PANEL_X, PANEL_Y);
    this.drawShapeId(roster.ambient ? SHAPE_ON : SHAPE_OFF, TOGGLE_X, TOGGLE_AMBIENT_Y);
    this.drawShapeId(roster.clickAndStick ? SHAPE_ON : SHAPE_OFF, TOGGLE_X, TOGGLE_CLICK_Y);
    const width = this.text(this.timerText, TIMER_TEXT_X, TIMER_TEXT_Y, COLOR_TEXT);
    if (Math.floor(this.ticks / CARET_TICKS) % 2 === 0) this.text("|", TIMER_TEXT_X + width, TIMER_TEXT_Y, COLOR_TEXT);
  }

  private drawTrivia(): void {
    const id = this.secretPhoto !== 0 ? this.secretPhoto : this.triviaNumber !== 0 ? 399 + this.triviaNumber : 0;
    if (id !== 0) this.drawShapeId(id, SCREEN_X, SCREEN_Y);
  }
}
