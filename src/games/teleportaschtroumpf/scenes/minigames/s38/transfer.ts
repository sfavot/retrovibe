import { measureText } from "../../../data/font";
import type { Voc } from "../../../data/voc";
import { voiceName } from "../../../engine/paths";
import type { Scene, SceneContext } from "../../../engine/scene";
import type { Game } from "../../../game/rules";
import { hasIngredient } from "../../../game/state";
import { INGREDIENT_COUNT } from "../../../game/tables";
import { drawInfo, loadInfo, pointsText, type InfoResources } from "../../s03-info";
import { TEXT_COLOR } from "../../common/text";
import { OverlayVideo } from "./overlay-video";

/**
 * Vol du Schtroumpf à lunettes (`1fc6:0c20(objet, de, vers)`) : `objet` 0..7 = un ingrédient, 8 = un point ; `de` = la victime ; `vers` = le bénéficiaire
 * (−1 si seul : l'objet est perdu). L'original présente **avant** de changer l'état : la partie est déjà à jour quand cette scène démarre, on
 * redessine donc l'état d'avant (`beforeGame`).
 *
 * Déroulé : écran info (S03) en fondu ; la vidéo `s38c` (point) ou `s38e` (ingrédient) en surimpression, avec le décalage de palette (l'écran info
 * passe dans les couleurs 128..255, la vidéo prend les 128 premières) ; la ligne de la victime redessinée (ingrédient volé grisé, `1fc6:0cc4..`) pendant la
 * réplique (`s38c003t` seul, `s38c002t` ou `s38d002t` tiré à plusieurs, `s38e002t` ingrédient) ; pour un point : cinq clignotements du compteur de la
 * victime (0,5 s éteint, 0,5 s allumé), puis la nouvelle valeur, puis la même chose pour le bénéficiaire ; pour un ingrédient donné : l'icône du bénéficiaire.
 */

export const POINT_ITEM = 8;
const ROW = 0x2e;
const ERASE_COLOR = 0x4a;
const SPRITE_OWNED = 6;
const SPRITE_MISSING = 0xf;
const SPRITE_DROP = 0xe;
const SPRITE_DROP_EMPTY = 0x17;
const BLINKS = 5;
const BLINK_TICKS = 30;

export interface Transfer {
  item: number;
  from: number;
  /** −1 : rien n'est donné (joueur seul). */
  to: number;
}

type Draw = { kind: "erase" | "text"; player: number; value: number };

/** Disposition d'une ligne de joueur (`1fc6:0c20`, boucles sur les ingrédients) : icônes (sprite, x) et nombre de places prises. */
export function rowLayout(game: Game, player: number, item: number, from: number): { icons: { sprite: number; x: number }[]; slots: number } {
  const { state } = game;
  const p = state.players[player];
  const goal = (k: number) => (state.goal.ingredients & (1 << k)) !== 0;
  const stolen = (k: number) => k === item && player === from;
  const icons: { sprite: number; x: number }[] = [];
  let slots = 0;
  for (let k = 0; k < INGREDIENT_COUNT; k++) {
    if (!goal(k)) continue;
    slots++;
    icons.push({ sprite: (hasIngredient(p, k) && !stolen(k) ? SPRITE_OWNED : SPRITE_MISSING) + k, x: slots * 0x0e + 0x57 });
  }
  for (let k = 0; k < INGREDIENT_COUNT; k++) {
    if (goal(k) || !hasIngredient(p, k)) continue;
    slots++;
    // L'ingrédient volé hors objectif prend sa place sans être redessiné (l'ancienne icône reste dans le fond).
    if (!stolen(k)) icons.push({ sprite: SPRITE_OWNED + k, x: slots * 0x0e + 0x57 });
  }
  return { icons, slots };
}

/** Partie vue comme avant le vol : `after` porte déjà les changements, on les défait. */
export function stateBefore(game: Game, t: Transfer): Game {
  const players = game.state.players.map((p) => ({ ...p }));
  const victim = players[t.from];
  if (t.item === POINT_ITEM) {
    victim.points += 1;
    if (t.to >= 0) players[t.to].points -= 1;
  } else {
    victim.ingredients |= 1 << t.item;
    victim.ingredientCount++;
    if (t.to >= 0) {
      players[t.to].ingredients &= ~(1 << t.item);
      players[t.to].ingredientCount--;
    }
  }
  return Object.create(game, { state: { value: { ...game.state, players } } }) as Game;
}

