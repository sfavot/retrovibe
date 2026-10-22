import type { Voc } from "../data/voc";
import type { Scene, SceneContext } from "../engine/scene";
import { VideoScene } from "../engine/video";
import type { Game, GameEvent } from "../game/rules";
import type { Position } from "../game/tables";
import { pickClip, type EventClip } from "./events/clips";

export { approachX } from "./events/clips";
export { createWellScene } from "./events/well";

/**
 * Événements du plateau S13 à S21 (engine.md §1.4, `2a78:00da` et ses animations `2a78:015f..1244`, rules.md §4 ;
 * `docs/teleportaschtroumpf/screens-events.md`).
 *
 * ### `createBoardEventScene(request, onDone)`
 *
 * - reçoit : `request.game` (partie, état **déjà** à jour : le pion et le tour sont réglés par `game/`), `request.event` :
 *   `hazard` (piège de marche S15, lac S18, pont S16, fusée S17, puits S14, prison S20, Turlusiphon S21, animation du puits S13 ;
 *   `scene` donne l'animation, `kind` le type) ou `release` (libération de la prison ou du Turlusiphon au début du tour,
 *   animations S20 `s20c/f/i/l/o` et S21 `s21b/d/f/h/j/l`), `request.before` (position du pion au déclenchement) et
 *   `request.after` (position une fois l'effet appliqué : arrivée de la téléportation, cage, siphon) ;
 * - joue : la vidéo MUX de l'événement en plein écran (non passable : `179a:0673` est appelé sans les drapeaux de saut), puis
 *   la voix de l'événement s'il y en a une (`s14a`, `s15a`, `s16a`, `s17a`, `s18a` : 1 à 3 ou 4 ; `s21v` : 1 à 3) ; la vidéo
 *   dépend du côté d'où le pion arrive (`before.x`) et, pour la libération du Turlusiphon, de son regard (`Player.facingRight`) ;
 * - rend : `onDone(ctx)` ; le plateau place alors le pion en `after` (animation d'arrivée si l'écran change), rien d'autre à rendre : toute
 *   l'issue vient de `game/` ;
 * - appelant : `scenes/game.ts`, qui **empile** la scène sans fondu (le plateau reste en dessous, il est redessiné au retour) et la
 *   retire par `ctx.scenes.pop()` dans `onDone` ;
 * - écran suivant : celui du plateau ; pour une prison ou un Turlusiphon le tour est déjà fini (`skip` suit) ;
 * - non reproduit ici : la marche du pion jusqu'au point de déclenchement (`approachX` donne ce `x`, c'est au plateau de l'animer) ;
 * - références : `s13a..f.mux`, `s14a/b.mux`, `s15a..n.mux`, `s16a/b.mux`, `s17a.mux`, `s18a/b.mux`, `s20a..o.mux`, `s21a..l.mux`, voix
 *   `s14a`, `s15a`, `s16a`, `s17a`, `s18a`, `s21v`.
 *
 * ### `createWellScene(game, onDone)` (`events/well.ts`)
 *
 * - reçoit : `game` ; la requête est `game.state.pending` (`wellMode` : `"ingredient"` = choisir un ingrédient manquant,
 *   `"travel"` = choisir un lieu sur la carte, `createMapScene` en mode `"wish"`) ;
 * - rend : `onDone(ctx, outcome)` avec `{ kind: "well", ingredient }` ou `{ kind: "well", destination }` (`k` de la carte), `null`
 *   si rien n'est choisi (carte quittée, 36 s écoulées) ; l'issue est appliquée par l'appelant (`Game.resolveMinigame`) ;
 * - appelant : `scenes/game.ts`, qui **empile** la scène avec fondu et la retire dans `onDone` ;
 * - références : `s13a`, `s13b`, `s13c` (voix), `s13g.mux`, `s13a000s.hy8` (curseur), `s07a001b.voc` (bip).
 */
export interface BoardEventRequest {
  game: Game;
  event: Extract<GameEvent, { type: "hazard" | "release" }>;
  before: Position;
  after: Position;
}

type Phase = "video" | "voice" | "done";

/**
 * Scène d'un événement du plateau : la vidéo (une `VideoScene` pilotée de l'intérieur, pour ne rien empiler), puis la voix
 * (`1f33:03a7` : on attend la fin), puis `onDone`. Sa dernière image reste à l'écran pendant la voix.
 */
export class BoardEventScene implements Scene {
  readonly step = 1;
  private clip: EventClip | null = null;
  private video: VideoScene | null = null;
  private voc: Voc | null = null;
  private phase: Phase = "video";

  constructor(
    private readonly request: BoardEventRequest,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {}

  /** Fichier vidéo joué (pour les tests), `null` pour une combinaison inconnue. */
  get clipInfo(): EventClip | null {
    return this.clip;
  }

  async load(ctx: SceneContext): Promise<void> {
    const { game, event, before, after } = this.request;
    const facingRight = game.state.players[event.player]?.facingRight ?? true;
    this.clip = pickClip(event, before, after, facingRight, ctx.rng);
    if (!this.clip) return;
    // Les vidéos des événements ne sont pas passables (`179a:0673` sans les drapeaux 0x400 / 0x800).
    this.video = new VideoScene({ file: this.clip.video, skippable: false, onEnd: (c) => this.videoEnded(c) });
    const voice = this.clip.voice;
    const [, voc] = await Promise.all([this.video.load(ctx), voice ? ctx.resources.voc(voice).catch(() => null) : null]);
    this.voc = voc;
  }

  enter(ctx: SceneContext): void {
    this.phase = "video";
    if (this.video) this.video.enter(ctx);
  }

  update(ctx: SceneContext): void {
    if (this.phase === "done") return;
    if (!this.video) return this.finish(ctx);
    if (this.phase === "video") return this.video.update(ctx);
    const cut = this.clip?.voiceSkippable === true && ctx.input.anyJustPressed("validate", "skip");
    if (cut || !ctx.voice.voicePlaying) {
      ctx.voice.stop();
      this.finish(ctx);
    }
  }

  render(ctx: SceneContext): void {
    this.video?.render(ctx);
  }

  exit(ctx: SceneContext): void {
    if (this.phase === "video") this.video?.exit(ctx);
  }

  private videoEnded(ctx: SceneContext): void {
    this.video!.render(ctx);
    this.video!.exit(ctx);
    this.phase = "voice";
    if (this.voc) ctx.voice.play(this.voc);
  }

  private finish(ctx: SceneContext): void {
    this.phase = "done";
    this.onDone(ctx);
  }
}

export function createBoardEventScene(request: BoardEventRequest, onDone: (ctx: SceneContext) => void): Scene {
  return new BoardEventScene(request, onDone);
}
