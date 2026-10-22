import type { PfnFont } from "../data/font";
import type { Hy8 } from "../data/hy8";
import type { Mcg } from "../data/mcg";
import { encodeCp437 } from "../../../data/cp437";
import { Menu, paletteHighlight } from "../engine/menu";
import { saveOptions } from "../engine/options";
import type { Scene, SceneContext } from "../engine/scene";
import { CLICK_SOUND } from "./setup/common";

/** Nombre de valeurs de chaque réglage : durée 0..3, pause 0..4, message 0..8 (`21ee:1525..153e`). */
const MAX_VALUES = [3, 4, 8] as const;
const DURATION = 0;
const PAUSE = 1;
const MESSAGE = 2;

/**
 * Messages de fin de partie, dans l'ordre des 9 valeurs (`21ee:1fc7..2071`, version française de l'exécutable) : ce sont
 * les textes d'origine, affichés dans le bandeau « motif d'arrêt de jeu ».
 */
export const END_MESSAGES = [
  "Finir ses devoirs.",
  "Aller goûter.",
  "Aller prendre son bain.",
  "Aller au lit.",
  "Suffisant pour l'instant.",
  "Aller jouer à autre chose.",
  "Aller reposer ses yeux.",
  "Aller aider son père.",
  "Aller aider sa mère.",
];

/** Sprites de `s04a000s.hy8` : cadran de la durée (`6 × durée` à `6 × durée + 6`, 7 images par pas) et jauge de la pause (`0x13 + pause`). */
const DIAL_X = 0x49;
const DIAL_Y = 0x48;
const DIAL_FRAMES_PER_STEP = 6;
const GAUGE_SPRITE = 0x13;
const GAUGE_X = 0xc0;
const GAUGE_Y = 0x6e;

/** Texte du message : police par défaut (`s52d001f.pfn`), indice de couleur 0, en (43, 180) (`21ee:13a7..13ac`, `32f4:0018`). */
const FONT = "s52d001f.pfn";
const TEXT_X = 0x2b;
const TEXT_Y = 0xbe - 10;
const TEXT_COLOR = 0;

/** Les libellés des trois lignes utilisent les entrées de palette 119, 120, 121 ; survol : RVB 8 bits `10 A4 CC` (`DS:5925`). */
const LABEL_FIRST_ENTRY = 119;
const HOVER_COLOR = [0x10, 0xa4, 0xcc] as const;

/**
 * S04 : menu parents (engine.md §6.3, `21ee:13a1`).
 *
 * - reçoit : rien (lit et écrit `ctx.options` : `saveOptions(ctx.host.storage, ctx.options)`) ;
 * - rend : `onDone(ctx)` quand l'écran est quitté, une fois les options enregistrées ;
 * - écran suivant (décidé par `flow.ts`) : S07 ;
 * - fonds : `s04a001d.mcg`, `s04a000s.hy8` ; bip `s07a001b.voc`.
 *
 * Déroulé de l'original : trois réglages (durée de la partie, pause avant de rejouer, message de fin). Haut / bas changent
 * de ligne (sans rebouclage, bip), gauche / droite la valeur : durée 0..3 et pause 0..4 sont **bornées**, le message
 * 0..8 **reboucle**. Le libellé de la ligne courante est en surbrillance (entrées 119 à 121). La durée anime le cadran
 * en 7 images, la pause pose une jauge de 5 sprites, le message est écrit en bas. Clic gauche / Espace : valide, écrit
 * les options (durée, pause, message et la date de la dernière partie, conservée) et quitte. Pas de voix, pas de
 * quitter par Échap. Clavier d'origine seul : la position du pointeur ne compte pas.
 */
export function createParentsScene(onDone: (ctx: SceneContext) => void): Scene {
  return new ParentsScene(onDone);
}

class ParentsScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private font!: PfnFont;
  /** Haut / bas : ligne du réglage, bornée (sans rebouclage), avec le bip de navigation. */
  private readonly menu = new Menu({
    items: [{}, {}, {}],
    axis: "vertical",
    wrap: false,
    highlight: paletteHighlight(LABEL_FIRST_ENTRY, HOVER_COLOR),
    changeSound: CLICK_SOUND,
  });
  private readonly messages = END_MESSAGES.map(encodeCp437);

  private values = [0, 0, 0];
  /** Pas de l'animation du cadran : de `from` vers `to`, image `frame` de 0 à 6 ; `null` hors animation. */
  private dial: { from: number; to: number; frame: number } | null = null;
  /** Valeur de durée dont le cadran est affiché au repos. */
  private shownDuration = 0;
  private fading = true;
  private done = false;

  constructor(private readonly onDone: (ctx: SceneContext) => void) {}

  async load(ctx: SceneContext): Promise<void> {
    [this.mcg, this.sprites, this.font] = await Promise.all([
      ctx.resources.mcg("s04a001d.mcg"),
      ctx.resources.hy8("s04a000s.hy8"),
      ctx.resources.pfn(FONT),
    ]);
    await this.menu.load(ctx);
  }

  enter(ctx: SceneContext): void {
    const { options } = ctx;
    this.values = [options.durationIndex, options.pauseIndex, options.messageIndex];
    this.shownDuration = this.values[DURATION];
    this.menu.select(ctx, 0);
    this.dial = null;
    this.done = false;
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.menu.enter(ctx);
    ctx.fade.blackout();
    ctx.fade.in();
    this.fading = true;
  }

  exit(ctx: SceneContext): void {
    this.menu.exit(ctx);
  }

  update(ctx: SceneContext): void {
    if (this.done) return;
    // L'original attend la fin du fondu d'entrée avant de lire les entrées.
    if (this.fading) {
      if (ctx.fade.active) return;
      this.fading = false;
    }
    if (this.dial) {
      // L'animation du cadran n'écoute rien (boucle bloquante de l'original) : une image par tick.
      this.dial.frame++;
      if (this.dial.frame > DIAL_FRAMES_PER_STEP) {
        this.shownDuration = this.dial.to;
        this.dial = null;
      }
      return;
    }

    const { input } = ctx;
    // Valeur : durée et pause bornées, message avec rebouclage.
    const delta = (input.justPressed("right") ? 1 : 0) - (input.justPressed("left") ? 1 : 0);
    const event = this.menu.update(ctx);
    if (delta !== 0) this.change(this.menu.index, delta, this.menu.index === MESSAGE);
    // Valider : Espace ou clic gauche.
    if (event?.kind === "validate") this.finish(ctx);
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    const { dial } = this;
    const dialSprite = dial
      ? dial.from * DIAL_FRAMES_PER_STEP + (dial.to > dial.from ? dial.frame : -dial.frame)
      : this.shownDuration * DIAL_FRAMES_PER_STEP;
    ctx.surface.drawSprite(this.sprites, dialSprite, DIAL_X, DIAL_Y);
    ctx.surface.drawSprite(this.sprites, GAUGE_SPRITE + this.values[PAUSE], GAUGE_X, GAUGE_Y);
    ctx.surface.drawText(this.font, this.messages[this.values[MESSAGE]], TEXT_X, TEXT_Y, TEXT_COLOR);
  }

  /** Change la valeur de la ligne : borne (durée, pause au clavier) ou reboucle ; la durée anime le cadran d'un pas. */
  private change(row: number, delta: number, wrap: boolean): void {
    const count = MAX_VALUES[row] + 1;
    const before = this.values[row];
    const raw = before + delta;
    this.values[row] = wrap ? (raw + count) % count : Math.min(count - 1, Math.max(0, raw));
    if (row !== DURATION) return;
    const after = this.values[DURATION];
    if (Math.abs(after - before) === 1) this.dial = { from: before, to: after, frame: 0 };
    else this.shownDuration = after;
  }

  /** `21ee:1bd7..1c4f` : les options sont enregistrées (la date de la dernière partie ne change pas). */
  private finish(ctx: SceneContext): void {
    this.done = true;
    ctx.options.durationIndex = this.values[DURATION];
    ctx.options.pauseIndex = this.values[PAUSE];
    ctx.options.messageIndex = this.values[MESSAGE];
    saveOptions(ctx.host.storage, ctx.options);
    this.onDone(ctx);
  }
}
