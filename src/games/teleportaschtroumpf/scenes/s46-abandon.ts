import type { Hy8 } from "../data/hy8";
import type { Mcg } from "../data/mcg";
import { AREA_MARGIN, Menu, spriteArea, type MenuHighlight } from "../engine/menu";
import { voiceName } from "../engine/paths";
import type { Scene, SceneContext } from "../engine/scene";
import { HOVER_COLOR, ScreenSnapshot } from "./common/choice";
import { CLICK_SOUND } from "./setup/common";
import { askConfirmation } from "./flow";

/** Issue de S46 (`1823:0415`, engine.md §1.5). */
export type AbandonResult =
  /** Rien n'a changé (retour à la partie). */
  | { kind: "cancel" }
  /** Le joueur d'indice `index` (0..players−1) abandonne, après confirmation S49 ; au plateau de compacter les joueurs. */
  | { kind: "player"; index: number }
  /** Tous abandonnent (confirmé) : fin de partie sans vidéo, retour au menu S07. Aussi le seul joueur qui abandonne. */
  | { kind: "all" };

/** S49 pour « quitter les Schtroumpfs » (tous abandonnent), `1823:0cb9` : `S49_11T`. */
export const CONFIRM_ALL = 10;
/** Message S49 de chaque personnage (table `0,4,5,1,2,3` de `1823:0415`) : Costaud, Poète, Grognon, Gourmand, Farceur, Bricoleur. */
export const CONFIRM_BY_CHARACTER: readonly number[] = [0, 4, 5, 1, 2, 3];

/** Positions x des quatre emplacements de la rangée de joueurs ; ligne de base y = 0x64 (`31fe:0481`). */
const SLOT_X = [0x40, 0x83, 0xc4, 0x106];
const ROW_Y = 0x64;
/** Sprites de `s46a000s.hy8` : 0 à 3 = parchemin de chaque emplacement, 0xD à 0x10 = cloche, 7 à 12 = portraits. */
const SPRITE_OVERLAY = 0x0d;
const PORTRAIT_SPRITES = [8, 0xb, 0xa, 0xc, 7, 9];
/** Main qui désigne le joueur choisi (sprite 6, en dessous du portrait). */
const SPRITE_HAND = 6;
const HAND_Y = 0x73;
/** Boutons : sprite 4 (« tous ») en (0xA0, 0x9A), sprite 5 (« retour ») en (0x9E, 0xB4) ; textes en couleurs 121 et 122. */
const SPRITE_ALL = 4;
const SPRITE_CANCEL = 5;
const BUTTON_ALL = { x: 0xa0, y: 0x9a };
const BUTTON_CANCEL = { x: 0x9e, y: 0xb4 };
const PALETTE_ALL = 121;
const PALETTE_BASE = 123;

const DIRECTIONS = ["up", "down", "left", "right"] as const;

