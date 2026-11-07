/**
 * Fondus d'écran de l'original (`11a8:302b` à l'entrée, `11a8:3065` à la sortie ; `engine.md` « Fondus d'écran »), communs à tous les écrans.
 *
 * Chaque écran de l'original appelle `11a8:302b` à la fin de son Enter (après le premier dessin) et `11a8:3065` dans son Exit : fondu de la
 * palette (entrées 1 à 254, via `1050:0043(objet 0, 1, 0, 0xfe, 1, palette)`), durée 0 donc 500 ms par défaut (`1050:0095`), soit 30 ticks,
 * mode 1 (niveau continu). Entrée : du noir (laissé par la sortie de l'écran précédent) vers la palette de l'écran (`DS:64ce`, la `SHPL` chargée,
 * sauvegardée par `1058:048a(236, 10)`) ; sortie : vers le noir, **tenu** jusqu'au fondu d'entrée suivant, et seulement si le fondu d'entrée a eu
 * lieu (`DS:a404`). Les deux **bloquent** (`1050:020a` boucle jusqu'à la fin en pompant les messages) : l'écran n'anime rien, ne lit aucun clic
 * et ne démarre ses minuteries qu'après (`11a8:2278` suit `302b`).
 *
 * Le port les fait ici, une fois pour tous les écrans : `ZoombinisEngine.register` enveloppe chaque écran (`withScreenFades`), qui lance le
 * fondu d'entrée après son `enter` et suspend son `tick`, ses touches et sa sortie tant qu'un fondu bloque ; `ZoombinisGame.goTo` passe par
 * `ScreenFades.request`, qui fait le fondu de sortie avant de demander l'écran suivant. Les objets (`Features.tick`) sont gelés pendant ce temps,
 * le son continue. Le logo (écrans 0 et 22, film sans palette) n'a pas de fondu d'entrée, donc pas de fondu de sortie (`DS:a404` à 0).
 *
 * `enabled` est faux par défaut : l'application l'active (`ui/app.ts`) ; les tests l'activent quand ils vérifient les fondus, ce qui garde
 * les délais des autres tests.
 */
import type { Fade, Palette } from "../../../engine/mohawk/graphics/palette";
import { defineService, ScreenId, type Scene, type SceneContext } from "./scene";

/** Durée des deux fondus en ticks (500 ms, `1050:0095`). */
export const SCREEN_FADE_TICKS = 30;
const SCREEN_FADE_FIRST = 1;
const SCREEN_FADE_COUNT = 254;

/** Écrans sans fondu : le logo et son doublon (film QuickTime, pas d'appel à `11a8:302b`). */
function hasFades(id: ScreenId): boolean {
  return id !== ScreenId.logo && id !== ScreenId.logoAlias;
}

export class ScreenFades {
  /** Fondus actifs (l'application) ; faux par défaut (tests). */
  enabled = false;
  private fadeIn: Fade | null = null;
  private fadeOut: Fade | null = null;
  /** Écran à demander à la fin du fondu de sortie. */
  private target: ScreenId | null = null;
  /** `DS:a404` : le fondu d'entrée de l'écran courant a eu lieu (sinon la sortie ne fond pas). */
  private faded = false;

  constructor(private readonly palette: Palette) {}

  /** Vrai pendant un fondu d'entrée en cours ou depuis le début d'un fondu de sortie jusqu'à l'écran suivant : l'écran est gelé. */
  get blocking(): boolean {
    return this.running(this.fadeIn) || this.fadeOut !== null;
  }

  /** Vrai entre le début du fondu de sortie et l'entrée de l'écran suivant. */
  get leaving(): boolean {
    return this.fadeOut !== null;
  }

  /** Début de l'`enter` d'un écran : l'état de l'écran précédent est oublié. */
  beginScreen(): void {
    this.fadeIn = null;
    this.fadeOut = null;
    this.target = null;
    this.faded = false;
  }

  /** Fin de l'`enter` (premier dessin fait) : `11a8:302b`. Pas de fondu si l'écran a déjà demandé à partir pendant son `enter`. */
  entered(ctx: SceneContext, id: ScreenId): void {
    if (!this.enabled || !hasFades(id) || ctx.scenes.pending !== null) return;
    ctx.requestPresent();
    this.fadeIn = this.palette.fadeFromBlack(SCREEN_FADE_TICKS, SCREEN_FADE_FIRST, SCREEN_FADE_COUNT);
    this.faded = true;
  }

  /** Changement d'écran (`ZoombinisGame.goTo`) : `11a8:3065` puis la demande, ou la demande tout de suite sans fondu d'entrée fait. */
  request(ctx: SceneContext, id: ScreenId): void {
    if (this.fadeOut) {
      // Une seconde demande pendant le fondu de sortie remplace la première (la dernière l'emporte, comme `SceneManager.request`).
      this.target = id;
      return;
    }
    if (!this.enabled || !this.faded) {
      ctx.scenes.request(id);
      return;
    }
    this.fadeIn = null;
    this.target = id;
    this.fadeOut = this.palette.fadeToBlack(SCREEN_FADE_TICKS, SCREEN_FADE_FIRST, SCREEN_FADE_COUNT);
  }

  /** Crochet de tick, après celui de la palette : fin du fondu de sortie → demande de l'écran suivant (bascule au tick suivant). */
  tick(ctx: SceneContext): void {
    if (this.fadeIn && !this.running(this.fadeIn)) this.fadeIn = null;
    if (this.fadeOut && !this.running(this.fadeOut) && this.target !== null) {
      ctx.scenes.request(this.target);
      this.target = null;
    }
  }

  /** Un fondu remplacé ou levé dans la palette (`clearFade`, autre fondu) ne bloque plus. */
  private running(fade: Fade | null): boolean {
    if (!fade || fade.done) return false;
    return this.palette.fade === fade;
  }
}

export const SCREEN_FADES = defineService<ScreenFades>("zoombinis.screenFades");

/**
 * Enveloppe d'un écran (`ZoombinisEngine.register`) : fondu d'entrée après `enter`, `tick`, touches et sortie suspendus tant qu'un fondu
 * bloque. Sans le service `SCREEN_FADES` (moteur sans `installServices`), l'écran est inchangé.
 */
export function withScreenFades(id: ScreenId, scene: Scene): Scene {
  const fades = (ctx: SceneContext) => ctx.services.tryGet(SCREEN_FADES);
  const wrapped: Scene = {
    enter(ctx) {
      const service = fades(ctx);
      service?.beginScreen();
      scene.enter(ctx);
      service?.entered(ctx, id);
    },
    leave(ctx) {
      scene.leave(ctx);
    },
    tick(ctx) {
      if (fades(ctx)?.blocking) return;
      scene.tick(ctx);
    },
  };
  if (scene.load) wrapped.load = (ctx) => scene.load!(ctx);
  // Pendant un fondu, l'écran ne lit pas la touche ; les raccourcis globaux (`shortcuts.ts`) restent servis.
  if (scene.key) wrapped.key = (event, ctx) => (fades(ctx)?.blocking ? false : scene.key!(event, ctx));
  if (scene.exit)
    wrapped.exit = (ctx) => {
      if (!fades(ctx)?.blocking) scene.exit!(ctx);
    };
  return wrapped;
}
