import type { Voc } from "../data/voc";
import type { Game } from "../game/rules";
import { voiceName } from "../engine/paths";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenSnapshot } from "./common/choice";
import { drawInfo, loadInfo, type InfoResources } from "./s03-info";

/**
 * S45 : aide, contenu dessiné de l'écran S03 « Info » (engine.md §1.5, `1e20:027c` → `1e20:0007`).
 *
 * - reçoit : `game`, la partie en cours (temps, portraits et ingrédients de chaque joueur). Écran **empilé** par le plateau
 *   ou la pause ;
 * - rend : `onDone(ctx)` après un clic gauche (ou Espace) ; le clic droit (ou Entrée) joue la voix d'aide ;
 * - écran suivant : le rappel décide (`pop` en général) ;
 * - fonds : `s03a001d.mcg`, `s03a000s.hy8` (voir `s03-info.ts`), voix `s45v003t.voc`.
 *
 * L'écran de la partie est rétabli à la sortie (`ScreenSnapshot`). Écart : le code de l'original nomme la voix `s45a003t.voc`,
 * absente des fichiers livrés où elle s'appelle `s45v003t.voc` (probable faute de lettre de l'original, comme `s48a008t`).
 */
export function createHelpScene(game: Game, onDone: (ctx: SceneContext) => void): Scene {
  return new HelpScene(game, onDone);
}

class HelpScene implements Scene {
  readonly step = 1;
  private info!: InfoResources;
  private voice!: Voc;
  private done = false;
  private readonly snapshot = new ScreenSnapshot();

  constructor(
    private readonly game: Game,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {}

  async load(ctx: SceneContext): Promise<void> {
    [this.info, this.voice] = await Promise.all([loadInfo(ctx), ctx.resources.voc(voiceName("s45v", 3))]);
  }

  enter(ctx: SceneContext): void {
    this.snapshot.take(ctx);
    drawInfo(ctx, this.info, this.game);
    ctx.fade.blackout();
    ctx.fade.in();
    this.done = false;
  }

  update(ctx: SceneContext): void {
    if (this.done || ctx.fade.active) return;
    if (ctx.input.justPressed("validate")) {
      this.done = true;
      ctx.voice.stop();
      this.onDone(ctx);
    } else if (ctx.input.justPressed("cancel")) {
      ctx.voice.play(this.voice);
    }
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
  }

  exit(ctx: SceneContext): void {
    this.snapshot.restore(ctx);
  }
}
