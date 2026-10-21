import type { Palette, PaletteAnimation } from "../data/palette";
import { HotspotType, TILE_SIZE, ZoneType } from "../data/types";
import type { AudioPlayer } from "../audio/audio";
import type { Game, Presenter, Transition } from "../engine/game";
import type { Point } from "../engine/geometry";
import { type Sector, SectorKind, WORLD_SIZE } from "../engine/world";
import { IndexedFrame, PaletteBlitter, VIEW_PIXELS, VIEW_TILES, cameraFor, composeView } from "../render/zone-renderer";
import { copy } from "../copy";
import { h } from "../../../ui/dom";

/** Tuiles du plan (locator) d'Indy : [non résolu, résolu]. */
const LOCATOR = {
  unvisited: 1138,
  here: 639,
  empty: 377,
  town: 375,
  goal: [408, 376],
  travel: [365, 366],
  puzzle: [363, 364],
  blockade: {
    [ZoneType.BlockadeEast]: [369, 370],
    [ZoneType.BlockadeWest]: [373, 374],
    [ZoneType.BlockadeNorth]: [367, 368],
    [ZoneType.BlockadeSouth]: [371, 372],
  } as Record<number, number[]>,
};

/** Vue de jeu : canvas, bulles, ramassage d'objets, transitions et écrans de fin. Implémente le Presenter. */
export class GameView implements Presenter {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly fade: HTMLElement;
  private readonly blitter: PaletteBlitter;
  private readonly frame = new IndexedFrame();
  private readonly scratch = new IndexedFrame();
  private game: Game | null = null;
  private transitionFrame: Uint8Array | null = null;
  private blink: { tile: number; at: Point; until: number } | null = null;
  private raf = 0;
  /** Une fenêtre modale (dialogue, carte, fin de partie) capte le clavier. */
  modalOpen = false;
  private dismissModal: (() => void) | null = null;
  private dismissKeys: string[] = [];
  onEnded: ((kind: "win" | "lose") => void) | null = null;

  constructor(
    private readonly palette: PaletteAnimation,
    private readonly audio: AudioPlayer,
  ) {
    this.canvas = h("canvas", { class: "screen", width: VIEW_PIXELS, height: VIEW_PIXELS, "aria-label": copy.gameView });
    this.overlay = h("div", { class: "overlay" });
    this.fade = h("div", { class: "fade", "aria-hidden": "true" });
    this.element = h("div", { class: "stage" }, this.canvas, this.fade, this.overlay);
    this.blitter = new PaletteBlitter(this.canvas.getContext("2d")!, VIEW_PIXELS, VIEW_PIXELS);
    document.addEventListener("keydown", (e) => {
      if (!this.dismissModal) return;
      if (this.dismissKeys.includes(e.key)) {
        e.preventDefault();
        this.dismissModal();
      }
    });
  }

  attach(game: Game): void {
    this.game = game;
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.game = null;
    this.overlay.replaceChildren();
    this.modalOpen = false;
    this.dismissModal = null;
  }

  private render(): void {
    const game = this.game;
    if (!game?.zone) return;
    if (this.transitionFrame) {
      this.blitter.blit(this.transitionFrame, this.palette.current);
      return;
    }
    const now = performance.now();
    const blink = this.blink && now < this.blink.until && Math.floor(now / 120) % 2 === 0 ? this.blink : undefined;
    composeView(game, this.frame, blink);
    this.blitter.blit(this.frame.pixels, this.palette.current);
  }

  /** Coordonnées de zone → case de la vue (0..8). */
  private toView(at: Point): Point {
    const game = this.game!;
    const camera = cameraFor(game.zone, game.hero);
    return { x: at.x - camera.x, y: at.y - camera.y };
  }

