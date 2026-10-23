import { SCREEN_HEIGHT, SCREEN_WIDTH, type Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import type { Timer } from "../../engine/clock";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { Pointer, SoundHush, drawFrame, minigameLevel, minigameRequest, pointsOutcome, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S25 « Observation » (`260f:000e`, 1 215 octets ; RE : `docs/teleportaschtroumpf/minigames/s25.md`).
 *
 * ### `createObservation(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 25). `level` 0..2 raccourcit le temps imparti (30, 25 ou
 *   20 s) ; `bonus` (indice de l'oiseau) force le niveau interne 0 : 35 s ;
 * - joue : un décor tiré au hasard parmi 25 cache un petit objet ; le joueur le cherche avec un curseur HY8 (souris, ou flèches + Espace) et
 *   clique dessus avant la fin du temps. Un clic ailleurs ou le temps écoulé est un échec ; Entrée (clic droit) ne fait rien ;
 * - rend : `onDone(ctx, { kind: "points", points })` après la voix de fin : 3, 2 ou 1 point selon la rapidité (tiers du temps imparti, voir
 *   « Écarts » du document sur le chrono lu par l'original), 0 en cas d'échec ; l'appelant applique l'issue.
 */

/** Zone d'un objet cachée dans un décor : `[x1, y1, x2, y2]` dans le repère de l'original, décalé de `(32, 40)` par rapport à l'écran. */
export type Rect = readonly [number, number, number, number];

/**
 * Zones des 25 décors (`DS:2470`, 250 octets : 25 × 5 mots, le 5e valant toujours 1), dans l'ordre `s25a<lettre a..e>0<chiffre 1..5>d.mcg` :
 * indice `5 × lettre + (chiffre − 1)`. Chaque zone fait 37 ou 38 px de côté.
 */
export const HIDDEN_OBJECTS: readonly Rect[] = [
  [78, 103, 116, 141], [193, 71, 231, 109], [236, 77, 273, 115], [269, 92, 307, 130], [295, 196, 333, 234],
  [236, 164, 274, 202], [240, 105, 278, 143], [151, 187, 189, 225], [298, 147, 336, 185], [202, 110, 240, 148],
  [295, 155, 333, 193], [254, 54, 292, 92], [167, 49, 205, 87], [104, 92, 142, 130], [150, 110, 188, 148],
  [171, 113, 209, 151], [200, 168, 238, 206], [120, 186, 158, 224], [100, 56, 138, 94], [236, 41, 274, 79],
  [265, 183, 303, 221], [207, 195, 245, 233], [119, 163, 157, 201], [92, 52, 130, 90], [239, 71, 277, 109],
];

/** Décalage entre le repère de la table et l'écran. */
export const ORIGIN_X = 32;
export const ORIGIN_Y = 40;
/** Nombre de décors par lettre et de lettres (`rand × 5000 / 0x8000 % 5`, deux fois). */
export const PICTURE_CHOICES = 5;
/** Temps imparti : `35 − 5 × niveau interne`, le niveau interne valant `niveau du joueur + 1` (1..3), ou 0 avec l'indice de l'oiseau. */
export const BASE_TIME_LIMIT = 35;
export const TIME_PER_LEVEL = 5;
/** Position de départ du curseur (`14b3:0039`). */
export const START_X = 0xa0;
export const START_Y = 100;
/** Couleurs des deux cadres de la bonne réponse (`32af:0006`) : ombre `0x7E`, trait `0x7F`. */
const FRAME_SHADOW = 0x7e;
const FRAME_LINE = 0x7f;
/** Voix de fin : `s25c` 1..12 (réussite), `s25b` 7..12 (clic à côté), `s25b` 1..6 (temps écoulé). */
const WIN_VOICES = 12;
const FAIL_VOICES = 6;
const MISS_VOICE_BASE = 7;

/** Décor tiré : `[lettre, chiffre]` de `rand × 5000 / 0x8000 % 5` appelé deux fois (la lettre d'abord). Indices 0..4. */
export function drawPicture(below: (n: number) => number): { letter: number; digit: number } {
  const letter = below(5000) % PICTURE_CHOICES;
  const digit = below(5000) % PICTURE_CHOICES;
  return { letter, digit };
}

/** Nom du décor : `s25a%c0%dd.mcg` avec la lettre `a + letter` et le chiffre `digit + 1`. */
export function pictureFile(letter: number, digit: number): string {
  return `s25a${String.fromCharCode(0x61 + letter)}0${digit + 1}d.mcg`;
}

/** Niveau interne `DS:6F42` : `niveau du joueur + 1` (1..3), 0 avec l'indice de l'oiseau. */
export function internalLevel(level: number, bonus: boolean): number {
  return bonus ? 0 : level + 1;
}

/** Temps imparti en secondes (`0x23 − 5 × niveau interne`). */
export function timeLimit(internal: number): number {
  return BASE_TIME_LIMIT - TIME_PER_LEVEL * internal;
}

/** Le curseur est sur l'objet : zone décalée de `(32, 40)`, bord droit et bas exclus (`260f:01e4..0238`, comparaisons non signées). */
export function isHit(rect: Rect, x: number, y: number): boolean {
  const [x1, y1, x2, y2] = rect;
  return x1 - ORIGIN_X <= x && y1 - ORIGIN_Y <= y && x < x2 - ORIGIN_X && y < y2 - ORIGIN_Y;
}

/** Points selon les secondes écoulées : moins du tiers du temps, 3 ; moins des deux tiers, 2 ; sinon 1 (`260f:0364..03d1`, divisions entières). */
export function pointsForTime(seconds: number, limit: number): number {
  if (seconds < Math.floor(limit / 3)) return 3;
  if (seconds < Math.floor((2 * limit) / 3)) return 2;
  return 1;
}

export type ObservationEnding = "hit" | "miss" | "timeout";
export type ObservationPhase = "intro" | "hunt" | "clickSound" | "hush" | "voice" | "done";

export class ObservationScene implements Scene {
  readonly step = 1;
  private readonly bonus: boolean;
  private readonly level: number;
  private mcg!: Mcg;
  private pointer!: Pointer;
  private click!: Voc;
  private winVoices: Voc[] = [];
  private failVoices: Voc[] = [];
  private letter = 0;
  private digit = 0;
  private phase: ObservationPhase = "intro";
  private timer: Timer | null = null;
  private result: ObservationEnding | null = null;
  private seconds = 0;
  private earned = 0;
  private cursorShown = true;
  private spoken: string | null = null;
  private readonly hushing = new SoundHush();
  private done = false;

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    const request = minigameRequest(game, 25);
    this.bonus = request.bonus;
    this.level = internalLevel(minigameLevel(request, 0), request.bonus);
  }

  get stage(): ObservationPhase {
    return this.phase;
  }

  /** Niveau interne (0 = indice de l'oiseau, 1..3 sinon) et temps imparti. */
  get internalLevel(): number {
    return this.level;
  }

  get limit(): number {
    return timeLimit(this.level);
  }

  get hasBonus(): boolean {
    return this.bonus;
  }

  /** Décor tiré : lettre 0..4, chiffre 0..4, fichier et zone de l'objet. */
  get picture(): { letter: number; digit: number; file: string; rect: Rect } {
    return { letter: this.letter, digit: this.digit, file: pictureFile(this.letter, this.digit), rect: HIDDEN_OBJECTS[this.letter * PICTURE_CHOICES + this.digit] };
  }

  /** Centre de l'objet à trouver à l'écran. */
  get targetCenter(): { x: number; y: number } {
    const [x1, y1, x2, y2] = this.picture.rect;
    return { x: Math.floor((x1 + x2) / 2) - ORIGIN_X, y: Math.floor((y1 + y2) / 2) - ORIGIN_Y };
  }

  /** Fin de la recherche : `hit`, `miss` (clic à côté) ou `timeout` ; `null` pendant la recherche. */
  get ending(): ObservationEnding | null {
    return this.result;
  }

  /** Points gagnés (0 en cas d'échec). */
  get points(): number {
    return this.earned;
  }

  /** Fichier de la voix de fin, une fois choisie (`s25c001t.voc` à `s25c012t.voc` ou `s25b001t.voc` à `s25b012t.voc`). */
  get spokenVoice(): string | null {
    return this.spoken;
  }

  /** Secondes écoulées depuis le début de la recherche, au moment de la fin. */
  get searchSeconds(): number {
    return this.timer?.seconds ?? this.seconds;
  }

  async load(ctx: SceneContext): Promise<void> {
    // Deux tirages au début (la lettre, puis le chiffre), un seul à la fin pour la voix : même suite que l'original.
    const { letter, digit } = drawPicture((n) => ctx.rng.below(n));
    this.letter = letter;
    this.digit = digit;
    const numbered = (prefix: string, count: number, first = 1) =>
      Promise.all(Array.from({ length: count }, (_, i) => ctx.resources.voc(`${prefix}${String(first + i).padStart(3, "0")}t.voc`)));
    const [mcg, sprites, click, winVoices, failVoices] = await Promise.all([
      ctx.resources.mcg(pictureFile(letter, digit)),
      ctx.resources.hy8("s25a000s.hy8"),
      ctx.resources.voc("s25a001b.voc"),
      numbered("s25c", WIN_VOICES),
      numbered("s25b", MISS_VOICE_BASE + FAIL_VOICES - 1),
    ]);
    this.mcg = mcg;
    this.click = click;
    this.winVoices = winVoices;
    this.failVoices = failVoices;
    this.pointer = new Pointer({ sprites, sprite: 0, bounds: { minX: 0, maxX: SCREEN_WIDTH - 1, minY: 0, maxY: SCREEN_HEIGHT - 1 } });
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.phase = "intro";
    this.timer = null;
    this.result = null;
    this.seconds = 0;
    this.earned = 0;
    this.spoken = null;
    this.cursorShown = false;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "intro":
        // Le chrono part une fois le fondu d'entrée fait (`13fc:0150` le fait avant `1f33:0181(3)`).
        if (ctx.fade.active) return;
        // `14b3:000d` / `0039` : entrées remises à zéro (un clic fait pendant le fondu est oublié), curseur au centre.
        ctx.input.justPressed("validate");
        ctx.input.mouseMove(START_X, START_Y);
        this.cursorShown = true;
        this.timer = ctx.clock.createTimer();
        this.phase = "hunt";
        return;
      case "hunt":
        this.hunt(ctx);
        return;
      case "clickSound":
        // `348d:0b42(1, 0)` : on attend la fin du bruitage du clic.
        if (ctx.voice.effectPlaying) return;
        this.startHush(ctx);
        return;
      case "hush":
        this.hush(ctx);
        return;
      case "voice":
        // `1f33:03a7(1)` : un clic gauche coupe la voix.
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
    if (this.cursorShown) this.pointer.draw(ctx);
    if (this.result === "hit") {
      const [x1, y1, x2, y2] = this.picture.rect;
      drawFrame(surface, x1 - 33, y1 - 41, x2 - 30, y2 - 38, FRAME_SHADOW);
      drawFrame(surface, x1 - 34, y1 - 42, x2 - 31, y2 - 39, FRAME_LINE);
    }
  }

  exit(ctx: SceneContext): void {
    ctx.voice.holdMusic(false);
    this.hushing.restore(ctx);
  }

  /** Boucle de recherche (`260f:0161..01cb`) : le curseur est redessiné à chaque tour ; fin sur un clic gauche ou le temps écoulé. */
  private hunt(ctx: SceneContext): void {
    this.pointer.update(ctx);
    // `DS:4BBD == 1` : seul le bouton gauche termine la recherche (le droit, Entrée, ne fait rien).
    const clicked = ctx.input.justPressed("validate");
    const seconds = this.timer!.seconds;
    if (!clicked && seconds < this.limit) return;
    this.seconds = seconds;
    if (!clicked) {
      this.result = "timeout";
      this.startHush(ctx);
      return;
    }
    const { x, y } = this.pointer.position(ctx);
    const hit = isHit(this.picture.rect, x, y);
    this.result = hit ? "hit" : "miss";
    // Le décor sans curseur n'est recopié à l'écran que sur une réussite (cadres) ; sur un échec, le dernier dessin reste affiché.
    this.cursorShown = !hit;
    // Bruitage mélangé `348d:0b42(2, son)` : la musique continue de jouer pendant le clic et le fondu sonore.
    ctx.voice.playEffect(this.click);
    this.phase = "clickSound";
  }

  /** `1343:0037` : le volume descend d'un cran toutes les 20 centièmes de seconde jusqu'à 1, la musique continue de jouer. */
  private startHush(ctx: SceneContext): void {
    this.hushing.start(ctx);
    this.phase = "hush";
  }

  private hush(ctx: SceneContext): void {
    // Fin du fondu : son coupé (`15f9:089f(0, 0x400000)`), volume rendu ; la musique ne repart plus.
    if (!this.hushing.update(ctx)) return;
    ctx.voice.holdMusic(true);
    this.speak(ctx);
  }

  /** Voix de fin (`260f:031c..0489`), tirée avec un seul `rand`. */
  private speak(ctx: SceneContext): void {
    const hit = this.result === "hit";
    // `15f9:0db1(tampon, préfixe, a, b)` : numéro `a + b`, `a` valant 1 (réussite, temps écoulé) ou 7 (clic à côté).
    const first = this.result === "miss" ? MISS_VOICE_BASE : 1;
    const number = first + ctx.rng.below(hit ? WIN_VOICES : FAIL_VOICES);
    this.spoken = `${hit ? "s25c" : "s25b"}${String(number).padStart(3, "0")}t.voc`;
    if (hit) this.earned = pointsForTime(this.seconds, this.limit);
    ctx.voice.play((hit ? this.winVoices : this.failVoices)[number - 1]);
    this.phase = "voice";
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, pointsOutcome(this.earned));
  }
}

export const createObservation: MinigameFactory = (game, onDone) => new ObservationScene(game, onDone);
