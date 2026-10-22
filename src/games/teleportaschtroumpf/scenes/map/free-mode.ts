import type { Scene, SceneContext } from "../../engine/scene";
import { newGame } from "../../game/rules";
import type { Game } from "../../game/rules";
import { VoiceLine, introVoice } from "../board/voices";
import { createMinigame } from "../minigames";
import { MapScene } from "./map-scene";
import { K_BACK, sceneOfK } from "./view";

type Phase = "map" | "intro" | "minigame";

/** Niveaux de difficulté 0..2 (`rand × 3`, `DS:6EB6`) et personnages 0..5. */
const LEVELS = 3;
const CHARACTERS = 6;

/**
 * Mode libre « Schtroumpf » (`1a3c:002a`, `docs/teleportaschtroumpf/screens-map.md`) : la carte, puis pour chaque lieu choisi
 * le niveau tiré, la voix d'accroche `sNNa`, le mini-jeu (empilé, avec fondu) et le retour à la carte sur le même lieu.
 * « Retour » (k = 1) rend la main à l'appelant.
 */
export class FreeModeScene implements Scene {
  readonly step = 3;

  private readonly map: MapScene;
  private phase: Phase = "map";
  private line: VoiceLine | null = null;
  private game: Game | null = null;
  private scene = 0;

  constructor(private readonly onDone: (ctx: SceneContext) => void) {
    this.map = new MapScene({ mode: "free" }, (ctx, k) => this.chosen(ctx, k));
  }

  get stage(): Phase {
    return this.phase;
  }

  /** La carte affichée (pour les tests). */
  get shown(): MapScene {
    return this.map;
  }

  /** Partie à un joueur qui sert de support aux mini-jeux (nulle hors lancement). */
  get currentGame(): Game | null {
    return this.game;
  }

  load(ctx: SceneContext): Promise<void> {
    return this.map.load(ctx);
  }

  enter(ctx: SceneContext): void {
    this.map.enter(ctx);
  }

  resume(ctx: SceneContext): void {
    this.game?.abortMinigame();
    this.game = null;
    this.phase = "map";
    this.map.resume(ctx);
  }

  update(ctx: SceneContext): void {
    if (this.phase === "map") this.map.update(ctx);
    else if (this.phase === "intro" && !ctx.fade.active && this.line!.update(ctx)) this.launch(ctx);
  }

  render(ctx: SceneContext): void {
    this.map.render(ctx);
  }

  /** Lieu choisi sur la carte : `k = 1` quitte ; sinon niveau tiré (`rand × 3`) puis voix d'accroche (`28a3:04dc`). */
  private chosen(ctx: SceneContext, k: number): void {
    if (k === K_BACK) return this.onDone(ctx);
    const scene = sceneOfK(k)!;
    const level = ctx.rng.below(LEVELS);
    this.line = new VoiceLine(ctx, introVoice(scene, ctx.rng));
    this.scene = scene;
    // Les mini-jeux lisent la requête de `Game.openMinigame` : une partie à un joueur, rien n'est appliqué au retour.
    this.game = newGame({ players: [{ character: ctx.rng.below(CHARACTERS), level }] }, ctx.rng);
    this.phase = "intro";
  }

  private launch(ctx: SceneContext): void {
    const game = this.game!;
    game.openMinigame(this.scene);
    this.phase = "minigame";
    ctx.scenes.push(createMinigame(this.scene, game, (c) => c.scenes.pop({ fade: true })), { fade: true });
  }
}
