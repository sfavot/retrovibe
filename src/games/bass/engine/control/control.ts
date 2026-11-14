/**
 * Panneau de contrôle, pause, sauvegardes et restitutions du moteur : `GameControl` implémente `BassControl` (les mcodes `fnRestoreGame`,
 * `fnRestartGame`, `fnQuitToDos`) et pilote tout ce qui fige le jeu.
 *
 * Référence : ScummVM engines/sky/control.cpp (`Control::doControlPanel`, `doLoadSavePanel`, `restartGame`, `loadSaveAllowed`), sky.cpp
 * (`SkyEngine::handleKey` : F5, pause `p` avec `halvePalette`, touche qui reprend le jeu) et logic.cpp (`fnRestoreGame`, `fnRestartGame`,
 * `fnQuitToDos`), GPL v3 ou ultérieure, lus puis réécrits.
 *
 * **Ce que le moteur doit faire** (`engine.md` § 19) : à chaque `tick` de 20 ms, passer les entrées de l'hôte à `GameControl.tick` avant tout
 * le reste. Si elle rend `null`, le jeu est figé (panneau ouvert, pause, dialogue de restitution) : le moteur n'avance ni son horloge ni son tour ;
 * sinon elle rend les entrées à traiter (sans F5 ni pause, qu'elle a prises). Les restitutions s'appliquent entre deux tours (jamais pendant
 * un effet bloquant), comme les ouvertures du panneau et de la pause : `isBlocked` dit si un tour est en cours.
 *
 * **Dialogues du site** (D5) : « Sauvegarder » et « Restituer » demandent à l'hôte d'ouvrir les emplacements (`requestSave`, `requestRestore`) ;
 * l'hôte appelle `capture` et `load`, puis `finishDialog` à la fermeture. Le jeu reste figé pendant ce temps ; sauvegardée ou restituée, la
 * partie ferme le panneau (`GAME_SAVED`, `GAME_RESTORED`), annulée elle y revient. Les saves et restitutions du menu du site (sans panneau)
 * passent par les mêmes `capture` et `load`.
 *
 * Écarts volontaires : le panneau d'origine bloque ScummVM dans une boucle locale, ici c'est une séquence reprise à chaque tick ; `fnRestoreGame`
 * rend la main au tour qui l'a appelé avant de figer le jeu (le reste de ce tour s'exécute) ; la pause n'est prise qu'entre deux tours.
 */

import { SequenceRunner, waitUntil, type Sequence } from "../../../../engine/sequence";
import { LANGUAGE_FRENCH } from "../../data/ids";
import type { SkyDisk } from "../../data/disk";
import { SkyTexts } from "../../data/text";
import type { Compacts } from "../compacts";
import type { ItemCache } from "../files";
import type { BassHost, BassInput, BassSettings } from "../host";
import { SF } from "../ids";
import type { Logic, SystemVars } from "../logic";
import type { Mouse } from "../mouse";
import { captureSave, currentFont, cursorOf, resetUnsaved, restoreSave, saveRefusal, validateSave, type SaveContext, type SaveData, type SaveRefusal, type SaveSource } from "../save";
import type { BassControl, BassScreen, BassSound, BassText } from "../services";
import { applyTextVoiceMode, textVoiceModeOf } from "../text";
import type { ScriptVars } from "../vars";
import { displayOf, type ScreenLike } from "./display";
import { ControlPanel, type PanelAudio, type PanelDisplay } from "./panel";
import { PANEL_FONT } from "./layout";

export interface GameControlOptions {
  host: BassHost;
  vars: ScriptVars;
  compacts: Compacts;
  items: ItemCache;
  mouse: Mouse;
  system: SystemVars;
  screen: BassScreen;
  sound: BassSound;
  text: BassText;
  rng: { readonly state: number; seed(state: number): void };
  /** La logique est construite après le panneau (elle en dépend) : fournie à la demande. */
  logic: () => Logic;
  /** Octets d'un fichier de `sky.dsk` (sprites et palette du panneau, police 60520, textes de la section 7). */
  loadFile(id: number): Uint8Array;
  /** `Control::restartGame` du moteur (`BassEngine.restartGame`) : remise à zéro par les données de `sky.cpt`. */
  restart(): void;
  /** Curseur rendu par la dernière remise à zéro (`BassEngine.savedMouse`). */
  savedMouse(): number;
  /** Mots des compacts de `sky.cpt` (`SkyCpt.raw`) : « Recommencer » et les restitutions n'en laissent aucun état résiduel. */
  pristine: Uint16Array;
  /** Un tour de jeu est en cours (effet bloquant) : rien ne se sauvegarde, ne se restitue ni ne s'ouvre avant sa fin. */
  isBlocked(): boolean;
  /** Questions du panneau (`copy.ts`). */
  restartQuestion: string;
  quitQuestion: string;
  /** Pour tester sans écran réel : remplace le dessin du panneau (par défaut `displayOf(screen)`). */
  display?: PanelDisplay | null;
}

