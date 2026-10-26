/**
 * Titres 3D des menus (`gm_message_spawn` `00422f8c` avec le type 11, `gm_title_release` `004235d8`, `docs/swiv3d/screens.md` § 4.1,
 * `rules.md` § 8) : un texte flottant qui arrive en vol en 31 ticks, tourne sur place jusqu'à la sortie du menu puis repart en 21 ticks.
 * Chaque menu choisit sa chaîne et sa teinte ; trajectoire, échelle et lumière sont les mêmes pour tous. Les écrans de fin de mission
 * n'ont pas de titre 3D (le titre y est un bandeau du menu).
 *
 * Les effets de l'exécutable avancent d'un tick toutes les 25 ms d'horloge (`gm_poll_events`) dans les menus comme en jeu ; le retard
 * au-delà de 800 ms (onglet masqué, écran de chargement) est abandonné.
 */
import { createText3d, type Text3d, type Text3dAssets } from "./draw";
import { MessagePool } from "./message";

/** Pas de la boucle d'événements (`0x19` ms) et seuil d'abandon du retard. */
const TICK_MS = 25;
const CATCH_UP_MS = 800;
/** Teinte du titre « Pause » (et d'autres menus) : ligne `0x04` de la table de couleurs du bloc 11003. */
export const TITLE_TINT = 0x400;
/** Type de trajectoire des titres de menu. */
const TITLE_TYPE = 11;

export interface TitleLayer {
  /** Un nouveau titre arrive avec sa teinte (ligne × 256) ; les précédents restent tels quels (l'appelant a appelé `release` en quittant le menu). */
  show(text: Uint8Array, tint: number): void;
  /** Sortie du menu : les titres affichés repartent. */
  release(): void;
  /** Efface tout (changement d'arrière-plan sans transition). */
  clear(): void;
  /**
   * Avance les effets jusqu'à `now` (ms) et trace les titres dans `fb`, avec la table de couleurs du niveau qui sert de fond. À appeler
   * avant de tracer le menu : `gm_menu_run` dessine ses lignes par-dessus l'image de `gm_frame`, qui contient les titres.
   */
  draw(fb: Uint8Array, now: number, colors: Uint8Array): void;
}

export function createTitleLayer(assets: Text3dAssets): TitleLayer {
  const pool = new MessagePool();
  const text3d: Text3d = createText3d(assets);
  let last: number | null = null;
  let accumulated = 0;
  return {
    show: (text, tint) => void pool.spawn(text, tint, TITLE_TYPE),
    release: () => pool.releaseTitles(),
    clear: () => pool.clear(),
    draw(fb, now, colors) {
      accumulated = last === null ? 0 : accumulated + (now - last);
      last = now;
      if (accumulated > CATCH_UP_MS) accumulated = 0;
      for (; accumulated > TICK_MS; accumulated -= TICK_MS) pool.tick();
      text3d.draw(fb, pool, colors);
    },
  };
}
