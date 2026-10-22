import type { PfnFont } from "../data/font";
import type { Hy8 } from "../data/hy8";
import type { Mcg } from "../data/mcg";
import type { Voc } from "../data/voc";
import { BorlandRandom } from "../engine/rng";
import type { SceneContext } from "../engine/scene";
import { TICKS_PER_SECOND } from "../engine/clock";
import type { Game, GameEvent } from "../game/rules";
import { HAZARDS, ROW_Y, SCREEN_COUNT, type Position, type Row } from "../game/tables";
import { loadDefaultFont } from "./common/text";
import { Ambient } from "./board/ambient";
import { drawHud } from "./board/hud";
import { Walker, type WalkerInput } from "./board/walker";

/**
 * Plateau S01 (engine.md §1.4, `291e:0401`) : le rendu et la marche d'un tour. La logique (portes, pièges, temps) est celle
 * de `game/` ; ce module n'en garde que ce qui se voit et se joue à la main.
 *
 * - **fonds** : `s01a00Nd.mcg`, N = écran 1..9, avec le bandeau du bas (`board/hud.ts`) ; la cage de la prison (sprite 157)
 *   est dessinée dans le fond tant que le pion est prisonnier ;
 * - **pion** : une animation de `s01a000s.hy8` par pose (`board/walker.ts`), ancrée sur le bord gauche et la ligne de la
 *   rangée (`y = 0x38` haute, `0x84` basse) ;
 * - **décor** : animations des écrans (`board/ambient.ts`), puits ouvert, bruitages du lac et du pont ;
 * - **cadence** : une image tous les 4 ticks (15 images/s), `step = 4` de la scène qui l'héberge ;
 * - **minuteur de tour** (multijoueur) : image `0x77 + ⌊secondes / 3⌋` (au plus 9) en bas à droite (`2bd4:0046`).
 *
 * Le plateau ne décide rien : `step` lit les touches, appelle `Game.walk / jump / press` et rend les événements produits (ou
 * une demande de pause / d'aide) ; c'est `scenes/game.ts` qui les présente. Les chronos (`Game.tick`) sont ceux de la scène hôte.
 */

/** Ce que le plateau demande à la scène hôte à l'issue d'une image. */
export type BoardOutput =
  /** Événements produits par la marche, le saut ou le bouton (voir `GameEvent`). */
  | { kind: "events"; events: GameEvent[] }
  /** Touche P : pause (S48). */
  | { kind: "pause" }
  /** Clic droit / Entrée : voix d'aide de la zone du pion. */
  | { kind: "help" };

/** Aspect du pion : normal, prisonnier de la cage (S20) ou avalé par le Turlusiphon (S21, sprite 0x52 / 0x53). */
export type BoardLook = "normal" | "jail" | "siphon";

/** Ce que le plateau montre : un joueur à une position. */
export interface BoardView {
  player: number;
  screen: number;
  row: Row;
  x: number;
  facingRight: boolean;
  look: BoardLook;
  /** Puits ouvert ce tour (animation 24 aux écrans 4, 6 et 9). */
  wellOpen: boolean;
}

export interface BoardResources {
  backgrounds: Mcg[];
  sprites: Hy8;
  hud: Hy8;
  font: PfnFont;
  iceSound: Voc;
  bridgeSound: Voc;
}

/** Charge tout ce que le plateau dessine (les 9 fonds restent en mémoire : on change d'écran sans attendre). */
export async function loadBoardResources(ctx: SceneContext): Promise<BoardResources> {
  const [backgrounds, sprites, hud, font, iceSound, bridgeSound] = await Promise.all([
    Promise.all(Array.from({ length: SCREEN_COUNT }, (_, i) => ctx.resources.mcg(`s01a00${i + 1}d.mcg`))),
    ctx.resources.hy8("s01a000s.hy8"),
    ctx.resources.hy8("s01a001s.hy8"),
    loadDefaultFont(ctx),
    ctx.resources.voc("s18a001b.voc"),
    ctx.resources.voc("s16a001b.voc"),
  ]);
  return { backgrounds, sprites, hud, font, iceSound, bridgeSound };
}

