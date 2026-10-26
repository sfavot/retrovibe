import type { Hy8, Hy8Frame } from "../../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import type { Timer } from "../../engine/clock";
import type { Action, Input } from "../../engine/input";
import type { MenuArea } from "../../engine/menu";
import type { Scene, SceneContext } from "../../engine/scene";
import { AnimationPlayer, boundsOf, placeFrame } from "../../engine/sprites";
import type { Game } from "../../game/rules";
import { Clip, minigameLevel, minigameRequest, pointsOutcome, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S23 « Le Schtroumpf Musicien » (`24d0:000c`, 2 510 octets ; RE : `docs/teleportaschtroumpf/minigames/s23.md`).
 *
 * ### `createMusician(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 23) : `level` 0..2 allonge la mélodie à
 *   reproduire (5, 6 ou 7 notes) et change le tirage des notes, `bonus` (indice de l'oiseau) force le niveau 0 et retire une note (4) ;
 * - joue : quatre instruments. Le Schtroumpf joue une mélodie qui s'allonge d'une note à chaque manche ; le joueur la reproduit
 *   avec les flèches (gauche, haut, droite, bas = instruments 0 à 3 ; `Z`, `Q`, `X`, `A` aussi), ou au doigt en touchant le Schtroumpf
 *   qui doit jouer (ajout du port). Dix secondes pour toute la mélodie,
 *   quarante-cinq secondes pour toute la partie ;
 * - rend : `onDone(ctx, { kind: "points", points })` à la fin de la vidéo de fin (`s23c` si réussi, `s23b` sinon, passables) ; 1 à 3
 *   gouttes selon la longueur de la dernière mélodie réussie, 0 à la moindre erreur ou au moindre délai dépassé ; l'appelant applique l'issue.
 */

/** Position (bord gauche, ligne du bas) des quatre instruments (`24d0:0158..018b`) : gauche, haut, droite, bas. */
export const INSTRUMENT_POSITIONS: readonly (readonly [number, number])[] = [
  [0x35, 0x3e],
  [0x8c, 0x4b],
  [0x104, 0x82],
  [0xa8, 0xa5],
];

/** Touche de chaque instrument (drapeaux de navigation `DS:4BBB` : 4 gauche, 1 haut, 8 droite, 2 bas ; table `24d0:0a0f`). */
export const INSTRUMENT_KEYS: readonly Action[] = ["left", "up", "right", "down"];

/** Sons de l'instrument quand la note est juste, puis quand elle est fausse (tables `24d0:0a2f` et `24d0:09ef`). */
export const RIGHT_SOUNDS: readonly string[] = ["s23a004c.voc", "s23a002b.voc", "s23a001b.voc", "s23a003e.voc"];
export const WRONG_SOUNDS: readonly string[] = ["s23a008e.voc", "s23a006b.voc", "s23a005b.voc", "s23a007d.voc"];

/** Marge (pixels) autour de chaque musicien au repos pour le toucher du doigt. */
const TOUCH_MARGIN = 4;

/**
 * Musicien touché en (x, y) parmi les zones (une par instrument), `null` hors de toutes. Les zones du guitariste et du joueur de
 * cymbales se chevauchent un peu : le musicien dont le centre est le plus proche l'emporte.
 */
export function instrumentAt(areas: readonly MenuArea[], x: number, y: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const [index, a] of areas.entries()) {
    if (x < a.x0 || x > a.x1 || y < a.y0 || y > a.y1) continue;
    const distance = Math.hypot(x - (a.x0 + a.x1) / 2, y - (a.y0 + a.y1) / 2);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** Longueur à atteindre (`DS:2370`) : 5, 6, 7 selon le niveau 0, 1, 2 ; 4 avec l'indice de l'oiseau. */
export function goalLength(level: number, bonus: boolean): number {
  if (level === 2) return 7;
  if (level === 1) return 6;
  return bonus ? 4 : 5;
}

/** Gouttes de rosée (`24d0:0991..09cb`) : mélodie réussie de `goal − 2` notes, 1 ; `goal − 1`, 2 ; `goal`, 3 ; moins, ou une erreur, 0. */
export function pointsFor(score: number, goal: number, failed: boolean): number {
  if (failed || score < goal - 2) return 0;
  if (score === goal - 2) return 1;
  return score === goal - 1 ? 2 : 3;
}

/**
 * Nouvelle note de la mélodie (`24d0:0250..0339`), tirée dans 0..3 : niveau 0, au hasard ; niveau 1, jamais trois fois la même de suite ;
 * niveau 2, jamais deux fois la même de suite. Les deux premières notes (une seule au niveau 2) sont libres.
 */
export function rollNote(rng: { below(n: number): number }, level: number, melody: readonly number[]): number {
  const at = melody.length;
  if (at === 0 || level === 0 || (level === 1 && at < 2)) return rng.below(4);
  for (;;) {
    const note = rng.below(4);
    if (level === 1 ? note !== melody[at - 1] || note !== melody[at - 2] : note !== melody[at - 1]) return note;
  }
}

/** Images (ticks) entre deux dessins (`1f33:0348(5)`) : 12 par seconde. */
const FRAME_TICKS = 5;
/** Attente après la mise en place (`1f33:00fc(200)`) : 2 s. */
const SETTLE_TICKS = 120;
/** `14b3:000d` attend 2 × 3 centièmes de seconde avant d'écouter le joueur (≈ 4 ticks). */
const LISTEN_GAP_TICKS = 4;
/** Pause après une mélodie reproduite en entier (`1f33:00fc(0x32)`) : 0,5 s. */
const ROUND_PAUSE_TICKS = 30;
/** `1f33:030e` attend le relâchement des flèches, au plus 500 centièmes de seconde. */
const RELEASE_CAP_TICKS = 300;
/** Le joueur dispose de moins de 10 s pour toute la mélodie (chrono 3, `24d0:0522..0547`). */
export const LISTEN_LIMIT_SECONDS = 10;
/** La partie s'arrête à la première fin de manche où le chrono 2 dépasse 44 s (`24d0:08da..08e5`). */
export const GAME_LIMIT_SECONDS = 45;

export type MusicianPhase = "intro" | "settle" | "demo" | "gap" | "listen" | "note" | "release" | "between" | "fadeOut" | "result" | "done";
type NoteMode = "demo" | "right" | "wrong";

export class MusicianScene implements Scene {
  readonly step = 1;
  private readonly level: number;
  private readonly bonus: boolean;
  private readonly goal: number;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private rightVocs: Voc[] = [];
  private wrongVocs: Voc[] = [];
  private intro!: Clip;
  private win!: Clip;
  private fail!: Clip;
  private result: Clip | null = null;
  private phase: MusicianPhase = "intro";
  private gameTimer: Timer | null = null;
  private listenTimer: Timer | null = null;
  private melody: number[] = [];
  private demoIndex = 0;
  private reproduced = 0;
  private best = 0;
  private rounds = 0;
  private failed = false;
  private earned = 0;
  /** Note en cours (démonstration, bonne ou fausse) : instrument, animation, prochaine image, fin de l'animation. */
  private noteMode: NoteMode = "demo";
  private noteInstrument = 0;
  private notePlayer: AnimationPlayer | null = null;
  private noteAt = 0;
  private noteAnimDone = false;
  private shown: { instrument: number; frame: Hy8Frame } | null = null;
  /** Zones des musiciens au repos (première image de chaque animation), pour le doigt. */
  private areas: MenuArea[] = [];
  private until = 0;
  private releaseStart = 0;
  private done = false;

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    const request = minigameRequest(game, 23);
    this.level = minigameLevel(request, 0);
    this.bonus = request.bonus;
    this.goal = goalLength(this.level, this.bonus);
  }

  get stage(): MusicianPhase {
    return this.phase;
  }

  /** Niveau interne (0..2) : celui du joueur, 0 avec l'indice de l'oiseau. */
  get internalLevel(): number {
    return this.level;
  }

  /** Longueur à atteindre (`DS:2370`). */
  get goalNotes(): number {
    return this.goal;
  }

  /** Mélodie tirée jusqu'ici (instruments 0..3), pour les tests. */
  get sequence(): readonly number[] {
    return this.melody;
  }

  /** Notes déjà reproduites dans la manche (`DS:8C4`). */
  get progress(): number {
    return this.reproduced;
  }

  /** Longueur de la dernière mélodie reproduite en entier (`DS:236E`). */
  get score(): number {
    return this.best;
  }

  /** Vrai après une erreur ou un délai de 10 s dépassé : la partie est perdue (`DS:2372`). */
  get hasFailed(): boolean {
    return this.failed;
  }

  /** Gouttes de rosée gagnées (0 tant que la partie n'est pas finie). */
  get points(): number {
    return this.earned;
  }

  /** Zones touchables des quatre musiciens (gauche, haut, droite, bas), pour les tests. */
  get touchAreas(): readonly MenuArea[] {
    return this.areas;
  }

  /** Secondes écoulées dans la manche d'écoute (chrono 3) et dans la partie (chrono 2), pour les tests. */
  get listenSeconds(): number {
    return this.listenTimer?.seconds ?? 0;
  }

  get gameSeconds(): number {
    return this.gameTimer?.seconds ?? 0;
  }

  /** Nature de la dernière note jouée : démonstration, bonne ou fausse (pour les tests). */
  get lastNote(): NoteMode {
    return this.noteMode;
  }

  /** Instrument dont l'animation joue en ce moment, `null` si aucun (pour les tests). */
  get animated(): number | null {
    return this.shown?.instrument ?? null;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.intro = new Clip("s23d.mux", (c) => this.introEnded(c));
    this.win = new Clip("s23c.mux", (c) => this.finish(c));
    this.fail = new Clip("s23b.mux", (c) => this.finish(c));
    [this.mcg, this.sprites, this.rightVocs, this.wrongVocs] = await Promise.all([
      ctx.resources.mcg("s23a001d.mcg"),
      ctx.resources.hy8("s23a000s.hy8"),
      Promise.all(RIGHT_SOUNDS.map((name) => ctx.resources.voc(name))),
      Promise.all(WRONG_SOUNDS.map((name) => ctx.resources.voc(name))),
      this.intro.load(ctx),
      this.win.load(ctx),
      this.fail.load(ctx),
    ]);
    this.areas = INSTRUMENT_POSITIONS.map(([x, y], index) => {
      const b = boundsOf(placeFrame(this.sprites, this.sprites.animations[index].frames[0]));
      return {
        x0: Math.max(0, x + b.minX - TOUCH_MARGIN),
        y0: Math.max(0, y + b.minY - TOUCH_MARGIN),
        x1: Math.min(SCREEN_WIDTH - 1, x + b.maxX - 1 + TOUCH_MARGIN),
        y1: Math.min(SCREEN_HEIGHT - 1, y + b.maxY - 1 + TOUCH_MARGIN),
      };
    });
  }

  enter(ctx: SceneContext): void {
    this.phase = "intro";
    this.gameTimer = null;
    this.listenTimer = null;
    this.melody = [];
    this.demoIndex = 0;
    this.reproduced = 0;
    this.best = 0;
    this.rounds = 0;
    this.failed = false;
    this.earned = 0;
    this.shown = null;
    this.notePlayer = null;
    this.result = null;
    this.done = false;
    this.intro.start(ctx);
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "intro":
        this.intro.update(ctx);
        return;
      case "settle":
        // L'original attend la fin du fondu d'entrée, puis 2 s (`24d0:01b5..01da`).
        if (ctx.fade.active) return;
        if (this.until === 0) this.until = ctx.clock.ticks + SETTLE_TICKS;
        if (ctx.clock.ticks >= this.until) this.beginRound(ctx);
        return;
      case "demo":
        if (this.noteFinished(ctx)) this.demoNoteEnded(ctx);
        return;
      case "gap":
        if (ctx.clock.ticks >= this.until) this.phase = "listen";
        return;
      case "listen":
        this.updateListen(ctx);
        return;
      case "note":
        if (this.noteFinished(ctx)) {
          this.phase = "release";
          this.releaseStart = ctx.clock.ticks;
        }
        return;
      case "release":
        this.updateRelease(ctx);
        return;
      case "between":
        if (ctx.clock.ticks >= this.until) this.nextOrEnd(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.phase = "result";
        this.result = this.isWin() ? this.win : this.fail;
        this.result.start(ctx);
        return;
      case "result":
        this.result!.update(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "intro") {
      this.intro.render(ctx);
      return;
    }
    if (this.phase === "result" || this.phase === "done") {
      this.result?.render(ctx);
      return;
    }
    const { surface } = ctx;
    surface.restoreBackground();
    for (const [index, [x, y]] of INSTRUMENT_POSITIONS.entries()) {
      // Les instruments au repos sont toujours la première image de leur animation (`12d7:0144` puis `00c1`).
      const frame = this.shown?.instrument === index ? this.shown.frame : this.sprites.animations[index].frames[0];
      surface.drawFrame(this.sprites, frame, x, y);
    }
  }

  exit(ctx: SceneContext): void {
    this.intro.stop(ctx);
    this.win.stop(ctx);
    this.fail.stop(ctx);
    ctx.voice.holdMusic(false);
  }

  /** Vrai si la partie est réussie : aucune erreur et mélodie d'au moins `goal − 2` notes. */
  private isWin(): boolean {
    return !this.failed && this.best >= this.goal - 2;
  }

  /** Fin de la vidéo d'introduction : décor, instruments au repos, fondu d'entrée, chrono de la partie (`24d0:0015..0124`). */
  private introEnded(ctx: SceneContext): void {
    // Aucun appel de musique dans la boucle de S23 : elle ne repart pas après la vidéo (probable).
    ctx.voice.holdMusic(true);
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    ctx.fade.blackout();
    ctx.fade.in();
    this.gameTimer = ctx.clock.createTimer();
    this.until = 0;
    this.phase = "settle";
  }

  /** Début d'une manche (`24d0:0250`) : une note de plus, jouée avec les précédentes. */
  private beginRound(ctx: SceneContext): void {
    this.rounds++;
    this.melody.push(rollNote(ctx.rng, this.level, this.melody));
    this.demoIndex = 0;
    this.startNote(ctx, this.melody[0], "demo");
  }

  private demoNoteEnded(ctx: SceneContext): void {
    this.demoIndex++;
    if (this.demoIndex < this.melody.length) {
      this.startNote(ctx, this.melody[this.demoIndex], "demo");
      return;
    }
    // Le chrono d'écoute démarre avant les 2 × 3 centièmes de `14b3:000d`.
    this.reproduced = 0;
    this.listenTimer = ctx.clock.createTimer();
    this.until = ctx.clock.ticks + LISTEN_GAP_TICKS;
    this.phase = "gap";
  }

  /** Joue le son de l'instrument et lance son animation (`24d0:0348..03b8`, `24d0:05bc..061c`, `24d0:0731..078d`). */
  private startNote(ctx: SceneContext, instrument: number, mode: NoteMode): void {
    if (mode === "right") ctx.voice.stop();
    ctx.voice.play(mode === "wrong" ? this.wrongVocs[instrument] : this.rightVocs[instrument]);
    this.noteMode = mode;
    this.noteInstrument = instrument;
    this.notePlayer = new AnimationPlayer(this.sprites, instrument);
    this.noteAt = ctx.clock.ticks;
    this.noteAnimDone = false;
    this.phase = mode === "demo" ? "demo" : "note";
  }

  /**
   * Boucle d'une note : une image toutes les 5 ticks jusqu'au retour de l'animation à sa première image (7 images), puis attente de
   * la fin du son (`1f33:03a7`). Vrai quand tout est fini.
   */
  private noteFinished(ctx: SceneContext): boolean {
    if (ctx.clock.ticks < this.noteAt) return false;
    const player = this.notePlayer!;
    if (!this.noteAnimDone) {
      this.shown = { instrument: this.noteInstrument, frame: player.frame! };
      player.advance();
      this.noteAt = ctx.clock.ticks + FRAME_TICKS;
      if (player.looped) this.noteAnimDone = true;
      return false;
    }
    if (ctx.voice.voicePlaying) return false;
    this.shown = null;
    return true;
  }

  /**
   * Écoute du joueur (`24d0:0522..0894`) : une seule touche de direction à la fois, 10 s pour toute la mélodie. Au doigt, toucher un
   * musicien vaut la flèche de son instrument (ajout du port).
   */
  private updateListen(ctx: SceneContext): void {
    const { input } = ctx;
    const timedOut = this.listenTimer!.seconds >= LISTEN_LIMIT_SECONDS;
    if (timedOut) this.failed = true;
    const pressed = new Set(INSTRUMENT_KEYS.flatMap((key, instrument) => (input.justPressed(key) ? [instrument] : [])));
    const touched = this.touchedInstrument(input);
    if (touched !== null) pressed.add(touched);
    // Deux directions à la fois ne désignent aucun instrument (table `24d0:0a0f`) : la touche est ignorée.
    if (pressed.size === 1) {
      const [instrument] = pressed;
      const right = instrument === this.melody[this.reproduced];
      if (right) this.reproduced++;
      else this.failed = true;
      this.startNote(ctx, instrument, right ? "right" : "wrong");
      return;
    }
    if (timedOut) this.endListen(ctx);
  }

  /** Musicien touché par le geste de ce pas (un toucher bref ; l'appui long et le glissement ne jouent rien), ou `null`. */
  private touchedInstrument(input: Input): number | null {
    const gesture = input.touchGesture;
    return gesture?.kind === "tap" ? instrumentAt(this.areas, gesture.x, gesture.y) : null;
  }

  /** `1f33:030e` : tant qu'une flèche est tenue (5 s au plus), la boucle attend. */
  private updateRelease(ctx: SceneContext): void {
    const { input } = ctx;
    const held = INSTRUMENT_KEYS.some((key) => input.pressed(key));
    if (held && ctx.clock.ticks - this.releaseStart < RELEASE_CAP_TICKS) return;
    if (this.failed || this.reproduced >= this.melody.length) this.endListen(ctx);
    else this.phase = "listen";
  }

  /** Fin de la boucle d'écoute (`24d0:08a9..08c6`) : son coupé ; une mélodie reproduite en entier est validée après une pause. */
  private endListen(ctx: SceneContext): void {
    ctx.voice.stop();
    if (this.reproduced === this.melody.length) {
      this.best = this.reproduced;
      this.phase = "between";
      this.until = ctx.clock.ticks + ROUND_PAUSE_TICKS;
      return;
    }
    this.nextOrEnd(ctx);
  }

  /** `24d0:08d1..08f0` : nouvelle manche si rien n'a échoué, moins de 45 s se sont écoulées et la longueur visée n'est pas atteinte. */
  private nextOrEnd(ctx: SceneContext): void {
    if (!this.failed && this.gameTimer!.seconds < GAME_LIMIT_SECONDS && this.goal > this.best) {
      this.beginRound(ctx);
      return;
    }
    this.earned = pointsFor(this.best, this.goal, this.failed);
    this.phase = "fadeOut";
    ctx.fade.out();
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, pointsOutcome(this.earned));
  }
}

export const createMusician: MinigameFactory = (game, onDone) => new MusicianScene(game, onDone);
