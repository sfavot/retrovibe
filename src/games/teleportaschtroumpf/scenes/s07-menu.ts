import { SCREEN_HEIGHT, SCREEN_WIDTH, type Mcg } from "../data/mcg";
import type { Voc } from "../data/voc";
import { TICKS_PER_SECOND } from "../engine/clock";
import { Menu, paletteHighlight } from "../engine/menu";
import { isLocked } from "../engine/options";
import { musicName, voiceName } from "../engine/paths";
import type { Scene, SceneContext } from "../engine/scene";
import { goFreeMap, goIntro, goParents, goPlayers, goRules, quitGame } from "./flow";

/** Boutons de S07, de haut en bas (engine.md §1.2). */
export const MENU_RULES = 0;
export const MENU_INTRO = 1;
export const MENU_FREE_MAP = 2;
export const MENU_PLAY = 3;
export const MENU_PARENTS = 4;
export const MENU_QUIT = 5;

/** Numéros de voix `s07v00Nt.voc` de chaque bouton (clic droit). */
const HELP_VOICES = [4, 5, 7, 2, 8, 6];

/** Première entrée de palette du texte des boutons (120 à 125) et couleur de survol (RVB 8 bits `10 A4 CC`). */
const TEXT_PALETTE_FIRST = 120;
const HOVER_COLOR = [0x10, 0xa4, 0xcc] as const;

/** Durée de maintien du bouton Parents (`1f33:019a(1) > 4`). */
export const PARENTS_HOLD_SECONDS = 4;

/** Marge autour du texte du bouton Parents pour l'appui long au pointeur (pixels 320×200) : le texte seul est une cible trop fine. */
const PARENTS_AREA_MARGIN = 6;

/** Rectangle (bornes incluses) des pixels d'un indice de palette dans un écran 320×200, élargi de `margin`. */
export function paletteBounds(pixels: Uint8Array, index: number, margin = 0): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = SCREEN_WIDTH;
  let y0 = SCREEN_HEIGHT;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (pixels[y * SCREEN_WIDTH + x] !== index) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  return {
    x0: Math.max(0, x0 - margin),
    y0: Math.max(0, y0 - margin),
    x1: Math.min(SCREEN_WIDTH - 1, x1 + margin),
    y1: Math.min(SCREEN_HEIGHT - 1, y1 + margin),
  };
}

/**
 * Menu principal S07 (engine.md §1.2, `21ee:0e8f`) : fond `s07a001d.mcg`, musique de fond `s52m00Nm.voc` tirée une fois
 * (conservée tant qu'elle joue sur la voie), six boutons. Haut / bas changent de bouton avec rebouclage et le bip de
 * navigation `s07a001b.voc` (pas de son à l'entrée) ; Espace valide, Entrée joue la voix d'aide.
 *
 * Le bouton Parents ne s'ouvre qu'en maintenant la touche droite 4 s ; valider ne fait rien. Jouer sous verrou parental ne
 * fait rien non plus (l'original n'affiche aucun message).
 *
 * Ajout au port, pour la souris et le doigt (l'original n'a que le clavier) : un appui tenu 4 s sur le bouton Parents l'ouvre
 * aussi. Ailleurs, la position du pointeur ne désigne toujours rien.
 */
export function createMenuScene(): Scene {
  return new MenuScene();
}

class MenuScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private music: Voc | null = null;
  private holdStart: number | null = null;
  /** Zone du bouton Parents (texte en palette 124, élargi) pour l'appui long au pointeur. */
  private parentsArea: ReturnType<typeof paletteBounds> = null;
  private readonly menu = new Menu({
    axis: "vertical",
    items: HELP_VOICES.map((n) => ({ voice: voiceName("s07v", n) })),
    changeSound: "s07a001b.voc",
    highlight: paletteHighlight(TEXT_PALETTE_FIRST, HOVER_COLOR),
  });

  async load(ctx: SceneContext): Promise<void> {
    // La musique est tirée une fois : au retour d'un écran, celle qui est déjà réglée sur la voie est gardée.
    const music = ctx.voice.hasMusic ? null : ctx.resources.voc(musicName(1 + ctx.rng.below(3)));
    const [mcg, picked] = await Promise.all([ctx.resources.mcg("s07a001d.mcg"), music, this.menu.load(ctx)]);
    this.mcg = mcg;
    this.music = picked;
    this.parentsArea = paletteBounds(mcg.pixels, TEXT_PALETTE_FIRST + MENU_PARENTS, PARENTS_AREA_MARGIN);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    ctx.fade.blackout();
    ctx.fade.in();
    this.menu.enter(ctx);
    if (this.music) ctx.voice.setMusic(this.music);
    this.holdStart = null;
  }

  update(ctx: SceneContext): void {
    // L'original attend la fin du fondu avant de lire les entrées.
    if (ctx.fade.active) return;
    // Appui sur Parents : il est sélectionné avant que le clic ne valide (valider Parents ne fait rien, rien d'autre ne part).
    if (this.pointerOnParents(ctx)) this.menu.select(ctx, MENU_PARENTS);
    const event = this.menu.update(ctx);
    if (this.updateParentsHold(ctx)) return;
    if (event?.kind === "validate") this.choose(ctx, event.index);
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    this.menu.render(ctx);
  }

  exit(ctx: SceneContext): void {
    this.menu.exit(ctx);
  }

  /** Le pointeur (souris ou doigt) est tenu sur le bouton Parents. */
  private pointerOnParents(ctx: SceneContext): boolean {
    const area = this.parentsArea;
    const { input } = ctx;
    return (
      area !== null && input.pointerHeld && input.mouseX >= area.x0 && input.mouseX <= area.x1 && input.mouseY >= area.y0 && input.mouseY <= area.y1
    );
  }

  /**
   * Accès parents : touche droite maintenue `PARENTS_HOLD_SECONDS` secondes sur le bouton Parents (ou appui tenu dessus au
   * pointeur). Renvoie vrai si l'écran est lancé.
   */
  private updateParentsHold(ctx: SceneContext): boolean {
    const holding = this.menu.index === MENU_PARENTS && (ctx.input.pressed("right") || this.pointerOnParents(ctx));
    if (!holding) {
      this.holdStart = null;
      return false;
    }
    this.holdStart ??= ctx.clock.ticks;
    if (ctx.clock.ticks - this.holdStart < PARENTS_HOLD_SECONDS * TICKS_PER_SECOND) return false;
    goParents(ctx);
    return true;
  }

  private choose(ctx: SceneContext, index: number): void {
    switch (index) {
      case MENU_RULES:
        goRules(ctx);
        break;
      case MENU_INTRO:
        goIntro(ctx);
        break;
      case MENU_FREE_MAP:
        goFreeMap(ctx);
        break;
      case MENU_PLAY:
        // Verrouillé : rien ne se passe (aucun message dans l'original).
        if (!isLocked(ctx.options, Math.floor(ctx.host.unixSeconds() / 60))) goPlayers(ctx);
        break;
      case MENU_PARENTS:
        // Valider ne fait rien : voir `updateParentsHold`.
        break;
      case MENU_QUIT:
        quitGame(ctx);
        break;
    }
  }
}
