/**
 * Registre des scènes de Math Workshop : une fabrique par `SceneId`, chaque scène de la table ci-dessous ; celles qui ne sont pas encore
 * écrites sont remplacées par `createPlaceholderScene` (écran noir, un clic ou une touche ramène au hub) pour que le hub ne soit
 * jamais une impasse.
 *
 * Brancher une scène écrite à part = une ligne dans `SCENE_FACTORIES` (ou, de l'extérieur, `options.factories`).
 */
import type { Engine } from "../engine/engine";
import { SceneId, type Scene, type SceneContext, type SceneFactory } from "../engine/scene";
import type { MathServices } from "../engine/services";
import { createCreditsScene } from "./credits";
import type { CertificateEnvironment, CertificatePort } from "./certificate";
import { createHiddenScene } from "./hidden";
import { createHubScene, type HubOptions } from "./hub";
import { createPatternsScene } from "./patterns";
import { createRocketsScene } from "./rockets";
import { createSticklersScene } from "./sticklers";
import { createTitleScene } from "./title";
import { createTrophyScene } from "./trophy";

export interface RegisterScenesOptions extends HubOptions {
  /** Téléchargement du certificat du Hall of Fame (hôte navigateur) ; sans lui, « Print My Certificate » est inactif. */
  certificates?: CertificatePort;
  /** Canevas et polices du certificat ; défaut : le navigateur. */
  certificateEnvironment?: CertificateEnvironment;
  /** Fabriques qui remplacent celles de la table (tests, scènes branchées de l'extérieur). */
  factories?: Partial<Record<SceneId, SceneFactory>>;
}

/** Fabrique d'une scène à partir des services et des options. */
type SceneBuilder = (services: MathServices, options: RegisterScenesOptions, engine: Engine) => Scene;

/**
 * Une ligne par scène écrite. Les scènes absentes de la table ont le substitut noir.
 * Exemple d'ajout : `[SceneId.rockets]: (services) => createRocketsScene(services),`.
 */
const SCENE_FACTORIES: Partial<Record<SceneId, SceneBuilder>> = {
  [SceneId.title]: (services) => createTitleScene(services),
  [SceneId.credits]: (services) => createCreditsScene(services),
  [SceneId.hub]: (services, options) => createHubScene(services, options),
  [SceneId.hidden]: (services) => createHiddenScene(services),
  [SceneId.patterns]: (services) => createPatternsScene(services),
  [SceneId.sticklers]: (services) => createSticklersScene(services),
  [SceneId.rockets]: (services) => createRocketsScene(services),
  [SceneId.trophy]: (services, options, engine) =>
    createTrophyScene(services, {
      certificates: options.certificates,
      certificateEnvironment: options.certificateEnvironment,
      exitTo: trophyExit(engine.scenes.currentId),
    }),
};

/** Le Hall of Fame revient à la scène d'où l'on vient (le Bowling, dans l'original) ; hub si elle n'a pas de suite (titre, crédits, rien). */
function trophyExit(from: SceneId | undefined): SceneId {
  return from === undefined || from === SceneId.title || from === SceneId.credits || from === SceneId.trophy ? SceneId.hub : from;
}

/**
 * Scène provisoire des activités pas encore branchées : écran noir, rien à faire, un clic ou une touche ramène au hub.
 * La palette reste noire (le hub a fondu vers le noir avant de partir).
 */
class PlaceholderScene implements Scene {
  constructor(private readonly services: MathServices) {}

  enter(ctx: SceneContext): void {
    this.services.graphics.screen.fill(0);
    ctx.setCursor("arrow");
    ctx.requestPresent();
  }

  leave(): void {
    this.services.endScene();
  }

  tick(ctx: SceneContext): void {
    const input = ctx.input;
    if (input.buttonEvents.some((e) => e.down) || input.keyEvents.some((e) => !e.repeat)) ctx.scenes.request(SceneId.hub);
  }
}

export function createPlaceholderScene(services: MathServices): Scene {
  return new PlaceholderScene(services);
}

/** Enregistre les 11 scènes dans le moteur (le titre est la première : `engine.start()` la lance). */
export function registerScenes(engine: Engine, services: MathServices, options: RegisterScenesOptions = {}): void {
  for (const id of Object.values(SceneId)) {
    const override = options.factories?.[id];
    const builder = SCENE_FACTORIES[id];
    const factory: SceneFactory = override ?? (builder ? () => builder(services, options, engine) : () => createPlaceholderScene(services));
    engine.register(id, factory);
  }
}