/** Cage de la prison (`291e:125c`) par écran : sprite 0x9d en (x, y). */
const SPRITE_CAGE = 0x9d;
const CAGES: Readonly<Record<number, readonly [number, number]>> = {
  3: [0xac, 0x84],
  5: [0x106, 0x84],
  7: [0xb0, 0x39],
  8: [0x34, 0x84],
  9: [0x3a, 0x84],
};
/** Turlusiphon (`2bd4:08e8`, `0cbc`, `0e9c`) : sprite 0x52 (pion tourné vers la droite) ou 0x53 (gauche) en (x, y). */
const SIPHONS: Readonly<Record<number, readonly [number, number]>> = { 3: [0x109, 0x84], 5: [0xa3, 0x38], 6: [0x109, 0x84] };
const SPRITE_SIPHON_RIGHT = 0x52;
const SPRITE_SIPHON_LEFT = 0x53;
/** Pion caché (prisonnier, avalé) : le sprite 0xaa (`2bd4:0093`, poses 12 et 15), deux traits d'un pixel. */
const SPRITE_HIDDEN = 0xaa;
/** Images 0x77..0x80 du minuteur de tour (`2bd4:0046`), au coin bas-droit. */
const TIMER_FIRST_IMAGE = 0x77;
const TIMER_LAST_STEP = 9;
const TIMER_X = 0x124;
const TIMER_BOTTOM = 0xc6;
const TIMER_SECONDS_PER_STEP = 3;

/** Plages « comptées » (lac glacé, pont branlant) avec leur bruitage d'entrée (`2bd4:0af9`, `10da`). */
const ZONE_SOUNDS = HAZARDS.filter((h) => h.counted).map((h) => ({ screen: h.screen, row: h.row, range: h.counted!, kind: h.kind }));

export class Board {
  readonly walker = new Walker();
  private game!: Game;
  private view: BoardView = { player: 0, screen: 1, row: "top", x: 0, facingRight: true, look: "normal", wellOpen: false };
  private ambient: Ambient | null = null;
  private since = 0;
  private timerVisible = false;
  private isPlaying = false;
  private inZone = false;
  private multiplayer = false;
  private turnSeconds = 0;
  private goalHidden = false;

  constructor(private readonly resources: BoardResources) {}

  /**
   * Cache l'objectif du bandeau (portrait seul) jusqu'au prochain `redraw` : au premier tour, S19 le montre un ingrédient à
   * la fois. À rétablir (`false`) avant que la scène qui l'a demandé ne rende la main.
   */
  setGoalHidden(hidden: boolean): void {
    this.goalHidden = hidden;
  }

  /** Joueur, écran et position montrés. */
  get shown(): Readonly<BoardView> {
    return this.view;
  }

  get position(): Position {
    return { screen: this.view.screen, row: this.view.row, x: this.view.x };
  }

  /** Affiche `view` : fond de l'écran, bandeau, décor, pion ; fondu d'entrée sur demande. */
  show(ctx: SceneContext, game: Game, view: BoardView, fadeIn: boolean): void {
    this.game = game;
    this.view = { ...view };
    this.multiplayer = game.state.players.length > 1;
    this.drawBackground(ctx);
    this.resetScreen(ctx);
    this.walker.reset(view.facingRight, ctx.clock.ticks);
    this.advance(ctx);
    if (fadeIn) {
      ctx.fade.blackout();
      ctx.fade.in();
    }
  }

  /** Redessine le fond et le bandeau (après une scène empilée qui a repris l'écran) sans toucher au pion ni au décor. */
  redraw(ctx: SceneContext): void {
    this.drawBackground(ctx);
  }