export type TransferPhase = "fadeIn" | "video" | "announce" | "blink" | "gift" | "done";

export class TransferScene implements Scene {
  readonly step = 1;
  private info!: InfoResources;
  private video!: OverlayVideo;
  private voices = new Map<string, Voc>();
  private before!: Game;
  private phase: TransferPhase = "fadeIn";
  private infoPalette = new Uint8Array(768);
  private shifted = new Uint8Array(64000);
  private combined = new Uint8Array(768);
  private voiceName = "";
  private steps: Draw[] = [];
  private stepIndex = 0;
  private stepSince = 0;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly transfer: Transfer,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {}

  get stage(): TransferPhase {
    return this.phase;
  }

  /** Nom de la voix jouée (pour les tests). */
  get voice(): string {
    return this.voiceName;
  }

  async load(ctx: SceneContext): Promise<void> {
    const { item } = this.transfer;
    this.before = stateBefore(this.game, this.transfer);
    const names = item === POINT_ITEM ? [voiceName("s38c", 3), voiceName("s38c", 2), voiceName("s38d", 2)] : [voiceName("s38e", 2)];
    const [info, video, ...vocs] = await Promise.all([
      loadInfo(ctx),
      OverlayVideo.load(ctx, item === POINT_ITEM ? "s38c.mux" : "s38e.mux"),
      ...names.map((n) => ctx.resources.voc(n)),
    ]);
    this.info = info;
    this.video = video;
    names.forEach((n, i) => this.voices.set(n, vocs[i]));
  }