/** Volume de la musique sans service son : celui du banc (`music_volume` par défaut de ScummVM, 192 sur 256, soit 96 sur 127). */
const DEFAULT_MUSIC_VOLUME = 96;

function audioOf(sound: BassSound): PanelAudio | null {
  const audio = sound as unknown as Partial<PanelAudio>;
  return typeof audio.musicVolume === "number" && typeof audio.fxOff === "boolean" && typeof audio.speechOn === "boolean" ? (audio as PanelAudio) : null;
}

/** Ce qu'un dialogue du site a donné. */
type DialogOutcome = "saved" | "restored" | "cancelled" | "unavailable";

export class GameControl implements BassControl, SaveSource {
  readonly host: BassHost;
  readonly vars: ScriptVars;
  readonly compacts: Compacts;
  readonly items: ItemCache;
  readonly mouse: Mouse;
  readonly system: SystemVars;
  readonly screen: BassScreen;
  readonly sound: BassSound;
  readonly text: BassText;
  readonly rng: { readonly state: number; seed(state: number): void };
  readonly pristine: Uint16Array;
  readonly panel: ControlPanel;
  private readonly runner: SequenceRunner;
  private readonly audio: PanelAudio | null;
  private ticks = 0;
  private volume = DEFAULT_MUSIC_VOLUME;
  private wantPanel = false;
  private wantPause = false;
  private isPaused = false;
  private pendingLoad: { save: SaveData } | null = null;
  /** Dialogue du site en attente (ouvert par le panneau ou par `fnRestoreGame`). */
  private dialog: { kind: "save" | "restore"; saved: boolean; restored: boolean; closed: boolean; fromPanel: boolean } | null = null;
  /** Curseur et police du jeu pendant que le panneau est ouvert, et ce qu'il remettra en sortant. */
  private panelContext: SaveContext | null = null;

  constructor(private readonly options: GameControlOptions) {
    this.host = options.host;
    this.vars = options.vars;
    this.compacts = options.compacts;
    this.items = options.items;
    this.mouse = options.mouse;
    this.system = options.system;
    this.screen = options.screen;
    this.sound = options.sound;
    this.text = options.text;
    this.rng = options.rng;
    this.pristine = options.pristine;
    this.audio = audioOf(options.sound);
    if (this.audio) this.volume = this.audio.musicVolume;
    this.runner = new SequenceRunner({ now: () => this.ticks, takeSkip: () => false, interrupted: () => false });
    const texts = new SkyTexts({ load: options.loadFile } as unknown as SkyDisk, LANGUAGE_FRENCH);
    this.panel = new ControlPanel({
      loadFile: options.loadFile,
      getText: (n) => texts.getText(n),
      system: this.system,
      mouse: this.mouse,
      display: options.display === undefined ? displayOf(options.screen as unknown as ScreenLike) : options.display,
      audio: this.audio,
      restartQuestion: options.restartQuestion,
      quitQuestion: options.quitQuestion,
      musicVolume: () => this.settings.musicVolume,
      setMusicVolume: (volume) => this.setMusicVolume(volume),
      hooks: {
        saveAllowed: () => saveRefusal(this) === null,
        dialog: (kind) => this.openDialog(kind),
        restart: () => this.restartFromPanel(),
        quit: () => this.quit(),
        changed: () => this.host.settingsChanged?.(this.settings),
      },
    });
  }

  get logic(): Logic {
    return this.options.logic();
  }

  // --- État ---

  /** Le panneau de contrôle est ouvert. */
  get panelOpen(): boolean {
    return this.runner.active;
  }

  /** Le jeu est en pause (`p`). */
  get paused(): boolean {
    return this.isPaused;
  }

  /** Le jeu est figé : panneau, pause ou dialogue de restitution. `tick` rend alors `null`. */
  get frozen(): boolean {
    return this.runner.active || this.isPaused || (this.dialog !== null && !this.options.isBlocked());
  }

  // --- Réglages ---