  /** Le pion arrive à `to` (téléportation, événement) : fond de l'écran d'arrivée, animation d'arrivée si demandée. */
  moveTo(ctx: SceneContext, to: Position, options: { facingRight?: boolean; arrival?: boolean; look?: BoardLook } = {}): void {
    const screenChanged = to.screen !== this.view.screen || to.row !== this.view.row;
    this.view = { ...this.view, ...to, look: options.look ?? this.view.look, facingRight: options.facingRight ?? this.view.facingRight };
    if (screenChanged) {
      this.drawBackground(ctx);
      this.resetScreen(ctx);
    }
    if (options.arrival) this.walker.startArrival(ctx.clock.ticks);
    else this.walker.reset(this.view.facingRight, ctx.clock.ticks);
    this.advance(ctx);
  }

  /**
   * Une image de marche automatique vers `target` (marche du pion jusqu'au point de déclenchement d'une vidéo d'événement,
   * `2bd4:000f` en boucle) : même animation et mêmes pas que la marche du joueur (4 px, 8 px en course), sans toucher à `game/`
   * (l'état est déjà celui d'après l'effet). Vrai une fois `target` atteint (pion immobile, tourné vers la marche).
   */
  walkToward(ctx: SceneContext, target: number): boolean {
    const dir = Math.sign(target - this.view.x);
    if (dir === 0) return true;
    const move = this.walker.step({ left: dir < 0, right: dir > 0, up: false, press: false }, ctx.clock.ticks, this.resources.sprites);
    const pace = move.walk?.run ? 8 : 4;
    const x = this.view.x + dir * Math.min(pace, Math.abs(target - this.view.x));
    this.view = { ...this.view, x, facingRight: dir > 0 };
    this.advance(ctx);
    if (x !== target) return false;
    this.walker.reset(dir > 0, ctx.clock.ticks);
    return true;
  }

  /** Le joueur courant a changé d'indice (un joueur qui précède est parti) : le bandeau montre le bon joueur. */
  retarget(ctx: SceneContext, player: number): void {
    if (player === this.view.player) return;
    this.view = { ...this.view, player };
    this.drawBackground(ctx);
  }

  /** Vrai quand le joueur a la main (le minuteur de tour ne se montre qu'en jeu, pas pendant une annonce). */
  get playing(): boolean {
    return this.isPlaying;
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    this.timerVisible = playing && this.multiplayer;
  }

  /**
   * Une image de jeu (4 ticks) : lit les touches et applique la marche, le saut ou le bouton à `game`.
   * Les événements rendus sont à présenter dans l'ordre ; tant qu'il n'y en a pas, le pion affiché suit celui de `game`.
   */
  step(ctx: SceneContext): BoardOutput | null {
    const { game } = this;
    const { input } = ctx;
    if (input.justPressed("pause")) return { kind: "pause" };
    if (input.justPressed("cancel")) return { kind: "help" };

    const press = input.justPressed("validate");
    const keys: WalkerInput = { left: input.pressed("left"), right: input.pressed("right"), up: input.pressed("up"), press };
    if (keys.left || keys.right || keys.up) game.markActive();
    const move = this.walker.step(keys, ctx.clock.ticks, this.resources.sprites);
    if (move.beep !== undefined) ctx.voice.playBeep(move.beep);

    const events: GameEvent[] = [];
    if (move.jump) events.push(...game.jump(move.jump));
    if (events.length === 0 && move.walk && game.state.phase === "turn") events.push(...game.walk(move.walk.dir, move.walk.run));
    if (events.length === 0 && press && game.state.phase === "turn") events.push(...game.press("button"));

    this.turnSeconds = game.state.turn.elapsed;
    if (events.length === 0 || events.every(isEdgeMove)) {
      this.followGame(ctx);
      this.advance(ctx);
      this.playZoneSound(ctx);
    }
    return events.length > 0 ? { kind: "events", events } : null;
  }

