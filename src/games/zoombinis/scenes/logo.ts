/**
 * Écran 0 : le logo (`1180:*`, `docs/zoombinis/screens.md` §1.3). L'original joue `Logo025.MOV` (QuickTime) ; le port joue `LOGO025.mp4`
 * (conversion ffmpeg de `scripts/zoombinis-extract.sh`) par la capacité `Host.playVideo`. Un clic ou une touche arrête le film
 * (`1180:0000` → `1180:0245(−1)`), sa fin fait de même ; `Ctrl+Q` quitte tout de suite (`1180:007d`, `[a1ee] = −1`). On passe ensuite à
 * l'écran de reprise de `1160:0521` (`resumeScreen`) : choix des Zoombinis pour une partie neuve, sinon l'écran où la partie s'était arrêtée.
 *
 * Écart : `1180:0048` remet `[9e0c]` à 0 à chaque entrée dans l'écran, donc l'original rejoue le film chaque fois qu'il repasse par le
 * logo ; le port ne le joue qu'une fois par chargement de page (décision du plan, vague G), les passages suivants (redémarrage du jeu
 * depuis l'accueil) vont directement à la reprise. L'hôte sans `playVideo`, ou dont le film est illisible, saute le film.
 */
import { isModifierOnlyKey } from "../../../engine/mohawk/input";
import { ZOOMBINIS_GAME } from "../engine/game";
import type { VideoPlayback } from "../engine/host";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenId } from "../engine/scene";
import { GRAPHICS } from "../engine/services";
import { resumeScreen } from "../game/route";

/** Le film, dans `original/zoombinis/` (conversion de `FRENCH/LOGO025.MOV`). */
export const LOGO_FILE = "LOGO025.mp4";

/** `[9e0c]` : le film a déjà été lancé depuis le chargement de la page. */
let filmStarted = false;

/** Remet à zéro « le film a déjà été joué » (tests ; un vrai chargement de page repart de zéro). */
export function resetLogoFilm(): void {
  filmStarted = false;
}

export function createLogoScene(): Scene {
  let film: VideoPlayback | null = null;
  let finished = false;

  /** `1180:0245` : arrête le film et passe à l'écran de reprise (`[8556] = 1160:0521`). */
  function finish(ctx: SceneContext): void {
    if (finished) return;
    finished = true;
    film?.stop();
    film = null;
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    zoombinis.goTo(ctx, resumeScreen(zoombinis.game, zoombinis.session));
  }

  return {
    enter(ctx: SceneContext) {
      finished = false;
      ctx.services.get(ZOOMBINIS_GAME).session.screen = ScreenId.logo;
      // Fond noir sous la vidéo (et seul affichage si le film n'est pas lu).
      ctx.services.get(GRAPHICS).screen.pixels.fill(0);
      ctx.requestPresent();
      const host = ctx.host;
      if (!filmStarted && host.playVideo) {
        filmStarted = true;
        film = host.playVideo(LOGO_FILE);
      }
    },
    leave() {
      film?.stop();
      film = null;
    },
    tick(ctx: SceneContext) {
      if (finished) return;
      const { input } = ctx;
      // Un clic ou une touche (hors modificateurs seuls) arrête le logo.
      const touched =
        input.buttonEvents.some((event) => event.down) ||
        input.keyEvents.some((event) => !isModifierOnlyKey(event.key) && !isQuit(event));
      if (touched || film === null || film.ended) finish(ctx);
    },
    key(event, ctx: SceneContext) {
      if (!isQuit(event)) return false;
      finished = true;
      film?.stop();
      film = null;
      ctx.host.exit();
      return true;
    },
  };
}

function isQuit(event: { ctrl: boolean; alt: boolean; code: string }): boolean {
  return event.ctrl && !event.alt && event.code === "KeyQ";
}
