import {
  SceneManager as MohawkSceneManager,
  type BaseSceneContext,
  type Scene as MohawkScene,
  type SceneFactory as MohawkSceneFactory,
} from "../../../engine/mohawk/scene";
import type { CursorKind } from "./host";
import type { RosterState } from "./roster";

// Cadre commun (services, gestionnaire de scènes) : défini dans `src/engine/mohawk/scene.ts`, réexporté ici pour les scènes du jeu.
export { Services, defineService, type ServiceKey } from "../../../engine/mohawk/scene";

/**
 * Les 11 scènes de `MATH` (engine.md §1.4, table `1108:1b22`). Les identifiants sont ceux de la variable de scène demandée
 * `1108:1b20` ; le titre (8) est la première scène.
 */
export const SceneId = {
  hub: 0,
  bowling: 1,
  rhythm: 2,
  patternWindows: 3,
  hidden: 4,
  patterns: 5,
  sticklers: 6,
  rockets: 7,
  title: 8,
  credits: 9,
  trophy: 10,
} as const;

export type SceneName = keyof typeof SceneId;
export type SceneId = (typeof SceneId)[SceneName];

/** Noms par identifiant (`SCENE_NAMES[8] === "title"`). */
export const SCENE_NAMES: readonly SceneName[] = Object.entries(SceneId)
  .sort(([, a], [, b]) => a - b)
  .map(([name]) => name as SceneName);

/** Tout ce qu'une scène de Mathémagique peut utiliser : le contexte commun plus les joueurs et préférences. */
export type SceneContext = BaseSceneContext<SceneId, CursorKind> & {
  /** Joueurs, préférences et joueur courant. */
  readonly roster: RosterState;
};

/** Alias de `SceneContext` (nom du contexte dans la spécification du moteur commun). */
export type MathContext = SceneContext;

export type Scene = MohawkScene<SceneContext>;
export type SceneFactory = MohawkSceneFactory<SceneContext>;
export type SceneManager = MohawkSceneManager<SceneId, SceneContext>;
