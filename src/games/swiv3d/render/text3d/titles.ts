/**
 * Titres 3D des menus et des écrans de fin (`gm_title_spawn` `00422f8c` avec le type 11, `gm_title_release` `004235d8`,
 * `docs/swiv3d/screens.md` § 4.1, `rules.md` § 8) : un texte flottant qui arrive en vol puis tourne sur place jusqu'à la sortie du menu.
 *
 * Les effets de l'exécutable avancent d'un tick toutes les 25 ms d'horloge (`gm_poll_events`) dans les menus comme en jeu ; le retard
 * au-delà de 800 ms (onglet masqué, écran de chargement) est abandonné.
 */
import { createText3d, type Text3d, type Text3dAssets } from "./draw";
import { MessagePool } from "./message";

/** Pas de la boucle d'événements (`0x19` ms) et seuil d'abandon du retard. */
const TICK_MS = 25;
const CATCH_UP_MS = 800;
/** Teinte d'un titre de menu : ligne `0x04` de la table de couleurs du bloc 11003. */
export const TITLE_TINT = 0x400;
/** Type de trajectoire des titres de menu. */
const TITLE_TYPE = 11;

export interface TitleLayer {
  /** Un nouveau titre arrive ; les précédents restent tels quels (l'appelant a appelé `release` en quittant le menu). */
  show(text: Uint8Array): void;
  /** Sortie du menu : les titres affichés repartent. */
  release(): void;
  /** Efface tout (changement d'arrière-plan sans transition). */
  clear(): void;
  /** Avance les effets jusqu'à `now` (ms) et trace les titres dans `fb`, avec la table de couleurs du niveau qui sert de fond. */
  draw(fb: Uint8Array, now: number, colors: Uint8Array): void;
}

export function createTitleLayer(assets: Text3dAssets): TitleLayer {
  const pool = new MessagePool();
  const text3d: Text3d = createText3d(assets);
  let last: number | null = null;
  let accumulated = 0;
  return {
    show: (text) => void pool.spawn(text, TITLE_TINT, TITLE_TYPE),
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
