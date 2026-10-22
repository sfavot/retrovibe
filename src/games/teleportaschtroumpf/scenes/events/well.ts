import { SCREEN_WIDTH } from "../../data/mcg";
import type { Hy8 } from "../../data/hy8";
import type { Voc } from "../../data/voc";
import { TICKS_PER_SECOND } from "../../engine/clock";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import { VideoScene } from "../../engine/video";
import type { Game } from "../../game/rules";
import { hasIngredient, type MinigameOutcome } from "../../game/state";
import { VoiceLine } from "../board/voices";
import { createMapScene } from "../s02-map";

/**
 * Puits aux vœux interactif S13 (`2daf:0006`, code 14 de `28a3:00ad`, `MinigameRequest.scene === 14` ;
 * `docs/teleportaschtroumpf/screens-events.md`).
 *
 * - mode « voyage » (`wellMode === "travel"`) : voix `s13a001/002t`, carte S02 en mode `wish` (fondu), voix `s13b018..020t` si un
 *   lieu est choisi, `s13b024/025t` si la carte est quittée ; issue `{ destination: k }` ou rien ;
 * - mode « ingrédient » : voix `s13a003/004t`, fondu, vidéo `s13g.mux` (Échap la passe), voix `s13c001..006t`, puis le curseur
 *   `s13a000s.hy8` suit la souris sur la dernière image de la vidéo : huit cases de 32 × 32 (une par ingrédient, cadre au survol,
 *   bip `s07a001b` quand on change de case), clic gauche sur une case. Un ingrédient déjà possédé : voix `s13c016..020t`, on
 *   continue. Au bout de 16 s (une fois, une chance sur 3) : voix d'encouragement `s13b021t` ou `s13b023t` ; à 36 s : fin sans
 *   choix (`s13b024/025t`). Choix : voix `s13c` + `7 + SPOKEN_OFFSET[ingrédient]`.
 */

/** Cases cliquables : coin haut-gauche de la case de l'ingrédient `i` (`2daf:02a4..0455`) ; la case fait 0x20 de côté, bords exclus. */
export const WELL_SLOTS: readonly { x: number; y: number }[] = [
  { x: 0x49, y: 0x90 },
  { x: 0x8b, y: 0x73 },
  { x: 0x3c, y: 0x31 },
  { x: 0x89, y: 0x4a },
  { x: 0x28, y: 0x77 },
  { x: 0x6d, y: 0x30 },
  { x: 0x29, y: 0x4d },
  { x: 0x6e, y: 0x8e },
];
const SLOT_SIZE = 0x20;

/** Décalage du numéro de la voix `s13c` annonçant l'ingrédient choisi (table `DS:2C1D`, 8 mots). */
export const SPOKEN_OFFSET: readonly number[] = [1, 6, 3, 5, 2, 7, 8, 0];

/** Bornes du pointeur (`2daf:0262`). */
const POINTER_MIN_X = 8;
const POINTER_MAX_X = 0x134;
const POINTER_MIN_Y = 0x0f;
const POINTER_MAX_Y = 0xbe;
/** Déplacement du curseur au clavier (pixels par pas) : l'original émule la souris avec les flèches. */
const KEY_SPEED = 3;
/** Couleurs du cadre (`2daf:0462`, `0x7f` puis `0x7e`). */
const FRAME_OUTER = 0x7f;
const FRAME_INNER = 0x7e;
/** Secondes avant la voix d'encouragement (chrono 2 > 0xF) et avant la fin sans choix (> 0x23). */
const HINT_SECONDS = 16;
const TIMEOUT_SECONDS = 36;

export type WellPhase =
  | "intro"
  | "video"
  | "videoVoice"
  | "map"
  | "pick"
  /** Une voix coupe le jeu (ingrédient déjà possédé, encouragement) : on attend sa fin puis on reprend `pick`. */
  | "pickVoice"
  | "outro"
  | "done";

export class WellScene implements Scene {
  readonly step = 1;
  private readonly mode: "ingredient" | "travel";
  private phase: WellPhase = "intro";
  private line: VoiceLine | null = null;
  private video: VideoScene | null = null;
  private sprites: Hy8 | null = null;
  private beep: Voc | null = null;
  /** `s13g.pal` : la vidéo laisse le magenta de transparence aux couleurs 128 et 129 du curseur ; l'original charge cette palette. */
  private palette: Uint8Array | null = null;
  private pickStart = 0;
  /** Case sous le curseur (indice d'ingrédient) ou `null`. */
  private slot: number | null = null;
  /** Dernière case annoncée par le bip (`DS:7C6A`) : elle ne change pas en quittant les cases. */
  private beeped: number | null = null;
  private hinted = false;
  private mapResult: number | null = null;
  private videoStarted = false;
  private outcome: MinigameOutcome = { kind: "well", ingredient: null, destination: null };

