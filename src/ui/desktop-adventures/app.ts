import { AudioPlayer } from "../../engine/desktop-adventures/audio/audio";
import { COLOR_CYCLES, type Palette, PaletteAnimation } from "../../engine/desktop-adventures/data/palette";
import { type HelpContentsEntry, type HelpDocument, parseContents, parseHelp } from "../../engine/desktop-adventures/data/help";
import { Assets } from "../../engine/desktop-adventures/assets";
import { Game, GameEvent, type GameSnapshot, storyFromSnapshot } from "../../engine/desktop-adventures/game";
import { randomSeed } from "../../engine/desktop-adventures/rng";
import { WorldSize } from "../../engine/desktop-adventures/world";
import { VIEW_TILES, tileCanvas } from "../../engine/desktop-adventures/render/zone-renderer";
import { copy as shared } from "../copy";
import { h } from "../dom";
import { createFullscreen, type Fullscreen } from "../fullscreen";
import { createShellControls, type ShellControls, type ShellMenuEntry } from "../shell-controls";
import { type TouchMenu, TOUCH_LAYOUT_CLASS, createTouchMenu, isTouchDevice, layoutTouch } from "../touch-page";
import { titleScreen } from "../title-screen";
import { GameView } from "./game-view";
import { createSpeedSetting, nearestPreset, nextPreset } from "./game-speed";
import { MoveKeys } from "./move-keys";
import { renderManual } from "./manual";
import { stepToward, WalkCursors } from "./walk-cursor";
import { type AudioPrefs, audioPrefs } from "./audio-prefs";
import type { DesktopAdventure, DesktopCopy, DesktopResources } from "./definition";
import { type ProgressStore, createProgressStore } from "./progress";
import { type SaveSlot, createSaveSlot } from "./save";
import { Sidebar } from "./sidebar";

const AUTOSAVE_MS = 4000;
/** Place du panneau (santé, arme, inventaire) en disposition tactile : colonne de cette largeur à côté de l'écran, ou bande de cette hauteur dessous. */
const PANEL = { sideWidth: 232, bottomHeight: 176 };

/**
 * Interface commune des jeux « Desktop Adventures » (Indy, Yoda Stories) : écran titre, partie, panneau, carte, manuel.
 * Ce qui est propre à un jeu vient de sa `DesktopAdventure`.
 */
export class App {
  private readonly assets: Assets;
  private readonly copy: DesktopCopy;
  private readonly basePalette: Palette;
  private readonly loadManual: () => Promise<ArrayBuffer>;
  private readonly loadManualContents: (() => Promise<ArrayBuffer>) | undefined;
  private readonly saveSlot: SaveSlot;
  private readonly progressStore: ProgressStore;
  private readonly speedSetting: ReturnType<typeof createSpeedSetting>;
  private readonly audioPrefs: AudioPrefs;
  private readonly palette: PaletteAnimation;
  private readonly audio: AudioPlayer;
  private readonly view: GameView;
  private readonly sidebar: Sidebar;
  private readonly root: HTMLElement;
  private readonly gameScreen: HTMLElement;
  private readonly fullscreen: Fullscreen;
  /** Contrôles tactiles (Attaquer / Utiliser et bouton « Menu ») et leur menu ; écran tactile seulement. */
  private readonly controls: ShellControls;
  private readonly menu: TouchMenu;
  /** La partie était en pause quand le menu s'est ouvert : elle le reste à sa fermeture (sinon elle reprend). */
  private menuWasPaused = false;
  private game: Game | null = null;
  private timer = 0;
  private autosaveTimer = 0;
  private paused = false;
  private readonly keys = new MoveKeys();
  private readonly walkCursors: WalkCursors;
  /** Dernière position de la souris sur la vue (null pour le tactile ou hors de la vue). */
  private mouse: { x: number; y: number } | null = null;
  private pointerWalk: { id: number; x: number; y: number } | null = null;
  private itemDrag: { tile: number; ghost: HTMLElement; startX: number; startY: number; moved: boolean } | null = null;
  /** Réglages de l'écran titre. */
  private settings = { size: WorldSize.Medium as WorldSize, difficulty: 50 };
  /** Réglages de la partie en cours (ceux de la sauvegarde si elle est reprise) : le Replay de défaite les reprend. */
  private gameSettings = { ...this.settings };
  private manual: HelpDocument | null = null;
  private manualContents: HelpContentsEntry[] | null = null;
  /** Durée d'un tick (ms), mémorisée entre les parties. */
  private tickMs: number;