  /** Case de zone sous un point de l'écran (clic, dépôt d'objet). */
  tileAt(clientX: number, clientY: number): Point | null {
    const game = this.game;
    if (!game) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * VIEW_TILES);
    const y = Math.floor(((clientY - rect.top) / rect.height) * VIEW_TILES);
    if (x < 0 || y < 0 || x >= VIEW_TILES || y >= VIEW_TILES) return null;
    const camera = cameraFor(game.zone, game.hero);
    return { x: x + camera.x, y: y + camera.y };
  }

  // ---------------------------------------------------------------- Presenter

  speak(text: string, at: Point | null): Promise<void> {
    const game = this.game;
    if (!game) return Promise.resolve();
    const speaker = this.toView(at ?? game.hero);
    const hero = this.toView(game.hero);
    // La bulle se place du côté opposé au héros quand c'est un PNJ qui parle, pour ne pas le masquer.
    let above = speaker.y >= 4;
    if (at && hero.y !== speaker.y) above = hero.y > speaker.y;
    // Cases libres au-dessus / en dessous du locuteur : on évite le côté trop étroit.
    const roomAbove = Math.max(0, speaker.y);
    const roomBelow = Math.max(0, VIEW_TILES - 1 - speaker.y);
    if (above && roomAbove < 4 && roomBelow > roomAbove) above = false;
    if (!above && roomBelow < 4 && roomAbove > roomBelow) above = true;
    const tail = h("span", { class: "bubble-tail", "aria-hidden": "true" });
    const body = h("div", { class: "bubble-text" }, text.replace(/\r\n?/g, "\n").trim());
    const bubble = h(
      "div",
      { class: `bubble ${above ? "above" : "below"}`, role: "dialog", "aria-live": "polite", tabindex: "-1" },
      body,
      h("div", { class: "bubble-hint", "aria-hidden": "true" }, `${copy.continueHint} ▸`),
      tail,
    );
    const centerPct = ((speaker.x + 0.5) / VIEW_TILES) * 100;
    const width = 76;
    const left = Math.max(2, Math.min(100 - width - 2, centerPct - width / 2));
    bubble.style.left = `${left}%`;
    bubble.style.width = `${width}%`;
    // La bulle ne dépasse jamais de la scène : sa hauteur est bornée par l'espace disponible
    // de son côté (2 % de marge + la pointe), le texte défile au-delà.
    const room = ((above ? roomAbove : roomBelow) / VIEW_TILES) * 100;
    bubble.style.maxHeight = `calc(${room - 2}% - 10px)`;
    if (above) bubble.style.bottom = `${100 - (Math.max(0, speaker.y) / VIEW_TILES) * 100 + 2}%`;
    else bubble.style.top = `${((Math.min(VIEW_TILES - 1, speaker.y) + 1) / VIEW_TILES) * 100 + 2}%`;
    tail.style.left = `${((centerPct - left) / width) * 100}%`;
    return this.modal(bubble);
  }

  message(text: string): Promise<void> {
    const panel = h(
      "div",
      { class: "letter", role: "dialog", "aria-modal": "true", "aria-label": copy.briefing, tabindex: "-1" },
      h("h2", {}, copy.briefing),
      h("p", {}, text.replace(/\r\n?/g, "\n").trim()),
      h("div", { class: "bubble-hint" }, `${copy.continueHint} ▸`),
    );
    return this.modal(panel);
  }

  /** Affiche un élément modal jusqu'à un clic ou une touche de fermeture (Entrée, Espace, Échap). */
  private modal(el: HTMLElement, dismissOnClick = true, keys = ["Enter", " ", "Escape", "NumpadEnter"]): Promise<void> {
    return new Promise((resolve) => {
      this.modalOpen = true;
      const close = () => {
        this.dismissModal = null;
        this.modalOpen = false;
        el.remove();
        resolve();
      };
      this.dismissModal = close;
      this.dismissKeys = keys;
      if (dismissOnClick) el.addEventListener("click", close);
      this.overlay.append(el);
      el.focus({ preventScroll: true });
    });
  }

  pickup(tile: number, at: Point): Promise<void> {
    const game = this.game;
    if (!game) return Promise.resolve();
    this.audio.play(14);
    const duration = 900;
    this.blink = { tile, at, until: performance.now() + duration };
    const toast = h("div", { class: "toast", role: "status" }, copy.found(game.assets.tileName(tile)));
    this.overlay.append(toast);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.blink = null;
        resolve();
      }, duration);
      window.setTimeout(() => toast.remove(), duration + 900);
    });
  }

  async transition(kind: Transition, apply: () => void): Promise<void> {
    const game = this.game;
    if (!game || kind.type === "none") {
      apply();
      return;
    }
    if (kind.type === "room") {
      this.fade.classList.add("on");
      await wait(140);
      apply();
      this.render();
      this.fade.classList.remove("on");
      await wait(60);
      return;
    }
    composeView(game, this.scratch);
    const before = this.scratch.pixels.slice();
    apply();
    composeView(game, this.frame);
    const after = this.frame.pixels;
    const out = new Uint8Array(before.length);
    this.transitionFrame = out;
    const steps = 9;
    for (let s = 1; s <= steps; s++) {
      slide(before, after, out, kind.dx, kind.dy, s / steps);
      await wait(22);
    }
    this.transitionFrame = null;
  }

  playSound(id: number): void {
    this.audio.play(id);
  }

  ended(kind: "win" | "lose", score: number): Promise<void> {
    const game = this.game;
    if (!game) return Promise.resolve();
    const zone = game.assets.zone(kind === "win" ? 208 : 209);
    const picture = renderZonePicture(game, zone.id, this.palette.current);
    const button = h("button", { class: "primary", type: "button" }, kind === "win" ? copy.keepPlaying : copy.tryAgain);
    const panel = h(
      "div",
      { class: `ending ${kind}`, role: "dialog", "aria-modal": "true", tabindex: "-1" },
      picture,
      h("h2", {}, kind === "win" ? copy.winTitle : copy.loseTitle),
      kind === "win" ? h("p", { class: "score" }, copy.score(score)) : null,
      button,
    );
    const done = this.modal(panel, false);
    button.addEventListener("click", () => this.dismissModal?.());
    queueMicrotask(() => button.focus());
    return done.then(() => this.onEnded?.(kind));
  }

  // ---------------------------------------------------------------- carte du monde

  async chooseTeleport(destinations: number[]): Promise<number | null> {
    let choice: number | null = null;
    await this.showMap(destinations, (index) => (choice = index));
    return choice;
  }

  /** Carte du monde ; avec `destinations`, chaque case listée devient un bouton de téléportation. */
  showMap(destinations: number[] = [], onChoose?: (index: number) => void): Promise<void> {
    const game = this.game;
    if (!game) return Promise.resolve();
    const size = WORLD_SIZE * TILE_SIZE;
    const canvas = h("canvas", { class: "map-canvas", width: size, height: size, "aria-label": copy.map });
    const frame = new Uint8Array(size * size);
    const here = game.world.locate(game.zone.id);
    const draw = (blinkOn: boolean) => {
      frame.fill(0);
      for (let y = 0; y < WORLD_SIZE; y++) {
        for (let x = 0; x < WORLD_SIZE; x++) {
          const sector = game.world.at(x, y);
          const tiles = sector ? locatorTiles(game, sector) : [];
          for (const id of tiles) drawTileInto(frame, size, game.assets.tile(id)?.pixels, x, y);
          if (here && here.x === x && here.y === y && blinkOn) {
            drawTileInto(frame, size, game.assets.tile(LOCATOR.here)?.pixels, x, y);
          }
        }
      }
      const ctx = canvas.getContext("2d")!;
      const image = ctx.createImageData(size, size);
      const rgba = new Uint32Array(image.data.buffer);
      for (let i = 0; i < frame.length; i++) rgba[i] = frame[i] ? this.palette.current[frame[i]] : 0xff0f4f4f;
      ctx.putImageData(image, 0, 0);
    };
    let on = true;
    draw(on);
    const timer = window.setInterval(() => draw((on = !on)), 400);
    const frameEl = h("div", { class: "map-frame" }, canvas);
    const panel = h("div", { class: "map", role: "dialog", "aria-modal": "true", "aria-label": copy.map, tabindex: "-1" }, frameEl);
    if (destinations.length && onChoose) {
      panel.setAttribute("aria-label", copy.teleportTitle);
      panel.prepend(h("p", { class: "map-title" }, copy.teleportTitle));
      for (const index of destinations) {
        const x = index % WORLD_SIZE;
        const y = Math.floor(index / WORLD_SIZE);
        const button = h("button", {
          type: "button",
          class: "map-target",
          "aria-label": copy.teleportTo(x + 1, y + 1),
        });
        button.style.left = `${(x / WORLD_SIZE) * 100}%`;
        button.style.top = `${(y / WORLD_SIZE) * 100}%`;
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          onChoose(index);
          this.dismissModal?.();
        });
        frameEl.append(button);
      }
      queueMicrotask(() => frameEl.querySelector<HTMLButtonElement>(".map-target")?.focus());
    }
    const keys = onChoose ? ["Escape"] : undefined;
    return this.modal(panel, true, keys).then(() => window.clearInterval(timer));
  }
}

