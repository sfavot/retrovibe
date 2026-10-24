/**
 * Registre des scènes de Math Workshop : une fabrique par `SceneId` (table `SCENE_FACTORIES`, complète : le typage l'impose).
 * `options.factories` permet d'en remplacer une de l'extérieur (tests).
 */
import type { Engine } from "../engine/engine";
import { SceneId, type Scene, type SceneFactory } from "../engine/scene";
import type { MathServices } from "../engine/services";
import { createBowlingScene } from "./bowling";
import { createCreditsScene } from "./credits";
import type { CertificateEnvironment, CertificatePort } from "./certificate";
import { createHiddenScene } from "./hidden";
import { createHubScene, type HubOptions } from "./hub";
import { createPatternsScene } from "./patterns";
import { createPatternWindowsScene } from "./pattern-windows";
import { createRhythmScene } from "./rhythm";
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

/** Une ligne par scène. */
const SCENE_FACTORIES: Record<SceneId, SceneBuilder> = {
  [SceneId.title]: (services) => createTitleScene(services),
  [SceneId.credits]: (services) => createCreditsScene(services),
  [SceneId.hub]: (services, options) => createHubScene(services, options),
  [SceneId.rhythm]: (services) => createRhythmScene(services),
  [SceneId.bowling]: (services, options) => createBowlingScene(services, { textInput: options.textInput }),
  [SceneId.hidden]: (services) => createHiddenScene(services),
  [SceneId.patterns]: (services) => createPatternsScene(services),
  [SceneId.patternWindows]: (services, options) => createPatternWindowsScene(services, { download: options.certificates, textInput: options.textInput }),
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

/** Enregistre les 11 scènes dans le moteur (le titre est la première : `engine.start()` la lance). */
export function registerScenes(engine: Engine, services: MathServices, options: RegisterScenesOptions = {}): void {
  for (const id of Object.values(SceneId)) {
    const builder = SCENE_FACTORIES[id];
    const factory: SceneFactory = options.factories?.[id] ?? (() => builder(services, options, engine));
    engine.register(id, factory);
  }
}
