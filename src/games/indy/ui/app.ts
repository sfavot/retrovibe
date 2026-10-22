import { AudioPlayer } from "../audio/audio";
import { type Palette, PaletteAnimation } from "../data/palette";
import { type HelpDocument, parseHelp } from "../data/help";
import type { GameData } from "../data/types";
import { Assets, IndyIds, IndySounds } from "../engine/assets";
import { Game, type GameSnapshot, storyFromSnapshot } from "../engine/game";
import type { Point } from "../engine/geometry";
import { generateStory } from "../engine/generation/generator";
import { randomSeed } from "../engine/rng";
import { WorldSize } from "../engine/world";
import { tileCanvas } from "../render/zone-renderer";
import { copy } from "../copy";
import { copy as shared } from "../../../ui/copy";
import { h } from "../../../ui/dom";
import { GameView } from "./game-view";
import { renderManual } from "./manual";
import { saveSlot } from "./save";
import { Sidebar } from "./sidebar";

const TICK_MS = 110;
const AUTOSAVE_MS = 4000;
/** Case de départ : devant le bureau de Marcus, en ville. */
const START = { zone: IndyIds.townZone, at: { x: 11, y: 5 } };

const MOVE_KEYS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

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
  private readonly held = new Set<string>();
  /** Touches appuyées depuis le dernier tick : un appui bref compte pour un pas. */
  private readonly tapped = new Set<string>();
  private pointerWalk: { id: number; x: number; y: number } | null = null;
  private itemDrag: { tile: number; ghost: HTMLElement; startX: number; startY: number; moved: boolean } | null = null;
  private settings = { size: WorldSize.Medium as WorldSize, difficulty: 50 };
  private manual: HelpDocument | null = null;

  constructor(
    container: HTMLElement,
    data: GameData,
    private readonly basePalette: Palette,
    private readonly loadManual: () => Promise<ArrayBuffer>,
  ) {
    this.assets = new Assets(data);
    this.palette = new PaletteAnimation(basePalette);
    this.audio = new AudioPlayer(data.sounds, `${import.meta.env.BASE_URL}indy/`);
    this.view = new GameView(this.palette, this.audio);
    this.view.onEnded = (kind) => {
      if (kind === "lose") {
        this.game = null;
        saveSlot.clear();
        this.showTitle();
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
    const picture = h("canvas", { class: "title-picture", width: 288, height: 288, "aria-hidden": "true" });
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
    start.addEventListener("click", () => {
      this.audio.unlock();
      start.disabled = true;
      status.textContent = copy.generating;
      // Laisse le navigateur afficher le message avant la génération (synchrone).
      window.setTimeout(() => {
        this.startGame().catch((e: unknown) => {
          console.error(e);
          status.textContent = String(e instanceof Error ? e.message : e);
          start.disabled = false;
        });
      }, 30);
    });
    this.root.replaceChildren(
      h(
        "section",
        { class: "title-screen" },
        picture,
        h(
          "div",
          { class: "title-form" },
          h("a", { class: "back-link", href: "#/" }, shared.backToGames),
          resumeSection,
          h("h1", {}, copy.newGame),
          radios("size", copy.worldSize, copy.sizes, this.settings.size, (v) => (this.settings.size = v)),
          radios("difficulty", copy.difficulty, copy.difficulties, this.settings.difficulty, (v) => (this.settings.difficulty = v)),
          start,
          status,
          manual,
          h("ul", { class: "help-list" }, ...copy.helpText.map((t) => h("li", {}, t))),
        ),
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

  async startGame(seed = randomSeed()): Promise<void> {
    const story = generateStory(this.assets, seed, this.settings.size);
    const game = this.launch(new Game(this.assets, story, this.view, { difficulty: this.settings.difficulty }));
    this.audio.playMusic(IndySounds.Theme);
    await game.start(START.zone, this.freeCellNear(START.zone, START.at));
  }

  async resumeGame(snapshot: GameSnapshot): Promise<void> {
    const game = this.launch(new Game(this.assets, storyFromSnapshot(snapshot), this.view, snapshot.settings));
    await game.resume(snapshot);
  }

  private launch(game: Game): Game {
    this.game = game;
    // Accès de débogage en développement uniquement (console : __indy.game).
    if (import.meta.env.DEV) Object.assign(window, { __indy: { game, app: this } });
    this.paused = false;
    this.palette.reset();
    this.root.replaceChildren(this.gameScreen);
    window.scrollTo(0, 0);
    this.sidebar.setPaused(false);
    this.view.attach(game);
    this.sidebar.attach(game);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.autosaveTimer = window.setInterval(() => this.autosave(), AUTOSAVE_MS);
    return game;
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
      if (MOVE_KEYS[e.code]) {
        e.preventDefault();
        this.held.add(e.code);
        this.tapped.add(e.code);
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
      this.held.delete(e.code);
      if (this.game) this.game.input.drag = e.shiftKey;
    });
    window.addEventListener("blur", () => this.held.clear());
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
      if (this.pointerWalk?.id === e.pointerId) {
        this.pointerWalk.x = e.clientX;
        this.pointerWalk.y = e.clientY;
      }
    });
    const endWalk = (e: PointerEvent) => {
      if (this.pointerWalk?.id === e.pointerId) this.pointerWalk = null;
    };
    canvas.addEventListener("pointerup", endWalk);
    canvas.addEventListener("pointercancel", endWalk);

    window.addEventListener("pointermove", (e) => this.moveItemDrag(e));
    window.addEventListener("pointerup", (e) => this.endItemDrag(e));
  }

  /** Direction courante : clavier, sinon pointeur maintenu sur la vue. */
  private updateMove(): void {
    const game = this.game;
    if (!game) return;
    let x = 0;
    let y = 0;
    for (const code of new Set([...this.held, ...this.tapped])) {
      const v = MOVE_KEYS[code];
      x += v.x;
      y += v.y;
    }
    this.tapped.clear();
    if (x === 0 && y === 0 && this.pointerWalk) {
      const target = this.view.tileAt(this.pointerWalk.x, this.pointerWalk.y);
      if (target) {
        x = target.x - game.hero.x;
        y = target.y - game.hero.y;
      }
    }
    game.input.move = { x: Math.sign(x), y: Math.sign(y) };
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
