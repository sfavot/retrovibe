import type { Hy8 } from "../../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH, parsePal, type Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import type { Timer } from "../../engine/clock";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { FRAME_LINE, FRAME_SHADOW, OBJECT_ORIGIN_X, OBJECT_ORIGIN_Y, Pointer, drawFrame, isObjectHit, minigameRequest, pointsForTime, pointsOutcome, type ObjectRect, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S26 « Jeu Sonore » (`1ed0:000b`, 1 582 octets ; RE : `docs/teleportaschtroumpf/minigames/s26.md`).
 *
 * ### `createSoundGame(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 26). Le niveau du joueur n'a **aucun effet** (l'original
 *   écrit 0 dans son niveau interne) ; `bonus` (indice de l'oiseau) élargit la zone cliquable de 4 px et allonge le temps à 19 s ;
 * - joue : un décor de huit images possibles s'affiche 5 s (un clic le raccourcit), s'éteint, puis un bruit est joué dans le noir.
 *   Le joueur doit cliquer là où se trouvait l'objet qui le produit, avec le curseur HY8 (souris, ou flèches + Espace) ; Entrée (clic droit) ou le temps
 *   écoulé (15 s) comptent comme un échec. Le décor revient et un double cadre entoure l'objet ;
 * - rend : `onDone(ctx, { kind: "points", points })` : 3, 2 ou 1 point selon la rapidité (tiers du temps imparti), 0 en cas d'échec ; l'appelant applique l'issue.
 */

/**
 * Les quatre objets de chacun des neuf décors (`DS:1A80`, 360 octets : 9 décors × 4 objets × 5 mots, le 5e étant le numéro 0..3). Le
 * décor 5 n'est jamais tiré ; il est identique au décor 7.
 */
export const TARGETS: readonly (readonly ObjectRect[])[] = [
  [[261, 177, 321, 210], [104, 164, 164, 221], [136, 121, 183, 142], [201, 87, 239, 116]],
  [[106, 199, 166, 234], [286, 132, 345, 191], [138, 121, 185, 141], [221, 149, 259, 180]],
  [[274, 202, 335, 237], [98, 123, 159, 182], [206, 157, 255, 180], [306, 125, 344, 155]],
  [[199, 47, 300, 120], [47, 133, 101, 169], [142, 184, 184, 206], [287, 143, 346, 164]],
  [[221, 56, 253, 137], [104, 48, 176, 123], [239, 144, 309, 201], [239, 144, 309, 201]],
  [[199, 47, 300, 120], [294, 130, 345, 165], [100, 89, 145, 108], [157, 182, 217, 202]],
  [[221, 56, 253, 137], [104, 48, 176, 123], [239, 144, 309, 201], [239, 144, 309, 201]],
  [[48, 60, 80, 136], [168, 56, 239, 131], [140, 138, 212, 196], [276, 154, 325, 179]],
  [[282, 52, 315, 130], [69, 56, 144, 134], [179, 144, 250, 198], [276, 154, 325, 179]],
];

/** Marge autour de la zone : 6 px, et 4 de plus avec l'indice de l'oiseau (`(2 − niveau) × 3 + bonus`, le niveau valant 0). */
export const BASE_TOLERANCE = 6;
export const BONUS_TOLERANCE = 4;
/** Temps de réponse : 15 s, 19 avec l'indice de l'oiseau (`15 − 5 × niveau + bonus`). */
export const BASE_TIME_LIMIT = 15;
export const BONUS_TIME_LIMIT = 4;
/** Le décor reste affiché 5 s au plus avant de s'éteindre (`1ed0:01a3`). */
export const VIEW_SECONDS = 5;
/** Fondus : sortie du décor `1523:01fa(0x80)`, retour `1523:00ee(0x30)` ; pause de 50 centièmes de seconde (`1f33:00fc(0x32)`). */
export const FADE_OUT_STEPS = 0x80;
export const FADE_IN_STEPS = 0x30;
const PAUSE_TICKS = 30;
/** Cadence de la boucle du curseur (`1f33:0348(5)`) et nombre d'images du curseur. */
const LOOP_TICKS = 5;
const CURSOR_FRAMES = 4;
const VOICE_COUNT = 6;

/** Décor (1 à 9, jamais 5) tiré par `rand × 9 / 0x8000 + 1` jusqu'à ne pas valoir 5. */
export function drawPicture(below: (n: number) => number): number {
  let picture: number;
  do picture = below(9) + 1;
  while (picture === 5);
  return picture;
}

/**
 * Numéro du bruit : l'objet 1..4 du décor, dans la série du décor (`(décor − 1) / 3` : 0 → 1..4, 1 → 5..8, 2 → 11..14), et son fichier
 * `s26a00Nb.voc` (`s26a0NNb.voc` à partir de 10).
 */
export function soundFile(picture: number, target: number): string {
  const series = Math.floor((picture - 1) / 3);
  const n = target + (series === 1 ? 4 : series === 2 ? 10 : 0);
  return `s26a${n < 10 ? "00" : "0"}${n}b.voc`;
}

export function tolerance(bonus: boolean): number {
  return BASE_TOLERANCE + (bonus ? BONUS_TOLERANCE : 0);
}

export function timeLimit(bonus: boolean): number {
  return BASE_TIME_LIMIT + (bonus ? BONUS_TIME_LIMIT : 0);
}

export type SoundGamePhase = "view" | "fadeOut" | "pause" | "listen" | "hunt" | "revealFade" | "revealSound" | "revealPause" | "verdict" | "done";

export class SoundGameScene implements Scene {
  readonly step = 1;
  private readonly bonus: boolean;
  private mcg!: Mcg;
  private picturePalette!: Uint8Array;
  private spritePalette!: Uint8Array;
  private sprites!: Hy8;
  private pointer!: Pointer;
  private sound!: Voc;
  private buzzer!: Voc;
  private failVoices: Voc[] = [];
  private winVoices: Voc[] = [];
  private picture = 1;
  private target = 1;
  private phase: SoundGamePhase = "view";
  private timer: Timer | null = null;
  private markTicks = 0;
  private nextAt = 0;
  private frame = 0;
  private drawnOnce = false;
  private click: 0 | 1 | 2 = 0;
  private cursorShown = false;
  private framesShown = false;
  private success = false;
  private elapsed = 0;
  private earned = 0;
  private done = false;

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    this.bonus = minigameRequest(game, 26).bonus;
  }

  get stage(): SoundGamePhase {
    return this.phase;
  }

  /** Décor tiré (1 à 9, jamais 5) et objet à trouver (1 à 4). */
  get pictureNumber(): number {
    return this.picture;
  }

  get targetNumber(): number {
    return this.target;
  }

  /** Zone de l'objet à trouver, dans le repère de la table. */
  get targetRect(): ObjectRect {
    return TARGETS[this.picture - 1][this.target - 1];
  }

  /** Centre de l'objet à trouver à l'écran. */
  get targetCenter(): { x: number; y: number } {
    const [x1, y1, x2, y2] = this.targetRect;
    return { x: Math.floor((x1 + x2) / 2) - OBJECT_ORIGIN_X, y: Math.floor((y1 + y2) / 2) - OBJECT_ORIGIN_Y };
  }

  get hasBonus(): boolean {
    return this.bonus;
  }

  get margin(): number {
    return tolerance(this.bonus);
  }

  get limit(): number {
    return timeLimit(this.bonus);
  }

  /** Secondes écoulées depuis le début de la recherche. */
  get seconds(): number {
    return this.timer?.seconds ?? 0;
  }

  get hasWon(): boolean {
    return this.success;
  }

  get points(): number {
    return this.earned;
  }

  /** Images du curseur dessinées depuis le début de la recherche. */
  get frameIndex(): number {
    return this.frame;
  }

  async load(ctx: SceneContext): Promise<void> {
    // Tirages dans l'ordre de l'original (`1ed0:0029..0189`) : le décor, l'objet, un tirage perdu ; la voix de fin n'est tirée qu'à la fin.
    this.picture = drawPicture((n) => ctx.rng.below(n));
    this.target = ctx.rng.below(4) + 1;
    // Un troisième tirage (`rand × 4 / 0x8000` rangé en `DS:6F4E`, jamais relu) : gardé pour que la suite des tirages reste celle de l'original.
    ctx.rng.below(4);
    const voc = (name: string) => ctx.resources.voc(name);
    const numbered = (prefix: string) => Promise.all(Array.from({ length: VOICE_COUNT }, (_, i) => voc(`${prefix}00${i + 1}t.voc`)));
    const [mcg, picturePal, spritePal, sprites, sound, buzzer, failVoices, winVoices] = await Promise.all([
      ctx.resources.mcg(`s26a00${this.picture}d.mcg`),
      ctx.resources.bytes(`s26a00${this.picture}d.pal`),
      ctx.resources.bytes("s26a000s.pal"),
      ctx.resources.hy8("s26a000s.hy8"),
      voc(soundFile(this.picture, this.target)),
      voc("s26a099b.voc"),
      numbered("s26b"),
      numbered("s26c"),
    ]);
    this.mcg = mcg;
    // La palette du décor est le fichier `.PAL` : celle que le MCG embarque est un remplissage.
    this.picturePalette = parsePal(picturePal);
    this.spritePalette = parsePal(spritePal);
    this.sprites = sprites;
    this.sound = sound;
    this.buzzer = buzzer;
    this.failVoices = failVoices;
    this.winVoices = winVoices;
    this.pointer = new Pointer({ sprites, sprite: 0, bounds: { minX: 0, maxX: SCREEN_WIDTH - 1, minY: 0, maxY: SCREEN_HEIGHT - 1 } });
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.picturePalette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    // Pas de musique pendant le jeu : l'original ne la relance nulle part dans la boucle (`15f9:089f(0x6F04, …)` absent).
    ctx.voice.holdMusic(true);
    this.phase = "view";
    this.timer = null;
    this.frame = 0;
    this.drawnOnce = false;
    this.click = 0;
    this.cursorShown = false;
    this.framesShown = false;
    this.success = false;
    this.elapsed = 0;
    this.earned = 0;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "view":
        if (ctx.fade.active) return;
        this.timer ??= ctx.clock.createTimer();
        if (this.timer.seconds >= VIEW_SECONDS || ctx.input.justPressed("validate") || ctx.input.justPressed("cancel")) {
          this.phase = "fadeOut";
          ctx.fade.out(FADE_OUT_STEPS);
        }
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.markTicks = ctx.clock.ticks;
        this.phase = "pause";
        return;
      case "pause":
        if (ctx.clock.ticks - this.markTicks < PAUSE_TICKS) return;
        ctx.voice.play(this.sound);
        this.phase = "listen";
        return;
      case "listen":
        if (ctx.voice.voicePlaying) return;
        this.startHunt(ctx);
        return;
      case "hunt":
        this.hunt(ctx);
        return;
      case "revealFade":
        if (ctx.fade.active) return;
        ctx.voice.play(this.success ? this.sound : this.buzzer);
        this.phase = "revealSound";
        return;
      case "revealSound":
        // Les cadres ne sont montrés qu'une fois le son fini (`13fc:03f9` vient après `1f33:03a7`).
        if (ctx.voice.voicePlaying) return;
        this.framesShown = true;
        this.markTicks = ctx.clock.ticks;
        this.phase = "revealPause";
        return;
      case "revealPause": {
        if (ctx.clock.ticks - this.markTicks < PAUSE_TICKS) return;
        const voices = this.success ? this.winVoices : this.failVoices;
        ctx.voice.play(voices[ctx.rng.below(voices.length)]);
        this.phase = "verdict";
        return;
      }
      case "verdict":
        // `1f33:03a7(1)` : un clic coupe la voix.
        if (ctx.voice.voicePlaying && !ctx.input.justPressed("validate")) return;
        ctx.voice.stop();
        this.finish(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    const { surface } = ctx;
    surface.restoreBackground();
    if (this.cursorShown) {
      const { x, y } = this.pointer.position(ctx);
      surface.drawSprite(this.sprites, this.frame, x, y);
    }
    if (this.framesShown) {
      const [x1, y1, x2, y2] = this.targetRect;
      drawFrame(surface, x1 - 33, y1 - 41, x2 - 30, y2 - 38, FRAME_SHADOW);
      drawFrame(surface, x1 - 34, y1 - 42, x2 - 31, y2 - 39, FRAME_LINE);
    }
  }

  exit(ctx: SceneContext): void {
    ctx.voice.holdMusic(false);
  }

  /** `1ed0:01f4..0254` : palette des sprites (le décor devient noir), curseur au centre, chrono à zéro. */
  private startHunt(ctx: SceneContext): void {
    ctx.palette.load(this.spritePalette);
    ctx.fade.reset();
    ctx.input.warpMouse(0xa0, 100);
    this.timer = ctx.clock.createTimer();
    this.nextAt = ctx.clock.ticks;
    this.frame = 0;
    this.drawnOnce = false;
    this.click = 0;
    this.cursorShown = true;
    this.phase = "hunt";
  }

  /** Boucle de recherche (`1ed0:025c..02cc`) : une itération toutes les 5 ticks ; le test de fin suit la cadence. */
  private hunt(ctx: SceneContext): void {
    const { input } = ctx;
    this.pointer.update(ctx);
    // Le bouton est lu à chaque tick ; l'original le lit à la fin de l'itération (un clic bref ne se perd pas ici).
    if (this.click === 0) this.click = input.justPressed("validate") ? 1 : input.justPressed("cancel") ? 2 : 0;
    if (ctx.clock.ticks < this.nextAt) return;
    this.nextAt = ctx.clock.ticks + LOOP_TICKS;
    if (this.drawnOnce) {
      this.elapsed = this.timer!.seconds;
      if (this.click !== 0 || this.elapsed >= this.limit) return this.endHunt(ctx);
    }
    // Image suivante du curseur (0..3, la première dessinée est la 1).
    this.frame = (this.frame + 1) % CURSOR_FRAMES;
    this.drawnOnce = true;
  }

  /** `1ed0:02ce..03b8` : le décor revient (noir, puis fondu) et le clic est jugé sur la position courante du curseur. */
  private endHunt(ctx: SceneContext): void {
    const { x, y } = this.pointer.position(ctx);
    this.success = this.click === 1 && isObjectHit(this.targetRect, this.margin, x, y);
    this.earned = this.success ? pointsForTime(this.elapsed, this.limit) : 0;
    this.cursorShown = false;
    ctx.palette.load(this.picturePalette);
    ctx.fade.in(FADE_IN_STEPS);
    this.phase = "revealFade";
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, pointsOutcome(this.earned));
  }
}

export const createSoundGame: MinigameFactory = (game, onDone) => new SoundGameScene(game, onDone);