  /** Réglages courants du panneau (à mémoriser par l'hôte, `BassHost.settingsChanged`). */
  get settings(): BassSettings {
    const flags = this.system.systemFlags;
    return {
      musicVolume: this.audio ? this.audio.musicVolume : this.volume,
      gameSpeed: this.system.gameSpeed,
      fxOff: (flags & SF.FX_OFF) !== 0,
      textMode: textVoiceModeOf(flags),
    };
  }

  /** Applique des réglages mémorisés (au démarrage) ; sans notification à l'hôte. */
  applySettings(settings: Partial<BassSettings>): void {
    if (settings.musicVolume !== undefined) this.setMusicVolume(settings.musicVolume);
    if (settings.gameSpeed !== undefined) this.system.gameSpeed = settings.gameSpeed;
    if (settings.fxOff !== undefined) {
      if (settings.fxOff) this.system.systemFlags |= SF.FX_OFF;
      else this.system.systemFlags &= ~SF.FX_OFF;
      if (this.audio) this.audio.fxOff = settings.fxOff;
    }
    if (settings.textMode !== undefined) applyTextVoiceMode(this.system, settings.textMode, this.audio ?? undefined);
  }

  private setMusicVolume(volume: number): void {
    this.volume = volume;
    if (this.audio) this.audio.musicVolume = volume;
  }

  // --- Boucle ---

  /**
   * À appeler à chaque tick de 20 ms avec les entrées de l'hôte. Rend les entrées que le jeu doit traiter, ou `null` si le jeu est figé
   * (le moteur n'avance alors ni son horloge ni son tour).
   */
  tick(inputs: readonly BassInput[]): readonly BassInput[] | null {
    this.ticks++;
    if (this.pendingLoad && !this.options.isBlocked()) {
      const { save } = this.pendingLoad;
      this.pendingLoad = null;
      this.applyLoad(save);
    }
    if (this.runner.active) {
      this.panel.feed(inputs);
      this.runner.step();
      return null;
    }
    if (this.dialog && !this.dialog.fromPanel && this.dialog.closed) this.dialog = null;
    if (this.isPaused) {
      this.tickPaused(inputs);
      return null;
    }

    const isKey = (e: BassInput): boolean => e.type === "action" && (e.action === "panel" || e.action === "pause");
    for (const event of inputs) {
      if (event.type !== "action") continue;
      if (event.action === "panel") this.wantPanel = true;
      else if (event.action === "pause") this.wantPause = true;
    }
    const rest = inputs.some(isKey) ? inputs.filter((e) => !isKey(e)) : inputs;
    if (!this.options.isBlocked()) {
      if (this.wantPanel) {
        this.wantPanel = this.wantPause = false;
        this.openPanel();
        return null;
      }
      if (this.wantPause) {
        this.wantPause = false;
        this.pause();
        return null;
      }
      if (this.dialog) return null;
    }
    return rest;
  }

  /** `doControlPanel` (F5). Sans effet si le panneau est déjà ouvert ou si un tour est en cours. */
  openPanel(): void {
    if (this.runner.active || this.options.isBlocked()) return;
    this.panelContext = { mouseType: this.mouse.cursor, charSet: currentFont(this.text), cursor: cursorOf(this.mouse) };
    (this.text as unknown as { setFont?(font: number): void }).setFont?.(PANEL_FONT);
    this.screen.clearScreen();
    this.runner.start(this.panelSequence());
  }

  private *panelSequence(): Sequence {
    try {
      yield* this.panel.run();
    } finally {
      this.closePanel();
    }
  }

  /** Sortie du panneau : `forceRefresh`, palette du jeu, curseur et police d'avant (ou ceux de la partie restituée). */
  private closePanel(): void {
    const context = this.panelContext;
    this.panelContext = null;
    this.screen.reset();
    this.screen.setPalette(this.system.currentPalette);
    if (context) this.finishLoad(context);
  }

  /** Remet le curseur et la police du jeu (`spriteMouse(_savedMouse, 0, 0)`, `fnSetFont(_savedCharSet)`). */
  private finishLoad(context: SaveContext): void {
    this.mouse.sprite(context.cursor.cursor, context.cursor.hotspot[0], context.cursor.hotspot[1]);
    this.mouse.objectCursor = context.cursor.objectCursor;
    (this.text as unknown as { setFont?(font: number): void }).setFont?.(context.charSet);
  }

  // --- Pause ---

  private pause(): void {
    (this.screen as unknown as { halvePalette?(): void }).halvePalette?.();
    this.sound.pauseFx();
    this.isPaused = true;
  }

