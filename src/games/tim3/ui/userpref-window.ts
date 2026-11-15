/**
 * Préférences du joueur : `USERPREF.ITF` (42aa60, procédure 42ab98, choix 42ae4a), ouverte par « Options » du menu principal (4230dd)
 * et, dans le jeu Windows, par « Configurer > Préférences » (commande 103, 41675f ; le port n'a pas ce menu).
 *
 * - Ouverture (42abd6) : les cases (genre 3 : image 0 = éteinte, dernière image = allumée, 44f02c) montrent les préférences
 *   d'affichage du joueur (`[0x481034]`) : UP_AMBIENT_SEL (bit 1), UP_SCENERY_SEL (bit 2), UP_BG_SEL (bit 4) ; UP_INFO_SEL est allumée
 *   sauf si le bit 0x10 est levé (case inversée) ; UP_SOUND_SEL suit l'interrupteur général du son (4115e6(10000, −1)).
 * - Choix (42ae4a) : chaque case bascule son bit (42aea8, 42aeb3, 42aee3, 42af2e) ; éteindre les décors (bit 2) éteint aussi les fonds
 *   (bit 4) et leur case (42aec8). UP_SOUND_SEL bascule l'interrupteur général (42aeee : coupé, tout s'arrête). Les effets sur le jeu :
 *   `DISPLAY` (`engine/players.ts`).
 * - Langue : UP_LANGUAGE est caché (45064c, drapeau 8) ; ▲ ▼ (UP_UP, UP_DOWN : 42af51, 42afa2) parcourent en boucle les langues des
 *   paquets `*.DAT` présents (42b453 écrit `LANGUAGE.RES`) et la langue choisie est chargée à la fermeture (42aaa7 → 42b348). Le port n'a
 *   que le français (D4) : les flèches restent, sans effet, et l'état annoncé le dit.
 * - « ? » (UP_HELP, 4169c8(9) : manuel Windows) : l'aide du site, puis la fenêtre revient ; « Terminé » (UP_DONE) et Échap ferment
 *   (450d44 : 29002 par défaut et en annulation). Le jeu écrit ensuite le fichier du joueur (42aaa1 → 42c8cb) : le port garde chaque
 *   changement aussitôt (`setDisplay`, `setSound`) ; si le stockage refuse, l'appelant montre 31173 (`USERPREF_UNSAVED_TEXT`) en fermant.
 * - Titre (29012, `SYS12.PFT`, contrôle de 185 × 26) : comme celui de `SIGNIN.ITF`, le jeu ne pose que les mots qui tiennent sur une ligne
 *   (« Préférences des ») ; **écart voulu** (`withReadableTitle`) : le contrôle s'étend de la gauche des cases jusqu'à l'ordinateur.
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import { ITF_DEFAULT_FONT, imageOfState, itfText, layoutItf, stateLength } from "../render/itf-draw";
import { measureText } from "../render/text";
import { DISPLAY } from "../engine/players";
import { copy } from "../copy";
import { openItfWindow, type ItfHost, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";

export const USERPREF = {
  frame: 29001,
  done: 29002,
  scenerySel: 29003,
  backgroundSel: 29004,
  infoSel: 29006,
  scenery: 29008,
  background: 29009,
  info: 29011,
  heading: 29012,
  ambient: 29013,
  ambientSel: 29014,
  help: 29015,
  picture: 29016,
  soundSel: 29017,
  sound: 29018,
  language: 29019,
  up: 29020,
  down: 29021,
} as const;

/** `INTRFACE.RES` 2394 « Préférences du joueur » : titre de la fenêtre Windows (titre du `role="dialog"`). */
export const USERPREF_TITLE = 2394;
/**
 * `INTRFACE.RES` 31173 « Nous ne pouvons pas sauvegarder vos préférences… » : montré quand le stockage refuse d'écrire les préférences du
 * joueur. Aucun appel de TIMWIN.EXE ne le cite (42c8cb échoue en silence) : texte repris du jeu, déclencheur du port.
 */
export const USERPREF_UNSAVED_TEXT = 31173;

/** Case → son libellé (nom pour les lecteurs d'écran : le texte du jeu posé à droite). */
const LABEL_OF: Readonly<Record<number, number>> = {
  [USERPREF.ambientSel]: USERPREF.ambient,
  [USERPREF.scenerySel]: USERPREF.scenery,
  [USERPREF.backgroundSel]: USERPREF.background,
  [USERPREF.infoSel]: USERPREF.info,
  [USERPREF.soundSel]: USERPREF.sound,
};

export interface UserPrefState {
  /** Préférences d'affichage (`DISPLAY`). */
  display: number;
  /** Interrupteur général du son. */
  soundOn: boolean;
}

export interface UserPrefOptions {
  initial: UserPrefState;
  /** Nouvelles préférences d'affichage (à garder pour le joueur courant et appliquer au jeu). */
  setDisplay(display: number): void;
  /** Interrupteur général du son (42aeee). */
  setSound(on: boolean): void;
  /** « ? » : l'appelant ouvre l'aide après la fermeture, puis rouvre la fenêtre. */
  help(): void;
}