  enter(ctx: SceneContext): void {
    this.phase = "fadeIn";
    this.done = false;
    drawInfo(ctx, this.info, this.before);
    this.infoPalette.set(ctx.palette.colors);
    const bg = ctx.surface.background;
    for (let i = 0; i < 64000; i++) this.shifted[i] = (bg[i] + 0x80) & 0xff;
    ctx.fade.blackout();
    ctx.fade.in();
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "fadeIn":
        if (ctx.fade.active) return;
        this.phase = "video";
        this.video.start(ctx);
        return;
      case "video":
        this.video.update(ctx, () => this.shifted);
        if (this.video.ended) {
          // Décalage inverse : l'écran info reprend ses couleurs.
          ctx.palette.load(this.infoPalette);
          this.startAnnounce(ctx);
        }
        return;
      case "announce":
        // `1f33:03a7(1)` : un clic coupe la voix.
        if (ctx.input.justPressed("validate")) ctx.voice.stop();
        if (ctx.voice.voicePlaying) return;
        this.afterAnnounce(ctx);
        return;
      case "blink": {
        // Le dernier état de chaque compteur n'attend pas (la suite enchaîne aussitôt) ; le tout dernier reste une image.
        if (this.stepIndex >= this.steps.length - 1) {
          this.finish(ctx);
          return;
        }
        const wait = this.isLastOfPlayer(this.stepIndex) ? 0 : BLINK_TICKS;
        if (ctx.clock.ticks - this.stepSince < wait) return;
        this.stepSince = ctx.clock.ticks;
        this.stepIndex++;
        return;
      }
      case "gift":
        this.finish(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    const { surface } = ctx;
    switch (this.phase) {
      case "video":
        if (this.video.shown >= 0 && !this.video.ended) {
          this.combined.set(this.infoPalette.subarray(0, 384), 384);
          this.combined.set(this.video.decoder.palette.subarray(0, 384), 0);
          ctx.palette.load(this.combined);
          surface.drawFullScreen(this.video.pixels);
        }
        return;
      case "announce":
        surface.restoreBackground();
        this.drawVictimRow(ctx);
        return;
      case "blink":
        surface.restoreBackground();
        this.drawBlink(ctx);
        return;
      case "gift":
        surface.restoreBackground();
        this.drawGift(ctx);
        return;
      default:
        return;
    }
  }

  exit(ctx: SceneContext): void {
    this.video?.stop(ctx);
  }

  private startAnnounce(ctx: SceneContext): void {
    const { item, to } = this.transfer;
    this.voiceName = item !== POINT_ITEM ? voiceName("s38e", 2) : to < 0 ? voiceName("s38c", 3) : ctx.rng.below(2) === 0 ? voiceName("s38c", 2) : voiceName("s38d", 2);
    this.phase = "announce";
    ctx.voice.play(this.voices.get(this.voiceName)!);
  }

  /** Redessine la ligne de la victime (ingrédient volé grisé) ; pour un point le compteur reste tel que le fond le montre. */
  private drawVictimRow(ctx: SceneContext): void {
    const { item, from } = this.transfer;
    if (item === POINT_ITEM) return;
    const { icons } = rowLayout(this.before, from, item, from);
    for (const icon of icons) ctx.surface.drawSprite(this.info.sprites, icon.sprite, icon.x, from * ROW + 0x30);
  }

  private afterAnnounce(ctx: SceneContext): void {
    const { item, from, to } = this.transfer;
    if (item === POINT_ITEM) {
      this.steps = [...this.blinkSteps(from, 1), ...(to >= 0 ? this.blinkSteps(to, -1) : [])];
      this.stepIndex = 0;
      this.stepSince = ctx.clock.ticks;
      this.phase = "blink";
    } else if (to >= 0) {
      this.phase = "gift";
    } else {
      this.finish(ctx);
    }
  }

  /** Valeur d'avant, cinq fois éteinte puis allumée, éteinte, puis la valeur d'après (`delta` : −1 victime, +1 bénéficiaire, vus du compteur d'avant). */
  private blinkSteps(player: number, sign: 1 | -1): Draw[] {
    const old = this.before.state.players[player].points;
    const steps: Draw[] = [];
    for (let i = 0; i < BLINKS; i++) steps.push({ kind: "erase", player, value: old }, { kind: "text", player, value: old });
    steps.push({ kind: "erase", player, value: old }, { kind: "text", player, value: old - sign });
    return steps;
  }

  private isLastOfPlayer(index: number): boolean {
    return !this.steps.slice(index + 1).some((s) => s.player === this.steps[index].player);
  }

  private drawBlink(ctx: SceneContext): void {
    // Les compteurs déjà terminés restent à leur nouvelle valeur ; le courant clignote.
    for (let i = 0; i < this.stepIndex; i++) if (this.isLastOfPlayer(i)) this.drawCounter(ctx, this.steps[i]);
    this.drawCounter(ctx, this.steps[this.stepIndex]);
  }

  private drawCounter(ctx: SceneContext, step: Draw): void {
    const { surface } = ctx;
    const { slots } = rowLayout(this.before, step.player, POINT_ITEM, step.player);
    const x = (slots + 1) * 0x0e + 0x52;
    const y = step.player * ROW + 0x25;
    // Fond effacé (`328a:0022`), puis texte et goutte si allumé.
    for (let row = y - 0x1a; row <= y + 0x10; row++) {
      for (let col = x; col <= x + 0x46; col++) if (row >= 0 && row < 200 && col < 320) surface.work[row * 320 + col] = ERASE_COLOR;
    }
    if (step.kind === "erase") return;
    const text = Uint8Array.from(pointsText(step.value, this.game.state.goal.points), (c) => c.charCodeAt(0));
    const width = surface.drawText(this.info.font, text, x, y - 5, TEXT_COLOR);
    surface.drawSprite(this.info.sprites, step.value === 0 ? SPRITE_DROP_EMPTY : SPRITE_DROP, x + 7 + width, y + 0x0b);
  }

  /** Icône de l'ingrédient chez le bénéficiaire (`1fc6:0c20`, dernière partie). */
  private drawGift(ctx: SceneContext): void {
    const { item, to } = this.transfer;
    const { state } = this.before;
    const goal = (state.goal.ingredients & (1 << item)) !== 0;
    let x: number;
    if (!goal) {
      const { slots } = rowLayout(this.before, to, -1, -1);
      const text = Uint8Array.from(pointsText(state.players[to].points, state.goal.points), (c) => c.charCodeAt(0));
      x = (slots + 2) * 0x0e + 0x59 + measureText(this.info.font, text);
    } else {
      let n = 1;
      for (let k = 0; k < item; k++) if ((state.goal.ingredients & (1 << k)) !== 0) n++;
      x = n * 0x0e + 0x57;
    }
    ctx.surface.drawSprite(this.info.sprites, SPRITE_OWNED + item, x, to * ROW + 0x30);
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx);
  }
}
