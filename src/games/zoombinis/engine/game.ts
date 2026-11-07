/**
 * Partie en cours (vague G) : l'état de la partie (`game/state.ts`), les globales de session, les parties enregistrées, et le changement
 * d'écran de l'original (`1108:0000`) que les écrans appellent au lieu de `ctx.scenes.request`.
 */
import { changeScreen, type ScreenChange } from "../game/route";
import { SaveStore } from "../game/saves";
import { createSession, newGame, prefsFromOptions, type GameState, type Session } from "../game/state";
import type { ZoombinisContext } from "./context";
import type { ZoombinisEngine } from "./engine";
import type { Host } from "./host";
import { defineService } from "./scene";
import type { ScreenId } from "./scene";
import { ZOOMBINIS_TEXT } from "./text";

/** `STRL` 1100 de `TEXTSTR.MHK` : caractères admis dans un nom de partie (`screens.md` §1.5). */
const NAME_CHARSET_STRL = 1100;

export class ZoombinisGame {
  /** Partie courante (le tampon `S` de l'original). Remplacée par une nouvelle partie ou un chargement. */
  game: GameState = newGame();
  readonly session: Session = createSession();
  /** Dernier changement d'écran (`XFER` y lit sa destination et son trajet). */
  lastChange: ScreenChange | null = null;

  constructor(readonly saves: SaveStore) {}

  /**
   * Demande l'écran `requested` comme `[8554]` : écriture automatique de la partie nommée (`11a0:141e`), règles de `1108:0000`
   * (progression, transition `XFER` intercalée, point de reprise), puis changement de scène différé.
   */
  goTo(ctx: ZoombinisContext, requested: number): ScreenChange {
    this.saves.autoSave(this.game, this.session);
    const change = changeScreen(this.game, this.session, requested);
    this.lastChange = change;
    ctx.scenes.request(change.screen as ScreenId);
    return change;
  }
}

export const ZOOMBINIS_GAME = defineService<ZoombinisGame>("zoombinis.game");

/**
 * Installe la partie (après `installText`, qui fournit le jeu de caractères des noms). Les options de la partie pilotent `ctx.prefs`
 * à chaque tick : une option basculée par un raccourci ou le menu prend effet au plus tard au tick suivant.
 */
export function installGame(engine: ZoombinisEngine): ZoombinisGame {
  const { ctx } = engine;
  const charset = ctx.services.get(ZOOMBINIS_TEXT).strings.get(NAME_CHARSET_STRL, 1) ?? "";
  const zoombinis = new ZoombinisGame(new SaveStore(ctx.host.storage, charset));
  engine.services.provide(ZOOMBINIS_GAME, zoombinis);
  engine.addTickHook((c) => {
    Object.assign(c.prefs, prefsFromOptions(zoombinis.game.options));
    // Au doigt, le transport dépose au relâchement : l'option « souris aimantée » (clic-clic) ne s'applique qu'à la souris.
    if ((c.host as Host).pointerIsTouch) c.prefs.magneticMouse = false;
  });
  return zoombinis;
}
