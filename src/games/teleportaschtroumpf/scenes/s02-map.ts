import type { Scene, SceneContext } from "../engine/scene";
import { FreeModeScene } from "./map/free-mode";
import { MapScene, type MapMode, type MapRequest } from "./map/map-scene";

export type { MapMode, MapRequest };

/**
 * Carte du Pays Schtroumpf S02 (engine.md §1.3, `1a3c:0225(k, a, b, mode)`) et mode libre (`1a3c:002a`) ; détail RE et écarts :
 * `docs/teleportaschtroumpf/screens-map.md`. Modules : `map/view.ts` (tables et géométrie, pur), `map/image.ts` (fond défilant et
 * marqueur), `map/map-scene.ts` (la carte), `map/free-mode.ts` (le mode libre).
 *
 * ### `createMapScene(request, onDone)`
 *
 * - reçoit : `request.mode` — `"consult"` : consultation depuis la pause (code 202 de `28a3:00ad`, `1a3c:0225(zone, 1, 0, 1)`),
 *   `request.zone` = indice de zone 1..54 du pion (`291e:1536`, `DS:D2C4`) ; `"free"` : mode libre (`1a3c:0225(k, 1, 1, 2)`) ;
 *   `"wish"` : voyage du puits aux vœux S13 (`1a3c:0003`, le lieu choisi devient la destination du pion) ;
 * - rend : `onDone(ctx, k)` avec `k = 1` (retour) ou `2..18` (lieu de `MAP_LOCATIONS`, `game/tables.ts`) ; en consultation `k`
 *   vaut toujours 1 ; en mode `"wish"`, `k = 1` aussi quand 36 s se sont écoulées sans choix ;
 * - commandes (clavier d'origine) : consultation, haut / bas tenus font défiler ; `"free"` et `"wish"`, haut / bas changent de
 *   lieu (bip), Espace valide, Entrée joue la voix d'aide du lieu (mode libre seul) ; la souris ne désigne rien ;
 * - appelant : la scène de partie (`scenes/game.ts`, pause → carte : elle `replace` / `pop` au retour), `events/well.ts` (puits,
 *   mode `"wish"`) et `createFreeModeScene` ;
 * - écran suivant : décidé par l'appelant (la carte n'enchaîne rien) ;
 * - références : `s02a001d/002d/007d.mcg` (cadre), `s02a004d/005d/006d.mcg` (fond défilant), `s02a000s.hy8`, voix `s07a001b`
 *   (bip), `s45v` (aide), `s13b` (puits), `1a3c:0225`.
 */
export function createMapScene(request: MapRequest, onDone: (ctx: SceneContext, k: number) => void): Scene {
  return new MapScene(request, onDone);
}

/**
 * Mode libre « Schtroumpf » du menu S07 (engine.md §1.3, `1a3c:002a`).
 *
 * - reçoit : rien ; fabrique elle-même la partie à un joueur nécessaire aux mini-jeux (`newGame`, personnage et niveau tirés ;
 *   `Game.openMinigame(scène)` donne la requête, `Game.abortMinigame()` la referme au retour) ;
 * - rend : `onDone(ctx)` quand le joueur choisit « retour » (`k == 1`) ;
 * - déroulé : carte (`mode` `"free"`) → choix `k ≥ 2` → niveau tiré (`rand × 3`), voix d'accroche (`introVoice` de
 *   `board/voices.ts`) → mini-jeu de `MAP_LOCATIONS[k − 2].scene` (`createMinigame`, `minigames.ts`, empilé avec fondu ; son
 *   issue est ignorée) → retour à la carte, sur le même lieu ;
 * - appelant : `flow.ts` (`goFreeMap`), écran suivant : menu S07 ;
 * - références : `1a3c:002a`, `28a3:04dc`.
 */
export function createFreeModeScene(onDone: (ctx: SceneContext) => void): Scene {
  return new FreeModeScene(onDone);
}

export { FreeModeScene, MapScene };
