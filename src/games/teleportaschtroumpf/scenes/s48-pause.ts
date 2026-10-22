import type { Hy8 } from "../data/hy8";
import { SCREEN_WIDTH, type Mcg } from "../data/mcg";
import type { Voc } from "../data/voc";
import { TICKS_PER_SECOND } from "../engine/clock";
import { Menu, paletteHighlight } from "../engine/menu";
import { voiceName } from "../engine/paths";
import type { Scene, SceneContext } from "../engine/scene";
import { HOVER_COLOR, ScreenSnapshot } from "./common/choice";

/** Choix de S48 (codes 200 à 203 de `269a:0007`, engine.md §1.5). */
export type PauseChoice = "resume" | "abandon" | "map" | "help";

/** Les quatre boutons, de gauche à droite : retour (200), abandon (201), carte (202), info (203). */
const CHOICES: readonly PauseChoice[] = ["resume", "abandon", "map", "help"];

/** Barre du bas copiée de l'image sur l'écran de la partie : `13fc:067d(…, x 0, y 0x98, w 0x13F, h 0x2F)`. */
const BAR_TOP = 152;
/** Parchemin « Pause » : sprite 0 de `s48a000s.hy8` en (0x64, 0x3C) (`31fe:0481`). */
const TITLE_X = 100;
const TITLE_Y = 60;

/** Entrées de palette : 250 = couleur normale du texte, 251 à 254 = textes des quatre boutons. */
const PALETTE_BASE = 250;
const PALETTE_FIRST_BUTTON = 251;

/** Voix `s48v00Nt.voc` : retour 5 ou 6, abandon 7, carte 1 ou 2, info 3 ou 4 (clic droit) ; 8 à 10 quand rien ne se passe. */
const HELP_VOICES: readonly (readonly number[])[] = [[5, 6], [7], [1, 2], [3, 4]];
const IDLE_VOICES = [8, 9, 10];
const VOICE_COUNT = 10;
/** Rappel vocal après 30 s sans réponse (`local_8 + 3000` centièmes de seconde). */
export const IDLE_SECONDS = 30;

/**
 * S48 : pause (engine.md §1.5, `269a:0007`).
 *
 * - reçoit : rien. Elle est **empilée** par le plateau (`ctx.scenes.push(createPauseScene(cb), { fade: true })`) au-dessus de
 *   la partie, qui reste en mémoire ; le plateau gèle ses chronos avant et les reprend après ;
 * - rend : `onDone(ctx, choice)` : `resume` (200), `abandon` (201 → S46), `map` (202 → S02), `help` (203 → S45) ;
 * - écran suivant : le rappel décide (`pop` pour reprendre, `push` / `replace` pour S46, S02, S45) ;
 * - fonds : `s48a001d.mcg` (barre du bas seulement), `s48a000s.hy8` (parchemin « Pause »), voix `s48v00Nt.voc`.
 *
 * L'écran de la partie reste affiché : seuls la barre du bas et le parchemin sont dessinés par-dessus, comme l'original ;
 * il est rétabli à la sortie (`ScreenSnapshot`). Gauche / droite choisissent un bouton sans rebouclage (« Retour » au
 * départ), clic gauche ou Espace valide, clic droit ou Entrée joue la voix du bouton ; si rien ne se passe pendant 30 s, une
 * voix de rappel est jouée. Échap n'a pas d'effet (l'original l'ignore).
 */
export function createPauseScene(onDone: (ctx: SceneContext, choice: PauseChoice) => void): Scene {
  return new PauseScene(onDone);
}

class PauseScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private voices: Voc[] = [];
  private idleSince = 0;
  private done = false;
  private readonly snapshot = new ScreenSnapshot();
  private readonly menu = new Menu({
    axis: "horizontal",
    wrap: false,
    items: CHOICES.map(() => ({})),
    highlight: paletteHighlight(PALETTE_FIRST_BUTTON, HOVER_COLOR),
  });

  constructor(private readonly onDone: (ctx: SceneContext, choice: PauseChoice) => void) {}

  async load(ctx: SceneContext): Promise<void> {
    const [mcg, sprites, voices] = await Promise.all([
      ctx.resources.mcg("s48a001d.mcg"),
      ctx.resources.hy8("s48a000s.hy8"),
      Promise.all(Array.from({ length: VOICE_COUNT }, (_, i) => ctx.resources.voc(voiceName("s48v", i + 1)))),
    ]);
    this.mcg = mcg;
    this.sprites = sprites;
    this.voices = voices;
  }

  enter(ctx: SceneContext): void {
    this.snapshot.take(ctx);
    // Seules les entrées 250 à 254 diffèrent de la palette du plateau ; les quatre textes partent de la couleur 250.
    ctx.palette.load(this.mcg.palette, PALETTE_BASE, 5);
    const colors = ctx.palette.colors;
    for (let i = 0; i < CHOICES.length; i++) {
      colors.copyWithin((PALETTE_FIRST_BUTTON + i) * 3, PALETTE_BASE * 3, PALETTE_BASE * 3 + 3);
    }
    const { work } = ctx.surface;
    work.set(this.mcg.pixels.subarray(BAR_TOP * SCREEN_WIDTH), BAR_TOP * SCREEN_WIDTH);
    ctx.surface.drawSprite(this.sprites, 0, TITLE_X, TITLE_Y);
    this.menu.enter(ctx);
    this.idleSince = ctx.clock.ticks;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    if (this.done || ctx.fade.active) return;
    const event = this.menu.update(ctx);
    if (event?.kind === "validate") {
      this.done = true;
      ctx.voice.stop();
      this.onDone(ctx, CHOICES[event.index]);
    } else if (event?.kind === "help") {
      ctx.voice.play(this.voices[this.pick(ctx, HELP_VOICES[event.index])]);
    } else if (ctx.clock.ticks - this.idleSince >= IDLE_SECONDS * TICKS_PER_SECOND) {
      ctx.voice.play(this.voices[this.pick(ctx, IDLE_VOICES)]);
      this.idleSince = ctx.clock.ticks;
    }
  }

  render(): void {
    // L'écran est fixe : seule la palette change avec la surbrillance.
  }

  exit(ctx: SceneContext): void {
    this.menu.exit(ctx);
    this.snapshot.restore(ctx);
  }

  /** Index de la voix (numéro − 1) : tirage parmi les numéros possibles (`lib_rand`). */
  private pick(ctx: SceneContext, numbers: readonly number[]): number {
    return numbers[numbers.length === 1 ? 0 : ctx.rng.below(numbers.length)] - 1;
  }
}