  constructor(
    private readonly game: Game,
    private readonly onDone: (ctx: SceneContext, outcome: MinigameOutcome) => void,
  ) {
    this.mode = game.state.pending?.wellMode ?? "travel";
  }

  /** Étape en cours (pour les tests). */
  get stage(): WellPhase {
    return this.phase;
  }

  /** Ingrédient dont la case est sous le curseur (pour les tests). */
  get hovered(): number | null {
    return this.slot;
  }

  async load(ctx: SceneContext): Promise<void> {
    if (this.mode === "travel") return;
    this.video = new VideoScene({ file: "s13g.mux", onEnd: (c) => this.videoEnded(c) });
    [, this.sprites, this.beep, this.palette] = await Promise.all([
      this.video.load(ctx),
      ctx.resources.hy8("s13a000s.hy8"),
      ctx.resources.voc("s07a001b.voc"),
      ctx.resources.bytes("s13g.pal"),
    ]);
  }

  enter(ctx: SceneContext): void {
    this.phase = "intro";
    // Voix d'accroche : `s13a` 1 ou 2 (voyage), 3 ou 4 (ingrédient).
    this.line = new VoiceLine(ctx, voiceName("s13a", (this.mode === "travel" ? 1 : 3) + ctx.rng.below(2)));
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "intro":
        if (!this.line!.update(ctx)) return;
        if (this.mode === "travel") this.openMap(ctx);
        else {
          ctx.fade.out();
          this.phase = "video";
        }
        return;
      case "video":
        if (ctx.fade.active) return;
        if (!this.videoStarted) {
          this.videoStarted = true;
          this.video!.enter(ctx);
        }
        this.video!.update(ctx);
        return;
      case "videoVoice":
        if (this.line!.update(ctx)) this.startPick(ctx);
        return;
      case "map":
        return;
      case "pick":
        this.pick(ctx);
        return;
      case "pickVoice":
        if (this.line!.update(ctx)) this.phase = "pick";
        return;
      case "outro":
        if (this.line!.update(ctx)) this.finish(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "video") this.video?.render(ctx);
    else if (this.phase === "pick" || this.phase === "pickVoice") this.drawPick(ctx);
  }

  resume(ctx: SceneContext): void {
    // Retour de la carte : écran noir sous la voix (l'original n'efface rien, la carte quittée a déjà fondu au noir).
    ctx.surface.clear(0);
    this.endMap(ctx);
  }

  exit(ctx: SceneContext): void {
    if (this.phase === "video" && this.videoStarted) this.video?.exit(ctx);
  }

  // --- voyage -------------------------------------------------------------------------------------

  private openMap(ctx: SceneContext): void {
    this.phase = "map";
    ctx.scenes.push(
      createMapScene({ mode: "wish" }, (c, k) => {
        this.mapResult = k;
        c.scenes.pop({ fade: true });
      }),
      { fade: true },
    );
  }

  private endMap(ctx: SceneContext): void {
    const k = this.mapResult ?? 1;
    if (k > 1) {
      // `k + 6` : voix `s13b` 18 à 20 avant le départ.
      this.outcome = { kind: "well", destination: k, ingredient: null };
      this.say(ctx, 0x12 + ctx.rng.below(3));
    } else this.say(ctx, 0x18 + ctx.rng.below(2));
  }

  // --- ingrédient ---------------------------------------------------------------------------------

  private videoEnded(ctx: SceneContext): void {
    // La dernière image de la vidéo devient le fond du puits (`12ec:0314`).
    this.video!.render(ctx);
    this.video!.exit(ctx);
    if (this.palette) ctx.palette.load(this.palette);
    ctx.surface.commitBackground();
    this.phase = "videoVoice";
    this.line = new VoiceLine(ctx, voiceName("s13c", 1 + ctx.rng.below(6)));
  }

  private startPick(ctx: SceneContext): void {
    this.phase = "pick";
    this.pickStart = ctx.clock.ticks;
    this.slot = null;
    this.beeped = null;
    this.hinted = false;
  }

