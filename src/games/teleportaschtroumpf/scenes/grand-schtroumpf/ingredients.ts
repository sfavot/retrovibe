import { measureText, type PfnFont } from "../../data/font";
import type { Hy8 } from "../../data/hy8";
import { TICKS_PER_SECOND } from "../../engine/clock";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { INGREDIENT_COUNT } from "../../game/tables";
import { BASE_Y, ICON_STEP, ICON_X, SPRITE_DROP_EMPTY, SPRITE_MISSING, TEXT_Y } from "../board/hud";
import { VoiceLine } from "../board/voices";
import { TEXT_COLOR, loadDefaultFont } from "../common/text";
import { pointsText } from "../s03-info";

/**
 * S19 : le Grand Schtroumpf annonce l'objectif au début de la partie (`1e52:0324`). Voir `screens-grand-schtroumpf.md`.
 */

/** Numéro de voix `s19v` de chaque ingrédient dans l'énumération (`DS:1A20`, +2) et en dernier de la liste (`DS:1A30`, +10). */
const LISTED_VOICE = [6, 5, 0, 1, 3, 4, 2, 7];
const LAST_VOICE = [7, 6, 1, 2, 4, 5, 3, 0];
const VOICE_INTRO = 1;
const VOICE_LISTED = 2;
const VOICE_LAST = 10;
const VOICE_POINTS = 0x12;
const VOICE_GOAL = 0x13;
/** Position du texte « points/objectif » : à droite des icônes, goutte après le texte (`1e52:0324`, 0x17 = goutte vide). */
const DROP_OFFSET = 0xc;

/** Un temps de l'annonce : une voix (avec, avant, l'icône d'un ingrédient ; après, le texte des points) puis une pause. */
export interface IngredientBeat {
  voice: string;
  /** Ingrédient dont l'icône est dessinée avant la voix, et son rang à l'écran. */
  icon?: { ingredient: number; slot: number };
  /** Le texte « points/objectif » et la goutte sont dessinés à la fin de la voix. */
  points?: boolean;
  pauseSeconds: number;
}

/**
 * Déroulé de `1e52:0324` pour un objectif : voix d'ouverture ; les ingrédients demandés dans l'ordre 0..7, tous sauf le
 * dernier avec `s19v` 2 + `DS:1A20[i]` (0,5 s de pause), le dernier avec 10 + `DS:1A30[i]` (1 s) ; « points » (0x12) ; le
 * nombre de points (0x13 + points / 10 − 1) ; texte et goutte, 2 s de pause.
 */
export function ingredientsScript(goalMask: number, goalPoints: number): IngredientBeat[] {
  const required = (i: number) => (goalMask & (1 << i)) !== 0;
  let count = 0;
  for (let i = 0; i < INGREDIENT_COUNT; i++) if (required(i)) count++;
  const beats: IngredientBeat[] = [{ voice: voiceName("s19v", VOICE_INTRO), pauseSeconds: 1 }];
  let slot = 0;
  let done = 0;
  let i = 0;
  // `do … while` de l'original : le premier ingrédient demandé est toujours dit avec la voix des énumérations.
  do {
    if (required(i)) {
      beats.push({ voice: voiceName("s19v", VOICE_LISTED + LISTED_VOICE[i]), icon: { ingredient: i, slot: slot++ }, pauseSeconds: 0.5 });
      done++;
    }
    i++;
  } while (done < count - 1 && i < INGREDIENT_COUNT);
  for (; i < INGREDIENT_COUNT; i++) {
    if (required(i)) beats.push({ voice: voiceName("s19v", VOICE_LAST + LAST_VOICE[i]), icon: { ingredient: i, slot: slot++ }, pauseSeconds: 1 });
  }
  beats.push({ voice: voiceName("s19v", VOICE_POINTS), pauseSeconds: 0.5 });
  beats.push({ voice: voiceName("s19v", VOICE_GOAL + Math.floor(goalPoints / 10) - 1), points: true, pauseSeconds: 2 });
  return beats;
}

export class IngredientsScene implements Scene {
  readonly step = 1;
  private hud!: Hy8;
  private font!: PfnFont;
  private readonly beats: IngredientBeat[];
  private index = 0;
  private phase: "voice" | "pause" = "voice";
  private line: VoiceLine | null = null;
  private pauseStart = 0;
  private readonly icons: { ingredient: number; slot: number }[] = [];
  private pointsShown = false;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {
    this.beats = ingredientsScript(game.state.goal.ingredients, game.state.goal.points);
  }

  async load(ctx: SceneContext): Promise<void> {
    [this.hud, this.font] = await Promise.all([ctx.resources.hy8("s01a001s.hy8"), loadDefaultFont(ctx)]);
  }

  enter(ctx: SceneContext): void {
    this.index = 0;
    this.done = false;
    this.startBeat(ctx);
  }

  update(ctx: SceneContext): void {
    if (this.done) return;
    if (this.phase === "voice") {
      // `1f33:03a7(1)` : un clic gauche coupe la voix ; la pause qui suit n'est pas passable.
      if (!this.line!.update(ctx, ctx.input.justPressed("validate"))) return;
      if (this.beats[this.index].points) this.pointsShown = true;
      this.phase = "pause";
      this.pauseStart = ctx.clock.ticks;
      return;
    }
    if (ctx.clock.ticks - this.pauseStart < this.beats[this.index].pauseSeconds * TICKS_PER_SECOND) return;
    this.index++;
    if (this.index < this.beats.length) return this.startBeat(ctx);
    this.done = true;
    this.onDone(ctx);
  }

  /** Dessine ce qui a été annoncé jusqu'ici, par-dessus le plateau (les dessins sont idempotents). */
  render(ctx: SceneContext): void {
    for (const { ingredient, slot } of this.icons) ctx.surface.drawSprite(this.hud, SPRITE_MISSING + ingredient, ICON_X + slot * ICON_STEP, BASE_Y);
    if (!this.pointsShown) return;
    const { players, current, goal } = this.game.state;
    const slot = this.icons.length;
    const text = Uint8Array.from(pointsText(players[current].points, goal.points), (c) => c.charCodeAt(0));
    ctx.surface.drawText(this.font, text, ICON_X + slot * ICON_STEP, TEXT_Y, TEXT_COLOR);
    ctx.surface.drawSprite(this.hud, SPRITE_DROP_EMPTY, ICON_X + DROP_OFFSET + slot * ICON_STEP + measureText(this.font, text), BASE_Y);
  }

  private startBeat(ctx: SceneContext): void {
    const beat = this.beats[this.index];
    if (beat.icon) this.icons.push(beat.icon);
    this.line = new VoiceLine(ctx, beat.voice);
    this.phase = "voice";
  }
}