  /** Dessine : fond, décor, minuteur, pion (`2bd4:000f` : `13fc:0411`, `0771`, `0046`, `0093`). */
  render(ctx: SceneContext): void {
    const { surface } = ctx;
    const { sprites } = this.resources;
    surface.restoreBackground();
    this.ambient?.draw(surface, sprites);
    if (this.view.look === "siphon") {
      const at = SIPHONS[this.view.screen];
      if (at) surface.drawSprite(sprites, this.view.facingRight ? SPRITE_SIPHON_RIGHT : SPRITE_SIPHON_LEFT, at[0], at[1]);
    }
    if (this.timerVisible) {
      const step = Math.min(TIMER_LAST_STEP, Math.floor(this.turnSeconds / TIMER_SECONDS_PER_STEP));
      const image = sprites.images[TIMER_FIRST_IMAGE + step];
      if (image) surface.blitImage(image, TIMER_X, TIMER_BOTTOM - image.height + 1);
    }
    const y = ROW_Y[this.view.row];
    if (this.view.look !== "normal") {
      surface.drawSprite(sprites, SPRITE_HIDDEN, this.view.x, y);
      return;
    }
    const frame = this.walker.currentFrame(sprites);
    if (frame) surface.drawFrame(sprites, frame, this.view.x, y);
  }

  // --- interne ----------------------------------------------------------------------------------

  private drawBackground(ctx: SceneContext): void {
    const { surface, palette } = ctx;
    const mcg = this.resources.backgrounds[this.view.screen - 1];
    palette.load(mcg.palette);
    surface.drawMcg(mcg);
    if (this.view.look === "jail") {
      const cage = CAGES[this.view.screen];
      if (cage) surface.drawSprite(this.resources.sprites, SPRITE_CAGE, cage[0], cage[1]);
    }
    const player = this.game.state.players[this.view.player];
    if (player) drawHud(surface, this.resources.hud, this.resources.font, player, this.goalHidden ? null : this.game.state.goal);
    surface.commitBackground();
  }

  /** Décor neuf et minuterie de l'écran remise à zéro (arrivée sur un écran). */
  private resetScreen(ctx: SceneContext): void {
    this.since = ctx.clock.ticks;
    this.inZone = false;
    this.ambient = new Ambient(this.resources.sprites, this.view.screen, this.view.wellOpen, new BorlandRandom(ctx.rng.next()));
  }

  /** Image de décor suivante. */
  private advance(ctx: SceneContext): void {
    this.ambient?.update(Math.floor((ctx.clock.ticks - this.since) / TICKS_PER_SECOND));
  }

  /** Le pion montré reprend la position du joueur courant de `game` (marche, bord d'écran). */
  private followGame(ctx: SceneContext): void {
    const p = this.game.player;
    if (this.game.state.current !== this.view.player) return;
    const screenChanged = p.screen !== this.view.screen || p.row !== this.view.row;
    this.view = { ...this.view, screen: p.screen, row: p.row, x: p.x, facingRight: p.facingRight };
    if (screenChanged) {
      this.drawBackground(ctx);
      this.resetScreen(ctx);
    }
  }

  /** Bruit de craquement en entrant dans le lac ou sur le pont (`15f9:089f`, seulement si rien ne joue). */
  private playZoneSound(ctx: SceneContext): void {
    const { screen, row, x } = this.view;
    const zone = ZONE_SOUNDS.find((z) => z.screen === screen && z.row === row && x >= z.range[0] && x <= z.range[1]);
    if (zone && !this.inZone && !ctx.voice.voicePlaying) ctx.voice.play(zone.kind === "ice" ? this.resources.iceSound : this.resources.bridgeSound);
    this.inZone = zone !== undefined;
  }
}

function isEdgeMove(event: GameEvent): boolean {
  return event.type === "moved" && event.cause === "edge";
}