  private pick(ctx: SceneContext): void {
    const input = ctx.input;
    // Les flèches déplacent le curseur comme le clavier de l'original émule la souris.
    const dx = (input.pressed("right") ? KEY_SPEED : 0) - (input.pressed("left") ? KEY_SPEED : 0);
    const dy = (input.pressed("down") ? KEY_SPEED : 0) - (input.pressed("up") ? KEY_SPEED : 0);
    if (dx !== 0 || dy !== 0) input.mouseMove(input.mouseX + dx, input.mouseY + dy);
    const { x, y } = this.pointer(ctx);
    this.slot = WELL_SLOTS.findIndex((s) => x > s.x && x < s.x + SLOT_SIZE && y > s.y && y < s.y + SLOT_SIZE);
    if (this.slot < 0) this.slot = null;

    if (this.slot !== null && this.slot !== this.beeped) {
      if (!ctx.voice.voicePlaying && this.beep) ctx.voice.play(this.beep);
      this.beeped = this.slot;
    }

    if (this.slot !== null && input.justPressed("validate")) {
      if (hasIngredient(this.game.state.players[this.game.state.pending?.player ?? this.game.state.current], this.slot)) {
        // Déjà possédé : « tu l'as déjà », on continue.
        ctx.voice.stop();
        this.say(ctx, 0x10 + ctx.rng.below(5), "s13c", "pickVoice");
        return;
      }
      this.outcome = { kind: "well", ingredient: this.slot, destination: null };
      this.say(ctx, 7 + SPOKEN_OFFSET[this.slot], "s13c");
      return;
    }

    const seconds = Math.floor((ctx.clock.ticks - this.pickStart) / TICKS_PER_SECOND);
    if (seconds >= HINT_SECONDS && !this.hinted) {
      this.hinted = true;
      if (ctx.rng.below(3) === 0) {
        ctx.voice.stop();
        this.say(ctx, 0x15 + ctx.rng.below(2) * 2, "s13b", "pickVoice");
        return;
      }
    }
    if (seconds >= TIMEOUT_SECONDS) {
      ctx.voice.stop();
      this.say(ctx, 0x18 + ctx.rng.below(2));
    }
  }

  private pointer(ctx: SceneContext): { x: number; y: number } {
    const { mouseX, mouseY } = ctx.input;
    return { x: Math.min(POINTER_MAX_X, Math.max(POINTER_MIN_X, mouseX)), y: Math.min(POINTER_MAX_Y, Math.max(POINTER_MIN_Y, mouseY)) };
  }

  private drawPick(ctx: SceneContext): void {
    const { surface } = ctx;
    surface.restoreBackground();
    if (this.slot !== null) {
      const { x, y } = WELL_SLOTS[this.slot];
      frame(surface.work, x - 1, y - 1, x + 0x1f, y + 0x1f, FRAME_OUTER);
      frame(surface.work, x, y, x + SLOT_SIZE, y + SLOT_SIZE, FRAME_INNER);
    }
    const { x, y } = this.pointer(ctx);
    if (this.sprites) surface.drawSprite(this.sprites, 0, x, y);
  }

  // --- fin ------------------------------------------------------------------------------------------

  /** Joue la voix `prefix` + `n` ; `then` : l'étape suivante (`outro` par défaut : la scène rend la main à la fin de la voix). */
  private say(ctx: SceneContext, n: number, prefix = "s13b", then: WellPhase = "outro"): void {
    this.line = new VoiceLine(ctx, voiceName(prefix, n));
    this.phase = then;
  }

  private finish(ctx: SceneContext): void {
    this.phase = "done";
    this.onDone(ctx, this.outcome);
  }
}

/** Contour d'un rectangle `[x1, x2] × [y1, y2]` bords compris, rogné à l'écran (`32af:0006`). */
function frame(pixels: Uint8Array, x1: number, y1: number, x2: number, y2: number, color: number): void {
  const put = (x: number, y: number) => {
    if (x >= 0 && x < SCREEN_WIDTH && y >= 0 && y * SCREEN_WIDTH + x < pixels.length) pixels[y * SCREEN_WIDTH + x] = color;
  };
  for (let x = x1; x <= x2; x++) {
    put(x, y1);
    put(x, y2);
  }
  for (let y = y1; y <= y2; y++) {
    put(x1, y);
    put(x2, y);
  }
}

export function createWellScene(game: Game, onDone: (ctx: SceneContext, outcome: MinigameOutcome) => void): Scene {
  return new WellScene(game, onDone);
}