  constructor(
    container: HTMLElement,
    private readonly def: DesktopAdventure,
    { data, palette: basePalette, loadManual, loadManualContents, cursors, icons, bitmaps }: DesktopResources,
  ) {
    const copy = def.copy;
    this.copy = copy;
    this.basePalette = basePalette;
    this.loadManual = loadManual;
    this.loadManualContents = loadManualContents;
    this.progressStore = createProgressStore(`${def.key}-desktop-progress`, def.progress);
    this.speedSetting = createSpeedSetting(`${def.key}-desktop-speed`);
    this.audioPrefs = audioPrefs(def.key);
    this.tickMs = this.speedSetting.read();
    this.walkCursors = new WalkCursors(cursors, def.walkCursorFirstId);
    this.assets = new Assets(data);
    this.saveSlot = createSaveSlot(`${def.key}-desktop-save`, this.assets);
    this.palette = new PaletteAnimation(basePalette, COLOR_CYCLES[def.variant.id]);
    this.audio = new AudioPlayer(def.sounds);
    this.audio.soundEnabled = this.audioPrefs.readSound();
    this.audio.musicEnabled = this.audioPrefs.readMusic();
    this.view = new GameView(this.palette, this.audio, copy, def.locator, def.endPictures, bitmaps);
    this.view.onEnded = (kind) => {
      if (kind === "lose") {
        // Même objectif, nouvelle graine ; l'écran titre reste le recours si la génération échoue.
        const goal = this.game?.story.goalPuzzle;
        this.stopGame();
        this.saveSlot.clear();
        this.replayStory(goal, this.gameSettings).catch((e: unknown) => {
          console.error(e);
          this.showTitle();
        });
      }
    };
    this.sidebar = new Sidebar(basePalette, icons, def.compassIcons, copy, {
      onMap: () => void this.openMap(),
      onPause: () => this.togglePause(),
      onNewGame: () => this.showTitle(),
      onToggleSound: () => this.toggleSound(),
      onToggleMusic: () => this.toggleMusic(),
      onHelp: () => void this.showHelp(),
      onCycleSpeed: () => this.setSpeed(nextPreset(this.tickMs)),
      onItemPointerDown: (tile, e) => this.startItemDrag(tile, e),
      onItemUseOnHero: (tile) => {
        const game = this.game;
        if (game) game.requestPlacement(tile, game.hero.x, game.hero.y);
      },
    });
    // Attaquer et Utiliser : gros boutons au pouce, posés par la barre de contrôles hors de l'écran (écran tactile seulement).
    const bigButton = (label: string, name: string, action: () => void): HTMLButtonElement => {
      const button = h("button", { type: "button", class: "touch-button", "aria-label": name }, label);
      // Le toucher ne vole pas le focus au jeu.
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        this.audio.unlock();
        action();
      });
      return button;
    };
    const pad = h(
      "div",
      { class: "touch-buttons indy-pad" },
      bigButton(copy.attack, copy.attack, () => this.game?.requestAttack()),
      bigButton(copy.use, copy.useItem, () => {
        if (this.game && this.sidebar.selected !== null) this.game.useInFront(this.sidebar.selected);
      }),
    );
    this.controls = createShellControls({
      afterPress: () => {},
      menu: { label: shared.menu, onPress: () => this.openMenu() },
      onChange: () => this.relayout(),
    });
    // Deux boutons côte à côte sous l'écran, empilés en colonne de côté (tailles déclarées : leur forme change avec le placement).
    this.controls.addPad(pad, "start", { bottom: { width: 136, height: 64 }, sides: { width: 64, height: 136 } });
    // Retour à l'accueil comme dans les autres jeux ; la partie est sauvegardée avant que la page ne se recharge.
    const back = h("a", { class: "back-link desktop-only", href: "#/", onclick: () => this.autosave() }, shared.backToGames);
    this.gameScreen = h(
      "main",
      { class: `game-screen ${TOUCH_LAYOUT_CLASS} controls-bottom` },
      // Écran et panneau dans une même fenêtre grise sur ordinateur ; en tactile `.retro-window` s'efface (`display: contents`).
      h("div", { class: "retro-window" }, h("div", { class: "play-column" }, this.view.element), this.sidebar.element),
      h("div", { class: "game-footer desktop-only" }, this.sidebar.commands, back),
      this.controls.element,
    );
    this.menu = createTouchMenu({
      main: this.gameScreen,
      title: shared.menu,
      closeLabel: shared.menuClose,
      // Le jeu est en pause tant que le menu est ouvert, sauf s'il l'était déjà ; l'onglet masqué le garde en pause.
      onOpen: () => {
        this.menuWasPaused = this.paused;
        this.togglePause(true);
      },
      onClose: () => {
        if (!this.menuWasPaused && !document.hidden) this.togglePause(false);
      },
    });
    // Toute la page du jeu (écran, contrôles, panneau) passe en plein écran, en paysage sur écran tactile.
    this.fullscreen = createFullscreen(this.gameScreen, { label: shared.fullscreen, landscape: true, onChange: () => this.relayout() });
    window.addEventListener("resize", () => this.relayout());
    this.sidebar.addCommand(this.fullscreen.button);
    this.sidebar.soundButton.setAttribute("aria-pressed", String(this.audio.soundEnabled));
    this.sidebar.musicButton.setAttribute("aria-pressed", String(this.audio.musicEnabled));
    this.root = h("div", { class: "app" });
    container.replaceChildren(this.root);
    this.bindInput();
  }

  private toggleSound(): void {
    this.audio.soundEnabled = !this.audio.soundEnabled;
    this.sidebar.soundButton.setAttribute("aria-pressed", String(this.audio.soundEnabled));
    this.audioPrefs.writeSound(this.audio.soundEnabled);
  }

  private toggleMusic(): void {
    this.audio.musicEnabled = !this.audio.musicEnabled;
    if (!this.audio.musicEnabled) this.audio.stopMusic();
    this.sidebar.musicButton.setAttribute("aria-pressed", String(this.audio.musicEnabled));
    this.audioPrefs.writeMusic(this.audio.musicEnabled);
  }

  /**
   * Bouton « Menu » de la barre tactile : les commandes que le panneau porte sur ordinateur, plus Plein écran et Quitter. Le jeu est en
   * pause tant qu'il est ouvert (voir `createTouchMenu` ci-dessus) ; « Pause » y est une bascule : le jeu reste en pause à la fermeture.
   */
  private openMenu(): void {
    if (!this.game || this.view.modalOpen) return;
    const entries: ShellMenuEntry[] = [
      { label: this.copy.map, onPress: () => void this.openMap() },
      { label: this.copy.pause, pressed: this.paused, onPress: () => this.togglePause() },
      { label: this.copy.speedButton(this.copy.speeds[this.tickMs] ?? String(this.tickMs)), onPress: () => this.setSpeed(nextPreset(this.tickMs)) },
      { label: this.copy.help, onPress: () => void this.showHelp() },
      { label: this.copy.newGame, onPress: () => this.showTitle() },
      { label: this.copy.sound, pressed: this.audio.soundEnabled, onPress: () => this.toggleSound() },
      { label: this.copy.music, pressed: this.audio.musicEnabled, onPress: () => this.toggleMusic() },
      { label: shared.fullscreen, onPress: () => this.fullscreen.toggle() },
      {
        label: shared.quit,
        onPress: () => {
          this.autosave();
          location.hash = "#/";
        },
      },
    ];
    this.menu.open(entries);
  }

  /**
   * Écran tactile : l'écran carré prend le maximum de place (ratio 1:1), le panneau et les contrôles se placent dans le reste
   * (`layoutTouch`) ; la taille de l'écran passe par `--stage`, que lisent le cadre, les bulles et la carte. Ordinateur : feuille de style.
   */
  private relayout(): void {
    // Appelé aussi pendant la construction (ajout du bloc d'Attaquer / Utiliser), avant que la page n'existe.
    const page = this.gameScreen as HTMLElement | undefined;
    if (!page?.isConnected) return;
    if (!isTouchDevice()) {
      page.style.removeProperty("--stage");
      return;
    }
    const layout = layoutTouch({ main: page, controls: this.controls, logicalWidth: 1, logicalHeight: 1, panel: PANEL });
    page.style.setProperty("--stage", `${Math.floor(layout.scale)}px`);
  }

  // ---------------------------------------------------------------- écrans

  showTitle(): void {
    this.stopGame();
    // l'écran titre remplace la page du jeu ; une partie perdue relancée, elle, garde le plein écran
    this.fullscreen.exit();
    window.scrollTo(0, 0);
    const picture = h("canvas", { width: 288, height: 288, "aria-hidden": "true" });
    const ctx = picture.getContext("2d")!;
    const image = ctx.createImageData(288, 288);
    const rgba = new Uint32Array(image.data.buffer);
    this.assets.data.startupImage.forEach((c, i) => (rgba[i] = c ? this.basePalette[c] : 0xff000000));
    ctx.putImageData(image, 0, 0);

    const radios = <T extends number>(name: string, legend: string, options: Record<number, string>, current: T, set: (v: T) => void) =>
      h(
        "fieldset",
        { class: "choices" },
        h("legend", {}, legend),
        ...Object.entries(options).map(([value, label]) => {
          const input = h("input", { type: "radio", name, value, checked: Number(value) === current });
          input.addEventListener("change", () => set(Number(value) as T));
          return h("label", {}, input, h("span", {}, label));
        }),
      );

    const saved = this.saveSlot.read();
    let resumeSection: HTMLElement | null = null;
    if (saved) {
      const resume = h("button", { class: "primary", type: "button" }, this.copy.resumeGame);
      resume.addEventListener("click", () => {
        this.audio.unlock();
        this.resumeGame(saved).catch((e: unknown) => {
          // Reprise impossible malgré la validation : la sauvegarde est écartée, comme si elle n'existait pas.
          console.error(e);
          this.saveSlot.clear();
          this.showTitle();
        });
      });
      resumeSection = h("div", { class: "resume" }, resume, h("p", { class: "muted" }, this.copy.resumeHint));
      queueMicrotask(() => resume.focus());
    }
    const start = h("button", { class: saved ? "" : "primary", type: "button" }, this.copy.start);
    const status = h("p", { class: "status-line", role: "status" });
    const manual = h("button", { class: "secondary", type: "button", onclick: () => void this.showManual() }, this.copy.manual);
    const best = this.progressStore.read().bestScore;
    const bestLine = best !== undefined ? h("p", { class: "muted best-score" }, this.copy.bestScore(best)) : null;
    const replay = this.progressStore.read().history.length
      ? h("button", { class: "secondary", type: "button" }, this.copy.replayStory)
      : null;
    const launchers = [start, replay].filter((b): b is HTMLButtonElement => b !== null);
    const begin = (run: () => Promise<void>) => {
      this.audio.unlock();
      for (const b of launchers) b.disabled = true;
      status.textContent = this.copy.generating;
      // Laisse le navigateur afficher le message avant la génération (synchrone).
      window.setTimeout(() => {
        run().catch((e: unknown) => {
          console.error(e);
          status.textContent = String(e instanceof Error ? e.message : e);
          for (const b of launchers) b.disabled = false;
        });
      }, 30);
    };
    start.addEventListener("click", () => begin(() => this.startGame()));
    replay?.addEventListener("click", () => begin(() => this.replayStory()));
    this.root.replaceChildren(
      titleScreen(
        picture,
        resumeSection,
        h("h1", {}, this.copy.newGame),
        radios("size", this.copy.worldSize, this.copy.sizes, this.settings.size, (v) => (this.settings.size = v)),
        radios("difficulty", this.copy.difficulty, this.copy.difficulties, this.settings.difficulty, (v) => (this.settings.difficulty = v)),
        radios("speed", this.copy.gameSpeed, this.copy.speeds, nearestPreset(this.tickMs), (v) => this.setSpeed(v)),
        start,
        replay,
        status,
        bestLine,
        manual,
        h("ul", { class: "help-list" }, ...this.copy.helpText.map((t) => h("li", {}, t))),
      ),
    );
    if (!saved) queueMicrotask(() => start.focus());
  }

  /** Le manuel d'origine (DESKADV.HLP), lu à la première ouverture. */
  async showManual(): Promise<void> {
    window.scrollTo(0, 0);
    this.root.replaceChildren(h("p", { class: "boot", role: "status" }, this.copy.manualLoading));
    try {
      if (!this.manual) {
        const manual = parseHelp(await this.loadManual());
        // Le sommaire d'origine est un plus : sans lui, celui qui est déduit des liens suffit.
        const contents = this.loadManualContents ? await this.loadManualContents().catch(() => null) : null;
        this.manualContents = contents ? parseContents(contents, manual) : null;
        this.manual = manual;
      }
      this.root.replaceChildren(renderManual(this.manual, this.copy, () => this.showTitle(), this.manualContents));
    } catch (e) {
      console.error(e);
      this.root.replaceChildren(
        h("div", { class: "boot error", role: "alert" }, h("p", {}, this.copy.manualUnavailable), h("button", { type: "button", onclick: () => this.showTitle() }, this.copy.manualBack)),
      );
    }
  }

  /**
   * Nouvelle histoire. L'objectif est tiré selon l'historique et les victoires enregistrés, sauf si `goal` l'impose.
   * `record: false` (graine imposée en développement) laisse l'historique intact, pour retrouver le même monde.
   */
  async startGame(
    seed = randomSeed(),
    { goal, record = true, settings = this.settings }: { goal?: number; record?: boolean; settings?: { size: WorldSize; difficulty: number } } = {},
  ): Promise<void> {
    const progress = this.progressStore.read();
    const { story, start } = this.def.newStory(this.assets, seed, settings.size, progress, goal);
    if (record) this.progressStore.recordGoal(story.goalPuzzle, this.def.lastWorldOf?.(story));
    this.gameSettings = { ...settings };
    const game = this.launch(
      new Game(this.def.variant, this.assets, story, this.view, { difficulty: settings.difficulty, gamesWon: progress.victories }),
      record,
    );
    this.audio.playMusic(this.def.theme);
    await game.start(start.zone, start.at);
  }

  /**
   * « Rejouer cette histoire » : l'objectif donné (celui de la partie perdue) ou, à défaut, le dernier de
   * l'historique, avec une nouvelle graine et les réglages donnés (ceux de l'écran titre par défaut).
   */
  async replayStory(goal = this.progressStore.read().history.at(-1), settings = this.settings): Promise<void> {
    if (goal === undefined) throw new Error(this.copy.noStoryToReplay);
    await this.startGame(randomSeed(), { goal, settings });
  }

  async resumeGame(snapshot: GameSnapshot): Promise<void> {
    const story = storyFromSnapshot(snapshot);
    this.gameSettings = { size: story.size, difficulty: snapshot.settings.difficulty };
    // Une sauvegarde est une partie en cours : sa victoire compte (l'histoire a été enregistrée à son démarrage).
    const game = this.launch(new Game(this.def.variant, this.assets, story, this.view, snapshot.settings), true);
    await game.resume(snapshot);
  }

  /** `record` : la partie compte dans la progression (faux pour une graine imposée en développement). */
  private launch(game: Game, record: boolean): Game {
    this.game = game;
    if (record) game.addEventListener(GameEvent.Won, () => this.progressStore.recordVictory(game.finalScore ?? undefined));
    // Accès de débogage en développement uniquement (console : __indy.game, __yoda.game).
    if (import.meta.env.DEV) Object.assign(window, { [`__${this.def.key}`]: { game, app: this } });
    this.paused = false;
    this.palette.reset();
    this.root.replaceChildren(this.gameScreen);
    window.scrollTo(0, 0);
    this.relayout();
    this.sidebar.setPaused(false);
    this.view.attach(game);
    this.sidebar.attach(game);
    this.startTimer();
    this.sidebar.setSpeed(this.tickMs);
    window.clearInterval(this.autosaveTimer);
    this.autosaveTimer = window.setInterval(() => this.autosave(), AUTOSAVE_MS);
    return game;
  }

  private startTimer(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), this.tickMs);
  }

  /** Change la durée d'un tick, la mémorise et, en partie, relance la boucle à la nouvelle cadence. */
  private setSpeed(ms: number): void {
    this.tickMs = nearestPreset(ms);
    this.speedSetting.write(this.tickMs);
    this.sidebar.setSpeed(this.tickMs);
    if (this.game) this.startTimer();
  }

  /** Sauvegarde automatique, uniquement entre deux actions (jamais au milieu d'un script). */
  private autosave(): void {
    const game = this.game;
    if (!game || game.busy || game.over || this.view.modalOpen) return;
    this.saveSlot.write(game.snapshot());
  }

  private stopGame(): void {
    this.autosave();
    window.clearInterval(this.timer);
    window.clearInterval(this.autosaveTimer);
    this.audio.stopMusic();
    this.view.detach();
    this.game = null;
  }

  private tick(): void {
    const game = this.game;
    if (!game || this.paused) return;
    this.updateMove();
    this.palette.step();
    void game.step();
  }

  togglePause(force?: boolean): void {
    if (!this.game) return;
    this.paused = force ?? !this.paused;
    // Rien ne doit survivre à la pause : ni touche maintenue, ni appui bref qui déplacerait Indy à la reprise.
    if (!this.paused) this.keys.clear();
    this.sidebar.setPaused(this.paused);
    this.view.element.classList.toggle("paused", this.paused);
    this.view.element.dataset.pausedLabel = this.copy.paused;
  }

  private async openMap(): Promise<void> {
    const game = this.game;
    if (!game || this.view.modalOpen || game.busy) return;
    if (!game.requestMap()) {
      this.audio.play(this.def.variant.sounds.noGo);
      return;
    }
    game.consumeMapRequest();
    const wasPaused = this.paused;
    this.paused = true;
    this.audio.play(this.def.mapSounds?.open ?? -1);
    await this.view.showMap();
    this.audio.play(this.def.mapSounds?.close ?? -1);
    this.paused = wasPaused;
  }

  private async showHelp(): Promise<void> {
    if (!this.game || this.view.modalOpen) return;
    const wasPaused = this.paused;
    this.paused = true;
    await this.view.message(this.copy.helpText.join("\n"));
    this.paused = wasPaused;
  }

  // ---------------------------------------------------------------- entrées

  private bindInput(): void {
    window.addEventListener("keydown", (e) => {
      const game = this.game;
      // Une touche déjà prise (fermeture d'une bulle ou de la carte par Échap, Entrée ou Espace ; sélection d'un objet) n'agit pas en plus sur le jeu.
      if (e.defaultPrevented) return;
      if (!game || this.view.modalOpen) return;
      if (e.target instanceof HTMLInputElement || this.menu.isOpen) return;
      // La case d'arme est un bouton : Entrée et Espace l'activent (équiper), sans déclencher d'attaque.
      if ((e.code === "Space" || e.code === "Enter") && e.target instanceof Element && e.target.closest(".weapon-slot")) return;
      this.audio.unlock();
      if (MoveKeys.handles(e.code)) {
        e.preventDefault();
        if (!this.paused) this.keys.press(e.code);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) game.requestAttack();
      } else if (e.code === this.def.mapKey) {
        void this.openMap();
      } else if (e.code === "Escape") {
        this.togglePause();
      } else if (e.code === "KeyU" && this.sidebar.selected !== null) {
        game.useInFront(this.sidebar.selected);
      }
      game.input.drag = e.shiftKey;
    });
    window.addEventListener("keyup", (e) => {
      this.keys.release(e.code);
      if (this.game) this.game.input.drag = e.shiftKey;
    });
    window.addEventListener("blur", () => this.keys.clear());
    // Onglet masqué : pause automatique, pour ne pas laisser Indy sans défense.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.game && !this.paused) this.togglePause(true);
    });

    const canvas = this.view.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      const game = this.game;
      if (!game || this.view.modalOpen) return;
      this.audio.unlock();
      const tile = this.view.tileAt(e.clientX, e.clientY);
      if (!tile) return;
      if (this.sidebar.selected !== null) {
        game.requestPlacement(this.sidebar.selected, tile.x, tile.y);
        return;
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // pointeur déjà relâché ou événement synthétique : pas de capture, la marche suit quand même le pointeur
      }
      this.pointerWalk = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointermove", (e) => {
      this.mouse = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
      this.refreshCursor();
      if (this.pointerWalk?.id === e.pointerId) {
        this.pointerWalk.x = e.clientX;
        this.pointerWalk.y = e.clientY;
      }
    });
    const endWalk = (e: PointerEvent) => {
      if (this.pointerWalk?.id === e.pointerId) this.pointerWalk = null;
    };
    canvas.addEventListener("pointerleave", () => {
      this.mouse = null;
      this.refreshCursor();
    });
    canvas.addEventListener("pointerup", endWalk);
    canvas.addEventListener("pointercancel", endWalk);

    window.addEventListener("pointermove", (e) => this.moveItemDrag(e));
    window.addEventListener("pointerup", (e) => this.endItemDrag(e));
  }

  /** Direction courante : clavier, sinon pointeur maintenu sur la vue. */
  private updateMove(): void {
    const game = this.game;
    if (!game) return;
    let { x, y } = this.keys.direction();
    if (x === 0 && y === 0 && this.pointerWalk) {
      const target = this.view.tileAt(this.pointerWalk.x, this.pointerWalk.y);
      if (target) {
        ({ x, y } = stepToward(game.hero, target));
      }
    }
    game.input.move = { x: Math.sign(x), y: Math.sign(y) };
    this.refreshCursor();
  }

  /** Souris : flèche de la direction que prendrait Indy au clic ; curseur standard sur sa case ou sans souris. */
  private refreshCursor(): void {
    const canvas = this.view.canvas;
    const game = this.game;
    let css: string | null = null;
    // Pas de flèche pendant qu'un objet est sélectionné : le clic le dépose, il ne déplace pas Indy.
    if (game && this.mouse && !this.view.modalOpen && this.sidebar.selected === null) {
      const target = this.view.tileAt(this.mouse.x, this.mouse.y);
      if (target) {
        const tileSize = canvas.getBoundingClientRect().width / VIEW_TILES;
        css = this.walkCursors.css(stepToward(game.hero, target), WalkCursors.scaleFor(tileSize));
      }
    }
    canvas.style.cursor = css ?? "";
  }

  private startItemDrag(tile: number, e: PointerEvent): void {
    if (!this.game || e.button !== 0) return;
    this.audio.play(this.def.grabSound?.(tile) ?? -1);
    const ghost = h("div", { class: "drag-ghost", "aria-hidden": "true" }, tileCanvas(this.assets.tile(tile), this.basePalette, 48));
    this.itemDrag = { tile, ghost, startX: e.clientX, startY: e.clientY, moved: false };
  }

  private moveItemDrag(e: PointerEvent): void {
    const drag = this.itemDrag;
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      document.body.append(drag.ghost);
    }
    drag.ghost.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 24}px)`;
  }

  private endItemDrag(e: PointerEvent): void {
    const drag = this.itemDrag;
    this.itemDrag = null;
    if (!drag || !drag.moved) return;
    drag.ghost.remove();
    const tile = this.view.tileAt(e.clientX, e.clientY);
    if (tile && this.game) this.game.requestPlacement(drag.tile, tile.x, tile.y);
  }
}
