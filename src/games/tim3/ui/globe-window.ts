/**
 * Globe : `GRAVITY.ITF` (ouverture 41cbdc, procédure 41cc84, boutons 41ce47, réglettes 41cf20, fenêtre de couleur 41d0c4).
 *
 * - Réglettes verticales, 0 en haut, glisser continu : gravité 0 à 512 (glissière 18004, bouton 18006), pression 0 à 128 (18003,
 *   18005). Valeurs écrites en direct (le jeu les écrit dans le niveau à la fermeture, 41cc25 : même effet).
 * - **Mode Jeu** : 41cf20 rend 0 tout de suite ; un appui sur une réglette ouvre GENERIC 31137 (« … uniquement … dans le labo. »).
 *   Écart : le jeu ne place pas les boutons (ils restent aux positions de l'ITF) ; le port les place sur les valeurs du puzzle, pour
 *   qu'on les lise (consultation).
 * - Couleur du décor : GP_LEFT −1 (sous 1 → 15), GP_RIGHT +1 (au-delà de 15 → 1), dans tous les modes ; GP_WINDOW montre la couleur
 *   (rectangle plein en (x + 6, y + 6, l − 10, h − 7)).
 * - « Terminé » et Échap ferment sans annuler ; GP_HELP (`TIMHELP.EXE`, 4169c8(8)) n'est pas porté : grisé.
 */
import { readItf, type Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { itfText } from "../render/itf-draw";
import { mapColor } from "../render/palette";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import { openItfWindow, type ItfWindowHandle, type ItfWindowOptions, type ItfHost, type ItfSlider } from "./itf-window";

export const GLOBE = {
  colorRight: 18013,
  colorLeft: 18012,
  window: 18011,
  help: 18010,
  done: 18007,
  gravityKnob: 18006,
  pressureKnob: 18005,
  gravitySlider: 18004,
  pressureSlider: 18003,
  gravityLabel: 18008,
  pressureLabel: 18009,
  colorLabel: 18014,
} as const;
export const GRAVITY_MAX = 512;
export const PRESSURE_MAX = 128;
export const BACKGROUND_COLORS = 15;
/** « La Gravité et la Pression Atmosphérique peuvent uniquement être modifiées dans le labo. » */
export const LAB_ONLY_TEXT = 31137;

export interface GlobeSettings {
  gravity: number;
  pressure: number;
  background: number;
}

export interface GlobeWindowOptions {
  settings: GlobeSettings;
  /** Labo (modes 1 et 6) : réglettes actives. */
  lab: boolean;
  change(settings: Partial<GlobeSettings>): void;
  /** Appui sur une réglette en mode Jeu : message du jeu. */
  refused(text: string): void;
}

export function globeWindow(assets: RenderAssets, itf: Itf, o: GlobeWindowOptions): { itf: Itf; options: ItfWindowOptions } {
  const s = { ...o.settings };
  const set = (patch: Partial<GlobeSettings>): void => {
    Object.assign(s, patch);
    o.change(patch);
  };
  const refused = (): void => o.refused(itfText(assets, LAB_ONLY_TEXT));
  const sliders: ItfSlider[] = [
    { slider: GLOBE.gravitySlider, knob: GLOBE.gravityKnob, max: GRAVITY_MAX, vertical: true, label: itfText(assets, 21035), value: () => s.gravity, set: (v) => set({ gravity: v }), enabled: o.lab, refused, page: 16 },
    { slider: GLOBE.pressureSlider, knob: GLOBE.pressureKnob, max: PRESSURE_MAX, vertical: true, label: itfText(assets, 21036), value: () => s.pressure, set: (v) => set({ pressure: v }), enabled: o.lab, refused, page: 8 },
  ];
  const drawColor = (surface: Surface, r: Rect): void => {
    const clip = surface.setClip(r.x, r.y, r.width - 1, r.height - 1);
    surface.fillRect(r.x + 6, r.y + 6, r.width - 10, r.height - 7, mapColor(s.background));
    surface.restoreClip(clip);
  };
  return {
    itf,
    options: {
      title: copy.globeTitle,
      state: { disabled: [GLOBE.help], draw: { [GLOBE.window]: drawColor } },
      defaultId: GLOBE.done,
      cancelId: GLOBE.done,
      labels: { [GLOBE.colorLeft]: copy.backgroundPrevious, [GLOBE.colorRight]: copy.backgroundNext, [GLOBE.help]: copy.help },
      sliders,
      status: () => copy.backgroundStatus(s.background),
      choose: (id) => {
        if (id === GLOBE.colorLeft) {
          set({ background: s.background - 1 < 1 ? BACKGROUND_COLORS : s.background - 1 });
          return true;
        }
        if (id === GLOBE.colorRight) {
          set({ background: s.background + 1 > BACKGROUND_COLORS ? 1 : s.background + 1 });
          return true;
        }
        return false;
      },
    },
  };
}

export function openGlobeWindow(host: ItfHost, o: GlobeWindowOptions & { onClose?(): void }): ItfWindowHandle {
  const w = globeWindow(host.assets, readItf(host.assets.index.get("GRAVITY.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
