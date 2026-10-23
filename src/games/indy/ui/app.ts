import { AudioPlayer } from "../audio/audio";
import { type Palette, PaletteAnimation } from "../data/palette";
import type { Cursor } from "../data/resources";
import { type HelpDocument, parseHelp } from "../data/help";
import type { GameData } from "../data/types";
import { Assets, IndyIds, IndySounds } from "../engine/assets";
import { Game, GameEvent, type GameSnapshot, storyFromSnapshot } from "../engine/game";
import type { Point } from "../engine/geometry";
import { generateStory } from "../engine/generation/generator";
import { randomSeed } from "../engine/rng";
import { WorldSize } from "../engine/world";
import { VIEW_TILES, tileCanvas } from "../render/zone-renderer";
import { copy } from "../copy";
import { h } from "../../../ui/dom";
import { titleScreen } from "../../../ui/title-screen";
import { GameView } from "./game-view";
import { nearestPreset, nextPreset, speedSetting } from "./game-speed";
import { MoveKeys } from "./move-keys";
import { renderManual } from "./manual";
import { stepToward, WalkCursors } from "./walk-cursor";
import { progressStore } from "./progress";
import { saveSlot } from "./save";
import { Sidebar } from "./sidebar";

const AUTOSAVE_MS = 4000;
/** Case de départ : devant le bureau de Marcus, en ville. */
const START = { zone: IndyIds.townZone, at: { x: 11, y: 5 } };

export class App {
  private readonly assets: Assets;
  private readonly palette: PaletteAnimation;
  private readonly audio: AudioPlayer;
  private readonly view: GameView;
  private readonly sidebar: Sidebar;
  private readonly root: HTMLElement;
  private readonly gameScreen: HTMLElement;
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
  /** Durée d'un tick (ms), mémorisée entre les parties. */
  private tickMs = speedSetting.read();

  constructor(
    container: HTMLElement,
    data: GameData,
    private readonly basePalette: Palette,
    exe: ArrayBuffer,
    private readonly loadManual: () => Promise<ArrayBuffer>,
    cursors: Map<number, Cursor> = new Map(),
  ) {
    this.walkCursors = new WalkCursors(cursors);
    this.assets = new Assets(data);
    this.palette = new PaletteAnimation(basePalette);
    this.audio = new AudioPlayer(data.sounds, `${import.meta.env.BASE_URL}indy/`, exe);
    this.view = new GameView(this.palette, this.audio);
    this.view.onEnded = (kind) => {
      if (kind === "lose") {
        // Même objectif, nouvelle graine ; l'écran titre reste le recours si la génération échoue.
        const goal = this.game?.story.goalPuzzle;
        this.stopGame();
        saveSlot.clear();
        this.replayStory(goal, this.gameSettings).catch((e: unknown) => {
          console.error(e);
          this.showTitle();
        });
      }
    };
    this.sidebar = new Sidebar(basePalette, {
      onMap: () => void this.openMap(),
      onPause: () => this.togglePause(),
      onNewGame: () => this.showTitle(),
      onToggleSound: () => {
        this.audio.soundEnabled = !this.audio.soundEnabled;
        this.sidebar.soundButton.setAttribute("aria-pressed", String(this.audio.soundEnabled));
      },
      onToggleMusic: () => {
        this.audio.musicEnabled = !this.audio.musicEnabled;
        if (!this.audio.musicEnabled) this.audio.stopMusic();
        this.sidebar.musicButton.setAttribute("aria-pressed", String(this.audio.musicEnabled));
      },
      onHelp: () => void this.showHelp(),
      onCycleSpeed: () => this.setSpeed(nextPreset(this.tickMs)),
      onItemPointerDown: (tile, e) => this.startItemDrag(tile, e),
      onItemUseOnHero: (tile) => {
        const game = this.game;
        if (game) game.requestPlacement(tile, game.hero.x, game.hero.y);
      },
    });
    const touchBar = h(
      "div",
      { class: "touch-bar" },
      h("button", { type: "button", onclick: () => this.game?.requestAttack() }, copy.attack),
      h(
        "button",
        {
          type: "button",
          onclick: () => {
            if (this.game && this.sidebar.selected !== null) this.game.useInFront(this.sidebar.selected);
          },
        },
        copy.useItem,
      ),
    );
    this.gameScreen = h("main", { class: "game-screen" }, h("div", { class: "play-column" }, this.view.element, touchBar), this.sidebar.element);
    this.root = h("div", { class: "app" });
    container.replaceChildren(this.root);
    this.bindInput();
  }

  // ---------------------------------------------------------------- écrans

