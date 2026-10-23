import type { Hy8 } from "../../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import type { Timer } from "../../engine/clock";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Surface } from "../../engine/surface";
import type { Game } from "../../game/rules";
import { FRAME_LINE, FRAME_SHADOW, Pointer, SoundHush, copyRect, drawFrame, fillRect, levelTimeLimit, minigameLevel, minigameRequest, pointsForTime, pointsOutcome, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S24 « Le Puzzle » (`2e6a:0001`, 2 028 octets ; RE : `docs/teleportaschtroumpf/minigames/s24.md`).
 *
 * ### `createPuzzle(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 24) : `level` 0..2 donne le nombre de trous
 *   (`level + 3`), le temps (`40 − 5 × level` s) et la durée de l'aperçu (`5 − level` s) ; `bonus` (indice de l'oiseau, `DS:6F37 == 0x18`)
 *   remet le niveau à 0 ;
 * - joue : un tableau (cinq possibles) est montré en entier, puis `level + 3` rectangles en sont découpés. Chaque rectangle manquant est
 *   recopié dans une rangée de vignettes en bas ; la vignette encadrée est celle à replacer : le joueur clique le trou d'où elle vient (souris
 *   avec le curseur HY8 de la scène, ou flèches + Espace). Un clic juste efface le trou et passe à la vignette suivante ; un clic sur un
 *   autre trou, ou le temps écoulé, met fin à la partie. L'avant-dernier trou juste suffit : le dernier se devine ;
 * - rend : `onDone(ctx, { kind: "points", points })` après la voix de fin : 3, 2 ou 1 point selon le tiers du temps imparti où le dernier clic
 *   juste est lu (après le fondu sonore), 0 en cas d'échec. L'appelant applique l'issue.
 */

/** Un trou du tableau : coin haut-gauche, rang de sa vignette dans la rangée du bas (permutation de `0..n-1`) et état. */
export interface Hole {
  readonly x: number;
  readonly y: number;
  /** Rang de la vignette de ce trou dans la rangée du bas ; le rang 0 est à replacer en premier. */
  readonly slot: number;
}

/** Trous : 36 × 21 pixels (`0x24 × 0x15`). Le clic est valide dans `[x, x + 0x24[ × [y, y + 0x15[` (`2e6a:03a0..03ec`). */
export const HOLE_WIDTH = 0x24;
export const HOLE_HEIGHT = 0x15;

/** Rangée de vignettes : la vignette de rang `k` est recopiée en (`0x20 + 0x2b × k`, `0x9F`) ; son cadre va de `(0x1E + 0x2b k, 0x9D)` à `(0x45 + 0x2b k, 0xB5)`. */
export const SLOT_STEP = 0x2b;
export const SLOT_X = 0x20;
export const SLOT_Y = 0x9f;

/** Tableaux possibles (`s24a001d` à `s24a005d`) : `rand × 5000 / 0x8000 % 5 + 1`. */
export const PICTURE_COUNT = 5;
/** Largeur d'une colonne de trous : `0x107 / n` ; chaque trou tombe dans sa colonne. */
const BOARD_WIDTH = 0x107;
/** Remplissage du trou : couleur du trait des cadres (`FRAME_LINE`, `0x7F`). */
const HOLE_FILL = 0x7f;

/** Nombre de trous : `niveau + 3` (3, 4 ou 5). */
export function holeCount(level: number): number {
  return level + 3;
}

/** Temps imparti : `40 − 5 × niveau` secondes. */
export function timeLimit(level: number): number {
  return levelTimeLimit(40, 5, level);
}

/** Aperçu du tableau entier avant le jeu : `5 − niveau` secondes (`1f33:0279`), qu'un clic gauche raccourcit. */
export function previewSeconds(level: number): number {
  return 5 - level;
}

/**
 * Tire les trous comme `2e6a:0111..028b` : pour chacun, une position dans sa colonne (`x = rand × (0x107 / n − 5) + i × (0x107 / n) + 6`,
 * `y = rand × 0x7B + 4`) refusée si elle chevauche un trou précédent (écart en x < 0x26 **et** en y < 0x17), puis un rang de vignette
 * (`rand × 5000 % n`) refusé s'il est déjà pris. Les deux tirages de position se refont ensemble.
 */
export function placeHoles(below: (n: number) => number, count: number): Hole[] {
  const column = Math.trunc(BOARD_WIDTH / count);
  const holes: Hole[] = [];
  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    do {
      x = below(column - 5) + i * column + 6;
      y = below(0x7b) + 4;
    } while (holes.some((h) => h.x - 0x26 < x && x < h.x + 0x26 && h.y - 0x17 < y && y < h.y + 0x17));
    let slot: number;
    do slot = below(5000) % count;
    while (holes.some((h) => h.slot === slot));
    holes.push({ x, y, slot });
  }
  return holes;
}