/** Emplacement de chaque joueur : un seul au milieu, deux à droite du milieu, trois ou quatre dès la gauche. */
export function slotsFor(count: number): number[] {
  if (count === 1) return [1];
  if (count === 2) return [1, 2];
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * S46 : abandon (engine.md §1.5, `1823:0415`).
 *
 * - reçoit : `players`, les personnages (0..5) des joueurs encore en jeu, dans l'ordre de jeu : leurs portraits sont affichés
 *   et leur nom choisit le message S49. Un simple nombre est accepté (les personnages 0.. sont alors supposés : c'est un
 *   repli, le plateau doit passer les vrais personnages). Écran **empilé** par le plateau au-dessus de la partie ; il
 *   enchaîne lui-même S49 (`askConfirmation`, mode `push`) ;
 * - rend : `onDone(ctx, result)` avec un `AbandonResult` ;
 * - écran suivant : le rappel décide (`pop` pour revenir à la partie, `goMainMenu` si `all`). Après un `player`, l'original
 *   compacte les joueurs (fait par l'appelant via `game/`) puis **réaffiche S46** avec ceux qui restent, tant qu'il en reste ;
 *   l'appelant doit donc recréer `createAbandonScene` ; s'il n'en reste plus, la partie se termine comme avec `all` ;
 * - fonds : `s46a001d.mcg`, `s46a000s.hy8`, voix `s46a00Nt.voc` (clic droit : joueur 3, « tous » 2, « retour » 4).
 *
 * Un seul joueur : pas d'écran S46, S49 est demandé tout de suite (Oui → `all`, Non → `cancel`). Sinon : haut / bas
 * changent de ligne (joueurs, « tous », « retour »), gauche / droite de joueur, sans rebouclage. Un joueur choisi puis
 * confirmé rend `player` ; refusé, on reste sur S46. « Tous » confirmé rend `all`, refusé `cancel` ; « retour » rend `cancel`.
 * Ajout du port : toucher un portrait ou un bouton le valide.
 */
export function createAbandonScene(players: number | readonly number[], onDone: (ctx: SceneContext, result: AbandonResult) => void): Scene {
  const characters = typeof players === "number" ? Array.from({ length: players }, (_, i) => i) : [...players];
  if (characters.length < 1 || characters.length > 4) throw new RangeError("S46 : 1 à 4 joueurs");
  if (characters.some((c) => !Number.isInteger(c) || c < 0 || c >= PORTRAIT_SPRITES.length)) throw new RangeError("S46 : personnage invalide");
  return new AbandonScene(characters, onDone);
}

/** Ce que S49 est en train de confirmer. */
type Question = { kind: "single" } | { kind: "player"; index: number } | { kind: "all" };

class AbandonScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private readonly count: number;
  private readonly slots: number[];
  private readonly snapshot = new ScreenSnapshot();
  private readonly menu: Menu;
  /** Dernier joueur choisi : la ligne « joueurs » y revient depuis les boutons. */
  private column = 0;
  private question: Question | null = null;
  private answer: boolean | null = null;
  private done = false;

  constructor(
    private readonly characters: readonly number[],
    private readonly onDone: (ctx: SceneContext, result: AbandonResult) => void,
  ) {
    this.count = characters.length;
    this.slots = slotsFor(this.count);
    this.menu = new Menu({
      // La navigation est à deux dimensions et sans rebouclage : la scène déplace la sélection (`navigate`).
      axis: "none",
      items: [...this.slots.map(() => ({ voice: voiceName("s46a", 3) })), { voice: voiceName("s46a", 2) }, { voice: voiceName("s46a", 4) }],
      highlight: this.highlight(),
      changeSound: CLICK_SOUND,
      changeSoundIfIdle: true,
      areas: () => [
        // Le portrait, pas le parchemin : celui-ci descend jusqu'aux boutons et déborde sur ses voisins.
        ...this.characters.map((character, i) => spriteArea(this.sprites, PORTRAIT_SPRITES[character], SLOT_X[this.slots[i]], ROW_Y, AREA_MARGIN)),
        spriteArea(this.sprites, SPRITE_ALL, BUTTON_ALL.x, BUTTON_ALL.y),
        spriteArea(this.sprites, SPRITE_CANCEL, BUTTON_CANCEL.x, BUTTON_CANCEL.y),
      ],
    });
  }

  async load(ctx: SceneContext): Promise<void> {
    const [mcg, sprites] = await Promise.all([ctx.resources.mcg("s46a001d.mcg"), ctx.resources.hy8("s46a000s.hy8"), this.menu.load(ctx)]);
    this.mcg = mcg;
    this.sprites = sprites;
  }

  enter(ctx: SceneContext): void {
    this.snapshot.take(ctx);
    this.done = false;
    this.question = null;
    this.answer = null;
    if (this.count === 1) return; // pas d'écran : la confirmation est demandée au premier pas
    const { surface, palette } = ctx;
    palette.load(this.mcg.palette);
    this.resetButtonColors(ctx);
    surface.drawMcg(this.mcg);
    for (const slot of this.slots) surface.drawSprite(this.sprites, slot, SLOT_X[slot], ROW_Y);
    surface.drawSprite(this.sprites, SPRITE_CANCEL, BUTTON_CANCEL.x, BUTTON_CANCEL.y);
    surface.drawSprite(this.sprites, SPRITE_ALL, BUTTON_ALL.x, BUTTON_ALL.y);
    this.characters.forEach((character, i) => surface.drawSprite(this.sprites, PORTRAIT_SPRITES[character], SLOT_X[this.slots[i]], ROW_Y));
    for (const slot of this.slots) surface.drawSprite(this.sprites, SPRITE_OVERLAY + slot, SLOT_X[slot], ROW_Y);
    surface.commitBackground();
    ctx.fade.blackout();
    ctx.fade.in();
    this.menu.enter(ctx);
  }

  resume(ctx: SceneContext): void {
    // S49 a rétabli notre écran (`ScreenSnapshot`) ; la réponse est traitée au pas suivant (pas de transition depuis `resume`).
    if (this.count > 1) this.menu.enter(ctx);
  }

  update(ctx: SceneContext): void {
    if (this.done || ctx.fade.active) return;
    if (this.answer !== null) {
      const yes = this.answer;
      this.answer = null;
      this.onAnswer(ctx, yes);
      return;
    }
    if (this.count === 1) {
      this.ask(ctx, { kind: "single" }, CONFIRM_BY_CHARACTER[this.characters[0]]);
      return;
    }
    let index = this.menu.index;
    for (const direction of DIRECTIONS) if (ctx.input.justPressed(direction)) index = this.navigate(index, direction);
    this.menu.move(ctx, index);
    const event = this.menu.update(ctx);
    if (event?.kind !== "validate") return;
    if (event.index < this.count) this.ask(ctx, { kind: "player", index: event.index }, CONFIRM_BY_CHARACTER[this.characters[event.index]]);
    else if (event.index === this.count) this.ask(ctx, { kind: "all" }, CONFIRM_ALL);
    else this.finish(ctx, { kind: "cancel" });
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    if (this.count > 1) this.menu.render(ctx);
  }

  exit(ctx: SceneContext): void {
    if (this.count > 1) this.menu.exit(ctx);
    this.snapshot.restore(ctx);
  }

  private ask(ctx: SceneContext, question: Question, n: number): void {
    this.question = question;
    askConfirmation(
      ctx,
      n,
      (c, yes) => {
        this.answer = yes;
        c.scenes.pop({ fade: true });
      },
      "push",
    );
  }

  private onAnswer(ctx: SceneContext, yes: boolean): void {
    const question = this.question;
    this.question = null;
    if (!question) return;
    if (question.kind === "player") {
      // Refusé : on reste sur S46 (l'original boucle).
      if (yes) this.finish(ctx, { kind: "player", index: question.index });
    } else {
      this.finish(ctx, yes ? { kind: "all" } : { kind: "cancel" });
    }
  }

  private finish(ctx: SceneContext, result: AbandonResult): void {
    this.done = true;
    ctx.voice.stop();
    this.onDone(ctx, result);
  }

  /** Haut / bas : ligne suivante (joueurs, tous, retour) ; gauche / droite : joueur (ligne des joueurs seulement). Sans rebouclage. */
  private navigate(index: number, direction: "up" | "down" | "left" | "right"): number {
    const row = index < this.count ? 0 : index - this.count + 1;
    if (direction === "left" || direction === "right") {
      if (row !== 0) return index;
      return Math.min(this.count - 1, Math.max(0, index + (direction === "right" ? 1 : -1)));
    }
    const next = Math.min(2, Math.max(0, row + (direction === "down" ? 1 : -1)));
    return next === 0 ? this.column : this.count + next - 1;
  }

  /** Les textes des deux boutons (121, 122) partent de la couleur 123 ; l'élément choisi passe en couleur de survol. */
  private highlight(): MenuHighlight {
    return {
      select: (ctx, index) => {
        if (index < this.count) this.column = index;
        else ctx.palette.setColor(PALETTE_ALL + index - this.count, ...HOVER_COLOR);
      },
      deselect: (ctx, index) => {
        if (index >= this.count) this.setBase(ctx, PALETTE_ALL + index - this.count);
      },
      render: (ctx, index) => {
        if (index < this.count) ctx.surface.drawSprite(this.sprites, SPRITE_HAND, SLOT_X[this.slots[index]], HAND_Y);
      },
    };
  }

  private resetButtonColors(ctx: SceneContext): void {
    this.setBase(ctx, PALETTE_ALL);
    this.setBase(ctx, PALETTE_ALL + 1);
  }

  private setBase(ctx: SceneContext, entry: number): void {
    const c = ctx.palette.colors;
    ctx.palette.setColor(entry, c[PALETTE_BASE * 3], c[PALETTE_BASE * 3 + 1], c[PALETTE_BASE * 3 + 2]);
  }
}