  /** Pause : le pointeur suit, une touche ou une action reprend le jeu (et n'est pas transmise). */
  private tickPaused(inputs: readonly BassInput[]): void {
    for (const event of inputs) {
      if (event.type === "move" || event.type === "click") {
        if (!(this.system.systemFlags & SF.MOUSE_LOCKED)) this.mouse.moved(event.x, event.y);
      } else if (event.type === "action") {
        this.isPaused = false;
        this.sound.unPauseFx();
        this.screen.setPalette(this.system.currentPalette);
        return;
      }
    }
  }

  // --- Dialogues du site ---

  /** Demande à l'hôte d'ouvrir le dialogue ; `null` s'il n'en a pas. */
  private startDialog(kind: "save" | "restore", fromPanel: boolean): NonNullable<GameControl["dialog"]> | null {
    const request = kind === "save" ? this.host.requestSave : this.host.requestRestore;
    if (!request) return null;
    const dialog = { kind, saved: false, restored: false, closed: false, fromPanel };
    this.dialog = dialog;
    request.call(this.host);
    return dialog;
  }

  /** Dialogue ouvert par le panneau : attend sa fermeture. */
  private *openDialog(kind: "save" | "restore"): Sequence<DialogOutcome> {
    const dialog = this.startDialog(kind, true);
    if (!dialog) return "unavailable";
    yield* waitUntil(() => dialog.closed);
    this.dialog = null;
    return dialog.restored ? "restored" : dialog.saved ? "saved" : "cancelled";
  }

  /** L'hôte a fermé son dialogue (emplacement choisi ou non) : le panneau ou le jeu reprend. */
  finishDialog(): void {
    if (this.dialog) this.dialog.closed = true;
  }

  // --- Sauvegarde et restitution ---

  /** Curseur et police à garder dans une sauvegarde : ceux du jeu, pas ceux du panneau. */
  private context(): SaveContext {
    return this.panelContext ?? { mouseType: this.mouse.cursor, charSet: currentFont(this.text), cursor: cursorOf(this.mouse) };
  }

  /** `prepareSaveData` : l'état de la partie, ou pourquoi elle ne peut pas être sauvegardée maintenant. */
  capture(): SaveData | SaveRefusal {
    if (this.options.isBlocked()) return "busy";
    const refusal = saveRefusal(this);
    if (refusal) return refusal;
    const save = captureSave(this, this.context());
    if (this.dialog) this.dialog.saved = true;
    return save;
  }

  /**
   * `parseSaveData` : reprend une sauvegarde. Faux, sans rien changer, si elle n'est pas lisible pour ce jeu ; vrai sinon. Pendant un tour
   * (effet bloquant) la reprise attend sa fin, puis s'applique au tick suivant.
   */
  load(save: SaveData): boolean {
    if (!validateSave(this.compacts, save)) return false;
    if (this.dialog) this.dialog.restored = true;
    if (this.options.isBlocked()) this.pendingLoad = { save };
    else this.applyLoad(save);
    return true;
  }

  private applyLoad(save: SaveData): void {
    const context = restoreSave(this, save);
    if (!context) throw new Error("GameControl : sauvegarde devenue illisible");
    if (this.panelContext) {
      this.panelContext = context; // le panneau le remettra en se fermant
      this.panel.close();
    } else {
      this.screen.reset();
      this.screen.setPalette(this.system.currentPalette);
      this.finishLoad(context);
    }
  }

  // --- BassControl ---

  /** `fnRestoreGame` : l'hôte ouvre la restitution ; le jeu reste figé jusqu'à sa fermeture. */
  restoreGame(): void {
    if (this.dialog || this.runner.active) return;
    if (!this.startDialog("restore", false)) this.host.log?.("fnRestoreGame : l'hôte n'a pas de dialogue de restitution");
  }

  /** `fnRestartGame`. */
  restartGame(): void {
    this.options.restart();
    resetUnsaved(this.compacts, this.pristine);
  }

  /** « Recommencer » du panneau : remise à zéro, puis le panneau remet l'écran en se fermant. */
  private restartFromPanel(): void {
    this.restartGame();
    const mouseType = this.options.savedMouse();
    this.panelContext = { mouseType, charSet: 0, cursor: { cursor: mouseType, hotspot: [0, 0], objectCursor: -1 } };
  }

  /** `fnQuitToDos` : retour à l'écran titre. */
  quit(): void {
    this.host.exit();
  }
}