/** Cadres posés autour d'un trou (`2e6a:03f1..0488`, aussi à la fin sur les trous restants) : ombre agrandie de 1, trait décalé de 2 vers le haut-gauche. */
function drawHoleFrames(surface: Surface, h: Hole): void {
  drawFrame(surface, h.x - 1, h.y - 1, h.x + 0x25, h.y + 0x16, FRAME_SHADOW);
  drawFrame(surface, h.x - 2, h.y - 2, h.x + 0x24, h.y + 0x15, FRAME_LINE);
}

/** Attente maximale du relâchement des boutons (`1f33:036d`), en centièmes. */
const RELEASE_CAP_CS = 500;
/** Voix de fin : 9 voix d'échec par type (clic faux `s24b001..009`, temps écoulé `s24b010..018`), 13 de réussite (`s24c001..013`). */
const FAIL_VOICES = 9;
const SUCCESS_VOICES = 13;
const TIMEOUT_VOICE_BASE = 10;

export type PuzzlePhase = "preview" | "release" | "play" | "fade" | "voice" | "done";

/** Pourquoi la partie s'arrête : tous les trous (sauf le dernier) trouvés, mauvais clic, temps écoulé. */
export type PuzzleEnd = "won" | "wrong" | "timeout";

export class PuzzleScene implements Scene {
  readonly step = 1;
  private readonly level: number;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private pointer!: Pointer;
  private goodSound!: Voc;
  private badSound!: Voc;
  private wrongVoices: Voc[] = [];
  private timeoutVoices: Voc[] = [];
  private successVoices: Voc[] = [];
  private pictureIndex = 1;
  private holeList: Hole[] = [];
  private found: boolean[] = [];
  private current = 0;
  private count = 0;
  private phase: PuzzlePhase = "preview";
  private preview: Timer | null = null;
  private timer: Timer | null = null;
  private releaseCs = 0;
  private blocked = false;
  private shown = { x: 0xa0, y: 0x64 };
  private hovered = -1;
  private cursorShown = false;
  private framesShown = false;
  private reason: PuzzleEnd = "timeout";
  private measured = 0;
  private earned = 0;
  private readonly hushing = new SoundHush();
  /** Volume de la voie au début du jeu : le fondu part de là. */
  private startVolume = 15;
  private done = false;

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    // L'indice de l'oiseau remet le niveau à 0 (`2e6a:003f..0051`) ; `Game` l'a déjà consommé.
    this.level = minigameLevel(minigameRequest(game, 24), 0);
  }

  get stage(): PuzzlePhase {
    return this.phase;
  }

  /** Niveau effectif (0 avec l'indice de l'oiseau). */
  get effectiveLevel(): number {
    return this.level;
  }

  /** Tableau tiré, de 1 à 5. */
  get picture(): number {
    return this.pictureIndex;
  }

  /** Les trous tirés. */
  get holes(): readonly Hole[] {
    return this.holeList;
  }

  /** Le trou à trouver maintenant (celui de la vignette encadrée), `-1` quand il n'y en a plus. */
  get targetIndex(): number {
    return this.current;
  }

  /** Trous déjà trouvés. */
  get foundCount(): number {
    return this.count;
  }

  get isFound(): readonly boolean[] {
    return this.found;
  }

  /** Trou sous le curseur à la dernière image, `-1` s'il n'y en a pas. */
  get hoveredHole(): number {
    return this.hovered;
  }

  get limit(): number {
    return timeLimit(this.level);
  }

  /** Secondes écoulées depuis le début du jeu (aperçu exclu). */
  get seconds(): number {
    return this.timer?.seconds ?? 0;
  }

  /** Pourquoi la partie s'est arrêtée (valide à partir de la phase `fade`). */
  get ending(): PuzzleEnd {
    return this.reason;
  }

  /** Secondes lues après le fondu sonore : elles décident des points. */
  get measuredSeconds(): number {
    return this.measured;
  }

  get points(): number {
    return this.earned;
  }

  async load(ctx: SceneContext): Promise<void> {
    // Premier tirage de l'original (`2e6a:006a..008b`) : `rand × 5000 / 0x8000 % 5 + 1`.
    this.pictureIndex = (ctx.rng.below(5000) % PICTURE_COUNT) + 1;
    const voc = (name: string) => ctx.resources.voc(name);
    const numbered = (prefix: string, first: number, length: number) =>
      Promise.all(Array.from({ length }, (_, i) => voc(voiceName(prefix, first + i))));
    [this.mcg, this.sprites, this.goodSound, this.badSound, this.wrongVoices, this.timeoutVoices, this.successVoices] = await Promise.all([
      ctx.resources.mcg(`s24a00${this.pictureIndex}d.mcg`),
      ctx.resources.hy8("s24a000s.hy8"),
      voc("s24a001b.voc"),
      voc("s24a002b.voc"),
      numbered("s24b", 1, FAIL_VOICES),
      numbered("s24b", TIMEOUT_VOICE_BASE, FAIL_VOICES),
      numbered("s24c", 1, SUCCESS_VOICES),
    ]);
    // Le curseur est le sprite 0 de `s24a000s.hy8` (`2e6a:04d9`) ; aucune borne propre : celles de l'écran.
    this.pointer = new Pointer({ sprites: this.sprites, sprite: 0, bounds: { minX: 0, maxX: SCREEN_WIDTH - 1, minY: 0, maxY: SCREEN_HEIGHT - 1 } });
  }

  enter(ctx: SceneContext): void {
    // Le tableau entier d'abord (`13fc:0150`, fondu fait par l'appelant) ; il devient le fond (`12ec:037c`) et la source des vignettes.
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.phase = "preview";
    this.preview = null;
    this.timer = null;
    this.blocked = false;
    this.hovered = -1;
    this.cursorShown = false;
    this.framesShown = false;
    this.reason = "timeout";
    this.measured = 0;
    this.earned = 0;
    this.done = false;
    // Tirages des trous (`2e6a:00f4..028b`), après le tirage du tableau.
    const count = holeCount(this.level);
    this.holeList = placeHoles((n) => ctx.rng.below(n), count);
    this.found = this.holeList.map(() => false);
    this.count = 0;
    this.current = this.holeList.findIndex((h) => h.slot === 0);
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "preview":
        // `1f33:0279(5 − niveau)` : attend la fin du fondu d'entrée, puis les secondes ou un clic gauche.
        if (ctx.fade.active) return;
        this.preview ??= ctx.clock.createTimer();
        if (this.preview.seconds >= previewSeconds(this.level) || ctx.input.justPressed("validate")) {
          this.phase = "release";
          this.releaseCs = ctx.clock.centiseconds;
        }
        return;
      case "release":
        // `1f33:036d` : on attend le relâchement des boutons, au plus 5 s.
        if (this.held(ctx)) return;
        this.beginPlay(ctx);
        return;
      case "play":
        this.updatePlay(ctx);
        return;
      case "fade":
        this.updateFade(ctx);
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
    const { work, background } = surface;
    if (this.phase === "play") {
      this.holeList.forEach((hole, i) => {
        if (this.found[i]) return;
        // La vignette du trou dans la rangée du bas, puis le trou lui-même (`13fc:0427` puis `328a:0022`).
        copyRect(background, work, hole.x, hole.y, SLOT_X + hole.slot * SLOT_STEP, SLOT_Y, HOLE_WIDTH, HOLE_HEIGHT);
        fillRect(work, hole.x, hole.y, hole.x + HOLE_WIDTH - 1, hole.y + HOLE_HEIGHT - 1, HOLE_FILL);
        if (i === this.hovered) drawHoleFrames(surface, hole);
      });
      if (this.current >= 0) {
        const k = this.holeList[this.current].slot;
        drawFrame(surface, 0x1e + k * SLOT_STEP, 0x9d, 0x45 + k * SLOT_STEP, 0xb5, FRAME_SHADOW);
      }
    } else if (this.framesShown) {
      this.holeList.forEach((hole, i) => {
        if (!this.found[i]) drawHoleFrames(surface, hole);
      });
    }
    if (this.cursorShown) surface.drawSprite(this.sprites, 0, this.shown.x, this.shown.y);
  }

  exit(ctx: SceneContext): void {
    ctx.voice.holdMusic(false);
    this.hushing.restore(ctx);
  }

  /** Un bouton est tenu depuis moins de 5 s (`1f33:036d`). */
  private held(ctx: SceneContext): boolean {
    return (ctx.input.pressed("validate") || ctx.input.pressed("cancel")) && ctx.clock.centiseconds - this.releaseCs < RELEASE_CAP_CS;
  }

  /** `2e6a:028e..02b3` : curseur replacé au centre, chrono 2 démarré, le curseur HY8 remplace celui du système. */
  private beginPlay(ctx: SceneContext): void {
    ctx.input.mouseMove(0xa0, 0x64);
    this.shown = this.pointer.position(ctx);
    this.timer = ctx.clock.createTimer();
    this.startVolume = ctx.voice.volume;
    this.cursorShown = true;
    this.phase = "play";
  }

  /** Une itération de la boucle (`2e6a:02b9..05b9`), à chaque tick : survol, clic, relâchement, test de fin. */
  private updatePlay(ctx: SceneContext): void {
    if (this.blocked) {
      if (this.held(ctx)) return;
      this.blocked = false;
      this.checkEnd(ctx);
      return;
    }
    this.pointer.update(ctx);
    this.shown = this.pointer.position(ctx);
    // Le dernier trou de la liste qui contient le curseur l'emporte (`2e6a:0395..0491`).
    this.hovered = -1;
    this.holeList.forEach((hole, i) => {
      if (this.found[i]) return;
      const { x, y } = this.shown;
      if (hole.x <= x && hole.y <= y && x < hole.x + HOLE_WIDTH && y < hole.y + HOLE_HEIGHT) this.hovered = i;
    });
    if (ctx.input.justPressed("validate")) {
      this.click(ctx);
      // Le relâchement est attendu dans l'itération, avant le test de fin.
      this.blocked = true;
      this.releaseCs = ctx.clock.centiseconds;
      return;
    }
    this.checkEnd(ctx);
  }

  /** Clic gauche (`2e6a:04e8..0595`) : le trou attendu s'efface, un autre trou met fin à la partie, le vide ne fait rien. */
  private click(ctx: SceneContext): void {
    if (this.hovered === this.current) {
      // Bruitages mélangés `348d:0b42` : le juste ne se lance que si aucun bruitage ne sonne ; le faux est lancé dans tous les cas.
      if (!ctx.voice.effectPlaying) ctx.voice.playEffect(this.goodSound);
      this.found[this.current] = true;
      this.count++;
      if (this.count < this.holeList.length) this.current = this.nextTarget();
    } else if (this.hovered !== -1) {
      ctx.voice.playEffect(this.badSound);
      this.reason = "wrong";
    }
  }

  /** Le non trouvé de plus petit rang (`2e6a:052f..0563`). */
  private nextTarget(): number {
    for (let slot = 0; slot < this.holeList.length; slot++) {
      const index = this.holeList.findIndex((h) => h.slot === slot);
      if (!this.found[index]) return index;
    }
    return -1;
  }

  /** `2e6a:059a..05b9` : mauvais clic, avant-dernier trou trouvé ou temps écoulé. */
  private checkEnd(ctx: SceneContext): void {
    const won = this.count >= this.holeList.length - 1;
    if (this.reason !== "wrong" && !won && this.seconds < this.limit) return;
    if (this.reason !== "wrong") this.reason = won ? "won" : "timeout";
    this.beginEnding(ctx);
  }

  /** `2e6a:05bc..0680` : curseur retiré, tableau avec un cadre autour de chaque trou resté ouvert, puis fondu sonore. */
  private beginEnding(ctx: SceneContext): void {
    this.cursorShown = false;
    this.framesShown = true;
    this.hovered = -1;
    this.hushing.start(ctx, this.startVolume);
    this.phase = "fade";
  }

  /** `1343:0037` : le volume descend à 1, un cran toutes les 20 centièmes ; puis le son est coupé et le temps lu. */
  private updateFade(ctx: SceneContext): void {
    if (!this.hushing.update(ctx)) return;
    ctx.voice.holdMusic(true);
    // Les secondes sont lues ici, après le fondu sonore (`2e6a:0699`).
    this.measured = this.seconds;
    let voice: Voc;
    if (this.reason === "won") {
      // Le tableau est restitué sans cadre avant la voix `s24c` (`2e6a:0741`).
      this.framesShown = false;
      voice = this.successVoices[ctx.rng.below(SUCCESS_VOICES)];
      this.earned = pointsForTime(this.measured, this.limit);
    } else {
      voice = (this.reason === "wrong" ? this.wrongVoices : this.timeoutVoices)[ctx.rng.below(FAIL_VOICES)];
      this.earned = 0;
    }
    ctx.voice.play(voice);
    this.phase = "voice";
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    // `1f33:0009` : le fond est restauré (le tableau entier, sans cadre ni curseur).
    this.framesShown = false;
    this.onDone(ctx, pointsOutcome(this.earned));
  }
}

export const createPuzzle: MinigameFactory = (game, onDone) => new PuzzleScene(game, onDone);
