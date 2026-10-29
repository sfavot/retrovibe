import type { Scene as MohawkScene, SceneFactory as MohawkSceneFactory, SceneManager as MohawkSceneManager } from "../../../engine/mohawk/scene";
import type { ZoombinisContext } from "./context";

// Cadre commun (services, gestionnaire de scènes) : défini dans `src/engine/mohawk/scene.ts`, réexporté ici pour les écrans du jeu.
export { Services, defineService, type ServiceKey } from "../../../engine/mohawk/scene";

/**
 * Les 23 écrans de la table `1530:14fe` (engine.md §2.1). L'identifiant est le numéro d'écran de `DS:8552` / `DS:8554`.
 * Noms dérivés des archives et des handlers ; `docs/zoombinis/plan.md` donne l'ordre du parcours.
 */
export const ScreenId = {
  /** Logo QuickTime `Logo025.MOV`, sans archive : écran de départ. */
  logo: 0,
  /** `MAP.MHK` : carte des épreuves. */
  map: 1,
  /** `XFER.MHK` : transition animée entre deux écrans. */
  xfer: 2,
  /** `PICKER.MHK` : choix des Zoombinis. */
  picker: 3,
  /** `BASECAMP.MHK` : camp de base 1. */
  baseCamp: 4,
  /** `BCTWO.MHK` : camp de base 2. */
  bcTwo: 5,
  /** `TOWN.MHK` : Zoombiniville. */
  town: 6,
  /** `BRIDGE.MHK` : épreuve 1. */
  bridge: 7,
  /** `TUNNELS.MHK` : épreuve 2. */
  tunnels: 8,
  /** `PIZZA.MHK` : épreuve 3. */
  pizza: 9,
  /** `FERRY.MHK` : épreuve 4. */
  ferry: 10,
  /** `LILLY.MHK` : épreuve 5. */
  lilly: 11,
  /** `SLIDES.MHK` : épreuve 6. */
  slides: 12,
  /** `FLEENS.MHK` : épreuve 7. */
  fleens: 13,
  /** `HOTEL.MHK` : épreuve 8. */
  hotel: 14,
  /** `NET.MHK` : épreuve 9. */
  net: 15,
  /** `CAVES.MHK` : épreuve 10. */
  caves: 16,
  /** `SMOKE.MHK` : épreuve 11. */
  smoke: 17,
  /** `MAZE2.MHK` : épreuve 12. */
  maze2: 18,
  /** Sous-écran du sélecteur dans `PICKER.MHK` (rôle inconnu, §2.5). */
  pickerSubA: 19,
  /** Autre sous-écran du sélecteur dans `PICKER.MHK` (rôle inconnu, §2.5). */
  pickerSubB: 20,
  /** Doublon du 19 dans la table (même descripteur). */
  pickerSubAAlias: 21,
  /** Doublon du 0 dans la table (même descripteur). */
  logoAlias: 22,
} as const;

export type ScreenName = keyof typeof ScreenId;
export type ScreenId = (typeof ScreenId)[ScreenName];

/** Noms par identifiant (`SCREEN_NAMES[4] === "baseCamp"`). */
export const SCREEN_NAMES: readonly ScreenName[] = Object.entries(ScreenId)
  .sort(([, a], [, b]) => a - b)
  .map(([name]) => name as ScreenName);

/** Contexte d'un écran de Zoombinis (voir `context.ts`). */
export type SceneContext = ZoombinisContext;

export type Scene = MohawkScene<SceneContext>;
export type SceneFactory = MohawkSceneFactory<SceneContext>;
export type SceneManager = MohawkSceneManager<ScreenId, SceneContext>;
