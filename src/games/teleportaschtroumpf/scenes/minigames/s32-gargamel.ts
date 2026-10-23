import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { Clip, goalClip, ingredientOutcome, minigameRequest, sceneIngredient, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S32 « Chez Gargamel » (`199e:000a`, 156 octets ; RE : `docs/teleportaschtroumpf/minigames/s32.md`).
 *
 * ### `createGargamel(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 32) : `successChance` (`1 / (niveau + 2)`, 1 avec l'indice
 *   de l'oiseau), déjà préparé par `Game` ;
 * - joue : un tirage (`game.rollChezGargamel()`), puis une vidéo (`s32cd1` / `s32cd2` si le tirage réussit selon que l'ingrédient 4 fait partie
 *   de l'objectif, `s32b` sinon), passable par Échap ou Espace (`154c:0954`) ; aucune interaction, aucune voix propre ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la vidéo ; l'appelant applique l'issue.
 */

/** Ingrédient donné par la scène (`MINIGAMES`) : 4. */
const INGREDIENT = sceneIngredient(32)!;

/** Vidéo de fin : `s32b` (échec), `s32cd1` (réussi, ingrédient hors objectif), `s32cd2` (réussi, dans l'objectif). */
export function gargamelClip(game: Game, success: boolean): string {
  if (!success) return "s32b.mux";
  return goalClip(game, INGREDIENT, { inGoal: "s32cd2.mux", notInGoal: "s32cd1.mux" });
}

export class GargamelScene implements Scene {
  readonly step = 1;
  private clip: Clip | null = null;
  private result = false;
  private rolled = false;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 32);
  }

  /** Résultat du tirage (pour les tests) : vrai s'il réussit ; `null` avant l'entrée. */
  get success(): boolean | null {
    return this.rolled ? this.result : null;
  }

  /** Vidéo choisie (pour les tests). */
  get file(): string | null {
    return this.clip?.file ?? null;
  }

  /** Le tirage se fait au chargement (`199e:0018..29`) : la vidéo à lire en dépend. */
  load(ctx: SceneContext): Promise<void> {
    this.result = this.game.rollChezGargamel();
    this.rolled = true;
    this.clip = new Clip(gargamelClip(this.game, this.result), (c) => this.finish(c));
    return this.clip.load(ctx);
  }

  enter(ctx: SceneContext): void {
    this.done = false;
    this.clip!.start(ctx);
  }

  update(ctx: SceneContext): void {
    this.clip!.update(ctx);
  }

  render(ctx: SceneContext): void {
    this.clip!.render(ctx);
  }

  exit(ctx: SceneContext): void {
    this.clip?.stop(ctx);
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.onDone(ctx, ingredientOutcome(this.result));
  }
}

export const createGargamel: MinigameFactory = (game, onDone) => new GargamelScene(game, onDone);