/** 42ae4a : préférences d'affichage après un clic sur la case `id` (autre contrôle : inchangées). */
export function toggleDisplay(display: number, id: number): number {
  switch (id) {
    case USERPREF.ambientSel:
      return display ^ DISPLAY.ambient;
    case USERPREF.scenerySel: {
      const next = display ^ DISPLAY.scenery;
      return next & DISPLAY.scenery ? next : next & ~DISPLAY.background;
    }
    case USERPREF.backgroundSel:
      return display ^ DISPLAY.background;
    case USERPREF.infoSel:
      return display ^ DISPLAY.noInfo;
    default:
      return display;
  }
}

/** Case allumée (42accf : `noInfo` est inversée ; le son suit l'interrupteur général). */
export function userPrefChecked(state: UserPrefState, id: number): boolean | undefined {
  switch (id) {
    case USERPREF.ambientSel:
      return (state.display & DISPLAY.ambient) !== 0;
    case USERPREF.scenerySel:
      return (state.display & DISPLAY.scenery) !== 0;
    case USERPREF.backgroundSel:
      return (state.display & DISPLAY.background) !== 0;
    case USERPREF.infoSel:
      return (state.display & DISPLAY.noInfo) === 0;
    case USERPREF.soundSel:
      return state.soundOn;
    default:
      return undefined;
  }
}

/**
 * Titre lisible (écart voulu, voir l'en-tête) : si le titre ne tient pas sur une ligne dans son contrôle, celui-ci s'étend de la gauche des
 * cases jusqu'à l'image de l'ordinateur, à la même hauteur ; inchangé si le titre tient déjà ou ne tiendrait pas non plus.
 */
export function withReadableTitle(assets: RenderAssets, itf: Itf): Itf {
  const heading = itf.controls.find((c) => c.id === USERPREF.heading);
  const box = itf.controls.find((c) => c.id === USERPREF.ambientSel);
  const picture = itf.controls.find((c) => c.id === USERPREF.picture);
  const font = assets.font(ITF_DEFAULT_FONT);
  if (!heading || !box || !picture || !font) return itf;
  const text = layoutItf(assets, itf).items.find((i) => i.id === USERPREF.heading)?.text ?? "";
  const width = measureText(font, text);
  const room = picture.x - box.x;
  if (width <= heading.width || width > room) return itf;
  return { ...itf, controls: itf.controls.map((c) => (c.id === USERPREF.heading ? { ...c, x: box.x, width: room } : c)) };
}

/** Fenêtre sans DOM (tests, rendu) : ITF et options. */
export function userPrefWindow(assets: RenderAssets, baseItf: Itf, o: UserPrefOptions): { itf: Itf; options: ItfWindowOptions } {
  const itf = withReadableTitle(assets, baseItf);
  const s: UserPrefState = { ...o.initial };
  const anm = itf.anm ? assets.anm(itf.anm) : null;
  const lastFrame = (id: number): number => {
    const c = itf.controls.find((k) => k.id === id);
    const first = c && anm ? imageOfState(anm, c.value) : -1;
    return anm && first >= 0 ? stateLength(anm, first) - 1 : 0;
  };
  const frames = (): Record<number, number> => Object.fromEntries(Object.keys(LABEL_OF).map((k) => [k, userPrefChecked(s, Number(k)) ? lastFrame(Number(k)) : 0]));
  const state: NonNullable<ItfWindowOptions["state"]> = { hidden: [USERPREF.language], frames: frames() };
  const layout = layoutItf(assets, itf);
  const textOf = (id: number): string => layout.items.find((i) => i.id === id)?.text.trim() ?? "";
  const labels: Record<number, string> = { [USERPREF.help]: copy.help, [USERPREF.up]: copy.languagePrevious, [USERPREF.down]: copy.languageNext };
  for (const [box, label] of Object.entries(LABEL_OF)) labels[Number(box)] = textOf(label);
  return {
    itf,
    options: {
      title: itfText(assets, USERPREF_TITLE),
      state,
      defaultId: USERPREF.done,
      cancelId: USERPREF.done,
      labels,
      checked: (id) => userPrefChecked(s, id),
      status: () => copy.languageStatus,
      choose: (id) => {
        switch (id) {
          case USERPREF.ambientSel:
          case USERPREF.scenerySel:
          case USERPREF.backgroundSel:
          case USERPREF.infoSel:
            s.display = toggleDisplay(s.display, id);
            o.setDisplay(s.display);
            break;
          case USERPREF.soundSel:
            s.soundOn = !s.soundOn;
            o.setSound(s.soundOn);
            break;
          case USERPREF.up:
          case USERPREF.down:
            // Une seule langue (D4) : la liste fait un tour sur elle-même.
            return true;
          case USERPREF.help:
            o.help();
            return false;
          default:
            return false;
        }
        state.frames = frames();
        return true;
      },
    },
  };
}

export function openUserPrefWindow(host: ItfHost, o: UserPrefOptions & { onClose?(): void }): ItfWindowHandle {
  const w = userPrefWindow(host.assets, readItf(host.assets.index.get("USERPREF.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
