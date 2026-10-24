/**
 * Écran des crédits (scène 9, `CREDITS.DAT`) : plaque de verre sur fond orange, quatre pages de texte (images cuites) qui se succèdent
 * toutes les 20 s avec un balayage dans l'une des 4 directions, étincelle sur la plaque, bouton EXIT vers le titre
 * (`docs/mathemagique/screens/common.md` §5, `1078:00e4` / `1078:024a`).
 *
 * Le balayage de l'original (`1018:0162`) recopie, tick après tick, le port de travail vers l'écran : une page est effacée en recopiant la
 * plaque vierge sauvegardée, puis la page suivante est dessinée dans le port de travail et révélée de même. La direction avance d'un cran
 * toutes les deux transitions (hypothèse sur « tourne tous les deux appels »).
 */
import type { Deadline } from "../engine/clock";
import { rectFromEdges, type GadgetGroup } from "../engine/gadgets";
import { drawShape } from "../engine/graphics/blit";
import { Surface, type Rect, type SavedRect } from "../engine/graphics/surface";
import { revealRects, Wipe, type WipeDirection } from "../engine/graphics/transitions";
import type { Archive } from "../engine/resources";
import { SCR_FLAG, type AnimationHandle } from "../engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";

const ARCHIVE = "CREDITS.DAT";
const MIDI_ARCHIVE = "MILKYWAY.DAT";
const MIDI_ID = 65000;

const BACKGROUND_SHAPE = 106;
/** Rectangle de contenu `DS:2bf2` (gauche, haut, droite, bas) : ce que les pages recouvrent. */
const CONTENT: Rect = { x: 103, y: 54, w: 471 - 103, h: 377 - 54 };
/** Pages (`SHAP` 1000 à 1003) et positions `DS:2c08`. */
const PAGES: readonly { shape: number; x: number; y: number }[] = [
  { shape: 1000, x: 152, y: 65 },
  { shape: 1001, x: 118, y: 85 },
  { shape: 1002, x: 208, y: 104 },
  { shape: 1003, x: 103, y: 64 },
];
const EXIT_EDGES = [62, 92, 103, 124] as const;
const EXIT_SHAPES = { normal: 1020, pressed: 1021 } as const;
const SPARK_SCRIPT = 2000;

const PAGE_TICKS = 1200;
const WIPE_TICKS = 30;
const PAUSE_TICKS = 30;
const FADE_TICKS = 30;
/** Étincelle : à partir du 3e cycle, au plus 5 passages par cycle (`7eb2 >= 2`, `7eb4 < 5`). */
const SPARK_FIRST_CYCLE = 2;
const SPARK_MAX_RUNS = 5;

type Phase =
  | "page" // page affichée, attente de 20 s
  | "erasing" // balayage qui efface la page
  | "pause" // plaque vierge, 30 ticks
  | "drawing" // balayage qui révèle la page suivante
  | "leaving";

class CreditsScene implements Scene {
  private archive!: Archive;
  private work = new Surface();
  private blank!: SavedRect;
  private phase: Phase = "page";
  private page = 0;
  private cycle = 0;
  private sparkRuns = 0;
  private spark: AnimationHandle | null = null;
  private wipes = 0;
  private wipe: Wipe | null = null;
  private wait: Deadline | null = null;
  private group: GadgetGroup | null = null;

  constructor(private readonly services: MathServices) {}

  async load(ctx: SceneContext): Promise<void> {
    await Promise.all([ctx.resources.open(ARCHIVE), ctx.resources.open(MIDI_ARCHIVE, "persistent")]);
  }

  enter(ctx: SceneContext): void {
    this.archive = ctx.resources.require(ARCHIVE);
    const { screen, palette } = this.services.graphics;
    const { gadgets, sound } = this.services;
    this.services.useArchive(this.archive);
    ctx.setCursor("arrow");
    palette.loadShpl(this.archive.shpl(BACKGROUND_SHAPE));
    drawShape(screen, this.archive.shap(BACKGROUND_SHAPE), 0, 0, 0);
    // Plaque vierge sauvegardée avant la première page : c'est elle qu'on recopie pour effacer une page.
    this.blank = screen.saveRect(CONTENT);
    this.drawPage(screen, 0);
    this.group = gadgets.addGroup({
      id: "credits",
      records: [
        { rect: rectFromEdges(...EXIT_EDGES), shapes: EXIT_SHAPES },
        { rect: rectFromEdges(0, 0, screen.width, screen.height), focusable: false },
      ],
      onActivate: (index) => {
        if (index === 1) this.leaveForTitle(ctx);
        else if (this.phase === "page") this.startErase(ctx);
      },
    });
    gadgets.captureBackground(screen);
    // Musique d'ambiance du hub (« Ambient Sounds »).
    const midi = ctx.resources.get(MIDI_ARCHIVE);
    if (midi) sound.playSound(midi, MIDI_ID, { ambient: true, loop: true });
    palette.fadeFromBlack(FADE_TICKS);
    this.wait = ctx.clock.deadline(PAGE_TICKS);
    ctx.requestPresent();
  }

