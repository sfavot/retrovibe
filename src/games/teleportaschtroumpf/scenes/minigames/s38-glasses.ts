import type { Scene, SceneContext } from "../../engine/scene";
import type { Game, GameEvent } from "../../game/rules";
import { minigameRequest, type AftermathFactory, type MinigameDone, type MinigameFactory } from "./common";
import { POINT_ITEM, TransferScene, type Transfer } from "./s38/transfer";
import { WalkScene } from "./s38/walk";

/**
 * S38 « Le Schtroumpf à Lunettes » (`1fc6:0008`, 925 octets ; RE : `docs/teleportaschtroumpf/minigames/s38.md`).
 *
 * ### `createGlasses(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 38) ; ni niveau ni indice de l'oiseau ne servent ;
 * - joue : rien. Dans l'original la fonction n'a aucune interaction : elle tire (vol ou promenade), puis présente. Le tirage et l'effet sont dans
 *   `Game.resolveMinigame` (`bespectacled`) ; la présentation est `createGlassesAftermath`, jouée juste après. Cette scène rend la main aussitôt ;
 * - rend : `onDone(ctx, { kind: "none" })`.
 *
 * ### `createGlassesAftermath(game, events, onDone)`
 *
 * - reçoit : les événements de `resolveMinigame` ; l'événement `bespectacled` dit quoi montrer ; la partie est **déjà** mise à jour ;
 * - joue : la promenade (`WalkScene`, vidéo 9..24) ou le vol (`TransferScene` : ingrédient ou point perdu seul, pris au plus riche à plusieurs) ;
 * - rend : `onDone(ctx)` à la fin ; `null` s'il n'y a pas d'événement `bespectacled`.
 */

export class GlassesScene implements Scene {
  readonly step = 1;
  private done = false;

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 38);
  }

  enter(): void {
    this.done = false;
  }

  update(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.onDone(ctx, { kind: "none" });
  }

  render(): void {}
}

export const createGlasses: MinigameFactory = (game, onDone) => new GlassesScene(game, onDone);

type Bespectacled = Extract<GameEvent, { type: "bespectacled" }>;

/** Ce que l'événement fait perdre : l'objet (0..7 ingrédient, 8 point), la victime et le bénéficiaire ; `null` pour une promenade. */
export function transferOf(event: Bespectacled): Transfer | null {
  switch (event.result) {
    case "ingredientLost":
      return { item: event.ingredient!, from: event.player, to: -1 };
    case "pointLost":
      return { item: POINT_ITEM, from: event.player, to: -1 };
    case "pointsMoved":
      return { item: POINT_ITEM, from: event.from!, to: event.to! };
    case "ingredientMoved":
      return { item: event.ingredient!, from: event.from!, to: event.to! };
    case "nothing":
      return null;
  }
}

export const createGlassesAftermath: AftermathFactory = (game, events, onDone) => {
  const event = events.find((e): e is Bespectacled => e.type === "bespectacled");
  if (!event) return null;
  const transfer = transferOf(event);
  if (transfer) return new TransferScene(game, transfer, onDone);
  // Promenade : l'écran de départ est celui d'avant le déplacement (`1fc6:085f` s'exécute avant que le pion bouge).
  const moved = events.find((e): e is Extract<GameEvent, { type: "moved" }> => e.type === "moved" && e.cause === "bespectacled");
  const player = game.state.players[event.player];
  return new WalkScene(event.video!, moved?.from.screen ?? player.screen, player.character, onDone);
};