function locatorTiles(game: Game, sector: Sector): number[] {
  if (!sector.visited) return [LOCATOR.unvisited];
  const zone = game.assets.zone(sector.zoneId);
  const pair = (p: number[]) => [p[sector.solved ? 1 : 0]];
  switch (sector.kind) {
    case SectorKind.Town:
      return [LOCATOR.town];
    case SectorKind.Goal:
      return pair(LOCATOR.goal);
    case SectorKind.Travel:
      return pair(LOCATOR.travel);
    case SectorKind.Blockade:
      return pair(LOCATOR.blockade[zone.type] ?? LOCATOR.puzzle);
    case SectorKind.Puzzle:
    case SectorKind.Find:
      return pair(LOCATOR.puzzle);
    default:
      return zone.hotspots.some((h) => h.type === HotspotType.Teleporter) ? [1139, 1131] : [LOCATOR.empty];
  }
}

function drawTileInto(frame: Uint8Array, width: number, pixels: Uint8Array | undefined, tx: number, ty: number): void {
  if (!pixels) return;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const c = pixels[y * TILE_SIZE + x];
      if (c) frame[(ty * TILE_SIZE + y) * width + tx * TILE_SIZE + x] = c;
    }
  }
}

function renderZonePicture(game: Game, zoneId: number, palette: Palette): HTMLCanvasElement {
  const zone = game.assets.zone(zoneId);
  const w = zone.width * TILE_SIZE;
  const hgt = zone.height * TILE_SIZE;
  const canvas = h("canvas", { class: "ending-picture", width: w, height: hgt, "aria-hidden": "true" });
  const frame = new Uint8Array(w * hgt);
  for (let layer = 0; layer < 3; layer++) {
    for (let y = 0; y < zone.height; y++) {
      for (let x = 0; x < zone.width; x++) {
        const id = zone.tiles[3 * (y * zone.width + x) + layer];
        if (id >= 0) drawTileInto(frame, w, game.assets.tile(id)?.pixels, x, y);
      }
    }
  }
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(w, hgt);
  const rgba = new Uint32Array(image.data.buffer);
  for (let i = 0; i < frame.length; i++) rgba[i] = frame[i] ? palette[frame[i]] : 0xff000000;
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Glissement entre deux vues : la nouvelle arrive du côté où l'on se déplace. */
function slide(before: Uint8Array, after: Uint8Array, out: Uint8Array, dx: number, dy: number, t: number): void {
  const n = VIEW_PIXELS;
  const shift = Math.round(t * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = x + dx * shift;
      const sy = y + dy * shift;
      let c: number;
      if (sx >= 0 && sx < n && sy >= 0 && sy < n) c = before[sy * n + sx];
      else c = after[(sy - dy * n) * n + (sx - dx * n)];
      out[y * n + x] = c;
    }
  }
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