  showTitle(): void {
    this.stopGame();
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

    const saved = saveSlot.read();
    let resumeSection: HTMLElement | null = null;
    if (saved) {
      const resume = h("button", { class: "primary", type: "button" }, copy.resumeGame);
      resume.addEventListener("click", () => {
        this.audio.unlock();
        void this.resumeGame(saved);
      });
      resumeSection = h("div", { class: "resume" }, resume, h("p", { class: "muted" }, copy.resumeHint));
      queueMicrotask(() => resume.focus());
    }
    const start = h("button", { class: saved ? "" : "primary", type: "button" }, copy.start);
    const status = h("p", { class: "status-line", role: "status" });
    const manual = h("button", { class: "secondary", type: "button", onclick: () => void this.showManual() }, copy.manual);
    const replay = progressStore.read().history.length
      ? h("button", { class: "secondary", type: "button" }, copy.replayStory)
      : null;
    const launchers = [start, replay].filter((b): b is HTMLButtonElement => b !== null);
    const begin = (run: () => Promise<void>) => {
      this.audio.unlock();
      for (const b of launchers) b.disabled = true;
      status.textContent = copy.generating;
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
        h("h1", {}, copy.newGame),
        radios("size", copy.worldSize, copy.sizes, this.settings.size, (v) => (this.settings.size = v)),
        radios("difficulty", copy.difficulty, copy.difficulties, this.settings.difficulty, (v) => (this.settings.difficulty = v)),
        radios("speed", copy.gameSpeed, copy.speeds, nearestPreset(this.tickMs), (v) => this.setSpeed(v)),
        start,
        replay,
        status,
        manual,
        h("ul", { class: "help-list" }, ...copy.helpText.map((t) => h("li", {}, t))),
      ),
    );
    if (!saved) queueMicrotask(() => start.focus());
  }

  /** Le manuel d'origine (DESKADV.HLP), lu à la première ouverture. */
  async showManual(): Promise<void> {
    window.scrollTo(0, 0);
    this.root.replaceChildren(h("p", { class: "boot", role: "status" }, copy.manualLoading));
    try {
      this.manual ??= parseHelp(await this.loadManual());
      this.root.replaceChildren(renderManual(this.manual, () => this.showTitle()));
    } catch (e) {
      console.error(e);
      this.root.replaceChildren(
        h("div", { class: "boot error", role: "alert" }, h("p", {}, copy.manualUnavailable), h("button", { type: "button", onclick: () => this.showTitle() }, copy.manualBack)),
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
    const { history, victories } = progressStore.read();
    const story = generateStory(this.assets, seed, settings.size, { history, victories, goal });
    if (record) progressStore.recordGoal(story.goalPuzzle);
    this.gameSettings = { ...settings };
    const game = this.launch(new Game(this.assets, story, this.view, { difficulty: settings.difficulty }), record);
    this.audio.playMusic(IndySounds.Theme);
    await game.start(START.zone, this.freeCellNear(START.zone, START.at));
  }

  /**
   * « Rejouer cette histoire » : l'objectif donné (celui de la partie perdue) ou, à défaut, le dernier de
   * l'historique, avec une nouvelle graine et les réglages donnés (ceux de l'écran titre par défaut).
   */
  async replayStory(goal = progressStore.read().history.at(-1), settings = this.settings): Promise<void> {
    if (goal === undefined) throw new Error(copy.noStoryToReplay);
    await this.startGame(randomSeed(), { goal, settings });
  }

  async resumeGame(snapshot: GameSnapshot): Promise<void> {
    const story = storyFromSnapshot(snapshot);
    this.gameSettings = { size: story.size, difficulty: snapshot.settings.difficulty };
    // Une sauvegarde est une partie en cours : sa victoire compte (l'histoire a été enregistrée à son démarrage).
    const game = this.launch(new Game(this.assets, story, this.view, snapshot.settings), true);
    await game.resume(snapshot);
  }

  /** `record` : la partie compte dans la progression (faux pour une graine imposée en développement). */
  private launch(game: Game, record: boolean): Game {
    this.game = game;
    if (record) game.addEventListener(GameEvent.Won, () => progressStore.recordVictory());
    // Accès de débogage en développement uniquement (console : __indy.game).
    if (import.meta.env.DEV) Object.assign(window, { __indy: { game, app: this } });
    this.paused = false;
    this.palette.reset();
    this.root.replaceChildren(this.gameScreen);
    window.scrollTo(0, 0);
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
    speedSetting.write(this.tickMs);
    this.sidebar.setSpeed(this.tickMs);
    if (this.game) this.startTimer();
  }

  /** Sauvegarde automatique, uniquement entre deux actions (jamais au milieu d'un script). */
  private autosave(): void {
    const game = this.game;
    if (!game || game.busy || game.over || this.view.modalOpen) return;
    saveSlot.write(game.snapshot());
  }

  private stopGame(): void {
    this.autosave();
    window.clearInterval(this.timer);
    window.clearInterval(this.autosaveTimer);
    this.audio.stopMusic();
    this.view.detach();
    this.game = null;
  }

  private freeCellNear(zoneId: number, at: Point): Point {
    const zone = this.assets.zone(zoneId);
    for (let r = 0; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = at.x + dx;
          const y = at.y + dy;
          if (x < 0 || y < 0 || x >= zone.width || y >= zone.height) continue;
          if (zone.tiles[3 * (y * zone.width + x) + 1] === -1) return { x, y };
        }
      }
    }
    return at;
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
    this.view.element.dataset.pausedLabel = copy.paused;
  }

  private async openMap(): Promise<void> {
    const game = this.game;
    if (!game || this.view.modalOpen || game.busy) return;
    if (!game.requestMap()) {
      this.audio.play(IndySounds.NoGo);
      return;
    }
    game.consumeMapRequest();
    const wasPaused = this.paused;
    this.paused = true;
    await this.view.showMap();
    this.paused = wasPaused;
  }

  private async showHelp(): Promise<void> {
    if (!this.game || this.view.modalOpen) return;
    const wasPaused = this.paused;
    this.paused = true;
    await this.view.message(copy.helpText.join("\n"));
    this.paused = wasPaused;
  }

  // ---------------------------------------------------------------- entrées

  private bindInput(): void {
    window.addEventListener("keydown", (e) => {
      const game = this.game;
      if (!game || this.view.modalOpen) return;
      if (e.target instanceof HTMLInputElement) return;
      this.audio.unlock();
      if (MoveKeys.handles(e.code)) {
        e.preventDefault();
        if (!this.paused) this.keys.press(e.code);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) game.requestAttack();
      } else if (e.code === "KeyM") {
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
      canvas.setPointerCapture(e.pointerId);
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