  leave(): void {
    this.services.endScene();
  }

  tick(ctx: SceneContext): void {
    const { screen } = this.services.graphics;
    switch (this.phase) {
      case "page":
        if (this.wait!.expired) this.startErase(ctx);
        else this.tickSpark();
        break;
      case "erasing":
      case "drawing": {
        const rects = this.wipe!.step();
        if (rects.length > 0) {
          revealRects(screen, this.work, rects);
          ctx.requestPresent();
        }
        if (this.wipe!.done) {
          this.wipe = null;
          this.wait = ctx.clock.deadline(this.phase === "erasing" ? PAUSE_TICKS : PAGE_TICKS);
          if (this.phase === "erasing") this.phase = "pause";
          else {
            this.phase = "page";
            this.sparkRuns = 0;
          }
          this.services.gadgets.invalidate();
        }
        break;
      }
      case "pause":
        if (this.wait!.expired) this.startDraw(ctx);
        break;
      case "leaving":
        if (this.wait?.expired) {
          this.wait = null;
          ctx.scenes.request(SceneId.title);
        }
        break;
    }
  }

  // --- Pages ---

  private drawPage(surface: Surface, index: number): void {
    const page = PAGES[index]!;
    drawShape(surface, this.archive.shap(page.shape), page.x, page.y, 8);
  }

  /** Efface la page : la plaque vierge est remise dans le port de travail, puis révélée par un balayage. */
  private startErase(ctx: SceneContext): void {
    const { screen } = this.services.graphics;
    this.spark?.interrupt();
    this.spark = null;
    this.work.pixels.set(screen.pixels);
    this.work.restoreRect(this.blank);
    this.beginWipe();
    this.phase = "erasing";
    ctx.requestPresent();
  }

  /** Page suivante (la quatrième est suivie de la première : fin de cycle). */
  private startDraw(ctx: SceneContext): void {
    const { screen } = this.services.graphics;
    this.page++;
    if (this.page >= PAGES.length) {
      this.page = 0;
      this.cycle++;
    }
    this.work.pixels.set(screen.pixels);
    this.drawPage(this.work, this.page);
    this.beginWipe();
    this.phase = "drawing";
    ctx.requestPresent();
  }

  private beginWipe(): void {
    const direction = ((this.wipes >> 1) & 3) as WipeDirection;
    this.wipes++;
    this.wipe = new Wipe(CONTENT, direction, WIPE_TICKS);
  }

  /** Étincelle sur la plaque pendant la première page, à partir du 3e cycle. */
  private tickSpark(): void {
    if (this.page !== 0 || this.cycle < SPARK_FIRST_CYCLE) return;
    if (!this.spark) {
      if (this.sparkRuns >= SPARK_MAX_RUNS) return;
      this.sparkRuns++;
      this.spark = this.services.scr.start(this.archive, SPARK_SCRIPT, { flags: SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground });
    } else if (this.spark.done) {
      this.spark = null;
    }
  }

  // --- Sortie ---

  private leaveForTitle(ctx: SceneContext): void {
    if (this.phase === "leaving") return;
    if (this.group) this.group.active = false;
    this.spark?.interrupt();
    this.services.pointer.cursor.setBase("busy");
    this.services.graphics.palette.fadeToBlack(FADE_TICKS);
    this.wait = ctx.clock.deadline(FADE_TICKS);
    this.phase = "leaving";
    // Pendant un balayage, l'écran est déjà complet au tick suivant : on arrête la transition.
    this.wipe = null;
  }
}

export function createCreditsScene(services: MathServices): Scene {
  return new CreditsScene(services);
}
